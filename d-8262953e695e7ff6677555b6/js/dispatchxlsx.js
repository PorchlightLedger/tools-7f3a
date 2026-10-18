// Build the dispatch-log workbook (+ optional fleet status / roster) ON DEVICE
import { buildXlsx, ST } from './xlsxwrite.js';
import { tripEntries, buildContext, evaluateTrip, vehicleView, fleetCounts, pct, personName, personLabel, tripSummaryMessage, allQualNames, isActivePerson, gcssIdStats, licenseState, asOfDate, hasQual, TRIP_STATUSES } from './rules.js';
import { chalkSummary, chalkLabel, chalkOf } from './chalk.js';
import { resolveTm, TM_NOT_FOUND } from './tmdata.js';
import { fmtDate, normKeyText, parseDateLoose, localStamp } from './util.js';

const cell = (v, s, type) => (v === '' || v == null ? '' : { v, s, type });
export function buildDispatchWorkbook(state, { includeFleet = true, includeRoster = false, now = new Date(), tripIds = null } = {}) {
  const ctx = buildContext({ settings: state.settings, fleet: state.fleet, roster: state.roster, trips: state.trips, now });
  const P = (id) => ctx.rosterById.get(id); const V = (k) => ctx.fleetByKey.get(k);
  const trips = [...state.trips].filter((t) => !tripIds || tripIds.includes(t.id)).sort((a, b) => (a.dateOut || '9999').localeCompare(b.dateOut || '9999') || (a.timeOut || '').localeCompare(b.timeOut || '') || (+a.chalk || 999) - (+b.chalk || 999) || (a.no || 0) - (b.no || 0));
  const head = ['Trip #', 'Chalk', 'Status', 'Date out', 'Time out', 'Date back', 'Time back', 'Destination / mission', 'Vehicle', 'Platoon', 'LIN', 'VIN / Serial', 'Type', 'Driver', 'Driver GCSS-Army ID', 'Driver license no.', 'TC / A-driver', 'TC GCSS-Army ID', 'Pax', 'Towed / trailers', 'Dispatcher', 'PMCS done', 'GO / NO-GO', 'Why (first reason)', 'All reasons', 'Notes', 'Veh #', 'Trip GO / NO-GO', 'Commander override'];
  const rows = [head];
  // one row per vehicle entry; the trip header (number, chalk, status, times, destination, dispatcher, notes) repeats on every row
  for (const t of trips) {
    const ev = evaluateTrip(t, ctx); const entries = tripEntries(t); const list = entries.length ? entries : [{ id: '', vehicle: '', driver: '', tc: '', pax: [], towed: [], pmcs: false }]; const tripOnly = ev.warnings.filter((x) => !x.entry);
    const tr = ev.result === 'GO' ? 'go' : ev.result === 'WARN' ? 'warn' : ev.result === 'NO-GO' ? 'nogo' : undefined;
    list.forEach((e, i) => {
      const v = V(e.vehicle); const d = P(e.driver), c = P(e.tc); const vw = v ? vehicleView(v, ctx) : null; const er = ev.entries && ev.entries[i];
      const own = er ? [...er.blockers, ...er.warnings] : (i === 0 ? [...ev.blockers] : []); const all = [...own.map((x) => x.raw || x.msg), ...(i === 0 ? tripOnly.map((x) => x.msg) : [])];
      const res = er ? er.result : ev.result; const rs = res === 'GO' ? 'go' : res === 'WARN' ? 'warn' : res === 'NO-GO' ? 'nogo' : undefined;
      rows.push([t.no || '', t.chalk || '', t.status, cell(t.dateOut, 0, 'date'), t.timeOut || '', cell(t.dateBack, 0, 'date'), t.timeBack || '', t.dest || '', v ? (v.short || v.bumper) : e.vehicle || '', vw ? vw.platoon : '', vw ? vw.lin : '', vw ? vw.vin : '', vw ? vw.type : '',
        d ? personLabel(d) : e.driver || '', d ? d.gcssId || '' : '', d ? d.licNo || '' : '', c ? personLabel(c) : e.tc || '', c ? c.gcssId || '' : '',
        (e.pax || []).map((id) => (P(id) ? personLabel(P(id)) : id)).join('; '), (e.towed || []).map((k) => (V(k) ? V(k).short : k)).join('; '), t.dispatcher || '', e.pmcs ? 'Y' : 'N',
        cell(res, rs), all[0] || '', all.join(' | '), t.notes || '', entries.length ? `${i + 1} of ${entries.length}` : '', cell(ev.result, tr), [e.override && e.override.by ? `Commander override: ${e.override.by} - ${e.override.reason}${e.override.at ? ' (' + localStamp(e.override.at) + ')' : ''}` : '', ...(Array.isArray(e.overrideLog) ? e.overrideLog : []).map((r) => `Override removed: ${r.by} - ${r.reason}${r.at ? ' (given ' + localStamp(r.at) + ')' : ''}${r.removedAt ? ' (removed ' + localStamp(r.removedAt) + ')' : ''}`)].filter(Boolean).join(' | ')]);
    });
  }
  // Column max widths (content decides the real width, long text wraps). Status column carries a dropdown with ALL options; the cell value is the trip's real status.
  const sheets = [{ name: 'Dispatch Log', rows, autosize: true, cols: [7, 7, 11, 13, 8, 13, 8, 34, 11, 14, 9, 20, 22, 24, 16, 14, 24, 16, 34, 18, 18, 8, 10, 40, 60, 36, 8, 10, 36], headerRow: 0,
    validations: [{ sqref: `C2:C${Math.max(rows.length, 2) + 300}`, list: TRIP_STATUSES, error: 'Use Planned, Out, Back or Cancelled' }] }];
  const c = fleetCounts(ctx); const gi = gcssIdStats(state.roster, state.settings);
  const asOf = asOfDate(state.settings, now);
  const sum = [[{ v: 'Dispatch export', s: 'title' }], [{ v: 'Generated on device; no data left the phone except by the file you share. May contain PII / CUI - handle per your SOP.', s: 'note' }], [],
    ['Generated', now.toLocaleString()], ['As-of date used for checks', fmtDate(asOf)], ['GCSS export date', state.gcss.exportDate ? fmtDate(state.gcss.exportDate) : 'not set'],
    [], [{ v: 'Fleet (GCSS-Army is the source of truth)', s: 'title' }], ['On hand', c.onHand], ['FMC', c.fmc], ['NMCM', c.nmcm], ['NMCS', c.nmcs], ['NMC-X (permanent NMC)', c.nmcx], ['FMC rate', pct(c.fmcRate)], ['Dispatchable now', c.dispatchable], ['Turned in (excluded)', c.turnedIn],
    [], [{ v: 'Roster', s: 'title' }], ['Active', gi.active], ['Active missing GCSS-Army ID', gi.missing], [],
    ...(state.chalkPlan && state.chalkPlan.chalks.length ? [[{ v: 'Chalks', s: 'title' }], ...chalkSummary(state, ctx).chalks.map((ch) => [chalkLabel(state, ch.n), `${ch.counts.vehicles} vehicles · ${ch.counts.drivers} drivers · ${ch.counts.tcs} TC · ${ch.counts.pax} pax`]), []] : []),
    [{ v: 'Trips in this export', s: 'title' }], ['Trips', trips.length], ['GO', trips.filter((t) => evaluateTrip(t, ctx).result === 'GO').length], ['WARN', trips.filter((t) => evaluateTrip(t, ctx).result === 'WARN').length], ['NO-GO', trips.filter((t) => evaluateTrip(t, ctx).result === 'NO-GO').length]];
  sheets.push({ name: 'Summary', rows: sum, cols: [34, 40], headerRow: -1, autofilter: false });
  if (includeFleet) {
    const fr = [['Bumper', 'Platoon', 'Chalk', 'Type', 'Model', 'LIN', 'VIN / Serial', 'TM (operator)', 'Status', 'Status source', 'Days NMC', 'NMC since', 'Notes / faults', 'Location (local)', 'GCSS location', 'GCSS status', 'Flags']];
    const chOf = (k) => chalkOf(state, k) || '';
    for (const v of state.fleet) { const w = vehicleView(v, ctx); if (w.status === 'TURNED IN') continue;
      const fs = w.status === 'FMC' ? 'go' : w.status === 'UNKNOWN' || w.status === 'NO STATUS' ? 'warn' : 'nogo'; const tm = resolveTm(v, { tmByModel: state.tmByModel || {}, tmByType: state.tmByType || {}, typeName: w.type });
      fr.push([v.short, w.platoon, chOf(v.key), w.type, v.model, w.lin, w.vin, tm.resolved ? tm.label : TM_NOT_FOUND, cell(w.status, fs), w.source, w.days ?? '', cell(v.nmcSince, 0, 'date'), v.notes || '', v.location || '', v.funcLoc || '', v.gcss || '', w.flags.join('; ')]); }
    sheets.push({ name: 'Fleet Status', rows: fr, autosize: true, cols: [14, 14, 7, 24, 16, 9, 20, 24, 11, 12, 9, 13, 40, 24, 26, 10, 40], headerRow: 0 });
  }
  if (state.chalkPlan && state.chalkPlan.chalks.length) {
    const cs = chalkSummary(state, ctx); const cr = [['Chalk', 'Vehicle', 'Platoon', 'Type', 'LIN', 'VIN / Serial', 'Status', 'Trip #', 'Driver', 'TC / A-driver', 'Pax', 'Pax count', 'Warnings']];
    const line = (n, it, warn) => [n, it.v.short, it.vw.platoon, it.vw.type, it.vw.lin, it.vw.vin, cell(it.vw.status, it.vw.status === 'FMC' ? 'go' : 'nogo'), it.trip ? it.trip.no : '', it.driver ? personLabel(it.driver) : '', it.tc ? personLabel(it.tc) : '', it.pax.map(personLabel).join('; '), it.pax.length || '', warn];
    for (const c of cs.chalks) { const label = chalkLabel(state, c.n); if (!c.items.length) cr.push([label, '(no vehicles)', '', '', '', '', '', '', '', '', '', '', c.warnings.map((w) => w.msg).join(' | ')]);
      for (const it of c.items) cr.push(line(label, it, c.warnings.filter((w) => w.key === it.v.key).map((w) => w.msg).join(' | ')));
      cr.push([{ v: `${label} totals`, s: 'muted' }, `${c.counts.vehicles} vehicles`, '', '', '', '', '', '', `${c.counts.drivers} drivers`, `${c.counts.tcs} TC`, '', c.counts.pax, c.warnings.filter((w) => !w.key).map((w) => w.msg).join(' | ')]); }
    for (const it of cs.unassigned) cr.push(line('(unassigned)', it, ''));
    sheets.push({ name: 'Chalk Plan', rows: cr, autosize: true, cols: [20, 12, 14, 24, 9, 20, 11, 7, 24, 24, 40, 9, 50], headerRow: 0 });
  }
  if (includeRoster) {
    const quals = allQualNames(state.settings);
    const rr = [[{ v: 'ROSTER - PERSONAL DATA (PII). Handle per your SOP.', s: 'title' }], [], ['ID', 'Status', 'Platoon', 'Rank', 'Last name', 'First name', 'License Exp', 'License', 'AMMO', 'HAZMAT', 'NVD', 'GCSS-Army ID', 'Operator license no.', ...quals]];
    for (const p of state.roster) { const ls = licenseState(p, asOf, state.settings.licenseWindow);
      rr.push([p.id, p.status, p.platoon, p.rank, p.last, p.first, cell(p.licExp, 0, 'date'), ls, p.ammo ? 'X' : '', p.hazmat ? 'X' : '', p.nvd ? 'X' : '', cell(p.gcssId || (isActivePerson(p, state.settings) ? 'MISSING' : ''), p.gcssId ? undefined : isActivePerson(p, state.settings) ? 'warn' : undefined), p.licNo || '', ...quals.map((q) => (hasQual(p, q) ? 'X' : ''))]); }
    sheets.push({ name: 'Roster (PII)', rows: rr, cols: [8, 18, 12, 8, 16, 14, 13, 10, 7, 8, 6, 16, 18, ...quals.map(() => 12)], headerRow: 2 });
  }
  return buildXlsx(sheets, { title: 'Dispatch log', created: now });
}
export function dispatchEmailText(state, { now = new Date(), count = 0 } = {}) {
  const unit = state.settings.unitName ? ` - ${state.settings.unitName}` : '';
  return { subject: `Dispatch log${unit} ${fmtDate(asOfDate(state.settings, now))}`, body: `Attached: dispatch log (${count} trip${count === 1 ? '' : 's'}) generated ${now.toLocaleString()}.\n\nMay contain PII/CUI - handle per SOP.\n` };
}
