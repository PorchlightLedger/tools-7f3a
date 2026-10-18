import { S, store, getCtx, commit, go } from '../ctx.js';
import { h, openSheet, toast, field, segmented, toggle, confirmBox, clear, readFileText, readFileBytes, safeAppend, pick } from '../dom.js';
import { fleetCounts, pct, vehicleView, vehicleUsable, towedUsable, isNMC, tripsOverlap, vehicleConflicts, VEHICLE_STATUSES, idLine, vehIds, platoonLabels, normBumper, shortBumper, modelLookup, modelInfo } from '../rules.js';
import { findByVin, suggestLin, vinKey } from '../vin.js';
import { vthumb, photoSection } from '../photoui.js';
import { reconcilePhotos } from '../photos.js';
import { pickDate } from '../pickers.js';
import { tmBlock, tmFor } from './tmedit.js';
import { parseGcssRows, parseGcssText, mergeGcss, findGcssHeader } from '../gcss.js';
import { parseDelimited } from '../csv.js';
import { readTable } from '../readtable.js';
import { todayISO, fmtDate, parseDateLoose, daysBetween, uid, clean } from '../util.js';
import { statusChip, chips, btn, emptyCard } from '../ui.js';
import { openFormEditorFor } from './form.js';

let filter = 'all', query = '', platoonFilter = 'all';
export function renderFleet(root, rest, top) {
  if (rest[0] === 'import') { setTimeout(() => { history.replaceState(null, '', '#fleet'); openImport(); }, 0); }
  else if (rest[0]) { filter = rest[0] === 'NMC' ? 'NMC' : rest[0]; history.replaceState(null, '', '#fleet'); }
  const st = S(); const ctx = getCtx(); const c = fleetCounts(ctx);
  top.append(btn('＋ Vehicle', () => openAddVehicle(), 'small', { 'data-testid': 'fleet-add' }), btn('Import GCSS', () => openImport(), 'primary small', { 'data-testid': 'fleet-import' }));
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
      if (platoonFilter !== 'all' && vw.platoon !== platoonFilter) return false;
      return !needle || `${v.short} ${v.bumper} ${vw.type} ${v.model} ${v.desc} ${v.notes} ${v.location} ${v.funcLoc} ${vw.vin} ${vw.lin} ${vw.platoon}`.toLowerCase().includes(needle);
    }).sort((a, b) => a.v.key.localeCompare(b.v.key, 'en', { numeric: true }));
    list.append(h('p', { class: 'muted', 'data-testid': 'vehicle-shown' }, `${items.length} shown`));
    for (const { v, vw } of items) {
      const busy = vehicleConflicts(v.key, { id: 'p', status: 'Planned', dateOut: ctx.asOf }, ctx.trips).length > 0;
      const th = vthumb(v);
      list.append(h('button', { type: 'button', class: 'vrow' + (th ? ' has-thumb' : ''), 'data-testid': 'vehicle-row', 'data-key': v.key, onClick: () => openVehicle(v.key) }, th,
        h('div', { class: 'vr-main' }, h('b', null, v.short), h('small', null, `${vw.type}${v.model ? ' · ' + v.model : ''}`), h('small', { class: 'muted', 'data-testid': 'vehicle-ids' }, idLine(v) || 'no LIN / VIN on file'), v.location || v.funcLoc ? h('small', { class: 'muted' }, v.location || v.funcLoc) : null,
          vw.flags.length ? h('small', { class: 'flag' }, vw.flags[0]) : null, !vw.mapped ? h('small', { class: 'flag' }, 'model not in Type map') : null),
        h('div', { class: 'vr-side' }, statusChip(vw.status), vw.platoon ? h('span', { class: 'chip', 'data-testid': 'vehicle-platoon' }, vw.platoon) : null, vw.source === 'override' ? h('span', { class: 'chip warn' }, 'local') : null, busy ? h('span', { class: 'chip' }, 'on trip') : null, vw.days != null ? h('span', { class: 'chip ' + (vw.aging === 'red' ? 'nogo' : vw.aging === 'amber' ? 'warn' : '') }, `${vw.days}d`) : null)));
    }
  };
  const search = h('input', { type: 'search', class: 'search', placeholder: 'Search bumper, type, location, notes…', 'aria-label': 'Search fleet', value: query, 'data-testid': 'fleet-search', onInput: (e) => { query = e.target.value; draw(); } });
  const f = chips([['all', 'All'], ['FMC', 'FMC'], ['usable', 'Usable'], ['NMCM', 'NMCM'], ['NMCS', 'NMCS'], ['NMC-X', 'NMC-X'], ['OUT', 'On trip'], ['TRL', 'Trailers'], ['FLAG', 'Flagged'], ['TURNED IN', 'Turned in']], filter, (v) => { filter = v; go('#fleet'); }, { label: 'Filter fleet' });
  const pl = platoonLabels(st.settings);
  const pf = pl.length ? chips([['all', 'All platoons'], ...pl.map((p) => [p, p]), ['', 'No platoon']], platoonFilter, (v) => { platoonFilter = v; go('#fleet'); }, { label: 'Filter fleet by platoon' }) : null;
  root.append(search, f, pf, list); draw();
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
      body.append(photoSection(v, redraw));
      const kv = h('dl', { class: 'kv' }); const add = (k, val) => val ? kv.append(h('dt', null, k), h('dd', null, val)) : null;
      add('Description', v.desc); add('Model', v.model); add('GCSS status', v.gcss || '—'); add('GCSS structure desc.', v.gcssDesc); add('Equipment (asset) #', v.asset); add('Registration', v.registration); add('GCSS location', v.funcLoc); add('GCSS remark', v.remark); add('Last import', v.lastImport ? fmtDate(v.lastImport) : '');
      body.append(kv);
      // VIN / serial and LIN: shown from GCSS, editable by hand (a manual value survives re-import; clear it to go back to GCSS)
      const idField = (label, setKey, gcssKey, testid, after) => field(label, h('input', { type: 'text', value: v[setKey] || '', placeholder: v[gcssKey] ? v[gcssKey] + '  (from GCSS)' : 'not in GCSS - type it', autocapitalize: 'characters', autocomplete: 'off', 'data-testid': testid, onInput: (e) => { const t = e.target.value.trim(); if (t) v[setKey] = t; else delete v[setKey]; commit({ render: false }); after && after(); } }), v[setKey] ? `GCSS value: ${v[gcssKey] || '—'}` : '');
      const vinStatus = h('p', { class: 'hint', 'data-testid': 'v-vin-status', role: 'status' }, ''); const linHint = h('div', { class: 'hint', 'data-testid': 'v-lin-hint' });
      const updHints = () => {
        const ids = vehIds(v); clear(vinStatus); clear(linHint);
        if (ids.vin) { const other = findByVin(st.fleet, ids.vin, { exceptKey: v.key });
          if (other) { vinStatus.append(`This VIN is also on ${other.short} (${other.model || 'no model'}). `, btn(`Copy empty LIN / model / UIC from ${other.short}`, () => { const o = vehIds(other); if (!ids.lin && o.lin) v.linSet = o.lin; if (!v.model && other.model) v.model = other.model; if (!v.uic && other.uic) v.uic = other.uic; if (!v.desc && other.desc) v.desc = other.desc; commit({ render: false }); redraw(); }, 'small', { 'data-testid': 'v-vin-copy' })); vinStatus.className = 'hint warn'; }
          else { vinStatus.textContent = 'No other fleet vehicle has this VIN.'; vinStatus.className = 'hint'; } }
        if (!ids.lin && v.model) { const sg = suggestLin(st.fleet, v.model, st.settings, { exceptKey: v.key });
          linHint.append(sg ? h('span', null, 'No LIN on file. A LIN cannot be derived from a VIN, but other fleet vehicles of ', sg.basis, ' use ', h('b', { class: 'mono' }, sg.lin), ` (${sg.count}). `, btn('Use ' + sg.lin, () => { v.linSet = sg.lin; commit({ render: false }); redraw(); }, 'small', { 'data-testid': 'v-lin-suggest' })) : 'No LIN on file and no other vehicle of this model has one. Type it from the data plate / GCSS.'); }
      };
      body.append(h('div', { class: 'grid2' }, idField('VIN / Serial', 'vinSet', 'serial', 'v-vin', updHints), idField('LIN', 'linSet', 'lin', 'v-lin', updHints)), vinStatus, linHint); updHints();
      body.append(h('p', { class: 'hint', 'data-testid': 'v-ids-line' }, idLine(v) || 'No LIN or VIN on file'));
      body.append(h('div', { class: 'row', 'data-testid': 'v-platoon' }, h('span', null, 'Platoon: '), h('b', { 'data-testid': 'v-platoon-val' }, vw.platoon || '—'), h('small', { class: 'muted' }, v.platoonSet ? ' (set by hand)' : vw.platoon ? ' (from Settings rules)' : ' (no rule matches)'), btn('Set', async () => {
        const labels = platoonLabels(st.settings); const items = labels.map((l) => ({ id: l, label: l })); const r = await pick({ title: 'Platoon for ' + v.short, items, allowNone: 'Use the Settings rules', empty: 'No platoon rules yet (More > Settings).' });
        if (r === undefined) return; if (r) v.platoonSet = r; else delete v.platoonSet; commit({ render: false }); redraw();
      }, 'small', { 'data-testid': 'v-platoon-set' })));
      body.append(tmBlock(v, redraw));
      if (vw.status === 'NMC-X') body.append(h('p', { class: 'note' }, 'X vehicle: permanent NMC awaiting turn-in. Cannot be dispatched and cannot be changed by a local status.'));
      body.append(field('Local status (walk-around)', segmented([['', 'Use GCSS'], ...VEHICLE_STATUSES.map((s) => [s, s])], v.override ? v.override.status : '', (val) => {
        if (vw.status === 'NMC-X' || vw.status === 'TURNED IN') { toast('Status is fixed for X / turned-in vehicles.', 'bad'); redraw(); return; }
        v.override = val ? { status: val, at: new Date().toISOString() } : null;
        if (val && val !== 'FMC' && !v.nmcSince) v.nmcSince = todayISO(); if (val === 'FMC') v.nmcSince = '';
        commit(); redraw();
      }, { label: 'Local status' }), 'GCSS-Army stays the source of truth: a local status is flagged and cleared when GCSS catches up.'));
      body.append(field('Fault / notes', h('textarea', { rows: 3, value: v.notes || '', 'data-testid': 'v-notes', onInput: (e) => { v.notes = e.target.value; commit({ render: false }); } })));
      body.append(field('Location (kept across GCSS imports)', h('input', { type: 'text', value: v.location || '', placeholder: v.funcLoc || 'e.g. Bay 3', 'data-testid': 'v-location', onInput: (e) => { v.location = e.target.value; commit({ render: false }); } })));
      body.append(h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'NMC since'), h('button', { type: 'button', class: 'select-btn dt-btn', 'data-testid': 'v-nmcsince', 'data-value': v.nmcSince || '', onClick: async () => { const r = await pickDate({ title: 'NMC since', value: v.nmcSince || '' }); if (r === undefined) return; v.nmcSince = r; commit({ render: false }); redraw(); } }, h('span', { class: 'val' }, v.nmcSince ? fmtDate(v.nmcSince) : 'Tap to set')), vw.days != null ? h('small', { class: 'hint' }, `${vw.days} days NMC`) : null));
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
      const cu = report.commonUic;
      if (cu && cu.uic !== st.settings.unitUic) out.append(h('div', { class: 'card', 'data-testid': 'import-uic' }, h('p', null, `The export has a UIC column. Most common value: ${cu.uic} (${cu.count} of ${cu.total} rows${cu.distinct > 1 ? `, ${cu.distinct} different UICs` : ''}).`),
        h('button', { class: 'btn small', type: 'button', 'data-testid': 'import-use-uic', onClick: () => { st.settings.unitUic = cu.uic; commit({ render: false }); toast(`Unit UIC set to ${cu.uic}`); showPreview(); } }, `Use ${cu.uic} as Unit UIC (5988-E)`)));
      else if (cu) out.append(h('p', { class: 'hint', 'data-testid': 'import-uic' }, `UIC column matches the Unit UIC (${cu.uic}).`));
      out.append(h('button', { class: 'btn primary wide', type: 'button', 'data-testid': 'import-apply', onClick: () => {
        const r = mergeGcss(st.fleet, parsed, st.settings, { exportDate }); st.fleet = r.fleet; st.gcss = { exportDate: parseDateLoose(exportDate) || todayISO(), importedAt: new Date().toISOString(), fileName, rows: parsed.vehicles.length };
        reconcilePhotos(st.fleet).then(() => commit()); commit(); api.close(); toast(`Imported ${parsed.vehicles.length} vehicles`);
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

/** add a vehicle / trailer by hand (not in the GCSS export). A VIN that is already in the fleet fills the form from that record and does not make a duplicate. */
export function openAddVehicle() {
  const st = S();
  openSheet({ title: 'Add vehicle / trailer', tall: true, build: (b, api) => {
    const reg = {}; const val = (k) => (reg[k] ? reg[k].value.trim() : '');
    const inp = (k, label, o = {}) => { const i = reg[k] = h('input', { type: 'text', value: o.value || '', autocomplete: 'off', autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false', placeholder: o.placeholder || '', 'data-testid': 'nv-' + k, onInput: () => o.on && o.on() }); return field(label, i, o.hint); };
    const status = h('p', { class: 'hint', 'data-testid': 'nv-vin-status', role: 'status' }, 'Type or paste a VIN first: if it is already in the fleet the form fills in from that record.');
    const typeHint = h('p', { class: 'hint', 'data-testid': 'nv-type' }, ''); const linHint = h('div', { class: 'hint', 'data-testid': 'nv-lin-hint' }); const err = h('p', { class: 'flagline', role: 'alert', 'data-testid': 'nv-error' });
    const openBtn = h('div', { class: 'row' }); let match = null; let statusSel = '';
    const upModel = () => {
      const m = val('model'); const mi = m ? modelInfo(m, modelLookup(st.settings)) : null; typeHint.textContent = m ? (mi.mapped ? `Type: ${mi.type} (${mi.cls})` : 'Model is not in the Type map yet: add it in More > Settings or the vehicle cannot be dispatched.') : '';
      clear(linHint); if (m && !val('lin')) { const sg = suggestLin(st.fleet, m, st.settings); if (sg) linHint.append('Other fleet vehicles of ', sg.basis, ' use LIN ', h('b', { class: 'mono' }, sg.lin), ` (${sg.count}). A LIN cannot be derived from a VIN - confirm it. `, btn('Use ' + sg.lin, () => { reg.lin.value = sg.lin; upModel(); }, 'small', { 'data-testid': 'nv-lin-suggest' })); }
    };
    const upVin = () => {
      const v = val('vin'); match = v ? findByVin(st.fleet, v) : null; clear(openBtn);
      if (match) { const ids = vehIds(match); reg.bumper.value = match.short; reg.model.value = match.model || ''; reg.lin.value = ids.lin; reg.desc.value = match.desc || ''; reg.uic.value = match.uic || reg.uic.value; upModel(); const vw = vehicleView(match, getCtx());
        status.textContent = `Already in the fleet as ${match.short} (${vw.type}). The fields show that record; nothing new is added.`; status.className = 'hint warn'; openBtn.append(btn(`Open ${match.short}`, () => { api.close(); openVehicle(match.key); }, 'small primary', { 'data-testid': 'nv-open-match' })); }
      else { status.className = 'hint'; status.textContent = vinKey(v).length < 4 ? 'Type or paste a VIN first: if it is already in the fleet the form fills in from that record.' : 'No fleet vehicle has this VIN. Fill in the fields by hand (a LIN cannot be derived from a VIN).'; }
    };
    const stSeg = segmented([['', 'Not set'], ...VEHICLE_STATUSES.map((s) => [s, s])], '', (v) => { statusSel = v; }, { label: 'Local status' });
    b.append(inp('vin', 'VIN / serial number', { on: upVin }), status, openBtn, inp('bumper', 'Bumper / admin number (required)', { placeholder: 'e.g. A-123' }), inp('model', 'Model number', { on: upModel, hint: 'The GCSS model decides the type and the qualification.' }), typeHint, inp('lin', 'LIN', { on: upModel }), linHint, inp('desc', 'Description (optional)'), inp('uic', 'UIC', { value: st.settings.unitUic || '' }),
      field('Local status', stSeg, 'A vehicle added by hand has no GCSS status; set one here or later on the vehicle.'), err);
    api.foot.append(h('button', { class: 'btn', type: 'button', onClick: () => api.close() }, 'Cancel'), h('button', { class: 'btn primary', type: 'button', 'data-testid': 'nv-save', onClick: () => {
      err.textContent = ''; const bump = val('bumper'); if (match) { err.textContent = `That VIN is already in the fleet (${match.short}).`; return; } if (!bump) { err.textContent = 'Enter the bumper / admin number.'; return; }
      const uic = val('uic'); const key = normBumper(bump, st.settings.prefixes, uic); if (!key) { err.textContent = 'Bumper number not readable.'; return; }
      if (st.fleet.some((x) => x.key === key)) { err.textContent = `${shortBumper(bump, st.settings.prefixes, uic)} is already in the fleet.`; return; }
      const rec = { key, vid: uid('v'), bumper: bump, short: shortBumper(bump, st.settings.prefixes, uic), uic, desc: val('desc'), model: val('model').toUpperCase(), gcss: '', asset: '', serial: '', registration: '', funcLoc: '', gcssDesc: '', userStatus: '', storageLoc: '', remark: 'added by hand', nsn: '', lin: '', notes: '', location: '', nmcSince: '', override: statusSel ? { status: statusSel, at: new Date().toISOString() } : null, walkAt: '', inExport: false, manual: true, lastImport: '' };
      if (val('vin')) rec.vinSet = val('vin'); if (val('lin')) rec.linSet = val('lin'); if (statusSel && statusSel !== 'FMC') rec.nmcSince = todayISO();
      st.fleet.push(rec); st.fleet.sort((a, c) => a.key.localeCompare(c.key, 'en', { numeric: true })); commit(); api.close(); toast(`${rec.short} added`);
    } }, 'Add to fleet'));
  } });
}
