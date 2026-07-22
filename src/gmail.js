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
import { db, getSetting, setSetting, deleteSetting, upsertClient, touchLead } from './db.js';

const SCOPES = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

const SKIP_SENDERS = /no-?reply|donotreply|mailer-daemon|notification|newsletter/i;

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

// --------------------------------------------------------------- sync -----
let syncing = false;

export async function syncNow() {
  if (syncing) return { skipped: true };
  if (!isConnected()) return { skipped: true };
  syncing = true;
  try {
    const myEmail = (getSetting('gmail_email') || '').toLowerCase();
    const since = getSetting('gmail_sync_since') || Math.floor(Date.now() / 1000);
    let created = 0, updated = 0;

    // 1. New inbox threads -> new leads
    const list = await apiGet(`/threads?q=${encodeURIComponent(`in:inbox after:${since}`)}&maxResults=50`);
    for (const t of list.threads || []) {
      const exists = db.prepare(`SELECT id FROM leads WHERE gmail_thread_id = ?`).get(t.id);
      if (exists) continue;
      const thread = await apiGet(`/threads/${t.id}?format=full`);
      const first = thread.messages?.[0];
      if (!first) continue;
      const from = parseFrom(header(first, 'From'));
      if (!from.email || from.email === myEmail || SKIP_SENDERS.test(from.email)) continue;
      const client = upsertClient({ name: from.name, email: from.email });
      const subject = header(first, 'Subject') || '(no subject)';
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
    return { created, updated };
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
  if (lastIn?.rfc_message_id) {
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
