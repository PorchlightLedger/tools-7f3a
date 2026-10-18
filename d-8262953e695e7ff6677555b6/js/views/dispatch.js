import { store, S, getCtx, commit, go } from '../ctx.js';
import { pickDate, pickTime } from '../pickers.js';
import { assignVehicleToChalk, chalkLabel, chalkOffers, addChalkOffers } from '../chalk.js';
import { vthumb, thumbFor } from '../photoui.js';
import { openFormEditorFor } from './form.js';
import { h, openSheet, toast, field, segmented, toggle, pick, confirmBox, clear } from '../dom.js';
import { evaluateTrip, isActiveTrip, usableVehicles, usableTowed, usablePeople, vehicleView, personLabel, tripSummaryMessage, TRIP_STATUSES, personName, missingGcssId, idLine, platoonLabels, tripEntries, newEntry } from '../rules.js';
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
  if (platoonFilter !== 'all') trips = trips.filter(({ t }) => tripEntries(t).some((e) => { const v = ctx.fleetByKey.get(e.vehicle); return v && vehicleView(v, ctx).platoon === platoonFilter; }));
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
  const entries = tripEntries(t); const multi = entries.length > 1; const st = S();
  const first = ctx.fleetByKey.get((entries[0] || {}).vehicle); const fvw = first ? vehicleView(first, ctx) : null;
  const card = h('article', { class: 'card trip ' + (ev.result === 'NO-GO' ? 'bad' : ev.result === 'WARN' ? 'warn' : ''), 'data-testid': 'trip-card', 'data-trip': t.no, 'data-chalk': t.chalk || '', 'data-status': t.status, 'data-vehicles': entries.length });
  const plats = [...new Set(entries.map((e) => { const v = ctx.fleetByKey.get(e.vehicle); return v ? vehicleView(v, ctx).platoon : ''; }).filter(Boolean))];
  card.append(h('div', { class: 'tr-top' }, h('b', null, `#${t.no || ''} · ${multi ? `${entries.length} vehicles` : first ? first.short : 'no vehicle'}`, !multi && fvw ? h('small', null, ' ' + fvw.type) : ''), t.chalk ? h('span', { class: 'chip', 'data-testid': 'trip-chalk' }, 'Chalk ' + t.chalk) : null, plats.map((p) => h('span', { class: 'chip', 'data-testid': 'trip-platoon' }, p)), h('span', { class: 'chip', 'data-testid': 'trip-status' }, t.status), resultChip(ev.result)));
  card.append(h('div', { class: 'tr-sub' }, tripTimes(t), ' · ', t.dest || h('i', null, 'no destination')));
  // one block per vehicle (matches the chalk): people, trailers, its own go / no-go
  const list = h('div', { class: 'veh-entries', 'data-testid': 'trip-entries' });
  entries.forEach((e, i) => {
    const v = ctx.fleetByKey.get(e.vehicle); const vw = v ? vehicleView(v, ctx) : null; const d = ctx.rosterById.get(e.driver); const c = ctx.rosterById.get(e.tc); const er = ev.entries && ev.entries[i];
    const th = v ? vthumb(v, { size: 'md' }) : null;
    const lines = [h('div', { class: 'tr-sub' }, 'Driver: ', nameWithId(d, e.driver), licNoBadge(d))];
    if (e.tc) lines.push(h('div', { class: 'tr-sub' }, 'TC: ', nameWithId(c, e.tc)));
    const extra = []; if (e.pax && e.pax.length) extra.push(`${e.pax.length} pax`); if (e.towed && e.towed.length) extra.push('towing ' + e.towed.map((k) => (ctx.fleetByKey.get(k) || {}).short || k).join(', ')); extra.push(e.pmcs ? 'PMCS ✔' : 'PMCS ✗');
    const msgs = er && isActiveTrip(t) ? [...er.blockers, ...er.warnings] : [];
    list.append(h('div', { class: 'veh-entry', 'data-testid': 'trip-entry', 'data-key': e.vehicle, 'data-idx': i }, th,
      h('div', { class: 've-main' }, h('b', null, v ? v.short : e.vehicle || 'no vehicle', vw ? h('small', null, ' ' + vw.type) : ''), vw && vw.platoon ? h('span', { class: 'chip', 'data-testid': 'entry-platoon' }, vw.platoon) : null,
        v ? h('div', { class: 'tr-sub muted', 'data-testid': 'entry-ids' }, idLine(v) || 'no LIN / VIN on file') : null, ...lines, h('div', { class: 'tr-sub muted' }, extra.join(' · ')),
        msgs.length ? h('ul', { class: 'reasons' }, msgs.slice(0, multi ? 3 : 4).map((m) => h('li', { class: er.blockers.includes(m) ? 'bad' : 'warn' }, m.raw || m.msg)), msgs.length > (multi ? 3 : 4) ? h('li', { class: 'muted' }, `+${msgs.length - (multi ? 3 : 4)} more`) : null) : null),
      h('div', { class: 'vr-side' }, er && isActiveTrip(t) ? h('span', { class: 'chip ' + (er.result === 'NO-GO' ? 'nogo' : er.result === 'WARN' ? 'warn' : 'go'), 'data-testid': 'entry-result', 'data-result': er.result }, er.result) : null,
        v ? btn('5988-E', () => openFormEditorFor(e.vehicle, { tripId: t.id, entryId: e.id }), 'small', { 'data-testid': 'entry-5988' }) : null)));
  });
  card.append(list);
  if (isActiveTrip(t) && ev.nogoEntries && ev.nogoEntries.length) card.append(h('p', { class: 'tr-msg bad', 'data-testid': 'trip-nogo-note' }, `${ev.nogoEntries.length === 1 ? 'A vehicle is' : ev.nogoEntries.length + ' vehicles are'} NO-GO: ${ev.nogoEntries.map((r) => (r.vehicle && r.vehicle.short) || 'no vehicle').join(', ')}. Fix or remove ${ev.nogoEntries.length === 1 ? 'it' : 'them'} before this trip can go Out.`));
  const offers = chalkOffers(st, ctx, t); if (offers.length) card.append(h('div', { class: 'offer', 'data-testid': 'chalk-offer' }, h('b', null, `Chalk ${t.chalk} now also has: `), offers.map((r) => r.v.short).join(', '), h('div', { class: 'row' }, btn(`Add ${offers.length === 1 ? 'it' : 'all ' + offers.length} to this trip`, () => { addChalkOffers(t, offers); commit(); toast(`Added ${offers.length} to trip #${t.no}`); }, 'small primary', { 'data-testid': 'chalk-offer-add' }))));
  const dispatcher = t.dispatcher ? h('div', { class: 'tr-sub muted' }, 'disp: ' + t.dispatcher) : null; if (dispatcher) card.append(dispatcher);
  const acts = h('div', { class: 'row' });
  if (t.status === 'Planned') acts.append(btn('Out', () => setTripStatus(t.id, 'Out'), 'primary', { 'data-testid': 'trip-out' }));
  if (t.status === 'Out') acts.append(btn('Back', () => setTripStatus(t.id, 'Back'), 'primary', { 'data-testid': 'trip-back' }));
  if (isActiveTrip(t)) acts.append(btn('Cancel trip', () => setTripStatus(t.id, 'Cancelled'), '', { 'data-testid': 'trip-cancel' }));
  acts.append(btn('Edit', () => openTripEditor(t.id), '', { 'data-testid': 'trip-edit' }), btn('Share trip', () => openExportSheet({ tripId: t.id }), '', { 'data-testid': 'trip-share' }));
  card.append(acts); return card;
}
function reasonList(ev) { return h('ul', { class: 'reasons' }, ev.blockers.map((m) => h('li', { class: 'bad' }, m.msg)), ev.warnings.map((m) => h('li', { class: 'warn' }, m.msg))); }

