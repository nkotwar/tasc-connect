/* TASC Connect · Admin tab: people and their Gmails, roles, blocking; verifying visits; the requests queue;
   the staff list (udairo.js upload) and photo storage; the activity feed. The dashboard arrives next. */

const admPane = id => $(`#main > .tabview[data-tab="admin"] .pane[data-pane="${id}"]`) || document.createElement('div');

async function viewAdmin() {
  if (!S.who.admin) { TV().innerHTML = '<div class="empty">Admins only.</div>'; return; }
  await loadBasics();
  const panes = [
    { id: 'verify', label: 'Verify', badge: 'an-verify', draw: () => admVerify() },
    { id: 'requests', label: 'Requests', badge: 'an-requests', draw: () => admRequests() },
    { id: 'activity', label: 'Activity', badge: 'an-activity', draw: () => admActivity() }
  ];
  const old = $('#adm-host', TV());
  if (old && old._pager) { await old._pager.refresh(); adminBadges(); return; }
  TV().innerHTML = `${S.updateReady ? updateBar() : ''}<div id="adm-host"></div>`;
  bindUpdate();
  mountPager($('#adm-host', TV()), panes, panes.some(p => p.id === S.cache.adminSeg) ? S.cache.adminSeg : 'verify', id => { S.cache.adminSeg = id; remember(); });
  adminBadges();
}

async function adminBadges() {
  const rq = all('requests').filter(r => r.status === 'pending').length, vf = liveVisits().filter(v => v.status === 'submitted').length;
  const a = $('#an-requests'); if (a) a.textContent = rq ? ` · ${rq}` : '';
  const b = $('#an-verify'); if (b) b.textContent = vf ? ` · ${vf}` : '';
}

/* ───────── Verify (admin) ─────────
   Every report waiting for a check, oldest first. Only the admin verifies. */
async function admVerify() {
  const rows = liveVisits().filter(v => v.status === 'submitted').map(withEntity).sort((a, b) => (a.logged_at || a.visited_at || '').localeCompare(b.logged_at || b.visited_at || ''));   // in the order they were submitted
  const bname = new Map(all('branches').map(b => [b.code, b.name]));
  admPane('verify').innerHTML = rows.length ? `<p class="hint" style="margin-top:0">${rows.length} report${rows.length > 1 ? 's' : ''} waiting, in the order they were submitted (oldest first). Open one, look at the photos and details, then tap <b>Verify</b>.</p>
    <div class="list">${rows.map(v => `<button class="item" data-v="${v.id}">
        <div class="avatar">${esc(initials(personName(v.visitor)))}</div>
        <div class="grow"><div class="t">${esc(v.entity.name)} · V${v.visit_no}</div>
          <div class="s">${esc(personName(v.visitor))} · ${esc(bname.get(v.visitor_branch) || '')} · Submitted ${fmtDateTime(v.logged_at || v.visited_at)}</div></div>
        <span class="chev">${ICON.chev}</span></button>`).join('')}</div>`
    : emptyState(ICON.shield, 'Nothing waiting', 'Every submitted visit report has been verified.');
  $$('[data-v]', admPane('verify')).forEach(b => b.onclick = () => openVisit(b.dataset.v));
}

