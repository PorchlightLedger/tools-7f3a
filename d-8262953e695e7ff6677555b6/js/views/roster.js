import { S, getCtx, commit, go } from '../ctx.js';
import { h, openSheet, toast, field, segmented, toggle, confirmBox, clear, readFileText, readFileBytes } from '../dom.js';
import { gcssIdStats, isActivePerson, licenseState, personLabel, personName, missingGcssId, allQualNames, asOfDate, isActiveTrip, FLAG_FIELDS, tripPeople } from '../rules.js';
import { parseRosterRows, parseRosterText, applyRoster, rosterToCSV } from '../roster.js';
import { readTable } from '../readtable.js';
import { parseDelimited } from '../csv.js';
import { fmtDate, uid, normKeyText, stampForFile } from '../util.js';
import { chips, btn, emptyCard, piiNote } from '../ui.js';
import { shareOrDownload } from '../backup.js';

let filter = 'active', query = '', plt = '';
export function renderRoster(root, rest, top) {
  if (rest[0] === 'import') { setTimeout(() => { history.replaceState(null, '', '#roster'); openRosterImport(); }, 0); }
  else if (rest[0]) { filter = rest[0]; history.replaceState(null, '', '#roster'); }
  const st = S(); const ctx = getCtx(); const gi = gcssIdStats(st.roster, st.settings);
  top.append(btn('＋ Person', () => openPerson(null), 'primary small', { 'data-testid': 'add-person' }));
  root.append(piiNote());
  if (!st.roster.length) { root.append(emptyCard('No roster loaded', 'Import a CSV (or pasted text) with ID, Status, Platoon, Rank, Last, First, License Exp, AMMO / HAZMAT / NVD, GCSS ID and one X column per vehicle qualification. DODID and DOB columns are ignored, never stored.', btn('Import roster', () => openRosterImport(), 'primary', { 'data-testid': 'roster-import-empty' }), btn('Add person', () => openPerson(null)))); return 'Roster'; }
  root.append(h('div', { class: 'row between' },
    h('button', { type: 'button', class: 'gcss-counter ' + (gi.missing ? 'orange' : 'ok'), 'data-testid': 'gcss-counter', onClick: () => { filter = 'missing'; go('#roster'); } }, `Missing GCSS ID: ${gi.missing} of ${gi.active} Active`),
    h('div', { class: 'row' }, btn('Import', () => openRosterImport(), 'small', { 'data-testid': 'roster-import' }), btn('Export CSV', () => exportRosterCsv(), 'small', { 'data-testid': 'roster-export' }))));
  const plts = [...new Set(st.roster.map((p) => p.platoon).filter(Boolean))].sort();
  root.append(h('input', { type: 'search', class: 'search', placeholder: 'Search name, rank, ID, GCSS ID…', value: query, 'aria-label': 'Search roster', 'data-testid': 'roster-search', onInput: (e) => { query = e.target.value; draw(); } }));
  root.append(chips([['active', 'Active'], ['missing', 'No GCSS ID'], ['license', 'License issue'], ['all', 'All'], ['inactive', 'Not Active']], filter, (v) => { filter = v; go('#roster'); }, { label: 'Filter roster' }));
  if (plts.length > 1) root.append(h('label', { class: 'field inline' }, h('span', { class: 'lbl' }, 'Platoon'), h('select', { 'aria-label': 'Platoon filter', onChange: (e) => { plt = e.target.value; draw(); } }, h('option', { value: '' }, 'All'), plts.map((p) => h('option', { value: p, selected: p === plt }, p)))));
  const list = h('div', { class: 'plist', 'data-testid': 'person-list' }); root.append(list);
  function draw() {
    clear(list); const needle = query.trim().toLowerCase();
    const items = st.roster.filter((p) => {
      const act = isActivePerson(p, st.settings);
      if (filter === 'active' && !act) return false; if (filter === 'inactive' && act) return false; if (filter === 'missing' && !(act && missingGcssId(p))) return false;
      if (filter === 'license') { if (!act) return false; const s = licenseState(p, ctx.asOf, st.settings.licenseWindow); if (s === 'OK') return false; }
      if (plt && p.platoon !== plt) return false;
      return !needle || `${p.rank} ${p.last} ${p.first} ${p.id} ${p.gcssId} ${p.platoon}`.toLowerCase().includes(needle);
    }).sort((a, b) => personName(a).localeCompare(personName(b)));
    list.append(h('p', { class: 'muted', 'data-testid': 'person-shown' }, `${items.length} shown`));
    for (const p of items) {
      const ls = licenseState(p, ctx.asOf, st.settings.licenseWindow); const act = isActivePerson(p, st.settings);
      list.append(h('button', { type: 'button', class: 'prow', 'data-testid': 'person-row', 'data-id': p.id, onClick: () => openPerson(p.id) },
        h('div', { class: 'pr-main' }, h('b', null, personLabel(p)), h('small', null, `${p.id} · ${p.platoon || 'no platoon'} · ${p.status || 'no status'}`), h('small', { class: 'muted' }, `${(p.quals || []).length} quals${p.ammo ? ' · AMMO' : ''}${p.hazmat ? ' · HAZMAT' : ''}${p.nvd ? ' · NVD' : ''}`)),
        h('div', { class: 'pr-side' }, act && missingGcssId(p) ? h('span', { class: 'chip orange', 'data-testid': 'no-gcss-badge' }, 'no GCSS ID') : !missingGcssId(p) ? h('span', { class: 'chip mono' }, p.gcssId) : null,
          h('span', { class: 'chip ' + (ls === 'OK' ? 'go' : ls === 'EXPIRING' ? 'warn' : 'nogo') }, ls === 'OK' ? 'lic ✔' : 'lic ' + ls.toLowerCase()))));
    }
  }
  draw(); return 'Roster';
}
async function exportRosterCsv() {
  const st = S(); if (!(await confirmBox({ title: 'Export roster CSV?', message: 'The file contains names, license dates and GCSS IDs (PII). Share it only per your SOP.', okText: 'Export' }))) return;
  const bytes = new TextEncoder().encode(rosterToCSV(st.roster, st.settings)); const r = await shareOrDownload(bytes, `roster-${stampForFile()}.csv`, 'text/csv', { title: 'Roster (PII)' }); if (r.method !== 'cancelled') toast(r.method === 'share' ? 'Shared' : 'Saved to Downloads');
}

