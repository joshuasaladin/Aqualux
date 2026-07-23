/* Aqualux Concierge CRM — frontend */

const $ = (sel) => document.querySelector(sel);

const STATUS_LABELS = { new_lead: 'New Lead', responded: 'Responded', new_mail: 'New Mail' };

let token = localStorage.getItem('aqualux_token') || '';
let gmailStatus = null;

async function api(path, options = {}) {
  const res = await fetch('/api' + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(options.headers || {})
    }
  });
  if (res.status === 401 && path !== '/login') {
    showLogin();
    throw new Error('Unauthorized');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const money = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

function timeAgo(iso) {
  if (!iso) return '';
  const then = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  const mins = Math.floor((Date.now() - then.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return then.toLocaleDateString();
}

function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function svcDateBadge(dateStr) {
  if (!dateStr) return `<span class="svc-date none">no date</span>`;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + 'T00:00:00');
  const days = Math.round((d - today) / 86400000);
  const label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const rel = days === 0 ? 'today' : days === 1 ? 'tomorrow' : days > 1 ? `in ${days}d` : `${-days}d ago`;
  return `<span class="svc-date ${days >= 0 && days <= 3 ? 'soon' : ''}">📅 ${label} · ${rel}</span>`;
}

const statusBadge = (s) => `<span class="badge st-${s}">${STATUS_LABELS[s] || s}</span>`;
const payBadge = (paid) => `<span class="badge pay-${paid ? 'paid' : 'unpaid'}">${paid ? 'Paid' : 'Unpaid'}</span>`;
const bookBadge = (b) => `<span class="badge bk-${b ? 'yes' : 'no'}">${b ? 'Confirmed ✓' : 'Not confirmed'}</span>`;

/* ------------------------------------------------------------- login ---- */
function showLogin() {
  $('#app').classList.add('hidden');
  $('#login-screen').classList.remove('hidden');
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const data = await api('/login', {
      method: 'POST',
      body: JSON.stringify({ password: $('#login-password').value })
    });
    token = data.token;
    localStorage.setItem('aqualux_token', token);
    $('#login-screen').classList.add('hidden');
    $('#app').classList.remove('hidden');
    boot();
  } catch {
    $('#login-error').textContent = 'Wrong password — try again.';
  }
});

/* -------------------------------------------------------------- views --- */
let currentView = 'leads';

