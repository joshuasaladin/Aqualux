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

  CREATE TABLE IF NOT EXISTS requests (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    service        TEXT NOT NULL,
    details        TEXT DEFAULT '',
    status         TEXT NOT NULL DEFAULT 'new'
                   CHECK (status IN ('new','contacted','quoted','in_progress','completed','cancelled')),
    payment_status TEXT NOT NULL DEFAULT 'unpaid'
                   CHECK (payment_status IN ('unpaid','deposit_paid','paid','refunded')),
    quoted_amount  REAL DEFAULT 0,
    paid_amount    REAL DEFAULT 0,
    currency       TEXT NOT NULL DEFAULT 'USD',
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS activities (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    type       TEXT NOT NULL DEFAULT 'note'
               CHECK (type IN ('note','email_in','email_out','call','status','payment','created')),
    body       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_requests_client  ON requests(client_id);
  CREATE INDEX IF NOT EXISTS idx_requests_status  ON requests(status);
  CREATE INDEX IF NOT EXISTS idx_requests_payment ON requests(payment_status);
  CREATE INDEX IF NOT EXISTS idx_activities_req   ON activities(request_id);
`);

export function touchRequest(id) {
  db.prepare(`UPDATE requests SET updated_at = datetime('now') WHERE id = ?`).run(id);
}

export function logActivity(requestId, type, body) {
  db.prepare(`INSERT INTO activities (request_id, type, body) VALUES (?, ?, ?)`)
    .run(requestId, type, body);
}

/** Find a client by email or create one; returns the client row. */
export function upsertClient({ name, email, phone = '', notes = '' }) {
  const existing = db.prepare(`SELECT * FROM clients WHERE email = ? COLLATE NOCASE`).get(email);
  if (existing) {
    if ((name && name !== existing.name) || (phone && phone !== existing.phone)) {
      db.prepare(`UPDATE clients SET name = COALESCE(NULLIF(?, ''), name),
                                     phone = COALESCE(NULLIF(?, ''), phone) WHERE id = ?`)
        .run(name || '', phone || '', existing.id);
      return db.prepare(`SELECT * FROM clients WHERE id = ?`).get(existing.id);
    }
    return existing;
  }
  const info = db.prepare(`INSERT INTO clients (name, email, phone, notes) VALUES (?, ?, ?, ?)`)
    .run(name, email, phone, notes);
  return db.prepare(`SELECT * FROM clients WHERE id = ?`).get(info.lastInsertRowid);
}
