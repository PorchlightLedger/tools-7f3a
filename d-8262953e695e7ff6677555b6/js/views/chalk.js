import { S, getCtx, commit, go } from '../ctx.js';
import { h, openSheet, toast, field, segmented, confirmBox } from '../dom.js';
import { personName, personLabel, idLine, platoonLabels } from '../rules.js';
import { addChalk, removeChalk, assignVehicleToChalk, chalkSummary, chalkLabel } from '../chalk.js';
import { btn, chips, statusChip, emptyCard } from '../ui.js';

let platoonFilter = 'all';
export function renderChalk(root, rest, top) {
  const st = S(); const ctx = getCtx();
  top.append(btn('‹ More', () => go('#more'), 'small'), btn('＋ Chalk', () => { const n = addChalk(st); commit(); toast(`Chalk ${n} added`); }, 'primary small', { 'data-testid': 'chalk-add' }));
  const pl = platoonLabels(st.settings);
  if (pl.length) root.append(chips([['all', 'All platoons'], ...pl.map((p) => [p, p])], platoonFilter, (v) => { platoonFilter = v; go('#more/chalk'); }, { label: 'Filter by platoon' }));
  if (!st.fleet.length) { root.append(emptyCard('No vehicles', 'Import the GCSS fleet export on the Fleet tab first.', btn('Import fleet', () => go('#fleet/import'), 'primary'))); return 'Chalk planner'; }
  const sum = chalkSummary(st, ctx, { platoon: platoonFilter });
  root.append(h('div', { class: 'note', role: 'note', 'data-testid': 'chalk-totals' }, `${sum.chalks.length} chalk${sum.chalks.length === 1 ? '' : 's'} · ${sum.totals.assigned} vehicle${sum.totals.assigned === 1 ? '' : 's'} assigned · ${sum.totals.unassigned} unassigned · ${sum.totals.warnings} warning${sum.totals.warnings === 1 ? '' : 's'}. Tap a vehicle to choose its chalk.`));
  if (!sum.chalks.length) root.append(emptyCard('No chalks yet', 'Add a chalk, then tap vehicles below to put them on it.', btn('Add chalk 1', () => { addChalk(st); commit(); }, 'primary', { 'data-testid': 'chalk-add-empty' })));
  for (const c of sum.chalks) {
    const card = h('section', { class: 'card chalk', 'data-testid': 'chalk-card', 'data-chalk': c.n });
    card.append(h('div', { class: 'row between' }, h('h3', null, chalkLabel(st, c.n)), h('span', { class: 'row' },
      btn('Name', () => renameChalk(c.n), 'small', { 'data-testid': 'chalk-rename' }), btn('Remove', async () => { if (await confirmBox({ title: `Remove chalk ${c.n}?`, message: `Its ${c.items.length} vehicle(s) become unassigned and active trips lose the chalk number. Trips are kept.`, okText: 'Remove', danger: true })) { removeChalk(st, c.n); commit(); } }, 'small', { 'data-testid': 'chalk-remove' }))));
    card.append(h('p', { class: 'chalk-counts', 'data-testid': 'chalk-counts' }, [`${c.counts.vehicles} vehicle${c.counts.vehicles === 1 ? '' : 's'}`, `${c.counts.drivers} driver${c.counts.drivers === 1 ? '' : 's'}`, `${c.counts.tcs} TC`, `${c.counts.pax} pax`, `${c.counts.people} people`].join(' · ')));
    for (const it of c.items) card.append(vehRow(it, 'chalk-veh'));
    if (!c.items.length) card.append(h('p', { class: 'muted' }, 'Nothing here yet.'));
    const real = c.warnings.filter((w) => w.level !== 'info'), info = c.warnings.filter((w) => w.level === 'info');
    if (real.length || info.length) card.append(h('ul', { class: 'reasons', 'data-testid': 'chalk-warnings' }, real.map((w) => h('li', { class: w.level === 'bad' ? 'bad' : 'warn' }, w.msg)), info.map((w) => h('li', { class: 'muted' }, w.msg))));
    root.append(card);
  }
  const un = h('section', { class: 'card', 'data-testid': 'chalk-unassigned' }, h('h3', null, `Unassigned vehicles (${sum.unassigned.length})`));
  for (const it of sum.unassigned) un.append(vehRow(it, 'unassigned-veh'));
  if (!sum.unassigned.length) un.append(h('p', { class: 'muted' }, 'Every vehicle is on a chalk.'));
  root.append(un);
  return 'Chalk planner';
}
function vehRow(it, testid) {
  const { v, vw, trip } = it; const who = [];
  if (it.driver) who.push('Driver: ' + personLabel(it.driver)); else if (trip) who.push('Driver: none');
  if (it.tc) who.push('TC: ' + personLabel(it.tc)); if (it.pax.length) who.push('Pax: ' + it.pax.map(personName).join('; '));
  return h('button', { type: 'button', class: 'vrow chalk-veh', 'data-testid': testid, 'data-key': v.key, 'data-short': v.short, onClick: () => openAssign(v, vw) },
    h('div', { class: 'vr-main' }, h('b', null, v.short), h('small', null, `${vw.type} · ${v.model}${vw.platoon ? ' · ' + vw.platoon : ''}`), h('small', { class: 'muted' }, idLine(v) || 'no LIN / VIN on file'), who.length ? h('small', { 'data-testid': 'chalk-people' }, who.join(' · ')) : null, trip ? h('small', { class: 'muted' }, `Trip #${trip.no} · ${trip.status}`) : null),
    h('div', { class: 'vr-side' }, statusChip(vw.status), it.chalk ? h('span', { class: 'chip' }, 'Chalk ' + it.chalk) : h('span', { class: 'chip' }, '—')));
}
function openAssign(v, vw) {
  const st = S();
  openSheet({ title: `Chalk for ${v.short}`, build: (b, api) => {
    const cur = st.chalkPlan.assign[v.key] || (st.trips.find((t) => t.vehicle === v.key && t.chalk && (t.status === 'Planned' || t.status === 'Out')) || {}).chalk || '';
    b.append(h('p', { class: 'hint' }, `${vw.type} · ${vw.status}${vw.platoon ? ' · ' + vw.platoon : ''}`));
    const opts = [['', 'Unassigned'], ...st.chalkPlan.chalks.slice().sort((a, c) => a.n - c.n).map((c) => [String(c.n), 'Chalk ' + c.n])];
    b.append(field('Chalk', segmented(opts, cur ? String(cur) : '', (val) => { assignVehicleToChalk(st, v.key, val ? +val : 0); commit(); api.close(); toast(val ? `${v.short} → chalk ${val}` : `${v.short} unassigned`); }, { label: 'Chalk' })));
    b.append(btn('＋ New chalk and put it there', () => { const n = addChalk(st); assignVehicleToChalk(st, v.key, n); commit(); api.close(); }, 'small', { 'data-testid': 'chalk-new-here' }));
  } });
}
function renameChalk(n) {
  const st = S(); const c = st.chalkPlan.chalks.find((x) => x.n === n); if (!c) return;
  openSheet({ title: `Name chalk ${n}`, build: (b, api) => {
    const inp = h('input', { type: 'text', value: c.label, placeholder: 'e.g. first lift 0600', autocomplete: 'off', 'data-testid': 'chalk-label', autofocus: true });
    b.append(field('Short name (optional)', inp));
    api.foot.append(h('button', { class: 'btn', type: 'button', onClick: () => api.close() }, 'Cancel'), h('button', { class: 'btn primary', type: 'button', 'data-testid': 'chalk-label-ok', onClick: () => { c.label = inp.value.trim(); commit(); api.close(); } }, 'Save'));
  } });
}
