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
export const DEFAULT_NOTES = 'Downpayment is required for reservation*\nRemaining balance needs to be paid to service provider';

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
const NAVY = '#0c2f54', GREY = '#666666', BAND = '#f1f1f1', BOX = '#d9d9d9';
const usd = (n) => `$${num(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${m}/${d}/${y}`;
};

export function invoicePdf(inv) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 0, info: { Title: `Invoice ${inv.number}`, Author: 'Aqua Lux Aruba' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const L = 48, R = 564, W = R - L;
    doc.rect(0, 0, 612, 8).fill('#2b3990');
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(19).text('Aqua Lux Aruba', L, 34);
    doc.rect(0, 62, 612, 2.5).fill('#c9c9c9');

    // logo: one uploaded in Settings, else the Aqua Lux logo that comes with the CRM
    const logo = getSetting('invoice_logo', null);
    let drewLogo = false;
    for (const img of [logo?.data ? Buffer.from(logo.data, 'base64') : null, fs.existsSync(LOGO_FILE) ? LOGO_FILE : null]) {
      if (!img || drewLogo) continue;
      try { doc.image(img, R - 118, 60, { fit: [128, 104], align: 'right' }); drewLogo = true; } catch { /* unreadable image */ }
    }
    if (!drewLogo) {
      doc.fillColor(NAVY).font('Times-Roman').fontSize(20).text('AQUA LUX', R - 130, 92, { width: 130, align: 'center', characterSpacing: 1.5 });
      doc.fillColor('#c5a059').font('Helvetica').fontSize(6).text('CONCIERGE SERVICE', R - 130, 116, { width: 130, align: 'center', characterSpacing: 1.2 });
    }

    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(34).text('Invoice', L, 84);
    doc.fillColor(GREY).font('Helvetica').fontSize(9)
      .text(`No. ${inv.number}  ·  ${fmtDate(String(inv.issue_date || '').slice(0, 10))}`, L, 124);

    // Invoice for / Payable to / Choose option
    let y = 150;
    const c2 = L + 178, c3 = L + 330;
    doc.fillColor('#333').font('Helvetica-Bold').fontSize(11.5);
    doc.text('Invoice for', L, y); doc.text('Payable to', c2, y); doc.text('Choose Option', c3, y);
    y += 20;
    doc.font('Helvetica').fontSize(9.5).fillColor(GREY);
    doc.text(inv.bill_name || '', L, y + 4, { width: 165 });
    const afterName = doc.y;
    doc.text(inv.bill_address || '', L, afterName + 4, { width: 165 });
    const leftEnd = doc.y;
    let py = y;
    const payable = getSetting('invoice_payable', DEFAULT_PAYABLE) || [];
    payable.forEach((p, i) => {
      const details = String(p.detail || '').split('\n').filter(Boolean);
      const h = Math.max(1, details.length) * 18;
      doc.rect(c3 - 4, py, 130, h).fill(i % 2 ? '#ececec' : BOX);
      doc.fillColor(GREY).text(p.method || '', c2, py + 5, { width: 145 });
      details.forEach((d, k) => doc.fillColor('#444').text(d, c3, py + 5 + k * 18, { width: 124, lineBreak: false }));
      py += h;
    });
    y = Math.max(py, leftEnd) + 28;

    // lines
    const C = { desc: [L, 178], date: [L + 184, 58], people: [L + 242, 40], down: [L + 286, 76], bal: [L + 362, 96], total: [L + 458, 58] };
    const cell = (text, [x, w], yy, align = 'left') => doc.text(text, x, yy, { width: w, align });
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10);
    cell('Description', C.desc, y); cell('Date', C.date, y); cell('People', C.people, y, 'right');
    cell('Downpayment', C.down, y, 'right'); cell('Remaining Balance', C.bal, y, 'right'); cell('Total', C.total, y, 'right');
    y += 22;
    doc.font('Helvetica').fontSize(9.5);
    inv.lines.forEach((l, i) => {
      const extra = (l.details || []).filter((d) => d.value).map((d) => `${d.label}: ${d.value}`).join('\n');
      doc.fontSize(9.5);
      const dh = doc.heightOfString(l.description || ' ', { width: C.desc[1] });
      doc.fontSize(8);
      const eh = extra ? doc.heightOfString(extra, { width: C.desc[1] + 60 }) + 3 : 0;
      const h = Math.max(20, dh + eh + 9);
      if (y + h > 700) { doc.addPage(); y = 50; }
      if (i % 2 === 0) doc.rect(L - 4, y, W + 8, h).fill(BAND);
      if (extra) doc.fillColor(GREY).fontSize(8).text(extra, L, y + 5 + dh + 2, { width: C.desc[1] + 60 });
      doc.fontSize(9.5).fillColor('#111'); cell(l.description, C.desc, y + 5);
      doc.fillColor(GREY);
      cell(fmtDate(l.date), C.date, y + 5); cell(l.people, C.people, y + 5, 'right');
      cell(l.downpayment ? usd(l.downpayment) : '-', C.down, y + 5, 'right');
      cell(l.balance ? usd(l.balance) : '-', C.bal, y + 5, 'right');
      cell(usd(l.downpayment + l.balance), C.total, y + 5, 'right');
      y += h;
    });
    y += 6;
    doc.moveTo(L - 4, y).lineTo(R + 4, y).lineWidth(0.7).strokeColor('#bdbdbd').stroke();
    y += 14;

    // notes (left) and totals (right)
    const t = totals(inv.lines);
    let ty = y;
    for (const [label, value, rule] of [['Downpayment', t.downpayment], ['Remaining balance', t.balance, true], ['Total', t.total]]) {
      doc.fillColor(NAVY).font('Helvetica').fontSize(9.5).text(label, L + 300, ty, { width: 150, align: 'right' });
      doc.fillColor('#111').font('Helvetica-Bold').text(usd(value), R - 90, ty, { width: 90, align: 'right' });
      ty += 16;
      if (rule) { doc.moveTo(L + 458, ty - 2).lineTo(R + 4, ty - 2).lineWidth(0.6).strokeColor('#8a8a8a').stroke(); ty += 3; }
    }
    const notes = String(inv.notes || '').split('\n').map((x) => x.trim()).filter(Boolean);
    let ny = y;
    doc.fillColor('#8a8a8a').font('Helvetica').fontSize(9.5).text('Notes:', L, ny);
    notes.forEach((n, i) => {
      doc.font(i === 0 ? 'Helvetica' : 'Helvetica-Bold').fillColor(i === 0 ? '#8a8a8a' : '#333')
        .text(n, L + 48, ny, { width: 262 });
      ny = doc.y + 5;
    });
    doc.end();
  });
}