/* ───────── Requests (admin) ───────── */
const RQ_LABEL = { delete_visit: 'Delete a visit', delete_assignment: 'Remove an allotment', reassign: 'Reassign an allotment', unverify: 'Unverify a visit (to edit)' };
async function admRequests() {
  const { pending, done } = qRequests();
  const target = r => r.visit ? `${esc(r.visit.entity.name)} · Visit ${r.visit.visit_no}` : r.assignment ? `${esc(r.assignment.entity.name)} · scheduled ${fmtDate(r.assignment.scheduled_on)}` : '<i>no longer exists</i>';
  admPane('requests').innerHTML = `
    ${pending.length ? pending.map(r => `<div class="card">
        <div class="row"><span class="badge warn">${RQ_LABEL[r.kind]}</span><span class="grow"></span><span class="hint">${ago(r.created_at)}</span></div>
        <h3 style="margin-top:10px">${target(r)}</h3>
        <p class="hint" style="margin:2px 0 8px">From ${esc(personName(r.raised_by))}</p>
        <div class="note">"${esc(r.reason)}"</div>
        <input class="input" id="nt-${r.id}" placeholder="Note to them (optional)" style="margin-top:10px">
        <div class="row" style="margin-top:10px">
          ${r.visit_id ? `<button class="btn ghost small" data-open="${r.visit_id}">View visit</button>` : ''}
          <span class="grow"></span>
          <button class="btn ghost small" data-dec="${r.id}">Decline</button>
          ${r.kind === 'reassign' && r.assignment && r.assignment.status === 'open' ? `<button class="btn small" data-reas="${r.id}">Reassign…</button>`
            : r.kind === 'reassign' ? '' : `<button class="btn small" data-ok="${r.id}">Approve</button>`}</div></div>`).join('')
      : emptyState(ICON.shield, 'No requests waiting', 'When staff ask to delete a visit, remove or reassign an allotment, or unverify a visit to correct it, the request lands here for you to approve or decline.')}
    ${done.length ? `<h2>Recently decided</h2><div class="list">${done.map(r => `<div class="item" style="cursor:default"><div class="grow">
        <div class="t">${RQ_LABEL[r.kind]}</div><div class="s">${target(r)} · ${esc(personName(r.raised_by))}${r.decision_note ? ' · ' + esc(r.decision_note) : ''}</div></div>
        <span class="badge ${r.status === 'approved' ? 'ok' : ''}">${r.status === 'approved' ? 'Approved' : 'Declined'}</span></div>`).join('')}</div>` : ''}`;
  $$('[data-open]', admPane('requests')).forEach(b => b.onclick = () => openVisit(b.dataset.open));
  const decide = async (id, approve) => {
    const r = pending.find(x => x.id === id);
    const note = ($('#nt-' + id) || {}).value || null;
    const to = null;   // reassign requests are approved through openReassignRequest
    try {
      if (approve && r.kind === 'delete_visit' && r.visit_id) {
        const ph = all('photos').filter(p => p.visit_id === r.visit_id);
        if (ph.length) await sb.storage.from('photos').remove(withThumbs(ph.map(p => p.path)));
      }
      await rpc('decide_request', { p_request: id, p_approve: approve, p_note: note, p_to: to });
      // apply the decision to the phone's copy
      patch('requests', id, { status: approve ? 'approved' : 'declined', decision_note: note, decided_at: new Date().toISOString(), decided_by: S.who.gmail });
      if (r.assignment_id) DB.holds.delete(r.assignment_id);
      if (approve) {
        if (r.kind === 'delete_visit' && r.visit_id) dropVisit(r.visit_id);
        if (r.kind === 'delete_assignment' && r.assignment_id) patch('assignments', r.assignment_id, { status: 'cancelled' });
        if (r.kind === 'reassign' && r.assignment_id) patch('assignments', r.assignment_id, { assignee: to });
        if (r.kind === 'unverify' && r.visit_id) patch('visits', r.visit_id, { status: 'submitted', verified_at: null, verified_by: null });
      }
      toast(approve ? 'Approved' : 'Declined'); admRequests(); adminBadges();
    } catch (e) { toast(errText(e)); }
  };
  $$('[data-ok]', admPane('requests')).forEach(b => b.onclick = () => decide(b.dataset.ok, true));
  $$('[data-dec]', admPane('requests')).forEach(b => b.onclick = () => decide(b.dataset.dec, false));
  $$('[data-reas]', admPane('requests')).forEach(b => b.onclick = () => openReassignRequest(pending.find(x => x.id === b.dataset.reas)));
}

/* Approving a reassign request: the same picker as Reallot (who, with their pending load; visit-by date; note for staff) */
function openReassignRequest(r) {
  const cur = r.assignment, today = todayISO();
  const body = openSheet('Reassign', `
    <p class="muted" style="margin-top:0"><b>${esc(cur.entity.name)}</b> · allotted to ${esc(cleanName(personName(r.raised_by)))}, scheduled ${fmtDate(cur.scheduled_on)}</p>
    <div class="note" style="margin-bottom:6px">${esc(cleanName(personName(r.raised_by)))} asked: "${esc(r.reason)}"</div>
    ${allotFieldsHTML(cur, false, { date: cur.scheduled_on && cur.scheduled_on >= today ? cur.scheduled_on : plusDays(7) })}
    <label class="f" for="rr-nt">Reply to ${esc(cleanName(personName(r.raised_by)))} <span class="hint">(optional)</span></label>
    <input class="input" id="rr-nt" placeholder="e.g. Given to the Pali branch" value="${esc(($('#nt-' + r.id) || {}).value || '')}">
    <p class="hint" id="al-err" style="color:var(--bad)"></p>
    <button class="btn block" id="rr-go">Reassign</button>`);
  const val = bindAllotFields(body, cur, { startEmpty: true, exclude: r.raised_by, noReason: true });
  $('#rr-go', body).onclick = async () => {
    const v = val(), b = $('#rr-go', body), e = $('#al-err', body);
    if (!v.to) { e.textContent = 'Pick who should visit.'; return; }
    if (!v.date) { e.textContent = 'Pick a visit date.'; return; }
    b.disabled = true; e.textContent = '';
    const note = $('#rr-nt', body).value.trim() || null;
    try { await rpc('decide_request', { p_request: r.id, p_approve: true, p_note: note, p_to: v.to }); }   // approves and reassigns, keeping the request's reason in the history
    catch (err) { b.disabled = false; e.textContent = errText(err); return; }
    patch('requests', r.id, { status: 'approved', decision_note: note, decided_at: new Date().toISOString(), decided_by: S.who.gmail });
    DB.holds.delete(cur.id);
    patch('assignments', cur.id, { assignee: v.to });
    let warn = '';
    if (v.date !== cur.scheduled_on || v.note !== (cur.note || '')) {   // then the new date and note
      try { put('assignments', await rpc('admin_update_allotment', { p_assignment: cur.id, p_to: v.to, p_date: v.date, p_note: v.note, p_reason: null })); }
      catch (err) { warn = ` The new date or note was not saved (${errText(err)}): use Reallot on the place.`; }
    }
    closeSheet(); toast(`Reassigned to ${personName(v.to)}.${warn}`, warn ? 6000 : 3000); admRequests(); adminBadges();
  };
}