export function openPerson(id) {
  const st = S(); const existing = id ? st.roster.find((p) => p.id === id) : null;
  const nextId = () => { let n = st.roster.length + 1, i; do { i = 'P' + String(n++).padStart(3, '0'); } while (st.roster.some((p) => p.id.toUpperCase() === i)); return i; };
  const d = existing ? JSON.parse(JSON.stringify(existing)) : { id: nextId(), status: 'Active', platoon: '', rank: '', last: '', first: '', licExp: '', licExpRaw: '', ammo: false, hazmat: false, nvd: false, gcssId: '', note: '', quals: [] };
  openSheet({ title: existing ? personLabel(existing) : 'Add person', tall: true, build: (b, api) => {
    const inp = (label, key, o = {}) => field(label, h('input', { type: o.type || 'text', value: d[key] || '', autocomplete: 'off', autocapitalize: o.cap || 'words', 'data-testid': 'p-' + key, ...(o.attrs || {}), onInput: (e) => { d[key] = e.target.value; } }), o.hint);
    const idIn = h('input', { type: 'text', value: d.id, disabled: !!existing, autocomplete: 'off', 'data-testid': 'p-id', onInput: (e) => { d.id = e.target.value.trim(); } });
    const lic = h('input', { type: 'date', value: d.licExp || '', 'data-testid': 'p-licExp', onChange: (e) => { d.licExp = e.target.value; d.licExpRaw = ''; } });
    const status = h('select', { 'data-testid': 'p-status', 'aria-label': 'Status', onChange: (e) => { d.status = e.target.value; } }, st.settings.statuses.map((s) => h('option', { value: s.name, selected: s.name === d.status }, s.name)), st.settings.statuses.some((s) => s.name === d.status) ? null : h('option', { value: d.status, selected: true }, d.status || '(none)'));
    const plat = h('input', { type: 'text', value: d.platoon || '', list: 'plt-list', autocomplete: 'off', 'data-testid': 'p-platoon', onInput: (e) => { d.platoon = e.target.value; } });
    b.append(h('datalist', { id: 'plt-list' }, st.settings.platoons.map((p) => h('option', { value: p }))));
    b.append(field('ID (permanent key used by trips)', idIn, 'Use a local ID like P001. Do NOT use a DODID or SSN.'), h('div', { class: 'grid2' }, inp('Rank', 'rank', { cap: 'characters' }), field('Status', status), inp('Last name', 'last'), inp('First name', 'first')), field('Platoon', plat));
    b.append(field('License expiration', lic, d.licExpRaw ? `Unreadable value "${d.licExpRaw}" - pick the date` : 'Checked against the trip date'));
    b.append(field('GCSS-Army ID (text)', h('input', { type: 'text', value: d.gcssId || '', autocomplete: 'off', autocapitalize: 'characters', 'data-testid': 'p-gcssId', onInput: (e) => { d.gcssId = e.target.value.trim(); } }), 'Needed to put this Soldier on a dispatch in GCSS-Army'));
    const flags = h('div', { class: 'row' }); FLAG_FIELDS.forEach((f) => flags.append(toggle(f.toUpperCase(), !!d[f], (v) => { d[f] = v; })));
    b.append(flags);
    const quals = allQualNames(st.settings); [...(d.quals || [])].forEach((q) => { if (!quals.some((k) => normKeyText(k) === normKeyText(q))) quals.push(q); });
    const qbox = h('div', { class: 'qgrid', role: 'group', 'aria-label': 'Qualifications' });
    const qdraw = () => { clear(qbox); quals.forEach((q) => { const on = d.quals.some((x) => normKeyText(x) === normKeyText(q)); qbox.append(h('button', { type: 'button', class: 'qchip' + (on ? ' on' : ''), 'aria-pressed': String(on), 'data-q': q, onClick: () => { d.quals = on ? d.quals.filter((x) => normKeyText(x) !== normKeyText(q)) : [...d.quals, q]; qdraw(); } }, (on ? '✔ ' : '') + q)); }); };
    qdraw(); b.append(h('h3', null, 'Vehicle qualifications'), qbox, field('Notes', h('textarea', { rows: 2, value: d.note || '', onInput: (e) => { d.note = e.target.value; } })));
    api.foot.append(existing ? h('button', { class: 'btn danger', type: 'button', 'data-testid': 'p-delete', onClick: async () => {
      const used = st.trips.filter((t) => isActiveTrip(t) && tripPeople(t).some(([, pid]) => pid === existing.id)).length;
      if (await confirmBox({ title: 'Delete person?', message: `${personLabel(existing)} will be removed from the roster.${used ? ` They are on ${used} active trip(s) - those trips will show "not on roster".` : ''} To keep history, set status to Inactive instead.`, okText: 'Delete', danger: true })) { st.roster = st.roster.filter((p) => p.id !== existing.id); commit(); api.close(); toast('Deleted'); }
    } }, 'Delete') : null, h('button', { class: 'btn', type: 'button', onClick: () => api.close() }, 'Cancel'),
    h('button', { class: 'btn primary', type: 'button', 'data-testid': 'p-save', onClick: () => {
      if (!d.id) { toast('ID is required.', 'bad'); return; } if (!d.last && !d.first) { toast('Enter a name.', 'bad'); return; }
      if (!existing && st.roster.some((p) => p.id.toUpperCase() === d.id.toUpperCase())) { toast('That ID already exists.', 'bad'); return; }
      if (existing) Object.assign(existing, d); else st.roster.push(d); commit(); api.close(); toast('Saved');
    } }, 'Save'));
  } });
}

