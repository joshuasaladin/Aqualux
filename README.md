# Aqualux — Concierge CRM

A Gmail-connected CRM for **Aqualux concierge services**: every email inquiry
becomes a lead automatically, you answer clients right from the CRM, and each
lead tracks its service date, payment, and booking confirmation.

## How it works

- **Emails become leads.** Connect your Gmail once (Settings tab). New
  incoming emails are pulled in automatically — sender name + email create
  the client, the subject line pre-fills the service (editable).
- **Status follows the conversation:**
  - 🟢 **New Lead** — a client emailed and you haven't replied yet
  - 🔴 **Responded** — the last message is yours
  - 🟢 **New Mail** — the client replied again, ball's in your court
  The status flips back and forth automatically as the conversation goes on —
  including when you reply from the Gmail app directly.
- **Reply from the CRM.** Each lead shows the full conversation as a chat
  thread with a reply box. Replies send through your Gmail (same thread, and
  they appear in your Sent folder).
- **Booking fields on every lead**: service, **service date**, **Paid**
  toggle, **Booking confirmed** toggle, price, and notes.
- **Smart ordering**: leads are sorted by service date — soonest on top —
  except leads that are already **paid AND confirmed**, which sink to the
  bottom (shown dimmed). Leads without a date come after dated ones.
- **Confirmed tab** — only bookings marked confirmed.
- **Calendar tab** — confirmed bookings plotted on their service dates
  (amber = confirmed but not paid yet).
- **Clients tab** — everyone who ever wrote in, with total paid and notes.
- **Website intake** — `POST /api/intake` accepts your website's
  "request a service" form; submissions appear as New Leads.

## Quick start

```bash
npm install
npm run dev     # demo data at http://localhost:3000
npm start       # production: empty database
```

Node.js **22.5+** required (uses built-in `node:sqlite`). Data lives in
`data/aqualux.db` (override the folder with `DATA_DIR`).

Protect it with a password:

```bash
ADMIN_PASSWORD=your-secret npm start
```

The `/api/intake` endpoint and the Google OAuth callback stay open.

## Connecting Gmail (one-time, ~5 minutes)

The CRM uses Google's official Gmail API — no password sharing, and you can
revoke access anytime from your Google account.

1. Open [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
   and create a (free) project.
2. Enable the [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com).
3. Configure the **OAuth consent screen** → External → add your own Gmail
   address as a **test user**.
4. **Create Credentials → OAuth client ID → Web application**, and add the
   redirect URI shown in the CRM's Settings tab
   (`https://your-crm-host/api/gmail/callback`).
5. Paste the Client ID + Secret into the CRM's Settings tab → **Connect
   Gmail** → approve the Google screen. Done.

From then on the CRM checks for new mail every ~3 minutes (there's also a
manual "Sync Gmail" button). Only emails received **after** connecting become
leads; "Import last 7 days" in Settings reaches further back. Obvious
no-reply/newsletter senders are skipped.

Credentials can also come from env vars: `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`. Set `BASE_URL` (e.g. `https://aqualux-crm.onrender.com`)
when deploying behind a proxy.

## Wiring your website's contact form

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

Your first reply from the CRM to a form lead starts a real Gmail thread.

## API overview

| Method & path | Purpose |
| --- | --- |
| `POST /api/intake` | Public: create a lead from the website form |
| `GET /api/leads` | Sorted list (`?q=` search, `?tab=confirmed`) |
| `GET /api/leads/summary` | Counters for the header stats |
| `GET /api/leads/:id` | Lead + client + full email conversation |
| `PATCH /api/leads/:id` | Update service, date, paid, confirmed, price, notes |
| `POST /api/leads/:id/reply` | Send an email reply via Gmail |
| `GET /api/calendar?from=&to=` | Confirmed bookings in a date range |
| `GET/PATCH /api/clients…` | Client list, details, notes |
| `GET /api/gmail/status` | Connection state + redirect URI |
| `POST /api/gmail/sync` | Sync now |