/* ───────── People ───────── */
/* People lives in the Visits tab (admin and viewers); after an admin action, redraw it there */
async function admPeople(fresh = true) { const el = $('#main > .tabview[data-tab="visits"] .pane[data-pane="people"]'); if (el) return drawPeople(el, 'admin', fresh); }

/* People list. mode 'admin' (admin, in Visits → People: full controls) or 'viewer' (Visits → People: read-only).
   Pills: Due, All, Signed up, Not yet, Branch heads, Viewers & admins (+ Blocked, Inactive for admin); a branch dropdown. */
async function drawPeople(el, mode, fresh = true) {
  const adm = mode === 'admin';
  const key = adm ? 'people' : 'vpeople';
  if (fresh || !S.cache[key]) S.cache[key] = adm ? await rpc('admin_people') : await rpc('viewer_people');
  const everyone = S.cache[key];
  const nlog = p => adm ? p.logins.length : (p.signins || 0);
  const br = S.cache.peopleBranch || '';
  const inBr = p => !br || String(p.branch_code) === br;
  const all = everyone.filter(inBr);
  const act = all.filter(p => p.active);
  const f = S.cache.peopleFilter || 'due';
  const due = pendingByEmp();
  const filters = {
    due: ['Due', act.filter(p => due.has(p.emp_id)).sort((a, b) => due.get(b.emp_id).late - due.get(a.emp_id).late || due.get(b.emp_id).n - due.get(a.emp_id).n)],
    all: ['All', act],
    linked: ['Signed up', act.filter(p => nlog(p))],
    pending: ['Not yet', act.filter(p => !nlog(p))],
    heads: ['Branch heads', act.filter(p => p.is_branch_head)],
    roles: ['Viewers & admins', act.filter(p => p.role !== 'field')],
    ...(adm ? { blocked: ['Blocked', all.filter(p => p.blocked)], inactive: ['Inactive', all.filter(p => !p.active)] } : {})
  };
  const branches = [...new Map(everyone.filter(p => p.active && p.branch_code != null).map(p => [String(p.branch_code), p.branch || '—'])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]));
  el.innerHTML = `
    <div class="row" style="margin-bottom:10px;gap:8px">
      <select class="input dsel" id="pbr" aria-label="Branch"><option value="">Branch: all</option>${branches.map(([c, n]) => `<option value="${c}" ${c === br ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
      ${adm ? `<button class="btn small soft" id="ub" style="flex:none">${ICON.upload} Upload udairo.js</button><input type="file" id="uf" accept=".js,text/javascript,application/javascript" hidden>` : ''}
    </div>
    <div class="hint" style="margin:-4px 0 8px">${act.length} staff${br ? '' : ` in ${new Set(act.map(p => p.branch_code)).size} branches`}</div>
    ${searchHTML('pq', adm ? 'Name, emp ID, branch or Gmail' : 'Name, emp ID or branch', S.cache.peopleQ || '')}
    <div class="chips">${Object.entries(filters).filter(([k, v]) => k === 'all' || v[1].length || k === f).map(([k, v]) =>
      `<button class="chip ${f === k ? 'on' : ''}" data-pf="${k}">${v[0]}<b>${v[1].length}</b></button>`).join('')}</div>
    <div class="hint sline" id="pqs" hidden></div>
    <div class="list" id="plist"></div>`;
  const draw = () => {
    const t = ($('#pq', el).value || '').trim().toLowerCase(); S.cache.peopleQ = t;
    const set = (filters[f] || filters.all)[1];
    const rows = set.filter(p => !t || [p.name, p.emp_id, p.branch, p.designation, ...(adm ? p.logins.map(l => l.gmail) : [])].join(' ').toLowerCase().includes(t));
    searchSummary($('#pqs', el), { shown: rows.length, of: set.length, noun: 'people', filters: [f !== 'all' && (filters[f] || [])[0], br && ($('#pbr option:checked', el) || {}).textContent], q: $('#pq', el).value.trim(),
      onClear: () => { $('#pq', el).value = ''; $('#pq', el).dispatchEvent(new Event('input')); } });
    $('#plist', el).innerHTML = rows.length ? rows.map(p => `<button class="item" data-emp="${p.emp_id}">
        <div class="avatar">${esc(initials(p.name))}</div>
        <div class="grow"><div class="t">${esc(cleanName(p.name))}</div>
          <div class="s">${esc(p.designation || '')} · ${esc(p.branch || '')}</div></div>
        <div style="text-align:right;flex:none;display:flex;flex-direction:column;gap:4px;align-items:flex-end">
          ${f === 'due' ? `<span class="badge warn">${due.get(p.emp_id).n} pending</span>${due.get(p.emp_id).late ? `<span class="badge bad">${due.get(p.emp_id).late} overdue</span>` : ''}` : p.blocked ? '<span class="badge bad">Blocked</span>' : !p.active ? '<span class="badge">Inactive</span>'
            : nlog(p) ? `<span class="badge ok">${adm && nlog(p) > 1 ? nlog(p) + ' sign-ins' : 'Signed up'}</span>` : '<span class="badge">Not yet</span>'}
          ${f !== 'due' && p.role !== 'field' ? `<span class="badge acc">${roleLabel(p.role)}</span>` : ''}
        </div></button>`).join('') : emptyState(ICON.search, 'No one matches', 'Try part of a name, an Emp ID or a branch.');
  };
  draw();
  $('#pq', el).oninput = draw; bindSearch($('#pq', el), draw);
  $('#pbr', el).onchange = e => { S.cache.peopleBranch = e.target.value; drawPeople(el, mode, false); };
  $$('[data-pf]', el).forEach(b => b.onclick = () => { S.cache.peopleFilter = b.dataset.pf; drawPeople(el, mode, false); });
  $('#plist', el).onclick = e => { const b = e.target.closest('[data-emp]'); if (b) (adm ? openPerson(+b.dataset.emp) : openStaff(+b.dataset.emp)); };
  if (adm) {
    $('#ub', el).onclick = () => $('#uf', el).click();
    $('#uf', el).onchange = e => { const file = e.target.files[0]; e.target.value = ''; if (file) staffUpload(file); };
  }
}

/* Allotments not visited yet (by them or a colleague), per person: { n, late } — from the phone's copy */
function pendingByEmp() {
  const today = todayISO(), m = new Map();
  const vs = liveVisits().filter(v => v.status !== 'returned'), byAsg = new Set(vs.filter(v => v.assignment_id).map(v => v.assignment_id));
  const held = new Set(all('requests').filter(r => r.status === 'pending' && r.assignment_id).map(r => r.assignment_id));
  for (const a of openAsg()) {
    if (byAsg.has(a.id) || held.has(a.id)) continue;
    if (vs.some(v => v.entity_id === a.entity_id && v.visitor !== a.assignee)) continue;   // a colleague visited
    const c = m.get(a.assignee) || { n: 0, late: 0 };
    c.n++; if (a.scheduled_on && a.scheduled_on < today) c.late++;
    m.set(a.assignee, c);
  }
  return m;
}

function openPerson(emp) {
  const p = S.cache.people.find(x => x.emp_id === emp); if (!p) return;
  const isMe = S.who.me && S.who.me.emp_id === emp;
  const phone = (p.phone || '').replace(/\D/g, '').slice(-10);
  const body = openSheet(cleanName(p.name), `
    <div class="row wrap" style="margin-bottom:12px">
      <span class="badge acc">${roleLabel(p.role)}</span>${p.is_branch_head ? '<span class="badge ok">Branch head</span>' : ''}
      ${p.blocked ? '<span class="badge bad">Blocked</span>' : ''}${!p.active ? '<span class="badge">Not in staff list</span>' : ''}</div>
    <dl class="kv">
      <dt>Emp ID</dt><dd class="mono">${p.emp_id}</dd>
      <dt>Designation</dt><dd>${esc(p.designation || '—')}</dd>
      <dt>Branch</dt><dd>${esc(p.branch || '—')}</dd>
      <dt>Phone</dt><dd class="mono">${esc(p.phone || '—')}</dd>
      <dt>Email on file</dt><dd>${esc(p.email || '—')}</dd>
      <dt>Date of birth</dt><dd class="mono">${esc(p.dob || '—')}</dd>
      <dt>Last used</dt><dd>${ago(p.last_seen)}</dd>
    </dl>
    ${phone.length === 10 ? `<div class="row" style="margin-top:14px">
      <a class="btn soft grow" href="tel:+91${phone}">${ICON.phone} Call</a>
      <a class="btn soft grow" target="_blank" rel="noopener" href="https://wa.me/91${phone}?text=${encodeURIComponent(`Dear ${cleanName(p.name)}, please sign in to TASC Connect (tap "Sign in with your name"): ${location.origin + location.pathname}`)}">${ICON.wa} Invite on WhatsApp</a></div>` : ''}

    <h2>Visits</h2><div id="sw"></div>
    <h2>Phones and Gmails</h2>
    ${p.logins.length ? `<div class="list">${p.logins.map(l => `<div class="item" style="cursor:default">
        <div class="grow"><div class="t" style="overflow-wrap:anywhere">${esc(loginLabel(l.gmail))}</div>
          <div class="s">via ${{ email: 'staff-list email', dob: 'Gmail + date of birth', admin: 'admin', device: 'name + date of birth' }[l.via] || l.via} · ${fmtDate(l.linked_at)} · used ${ago(l.last_seen)}</div></div>
        <button class="btn small danger" data-unlink="${esc(l.gmail)}">Remove</button></div>`).join('')}</div>`
      : '<p class="hint">Hasn\'t signed in yet.</p>'}
    <div class="row" style="margin-top:10px"><input class="input grow" id="lg" type="email" placeholder="Add a Gmail for them" autocomplete="off">
      <button class="btn small" id="lgb" style="min-height:44px">Link</button></div>

    <h2>Role</h2>
    <select class="input" id="role" ${isMe ? 'disabled' : ''}>
      <option value="field" ${p.role === 'field' ? 'selected' : ''}>Field staff: own visits</option>
      <option value="viewer" ${p.role === 'viewer' ? 'selected' : ''}>Viewer: sees everything, read-only</option>
      <option value="admin" ${p.role === 'admin' ? 'selected' : ''}>Admin: full control</option>
    </select>
    ${isMe ? '<p class="hint">You can\'t change your own role.</p>' : ''}

    <h2>Access</h2>
    ${isMe ? '<p class="hint">You can\'t block yourself.</p>' : `<button class="btn block ${p.blocked ? 'soft' : 'danger'}" id="blk">${p.blocked ? 'Unblock: allow access again' : 'Block: cut off access on every device now'}</button>`}
  `);
  loadStaffWork($('#sw', body), emp);
  const refresh = async (msg) => { toast(msg); S.cache.people = await rpc('admin_people'); closeSheet(); admPeople(false); openPerson(emp); };
  $$('[data-unlink]', body).forEach(b => b.onclick = async () => {
    if (!await confirmSheet('Remove this sign-in?', `<b>${esc(loginLabel(b.dataset.unlink))}</b> will no longer open ${esc(cleanName(p.name))}'s profile.`, 'Remove', true)) return openPerson(emp);
    try { await rpc('admin_unlink', { p_gmail: b.dataset.unlink }); await refresh('Removed'); } catch (e) { toast(errText(e)); }
  });
  $('#lgb', body).onclick = async () => {
    const g = $('#lg', body).value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(g)) { toast('Enter a valid Gmail address'); return; }
    try { await rpc('admin_link', { p_gmail: g, p_emp: emp }); await refresh('Linked'); } catch (e) { toast(errText(e)); }
  };
  $('#role', body).onchange = async e => {
    try { await rpc('admin_set_role', { p_emp: emp, p_role: e.target.value }); await refresh('Role updated'); } catch (err) { toast(errText(err)); }
  };
  const blk = $('#blk', body);
  if (blk) blk.onclick = async () => {
    if (!p.blocked && !await confirmSheet('Block this person?', `${esc(cleanName(p.name))} loses access to TASC Connect at once, on every device, until you unblock them. Their visits stay.`, 'Block', true)) return openPerson(emp);
    try { await rpc('admin_set_blocked', { p_emp: emp, p_blocked: !p.blocked }); await refresh(p.blocked ? 'Unblocked' : 'Blocked'); } catch (e) { toast(errText(e)); }
  };
}

