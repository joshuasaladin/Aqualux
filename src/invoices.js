// Invoices: one invoice can list several services (one line each), with a
// downpayment and remaining balance per line. Lines start from the lead's
// booking lines; each service's own invoice notes (policies) come along.
// The PDF follows the invoice the team used to make in a spreadsheet.
import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, getSetting } from './db.js';

const LOGO_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'logo.png');

export const DEFAULT_PAYABLE = [
  { method: 'Zelle', detail: 'aqualuxaruba@gmail.com' },
  { method: 'Venmo', detail: '@AquaLuxAruba' },
  { method: 'Bank Transfer Aruba', detail: 'Joshua Saladin\n3106380190\nAruba Bank' }
];
export const DEFAULT_NOTES = 'Down payment is required to secure the reservation.\nRemaining balance must be paid to the service provider.';

export const invoiceSettings = () => ({
  payable: getSetting('invoice_payable', DEFAULT_PAYABLE),
  default_notes: getSetting('invoice_default_notes', DEFAULT_NOTES),
  logo: getSetting('invoice_logo', null) ? true : false
});

const num = (v) => Math.round((Number(v) || 0) * 100) / 100;
const lc = (s) => String(s || '').trim().toLowerCase();

export function cleanLines(lines) {
  return (Array.isArray(lines) ? lines : []).map((l) => ({
    description: String(l.description || '').slice(0, 200),
    date: /^\d{4}-\d{2}-\d{2}$/.test(l.date || '') ? l.date : '',
    people: String(l.people ?? '').slice(0, 30),
    downpayment: num(l.downpayment),
    balance: num(l.balance),
    service_id: Number(l.service_id) || null,
    // extra information this service needs on the invoice (set per service)
    details: (Array.isArray(l.details) ? l.details : []).slice(0, 12)
      .map((d) => ({ label: String(d?.label || '').trim().slice(0, 60), value: String(d?.value || '').trim().slice(0, 200) }))
      .filter((d) => d.label)
  })).filter((l) => l.description || l.downpayment || l.balance || l.service_id);
}

export function totals(lines) {
  const downpayment = num(lines.reduce((a, l) => a + l.downpayment, 0));
  const balance = num(lines.reduce((a, l) => a + l.balance, 0));
  return { downpayment, balance, total: num(downpayment + balance) };
}

export function getInvoice(id) {
  const inv = db.prepare(`
    SELECT i.*, c.name AS client_name, c.email AS client_email
    FROM invoices i LEFT JOIN clients c ON c.id = i.client_id WHERE i.id = ?`).get(id);
  if (!inv) return null;
  try { inv.lines = cleanLines(JSON.parse(inv.lines || '[]')); } catch { inv.lines = []; }
  inv.totals = totals(inv.lines);
  return inv;
}

// The service in the Services pages that a booking line is about.
function serviceFor(name) {
  const n = lc(name);
  if (!n) return null;
  const all = db.prepare(`SELECT * FROM services`).all();
  return all.find((s) => lc(s.service_name) === n || lc(s.wix_form_name) === n) ||
    all.find((s) => n.includes(lc(s.service_name)) || (s.wix_form_name && n.includes(lc(s.wix_form_name)))) || null;
}

const serviceById = (id) => (id ? db.prepare(`SELECT * FROM services WHERE id = ?`).get(id) : null) || null;
// The service an invoice line is about: the one picked, else by its description.
const serviceOf = (line) => (typeof line === 'string' ? serviceFor(line) : serviceById(line?.service_id) || serviceFor(line?.description));
const splitLines = (text) => String(text || '').split('\n').map((x) => x.trim()).filter(Boolean);
// The details a service wants on its invoice line, keeping what is already filled in.
export function detailsFor(service, have = []) {
  const labels = splitLines(service?.invoice_fields);
  const out = labels.map((label) => ({ label, value: have.find((d) => lc(d.label) === lc(label))?.value || '' }));
  for (const d of have) if (d.value && !out.some((x) => lc(x.label) === lc(d.label))) out.push(d);
  return out;
}

