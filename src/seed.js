import { db, upsertClient } from './db.js';
import { recomputeStatus } from './gmail.js';

/** Seed demo data so the CRM has something to show on first run (DEMO=1). */
export function seedDemo() {
  if (db.prepare(`SELECT COUNT(*) n FROM clients`).get().n > 0) return;

  const day = (offset) => {
    const d = new Date(Date.now() + offset * 86400000);
    return d.toISOString().slice(0, 10);
  };
  const at = (daysAgo, hour) =>
    new Date(Date.now() - daysAgo * 86400000 + hour * 3600000 - 12 * 3600000).toISOString();

  const demo = [
    {
      client: { name: 'Isabella Romero', email: 'isabella.romero@example.com', phone: '+297 561 0192' },
      subject: 'Sunset yacht charter for 8', service: 'Private yacht charter',
      service_date: day(3), paid: 0, confirmed: 1, price: 2400,
      msgs: [
        ['in',  at(4, 9),  'Hi! We would love a sunset charter for 8 guests — it is our anniversary. Do you offer dinner on board?'],
        ['out', at(4, 11), 'Congratulations! Yes — we have a catamaran with a private chef option. Sending three packages now.'],
        ['in',  at(3, 15), 'Option B looks perfect. Please book it — how do we pay?'],
        ['out', at(3, 16), 'Wonderful choice! Invoice attached — a 50% deposit confirms the date.'],
        ['in',  at(1, 10), 'Deposit sent just now! Can we also add a photographer?'],
      ]
    },
    {
      client: { name: 'Marcus Feld', email: 'm.feld@example.com', phone: '+1 305 555 0117' },
      subject: 'Villa setup before arrival July 30', service: 'Villa pre-arrival setup',
      service_date: day(8), paid: 0, confirmed: 0, price: 650,
      msgs: [
        ['in',  at(2, 8),  'We arrive July 30, family of 5. Can you stock the villa with groceries and arrange an airport transfer?'],
        ['out', at(2, 13), 'Absolutely. All-in package is $650: full grocery stock to your list, fresh flowers, and a private transfer.'],
      ]
    },
    {
      client: { name: 'Sofia Anders', email: 'sofia.anders@example.com' },
      subject: 'Dinner reservations for our week in Aruba', service: 'Restaurant reservations week',
      service_date: day(1), paid: 1, confirmed: 1, price: 150,
      msgs: [
        ['in',  at(6, 10), 'Could you arrange beachfront dinner reservations for two, every night of our stay?'],
        ['out', at(6, 12), 'With pleasure — all six nights are booked, itinerary attached. Concierge fee is $150.'],
        ['in',  at(5, 9),  'Paid! Thank you, the lineup looks amazing.'],
        ['out', at(5, 10), 'Payment received — enjoy every course! We are one message away all week.'],
      ]
    },
    {
      client: { name: 'David Okafor', email: 'd.okafor@example.com', phone: '+44 20 7946 0912' },
      subject: 'Private chef for 10 on Aug 12', service: 'Private chef evening',
      service_date: day(21), paid: 0, confirmed: 0, price: 0,
      msgs: [
        ['in', at(0, 9), 'Hello — we would like a private chef at our villa for 10 guests on Aug 12, seafood focused. Is that possible?'],
      ]
    },
  ];

  for (const item of demo) {
    const client = upsertClient(item.client);
    const info = db.prepare(`
      INSERT INTO leads (client_id, subject, service, service_date, paid, booking_confirmed, price)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(client.id, item.subject, item.service, item.service_date, item.paid, item.confirmed, item.price);
    for (const [direction, sentAt, body] of item.msgs) {
      db.prepare(`
        INSERT INTO messages (lead_id, direction, from_email, subject, body, sent_at)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(info.lastInsertRowid, direction,
             direction === 'in' ? client.email : 'you@aqualux.example',
             item.subject, body, sentAt);
    }
    recomputeStatus(info.lastInsertRowid);
  }
  console.log('Seeded demo data (4 clients, 4 leads with conversations).');
}
