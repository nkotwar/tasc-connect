/* TASC Connect · core: shared state, Supabase client, small UI helpers.
   The app is split into plain scripts that share one global scope; index.html loads them in order. */

const S = {
  who: null,        // result of whoami(): { state, gmail, admin, viewer, me }
  tab: 'visits',
  cache: {}         // per-screen data
};

const configured = DAURA_CONFIG && !/YOUR-PROJECT|PASTE_YOURS/.test(DAURA_CONFIG.supabaseUrl + DAURA_CONFIG.supabaseKey + DAURA_CONFIG.googleClientId);

const sb = configured ? supabase.createClient(DAURA_CONFIG.supabaseUrl, DAURA_CONFIG.supabaseKey, {
  // lock: run sign-in refreshes directly. The browser-wide lock it uses by default can get stuck after the
  // phone sleeps or the app is backgrounded, and then every server call waits forever.
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'daura-auth', lock: (name, wait, fn) => fn() }
}) : null;

const $ = (q, el = document) => el.querySelector(q);
/* The current tab's own container. Tabs you have visited stay built (hidden) and refresh quietly when you return. */
const TV = () => document.querySelector(`#main > .tabview[data-tab="${S.tab}"]`) || document.getElementById('main');
const $$ = (q, el = document) => [...el.querySelectorAll(q)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICON = {
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 6v6c0 5 3.4 8.3 8 9 4.6-.7 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/></svg>',
  chev: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5M5 12h11"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>',
  wa: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3a.5.5 0 0 0 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.7-1.2 2.2 2.2 0 0 0 .2-1.2c-.1-.1-.3-.2-.5-.3z"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>'
};

/* Friendly empty state that fills the section: icon in a soft circle, a title, a line of help, optional buttons. */
const emptyState = (icon, title, text, actions = '') =>
  `<div class="empty big"><div class="eic">${icon}</div><h4>${title}</h4><p>${text}</p>${actions ? `<div class="eact">${actions}</div>` : ''}</div>`;
/* Dashboard tiles that open Visits → Places with a pill picked: data-goplace="<pill>" */
document.addEventListener('click', e => { const b = e.target.closest('[data-goplace]'); if (b) goPlaces(b.dataset.goplace); });
/* Buttons inside a section that jump to another section of the same tab: data-goto="<pane id>" */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-goto]'); if (!b) return;
  const t = $(`.pseg button[data-pid="${b.dataset.goto}"]`, TV()); if (t) t.click();
});

function toast(msg, ms = 2600) {
  const t = $('#toast'); $('#toast-msg').textContent = msg; t.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), ms);
}

/* Server error codes → plain words. Hints written in the database are shown as they are. */
const ERR = {
  NOT_ALLOWED: 'You are not allowed to do that.',
  NOT_LINKED: 'Please confirm your profile first.',
  ALREADY_LINKED: 'This Gmail is already linked to a profile.',
  NO_MATCH: 'That profile no longer matches this Gmail.',
  NOT_GOOGLE: 'Please sign in with Google.',
  BAD_FILE: 'That file does not look like udairo.js.',
  CANNOT_BLOCK_SELF: 'You cannot block yourself.',
  REASON_REQUIRED: 'Please give a reason.',
  ALREADY_REQUESTED: 'A request for this is already waiting with the admin.',
  TIMEOUT: 'The server is taking too long. Check your signal and try again.',
  ALLOTMENT_ON_HOLD: 'Your request about this visit is waiting for the admin. You can log it once the admin decides.'
};
function errText(e) {
  if (!e) return 'Something went wrong.';
  if (e.hint) return e.hint;
  const code = (e.message || '').trim();
  if (ERR[code]) return ERR[code];
  if (/Failed to fetch|NetworkError|network/i.test(code)) return 'No internet connection. Please try again.';
  if (/JWT|token|session/i.test(code)) return 'Your sign-in has expired. Please sign in again.';
  return code || 'Something went wrong.';
}

async function rpc(fn, args, ms = 20000) {
  let t;
  const late = new Promise((_, no) => { t = setTimeout(() => no({ message: 'TIMEOUT' }), ms); });
  const { data, error } = await Promise.race([sb.rpc(fn, args || {}), late]).finally(() => clearTimeout(t));
  if (error) throw error;
  return data;
}
async function q(promise) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}