/* Staff list upload (from People): check what changes, then apply. */
async function staffUpload(file) {
  const people = S.cache.people || await rpc('admin_people');
  const text = await file.text();
  if (!/UDAIRO_DATA/.test(text)) { toast('That is not the staff list file. Please pick udairo.js.'); return; }
  let D;
  try { D = new Function(text + ';return UDAIRO_DATA;')(); } catch (err) { toast('Could not read that file.'); return; }
  if (!D || !Array.isArray(D.branches)) { toast('That file has no branches in it.'); return; }
  // Send only what TASC Connect needs (no DOJ, FTP, etc.).
  const slim = { branches: D.branches.map(b => ({ branchCode: b.branchCode, branchName: b.branchName, lat: b.lat, lng: b.lng, mobile: b.mobile, size: b.size,
    staff: (b.staff || []).map(s => ({ empId: s.empId, name: s.name, designation: s.designation, grade: s.grade, phone: s.phone, email: s.email, dob: s.dob, dept: s.dept, secondInCommand: !!s.secondInCommand })) })) };
  const incoming = new Map(slim.branches.flatMap(b => b.staff.map(s => [s.empId, { ...s, branch: b.branchName }])));
  const current = new Map(people.filter(p => p.active).map(p => [p.emp_id, p]));
  const added = [...incoming.values()].filter(s => !current.has(s.empId));
  const gone = [...current.values()].filter(p => !incoming.has(p.emp_id));
  const moved = [...incoming.values()].filter(s => current.has(s.empId) && current.get(s.empId).branch !== s.branch);
  const li = (arr, f) => arr.slice(0, 30).map(f).join('') + (arr.length > 30 ? `<div class="item"><span class="hint">and ${arr.length - 30} more</span></div>` : '');
  const body = openSheet('Update staff list', `<p class="muted" style="margin-top:0">Matching is by Emp ID: changes are updated, new people added, and anyone missing is marked inactive (their visits stay).</p>
    <div class="note"><b>${incoming.size} staff in ${slim.branches.length} branches.</b> Please check before applying.</div>
    ${added.length ? `<h2>New (${added.length})</h2><div class="list">${li(added, s => `<div class="item"><div class="grow"><div class="t">${esc(cleanName(s.name))}</div><div class="s">${esc(s.designation)} · ${esc(s.branch)}</div></div></div>`)}</div>` : ''}
    ${moved.length ? `<h2>Moved (${moved.length})</h2><div class="list">${li(moved, s => `<div class="item"><div class="grow"><div class="t">${esc(cleanName(s.name))}</div><div class="s">${esc(current.get(s.empId).branch)} → ${esc(s.branch)}</div></div></div>`)}</div>` : ''}
    ${gone.length ? `<h2>Will be marked inactive (${gone.length})</h2><div class="list">${li(gone, p => `<div class="item"><div class="grow"><div class="t">${esc(cleanName(p.name))}</div><div class="s">${esc(p.branch || '')}</div></div></div>`)}</div>` : ''}
    ${!added.length && !moved.length && !gone.length ? '<p class="hint">No joins, moves or exits. Names, phones and other details will be refreshed.</p>' : ''}
    <div class="row" style="margin-top:14px"><button class="btn ghost grow" id="ucan">Cancel</button><button class="btn grow" id="uok">Apply</button></div>`);
  $('#ucan', body).onclick = () => closeSheet();
  $('#uok', body).onclick = async () => {
    $('#uok', body).disabled = true;
    try {
      const r = await rpc('admin_import_directory', { d: slim });
      S.cache.people = null;
      closeSheet();
      toast(`Updated: ${r.staff} staff, ${r.new} new, ${r.inactivated} marked inactive`, 4000);
      syncNow().catch(() => {});   // bring the new staff list into the phone's copy
      admPeople(true);
    } catch (err) { $('#uok', body).disabled = false; toast(errText(err)); }
  };
}

