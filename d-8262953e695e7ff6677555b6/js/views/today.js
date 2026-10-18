import { store, S, getCtx, go } from '../ctx.js';
import { h } from '../dom.js';
import { tripEntries, fleetCounts, pct, evaluateTrip, gcssIdStats, isActiveTrip, vehicleView, personAvailable, licenseState, asOfDate, tripSummaryMessage, personLabel, tripOverrides, overrideMarker } from '../rules.js';
import { daysBetween, fmtDate, todayISO, localDayOf } from '../util.js';
import { statusChip, resultChip, tripTimes, nameWithId, piiNote, emptyCard, btn } from '../ui.js';
import { openTripEditor } from './dispatch.js';
import { chalkSummary, chalkLabel } from '../chalk.js';

export function renderToday(root) {
  const st = S(); const ctx = getCtx(); const c = fleetCounts(ctx); const gi = gcssIdStats(st.roster, st.settings);
  root.append(piiNote());
  if (!st.fleet.length || !st.roster.length) {
    root.append(emptyCard('Start here', 'Nothing is loaded yet. Import your fleet (GCSS-Army export) and your roster. Nothing is built in and nothing leaves this phone.',
      btn('Import fleet', () => go('#fleet/import'), 'primary', { 'data-testid': 'start-fleet' }), btn('Import roster', () => go('#roster/import'), 'primary', { 'data-testid': 'start-roster' })));
  }
  const tile = (label, val, cls = '', sub = '', onClick) => h(onClick ? 'button' : 'div', { class: 'tile ' + cls, type: onClick ? 'button' : null, onClick, 'data-testid': 'tile-' + label.toLowerCase().replace(/[^a-z]+/g, '-') }, h('b', null, String(val)), h('span', null, label), sub ? h('small', null, sub) : null);
  root.append(h('section', { 'aria-label': 'Fleet counts' },
    h('div', { class: 'tiles' }, tile('On hand', c.onHand, '', c.turnedIn ? `excl. ${c.turnedIn} turned in` : '', () => go('#fleet')), tile('FMC', c.fmc, 'go', '', () => go('#fleet/FMC')), tile('FMC rate', pct(c.fmcRate), 'go'), tile('Dispatchable now', c.dispatchable, 'go', c.towable ? `+${c.towable} trailers/towed` : '', () => go('#fleet/usable')),
      tile('NMCM', c.nmcm, 'nogo', '', () => go('#fleet/NMCM')), tile('NMCS', c.nmcs, 'nogo', '', () => go('#fleet/NMCS')), tile('NMC-X', c.nmcx, 'nmcx', 'permanent', () => go('#fleet/NMC-X')), tile('Out / planned', ctx.trips.filter(isActiveTrip).length, '', '', () => go('#dispatch')))));
  // attention
  const att = []; const asOf = ctx.asOf;
  const trips = ctx.trips.filter(isActiveTrip).map((t) => ({ t, ev: evaluateTrip(t, ctx) }));
  const nogo = trips.filter((x) => x.ev.result === 'NO-GO').length, nogoOv = trips.filter((x) => x.ev.result === 'NO-GO' && x.ev.overriddenEntries.length).length, warn = trips.filter((x) => x.ev.result === 'WARN').length;
  if (nogo) att.push(['bad', `${nogo} trip${nogo > 1 ? 's' : ''} NO-GO${nogoOv ? ` (${nogoOv} with commander override)` : ''}`, '#dispatch']);
  if (warn) att.push(['warn', `${warn} trip${warn > 1 ? 's' : ''} with warnings`, '#dispatch']);
  if (st.roster.length) att.push([gi.missing ? 'orange' : 'ok', `Missing GCSS ID: ${gi.missing} of ${gi.active} Active`, '#roster/missing']);
  const act = st.roster.filter((p) => personAvailable(p, st.settings)); const lic = { EXPIRED: 0, MISSING: 0, EXPIRING: 0, INVALID: 0 };
  act.forEach((p) => { const s = licenseState(p, asOf, st.settings.licenseWindow); if (s in lic) lic[s]++; });
  if (act.length) { const bad = lic.EXPIRED + lic.MISSING + lic.INVALID; att.push([bad ? 'warn' : 'ok', `Licenses (Active): ${lic.EXPIRED} expired, ${lic.MISSING} no date, ${lic.EXPIRING} expiring ≤${st.settings.licenseWindow}d`, '#roster/license']); }
  if (st.fleet.length) {
    const age = st.gcss.exportDate ? daysBetween(st.gcss.exportDate, asOf) : null;
    att.push([age == null ? 'warn' : age > st.settings.gcssStaleDays ? 'warn' : 'ok', age == null ? 'GCSS export date not set' : `GCSS data is ${age} day${age === 1 ? '' : 's'} old (export ${fmtDate(st.gcss.exportDate)})`, '#fleet/import']);
    const red = st.fleet.filter((v) => vehicleView(v, ctx).aging === 'red').length; if (red) att.push(['bad', `${red} vehicle${red > 1 ? 's' : ''} NMC ≥ ${st.settings.agingRed} days`, '#fleet/NMC']);
    const unk = c.unknown; if (unk) att.push(['warn', `${unk} vehicle${unk > 1 ? 's' : ''} with no / unknown status`, '#fleet/UNKNOWN']);
    const um = st.fleet.filter((v) => !vehicleView(v, ctx).mapped && vehicleView(v, ctx).status !== 'TURNED IN').length; if (um) att.push(['warn', `${um} vehicle${um > 1 ? 's' : ''} with a model missing from the Type map (cannot be dispatched)`, '#more/settings']);
    const walked = st.fleet.filter((v) => localDayOf(v.walkAt) === todayISO()).length; att.push(['info', `Walk-around today: ${walked} of ${c.onHand} seen`, '#more/walk']);
  }
  if (att.length) root.append(h('section', { class: 'card' }, h('h3', null, 'Needs attention'), h('ul', { class: 'att' }, att.map(([k, text, href]) => h('li', null, h('a', { href, class: 'att-' + k, 'data-testid': 'att-item' }, h('span', { class: 'dot ' + k, 'aria-hidden': 'true' }), text))))));
  // trips
  const sec = h('section', { class: 'card' }, h('h3', null, `Active trips (${trips.length})`));
  if (!trips.length) sec.append(h('p', { class: 'muted' }, 'No planned or outbound trips.'), btn('New trip', () => go('#dispatch/new'), 'primary'));
  trips.sort((a, b) => (a.t.dateOut || '9').localeCompare(b.t.dateOut || '9') || (a.t.timeOut || '').localeCompare(b.t.timeOut || '')).slice(0, 12).forEach(({ t, ev }) => {
    const es = tripEntries(t); const v = ctx.fleetByKey.get((es[0] || {}).vehicle); const d = ctx.rosterById.get((es[0] || {}).driver); const label = es.length > 1 ? `${v ? v.short : 'no vehicle'} +${es.length - 1} more` : v ? v.short : 'no vehicle';
    sec.append(h('button', { class: 'trip-row', type: 'button', onClick: () => openTripEditor(t.id), 'data-testid': 'today-trip' }, h('div', { class: 'tr-top' }, h('b', null, `#${t.no || ''} ${label}`), h('span', { class: 'chip' }, t.status), resultChip(ev.result), overrideMarker(tripOverrides(t)) ? h('span', { class: 'chip override', 'data-testid': 'trip-override' }, overrideMarker(tripOverrides(t))) : null), h('div', { class: 'tr-sub' }, tripTimes(t), ' · ', t.dest || 'no destination'), h('div', { class: 'tr-sub' }, es.length > 1 ? `${es.length} vehicles · ${es.filter((e) => e.driver).length} drivers` : ['Driver: ', nameWithId(d, (es[0] || {}).driver)]), (ev.blockers.length || ev.warnings.length) ? h('div', { class: 'tr-msg ' + (ev.blockers.length ? 'bad' : 'warn') }, tripSummaryMessage(ev)) : null));
  });
  root.append(sec);
  if (st.chalkPlan.chalks.length) {
    const sum = chalkSummary(st, ctx); const cs = h('section', { class: 'card', 'data-testid': 'today-chalks' }, h('h3', null, `Chalks (${sum.chalks.length})`));
    for (const c of sum.chalks) cs.append(h('button', { class: 'trip-row', type: 'button', onClick: () => go('#more/chalk'), 'data-testid': 'today-chalk', 'data-chalk': c.n }, h('div', { class: 'tr-top' }, h('b', null, chalkLabel(st, c.n)), c.warnings.some((w) => w.level !== 'info') ? h('span', { class: 'chip warn' }, `${c.warnings.filter((w) => w.level !== 'info').length} warning(s)`) : null), h('div', { class: 'tr-sub' }, `${c.counts.vehicles} veh · ${c.counts.drivers} drivers · ${c.counts.tcs} TC · ${c.counts.pax} pax`)));
    if (sum.unassigned.length) cs.append(h('p', { class: 'muted' }, `${sum.unassigned.length} vehicles not on a chalk`));
    root.append(cs);
  }
  return 'Today';
}
