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

const SCOPES = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

// Bulk/marketing sender addresses — never real people.
const SKIP_SENDERS = /no[-._]?reply|donotreply|mailer-daemon|notifications?@|newsletter|marketing@|promo(?:tions?)?@|offers?@|deals@|@e?mail\.|@e\./i;
// Gmail's own categorization: promotions/social/spam are not leads.
const SKIP_LABELS = new Set(['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'SPAM']);
// Payment services whose notification emails go to the Payments tab.
const PAYMENT_SENDERS = /venmo\.com|zelle|chase\.com|paypal\.com|cash\.app|square(?:up)?\.com|wellsfargo|bankofamerica|citi(?:bank)?\.com|wise\.com|revolut\.com/i;

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

export function connectionInfo() {
  const creds = getCredentials();
  return {
    has_credentials: !!(creds.client_id && creds.client_secret),
    connected: isConnected(),
    email: getSetting('gmail_email', null),
    last_sync: getSetting('gmail_last_sync', null),
    last_sync_error: getSetting('gmail_last_sync_error', null)
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

  const profile = await apiGet('/profile');
  setSetting('gmail_email', profile.emailAddress);
  // Only emails that arrive AFTER connecting become leads (avoids importing
  // the whole mailbox). "Import last 7 days" in Settings can look further back.
  if (!getSetting('gmail_sync_since')) setSetting('gmail_sync_since', Math.floor(Date.now() / 1000));
  return profile.emailAddress;
}

export function disconnect() {
  for (const k of ['gmail_tokens', 'gmail_email', 'gmail_last_sync', 'gmail_last_sync_error', 'gmail_sync_since']) {
    deleteSetting(k);
  }
}

async function accessToken() {
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
  const isLabel = (l) => /^(.{1,60}?)\s*:\s*$/.test(l);
  for (let i = 0; i < lines.length; i++) {
    let label = null, value = '';
    const block = lines[i].match(/^(.{1,60}?)\s*:\s*$/);
    const inline = lines[i].match(/^(.{1,60}?):\s+(.+)$/);
    if (block) {
      label = block[1];
      const vals = [];
      let j = i + 1;
      while (j < lines.length && !isLabel(lines[j]) && !/^(.{1,60}?):\s+.+$/.test(lines[j])) {
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

function createLeadFromForm(form, msg) {
  const client = upsertClient({ name: form.name, email: form.email, phone: form.phone });
  const info = db.prepare(`
    INSERT INTO leads (client_id, subject, service, service_date, party_size, source)
    VALUES (?, ?, ?, ?, ?, 'website_form')`)
    .run(client.id, form.formName, form.service, form.serviceDate, form.partySize);
  db.prepare(`
    INSERT INTO messages (lead_id, gmail_message_id, direction, from_email, subject, body, sent_at)
    VALUES (?, ?, 'in', ?, ?, ?, ?)`)
    .run(info.lastInsertRowid, msg.id, form.email, form.formName,
         `Website form submission — ${form.formName}\n\n${form.details}`,
         new Date(Number(msg.internalDate)).toISOString());
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

    // 1. New inbox threads -> new leads
    const list = await apiGet(`/threads?q=${encodeURIComponent(`in:inbox after:${since}`)}&maxResults=50`);
    for (const t of list.threads || []) {
      if (db.prepare(`SELECT id FROM leads WHERE gmail_thread_id = ?`).get(t.id)) continue;
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
        createLeadFromForm(form, first);
        markThreadProcessed(t.id);
        created++;
        continue;
      }

      // Payment notification (Venmo / Zelle / Chase / …) -> Payments tab.
      const pay = parsePaymentNotification(from, subject, bodyText);
      if (pay) {
        recordPayment(pay, first, subject, bodyText);
        markThreadProcessed(t.id);
        payments++;
        continue;
      }

      // Bulk / promotional mail is not a lead.
      if (isBulkMail(first, from)) { markThreadProcessed(t.id); continue; }

      const client = upsertClient({ name: from.name, email: from.email });
      const info = db.prepare(`
        INSERT INTO leads (client_id, gmail_thread_id, subject, service)
        VALUES (?, ?, ?, ?)`).run(client.id, t.id, subject, subject);
      absorbThreadMessages(info.lastInsertRowid, thread, myEmail);
      created++;
    }

    // 2. Refresh tracked threads (catches client replies AND your replies
    //    sent from Gmail directly, so status stays correct either way).
    const tracked = db.prepare(`
      SELECT id, gmail_thread_id FROM leads
      WHERE gmail_thread_id IS NOT NULL
      ORDER BY updated_at DESC LIMIT 100`).all();
    for (const lead of tracked) {
      try {
        const thread = await apiGet(`/threads/${lead.gmail_thread_id}?format=full`);
        if (absorbThreadMessages(lead.id, thread, myEmail)) updated++;
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
export async function sendReply(lead, client, bodyText) {
  const myEmail = getSetting('gmail_email');
  if (!myEmail) throw new Error('Gmail is not connected');

  const lastIn = db.prepare(`
    SELECT * FROM messages WHERE lead_id = ? AND direction = 'in'
    ORDER BY sent_at DESC, id DESC LIMIT 1`).get(lead.id);

  let subject = lead.subject || lead.service || 'Your Aqualux request';
  if (lastIn && !/^re:/i.test(subject)) subject = 'Re: ' + subject;

  const headers = [
    `From: ${myEmail}`,
    `To: ${client.email}`,
    `Subject: ${subject.replace(/[\r\n]/g, ' ')}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit'
  ];
  // Only reference the previous email when replying inside a real Gmail
  // thread. Form leads have no client thread yet — the first reply starts one.
  if (lead.gmail_thread_id && lastIn?.rfc_message_id) {
    headers.push(`In-Reply-To: ${lastIn.rfc_message_id}`, `References: ${lastIn.rfc_message_id}`);
  }
  const raw = Buffer.from(headers.join('\r\n') + '\r\n\r\n' + bodyText)
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const payload = { raw };
  if (lead.gmail_thread_id) payload.threadId = lead.gmail_thread_id;
  const sent = await apiPost('/messages/send', payload);

  // Leads created manually or from the website form get a thread on first reply
  if (!lead.gmail_thread_id && sent.threadId) {
    db.prepare(`UPDATE leads SET gmail_thread_id = ? WHERE id = ?`).run(sent.threadId, lead.id);
  }
  db.prepare(`
    INSERT INTO messages (lead_id, gmail_message_id, direction, from_email, subject, body, sent_at)
    VALUES (?, ?, 'out', ?, ?, ?, ?)`)
    .run(lead.id, sent.id || null, myEmail, subject, bodyText, new Date().toISOString());
  recomputeStatus(lead.id);
  touchLead(lead.id);
  return sent;
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
