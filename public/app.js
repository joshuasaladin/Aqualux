/* Aqualux Concierge CRM — frontend */

const $ = (sel) => document.querySelector(sel);

const STATUS_LABELS = {
  new: 'New', contacted: 'Contacted', quoted: 'Quoted',
  in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled'
};
const PAYMENT_LABELS = {
  unpaid: 'Unpaid', deposit_paid: 'Deposit paid', paid: 'Paid in full', refunded: 'Refunded'
};
const ACTIVITY_LABELS = {
  note: '📝 Note', email_in: '📩 Email received', email_out: '📤 Email sent',
  call: '📞 Call', status: '🔁 Status change', payment: '💳 Payment', created: '✨ Created'
};

let token = localStorage.getItem('aqualux_token') || '';

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

function money(amount, currency = 'USD') {
  const n = Number(amount) || 0;
  return `${currency === 'AWG' ? 'ƒ' : currency === 'EUR' ? '€' : '$'}${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function timeAgo(iso) {
  if (!iso) return '';
  const then = new Date(iso.replace(' ', 'T') + (iso.includes('Z') ? '' : 'Z'));
  const mins = Math.floor((Date.now() - then.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return then.toLocaleDateString();
}

function fullDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + (iso.includes('Z') ? '' : 'Z'));
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const statusBadge = (s) => `<span class="badge st-${s}">${STATUS_LABELS[s] || s}</span>`;
const payBadge = (p) => `<span class="badge pay-${p}">${PAYMENT_LABELS[p] || p}</span>`;

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
    showView('dashboard');
  } catch {
    $('#login-error').textContent = 'Wrong password — try again.';
  }
});

/* -------------------------------------------------------------- views --- */
let currentView = 'dashboard';

function showView(name) {
  currentView = name;
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  $('#view-' + name).classList.remove('hidden');
  document.querySelectorAll('.nav-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === name));
  if (name === 'dashboard') loadDashboard();
  if (name === 'requests') loadRequests();
  if (name === 'clients') loadClients();
}

document.querySelectorAll('.nav-btn').forEach((b) =>
  b.addEventListener('click', () => showView(b.dataset.view)));

/* ---------------------------------------------------------- dashboard --- */
async function loadDashboard() {
  const d = await api('/dashboard');
  $('#stat-grid').innerHTML = `
    <div class="stat"><div class="num">${d.open}</div><div class="label">Open requests</div></div>
    <div class="stat"><div class="num">${d.by_status.new || 0}</div><div class="label">New — need reply</div></div>
    <div class="stat"><div class="num amber">${d.awaiting_payment}</div><div class="label">Awaiting payment</div></div>
    <div class="stat"><div class="num green">${money(d.collected)}</div><div class="label">Collected</div></div>
    <div class="stat"><div class="num gold">${money(d.outstanding)}</div><div class="label">Outstanding</div></div>
    <div class="stat"><div class="num">${d.clients}</div><div class="label">Clients</div></div>`;
  $('#dash-recent').innerHTML = d.recent.length
    ? d.recent.map(requestCard).join('')
    : `<div class="empty">No requests yet. Click “+ New request” to add your first one.</div>`;
  bindCards('#dash-recent');
}

/* ----------------------------------------------------------- requests --- */
function requestCard(r) {
  return `
  <div class="card" data-request="${r.id}">
    <div class="card-top">
      <span class="card-title">${esc(r.client_name)}</span>
      ${statusBadge(r.status)} ${payBadge(r.payment_status)}
      <span class="card-right">
        ${r.quoted_amount ? `<span class="card-amount">${money(r.quoted_amount, r.currency)}</span>` : ''}
        <span class="card-sub">${timeAgo(r.updated_at)}</span>
      </span>
    </div>
    <div class="card-sub">✉️ ${esc(r.client_email)} · ${esc(r.service)}</div>
  </div>`;
}

function bindCards(container) {
  document.querySelectorAll(container + ' [data-request]').forEach((el) =>
    el.addEventListener('click', () => openRequest(el.dataset.request)));
  document.querySelectorAll(container + ' [data-client]').forEach((el) =>
    el.addEventListener('click', () => openClient(el.dataset.client)));
}

let reqTimer;
async function loadRequests() {
  const params = new URLSearchParams();
  if ($('#req-search').value) params.set('q', $('#req-search').value);
  if ($('#req-status').value) params.set('status', $('#req-status').value);
  if ($('#req-payment').value) params.set('payment_status', $('#req-payment').value);
  const rows = await api('/requests?' + params);
  $('#req-list').innerHTML = rows.length
    ? rows.map(requestCard).join('')
    : `<div class="empty">No requests match.</div>`;
  bindCards('#req-list');
}

$('#req-search').addEventListener('input', () => {
  clearTimeout(reqTimer); reqTimer = setTimeout(loadRequests, 250);
});
$('#req-status').addEventListener('change', loadRequests);
$('#req-payment').addEventListener('change', loadRequests);

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
            <span class="card-sub">${c.request_count} request${c.request_count === 1 ? '' : 's'}</span>
          </span>
        </div>
        <div class="card-sub">✉️ ${esc(c.email)}${c.phone ? ' · 📞 ' + esc(c.phone) : ''}</div>
      </div>`).join('')
    : `<div class="empty">No clients yet.</div>`;
  bindCards('#client-list');
}

