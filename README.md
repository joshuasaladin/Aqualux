# Aqualux — Concierge CRM

A simple CRM for **Aqualux concierge services**: track every client who
requests a service, follow how each inquiry (email) is progressing, and see
at a glance whether they've paid.

## What it does

- **Requests pipeline** — every inquiry moves through
  `New → Contacted → Quoted → In progress → Completed` (or `Cancelled`),
  so you always know where each email stands.
- **Payment tracking** — each request has a payment status
  (`Unpaid / Deposit paid / Paid in full / Refunded`), a quoted amount, and
  the amount actually received. The dashboard totals what you've collected
  and what's still outstanding.
- **Timeline per request** — log emails sent/received, calls, and notes.
  Status and payment changes are logged automatically, so each request reads
  like a story from first email to final payment.
- **Clients** — every requester becomes a client (deduplicated by email),
  with their full request history, total paid, and private notes
  (preferences, VIP status, …).
- **Dashboard** — open requests, new inquiries needing a reply, requests
  awaiting payment, money collected and outstanding.
- **Website intake** — `POST /api/intake` is an open endpoint your concierge
  website's "request a service" form can submit to; the inquiry appears in
  the CRM instantly as a **New** request.

## Quick start

```bash
npm install
npm run dev     # starts with demo data at http://localhost:3000
npm start       # production: empty database, real data only
```

Node.js **22.5+** required (uses the built-in `node:sqlite` — no native deps).
Data is stored in `data/aqualux.db` (override the folder with `DATA_DIR`).

### Protecting it with a password

```bash
ADMIN_PASSWORD=your-secret npm start
```

When `ADMIN_PASSWORD` is set, the CRM asks for it on first load. The
`/api/intake` endpoint stays open so the website form keeps working.

## Wiring your website's contact form

Point the form at the intake endpoint:

```js
await fetch('https://your-crm-host/api/intake', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Jane Smith',            // required
    email: 'jane@example.com',     // required
    service: 'Yacht charter',      // required
    phone: '+297 …',               // optional
    details: 'Sunset trip for 8'   // optional
  })
});
```

## API overview

| Method & path | Purpose |
| --- | --- |
| `POST /api/intake` | Public: create a request from the website form |
| `GET /api/dashboard` | Stats + recently updated requests |
| `GET /api/requests` | List/filter (`?status=`, `?payment_status=`, `?q=`) |
| `POST /api/requests` | Create a request (creates the client if new) |
| `GET /api/requests/:id` | Request + client + full timeline |
| `PATCH /api/requests/:id` | Update status, payment, amounts, details |
| `POST /api/requests/:id/activities` | Log an email / call / note |
| `DELETE /api/requests/:id` | Delete a request |
| `GET /api/clients` | List clients with request counts & totals |
| `GET /api/clients/:id` | Client + their requests |
| `PATCH /api/clients/:id` | Update client info / notes |