// How much of a price is the downpayment, from the service's price options.
function depositFor(service, line, price, people) {
  if (!service || !price) return 0;
  const opts = db.prepare(`SELECT * FROM service_options WHERE service_id = ? ORDER BY sort_order, id`).all(service.id)
    .filter((o) => o.downpayment_percent || o.downpayment_fixed);
  if (!opts.length) return 0;
  const hay = lc(`${line.name} ${line.info}`);
  const o = opts.find((x) => x.option_name && hay.includes(lc(x.option_name))) || opts[0];
  let dep = 0;
  if (o.downpayment_percent) dep += price * o.downpayment_percent / 100;
  if (o.downpayment_fixed) dep += o.downpayment_fixed * (o.downpayment_per_person ? Math.max(1, parseInt(people, 10) || 1) : 1);
  return num(Math.min(price, dep));
}

// The notes for a set of invoice lines: the general notes first, then each
// service's own policies (once each).
export function notesFor(lines) {
  const out = [];
  const add = (text) => {
    for (const l of String(text || '').split('\n').map((x) => x.trim()).filter(Boolean)) {
      if (!out.some((x) => lc(x) === lc(l))) out.push(l);
    }
  };
  add(getSetting('invoice_default_notes', DEFAULT_NOTES));
  for (const l of lines) add(serviceOf(l)?.invoice_notes);
  return out.join('\n');
}

// When a service is newly added to an invoice by hand, its policy lines join the notes.
export function notesWithNewServices(oldLines, newLines, notes) {
  const had = new Set(oldLines.map((l) => serviceOf(l)?.id).filter(Boolean));
  const out = String(notes || '').split('\n');
  for (const l of newLines) {
    const svc = serviceOf(l);
    if (!svc || had.has(svc.id)) continue;
    had.add(svc.id);
    for (const n of String(svc.invoice_notes || '').split('\n').map((x) => x.trim()).filter(Boolean)) {
      if (!out.some((x) => lc(x) === lc(n))) out.push(n);
    }
  }
  return out.join('\n').replace(/^\n+/, '');
}

// A new invoice's contents, from what is filled in on the lead.
export function draftFromLead(leadId) {
  const lead = db.prepare(`
    SELECT l.*, c.name AS client_name FROM leads l JOIN clients c ON c.id = l.client_id WHERE l.id = ?`).get(leadId);
  if (!lead) return null;
  const rows = db.prepare(`SELECT * FROM lead_services WHERE lead_id = ? ORDER BY service_date IS NULL, service_date, id`).all(leadId);
  const lines = rows.map((r) => {
    const people = r.people || (lead.party_size ? String(lead.party_size) : '');
    const price = num(r.downpayment) + num(r.balance);
    const svc = serviceFor(r.name);
    const dep = num(r.downpayment) || depositFor(svc, r, price, people);
    const label = svc?.invoice_description?.trim() || r.name;
    return {
      service_id: svc?.id || null,
      details: detailsFor(svc).map((d) => (/\btime\b/i.test(d.label) && r.service_time ? { ...d, value: r.service_time } : d)),
      description: r.info && !lc(label).includes(lc(r.info)) ? `${label} (${r.info})` : label,
      date: r.service_date || lead.service_date || '',
      people,
      downpayment: dep,
      balance: num(price - dep)
    };
  });
  if (!lines.length && lead.service) {
    lines.push({ description: lead.service, date: lead.service_date || '', people: lead.party_size ? String(lead.party_size) : '',
      downpayment: 0, balance: num(lead.price) });
  }
  return {
    lead_id: lead.id, client_id: lead.client_id,
    bill_name: lead.client_name, bill_address: '',
    lines: cleanLines(lines),
    notes: notesFor(rows.length ? rows.map((r) => r.name) : [lead.service])
  };
}

// Lines worked out by the AI: link each to its service and add that service's details.
export function linkServices(lines) {
  return (Array.isArray(lines) ? lines : []).map((l) => {
    const svc = serviceFor(l.service_name) || serviceFor(l.description);
    return { ...l, service_id: svc?.id || null, details: detailsFor(svc, Array.isArray(l.details) ? l.details : []) };
  });
}

