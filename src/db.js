import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, 'aqualux.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS clients (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    email      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    phone      TEXT DEFAULT '',
    notes      TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS leads (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id         INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    gmail_thread_id   TEXT UNIQUE,
    subject           TEXT DEFAULT '',
    service           TEXT DEFAULT '',
    service_date      TEXT,                -- YYYY-MM-DD
    status            TEXT NOT NULL DEFAULT 'new_lead'
                      CHECK (status IN ('new_lead','responded','new_mail')),
    paid              INTEGER NOT NULL DEFAULT 0,
    booking_confirmed INTEGER NOT NULL DEFAULT 0,
    price             REAL DEFAULT 0,
    notes             TEXT DEFAULT '',
    last_msg_at       TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id          INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    gmail_message_id TEXT UNIQUE,
    rfc_message_id   TEXT DEFAULT '',
    direction        TEXT NOT NULL CHECK (direction IN ('in','out')),
    from_email       TEXT DEFAULT '',
    subject          TEXT DEFAULT '',
    body             TEXT DEFAULT '',
    sent_at          TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS lead_services (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id         INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    name            TEXT NOT NULL DEFAULT '',
    downpayment     REAL NOT NULL DEFAULT 0,
    downpayment_paid INTEGER NOT NULL DEFAULT 0,
    balance         REAL NOT NULL DEFAULT 0,
    balance_paid    INTEGER NOT NULL DEFAULT 0
  );

  -- Gmail threads already handled (form emails, skipped promos, deleted
  -- leads) so a sync never re-imports them.
  CREATE TABLE IF NOT EXISTS processed_threads (
    thread_id TEXT PRIMARY KEY
  );

  -- Extra Gmail threads attached to a lead (a client who writes in again
  -- from a new email thread stays ONE lead).
  CREATE TABLE IF NOT EXISTS lead_threads (
    thread_id TEXT PRIMARY KEY,
    lead_id   INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE
  );

  -- Incoming payment notifications (Venmo, Zelle, Chase, PayPal, ...)
  CREATE TABLE IF NOT EXISTS payments (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    gmail_message_id TEXT UNIQUE,
    source           TEXT DEFAULT '',
    payer            TEXT DEFAULT '',
    amount           REAL DEFAULT 0,
    subject          TEXT DEFAULT '',
    body             TEXT DEFAULT '',
    received_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Service info book: ONE row per bookable service (e.g. "Private Sailing
  -- Charter" at AWA Aruba). Pricing tiers live in service_options below.
  CREATE TABLE IF NOT EXISTS services (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    category              TEXT NOT NULL DEFAULT '',
    wix_form_name         TEXT NOT NULL DEFAULT '',
    service_name          TEXT NOT NULL DEFAULT '',
    company               TEXT NOT NULL DEFAULT '',
    contact               TEXT DEFAULT '',
    booking_method        TEXT DEFAULT '',
    info_needed           TEXT DEFAULT '',
    commission            TEXT DEFAULT '',
    internal_notes        TEXT DEFAULT '',
    sort_order            INTEGER NOT NULL DEFAULT 0,
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_services_category ON services(category);

  -- One pricing tier/option under a service (e.g. "Sunset Tour" or
  -- "Half Day — base (up to 6 people)").
  CREATE TABLE IF NOT EXISTS service_options (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    service_id            INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    option_name           TEXT NOT NULL DEFAULT '',
    price                 REAL DEFAULT 0,
    price_unit            TEXT NOT NULL DEFAULT 'per_person'
                           CHECK (price_unit IN ('flat_total','per_person','per_vehicle','per_hour','per_day','quote')),
    child_price           REAL DEFAULT 0,
    min_people            INTEGER,
    max_people            INTEGER,
    downpayment_percent   REAL DEFAULT 0,
    downpayment_fixed     REAL DEFAULT 0,
    downpayment_per_person INTEGER NOT NULL DEFAULT 0,
    timing                TEXT DEFAULT '',
    notes                 TEXT DEFAULT '',
    sort_order            INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_options_service ON service_options(service_id);

  -- Files and photos on an email. Only the metadata lives here; the bytes are
  -- fetched from Gmail the first time someone opens them, then cached on disk.
  CREATE TABLE IF NOT EXISTS message_attachments (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id       INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    gmail_message_id TEXT NOT NULL,
    part_id          TEXT NOT NULL,
    attachment_id    TEXT,
    filename         TEXT DEFAULT '',
    mime_type        TEXT DEFAULT '',
    size             INTEGER DEFAULT 0,
    content_id       TEXT DEFAULT '',
    is_inline        INTEGER NOT NULL DEFAULT 0,
    UNIQUE (gmail_message_id, part_id)
  );
  CREATE INDEX IF NOT EXISTS idx_attach_msg ON message_attachments(message_id);

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_leads_client   ON leads(client_id);
  CREATE INDEX IF NOT EXISTS idx_leads_status   ON leads(status);
  CREATE INDEX IF NOT EXISTS idx_leads_date     ON leads(service_date);
  CREATE INDEX IF NOT EXISTS idx_messages_lead  ON messages(lead_id);
  CREATE INDEX IF NOT EXISTS idx_services_lead  ON lead_services(lead_id);
`);

// Additive migrations so an existing database upgrades in place.
function ensureColumn(table, col, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
function hasColumn(table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
}

// The Services book moved from one-row-per-price-option to one-row-per-
// service with pricing tiers underneath. If an older flat 'services' table
// (with an 'option_name' column) is still around, preserve its rows under
// services_legacy instead of losing them, then rebuild the new tables.
if (hasColumn('services', 'option_name')) {
  db.exec(`ALTER TABLE services RENAME TO services_legacy`);
  db.exec(`
    CREATE TABLE services (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      category              TEXT NOT NULL DEFAULT '',
      wix_form_name         TEXT NOT NULL DEFAULT '',
      service_name          TEXT NOT NULL DEFAULT '',
      company               TEXT NOT NULL DEFAULT '',
      contact               TEXT DEFAULT '',
      booking_method        TEXT DEFAULT '',
      info_needed           TEXT DEFAULT '',
      commission            TEXT DEFAULT '',
      internal_notes        TEXT DEFAULT '',
      sort_order            INTEGER NOT NULL DEFAULT 0,
      created_at            TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_services_category ON services(category);
  `);
  // Bring the legacy rows across as one service per (category, company,
  // service_name) with their price/option_name as a single pricing option.
  const legacyGroups = new Map();
  for (const r of db.prepare(`SELECT * FROM services_legacy`).all()) {
    const key = `${r.category} ${r.company} ${r.service_name}`;
    if (!legacyGroups.has(key)) legacyGroups.set(key, []);
    legacyGroups.get(key).push(r);
  }
  const insSvc = db.prepare(`
    INSERT INTO services (category, service_name, company, commission)
    VALUES (?, ?, ?, ?)`);
  const insOpt = db.prepare(`
    INSERT INTO service_options (service_id, option_name, price, price_unit, child_price,
      min_people, max_people, downpayment_percent, timing, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const [, rows] of legacyGroups) {
    const first = rows[0];
    const svcInfo = insSvc.run(first.category, first.service_name, first.company, first.commission);
    for (const r of rows) {
      const unit = ['flat_total', 'per_person', 'per_vehicle', 'per_hour', 'per_day', 'quote'].includes(r.price_unit)
        ? r.price_unit : 'per_person';
      insOpt.run(svcInfo.lastInsertRowid, r.option_name, r.price, unit, r.child_price,
                  r.min_people, r.max_people,
                  r.downpayment_type === 'percent' ? r.downpayment_value : 0,
                  r.timing, [r.communication_method && `Contact via ${r.communication_method}`, r.notes].filter(Boolean).join(' — '));
    }
  }
  console.log(`Migrated ${legacyGroups.size} legacy service(s) to the new Services book format.`);
}
ensureColumn('leads', 'party_size', 'party_size INTEGER');
ensureColumn('leads', 'source', `source TEXT NOT NULL DEFAULT 'email'`);
ensureColumn('leads', 'merged_count', 'merged_count INTEGER NOT NULL DEFAULT 1');
ensureColumn('leads', 'gcal_event_id', 'gcal_event_id TEXT');
ensureColumn('leads', 'service_time', 'service_time TEXT');
ensureColumn('leads', 'draft_reply', `draft_reply TEXT DEFAULT ''`);
// One lead_services row = one booked service — a line of the old bookings
// spreadsheet: date, info ("3 day"), people ("VAN" / "6"), price
// (= downpayment + balance), commission, and who has paid what.
ensureColumn('lead_services', 'service_date', 'service_date TEXT');
ensureColumn('lead_services', 'info', `info TEXT DEFAULT ''`);
ensureColumn('lead_services', 'people', `people TEXT DEFAULT ''`);
ensureColumn('lead_services', 'commission', 'commission REAL NOT NULL DEFAULT 0');
ensureColumn('lead_services', 'commission_paid', 'commission_paid INTEGER NOT NULL DEFAULT 0');
ensureColumn('lead_services', 'provider', `provider TEXT DEFAULT ''`);
ensureColumn('lead_services', 'notes', `notes TEXT DEFAULT ''`);
ensureColumn('leads', 'reply_cc', `reply_cc TEXT DEFAULT ''`);
ensureColumn('leads', 'archived', 'archived INTEGER NOT NULL DEFAULT 0');
ensureColumn('messages', 'from_name', `from_name TEXT DEFAULT ''`);
ensureColumn('messages', 'to_emails', `to_emails TEXT DEFAULT ''`);
ensureColumn('messages', 'cc', `cc TEXT DEFAULT ''`);
// 0 until the message's attachment parts have been read from Gmail — lets
// messages imported before attachments were supported get picked up later.
ensureColumn('messages', 'attachments_scanned', 'attachments_scanned INTEGER NOT NULL DEFAULT 0');
ensureColumn('payments', 'payer_email', `payer_email TEXT DEFAULT ''`);
ensureColumn('payments', 'service', `service TEXT DEFAULT ''`);
ensureColumn('payments', 'amount_due', 'amount_due REAL DEFAULT 0');
ensureColumn('payments', 'notes', `notes TEXT DEFAULT ''`);

// Register each lead's primary Gmail thread in lead_threads (idempotent).
db.exec(`INSERT OR IGNORE INTO lead_threads (thread_id, lead_id)
         SELECT gmail_thread_id, id FROM leads WHERE gmail_thread_id IS NOT NULL`);

// One-time cleanup: strip Wix tracking-link footers from already-imported
// form messages ("Click on the link below…" / "This email was sent as a…").
{
  const dirty = db.prepare(`
    SELECT id, body FROM messages
    WHERE body LIKE '%Click on the link below%' OR body LIKE '%sent as a notification%'`).all();
  const upd = db.prepare(`UPDATE messages SET body = ? WHERE id = ?`);
  for (const m of dirty) {
    const clean = m.body
      .replace(/\s*Click on the link below[\s\S]*$/i, '')
      .replace(/\s*This email was sent as a notification[\s\S]*$/i, '')
      .trimEnd();
    if (clean !== m.body) upd.run(clean, m.id);
  }
}

export function markThreadProcessed(threadId) {
  if (!threadId) return;
  db.prepare(`INSERT OR IGNORE INTO processed_threads (thread_id) VALUES (?)`).run(threadId);
}

export function getSetting(key, fallback = null) {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key);
  return row ? JSON.parse(row.value) : fallback;
}

export function setSetting(key, value) {
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(key, JSON.stringify(value));
}

export function deleteSetting(key) {
  db.prepare(`DELETE FROM settings WHERE key = ?`).run(key);
}

export function touchLead(id) {
  db.prepare(`UPDATE leads SET updated_at = datetime('now') WHERE id = ?`).run(id);
}

/** Find a client by email or create one; returns the client row. */
export function upsertClient({ name, email, phone = '', notes = '' }) {
  const existing = db.prepare(`SELECT * FROM clients WHERE email = ? COLLATE NOCASE`).get(email);
  if (existing) {
    if ((name && name !== existing.name && existing.name === existing.email) ||
        (phone && !existing.phone)) {
      db.prepare(`UPDATE clients SET name = COALESCE(NULLIF(?, ''), name),
                                     phone = COALESCE(NULLIF(?, ''), phone) WHERE id = ?`)
        .run(name || '', phone || '', existing.id);
      return db.prepare(`SELECT * FROM clients WHERE id = ?`).get(existing.id);
    }
    return existing;
  }
  const info = db.prepare(`INSERT INTO clients (name, email, phone, notes) VALUES (?, ?, ?, ?)`)
    .run(name || email, email, phone, notes);
  return db.prepare(`SELECT * FROM clients WHERE id = ?`).get(info.lastInsertRowid);
}

/**
 * Lead ordering, per Aqualux's workflow:
 *   1. Active leads first — paid AND confirmed bookings sink to the bottom.
 *   2. Soonest service date on top; leads without a date after dated ones.
 *   3. Most recent activity as tiebreaker.
 */
export const LEAD_ORDER = `
  ORDER BY (l.paid = 1 AND l.booking_confirmed = 1) ASC,
           l.service_date IS NULL ASC,
           l.service_date ASC,
           l.updated_at DESC`;
