// Publishes the Services pages to the website: every service in the CRM is
// one item in the "Aqua Lux Services" CMS collection on aqualuxaruba.com, which the
// site's service page (a dynamic page) shows. Saving a service in the CRM
// updates its item a few seconds later.
//
// Wix REST API with an API key: header `Authorization: <key>` plus
// `wix-site-id: <site id>` (dev.wix.com → REST API Authentication).
import { db, getSetting } from './db.js';

export const COLLECTION_ID = 'AquaLuxServices';
const DEFAULT_SITE_ID = 'c2d8c937-e2c1-44d2-a0e7-ecb20cf357f2'; // aqualuxaruba.com
const API = process.env.WIX_API_BASE || 'https://www.wixapis.com/data/v2';

export function wixConfig() {
  return {
    apiKey: String(getSetting('wix_api_key', '') || process.env.WIX_API_KEY || '').trim(),
    siteId: String(getSetting('wix_site_id', '') || process.env.WIX_SITE_ID || DEFAULT_SITE_ID).trim()
  };
}
export const wixConnected = () => !!wixConfig().apiKey;

async function call(method, path, body) {
  const { apiKey, siteId } = wixConfig();
  if (!apiKey) throw new Error('Connect the website first in Settings → Website.');
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: apiKey, 'wix-site-id': siteId, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000)
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text.slice(0, 300) }; }
  if (!res.ok) {
    const msg = data.message || data.details?.applicationError?.description || `HTTP ${res.status}`;
    const err = new Error(res.status === 401 || res.status === 403
      ? 'Wix didn’t accept the API key. Check it in Settings → Website (it needs the CMS / Wix Data permissions and access to this site).'
      : /collection/i.test(msg) && /not.*found|does not exist/i.test(msg)
        ? 'The “Aqua Lux Services” collection doesn’t exist on the website yet.'
        : `Wix: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ------------------------------------------------------------ the item ----
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const lines = (t) => String(t || '').split('\n').map((l) => l.replace(/^[-•*]\s*/, '').trim()).filter(Boolean);
function listHtml(t) {
  const l = lines(t);
  if (!l.length) return '';
  return l.length === 1 ? `<p>${esc(l[0])}</p>` : `<ul>${l.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
}
const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const UNIT = { per_person: 'per person', per_vehicle: 'per vehicle', per_hour: 'per hour', per_day: 'per day', flat_total: '', quote: '' };

function priceText(o) {
  if (o.price_unit === 'quote' || !Number(o.price)) return 'Price on request';
  return `${money(o.price)} ${UNIT[o.price_unit] || ''}`.trim();
}
function pricesHtml(options) {
  return options.map((o) => {
    const bits = [priceText(o)];
    if (Number(o.child_price)) bits.push(`child ${money(o.child_price)}`);
    if (o.timing) bits.push(esc(o.timing));
    const note = o.notes && o.notes.trim().toLowerCase() !== priceText(o).toLowerCase() ? `<br>${esc(o.notes)}` : '';
    return `<p><strong>${esc(o.option_name || 'Price')}</strong> · ${bits.join(' · ')}${note}</p>`;
  }).join('');
}
// "From …" leaves out add-ons (extra guest, juices…): options named Extra/
// Add-on, and small fixed-price items next to much bigger ones.
function fromPrice(options) {
  let priced = options.filter((o) => o.price_unit !== 'quote' && Number(o.price) > 0);
  const maxFlat = Math.max(0, ...priced.filter((o) => o.price_unit === 'flat_total').map((o) => Number(o.price)));
  const main = priced.filter((o) => !/^(extra|add[\s-]?on)\b/i.test(String(o.option_name || '').trim()) &&
    !(o.price_unit === 'flat_total' && Number(o.price) < maxFlat * 0.25));
  if (main.length) priced = main;
  if (!priced.length) return options.length ? 'Price on request' : '';
  const lo = priced.reduce((a, o) => (Number(o.price) < Number(a.price) ? o : a));
  const same = priced.every((o) => Number(o.price) === Number(lo.price) && o.price_unit === lo.price_unit);
  return `${same ? '' : 'From '}${priceText(lo)}`;
}

const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

// The web address of a service's page — and the id of its item. Our existing
// page addresses are kept so links can be redirected one to one.
const SLUG_RENAMES = {
  'copy-of-private-jeep-tour': 'horseback-riding-tour',
  'atv-tours-rentals': 'atv-tour',
  'utv-tours-rentals': 'utv-tour'
};
export function slugFor(s) {
  if (s.wix_slug) return s.wix_slug;
  const fromPage = String(s.page_url || '').match(/aqualuxaruba\.com\/([a-z0-9-]+)\/?$/i)?.[1]?.toLowerCase();
  if (fromPage) return SLUG_RENAMES[fromPage] || fromPage;
  return slugify(s.service_name) || `service-${s.id}`;
}

export function toWixItem(s, order = 0) {
  const options = s.options || [];
  return {
    id: slugFor(s),
    data: {
      title: s.service_name || '',
      slug: slugFor(s),
      category: s.category || '',
      provider: s.company || '',
      summary: s.summary || '',
      included: listHtml(s.included),
      duration: s.duration || '',
      location: s.location || '',
      goodToKnow: listHtml(s.good_to_know),
      cancellationPolicy: s.cancellation_policy || '',
      prices: pricesHtml(options),
      priceFrom: fromPrice(options),
      image: s.image_url || '',
      order,
      crmId: s.id
    }
  };
}

// The collection's fields — used once, to create it (see createCollection).
export const COLLECTION_FIELDS = [
  ['title', 'Service name', 'TEXT'],
  ['slug', 'Page address', 'TEXT'],
  ['category', 'Category', 'TEXT'],
  ['provider', 'Provider', 'TEXT'],
  ['summary', 'About', 'TEXT'],
  ['included', 'What’s included', 'RICH_TEXT'],
  ['duration', 'Duration & times', 'TEXT'],
  ['location', 'Location', 'TEXT'],
  ['goodToKnow', 'Good to know', 'RICH_TEXT'],
  ['cancellationPolicy', 'Cancellation policy', 'TEXT'],
  ['prices', 'Prices', 'RICH_TEXT'],
  ['priceFrom', 'Price from', 'TEXT'],
  ['image', 'Photo', 'IMAGE'],
  ['order', 'Order', 'NUMBER'],
  ['crmId', 'CRM id', 'NUMBER']
];

// ------------------------------------------------------------- publish ----
function servicesForPublish(ids) {
  const all = db.prepare(`SELECT * FROM services ORDER BY category, service_name, id`).all();
  const opts = db.prepare(`SELECT * FROM service_options ORDER BY sort_order, id`).all();
  all.forEach((s, i) => {
    s.options = opts.filter((o) => o.service_id === s.id);
    s.order = i;
  });
  return ids ? all.filter((s) => ids.includes(s.id)) : all;
}

function markPublished(ids, error = '') {
  const st = db.prepare(`UPDATE services SET wix_published_at = CASE WHEN ? = '' THEN datetime('now') ELSE wix_published_at END,
    wix_error = ?, wix_slug = COALESCE(NULLIF(wix_slug, ''), ?) WHERE id = ?`);
  for (const s of ids) st.run(error, error, slugFor(s), s.id);
}

// Puts these services (or all) on the website; ones switched off are removed.
export async function publish(ids = null) {
  const list = servicesForPublish(ids);
  const show = list.filter((s) => s.on_website !== 0);
  const hide = list.filter((s) => s.on_website === 0);
  let saved = 0, removed = 0;
  try {
    for (let i = 0; i < show.length; i += 50) {
      const chunk = show.slice(i, i + 50);
      const r = await call('POST', '/bulk/items/save', {
        dataCollectionId: COLLECTION_ID,
        dataItems: chunk.map((s) => toWixItem(s, s.order))
      });
      const failed = (r.results || []).filter((x) => x.itemMetadata && x.itemMetadata.success === false);
      if (failed.length) throw new Error(`Wix: ${failed[0].itemMetadata.error?.description || 'an item could not be saved'}`);
      saved += chunk.length;
      markPublished(chunk);
    }
    for (const s of hide) {
      await removeItem(slugFor(s));
      removed++;
      markPublished([s]);
    }
  } catch (err) {
    markPublished(ids ? list : [], err.message);
    throw err;
  }
  return { saved, removed };
}

export async function removeItem(itemId) {
  try {
    await call('DELETE', `/items/${encodeURIComponent(itemId)}?dataCollectionId=${COLLECTION_ID}`);
  } catch (err) {
    if (err.status !== 404) throw err; // already gone is fine
  }
}

export async function testConnection() {
  const r = await call('POST', '/items/query', { dataCollectionId: COLLECTION_ID, query: { paging: { limit: 100 } } });
  return { items: (r.dataItems || []).length };
}

// Saving in the CRM publishes a few seconds after the last change.
const timers = new Map();
export function schedulePublish(id) {
  if (!wixConnected()) return;
  clearTimeout(timers.get(id));
  timers.set(id, setTimeout(() => {
    timers.delete(id);
    publish([Number(id)]).catch((err) => console.error(`[wix] publish service ${id}: ${err.message}`));
  }, 4000));
}