export function createInvoice(d) {
  const year = new Date(Date.now() - 4 * 3600e3).getUTCFullYear();
  const n = db.prepare(`SELECT COUNT(*) n FROM invoices WHERE number LIKE ?`).get(`${year}-%`).n + 1;
  const info = db.prepare(`
    INSERT INTO invoices (lead_id, client_id, number, bill_name, bill_address, lines, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(d.lead_id || null, d.client_id || null, `${year}-${String(n).padStart(3, '0')}`,
      d.bill_name || '', d.bill_address || '', JSON.stringify(cleanLines(d.lines)), d.notes ?? notesFor([]));
  return getInvoice(info.lastInsertRowid);
}

// ----------------------------------------------------------------- PDF ----
// A4, navy and gold: header with the logo, a "bill to" card, the services
// table, the payment options, the payment summary and the notes.
const NAVY = '#0c2f54', BLUE = '#0b4a8a', GOLD = '#b8914f', GREY = '#6b7280', CARD = '#f3f6fa', RULE = '#dfe5ec';
const usd = (n) => `$${num(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = (iso) => {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-').map(Number);
  return y && m && d ? `${MONTHS[m - 1]} ${d}, ${y}` : '';
};

export function invoicePdf(inv) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Invoice ${inv.number}`, Author: 'Aqua Lux Aruba' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const L = 48, R = 547, W = R - L, PAGE_END = 758;
    const B = 'Helvetica-Bold', N = 'Helvetica';
    const footer = () => {
      doc.moveTo(L, 769).lineTo(R, 769).lineWidth(0.6).strokeColor(RULE).stroke();
      doc.font(B).fontSize(7.5).fillColor(NAVY).text('AQUA LUX ARUBA  |  CONCIERGE SERVICE', L, 782, { lineBreak: false, characterSpacing: 0.3 });
      doc.font(N).fontSize(8).fillColor(BLUE).text('www.aqualuxaruba.com', L, 782, { width: W, align: 'right', lineBreak: false });
    };
    const topBand = () => { doc.rect(0, 0, 595.28, 9).fill(NAVY); doc.rect(0, 9, 595.28, 2.5).fill(GOLD); };
    let y = 0;
    // keeps a block together: starts a new page when it would run into the footer
    const need = (h) => { if (y + h > PAGE_END) { footer(); doc.addPage(); topBand(); y = 48; } };
    const heading = (text, x = L) => { doc.font(B).fontSize(10).fillColor(NAVY).text(text, x, y, { lineBreak: false, characterSpacing: 0.3 }); y += 21; };

    // ---- header
    topBand();
    doc.font(B).fontSize(11).fillColor(NAVY).text('AQUA LUX ARUBA', L, 75, { characterSpacing: 0.4 });
    doc.font(B).fontSize(35).text('INVOICE', L, 106, { characterSpacing: 0.5 });
    doc.rect(L, 152, 37, 2.2).fill(GOLD);
    doc.font(N).fontSize(9.5).fillColor(GREY).text(`Invoice no. ${inv.number}`, L, 169);
    doc.text(`Issued ${longDate(inv.issue_date)}`, L, 185);
    // logo: one uploaded in Settings, else the Aqua Lux logo that comes with the CRM
    const custom = getSetting('invoice_logo', null);
    let drewLogo = false;
    if (custom?.data) {
      try { doc.image(Buffer.from(custom.data, 'base64'), R - 150, 72, { fit: [150, 118], align: 'right', valign: 'center' }); drewLogo = true; } catch { /* unreadable image */ }
    }
    if (!drewLogo && fs.existsSync(LOGO_FILE)) {
      try { doc.image(LOGO_FILE, 383, 40, { width: 190 }); } catch { /* unreadable image */ }
    }

    // ---- bill to / payment details
    const payable = (getSetting('invoice_payable', DEFAULT_PAYABLE) || []).filter((p) => p.method || p.detail);
    const mid = L + W / 2;
    doc.font(N).fontSize(10);
    const addrH = inv.bill_address ? doc.heightOfString(inv.bill_address, { width: mid - L - 40 }) : 0;
    const cardH = Math.max(100, 76 + addrH);
    y = 220;
    doc.roundedRect(L, y, W, cardH, 8).fill(CARD);
    doc.moveTo(mid, y + 23).lineTo(mid, y + cardH - 23).lineWidth(0.8).strokeColor('#d3dbe5').stroke();
    doc.font(B).fontSize(8.5).fillColor(BLUE).text('BILL TO', L + 17, y + 20, { characterSpacing: 0.3 });
    doc.font(B).fontSize(13).fillColor(NAVY).text(inv.bill_name || '', L + 17, y + 40, { width: mid - L - 40, lineBreak: false, ellipsis: true });
    doc.font(N).fontSize(10).fillColor(GREY).text(inv.bill_address || '', L + 17, y + 62, { width: mid - L - 40 });
    doc.font(B).fontSize(8.5).fillColor(BLUE).text('PAYMENT DETAILS', mid + 21, y + 20, { characterSpacing: 0.3 });
    doc.font(N).fontSize(9.5).fillColor(NAVY).text(payable.map((p) => p.method).filter(Boolean).join('  /  '), mid + 21, y + 42, { width: W / 2 - 38 });
    doc.fillColor(GREY).text('See payment methods below', mid + 21, doc.y + 8, { width: W / 2 - 38 });
    y += cardH + 27;

    // ---- services
    const C = { desc: [L + 13, 240], date: [L + 269, 60], guests: [L + 329, 45], total: [R - 113, 100] };
    const tableHead = () => {
      doc.roundedRect(L, y, W, 27, 5).fill(NAVY);
      doc.font(B).fontSize(8).fillColor('#ffffff');
      doc.text('DESCRIPTION', C.desc[0], y + 10, { lineBreak: false, characterSpacing: 0.3 });
      doc.text('DATE', C.date[0], y + 10, { lineBreak: false, characterSpacing: 0.3 });
      doc.text('GUESTS', C.guests[0], y + 10, { width: C.guests[1], align: 'center', lineBreak: false, characterSpacing: 0.3 });
      doc.text('TOTAL', C.total[0], y + 10, { width: C.total[1], align: 'right', lineBreak: false, characterSpacing: 0.3 });
      y += 27;
    };
    need(120);
    heading('SERVICE DETAILS');
    tableHead();
    inv.lines.forEach((l) => {
      const extra = (l.details || []).filter((d) => d.value).map((d) => `${d.label}: ${d.value}`).join('\n');
      doc.font(N).fontSize(9.5);
      const dh = doc.heightOfString(l.description || ' ', { width: C.desc[1] });
      doc.fontSize(8);
      const eh = extra ? doc.heightOfString(extra, { width: C.desc[1] }) + 4 : 0;
      const pad = extra || dh > 14 ? 12 : 17;
      const h = dh + eh + pad * 2;
      if (y + h > PAGE_END) { footer(); doc.addPage(); topBand(); y = 48; tableHead(); }
      doc.rect(L, y, W, h).fill(CARD);
      for (const ly of [y, y + h]) doc.moveTo(L, ly).lineTo(R, ly).lineWidth(0.6).strokeColor(RULE).stroke();
      const ty = y + pad;
      doc.font(N).fontSize(9.5).fillColor(NAVY).text(l.description || '', C.desc[0], ty, { width: C.desc[1] });
      if (extra) doc.fontSize(8).fillColor(GREY).text(extra, C.desc[0], ty + dh + 4, { width: C.desc[1] });
      doc.font(N).fontSize(9.5).fillColor(NAVY);
      doc.text(fmtDate(l.date), C.date[0], ty, { width: C.date[1], lineBreak: false });
      doc.text(l.people || '', C.guests[0], ty, { width: C.guests[1], align: 'center', lineBreak: false });
      doc.font(B).fontSize(10.5).text(usd(l.downpayment + l.balance), C.total[0], ty - 0.5, { width: C.total[1], align: 'right', lineBreak: false });
      y += h;
    });
    y += 17;

    // ---- payment options: two columns, filled top to bottom
    if (payable.length) {
      const blocks = payable.map((p) => ({ method: String(p.method || '').toUpperCase(), lines: String(p.detail || '').split('\n').map((x) => x.trim()).filter(Boolean) }));
      const bh = (b) => 15 + Math.max(1, b.lines.length) * 16 + 6;
      const colH = (c) => c.reduce((a, b) => a + bh(b), 0);
      // split where the two columns come out most even
      let k = 1;
      for (let i = 1; i <= blocks.length; i++) {
        const tall = (n) => Math.max(colH(blocks.slice(0, n)), colH(blocks.slice(n)));
        if (tall(i) < tall(k)) k = i;
      }
      const cols = [blocks.slice(0, k), blocks.slice(k)];
      const boxH = Math.max(colH(cols[0]), colH(cols[1])) - 6 + 28;
      need(boxH + 40);
      heading('PAYMENT OPTIONS');
      doc.roundedRect(L, y, W, boxH, 8).fill(CARD);
      if (cols[1].length) doc.moveTo(mid - 3, y + 15).lineTo(mid - 3, y + boxH - 15).lineWidth(0.8).strokeColor('#d3dbe5').stroke();
      cols.forEach((col, ci) => {
        const x = ci ? mid + 15 : L + 16;
        let cy = y + 14;
        for (const b of col) {
          doc.font(B).fontSize(8).fillColor(BLUE).text(b.method, x, cy, { width: W / 2 - 34, lineBreak: false, characterSpacing: 0.3 });
          cy += 15;
          doc.font(N).fontSize(9.5).fillColor(NAVY);
          for (const line of b.lines) { doc.text(line, x, cy, { width: W / 2 - 34, lineBreak: false, ellipsis: true }); cy += 16; }
          if (!b.lines.length) cy += 16;
          cy += 6;
        }
      });
      y += boxH + 20;
    }

    // ---- payment summary
    const t = totals(inv.lines);
    need(100);
    heading('PAYMENT SUMMARY', L + 14);
    const sx = L + 262;
    y -= 4;
    for (const [label, value] of [['Down payment', t.downpayment], ['Remaining balance', t.balance]]) {
      doc.font(N).fontSize(9.5).fillColor(GREY).text(label, sx, y, { lineBreak: false });
      doc.font(B).fontSize(10.5).fillColor(NAVY).text(usd(value), sx, y - 0.5, { width: R - 14 - sx, align: 'right', lineBreak: false });
      y += 21;
    }
    doc.moveTo(sx, y - 3).lineTo(R - 14, y - 3).lineWidth(0.6).strokeColor(RULE).stroke();
    y += 9;
    doc.font(B).fontSize(10.5).fillColor(NAVY).text('TOTAL', sx, y + 3, { lineBreak: false });
    doc.font(B).fontSize(16).fillColor(BLUE).text(usd(t.total), sx, y - 2, { width: R - 14 - sx, align: 'right', lineBreak: false });
    y += 28;

    // ---- notes
    const notes = String(inv.notes || '').split('\n').map((x) => x.trim()).filter(Boolean);
    if (notes.length) {
      doc.font(N).fontSize(9.5);
      need(17 + Math.min(notes.length, 2) * 16);
      doc.font(B).fontSize(9).fillColor(NAVY).text('BOOKING & PAYMENT NOTES', L, y, { lineBreak: false, characterSpacing: 0.3 });
      y += 17;
      for (const n of notes) {
        doc.font(N).fontSize(9.5);
        const h = doc.heightOfString(n, { width: W - 60 });
        need(h);
        doc.font(N).fontSize(9.5).fillColor(GREY).text(n, L, y, { width: W - 60 });
        y += h + 5;
      }
    }
    footer();
    doc.end();
  });
}
