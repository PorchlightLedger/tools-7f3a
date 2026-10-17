import { S, store, getCtx, commit, go } from '../ctx.js';
import { h, openSheet, toast, field, segmented, toggle, confirmBox, clear, readFileText, readFileBytes, safeAppend } from '../dom.js';
import { fleetCounts, pct, vehicleView, vehicleUsable, towedUsable, isNMC, tripsOverlap, vehicleConflicts, VEHICLE_STATUSES } from '../rules.js';
import { parseGcssRows, parseGcssText, mergeGcss, findGcssHeader } from '../gcss.js';
import { parseDelimited } from '../csv.js';
import { readTable } from '../readtable.js';
import { todayISO, fmtDate, parseDateLoose, daysBetween } from '../util.js';
import { statusChip, chips, btn, emptyCard } from '../ui.js';
import { openFormEditorFor } from './form.js';

let filter = 'all', query = '';
export function renderFleet(root, rest, top) {
  if (rest[0] === 'import') { setTimeout(() => { history.replaceState(null, '', '#fleet'); openImport(); }, 0); }
  else if (rest[0]) { filter = rest[0] === 'NMC' ? 'NMC' : rest[0]; history.replaceState(null, '', '#fleet'); }
  const st = S(); const ctx = getCtx(); const c = fleetCounts(ctx);
  top.append(btn('Import GCSS', () => openImport(), 'primary small', { 'data-testid': 'fleet-import' }));
  root.append(h('section', { class: 'card counts', 'data-testid': 'fleet-counts', 'aria-label': 'Fleet counts' },
    h('div', { class: 'cgrid' }, ...[['On hand', c.onHand], ['FMC', c.fmc, 'go'], ['NMCM', c.nmcm, 'nogo'], ['NMCS', c.nmcs, 'nogo'], ['NMC-X', c.nmcx, 'nmcx'], ['FMC rate', pct(c.fmcRate), 'go'], ['Dispatchable now', c.dispatchable, 'go']].map(([l, v, k]) => h('div', { class: 'cell ' + (k || '') }, h('b', null, String(v)), h('span', null, l)))),
    h('small', { class: 'muted' }, `${c.turnedIn} turned in (excluded) · ${c.nmc} NMC total · GCSS export ${st.gcss.exportDate ? fmtDate(st.gcss.exportDate) : 'date not set'}${st.gcss.rows ? ` · ${st.gcss.rows} rows read` : ''}`)));
  if (!st.fleet.length) { root.append(emptyCard('No fleet loaded', 'Export the equipment list from GCSS-Army (CSV or Excel) and import it here, or paste the text.', btn('Import GCSS export', () => openImport(), 'primary', { 'data-testid': 'fleet-import-empty' }))); return 'Fleet'; }
  const list = h('div', { class: 'vlist', 'data-testid': 'vehicle-list' });
  const draw = () => {
    clear(list); const needle = query.trim().toLowerCase();
    const items = st.fleet.map((v) => ({ v, vw: vehicleView(v, ctx) })).filter(({ v, vw }) => {
      if (vw.status === 'TURNED IN') return filter === 'TURNED IN';
      if (filter === 'NMC') { if (!isNMC(vw.status)) return false; } else if (filter === 'usable') { if (!(vehicleUsable(vw) && !vehicleConflicts(v.key, { id: 'p', status: 'Planned', dateOut: ctx.asOf }, ctx.trips).length)) return false; }
      else if (filter === 'OUT') { if (!vehicleConflicts(v.key, { id: 'p', status: 'Planned', dateOut: ctx.asOf }, ctx.trips).length) return false; }
      else if (filter === 'TRL') { if (vw.cls !== 'Towed') return false; } else if (filter === 'FLAG') { if (!vw.flags.length && vw.cls !== 'Unmapped') return false; }
      else if (filter === 'UNKNOWN') { if (vw.status !== 'UNKNOWN' && vw.status !== 'NO STATUS') return false; } else if (filter !== 'all' && vw.status !== filter) return false;
      return !needle || `${v.short} ${v.bumper} ${vw.type} ${v.model} ${v.desc} ${v.notes} ${v.location} ${v.funcLoc} ${v.serial}`.toLowerCase().includes(needle);
    }).sort((a, b) => a.v.key.localeCompare(b.v.key, 'en', { numeric: true }));
    list.append(h('p', { class: 'muted', 'data-testid': 'vehicle-shown' }, `${items.length} shown`));
    for (const { v, vw } of items) {
      const busy = vehicleConflicts(v.key, { id: 'p', status: 'Planned', dateOut: ctx.asOf }, ctx.trips).length > 0;
      list.append(h('button', { type: 'button', class: 'vrow', 'data-testid': 'vehicle-row', 'data-key': v.key, onClick: () => openVehicle(v.key) },
        h('div', { class: 'vr-main' }, h('b', null, v.short), h('small', null, `${vw.type}${v.model ? ' · ' + v.model : ''}`), v.location || v.funcLoc ? h('small', { class: 'muted' }, v.location || v.funcLoc) : null,
          vw.flags.length ? h('small', { class: 'flag' }, vw.flags[0]) : null, !vw.mapped ? h('small', { class: 'flag' }, 'model not in Type map') : null),
        h('div', { class: 'vr-side' }, statusChip(vw.status), vw.source === 'override' ? h('span', { class: 'chip warn' }, 'local') : null, busy ? h('span', { class: 'chip' }, 'on trip') : null, vw.days != null ? h('span', { class: 'chip ' + (vw.aging === 'red' ? 'nogo' : vw.aging === 'amber' ? 'warn' : '') }, `${vw.days}d`) : null)));
    }
  };
  const search = h('input', { type: 'search', class: 'search', placeholder: 'Search bumper, type, location, notes…', 'aria-label': 'Search fleet', value: query, 'data-testid': 'fleet-search', onInput: (e) => { query = e.target.value; draw(); } });
  const f = chips([['all', 'All'], ['FMC', 'FMC'], ['usable', 'Usable'], ['NMCM', 'NMCM'], ['NMCS', 'NMCS'], ['NMC-X', 'NMC-X'], ['OUT', 'On trip'], ['TRL', 'Trailers'], ['FLAG', 'Flagged'], ['TURNED IN', 'Turned in']], filter, (v) => { filter = v; go('#fleet'); }, { label: 'Filter fleet' });
  root.append(search, f, list); draw();
  return 'Fleet';
}

