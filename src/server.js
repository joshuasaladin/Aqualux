import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, touchRequest, logActivity, upsertClient } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

const STATUSES = ['new', 'contacted', 'quoted', 'in_progress', 'completed', 'cancelled'];
const PAYMENT_STATUSES = ['unpaid', 'deposit_paid', 'paid', 'refunded'];
const ACTIVITY_TYPES = ['note', 'email_in', 'email_out', 'call'];

// ---------------------------------------------------------------- auth ----
// Set ADMIN_PASSWORD to protect the CRM. The public intake endpoint stays
// open so the website contact form can always submit.
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

// ------------------------------------------------------- public intake ----
// POST { name, email, phone?, service, details? }
// Wire your website's "request a service" form to this endpoint.
app.post('/api/intake', (req, res) => {
  const { name, email, phone = '', service, details = '' } = req.body || {};
  if (!name || !email || !service) {
    return res.status(400).json({ error: 'name, email and service are required' });
  }
  const client = upsertClient({ name, email, phone });
  const info = db.prepare(`INSERT INTO requests (client_id, service, details) VALUES (?, ?, ?)`)
    .run(client.id, service, details);
  logActivity(info.lastInsertRowid, 'created', `Request received via website from ${email}`);
  res.status(201).json({ ok: true, request_id: info.lastInsertRowid });
});

app.use('/api', requireAuth);

// ----------------------------------------------------------- dashboard ----
app.get('/api/dashboard', (req, res) => {
  const byStatus = {};
  for (const row of db.prepare(`SELECT status, COUNT(*) n FROM requests GROUP BY status`).all()) {
    byStatus[row.status] = row.n;
  }
  const money = db.prepare(`
    SELECT COALESCE(SUM(paid_amount), 0) AS collected,
           COALESCE(SUM(CASE WHEN payment_status IN ('unpaid','deposit_paid')
                             AND status NOT IN ('cancelled')
                             THEN quoted_amount - paid_amount ELSE 0 END), 0) AS outstanding
    FROM requests`).get();
  const awaitingPayment = db.prepare(`
    SELECT COUNT(*) n FROM requests
    WHERE payment_status IN ('unpaid','deposit_paid')
      AND status NOT IN ('new','cancelled')`).get().n;
  const recent = db.prepare(`
    SELECT r.*, c.name AS client_name, c.email AS client_email
    FROM requests r JOIN clients c ON c.id = r.client_id
    ORDER BY r.updated_at DESC LIMIT 8`).all();
  res.json({
    by_status: byStatus,
    open: (byStatus.new || 0) + (byStatus.contacted || 0) + (byStatus.quoted || 0) + (byStatus.in_progress || 0),
    clients: db.prepare(`SELECT COUNT(*) n FROM clients`).get().n,
    awaiting_payment: awaitingPayment,
    collected: money.collected,
    outstanding: money.outstanding,
    recent
  });
});

