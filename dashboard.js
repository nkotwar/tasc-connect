/* TASC Connect · Dashboard (admin and viewers). Everything is worked out on the phone from the live data:
   completion, overdue ageing, delays, business, verification pending, officers, photos.
   Plus WhatsApp nudges, Excel export and a shareable summary image. */

async function fetchAll(build) {
  const out = []; let from = 0;
  while (true) { const p = await q(build().range(from, from + 999)); out.push(...p); if (p.length < 1000) break; from += 1000; }
  return out;
}
const localDay = iso => iso ? new Date(iso).toLocaleDateString('en-CA') : null;   // YYYY-MM-DD in local time
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
const inrShort = n => { n = +n || 0; if (n >= 1e7) return '₹' + (n / 1e7).toFixed(n >= 1e8 ? 0 : 1) + ' Cr'; if (n >= 1e5) return '₹' + (n / 1e5).toFixed(n >= 1e6 ? 0 : 1) + ' L'; return '₹' + Math.round(n).toLocaleString('en-IN'); };
const daoraLink = () => location.origin + location.pathname;
const waLink = (phone, text) => { const p = String(phone || '').replace(/\D/g, '').slice(-10); return p.length === 10 ? `https://wa.me/91${p}?text=${encodeURIComponent(text)}` : null; };
const telLink = phone => { const p = String(phone || '').replace(/\D/g, '').slice(-10); return p.length === 10 ? `tel:+91${p}` : null; };

/* Everything comes from the phone's copy: opening or filtering the dashboard makes no database call. */
async function loadDashData() { await loadBasics(); S.cache.dash = qDash(); return S.cache.dash; }

