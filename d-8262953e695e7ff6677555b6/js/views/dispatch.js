import { store, S, getCtx, commit, go } from '../ctx.js';
import { pickDate, pickTime } from '../pickers.js';
import { assignVehicleToChalk, chalkLabel } from '../chalk.js';
import { h, openSheet, toast, field, segmented, toggle, pick, confirmBox, clear } from '../dom.js';
import { evaluateTrip, isActiveTrip, usableVehicles, usableTowed, usablePeople, vehicleView, personLabel, tripSummaryMessage, TRIP_STATUSES, personName, missingGcssId, idLine, platoonLabels } from '../rules.js';
import { uid, todayISO, nowHHMM, fmtDate } from '../util.js';
import { resultChip, tripTimes, nameWithId, btn, chips, emptyCard, STATUS_CLASS, licNoBadge } from '../ui.js';
import { openExportSheet } from './exporter.js';

let filter = 'active'; let platoonFilter = 'all';
export function renderDispatch(root, rest, top) {
  if (rest[0] === 'new') { setTimeout(() => { history.replaceState(null, '', '#dispatch'); openTripEditor(null); }, 0); }
  const st = S(); const ctx = getCtx();
  top.append(btn('＋ New trip', () => openTripEditor(null), 'primary small', { 'data-testid': 'new-trip' }));
  const today = todayISO();
  root.append(chips([['active', 'Active'], ['today', 'Today'], ['all', 'All'], ['Back', 'Back'], ['Cancelled', 'Cancelled']], filter, (v) => { filter = v; go('#dispatch'); }, { label: 'Filter trips' }));
  const pl = platoonLabels(st.settings);
  if (pl.length) root.append(chips([['all', 'All platoons'], ...pl.map((p) => [p, p])], platoonFilter, (v) => { platoonFilter = v; go('#dispatch'); }, { label: 'Filter trips by platoon' }));
  let trips = st.trips.map((t) => ({ t, ev: evaluateTrip(t, ctx) }));
  if (platoonFilter !== 'all') trips = trips.filter(({ t }) => { const v = ctx.fleetByKey.get(t.vehicle); return v && vehicleView(v, ctx).platoon === platoonFilter; });
  trips = trips.filter(({ t }) => filter === 'all' || (filter === 'active' && isActiveTrip(t)) || (filter === 'today' && (t.dateOut === today || t.dateBack === today)) || t.status === filter);
  trips.sort((a, b) => (a.t.dateOut || '9999').localeCompare(b.t.dateOut || '9999') || (a.t.timeOut || '').localeCompare(b.t.timeOut || '') || (+a.t.chalk || 999) - (+b.t.chalk || 999) || (a.t.no || 0) - (b.t.no || 0));
  const nogo = st.trips.filter(isActiveTrip).filter((t) => evaluateTrip(t, ctx).result === 'NO-GO').length;
  root.append(h('div', { class: 'row between' }, h('small', { class: 'muted' }, `${trips.length} shown · ${st.trips.length} total · ${nogo} NO-GO`), h('span', { class: 'row' }, btn('Chalks', () => go('#more/chalk'), 'small', { 'data-testid': 'open-chalks' }), btn('Share spreadsheet', () => openExportSheet(), 'small', { 'data-testid': 'open-export' }))));
  if (!trips.length) root.append(emptyCard('No trips here', st.fleet.length && st.roster.length ? 'Tap New trip to plan one.' : 'Import your fleet and roster first (Fleet and Roster tabs), then plan trips.', btn('New trip', () => openTripEditor(null), 'primary')));
  const list = h('div', { class: 'trips' }); root.append(list);
  for (const { t, ev } of trips) list.append(tripCard(t, ev, ctx));
  return 'Dispatch';
}
function tripCard(t, ev, ctx) {
  const v = ctx.fleetByKey.get(t.vehicle); const d = ctx.rosterById.get(t.driver); const c = ctx.rosterById.get(t.tc);
  const vw = v ? vehicleView(v, ctx) : null;
  const card = h('article', { class: 'card trip ' + (ev.result === 'NO-GO' ? 'bad' : ev.result === 'WARN' ? 'warn' : ''), 'data-testid': 'trip-card', 'data-trip': t.no, 'data-chalk': t.chalk || '', 'data-status': t.status });
  card.append(h('div', { class: 'tr-top' }, h('b', null, `#${t.no || ''} · ${v ? v.short : 'no vehicle'}`, vw ? h('small', null, ' ' + vw.type) : ''), t.chalk ? h('span', { class: 'chip', 'data-testid': 'trip-chalk' }, 'Chalk ' + t.chalk) : null, vw && vw.platoon ? h('span', { class: 'chip', 'data-testid': 'trip-platoon' }, vw.platoon) : null, h('span', { class: 'chip', 'data-testid': 'trip-status' }, t.status), resultChip(ev.result)));
  if (v) card.append(h('div', { class: 'tr-sub muted', 'data-testid': 'trip-ids' }, idLine(v) || 'no LIN / VIN on file'));
  card.append(h('div', { class: 'tr-sub' }, tripTimes(t), ' · ', t.dest || h('i', null, 'no destination')));
  card.append(h('div', { class: 'tr-sub' }, 'Driver: ', nameWithId(d, t.driver), licNoBadge(d)));
  if (t.tc) card.append(h('div', { class: 'tr-sub' }, 'TC: ', nameWithId(c, t.tc)));
  const extra = []; if (t.pax && t.pax.length) extra.push(`${t.pax.length} pax`); if (t.towed && t.towed.length) extra.push('towing ' + t.towed.map((k) => (ctx.fleetByKey.get(k) || {}).short || k).join(', ')); if (t.dispatcher) extra.push('disp: ' + t.dispatcher); extra.push(t.pmcs ? 'PMCS ✔' : 'PMCS ✗');
  card.append(h('div', { class: 'tr-sub muted' }, extra.join(' · ')));
  const msgs = [...ev.blockers, ...ev.warnings]; if (msgs.length) card.append(h('ul', { class: 'reasons' }, msgs.slice(0, 4).map((m, i) => h('li', { class: i < ev.blockers.length ? 'bad' : 'warn' }, m.msg)), msgs.length > 4 ? h('li', { class: 'muted' }, `+${msgs.length - 4} more`) : null));
  const acts = h('div', { class: 'row' });
  if (t.status === 'Planned') acts.append(btn('Out', () => setTripStatus(t.id, 'Out'), 'primary', { 'data-testid': 'trip-out' }));
  if (t.status === 'Out') acts.append(btn('Back', () => setTripStatus(t.id, 'Back'), 'primary', { 'data-testid': 'trip-back' }));
  if (isActiveTrip(t)) acts.append(btn('Cancel trip', () => setTripStatus(t.id, 'Cancelled'), '', { 'data-testid': 'trip-cancel' }));
  acts.append(btn('Edit', () => openTripEditor(t.id), '', { 'data-testid': 'trip-edit' }));
  card.append(acts); return card;
}
function reasonList(ev) { return h('ul', { class: 'reasons' }, ev.blockers.map((m) => h('li', { class: 'bad' }, m.msg)), ev.warnings.map((m) => h('li', { class: 'warn' }, m.msg))); }

