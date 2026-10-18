import { S, getCtx, commit, go } from '../ctx.js';
import { h, openSheet, toast, field, segmented, clear, pick, safeAppend } from '../dom.js';
import { vehicleView, VEHICLE_STATUSES, isNMC, idLine } from '../rules.js';
import { pickDate } from '../pickers.js';
import { todayISO, fmtDate, localDayOf } from '../util.js';
import { statusChip, chips, btn, emptyCard } from '../ui.js';
import { openFormEditorFor } from './form.js';

let filter = 'todo', query = '';
export function renderWalk(root, rest, top) {
  const st = S(); const ctx = getCtx(); const today = todayISO();
  top.append(btn('‹ More', () => go('#more'), 'small'));
  root.append(h('p', { class: 'hint' }, 'Walk the motor pool: tap a vehicle, mark its status, add the fault, location and NMC-since date. Changes are local and flagged until GCSS-Army agrees.'));
  if (!st.fleet.length) { root.append(emptyCard('No fleet loaded', 'Import the GCSS export first.', btn('Import GCSS', () => go('#fleet/import'), 'primary'))); return 'Walk-around'; }
  const all = st.fleet.map((v) => ({ v, vw: vehicleView(v, ctx) })).filter((x) => x.vw.status !== 'TURNED IN').sort((a, b) => a.v.key.localeCompare(b.v.key, 'en', { numeric: true }));
  const seen = (v) => localDayOf(v.walkAt) === today;
  const done = all.filter((x) => seen(x.v)).length;
  root.append(h('div', { class: 'card' }, h('b', { 'data-testid': 'walk-progress' }, `${done} of ${all.length} seen today`), h('div', { class: 'bar', role: 'presentation' }, (() => { const i = h('i', { class: 'bar-fill' }); i.style.width = Math.round((done / Math.max(1, all.length)) * 100) + '%'; return i; })())));
  root.append(h('input', { type: 'search', class: 'search', placeholder: 'Search bumper / type…', value: query, 'aria-label': 'Search vehicles', 'data-testid': 'walk-search', onInput: (e) => { query = e.target.value; draw(); } }),
    chips([['todo', 'Not seen today'], ['all', 'All'], ['NMC', 'NMC'], ['FMC', 'FMC']], filter, (v) => { filter = v; go('#more/walk'); }, { label: 'Filter' }));
  const list = h('div', { class: 'vlist', 'data-testid': 'walk-list' }); root.append(list);
  function visible() { const n = query.trim().toLowerCase(); return all.filter(({ v, vw }) => (filter === 'all' || (filter === 'todo' && !seen(v)) || (filter === 'NMC' && isNMC(vw.status)) || (filter === 'FMC' && vw.status === 'FMC')) && (!n || `${v.short} ${vw.type} ${v.model}`.toLowerCase().includes(n))); }
  function draw() {
    clear(list); const items = visible(); list.append(h('p', { class: 'muted' }, `${items.length} shown`));
    for (const { v, vw } of items) list.append(h('button', { type: 'button', class: 'vrow', 'data-testid': 'walk-row', 'data-key': v.key, onClick: () => openWalk(v.key, items.map((x) => x.v.key)) },
      h('div', { class: 'vr-main' }, h('b', null, v.short), h('small', null, vw.type), h('small', { class: 'muted' }, idLine(v) || 'no LIN / VIN'), v.notes ? h('small', { class: 'muted' }, v.notes.slice(0, 60)) : null), h('div', { class: 'vr-side' }, statusChip(vw.status), seen(v) ? h('span', { class: 'chip go' }, 'seen ✔') : null)));
  }
  draw(); return 'Walk-around';
}