let clientTimer;
$('#client-search').addEventListener('input', () => {
  clearTimeout(clientTimer); clientTimer = setTimeout(loadClients, 250);
});

/* ------------------------------------------------------ request drawer --- */
function closeDrawer() {
  $('#drawer').classList.add('hidden');
  $('#drawer-backdrop').classList.add('hidden');
}
$('#drawer-backdrop').addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

async function openRequest(id) {
  const r = await api('/requests/' + id);
  $('#drawer-content').innerHTML = `
  <div class="drawer-head">
    <button class="close" id="drawer-close">×</button>
    <h2>${esc(r.service)}</h2>
    <div class="client-line">
      ${esc(r.client_name)} · <a href="mailto:${esc(r.client_email)}">${esc(r.client_email)}</a>
      ${r.client_phone ? ' · ' + esc(r.client_phone) : ''}
    </div>
  </div>
  <div class="drawer-body">
    <div class="panel">
      <h3>Status &amp; payment</h3>
      <div class="form-row">
        <label>Status
          <select id="d-status">${Object.entries(STATUS_LABELS).map(([v, l]) =>
            `<option value="${v}" ${v === r.status ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </label>
        <label>Payment
          <select id="d-payment">${Object.entries(PAYMENT_LABELS).map(([v, l]) =>
            `<option value="${v}" ${v === r.payment_status ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </label>
      </div>
      <div class="form-row">
        <label>Quoted (${esc(r.currency)})
          <input id="d-quoted" type="number" min="0" step="0.01" value="${r.quoted_amount || ''}" placeholder="0.00">
        </label>
        <label>Received (${esc(r.currency)})
          <input id="d-paid" type="number" min="0" step="0.01" value="${r.paid_amount || ''}" placeholder="0.00">
        </label>
      </div>
      <button class="btn btn-primary btn-sm" id="d-save">Save changes</button>
    </div>

    <div class="panel">
      <h3>Request details</h3>
      <div class="kv"><span class="k">Received</span><span>${fullDate(r.created_at)}</span></div>
      <div class="kv"><span class="k">Last update</span><span>${fullDate(r.updated_at)}</span></div>
      ${r.details ? `<p style="margin-top:8px; font-size:.9rem; white-space:pre-wrap">${esc(r.details)}</p>` : ''}
    </div>

    <div class="panel">
      <h3>Add to timeline</h3>
      <form class="activity-form" id="d-activity-form">
        <div class="row">
          <select id="d-activity-type">
            <option value="email_out">📤 Email sent</option>
            <option value="email_in">📩 Email received</option>
            <option value="note">📝 Note</option>
            <option value="call">📞 Call</option>
          </select>
          <button type="submit" class="btn btn-primary btn-sm">Add</button>
        </div>
        <textarea id="d-activity-body" rows="2" placeholder="What happened? e.g. ‘Sent quote for the catamaran option’" required></textarea>
      </form>
    </div>

    <div class="panel">
      <h3>Timeline</h3>
      <ul class="timeline">
        ${r.activities.map((a) => `
          <li class="t-${a.type}">
            <div class="t-meta">${ACTIVITY_LABELS[a.type] || a.type} · ${fullDate(a.created_at)}</div>
            <div class="t-body">${esc(a.body)}</div>
          </li>`).join('')}
      </ul>
    </div>

    <button class="btn btn-danger btn-sm" id="d-delete">Delete request</button>
  </div>`;

  $('#drawer-close').addEventListener('click', closeDrawer);

  $('#d-save').addEventListener('click', async () => {
    await api('/requests/' + id, {
      method: 'PATCH',
      body: JSON.stringify({
        status: $('#d-status').value,
        payment_status: $('#d-payment').value,
        quoted_amount: $('#d-quoted').value || 0,
        paid_amount: $('#d-paid').value || 0
      })
    });
    openRequest(id);
    refreshCurrentView();
  });

  $('#d-activity-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await api(`/requests/${id}/activities`, {
      method: 'POST',
      body: JSON.stringify({ type: $('#d-activity-type').value, body: $('#d-activity-body').value })
    });
    openRequest(id);
  });

  $('#d-delete').addEventListener('click', async () => {
    if (!confirm('Delete this request and its timeline? This cannot be undone.')) return;
    await api('/requests/' + id, { method: 'DELETE' });
    closeDrawer();
    refreshCurrentView();
  });

  $('#drawer').classList.remove('hidden');
  $('#drawer-backdrop').classList.remove('hidden');
}