function showView(name) {
  currentView = name;
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  $('#view-' + name).classList.remove('hidden');
  document.querySelectorAll('.nav-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === name));
  if (name === 'leads') loadLeads();
  if (name === 'confirmed') loadConfirmed();
  if (name === 'calendar') renderCalendar();
  if (name === 'payments') loadPayments();
  if (name === 'clients') loadClients();
  if (name === 'settings') loadSettings();
}

document.querySelectorAll('.nav-btn').forEach((b) =>
  b.addEventListener('click', () => showView(b.dataset.view)));

function refreshCurrentView() { showView(currentView); }

/* -------------------------------------------------------------- leads --- */
function leadCard(l) {
  const done = l.paid && l.booking_confirmed;
  const total = l.services_total || l.price || 0;
  const owed = l.services_total ? l.services_owed : 0;
  return `
  <div class="card ${done ? 'done' : ''}" data-lead="${l.id}">
    <div class="card-top">
      <span class="card-title">${esc(l.client_name)}</span>
      ${statusBadge(l.status)} ${payBadge(l.paid)} ${bookBadge(l.booking_confirmed)}
      <span class="card-right">
        ${total ? `<span class="card-amount">${money(total)}${owed > 0 && owed < total ?
          ` <span class="owed">(${money(owed)} due)</span>` : ''}</span>` : ''}
        ${svcDateBadge(l.service_date)}
      </span>
    </div>
    <div class="card-sub">✉️ ${esc(l.client_email)}${l.party_size ? ` · 👥 ${l.party_size}` : ''} · ${esc(l.service || l.subject || '—')}
      ${l.last_msg_at ? ` · last email ${timeAgo(l.last_msg_at)}` : ''}</div>
  </div>`;
}

function bindLeadCards(container) {
  document.querySelectorAll(container + ' [data-lead]').forEach((el) =>
    el.addEventListener('click', () => openLead(el.dataset.lead)));
}

let leadTimer;
async function loadLeads() {
  const [summary, rows] = await Promise.all([
    api('/leads/summary'),
    api('/leads' + ($('#lead-search').value ? '?q=' + encodeURIComponent($('#lead-search').value) : ''))
  ]);
  $('#stat-grid').innerHTML = `
    <div class="stat"><div class="num green">${summary.needs_reply || 0}</div><div class="label">Waiting on your reply</div></div>
    <div class="stat"><div class="num amber">${summary.confirmed_unpaid || 0}</div><div class="label">Confirmed but unpaid</div></div>
    <div class="stat"><div class="num">${summary.upcoming || 0}</div><div class="label">Upcoming bookings</div></div>
    <div class="stat"><div class="num">${summary.total || 0}</div><div class="label">Total leads</div></div>`;
  $('#lead-list').innerHTML = rows.length
    ? rows.map(leadCard).join('')
    : `<div class="empty">No leads yet. Connect Gmail in Settings — new emails will appear here automatically.</div>`;
  bindLeadCards('#lead-list');
}

$('#lead-search').addEventListener('input', () => {
  clearTimeout(leadTimer); leadTimer = setTimeout(loadLeads, 250);
});

$('#btn-sync').addEventListener('click', async () => {
  const btn = $('#btn-sync');
  btn.disabled = true; btn.textContent = '⟳ Syncing…';
  try {
    await api('/gmail/sync', { method: 'POST' });
    await loadLeads();
  } catch (err) {
    alert('Sync failed: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = '⟳ Sync Gmail';
  }
});

/* ---------------------------------------------------------- confirmed --- */
async function loadConfirmed() {
  const rows = await api('/leads?tab=confirmed');
  $('#confirmed-list').innerHTML = rows.length
    ? rows.map(leadCard).join('')
    : `<div class="empty">No confirmed bookings yet. Open a lead and switch on “Booking confirmed”.</div>`;
  bindLeadCards('#confirmed-list');
}

/* ------------------------------------------------------------ calendar --- */
let calYear, calMonth; // calMonth: 0-11

async function renderCalendar() {
  if (calYear === undefined) {
    const now = new Date();
    calYear = now.getFullYear(); calMonth = now.getMonth();
  }
  const first = new Date(calYear, calMonth, 1);
  const last = new Date(calYear, calMonth + 1, 0);
  const pad = (n) => String(n).padStart(2, '0');
  const from = `${calYear}-${pad(calMonth + 1)}-01`;
  const to = `${calYear}-${pad(calMonth + 1)}-${pad(last.getDate())}`;
  const events = await api(`/calendar?from=${from}&to=${to}`);
  const byDay = {};
  for (const e of events) (byDay[e.service_date] ||= []).push(e);

  $('#cal-title').textContent = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const todayStr = new Date().toISOString().slice(0, 10);
  let cells = '';
  for (let i = 0; i < first.getDay(); i++) cells += `<div class="cal-cell other"></div>`;
  for (let d = 1; d <= last.getDate(); d++) {
    const dateStr = `${calYear}-${pad(calMonth + 1)}-${pad(d)}`;
    const evts = (byDay[dateStr] || []).map((e) => `
      <div class="cal-evt ${e.paid ? '' : 'unpaid'}" data-lead="${e.id}"
           title="${esc(e.client_name)} — ${esc(e.service)}${e.paid ? '' : ' (unpaid)'}">
        ${esc(e.client_name.split(' ')[0])}: ${esc(e.service)}
      </div>`).join('');
    cells += `<div class="cal-cell ${dateStr === todayStr ? 'today' : ''}"><div class="d">${d}</div>${evts}</div>`;
  }
  $('#cal-grid').innerHTML = cells;
  bindLeadCards('#cal-grid');
}

$('#cal-prev').addEventListener('click', () => {
  calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; }
  renderCalendar();
});
$('#cal-next').addEventListener('click', () => {
  calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; }
  renderCalendar();
});