export async function setTripStatus(id, status) {
  const st = S(); const t = st.trips.find((x) => x.id === id); if (!t) return;
  if (status === 'Out') {
    const probe = { ...t, status: 'Out' }; const ev = evaluateTrip(probe, getCtx());
    if (ev.result === 'NO-GO') { await confirmBox({ title: 'NO-GO - cannot go Out', html: h('div', null, h('p', null, 'Fix these first:'), reasonList(ev)), okText: 'OK', cancelText: 'Close' }); return; }
    if (ev.result === 'WARN') { const ok = await confirmBox({ title: 'Go Out with warnings?', html: h('div', null, reasonList(ev)), okText: 'Go Out anyway' }); if (!ok) return; }
    t.status = 'Out'; if (!t.dateOut) t.dateOut = todayISO(); if (!t.timeOut) t.timeOut = nowHHMM();
  } else if (status === 'Back') { t.status = 'Back'; if (!t.dateBack) t.dateBack = todayISO(); if (!t.timeBack) t.timeBack = nowHHMM(); }
  else if (status === 'Cancelled') { if (!(await confirmBox({ title: 'Cancel this trip?', message: 'It stays in the log as Cancelled.', okText: 'Cancel trip', cancelText: 'Keep', danger: true }))) return; t.status = 'Cancelled'; }
  commit(); toast(`Trip #${t.no} → ${t.status}`);
}

