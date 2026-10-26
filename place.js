/* TASC Connect · places (search, add new), a place's page with its visit history, and a visit's full view. */

/* Places come from the phone's copy. */
async function loadEntities() { return all('entities').sort((a, b) => a.name.localeCompare(b.name)); }

/* ───────── Places tab segment ─────────
   Pills filter by allotment state (same rules as the Dashboard): Allotted · Overdue · Visited · Verified · Accounts opened · Not allotted. */
const PLACE_PILLS = [['all', 'All'], ['allotted', 'Allotted'], ['overdue', 'Overdue'], ['visited', 'Visited'], ['verified', 'Verified'], ['opened', 'Accounts opened'], ['free', 'Not allotted']];

function placeSets(list) {
  const rows = dashModel(qDash(), {}).rows;
  const s = { allotted: new Set(), overdue: new Set(), visited: new Set(), verified: new Set() };
  rows.forEach(r => {
    const id = r.a.entity.id; s.allotted.add(id);
    if (r.st === 'overdue') s.overdue.add(id);
    if (r.v) s.visited.add(id);
    if (r.st === 'verified') s.verified.add(id);
  });
  s.opened = new Set(list.filter(e => e.closure === 'account_opened').map(e => e.id));
  s.free = new Set(list.filter(e => !s.allotted.has(e.id)).map(e => e.id));
  return { sets: s, rows };
}

async function drawPlaces(el) {
  if (!el.children.length || el.querySelector(':scope > .spin')) el.innerHTML = '<div class="spin"></div>';
  let list;
  try { list = await loadEntities(); } catch (e) { el.innerHTML = `<div class="empty">${esc(errText(e))}</div>`; return; }
  const dups = list.filter(e => e.is_duplicate), seeDup = S.who.admin || S.who.viewer;
  list = list.filter(e => !e.is_duplicate);   // duplicates show only under their own pill (admin and viewers)
  const { sets, rows } = placeSets(list);
  if (seeDup && dups.length) sets.dup = new Set(dups.map(e => e.id));
  const info = placeInfo(rows);
  let f = S.cache.placeF || 'all'; if (f !== 'all' && !sets[f]) f = 'all';
  const count = k => k === 'all' ? list.length : sets[k].size;
  const pills = PLACE_PILLS.concat(sets.dup ? [['dup', 'Duplicates']] : []);
  el.innerHTML = `<div class="row" style="margin-bottom:10px;gap:8px">${searchHTML('eq', 'Search places', S.cache.placeQ || '', 'grow')}
      <button class="btn soft" id="addp" style="flex:none;min-height:44px;padding:0 14px">+ Add place</button></div>
    <div class="chips wrap" id="pf">${pills.map(([k, l]) => `<button class="chip ${f === k ? 'on' : ''} ${k === 'overdue' && count(k) && f !== k ? 'hot' : ''}" data-pf="${k}">${l}<b>${count(k)}</b></button>`).join('')}</div>
    <div class="hint sline" id="eqs" hidden></div>
    <div class="list" id="el"></div>`;
  const draw = () => {
    const t = $('#eq').value.trim().toLowerCase(); S.cache.placeQ = t;
    const base = (f === 'dup' ? dups : list).filter(e => f === 'all' || sets[f].has(e.id));
    let rs = (f === 'dup' ? dups : list).filter(e => (f === 'all' || sets[f].has(e.id)) && (!t || (e.name + ' ' + (e.area || '') + ' ' + e.type + ' ' + (e.address || '')).toLowerCase().includes(t)));
    if (f === 'overdue') rs.sort((a, b) => (info.get(b.id)?.late || 0) - (info.get(a.id)?.late || 0));
    searchSummary($('#eqs'), { shown: rs.length, of: base.length, noun: 'places', filters: [f !== 'all' && (pills.find(x => x[0] === f) || [])[1]], q: $('#eq').value.trim(), onClear: () => { $('#eq').value = ''; $('#eq').dispatchEvent(new Event('input')); } });
    const more = rs.length > 150 ? rs.length - 150 : 0; rs = rs.slice(0, 150);
    $('#el').innerHTML = rs.length ? rs.map(e => `<button class="item" data-e="${e.id}"><div class="grow"><div class="t">${esc(e.name)}</div>
        <div class="s">${esc(e.type)}${e.area ? ' · ' + esc(e.area) : ''}</div>${e.is_duplicate ? (e.duplicate_note ? `<div class="s">${esc(e.duplicate_note)}</div>` : '') : placeLine(e, info.get(e.id))}</div>${e.is_duplicate ? '<span class="badge">Duplicate</span>' : placeBadge(e, info.get(e.id))}</button>`).join('')
        + (more ? `<div class="item" style="cursor:default"><span class="hint">and ${more} more. Search to narrow.</span></div>` : '')
      : emptyState(ICON.search, t ? 'No place by that name' : 'Nothing here', t ? 'Check the spelling, or add it as a new place with the button below.' : 'No places in this group right now.');
  };
  draw();
  $('#eq').oninput = draw; bindSearch($('#eq'), draw);
  $$('[data-pf]', el).forEach(b => b.onclick = () => { S.cache.placeF = b.dataset.pf; drawPlaces(el); });
  $('#el').onclick = ev => { const b = ev.target.closest('[data-e]'); if (b) openPlace(get('entities', b.dataset.e)); };
  $('#addp').onclick = () => openNewPlace($('#eq').value.trim());
}

