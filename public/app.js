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

/**
 * Email replies carry the whole previous conversation as quoted text
 * ("On ... wrote:", "> " lines). Each earlier message is already its own
 * bubble in the thread, so show only the NEW text — with the raw original
 * available behind a click, just in case.
 */
function stripQuoted(body) {
  const patterns = [
    /(^|\r?\n)\s*On [\s\S]{0,200}?wrote:\s*(\r?\n|$)/,   // "On <date>, <name> wrote:" (may wrap)
    /(^|\r?\n)>\s?/,                                     // first "> " quoted line
    /(^|\r?\n)-{2,}\s*Original Message\s*-{2,}/i,
    /(^|\r?\n)From:\s[^\n]+\r?\nSent:\s/i,
    /(^|\r?\n)_{6,}\s*(\r?\n|$)/
  ];
  let cut = body.length;
  for (const re of patterns) {
    const m = body.match(re);
    if (m && m.index < cut) cut = m.index;
  }
  const text = body.slice(0, cut).trim();
  if (!text || cut >= body.length) return { text: body, hasQuoted: false };
  return { text, hasQuoted: true };
}

function renderMsgBubble(m, l) {
  const isFormSubmission = m.body.startsWith('Website form submission');
  const { text, hasQuoted } = isFormSubmission
    ? { text: m.body, hasQuoted: false } : stripQuoted(m.body);
  return `
    <div class="msg ${m.direction}">
      ${isFormSubmission ? '' :
        `<div class="m-meta">${m.direction === 'in' ? esc(l.client_name) : 'You'} · ${fmtDateTime(m.sent_at)}</div>`}
      <span class="msg-text">${esc(text)}</span>
      ${hasQuoted ? `<div class="quoted-toggle" data-mid="${m.id}">Show quoted history ⌄</div>` : ''}
    </div>`;
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
  const inOtherMenu = name === 'clients' || name === 'services';
  $('#other-toggle').classList.toggle('active', inOtherMenu);
  document.querySelectorAll('.nav-dropdown-item').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === name));

  if (name === 'leads') loadLeads();
  if (name === 'confirmed') loadConfirmed();
  if (name === 'calendar') renderCalendar();
  if (name === 'payments') loadPayments();
  if (name === 'clients') loadClients();
  if (name === 'services') loadServices();
  if (name === 'settings') loadSettings();
}

document.querySelectorAll('.nav-btn[data-view]').forEach((b) =>
  b.addEventListener('click', () => showView(b.dataset.view)));

// "Other" dropdown: toggles open/closed, click outside or an item closes it
$('#other-toggle').addEventListener('click', (e) => {
  e.stopPropagation();
  $('#other-menu').classList.toggle('hidden');
});
document.querySelectorAll('.nav-dropdown-item').forEach((b) =>
  b.addEventListener('click', () => {
    $('#other-menu').classList.add('hidden');
    showView(b.dataset.view);
  }));