export function openTripEditor(id) {
  const st = S(); const existing = id ? st.trips.find((t) => t.id === id) : null;
  const draft = existing ? JSON.parse(JSON.stringify(existing)) : { id: uid('t'), no: 0, chalk: '', status: 'Planned', dateOut: todayISO(), timeOut: '', dateBack: '', timeBack: '', dest: '', vehicle: '', driver: '', tc: '', pax: [], towed: [], dispatcher: st.settings.dispatcherDefault || '', pmcs: false, notes: '', created: new Date().toISOString() };
  const vehLabel = (k) => { const v = getCtx().fleetByKey.get(k); if (!v) return k; const vw = vehicleView(v, getCtx()); return `${v.short} · ${vw.type}${vw.platoon ? ' · ' + vw.platoon : ''} · ${idLine(v) || 'no LIN / VIN'}`; };
  openSheet({ title: existing ? `Trip #${existing.no}` : 'New trip', tall: true,
    build: (b, api) => {
      const checks = h('section', { class: 'checks', 'data-testid': 'checks', 'aria-live': 'polite' });
      const refresh = () => {
        const ctx = getCtx(); const ev = evaluateTrip(draft, ctx); clear(checks);
        checks.className = 'checks ' + (ev.result === 'NO-GO' ? 'bad' : ev.result === 'WARN' ? 'warn' : ev.result === 'GO' ? 'go' : '');
        checks.append(h('div', { class: 'row between' }, h('b', null, 'Checks'), resultChip(ev.result || '—')));
        if (isActiveTrip(draft)) {
          if (!ev.blockers.length && !ev.warnings.length) checks.append(h('p', null, 'Everything checks out.'));
          checks.append(reasonList(ev));
          const d = ctx.rosterById.get(draft.driver); if (d) checks.append(h('p', { class: 'gcss-line', 'data-testid': 'driver-gcss' }, 'Driver GCSS-Army ID: ', missingGcssId(d) ? h('span', { class: 'chip orange' }, 'MISSING') : h('b', { class: 'mono' }, d.gcssId), d.licNo ? h('span', { 'data-testid': 'driver-licno' }, ' · Operator license no.: ', h('b', { class: 'mono' }, d.licNo)) : null));
        } else checks.append(h('p', { class: 'muted' }, 'Checks are skipped for Back / Cancelled trips.'));
        draw();
      };
      const sel = (label, getText, onClick, testid) => h('button', { type: 'button', class: 'select-btn', onClick, 'data-testid': testid, 'aria-label': label }, h('span', { class: 'lbl' }, label), h('span', { class: 'val' }, getText()));
      const rows = h('div', { class: 'form' });
      function draw() {
        const ctx = getCtx(); clear(rows);
        rows.append(field('Status', segmented(TRIP_STATUSES.map((s) => [s, s]), draft.status, (v) => { draft.status = v; if (v === 'Out') { if (!draft.dateOut) draft.dateOut = todayISO(); } refresh(); }, { label: 'Trip status' })));
        // Date / time: tap to open the in-app picker (explicit OK / Cancel). Nothing is written until OK.
        { const plan = S().chalkPlan.chalks;
          rows.append(field('Chalk', segmented([['', 'None'], ...plan.map((c) => [String(c.n), 'Chalk ' + c.n])], draft.chalk ? String(draft.chalk) : '', (v) => { draft.chalk = v ? +v : ''; refresh(); }, { label: 'Chalk' }), plan.length ? 'Plan chalks on More > Chalk planner' : 'No chalks yet: add them on More > Chalk planner'));
          const v0 = ctx.fleetByKey.get(draft.vehicle); if (v0) { const vw0 = vehicleView(v0, ctx); rows.append(h('p', { class: 'hint', 'data-testid': 'f-veh-ids' }, [idLine(v0), vw0.platoon].filter(Boolean).join(' · ') || 'No LIN / VIN on file (add on the Fleet tab)')); } }
        const dt = (label, key, kind, testid) => { const val = draft[key]; const txt = kind === 'date' ? (val ? fmtDate(val) : 'Tap to set') : (val ? val : 'Tap to set');
          return h('div', { class: 'field' }, h('span', { class: 'lbl' }, label), h('button', { type: 'button', class: 'select-btn dt-btn', 'data-testid': testid, 'data-value': val || '', 'aria-label': `${label}: ${val || 'not set'}`, onClick: async () => {
            const r = kind === 'date' ? await pickDate({ title: label, value: val || '' }) : await pickTime({ title: label, value: val || '' });
            if (r === undefined) return; draft[key] = r; if (key === 'dateOut' && !r && draft.status === 'Out') draft.dateOut = todayISO(); refresh();
          } }, h('span', { class: 'val' }, txt))); };
        rows.append(h('div', { class: 'grid2' }, dt('Date out', 'dateOut', 'date', 'f-dateOut'), dt('Time out', 'timeOut', 'time', 'f-timeOut'), dt('Date back', 'dateBack', 'date', 'f-dateBack'), dt('Time back', 'timeBack', 'time', 'f-timeBack')));
        rows.append(field('Destination / mission', h('input', { type: 'text', value: draft.dest, 'data-testid': 'f-dest', autocomplete: 'off', onInput: (e) => { draft.dest = e.target.value; } })));
        rows.append(sel('Vehicle', () => (draft.vehicle ? vehLabel(draft.vehicle) : 'Tap to choose (FMC only)'), async () => {
          const ctx2 = getCtx(); const mk = (u) => ({ id: u.v.key, label: u.v.short, sub: `${u.vw.type} · ${u.v.model}${u.vw.platoon ? ' · ' + u.vw.platoon : ''} · ${idLine(u.v) || 'no LIN / VIN'}`, badge: u.vw.status, badgeClass: STATUS_CLASS[u.vw.status] });
          const all = ctx2.fleet.map((v) => ({ v, vw: vehicleView(v, ctx2) })).filter((u) => u.vw.status !== 'TURNED IN' && u.vw.cls !== 'Towed').sort((a, b) => a.v.key.localeCompare(b.v.key, 'en', { numeric: true }));
          const r = await pick({ title: 'Choose vehicle', items: usableVehicles(ctx2, draft).map(mk), selected: draft.vehicle ? [draft.vehicle] : [], more: { label: 'Also show vehicles that cannot be dispatched (will be NO-GO)', items: all.map(mk) }, empty: 'No dispatchable vehicles. Import the GCSS export on the Fleet tab.', allowNone: 'None' });
          if (r !== undefined) { draft.vehicle = r || ''; const planned = r && S().chalkPlan.assign[r]; if (planned && !draft.chalk) draft.chalk = planned; refresh(); }
        }, 'f-vehicle'));
        rows.append(sel('Driver', () => { const p = ctx.rosterById.get(draft.driver); return p ? `${personLabel(p)}${p.gcssId ? ' · ' + p.gcssId : ' · no GCSS ID'}` : 'Tap to choose (qualified, licensed, Active)'; }, async () => {
          const ctx2 = getCtx(); const mk = (p) => ({ id: p.id, label: personLabel(p), sub: `${p.platoon || ''} · lic ${p.licExp ? fmtDate(p.licExp) : 'none'}`, badge: p.gcssId ? p.gcssId : 'no GCSS ID', badgeClass: p.gcssId ? '' : 'orange' });
          const r = await pick({ title: 'Choose driver', items: usablePeople(ctx2, draft, 'driver', draft.vehicle).map(mk), selected: draft.driver ? [draft.driver] : [], more: { label: 'Show everyone (even unqualified / expired)', items: ctx2.roster.slice().sort((a, b) => personName(a).localeCompare(personName(b))).map((p) => ({ ...mk(p), badge: p.status })) }, note: draft.vehicle ? 'Only Active, licensed drivers qualified on this vehicle type are listed.' : 'Choose the vehicle first to filter by qualification.', empty: 'Nobody is eligible. Check licenses and qualifications on the Roster.', allowNone: 'None' });
          if (r !== undefined) { draft.driver = r || ''; refresh(); }
        }, 'f-driver'));
        rows.append(sel('TC / A-driver (optional)', () => { const p = ctx.rosterById.get(draft.tc); return p ? personLabel(p) : 'Tap to choose'; }, async () => {
          const ctx2 = getCtx(); const mk = (p) => ({ id: p.id, label: personLabel(p), sub: p.platoon, badge: p.gcssId ? '' : 'no GCSS ID', badgeClass: 'orange' });
          const r = await pick({ title: 'Choose TC / A-driver', items: usablePeople(ctx2, draft, 'tc').map(mk), selected: draft.tc ? [draft.tc] : [], allowNone: 'None' }); if (r !== undefined) { draft.tc = r || ''; refresh(); }
        }, 'f-tc'));
        rows.append(sel('Passengers', () => (draft.pax.length ? draft.pax.map((id) => { const p = ctx.rosterById.get(id); return p ? personName(p) : id; }).join('; ') : 'None'), async () => {
          const ctx2 = getCtx(); const r = await pick({ title: 'Passengers', multi: true, selected: draft.pax, items: usablePeople(ctx2, draft, 'pax').map((p) => ({ id: p.id, label: personLabel(p), sub: p.platoon })) }); if (r !== undefined) { draft.pax = r; refresh(); }
        }, 'f-pax'));
        rows.append(sel('Trailers / towed', () => (draft.towed.length ? draft.towed.map(vehLabel).join('; ') : 'None'), async () => {
          const ctx2 = getCtx(); const r = await pick({ title: 'Trailers / towed items', multi: true, selected: draft.towed, items: usableTowed(ctx2, draft).map((u) => ({ id: u.v.key, label: u.v.short, sub: u.vw.type })), empty: 'No FMC trailers / towed items free.' }); if (r !== undefined) { draft.towed = r; refresh(); }
        }, 'f-towed'));
        rows.append(field('Dispatcher', h('input', { type: 'text', value: draft.dispatcher, autocomplete: 'off', 'data-testid': 'f-dispatcher', onInput: (e) => { draft.dispatcher = e.target.value; } })));
        rows.append(toggle('PMCS done', draft.pmcs, (v) => { draft.pmcs = v; refresh(); }, 'Needed before the trip goes Out'));
        rows.append(field('Notes', h('textarea', { rows: 2, value: draft.notes, onInput: (e) => { draft.notes = e.target.value; } })));
      }
      b.append(checks, rows); refresh();
      api.foot.append(
        existing ? h('button', { class: 'btn danger', type: 'button', 'data-testid': 'trip-delete', onClick: async () => { if (await confirmBox({ title: 'Delete this trip?', message: 'This removes it from the log. Use Cancelled to keep a record.', okText: 'Delete', danger: true })) { st.trips = st.trips.filter((t) => t.id !== draft.id); commit(); api.close(); toast('Trip deleted'); } } }, 'Delete') : null,
        h('button', { class: 'btn', type: 'button', onClick: () => api.close() }, 'Cancel'),
        h('button', { class: 'btn primary', type: 'button', 'data-testid': 'trip-save', onClick: () => {
          if (draft.status === 'Out') { const ev = evaluateTrip(draft, getCtx()); if (ev.result === 'NO-GO') { toast('NO-GO: cannot mark Out. Fix the reasons shown, or save as Planned.', 'bad'); return; } if (!draft.timeOut) draft.timeOut = nowHHMM(); }
          if (draft.status === 'Back') { if (!draft.dateBack) draft.dateBack = todayISO(); if (!draft.timeBack) draft.timeBack = nowHHMM(); }
          if (!existing) { st.chalkSeq = (st.chalkSeq || 0) + 1; draft.no = st.chalkSeq; st.trips.push(draft); } else Object.assign(existing, draft);
          if (draft.vehicle && draft.chalk) assignVehicleToChalk(st, draft.vehicle, +draft.chalk, { trips: false });
          else if (draft.vehicle && isActiveTrip(draft) && existing) assignVehicleToChalk(st, draft.vehicle, 0, { trips: false }); // chosen 'None': take it off the plan too
          commit(); api.close(); toast(`Trip #${draft.no} saved`);
        } }, 'Save trip'));
    } });
}
