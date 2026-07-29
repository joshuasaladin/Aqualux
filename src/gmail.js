/**
 * Gmail integration via the official Gmail REST API (OAuth 2.0).
 *  - Polls the inbox: new incoming emails become leads (status "New Lead").
 *  - Follows each thread: client reply -> "New Mail", your reply -> "Responded".
 *  - Sends replies from the CRM through the connected Gmail account.
 *
 * Credentials (OAuth client id/secret) come from the Settings tab or the
 * GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET env vars. Tokens live in the DB.
 */
import crypto from 'node:crypto';
import { db, getSetting, setSetting, deleteSetting, upsertClient, touchLead, markThreadProcessed } from './db.js';

const SCOPES = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/calendar.events';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const CAL_API = 'https://www.googleapis.com/calendar/v3';
// Google Calendar's "Banana" color — the closest built-in option to yellow.
const CAL_COLOR_ID = '5';

// Bulk/marketing sender addresses — never real people.
const SKIP_SENDERS = /no[-._]?reply|donotreply|mailer-daemon|notifications?@|newsletter|marketing@|promo(?:tions?)?@|offers?@|deals@|@e?mail\.|@e\./i;
// Gmail's own categorization: promotions/social/spam are not leads.
const SKIP_LABELS = new Set(['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'SPAM']);
// Payment services whose notification emails go to the Payments tab.
export const PAYMENT_SENDERS = /venmo\.com|zelle|chase\.com|paypal\.com|cash\.app|square(?:up)?\.com|wellsfargo|bankofamerica|citi(?:bank)?\.com|wise\.com|revolut\.com/i;

// Appended to every outgoing reply; editable in Settings.
export const DEFAULT_SIGNATURE = `Kind regards,

Isabella Frieri

Aqua Lux Aruba
Concierge & Guest services
📞 +297 567-0134
✉️ aqualuxaruba@gmail.com
🌐 www.aqualuxaruba.com`;

export function getCredentials() {
  const stored = getSetting('gmail_credentials', {});
  return {
    client_id: stored.client_id || process.env.GOOGLE_CLIENT_ID || '',
    client_secret: stored.client_secret || process.env.GOOGLE_CLIENT_SECRET || ''
  };
}

export function isConnected() {
  return !!getSetting('gmail_tokens');
}

export function hasCalendarScope() {
  const scope = getSetting('gmail_granted_scope', '');
  return scope.includes('calendar');
}

export function connectionInfo() {
  const creds = getCredentials();
  return {
    has_credentials: !!(creds.client_id && creds.client_secret),
    connected: isConnected(),
    email: getSetting('gmail_email', null),
    last_sync: getSetting('gmail_last_sync', null),
    last_sync_error: getSetting('gmail_last_sync_error', null),
    calendar_connected: isConnected() && hasCalendarScope()
  };
}

// ------------------------------------------------------------- OAuth ------
export function buildAuthUrl(redirectUri) {
  const { client_id } = getCredentials();
  if (!client_id) throw new Error('Set your Google Client ID and Secret first');
  const state = crypto.randomBytes(16).toString('hex');
  setSetting('gmail_oauth_state', state);
  const params = new URLSearchParams({
    client_id,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function handleCallback(code, state, redirectUri) {
  if (!state || state !== getSetting('gmail_oauth_state')) throw new Error('Invalid OAuth state');
  deleteSetting('gmail_oauth_state');
  const { client_id, client_secret } = getCredentials();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id, client_secret,
      redirect_uri: redirectUri, grant_type: 'authorization_code'
    })
  });
  const tokens = await res.json();
  if (!res.ok || !tokens.access_token) {
    throw new Error(tokens.error_description || tokens.error || 'Token exchange failed');
  }
  tokens.expires_at = Date.now() + (tokens.expires_in - 60) * 1000;
  setSetting('gmail_tokens', tokens);
  // Google only returns the granted scopes on THIS response, not on refresh —
  // record it so we can tell whether Calendar access was actually granted
  // (a user connected before Calendar sync existed won't have it yet).
  setSetting('gmail_granted_scope', tokens.scope || '');

  const profile = await apiGet('/profile');
  setSetting('gmail_email', profile.emailAddress);
  // Only emails that arrive AFTER connecting become leads (avoids importing
  // the whole mailbox). "Import last 7 days" in Settings can look further back.
  if (!getSetting('gmail_sync_since')) setSetting('gmail_sync_since', Math.floor(Date.now() / 1000));
  return profile.emailAddress;
}

export function disconnect() {
  for (const k of ['gmail_tokens', 'gmail_email', 'gmail_last_sync', 'gmail_last_sync_error',
                    'gmail_sync_since', 'gmail_granted_scope']) {
    deleteSetting(k);
  }
}

export async function accessToken() {
  const tokens = getSetting('gmail_tokens');
  if (!tokens) throw new Error('Gmail is not connected');
  if (Date.now() < tokens.expires_at) return tokens.access_token;

  const { client_id, client_secret } = getCredentials();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: tokens.refresh_token, client_id, client_secret,
      grant_type: 'refresh_token'
    })
  });
  const fresh = await res.json();
  if (!res.ok || !fresh.access_token) {
    throw new Error('Gmail token refresh failed — reconnect in Settings');
  }
  const merged = { ...tokens, ...fresh, expires_at: Date.now() + (fresh.expires_in - 60) * 1000 };
  setSetting('gmail_tokens', merged);
  return merged.access_token;
}

