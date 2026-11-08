// AI helper (Claude). Two jobs:
//   1. draftReply   — writes a reply to a guest, using the Services info
//                     pages, the tone of our past replies, and everything in
//                     this guest's conversations so far.
//   2. checkWebsite — reads a provider's website and proposes updates for a
//                     service's info page (prices, what's included, times…).
//                     Nothing is changed until someone accepts a proposal.
//
// The API key comes from Settings → AI assistant, or the ANTHROPIC_API_KEY
// environment variable.
import crypto from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { db, getSetting } from './db.js';

const MODEL = 'claude-opus-5-5';
// If the model declines a request, the API re-runs it on Anthropic's
// recommended fallback model instead of returning a refusal.
const BETAS = ['server-side-fallback-2026-07-01'];

export class AiError extends Error {
  constructor(message, status = 500) { super(message); this.status = status; }
}

export function apiKey() {
  return String(getSetting('anthropic_api_key', '') || process.env.ANTHROPIC_API_KEY || '').trim();
}

export function aiStatus() {
  const saved = String(getSetting('anthropic_api_key', '') || '').trim();
  const key = apiKey();
  return {
    configured: !!key,
    source: saved ? 'settings' : key ? 'environment' : null,
    hint: key ? `…${key.slice(-4)}` : ''
  };
}

function client() {
  const key = apiKey();
  if (!key) throw new AiError('Add your Claude API key in Settings → AI assistant first.', 400);
  return new Anthropic({ apiKey: key, maxRetries: 2, timeout: 10 * 60 * 1000 });
}

// Plain-English version of an API error, for the screen.
export function friendlyError(err) {
  if (err instanceof AiError) return err;
  if (err instanceof Anthropic.AuthenticationError) {
    return new AiError('The Claude API key was not accepted. Check it in Settings → AI assistant.', 400);
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return new AiError('This Claude API key is not allowed to do that. Check the key’s workspace and permissions.', 400);
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AiError('Claude is busy right now (rate limit). Try again in a minute.', 429);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new AiError('Could not reach Claude. Check the internet connection and try again.', 502);
  }
  if (err instanceof Anthropic.APIError) {
    const msg = err.error?.error?.message || err.message || '';
    if (/credit balance|billing|spend limit/i.test(msg)) {
      return new AiError('The Claude account is out of credit. Add credit at console.anthropic.com → Billing.', 402);
    }
    if (err.status >= 500) return new AiError('Claude had a temporary problem. Try again in a moment.', 502);
    return new AiError(`Claude: ${msg}`, 400);
  }
  return new AiError(err?.message || 'Something went wrong talking to Claude.', 500);
}

// One request (streamed, so long answers never time out). A turn that pauses
// while using a server tool (website reading) is sent back to continue.
async function run(params, label) {
  const c = client();
  let messages = params.messages;
  let resp;
  try {
    for (let i = 0; i < 6; i++) {
      resp = await c.beta.messages.stream({
        ...params, messages, model: MODEL, betas: BETAS, fallbacks: 'default'
      }).finalMessage();
      if (resp.stop_reason !== 'pause_turn') break;
      messages = [...messages, { role: 'assistant', content: resp.content }];
    }
  } catch (err) {
    console.error(`[ai] ${label} failed:`, err?.status || '', err?.message || err);
    throw friendlyError(err);
  }
  const u = resp.usage || {};
  console.log(`[ai] ${label}: in ${u.input_tokens} (cache read ${u.cache_read_input_tokens || 0}, written ${u.cache_creation_input_tokens || 0}), out ${u.output_tokens}, stop ${resp.stop_reason}${resp.model !== MODEL ? `, served by ${resp.model}` : ''}`);
  if (resp.stop_reason === 'refusal') throw new AiError('Claude declined to write this one. Try rewording the instructions.', 422);
  return resp;
}