export function openVehicle(key) {
  const st = S(); const v = st.fleet.find((x) => x.key === key); if (!v) return;
  openSheet({ title: v.short, tall: true, build: (b, api) => {
    const body = safeAppend(h('div')); b.append(body);
    const redraw = () => {
      const ctx = getCtx(); const vw = vehicleView(v, ctx); clear(body); api.setTitle(`${v.short} · ${vw.status}`);
      body.append(h('div', { class: 'row' }, statusChip(vw.status), vw.source === 'override' ? h('span', { class: 'chip warn' }, 'local status (GCSS: ' + (v.gcss || '—') + ')') : null, h('span', { class: 'chip' }, vw.type)));
      for (const fl of vw.flags) body.append(h('p', { class: 'flagline' }, '⚠ ' + fl));
      if (!vw.mapped) body.append(h('p', { class: 'flagline' }, '⚠ Model not in the Type map: this vehicle cannot be dispatched until you add it (More > Settings).'));
      const kv = h('dl', { class: 'kv' }); const add = (k, val) => val ? kv.append(h('dt', null, k), h('dd', null, val)) : null;
      add('Description', v.desc); add('Model', v.model); add('GCSS status', v.gcss || '—'); add('GCSS structure desc.', v.gcssDesc); add('Equipment (asset) #', v.asset); add('Serial', v.serial); add('Registration', v.registration); add('GCSS location', v.funcLoc); add('GCSS remark', v.remark); add('Last import', v.lastImport ? fmtDate(v.lastImport) : '');
      body.append(kv);
      if (vw.status === 'NMC-X') body.append(h('p', { class: 'note' }, 'X vehicle: permanent NMC awaiting turn-in. Cannot be dispatched and cannot be changed by a local status.'));
      body.append(field('Local status (walk-around)', segmented([['', 'Use GCSS'], ...VEHICLE_STATUSES.map((s) => [s, s])], v.override ? v.override.status : '', (val) => {
        if (vw.status === 'NMC-X' || vw.status === 'TURNED IN') { toast('Status is fixed for X / turned-in vehicles.', 'bad'); redraw(); return; }
        v.override = val ? { status: val, at: new Date().toISOString() } : null;
        if (val && val !== 'FMC' && !v.nmcSince) v.nmcSince = todayISO(); if (val === 'FMC') v.nmcSince = '';
        commit(); redraw();
      }, { label: 'Local status' }), 'GCSS-Army stays the source of truth: a local status is flagged and cleared when GCSS catches up.'));
      body.append(field('Fault / notes', h('textarea', { rows: 3, value: v.notes || '', 'data-testid': 'v-notes', onInput: (e) => { v.notes = e.target.value; commit({ render: false }); } })));
      body.append(field('Location (kept across GCSS imports)', h('input', { type: 'text', value: v.location || '', placeholder: v.funcLoc || 'e.g. Bay 3', 'data-testid': 'v-location', onInput: (e) => { v.location = e.target.value; commit({ render: false }); } })));
      body.append(field('NMC since', h('input', { type: 'date', value: v.nmcSince || '', 'data-testid': 'v-nmcsince', onChange: (e) => { v.nmcSince = e.target.value; commit({ render: false }); } }), vw.days != null ? `${vw.days} days NMC` : ''));
      body.append(h('div', { class: 'row' }, btn('DA 5988-E worksheet', () => { api.close(); openFormEditorFor(v.key); }, '', { 'data-testid': 'v-5988' }), btn('Remove from fleet', async () => { if (await confirmBox({ title: 'Remove vehicle?', message: `${v.short} will be removed from the app (not from GCSS). It returns if it is still in the next GCSS import.`, okText: 'Remove', danger: true })) { st.fleet = st.fleet.filter((x) => x.key !== v.key); commit(); api.close(); } }, 'danger')));
    };
    redraw();
  }, onClose: () => commit() });
}