export function openRosterImport() {
  const st = S(); let parsed = null, mode = 'merge';
  openSheet({ title: 'Import roster', tall: true, build: (b, api) => {
    const out = h('div', { 'data-testid': 'rimport-out' });
    // No accept attribute on purpose (iOS greys out types it does not map); the file is identified by content.
    const file = h('input', { type: 'file', 'data-testid': 'rimport-file', 'aria-label': 'Choose roster file (.xls, .xlsx, .csv, .txt)' });
    const ta = h('textarea', { rows: 5, placeholder: 'Or paste CSV / tab-separated rows here (include the header row)…', 'aria-label': 'Paste roster text', 'data-testid': 'rimport-paste' });
    const fail = (e) => { parsed = null; clear(out); out.append(h('div', { class: 'card bad', role: 'alert', 'data-testid': 'rimport-error' }, e.message || String(e))); };
    const preview = () => {
      clear(out); if (!parsed) return; const i = parsed.issues; const act = parsed.people.filter((p) => isActivePerson(p, st.settings));
      out.append(h('div', { class: 'card go', 'data-testid': 'rimport-preview' }, h('p', null, `${parsed.people.length} people read · ${act.length} Active · ${act.filter(missingGcssId).length} Active without GCSS ID`),
        parsed.hasGcssCol ? null : h('p', { class: 'hint warn' }, 'No GCSS ID column found. Existing IDs are kept; you can add IDs per person.')));
      const w = [];
      if (parsed.dropped.length) w.push(`Ignored, NOT stored: ${parsed.dropped.join(', ')}`); if (parsed.newQuals.length) w.push(`New qualification column(s) added: ${parsed.newQuals.join(', ')}`);
      if (parsed.ignored.length) w.push(`Unrecognized columns ignored: ${parsed.ignored.join(', ')}`); if (i.generatedIds) w.push(`${i.generatedIds} row(s) had no ID - IDs were generated`);
      if (i.dupIds.length) w.push(`Duplicate IDs skipped: ${i.dupIds.join(', ')}`); if (i.badLicense.length) w.push(`Unreadable license dates (treated as invalid): ${i.badLicense.join(', ')}`); if (i.unknownStatus.length) w.push(`Statuses not in your list (treated as not available): ${i.unknownStatus.slice(0, 6).join('; ')}`);
      if (w.length) out.append(h('div', { class: 'card warn' }, w.map((x) => h('p', null, x))));
      out.append(field('How to apply', segmented([['merge', 'Update by ID + add new'], ['replace', 'Replace whole roster']], mode, (v) => { mode = v; }, { label: 'Import mode' }), 'Update keeps existing GCSS IDs when the file has none.'));
      out.append(h('button', { class: 'btn primary wide', type: 'button', 'data-testid': 'rimport-apply', onClick: async () => {
        if (mode === 'replace' && st.roster.length && !(await confirmBox({ title: 'Replace roster?', message: `This replaces all ${st.roster.length} people with the ${parsed.people.length} in the file.`, okText: 'Replace', danger: true }))) return;
        const r = applyRoster(st.roster, parsed, mode); st.roster = r.roster; for (const q of parsed.newQuals) if (!st.settings.extraQuals.includes(q)) st.settings.extraQuals.push(q);
        st.rosterMeta.importedAt = new Date().toISOString(); commit(); api.close(); toast(`Roster: ${r.added} added, ${r.updated} updated`);
      } }, 'Apply roster import'));
    };
    const run = (rows) => { try { parsed = parseRosterRows(rows, st.settings, { existing: mode === 'merge' ? st.roster : [] }); preview(); } catch (e) { fail(e); } };
    file.addEventListener('change', async () => { const f = file.files[0]; if (!f) return; try { const t = await readTable(await readFileBytes(f)); if (t.kind === 'text') run(parseDelimited(t.text)); else { const sh = t.sheets.find((x) => x.rows.length > 1) || t.sheets[0]; if (!sh) throw new Error('No sheet with data found in that file.'); run(sh.rows); } } catch (e) { fail(e); } });
    b.append(h('p', { class: 'hint' }, 'Columns: ID, Status, Platoon, Rank, Last name, First name, License Exp, AMMO, HAZMAT, NVD, GCSS ID, then one column per qualification (X = qualified). The ID column should be a local ID (P001), not a DODID/SSN. DODID, SSN and DOB columns are dropped on import and never stored.'), piiNote(),
      field('Roster file (.xls, .xlsx, .csv, .txt)', file), ta, h('button', { class: 'btn wide', type: 'button', 'data-testid': 'rimport-read', onClick: () => { if (!ta.value.trim()) { fail(new Error('Paste the text first, or choose a file.')); return; } run(parseDelimited(ta.value)); } }, 'Read pasted text'), out);
  } });
}
