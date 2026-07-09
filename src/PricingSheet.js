/**
 * LIVE PRICING SHEET — edit prices in Google Sheets, no code changes.
 *
 * Run createPricingSheet() ONCE: it builds an "Aqua Lux Live Pricing"
 * Google Sheet in your Drive from the current catalog, one row per priced
 * option (tiered options get one row per group-size tier). From then on,
 * the pipeline re-reads the sheet at the start of EVERY run, so a price or
 * downpayment you change there is used on the very next draft.
 *
 * Editing rules (also shown on the sheet):
 *   • Edit the number columns only: Price $, Child Price $, Rate after
 *     4 hrs $, Min/Max, Downpayment % / $ / per person.
 *   • Never edit the Key column — it is how rows map to services. A row
 *     with a broken Key is simply ignored (built-in price used instead).
 *   • Adding NEW services/options still needs a code update — ask Claude.
 *
 * Not on the sheet (still code-managed): car rental price texts, and the
 * quote/follow-up services with no price (balloons, flowers, airport).
 */

const PRICING_HEADERS = [
  'Key (do not edit)', 'Category', 'Service', 'Option',
  'Price $', 'Child Price $', 'Rate after 4 hrs $',
  'Min', 'Max',
  'Downpayment %', 'Downpayment $', '$ per person?',
  'How it’s charged'
];

/** Build the live pricing sheet from the catalog (run once). */
function createPricingSheet() {
  if (getProp_('PRICING_SHEET_ID')) {
    Logger.log('Live pricing sheet already exists: https://docs.google.com/spreadsheets/d/' + getProp_('PRICING_SHEET_ID'));
    Logger.log('Delete the PRICING_SHEET_ID script property first if you want to regenerate it.');
    return;
  }
  const ss = SpreadsheetApp.create('Aqua Lux Live Pricing');
  const s = ss.getSheets()[0].setName('Prices');

  const rows = [];
  for (const svc of CATALOG) {
    for (const v of svc.variants) {
      const c = commissionCells_(v.commission || svc.commission);
      const p = v.pricing;
      const base = [svc.id + '|' + v.name, svc.category, svc.name, v.name];
      if (p.type === 'flat' || p.type === 'perVehicle') {
        rows.push(base.concat([p.price, null, null, null, null, c.pct, c.usd, c.pp,
          p.type === 'flat' ? 'flat total' : 'per vehicle' + (v.seats ? ' (seats ' + v.seats + ')' : '')]));
      } else if (p.type === 'perPerson') {
        rows.push(base.concat([p.price, null, null, p.minPeople || null, null, c.pct, c.usd, c.pp, 'per person']));
      } else if (p.type === 'adultChild') {
        rows.push(base.concat([p.adult, p.child, null, null, null, c.pct, c.usd, c.pp, 'per adult / per child']));
      } else if (p.type === 'perHour') {
        rows.push(base.concat([p.rate, null, p.over4Rate || null, p.minHours, p.maxHours, c.pct, c.usd, c.pp, 'per hour (Min/Max = hours)']));
      } else if (p.type === 'tieredPerPerson') {
        p.tiers.forEach(t => rows.push(base.concat([
          t.price, null, null, t.min, t.max >= 999 ? null : t.max, c.pct, c.usd, c.pp, 'per person, for this group size'])));
      } else if (p.type === 'groupFormula') {
        rows.push(base.concat([p.base, null, null, 1, p.included, c.pct, c.usd, c.pp, 'BASE price (up to Max people)']));
        rows.push(base.concat([p.extraPerPerson, null, null, p.included + 1, p.maxPeople, c.pct, c.usd, c.pp, 'EACH ADDITIONAL person (up to Max)']));
      }
      // quote / inquire / manualQuote / review variants stay code-managed.
    }
  }

  s.getRange(1, 1, 1, PRICING_HEADERS.length).setValues([PRICING_HEADERS])
    .setFontWeight('bold').setBackground('#0b3d5c').setFontColor('#ffffff').setWrap(true);
  s.setRowHeight(1, 40);
  s.getRange(2, 1, rows.length, PRICING_HEADERS.length).setValues(rows);
  s.setFrozenRows(1);
  s.setColumnWidth(1, 220); s.setColumnWidth(2, 110); s.setColumnWidth(3, 200); s.setColumnWidth(4, 240);
  for (let col = 5; col <= 12; col++) s.setColumnWidth(col, 90);
  s.setColumnWidth(13, 200);
  s.getRange(2, 1, rows.length, 1).setFontColor('#999999').setFontSize(8);
  s.getRange(1, 1, rows.length + 1, PRICING_HEADERS.length).createFilter();

  setProp_('PRICING_SHEET_ID', ss.getId());
  Logger.log('Live pricing sheet created ✓  https://docs.google.com/spreadsheets/d/' + ss.getId());
  Logger.log('Edit prices there any time — the pipeline reads it fresh on every run.');
}

