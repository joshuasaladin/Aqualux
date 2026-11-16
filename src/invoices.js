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
// A4 payment invoice: who it is for, a big "pay this amount now" block (the
// downpayment), what is paid later in person, the services, how to pay and
// the terms. The spacing tightens as services are added so that five or more
// still fit on one page.
const NAVY = '#0e2f56', BLUE = '#0b4a8a', GOLD = '#c19a5b', GREY = '#6b7280', CARD = '#f1f5f9', RULE = '#dfe5ec';
const usd = (n) => `$${num(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = (iso, year = true) => {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-').map(Number);
  return y && m && d ? `${MONTHS[m - 1]} ${d}${year ? `, ${y}` : ''}` : '';
};
// "March 31, 2027", or the first and last day when the services are on several days
function serviceDates(lines) {
  const days = [...new Set(lines.map((l) => l.date).filter(Boolean))].sort();
  if (!days.length) return '';
  const [a, b] = [days[0], days[days.length - 1]];
  if (a === b) return longDate(a);
  return `${longDate(a, a.slice(0, 4) !== b.slice(0, 4))} – ${longDate(b)}`;
}
// The standard lines are printed with the amounts filled in, so the same
// sentences in an invoice's notes are not repeated.
const STANDARD_NOTE = /^(down ?payment is required|remaining balance (needs to|must) be paid)/i;

// Spacing for a normal invoice, and tighter ones for when there is a lot on it.
const PDF_SIZES = [
  { payBox: 139, amount: 46, later: 59, head: 35, rowPad: 15, gap: 24, optLine: 15.5, footer: 788 },
  { payBox: 108, amount: 36, later: 48, head: 28, rowPad: 9, gap: 17, optLine: 14, footer: 796 },
  { payBox: 88, amount: 30, later: 40, head: 24, rowPad: 6.5, gap: 12, optLine: 13, footer: 812 }
];

function renderInvoice(inv, Z) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Invoice ${inv.number}`, Author: 'Aqua Lux Aruba' } });
    const chunks = [];
    let pages = 1;
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve({ pdf: Buffer.concat(chunks), pages }));
    doc.on('error', reject);

    const L = 43, R = 552, W = R - L, PAGE_END = Z.footer - 4;
    const B = 'Helvetica-Bold', N = 'Helvetica';
    const t = totals(inv.lines);
    const payNow = t.downpayment > 0;          // a downpayment is asked now
    const payLater = payNow && t.balance > 0;  // and the rest in person
    const footer = () => {
      doc.moveTo(L, Z.footer).lineTo(R, Z.footer).lineWidth(0.8).strokeColor(RULE).stroke();
      doc.font(B).fontSize(7.5).fillColor(NAVY).text('AQUA LUX ARUBA  |  CONCIERGE SERVICE', L, Z.footer + 10, { lineBreak: false });
      doc.font(N).fontSize(8).fillColor(BLUE).text('www.aqualuxaruba.com', L, Z.footer + 10, { width: W, align: 'right', lineBreak: false });
    };
    const topBand = () => doc.rect(0, 0, 595.28, 9).fill(NAVY);
    let y = 0;
    const newPage = () => { footer(); doc.addPage(); pages++; topBand(); y = 40; };
    const need = (h) => { if (y + h > PAGE_END) newPage(); };
    const heading = (text) => { doc.font(B).fontSize(10).fillColor(NAVY).text(text, L, y, { lineBreak: false }); y += 19; };

    // ---- header
    topBand();
    doc.font(B).fontSize(12).fillColor(NAVY).text('AQUA LUX ARUBA', L, 44);
    doc.font(B).fontSize(7.5).fillColor(GOLD).text('CONCIERGE SERVICE', L, 63);
    const custom = getSetting('invoice_logo', null);
    let drewLogo = false;
    if (custom?.data) {
      try { doc.image(Buffer.from(custom.data, 'base64'), R - 130, 24, { fit: [130, 68], align: 'right', valign: 'center' }); drewLogo = true; } catch { /* unreadable image */ }
    }
    if (!drewLogo && fs.existsSync(LOGO_FILE)) {
      try { doc.image(LOGO_FILE, R - 104, 2, { width: 118 }); } catch { /* unreadable image */ }
    }
    doc.moveTo(L, 102).lineTo(R, 102).lineWidth(0.8).strokeColor(RULE).stroke();
    doc.font(B).fontSize(28).fillColor(NAVY).text('INVOICE', L, 116);
    doc.font(B).fontSize(9.5).text(`No. ${inv.number}`, L, 125, { width: W - 2, align: 'right' });
    doc.font(N).fontSize(9).fillColor(GREY).text(`Issued: ${fmtDate(String(inv.issue_date || '').slice(0, 10))}`, L, 142, { width: W - 2, align: 'right' });

    // ---- bill to / service date
    const half = W / 2 - 20;
    doc.font(B).fontSize(8).fillColor(BLUE).text('BILL TO', L, 165);
    doc.font(B).fontSize(12.5).fillColor(NAVY).text(inv.bill_name || '', L, 180, { width: half, lineBreak: false, ellipsis: true });
    doc.font(N).fontSize(10).fillColor(GREY).text(inv.bill_address || '', L, 198, { width: half, height: 26, ellipsis: true });
    const when = serviceDates(inv.lines);
    if (when) {
      doc.font(B).fontSize(8).fillColor(BLUE).text(when.includes('–') ? 'SERVICE DATES' : 'SERVICE DATE', L + 272, 165);
      doc.font(B).fontSize(11.5).fillColor(NAVY).text(when, L + 272, 181, { width: W - 272, lineBreak: false });
    }
    y = 235 - (PDF_SIZES[0].gap - Z.gap);

    // ---- pay this amount now
    const s = Z.payBox / 139; // how far this block is shrunk
    doc.roundedRect(L, y, W, Z.payBox, 12).fill(NAVY);
    doc.font(B).fontSize(11.5).fillColor('#ffffff').text(payNow ? 'PAY THIS AMOUNT NOW' : 'TOTAL AMOUNT', L + 21, y + 20 * s, { lineBreak: false });
    doc.font(B).fontSize(Z.amount).text(usd(payNow ? t.downpayment : t.total), L + 20, y + 52 * s, { lineBreak: false });
    doc.font(N).fontSize(10).text(payNow ? 'Required to secure your reservation' : 'Paid at the time of service', L + 21, y + Z.payBox - 14 - 16 * s, { lineBreak: false });
    const pillH = Math.max(26, 36 * s);
    doc.roundedRect(R - 203, y + Z.payBox / 2 - pillH / 2 - 2, 180, pillH, 6).fill(GOLD);
    doc.font(B).fontSize(9.5).fillColor(NAVY).text(!payNow ? 'PAID IN PERSON' : payLater ? 'DOWN PAYMENT ONLY' : 'FULL PAYMENT',
      R - 203, y + Z.payBox / 2 - 5.5, { width: 180, align: 'center', lineBreak: false });
    y += Z.payBox + Math.min(14, Z.gap);

    // ---- pay later, in person
    if (payLater) {
      doc.roundedRect(L, y, W, Z.later, 8).fill(CARD);
      const m = y + Z.later / 2;
      doc.font(B).fontSize(9.5).fillColor(NAVY).text('PAY LATER — IN PERSON', L + 17, m - 14, { lineBreak: false });
      doc.font(N).fontSize(9).fillColor(GREY).text('Remaining balance due at the time of service', L + 17, m + 3, { lineBreak: false });
      doc.font(B).fontSize(21).fillColor(NAVY).text(usd(t.balance), L, m - 9, { width: W - 20, align: 'right', lineBreak: false });
      y += Z.later;
    }
    y += Z.gap;

    // ---- services
    const C = { desc: [L + 13, 270], date: [L + 300, 60], guests: [L + 368, 60], total: [R - 113, 100] };
    const tableHead = () => {
      doc.roundedRect(L, y, W, Z.head, 5).fill(NAVY);
      const ty = y + Z.head / 2 - 3;
      doc.font(B).fontSize(8).fillColor('#ffffff');
      doc.text('DESCRIPTION', C.desc[0], ty, { lineBreak: false });
      doc.text('DATE', C.date[0], ty, { lineBreak: false });
      doc.text('GUESTS', C.guests[0], ty, { width: C.guests[1], align: 'center', lineBreak: false });
      doc.text('TOTAL', C.total[0], ty, { width: C.total[1], align: 'right', lineBreak: false });
      y += Z.head;
    };
    heading('SERVICE DETAILS');
    tableHead();
    inv.lines.forEach((l, i) => {
      // the details go on one line under the description, to keep rows short
      const extra = (l.details || []).filter((d) => d.value).map((d) => `${d.label}: ${d.value}`).join('  ·  ');
      doc.font(N).fontSize(9.5);
      const dh = doc.heightOfString(l.description || ' ', { width: C.desc[1] });
      doc.fontSize(7.5);
      const eh = extra ? doc.heightOfString(extra, { width: C.desc[1] + 20 }) + 3 : 0;
      const h = dh + eh + Z.rowPad * 2;
      if (y + h > PAGE_END) { newPage(); tableHead(); }
      doc.rect(L, y, W, h).fill(CARD);
      if (i) doc.moveTo(L, y).lineTo(R, y).lineWidth(0.6).strokeColor(RULE).stroke();
      const ty = y + Z.rowPad + 1;
      doc.font(N).fontSize(9.5).fillColor(NAVY).text(l.description || '', C.desc[0], ty, { width: C.desc[1] });
      if (extra) doc.fontSize(7.5).fillColor(GREY).text(extra, C.desc[0], ty + dh + 2, { width: C.desc[1] + 20 });
      doc.font(N).fontSize(9.5).fillColor(NAVY);
      doc.text(fmtDate(l.date), C.date[0], ty, { width: C.date[1], lineBreak: false });
      doc.text(l.people || '', C.guests[0], ty, { width: C.guests[1], align: 'center', lineBreak: false });
      doc.font(B).fontSize(10.5).text(usd(l.downpayment + l.balance), C.total[0], ty - 0.5, { width: C.total[1], align: 'right', lineBreak: false });
      y += h;
    });
    need(20);
    doc.font(N).fontSize(10).fillColor(GREY).text(`Full service total: ${usd(t.total)}`, L, y + Math.min(12, Z.gap * 0.6), { width: W - 13, align: 'right', lineBreak: false });
    y += Math.min(12, Z.gap * 0.6) + 12 + Z.gap * 0.7;

    // ---- how to pay: two columns, split where they come out most even
    const payable = (getSetting('invoice_payable', DEFAULT_PAYABLE) || []).filter((p) => p.method || p.detail);
    if (payable.length && (payNow || !t.total)) {
      const blocks = payable.map((p) => ({ method: String(p.method || '').toUpperCase(), lines: String(p.detail || '').split('\n').map((x) => x.trim()).filter(Boolean) }));
      const bh = (b) => 14 + Math.max(1, b.lines.length) * Z.optLine + 5;
      const colH = (c) => c.reduce((a, b) => a + bh(b), 0);
      let k = 1;
      for (let i = 1; i <= blocks.length; i++) {
        const tall = (n) => Math.max(colH(blocks.slice(0, n)), colH(blocks.slice(n)));
        if (tall(i) < tall(k)) k = i;
      }
      const cols = [blocks.slice(0, k), blocks.slice(k)];
      const pad = Math.min(13, Z.gap * 0.7);
      const boxH = Math.max(colH(cols[0]), colH(cols[1])) - 5 + pad * 2;
      need(boxH + 22);
      heading(payNow ? `HOW TO PAY YOUR ${usd(t.downpayment)} ${payLater ? 'DOWN PAYMENT' : 'PAYMENT'}` : 'HOW TO PAY');
      doc.roundedRect(L, y, W, boxH, 8).fill(CARD);
      const mid = L + W / 2;
      if (cols[1].length) doc.moveTo(mid, y + pad).lineTo(mid, y + boxH - pad).lineWidth(0.8).strokeColor('#d3dbe5').stroke();
      cols.forEach((col, ci) => {
        const x = ci ? mid + 17 : L + 16;
        let cy = y + pad;
        for (const b of col) {
          doc.font(B).fontSize(8).fillColor(BLUE).text(b.method, x, cy, { width: W / 2 - 34, lineBreak: false });
          cy += 14;
          doc.font(N).fontSize(9.5).fillColor(NAVY);
          for (const line of b.lines) { doc.text(line, x, cy, { width: W / 2 - 34, lineBreak: false, ellipsis: true }); cy += Z.optLine; }
          if (!b.lines.length) cy += Z.optLine;
          cy += 5;
        }
      });
      y += boxH + Z.gap * 0.8;
    }

    // ---- payment terms: the amounts first, then this invoice's own notes
    const terms = [];
    if (payLater) {
      terms.push(`Only the ${usd(t.downpayment)} down payment is required now to reserve the service.`,
        `The remaining ${usd(t.balance)} is paid directly to the service provider in person.`);
    } else if (payNow) terms.push(`The full amount of ${usd(t.downpayment)} is required now to reserve the service.`);
    else if (t.total) terms.push(`The full amount of ${usd(t.total)} is paid directly to the service provider in person.`);
    for (const n of String(inv.notes || '').split('\n').map((x) => x.trim()).filter(Boolean)) {
      if (!STANDARD_NOTE.test(n)) terms.push(n);
    }
    if (terms.length) {
      need(14 + 13 * Math.min(terms.length, 2));
      doc.font(B).fontSize(8).fillColor(BLUE).text('PAYMENT TERMS', L, y, { lineBreak: false });
      y += 14;
      terms.forEach((n, i) => {
        doc.font(N).fontSize(9.5);
        const h = doc.heightOfString(n, { width: W });
        need(h);
        doc.font(N).fontSize(9.5).fillColor(i === 0 ? NAVY : GREY).text(n, L, y, { width: W });
        y += h + 2.5;
      });
    }
    footer();
    doc.end();
  });
}

// Uses the roomiest spacing that keeps the invoice on one page.
export async function invoicePdf(inv) {
  let out;
  for (const size of PDF_SIZES) {
    out = await renderInvoice(inv, size);
    if (out.pages === 1) break;
  }
  return out.pdf;
}