/* ───────── Activity ───────── */
const ACT = {
  login_linked: (a) => a.detail?.via === 'device' ? `linked a phone to ${esc(cleanName(a.target_name || a.target))} (name + date of birth)`
    : `linked ${esc(a.detail?.gmail || 'a Gmail')} to ${esc(cleanName(a.target_name || a.target))}${a.detail?.via === 'dob' ? ' (name + date of birth)' : a.detail?.via === 'email' ? ' (staff-list email)' : ' (admin)'}`,
  login_unlinked: (a) => `removed ${String(a.detail?.gmail || '').startsWith('device:') ? 'a phone sign-in' : esc(a.detail?.gmail || 'a Gmail')} from ${esc(cleanName(a.target_name || a.target))}`,
  claim_failed: (a) => `tried to open ${esc(cleanName(a.target_name || a.target))}'s profile with a wrong date of birth (${String(a.detail?.gmail || '').startsWith('device:') ? 'from a phone' : esc(a.detail?.gmail || '')})`,
  allotted: (a) => `allotted ${esc(a.detail?.entity || 'a place')} to ${esc(cleanName(a.target_name || a.target))}${a.detail?.on ? ', visit by ' + fmtDate(a.detail.on) : ''}`,
  directory_imported: (a) => `uploaded the staff list: ${a.detail?.staff} staff, ${a.detail?.new} new, ${a.detail?.inactivated} marked inactive`,
  role_set: (a) => `made ${esc(cleanName(a.target_name || a.target))} ${roleLabel(a.detail?.role).toLowerCase()}`,
  person_blocked: (a) => `blocked ${esc(cleanName(a.target_name || a.target))}`,
  person_unblocked: (a) => `unblocked ${esc(cleanName(a.target_name || a.target))}`,
  visit_logged: (a) => `logged visit ${esc(a.detail?.visit_no || '')} at ${esc(a.detail?.entity || 'a place')}`,
  visit_verified: () => 'verified a visit',
  visit_returned: (a) => `sent back ${esc(cleanName(a.target_name || a.target))}'s report on ${esc(a.detail?.entity || 'a place')}: "${esc(a.detail?.note || '')}"`,
  visit_resubmitted: (a) => `resubmitted the report on ${esc(a.detail?.entity || 'a place')}`,
  visit_unverified: (a) => `unverified ${a.detail?.entity ? 'the report on ' + esc(a.detail.entity) : 'a visit'}${a.detail?.reason ? `: "${esc(a.detail.reason)}"` : ''}`,
  request_raised: (a) => `raised a ${String(a.detail?.kind || '').replace('_', ' ')} request`,
  request_decided: (a) => `${a.detail?.approved ? 'approved' : 'declined'} a request`,
  assignment_reassigned: (a) => a.detail?.entity ? `reallotted ${esc(a.detail.entity)} to ${esc(cleanName(a.target_name || personName(+a.detail.to)))}` : 'reassigned a visit',
  place_reopened: () => 'reopened a closed place',
  place_duplicate: (a) => `marked ${esc(a.detail?.entity || 'a place')} as duplicate${a.detail?.note ? `: "${esc(a.detail.note)}"` : ''}`,
  place_not_duplicate: (a) => `marked ${esc(a.detail?.entity || 'a place')} as not duplicate`,
  place_deleted: (a) => `deleted the place ${esc(a.detail?.entity || '')}${a.detail?.visits ? ` with ${a.detail.visits} visit report${a.detail.visits > 1 ? 's' : ''}` : ''}`
};
/* What each filter shows */
const ACT_KINDS = {
  attention: ['Attention', ['claim_failed', 'person_blocked', 'person_unblocked', 'role_set', 'login_unlinked', 'place_deleted', 'place_duplicate', 'place_not_duplicate']],
  all: ['All', null],
  visits: ['Visits', ['visit_logged', 'visit_verified', 'visit_unverified', 'visit_returned', 'visit_resubmitted', 'request_raised', 'request_decided']],
  people: ['People', ['login_linked', 'login_unlinked', 'claim_failed', 'role_set', 'person_blocked', 'person_unblocked', 'directory_imported']],
  places: ['Places', ['allotted', 'assignment_reassigned', 'place_reopened', 'place_deleted', 'place_duplicate', 'place_not_duplicate']]
};
/* A run of 3+ of these by the same person within 30 minutes shows as one line you can open */
const ACT_BULK = { allotted: ['allotted', 'places'], visit_verified: ['verified', 'visits'], visit_logged: ['logged', 'visits'],
  login_linked: ['linked', 'sign-ins'], assignment_reassigned: ['reallotted', 'places'] };