/* What each place's row says: who it's with and where it stands */
function placeInfo(rows) {
  const m = new Map(), today = todayISO();
  rows.forEach(r => {
    const id = r.a.entity.id, c = m.get(id) || { asg: [] };
    c.asg.push(r);
    if (r.st === 'overdue') c.late = Math.max(c.late || 0, r.late);
    m.set(id, c);
  });
  const byEnt = new Map();
  all('visits').forEach(v => { if (!byEnt.has(v.entity_id)) byEnt.set(v.entity_id, []); byEnt.get(v.entity_id).push(v); });
  byEnt.forEach((vs, id) => {
    vs.sort((a, b) => a.visit_no - b.visit_no);
    const c = m.get(id) || { asg: [] }; c.visits = vs; c.last = vs[vs.length - 1]; m.set(id, c);
  });
  m.forEach(c => {
    const open = c.asg.filter(r => !r.v);
    c.due = open.filter(r => r.st === 'notdue').map(r => r.a.scheduled_on).filter(Boolean).sort()[0];
    c.today = c.due === today;
    c.hold = c.asg.some(r => r.st === 'hold');
  });
  return m;
}
function placeBadge(e, c) {
  if (e.closure) return `<span class="badge ${e.closure === 'account_opened' ? 'ok' : ''}">${closureLabel(e.closure)}</span>`;
  if (!c || (!c.asg.length && !c.last)) return '<span class="badge">Not allotted</span>';
  if (c.late) return `<span class="badge bad">Overdue · ${c.late} d</span>`;
  if (c.hold) return '<span class="badge warn">🔒 On hold</span>';
  if (c.last && c.last.status === 'returned') return '<span class="badge bad">Sent back</span>';
  if (c.last) return c.last.status === 'verified' ? `<span class="badge ok">Verified${c.visits.length > 1 ? ' · V' + c.last.visit_no : ''}</span>`
    : `<span class="badge acc">Visited${c.visits.length > 1 ? ' · V' + c.last.visit_no : ''}</span>`;
  if (c.today) return '<span class="badge warn">Due today</span>';
  if (c.due) return `<span class="badge">Due ${fmtDate(c.due)}</span>`;
  return '<span class="badge">Allotted</span>';
}
function placeLine(e, c) {
  if (!c) return '';
  const bits = [];
  const who = [...new Set(c.asg.map(r => r.a.assignee))].map(x => cleanName(personName(x)));
  if (who.length) bits.push('Allotted to ' + esc(who.slice(0, 2).join(', ')) + (who.length > 2 ? ` +${who.length - 2}` : ''));
  if (c.last) bits.push(`Last visit ${fmtDate(c.last.visited_at)}${who.length && !c.asg.some(r => r.a.assignee === c.last.visitor) ? ' by ' + esc(cleanName(personName(c.last.visitor))) : ''}`);
  return bits.length ? `<div class="s">${bits.join(' · ')}</div>` : '';
}

/* From the Dashboard: open Visits → Places with a pill picked */
function goPlaces(pill) {
  S.cache.placeF = pill; S.cache.placeQ = ''; S.cache.vseg = 'places';
  show('visits');
  setTimeout(() => {
    const host = $('#v-host'); if (!host || !host._pager) return;
    host._pager.go('places');
    const pane = $('section[data-pane="places"]', host); if (pane) drawPlaces(pane);
  }, 50);
}

async function openNewPlace(prefill = '') {
  await loadBasics();
  const list = (await loadEntities()).filter(e => !e.is_duplicate);
  const body = openSheet('Add a new place', `
    <label class="f" for="np-n">Name</label><input class="input" id="np-n" value="${esc(prefill)}" autocomplete="off">
    <div id="np-dup"></div>
    <label class="f" for="np-t">Type</label><select class="input" id="np-t">${setting('entity_types').map(t => `<option>${esc(t)}</option>`).join('')}</select>
    <label class="f" for="np-a">Town / area</label><input class="input" id="np-a" value="${esc((S.who.me || {}).branch || '')}">
    <label class="f" for="np-ad">Address</label><textarea class="input" id="np-ad" rows="2"></textarea>
    <label class="f" for="np-cp">Contact person</label><input class="input" id="np-cp" placeholder="Name and designation">
    <label class="f" for="np-c">Contact details</label><input class="input" id="np-c" placeholder="Phone, email, website">
    ${S.who.admin ? `<h4 class="dh" style="margin-top:20px">Allotment</h4>${allotFieldsHTML(null, true)}`
      : `<h4 class="dh" style="margin-top:20px">Allotment</h4>
        <div class="item" style="cursor:default"><div class="avatar">${esc(initials(S.who.me.name))}</div><div class="grow"><div class="t">${esc(cleanName(S.who.me.name))} (you)</div><div class="s">Places you add are allotted to you</div></div><span style="width:18px;height:18px;flex:none;color:var(--faint);display:inline-flex">${ICON.lock}</span></div>
        <label class="f" for="np-d">Visit by</label><input class="input" type="date" id="np-d" min="${todayISO()}" value="${todayISO()}">`}
    <p class="hint" id="np-err" style="color:var(--bad)"></p>
    <button class="btn block" id="np-save">Add place</button>`);
  const allotVal = S.who.admin ? bindAllotFields(body, null) : null;
  const dup = () => {
    const t = $('#np-n', body).value.trim().toLowerCase();
    const words = t.split(/\s+/).filter(w => w.length > 2);
    const hits = t.length < 4 ? [] : list.filter(e => words.every(w => e.name.toLowerCase().includes(w))).slice(0, 5);
    $('#np-dup', body).innerHTML = hits.length ? `<div class="note warn" style="margin-top:8px">Already in TASC Connect? Tap it instead of adding again:
      <div class="list" style="margin-top:8px">${hits.map(e => `<button class="item" data-open="${e.id}"><div class="grow"><div class="t">${esc(e.name)}</div><div class="s">${esc(e.type)} · ${esc(e.area || '')}</div></div></button>`).join('')}</div></div>` : '';
    $$('[data-open]', body).forEach(b => b.onclick = () => openPlace(list.find(e => e.id === b.dataset.open)));
  };
  $('#np-n', body).oninput = dup; dup();
  $('#np-save', body).onclick = async () => {
    const name = $('#np-n', body).value.trim();
    if (name.length < 3) { $('#np-err', body).textContent = 'Please enter the place\'s name.'; return; }
    $('#np-save', body).disabled = true;
    try {
      const av = allotVal ? allotVal() : null;
      if (av && av.to && !av.date) { $('#np-save', body).disabled = false; $('#np-err', body).textContent = 'Pick a visit date.'; return; }
      const [e] = await q(sb.from('entities').insert({ name, type: $('#np-t', body).value, area: $('#np-a', body).value.trim() || null,
        address: $('#np-ad', body).value.trim() || null, contact: $('#np-c', body).value.trim() || null, contact_person: $('#np-cp', body).value.trim() || null })
        .select('id, name, type, area, address, contact, contact_person, closure, lat, lng, created_by'));
      put('entities', e);
      if (av && av.to) {
        try { put('assignments', await rpc('admin_allot', { p_entity: e.id, p_to: av.to, p_date: av.date, p_campaign: av.camp, p_note: av.note }));
          toast(`Place added and allotted to ${personName(av.to)}`); }
        catch (err) { toast('Place added, but not allotted: ' + errText(err), 4000); }
      } else if (!S.who.admin) {
        try { put('assignments', await rpc('self_allot', { p_entity: e.id, p_date: $('#np-d', body).value || todayISO() })); toast('Place added and allotted to you'); }
        catch (err) { toast('Place added, but not allotted: ' + errText(err), 4000); }
      } else toast('Place added');
      if (S.cache.visits) loadMyWork();
      openPlace(e);
    } catch (err) { $('#np-save', body).disabled = false; $('#np-err', body).textContent = errText(err); }
  };
}