document.addEventListener('click', (e) => {
  if (!$('#other-dropdown').contains(e.target)) $('#other-menu').classList.add('hidden');
});

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
      ${l.merged_count > 1 ? `<span class="badge multi">📨 ${l.merged_count} submissions</span>` : ''}
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
  const params = new URLSearchParams();
  if ($('#lead-search').value) params.set('q', $('#lead-search').value);
  const sort = $('#lead-sort').value;
  if (sort && sort !== 'date') params.set('sort', sort);
  const [summary, rows] = await Promise.all([
    api('/leads/summary'),
    api('/leads' + (params.size ? '?' + params : ''))
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

// remember the chosen sort order between visits
$('#lead-sort').value = localStorage.getItem('aqualux_sort') || 'date';
$('#lead-sort').addEventListener('change', () => {
  localStorage.setItem('aqualux_sort', $('#lead-sort').value);
  loadLeads();
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
    ? payments.map((p) => {
        const sub = [p.service, p.payer_email, p.subject, p.notes].filter(Boolean).map(esc).join(' · ');
        return `
      <div class="card pay-card" data-pay="${p.id}">
        <div class="card-top">
          <span class="card-title">${SOURCE_ICONS[p.source] || '💵'} ${esc(p.payer || p.source)}</span>
          <span class="badge pay-paid">${esc(p.source)}</span>
          ${p.amount_due > 0 ? `<span class="badge pay-unpaid">${money(p.amount_due)} still due</span>` : ''}
          <span class="card-right">
            <span class="card-amount pay-amount">+${money(p.amount)}</span>
            <span class="card-sub">${timeAgo(p.received_at)}</span>
            <button class="btn btn-sm btn-danger pay-del" title="Remove">×</button>
          </span>
        </div>
        ${sub ? `<div class="card-sub">${sub}</div>` : ''}
      </div>`;
      }).join('')
    : `<div class="empty">No payments yet. Payment emails appear here automatically — or click “+ Add payment” for cash.</div>`;
  document.querySelectorAll('#payment-list .pay-del').forEach((btn) =>
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.closest('[data-pay]').dataset.pay;
      if (!confirm('Remove this payment from the list?')) return;
      await api('/payments/' + id, { method: 'DELETE' });
      loadPayments();
    }));
}

/* --- manual payment modal --- */
$('#btn-add-payment').addEventListener('click', () => {
  $('#payment-form').reset();
  $('#payment-form [name=received_at]').value = new Date().toISOString().slice(0, 10);
  $('#payment-modal-backdrop').classList.remove('hidden');
  $('#payment-form [name=payer]').focus();
});
$('#payment-cancel').addEventListener('click', () => $('#payment-modal-backdrop').classList.add('hidden'));
$('#payment-modal-backdrop').addEventListener('click', (e) => {
  if (e.target === $('#payment-modal-backdrop')) $('#payment-modal-backdrop').classList.add('hidden');
});
$('#payment-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target).entries());
  await api('/payments', { method: 'POST', body: JSON.stringify(body) });
  $('#payment-modal-backdrop').classList.add('hidden');
  loadPayments();
});

/* ------------------------------------------------------ services book --- */
const PRICE_UNIT_LABELS = {
  per_person: '/ person', per_hour: '/ hour', per_day: '/ day',
  per_vehicle: '/ vehicle', flat_total: 'flat', quote: 'quote'
};
const collapsedCategories = new Set(JSON.parse(localStorage.getItem('aqualux_collapsed_cats') || '[]'));
const expandedServices = new Set();

function fmtDownpayment(o) {
  const parts = [];
  if (o.downpayment_percent) parts.push(`${o.downpayment_percent}%`);
  if (o.downpayment_fixed) parts.push(`${money(o.downpayment_fixed)}${o.downpayment_per_person ? '/person' : ''}`);
  return parts.length ? parts.join(' + ') + ' down' : '';
}

function priceSummary(options) {
  const priced = options.filter((o) => o.price_unit !== 'quote' && o.price);
  if (!priced.length) return options.length ? 'Quote only' : 'No pricing yet';
  const prices = priced.map((o) => o.price);
  const lo = Math.min(...prices), hi = Math.max(...prices);
  const unit = PRICE_UNIT_LABELS[priced[0].price_unit] || '';
  const range = lo === hi ? money(lo) : `${money(lo)}–${money(hi)}`;
  return `${range} ${unit}${options.length > 1 ? ` · ${options.length} options` : ''}`;
}

function optionSummaryLine(o) {
  const people = (o.min_people || o.max_people)
    ? `👥 ${o.min_people || 1}${o.max_people ? '–' + o.max_people : '+'}` : '';
  const dp = fmtDownpayment(o);
  const price = o.price_unit === 'quote' ? 'Personal quote' : `${money(o.price)} ${PRICE_UNIT_LABELS[o.price_unit]}`;
  return { people, dp, price };
}

function serviceCard(s) {
  const expanded = expandedServices.has(s.id);
  const hasFlag = s.options.some((o) => o.notes?.includes('⚠'));
  return `
  <div class="svc-card ${expanded ? 'expanded' : ''}" data-service="${s.id}">
    <div class="svc-card-head" data-toggle="${s.id}">
      <span class="svc-card-title">${esc(s.service_name)}</span>
      ${s.company ? `<span class="svc-company-badge">${esc(s.company)}</span>` : ''}
      ${s.booking_method ? `<span class="svc-comm-badge">${esc(s.booking_method)}</span>` : ''}
      ${hasFlag ? `<span class="svc-flag-badge">⚠ needs review</span>` : ''}
      <span class="svc-card-right">
        <span class="svc-price-summary">${esc(priceSummary(s.options))}</span>
        <span class="chev">▾</span>
      </span>
    </div>
    ${expanded ? serviceCardBody(s) : ''}
  </div>`;
}