/* Bottom sheet: openSheet(title, html) → returns the body element. */
function openSheet(title, html, onClose) {
  const cur = $('#layer .scrim');
  if (cur) {   // a panel is already open: swap its content in place
    const cb = cur._onClose; cur._onClose = onClose; if (cb) cb();
    const sh = $('.sheet', cur); sh.setAttribute('aria-label', title); sh.style.transform = ''; cur.style.background = '';
    $('.sheet-head h3', cur).textContent = title;
    const body = $('.sheet-body', cur);
    body.innerHTML = html; body.scrollTop = 0;
    body.classList.remove('swap'); void body.offsetWidth; body.classList.add('swap');
    return body;
  }
  const wrap = document.createElement('div');
  wrap.className = 'scrim';
  wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="grab" aria-hidden="true"><i></i></div>
    <div class="sheet-head"><h3>${esc(title)}</h3><button class="x" data-close aria-label="Close">${ICON.x}</button></div>
    <div class="sheet-body">${html}</div></div>`;
  wrap.addEventListener('click', e => { if (e.target === wrap || e.target.closest('[data-close]')) closeSheet(); });
  wrap._onClose = onClose;
  $('#layer').appendChild(wrap);
  dragToClose(wrap);
  return $('.sheet-body', wrap);
}

/* Pull a panel down to close it: from the handle or header anytime, or from the content when it is scrolled to the top. */
function dragToClose(wrap) {
  const sheet = $('.sheet', wrap), body = $('.sheet-body', wrap);
  let sy = 0, sx = 0, dy = 0, t0 = 0, on = false, lock = null;
  wrap.addEventListener('touchstart', e => {
    const t = e.target;
    on = e.touches.length === 1 && !!t.closest('.sheet') && !t.closest('input, textarea, select, .chips, .tbl')
      && (!!t.closest('.grab, .sheet-head') || body.scrollTop <= 0);
    if (!on) return;
    sy = e.touches[0].clientY; sx = e.touches[0].clientX; dy = 0; t0 = performance.now(); lock = null;
  }, { passive: true });
  wrap.addEventListener('touchmove', e => {
    if (!on) return;
    const y = e.touches[0].clientY - sy, x = e.touches[0].clientX - sx;
    if (!lock && (Math.abs(y) > 6 || Math.abs(x) > 6)) lock = (y > 0 && Math.abs(y) > Math.abs(x)) ? 'down' : 'no';
    if (lock !== 'down') return;
    if (body.scrollTop > 0 && !e.target.closest('.grab, .sheet-head')) { on = false; return; }
    dy = Math.max(0, y);
    sheet.style.transition = 'none'; sheet.style.transform = `translateY(${dy}px)`;
    wrap.style.background = `rgba(10,16,26,${0.45 * Math.max(0, 1 - dy / 500)})`;
  }, { passive: true });
  const end = () => {
    if (!on) return; on = false;
    if (lock !== 'down') return;
    const v = dy / Math.max(1, performance.now() - t0);
    if (dy > 110 || (dy > 30 && v > 0.5)) {
      sheet.style.transition = 'transform .2s ease-in'; sheet.style.transform = 'translateY(100%)';
      wrap.style.transition = 'background .2s'; wrap.style.background = 'rgba(10,16,26,0)';
      setTimeout(() => { if (wrap.isConnected) closeSheet(); }, 190);
    } else {
      sheet.style.transition = 'transform .22s cubic-bezier(.2,.85,.25,1)'; sheet.style.transform = '';
      wrap.style.background = '';
    }
  };
  wrap.addEventListener('touchend', end, { passive: true });
  wrap.addEventListener('touchcancel', end, { passive: true });
}
function closeSheet() {
  const w = $('#layer .scrim'); if (!w) return;
  const cb = w._onClose; w.remove(); if (cb) cb();
}
function confirmSheet(title, text, okLabel, danger = false) {
  return new Promise(res => {
    let done = false;
    const body = openSheet(title, `<p style="margin-top:0">${text}</p>
      <div class="row" style="margin-top:16px"><button class="btn ghost grow" data-no>Cancel</button>
      <button class="btn grow ${danger ? 'danger' : ''}" data-yes>${esc(okLabel)}</button></div>`, () => { if (!done) res(false); });
    $('[data-no]', body).onclick = () => { done = true; closeSheet(); res(false); };
    $('[data-yes]', body).onclick = () => { done = true; closeSheet(); res(true); };
  });
}

const initials = n => String(n || '').replace(/^(MR|MS|MRS|MISS)\.?\s+/i, '').split(/\s+/).filter(w => /\w/.test(w)).slice(0, 2).map(w => w[0]).join('').toUpperCase();
/* A sign-in as people should read it: a Gmail, or "Phone (name + date of birth)" */
const loginLabel = g => String(g || '').startsWith('device:') ? 'Phone · signed in with name + date of birth' : String(g || '');
const cleanName = n => String(n || '').replace(/\s+\.$/, '').trim();
const fmtDate = d => d ? new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtDateTime = d => d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—';
const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5);
function ago(d) {
  if (!d) return 'never';
  const s = (Date.now() - new Date(d)) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  if (s < 86400 * 30) return Math.round(s / 86400) + ' d ago';
  return fmtDate(d);
}
const roleLabel = r => ({ field: 'Field staff', viewer: 'Viewer', admin: 'Admin' }[r] || r);

function header() {
  const me = S.who && S.who.me;
  $('#top').innerHTML = `<div class="brand"><button class="brand-btn" data-about aria-label="About TASC Connect"><img src="icon-192.png" alt=""></button><div><h1>TASC Connect</h1>
      <div class="sub">Udaipur RO · institution visits</div></div></div>
    ${me ? `<div class="who"><b>${esc(cleanName(me.name))}</b>${esc(me.branch || '')}</div>` : ''}`;
}

const TABS = [
  { id: 'visits', label: 'Visits', icon: ICON.pin, show: () => true },
  { id: 'dashboard', label: 'Dashboard', icon: ICON.chart, show: () => S.who && S.who.viewer },
  { id: 'admin', label: 'Admin', icon: ICON.shield, show: () => S.who && S.who.admin },
  { id: 'profile', label: 'Profile', icon: ICON.user, show: () => true }
];
function renderTabs(show) {
  const nav = $('#tabs');
  document.body.classList.toggle('no-tabs', !show);
  nav.hidden = !show; if (!show) return;
  $('#tabs-inner').innerHTML = TABS.filter(t => t.show()).map(t =>
    `<button class="tab ${S.tab === t.id ? 'on' : ''}" data-tab="${t.id}"><span class="ic">${t.icon}</span>${t.label}</button>`).join('');
}

/* Height of the sticky header, so things pinned below it (Dashboard filters) sit right under it */
(function () {
  const set = () => { const t = document.getElementById('top'); if (t) document.documentElement.style.setProperty('--toph', t.getBoundingClientRect().height + 'px'); };
  if (window.ResizeObserver) { const t = document.getElementById('top'); if (t) new ResizeObserver(set).observe(t); }
  addEventListener('resize', set); setTimeout(set, 0);
})();

/* ───────── search boxes that show they are filtering ─────────
   Blue when they hold text, an × to clear, a one-line "Showing n of m" summary, and one soft glow when you come back to them. */
function searchHTML(id, placeholder, value = '', cls = '') {
  return `<div class="search ${value ? 'on' : ''} ${cls}">${ICON.search}<input class="input" id="${id}" type="search" enterkeyhint="search" placeholder="${esc(placeholder)}" value="${esc(value)}" autocomplete="off">
    <button type="button" class="sx" aria-label="Clear search" ${value ? '' : 'hidden'}>${ICON.x}</button></div>`;
}
function bindSearch(input, onChange) {
  const box = input.closest('.search'), x = $('.sx', box);
  const sync = () => { box.classList.toggle('on', !!input.value.trim()); x.hidden = !input.value; };
  input.addEventListener('input', sync);
  x.onclick = () => { input.value = ''; sync(); onChange(); };
  sync();
}
/* "Showing 4 of 338 places · Overdue · "school" · Clear" (only while a search is typed) */
function searchSummary(el, { shown, of, noun, filters = [], q, onClear }) {
  if (!el) return;
  if (!q) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = `Showing <b>${shown}</b> of ${of} ${noun}${filters.filter(Boolean).map(f => ' · ' + esc(f)).join('')} · “${esc(q)}” · <button type="button" class="linkbtn" style="padding:0">Clear</button>`;
  $('button', el).onclick = onClear;
}
function glowSearch(root) {
  if (!root) return;
  const on = $('.pseg button.on', root), pane = on ? $(`.pane[data-pane="${on.dataset.pid}"]`, root) : root;
  $$('.search.on', pane || root).forEach(b => { b.classList.remove('glow'); void b.offsetWidth; b.classList.add('glow'); });
}

/* Someone the admin allowed to submit visit reports for others (not the admin themself) */
const canReportFor = () => !!(S.who && !S.who.admin && S.who.me && S.who.me.can_report_for);
/* "Entered by …" for a report someone else entered (admin or a staff member with the switch on) */
const enteredBy = v => v.entered_by ? personName(v.entered_by) : v.created_by_admin ? 'admin' : '';