/* ───────── A place's page ───────── */
async function openPlace(e, assignment) {
  const me = S.who.me;
  if (!assignment && S.cache.visits) assignment = S.cache.visits.asg.find(a => a.entity.id === e.id);
  e = get('entities', e.id) || e;   // latest copy (closure, map pin)
  const body = openSheet(e.name, '');
  const tl = qTimeline(e.id);
  const latest = tl[tl.length - 1];
  const asgVisited = !!(assignment && me && tl.some(v => v.visitor_emp === me.emp_id));
  let action = '';
  if (!me) action = '';
  else if (!latest) action = `<button class="btn block" id="pl-log">${ICON.pin} Submit Visit Report</button>`;
  else if (latest.closure) action = `<div class="note">Closed: <b>${closureLabel(latest.closure)}</b> (Visit ${latest.visit_no}).${S.who.admin ? ' <button class="linkbtn" id="pl-reopen">Reopen</button>' : ' Ask the admin if it needs reopening.'}</div>`;
  else if (latest.status === 'verified') action = `<button class="btn block" id="pl-fu">+ Add follow-up · Visit ${latest.visit_no + 1}</button>`;
  else action = `<div class="note">A follow-up can be added once Visit ${latest.visit_no} is verified.</div>`;
  const myAsg = assignment && assignment.status === 'open' && me && !asgVisited;
  const held = myAsg && S.cache.visits && S.cache.visits.hold && S.cache.visits.hold.get(assignment.id);
  const dup = !!e.is_duplicate;
  if (dup) action = `<div class="note"><b>Marked as duplicate</b>${e.duplicate_at ? ' · ' + fmtDate(e.duplicate_at) : ''}${e.duplicate_note ? `<br>${esc(e.duplicate_note)}` : ''}<br><span class="hint">It is left out of every list and count except Places → Duplicates. Nothing on it has been removed.</span></div>`;
  else if (held && !latest) action = `<div class="note warn lockednote">${ICON.lock}<div><b>Locked: request pending.</b> You asked to ${held.kind === 'reassign' ? 'reassign' : 'remove'} this visit
    ${ago(held.created_at)}: "${esc(held.reason)}". It stays off your overdue list, and you can log it or ask again after the admin decides.</div></div>`;

  body.innerHTML = `
    <div class="row wrap" style="margin-bottom:10px"><span class="badge acc">${esc(e.type)}</span>${e.area ? `<span class="badge">${esc(e.area)}</span>` : ''}
      ${assignment ? `<span class="badge ${assignment.scheduled_on < todayISO() && !asgVisited ? 'bad' : ''}">Scheduled ${fmtDate(assignment.scheduled_on)}</span>` : ''}
      ${e.lat != null ? '<span class="badge ok">On map</span>' : ''}</div>
    ${allotNote(e.id)}
    <dl class="kv"><dt>Address</dt><dd>${esc(e.address || '—')}</dd>${e.contact_person ? `<dt>Contact person</dt><dd>${esc(e.contact_person)}</dd>` : ''}<dt>Contact</dt><dd>${esc(e.contact || '—')}</dd></dl>
    <div class="row" style="margin-top:12px">
      ${e.lat != null ? `<a class="btn ghost grow" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${e.lat},${e.lng}">${ICON.pin} Map</a>`
        : e.address ? `<a class="btn ghost grow" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.name + ', ' + e.address)}">${ICON.pin} Find on Maps</a>` : ''}
    </div>
    <div id="pl-asg"></div>
    <div class="spacer"></div>${action}
    <h2>Visit history</h2>
    ${tl.length ? `<div class="list">${tl.map(v => `<button class="item" ${v.can_open ? `data-v="${v.id}"` : 'style="cursor:default"'}>
        <div class="avatar mono" style="font-size:12px">V${v.visit_no}</div>
        <div class="grow"><div class="t">${esc(cleanName(v.visitor))}</div><div class="s">${fmtDateTime(v.visited_at)} · ${esc(v.outcome || closureLabel(v.closure) || '—')}${v.next_step ? ' · Next: ' + esc(v.next_step) : ''}</div></div>
        <span class="badge ${v.status === 'verified' ? 'ok' : v.status === 'returned' ? 'bad' : 'warn'}">${v.status === 'verified' ? 'Verified' : v.status === 'returned' ? 'Sent back' : 'Submitted'}</span>${v.can_open ? `<span class="chev">${ICON.chev}</span>` : ''}</button>`).join('')}</div>`
      : '<p class="hint">Not visited yet.</p>'}
    ${myAsg && !held && !dup ? `<h2>Your allotment</h2><div class="row"><button class="btn ghost grow small" id="pl-reas">Ask to reassign</button><button class="btn ghost grow small" id="pl-rem">Ask to remove</button></div>` : ''}
    ${S.who.admin ? `<div class="spacer"></div><button class="btn ghost block small" id="pl-dup">${dup ? 'Mark as not duplicate' : 'Mark as duplicate'}</button>` : ''}
    ${S.who.admin || (me && e.created_by === me.emp_id && !tl.length) ? `${S.who.admin ? '' : '<div class="spacer"></div>'}<button class="btn ghost block small" id="pl-del" style="color:var(--bad)${S.who.admin ? ';margin-top:8px' : ''}">Delete this place</button>`
      : me && e.created_by === me.emp_id ? '<p class="hint" style="text-align:center;margin-top:16px">You added this place. To delete it, first delete its visit report.</p>' : ''}`;

  loadAssignees($('#pl-asg', body), e.id);
  if ($('#pl-del', body)) $('#pl-del', body).onclick = () => deletePlace(e);
  if ($('#pl-dup', body)) $('#pl-dup', body).onclick = () => markDuplicate(e, !dup);
  const go = (nextNo) => openVisitForm({ entity: e, assignment: myAsg && !held ? assignment : null, nextNo });
  if ($('#pl-log', body)) $('#pl-log', body).onclick = () => go(1);
  if ($('#pl-fu', body)) $('#pl-fu', body).onclick = () => go(latest.visit_no + 1);
  if ($('#pl-reopen', body)) $('#pl-reopen', body).onclick = async () => {
    try {
      await rpc('admin_reopen_place', { p_entity: e.id });
      if (latest) patch('visits', latest.id, { closure: null, closure_note: null });
      patch('entities', e.id, { closure: null });
      toast('Place reopened'); openPlace(e, assignment);
    } catch (err) { toast(errText(err)); }
  };
  $$('[data-v]', body).forEach(b => b.onclick = () => openVisit(b.dataset.v));
  if ($('#pl-reas', body)) $('#pl-reas', body).onclick = () => askRequest('reassign', null, assignment.id, `Reassign ${e.name}`, 'Why should someone else visit? e.g. not in my area, I am on leave');
  if ($('#pl-rem', body)) $('#pl-rem', body).onclick = () => askRequest('delete_assignment', null, assignment.id, `Remove ${e.name}`, 'Why should this visit be removed? e.g. closed down, duplicate, not relevant');
}

/* Admin: mark a place as a duplicate (or not). Nothing is removed; it is only left out of lists and counts. */
async function markDuplicate(e, on) {
  const body = openSheet(on ? 'Mark as duplicate?' : 'Mark as not duplicate?', on ? `
    <p style="margin-top:0"><b>${esc(e.name)}</b> will be left out of To do, pendency, the Dashboard, reports and exports. It stays in Places → Duplicates, with its allotment and visit reports as they are. You can unmark it any time.</p>
    <label class="f" for="dp-n">Note <span class="hint">(optional)</span></label>
    <input class="input" id="dp-n" placeholder="e.g. Same as Govt School, Hiran Magri">
    <p class="hint" id="dp-err" style="color:var(--bad)"></p>
    <button class="btn block" id="dp-go">Mark as duplicate</button>` : `
    <p style="margin-top:0"><b>${esc(e.name)}</b> comes back everywhere, with its allotment and visit reports as they were.</p>
    <p class="hint" id="dp-err" style="color:var(--bad)"></p>
    <button class="btn block" id="dp-go">Mark as not duplicate</button>`);
  $('#dp-go', body).onclick = async () => {
    const b = $('#dp-go', body); b.disabled = true;
    try {
      const r = await rpc('admin_set_duplicate', { p_entity: e.id, p_dup: on, p_note: on ? ($('#dp-n', body).value.trim() || null) : null });
      patch('entities', e.id, r);
      toast(on ? 'Marked as duplicate' : 'Marked as not duplicate');
      if (VIEWS[S.tab]) VIEWS[S.tab]();   // lists and counts follow the mark
      openPlace(get('entities', e.id));
    } catch (err) { b.disabled = false; $('#dp-err', body).textContent = errText(err); }
  };
}

/* Admin: delete a place, with its allotments and visit reports */
async function deletePlace(e) {
  const nv = visitsOf(e.id).length, na = all('assignments').filter(a => a.entity_id === e.id).length;
  const what = [na ? `its allotment${na > 1 ? 's' : ''}` : '', nv ? `<b>${nv} visit report${nv > 1 ? 's' : ''}</b> with their photos` : ''].filter(Boolean).join(' and ');
  const ok = await new Promise(res => {
    const body = openSheet('Delete this place?', `<p style="margin-top:0"><b>${esc(e.name)}</b> will be removed from TASC Connect${what ? ', along with ' + what : ''}. This can't be undone.</p>
      <label class="f" for="del-t">Type <b>delete</b> to confirm</label>
      <input class="input" id="del-t" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="delete">
      <div class="row" style="margin-top:14px"><button class="btn ghost grow" id="del-no">Cancel</button><button class="btn danger grow" id="del-ok" disabled>Delete place</button></div>`, () => res(false));
    const t = $('#del-t', body), go = $('#del-ok', body);
    t.oninput = () => { go.disabled = t.value.trim().toLowerCase() !== 'delete'; };
    t.onkeydown = ev => { if (ev.key === 'Enter' && !go.disabled) go.click(); };
    $('#del-no', body).onclick = () => res(false);
    go.onclick = () => res(true);
    setTimeout(() => t.focus(), 250);
  });
  if (!ok) return openPlace(e);
  try {
    const r = S.who.admin ? await rpc('admin_delete_place', { p_entity: e.id }) : (await rpc('delete_my_place', { p_entity: e.id }), null);
    if (r && r.paths && r.paths.length) sb.storage.from('photos').remove(withThumbs(r.paths)).catch(() => {});
    visitsOf(e.id).forEach(v => dropVisit(v.id));
    all('assignments').filter(a => a.entity_id === e.id).forEach(a => drop('assignments', a.id));
    drop('entities', e.id);
    closeSheet(); toast('Place deleted');
    if (VIEWS[S.tab]) VIEWS[S.tab]();
  } catch (err) { toast(errText(err)); openPlace(e); }
}

/* A reason box → request to the admin */
function askRequest(kind, visitId, asgId, title, placeholder) {
  const body = openSheet(title, `<p class="muted" style="margin-top:0">The admin will approve or decline this.</p>
    <label class="f" for="rq">Reason</label><textarea class="input" id="rq" rows="3" placeholder="${esc(placeholder)}"></textarea>
    <p class="hint" id="rqe" style="color:var(--bad)"></p><button class="btn block" id="rqs">Send request</button>`);
  $('#rqs', body).onclick = async () => {
    const reason = $('#rq', body).value.trim();
    if (reason.length < 5) { $('#rqe', body).textContent = 'That reason is too short. Add a few more words.'; return; }
    $('#rqs', body).disabled = true;
    try {
      const id = await rpc('raise_request', { p_kind: kind, p_visit: visitId, p_assignment: asgId, p_reason: reason });
      put('requests', { id, kind, visit_id: visitId, assignment_id: asgId, raised_by: S.who.me.emp_id, reason, status: 'pending', created_at: new Date().toISOString() });
      if (asgId && (kind === 'reassign' || kind === 'delete_assignment')) DB.holds.add(asgId);
      closeSheet(); toast(asgId ? 'Request sent. This visit is locked until the admin decides.' : 'Request sent to the admin');
      if (S.tab === 'visits') viewVisits();
    }
    catch (e) { $('#rqs', body).disabled = false; $('#rqe', body).textContent = errText(e); }
  };
}

/* ───────── A visit's full view ───────── */
async function openVisit(id) {
  const body = openSheet('Visit', '');
  const got = qVisit(id);
  if (!got) { body.innerHTML = emptyState(ICON.pin, 'Not available', 'This visit is no longer there. Pull down to refresh.'); return; }
  if (!got.v.f) { body.innerHTML = emptyState(ICON.lock, 'Details not shared', 'Only the visitor, their branch head and the Regional Office see the full report.'); return; }
  const { v, photos, joint } = got, ent = v.entity;
  const me = S.who.me || {};
  const mine = v.visitor === me.emp_id, back = v.status === 'returned', sub = v.status === 'submitted' || back, adm = S.who.admin;
  const canVerify = v.status === 'submitted' && adm;   // only the Regional Office verifies
  $('.sheet-head h3').textContent = `${ent.name} · Visit ${v.visit_no}`;
  const urls = photos.length ? await signedUrls(photos.map(p => p.path)).catch(() => ({})) : {};
  const turls = photos.length ? await signedThumbs(photos.map(p => p.path)).catch(() => urls) : {};
  const pr = qMyPendingFor(v.id), pending = pr ? ({ delete_visit: 'delete', unverify: 'unverify' }[pr.kind] || '') : '';
  const kv = (k, val) => val == null || val === '' || (Array.isArray(val) && !val.length) ? '' : `<dt>${k}</dt><dd>${val}</dd>`;
  body.innerHTML = `
    <div class="row wrap" style="margin-bottom:12px">
      <span class="badge ${v.status === 'verified' ? 'ok' : back ? 'bad' : 'warn'}">${v.status === 'verified' ? 'Verified' : back ? 'Sent back for changes' : 'Submitted, not yet verified'}</span>
      ${v.closure ? `<span class="badge ${v.closure === 'account_opened' ? 'ok' : v.closure === 'existing_customer' ? 'acc' : 'bad'}">${closureLabel(v.closure)}</span>` : ''}
      ${v.assignment_id ? '<span class="badge acc">Allotted</span>' : '<span class="badge">Self-initiated</span>'}</div>
    ${back ? `<div class="note bad" style="margin-bottom:12px"><b>Sent back by the Regional Office${v.returned_at ? ' · ' + fmtDateTime(v.returned_at) : ''}:</b> ${esc(v.return_note || '')}${mine ? '<br>Make the changes and save: it goes back for checking.' : ''}</div>`
      : v.resubmitted_at && v.status === 'submitted' ? `<div class="note" style="margin-bottom:12px">Resubmitted ${fmtDateTime(v.resubmitted_at)} after being sent back${v.return_note ? `: "${esc(v.return_note)}"` : ''}.</div>` : ''}
    ${photos.length ? `<div class="pgrid" style="margin-bottom:14px">${photos.map(p => `<a class="pthumb" href="${urls[p.path] || '#'}" target="_blank" rel="noopener"><img src="${turls[p.path] || urls[p.path] || ''}" alt="Visit photo" loading="lazy"><span class="ptag">${p.source === 'capture' ? 'Live' : 'Uploaded'}</span></a>`).join('')}</div>` : ''}
    <dl class="kv">
      ${kv('Visited by', esc(personName(v.visitor)) + (joint.length ? ' with ' + joint.map(j => esc(personName(j.emp_id))).join(', ') : ''))}
      ${kv('When', fmtDateTime(v.visited_at))}
      ${kv('Logged', fmtDateTime(v.logged_at) + (new Date(v.logged_at) - new Date(v.visited_at) > 864e5 ? ` <span class="badge">${Math.floor((new Date(v.logged_at) - new Date(v.visited_at)) / 864e5)} d after visit</span>` : ''))}
      ${kv('Location', v.lat != null ? `<a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${v.lat},${v.lng}" class="mono">${fmtCoords({ lat: v.lat, lng: v.lng, acc: v.accuracy_m })}</a>` : 'Not recorded')}
      ${kv('Person met', [esc(v.person_name), esc(v.person_designation)].filter(Boolean).join(', '))}
      ${kv('Mobile', v.person_mobile ? `<a href="tel:${esc(v.person_mobile)}" class="mono">${esc(v.person_mobile)}</a>` : '')}
      ${kv('Banks with', { us: 'Our bank', other: 'Other bank' + (v.other_bank ? ': ' + esc(v.other_bank) : ''), none: 'None / not known' }[v.banking_with])}
      ${kv('Headcount', v.headcount != null ? `${v.headcount} ${esc((v.headcount_kind || '').toLowerCase())}` : '')}
      ${kv('Potential', v.potential_rs != null ? inr(v.potential_rs) : '')}
      ${kv('Products', esc((v.products || []).join(', ')))}
      ${kv('Outcome', esc(v.outcome))}
      ${kv('Remarks', esc(v.remarks))}
      ${kv('Next step', esc(v.next_step))}
      ${kv('Follow-up', v.followup_on ? fmtDate(v.followup_on) : '')}
      ${kv('Closure', v.closure ? closureLabel(v.closure) + (v.closure_note ? ': ' + esc(v.closure_note) : '') : '')}
      ${kv('Accounts opened', v.account_numbers && v.account_numbers.length ? `<span class="mono">${v.account_numbers.map(esc).join(', ')}</span>` : '')}
      ${kv('Existing accounts', v.existing_accounts && v.existing_accounts.length ? `<span class="mono">${v.existing_accounts.map(esc).join(', ')}</span>` : '')}
      ${kv('Mobilised', v.mobilised_rs != null ? inr(v.mobilised_rs) : '')}
      ${kv('Verified', v.verified_at ? `${esc(v.verified_by ? personName(v.verified_by) : 'Admin')} · ${fmtDateTime(v.verified_at)}` : '')}
    </dl>
    ${pending ? `<div class="note warn" style="margin-top:12px">Your ${pending} request is waiting with the admin.</div>` : ''}
    <div id="v-hist"></div>
    <div class="stack" style="margin-top:16px" id="v-acts"></div>`;
  loadHistory($('#v-hist', body), v, photos, joint);

  const acts = [];
  if (canVerify) acts.push(`<div class="row"><button class="btn grow" id="va-ver">✓ Verify</button><button class="btn ghost grow" id="va-back" style="color:var(--bad)">↩ Send back</button></div>`);
  if (mine && sub) acts.push(`<button class="btn ${back ? '' : 'ghost'} block" id="va-edit">${back ? 'Edit and resubmit' : 'Edit'}</button>`);
  if (mine && sub && !v.assignment_id && !v.created_by_admin) acts.push(`<button class="btn danger block" id="va-del">Delete</button>`);
  if (mine && sub && (v.assignment_id || v.created_by_admin) && !pending) acts.push(`<button class="btn ghost block" id="va-rdel">Ask admin to delete</button>`);
  if (mine && !sub && !pending) acts.push(`<button class="btn ghost block" id="va-runv">Ask admin to unverify (to edit)</button>`);
  if (adm && !sub) acts.push(`<button class="btn ghost block" id="va-unv">Unverify</button>`);
  if (adm && !mine) acts.push(`<button class="btn danger block" id="va-adel">Delete visit (admin)</button>`);
  $('#v-acts', body).innerHTML = acts.join('');

  const on = (sel, fn) => { const b = $(sel, body); if (b) b.onclick = fn; };
  on('#va-ver', async () => {
    try { await rpc('verify_visit', { p_visit: v.id }); patch('visits', v.id, { status: 'verified', verified_at: new Date().toISOString(), verified_by: me.emp_id || null }); toast('Verified'); refreshCurrent(); }
    catch (e) { toast(errText(e)); } });
  on('#va-back', async () => {
    const note = await new Promise(res => {
      const b2 = openSheet('Send back this report?', `<p class="muted" style="margin-top:0">${esc(personName(v.visitor))} will see your reason, make the changes and resubmit. Until then it counts as pending again.</p>
        <label class="f" for="sb-n">What needs fixing</label><textarea class="input" id="sb-n" rows="3" placeholder="e.g. Photo unclear; add the contact person's mobile"></textarea>
        <p class="hint" id="sb-e" style="color:var(--bad)"></p>
        <div class="row"><button class="btn ghost grow" id="sb-no">Cancel</button><button class="btn grow" id="sb-ok">Send back</button></div>`, () => res(null));
      $('#sb-no', b2).onclick = () => res(null);
      $('#sb-ok', b2).onclick = () => { const t = $('#sb-n', b2).value.trim(); if (t.length < 5) { $('#sb-e', b2).textContent = 'Please write what needs fixing.'; return; } res(t); };
      setTimeout(() => $('#sb-n', b2).focus(), 250);
    });
    if (!note) return openVisit(v.id);
    try { const r = await rpc('admin_return_visit', { p_visit: v.id, p_note: note }); patch('visits', v.id, { status: 'returned', return_note: r.return_note, returned_at: r.returned_at, resubmitted_at: null });
      toast(`Sent back to ${personName(v.visitor)}`); openVisit(v.id); }
    catch (e) { toast(errText(e)); openVisit(v.id); }
  });
  on('#va-unv', async () => {
    const why = await new Promise(res => {
      const b2 = openSheet('Unverify this report?', `<p class="muted" style="margin-top:0">${esc(personName(v.visitor))} can then edit it, and it waits for verification again. The verified version is kept in its History.</p>
        <label class="f" for="uv-n">Reason <span class="hint">(optional)</span></label><input class="input" id="uv-n" placeholder="e.g. Wrong account number">
        <div class="row" style="margin-top:14px"><button class="btn ghost grow" id="uv-no">Cancel</button><button class="btn grow" id="uv-ok">Unverify</button></div>`, () => res(null));
      $('#uv-no', b2).onclick = () => res(null);
      $('#uv-ok', b2).onclick = () => res({ t: $('#uv-n', b2).value.trim() });
    });
    if (!why) return openVisit(v.id);
    try {
      try { await rpc('unverify_visit', { p_visit: v.id, p_reason: why.t || null }); }
      catch (e) { if (!/unverify_visit|PGRST202|schema cache|function/i.test(String(e && (e.message || e.code)))) throw e; await rpc('unverify_visit', { p_visit: v.id }); }   // database not updated yet: no reason
      patch('visits', v.id, { status: 'submitted', verified_at: null, verified_by: null }); toast('Unverified: the visitor can edit it again'); openVisit(v.id);
    } catch (e) { toast(errText(e)); openVisit(v.id); } });
  on('#va-edit', () => openVisitForm({ entity: ent, visit: v, photos: photos.map(p => ({ id: p.id, path: p.path, url: urls[p.path], source: p.source })), joint: joint.map(j => j.emp_id) }));
  on('#va-del', async () => {
    if (!await confirmSheet('Delete this visit?', 'The visit and its photos are removed for good.', 'Delete', true)) return openVisit(v.id);
    try { await deleteVisitWithPhotos(v.id, photos); toast('Visit deleted'); refreshCurrent(); } catch (e) { toast(errText(e)); }
  });
  on('#va-adel', async () => {
    if (!await confirmSheet('Delete this visit?', `${esc(personName(v.visitor))}'s Visit ${v.visit_no} to ${esc(ent.name)} and its photos are removed for good.`, 'Delete', true)) return openVisit(v.id);
    try { await deleteVisitWithPhotos(v.id, photos); toast('Visit deleted'); refreshCurrent(); } catch (e) { toast(errText(e)); }
  });
  on('#va-rdel', () => askRequest('delete_visit', v.id, null, 'Ask to delete this visit', 'Why should this visit be deleted?'));
  on('#va-runv', () => askRequest('unverify', v.id, null, 'Ask to unverify', 'What do you need to correct?'));
}