async function apiGet(path) {
  const token = await accessToken();
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Gmail API error ${res.status}`);
  return data;
}

async function apiPost(path, body) {
  const token = await accessToken();
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Gmail API error ${res.status}`);
  return data;
}

// --------------------------------------------------- message parsing ------
const header = (msg, name) =>
  msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

const decodeB64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

function extractText(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) return decodeB64url(payload.body.data);
  if (payload.mimeType === 'text/html' && payload.body?.data) {
    return decodeB64url(payload.body.data)
      .replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li)>/gi, '\n')
      .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
      .replace(/\n{3,}/g, '\n\n').trim();
  }
  for (const part of payload.parts || []) {
    const text = extractText(part);
    if (text) return text;
  }
  return '';
}

function parseFrom(fromHeader) {
  const m = fromHeader.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>/);
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  return { name: '', email: fromHeader.trim().toLowerCase() };
}

/** Is this bulk/marketing mail rather than a real person? */
export function isBulkMail(msg, from) {
  if (SKIP_SENDERS.test(from.email)) return true;
  if ((msg.labelIds || []).some((l) => SKIP_LABELS.has(l))) return true;
  if (header(msg, 'List-Unsubscribe')) return true;
  if (/^(bulk|list)$/i.test(header(msg, 'Precedence'))) return true;
  return false;
}

// Google Calendar's own RSVP/update notifications — e.g. someone accepting a
// meeting invite Aqualux sent. These come FROM the guest's real address (so
// sender filtering alone can't catch them), always with a subject Google
// itself prefixes, and this "guest replying to an invite" content is never a
// service inquiry, so it should never become a lead.
const CALENDAR_RSVP_SUBJECT = /^(accepted|declined|tentative|invitation|updated invitation|canceled event|cancelled event|new event):/i;
const CALENDAR_RSVP_BODY = /has (accepted|declined|tentatively accepted) this invitation|join with google meet/i;

export function isCalendarNotification(subject, bodyText) {
  return CALENDAR_RSVP_SUBJECT.test((subject || '').trim()) || CALENDAR_RSVP_BODY.test(bodyText || '');
}

// ------------------------------------------------- website form emails ----
/**
 * Wix (and similar form services) email you a "Submission summary" with
 * "Label:" / value pairs. Parse it so the lead belongs to the real visitor —
 * their name and email — instead of the form service's address.
 */
