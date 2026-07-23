import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, touchLead, upsertClient, setSetting, getSetting, markThreadProcessed, LEAD_ORDER } from './db.js';
import * as gmail from './gmail.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
// generous body limit so email replies can carry file attachments
app.use(express.json({ limit: '30mb' }));

// ---------------------------------------------------------------- auth ----
// Set ADMIN_PASSWORD to protect the CRM. The public intake endpoint and the
// Google OAuth callback stay open (Google redirects the browser there).
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

app.post('/api/login', (req, res) => {
  if (!ADMIN_PASSWORD) return res.json({ ok: true, token: '' });
  if ((req.body?.password || '') === ADMIN_PASSWORD) {
    return res.json({ ok: true, token: ADMIN_PASSWORD });
  }
  res.status(401).json({ error: 'Wrong password' });
});

function requireAuth(req, res, next) {
  if (!ADMIN_PASSWORD) return next();
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
  if (token === ADMIN_PASSWORD) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

function baseUrl(req) {
  return process.env.BASE_URL ||
    `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers['x-forwarded-host'] || req.headers.host}`;
}
const redirectUri = (req) => baseUrl(req) + '/api/gmail/callback';

// ------------------------------------------------------- public intake ----
// POST { name, email, phone?, service, details? } — for the website form.
app.post('/api/intake', (req, res) => {
  const { name, email, phone = '', service, details = '' } = req.body || {};
  if (!name || !email || !service) {
    return res.status(400).json({ error: 'name, email and service are required' });
  }
  const client = upsertClient({ name, email, phone });
  const info = db.prepare(`
    INSERT INTO leads (client_id, subject, service, notes) VALUES (?, ?, ?, ?)`)
    .run(client.id, service, service, details ? `Website form: ${details}` : '');
  db.prepare(`
    INSERT INTO messages (lead_id, direction, from_email, subject, body)
    VALUES (?, 'in', ?, ?, ?)`)
    .run(info.lastInsertRowid, email, service, details || `Service request: ${service}`);
  res.status(201).json({ ok: true, lead_id: info.lastInsertRowid });
});

// ----------------------------------------------------- gmail callback -----
// Must be reachable without auth: Google redirects the browser here.
app.get('/api/gmail/callback', async (req, res) => {
  try {
    if (req.query.error) throw new Error(req.query.error);
    const email = await gmail.handleCallback(req.query.code, req.query.state, redirectUri(req));
    gmail.syncNow().catch(() => {});
    res.send(`<meta http-equiv="refresh" content="2;url=/"><body style="font-family:sans-serif;text-align:center;padding-top:80px">
      ✅ Gmail connected as <b>${email}</b>. Taking you back to the CRM…</body>`);
  } catch (err) {
    res.status(400).send(`<body style="font-family:sans-serif;text-align:center;padding-top:80px">
      ❌ Gmail connection failed: ${String(err.message || err)}<br><br><a href="/">Back to CRM</a></body>`);
  }
});

app.use('/api', requireAuth);

// --------------------------------------------------------------- gmail ----
app.get('/api/gmail/status', (req, res) => {
  res.json({ ...gmail.connectionInfo(), redirect_uri: redirectUri(req) });
});

app.post('/api/gmail/credentials', (req, res) => {
  const { client_id, client_secret } = req.body || {};
  if (!client_id || !client_secret) {
    return res.status(400).json({ error: 'client_id and client_secret are required' });
  }
  setSetting('gmail_credentials', { client_id: client_id.trim(), client_secret: client_secret.trim() });
  res.json({ ok: true });
});

app.get('/api/gmail/auth-url', (req, res) => {
  try {
    res.json({ url: gmail.buildAuthUrl(redirectUri(req)) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/gmail/sync', async (req, res) => {
  try {
    res.json(await gmail.syncNow());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/gmail/import-recent', async (req, res) => {
  try {
    const days = Math.min(Number(req.body?.days) || 7, 30);
    setSetting('gmail_sync_since', Math.floor(Date.now() / 1000) - days * 86400);
    res.json(await gmail.syncNow());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/gmail/disconnect', (req, res) => {
  gmail.disconnect();
  res.json({ ok: true });
});

// --------------------------------------------------------------- leads ----
const LEAD_SELECT = `
  SELECT l.*, c.name AS client_name, c.email AS client_email, c.phone AS client_phone,
         COALESCE(s.total, 0) AS services_total,
         COALESCE(s.owed, 0)  AS services_owed
  FROM leads l JOIN clients c ON c.id = l.client_id
  LEFT JOIN (
    SELECT lead_id,
           SUM(downpayment + balance) AS total,
           SUM(downpayment * (1 - downpayment_paid) + balance * (1 - balance_paid)) AS owed
    FROM lead_services GROUP BY lead_id
  ) s ON s.lead_id = l.id`;

app.get('/api/leads', (req, res) => {
  const { q, tab, sort } = req.query;
  const where = [];
  const params = [];
  // Confirmed bookings live in their own tab (+ Calendar/Clients) — the main
  // Leads list shows only the active, not-yet-confirmed pipeline.
  where.push(tab === 'confirmed' ? 'l.booking_confirmed = 1' : 'l.booking_confirmed = 0');
  if (q) {
    where.push(`(c.name LIKE ? OR c.email LIKE ? OR l.service LIKE ? OR l.subject LIKE ?)`);
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  // 'newest' = most recent email/lead activity first; default = soonest
  // service date first with paid+confirmed sinking to the bottom.
  const order = sort === 'newest'
    ? `ORDER BY COALESCE(l.last_msg_at, l.created_at) DESC`
    : LEAD_ORDER;
  const rows = db.prepare(`${LEAD_SELECT}
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ${order} LIMIT 500`).all(...params);
  res.json(rows);
});

app.get('/api/leads/summary', (req, res) => {
  const s = db.prepare(`
    SELECT
      SUM(status IN ('new_lead','new_mail')) AS needs_reply,
      SUM(paid = 0 AND booking_confirmed = 1) AS confirmed_unpaid,
      SUM(booking_confirmed = 1 AND service_date >= date('now')) AS upcoming,
      COUNT(*) AS total
    FROM leads`).get();
  res.json(s);
});

function getLeadFull(id) {
  const lead = db.prepare(`${LEAD_SELECT} WHERE l.id = ?`).get(id);
  if (!lead) return null;
  lead.messages = db.prepare(`
    SELECT id, direction, from_email, subject, body, sent_at
    FROM messages WHERE lead_id = ? ORDER BY sent_at ASC, id ASC`).all(id);
  lead.services = db.prepare(`
    SELECT * FROM lead_services WHERE lead_id = ? ORDER BY id ASC`).all(id);
  return lead;
}

app.get('/api/leads/:id', (req, res) => {
  const lead = getLeadFull(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Not found' });
  res.json(lead);
});

app.post('/api/leads', (req, res) => {
  const { name, email, phone = '', service = '', service_date = null, price = 0 } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'name and email are required' });
  const client = upsertClient({ name, email, phone });
  const info = db.prepare(`
    INSERT INTO leads (client_id, subject, service, service_date, price)
    VALUES (?, ?, ?, ?, ?)`)
    .run(client.id, service, service, service_date || null, Number(price) || 0);
  res.status(201).json(getLeadFull(info.lastInsertRowid));
});

app.patch('/api/leads/:id', (req, res) => {
  const id = req.params.id;
  const lead = db.prepare(`SELECT * FROM leads WHERE id = ?`).get(id);
  if (!lead) return res.status(404).json({ error: 'Not found' });
  const { service, service_date, paid, booking_confirmed, price, notes, status, party_size, services } = req.body || {};
  if (service !== undefined) db.prepare(`UPDATE leads SET service = ? WHERE id = ?`).run(service, id);
  if (service_date !== undefined) {
    db.prepare(`UPDATE leads SET service_date = ? WHERE id = ?`).run(service_date || null, id);
  }
  if (paid !== undefined) db.prepare(`UPDATE leads SET paid = ? WHERE id = ?`).run(paid ? 1 : 0, id);
  if (booking_confirmed !== undefined) {
    db.prepare(`UPDATE leads SET booking_confirmed = ? WHERE id = ?`).run(booking_confirmed ? 1 : 0, id);
  }
  if (price !== undefined) db.prepare(`UPDATE leads SET price = ? WHERE id = ?`).run(Number(price) || 0, id);
  if (notes !== undefined) db.prepare(`UPDATE leads SET notes = ? WHERE id = ?`).run(notes, id);
  if (party_size !== undefined) {
    db.prepare(`UPDATE leads SET party_size = ? WHERE id = ?`).run(parseInt(party_size, 10) || null, id);
  }
  if (status !== undefined && ['new_lead', 'responded', 'new_mail'].includes(status)) {
    db.prepare(`UPDATE leads SET status = ? WHERE id = ?`).run(status, id);
  }
  if (Array.isArray(services)) {
    db.prepare(`DELETE FROM lead_services WHERE lead_id = ?`).run(id);
    const ins = db.prepare(`
      INSERT INTO lead_services (lead_id, name, downpayment, downpayment_paid, balance, balance_paid)
      VALUES (?, ?, ?, ?, ?, ?)`);
    for (const s of services) {
      if (!s || (!s.name && !s.downpayment && !s.balance)) continue;
      ins.run(id, String(s.name || '').slice(0, 200),
              Number(s.downpayment) || 0, s.downpayment_paid ? 1 : 0,
              Number(s.balance) || 0, s.balance_paid ? 1 : 0);
    }
  }
  touchLead(id);
  res.json(getLeadFull(id));
});

app.delete('/api/leads/:id', (req, res) => {
  // Remember every thread of this lead so a sync doesn't re-import it.
  const lead = db.prepare(`SELECT gmail_thread_id FROM leads WHERE id = ?`).get(req.params.id);
  if (lead?.gmail_thread_id) markThreadProcessed(lead.gmail_thread_id);
  for (const t of db.prepare(`SELECT thread_id FROM lead_threads WHERE lead_id = ?`).all(req.params.id)) {
    markThreadProcessed(t.thread_id);
  }
  db.prepare(`DELETE FROM leads WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// --------------------------------------------------------------- reply ----
app.post('/api/leads/:id/reply', async (req, res) => {
  const { body, attachments = [] } = req.body || {};
  if (!body?.trim() && !attachments.length) {
    return res.status(400).json({ error: 'Message body is required' });
  }
  const lead = db.prepare(`SELECT * FROM leads WHERE id = ?`).get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Not found' });
  const client = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(lead.client_id);

  const files = [];
  let totalBytes = 0;
  for (const a of Array.isArray(attachments) ? attachments : []) {
    if (!a?.filename || !a?.data) continue;
    const size = Math.floor(a.data.length * 3 / 4);
    totalBytes += size;
    files.push({
      filename: String(a.filename).replace(/[\r\n"]/g, '').slice(0, 200),
      mimeType: /^[\w.+-]+\/[\w.+-]+$/.test(a.mimeType || '') ? a.mimeType : 'application/octet-stream',
      data: a.data
    });
  }
  if (totalBytes > 20 * 1024 * 1024) {
    return res.status(400).json({ error: 'Attachments too large — keep the total under 20 MB' });
  }
  try {
    await gmail.sendReply(lead, client, (body || '').trim(), files);
    res.json(getLeadFull(lead.id));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ----------------------------------------------------------- signature ----
app.get('/api/signature', (req, res) => {
  res.json({ signature: getSetting('email_signature', gmail.DEFAULT_SIGNATURE) });
});

app.post('/api/signature', (req, res) => {
  setSetting('email_signature', String(req.body?.signature ?? '').slice(0, 2000));
  res.json({ ok: true });
});

// Signature image: uploaded once, embedded inline in every outgoing email.
app.get('/api/signature-image', (req, res) => {
  res.json({ image: getSetting('signature_image', null) });
});

app.post('/api/signature-image', (req, res) => {
  const { data, mimeType, filename } = req.body || {};
  if (!data || !/^image\/(png|jpe?g|gif|webp)$/.test(mimeType || '')) {
    return res.status(400).json({ error: 'Upload a PNG, JPG, GIF or WebP image' });
  }
  if (data.length > 2 * 1024 * 1024 * 4 / 3) {
    return res.status(400).json({ error: 'Image too large — keep it under 2 MB' });
  }
  setSetting('signature_image', { data, mimeType, filename: String(filename || 'signature').slice(0, 100) });
  res.json({ ok: true });
});

app.delete('/api/signature-image', (req, res) => {
  setSetting('signature_image', null);
  res.json({ ok: true });
});

// ------------------------------------------------------------ payments ----
app.get('/api/payments', (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM payments ORDER BY received_at DESC LIMIT 500`).all();
  const totals = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS all_time,
           COALESCE(SUM(CASE WHEN received_at >= date('now', 'start of month') THEN amount ELSE 0 END), 0) AS this_month,
           COALESCE(SUM(CASE WHEN received_at >= date('now', '-7 days') THEN amount ELSE 0 END), 0) AS this_week
    FROM payments`).get();
  res.json({ totals, payments: rows });
});

// Manual payment: cash, bank transfer, or anything Gmail didn't catch.
app.post('/api/payments', (req, res) => {
  const { payer, payer_email = '', service = '', amount, amount_due = 0,
          source = 'Cash', notes = '', received_at } = req.body || {};
  if (!payer?.trim()) return res.status(400).json({ error: 'Name is required' });
  const when = /^\d{4}-\d{2}-\d{2}/.test(received_at || '')
    ? new Date(received_at + 'T12:00:00').toISOString()
    : new Date().toISOString();
  const info = db.prepare(`
    INSERT INTO payments (source, payer, payer_email, service, amount, amount_due, notes, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(String(source).slice(0, 40), payer.trim().slice(0, 120), String(payer_email).slice(0, 200),
         String(service).slice(0, 200), Number(amount) || 0, Number(amount_due) || 0,
         String(notes).slice(0, 1000), when);
  res.status(201).json(db.prepare(`SELECT * FROM payments WHERE id = ?`).get(info.lastInsertRowid));
});

app.delete('/api/payments/:id', (req, res) => {
  db.prepare(`DELETE FROM payments WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// --------------------------------------------------------- services book --
app.get('/api/services', (req, res) => {
  const q = req.query.q ? `%${req.query.q}%` : null;
  const rows = db.prepare(`
    SELECT * FROM services
    ${q ? `WHERE category LIKE ? OR company LIKE ? OR service_name LIKE ? OR option_name LIKE ? OR notes LIKE ?` : ''}
    ORDER BY category, company, service_name, sort_order, id`)
    .all(...(q ? [q, q, q, q, q] : []));
  res.json(rows);
});

app.post('/api/services', (req, res) => {
  const b = req.body || {};
  if (!b.service_name?.trim()) return res.status(400).json({ error: 'Service name is required' });
  const info = db.prepare(`
    INSERT INTO services (category, company, service_name, option_name, price, price_unit,
      child_price, min_people, max_people, downpayment_type, downpayment_value,
      timing, commission, communication_method, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      String(b.category || '').trim(), String(b.company || '').trim(),
      String(b.service_name || '').trim(), String(b.option_name || '').trim(),
      Number(b.price) || 0, ['per_person', 'per_hour', 'flat_total'].includes(b.price_unit) ? b.price_unit : 'per_person',
      Number(b.child_price) || 0, b.min_people ? parseInt(b.min_people, 10) : null,
      b.max_people ? parseInt(b.max_people, 10) : null,
      b.downpayment_type === 'fixed' ? 'fixed' : 'percent', Number(b.downpayment_value) || 0,
      String(b.timing || '').trim(), String(b.commission || '').trim(),
      String(b.communication_method || '').trim(), String(b.notes || '').trim()
    );
  res.status(201).json(db.prepare(`SELECT * FROM services WHERE id = ?`).get(info.lastInsertRowid));
});

app.patch('/api/services/:id', (req, res) => {
  const svc = db.prepare(`SELECT * FROM services WHERE id = ?`).get(req.params.id);
  if (!svc) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  const fields = {
    category: b.category, company: b.company, service_name: b.service_name, option_name: b.option_name,
    price: b.price !== undefined ? Number(b.price) || 0 : undefined,
    price_unit: ['per_person', 'per_hour', 'flat_total'].includes(b.price_unit) ? b.price_unit : undefined,
    child_price: b.child_price !== undefined ? Number(b.child_price) || 0 : undefined,
    min_people: b.min_people !== undefined ? (b.min_people ? parseInt(b.min_people, 10) : null) : undefined,
    max_people: b.max_people !== undefined ? (b.max_people ? parseInt(b.max_people, 10) : null) : undefined,
    downpayment_type: b.downpayment_type === 'fixed' || b.downpayment_type === 'percent' ? b.downpayment_type : undefined,
    downpayment_value: b.downpayment_value !== undefined ? Number(b.downpayment_value) || 0 : undefined,
    timing: b.timing, commission: b.commission, communication_method: b.communication_method, notes: b.notes
  };
  const sets = [];
  const params = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    sets.push(`${k} = ?`);
    params.push(typeof v === 'string' ? v.trim() : v);
  }
  if (sets.length) {
    sets.push(`updated_at = datetime('now')`);
    params.push(req.params.id);
    db.prepare(`UPDATE services SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }
  res.json(db.prepare(`SELECT * FROM services WHERE id = ?`).get(req.params.id));
});

app.delete('/api/services/:id', (req, res) => {
  db.prepare(`DELETE FROM services WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// ------------------------------------------------------------ calendar ----
// Confirmed bookings within a date range, for the calendar tab.
app.get('/api/calendar', (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to are required (YYYY-MM-DD)' });
  const rows = db.prepare(`${LEAD_SELECT}
    WHERE l.booking_confirmed = 1 AND l.service_date BETWEEN ? AND ?
    ORDER BY l.service_date ASC`).all(from, to);
  res.json(rows);
});

// ------------------------------------------------------------- clients ----
app.get('/api/clients', (req, res) => {
  const q = req.query.q ? `%${req.query.q}%` : null;
  const rows = db.prepare(`
    SELECT c.*,
           COUNT(l.id) AS lead_count,
           COALESCE(SUM(CASE WHEN l.paid = 1 THEN l.price ELSE 0 END), 0) AS total_paid,
           MAX(l.updated_at) AS last_activity
    FROM clients c LEFT JOIN leads l ON l.client_id = c.id
    ${q ? 'WHERE c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?' : ''}
    GROUP BY c.id ORDER BY last_activity DESC NULLS LAST, c.created_at DESC LIMIT 500`)
    .all(...(q ? [q, q, q] : []));
  res.json(rows);
});

app.get('/api/clients/:id', (req, res) => {
  const client = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Not found' });
  client.leads = db.prepare(`SELECT l.* FROM leads l WHERE l.client_id = ? ${LEAD_ORDER}`).all(client.id);
  res.json(client);
});

app.patch('/api/clients/:id', (req, res) => {
  const client = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Not found' });
  const { name, email, phone, notes } = req.body || {};
  db.prepare(`UPDATE clients SET name = COALESCE(?, name), email = COALESCE(?, email),
              phone = COALESCE(?, phone), notes = COALESCE(?, notes) WHERE id = ?`)
    .run(name ?? null, email ?? null, phone ?? null, notes ?? null, client.id);
  res.json(db.prepare(`SELECT * FROM clients WHERE id = ?`).get(client.id));
});

app.delete('/api/clients/:id', (req, res) => {
  db.prepare(`DELETE FROM clients WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// -------------------------------------------------------------- static ----
app.use(express.static(path.join(__dirname, '..', 'public')));

const PORT = process.env.PORT || 3000;

if (process.env.DEMO === '1') {
  const { seedDemo } = await import('./seed.js');
  seedDemo();
}

// One-time cleanup: remove leads/clients mistakenly created from payment-
// service notification emails before the sender gate existed. Their threads
// are remembered so a sync never brings them back.
{
  const paymentClients = db.prepare(`SELECT id, email FROM clients`).all()
    .filter((c) => gmail.PAYMENT_SENDERS.test(c.email));
  for (const c of paymentClients) {
    for (const l of db.prepare(`SELECT gmail_thread_id FROM leads WHERE client_id = ?`).all(c.id)) {
      if (l.gmail_thread_id) markThreadProcessed(l.gmail_thread_id);
    }
    db.prepare(`DELETE FROM clients WHERE id = ?`).run(c.id); // cascades to leads
    console.log(`Removed payment-service lead/client: ${c.email}`);
  }
}

gmail.startPolling();

app.listen(PORT, () => {
  console.log(`Aqualux CRM running at http://localhost:${PORT}${ADMIN_PASSWORD ? ' (password protected)' : ''}`);
});
