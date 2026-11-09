// AI helper (Claude). Two jobs:
//   1. draftReply   — writes a reply to a guest, using the Services info
//                     pages, the tone of our past replies, and everything in
//                     this guest's conversations so far.
//   2. checkService — keeps a service's info page right, in this order:
//                     the provider's own website first (its prices and info
//                     are applied to the CRM); without one, what the team
//                     entered in the CRM. Then it compares that with our own
//                     page on aqualuxaruba.com and lists what to fix there.
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
    if (o.length) {
      lines.push('Our prices (use these when quoting):');
      for (const x of o) {
        lines.push(optionLine(x));
        if (String(x.web_details || '').trim()) lines.push(`    Includes: ${String(x.web_details).trim().split('\n').join('; ')}`);
      }
    }
    // our public page can be behind; the information above wins
    if (s.website_text) lines.push(`Our public website page (background only — it can be out of date; where it differs from the information above, the information above is correct, and never quote its prices):\n${clip(s.website_text, 2500)}`);
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

// ---------------------------------------------------- our own web page ----
// The visible text of one of our aqualuxaruba.com service pages, without the
// menu, the inquiry form and the footer.
export function pageText(html) {
  let h = String(html || '')
    .replace(/<head[\s\S]*?<\/head>/i, '')
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<(br|p|div|li|h[1-6]|span|section|tr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  h = h.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/​/g, '');
  const lines = [];
  for (const raw of h.split('\n')) {
    const l = raw.replace(/\s+/g, ' ').trim();
    if (l && lines[lines.length - 1] !== l) lines.push(l);
  }
  let t = lines.join('\n');
  const marker = 'Use tab to navigate through the menu items.';
  if (t.includes(marker)) t = t.slice(t.indexOf(marker) + marker.length);
  const tail = t.includes('Inquire Now!') ? t.slice(t.indexOf('Inquire Now!')) : '';
  for (const cut of ['Inquire Now!', 'Social Media', 'bottom of page']) {
    if (t.includes(cut)) t = t.slice(0, t.indexOf(cut));
  }
  const arrive = tail.match(/Please arrive[^\n]*/);
  return (t.trim() + (arrive ? `\n${arrive[0]}` : '')).trim();
}

export async function fetchOurPage(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'AquaLuxCRM/1.0' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = pageText(await res.text());
  if (text.length < 40) throw new Error('page had no readable text');
  return text;
}

// ------------------------------------------------------- service check ----
const SITE_ISSUES = {
  type: 'array',
  description: 'What is wrong or missing on our own website page, compared with the correct information.',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['topic', 'website_says', 'should_say'],
    properties: {
      topic: { type: 'string', description: 'What it is about, e.g. "Sunset Tour price" or "Cancellation policy"' },
      website_says: { type: 'string', description: 'What our website shows now ("Not on the website" if missing)' },
      should_say: { type: 'string', description: 'The correct information to put on the website' }
    }
  }
};
const COMPARE_ONLY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'site_issues'],
  properties: {
    summary: { type: 'string', description: 'One or two sentences for the team.' },
    site_issues: SITE_ISSUES
  }
};
const CHECK_WITH_SITE_SCHEMA = {
  ...CHECK_SCHEMA,
  required: [...CHECK_SCHEMA.required, 'site_issues'],
  properties: { ...CHECK_SCHEMA.properties, site_issues: SITE_ISSUES }
};

const COMPARE_RULES = `Comparing with our own website (site_issues):
- List every price that is different on our website, and every price option that is missing there.
- List facts that are different on our website: times, duration, what is included, age or other requirements, meeting point, cancellation policy, provider name. Also list important facts (prices, times, policies) that are missing from our website.
- Don't list differences in wording, style or level of detail, and don't list things our website has that the correct information simply doesn't mention.
- website_says: quote or summarize what our website shows now ("Not on the website" if missing). should_say: exactly what it should say instead.
- If our website already matches, return an empty list.`;

function serviceSummary(service) {
  const opts = service.options || [];
  return [
    `Service: ${service.service_name}`,
    `Category: ${service.category || ''}`,
    `Provider: ${service.company || '(unknown)'}`,
    `Contact: ${service.contact || ''}`,
    ...Object.keys(CHECK_FIELDS).filter((f) => !['company', 'contact', 'website_url'].includes(f))
      .map((f) => `${CHECK_FIELDS[f]} [${f}]: ${String(service[f] || '').trim() || '(empty)'}`),
    'Price options:',
    ...(opts.length ? opts.map((o) => `${optionLine(o)} [option_id ${o.id}, unit ${o.price_unit}]`) : ['(none)'])
  ].join('\n');
}

