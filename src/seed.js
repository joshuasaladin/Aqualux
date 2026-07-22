import { db, logActivity, upsertClient } from './db.js';

/** Seed demo data so the CRM has something to show on first run (DEMO=1). */
export function seedDemo(force = false) {
  const count = db.prepare(`SELECT COUNT(*) n FROM clients`).get().n;
  if (count > 0 && !force) return;
  if (count > 0) return; // never overwrite real data

  const demo = [
    {
      client: { name: 'Isabella Romero', email: 'isabella.romero@example.com', phone: '+297 561 0192' },
      service: 'Private yacht charter', details: 'Sunset charter for 8 guests, anniversary dinner on board.',
      status: 'in_progress', payment_status: 'deposit_paid', quoted: 2400, paid: 1200,
      log: [
        ['email_in', 'Initial inquiry: sunset charter for 8, asking about catering options.'],
        ['email_out', 'Replied with three charter options and catering menu.'],
        ['email_in', 'Chose option B (catamaran + dinner). Asked for invoice.'],
        ['email_out', 'Sent invoice #1042 — 50% deposit to confirm.'],
      ]
    },
    {
      client: { name: 'Marcus Feld', email: 'm.feld@example.com', phone: '+1 305 555 0117' },
      service: 'Villa pre-arrival setup', details: 'Grocery stocking, flowers, airport transfer for July 30 arrival.',
      status: 'quoted', payment_status: 'unpaid', quoted: 650, paid: 0,
      log: [
        ['email_in', 'Arriving July 30 with family of 5, wants villa stocked + transfer.'],
        ['email_out', 'Sent quote: $650 all-in. Awaiting confirmation.'],
      ]
    },
    {
      client: { name: 'Sofia Anders', email: 'sofia.anders@example.com', phone: '' },
      service: 'Restaurant reservations week', details: 'Dinner reservations for 6 nights, prefers beachfront.',
      status: 'completed', payment_status: 'paid', quoted: 150, paid: 150,
      log: [
        ['email_in', 'Wants full week of dinner reservations, 2 people, beachfront.'],
        ['email_out', 'Confirmed all 6 reservations, itinerary attached.'],
        ['note', 'Client very happy — mention priority booking next season.'],
      ]
    },
    {
      client: { name: 'David Okafor', email: 'd.okafor@example.com', phone: '+44 20 7946 0912' },
      service: 'Private chef evening', details: 'Chef at villa for 10 guests, seafood focus, Aug 12.',
      status: 'new', payment_status: 'unpaid', quoted: 0, paid: 0,
      log: [
        ['email_in', 'Inquiry via website: private chef for 10 on Aug 12, seafood.'],
      ]
    },
  ];

  for (const item of demo) {
    const client = upsertClient(item.client);
    const info = db.prepare(`
      INSERT INTO requests (client_id, service, details, status, payment_status, quoted_amount, paid_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(client.id, item.service, item.details, item.status, item.payment_status, item.quoted, item.paid);
    logActivity(info.lastInsertRowid, 'created', `Request received via website from ${client.email}`);
    for (const [type, body] of item.log) logActivity(info.lastInsertRowid, type, body);
  }
  console.log('Seeded demo data (4 clients, 4 requests).');
}
