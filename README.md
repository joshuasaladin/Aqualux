# Aqua Lux Aruba — Inquiry & Invoice Pipeline

Automated pipeline that reads Wix form-notification emails in
`aqualuxaruba@gmail.com`, prices the request against the service catalog,
generates a branded invoice PDF from your Google Sheet template, and prepares
a warm guest reply with the invoice attached — as **Gmail drafts** first
(draft mode), auto-send later once you approve the output quality.

Runs entirely inside your own Google account on **Google Apps Script** —
no server, no hosting bill, no external API keys.

## What each submission becomes

| Situation | What happens | Log status |
|---|---|---|
| Known service, fully priceable | Invoice PDF + confirmation email (draft in draft mode) | `draft-created` / `sent` |
| Missing date, party size, hours, or ambiguous option | Friendly email asking exactly what's missing; original starred + labeled | `clarification-draft` / `clarification-sent` |
| Not in catalog, or catalog price ambiguous (see `docs/PRICING_REVIEW.md`) | Warm "we'll follow up personally" reply where appropriate; **never** an invented price; you get an alert email | `needs-review` |
| Duplicate (same guest + form + date within 30 days) | No second invoice; flagged for you | `needs-review` |
| Spam / non-Wix email | Ignored silently | — |

Every processed submission is logged to the **Aqua Lux Pipeline Log** sheet:
timestamp, guest, email, service, date requested, invoice #, downpayment,
total, status, notes, message ID.

**Invoice numbering:** `AQL-2026-0001`, `AQL-2026-0002`, … The counter lives
in Script Properties and increments under a script lock, so overlapping
trigger runs can't mint the same number twice; it resets per year.

## Setup (one time, ~10 minutes)

What I need from you is just clicks inside your own Google account — no
OAuth client IDs or cloud consoles:

1. While signed in as `aqualuxaruba@gmail.com`, open https://script.google.com
   → **New project**. Name it "AquaLux Pipeline".
2. Copy every file from `src/` into the project (File → each `.js` becomes a
   script file; also enable *Project Settings → Show "appsscript.json"* and
   paste that in to set scopes and the Aruba timezone).
   (Alternative for the terminal-inclined: `npm i -g @google/clasp`,
   `clasp login`, copy `.clasp.json.example` to `.clasp.json` with your
   script ID, `clasp push`.)
3. In `Config.js`, set `INVOICE_TEMPLATE_ID` to your "Aqua Lux Concierge
   Invoice" Google Sheet ID (the long string in its URL) — or leave it blank
   and `setup()` will generate a starter template matching the built-in cell
   map. If you use your own sheet, make the cell positions in
   `CONFIG.INVOICE_CELLS` match your layout.
4. Run `setup()` from the editor toolbar. Google will show the consent
   screen once — it asks for Gmail, Sheets, and Drive access **for this
   script in your account only**. Approve it.
5. Run `dryRunSample()` → check the execution log: it must end with
   `DRY RUN PASSED ✓ (total $155, downpayment $15, remaining $140)`.
6. Run `testSampleSubmission()` → a **[TEST] draft addressed to you** appears
   in your Drafts with the invoice PDF attached. Open both and inspect.
7. Happy? Run `installTrigger()`. The pipeline now checks for new Wix
   notifications every 5 minutes, forever (Apps Script keeps time triggers
   running unattended and emails you automatically if a run errors).

### Phase 1 → Phase 2

`CONFIG.DRAFT_MODE = true` (the default) means **every guest email is only a
draft** — nothing sends without you pressing Send. After you've approved a
handful of real drafts, flip `DRAFT_MODE` to `false` and save; from then on
invoices/clarifications send automatically. Owner alert emails and the log
are active in both modes.

Note: in draft mode, Gmail drafts sit in your Drafts folder — the log's
`draft-created` rows are your queue to review.

## Test walkthrough (the attached Michele sample)

`dryRunSample()` / `testSampleSubmission()` replay the exact sample email:

1. Sender + body signature identify it as a Wix notification for form
   **Floating Breakfast**.
2. Parsed fields: Michele Defilippis, flipper01@yahoo.com, 2026-07-09, 08:30,
   choice "Big Breakfast", staying "Other", note "We are at casa Hermanas
   Diamanté" (note the two-line value — the parser joins it).
3. Catalog match: Moments → Floating Breakfast → **Big Breakfast**, flat
   **$155**, commission $15 → **downpayment $15, remaining $140**.
4. Location: staying is "Other", so the short free-text note is used →
   "casa Hermanas Diamanté".
5. Invoice `AQL-2026-…` is created from the template, exported to PDF.
6. A draft reply to Michele (addressed to *you* in the test) confirms the
   details, describes the experience, states $155 / $15 down / payment
   options / cancellation policy, and attaches the PDF.

## Where a customer-facing mistake could still happen (spot-check list)

Read `docs/PRICING_REVIEW.md` for the full list. The short version of what
to spot-check while in draft mode:

1. **Prices assumed per person** for Water Sports and Massage — confirm.
2. **Flat-setup party sizes**: floating breakfast/picnic invoices don't scale
   with party size (per your rule); a form arriving with 6 people still says
   $155 — check those drafts.
3. **Variant matching** relies on the form's choice-field wording matching
   catalog keywords; a renamed Wix option (e.g. "Grand Breakfast") becomes a
   clarification email, never a guessed price — but check the first draft
   after you edit any form.
4. **Location line** comes from "Where are you staying?" (or the guest's short
   free-text note when they pick "Other") — it's guest-typed, so typos pass
   through.
5. **Date parsing** expects `YYYY-MM-DD` (Wix's format) and common variants;
   anything unparseable triggers a clarification, not a guess.
6. **Wix template changes**: if Wix reworks the notification email format,
   parsing fails safe → needs-review alert to you, no guest email.
7. Anything in `needs-review` **never** reached the guest with a price —
   those are yours to finish by hand (the original email is starred and
   labeled `AquaLux/Needs-Review`).

## Internal-data firewall

Guest emails and invoices are built only from the guest-safe catalog
(service names, descriptions, your prices). Vendor names, contacts, booking
methods, and commission language exist nowhere in guest-facing templates,
and a leak guard (`src/Guard.js`) scans every outgoing subject, body, and
invoice cell for internal terms as a final tripwire — a hit aborts that
email and routes the inquiry to needs-review.

## Repo layout

```
src/
  appsscript.json  manifest: scopes + America/Aruba timezone
  Config.js        all knobs incl. DRAFT_MODE, template ID, cell map
  Catalog.js       guest-safe service catalog + variant matcher
  Parser.js        Wix notification email parser (defensive)
  Pricing.js       pricing engine + downpayment (= commission) rules
  Invoice.js       template copy → fill → PDF export; invoice numbering
  Email.js         guest email composition (concierge voice) + delivery
  Guard.js         outbound internal-data leak guard
  Log.js           pipeline log sheet + duplicate/idempotency checks
  Main.js          inbox processing + routing + trigger install
  Setup.js         one-time provisioning (labels, log, folder, template)
  Test.js          dryRunSample() / testSampleSubmission()
docs/
  PRICING_REVIEW.md  every pricing ambiguity found in the info sheet
```