// With a provider website: read it, correct our info from it, and compare
// the corrected info with our own page. Without one: our CRM info is the
// correct information; only compare it with our own page.
export async function checkService(service, ourPageText) {
  const url = String(service.website_url || '').trim();
  const host = hostOf(url);
  const ourPage = String(ourPageText || '').trim()
    ? `<our_website_page url="${service.page_url || 'www.aqualuxaruba.com'}">\n${clip(ourPageText, 12000)}\n</our_website_page>`
    : '<our_website_page>(we have no page for this service on aqualuxaruba.com)</our_website_page>';

  if (!url || !host) {
    const prompt = `You help Aqua Lux Aruba (a concierge company) keep its public website www.aqualuxaruba.com correct.

The information in our CRM below is CORRECT — the team keeps it up to date by hand. Compare our own website page with it and list what has to be fixed on the website.

<correct_information>
${serviceSummary(service)}
</correct_information>

${ourPage}

${COMPARE_RULES}`;
    const resp = await run({
      max_tokens: 16000,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: COMPARE_ONLY_SCHEMA } },
      messages: [{ role: 'user', content: prompt }]
    }, `site compare service ${service.id}`);
    const data = parseJson(finalText(resp));
    if (!data) throw new AiError('Could not read Claude’s answer. Try again.', 502);
    return { mode: 'compare', ...data };
  }

  const bare = host.replace(/^www\./, '');
  const prompt = `You keep the service information of Aqua Lux Aruba (a concierge company) correct. The provider's own website is the most reliable source: what it shows wins over what we have.

The provider's website is ${url} — fetch it, and follow links on that site to the page(s) about this service and its prices if needed. Use only that website.

What we have now in our CRM:
<current>
${serviceSummary(service)}
</current>

Step 1 — correct our CRM from the provider's website (these changes are applied automatically):
- option_changes: when the provider's price for an option differs from ours, an "update" with the option_id and the provider's price (keep our option name unless the provider clearly renamed it; keep our unit, timing and notes unless the provider shows different ones). The provider often uses different names for the same thing (our "Brunch Tour" may be their "Aqua Champagne Brunch Cruise", our "Sunset Tour" their "Sunset Cruise") — match them by what they are (time of day, duration, type) and use "update", never "add". Use "add" (option_id 0) only for options with no match in ours. Never remove options.
- field_changes: a new value for a field only when the provider clearly shows different or missing information (new times, a new inclusion, a changed policy). Write the full new value for the field, in the same short style as ours (one item per line for lists). Leave out changes that are only wording.
- Only change what the provider's website clearly supports. If something is unclear, or the provider shows no prices, change nothing for it and say so in the summary.
- If you could not find the service on the provider's website, set found to false, explain in the summary, and make no changes.
- page_text: the useful facts you read on the provider's website.

Step 2 — compare the CORRECTED information (ours after your step-1 changes) with our own public website page below, and list what has to be fixed on our website.

${ourPage}

${COMPARE_RULES}`;

  const resp = await run({
    max_tokens: 32000,
    output_config: { effort: 'high', format: { type: 'json_schema', schema: CHECK_WITH_SITE_SCHEMA } },
    tools: [{ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 8, allowed_domains: [...new Set([host, bare])] }],
    messages: [{ role: 'user', content: prompt }]
  }, `provider check service ${service.id}`);
  const data = parseJson(finalText(resp));
  if (!data) throw new AiError('Could not read Claude’s answer for this website. Try again.', 502);
  return { mode: 'provider', ...data };
}

// Which of our options a website option most likely is, by the words in
// their names ("Aqua Champagne Brunch Cruise" -> our "Brunch Tour").
const NAME_NOISE = new Set(['tour', 'tours', 'cruise', 'cruises', 'trip', 'the', 'a', 'an', 'and', 'with', 'of',
  'for', 'sailing', 'snorkeling', 'snorkel', 'experience', 'package', 'option', 'minutes', 'minute', 'min',
  'mins', 'hours', 'hour', 'massage', 'private', 'charter', 'per', 'person']);
const NAME_SAME = { single: '1', one: '1', double: '2', two: '2', triple: '3', three: '3', four: '4', five: '5', six: '6' };
const nameWords = (n) => new Set(String(n || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')
  .map((w) => NAME_SAME[w] || w).filter((w) => w && !NAME_NOISE.has(w)));
const VARIANT_WORDS = new Set(['vip', 'deluxe', 'premium', 'luxury', 'dinner', 'combo', 'extended', 'upgrade',
  'family', 'group', 'kids', 'exclusive', 'plus']);
export function bestOptionMatches(newNames, options, taken = new Set()) {
  const pairs = [];
  newNames.forEach((name, i) => {
    const a = nameWords(name);
    // a variant of a tour is its own product, never the same as the plain one
    if ([...a].some((w) => VARIANT_WORDS.has(w))) return;
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

// Turn a provider check into the list of changes to apply to the service.
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