// Text of the final answer: the text blocks after the last tool activity.
function finalText(resp) {
  const blocks = resp.content || [];
  let start = 0;
  blocks.forEach((b, i) => { if (b.type !== 'text' && b.type !== 'thinking') start = i + 1; });
  return blocks.slice(start).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
}

export async function testConnection() {
  const resp = await run({
    max_tokens: 2000,
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: 'Reply with the single word: OK' }]
  }, 'test');
  return { ok: true, reply: finalText(resp).slice(0, 50), model: resp.model };
}

// ------------------------------------------------------------ knowledge ----
const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const UNIT = {
  flat_total: 'total', per_person: 'per person', per_vehicle: 'per vehicle',
  per_hour: 'per hour', per_day: 'per day', quote: 'price on request'
};

function optionLine(o) {
  const bits = [];
  if (o.price_unit === 'quote' && !o.price) bits.push('price on request');
  else bits.push(`${money(o.price)} ${UNIT[o.price_unit] || ''}`.trim());
  if (o.child_price) bits.push(`child ${money(o.child_price)}`);
  if (o.max_people || o.min_people > 1) {
    bits.push(o.min_people && o.max_people ? `${o.min_people}–${o.max_people} people`
      : o.max_people ? `up to ${o.max_people} people` : `min ${o.min_people} people`);
  }
  if (o.timing) bits.push(o.timing);
  if (o.downpayment_percent) bits.push(`deposit ${o.downpayment_percent}%`);
  if (o.downpayment_fixed) bits.push(`deposit ${money(o.downpayment_fixed)}${o.downpayment_per_person ? ' per person' : ''}`);
  if (o.notes) bits.push(o.notes);
  return `- ${o.option_name || 'Option'}: ${bits.join(' · ')}`;
}