/* ----------------------------------------------------------- payments --- */
const SOURCE_ICONS = { Venmo: '💙', Zelle: '💜', Chase: '🏦', PayPal: '🅿️', 'Cash App': '💵', Wise: '🌍', Bank: '🏦' };

async function loadPayments() {
  const { totals, payments } = await api('/payments');
  $('#pay-stats').innerHTML = `
    <div class="stat"><div class="num green">${money(totals.this_week)}</div><div class="label">Last 7 days</div></div>
    <div class="stat"><div class="num green">${money(totals.this_month)}</div><div class="label">This month</div></div>
    <div class="stat"><div class="num">${money(totals.all_time)}</div><div class="label">All time</div></div>
    <div class="stat"><div class="num">${payments.length}</div><div class="label">Payments</div></div>`;
  $('#payment-list').innerHTML = payments.length
    ? payments.map((p) => `
      <div class="card pay-card" data-pay="${p.id}">
        <div class="card-top">
          <span class="card-title">${SOURCE_ICONS[p.source] || '💳'} ${esc(p.payer || p.source)}</span>
          <span class="badge pay-paid">${esc(p.source)}</span>
          <span class="card-right">
            <span class="card-amount pay-amount">+${money(p.amount)}</span>
            <span class="card-sub">${timeAgo(p.received_at)}</span>
            <button class="btn btn-sm btn-danger pay-del" title="Remove">×</button>
          </span>
        </div>
        <div class="card-sub">${esc(p.subject)}</div>
      </div>`).join('')
    : `<div class="empty">No payments yet. When Venmo, Zelle or your bank emails you a “you received money” notification, it appears here.</div>`;
  document.querySelectorAll('#payment-list .pay-del').forEach((btn) =>
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.closest('[data-pay]').dataset.pay;
      if (!confirm('Remove this payment from the list?')) return;
      await api('/payments/' + id, { method: 'DELETE' });
      loadPayments();
    }));
}

/* ------------------------------------------------------------ clients --- */
async function loadClients() {
  const q = $('#client-search').value;
  const rows = await api('/clients' + (q ? '?q=' + encodeURIComponent(q) : ''));
  $('#client-list').innerHTML = rows.length
    ? rows.map((c) => `
      <div class="card" data-client="${c.id}">
        <div class="card-top">
          <span class="card-title">${esc(c.name)}</span>
          <span class="card-right">
            <span class="card-amount">${money(c.total_paid)} paid</span>
            <span class="card-sub">${c.lead_count} lead${c.lead_count === 1 ? '' : 's'}</span>
          </span>
        </div>
        <div class="card-sub">✉️ ${esc(c.email)}${c.phone ? ' · 📞 ' + esc(c.phone) : ''}</div>
      </div>`).join('')
    : `<div class="empty">No clients yet.</div>`;
  document.querySelectorAll('#client-list [data-client]').forEach((el) =>
    el.addEventListener('click', () => openClient(el.dataset.client)));
}

let clientTimer;
$('#client-search').addEventListener('input', () => {
  clearTimeout(clientTimer); clientTimer = setTimeout(loadClients, 250);
});

/* --------------------------------------------------------- lead drawer --- */
function closeDrawer() {
  $('#drawer').classList.add('hidden');
  $('#drawer-backdrop').classList.add('hidden');
}
$('#drawer-backdrop').addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