export async function setTripStatus(id, status) {
  const st = S(); const t = st.trips.find((x) => x.id === id); if (!t) return;
  if (status === 'Out') {
    const probe = { ...t, status: 'Out' }; const ev = evaluateTrip(probe, getCtx());
    if (ev.result === 'NO-GO') { await confirmBox({ title: 'NO-GO - cannot go Out', html: h('div', null, h('p', null, ev.nogoEntries && ev.entries.length > 1 ? 'A NO-GO vehicle must be fixed or removed from the trip before it can go Out:' : 'Fix these first:'), reasonList(ev)), okText: 'OK', cancelText: 'Close' }); return; }
    if (ev.result === 'WARN') { const ok = await confirmBox({ title: 'Go Out with warnings?', html: h('div', null, reasonList(ev)), okText: 'Go Out anyway' }); if (!ok) return; }
    t.status = 'Out'; if (!t.dateOut) t.dateOut = todayISO(); if (!t.timeOut) t.timeOut = nowHHMM();
  } else if (status === 'Back') { t.status = 'Back'; if (!t.dateBack) t.dateBack = todayISO(); if (!t.timeBack) t.timeBack = nowHHMM(); }
  else if (status === 'Cancelled') { if (!(await confirmBox({ title: 'Cancel this trip?', message: 'It stays in the log as Cancelled.', okText: 'Cancel trip', cancelText: 'Keep', danger: true }))) return; t.status = 'Cancelled'; }
  commit(); toast(`Trip #${t.no} → ${t.status}`);
}