function optionEditRow(o = {}, idx) {
  const id = o.id ?? `new${idx}`;
  return `
  <div class="opt-row" data-opt="${id}">
    <div class="opt-row-line1">
      <input class="opt-name" placeholder="Option name (e.g. Sunset Tour)" value="${esc(o.option_name || '')}">
      <input class="opt-timing" placeholder="Timing (e.g. 5:30pm–7:30pm)" value="${esc(o.timing || '')}">
      <button type="button" class="btn btn-sm opt-del" title="Remove option">×</button>
    </div>
    <div class="opt-row-line2">
      <label class="opt-field">Price<input class="opt-price" type="number" min="0" step="0.01" value="${o.price ?? ''}" placeholder="0.00"></label>
      <label class="opt-field">Unit
        <select class="opt-unit">
          <option value="per_person" ${o.price_unit === 'per_person' ? 'selected' : ''}>per person</option>
          <option value="flat_total" ${o.price_unit === 'flat_total' ? 'selected' : ''}>flat total</option>
          <option value="per_vehicle" ${o.price_unit === 'per_vehicle' ? 'selected' : ''}>per vehicle</option>
          <option value="per_hour" ${o.price_unit === 'per_hour' ? 'selected' : ''}>per hour</option>
          <option value="per_day" ${o.price_unit === 'per_day' ? 'selected' : ''}>per day</option>
          <option value="quote" ${o.price_unit === 'quote' ? 'selected' : ''}>personal quote</option>
        </select>
      </label>
      <label class="opt-field">Child price<input class="opt-child" type="number" min="0" step="0.01" value="${o.child_price || ''}" placeholder="0.00"></label>
      <label class="opt-field">Min people<input class="opt-min" type="number" min="1" step="1" value="${o.min_people ?? ''}" placeholder="1"></label>
      <label class="opt-field">Max people<input class="opt-max" type="number" min="1" step="1" value="${o.max_people ?? ''}" placeholder="∞"></label>
    </div>
    <div class="opt-row-line3">
      <label class="opt-field">Downpayment %<input class="opt-dp-pct" type="number" min="0" step="0.01" value="${o.downpayment_percent || ''}" placeholder="0"></label>
      <label class="opt-field">Downpayment $<input class="opt-dp-fix" type="number" min="0" step="0.01" value="${o.downpayment_fixed || ''}" placeholder="0"></label>
      <label class="opt-field mini-check"><input type="checkbox" class="opt-dp-pp" ${o.downpayment_per_person ? 'checked' : ''}> $ is per person</label>
      <input class="opt-notes" placeholder="Notes for this option…" value="${esc(o.notes || '')}">
    </div>
  </div>`;
}

function serviceCardBody(s) {
  return `
    <div class="svc-card-body">
      <div class="svc-vendor-grid">
        <label>Category<input class="sf-category" value="${esc(s.category)}" list="category-list"></label>
        <label>Wix form name<input class="sf-wix" value="${esc(s.wix_form_name)}" placeholder="Exact name on your website form"></label>
        <label>Company / Provider<input class="sf-company" value="${esc(s.company)}"></label>
        <label>Contact<input class="sf-contact" value="${esc(s.contact)}" placeholder="Phone / email"></label>
        <label>Booking method<input class="sf-booking" value="${esc(s.booking_method)}" list="booking-method-list"></label>
        <label>Info needed to book<input class="sf-info" value="${esc(s.info_needed)}" placeholder="e.g. Date, People, Timing"></label>
        <label>Commission<input class="sf-commission" value="${esc(s.commission)}" placeholder="e.g. 15% or $20/booking"></label>
        <label>Internal notes<input class="sf-internal" value="${esc(s.internal_notes)}" placeholder="Vendor-only notes"></label>
      </div>

      <h4>Pricing options</h4>
      <div class="opt-rows">${s.options.map((o, i) => optionEditRow(o, i)).join('')}</div>
      <button type="button" class="btn btn-sm opt-add">+ Add option</button>

      <div class="svc-card-actions">
        <button type="button" class="btn btn-primary btn-sm svc-save">Save changes</button>
        <button type="button" class="btn btn-danger btn-sm svc-delete">Delete service</button>
        <span class="send-status svc-save-status"></span>
      </div>
    </div>`;
}