async function openLead(id) {
  const l = await api('/leads/' + id);
  const canEmail = gmailStatus?.connected;
  $('#drawer-content').innerHTML = `
  <div class="drawer-head">
    <button class="close" id="drawer-close">×</button>
    <h2>${esc(l.client_name)} ${statusBadge(l.status)}</h2>
    <div class="client-line">
      <a href="mailto:${esc(l.client_email)}">${esc(l.client_email)}</a>
      ${l.client_phone ? ' · ' + esc(l.client_phone) : ''}
      ${l.subject ? ' · ' + esc(l.subject) : ''}
    </div>
  </div>
  <div class="drawer-body">

    <div class="panel">
      <h3>Booking</h3>
      <div class="form-row">
        <label>Service requested<input id="d-service" value="${esc(l.service)}" placeholder="e.g. Yacht charter"></label>
        <label>Service date<input id="d-date" type="date" value="${l.service_date || ''}"></label>
      </div>
      <div class="form-row">
        <label>How many people<input id="d-party" type="number" min="1" step="1" value="${l.party_size || ''}" placeholder="e.g. 8"></label>
        <label>Notes<input id="d-notes" value="${esc(l.notes)}" placeholder="Internal notes…"></label>
      </div>
      <div class="toggle-row">
        <label class="toggle ${l.paid ? 'on-paid' : ''}">
          <input type="checkbox" id="d-paid" ${l.paid ? 'checked' : ''}> Paid ${l.paid ? '✓' : ''}
        </label>
        <label class="toggle ${l.booking_confirmed ? 'on-confirmed' : ''}">
          <input type="checkbox" id="d-confirmed" ${l.booking_confirmed ? 'checked' : ''}> Booking confirmed ${l.booking_confirmed ? '✓' : ''}
        </label>
      </div>
      <button class="btn btn-primary btn-sm" id="d-save">Save</button>
      <span class="send-status" id="d-save-status"></span>
    </div>

    <div class="panel">
      <h3>Services &amp; payments</h3>
      <div class="svc-head"><span>Service</span><span>Down payment</span><span></span><span>Balance</span><span></span><span></span></div>
      <div id="svc-rows"></div>
      <button class="btn btn-sm" id="svc-add">+ Add service</button>
      <div class="svc-totals" id="svc-totals"></div>
    </div>

    <div class="panel">
      <h3>Conversation</h3>
      <div class="thread">
        ${l.messages.length ? l.messages.map((m) => `
          <div class="msg ${m.direction}">
            <div class="m-meta">${m.direction === 'in' ? esc(l.client_name) : 'You'} · ${fmtDateTime(m.sent_at)}</div>
            ${esc(m.body)}
          </div>`).join('') : '<div class="empty">No emails on this lead yet.</div>'}
      </div>
      <div class="reply-box">
        <textarea id="d-reply" placeholder="Write your reply — it sends from your Gmail…" ${canEmail ? '' : 'disabled'}></textarea>
        <div class="reply-actions">
          <button class="btn btn-primary" id="d-send" ${canEmail ? '' : 'disabled'}>Send reply ✉️</button>
          <span class="send-status" id="d-send-status">${canEmail ? '' :
            'Connect Gmail in <a href="#" id="goto-settings">Settings</a> to send emails from here.'}</span>
        </div>
      </div>
    </div>

    <button class="btn btn-danger btn-sm" id="d-delete">Delete lead</button>
  </div>`;

  $('#drawer-close').addEventListener('click', closeDrawer);
  $('#goto-settings')?.addEventListener('click', (e) => {
    e.preventDefault(); closeDrawer(); showView('settings');
  });

  // --- services editor ---
  const svcRows = $('#svc-rows');
  function addServiceRow(s = {}) {
    const row = document.createElement('div');
    row.className = 'svc-row';
    row.innerHTML = `
      <input class="svc-name" placeholder="e.g. Boat day" value="${esc(s.name || '')}">
      <input class="svc-down" type="number" min="0" step="0.01" placeholder="0" value="${s.downpayment || ''}">
      <label class="mini" title="Down payment received"><input type="checkbox" class="svc-down-paid" ${s.downpayment_paid ? 'checked' : ''}>paid</label>
      <input class="svc-bal" type="number" min="0" step="0.01" placeholder="0" value="${s.balance || ''}">
      <label class="mini" title="Balance received"><input type="checkbox" class="svc-bal-paid" ${s.balance_paid ? 'checked' : ''}>paid</label>
      <button class="btn btn-sm svc-del" title="Remove">×</button>`;
    row.querySelector('.svc-del').addEventListener('click', () => { row.remove(); updateTotals(); });
    row.querySelectorAll('input').forEach((i) => i.addEventListener('input', updateTotals));
    svcRows.appendChild(row);
  }
  function collectServices() {
    return [...svcRows.querySelectorAll('.svc-row')].map((r) => ({
      name: r.querySelector('.svc-name').value.trim(),
      downpayment: Number(r.querySelector('.svc-down').value) || 0,
      downpayment_paid: r.querySelector('.svc-down-paid').checked,
      balance: Number(r.querySelector('.svc-bal').value) || 0,
      balance_paid: r.querySelector('.svc-bal-paid').checked
    })).filter((s) => s.name || s.downpayment || s.balance);
  }
  function updateTotals() {
    const list = collectServices();
    const total = list.reduce((a, s) => a + s.downpayment + s.balance, 0);
    const received = list.reduce((a, s) =>
      a + (s.downpayment_paid ? s.downpayment : 0) + (s.balance_paid ? s.balance : 0), 0);
    $('#svc-totals').innerHTML = total
      ? `Total <b>${money(total)}</b> · Received <b class="ok">${money(received)}</b> · Still due <b class="${total - received > 0 ? 'due' : 'ok'}">${money(total - received)}</b>`
      : '';
  }
  if (l.services.length) l.services.forEach(addServiceRow);
  else if (l.price > 0) addServiceRow({ name: l.service, balance: l.price });
  else addServiceRow();
  updateTotals();
  $('#svc-add').addEventListener('click', () => addServiceRow());

  $('#d-save').addEventListener('click', async () => {
    $('#d-save-status').textContent = 'Saving…';
    await api('/leads/' + id, {
      method: 'PATCH',
      body: JSON.stringify({
        service: $('#d-service').value,
        service_date: $('#d-date').value || null,
        party_size: $('#d-party').value || null,
        paid: $('#d-paid').checked,
        booking_confirmed: $('#d-confirmed').checked,
        notes: $('#d-notes').value,
        services: collectServices()
      })
    });
    openLead(id);
    refreshCurrentView();
  });

  $('#d-send').addEventListener('click', async () => {
    const body = $('#d-reply').value.trim();
    if (!body) return;
    const st = $('#d-send-status');
    $('#d-send').disabled = true;
    st.classList.remove('err');
    st.textContent = 'Sending…';
    try {
      await api(`/leads/${id}/reply`, { method: 'POST', body: JSON.stringify({ body }) });
      openLead(id);
      refreshCurrentView();
    } catch (err) {
      st.classList.add('err');
      st.textContent = 'Failed: ' + err.message;
      $('#d-send').disabled = false;
    }
  });

  $('#d-delete').addEventListener('click', async () => {
    if (!confirm('Delete this lead and its conversation from the CRM? (Emails stay in Gmail.)')) return;
    await api('/leads/' + id, { method: 'DELETE' });
    closeDrawer();
    refreshCurrentView();
  });

  $('#drawer').classList.remove('hidden');
  $('#drawer-backdrop').classList.remove('hidden');
  const thread = $('#drawer-content .thread');
  if (thread) thread.scrollTop = thread.scrollHeight;
}