/* ───────── a report's History: kept when the admin sends it back or unverifies it ───────── */
const HIST_FIELDS = [
  ['visited_at', 'Visit time', x => x ? fmtDateTime(x) : ''], ['person_name', 'Person met'], ['person_designation', 'Designation'], ['person_mobile', 'Mobile'],
  ['banking_with', 'Banks with', x => ({ us: 'Our bank', other: 'Other bank', none: 'None / not known' }[x] || '')], ['other_bank', 'Which bank'],
  ['headcount', 'Headcount'], ['potential_rs', 'Business potential', x => x == null || x === '' ? '' : inr(x)], ['products', 'Products', x => (x || []).join(', ')],
  ['outcome', 'Outcome'], ['remarks', 'Remarks'], ['next_step', 'Next step'], ['followup_on', 'Follow-up date', x => x ? fmtDate(x) : ''],
  ['closure', 'Lead status', x => closureLabel(x) || 'Open'], ['closure_note', 'Closure note'], ['mobilised_rs', 'Business mobilised', x => x == null || x === '' ? '' : inr(x)],
  ['account_numbers', 'Accounts opened', x => (x || []).join(', ')], ['existing_accounts', 'Existing accounts', x => (x || []).join(', ')],
  ['_loc', 'Location', (x, o) => o.lat != null ? `${(+o.lat).toFixed(5)}, ${(+o.lng).toFixed(5)}` : 'Not recorded'],
  ['joint', 'Joint visit with', x => (x || []).map(e => cleanName(personName(e))).join(', ')], ['photo_count', 'Photos', x => x == null ? '' : String(x)]
];
function histDiff(a, b) {
  return HIST_FIELDS.map(([k, label, fmt]) => {
    const f = fmt || (x => x == null ? '' : String(x));
    const x = f(a[k], a), y = f(b[k], b);
    return x === y ? '' : `<div class="s" style="margin-top:3px"><b>${label}:</b> <span style="text-decoration:line-through;opacity:.7">${esc(x || '—')}</span> → ${esc(y || '—')}</div>`;
  }).join('');
}
async function loadHistory(el, v, photos, joint) {
  if (!el) return;
  let rows;
  try { rows = await rpc('visit_history', { p_visit: v.id }); } catch (e) { return; }   // database not updated yet: no History
  if (!rows || !rows.length || !el.isConnected) return;
  const now = { ...v, photo_count: photos.length, joint: joint.map(j => j.emp_id).sort((a, b) => a - b) };
  el.innerHTML = `<h2>History</h2><div class="list">${rows.slice().reverse().map((h, ri) => {
    const i = rows.length - 1 - ri, next = rows[i + 1] ? rows[i + 1].snapshot : now, last = !rows[i + 1];
    const s = h.snapshot, what = h.kind === 'returned' ? 'Sent back' : 'Unverified';
    const who = h.by_emp ? cleanName(personName(h.by_emp)) : 'Admin';
    const waiting = last && h.kind === 'returned' && v.status === 'returned';
    const diff = waiting ? '' : histDiff({ ...s, joint: (s.joint || []).slice().sort((a, b) => a - b) }, next);
    return `<div class="item" style="cursor:default;align-items:flex-start"><div class="grow">
      <div class="t">${what} · ${fmtDateTime(h.at)}</div><div class="s">by ${esc(who)}${h.reason ? ` · “${esc(h.reason)}”` : ''}</div>
      ${waiting ? '<div class="s" style="margin-top:4px">Not resubmitted yet.</div>'
        : diff ? `<div class="s" style="margin-top:6px">${h.kind === 'returned' ? 'Changes when resubmitted:' : 'Changes made after unverifying:'}</div>${diff}`
        : '<div class="s" style="margin-top:4px">No changes made.</div>'}
    </div><span class="badge ${h.kind === 'returned' ? 'bad' : 'warn'}">${what}</span></div>`; }).join('')}</div>`;
}