const clip = (s, n) => {
  s = String(s || '').trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

export function servicesKnowledge() {
  const services = db.prepare(`SELECT * FROM services ORDER BY category, service_name, id`).all();
  const opts = db.prepare(`SELECT * FROM service_options ORDER BY sort_order, id`).all();
  const parts = [];
  for (const s of services) {
    const lines = [`## ${s.service_name}${s.wix_form_name && s.wix_form_name !== s.service_name ? ` (website form: ${s.wix_form_name})` : ''}`];
    const add = (label, v) => { if (String(v || '').trim()) lines.push(`${label}: ${String(v).trim()}`); };
    add('Category', s.category);
    add('Provider', s.company);
    add('Our page', s.page_url);
    add('Provider website', s.website_url);
    add('About', s.summary);
    add('Included', s.included);
    add('Duration / times', s.duration);
    add('Location', s.location);
    add('Good to know', s.good_to_know);
    add('Cancellation policy', s.cancellation_policy);
    add('Information we need from the guest to book', s.info_needed);
    add('How we book it (internal)', s.booking_method);
    add('Internal notes (for the team, never quote to guests)', s.internal_notes);
    const o = opts.filter((x) => x.service_id === s.id);
    if (o.length) lines.push('Our prices (use these when quoting):', ...o.map(optionLine));
    add('Prices as shown on our public website', s.website_prices);
    if (s.website_text) lines.push(`Our website page says:\n${clip(s.website_text, 2500)}`);
    if (s.provider_text) lines.push(`Provider website (checked ${String(s.checked_at || '').slice(0, 10)}):\n${clip(s.provider_text, 2500)}`);
    parts.push(lines.join('\n'));
  }
  return parts.join('\n\n');
}

// --------------------------------------------------------- conversations ----
function signatureLines() {
  const sig = String(getSetting('email_signature', '') || '');
  return sig.split('\n').map((l) => l.trim()).filter((l) => l.length > 3);
}

// Message body without the quoted earlier emails and (for ours) the signature.
export function cleanBody(text, ours = false) {
  let s = String(text || '').replace(/\r/g, '');
  const cut = s.search(/^\s*(On [^\n]{5,200}\n?[^\n]{0,120}wrote:|-{2,}\s*Original Message|From: [^\n]+\n(Sent|Date): )/mi);
  if (cut > 0) s = s.slice(0, cut);
  s = s.split('\n').filter((l) => !/^\s*>/.test(l)).join('\n');
  if (ours) {
    const first = signatureLines()[0] || 'Kind regards,';
    const at = s.lastIndexOf(first);
    if (at > 0) s = s.slice(0, at);
  }
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

// Recent guest-message → our-reply pairs from OTHER conversations, so the
// draft sounds like us.
function toneExamples(excludeLeadId, limit = 18) {
  const outs = db.prepare(`
    SELECT m.id, m.lead_id, m.body, m.sent_at FROM messages m
    WHERE m.direction = 'out' AND m.lead_id != ? AND length(m.body) > 40
    ORDER BY m.sent_at DESC, m.id DESC LIMIT ?`).all(excludeLeadId, limit);
  const prevIn = db.prepare(`
    SELECT body FROM messages WHERE lead_id = ? AND direction = 'in'
      AND (sent_at < ? OR (sent_at = ? AND id < ?))
    ORDER BY sent_at DESC, id DESC LIMIT 1`);
  return outs.reverse().map((m, i) => {
    const guest = prevIn.get(m.lead_id, m.sent_at, m.sent_at, m.id);
    return `<example ${i + 1}>\n` +
      (guest ? `Guest wrote:\n${clip(cleanBody(guest.body), 900)}\n\n` : '') +
      `We replied:\n${clip(cleanBody(m.body, true), 1800)}\n</example ${i + 1}>`;
  }).join('\n\n');
}

function lineSummary(l) {
  const bits = [l.name || 'Service'];
  if (l.service_date) bits.push(l.service_date);
  if (l.service_time) bits.push(l.service_time);
  if (l.info) bits.push(l.info);
  if (l.people) bits.push(`people: ${l.people}`);
  const price = (Number(l.downpayment) || 0) + (Number(l.balance) || 0);
  if (price) bits.push(`price ${money(price)}`);
  if (l.provider) bits.push(`provider: ${l.provider}`);
  bits.push(l.confirmed ? 'CONFIRMED' : 'not confirmed yet');
  if (l.notes) bits.push(`notes: ${l.notes}`);
  return `- ${bits.join(' · ')}`;
}

function arubaNow() {
  const d = new Date(Date.now() - 4 * 3600e3);
  return `${d.toISOString().slice(0, 10)} (${d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })})`;
}

function leadContext(leadId) {
  const lead = db.prepare(`
    SELECT l.*, c.name AS client_name, c.email AS client_email, c.phone AS client_phone, c.notes AS client_notes
    FROM leads l JOIN clients c ON c.id = l.client_id WHERE l.id = ?`).get(leadId);
  if (!lead) throw new AiError('Lead not found', 404);
  const lines = db.prepare(`SELECT * FROM lead_services WHERE lead_id = ? ORDER BY id`).all(leadId);
  const msgs = db.prepare(`
    SELECT direction, from_email, from_name, body, sent_at FROM messages
    WHERE lead_id = ? ORDER BY sent_at, id`).all(leadId);

  const out = [];
  out.push(`Today in Aruba: ${arubaNow()}`);
  out.push(`\n# Guest\nName: ${lead.client_name}\nEmail: ${lead.client_email}` +
    (lead.client_phone ? `\nPhone: ${lead.client_phone}` : '') +
    (lead.client_notes ? `\nNotes about this guest: ${lead.client_notes}` : ''));

  const info = [`Subject: ${lead.subject || ''}`];
  if (lead.service) info.push(`Service requested: ${lead.service}`);
  if (lead.party_size) info.push(`How many people: ${lead.party_size}`);
  if (lead.service_date) info.push(`Service date: ${lead.service_date}`);
  if (lead.notes) info.push(`Our notes: ${lead.notes}`);
  if (lines.length) info.push('Services on this booking:', ...lines.map(lineSummary));
  out.push(`\n# This inquiry\n${info.join('\n')}`);

  // the guest's other inquiries / bookings with us
  const others = db.prepare(`
    SELECT id, subject, service, service_date, booking_confirmed, created_at FROM leads
    WHERE client_id = ? AND id != ? ORDER BY created_at DESC LIMIT 6`).all(lead.client_id, leadId);
  if (others.length) {
    const blocks = others.map((o) => {
      const ol = db.prepare(`SELECT * FROM lead_services WHERE lead_id = ? ORDER BY id`).all(o.id);
      const om = db.prepare(`
        SELECT direction, body, sent_at FROM messages WHERE lead_id = ?
        ORDER BY sent_at DESC, id DESC LIMIT 4`).all(o.id).reverse();
      return `## ${o.subject || o.service || 'Inquiry'} (started ${String(o.created_at).slice(0, 10)}${o.booking_confirmed ? ', booked' : ''})\n` +
        (ol.length ? `${ol.map(lineSummary).join('\n')}\n` : '') +
        om.map((m) => `[${String(m.sent_at).slice(0, 16)}] ${m.direction === 'in' ? 'GUEST' : 'US'}: ${clip(cleanBody(m.body, m.direction === 'out'), 700)}`).join('\n');
    });
    out.push(`\n# This guest's other conversations with us\n${blocks.join('\n\n')}`);
  }

  // this conversation, oldest first; the oldest messages are shortened if long
  const convo = msgs.map((m, i) => {
    const who = m.direction === 'in' ? `GUEST${m.from_name ? ` (${m.from_name})` : ''}` : 'US (Aqua Lux)';
    const limit = i >= msgs.length - 6 ? 6000 : 1500;
    return `[${String(m.sent_at).slice(0, 16)}] ${who}:\n${clip(cleanBody(m.body, m.direction === 'out'), limit)}`;
  });
  out.push(`\n# This conversation (oldest first)\n${convo.join('\n\n') || '(no messages yet)'}`);
  return { lead, text: out.join('\n') };
}

const REPLY_RULES = `You write email replies for Aqua Lux Aruba, a concierge company in Aruba that books tours, boat trips, private chefs, massages, transport and special moments for guests. You write as the Aqua Lux team, replying to guests' inquiries.

How to write the reply:
- Match the tone, warmth, length and structure of our past replies in the examples: the same greeting style, how we present options and prices, how we ask for details, and how we close. Write like a real person on the team, not like an assistant.
- Use the conversation so far: answer every question the guest asked, don't ask for anything they already told us, and don't repeat information we already sent unless it helps.
- Use the services information for facts: what is included, times, meeting points, policies. When quoting prices, use "Our prices"; the public website prices are for reference only. Never mention commissions, provider net rates or anything marked internal.
- Never invent a price, time, availability or policy. If something isn't in the information, say we will check and get back to them (or ask the team in the instructions to fill it in).
- If a date, number of guests, ages or other booking details are missing, ask for them, using "Information we need from the guest to book" for that service.
- Formatting: plain email text with Markdown only where it helps (**bold** for option names or prices, - bullet lists for options). No headings, no tables.
- Do NOT add a sign-off, name or signature at the end — our email signature (with the closing) is added automatically. End with the last sentence of the message.
- No subject line. Output only the email body, nothing else.
- Reply in the language the guest wrote in.`;

export async function draftReply(leadId, { instructions = '', currentDraft = '' } = {}) {
  const { lead, text } = leadContext(leadId);
  const examples = toneExamples(leadId);
  const system = [
    { type: 'text', text: REPLY_RULES },
    { type: 'text', text: `# Services information\n\n${servicesKnowledge() || '(no services filled in yet)'}`, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: `# Examples of our past replies (for tone and style)\n\n${examples || '(no past replies yet)'}`, cache_control: { type: 'ephemeral' } }
  ];
  let ask = `${text}\n\n# Your task\nWrite our reply to the guest's latest message.`;
  if (String(currentDraft).trim()) {
    ask += `\n\nThere is already a draft in the editor. Improve it and keep what the team wrote unless the instructions say otherwise:\n<draft>\n${clip(currentDraft, 6000)}\n</draft>`;
  }
  if (String(instructions).trim()) {
    ask += `\n\nInstructions from the team for this reply (follow them):\n${clip(instructions, 2000)}`;
  }
  const resp = await run({
    max_tokens: 16000,
    output_config: { effort: 'medium' },
    system,
    messages: [{ role: 'user', content: ask }]
  }, `draft lead ${lead.id}`);
  const body = finalText(resp);
  if (!body) throw new AiError('Claude returned an empty reply. Try again.', 502);
  return { markdown: body };
}

// --------------------------------------------------------- website check ----
export const CHECK_FIELDS = {
  summary: 'About', included: 'Included', duration: 'Duration / times', location: 'Location',
  good_to_know: 'Good to know', cancellation_policy: 'Cancellation policy',
  company: 'Provider', contact: 'Contact', website_url: 'Provider website'
};
const UNITS = ['flat_total', 'per_person', 'per_vehicle', 'per_hour', 'per_day', 'quote'];

const CHECK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['website_url', 'found', 'summary', 'page_text', 'field_changes', 'option_changes'],
  properties: {
    website_url: { type: 'string', description: 'The provider website page you used (empty if none found).' },
    found: { type: 'boolean', description: 'True if you found this service on the provider website.' },
    summary: { type: 'string', description: 'One or two sentences for the team: what you found and what changed.' },
    page_text: { type: 'string', description: 'The useful facts from the provider website for this service, condensed: prices, options, what is included, times, location, age/other requirements, policies. Plain text, at most about 2500 characters.' },
    field_changes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'new_value', 'reason'],
        properties: {
          field: { type: 'string', enum: Object.keys(CHECK_FIELDS) },
          new_value: { type: 'string' },
          reason: { type: 'string' }
        }
      }
    },
    option_changes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['action', 'option_id', 'option_name', 'price', 'child_price', 'price_unit', 'timing', 'notes', 'reason'],
        properties: {
          action: { type: 'string', enum: ['update', 'add'] },
          option_id: { type: 'integer', description: 'id of the option to update; 0 when adding' },
          option_name: { type: 'string' },
          price: { type: 'number' },
          child_price: { type: 'number' },
          price_unit: { type: 'string', enum: UNITS },
          timing: { type: 'string' },
          notes: { type: 'string' },
          reason: { type: 'string', description: 'What the website says, e.g. "Website lists $95 per adult (was $86)"' }
        }
      }
    }
  }
};