/* Turn raw rows into everything the dashboard shows, for the chosen filters. */
function dashModel(D, f) {
  const today = todayISO();
  const tmr = nextWorkingDay();   // next working day: skips Sundays and 2nd / 4th Saturdays
  const staff = e => S.dir.get(e) || {};
  const bname = new Map(D.branches.map(b => [b.code, b.name]));
  const ro = new Set(D.branches.filter(b => b.is_ro).map(b => b.code));
  const asgCamp = new Map(D.asg.map(a => [a.id, a.campaign_id]));
  const okA = a => (!f.camp || a.campaign_id === f.camp) && (!f.type || a.entity.type === f.type) && (!f.branch || staff(a.assignee).branch_code === f.branch) && !(f.noRO && ro.has(staff(a.assignee).branch_code));
  const okV = v => (!f.camp || (v.assignment_id && asgCamp.get(v.assignment_id) === f.camp)) && (!f.type || v.entity.type === f.type) && (!f.branch || v.visitor_branch === f.branch) && !(f.noRO && ro.has(v.visitor_branch));

  const firstVisit = new Map();
  D.vis.forEach(v => { if (v.assignment_id) { const c = firstVisit.get(v.assignment_id); if (!c || v.visit_no < c.visit_no) firstVisit.set(v.assignment_id, v); } });

  const entVisits = new Map();
  D.vis.slice().sort((x, y) => x.visit_no - y.visit_no).forEach(v => { if (!entVisits.has(v.entity_id)) entVisits.set(v.entity_id, []); entVisits.get(v.entity_id).push(v); });
  const rows = D.asg.filter(okA).map(a => {
    const own = firstVisit.get(a.id);
    const ov = !own && (entVisits.get(a.entity.id) || []).find(x => x.visitor !== a.assignee);   // visited by a colleague
    const v = own || ov;
    const back = v && v.status === 'returned';   // sent back: pending again
    const st = v && !back ? (v.status === 'verified' ? 'verified' : 'submitted') : D.hold && D.hold.has(a.id) ? 'hold' : (a.scheduled_on && a.scheduled_on < today ? 'overdue' : 'notdue');
    return { a, v: back ? null : v, back: back ? v : null, by: ov ? ov.visitor : null, st, late: st === 'overdue' ? daysBetween(a.scheduled_on, today) : 0, delay: v && !back && a.scheduled_on ? daysBetween(a.scheduled_on, localDay(v.visited_at)) : null };
  });
  const vis = D.vis.filter(okV);
  const n = { total: rows.length, verified: 0, submitted: 0, overdue: 0, notdue: 0, hold: 0 };
  rows.forEach(r => n[r.st]++);
  const visited = n.verified + n.submitted;

  const ageing = [['1–3 days', 1, 3], ['4–7 days', 4, 7], ['8–15 days', 8, 15], ['15+ days', 16, 1e9]].map(([l, lo, hi]) => ({ l, n: rows.filter(r => r.st === 'overdue' && r.late >= lo && r.late <= hi).length }));
  const delays = rows.filter(r => r.delay != null);
  const onTime = delays.filter(r => r.delay <= 0).length;
  const avgDelay = delays.length ? delays.reduce((s, r) => s + Math.max(0, r.delay), 0) / delays.length : 0;

  // latest visit per place → follow-ups due and closures
  const latest = new Map();
  vis.forEach(v => { const c = latest.get(v.entity_id); if (!c || v.visit_no > c.visit_no) latest.set(v.entity_id, v); });
  const followDue = [...latest.values()].filter(v => v.followup_on && v.followup_on <= today && !v.closure).sort((a, b) => a.followup_on.localeCompare(b.followup_on));
  const opened = vis.filter(v => v.closure === 'account_opened');
  const biz = {
    potential: [...latest.values()].reduce((s, v) => s + (+v.potential_rs || 0), 0),
    mobilised: opened.reduce((s, v) => s + (+v.mobilised_rs || 0), 0),
    accounts: opened.reduce((s, v) => s + (v.account_numbers || []).length, 0),
    opened: opened.length, existing: vis.filter(v => v.closure === 'existing_customer').length, rejected: vis.filter(v => v.closure === 'rejected').length, notFeasible: vis.filter(v => v.closure === 'not_feasible').length,
    places: latest.size
  };
  const countBy = (arr, key) => { const m = new Map(); arr.forEach(x => [].concat(key(x) || []).forEach(k => m.set(k, (m.get(k) || 0) + 1))); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
  const outcomes = countBy(vis, v => v.outcome);
  const products = countBy(vis, v => v.products);
  const banking = countBy([...latest.values()], v => ({ us: 'Our bank', other: 'Other bank', none: 'None / not known' }[v.banking_with]));
  const otherBanks = countBy([...latest.values()].filter(v => v.banking_with === 'other' && v.other_bank), v => v.other_bank.split(/[,/&]+/).map(s => s.trim().toUpperCase()).filter(Boolean));

  // by branch (assignee's branch for allotments)
  const byBranch = new Map();
  const bb = code => { if (!byBranch.has(code)) byBranch.set(code, { code, ro: ro.has(code), name: bname.get(code) || '—', total: 0, visited: 0, verified: 0, overdue: 0, today: 0, tmr: 0 }); return byBranch.get(code); };
  // every branch with staff appears, even with nothing allotted (unless one branch is filtered)
  new Set([...S.dir.values()].map(p => p.branch_code)).forEach(code => { if (code != null && (!f.branch || code === f.branch)) bb(code); });
  rows.forEach(r => { const b = bb(staff(r.a.assignee).branch_code); b.total++; if (r.v) b.visited++; if (r.st === 'verified') b.verified++; if (r.st === 'overdue') b.overdue++;
    if (r.st === 'notdue' && r.a.scheduled_on === today) b.today++;
    if (r.st === 'notdue' && r.a.scheduled_on > today && r.a.scheduled_on <= tmr) b.tmr++; });   // weekend-dated visits count towards the next working day
  // by officer
  const byOff = new Map();
  const oo = e => { if (!byOff.has(e)) byOff.set(e, { emp: e, name: cleanName(staff(e).name || 'Emp ' + e), branch: staff(e).branch || '', phone: staff(e).phone, total: 0, visited: 0, overdue: 0, today: 0, own: 0, delaySum: 0, delayN: 0, pending: [], dueToday: [] }); return byOff.get(e); };
  rows.forEach(r => { const o = oo(r.a.assignee); o.total++; if (r.v) o.visited++; if (r.st === 'overdue') { o.overdue++; o.pending.push(r); }
    if (r.st === 'notdue' && r.a.scheduled_on === today) { o.today++; o.dueToday.push(r); } if (r.delay != null) { o.delaySum += Math.max(0, r.delay); o.delayN++; } });
  vis.filter(v => !v.assignment_id).forEach(v => oo(v.visitor).own++);
  // by type
  const byType = countBy(rows, r => r.a.entity.type).map(([t]) => { const rr = rows.filter(r => r.a.entity.type === t); return { t, total: rr.length, visited: rr.filter(r => r.v).length, overdue: rr.filter(r => r.st === 'overdue').length }; });
  // verification pending (only the admin verifies)
  const waitingV = vis.filter(v => v.status === 'submitted');
  const waitOldest = waitingV.reduce((m, v) => !m || v.logged_at < m ? v.logged_at : m, null);
  return { today, tmr, rows, vis, n, visited, ageing, delays, onTime, avgDelay, followDue, biz, outcomes, products, banking, otherBanks,
    byBranch: [...byBranch.values()].sort((a, b) => (b.ro - a.ro) || a.name.localeCompare(b.name)),   // Udaipur RO first, then A–Z
    byOff: [...byOff.values()].sort((a, b) => b.overdue - a.overdue || b.today - a.today || a.name.localeCompare(b.name)),
    byType, waiting: waitingV.length, waitOldest, bname };
}

/* ───────── view ───────── */
async function viewDashboard(force = false) {
  const main = TV();
  if (!S.who.viewer) { main.innerHTML = '<div class="empty">For admin and viewers.</div>'; return; }
  if (!main.children.length) main.innerHTML = '<div class="spin"></div>';
  let D;
  try { D = await loadDashData(force); } catch (e) { main.innerHTML = `<div class="empty"><p>${esc(errText(e))}</p><button class="btn" id="rt">Try again</button></div>`; $('#rt').onclick = () => viewDashboard(true); return; }
  const f = S.cache.dashF || (S.cache.dashF = { camp: null, type: null, branch: null });
  const M = dashModel(D, f);
  S.cache.dashM = M;
  const types = [...new Set(D.asg.map(a => a.entity.type).concat(D.vis.map(v => v.entity.type)))].sort();
  const branchOpts = D.branches.filter(b => [...S.dir.values()].some(p => p.branch_code === b.code)).sort((a, b) => a.name.localeCompare(b.name));
  const sel = (id, label, opts, val) => `<select class="input dsel" id="${id}" aria-label="${label}"><option value="">${label}: all</option>${opts.map(([v, l]) => `<option value="${v}" ${String(val) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const N = M.n;

  main.innerHTML = `${S.updateReady ? updateBar() : ''}
    <div class="dfilters">
      ${D.camps.length > 1 ? sel('df-c', 'Campaign', D.camps.map(c => [c.id, c.name]), f.camp) : ''}
      ${sel('df-t', 'Type', types.map(t => [t, t]), f.type)}
      ${sel('df-b', 'Branch', branchOpts.map(b => [b.code, b.name]), f.branch)}
      <button class="btn small ghost" id="df-r" title="Reload the latest data">↻</button>
    </div>
    <div class="hint" style="margin:-4px 0 10px">Synced ${syncedAgo()}. Allotment figures follow the allotted officer's branch; business figures follow the visitor's branch.</div>

    <div class="stats s6">
      ${tile(N.total, 'Allotted', '', 'allotted')}
      ${tile(M.visited, `Visited · ${pct(M.visited, N.total)}%`, 'ok', 'visited')}
      ${tile(N.overdue, 'Overdue', N.overdue ? 'bad' : '', 'overdue')}
      ${tile(N.verified, `Verified · ${pct(N.verified, M.visited)}%`, '', 'verified')}
      ${M.followDue.length ? `<div class="stat warn tap" role="button" onclick="document.getElementById('fu-card').scrollIntoView({behavior:'smooth',block:'start'})"><b>${M.followDue.length}</b><span>Follow-ups due</span></div>` : tile(0, 'Follow-ups due')}
      ${tile(M.biz.opened, 'Accounts opened', 'ok', 'opened')}
    </div>

    <div class="card"><h3>By branch</h3>
      <div class="tbl"><table><thead><tr><th>Branch</th><th>Allotted</th><th>Visited</th><th>Overdue</th><th>Due today</th><th>Due ${shortDay(M.tmr)}</th><th>Done</th></tr></thead><tbody>
      ${M.byBranch.map(b => `<tr data-br="${b.code}"><td>${esc(b.name)}</td><td class="mono">${b.total}</td><td class="mono">${b.visited}</td><td class="mono ${b.overdue ? 'bad' : ''}">${b.overdue}</td><td class="mono ${b.today ? 'warn' : ''}">${b.today || '·'}</td><td class="mono">${b.tmr || '·'}</td><td>${minibar(pct(b.visited, b.total))}</td></tr>`).join('') || '<tr><td colspan="7" class="hint">No branches.</td></tr>'}
      </tbody></table></div>
      <p class="hint">Tap a branch for its officers and pending visits.</p>
    </div>

    <div class="card"><h3>Progress</h3>
      ${stackBar([['Verified', N.verified, 'ok'], ['Visited, not verified', N.submitted, 'acc'], ['Not due yet', N.notdue, 'mute'], ['On hold (request)', N.hold, 'warn'], ['Overdue', N.overdue, 'bad']], N.total)}
    </div>

    <div class="card"><h3>By type</h3>
      <div class="tbl"><table><thead><tr><th>Type</th><th>Allotted</th><th>Visited</th><th>Overdue</th><th>Done</th></tr></thead><tbody>
      ${M.byType.map(t => `<tr><td>${esc(t.t)}</td><td class="mono">${t.total}</td><td class="mono">${t.visited}</td><td class="mono ${t.overdue ? 'bad' : ''}">${t.overdue}</td><td>${minibar(pct(t.visited, t.total))}</td></tr>`).join('')}
      </tbody></table></div>
    </div>

    <div class="card"><h3>Officers</h3>${offSummary(M)}
      <div class="list" id="offl">${offRows(M, M.byOff.filter(offDue).slice(0, 5))}</div>
      <button class="btn ghost block small" id="offall" style="margin-top:10px">See all ${M.byOff.length} officers ›</button>
    </div>

    <div class="card"><h3>Overdue ageing</h3>
      ${N.overdue ? hbars(M.ageing.map(x => [x.l, x.n]), 'bad') : '<p class="hint">Nothing overdue.</p>'}
      <div class="row wrap" style="margin-top:10px;gap:14px">
        <span class="hint">On time or early: <b class="mono">${M.onTime}/${M.delays.length}</b></span>
        <span class="hint">Average delay: <b class="mono">${M.avgDelay.toFixed(1)} d</b></span>
      </div>
    </div>

    <div class="card"><h3>Business</h3>
      <div class="stats" style="margin-bottom:6px">${tile(inrShort(M.biz.potential), 'Potential')}${tile(inrShort(M.biz.mobilised), 'Mobilised', 'ok')}${tile(M.biz.accounts, 'Accounts')}</div>
      <p class="hint">Closures: ${M.biz.opened} opened · ${M.biz.existing} existing customer${M.biz.existing === 1 ? '' : 's'} · ${M.biz.rejected} rejected · ${M.biz.notFeasible} not feasible, across ${M.biz.places} places visited. Potential counts each place's latest visit once.</p>
      ${M.outcomes.length ? `<h4 class="dh">Outcomes</h4>${hbars(M.outcomes)}` : ''}
      ${M.products.length ? `<h4 class="dh">Products discussed</h4>${hbars(M.products.slice(0, 10))}` : ''}
      ${M.banking.length ? `<h4 class="dh">Banks with</h4>${hbars(M.banking)}${M.otherBanks.length ? `<p class="hint" style="margin-top:6px">Other banks named: ${M.otherBanks.slice(0, 8).map(([b, c]) => `${esc(b)} (${c})`).join(', ')}</p>` : ''}` : ''}
      ${!M.vis.length ? '<p class="hint">No visits logged yet.</p>' : ''}
    </div>

    ${S.who.admin ? `<div class="card"><h3>Waiting for verification</h3>
      ${M.waiting ? `<div class="row"><div class="grow"><b class="mono" style="font-size:20px">${M.waiting}</b> report${M.waiting > 1 ? 's' : ''} · oldest ${ago(M.waitOldest)}</div>
        <button class="btn small soft" id="d-ver">Open Verify</button></div>` : '<p class="hint">Nothing waiting.</p>'}
    </div>` : ''}

    ${M.followDue.length ? `<div class="card" id="fu-card" style="scroll-margin-top:70px"><h3>Follow-ups due</h3><div class="list">${M.followDue.slice(0, 30).map(v => `<button class="item" data-v="${v.id}"><div class="grow"><div class="t">${esc(v.entity.name)}</div>
      <div class="s">${esc(personName(v.visitor))} · ${esc(v.next_step || 'Follow-up')}</div></div><span class="badge ${v.followup_on < M.today ? 'bad' : 'warn'}">${fmtDate(v.followup_on)}</span></button>`).join('')}</div></div>` : ''}

    <div class="card"><h3>Latest photos</h3><div class="pgrid pgrid3" id="gal"><div class="hint" style="grid-column:1/-1">Loading…</div></div></div>

    <div class="card"><h3>Share &amp; export</h3>
      <div class="stack">
        <button class="btn block" id="dx-img">Summary image for WhatsApp</button>
        <button class="btn ghost block" id="dx-pdf">Pending visits, staff-wise (PDF)</button>
        <button class="btn ghost block" id="dx-xls">Download Excel (all data)</button>
      </div>
      <p class="hint">The image and the Excel follow the filters above.</p>
    </div>`;

  // filters
  const setF = (k, v) => { f[k] = v || null; viewDashboard(); };
  if ($('#df-c')) $('#df-c').onchange = e => setF('camp', +e.target.value || null);
  $('#df-t').onchange = e => setF('type', e.target.value);
  $('#df-b').onchange = e => setF('branch', +e.target.value || null);
  if ($('#d-ver')) $('#d-ver').onclick = () => { S.cache.adminSeg = 'verify'; show('admin'); setTimeout(() => { const h = $('#adm-host'); if (h && h._pager) h._pager.go('verify'); }, 50); };
  $('#df-r').onclick = async () => { $('#df-r').disabled = true; try { await syncAndRefresh(); } catch (e) { toast(errText(e)); } const b = $('#df-r'); if (b) b.disabled = false; };
  $$('[data-br]').forEach(r => r.onclick = () => openBranch(+r.dataset.br));
  bindOfficers(M);
  $$('[data-v]', main).forEach(b => b.onclick = () => openVisit(b.dataset.v));
  $('#dx-img').onclick = () => askSummaryImage(M, f, D);
  $('#dx-xls').onclick = () => exportExcel(M, D);
  $('#dx-pdf').onclick = () => askPendingPdf(M, f, D);
  loadGallery(f, M);
}

/* Next working day for a bank: skips Sundays and the 2nd and 4th Saturday of the month */
function nextWorkingDay(from = new Date()) {
  const d = new Date(from); d.setHours(12, 0, 0, 0);
  for (;;) {
    d.setDate(d.getDate() + 1);
    const wd = d.getDay(), nth = Math.ceil(d.getDate() / 7);
    if (wd === 0 || (wd === 6 && (nth === 2 || nth === 4))) continue;
    return d.toLocaleDateString('en-CA');
  }
}
const shortDay = iso => new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const tile = (v, l, cls = '', go = '') => `<div class="stat ${cls} ${go && S.who.me ? 'tap' : ''}" ${go && S.who.me ? `data-goplace="${go}" role="button"` : ''}><b>${typeof v === 'number' ? v.toLocaleString('en-IN') : v}</b><span>${l}</span></div>`;
const minibar = p => `<div class="mini" title="${p}% visited"><i style="width:${p}%"></i></div><span class="mono hint">${p}%</span>`;
function stackBar(parts, total) {
  if (!total) return '<p class="hint">No allotments for these filters.</p>';
  return `<div class="stack-bar" role="img" aria-label="${parts.map(([l, n]) => `${l} ${n}`).join(', ')}">${parts.filter(p => p[1]).map(([l, n, c]) =>
      `<i class="sb-${c}" style="flex:${n}" title="${l}: ${n} (${pct(n, total)}%)"></i>`).join('')}</div>
    <div class="legend">${parts.map(([l, n, c]) => `<span><i class="sb-${c}"></i>${l} <b class="mono">${n}</b></span>`).join('')}</div>`;
}
function hbars(pairs, cls = '') {
  const max = Math.max(1, ...pairs.map(p => p[1]));
  return `<div class="hbars">${pairs.map(([l, n]) => `<div class="hb" title="${esc(l)}: ${n}"><span class="hl">${esc(l)}</span><span class="ht"><i class="${cls}" style="width:${Math.max(2, n / max * 100)}%"></i></span><b class="mono">${n}</b></div>`).join('')}</div>`;
}
const nudgeBtns = (wa, tel) => `${wa ? `<a class="nb wa" href="${wa}" target="_blank" rel="noopener" title="WhatsApp" aria-label="WhatsApp">${ICON.wa}</a>` : ''}${tel ? `<a class="nb" href="${tel}" title="Call" aria-label="Call">${ICON.phone}</a>` : ''}`;
function overdueMsg(o) {
  const all = [...o.pending, ...(o.dueToday || [])], n = all.length;
  const list = all.slice(0, 6).map(r => `• ${r.a.entity.name} (${r.st === 'overdue' ? 'due ' + fmtDate(r.a.scheduled_on) : 'due today'})`).join('\n');
  return `Dear ${o.name}, ${n} visit${n > 1 ? 's' : ''} allotted to you ${n > 1 ? 'are' : 'is'} pending in TASC Connect:\n${list}${n > 6 ? `\n…and ${n - 6} more` : ''}\nKindly visit and submit the visit report: ${daoraLink()}\n– Regional Office, Udaipur`;
}
const offDue = o => o.overdue || o.today;
/* Dashboard card: a one-line summary and the 5 most behind; everyone else in a panel (search, branch, sort) */
function offSummary(M) {
  const late = M.byOff.filter(o => o.overdue).length, today = M.byOff.filter(o => o.today).length;
  return late || today ? `<p class="muted" style="margin:-2px 0 8px">${late ? `<b>${late}</b> officer${late > 1 ? 's have' : ' has'} overdue visits` : ''}${late && today ? ' · ' : ''}${today ? `<b>${today}</b> ${today > 1 ? 'have' : 'has'} visits due today` : ''}</p>` : '';
}
const OFF_SORT = {
  late: ['Most overdue', (a, b) => b.overdue - a.overdue || b.today - a.today || a.name.localeCompare(b.name)],
  cov: ['Lowest coverage', (a, b) => (a.total ? a.visited / a.total : 2) - (b.total ? b.visited / b.total : 2) || b.overdue - a.overdue || a.name.localeCompare(b.name)],
  most: ['Most visits', (a, b) => (b.visited + b.own) - (a.visited + a.own) || a.name.localeCompare(b.name)],
  az: ['A–Z', (a, b) => a.name.localeCompare(b.name)]
};
function openOfficers(M) {
  const st = S.cache.offAll || (S.cache.offAll = { q: '', br: '', f: 'due', sort: 'late' });
  const branches = M.byBranch.filter(b => M.byOff.some(o => (S.dir.get(o.emp) || {}).branch_code === b.code));
  const body = openSheet('Officers', `
    <div class="row" style="gap:8px;margin-bottom:10px">
      <select class="input dsel" id="oa-br" aria-label="Branch"><option value="">Branch: all</option>${branches.map(b => `<option value="${b.code}" ${String(b.code) === st.br ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>
      <select class="input dsel" id="oa-so" aria-label="Sort">${Object.entries(OFF_SORT).map(([k, v]) => `<option value="${k}" ${st.sort === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></div>
    ${searchHTML('oa-q', 'Name or emp ID', st.q)}
    <div class="chips" id="oa-f"></div>
    <div class="hint sline" id="oa-s" hidden></div>
    <div class="list" id="oa-l"></div>`);
  const draw = () => {
    st.q = $('#oa-q', body).value.trim(); st.br = $('#oa-br', body).value; st.sort = $('#oa-so', body).value;
    const inBr = M.byOff.filter(o => !st.br || String((S.dir.get(o.emp) || {}).branch_code) === st.br);
    const base = st.f === 'due' ? inBr.filter(offDue) : inBr;
    const t = st.q.toLowerCase();
    const list = base.filter(o => !t || (o.name + ' ' + o.emp).toLowerCase().includes(t)).sort(OFF_SORT[st.sort][1]);
    $('#oa-f', body).innerHTML = `<button class="chip ${st.f === 'due' ? 'on' : ''}" data-f="due">Overdue / due today<b>${inBr.filter(offDue).length}</b></button><button class="chip ${st.f === 'all' ? 'on' : ''}" data-f="all">All<b>${inBr.length}</b></button>`;
    $$('#oa-f [data-f]', body).forEach(b => b.onclick = () => { st.f = b.dataset.f; draw(); });
    searchSummary($('#oa-s', body), { shown: list.length, of: base.length, noun: 'officers', filters: [st.f === 'due' && 'Overdue / due today', st.br && M.bname.get(+st.br)], q: st.q,
      onClear: () => { $('#oa-q', body).value = ''; $('#oa-q', body).dispatchEvent(new Event('input')); } });
    $('#oa-l', body).innerHTML = list.length ? offRows(M, list) : `<div class="empty">${t ? 'No officer by that name.' : st.f === 'due' ? 'Nothing overdue or due today. 🎉' : 'No officers here.'}</div>`;
    $$('[data-off]', $('#oa-l', body)).forEach(b => b.onclick = () => (S.who.admin ? openStaff(+b.dataset.off) : openOfficer(+b.dataset.off)));
  };
  $('#oa-q', body).oninput = draw; bindSearch($('#oa-q', body), draw);
  $('#oa-br', body).onchange = draw; $('#oa-so', body).onchange = draw;
  draw();
}
function offChips(M) {
  const f = S.cache.offF === 'all' ? 'all' : 'due';
  return `<button class="chip ${f === 'due' ? 'on' : ''}" data-of="due">Overdue / due today<b>${M.byOff.filter(offDue).length}</b></button>`
    + `<button class="chip ${f === 'all' ? 'on' : ''}" data-of="all">All<b>${M.byOff.length}</b></button>`;
}
function offRows(M, list) {
  list = list || (S.cache.offF === 'all' ? M.byOff : M.byOff.filter(offDue));
  if (!list.length) return '<div class="empty">Nothing overdue or due today. 🎉</div>';
  return list.map(o => `<div class="item"><button class="grow" data-off="${o.emp}" style="all:unset;cursor:pointer;flex:1;min-width:0">
      <div class="t">${esc(o.name)}</div><div class="s">${esc(o.branch)} · ${o.visited}/${o.total} visited${o.own ? ` · +${o.own} own` : ''}${o.delayN ? ` · avg delay ${(o.delaySum / o.delayN).toFixed(1)} d` : ''}</div></button>
    <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end;flex:none">
      ${o.overdue ? `<span class="badge bad">${o.overdue} overdue</span>` : ''}${o.today ? `<span class="badge warn">${o.today} due today</span>` : ''}
      ${!offDue(o) ? `<span class="badge ok">${pct(o.visited, o.total)}%</span>` : ''}</div>
    ${offDue(o) ? nudgeBtns(waLink(o.phone, overdueMsg(o)), telLink(o.phone)) : nudgeBtns(null, telLink(o.phone))}</div>`).join('');
}
/* Officer pills redraw only the list, not the whole dashboard */
function bindOfficers(M, root = document) {
  const all = $('#offall', root); if (all) all.onclick = () => openOfficers(M);
  const wire = () => $$('[data-off]', $('#offl', root) || root).forEach(b => b.onclick = () => (S.who.admin ? openStaff(+b.dataset.off) : openOfficer(+b.dataset.off)));
  $$('#offc [data-of]', root).forEach(b => b.onclick = () => { S.cache.offF = b.dataset.of; $('#offc', root).innerHTML = offChips(M); $('#offl', root).innerHTML = offRows(M); bindOfficers(M, root); });
  wire();
}
/* A branch at a glance: its numbers, officers and what is pending */
function openBranch(code) {
  const M = S.cache.dashM; const b = M.byBranch.find(x => x.code === code); if (!b) return;
  const offs = M.byOff.filter(o => (S.dir.get(o.emp) || {}).branch_code === code);
  const pend = M.rows.filter(r => (S.dir.get(r.a.assignee) || {}).branch_code === code && (r.st === 'overdue' || (r.st === 'notdue' && r.a.scheduled_on <= M.tmr)))
    .sort((x, y) => (x.a.scheduled_on || '').localeCompare(y.a.scheduled_on || ''));
  const body = openSheet(b.name, `
    <div class="stats s6" style="margin-bottom:12px">
      ${tile(b.total, 'Allotted')}${tile(b.visited, `Visited · ${pct(b.visited, b.total)}%`, 'ok')}${tile(b.verified, 'Verified')}
      ${tile(b.overdue, 'Overdue', b.overdue ? 'bad' : '')}${tile(b.today, 'Due today', b.today ? 'warn' : '')}${tile(b.tmr, `Due ${shortDay(M.tmr)}`)}
    </div>
    <h2>Officers</h2><div class="list">${offRows(M, offs) || ''}</div>
    <h2>Pending till ${shortDay(M.tmr)}</h2>
    ${pend.length ? `<div class="list">${pend.map(r => `<button class="item" data-pe="${r.a.entity.id}"><div class="grow"><div class="t">${esc(r.a.entity.name)}</div>
      <div class="s">${esc(personName(r.a.assignee))} · due ${fmtDate(r.a.scheduled_on)}</div></div>
      <span class="badge ${r.st === 'overdue' ? 'bad' : r.a.scheduled_on === M.today ? 'warn' : ''}">${r.st === 'overdue' ? r.late + ' d delay' : r.a.scheduled_on === M.today ? 'Today' : shortDay(r.a.scheduled_on)}</span></button>`).join('')}</div>`
      : '<p class="hint">Nothing overdue or due soon.</p>'}
    <div class="spacer"></div>
    <button class="btn ghost block" id="br-filter">Filter the whole dashboard to ${esc(b.name)}</button>`);
  $$('[data-off]', body).forEach(x => x.onclick = () => (S.who.admin ? openStaff(+x.dataset.off) : openOfficer(+x.dataset.off)));
  $$('[data-pe]', body).forEach(x => x.onclick = () => { const r = pend.find(y => y.a.entity.id === x.dataset.pe); openPlace({ ...r.a.entity }, null); });
  $('#br-filter', body).onclick = () => { closeSheet(); (S.cache.dashF || {}).branch = code; viewDashboard(); window.scrollTo(0, 0); };
}

function openOfficer(emp) {
  const M = S.cache.dashM; const o = M.byOff.find(x => x.emp === emp); if (!o) return;
  const rows = M.rows.filter(r => r.a.assignee === emp).sort((a, b) => (a.a.scheduled_on || '').localeCompare(b.a.scheduled_on || ''));
  const own = M.vis.filter(v => v.visitor === emp && !v.assignment_id);
  const lbl = { verified: ['Verified', 'ok'], submitted: ['Visited', 'acc'], overdue: ['Overdue', 'bad'], notdue: ['Not due', ''], hold: ['🔒 On hold', 'warn'] };
  const body = openSheet(o.name, `
    <div class="row wrap" style="margin-bottom:10px"><span class="badge">${esc(o.branch)}</span><span class="badge ok">${o.visited}/${o.total} visited</span>${o.overdue ? `<span class="badge bad">${o.overdue} overdue</span>` : ''}</div>
    <div class="row">${o.overdue && waLink(o.phone, overdueMsg(o)) ? `<a class="btn soft grow" target="_blank" rel="noopener" href="${waLink(o.phone, overdueMsg(o))}">${ICON.wa} Nudge on WhatsApp</a>` : ''}
      ${telLink(o.phone) ? `<a class="btn ghost grow" href="${telLink(o.phone)}">${ICON.phone} Call</a>` : ''}</div>
    <h2>Allotted</h2><div class="list">${rows.map(r => `<button class="item" ${r.v ? `data-v="${r.v.id}"` : `data-e="${r.a.entity.id}"`}><div class="grow"><div class="t">${esc(r.a.entity.name)}</div>
      <div class="s">Due ${fmtDate(r.a.scheduled_on)}${r.v ? ' · visited ' + fmtDate(r.v.visited_at) + (r.by ? ' by ' + esc(personName(r.by)) : '') + (r.delay > 0 ? ` (${r.delay} d delay)` : '') : r.late ? ` · ${r.late} d delay` : ''}</div></div>
      <span class="badge ${lbl[r.st][1]}">${lbl[r.st][0]}</span></button>`).join('') || '<div class="empty">None.</div>'}</div>
    ${own.length ? `<h2>Own visits</h2><div class="list">${own.map(v => `<button class="item" data-v="${v.id}"><div class="grow"><div class="t">${esc(v.entity.name)} · V${v.visit_no}</div><div class="s">${fmtDateTime(v.visited_at)} · ${esc(v.outcome || closureLabel(v.closure) || '')}</div></div></button>`).join('')}</div>` : ''}`);
  $$('[data-v]', body).forEach(b => b.onclick = () => openVisit(b.dataset.v));
  $$('[data-e]', body).forEach(b => b.onclick = () => { const r = rows.find(x => x.a.entity.id === b.dataset.e); openPlace({ ...r.a.entity }, null); });
}

/* ───────── photo gallery ───────── */
async function loadGallery(f, M, limit = 6) {
  const el = $('#gal'); if (!el) return;
  try {
    const ids = new Set(M.vis.map(v => v.id));
    const filtered = f.camp || f.type || f.branch;
    let rows = all('photos').sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    rows = filtered ? rows.filter(p => ids.has(p.visit_id)) : rows.filter(p => { const v = get('visits', p.visit_id); return v && !isDup(v.entity_id); });
    rows = rows.slice(0, limit);
    if (!rows.length) { el.innerHTML = '<div class="hint" style="grid-column:1/-1">No photos yet.</div>'; return; }
    const urls = await signedThumbs(rows.map(p => p.path));
    const vmap = new Map(M.vis.map(v => [v.id, v]));
    el.innerHTML = rows.map(p => { const v = vmap.get(p.visit_id); return `<button class="pthumb" data-v="${p.visit_id}" title="${v ? esc(v.entity.name + ' · ' + personName(v.visitor)) : ''}" style="border:0;padding:0;cursor:pointer">
      <img src="${urls[p.path] || ''}" alt="" loading="lazy"><span class="ptag">${v ? esc(v.entity.name.slice(0, 18)) : ''}</span></button>`; }).join('');
    $$('[data-v]', el).forEach(b => b.onclick = () => openVisit(b.dataset.v));  } catch (e) { el.innerHTML = `<div class="hint" style="grid-column:1/-1">${esc(errText(e))}</div>`; }
}

/* ───────── summary image (1080 wide, as tall as needed: every branch, plus a totals row) ───────── */
/* ───────── Pending visits PDF (admin and viewers): overdue + due today, branch-wise then staff-wise, A4 pages ───────── */
function askPendingPdf(M, f, D) {
  const body = openSheet('Pending visits (PDF)', `
    <p class="muted" style="margin-top:0">Overdue and due-today visits, branch by branch and staff by staff, on A4 pages. Follows the Type and Branch filters above.</p>
    <label class="item" style="cursor:pointer"><div class="grow"><div class="t">Include Udaipur RO</div><div class="s">Regional Office staff's pending visits</div></div>
      <input type="checkbox" id="pp-ro" style="width:22px;height:22px"></label>
    <div class="spacer"></div>
    <button class="btn block" id="pp-go">Make PDF</button>`);
  $('#pp-go', body).onclick = async () => {
    const b = $('#pp-go', body); b.disabled = true; b.textContent = 'Preparing…';
    let out;
    try { out = await pendingPdf(M, f, D, $('#pp-ro', body).checked); }
    catch (e) { toast(errText(e)); b.disabled = false; b.textContent = 'Make PDF'; return; }
    shareReady(out);
  };
}

/* The PDF is ready: share it (with the message) or download it. Sharing needs a fresh tap, so it gets its own button. */
function shareReady({ blob, name, text, kind = 'PDF', mime = 'application/pdf', title = 'TASC Connect · Pending visits' }) {
  const body = openSheet(kind + ' ready', `
    <p class="muted" style="margin-top:0">${esc(name)} · ${Math.max(1, Math.round(blob.size / 1024))} KB</p>
    <label class="f">Message sent with it</label>
    <textarea class="input" id="pr-msg" rows="9" style="font-size:14px">${esc(text)}</textarea>
    <div class="stack" style="margin-top:12px">
      <button class="btn block" id="pr-share">${ICON.wa} Share ${kind} with message</button>
      <div class="row"><button class="btn ghost grow" id="pr-copy">Copy message</button><button class="btn ghost grow" id="pr-dl">Download ${kind}</button></div>
    </div>
    <p class="hint">If WhatsApp shows only the ${kind.toLowerCase()}, long-press in the chat and Paste: the message is copied when you share.</p>`);
  const msg = () => $('#pr-msg', body).value;
  const copy = async () => { try { await navigator.clipboard.writeText(msg()); return true; } catch (e) { return false; } };
  const file = new File([blob], name, { type: mime });
  const download = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
  $('#pr-copy', body).onclick = async () => toast(await copy() ? 'Message copied' : 'Could not copy. Select the text and copy it.');
  $('#pr-dl', body).onclick = () => { download(); toast(kind + ' downloaded'); };
  $('#pr-share', body).onclick = async () => {
    const copied = await copy();
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], text: msg(), title }); if (copied) toast('Shared. Message also copied, paste it if it is missing.', 3500); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    download(); toast(copied ? kind + ' downloaded and message copied' : kind + ' downloaded', 3000);
  };
}

async function pendingPdf(M, f, D, withRO) {
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
  const today = M.today;
  const pend = M.rows.filter(r => r.st === 'overdue' || (r.st === 'notdue' && r.a.scheduled_on === today));
  const byB = new Map();
  pend.forEach(r => {
    const p = S.dir.get(r.a.assignee) || {};
    const bc = p.branch_code, ro = !!(M.byBranch.find(b => b.code === bc) || {}).ro;
    if (ro && !withRO) return;
    if (!byB.has(bc)) byB.set(bc, { name: M.bname.get(bc) || p.branch || '—', ro, staff: new Map(), late: 0, today: 0 });
    const B = byB.get(bc);
    if (!B.staff.has(r.a.assignee)) B.staff.set(r.a.assignee, { name: cleanName(p.name || 'Emp ' + r.a.assignee), desig: p.designation || '', rows: [], late: 0, today: 0 });
    const sf = B.staff.get(r.a.assignee);
    sf.rows.push(r);
    if (r.st === 'overdue') { sf.late++; B.late++; } else { sf.today++; B.today++; }
  });
  const branches = [...byB.values()].sort((a, b) => (b.ro ? 1 : 0) - (a.ro ? 1 : 0) || a.name.localeCompare(b.name));
  branches.forEach(B => { B.list = [...B.staff.values()].sort((a, b) => b.late - a.late || b.today - a.today || a.name.localeCompare(b.name));
    B.list.forEach(sf => sf.rows.sort((a, b) => (a.a.scheduled_on || '').localeCompare(b.a.scheduled_on || ''))); });
  const totLate = branches.reduce((n, B) => n + B.late, 0), totToday = branches.reduce((n, B) => n + B.today, 0);
  const nStaff = branches.reduce((n, B) => n + B.list.length, 0);

  // A4 at 150 dpi
  const W = 1240, H = 1754, PAD = 70, FOOT = 80, BAND = 64, SROW = 58, PROW = 38;
  try { await document.fonts.load('600 30px "IBM Plex Sans"'); await document.fonts.load('600 30px "IBM Plex Mono"'); } catch (e) { /* fallback fonts */ }
  const logo = await new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = 'icon-192.png'; });
  const P = { bg: '#FFFFFF', card: '#F6F8FB', ink: '#142033', muted: '#5B6B80', faint: '#8A97A8', band: '#E6EDF6', acc: '#146CC0', bad: '#C2412D', badBg: '#FBE4E0', warn: '#A86A0F', warnBg: '#FBF0DC', red: '#D20838' };
  const sans = (w, z) => `${w} ${z}px "IBM Plex Sans", system-ui, sans-serif`, mono = (w, z) => `${w} ${z}px "IBM Plex Mono", monospace`;
  const pages = []; let c, x, y;
  const txt = (t, X, Y, o = {}) => { x.font = o.f || sans(400, 26); x.fillStyle = o.c || P.ink; x.textAlign = o.a || 'left'; x.textBaseline = 'alphabetic'; x.fillText(t, X, Y); };
  const fit = (t, maxW, font) => { x.font = font; if (x.measureText(t).width <= maxW) return t; while (t.length > 3 && x.measureText(t + '…').width > maxW) t = t.slice(0, -1); return t + '…'; };
  const rr = (X, Y, w, h, r, fill) => { x.beginPath(); x.roundRect(X, Y, w, h, r); x.fillStyle = fill; x.fill(); };
  const pill = (t, Xr, Y, fg, bg) => { x.font = sans(600, 21); const w = x.measureText(t).width + 26; rr(Xr - w, Y - 25, w, 34, 17, bg); txt(t, Xr - w / 2, Y - 1, { f: sans(600, 21), c: fg, a: 'center' }); return w; };
  const stamp = new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const scope = [f.type, f.branch && M.bname.get(f.branch)].filter(Boolean).join(' · ');
  const newPage = () => {
    c = document.createElement('canvas'); c.width = W; c.height = H; x = c.getContext('2d'); pages.push(c);
    x.fillStyle = P.bg; x.fillRect(0, 0, W, H);
    if (pages.length === 1) {
      if (logo) x.drawImage(logo, PAD, 60, 76, 76);
      txt('TASC Connect · Pending visits', PAD + 96, 102, { f: sans(700, 40) });
      txt(`Udaipur RO · Overdue and due today${scope ? ' · ' + scope : ''}`, PAD + 96, 136, { f: sans(400, 23), c: P.muted });
      txt(stamp, W - PAD, 102, { f: sans(500, 22), c: P.muted, a: 'right' });
      x.fillStyle = P.red; x.fillRect(PAD, 166, W - 2 * PAD, 4);
      [[totLate, 'Overdue', P.bad], [totToday, 'Due today', P.warn], [nStaff, 'Staff with pending', P.ink], [branches.length, 'Branches', P.ink]].forEach(([v, l, col], i) => {
        const w = (W - 2 * PAD - 3 * 16) / 4, cx = PAD + i * (w + 16), cy = 196;
        rr(cx, cy, w, 108, 16, P.card);
        txt(String(v), cx + 22, cy + 56, { f: mono(600, 40), c: col });
        txt(l, cx + 22, cy + 90, { f: sans(500, 21), c: P.muted });
      });
      y = 340;
    } else {
      txt('TASC Connect · Pending visits', PAD, 70, { f: sans(700, 24), c: P.muted });
      txt(stamp, W - PAD, 70, { f: sans(500, 20), c: P.faint, a: 'right' });
      x.fillStyle = P.red; x.fillRect(PAD, 88, W - 2 * PAD, 3);
      y = 116;
    }
  };
  const room = h => y + h <= H - FOOT;
  const band = (B, contd) => {
    rr(PAD, y, W - 2 * PAD, BAND, 14, P.band);
    txt(fit(B.name.toUpperCase() + (contd ? '  (continued)' : ''), 700, sans(700, 26)), PAD + 22, y + 42, { f: sans(700, 26), c: P.acc });
    let xr = W - PAD - 18;
    if (B.today) xr -= pill(`${B.today} today`, xr, y + 44, P.warn, P.warnBg) + 10;
    if (B.late) pill(`${B.late} overdue`, xr, y + 44, P.bad, P.badBg);
    y += BAND + 10;
  };
  newPage();
  if (!branches.length) txt('Nothing overdue or due today.', W / 2, y + 80, { f: sans(600, 30), c: P.muted, a: 'center' });
  branches.forEach(B => {
    if (!room(BAND + 10 + SROW + PROW + 10)) newPage();
    band(B, false);
    B.list.forEach(sf => {
      let i = 0, first = true;
      while (i < sf.rows.length) {
        // how many places fit on this page for this person
        let fitN = Math.floor((H - FOOT - y - SROW - 10) / PROW);
        if (fitN < 1) { newPage(); band(B, true); continue; }
        const n = Math.min(fitN, sf.rows.length - i), hgt = SROW + n * PROW;
        rr(PAD, y, W - 2 * PAD, hgt, 14, P.card);
        const nm = fit(sf.name + (first ? '' : ' (continued)'), 620, sans(700, 25));
        txt(nm, PAD + 22, y + 38, { f: sans(700, 25) });
        x.font = sans(700, 25); const nw = x.measureText(nm).width;
        if (first) txt(fit(sf.desig, 320, sans(400, 20)), PAD + 34 + nw, y + 38, { f: sans(400, 20), c: P.faint });
        if (first) { let xr = W - PAD - 18; if (sf.today) xr -= pill(`${sf.today} today`, xr, y + 40, P.warn, P.warnBg) + 10; if (sf.late) pill(`${sf.late} overdue`, xr, y + 40, P.bad, P.badBg); }
        let py = y + SROW + 26;
        sf.rows.slice(i, i + n).forEach(r => {
          const late = r.st === 'overdue';
          x.fillStyle = late ? P.bad : P.warn; x.beginPath(); x.arc(PAD + 30, py - 8, 5, 0, Math.PI * 2); x.fill();
          txt(fit(r.a.entity.name, 760, sans(400, 22)), PAD + 46, py, { f: sans(400, 22) });
          txt((r.back ? 'Sent back · ' : '') + (late ? `${r.late} d delay` : 'Today'), W - PAD - 22, py, { f: mono(600, 21), c: late ? P.bad : P.warn, a: 'right' });
          py += PROW;
        });
        y += hgt + 10; i += n; first = false;
        if (i < sf.rows.length) { newPage(); band(B, true); }
      }
    });
    y += 16;
  });
  // footers with page numbers
  pages.forEach((pg, k) => { x = pg.getContext('2d'); txt(`TASC Connect · Central Bank of India · via PDUDAIRO`, PAD, H - 40, { f: sans(500, 19), c: P.faint });
    txt(`Page ${k + 1} of ${pages.length}`, W - PAD, H - 40, { f: sans(500, 19), c: P.faint, a: 'right' }); });
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  pages.forEach((pg, k) => { if (k) pdf.addPage(); pdf.addImage(pg.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, 210, 297); });
  const blob = pdf.output('blob');
  const name = `TASC-Connect-pending-${todayISO()}.pdf`;
  const day = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const text = `*TASC Connect · Pending visits* (${day})\nOverdue: ${totLate} · Due today: ${totToday}\n\n`
    + `Please complete your pending visits and submit the visit reports.\n`
    + `To view or submit your visits, open TASC Connect, tap *Sign in with your name*, select your name and enter your date of birth:\n`
    + `${daoraLink()}\n\n– Regional Office, Udaipur`;
  return { blob, name, text };
}