// ------------------------------------------------------------ requests ----
app.get('/api/requests', (req, res) => {
  const { status, payment_status, q } = req.query;
  const where = [];
  const params = [];
  if (status && STATUSES.includes(status)) { where.push('r.status = ?'); params.push(status); }
  if (payment_status && PAYMENT_STATUSES.includes(payment_status)) {
    where.push('r.payment_status = ?'); params.push(payment_status);
  }
  if (q) {
    where.push(`(c.name LIKE ? OR c.email LIKE ? OR r.service LIKE ? OR r.details LIKE ?)`);
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  const rows = db.prepare(`
    SELECT r.*, c.name AS client_name, c.email AS client_email, c.phone AS client_phone
    FROM requests r JOIN clients c ON c.id = r.client_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY r.updated_at DESC LIMIT 500`).all(...params);
  res.json(rows);
});

app.post('/api/requests', (req, res) => {
  const { name, email, phone = '', service, details = '', quoted_amount = 0, currency = 'USD' } = req.body || {};
  if (!name || !email || !service) {
    return res.status(400).json({ error: 'name, email and service are required' });
  }
  const client = upsertClient({ name, email, phone });
  const info = db.prepare(`
    INSERT INTO requests (client_id, service, details, quoted_amount, currency)
    VALUES (?, ?, ?, ?, ?)`)
    .run(client.id, service, details, Number(quoted_amount) || 0, currency);
  logActivity(info.lastInsertRowid, 'created', 'Request created manually');
  res.status(201).json(getRequestFull(info.lastInsertRowid));
});

function getRequestFull(id) {
  const request = db.prepare(`
    SELECT r.*, c.name AS client_name, c.email AS client_email, c.phone AS client_phone, c.notes AS client_notes
    FROM requests r JOIN clients c ON c.id = r.client_id WHERE r.id = ?`).get(id);
  if (!request) return null;
  request.activities = db.prepare(`
    SELECT * FROM activities WHERE request_id = ? ORDER BY created_at DESC, id DESC`).all(id);
  return request;
}

app.get('/api/requests/:id', (req, res) => {
  const request = getRequestFull(req.params.id);
  if (!request) return res.status(404).json({ error: 'Not found' });
  res.json(request);
});

const STATUS_LABELS = {
  new: 'New', contacted: 'Contacted', quoted: 'Quoted',
  in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled'
};
const PAYMENT_LABELS = {
  unpaid: 'Unpaid', deposit_paid: 'Deposit paid', paid: 'Paid in full', refunded: 'Refunded'
};

app.patch('/api/requests/:id', (req, res) => {
  const id = req.params.id;
  const current = db.prepare(`SELECT * FROM requests WHERE id = ?`).get(id);
  if (!current) return res.status(404).json({ error: 'Not found' });

  const { status, payment_status, service, details, quoted_amount, paid_amount, currency } = req.body || {};
  if (status !== undefined) {
    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    if (status !== current.status) {
      db.prepare(`UPDATE requests SET status = ? WHERE id = ?`).run(status, id);
      logActivity(id, 'status', `Status changed: ${STATUS_LABELS[current.status]} → ${STATUS_LABELS[status]}`);
    }
  }
  if (payment_status !== undefined) {
    if (!PAYMENT_STATUSES.includes(payment_status)) return res.status(400).json({ error: 'Invalid payment status' });
    if (payment_status !== current.payment_status) {
      db.prepare(`UPDATE requests SET payment_status = ? WHERE id = ?`).run(payment_status, id);
      logActivity(id, 'payment', `Payment: ${PAYMENT_LABELS[current.payment_status]} → ${PAYMENT_LABELS[payment_status]}`);
    }
  }
  if (paid_amount !== undefined && Number(paid_amount) !== current.paid_amount) {
    db.prepare(`UPDATE requests SET paid_amount = ? WHERE id = ?`).run(Number(paid_amount) || 0, id);
    logActivity(id, 'payment', `Amount received set to ${current.currency} ${Number(paid_amount) || 0}`);
  }
  if (quoted_amount !== undefined) {
    db.prepare(`UPDATE requests SET quoted_amount = ? WHERE id = ?`).run(Number(quoted_amount) || 0, id);
  }
  if (service !== undefined) db.prepare(`UPDATE requests SET service = ? WHERE id = ?`).run(service, id);
  if (details !== undefined) db.prepare(`UPDATE requests SET details = ? WHERE id = ?`).run(details, id);
  if (currency !== undefined) db.prepare(`UPDATE requests SET currency = ? WHERE id = ?`).run(currency, id);

  touchRequest(id);
  res.json(getRequestFull(id));
});

app.delete('/api/requests/:id', (req, res) => {
  db.prepare(`DELETE FROM requests WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------- activities ----
app.post('/api/requests/:id/activities', (req, res) => {
  const { type = 'note', body } = req.body || {};
  if (!body) return res.status(400).json({ error: 'body is required' });
  if (!ACTIVITY_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid activity type' });
  const request = db.prepare(`SELECT id FROM requests WHERE id = ?`).get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Not found' });
  logActivity(req.params.id, type, body);
  touchRequest(req.params.id);
  res.status(201).json(getRequestFull(req.params.id));
});

// ------------------------------------------------------------- clients ----
app.get('/api/clients', (req, res) => {
  const q = req.query.q ? `%${req.query.q}%` : null;
  const rows = db.prepare(`
    SELECT c.*,
           COUNT(r.id) AS request_count,
           COALESCE(SUM(r.paid_amount), 0) AS total_paid,
           MAX(r.updated_at) AS last_activity
    FROM clients c LEFT JOIN requests r ON r.client_id = c.id
    ${q ? 'WHERE c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?' : ''}
    GROUP BY c.id ORDER BY last_activity DESC NULLS LAST, c.created_at DESC LIMIT 500`)
    .all(...(q ? [q, q, q] : []));
  res.json(rows);
});

app.get('/api/clients/:id', (req, res) => {
  const client = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Not found' });
  client.requests = db.prepare(`
    SELECT * FROM requests WHERE client_id = ? ORDER BY updated_at DESC`).all(client.id);
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

app.listen(PORT, () => {
  console.log(`Aqualux CRM running at http://localhost:${PORT}${ADMIN_PASSWORD ? ' (password protected)' : ''}`);
});
