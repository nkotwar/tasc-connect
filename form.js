/* TASC Connect · the visit form (new visit, follow-up, or edit of your own unverified visit). */

const localDT = d => { const x = new Date(d || Date.now()); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };
const uuid = () => crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });

/* opts: { entity, assignment, visit, photos, nextNo } */
async function openVisitForm(opts) {
  await loadBasics();
  const v = opts.visit || {};
  const me = S.who.me;
  const F = {
    id: v.id || uuid(), isNew: !v.id, entity: opts.entity,
    assignment_id: v.id ? v.assignment_id : (opts.assignment ? opts.assignment.id : null),
    visited_at: localDT(v.visited_at), pos: v.id ? (v.lat != null ? { lat: v.lat, lng: v.lng, acc: v.accuracy_m, source: v.loc_source } : { source: v.loc_source || 'none' }) : null,
    person_name: v.person_name || '', person_designation: v.person_designation || '', person_mobile: v.person_mobile || '',
    banking_with: v.banking_with || '', other_bank: v.other_bank || '', headcount: v.headcount ?? '', headcount_kind: v.headcount_kind || setting('headcount_kinds', ['Staff'])[0],
    potential_rs: v.potential_rs ?? '', products: new Set(v.products || []), outcome: v.outcome || '', remarks: v.remarks || '',
    next_step: v.next_step || '', followup_on: v.followup_on || '', closure: v.closure || '', closure_note: v.closure_note || '',
    mobilised_rs: v.mobilised_rs ?? '', account_numbers: (v.account_numbers && v.account_numbers.length ? [...v.account_numbers] : ['']),
    existing_accounts: (v.existing_accounts && v.existing_accounts.length ? [...v.existing_accounts] : ['']),
    outcomeTouched: false, visit0: v,
    joint: new Set(opts.joint || []), photos: (opts.photos || []).map(p => ({ ...p, existing: true })), removed: []
  };
  /* Admin can submit for someone else: their visit, their credit. Default: the person the place is allotted to. */
  const myEmp = me ? me.emp_id : null;
  const allottee = (openAsgAll().find(a => a.entity_id === opts.entity.id && a.assignee !== myEmp) || {}).assignee;
  F.visitor = v.id ? v.visitor : (opts.onBehalf || (S.who.admin && allottee && !opts.assignment ? allottee : myEmp));
  F.pickVisitor = S.who.admin && F.isNew;
  F.myEmp = myEmp;
  const no = v.visit_no || opts.nextNo || 1;
  const title = (F.isNew ? (no > 1 ? `Follow-up · Visit ${no}` : 'Submit Visit Report') : `Edit Visit ${no}`);
  const body = openSheet(title, formHTML(F, no));
  bindForm(body, F);
  if (F.isNew) refreshLocation(body, F);
}