const AC = { kind: 'attention', q: '', rows: [], more: false, legacy: false, open: new Set(), t: 0 };
const actDay = d => { const k = new Date(d).toLocaleDateString('en-CA'), t = new Date(), y = new Date(t.getTime() - 864e5);
  return k === t.toLocaleDateString('en-CA') ? 'Today' : k === y.toLocaleDateString('en-CA') ? 'Yesterday'
    : new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: new Date(d).getFullYear() === t.getFullYear() ? undefined : 'numeric' }); };
const actTime = d => new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
const actWho = a => a.actor ? cleanName(a.actor) : (a.actor_gmail || 'Setup');

async function actFetch(more) {
  const acts = ACT_KINDS[AC.kind][1], last = more ? AC.rows[AC.rows.length - 1] : null;
  if (!AC.legacy) {
    try {
      const rows = await rpc('admin_activity_v2', { p_before: last ? last.at : null, p_before_id: last ? last.id : null, p_limit: 50, p_actions: acts, p_q: AC.q || null });
      AC.rows = more ? AC.rows.concat(rows) : rows; AC.more = rows.length === 50; return;
    } catch (e) {
      if (!/admin_activity_v2|PGRST202|404|schema cache/i.test(String(e && (e.message || e.code || e)))) throw e;
      AC.legacy = true;   // the database has not had sql/19 yet: the old list, filtered here
    }
  }
  let rows = await rpc('admin_activity', { p_limit: 150 });
  if (acts) rows = rows.filter(a => acts.includes(a.action));
  if (AC.q) { const t = AC.q.toLowerCase(); rows = rows.filter(a => (actWho(a) + ' ' + (a.target_name || '') + ' ' + JSON.stringify(a.detail || {})).toLowerCase().includes(t)); }
  AC.rows = rows; AC.more = false;
}
function actLine(a) {
  const bad = a.action === 'claim_failed' || a.action === 'person_blocked';
  return `<div class="item" style="cursor:default;align-items:flex-start">
    <div class="grow"><div style="font-size:14px"><b>${esc(actWho(a))}</b> ${(ACT[a.action] || (() => esc(a.action)))(a)}</div><div class="s">${actTime(a.at)}</div></div>
    ${bad ? '<span class="badge bad">Check</span>' : ''}</div>`;
}
function actHTML() {
  const rows = AC.rows; let out = '', day = '', i = 0;
  while (i < rows.length) {
    const a = rows[i], d = actDay(a.at);
    if (d !== day) { day = d; out += `<div class="hint" style="margin:14px 0 4px;font-weight:600">${esc(d)}</div>`; }
    let j = i + 1;
    if (ACT_BULK[a.action]) while (j < rows.length && rows[j].action === a.action && rows[j].actor_gmail === a.actor_gmail && rows[j].actor === a.actor
      && actDay(rows[j].at) === d && Math.abs(new Date(rows[j - 1].at) - new Date(rows[j].at)) < 18e5) j++;
    if (j - i >= 3) {
      const b = ACT_BULK[a.action], key = a.id != null ? a.id : a.at, run = rows.slice(i, j), open = AC.open.has(key);
      out += `<div class="item" data-run="${esc(String(key))}" style="align-items:flex-start;cursor:pointer"><div class="grow"><div style="font-size:14px"><b>${esc(actWho(a))}</b> ${b[0]} ${run.length} ${b[1]}</div>
        <div class="s">${actTime(run[run.length - 1].at)}–${actTime(a.at)} · tap to ${open ? 'hide' : 'see each'}</div></div></div>`;
      if (open) out += `<div style="margin-left:12px;border-left:2px solid var(--line, #ddd)">${run.map(actLine).join('')}</div>`;
    } else out += rows.slice(i, j).map(actLine).join('');
    i = j;
  }
  return out;
}
async function admActivity() {
  const el = admPane('activity');
  if (!el.dataset.ready) {
    el.dataset.ready = '1';
    el.innerHTML = `${searchHTML('aq', 'Person or place', AC.q)}
      <div class="chips" id="akinds">${Object.entries(ACT_KINDS).map(([k, v]) => `<button class="chip" data-k="${k}">${v[0]}</button>`).join('')}</div>
      <div id="alist"></div><button class="btn ghost block small" id="amore" hidden style="margin-top:12px">Load more</button>`;
    const reload = async () => { await draw(false); };
    $('#aq', el).oninput = e => { clearTimeout(AC.t); AC.t = setTimeout(() => { AC.q = e.target.value.trim(); reload(); }, 350); };
    bindSearch($('#aq', el), () => { clearTimeout(AC.t); AC.q = ''; reload(); });
    $$('[data-k]', el).forEach(b => b.onclick = () => { AC.kind = b.dataset.k; reload(); });
    $('#amore', el).onclick = async () => { $('#amore', el).disabled = true; try { await draw(true); } finally { $('#amore', el).disabled = false; } };
    el._draw = draw;
  }
  async function draw(more) {
    $$('[data-k]', el).forEach(b => b.classList.toggle('on', b.dataset.k === AC.kind));
    const box = $('#alist', el);
    if (!more) box.innerHTML = '<div class="hint" style="margin-top:12px">Loading…</div>';
    try { await actFetch(more); } catch (e) { box.innerHTML = `<div class="hint" style="color:var(--bad)">${esc(errText(e))}</div>`; return; }
    box.innerHTML = AC.rows.length ? actHTML() : emptyState(ICON.user, AC.kind === 'attention' && !AC.q ? 'Nothing needs attention' : 'Nothing found',
      AC.kind === 'attention' && !AC.q ? 'Wrong date-of-birth tries, blocks, role changes and removed sign-ins will show here. Tap All to see everything.' : 'Try another filter or name.');
    bindRuns(box);
    $('#amore', el).hidden = !AC.more;
    if (AC.legacy && !el.querySelector('#alegacy')) box.insertAdjacentHTML('beforebegin', '<p class="hint" id="alegacy">Showing the latest 150 only. Run <b>sql/19_update_v52.sql</b> in Supabase for older entries and faster search.</p>');
  }
  function bindRuns(box) { $$('[data-run]', box).forEach(b => b.onclick = () => { const k = b.dataset.run, key = isNaN(+k) ? k : +k; AC.open.has(key) ? AC.open.delete(key) : AC.open.add(key); box.innerHTML = actHTML(); bindRuns(box); }); }
  await draw(false);
}