export function parseFormSubmission(from, bodyText) {
  const looksLikeForm = /wix-forms\.com|wixforms|formsubmit/i.test(from.email) ||
    /submitted your form|submission summary/i.test(bodyText);
  if (!looksLikeForm) return null;

  // Drop the Wix notification footer (tracking links) before parsing.
  bodyText = bodyText
    .replace(/\s*Click on the link below[\s\S]*$/i, '')
    .replace(/\s*This email was sent as a notification[\s\S]*$/i, '');

  const formName = bodyText.match(/submitted your form\s+["“]?(.+?)["”]?\s+on\s/i)?.[1]?.trim() || '';

  // Collect "Label:" -> value pairs ("Label:\nvalue" or "Label: value")
  const lines = bodyText.split('\n').map((l) => l.trim());
  const fields = {};
  const order = [];
  const isLabel = (l) => /^(.{1,160}?)\s*:\s*$/.test(l);
  for (let i = 0; i < lines.length; i++) {
    let label = null, value = '';
    const block = lines[i].match(/^(.{1,160}?)\s*:\s*$/);
    const inline = lines[i].match(/^(.{1,160}?):\s+(.+)$/);
    if (block) {
      label = block[1];
      const vals = [];
      let j = i + 1;
      while (j < lines.length && !isLabel(lines[j]) && !/^(.{1,160}?):\s+.+$/.test(lines[j])) {
        if (/^view submissions?$/i.test(lines[j])) break; // Wix footer button
        if (lines[j]) vals.push(lines[j]);
        j++;
      }
      value = vals.join(' ').trim();
      i = j - 1;
    } else if (inline && !/^https?:/i.test(inline[2])) {
      label = inline[1];
      value = inline[2].trim();
    }
    if (label && value) {
      fields[label.toLowerCase().replace(/\?+$/, '').trim()] = value;
      order.push([label.replace(/\?+$/, '').trim(), value]);
    }
  }

  const pick = (...names) => {
    for (const n of names) if (fields[n]) return fields[n];
    return '';
  };
  const email = pick('email', 'e-mail', 'email address').match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/)?.[0]?.toLowerCase();
  if (!email) return null;

  const name = [pick('first name'), pick('last name')].filter(Boolean).join(' ') ||
    pick('name', 'full name') || email;
  const phone = pick('phone', 'phone number', 'mobile');
  const partySize = parseInt(pick('people', 'guests', 'number of people', 'party size', 'how many people'), 10) || null;
  const activity = pick('choose the activity', 'activity', 'service', 'choose a service');

  let serviceDate = null;
  const rawDate = pick('select a date', 'date', 'service date', 'preferred date');
  if (rawDate) {
    const iso = rawDate.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    if (iso) serviceDate = iso;
    else {
      const d = new Date(rawDate);
      if (!isNaN(d)) serviceDate = d.toISOString().slice(0, 10);
    }
  }

  const details = order
    .filter(([label]) => !/^(submission summary|view submissions?)$/i.test(label))
    .map(([label, value]) => `${label}: ${value}`).join('\n');

  return {
    formName: formName || 'Website form',
    service: [formName, activity].filter(Boolean).join(' — ') || activity || 'Website inquiry',
    name, email, phone, partySize, serviceDate, details
  };
}

// ------------------------------------------------ payment notifications ---
/**
 * Venmo / Zelle / Chase / PayPal etc. notification emails become entries in
 * the Payments tab instead of leads.
 */