function formHTML(F, no) {
  const e = F.entity;
  const outcomes = setting('outcomes');
  return `
  <div class="card" style="margin-bottom:14px"><div style="font-weight:650">${esc(e.name)}</div>
    <div class="hint">${esc(e.type)}${e.area ? ' · ' + esc(e.area) : ''}${no > 1 ? ` · Visit ${no}` : ''}</div></div>

  ${F.pickVisitor ? `<div class="fs"><h4>Visited by</h4><div id="f-vby"></div></div>`
    : F.visitor !== F.myEmp ? `<div class="note" style="margin-bottom:14px">Report of <b>${esc(personName(F.visitor))}</b>${F.isNew ? '' : ', entered by the admin'}.</div>` : ''}

  <div class="fs"><h4>When &amp; where</h4>
    <label class="f" for="f-when">Date and time of visit</label>
    <input class="input" type="datetime-local" id="f-when" value="${F.visited_at}" max="${localDT()}">
    <label class="f">Location</label>
    <div class="row"><div class="grow" id="f-loc">${locText(F.pos)}</div><button class="btn small ghost" type="button" id="f-locbtn">${F.isNew ? 'Refresh' : 'Use current'}</button></div>
  </div>

  <div class="fs"><h4>Person met</h4>
    <label class="f" for="f-pn">Name</label><input class="input" id="f-pn" value="${esc(F.person_name)}" autocomplete="off">
    <div class="g2"><div><label class="f" for="f-pd">Designation</label><input class="input" id="f-pd" value="${esc(F.person_designation)}" autocomplete="off"></div>
    <div><label class="f" for="f-pm">Mobile</label><input class="input mono" id="f-pm" type="tel" inputmode="numeric" maxlength="10" value="${esc(F.person_mobile)}" autocomplete="off"></div></div>
  </div>

  <div class="fs"><h4>Their banking</h4>
    <label class="f">Banks with</label>
    <div class="seg" id="f-bank" style="margin-bottom:0">${[['us', 'Our bank'], ['other', 'Other bank'], ['none', 'None / not known']].map(([k, l]) =>
      `<button type="button" data-v="${k}" class="${F.banking_with === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div id="f-obw" ${F.banking_with === 'other' ? '' : 'hidden'}><label class="f" for="f-ob">Which bank(s)</label><input class="input" id="f-ob" value="${esc(F.other_bank)}" placeholder="e.g. SBI, HDFC"></div>
    <p class="hint" id="f-banklock" hidden>Set to Our bank by the outcome (Already our customer). Their account number is asked under Outcome.</p>
    <div id="f-exbank"></div>
    <div id="f-exw" ${F.banking_with === 'us' ? '' : 'hidden'}><label class="f">Existing account number(s) <span class="hint" id="f-exreq">(optional)</span></label><div id="f-exs"></div>
      <button type="button" class="linkbtn" id="f-exadd">+ Add another account</button>
      <p class="hint" style="margin-top:4px">Accounts they already have with us. These are not counted as accounts opened.</p></div>
  </div>

  <div class="fs"><h4>Business</h4>
    <label class="f" for="f-pot">Business potential (₹)</label>
    <input class="input mono" id="f-pot" type="number" inputmode="decimal" min="0" value="${esc(F.potential_rs)}" placeholder="0">
    <div class="hint" id="f-potw"></div>
    <label class="f">Products discussed</label>
    <div class="chipwrap" id="f-prod">${setting('products').map(p => `<button type="button" class="chip ${F.products.has(p) ? 'on' : ''}" data-p="${esc(p)}">${esc(p)}</button>`).join('')}</div>
  </div>

  <div class="fs"><h4>Outcome</h4>
    <label class="f" for="f-out">Outcome</label>
    <select class="input" id="f-out"><option value="">Choose…</option>${outcomes.map(o => `<option ${F.outcome === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>
    <div id="f-exout"></div>
    <label class="f" for="f-rem">Remarks</label><textarea class="input" id="f-rem" rows="3">${esc(F.remarks)}</textarea>
    <div id="f-fuw">
      <label class="f" for="f-next">Next step</label><input class="input" id="f-next" value="${esc(F.next_step)}">
      <label class="f" for="f-fu">Follow-up date <span class="hint" id="f-fureq"></span></label>
      <div class="row" style="gap:8px"><input class="input grow" type="date" id="f-fu" value="${esc(F.followup_on)}">
        <button type="button" class="btn ghost" id="f-fuclr" style="flex:none;min-height:44px">Clear</button></div>
      <p class="hint" id="f-fuold" hidden>A later visit to this place exists, so this follow-up date no longer counts.</p>
    </div>
    <p class="hint" id="f-funo" hidden></p>
  </div>

  <div class="fs"><h4>Joint visit with</h4>
    <div class="chipwrap" id="f-joint"></div>
    <div class="search" style="margin-top:8px">${ICON.search}<input class="input" id="f-jq" type="search" placeholder="Add a colleague who came along" autocomplete="off"></div>
    <div class="list" id="f-jl" hidden></div>
  </div>

  <div class="fs"><h4>Lead status?</h4>
    <div class="chipwrap" id="f-close">${[['', 'Open'], ['account_opened', 'Account opened'], ['rejected', 'Rejected'], ['not_feasible', 'Not feasible'], ['existing_customer', 'Existing customer']].map(([k, l]) =>
      `<button type="button" class="chip ${F.closure === k ? 'on' : ''}" data-c="${k}" ${k === 'existing_customer' && F.closure !== k ? 'hidden' : ''}>${l}</button>`).join('')}</div>
    <p class="hint" id="f-custhint" hidden>Already our customer: the lead is closed as Existing customer. Nothing new was opened, so no follow-up.</p>
    <div id="f-ao" ${F.closure === 'account_opened' ? '' : 'hidden'}>
      <label class="f">Account number(s)</label><div id="f-acs"></div>
      <button type="button" class="linkbtn" id="f-acadd">+ Add another account</button>
      <label class="f" for="f-mob">Business mobilised (₹)</label><input class="input mono" id="f-mob" type="number" inputmode="decimal" min="0" value="${esc(F.mobilised_rs)}">
      <div class="hint" id="f-mobw"></div>
    </div>
    <div id="f-cnw" ${F.closure ? '' : 'hidden'}><label class="f" for="f-cn">Closure note</label><input class="input" id="f-cn" value="${esc(F.closure_note)}"></div>
    <p class="hint" id="f-closehint" ${F.closure ? '' : 'hidden'}>This closes the lead: no more follow-ups unless the admin reopens it.</p>
  </div>

  <div class="fs"><h4>Photos <span class="hint" id="f-pc"></span></h4>
    <div class="pgrid" id="f-ph"></div>
    <div class="row" style="margin-top:10px">
      <button type="button" class="btn soft grow" id="f-cam">${ICON.camera} Take photo</button>
      <button type="button" class="btn ghost grow" id="f-upl">${ICON.upload} Upload</button>
    </div>
    <p class="hint">Photos taken here are stamped with place, name, time and location. Uploaded photos keep their own location if the file has it.</p>
    <input type="file" id="f-camin" accept="image/*" capture="environment" hidden>
    <input type="file" id="f-uplin" accept="image/*" multiple hidden>
  </div>

  <p class="hint" id="f-err" style="color:var(--bad)"></p>
  <button class="btn block" id="f-save">${F.isNew ? 'Submit Visit Report' : 'Save changes'}</button>`;
}

function locText(p) {
  if (!p) return '<span class="hint">Getting location…</span>';
  if (p.denied) return '<span class="hint" style="color:var(--warn)">Location is blocked. Allow it in the browser\'s site settings, then tap Refresh.</span>';
  if (p.lat == null) return '<span class="hint">No location</span>';
  return `<span class="mono" style="font-size:13.5px">${fmtCoords(p)}</span>`;
}
async function refreshLocation(body, F) {
  $('#f-loc', body).innerHTML = '<span class="hint">Getting location…</span>';
  const p = await getPosition();
  F.pos = p && p.lat != null ? { ...p, source: 'gps', at: Date.now() } : (p && p.denied ? { denied: true, source: 'none' } : { source: 'none' });
  const el = $('#f-loc', body); if (el) el.innerHTML = locText(F.pos);
}

const inr = n => n === '' || n == null || isNaN(n) ? '' : '₹ ' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });

function bindForm(body, F) {
  const $b = s => $(s, body);
  $b('#f-locbtn').onclick = () => refreshLocation(body, F);
  const drawBank = () => {
    $$('#f-bank button', body).forEach(x => x.classList.toggle('on', x.dataset.v === F.banking_with));
    $b('#f-obw').hidden = F.banking_with !== 'other';
    $b('#f-exw').hidden = F.banking_with !== 'us';
  };
  $$('#f-bank button', body).forEach(b => b.onclick = () => {
    if (F.custLock) return;   // "Already our customer" keeps this on Our bank
    F.banking_with = F.banking_with === b.dataset.v ? '' : b.dataset.v;
    drawBank();
  });
  const drawExs = () => {
    $b('#f-exs').innerHTML = F.existing_accounts.map((a, i) => `<div class="row" style="margin-bottom:6px"><input class="input mono grow" data-ex="${i}" inputmode="numeric" value="${esc(a)}" placeholder="Existing account number">
      ${F.existing_accounts.length > 1 ? `<button type="button" class="x" data-exrm="${i}" aria-label="Remove">${ICON.x}</button>` : ''}</div>`).join('');
    $$('[data-ex]', body).forEach(i => i.oninput = () => { F.existing_accounts[+i.dataset.ex] = i.value.trim(); });
    $$('[data-exrm]', body).forEach(b => b.onclick = () => { F.existing_accounts.splice(+b.dataset.exrm, 1); drawExs(); });
  };
  drawExs();
  $b('#f-exadd').onclick = () => { F.existing_accounts.push(''); drawExs(); };
  const potw = () => { $b('#f-potw').textContent = inr($b('#f-pot').value); };
  $b('#f-pot').oninput = potw; potw();
  $$('#f-prod .chip', body).forEach(c => c.onclick = () => { const p = c.dataset.p; F.products.has(p) ? F.products.delete(p) : F.products.add(p); c.classList.toggle('on'); });

  // visited by (admin only, new report)
  const drawVby = (searching) => {
    const el = $b('#f-vby'); if (!el) return;
    const p = S.dir.get(F.visitor) || {}, isMe = F.visitor === F.myEmp;
    const asgTo = openAsgAll().filter(a => a.entity_id === F.entity.id).map(a => a.assignee);
    const note = isMe ? '<p class="hint" style="margin:6px 0 0">Your own visit.</p>'
      : `<p class="hint" style="margin:6px 0 0">Counts as <b>${esc(personName(F.visitor))}</b>'s visit and shows in their visits, marked "Entered by admin".${asgTo.length && !asgTo.includes(F.visitor) ? ` This place is allotted to ${asgTo.map(e => esc(personName(e))).join(', ')}: that allotment will show as visited by a colleague.` : ''}</p>`;
    el.innerHTML = searching ? `${searchHTML('f-vq', 'Name, Emp ID or branch', '')}<div class="list" id="f-vl"></div>`
      : `<div class="item" style="cursor:default"><div class="avatar">${esc(initials(isMe ? (S.who.me || {}).name || 'Me' : p.name || ''))}</div>
          <div class="grow"><div class="t">${isMe ? 'Me' : esc(cleanName(p.name || 'Emp ' + F.visitor))}</div><div class="s">${esc(p.designation || '')}${p.branch ? ' · ' + esc(p.branch) : ''}</div></div>
          <button type="button" class="btn small ghost" id="f-vch">Change</button></div>${note}`;
    if (!searching) { $b('#f-vch').onclick = () => drawVby(true); return; }
    const q = $b('#f-vq');
    const list = () => {
      const t = q.value.trim().toLowerCase();
      const rows = [...S.dir.values()].filter(x => x.emp_id !== F.myEmp && (!t || (x.name + ' ' + (x.branch || '') + ' ' + x.emp_id).toLowerCase().includes(t)))
        .sort((a, b) => (asgTo.includes(b.emp_id) - asgTo.includes(a.emp_id)) || cleanName(a.name).localeCompare(cleanName(b.name))).slice(0, t ? 30 : 8);
      $b('#f-vl').innerHTML = (F.myEmp && !t ? `<button type="button" class="item" data-vb="${F.myEmp}"><div class="grow"><div class="t">Me</div><div class="s">My own visit</div></div></button>` : '')
        + rows.map(x => `<button type="button" class="item" data-vb="${x.emp_id}"><div class="grow"><div class="t">${esc(cleanName(x.name))}</div><div class="s">${esc(x.designation || '')} · ${esc(x.branch || '')}${asgTo.includes(x.emp_id) ? ' · <b>allotted this place</b>' : ''}</div></div></button>`).join('');
      $$('[data-vb]', body).forEach(b => b.onclick = () => { F.visitor = +b.dataset.vb; F.joint.delete(F.visitor); drawJoint(); drawVby(false); });
    };
    q.oninput = list; bindSearch(q, list); list(); setTimeout(() => q.focus(), 50);
  };
  drawVby(false);

  // joint visit picker
  const drawJoint = () => {
    $b('#f-joint').innerHTML = [...F.joint].map(e => `<button type="button" class="chip on" data-rmj="${e}">${esc(personName(e))} ✕</button>`).join('') || '<span class="hint">Nobody added.</span>';
    $$('[data-rmj]', body).forEach(c => c.onclick = () => { F.joint.delete(+c.dataset.rmj); drawJoint(); });
  };
  drawJoint();
  $b('#f-jq').oninput = () => {
    const t = $b('#f-jq').value.trim().toLowerCase(); const l = $b('#f-jl');
    if (t.length < 2) { l.hidden = true; return; }
    const rows = [...S.dir.values()].filter(p => p.emp_id !== F.visitor && !F.joint.has(p.emp_id) && (p.name + ' ' + (p.branch || '') + ' ' + p.emp_id).toLowerCase().includes(t)).slice(0, 8);
    l.hidden = !rows.length;
    l.innerHTML = rows.map(p => `<button type="button" class="item" data-addj="${p.emp_id}"><div class="grow"><div class="t">${esc(cleanName(p.name))}</div><div class="s">${esc(p.designation || '')} · ${esc(p.branch || '')}</div></div></button>`).join('');
    $$('[data-addj]', l).forEach(b => b.onclick = () => { F.joint.add(+b.dataset.addj); $b('#f-jq').value = ''; l.hidden = true; drawJoint(); });
  };

  // closure
  const drawAcs = () => {
    $b('#f-acs').innerHTML = F.account_numbers.map((a, i) => `<div class="row" style="margin-bottom:6px"><input class="input mono grow" data-ac="${i}" inputmode="numeric" value="${esc(a)}" placeholder="Account number">
      ${F.account_numbers.length > 1 ? `<button type="button" class="x" data-acrm="${i}" aria-label="Remove">${ICON.x}</button>` : ''}</div>`).join('');
    $$('[data-ac]', body).forEach(i => i.oninput = () => { F.account_numbers[+i.dataset.ac] = i.value.trim(); });
    $$('[data-acrm]', body).forEach(b => b.onclick = () => { F.account_numbers.splice(+b.dataset.acrm, 1); drawAcs(); });
  };
  drawAcs();
  $b('#f-acadd').onclick = () => { F.account_numbers.push(''); drawAcs(); };
  const mobw = () => { $b('#f-mobw').textContent = inr($b('#f-mob').value); };
  $b('#f-mob').oninput = mobw; mobw();
  const drawClose = () => {
    $$('#f-close .chip', body).forEach(x => { x.classList.toggle('on', x.dataset.c === F.closure); x.disabled = !!F.custLock && x.dataset.c !== 'existing_customer';
      if (x.dataset.c === 'existing_customer') x.hidden = !F.custLock && F.closure !== 'existing_customer'; });
    $b('#f-ao').hidden = F.closure !== 'account_opened';
    $b('#f-cnw').hidden = !F.closure; $b('#f-closehint').hidden = !F.closure || !!F.custLock;
    $b('#f-custhint').hidden = !F.custLock;
  };
  $$('#f-close .chip', body).forEach(c => c.onclick = () => {
    if (F.custLock || c.dataset.c === 'existing_customer') return;   // set only by the outcome
    F.closure = c.dataset.c;
    drawClose(); fuRule();
  });
  /* "Already our customer" → banking is Our bank, existing account number required, lead closed as Existing customer.
     A report submitted before this rule existed is left as it was unless its outcome is changed. */
  const custRule = () => {
    const out = $b('#f-out').value;
    const legacy = !F.isNew && !F.outcomeTouched && F.closure !== 'existing_customer';
    F.custLock = out === 'Already our customer' && !legacy;
    if (F.custLock) { F.closure = 'existing_customer'; F.banking_with = 'us'; }
    else if (F.closure === 'existing_customer') F.closure = '';
    $$('#f-bank button', body).forEach(x => { x.disabled = !!F.custLock && x.dataset.v !== 'us'; });
    $b('#f-banklock').hidden = !F.custLock;
    $b('#f-exreq').textContent = F.custLock ? '(required)' : '(optional)';
    // one box: under Outcome for "Already our customer", else under Their banking (same numbers either way)
    const box = $b('#f-exw'), home = F.custLock ? $b('#f-exout') : $b('#f-exbank');
    if (box.previousElementSibling !== home) home.after(box);
    drawBank(); drawClose();
  };
  // follow-up rules: none for a closed lead or an existing customer; required for Interested / Follow-up needed / Person not available
  const FU_REQUIRED = ['Interested', 'Follow-up needed', 'Person not available'];
  const fuRule = () => {
    const out = $b('#f-out').value;
    const why = F.closure === 'existing_customer' ? 'No follow-up: already our customer.' : F.closure ? `No follow-up: lead status is ${closureLabel(F.closure)}.` : out === 'Already our customer' ? 'No follow-up needed: already our customer.' : '';
    $b('#f-fuw').hidden = !!why; $b('#f-funo').hidden = !why; $b('#f-funo').textContent = why;
    const req = !why && FU_REQUIRED.includes(out);
    $b('#f-fureq').textContent = req ? '(required)' : '(optional)';
    $b('#f-fuclr').hidden = req;
  };
  $b('#f-out').addEventListener('change', () => { F.outcomeTouched = true; custRule(); fuRule(); });
  $b('#f-fuclr').onclick = () => { $b('#f-fu').value = ''; toast('Follow-up removed'); };
  if (!F.isNew && visitsOf(F.entity.id).some(x => x.id !== F.id && x.visit_no > no)) $b('#f-fuold').hidden = false;
  custRule(); fuRule();

  // photos
  const count = () => F.photos.length;
  const drawPhotos = () => {
    $b('#f-pc').textContent = `${count()} of ${PHOTO_MAX}`;
    $b('#f-ph').innerHTML = F.photos.map((p, i) => `<div class="pthumb"><img src="${p.preview || p.url || ''}" alt="">
      <span class="ptag">${p.source === 'capture' ? 'Live' : 'Uploaded'}</span>
      <button type="button" class="prm" data-prm="${i}" aria-label="Remove photo">${ICON.x}</button></div>`).join('')
      || '<div class="hint" style="grid-column:1/-1">No photos yet.</div>';
    $$('[data-prm]', body).forEach(b => b.onclick = () => {
      const p = F.photos.splice(+b.dataset.prm, 1)[0];
      if (p.existing) F.removed.push({ id: p.id, path: p.path });
      if (p.preview) URL.revokeObjectURL(p.preview);
      drawPhotos();
    });
    $b('#f-cam').disabled = $b('#f-upl').disabled = count() >= PHOTO_MAX;
  };
  drawPhotos();
  $b('#f-cam').onclick = () => $b('#f-camin').click();
  $b('#f-upl').onclick = () => $b('#f-uplin').click();
  $b('#f-camin').onchange = async ev => {
    const file = ev.target.files[0]; ev.target.value = ''; if (!file) return;
    toast('Adding photo…', 1500);
    let pos = F.pos && F.pos.lat != null && Date.now() - (F.pos.at || 0) < 60000 ? F.pos : await getPosition(10000);
    if (pos && pos.lat == null) pos = null;
    if (pos && (!F.pos || F.pos.lat == null)) { F.pos = { ...pos, source: 'gps', at: Date.now() }; $b('#f-loc').innerHTML = locText(F.pos); }
    const now = new Date();
    try {
      const { blob } = await processPhoto(file, { place: F.entity.name, person: F.visitor === F.myEmp ? cleanName(S.who.me.name) : `${personName(F.visitor)} (by ${cleanName((S.who.me || {}).name || 'admin')})`, when: now.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }), coords: pos ? fmtCoords(pos) : 'Location not available' });
      F.photos.push({ id: uuid(), blob, preview: URL.createObjectURL(blob), source: 'capture', taken_at: now.toISOString(), lat: pos ? pos.lat : null, lng: pos ? pos.lng : null });
      drawPhotos();
    } catch (e) { toast(e.message || 'Could not add that photo'); }
  };
  $b('#f-uplin').onchange = async ev => {
    const files = [...ev.target.files].slice(0, PHOTO_MAX - count()); ev.target.value = '';
    if (!files.length) return;
    if (ev.target.files.length > files.length) toast(`Only ${PHOTO_MAX} photos per visit. Added the first ${files.length}.`);
    for (const file of files) {
      try {
        const ex = await readExif(file);
        const { blob } = await processPhoto(file, null);
        F.photos.push({ id: uuid(), blob, preview: URL.createObjectURL(blob), source: 'upload', taken_at: ex.when || null, lat: ex.lat ?? null, lng: ex.lng ?? null });
      } catch (e) { toast(e.message || 'Could not add a photo'); }
    }
    drawPhotos();
  };

  $b('#f-save').onclick = () => saveForm(body, F);
}