/* ------------------------------------------------------ client drawer --- */
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
      <h3>Requests (${c.requests.length})</h3>
      <div class="card-list">
        ${c.requests.length ? c.requests.map((r) => `
          <div class="card" data-request="${r.id}">
            <div class="card-top">
              <span class="card-title">${esc(r.service)}</span>
              ${statusBadge(r.status)} ${payBadge(r.payment_status)}
              <span class="card-right">
                ${r.quoted_amount ? `<span class="card-amount">${money(r.quoted_amount, r.currency)}</span>` : ''}
              </span>
            </div>
            <div class="card-sub">${timeAgo(r.updated_at)}</div>
          </div>`).join('') : '<div class="empty">No requests yet.</div>'}
      </div>
    </div>
  </div>`;

  $('#drawer-close').addEventListener('click', closeDrawer);
  $('#c-save').addEventListener('click', async () => {
    await api('/clients/' + id, {
      method: 'PATCH',
      body: JSON.stringify({ notes: $('#c-notes').value })
    });
    $('#c-save').textContent = 'Saved ✓';
    setTimeout(() => { $('#c-save').textContent = 'Save notes'; }, 1500);
  });
  document.querySelectorAll('#drawer-content [data-request]').forEach((el) =>
    el.addEventListener('click', () => openRequest(el.dataset.request)));

  $('#drawer').classList.remove('hidden');
  $('#drawer-backdrop').classList.remove('hidden');
}

function refreshCurrentView() { showView(currentView); }

/* -------------------------------------------------- new request modal --- */
$('#btn-new-request').addEventListener('click', () => {
  $('#modal-backdrop').classList.remove('hidden');
  $('#new-request-form').reset();
  $('#new-request-form [name=name]').focus();
});
$('#modal-cancel').addEventListener('click', () => $('#modal-backdrop').classList.add('hidden'));
$('#modal-backdrop').addEventListener('click', (e) => {
  if (e.target === $('#modal-backdrop')) $('#modal-backdrop').classList.add('hidden');
});

$('#new-request-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd.entries());
  const created = await api('/requests', { method: 'POST', body: JSON.stringify(body) });
  $('#modal-backdrop').classList.add('hidden');
  refreshCurrentView();
  openRequest(created.id);
});

/* --------------------------------------------------------------- boot --- */
(async function boot() {
  try {
    await api('/dashboard');
    $('#app').classList.remove('hidden');
    showView('dashboard');
  } catch (err) {
    if (err.message === 'Unauthorized') showLogin();
    else {
      $('#app').classList.remove('hidden');
      showView('dashboard');
    }
  }
})();