function hostOf(url) {
  try { return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase(); } catch { return ''; }
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { /* fall through */ }
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch { /* ignore */ } }
  return null;
}

export async function checkWebsite(service) {
  const url = String(service.website_url || '').trim();
  const host = hostOf(url);
  const bare = host.replace(/^www\./, '');
  const tools = [];
  if (url && host) {
    tools.push({ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 8, allowed_domains: [...new Set([host, bare])] });
  } else {
    tools.push({ type: 'web_search_20260209', name: 'web_search', max_uses: 4 });
    tools.push({ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 6 });
  }
  const opts = service.options || [];
  const current = [
    `Service: ${service.service_name}`,
    `Category: ${service.category || ''}`,
    `Provider: ${service.company || '(unknown)'}`,
    `Contact: ${service.contact || ''}`,
    ...Object.keys(CHECK_FIELDS).filter((f) => !['company', 'contact', 'website_url'].includes(f))
      .map((f) => `${CHECK_FIELDS[f]} [${f}]: ${String(service[f] || '').trim() || '(empty)'}`),
    'Price options:',
    ...(opts.length ? opts.map((o) => `${optionLine(o)} [option_id ${o.id}, unit ${o.price_unit}]`) : ['(none)'])
  ].join('\n');

  const where = url
    ? `The provider's website is ${url} — fetch it, and follow links on that site to the page(s) about this service and its prices if needed. Use only that website.`
    : `We don't have the provider's website yet. Search for the official website of "${service.company || service.service_name}" in Aruba (the provider of this service), then fetch it. Use only the provider's own official website — not TripAdvisor, Viator, GetYourGuide, Expedia, Facebook or other resellers. Put the URL you used in website_url.`;

  const prompt = `You keep the service information pages of Aqua Lux Aruba (a concierge company) up to date with what the providers publish on their own websites.

${where}

Here is what we currently have for this service:
<current>
${current}
</current>

Compare the provider's website with what we have and propose changes:
- option_changes: when the website's price for an option differs from ours, propose an "update" with the option_id and the website's price (keep our option name unless the website clearly renamed it; keep our unit, timing and notes unless the website shows different ones). The website often uses different names for the same thing (for example our "Brunch Tour" may be called "Aqua Champagne Brunch Cruise" there, or our "Sunset Tour" a "Sunset Cruise") — match them by what they are (time of day, duration, type) and propose an "update" of our option, never an "add". Propose "add" (option_id 0) only for options that really have no match in ours (for example a dinner package we don't list). Don't propose removing options.
- field_changes: propose a new value for a field only when the website clearly shows different or missing information (for example new times, a new inclusion, a changed policy). Write the full new value for the field, in the same short style as ours (one item per line for lists). Leave out changes that are only wording.
- Only propose what the website clearly supports. If something is unclear, or the website shows no prices, propose nothing for it and say so in the summary.
- If you could not find the service on the website, set found to false, explain in the summary, and propose no changes.
- page_text: the useful facts you read, so the team (and the reply assistant) can use them later.`;

  const resp = await run({
    max_tokens: 32000,
    output_config: { effort: 'high', format: { type: 'json_schema', schema: CHECK_SCHEMA } },
    tools,
    messages: [{ role: 'user', content: prompt }]
  }, `website check service ${service.id}`);

  const data = parseJson(finalText(resp));
  if (!data) throw new AiError('Could not read Claude’s answer for this website. Try again.', 502);
  return data;
}