let allServices = [];

async function loadServices() {
  const q = $('#service-search').value;
  allServices = await api('/services' + (q ? '?q=' + encodeURIComponent(q) : ''));

  const cats = [...new Set(allServices.map((r) => r.category).filter(Boolean))].sort();
  $('#category-list').innerHTML = cats.map((c) => `<option value="${esc(c)}">`).join('');

  if (!allServices.length) {
    $('#service-groups').innerHTML = `<div class="empty">No services yet. Click “+ Add service” to build your info book — pricing, timings, commissions, everything in one place.</div>`;
    return;
  }

  const byCategory = new Map();
  for (const s of allServices) {
    const cat = s.category || 'Uncategorized';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(s);
  }

  $('#service-groups').innerHTML = [...byCategory.entries()].map(([cat, items]) => {
    const collapsed = collapsedCategories.has(cat);
    return `
    <div class="svc-category ${collapsed ? 'collapsed' : ''}" data-cat="${esc(cat)}">
      <div class="svc-category-head">
        <h3>${esc(cat)}</h3>
        <span class="count">${items.length} service${items.length === 1 ? '' : 's'}</span>
        <span class="chev">▾</span>
      </div>
      <div class="svc-category-items">${items.map(serviceCard).join('')}</div>
    </div>`;
  }).join('');

  document.querySelectorAll('.svc-category-head').forEach((el) =>
    el.addEventListener('click', () => {
      const group = el.closest('.svc-category');
      const cat = group.dataset.cat;
      group.classList.toggle('collapsed');
      if (group.classList.contains('collapsed')) collapsedCategories.add(cat);
      else collapsedCategories.delete(cat);
      localStorage.setItem('aqualux_collapsed_cats', JSON.stringify([...collapsedCategories]));
    }));

  bindServiceCardEvents();
}

function bindServiceCardEvents() {
  document.querySelectorAll('.svc-card-head[data-toggle]').forEach((el) =>
    el.addEventListener('click', () => {
      const id = Number(el.dataset.toggle);
      if (expandedServices.has(id)) expandedServices.delete(id);
      else expandedServices.add(id);
      loadServices();
    }));

  document.querySelectorAll('.opt-add').forEach((btn) =>
    btn.addEventListener('click', () => {
      const rows = btn.closest('.svc-card-body').querySelector('.opt-rows');
      rows.insertAdjacentHTML('beforeend', optionEditRow({}, rows.children.length));
      bindOptionRowEvents(rows);
    }));

  document.querySelectorAll('.opt-rows').forEach(bindOptionRowEvents);

  document.querySelectorAll('.svc-save').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const card = btn.closest('.svc-card');
      const id = card.dataset.service;
      const body = card.querySelector('.svc-card-body');
      const options = [...body.querySelectorAll('.opt-row')].map((row) => ({
        option_name: row.querySelector('.opt-name').value,
        timing: row.querySelector('.opt-timing').value,
        price: row.querySelector('.opt-price').value,
        price_unit: row.querySelector('.opt-unit').value,
        child_price: row.querySelector('.opt-child').value,
        min_people: row.querySelector('.opt-min').value,
        max_people: row.querySelector('.opt-max').value,
        downpayment_percent: row.querySelector('.opt-dp-pct').value,
        downpayment_fixed: row.querySelector('.opt-dp-fix').value,
        downpayment_per_person: row.querySelector('.opt-dp-pp').checked,
        notes: row.querySelector('.opt-notes').value
      }));
      const status = card.querySelector('.svc-save-status');
      status.textContent = 'Saving…';
      await api('/services/' + id, {
        method: 'PATCH',
        body: JSON.stringify({
          category: body.querySelector('.sf-category').value,
          wix_form_name: body.querySelector('.sf-wix').value,
          company: body.querySelector('.sf-company').value,
          contact: body.querySelector('.sf-contact').value,
          booking_method: body.querySelector('.sf-booking').value,
          info_needed: body.querySelector('.sf-info').value,
          commission: body.querySelector('.sf-commission').value,
          internal_notes: body.querySelector('.sf-internal').value,
          options
        })
      });
      loadServices();
    }));

  document.querySelectorAll('.svc-delete').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const card = btn.closest('.svc-card');
      const id = card.dataset.service;
      if (!confirm('Delete this service and all its pricing options?')) return;
      await api('/services/' + id, { method: 'DELETE' });
      expandedServices.delete(Number(id));
      loadServices();
    }));
}

