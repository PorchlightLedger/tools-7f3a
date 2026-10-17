// TM (technical manual) display + manual entry, per vehicle or per model.
import { S, commit, getCtx } from '../ctx.js';
import { h, openSheet, toast, field } from '../dom.js';
import { vehicleView } from '../rules.js';
import { resolveTm, tmLevelText, modelKey, TM_NOT_FOUND, TM_TABLE, builtinByModel, knownItems } from '../tmdata.js';
import { btn } from '../ui.js';
import { clean } from '../util.js';

export const tmFor = (v, st = S(), ctx = getCtx()) => resolveTm(v, { tmByModel: st.tmByModel, tmByType: st.tmByType, typeName: v ? vehicleView(v, ctx).type : '' });

/** read-only summary block with the edit buttons. onChange() redraws the host. */
export function tmBlock(v, onChange) {
  const st = S(); const r = tmFor(v, st); const box = h('div', { class: 'tmblock card', 'data-testid': 'tm-block', 'data-level': r.level });
  box.append(h('h3', null, 'Technical manual (TM)'));
  if (r.resolved) {
    box.append(h('p', { class: 'tm-main', 'data-testid': 'tm-label' }, h('b', null, r.tm10 || r.pmcs), r.title ? h('small', null, ' ' + r.title) : null));
    if (r.pmcs && r.pmcs !== r.tm10) box.append(h('p', { class: 'hint', 'data-testid': 'tm-pmcs' }, 'PMCS: ' + r.pmcs));
    box.append(h('p', { class: 'hint' }, 'Source: ' + tmLevelText(r.level) + (r.source && r.level.startsWith('builtin') ? ' — ' + r.source : '')));
    if (r.url) box.append(h('p', { class: 'hint' }, 'Reference: ' + r.url));
  } else {
    box.append(h('p', { class: 'flagline', 'data-testid': 'tm-label' }, TM_NOT_FOUND), r.note ? h('p', { class: 'hint' }, r.note) : null);
  }
  box.append(h('div', { class: 'row' }, btn('Enter TM for this vehicle', () => openTmEditor({ vehicle: v }, onChange), 'small', { 'data-testid': 'tm-edit-vehicle' }), v.model ? btn(`Enter TM for all ${v.model}`, () => openTmEditor({ model: v.model }, onChange), 'small', { 'data-testid': 'tm-edit-model' }) : null));
  return box;
}

export function openTmEditor({ vehicle = null, model = '' }, onSaved) {
  const st = S(); const mk = modelKey(vehicle ? vehicle.model : model); const scopeVeh = !!vehicle;
  const cur = scopeVeh ? (vehicle.tmSet || {}) : (st.tmByModel[mk] || {});
  const d = { tm10: clean(cur.tm10), pmcs: clean(cur.pmcs), items: (cur.items || []).map((i) => ({ ...i })) };
  const built = builtinByModel.get(mk);
  openSheet({ title: scopeVeh ? `TM for ${vehicle.short}` : `TM for model ${vehicle ? vehicle.model : model}`, tall: true, build: (b, api) => {
    b.append(h('p', { class: 'hint' }, scopeVeh ? 'Applies to this vehicle only and wins over the model entry and the built-in table.' : 'Applies to every vehicle of this model (a vehicle entry still wins). Wins over the built-in table.'),
      built ? h('p', { class: 'hint' }, `Built-in for this model: ${built.tm10}. Leave the fields empty and save to go back to it.`) : h('p', { class: 'hint' }, 'No built-in TM for this model: enter it from your TM list.'));
    b.append(field('Operator manual (-10) number', h('input', { type: 'text', value: d.tm10, autocapitalize: 'characters', autocomplete: 'off', placeholder: 'e.g. TM 9-2320-387-10', 'data-testid': 'tm-in-tm10', onInput: (e) => { d.tm10 = e.target.value; } })));
    b.append(field('PMCS table reference (optional)', h('input', { type: 'text', value: d.pmcs, autocomplete: 'off', placeholder: 'e.g. TM 9-2320-xxx-10, Table 2-1', 'data-testid': 'tm-in-pmcs', onInput: (e) => { d.pmcs = e.target.value; } }), 'A bare TM number becomes a second publication line on the 5988-E; other text is shown as a reference.'));
    if (!scopeVeh) {
      const ta = h('textarea', { rows: 6, spellcheck: 'false', autocapitalize: 'none', 'data-testid': 'tm-in-items', placeholder: '1 | Tires\n2 | Fuel and water\n3a | ...', onInput: () => { d.items = ta.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf('|'); return i < 0 ? { n: l, desc: '' } : { n: l.slice(0, i).trim(), desc: l.slice(i + 1).trim() }; }).filter((x) => x.n); } });
      ta.value = d.items.map((i) => `${i.n} | ${i.desc || ''}`).join('\n');
      b.append(field('Known PMCS item numbers for this model (optional: "no. | text", one per line)', ta, 'Offered when you add a fault on a 5988-E. Type only what you read in your TM; nothing is pre-filled.'));
    }
    api.foot.append(h('button', { class: 'btn', type: 'button', onClick: () => api.close() }, 'Cancel'),
      h('button', { class: 'btn primary', type: 'button', 'data-testid': 'tm-save', onClick: () => {
        const rec = { tm10: clean(d.tm10), pmcs: clean(d.pmcs) };
        if (scopeVeh) { if (rec.tm10 || rec.pmcs) vehicle.tmSet = rec; else delete vehicle.tmSet; }
        else { const items = d.items.filter((i) => clean(i.n)); if (rec.tm10 || rec.pmcs || items.length) st.tmByModel[mk] = { ...rec, items }; else delete st.tmByModel[mk]; }
        commit({ render: false }); api.close(); toast('TM saved'); onSaved && onSaved();
      } }, 'Save'));
  } });
}
export { knownItems, TM_TABLE };

