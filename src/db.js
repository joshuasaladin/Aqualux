import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
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
ensureColumn('leads', 'party_size', 'party_size INTEGER');
ensureColumn('leads', 'source', `source TEXT NOT NULL DEFAULT 'email'`);

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
