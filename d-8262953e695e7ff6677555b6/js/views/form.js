import { S, getCtx, commit, go } from '../ctx.js';
import { h, openSheet, toast, field, segmented, toggle, confirmBox, clear, pick, safeAppend } from '../dom.js';
import { vehicleView } from '../rules.js';
import { SYMBOLS, LEGACY_SYMBOL, INSPECTION_TYPES, READING_TYPES, newForm, newFault, newPart, buildFormPdf, validateForm, formFileName, formHasNMC, symbolText, CIRCLED_X_PREFIX } from '../form5988.js';
import { STARTER_PRESETS, STARTER_PRESETS_LABEL } from '../store.js';
import { shareOrDownload } from '../backup.js';
import { fmtDate, todayISO, uid } from '../util.js';
import { btn, emptyCard, statusChip } from '../ui.js';

const DISCLAIMER = 'Worksheet aid. It does not replace the official DA Form 5988-E / GCSS-Army record. Check every symbol and TM reference against your TM and unit SOP.';
export function renderForms(root, rest, top) {
  const st = S();
  top.append(btn('‹ More', () => go('#more'), 'small'), btn('＋ New', () => newFormFlow(), 'primary small', { 'data-testid': 'form-new' }));
  root.append(h('div', { class: 'note', role: 'note' }, h('b', null, 'DA Form 5988-E worksheet. '), DISCLAIMER));
  if (!st.forms.length) root.append(emptyCard('No worksheets yet', 'Pick a vehicle, tap a status symbol for each fault, then make a PDF to share or print.', btn('New 5988-E worksheet', () => newFormFlow(), 'primary', { 'data-testid': 'form-new-empty' })));
  const ctx = getCtx();
  for (const f of [...st.forms].sort((a, b) => (b.updated || '').localeCompare(a.updated || ''))) {
    root.append(h('button', { type: 'button', class: 'vrow', 'data-testid': 'form-row', onClick: () => openFormEditor(f.id) }, h('div', { class: 'vr-main' }, h('b', null, f.adminNumber || 'no vehicle'), h('small', null, `${fmtDate(f.date)} · type ${f.typeInsp} · ${f.faults.length} fault(s)`), h('small', { class: 'muted' }, f.noun)), h('div', { class: 'vr-side' }, formHasNMC(f) ? h('span', { class: 'chip nogo' }, 'X fault') : h('span', { class: 'chip' }, 'draft'))));
  }
  root.append(h('div', { class: 'row' }, btn('Edit fault presets', () => openPresetEditor(), '', { 'data-testid': 'open-presets' })));
  return '5988-E worksheet';
}
export async function newFormFlow() {
  const st = S(); const ctx = getCtx();
  const items = ctx.fleet.map((v) => ({ v, vw: vehicleView(v, ctx) })).filter((u) => u.vw.status !== 'TURNED IN').sort((a, b) => a.v.key.localeCompare(b.v.key, 'en', { numeric: true })).map((u) => ({ id: u.v.key, label: u.v.short, sub: `${u.vw.type} · ${u.v.model}`, badge: u.vw.status }));
  if (!items.length) { toast('Import the fleet first.', 'bad'); return; }
  const r = await pick({ title: 'Choose vehicle for 5988-E', items }); if (r) openFormEditorFor(r);
}
export function openFormEditorFor(key) {
  const st = S(); const ctx = getCtx(); const v = ctx.fleetByKey.get(key); const vw = v ? vehicleView(v, ctx) : null;
  const f = newForm(v, { settings: st.settings, tmByType: st.tmByType, typeName: vw ? vw.type : '' }); st.forms.push(f); commit({ render: false }); openFormEditor(f.id, true);
}
export function openFormEditor(id, isNew = false) {
  const st = S(); const f = st.forms.find((x) => x.id === id); if (!f) return; const original = JSON.stringify(f);
  openSheet({ title: `5988-E · ${f.adminNumber || 'vehicle'}`, tall: true, onClose: () => { if (isNew && !f.faults.length && JSON.stringify(f) === original) { st.forms = st.forms.filter((x) => x.id !== f.id); } commit(); },
    build: (b, api) => {
      const body = safeAppend(h('div', { class: 'form' })); b.append(body);
      const txt = (label, key, o = {}) => field(label, h('input', { type: 'text', value: f[key] || '', autocomplete: 'off', autocapitalize: o.cap || 'characters', 'data-testid': 'F-' + key, onInput: (e) => { f[key] = e.target.value; f.updated = new Date().toISOString(); } }), o.hint);
      const draw = () => {
        clear(body); const warns = validateForm(f);
        body.append(h('div', { class: 'note', role: 'note' }, DISCLAIMER));
        body.append(h('h3', null, 'Equipment data'), h('div', { class: 'grid2' }, txt('Admin number', 'adminNumber'), txt('Equip serial num', 'serial'), txt('Equip model', 'model'), txt('Registration', 'registration')), txt('Equip noun', 'noun'), txt('Equip NSN', 'nsn', { hint: 'Not in the GCSS export - type it if you want it on the form' }),
          h('div', { class: 'grid2' }, field('Date', h('input', { type: 'date', value: f.date, 'data-testid': 'F-date', onChange: (e) => { f.date = e.target.value; } })), txt('UIC (optional)', 'uic')),
          field('Type inspection', segmented(INSPECTION_TYPES.map(([c, n]) => [c, c, n]), f.typeInsp, (v) => { f.typeInsp = v; }, { label: 'Type of inspection', cls: 'wrapseg' })),
          h('div', { class: 'grid2' }, field('Reading type', segmented(READING_TYPES.map(([c, n]) => [c, c, n]), f.readingType, (v) => { f.readingType = v; }, { label: 'Reading type' })), txt('Current reading', 'reading', { hint: '' })));
        body.append(h('h3', null, 'Publications (TM number / date / change)'));
        f.pubs.forEach((p, i) => body.append(h('div', { class: 'grid3' }, ...['tm', 'date', 'change'].map((k) => field(k === 'tm' ? `TM ${i + 1}` : k === 'date' ? 'Date' : 'Change', h('input', { type: 'text', value: p[k] || '', autocomplete: 'off', autocapitalize: 'characters', 'data-testid': `F-pub${i}-${k}`, onInput: (e) => { p[k] = e.target.value; } }))))));
        const vwt = (getCtx().fleetByKey.get(f.vehicleKey) || null); const tname = vwt ? vehicleView(vwt, getCtx()).type : '';
        body.append(h('div', { class: 'row' }, f.pubs.length < 4 ? btn('+ Add TM line', () => { f.pubs.push({ tm: '', date: '', change: '' }); draw(); }, 'small') : null, tname ? btn(`Remember TMs for ${tname}`, () => { st.tmByType[tname] = f.pubs.filter((p) => p.tm).map((p) => ({ ...p })); commit({ render: false }); toast('Saved for this vehicle type'); }, 'small') : null));
        body.append(h('h3', null, 'Inspector'), h('div', { class: 'grid2' }, txt("Inspector's LIC #", 'inspLic'), txt('Time', 'inspTime')), txt('Inspector name / rank (prints on SIGNATURE line - leave blank to sign by hand)', 'inspName', { cap: 'words' }), txt('Maintenance supervisor / designated rep (optional)', 'supName', { cap: 'words' }));
        body.append(h('h3', null, 'Add a fault: tap the status symbol'));
        const symRow = h('div', { class: 'symrow', role: 'group', 'aria-label': 'Add fault by status symbol' });
        for (const s of [...SYMBOLS, ...(st.settings.showEPrefix ? [LEGACY_SYMBOL] : [])]) symRow.append(h('button', { type: 'button', class: 'sym s-' + (s.code === '-' ? 'dash' : s.code === '/' ? 'diag' : s.code === 'CX' ? 'cx' : s.code === 'E' ? 'e' : 'x'), title: s.title, 'aria-label': 'Add ' + s.title, 'data-testid': 'add-' + s.code, onClick: () => openFaultSheet(f, null, s.code, draw) }, h('b', null, s.code === 'CX' ? 'X' : s.code === '-' ? '--' : s.code), h('small', null, s.code === 'CX' ? 'circled' : s.code === 'X' ? 'NMC' : s.code === '/' ? 'shortcoming' : s.code === '-' ? 'due' : 'legacy')));
        body.append(symRow, h('details', { class: 'legend' }, h('summary', null, 'What the symbols mean'), h('ul', null, SYMBOLS.map((s) => h('li', null, s.short)), h('li', null, 'Circled TM item number = the fault is in the TM "equipment not ready/available" (NMC) column.'), h('li', null, 'Last-name initial = satisfactory / corrected.'))));
        const sorted = [...f.faults].sort((a, c) => (parseInt(a.item, 10) || 0) - (parseInt(c.item, 10) || 0));
        if (!sorted.length) body.append(h('p', { class: 'muted' }, 'No faults yet.'));
        sorted.forEach((x) => body.append(h('button', { type: 'button', class: 'faultrow', 'data-testid': 'fault-row', onClick: () => openFaultSheet(f, x, x.symbol, draw) }, h('span', { class: 'fnum' + (x.circleItem ? ' circ' : '') }, String(x.item).padStart(4, '0')), h('span', { class: 'fsym s-' + (x.symbol === '-' ? 'dash' : x.symbol === '/' ? 'diag' : x.symbol === 'CX' ? 'cx' : 'x') }, symbolText(x.symbol)), h('span', { class: 'fdesc' }, x.desc || '(no description)', x.action ? h('small', null, 'Action: ' + x.action) : null))));
        body.append(h('h3', null, 'Parts required (optional)'));
        f.parts.forEach((p, i) => body.append(h('button', { type: 'button', class: 'faultrow', onClick: () => openPartSheet(f, p, draw) }, h('span', { class: 'fnum' }, p.fault || '—'), h('span', { class: 'fdesc' }, `${p.noun || p.niin || 'part'} · ${p.doc || 'no doc #'}`))));
        body.append(btn('+ Add part line', () => openPartSheet(f, null, draw), 'small'));
        if (warns.length) body.append(h('div', { class: 'card warn', 'data-testid': 'form-warnings' }, h('b', null, 'Check before printing'), h('ul', null, warns.map((w) => h('li', null, w)))));
      };
      draw();
      api.foot.append(
        h('button', { class: 'btn danger', type: 'button', 'data-testid': 'form-delete', onClick: async () => { if (await confirmBox({ title: 'Delete worksheet?', message: 'This removes the saved worksheet from the app.', okText: 'Delete', danger: true })) { st.forms = st.forms.filter((x) => x.id !== f.id); isNew = false; commit(); api.close(); } } }, 'Delete'),
        h('button', { class: 'btn', type: 'button', 'data-testid': 'form-save', onClick: () => { f.updated = new Date().toISOString(); commit(); toast('Worksheet saved'); } }, 'Save'),
        h('button', { class: 'btn primary', type: 'button', 'data-testid': 'form-pdf', onClick: async () => {
          f.updated = new Date().toISOString(); commit({ render: false });
          try { const bytes = buildFormPdf(f, { unitName: st.settings.unitName }); const r = await shareOrDownload(bytes, formFileName(f), 'application/pdf', { title: `DA Form 5988-E worksheet ${f.adminNumber || ''}`, text: 'Worksheet aid - not an official form.' });
            if (r.method === 'download') toast('PDF saved to Downloads / Files'); else if (r.method === 'share') toast('Shared'); window.__lastPdf = { size: bytes.length, name: formFileName(f), method: r.method };
          } catch (e) { console.error(e); toast('Could not make the PDF: ' + e.message, 'bad'); }
        } }, 'Make PDF / share'));
    } });
}
function openFaultSheet(form, fault, symbol, done) {
  const st = S(); const isNew = !fault; const d = fault ? JSON.parse(JSON.stringify(fault)) : newFault(form, symbol);
  if (isNew) d.symbol = symbol;
  openSheet({ title: isNew ? 'Add fault' : `Fault ${d.item}`, tall: true, build: (b, api) => {
    const body = safeAppend(h('div', { class: 'form' })); b.append(body);
    const draw = () => {
      clear(body);
      const syms = [...SYMBOLS, ...(st.settings.showEPrefix ? [LEGACY_SYMBOL] : [])];
      body.append(field('Status symbol', h('div', { class: 'symrow', role: 'radiogroup', 'aria-label': 'Status symbol' }, syms.map((s) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(d.symbol === s.code), class: 'sym s-' + (s.code === '-' ? 'dash' : s.code === '/' ? 'diag' : s.code === 'CX' ? 'cx' : s.code === 'E' ? 'e' : 'x') + (d.symbol === s.code ? ' on' : ''), title: s.title, 'data-testid': 'sym-' + s.code, onClick: () => { const was = d.symbol; d.symbol = s.code; if (s.code === 'CX' && !d.action) d.action = CIRCLED_X_PREFIX; if (was === 'CX' && s.code !== 'CX' && d.action === CIRCLED_X_PREFIX) d.action = ''; draw(); } }, h('b', null, s.code === 'CX' ? 'X' : s.code === '-' ? '--' : s.code), h('small', null, s.code === 'CX' ? 'circled' : s.code === 'X' ? 'NMC' : s.code === '/' ? 'shortcoming' : s.code === '-' ? 'due' : 'legacy'))))));
      body.append(h('p', { class: 'hint' }, (syms.find((s) => s.code === d.symbol) || {}).short));
      if (d.symbol === 'CX') body.append(h('p', { class: 'note' }, 'Only the commander (or designated representative / maintenance officer) may circle an X, and never for something that endangers the crew. Put the limitation in the corrective action.'));
      body.append(h('div', { class: 'grid2' }, field('TM item number', h('input', { type: 'text', inputmode: 'numeric', value: d.item, 'data-testid': 'fl-item', onInput: (e) => { d.item = e.target.value.trim(); } })), field('Fault date', h('input', { type: 'date', value: d.date, onChange: (e) => { d.date = e.target.value; } }))));
      body.append(toggle('Circle the item number (fault is in the TM "not ready / available" column)', !!d.circleItem, (v) => { d.circleItem = v; }));
      const desc = h('textarea', { rows: 3, value: d.desc, placeholder: 'Describe the fault', 'aria-label': 'Fault description', 'data-testid': 'fl-desc', onInput: (e) => { d.desc = e.target.value; } });
      body.append(field('Deficiency / shortcoming description', desc), btn('Pick from preset list', async () => {
        const items = st.presets.map((p) => ({ id: p.id, label: p.desc, badge: p.symbol === '-' ? '--' : p.symbol })); const r = await pick({ title: 'Fault presets', items, note: STARTER_PRESETS_LABEL + ' (suggested symbols only - the TM decides)' });
        if (r) { const p = st.presets.find((x) => x.id === r); d.desc = p.desc; if (isNew && d.symbol !== 'CX') { d.symbol = p.symbol; d.circleItem = p.symbol === 'X'; } draw(); }
      }, 'small', { 'data-testid': 'fl-preset' }));
      body.append(field('Corrective action', h('textarea', { rows: 2, value: d.action || '', 'data-testid': 'fl-action', onInput: (e) => { d.action = e.target.value; } })), h('div', { class: 'grid2' }, field('Oper hrs', h('input', { type: 'text', inputmode: 'decimal', value: d.hrs || '', onInput: (e) => { d.hrs = e.target.value; } })), field('LIC #', h('input', { type: 'text', value: d.lic || '', autocapitalize: 'characters', onInput: (e) => { d.lic = e.target.value; } }))));
    };
    draw();
    api.foot.append(!isNew ? h('button', { class: 'btn danger', type: 'button', onClick: () => { form.faults = form.faults.filter((x) => x.id !== d.id); form.updated = new Date().toISOString(); commit({ render: false }); api.close(); done(); } }, 'Delete') : null, h('button', { class: 'btn', type: 'button', onClick: () => api.close() }, 'Cancel'),
      h('button', { class: 'btn primary', type: 'button', 'data-testid': 'fl-save', onClick: () => {
        if (!d.item) { toast('Item number needed.', 'bad'); return; }
        if (isNew) form.faults.push(d); else Object.assign(fault, d); form.updated = new Date().toISOString(); commit({ render: false }); api.close(); done();
      } }, 'Save fault'));
  } });
}
function openPartSheet(form, part, done) {
  const isNew = !part; const d = part ? { ...part } : newPart();
  const cols = [['fault', 'Fault item'], ['doc', 'Document number'], ['niin', 'NIIN'], ['noun', 'Noun'], ['qtyDue', 'Qty due'], ['qtyRec', 'Qty received'], ['status', 'Status'], ['date', 'Date'], ['comp', 'Comp'], ['pri', 'Priority'], ['dlc', 'DLC']];
  openSheet({ title: isNew ? 'Add part line' : 'Part line', tall: true, build: (b, api) => {
    b.append(h('p', { class: 'hint' }, 'Mirrors the PARTS REQUIRED block: fault item, doc number, NIIN, noun, quantity due / received, status, date, completion, priority, DLC (deadline code).'), h('div', { class: 'form' }, cols.map(([k, l]) => field(l, h('input', { type: 'text', value: d[k] || '', autocapitalize: 'characters', onInput: (e) => { d[k] = e.target.value; } })))));
    api.foot.append(!isNew ? h('button', { class: 'btn danger', type: 'button', onClick: () => { form.parts = form.parts.filter((x) => x.id !== d.id); commit({ render: false }); api.close(); done(); } }, 'Delete') : null, h('button', { class: 'btn', type: 'button', onClick: () => api.close() }, 'Cancel'), h('button', { class: 'btn primary', type: 'button', onClick: () => { if (isNew) form.parts.push(d); else Object.assign(part, d); commit({ render: false }); api.close(); done(); } }, 'Save'));
  } });
}
export function openPresetEditor() {
  const st = S();
  openSheet({ title: 'Fault presets', tall: true, build: (b, api) => {
    const draw = () => {
      clear(b); b.append(h('div', { class: 'note warn', 'data-testid': 'preset-banner' }, h('b', null, STARTER_PRESETS_LABEL + '. '), 'These are generic starter faults with suggested symbols only. Replace them with items from your TM PMCS tables.'),
        h('div', { class: 'row' }, btn('+ Add preset', () => editOne(null), 'primary small', { 'data-testid': 'preset-add' }), btn('Reset to starter set', async () => { if (await confirmBox({ title: 'Reset presets?', message: 'Replaces the list with the generic starter set.', okText: 'Reset', danger: true })) { st.presets = STARTER_PRESETS.map((p) => ({ ...p })); commit({ render: false }); draw(); } }, 'small')));
      const ul = h('ul', { class: 'pick-list' }); st.presets.forEach((p) => ul.append(h('li', null, h('button', { type: 'button', class: 'pick-item', onClick: () => editOne(p) }, h('span', { class: 'pi-main' }, h('b', null, p.desc)), h('span', { class: 'chip' }, p.symbol === '-' ? '--' : p.symbol))))); b.append(ul);
      b.append(toggle('Offer the legacy "E" symbol (appears in ULLS-era training slides; verify before using)', !!st.settings.showEPrefix, (v) => { st.settings.showEPrefix = v; commit({ render: false }); }));
    };
    const editOne = (p) => {
      const d = p ? { ...p } : { id: uid('pre'), desc: '', symbol: '/' };
      openSheet({ title: p ? 'Edit preset' : 'New preset', build: (bb, a2) => {
        bb.append(field('Fault description', h('textarea', { rows: 2, value: d.desc, 'data-testid': 'preset-desc', onInput: (e) => { d.desc = e.target.value; } })), field('Suggested symbol', segmented([['X', 'X'], ['/', '/'], ['-', '--']], d.symbol, (v) => { d.symbol = v; })));
        a2.foot.append(p ? h('button', { class: 'btn danger', type: 'button', onClick: () => { st.presets = st.presets.filter((x) => x.id !== p.id); commit({ render: false }); a2.close(); draw(); } }, 'Delete') : null, h('button', { class: 'btn primary', type: 'button', 'data-testid': 'preset-save', onClick: () => { if (!d.desc.trim()) { toast('Enter a description.', 'bad'); return; } d.desc = d.desc.trim(); if (p) Object.assign(p, d); else st.presets.push(d); commit({ render: false }); a2.close(); draw(); } }, 'Save'));
      } });
    };
    draw(); api.foot.append(h('button', { class: 'btn', type: 'button', onClick: () => api.close() }, 'Close'));
  } });
}
