// Build the dispatch-log workbook (+ optional fleet status / roster) ON DEVICE
import { buildXlsx, ST } from './xlsxwrite.js';
import { buildContext, evaluateTrip, vehicleView, fleetCounts, pct, personName, personLabel, tripSummaryMessage, allQualNames, isActivePerson, gcssIdStats, licenseState, asOfDate, hasQual } from './rules.js';
import { fmtDate, normKeyText, parseDateLoose } from './util.js';

const cell = (v, s, type) => (v === '' || v == null ? '' : { v, s, type });
export function buildDispatchWorkbook(state, { includeFleet = true, includeRoster = false, now = new Date(), tripIds = null } = {}) {
  const ctx = buildContext({ settings: state.settings, fleet: state.fleet, roster: state.roster, trips: state.trips, now });
  const P = (id) => ctx.rosterById.get(id); const V = (k) => ctx.fleetByKey.get(k);
  const trips = [...state.trips].filter((t) => !tripIds || tripIds.includes(t.id)).sort((a, b) => (a.dateOut || '9999').localeCompare(b.dateOut || '9999') || (a.timeOut || '').localeCompare(b.timeOut || '') || (a.chalk || 0) - (b.chalk || 0));
  const head = ['Chalk #', 'Status', 'Date out', 'Time out', 'Date back', 'Time back', 'Destination / mission', 'Vehicle', 'Type', 'Driver', 'Driver GCSS-Army ID', 'TC / A-driver', 'TC GCSS-Army ID', 'Pax', 'Towed / trailers', 'Dispatcher', 'PMCS done', 'GO / NO-GO', 'Why (first reason)', 'All reasons', 'Notes'];
  const rows = [head];
  for (const t of trips) {
    const ev = evaluateTrip(t, ctx); const v = V(t.vehicle); const d = P(t.driver), c = P(t.tc);
    const rs = ev.result === 'GO' ? 'go' : ev.result === 'WARN' ? 'warn' : ev.result === 'NO-GO' ? 'nogo' : undefined;
    rows.push([t.chalk || '', t.status, cell(t.dateOut, 0, 'date'), t.timeOut || '', cell(t.dateBack, 0, 'date'), t.timeBack || '', t.dest || '', v ? (v.short || v.bumper) : t.vehicle || '', v ? vehicleView(v, ctx).type : '',
      d ? personLabel(d) : t.driver || '', d ? d.gcssId || '' : '', c ? personLabel(c) : t.tc || '', c ? c.gcssId || '' : '',
      (t.pax || []).map((id) => (P(id) ? personLabel(P(id)) : id)).join('; '), (t.towed || []).map((k) => (V(k) ? V(k).short : k)).join('; '), t.dispatcher || '', t.pmcs ? 'Y' : 'N',
      cell(ev.result, rs), tripSummaryMessage(ev), [...ev.blockers, ...ev.warnings].map((x) => x.msg).join(' | '), t.notes || '']);
  }
  const sheets = [{ name: 'Dispatch Log', rows, cols: [8, 11, 13, 9, 13, 9, 34, 11, 22, 24, 16, 24, 16, 34, 18, 18, 9, 11, 40, 60, 30], headerRow: 0 }];
  const c = fleetCounts(ctx); const gi = gcssIdStats(state.roster, state.settings);
  const asOf = asOfDate(state.settings, now);
  const sum = [[{ v: 'Dispatch export', s: 'title' }], [{ v: 'Generated on device; no data left the phone except by the file you share. May contain PII / CUI - handle per your SOP.', s: 'note' }], [],
    ['Generated', now.toLocaleString()], ['As-of date used for checks', fmtDate(asOf)], ['GCSS export date', state.gcss.exportDate ? fmtDate(state.gcss.exportDate) : 'not set'],
    [], [{ v: 'Fleet (GCSS-Army is the source of truth)', s: 'title' }], ['On hand', c.onHand], ['FMC', c.fmc], ['NMCM', c.nmcm], ['NMCS', c.nmcs], ['NMC-X (permanent NMC)', c.nmcx], ['FMC rate', pct(c.fmcRate)], ['Dispatchable now', c.dispatchable], ['Turned in (excluded)', c.turnedIn],
    [], [{ v: 'Roster', s: 'title' }], ['Active', gi.active], ['Active missing GCSS-Army ID', gi.missing], [],
    [{ v: 'Trips in this export', s: 'title' }], ['Trips', trips.length], ['GO', trips.filter((t) => evaluateTrip(t, ctx).result === 'GO').length], ['WARN', trips.filter((t) => evaluateTrip(t, ctx).result === 'WARN').length], ['NO-GO', trips.filter((t) => evaluateTrip(t, ctx).result === 'NO-GO').length]];
  sheets.push({ name: 'Summary', rows: sum, cols: [34, 40], headerRow: -1, autofilter: false });
  if (includeFleet) {
    const fr = [['Bumper', 'Type', 'Model', 'Status', 'Status source', 'Days NMC', 'NMC since', 'Notes / faults', 'Location (local)', 'GCSS location', 'GCSS status', 'Flags']];
    for (const v of state.fleet) { const w = vehicleView(v, ctx); if (w.status === 'TURNED IN') continue;
      const fs = w.status === 'FMC' ? 'go' : w.status === 'UNKNOWN' || w.status === 'NO STATUS' ? 'warn' : 'nogo';
      fr.push([v.short, w.type, v.model, cell(w.status, fs), w.source, w.days ?? '', cell(v.nmcSince, 0, 'date'), v.notes || '', v.location || '', v.funcLoc || '', v.gcss || '', w.flags.join('; ')]); }
    sheets.push({ name: 'Fleet Status', rows: fr, cols: [14, 24, 16, 11, 12, 9, 13, 36, 24, 26, 10, 40], headerRow: 0 });
  }
  if (includeRoster) {
    const quals = allQualNames(state.settings);
    const rr = [[{ v: 'ROSTER - PERSONAL DATA (PII). Handle per your SOP.', s: 'title' }], [], ['ID', 'Status', 'Platoon', 'Rank', 'Last name', 'First name', 'License Exp', 'License', 'AMMO', 'HAZMAT', 'NVD', 'GCSS-Army ID', ...quals]];
    for (const p of state.roster) { const ls = licenseState(p, asOf, state.settings.licenseWindow);
      rr.push([p.id, p.status, p.platoon, p.rank, p.last, p.first, cell(p.licExp, 0, 'date'), ls, p.ammo ? 'X' : '', p.hazmat ? 'X' : '', p.nvd ? 'X' : '', cell(p.gcssId || (isActivePerson(p, state.settings) ? 'MISSING' : ''), p.gcssId ? undefined : isActivePerson(p, state.settings) ? 'warn' : undefined), ...quals.map((q) => (hasQual(p, q) ? 'X' : ''))]); }
    sheets.push({ name: 'Roster (PII)', rows: rr, cols: [8, 18, 12, 8, 16, 14, 13, 10, 7, 8, 6, 16, ...quals.map(() => 12)], headerRow: 2 });
  }
  return buildXlsx(sheets, { title: 'Dispatch log', created: now });
}
export function dispatchEmailText(state, { now = new Date(), count = 0 } = {}) {
  const unit = state.settings.unitName ? ` - ${state.settings.unitName}` : '';
  return { subject: `Dispatch log${unit} ${fmtDate(asOfDate(state.settings, now))}`, body: `Attached: dispatch log (${count} trip${count === 1 ? '' : 's'}) generated ${now.toLocaleString()}.\n\nMay contain PII/CUI - handle per SOP.\n` };
}