/* ------------------------------------------------------- client drawer --- */
async function openClient(id) {
  const c = await api('/clients/' + id);
  $('#drawer-content').innerHTML = `
  <div class="drawer-head">
    <button class="close" id="drawer-close">×</button>
    <h2>${esc(c.name)}</h2>
    <div class="client-line">
      <a href="mailto:${esc(c.email)}">${esc(c.email)}</a>${c.phone ? ' · ' + esc(c.phone) : ''}
    </div>
  </div>
  <div class="drawer-body">
    <div class="panel">
      <h3>Notes</h3>
      <textarea id="c-notes" rows="3" placeholder="Preferences, VIP status, allergies…">${esc(c.notes)}</textarea>
      <button class="btn btn-primary btn-sm" id="c-save" style="margin-top:8px">Save notes</button>
    </div>
    <div class="panel">
      <h3>Leads (${c.leads.length})</h3>
      <div class="card-list">
        ${c.leads.length ? c.leads.map((l) => `
          <div class="card" data-lead="${l.id}">
            <div class="card-top">
              <span class="card-title">${esc(l.service || l.subject || '—')}</span>
              ${statusBadge(l.status)} ${payBadge(l.paid)} ${bookBadge(l.booking_confirmed)}
              <span class="card-right">${svcDateBadge(l.service_date)}</span>
            </div>
          </div>`).join('') : '<div class="empty">No leads yet.</div>'}
      </div>
    </div>
  </div>`;

  $('#drawer-close').addEventListener('click', closeDrawer);
  $('#c-save').addEventListener('click', async () => {
    await api('/clients/' + id, { method: 'PATCH', body: JSON.stringify({ notes: $('#c-notes').value }) });
    $('#c-save').textContent = 'Saved ✓';
    setTimeout(() => { $('#c-save').textContent = 'Save notes'; }, 1500);
  });
  document.querySelectorAll('#drawer-content [data-lead]').forEach((el) =>
    el.addEventListener('click', () => openLead(el.dataset.lead)));

  $('#drawer').classList.remove('hidden');
  $('#drawer-backdrop').classList.remove('hidden');
}