function bindOptionRowEvents(rows) {
  rows.querySelectorAll('.opt-del').forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => btn.closest('.opt-row').remove());
  });
}

let serviceSearchTimer;
$('#service-search').addEventListener('input', () => {
  clearTimeout(serviceSearchTimer); serviceSearchTimer = setTimeout(loadServices, 250);
});

$('#btn-add-service').addEventListener('click', () => {
  $('#service-form').reset();
  $('#service-modal-backdrop').classList.remove('hidden');
  $('#service-form [name=category]').focus();
});
$('#service-cancel').addEventListener('click', () => $('#service-modal-backdrop').classList.add('hidden'));
$('#service-modal-backdrop').addEventListener('click', (e) => {
  if (e.target === $('#service-modal-backdrop')) $('#service-modal-backdrop').classList.add('hidden');
});

$('#service-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target).entries());
  const created = await api('/services', { method: 'POST', body: JSON.stringify(body) });
  $('#service-modal-backdrop').classList.add('hidden');
  expandedServices.add(created.id);
  loadServices();
});

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
    <h2>${esc(l.client_name)} ${statusBadge(l.status)}
      ${l.merged_count > 1 ? `<span class="badge multi">📨 ${l.merged_count} submissions</span>` : ''}</h2>
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
      <div class="thread thread-latest">
        ${l.messages.length ? renderMsgBubble(l.messages[l.messages.length - 1], l)
          : '<div class="empty">No emails on this lead yet.</div>'}
      </div>
      <div class="reply-box">
        <textarea id="d-reply" placeholder="Write your reply — it sends from your Gmail…" ${canEmail ? '' : 'disabled'}></textarea>
        <div id="d-file-list" class="file-list"></div>
        <div class="reply-actions">
          <button class="btn btn-primary" id="d-send" ${canEmail ? '' : 'disabled'}>Send reply ✉️</button>
          <button class="btn" id="d-attach" ${canEmail ? '' : 'disabled'} title="Attach files">📎 Attach</button>
          <button class="btn" id="d-footer" ${canEmail ? '' : 'disabled'} title="Insert your footer at the bottom of the message">Footer</button>
          <input type="file" id="d-files" multiple hidden>
          <span class="send-status" id="d-send-status">${canEmail ? '' :
            'Connect Gmail in <a href="#" id="goto-settings">Settings</a> to send emails from here.'}</span>
        </div>
      </div>
      ${l.messages.length > 1 ? `
        <div class="older-toggle" id="older-toggle">▾ Show ${l.messages.length - 1} earlier message${l.messages.length - 1 === 1 ? '' : 's'}</div>
        <div class="thread thread-older hidden" id="thread-older">
          ${l.messages.slice(0, -1).reverse().map((m) => renderMsgBubble(m, l)).join('')}
        </div>` : ''}
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

  // --- show/hide earlier messages (newest message is always visible) ---
  $('#older-toggle')?.addEventListener('click', () => {
    const older = $('#thread-older');
    const hidden = older.classList.toggle('hidden');
    $('#older-toggle').textContent = hidden
      ? `▾ Show ${l.messages.length - 1} earlier message${l.messages.length - 1 === 1 ? '' : 's'}`
      : `▴ Hide earlier messages`;
  });

  // --- expand/collapse quoted history in bubbles ---
  const msgById = Object.fromEntries(l.messages.map((m) => [String(m.id), m]));
  document.querySelectorAll('#drawer-content .quoted-toggle').forEach((el) =>
    el.addEventListener('click', () => {
      const m = msgById[el.dataset.mid];
      const textEl = el.parentElement.querySelector('.msg-text');
      const expanded = el.dataset.expanded === '1';
      textEl.textContent = expanded ? stripQuoted(m.body).text : m.body;
      el.dataset.expanded = expanded ? '0' : '1';
      el.textContent = expanded ? 'Show quoted history ⌄' : 'Hide quoted history ⌃';
    }));

  // --- auto-expanding reply box ---
  const replyBox = $('#d-reply');
  function autoGrow() {
    replyBox.style.height = 'auto';
    replyBox.style.height = Math.min(replyBox.scrollHeight + 2, 420) + 'px';
  }
  replyBox.addEventListener('input', autoGrow);

  // --- footer button: insert the signature at the bottom of the message ---
  $('#d-footer')?.addEventListener('click', async () => {
    const { image } = await api('/signature-image');
    if (image) {
      const st = $('#d-send-status');
      st.classList.remove('err');
      st.textContent = '🖼️ Your signature image is added to every email automatically.';
      return;
    }
    const { signature } = await api('/signature');
    if (!signature?.trim()) { showView('settings'); return; }
    const firstLine = signature.split('\n').map((l) => l.trim()).find((l) => l.length > 3);
    if (firstLine && replyBox.value.includes(firstLine)) return; // already there
    replyBox.value = replyBox.value.replace(/\s+$/, '') + '\n\n' + signature;
    autoGrow();
    replyBox.focus();
  });

  // --- attachments ---
  let pendingFiles = [];
  const MAX_TOTAL = 20 * 1024 * 1024;

  function renderFileList() {
    $('#d-file-list').innerHTML = pendingFiles.map((f, i) => `
      <span class="file-chip">📎 ${esc(f.filename)}
        <small>${(f.size / 1024 < 1000 ? (f.size / 1024).toFixed(0) + ' KB' : (f.size / 1048576).toFixed(1) + ' MB')}</small>
        <button data-rm="${i}" title="Remove">×</button>
      </span>`).join('');
    $('#d-file-list').querySelectorAll('[data-rm]').forEach((b) =>
      b.addEventListener('click', () => { pendingFiles.splice(Number(b.dataset.rm), 1); renderFileList(); }));
  }

  $('#d-attach')?.addEventListener('click', () => $('#d-files').click());
  $('#d-files')?.addEventListener('change', async (e) => {
    for (const file of e.target.files) {
      const total = pendingFiles.reduce((a, f) => a + f.size, 0) + file.size;
      if (total > MAX_TOTAL) {
        alert(`"${file.name}" would push attachments over 20 MB — send it in a separate email.`);
        continue;
      }
      const data = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result.split(',')[1]);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      pendingFiles.push({ filename: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, data });
    }
    e.target.value = '';
    renderFileList();
  });

  $('#d-send').addEventListener('click', async () => {
    const body = $('#d-reply').value.trim();
    if (!body && !pendingFiles.length) return;
    const st = $('#d-send-status');
    $('#d-send').disabled = true;
    st.classList.remove('err');
    st.textContent = pendingFiles.length ? 'Sending with attachments…' : 'Sending…';
    try {
      await api(`/leads/${id}/reply`, {
        method: 'POST',
        body: JSON.stringify({
          body,
          attachments: pendingFiles.map(({ filename, mimeType, data }) => ({ filename, mimeType, data }))
        })
      });
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

  const sig = await api('/signature');
  $('#sig-text').value = sig.signature;
  $('#sig-save').onclick = async () => {
    await api('/signature', { method: 'POST', body: JSON.stringify({ signature: $('#sig-text').value }) });
    $('#sig-status').textContent = 'Saved ✓';
    setTimeout(() => { $('#sig-status').textContent = ''; }, 1500);
  };

  // --- signature image ---
  async function renderSigImage() {
    const { image } = await api('/signature-image');
    $('#sig-img-area').innerHTML = image
      ? `<img src="data:${image.mimeType};base64,${image.data}" alt="Signature" style="max-width:400px; border:1px solid var(--border); border-radius:8px">`
      : `<div class="empty" style="padding:14px">No image uploaded — the text signature below is used.</div>`;
    $('#sig-img-remove').classList.toggle('hidden', !image);
  }
  renderSigImage();
  $('#sig-img-upload').onclick = () => $('#sig-img-file').click();
  $('#sig-img-file').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { alert('Keep the image under 2 MB.'); return; }
    const data = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result.split(',')[1]);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    await api('/signature-image', {
      method: 'POST',
      body: JSON.stringify({ data, mimeType: file.type, filename: file.name })
    });
    e.target.value = '';
    $('#sig-img-status').textContent = 'Uploaded ✓ — every email now ends with this image.';
    setTimeout(() => { $('#sig-img-status').textContent = ''; }, 3000);
    renderSigImage();
  };
  $('#sig-img-remove').onclick = async () => {
    if (!confirm('Remove the signature image? Emails will use the text signature instead.')) return;
    await api('/signature-image', { method: 'DELETE' });
    renderSigImage();
  };

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