function askSummaryImage(M, f, D) {
  const body = openSheet('Summary image', `
    <p class="muted" style="margin-top:0">A picture of the branch table and totals, to share on WhatsApp. Follows the Type and Branch filters above.</p>
    <label class="item" style="cursor:pointer"><div class="grow"><div class="t">Include Udaipur RO</div><div class="s">Regional Office staff's visits</div></div>
      <input type="checkbox" id="si-ro" style="width:22px;height:22px"></label>
    <div class="spacer"></div>
    <button class="btn block" id="si-go">Make image</button>`);
  $('#si-go', body).onclick = async () => {
    const b = $('#si-go', body); b.disabled = true; b.textContent = 'Preparing…';
    let out;
    try { out = await summaryImage(M, f, D, $('#si-ro', body).checked); }
    catch (e) { toast(errText(e)); b.disabled = false; b.textContent = 'Make image'; return; }
    shareReady(out);
  };
}
async function summaryImage(M, f, D, withRO) {
  if (!withRO) M = dashModel(D, { ...f, noRO: true });   // everything on the image leaves the Regional Office out
  const W = 1080, ROW = 46;
  const br = M.byBranch.filter(b => withRO || !b.ro);
  const H = 640 + 70 + (br.length + 1) * ROW + 120;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  try { await document.fonts.load('600 30px "IBM Plex Sans"'); await document.fonts.load('600 30px "IBM Plex Mono"'); } catch (e) { /* fallback fonts */ }
  const sans = (w, s) => `${w} ${s}px "IBM Plex Sans", system-ui, sans-serif`, mono = (w, s) => `${w} ${s}px "IBM Plex Mono", monospace`;
  const P = { bg: '#F3F5F8', card: '#FFFFFF', ink: '#142033', muted: '#5B6B80', faint: '#8A97A8', line: '#DCE2EA', zebra: '#F7F9FB', acc: '#146CC0', ok: '#12805C', bad: '#C2412D', warn: '#A86A0F', red: '#D20838', mute: '#B7C2D0' };
  const txt = (t, X, Y, o = {}) => { x.font = o.f || sans(400, 26); x.fillStyle = o.c || P.ink; x.textAlign = o.a || 'left'; x.textBaseline = 'alphabetic'; x.fillText(t, X, Y); };
  const rr = (X, Y, w, h, r, fill) => { x.beginPath(); x.roundRect(X, Y, w, h, r); x.fillStyle = fill; x.fill(); };
  x.fillStyle = P.bg; x.fillRect(0, 0, W, H);
  // header
  const logo = await new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = 'icon-192.png'; });
  if (logo) x.drawImage(logo, 60, 50, 76, 76);
  txt('TASC Connect · Visit report', 156, 92, { f: sans(700, 42) });
  const scope = [f.camp && (D.camps.find(cc => cc.id === f.camp) || {}).name, f.type, f.branch && M.bname.get(f.branch)].filter(Boolean).join(' · ') || 'All visits';
  txt(`Udaipur RO · ${scope}`, 156, 128, { f: sans(400, 26), c: P.muted });
  txt(new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }), W - 60, 92, { f: sans(500, 24), c: P.muted, a: 'right' });
  x.fillStyle = P.red; x.fillRect(60, 156, W - 120, 4);
  // tiles
  const N = M.n, dueT = br.reduce((s, b) => s + b.tmr, 0);
  const tiles = [[N.total, 'Allotted', P.ink], [`${M.visited} (${pct(M.visited, N.total)}%)`, 'Visited', P.ok], [N.overdue, 'Overdue', N.overdue ? P.bad : P.ink],
    [dueT, `Due ${shortDay(M.tmr)}`, dueT ? P.warn : P.ink], [M.biz.opened, 'Accounts opened', P.ok], [inrShort(M.biz.mobilised), 'Mobilised', P.ok]];
  tiles.forEach(([v, l, col], i) => {
    const cx = 60 + (i % 3) * 330, cy = 190 + Math.floor(i / 3) * 150;
    rr(cx, cy, 310, 130, 18, P.card);
    txt(String(v), cx + 24, cy + 66, { f: mono(600, 44), c: col });
    txt(l, cx + 24, cy + 106, { f: sans(500, 24), c: P.muted });
  });
  // progress bar
  let y = 510; const bw = W - 120;
  rr(60, y, bw, 26, 13, P.line);
  let bx = 60; [[N.verified, P.ok], [N.submitted, P.acc], [N.notdue, P.mute], [N.hold, P.warn], [N.overdue, P.bad]].forEach(([n, col]) => {
    if (!n || !N.total) return; const w = n / N.total * bw; x.fillStyle = col; x.fillRect(bx, y, w, 26); bx += w; });
  y += 62;
  [['Verified', N.verified, P.ok], ['Visited', N.submitted, P.acc], ['Not due', N.notdue, P.mute], ['On hold', N.hold, P.warn], ['Overdue', N.overdue, P.bad]].forEach(([l, n, col], i) => {
    const lx = 60 + i * 200; x.fillStyle = col; x.fillRect(lx, y - 18, 18, 18); txt(`${l} ${n}`, lx + 28, y, { f: sans(500, 24) }); });
  // branch table: every branch
  const cols = [['Allotted', 470], ['Visited', 590], ['Overdue', 720], ['Due today', 865], [`Due ${shortDay(M.tmr)}`, 1020]];
  y = 640 + 40;
  txt('Branch', 60, y, { f: sans(700, 24) });
  cols.forEach(([h, X]) => txt(h, X, y, { f: sans(700, 24), a: 'right' }));
  y += 16; x.fillStyle = P.ink; x.fillRect(60, y, W - 120, 2);
  const cell = (b, Y, bold) => {
    const w = bold ? 700 : 500, R = { a: 'right' };
    txt(b.name.length > 24 ? b.name.slice(0, 23) + '…' : b.name, 72, Y, { f: sans(w, 25) });
    txt(String(b.total), 470, Y, { ...R, f: mono(w, 25) });
    txt(String(b.visited), 590, Y, { ...R, f: mono(w, 25), c: b.visited ? P.ok : P.faint });
    txt(String(b.overdue), 720, Y, { ...R, f: mono(bold ? 700 : 600, 25), c: b.overdue ? P.bad : P.faint });
    txt(b.today ? String(b.today) : '–', 865, Y, { ...R, f: mono(w, 25), c: b.today ? P.warn : P.faint });
    txt(b.tmr ? String(b.tmr) : '–', 1020, Y, { ...R, f: mono(w, 25), c: b.tmr ? P.warn : P.faint });
  };
  const rt = cell;
  br.forEach((b, i) => {
    const top = y + i * ROW;
    if (i % 2 === 0) { x.fillStyle = P.zebra; x.fillRect(60, top + 2, W - 120, ROW); }
    rt(b, top + ROW - 14, false);
  });
  y += br.length * ROW;
  x.fillStyle = P.ink; x.fillRect(60, y + 2, W - 120, 2);
  const tot = br.reduce((t, b) => ({ name: 'Total', total: t.total + b.total, visited: t.visited + b.visited, overdue: t.overdue + b.overdue, today: t.today + b.today, tmr: t.tmr + b.tmr }), { total: 0, visited: 0, overdue: 0, today: 0, tmr: 0 });
  rt(tot, y + ROW - 10, true);
  // footer
  txt('TASC Connect · Central Bank of India · via PDUDAIRO', W / 2, H - 44, { f: sans(500, 22), c: P.faint, a: 'center' });
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const name = `TASC-Connect-summary-${todayISO()}.png`;
  const day = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const text = `*TASC Connect · Visit report* (${day})\n`
    + `Allotted: ${N.total} · Visited: ${M.visited} (${pct(M.visited, N.total)}%) · Overdue: ${N.overdue} · Due ${shortDay(M.tmr)}: ${dueT}\n\n`
    + `Please complete your pending visits and submit the visit reports.\n`
    + `To view or submit your visits, open TASC Connect, tap *Sign in with your name*, select your name and enter your date of birth:\n`
    + `${daoraLink()}\n\n– Regional Office, Udaipur`;
  return { blob, name, text, kind: 'Image', mime: 'image/png', title: 'TASC Connect · Visit report' };
}