// Turn a check result into the list of proposals shown on the service page.
// Which of our options a website option most likely is, by the words in
// their names ("Aqua Champagne Brunch Cruise" -> our "Brunch Tour").
const NAME_NOISE = new Set(['tour', 'tours', 'cruise', 'cruises', 'trip', 'the', 'a', 'an', 'and', 'with', 'of',
  'for', 'sailing', 'snorkeling', 'snorkel', 'experience', 'package', 'option', 'minutes', 'minute', 'min',
  'mins', 'hours', 'hour', 'massage', 'private', 'charter', 'per', 'person']);
const nameWords = (n) => new Set(String(n || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')
  .filter((w) => w && !NAME_NOISE.has(w)));
export function bestOptionMatches(newNames, options, taken = new Set()) {
  const pairs = [];
  newNames.forEach((name, i) => {
    const a = nameWords(name);
    for (const o of options) {
      if (taken.has(o.id)) continue;
      const b = nameWords(o.option_name);
      const overlap = [...a].filter((w) => b.has(w)).length;
      if (!overlap) continue;
      const contain = overlap / Math.min(a.size, b.size);
      if (contain < 0.5) continue;
      pairs.push({ i, id: o.id, contain, jac: overlap / new Set([...a, ...b]).size });
    }
  });
  pairs.sort((x, y) => y.contain - x.contain || y.jac - x.jac);
  const out = new Map(); // index -> option id
  const used = new Set(taken);
  for (const p of pairs) {
    if (out.has(p.i) || used.has(p.id)) continue;
    out.set(p.i, p.id);
    used.add(p.id);
  }
  return out;
}

// A website option applied to one of our existing options: the website's
// price, our name; their times/notes only where ours are empty.
export function asUpdateOf(cur, option) {
  return {
    option_name: cur.option_name, price: Number(option.price) || 0,
    child_price: Number(option.child_price) || Number(cur.child_price) || 0,
    price_unit: option.price_unit || cur.price_unit,
    timing: cur.timing || option.timing || '', notes: cur.notes || option.notes || ''
  };
}
const oldOf = (cur) => ({ option_name: cur.option_name, price: cur.price, child_price: cur.child_price || 0,
  price_unit: cur.price_unit, timing: cur.timing || '', notes: cur.notes || '' });

export function proposalsFrom(service, data) {
  const out = [];
  const id = () => crypto.randomBytes(5).toString('hex');
  const url = String(data.website_url || '').trim();
  if (url && !String(service.website_url || '').trim()) {
    out.push({ id: id(), kind: 'field', field: 'website_url', label: CHECK_FIELDS.website_url, old_value: '', new_value: url, reason: 'Found the provider’s website' });
  }
  for (const c of data.field_changes || []) {
    if (!CHECK_FIELDS[c.field]) continue;
    const oldV = String(service[c.field] || '').trim();
    const newV = String(c.new_value || '').trim();
    if (!newV || newV === oldV) continue;
    if (c.field === 'website_url' && out.some((p) => p.field === 'website_url')) continue;
    out.push({ id: id(), kind: 'field', field: c.field, label: CHECK_FIELDS[c.field], old_value: oldV, new_value: newV, reason: String(c.reason || '') });
  }
  const opts = service.options || [];
  for (const c of data.option_changes || []) {
    const unit = UNITS.includes(c.price_unit) ? c.price_unit : 'per_person';
    const option = {
      option_name: String(c.option_name || '').trim(), price: Number(c.price) || 0,
      child_price: Number(c.child_price) || 0, price_unit: unit,
      timing: String(c.timing || '').trim(), notes: String(c.notes || '').trim()
    };
    if (c.action === 'update') {
      const cur = opts.find((o) => o.id === Number(c.option_id));
      if (!cur) continue;
      // blanks mean "keep ours"
      if (!option.timing) option.timing = cur.timing || '';
      if (!option.notes) option.notes = cur.notes || '';
      if (!option.child_price) option.child_price = Number(cur.child_price) || 0;
      const same = Number(cur.price) === option.price && Number(cur.child_price || 0) === option.child_price &&
        cur.option_name === (option.option_name || cur.option_name) && cur.price_unit === unit &&
        (cur.timing || '') === option.timing && (cur.notes || '') === option.notes;
      if (same) continue;
      out.push({ id: id(), kind: 'option', action: 'update', option_id: cur.id, label: cur.option_name || 'Option',
        old: oldOf(cur), option: { ...option, option_name: option.option_name || cur.option_name }, reason: String(c.reason || '') });
    } else if (option.option_name) {
      out.push({ id: id(), kind: 'option', action: 'add', option_id: 0, label: option.option_name, option, reason: String(c.reason || '') });
    }
  }
  // "New" options that are really one of ours under another name become
  // price updates of that option.
  const adds = out.filter((p) => p.kind === 'option' && p.action === 'add');
  const taken = new Set(out.filter((p) => p.action === 'update').map((p) => p.option_id));
  const matches = bestOptionMatches(adds.map((p) => p.option.option_name), opts, taken);
  adds.forEach((p, i) => {
    const cur = opts.find((o) => o.id === matches.get(i));
    if (!cur) return;
    const upd = asUpdateOf(cur, p.option);
    if (Number(cur.price) === upd.price && Number(cur.child_price || 0) === upd.child_price && cur.price_unit === upd.price_unit) {
      out.splice(out.indexOf(p), 1); // same price already — nothing to do
      return;
    }
    Object.assign(p, {
      action: 'update', option_id: cur.id, label: cur.option_name || 'Option', old: oldOf(cur), option: upd,
      reason: `Website calls it “${p.option.option_name}”. ${p.reason}`.trim()
    });
  });
  return out;
}
