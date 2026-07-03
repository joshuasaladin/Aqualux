# Pricing ambiguities found in the Concierge Info Sheet

Per your instruction, nothing below was guessed. Items marked **BLOCKED**
never auto-invoice — they land in `needs-review` until you resolve them
(edit the catalog entry in `src/Catalog.js`, then they price automatically).
Items marked **ASSUMED** do auto-invoice on a stated assumption you should
confirm.

## Decisions you already made (encoded in the pipeline)

- Listed price = guest price; commission is your cut inside it.
- Downpayment = your commission for that service.
- Floating Breakfast and Beach Picnic prices are flat per setup.
- Commission values < 1 in the sheet (0.15, 0.10, 0.30, 0.40) are
  percentages; values ≥ 1 are flat dollars.

## BLOCKED — needs your answer before these can auto-invoice

1. **Hot Stone massage** — the sheet lists two different prices both marked
   60 minutes: $135 and $165. Is the $165 actually the 90-minute price
   (like the other massage rows)?
2. **Private Jeep Tour** — $100 p/p with commission "20": is that $20 per
   person or $20 per booking? Downpayment can't be computed until decided.
3. **Open-Air Safari** — no commission listed at all → no downpayment rule.
   Also: for a 5+ hour booking, does the >4-hour rate ($60/$70 p/h) apply to
   all hours or only hours beyond 4?
4. **Airport Transportation** — commission is "$ on top" with no amount, and
   the 6–10-person prices say "has no commission added". What does the guest
   actually pay for 1–5 and 6–10 people, and what's your cut?
5. **Car Rental** — prices look per **day** (confirm) and there's a $300–$500
   deposit column. Should the deposit appear on the guest invoice, and if
   so where? Commission 15% of (price × days)?
6. **Beach Picnic "Dinner Package Kids" ($30, commission $5)** — per child,
   or a kids' add-on per setup?
7. **Private Chef add-ons** — Mimosas $15 and Kids Menu $25: per person or
   flat? The kids menu note says "no on top on this" (no commission?) —
   commission treatment of add-ons is unclear.
8. **Balloon Decoration & Flower Arrangements** — no prices in the sheet at
   all; guests get the warm "Joshua will follow up personally" reply.

## ASSUMED — auto-invoices today, confirm the assumption

9. **Water Sports (Parasailing $70 / Tubing $25 / Jet Ski $85)** — assumed
   **per person** (jet ski per rider), with the commission column ($20/$5/$15)
   also per person. If jet skis are priced per ski for two riders, tell me
   and I'll switch it to ask for the number of skis.
10. **Massage prices** — assumed **per person per session** (the sheet's
    booking info mentions "people", implying multiples).
11. **UTV/ATV tours & rentals** — assumed priced **per vehicle**, one vehicle
    per booking; if the party size exceeds the chosen vehicle's seats, the
    guest is asked rather than invoiced. Multi-vehicle bookings currently
    require your manual handling.
12. **Private Sailing** — "$2000 for 6 people, additional $50 p/p up to 15"
    is computed as base + $50 × (party − 6). A party of, say, 4 still pays
    the $2000 base (minimum), which matches the wording but confirm.
13. **Catamaran / Pirates tours** — adult and child rates are firm. Per
    Josh's rule, a total-only headcount is priced with everyone at the
    adult rate; the confirmation email says "N adults" so families with
    kids can reply to correct it (they'd see a small refund, never a
    surprise charge).

## Structural notes

- **UTV Rental sheet cells** cram two prices into one cell ("$230 $270" over
  "4 hours 8 hours"); I encoded them as separate 4-hour/8-hour variants —
  double-check: 2-seater $230/4h, $270/8h; 3/4/5-seater $280/4h, $340/8h;
  ATV 1-seater $130/$160, 2-seater $150/$180.
- **Flo Chef Cookout** menu options 1/2/3 ($75/$70/$70) require the menu
  choice in the form; otherwise the guest is asked which menu.
- **Dining Memories 3-course rule** ("all must agree on 1 appetizer/main/
  dessert…") is a service condition, not a price, so it isn't on the invoice.
  Say the word if you want it in the confirmation email for that menu.