export function openImport() {
  const st = S(); let parsed = null, fileName = '', exportDate = todayISO();
  openSheet({ title: 'Import GCSS-Army fleet export', tall: true, build: (b, api) => {
    const out = h('div', { 'data-testid': 'import-out' });
    const ta = h('textarea', { rows: 5, placeholder: 'Or paste the exported list here (include the header row)…', 'aria-label': 'Paste GCSS export text', 'data-testid': 'import-paste' });
    // No accept attribute on purpose: iOS greys out files whose type it does not map (e.g. old .xls). The file is identified by its content instead.
    const file = h('input', { type: 'file', 'data-testid': 'import-file', 'aria-label': 'Choose GCSS export file (.xls, .xlsx, .csv, .txt)' });
    const showPreview = () => {
      clear(out); if (!parsed) return;
      const { fleet, report } = mergeGcss(st.fleet, parsed, st.settings, { exportDate });
      const ctx = { ...getCtx(), fleet }; const c = fleetCounts({ ...ctx, fleetByKey: new Map(fleet.map((v) => [v.key, v])) });
      const lines = [`${parsed.vehicles.length} vehicles read${parsed.issues.duplicates.length ? `, ${parsed.issues.duplicates.length} duplicate row(s) ignored` : ''}`, `${report.added.length} new · ${st.fleet.length ? report.statusChanges.length + ' status change(s)' : ''}${report.missing.length ? ` · ${report.missing.length} not in this export` : ''}`,
        `On hand ${c.onHand} · FMC ${c.fmc} · NMCM ${c.nmcm} · NMCS ${c.nmcs} · NMC-X ${c.nmcx} · FMC rate ${pct(c.fmcRate)} · turned in ${c.turnedIn}`];
      out.append(h('div', { class: 'card go', 'data-testid': 'import-preview' }, lines.filter(Boolean).map((l) => h('p', null, l))));
      const warn = [];
      if (report.unmapped.length) warn.push(`Models not in the Type map (cannot be dispatched until added): ${report.unmappedModels.join(', ')}`);
      if (report.xButFmc.length) warn.push(`X vehicle(s) GCSS shows FMC (kept NMC-X): ${report.xButFmc.join(', ')}`);
      if (report.turnedInStill.length) warn.push(`Turned-in vehicle(s) still in GCSS (excluded): ${report.turnedInStill.join(', ')}`);
      if (report.overridesDiffer.length) warn.push(`Local statuses that differ from GCSS: ${report.overridesDiffer.join('; ')}`);
      if (parsed.issues.unrecognizedStatus.length) warn.push(`Unrecognized status text: ${parsed.issues.unrecognizedStatus.slice(0, 8).join('; ')}`);
      if (parsed.issues.blankStatus.length) warn.push(`Blank status: ${parsed.issues.blankStatus.slice(0, 8).join(', ')}`);
      if (report.missing.length) warn.push(`In the app but not in this export (status → NO STATUS): ${report.missing.slice(0, 10).join(', ')}`);
      if (parsed.issues.missingColumns.length) warn.push(`Columns not found: ${parsed.issues.missingColumns.join(', ')}`);
      if (report.statusChanges.length && st.fleet.length) warn.push('Changed: ' + report.statusChanges.slice(0, 12).join('; ') + (report.statusChanges.length > 12 ? '…' : ''));
      if (warn.length) out.append(h('div', { class: 'card warn' }, warn.map((w) => h('p', null, w))));
      out.append(h('button', { class: 'btn primary wide', type: 'button', 'data-testid': 'import-apply', onClick: () => {
        const r = mergeGcss(st.fleet, parsed, st.settings, { exportDate }); st.fleet = r.fleet; st.gcss = { exportDate: parseDateLoose(exportDate) || todayISO(), importedAt: new Date().toISOString(), fileName, rows: parsed.vehicles.length };
        commit(); api.close(); toast(`Imported ${parsed.vehicles.length} vehicles`);
      } }, st.fleet.length ? 'Apply (update statuses, keep notes & locations)' : 'Apply import'));
    };
    const fail = (e) => { parsed = null; clear(out); out.append(h('div', { class: 'card bad', role: 'alert', 'data-testid': 'import-error' }, e.message || String(e))); };
    const readText = (text, name) => { try { fileName = name || 'pasted text'; parsed = parseGcssText(text, st.settings); showPreview(); } catch (e) { fail(e); } };
    file.addEventListener('change', async () => {
      const f = file.files[0]; if (!f) return;
      try {
        const t = await readTable(await readFileBytes(f));
        if (t.kind === 'text') { readText(t.text, f.name); return; }
        const sh = t.sheets.find((x) => findGcssHeader(x.rows)); if (!sh) throw new Error('No sheet in that file has an "Admin No." / "Operational Status" header row. Check it is the GCSS-Army equipment list, or save it as CSV and try again.');
        fileName = f.name; parsed = parseGcssRows(sh.rows, st.settings); showPreview();
      } catch (e) { fail(e); }
    });
    const dt = h('input', { type: 'date', value: exportDate, 'data-testid': 'import-date', onChange: (e) => { exportDate = e.target.value; if (parsed) showPreview(); } });
    b.append(h('p', { class: 'hint' }, 'Columns used: Admin No., Material Description, Model number, Operational Status (FMC / NMCM / NMCS), Equipment, Serial Number, Functional Location, Remark. Re-importing a newer export updates GCSS fields and keeps your notes, locations and NMC-since dates.'),
      field('Export file (.xls, .xlsx, .csv, .txt)', file), field('GCSS export date', dt, 'Used for data age and NMC-since on newly NMC vehicles'), ta,
      h('button', { class: 'btn wide', type: 'button', 'data-testid': 'import-read', onClick: () => { if (!ta.value.trim()) { fail(new Error('Paste the text first, or choose a file.')); return; } readText(ta.value, 'pasted text'); } }, 'Read pasted text'), out);
  } });
}