/* ------------------------------------------------------------ settings --- */
async function loadSettings() {
  const s = await api('/gmail/status');
  gmailStatus = s;
  updateGmailDot();
  const panel = $('#gmail-panel');

  if (s.connected) {
    panel.innerHTML = `
      <div class="gmail-connected">
        <span class="dot dot-on"></span>
        <span class="who">Connected as ${esc(s.email)}</span>
        <button class="btn btn-sm" id="s-sync">⟳ Sync now</button>
        <button class="btn btn-sm" id="s-import">Import last 7 days</button>
        <button class="btn btn-sm btn-danger" id="s-disconnect">Disconnect</button>
      </div>
      <p class="reply-hint">New incoming emails become leads automatically (checked every few minutes).
        Replies you send here go out through your Gmail and land in your Sent folder.
        ${s.last_sync ? `Last sync: ${fmtDateTime(s.last_sync)}.` : ''}</p>
      ${s.last_sync_error ? `<div class="sync-err">Last sync error: ${esc(s.last_sync_error)}</div>` : ''}`;
    $('#s-sync').addEventListener('click', async (e) => {
      e.target.disabled = true;
      try { await api('/gmail/sync', { method: 'POST' }); loadSettings(); }
      catch (err) { alert('Sync failed: ' + err.message); e.target.disabled = false; }
    });
    $('#s-import').addEventListener('click', async (e) => {
      if (!confirm('Import emails from the last 7 days as leads?')) return;
      e.target.disabled = true;
      try { await api('/gmail/import-recent', { method: 'POST', body: JSON.stringify({ days: 7 }) }); loadSettings(); }
      catch (err) { alert('Import failed: ' + err.message); e.target.disabled = false; }
    });
    $('#s-disconnect').addEventListener('click', async () => {
      if (!confirm('Disconnect Gmail? Existing leads stay; new emails stop syncing.')) return;
      await api('/gmail/disconnect', { method: 'POST' });
      loadSettings();
    });
    return;
  }

  panel.innerHTML = `
    <p class="reply-hint" style="margin-bottom:10px">
      One-time setup (~5 minutes) so the CRM can read incoming inquiries and send replies from your Gmail:</p>
    <ol class="steps">
      <li>Go to <a href="https://console.cloud.google.com/apis/credentials" target="_blank">Google Cloud Console → Credentials</a> (create a free project if asked).</li>
      <li>Enable the <a href="https://console.cloud.google.com/apis/library/gmail.googleapis.com" target="_blank">Gmail API</a> for the project.</li>
      <li>Configure the OAuth consent screen (External), and add <b>your own Gmail address</b> as a test user.</li>
      <li>Create an <b>OAuth client ID</b> → type <b>Web application</b> → add this exact redirect URI:<br>
        <code>${esc(s.redirect_uri)}</code></li>
      <li>Copy the Client ID and Client Secret below, then click Connect.</li>
      <li><b>To stay connected permanently:</b> in Google Console → <a href="https://console.cloud.google.com/auth/audience" target="_blank">Audience</a>,
        click <b>Publish app</b>. While the app is in "Testing" mode, Google cuts the
        connection every 7 days; published apps stay connected.</li>
    </ol>
    <div class="form-row">
      <label>Client ID<input id="s-client-id" placeholder="xxxxxxxx.apps.googleusercontent.com"></label>
      <label>Client Secret<input id="s-client-secret" type="password" placeholder="GOCSPX-…"></label>
    </div>
    <button class="btn btn-primary" id="s-connect">Connect Gmail →</button>
    <span class="send-status" id="s-status">${s.has_credentials ? 'Credentials saved — click Connect to authorize.' : ''}</span>`;

  $('#s-connect').addEventListener('click', async () => {
    const st = $('#s-status');
    try {
      const cid = $('#s-client-id').value.trim();
      const sec = $('#s-client-secret').value.trim();
      if (cid && sec) {
        await api('/gmail/credentials', { method: 'POST', body: JSON.stringify({ client_id: cid, client_secret: sec }) });
      }
      const { url } = await api('/gmail/auth-url');
      window.location.href = url;
    } catch (err) {
      st.classList.add('err');
      st.textContent = err.message;
    }
  });
}