export function openTripEditor(id, { draft: preset = null } = {}) {
  const st = S(); const existing = id ? st.trips.find((t) => t.id === id) : null;
  const draft = existing ? JSON.parse(JSON.stringify(existing)) : (preset || { id: uid('t'), no: 0, sv: 2, chalk: '', status: 'Planned', dateOut: todayISO(), timeOut: '', dateBack: '', timeBack: '', dest: '', dispatcher: st.settings.dispatcherDefault || '', notes: '', entries: [], created: new Date().toISOString() });
  if (!Array.isArray(draft.entries)) draft.entries = [];
  const vehLabel = (k) => { const v = getCtx().fleetByKey.get(k); if (!v) return k; const vw = vehicleView(v, getCtx()); return `${v.short} · ${vw.type}${vw.platoon ? ' · ' + vw.platoon : ''} · ${idLine(v) || 'no LIN / VIN'}`; };
  const ids = (e) => e.pax.concat(e.driver, e.tc).filter(Boolean);
  openSheet({ title: existing ? `Trip #${existing.no}` : 'New trip', tall: true,
    build: (b, api) => {
      const checks = h('section', { class: 'checks', 'data-testid': 'checks', 'aria-live': 'polite' });
      let ev = null;
      const refresh = () => {
        const ctx = getCtx(); ev = evaluateTrip(draft, ctx); clear(checks);
        checks.className = 'checks ' + (ev.result === 'NO-GO' ? 'bad' : ev.result === 'WARN' ? 'warn' : ev.result === 'GO' ? 'go' : '');
        checks.append(h('div', { class: 'row between' }, h('b', null, 'Checks' + (draft.entries.length > 1 ? ` (${draft.entries.length} vehicles)` : '')), resultChip(ev.result || '—')));
        if (isActiveTrip(draft)) {
          if (!ev.blockers.length && !ev.warnings.length) checks.append(h('p', null, 'Everything checks out.'));
          if (ev.nogoEntries && ev.nogoEntries.length && draft.entries.length > 1) checks.append(h('p', { class: 'tr-msg bad', 'data-testid': 'nogo-note' }, `NO-GO vehicle${ev.nogoEntries.length > 1 ? 's' : ''}: ${ev.nogoEntries.map((r) => (r.vehicle && r.vehicle.short) || 'no vehicle').join(', ')}. Remove or fix ${ev.nogoEntries.length > 1 ? 'them' : 'it'} before the trip can be marked Out (you can still save it as Planned).`));
          checks.append(reasonList(ev));
        } else checks.append(h('p', { class: 'muted' }, 'Checks are skipped for Back / Cancelled trips.'));
        draw();
      };
      const sel = (label, getText, onClick, testid) => h('button', { type: 'button', class: 'select-btn', onClick, 'data-testid': testid, 'aria-label': label }, h('span', { class: 'lbl' }, label), h('span', { class: 'val' }, getText()));
      const rows = h('div', { class: 'form' });
      const vehItem = (u) => ({ id: u.v.key, label: u.v.short, sub: `${u.vw.type} · ${u.v.model}${u.vw.platoon ? ' · ' + u.vw.platoon : ''} · ${idLine(u.v) || 'no LIN / VIN'}`, badge: u.vw.status, badgeClass: STATUS_CLASS[u.vw.status], thumb: thumbFor(u.v) });
      const chooseVehicle = async (replaceIdx) => {
        const ctx2 = getCtx(); const used = draft.entries.filter((_, i) => i !== replaceIdx).map((e) => e.vehicle);
        const all = ctx2.fleet.map((v) => ({ v, vw: vehicleView(v, ctx2) })).filter((u) => u.vw.status !== 'TURNED IN' && u.vw.cls !== 'Towed' && !used.includes(u.v.key)).sort((a, c) => a.v.key.localeCompare(c.v.key, 'en', { numeric: true }));
        const cur = replaceIdx != null ? draft.entries[replaceIdx].vehicle : '';
        const r = await pick({ title: replaceIdx != null ? 'Change vehicle' : 'Add vehicle', items: usableVehicles(ctx2, draft, { exclude: used }).map(vehItem), selected: cur ? [cur] : [], more: { label: 'Also show vehicles that cannot be dispatched (will be NO-GO)', items: all.map(vehItem) }, empty: 'No dispatchable vehicles. Import the GCSS export on the Fleet tab.', note: used.length ? `${used.length} vehicle${used.length === 1 ? ' is' : 's are'} already on this trip and not listed.` : '' });
        if (!r) return; const v = ctx2.fleetByKey.get(r);
        if (replaceIdx != null) { draft.entries[replaceIdx].vehicle = r; draft.entries[replaceIdx].vid = v ? v.vid || '' : ''; } else draft.entries.push(newEntry({ vehicle: r, vid: v ? v.vid || '' : '' }));
        const planned = S().chalkPlan.assign[r]; if (planned && !draft.chalk) draft.chalk = planned; refresh();
      };
      const entryBlock = (e, i) => {
        const ctx = getCtx(); const v = ctx.fleetByKey.get(e.vehicle); const vw = v ? vehicleView(v, ctx) : null; const er = ev && ev.entries[i]; const others = draft.entries.filter((_, j) => j !== i);
        const othersPeople = others.flatMap(ids); const othersTowed = others.flatMap((x) => x.towed);
        const th = v ? vthumb(v, { size: 'md' }) : null;
        const box = h('div', { class: 'entry ' + (er && isActiveTrip(draft) ? (er.result === 'NO-GO' ? 'bad' : er.result === 'WARN' ? 'warn' : 'go') : ''), 'data-testid': 'entry', 'data-idx': i, 'data-key': e.vehicle });
        box.append(h('div', { class: 'entry-head' }, th,
          h('button', { type: 'button', class: 'select-btn', 'data-testid': 'entry-vehicle', 'aria-label': 'Vehicle ' + (i + 1), onClick: () => chooseVehicle(i) }, h('span', { class: 'lbl' }, `Vehicle ${i + 1}`), h('span', { class: 'val' }, e.vehicle ? vehLabel(e.vehicle) : 'Tap to choose (FMC only)')),
          er && isActiveTrip(draft) ? h('span', { class: 'chip big ' + (er.result === 'NO-GO' ? 'nogo' : er.result === 'WARN' ? 'warn' : 'go'), 'data-testid': 'entry-result', 'data-result': er.result }, er.result) : null));
        if (er && isActiveTrip(draft) && er.blockers.length) box.append(h('ul', { class: 'reasons', 'data-testid': 'entry-reasons' }, er.blockers.map((m) => h('li', { class: 'bad' }, m.raw || m.msg)), er.warnings.map((m) => h('li', { class: 'warn' }, m.raw || m.msg))));
        box.append(sel('Driver', () => { const p = ctx.rosterById.get(e.driver); return p ? `${personLabel(p)}${p.gcssId ? ' · ' + p.gcssId : ' · no GCSS ID'}` : 'Tap to choose (qualified, licensed, Active)'; }, async () => {
          const ctx2 = getCtx(); const mk = (p) => ({ id: p.id, label: personLabel(p), sub: `${p.platoon || ''} · lic ${p.licExp ? fmtDate(p.licExp) : 'none'}`, badge: p.gcssId ? p.gcssId : 'no GCSS ID', badgeClass: p.gcssId ? '' : 'orange' });
          const r = await pick({ title: 'Choose driver', items: usablePeople(ctx2, draft, 'driver', e.vehicle, { exclude: othersPeople.concat(e.tc, e.pax) }).map(mk), selected: e.driver ? [e.driver] : [], more: { label: 'Show everyone (even unqualified / expired)', items: ctx2.roster.slice().sort((a, c) => personName(a).localeCompare(personName(c))).map((p) => ({ ...mk(p), badge: p.status })) }, note: e.vehicle ? 'Only Active, licensed drivers qualified on this vehicle type are listed. People already on another vehicle of this trip are hidden.' : 'Choose the vehicle first to filter by qualification.', empty: 'Nobody is eligible. Check licenses and qualifications on the Roster.', allowNone: 'None' });
          if (r !== undefined) { e.driver = r || ''; refresh(); }
        }, 'entry-driver'));
        box.append(sel('TC / A-driver (optional)', () => { const p = ctx.rosterById.get(e.tc); return p ? personLabel(p) : 'Tap to choose'; }, async () => {
          const ctx2 = getCtx(); const mk = (p) => ({ id: p.id, label: personLabel(p), sub: p.platoon, badge: p.gcssId ? '' : 'no GCSS ID', badgeClass: 'orange' });
          const r = await pick({ title: 'Choose TC / A-driver', items: usablePeople(ctx2, draft, 'tc', null, { exclude: othersPeople.concat(e.driver, e.pax) }).map(mk), selected: e.tc ? [e.tc] : [], allowNone: 'None' }); if (r !== undefined) { e.tc = r || ''; refresh(); }
        }, 'entry-tc'));
        box.append(sel('Passengers', () => (e.pax.length ? e.pax.map((id) => { const p = ctx.rosterById.get(id); return p ? personName(p) : id; }).join('; ') : 'None'), async () => {
          const ctx2 = getCtx(); const r = await pick({ title: 'Passengers', multi: true, selected: e.pax, items: usablePeople(ctx2, draft, 'pax', null, { exclude: othersPeople.concat(e.driver, e.tc) }).map((p) => ({ id: p.id, label: personLabel(p), sub: p.platoon })) }); if (r !== undefined) { e.pax = r; refresh(); }
        }, 'entry-pax'));
        box.append(sel(e.towed.length ? 'Trailers / assets' : '＋ Add trailer / asset', () => (e.towed.length ? e.towed.map(vehLabel).join('; ') : 'None (tap to add)'), async () => {
          const ctx2 = getCtx(); const r = await pick({ title: 'Trailers / assets', multi: true, selected: e.towed, items: usableTowed(ctx2, draft, { exclude: othersTowed }).map((u) => ({ id: u.v.key, label: u.v.short, sub: `${u.vw.type} · ${idLine(u.v) || 'no LIN / VIN'}`, thumb: thumbFor(u.v) })), empty: 'No FMC trailers / towed items free.' }); if (r !== undefined) { e.towed = r; refresh(); }
        }, 'entry-towed'));
        const d = ctx.rosterById.get(e.driver); if (d) box.append(h('p', { class: 'gcss-line', 'data-testid': 'driver-gcss' }, 'Driver GCSS-Army ID: ', missingGcssId(d) ? h('span', { class: 'chip orange' }, 'MISSING') : h('b', { class: 'mono' }, d.gcssId), d.licNo ? h('span', { 'data-testid': 'driver-licno' }, ' · Operator license no.: ', h('b', { class: 'mono' }, d.licNo)) : null));
        if (v) box.append(h('p', { class: 'hint', 'data-testid': 'entry-ids' }, [idLine(v), vw.platoon].filter(Boolean).join(' · ') || 'No LIN / VIN on file (add on the Fleet tab)'));
        box.append(toggle('PMCS done', e.pmcs, (val) => { e.pmcs = val; refresh(); }, i === 0 ? 'Needed before this vehicle goes Out' : ''));
        box.append(h('div', { class: 'entry-btns' },
          i > 0 ? btn('▲ Up', () => { draft.entries.splice(i - 1, 0, draft.entries.splice(i, 1)[0]); refresh(); }, 'small', { 'data-testid': 'entry-up' }) : null,
          i < draft.entries.length - 1 ? btn('▼ Down', () => { draft.entries.splice(i + 1, 0, draft.entries.splice(i, 1)[0]); refresh(); }, 'small', { 'data-testid': 'entry-down' }) : null,
          e.vehicle ? btn('5988-E', () => openFormEditorFor(e.vehicle, { tripId: existing ? draft.id : '', entryId: e.id }), 'small', { 'data-testid': 'entry-5988' }) : null,
          btn('Remove vehicle', () => { draft.entries.splice(i, 1); refresh(); }, 'small danger', { 'data-testid': 'entry-remove' })));
        return box;
      };
      function draw() {
        const ctx = getCtx(); clear(rows);
        rows.append(field('Status', segmented(TRIP_STATUSES.map((s) => [s, s]), draft.status, (v) => { draft.status = v; if (v === 'Out') { if (!draft.dateOut) draft.dateOut = todayISO(); } refresh(); }, { label: 'Trip status' })));
        { const plan = S().chalkPlan.chalks;
          rows.append(field('Chalk', segmented([['', 'None'], ...plan.map((c) => [String(c.n), 'Chalk ' + c.n])], draft.chalk ? String(draft.chalk) : '', (v) => { draft.chalk = v ? +v : ''; refresh(); }, { label: 'Chalk' }), plan.length ? 'Plan chalks on More > Chalk planner' : 'No chalks yet: add them on More > Chalk planner'));
          const off = chalkOffers(S(), ctx, draft);
          if (off.length) rows.append(h('div', { class: 'offer', 'data-testid': 'chalk-offer' }, h('b', null, `Chalk ${draft.chalk} has ${off.length} vehicle${off.length === 1 ? '' : 's'} not on this trip: `), off.map((r) => r.v.short).join(', '),
            h('div', { class: 'row' }, btn(`Add ${off.length === 1 ? 'it' : 'all ' + off.length}`, () => { addChalkOffers(draft, off); refresh(); }, 'small primary', { 'data-testid': 'chalk-offer-add' }))));
        }
        const dt = (label, key, kind, testid) => { const val = draft[key]; const txt = kind === 'date' ? (val ? fmtDate(val) : 'Tap to set') : (val ? val : 'Tap to set');
          return h('div', { class: 'field' }, h('span', { class: 'lbl' }, label), h('button', { type: 'button', class: 'select-btn dt-btn', 'data-testid': testid, 'data-value': val || '', 'aria-label': `${label}: ${val || 'not set'}`, onClick: async () => {
            const r = kind === 'date' ? await pickDate({ title: label, value: val || '' }) : await pickTime({ title: label, value: val || '' });
            if (r === undefined) return; draft[key] = r; if (key === 'dateOut' && !r && draft.status === 'Out') draft.dateOut = todayISO(); refresh();
          } }, h('span', { class: 'val' }, txt))); };
        rows.append(h('div', { class: 'grid2' }, dt('Date out', 'dateOut', 'date', 'f-dateOut'), dt('Time out', 'timeOut', 'time', 'f-timeOut'), dt('Date back', 'dateBack', 'date', 'f-dateBack'), dt('Time back', 'timeBack', 'time', 'f-timeBack')));
        rows.append(field('Destination / mission', h('input', { type: 'text', value: draft.dest, 'data-testid': 'f-dest', autocomplete: 'off', onInput: (e) => { draft.dest = e.target.value; } })));
        rows.append(h('h3', { class: 'sec-h' }, `Vehicles on this trip (${draft.entries.length})`));
        if (!draft.entries.length) rows.append(h('p', { class: 'muted' }, 'No vehicle yet. Add the first vehicle, give it a driver / TC / passengers and trailers, then add the next one.'));
        draft.entries.forEach((e, i) => rows.append(entryBlock(e, i)));
        rows.append(h('div', { class: 'row' }, btn(draft.entries.length ? '＋ Add another vehicle' : '＋ Add vehicle', () => chooseVehicle(null), 'primary small', { 'data-testid': 'add-vehicle' })));
        rows.append(field('Dispatcher', h('input', { type: 'text', value: draft.dispatcher, autocomplete: 'off', 'data-testid': 'f-dispatcher', onInput: (e) => { draft.dispatcher = e.target.value; } })));
        rows.append(field('Notes', h('textarea', { rows: 2, value: draft.notes, onInput: (e) => { draft.notes = e.target.value; } })));
      }
      b.append(checks, rows); refresh();
      api.foot.append(
        existing ? h('button', { class: 'btn danger', type: 'button', 'data-testid': 'trip-delete', onClick: async () => { if (await confirmBox({ title: 'Delete this trip?', message: 'This removes it from the log. Use Cancelled to keep a record.', okText: 'Delete', danger: true })) { st.trips = st.trips.filter((t) => t.id !== draft.id); commit(); api.close(); toast('Trip deleted'); } } }, 'Delete') : null,
        h('button', { class: 'btn', type: 'button', onClick: () => api.close() }, 'Cancel'),
        h('button', { class: 'btn primary', type: 'button', 'data-testid': 'trip-save', onClick: () => {
          if (draft.status === 'Out') { const e2 = evaluateTrip(draft, getCtx()); if (e2.result === 'NO-GO') { toast(draft.entries.length > 1 ? 'NO-GO: a NO-GO vehicle must be fixed or removed before the trip can go Out. Or save as Planned.' : 'NO-GO: cannot mark Out. Fix the reasons shown, or save as Planned.', 'bad'); return; } if (!draft.timeOut) draft.timeOut = nowHHMM(); }
          if (draft.status === 'Back') { if (!draft.dateBack) draft.dateBack = todayISO(); if (!draft.timeBack) draft.timeBack = nowHHMM(); }
          if (!existing) { st.chalkSeq = (st.chalkSeq || 0) + 1; draft.no = st.chalkSeq; st.trips.push(draft); } else Object.assign(existing, draft);
          const oldChalk = existing ? +existing.chalk || 0 : 0;
          for (const e of draft.entries) { if (!e.vehicle) continue; if (draft.chalk) assignVehicleToChalk(st, e.vehicle, +draft.chalk, { trips: false }); else if (isActiveTrip(draft) && existing && +st.chalkPlan.assign[e.vehicle] === oldChalk) assignVehicleToChalk(st, e.vehicle, 0, { trips: false }); }
          commit(); api.close(); toast(`Trip #${draft.no} saved`);
        } }, 'Save trip'));
    } });
}