export function openWalk(key, keys) {
  const st = S(); let idx = Math.max(0, keys.indexOf(key));
  openSheet({ title: 'Walk-around', tall: true, build: (b, api) => {
    const body = safeAppend(h('div')); b.append(body);
    const draw = () => {
      const v = st.fleet.find((x) => x.key === keys[idx]); if (!v) { api.close(); return; }
      const ctx = getCtx(); const vw = vehicleView(v, ctx); clear(body); api.setTitle(`${v.short} (${idx + 1}/${keys.length})`);
      body.append(h('div', { class: 'row' }, statusChip(vw.status), h('span', { class: 'chip' }, vw.type), vw.source === 'override' ? h('span', { class: 'chip warn' }, 'GCSS: ' + (v.gcss || '—')) : null));
      body.append(h('p', { class: 'hint', 'data-testid': 'walk-ids' }, [idLine(v), vw.platoon].filter(Boolean).join(' · ') || 'No LIN / VIN on file (add it in the vehicle detail on the Fleet tab)'));
      for (const f of vw.flags) body.append(h('p', { class: 'flagline' }, '⚠ ' + f));
      const locked = vw.status === 'NMC-X';
      if (locked) body.append(h('p', { class: 'note' }, 'X vehicle: permanent NMC (cannot be changed here).'));
      const btns = h('div', { class: 'bigstat', role: 'group', 'aria-label': 'Set status' });
      VEHICLE_STATUSES.forEach((s) => btns.append(h('button', { type: 'button', class: 'bs ' + (s === 'FMC' ? 'go' : 'nogo') + (vw.status === s ? ' on' : ''), disabled: locked, 'aria-pressed': String(vw.status === s), 'data-testid': 'walk-' + s, onClick: () => {
        if (s === vw.status && vw.source === 'override') return;
        v.override = s === v.gcss ? null : { status: s, at: new Date().toISOString() };
        if (s !== 'FMC' && !v.nmcSince) v.nmcSince = todayISO(); if (s === 'FMC') v.nmcSince = ''; commit({ render: false }); draw();
      } }, s)));
      body.append(btns);
      if (v.override) body.append(btn('Back to GCSS status (' + (v.gcss || '—') + ')', () => { v.override = null; commit({ render: false }); draw(); }, 'small'));
      const notes = h('textarea', { rows: 3, value: v.notes || '', placeholder: 'Fault / notes (what is wrong, parts needed…)', 'aria-label': 'Fault notes', 'data-testid': 'walk-notes', onInput: (e) => { v.notes = e.target.value; commit({ render: false }); } });
      body.append(field('Fault notes', notes), btn('+ Add fault from list', async () => {
        const items = st.presets.map((p) => ({ id: p.id, label: p.desc, badge: p.symbol === '-' ? '--' : p.symbol })); const r = await pick({ title: 'Add fault (starter list - edit in 5988-E presets)', items, note: 'STARTER SET - EDIT TO MATCH YOUR TM / PMCS' });
        if (r) { const p = st.presets.find((x) => x.id === r); v.notes = (v.notes ? v.notes.replace(/\s+$/, '') + '\n' : '') + p.desc; commit({ render: false }); draw(); }
      }, 'small', { 'data-testid': 'walk-addfault' }));
      const locs = (st.ui.lastLocations || []).slice(0, 6);
      const loc = h('input', { type: 'text', value: v.location || '', placeholder: v.funcLoc || 'e.g. Bay 3 / back fence line', 'aria-label': 'Location', 'data-testid': 'walk-location', onInput: (e) => { v.location = e.target.value; } });
      body.append(field('Location', loc), locs.length ? h('div', { class: 'filters' }, locs.map((l) => h('button', { type: 'button', class: 'fchip', onClick: () => { v.location = l; commit({ render: false }); draw(); } }, l))) : null);
      body.append(h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'NMC since'), h('button', { type: 'button', class: 'select-btn dt-btn', 'data-testid': 'walk-nmcsince', 'data-value': v.nmcSince || '', onClick: async () => { const r = await pickDate({ title: 'NMC since', value: v.nmcSince || '' }); if (r === undefined) return; v.nmcSince = r; commit({ render: false }); draw(); } }, h('span', { class: 'val' }, v.nmcSince ? fmtDate(v.nmcSince) : 'Tap to set')), h('small', { class: 'hint' }, vw.days != null ? `${vw.days} days NMC` : (vw.status === 'FMC' ? 'Not NMC' : ''))));
      body.append(h('p', { class: 'muted' }, v.walkAt ? `Last seen ${new Date(v.walkAt).toLocaleString()}` : 'Not seen yet'));
      const save = (next) => {
        v.walkAt = new Date().toISOString(); const l = (v.location || '').trim(); if (l) { st.ui.lastLocations = [l, ...(st.ui.lastLocations || []).filter((x) => x !== l)].slice(0, 12); }
        commit({ render: false });
        if (next && idx < keys.length - 1) { idx++; draw(); toast('Saved'); } else { commit(); api.close(); toast('Saved'); }
      };
      body.append(h('div', { class: 'row' }, btn('‹ Prev', () => { if (idx > 0) { idx--; draw(); } }, '', { disabled: idx === 0 }), btn('Save & next ›', () => save(true), 'primary', { 'data-testid': 'walk-next' }), btn('Save & close', () => save(false), '', { 'data-testid': 'walk-save' })), btn('Write up on DA 5988-E', () => { save(false); openFormEditorFor(v.key); }, 'wide'));
    };
    draw();
  }, onClose: () => commit() });
}