function updateGmailDot() {
  const dot = $('#gmail-dot');
  const on = gmailStatus?.connected;
  dot.className = 'dot ' + (on ? 'dot-on' : 'dot-off');
  dot.title = on ? `Gmail connected: ${gmailStatus.email}` : 'Gmail not connected';
}

/* --------------------------------------------------- new lead modal ------ */
$('#btn-new-lead').addEventListener('click', () => {
  $('#modal-backdrop').classList.remove('hidden');
  $('#new-lead-form').reset();
  $('#new-lead-form [name=name]').focus();
});
$('#modal-cancel').addEventListener('click', () => $('#modal-backdrop').classList.add('hidden'));
$('#modal-backdrop').addEventListener('click', (e) => {
  if (e.target === $('#modal-backdrop')) $('#modal-backdrop').classList.add('hidden');
});

$('#new-lead-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target).entries());
  const created = await api('/leads', { method: 'POST', body: JSON.stringify(body) });
  $('#modal-backdrop').classList.add('hidden');
  refreshCurrentView();
  openLead(created.id);
});

/* --------------------------------------------------------------- boot --- */
async function boot() {
  gmailStatus = await api('/gmail/status').catch(() => null);
  updateGmailDot();
  showView('leads');
  // light auto-refresh so new emails appear without reloading
  setInterval(() => {
    if (currentView === 'leads' && $('#drawer').classList.contains('hidden')) loadLeads();
  }, 60000);
}

(async function init() {
  try {
    await api('/leads/summary');
    $('#app').classList.remove('hidden');
    boot();
  } catch (err) {
    if (err.message === 'Unauthorized') showLogin();
    else { $('#app').classList.remove('hidden'); boot(); }
  }
})();