/* ───────── Excel export (SheetJS, loaded only when needed) ───────── */
function loadScript(src) {
  return new Promise((res, rej) => { if ([...document.scripts].some(s => s.src === src)) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load the export tool. Check your internet.')); document.head.appendChild(s); });
}
async function exportExcel(M, D) {
  toast('Preparing Excel…', 2000);
  // xlsx-js-style: SheetJS with cell styles (bold headers, colours, number formats)
  try { await loadScript('https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js'); } catch (e) { toast(e.message); return; }
  const f = S.cache.dashF || {};
  const BLUE = '146CC0', LINE = 'D5DCE6';
  const border = { top: { style: 'thin', color: { rgb: LINE } }, bottom: { style: 'thin', color: { rgb: LINE } }, left: { style: 'thin', color: { rgb: LINE } }, right: { style: 'thin', color: { rgb: LINE } } };
  const FMT = { date: 'dd-mmm-yyyy', dt: 'dd-mmm-yyyy hh:mm', inr: '[>=10000000]"₹"##\\,##\\,##\\,##0;[>=100000]"₹"##\\,##\\,##0;"₹"##,##0', int: '0', pct: '0%', dec: '0.0' };
  const TINT = { 'Sent back': 'FDE2E4', 'Overdue': 'FDE2E4', 'Verified': 'DDF3E4', 'Visited (not verified)': 'FFF1D6', 'Submitted': 'FFF1D6', 'On hold (request pending)': 'E9ECF1', 'Account opened': 'DDF3E4' };
  // dates as Excel serial numbers in local (IST) wall time, so they show exactly as in the app
  const d = x => { if (!x) return ''; const t = new Date(x.length === 10 ? x + 'T00:00:00' : x); if (isNaN(t)) return '';
    return (Date.UTC(t.getFullYear(), t.getMonth(), t.getDate(), t.getHours(), t.getMinutes(), t.getSeconds()) - Date.UTC(1899, 11, 30)) / 864e5; };
  const st = { verified: 'Verified', submitted: 'Visited (not verified)', overdue: 'Overdue', notdue: 'Not due yet', hold: 'On hold (request pending)' };
  const filt = [f.camp && (all('campaigns').find(c => c.id === f.camp) || {}).name, f.type, f.branch && M.bname.get(f.branch)].filter(Boolean).join(' · ') || 'All campaigns, types and branches';

  /* One styled table. cols: [{ h: header, w: width, t: 'text'|'int'|'inr'|'date'|'dt'|'pct'|'dec', tint: true }] ; rows: arrays */
  const table = (title, cols, rows, totals) => {
    const aoa = [[title], [`Generated ${fmtDateTime(new Date().toISOString())} · ${filt}`], [], cols.map(c => c.h), ...rows];
    if (totals) aoa.push(totals);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const H = 3, last = aoa.length - 1;
    ws['!cols'] = cols.map(c => ({ wch: c.w }));
    ws['!rows'] = [{ hpt: 24 }, { hpt: 16 }, { hpt: 6 }, { hpt: 32 }];
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(0, cols.length - 1) } }, { s: { r: 1, c: 0 }, e: { r: 1, c: Math.max(0, cols.length - 1) } }];
    if (rows.length) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: H, c: 0 }, e: { r: H + rows.length, c: cols.length - 1 } }) };
    const cell = (r, c) => { const a = XLSX.utils.encode_cell({ r, c }); if (!ws[a]) ws[a] = { t: 's', v: '' }; return ws[a]; };
    cell(0, 0).s = { font: { bold: true, sz: 14, color: { rgb: BLUE } } };
    cell(1, 0).s = { font: { sz: 9, color: { rgb: '5B6B80' } } };
    cols.forEach((c, j) => { cell(H, j).s = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: BLUE } }, alignment: { vertical: 'center', horizontal: 'center', wrapText: true }, border }; });
    for (let r = H + 1; r <= last; r++) {
      const isTot = totals && r === last;
      cols.forEach((c, j) => {
        const x = cell(r, j);
        const fmt = FMT[c.t];
        const tint = c.tint && TINT[x.v];
        x.s = { border, alignment: { vertical: 'top', wrapText: c.t === 'text' && c.w >= 24, horizontal: ['int', 'inr', 'pct', 'dec'].includes(c.t) ? 'right' : (['date', 'dt'].includes(c.t) ? 'center' : 'left') },
          ...(fmt && x.t !== 's' ? { numFmt: fmt } : {}),
          ...(tint ? { fill: { fgColor: { rgb: tint } } } : (r % 2 === 0 ? { fill: { fgColor: { rgb: 'F7F9FC' } } } : {})),
          ...(isTot ? { font: { bold: true }, fill: { fgColor: { rgb: 'E8EEF6' } } } : {}) };
        if (fmt && x.t === 'n') x.z = fmt;
        if (x.t === 's' && x.v === '') delete x.v;
      });
    }
    return ws;
  };
  const sum = (rows, j) => rows.reduce((s, r) => s + (+r[j] || 0), 0);

  // Summary
  const N = M.n;
  const sumRows = [
    ['Allotted', N.total, ''], ['Visited', M.visited, N.total ? M.visited / N.total : 0], ['  of which verified', N.verified, M.visited ? N.verified / M.visited : 0],
    ['  of which awaiting verification', N.submitted, M.visited ? N.submitted / M.visited : 0], ['Overdue', N.overdue, N.total ? N.overdue / N.total : 0],
    ['Not due yet', N.notdue, ''], ['On hold (request pending)', N.hold, ''], ['Follow-ups due', M.followDue.length, ''],
    ['Places visited (any visit)', M.biz.places, ''], ['Accounts opened (places)', M.biz.opened, ''], ['Account numbers recorded', M.biz.accounts, ''],
    ['Existing customers (lead closed)', M.biz.existing, ''], ['Rejected', M.biz.rejected, ''], ['Not feasible', M.biz.notFeasible, ''], ['Business potential', M.biz.potential, ''], ['Business mobilised', M.biz.mobilised, '']
  ];
  const wsSum = table('TASC Connect · Summary', [{ h: 'Measure', w: 34, t: 'text' }, { h: 'Number', w: 16, t: 'int' }, { h: 'Share', w: 10, t: 'pct' }], sumRows);
  ['Business potential', 'Business mobilised'].forEach(lbl => { const r = 4 + sumRows.findIndex(x => x[0] === lbl); const a = XLSX.utils.encode_cell({ r, c: 1 }); ws_fmt(wsSum[a], FMT.inr); });
  function ws_fmt(c, z) { if (c) { c.z = z; c.s = { ...(c.s || {}), numFmt: z }; } }

  // Branches
  const brRows = M.byBranch.map(b => [b.name, b.total, b.visited, b.verified, b.overdue, b.today, b.tmr, b.total ? b.visited / b.total : 0]);
  const wsBr = table('Branch-wise progress', [{ h: 'Branch', w: 26, t: 'text' }, { h: 'Allotted', w: 10, t: 'int' }, { h: 'Visited', w: 10, t: 'int' }, { h: 'Verified', w: 10, t: 'int' },
    { h: 'Overdue', w: 10, t: 'int' }, { h: 'Due today', w: 10, t: 'int' }, { h: `Due ${shortDay(M.tmr)}`, w: 11, t: 'int' }, { h: 'Done %', w: 9, t: 'pct' }], brRows,
    ['Total', sum(brRows, 1), sum(brRows, 2), sum(brRows, 3), sum(brRows, 4), sum(brRows, 5), sum(brRows, 6), sum(brRows, 1) ? sum(brRows, 2) / sum(brRows, 1) : 0]);

  // Officers
  const ofRows = M.byOff.map(o => [o.name, o.emp, o.branch, o.total, o.visited, o.overdue, o.own, o.delayN ? +(o.delaySum / o.delayN).toFixed(1) : '', o.total ? o.visited / o.total : 0]);
  const wsOf = table('Officer-wise progress', [{ h: 'Officer', w: 28, t: 'text' }, { h: 'Emp ID', w: 9, t: 'int' }, { h: 'Branch', w: 20, t: 'text' }, { h: 'Allotted', w: 10, t: 'int' },
    { h: 'Visited', w: 10, t: 'int' }, { h: 'Overdue', w: 10, t: 'int' }, { h: 'Own visits (not allotted)', w: 13, t: 'int' }, { h: 'Avg delay (days)', w: 11, t: 'dec' }, { h: 'Done %', w: 9, t: 'pct' }], ofRows,
    ['Total', '', '', sum(ofRows, 3), sum(ofRows, 4), sum(ofRows, 5), sum(ofRows, 6), '', sum(ofRows, 3) ? sum(ofRows, 4) / sum(ofRows, 3) : 0]);

  // Allotments
  const alRows = M.rows.slice().sort((a, b) => (a.a.scheduled_on || '').localeCompare(b.a.scheduled_on || '')).map(r => [
    r.a.entity.name, r.a.entity.type, r.a.entity.area || '', personName(r.a.assignee), r.a.assignee, (S.dir.get(r.a.assignee) || {}).branch || '',
    d(r.a.scheduled_on), st[r.st], r.v ? d(r.v.visited_at) : '', r.v ? personName(r.v.visitor) : '', r.delay != null ? r.delay : (r.st === 'overdue' ? r.late : ''),
    r.v ? (r.v.outcome || '') : '', r.v ? closureLabel(r.v.closure) || '' : '', r.a.note || '']);
  const wsAl = table('Allotments', [{ h: 'Place', w: 40, t: 'text' }, { h: 'Type', w: 20, t: 'text' }, { h: 'Area', w: 16, t: 'text' }, { h: 'Officer', w: 26, t: 'text' },
    { h: 'Emp ID', w: 9, t: 'int' }, { h: 'Officer branch', w: 18, t: 'text' }, { h: 'Visit by', w: 13, t: 'date' }, { h: 'Status', w: 22, t: 'text', tint: true },
    { h: 'Visited on', w: 17, t: 'dt' }, { h: 'Visited by', w: 24, t: 'text' }, { h: 'Delay (days)', w: 10, t: 'int' }, { h: 'Outcome', w: 18, t: 'text' },
    { h: 'Closure', w: 16, t: 'text', tint: true }, { h: 'Note for staff', w: 30, t: 'text' }], alRows);

  // Visit reports (full details)
  const jointOf = id => all('joint').filter(j => j.visit_id === id).map(j => personName(j.emp_id)).join(', ');
  const photosOf = id => all('photos').filter(p => p.visit_id === id).length;
  const viRows = M.vis.slice().sort((a, b) => a.visited_at.localeCompare(b.visited_at)).map(v => [
    v.entity.name, v.entity.type, v.entity.area || '', v.visit_no, personName(v.visitor), v.visitor, M.bname.get(v.visitor_branch) || '',
    d(v.visited_at), d(v.logged_at), v.created_by_admin ? 'Yes' : '', v.assignment_id ? 'Yes' : 'No', jointOf(v.id),
    v.person_name || '', v.person_designation || '', v.person_mobile || '',
    { us: 'Our bank', other: 'Other bank', none: 'None / not known' }[v.banking_with] || '', v.other_bank || '',
    v.potential_rs != null ? +v.potential_rs : '', (v.products || []).join(', '), v.outcome || '', v.remarks || '', v.next_step || '',
    d(v.followup_on) || '', closureLabel(v.closure) || '', (v.account_numbers || []).join(', '), (v.existing_accounts || []).join(', '), v.mobilised_rs != null ? +v.mobilised_rs : '',
    photosOf(v.id), v.lat != null ? `${(+v.lat).toFixed(5)}, ${(+v.lng).toFixed(5)}` : '',
    v.status === 'verified' ? 'Verified' : v.status === 'returned' ? 'Sent back' : 'Submitted', d(v.verified_at) || '', v.verified_at ? (v.verified_by ? personName(v.verified_by) : 'Admin') : '']);
  const wsVi = table('Visit reports', [{ h: 'Place', w: 40, t: 'text' }, { h: 'Type', w: 20, t: 'text' }, { h: 'Area', w: 16, t: 'text' }, { h: 'Visit no', w: 8, t: 'int' },
    { h: 'Visited by', w: 26, t: 'text' }, { h: 'Emp ID', w: 9, t: 'int' }, { h: 'Branch', w: 18, t: 'text' }, { h: 'Visited at', w: 17, t: 'dt' }, { h: 'Submitted at', w: 17, t: 'dt' }, { h: 'Entered by admin', w: 10, t: 'text' },
    { h: 'Allotted', w: 9, t: 'text' }, { h: 'Joint visit with', w: 24, t: 'text' }, { h: 'Person met', w: 22, t: 'text' }, { h: 'Designation', w: 18, t: 'text' },
    { h: 'Mobile', w: 13, t: 'text' }, { h: 'Banks with', w: 14, t: 'text' }, { h: 'Other bank', w: 16, t: 'text' }, { h: 'Potential', w: 14, t: 'inr' },
    { h: 'Products', w: 30, t: 'text' }, { h: 'Outcome', w: 18, t: 'text' }, { h: 'Remarks', w: 40, t: 'text' }, { h: 'Next step', w: 30, t: 'text' },
    { h: 'Follow-up on', w: 13, t: 'date' }, { h: 'Closure', w: 16, t: 'text', tint: true }, { h: 'Accounts opened', w: 22, t: 'text' }, { h: 'Existing accounts', w: 22, t: 'text' }, { h: 'Mobilised', w: 14, t: 'inr' },
    { h: 'Photos', w: 8, t: 'int' }, { h: 'Location (lat, long)', w: 22, t: 'text' }, { h: 'Status', w: 12, t: 'text', tint: true }, { h: 'Verified at', w: 17, t: 'dt' }, { h: 'Verified by', w: 22, t: 'text' }], viRows);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsSum, 'Summary');
  XLSX.utils.book_append_sheet(wb, wsBr, 'Branches');
  XLSX.utils.book_append_sheet(wb, wsOf, 'Officers');
  XLSX.utils.book_append_sheet(wb, wsAl, 'Allotments');
  XLSX.utils.book_append_sheet(wb, wsVi, 'Visit reports');
  XLSX.writeFile(wb, `TASC-Connect-${todayISO()}.xlsx`);
  toast('Excel downloaded');
}