/** the TM table: every model in the fleet (plus built-in models) with the TM it resolves to, tap to enter / change it for the whole model */
export function openTmTable() {
  const st = S();
  openSheet({ title: 'TM table', tall: true, build: (b, api) => {
    const draw = () => {
      b.replaceChildren(); const ctx = getCtx();
      const fleetModels = new Map(); for (const v of st.fleet) { const k = modelKey(v.model); if (!k) continue; if (!fleetModels.has(k)) fleetModels.set(k, { model: v.model, vehicles: [] }); fleetModels.get(k).vehicles.push(v); }
      b.append(h('p', { class: 'hint' }, 'Built-in numbers come from public Army publication records (each row lists its source). Tap a model to enter or change its TM for all vehicles of that model. Unknown models show "TM not found - enter manually".'));
      const ul = h('ul', { class: 'pick-list', 'data-testid': 'tm-table' });
      const rows = [...fleetModels.values()].sort((a, c) => a.model.localeCompare(c.model, 'en', { numeric: true }));
      for (const m of rows) { const r = resolveTm(m.vehicles[0], { tmByModel: st.tmByModel, tmByType: {}, typeName: '' }); ul.append(h('li', null, h('button', { type: 'button', class: 'pick-item', 'data-testid': 'tm-row', 'data-model': m.model, onClick: () => openTmEditor({ model: m.model }, draw) }, h('span', { class: 'pi-main' }, h('b', null, `${m.model} (${m.vehicles.length})`), h('small', null, r.resolved ? `${r.label} · ${tmLevelText(r.level)}` : TM_NOT_FOUND)), h('span', { class: 'chip ' + (r.resolved ? 'go' : 'warn') }, r.resolved ? 'TM' : '?')))); }
      if (!rows.length) ul.append(h('li', { class: 'empty' }, 'Import the fleet to list its models.'));
      b.append(ul);
      b.append(h('h3', null, 'Built-in table'), h('ul', { class: 'pick-list' }, TM_TABLE.map((r) => h('li', null, h('div', { class: 'pick-item' }, h('span', { class: 'pi-main' }, h('b', null, `${r.tm10}`), h('small', null, `${r.models.join(', ')} · ${r.level === 'apd' ? 'APD record' : 'public manual listing'}`), h('small', { class: 'muted' }, r.source)))))));
    };
    draw(); api.foot.append(h('button', { class: 'btn', type: 'button', onClick: () => api.close() }, 'Close'));
  } });
}