async function deleteVisitWithPhotos(id, photos) {
  // the visit first: if the database refuses, the photos are still there
  const gone = await q(sb.from('visits').delete().eq('id', id).select('id'));
  if (!gone.length) throw { message: 'NOT_ALLOWED', hint: 'This visit can no longer be deleted. It may have been verified.' };
  dropVisit(id);
  if (photos && photos.length) await sb.storage.from('photos').remove(withThumbs(photos.map(p => p.path))).catch(() => {});
}

function refreshCurrent() { closeSheet(); if (VIEWS[S.tab]) VIEWS[S.tab](); }

/* The admin's note on an allotment: shown to the person it is allotted to, and to admins */
function allotNote(entityId) {
  const me = S.who.me && S.who.me.emp_id;
  const rows = openAsgAll().filter(a => a.entity_id === entityId && a.note && (S.who.admin || a.assignee === me));
  return rows.map(a => `<div class="note" style="margin-bottom:10px"><b>Note from the Regional Office${S.who.admin && a.assignee !== me ? ' for ' + esc(personName(a.assignee)) : ''}:</b> ${esc(a.note)}</div>`).join('');
}

/* "Allotted to" on a place's page. Viewers and admin can tap a name to see that person's summary. */
async function loadAssignees(el, entityId) {
  if (!el) return;
  const rows = qAssignees(entityId), dbNote = '';
  const ent = get('entities', entityId);
  if (!rows.length) {
    el.innerHTML = '<p class="hint" style="margin:12px 0 0">Not allotted to anyone. Anyone can visit and log it.</p>'
      + (S.who.admin && ent && !ent.closure && !ent.is_duplicate ? '<button class="btn soft block" id="pl-allot" style="margin-top:8px">Allot this place</button>' : '');
    const b = $('#pl-allot', el); if (b) b.onclick = () => openAllot(ent);
    return;
  }
  const today = todayISO(), canOpen = S.who.admin;
  el.innerHTML = `<h4 class="dh">Allotted to</h4><div class="list">${rows.map(r => {
    const st = r.verified ? '<span class="badge ok">Verified</span>' : r.returned ? '<span class="badge bad">Sent back</span>' : r.visited ? '<span class="badge acc">Visited</span>'
      : r.on_hold ? '<span class="badge warn">🔒 On hold</span>'
      : r.scheduled_on && r.scheduled_on < today ? `<span class="badge bad">${daysBetween(r.scheduled_on, today)} d delay</span>`
      : r.scheduled_on === today ? '<span class="badge warn">Due today</span>' : `<span class="badge">Due ${r.scheduled_on ? fmtDate(r.scheduled_on) : '—'}</span>`;
    const me = S.who.me && r.emp_id === S.who.me.emp_id;
    return `<${canOpen ? `button class="item" data-st="${r.emp_id}"` : 'div class="item" style="cursor:default"'}>
      <div class="avatar">${esc(initials(r.name))}</div>
      <div class="grow"><div class="t">${esc(cleanName(r.name))}${me ? ' (you)' : ''}</div><div class="s">${esc(r.designation || '')}${r.branch ? ' · ' + esc(r.branch) : ''}${
        r.visited_by_emp && r.visited_by_emp !== r.emp_id ? `<br><b>Visited by ${S.who.me && r.visited_by_emp === S.who.me.emp_id ? 'you' : esc(cleanName(r.visited_by))}</b> · ${fmtDate(r.visited_at)}` : ''}</div></div>
      ${st}${canOpen ? `<span class="chev">${ICON.chev}</span>` : ''}</${canOpen ? 'button' : 'div'}>`; }).join('')}</div>${dbNote}
    ${S.who.admin && !(ent && ent.is_duplicate) ? rows.filter(r => !r.visited).map(r => `<button class="btn soft block" data-realot="${r.assignment_id}" style="margin-top:8px">Reallot or change date${rows.length > 1 ? ' · ' + esc(cleanName(r.name)) : ''}</button>`).join('') : ''}`;
  $$('[data-st]', el).forEach(b => b.onclick = () => openStaff(+b.dataset.st));
  $$('[data-realot]', el).forEach(b => b.onclick = () => openAllot(ent, b.dataset.realot));
}