function commissionCells_(commission) {
  if (!commission) return { pct: null, usd: null, pp: null };
  switch (commission.type) {
    case 'pct': return { pct: commission.value * 100, usd: null, pp: null };
    case 'flat': return { pct: null, usd: commission.value, pp: 'no' };
    case 'flatPerPerson': return { pct: null, usd: commission.value, pp: 'yes' };
    case 'pctPlusPerPerson': return { pct: commission.pct * 100, usd: commission.perPerson, pp: 'yes' };
    default: return { pct: null, usd: null, pp: null };
  }
}

/**
 * Overlay the sheet's numbers onto the in-memory catalog. Called at the
 * start of every pipeline run; failures fall back to built-in prices (and
 * alert the owner at most once per 6 hours).
 */
function applyPricingOverrides_() {
  const id = getProp_('PRICING_SHEET_ID');
  if (!id) return 0;

  const values = SpreadsheetApp.openById(id).getSheets()[0].getDataRange().getValues();
  const byKey = {};
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    const key = String(r[0] || '').trim();
    if (!key) continue;
    (byKey[key] = byKey[key] || []).push({
      price: num_(r[4]), child: num_(r[5]), after4: num_(r[6]),
      min: num_(r[7]), max: num_(r[8]),
      dpct: num_(r[9]), dusd: num_(r[10]),
      dpp: String(r[11] || '').trim().toLowerCase()
    });
  }

  let applied = 0;
  for (const svc of CATALOG) {
    for (const v of svc.variants) {
      const rows = byKey[svc.id + '|' + v.name];
      if (!rows) continue;
      const rebuilt = rebuildFromRows_(v.pricing, rows);
      if (rebuilt.pricing) { v.pricing = rebuilt.pricing; applied++; }
      if (rebuilt.commission) v.commission = rebuilt.commission;
    }
  }
  return applied;
}

/**
 * Pure: rebuild a variant's pricing/commission from its sheet rows.
 * Blank cells keep the built-in value; the tier list is replaced whole.
 */
function rebuildFromRows_(existing, rows) {
  const out = {};
  const p = Object.assign({}, existing);
  const r0 = rows[0];

  switch (existing.type) {
    case 'flat':
    case 'perVehicle':
      if (r0.price != null) p.price = r0.price;
      break;
    case 'perPerson':
      if (r0.price != null) p.price = r0.price;
      if (r0.min != null) p.minPeople = r0.min;
      break;
    case 'adultChild':
      if (r0.price != null) p.adult = r0.price;
      if (r0.child != null) p.child = r0.child;
      break;
    case 'perHour':
      if (r0.price != null) p.rate = r0.price;
      if (r0.after4 != null) p.over4Rate = r0.after4;
      if (r0.min != null) p.minHours = r0.min;
      if (r0.max != null) p.maxHours = r0.max;
      break;
    case 'tieredPerPerson': {
      const tiers = rows.filter(r => r.price != null && r.min != null)
        .map(r => ({ min: r.min, max: r.max != null ? r.max : 999, price: r.price }))
        .sort((a, b) => a.min - b.min);
      if (tiers.length) p.tiers = tiers;
      break;
    }
    case 'groupFormula': {
      // Row 1 = base (Max = included people), row 2 = each additional person.
      if (rows[0] && rows[0].price != null) p.base = rows[0].price;
      if (rows[0] && rows[0].max != null) p.included = rows[0].max;
      if (rows[1] && rows[1].price != null) p.extraPerPerson = rows[1].price;
      if (rows[1] && rows[1].max != null) p.maxPeople = rows[1].max;
      break;
    }
    default:
      return {}; // quote/inquire/manualQuote/review — not sheet-managed
  }
  out.pricing = p;

  if (r0.dpct != null && r0.dusd != null) {
    out.commission = { type: 'pctPlusPerPerson', pct: r0.dpct / 100, perPerson: r0.dusd };
  } else if (r0.dpct != null) {
    out.commission = { type: 'pct', value: r0.dpct / 100 };
  } else if (r0.dusd != null) {
    out.commission = { type: r0.dpp === 'yes' ? 'flatPerPerson' : 'flat', value: r0.dusd };
  }
  return out;
}

function num_(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

/** Alert the owner about a broken pricing sheet, at most every 6 hours. */
function pricingSheetProblem_(err) {
  Logger.log('Pricing sheet unreadable — using built-in prices. %s', err.message);
  const last = Number(getProp_('PRICING_ALERT_AT') || 0);
  if (Date.now() - last < 6 * 3600 * 1000) return;
  setProp_('PRICING_ALERT_AT', String(Date.now()));
  notifyOwner_('Live pricing sheet could not be read',
    'The pipeline could not read the Aqua Lux Live Pricing sheet, so it is using the built-in prices for now.\n\nError: ' + err.message);
}