export function parsePaymentNotification(from, subject, body) {
  if (!PAYMENT_SENDERS.test(from.email)) return null;
  const text = subject + '\n' + body;
  // Only money-received notifications — not statements, ads, or login alerts.
  if (!/paid you|sent you|received (?:money|a payment|\$)|you received|payment received|deposited/i.test(text)) return null;

  const amount = Number((subject.match(/\$\s?([\d,]+(?:\.\d{1,2})?)/) ||
                         body.match(/\$\s?([\d,]+(?:\.\d{1,2})?)/) || [])[1]?.replace(/,/g, '')) || 0;

  let payer =
    subject.match(/^(.{2,50}?)\s+(?:paid|sent)\s+you/i)?.[1] ||
    body.match(/^(.{2,50}?)\s+(?:paid|sent)\s+you/im)?.[1] ||
    text.match(/(?:from|received money from)\s+([A-Z][\w .'-]{2,40}?)(?:\s+(?:is|has|on|for|via|with)\b|[.,!\n]|$)/m)?.[1] ||
    '';
  payer = payer.trim();

  let source = 'Bank';
  if (/venmo/i.test(from.email)) source = 'Venmo';
  else if (/zelle/i.test(text) || /zelle/i.test(from.email)) source = 'Zelle';
  else if (/paypal/i.test(from.email)) source = 'PayPal';
  else if (/cash\.app|squareup/i.test(from.email)) source = 'Cash App';
  else if (/chase/i.test(from.email)) source = 'Chase';
  else if (/wise\.com/i.test(from.email)) source = 'Wise';

  return { source, payer, amount };
}

function recordPayment(pay, msg, subject, body) {
  db.prepare(`
    INSERT OR IGNORE INTO payments (gmail_message_id, source, payer, amount, subject, body, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(msg.id, pay.source, pay.payer, pay.amount, subject,
         body.slice(0, 2000), new Date(Number(msg.internalDate)).toISOString());
}

/** The client's most recently active lead, if any — merge target. */
function latestLeadForClient(clientId) {
  return db.prepare(`
    SELECT * FROM leads WHERE client_id = ?
    ORDER BY updated_at DESC LIMIT 1`).get(clientId);
}

function registerThread(threadId, leadId) {
  db.prepare(`INSERT OR IGNORE INTO lead_threads (thread_id, lead_id) VALUES (?, ?)`)
    .run(threadId, leadId);
}

function bumpMergedCount(leadId) {
  db.prepare(`UPDATE leads SET merged_count = merged_count + 1 WHERE id = ?`).run(leadId);
}

/**
 * A form submission either creates a lead or — when this person already has
 * one — is added to their existing lead as another submission.
 */
export function handleFormSubmission(form, msg) {
  const client = upsertClient({ name: form.name, email: form.email, phone: form.phone });
  const body = `Website form submission — ${form.formName}\n\n${form.details}`;
  const sentAt = new Date(Number(msg.internalDate)).toISOString();

  const existing = latestLeadForClient(client.id);
  if (existing) {
    const ins = db.prepare(`
      INSERT OR IGNORE INTO messages (lead_id, gmail_message_id, direction, from_email, subject, body, sent_at)
      VALUES (?, ?, 'in', ?, ?, ?, ?)`)
      .run(existing.id, msg.id, form.email, form.formName, body, sentAt);
    if (ins.changes) {
      bumpMergedCount(existing.id);
      // fill in blanks from the new submission, never overwrite your edits
      if (!existing.service_date && form.serviceDate) {
        db.prepare(`UPDATE leads SET service_date = ? WHERE id = ?`).run(form.serviceDate, existing.id);
      }
      if (!existing.party_size && form.partySize) {
        db.prepare(`UPDATE leads SET party_size = ? WHERE id = ?`).run(form.partySize, existing.id);
      }
      recomputeStatus(existing.id);
    }
    return existing.id;
  }

  const info = db.prepare(`
    INSERT INTO leads (client_id, subject, service, service_date, party_size, source)
    VALUES (?, ?, ?, ?, ?, 'website_form')`)
    .run(client.id, form.formName, form.service, form.serviceDate, form.partySize);
  db.prepare(`
    INSERT INTO messages (lead_id, gmail_message_id, direction, from_email, subject, body, sent_at)
    VALUES (?, ?, 'in', ?, ?, ?, ?)`)
    .run(info.lastInsertRowid, msg.id, form.email, form.formName, body, sentAt);
  recomputeStatus(info.lastInsertRowid);
  return info.lastInsertRowid;
}

// --------------------------------------------------------------- sync -----
let syncing = false;

export async function syncNow() {
  if (syncing) return { skipped: true };
  if (!isConnected()) return { skipped: true };
  syncing = true;
  try {
    const myEmail = (getSetting('gmail_email') || '').toLowerCase();
    const since = getSetting('gmail_sync_since') || Math.floor(Date.now() / 1000);
    let created = 0, updated = 0, payments = 0;

    // 1. New threads -> new leads (or merged into the sender's existing
    //    lead). Searches ALL mail, not just the inbox, so emails that Gmail
    //    filters auto-label or archive (skip the inbox) are still found.
    const list = await apiGet(`/threads?q=${encodeURIComponent(`after:${since} -in:spam -in:trash`)}&maxResults=50`);
    for (const t of list.threads || []) {
      if (db.prepare(`SELECT 1 FROM lead_threads WHERE thread_id = ?`).get(t.id)) continue;
      if (db.prepare(`SELECT 1 FROM processed_threads WHERE thread_id = ?`).get(t.id)) continue;
      const thread = await apiGet(`/threads/${t.id}?format=full`);
      const first = thread.messages?.[0];
      if (!first) continue;
      const from = parseFrom(header(first, 'From'));
      if (!from.email || from.email === myEmail) { markThreadProcessed(t.id); continue; }

      const bodyText = extractText(first.payload) || first.snippet || '';
      const subject = header(first, 'Subject') || '(no subject)';

      // Website form notification? Lead belongs to the visitor, not the form service.
      const form = parseFormSubmission(from, bodyText);
      if (form) {
        handleFormSubmission(form, first);
        markThreadProcessed(t.id);
        created++;
        continue;
      }

      // Emails from payment services NEVER become leads: money-received
      // notifications go to the Payments tab; everything else from them
      // (transfer initiated, statements, alerts) is skipped entirely.
      if (PAYMENT_SENDERS.test(from.email)) {
        const pay = parsePaymentNotification(from, subject, bodyText);
        if (pay) {
          recordPayment(pay, first, subject, bodyText);
          payments++;
        }
        markThreadProcessed(t.id);
        continue;
      }

      // Bulk / promotional mail is not a lead.
      if (isBulkMail(first, from)) { markThreadProcessed(t.id); continue; }

      // Google Calendar RSVP notifications ("Accepted: ...") are not leads,
      // even though they arrive from the guest's real address.
      if (isCalendarNotification(subject, bodyText)) { markThreadProcessed(t.id); continue; }

      const client = upsertClient({ name: from.name, email: from.email });
      const existing = latestLeadForClient(client.id);
      if (existing) {
        // Same person writing in again from a new thread -> same lead.
        registerThread(t.id, existing.id);
        if (!existing.gmail_thread_id) {
          db.prepare(`UPDATE OR IGNORE leads SET gmail_thread_id = ? WHERE id = ?`).run(t.id, existing.id);
        }
        if (absorbThreadMessages(existing.id, thread, myEmail)) bumpMergedCount(existing.id);
        updated++;
        continue;
      }
      const info = db.prepare(`
        INSERT INTO leads (client_id, gmail_thread_id, subject, service)
        VALUES (?, ?, ?, ?)`).run(client.id, t.id, subject, subject);
      registerThread(t.id, info.lastInsertRowid);
      absorbThreadMessages(info.lastInsertRowid, thread, myEmail);
      created++;
    }

    // 2. Refresh every tracked thread (catches client replies AND your
    //    replies sent from Gmail directly, so status stays correct).
    const tracked = db.prepare(`
      SELECT lt.thread_id, lt.lead_id FROM lead_threads lt
      JOIN leads l ON l.id = lt.lead_id
      ORDER BY l.updated_at DESC LIMIT 150`).all();
    for (const row of tracked) {
      try {
        const thread = await apiGet(`/threads/${row.thread_id}?format=full`);
        if (absorbThreadMessages(row.lead_id, thread, myEmail)) updated++;
      } catch { /* thread deleted in Gmail — leave the lead as-is */ }
    }

    setSetting('gmail_last_sync', new Date().toISOString());
    setSetting('gmail_last_sync_error', null);
    return { created, updated, payments };
  } catch (err) {
    setSetting('gmail_last_sync_error', String(err.message || err));
    throw err;
  } finally {
    syncing = false;
  }
}

/** Store any new messages from a thread; recompute the lead's status. */
function absorbThreadMessages(leadId, thread, myEmail) {
  let changed = false;
  for (const msg of thread.messages || []) {
    const exists = db.prepare(`SELECT id FROM messages WHERE gmail_message_id = ?`).get(msg.id);
    if (exists) continue;
    const from = parseFrom(header(msg, 'From'));
    const direction = from.email === myEmail ? 'out' : 'in';
    db.prepare(`
      INSERT INTO messages (lead_id, gmail_message_id, rfc_message_id, direction, from_email, subject, body, sent_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(leadId, msg.id, header(msg, 'Message-ID'), direction, from.email,
           header(msg, 'Subject'), extractText(msg.payload) || msg.snippet || '',
           new Date(Number(msg.internalDate)).toISOString());
    changed = true;
  }
  if (changed) recomputeStatus(leadId);
  return changed;
}

/**
 * The status flip-flop:
 *   last message from the client and you never replied  -> new_lead
 *   last message from you                               -> responded
 *   last message from the client after you replied      -> new_mail
 */
export function recomputeStatus(leadId) {
  const last = db.prepare(`
    SELECT direction FROM messages WHERE lead_id = ?
    ORDER BY sent_at DESC, id DESC LIMIT 1`).get(leadId);
  if (!last) return;
  let status;
  if (last.direction === 'out') {
    status = 'responded';
  } else {
    const everReplied = db.prepare(`
      SELECT 1 FROM messages WHERE lead_id = ? AND direction = 'out' LIMIT 1`).get(leadId);
    status = everReplied ? 'new_mail' : 'new_lead';
  }
  const lastAt = db.prepare(`
    SELECT MAX(sent_at) t FROM messages WHERE lead_id = ?`).get(leadId).t;
  db.prepare(`UPDATE leads SET status = ?, last_msg_at = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(status, lastAt, leadId);
}

// --------------------------------------------------------------- send -----
/**
 * Send a full RFC-822 message through Gmail's upload endpoint, which allows
 * large bodies (attachments up to ~35 MB) unlike the plain JSON endpoint.
 */
async function apiSendRaw(rfc822, threadId) {
  const token = await accessToken();
  const boundary = 'upload_' + crypto.randomBytes(8).toString('hex');
  const meta = JSON.stringify(threadId ? { threadId } : {});
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
                `--${boundary}\r\nContent-Type: message/rfc822\r\n\r\n`),
    Buffer.from(rfc822),
    Buffer.from(`\r\n--${boundary}--`)
  ]);
  const res = await fetch(
    'https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=multipart', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary="${boundary}"`
      },
      body: payload
    });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Gmail API error ${res.status}`);
  return data;
}

/** attachments: [{ filename, mimeType, data }] where data is plain base64. */
/** 2 -> "2nd", 21 -> "21st", 13 -> "13th", etc. */
function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
}

/** "2026-12-02" -> "December 2nd" */
function formatServiceDateLong(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.toLocaleDateString('en-US', { month: 'long' })} ${ordinal(d.getDate())}`;
}

/** "Private Chef - December 2nd", or just the activity name with no date yet. */
function buildEmailSubject(lead) {
  const activity = lead.service || lead.subject || 'Aqualux booking';
  const dateLabel = formatServiceDateLong(lead.service_date);
  return dateLabel ? `${activity} - ${dateLabel}` : activity;
}

export async function sendReply(lead, client, bodyText, attachments = []) {
  const myEmail = getSetting('gmail_email');
  if (!myEmail) throw new Error('Gmail is not connected');

  const lastIn = db.prepare(`
    SELECT * FROM messages WHERE lead_id = ? AND direction = 'in'
    ORDER BY sent_at DESC, id DESC LIMIT 1`).get(lead.id);

  let subject = buildEmailSubject(lead);
  if (lastIn && !/^re:/i.test(subject)) subject = 'Re: ' + subject;

  const headers = [
    `From: ${myEmail}`,
    `To: ${client.email}`,
    `Subject: ${subject.replace(/[\r\n]/g, ' ')}`,
    'MIME-Version: 1.0'
  ];
  // Only reference the previous email when replying inside a real Gmail
  // thread. Form leads have no client thread yet — the first reply starts one.
  if (lead.gmail_thread_id && lastIn?.rfc_message_id) {
    headers.push(`In-Reply-To: ${lastIn.rfc_message_id}`, `References: ${lastIn.rfc_message_id}`);
  }

  const fold = (s) => s.replace(/.{76}/g, '$&\r\n');
  const sigImage = getSetting('signature_image'); // { data, mimeType, filename }

  // Build the message content: with a signature image the email is HTML with
  // the image embedded inline; otherwise plain text with the text signature.
  let core; // { type: content-type header value, extra: [], content: string }
  if (sigImage?.data) {
    const escHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html =
      `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;white-space:pre-wrap">${escHtml(bodyText)}</div>` +
      `<br><img src="cid:aqualuxsig" alt="Aqua Lux Aruba — Concierge & Guest services" style="max-width:420px;height:auto">`;
    const rel = 'related_' + crypto.randomBytes(8).toString('hex');
    core = {
      type: `multipart/related; boundary="${rel}"`,
      extra: [],
      content:
        `--${rel}\r\nContent-Type: text/html; charset="UTF-8"\r\n` +
        `Content-Transfer-Encoding: base64\r\n\r\n${fold(Buffer.from(html, 'utf8').toString('base64'))}\r\n` +
        `--${rel}\r\nContent-Type: ${sigImage.mimeType}\r\n` +
        `Content-Transfer-Encoding: base64\r\n` +
        `Content-ID: <aqualuxsig>\r\n` +
        `Content-Disposition: inline; filename="signature"\r\n\r\n${fold(sigImage.data)}\r\n--${rel}--\r\n`
    };
  } else {
    // Append the text signature unless the message already contains it —
    // e.g. inserted with the "Footer" button and possibly edited.
    const signature = getSetting('email_signature', DEFAULT_SIGNATURE) || '';
    const sigLines = signature.split('\n').map((l) => l.trim()).filter((l) => l.length > 3);
    const alreadyHasSig = sigLines.some((l) => bodyText.includes(l));
    const fullBody = signature.trim() && !alreadyHasSig ? `${bodyText}\n\n${signature}` : bodyText;
    core = {
      type: 'text/plain; charset="UTF-8"',
      extra: ['Content-Transfer-Encoding: base64'],
      content: fold(Buffer.from(fullBody, 'utf8').toString('base64'))
    };
  }

  let rfc822;
  if (attachments.length) {
    const boundary = 'aqualux_' + crypto.randomBytes(8).toString('hex');
    headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    const parts = [
      `--${boundary}\r\nContent-Type: ${core.type}\r\n${core.extra.map((h) => h + '\r\n').join('')}\r\n${core.content}\r\n`
    ];
    for (const a of attachments) {
      parts.push(
        `--${boundary}\r\n` +
        `Content-Type: ${a.mimeType}; name="${a.filename}"\r\n` +
        `Content-Transfer-Encoding: base64\r\n` +
        `Content-Disposition: attachment; filename="${a.filename}"\r\n\r\n` +
        `${fold(a.data)}\r\n`
      );
    }
    parts.push(`--${boundary}--`);
    rfc822 = headers.join('\r\n') + '\r\n\r\n' + parts.join('');
  } else {
    headers.push(`Content-Type: ${core.type}`, ...core.extra);
    rfc822 = headers.join('\r\n') + '\r\n\r\n' + core.content;
  }

  const sent = await apiSendRaw(rfc822, lead.gmail_thread_id || undefined);

  // Leads created manually or from the website form get a thread on first reply
  if (!lead.gmail_thread_id && sent.threadId) {
    db.prepare(`UPDATE OR IGNORE leads SET gmail_thread_id = ? WHERE id = ?`).run(sent.threadId, lead.id);
  }
  if (sent.threadId) registerThread(sent.threadId, lead.id);
  const storedBody = bodyText +
    (attachments.length ? `\n\n📎 ${attachments.map((a) => a.filename).join(', ')}` : '');
  db.prepare(`
    INSERT OR IGNORE INTO messages (lead_id, gmail_message_id, direction, from_email, subject, body, sent_at)
    VALUES (?, ?, 'out', ?, ?, ?, ?)`)
    .run(lead.id, sent.id || null, myEmail, subject, storedBody, new Date().toISOString());
  recomputeStatus(lead.id);
  touchLead(lead.id);
  return sent;
}

// ---------------------------------------------------------- calendar sync --
/**
 * One-way sync: confirmed bookings -> a yellow all-day event on the
 * connected Google Calendar. The CRM's own Calendar tab never reads
 * anything back from Google — it only ever shows the CRM's own confirmed
 * leads, exactly as before this existed.
 */
async function calApiRequest(path, options = {}) {
  const token = await accessToken();
  const res = await fetch(CAL_API + path, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  if (res.status === 204) return {};
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Google's per-field validation errors live in error.errors[]; surface
    // that detail (e.g. which field/reason) instead of just the generic
    // top-level message, so a bad request is diagnosable from the message alone.
    const detail = data.error?.errors?.map((e) => `${e.reason}: ${e.message}`).join('; ');
    throw new Error(detail || data.error?.message || `Google Calendar API error ${res.status}`);
  }
  return data;
}

// Aruba is fixed at UTC-4 year-round (no DST). Using an explicit offset in
// dateTime (rather than relying on Google recognizing an IANA zone name) is
// unambiguous and can't be rejected as an unrecognized timezone string.
const ARUBA_UTC_OFFSET = '-04:00';
const ARUBA_TZ = 'America/Aruba'; // supplementary metadata only
// No explicit end time is collected, so timed events get a default length.
const DEFAULT_EVENT_MINUTES = 120;

/** "14:30" + 120 -> { date: same-or-next-day, time: "16:30" }, handling midnight rollover. */
function addMinutesToTime(dateStr, timeStr, minutes) {
  const [h, m] = timeStr.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const dayOffset = Math.floor(total / 1440);
  const wrapped = ((total % 1440) + 1440) % 1440;
  const date = new Date(dateStr + 'T00:00:00');
  date.setDate(date.getDate() + dayOffset);
  const hh = String(Math.floor(wrapped / 60)).padStart(2, '0');
  const mm = String(wrapped % 60).padStart(2, '0');
  return { date: date.toISOString().slice(0, 10), time: `${hh}:${mm}` };
}

function calendarEventBody(lead) {
  const lines = [
    lead.client_email ? `Client: ${lead.client_name} <${lead.client_email}>` : `Client: ${lead.client_name}`,
    lead.client_phone ? `Phone: ${lead.client_phone}` : null,
    lead.party_size ? `Party size: ${lead.party_size}` : null,
    `Paid: ${lead.paid ? 'Yes' : 'No'}`,
    lead.notes ? `Notes: ${lead.notes}` : null
  ].filter(Boolean);
  const summary = `${lead.service || 'Booking'} — ${lead.client_name}`;
  const description = lines.join('\n');

  if (lead.service_time) {
    const endPoint = addMinutesToTime(lead.service_date, lead.service_time, DEFAULT_EVENT_MINUTES);
    return {
      summary, description, colorId: CAL_COLOR_ID,
      start: { dateTime: `${lead.service_date}T${lead.service_time}:00${ARUBA_UTC_OFFSET}`, timeZone: ARUBA_TZ },
      end: { dateTime: `${endPoint.date}T${endPoint.time}:00${ARUBA_UTC_OFFSET}`, timeZone: ARUBA_TZ }
    };
  }

  // No specific time -> all-day event (next-day exclusive end date, per the API).
  const end = new Date(lead.service_date + 'T00:00:00');
  end.setDate(end.getDate() + 1);
  return {
    summary, description, colorId: CAL_COLOR_ID,
    start: { date: lead.service_date },
    end: { date: end.toISOString().slice(0, 10) }
  };
}

/** Create or update the Google Calendar event for a confirmed, dated lead. */
export async function upsertCalendarEvent(lead) {
  if (!hasCalendarScope()) throw new Error('Google Calendar isn\'t connected — reconnect Gmail in Settings to grant calendar access');
  const body = calendarEventBody(lead);
  if (lead.gcal_event_id) {
    try {
      const updated = await calApiRequest(`/calendars/primary/events/${lead.gcal_event_id}`, {
        method: 'PATCH', body: JSON.stringify(body)
      });
      return updated.id;
    } catch (err) {
      // event was deleted on the Google Calendar side — recreate it below
      if (!/not found|404/i.test(err.message)) throw err;
    }
  }
  const created = await calApiRequest('/calendars/primary/events', { method: 'POST', body: JSON.stringify(body) });
  return created.id;
}

/** Remove a lead's event from Google Calendar (booking un-confirmed/deleted). */
export async function deleteCalendarEvent(eventId) {
  if (!eventId || !hasCalendarScope()) return;
  try {
    await calApiRequest(`/calendars/primary/events/${eventId}`, { method: 'DELETE' });
  } catch (err) {
    if (!/not found|404|410/i.test(err.message)) throw err;
  }
}

// ------------------------------------------------------------ polling -----
export function startPolling(intervalMs = 3 * 60 * 1000) {
  const tick = () => {
    if (!isConnected()) return;
    syncNow().catch((err) => console.error('[gmail sync]', err.message));
  };
  setTimeout(tick, 5000);
  setInterval(tick, intervalMs);
}