/* Which allotment a new report completes: the visitor's own open allotment for this place, if it has no report yet.
   A report for someone the place isn't allotted to stays unlinked (the allotment then shows as visited by a colleague). */
function asgFor(F) {
  if (!F.isNew || F.visitor === F.myEmp) return F.assignment_id;
  const done = new Set(all('visits').filter(x => x.assignment_id).map(x => x.assignment_id));
  const a = openAsgAll().find(x => x.entity_id === F.entity.id && x.assignee === F.visitor && !done.has(x.id));
  return a ? a.id : null;
}
async function saveForm(body, F) {
  const $b = s => $(s, body);
  const err = m => { $b('#f-err').textContent = m; $b('#f-err').scrollIntoView({ block: 'center', behavior: 'smooth' }); };
  const when = $b('#f-when').value;
  const mob = $b('#f-pm').value.replace(/\D/g, '');
  const outcome = $b('#f-out').value;
  if (!when) return err('Please enter the date and time of the visit.');
  if (new Date(when) > new Date(Date.now() + 5 * 60000)) return err('The visit time cannot be in the future.');
  if (mob && mob.length !== 10) return err('Mobile number should be 10 digits.');
  if (!outcome && !F.closure) return err('Please choose an outcome.');
  const fuOn = !$b('#f-fuw').hidden, fuDate = fuOn ? $b('#f-fu').value : '';
  if (fuOn && ['Interested', 'Follow-up needed', 'Person not available'].includes(outcome) && !fuDate) return err('Please set a follow-up date. It is needed when the outcome is ' + outcome + '.');
  if (fuDate && when && fuDate < String(when).slice(0, 10)) return err('The follow-up date can\'t be before the visit date.');
  const accs = F.closure === 'account_opened' ? F.account_numbers.map(a => a.trim()).filter(Boolean) : [];
  if (F.closure === 'account_opened' && !accs.length) return err('Please enter the account number opened.');
  const exAccs = F.banking_with === 'us' ? F.existing_accounts.map(a => a.trim()).filter(Boolean) : [];
  if (F.closure === 'existing_customer' && !exAccs.length) return err('Please enter their existing account number. It is needed when the outcome is Already our customer.');
  const num = id => { const x = $b(id).value; return x === '' ? null : Number(x); };
  const visit = {
    entity_id: F.entity.id, assignment_id: asgFor(F), visitor: F.visitor,
    visited_at: new Date(when).toISOString(),
    lat: F.pos && F.pos.lat != null ? F.pos.lat : null, lng: F.pos && F.pos.lat != null ? F.pos.lng : null,
    accuracy_m: F.pos && F.pos.acc != null ? F.pos.acc : null, loc_source: F.pos && F.pos.lat != null ? 'gps' : 'none',
    person_name: $b('#f-pn').value.trim() || null, person_designation: $b('#f-pd').value.trim() || null, person_mobile: mob || null,
    banking_with: F.banking_with || null, other_bank: F.banking_with === 'other' ? ($b('#f-ob').value.trim() || null) : null,
    potential_rs: num('#f-pot'), products: [...F.products], outcome: outcome || null, remarks: $b('#f-rem').value.trim() || null,
    next_step: fuOn ? ($b('#f-next').value.trim() || null) : null, followup_on: fuOn ? (fuDate || null) : null,
    closure: F.closure || null, closure_note: F.closure ? ($b('#f-cn').value.trim() || null) : null,
    mobilised_rs: F.closure === 'account_opened' ? num('#f-mob') : null, account_numbers: accs
  };
  if (exAccs.length || (F.visit0 && F.visit0.existing_accounts && F.visit0.existing_accounts.length)) visit.existing_accounts = exAccs;   // only sent when used, so a database without it still accepts other reports
  const item = {
    id: F.id, isNew: F.isNew, visit, joint: [...F.joint], entityName: F.entity.name,
    addPhotos: F.photos.filter(p => !p.existing).map(({ preview, ...p }) => p), removePhotos: F.removed
  };
  const btn = $b('#f-save'); btn.disabled = true; btn.textContent = 'Sending…'; $b('#f-err').textContent = '';
  try {
    const r = await submitVisit(item);
    F.photos.forEach(p => p.preview && URL.revokeObjectURL(p.preview));
    closeSheet();
    toast(r === 'queued' ? 'No signal. Saved on this phone; it will send by itself.' : (F.isNew ? 'Visit submitted' : 'Changes saved'), 3500);
    if (VIEWS[S.tab]) VIEWS[S.tab]();   // redraw from the phone's copy (the saved visit is already in it)
  } catch (e) {
    btn.disabled = false; btn.textContent = F.isNew ? 'Submit Visit Report' : 'Save changes';
    err(errText(e));
  }
}
