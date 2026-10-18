import { S, getCtx, commit, go } from '../ctx.js';
import { h, openSheet, toast, field, segmented, toggle, confirmBox, clear, pick, safeAppend } from '../dom.js';
import { vehicleView, idLine } from '../rules.js';
import { findByVin, suggestLin, headerFromVehicle, vinKey } from '../vin.js';
import { thumbFor, faultPhotoStrip, FAULT_PHOTO_HELP } from '../photoui.js';
import { faultPhotoKeys, faultPhotoCount, removeFaultPhotos, getPhotoBlob } from '../photos.js';
import { tmFor } from './tmedit.js';
import { knownItems, modelKey } from '../tmdata.js';
import { SYMBOLS, LEGACY_SYMBOL, INSPECTION_TYPES, READING_TYPES, newForm, newFault, newPart, buildFormPdf, validateForm, formFileName, formHasNMC, symbolText, CIRCLED_X_PREFIX, formUic } from '../form5988.js';
import { STARTER_PRESETS, STARTER_PRESETS_LABEL } from '../store.js';
import { shareOrDownload } from '../backup.js';
import { fmtDate, todayISO, uid, sortFaults, compareItems } from '../util.js';
import { pickDate } from '../pickers.js';
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
  const ctx0 = getCtx();
  if (!ctx0.fleet.length) { openNewFormSheet(); return; }
  openNewFormSheet();
}
function openNewFormSheet() {
  const st = S();
  openSheet({ title: 'New 5988-E worksheet', build: (b, api) => {
    const status = h('p', { class: 'hint', 'data-testid': 'nf-vin-status', role: 'status' }, 'Type or paste the VIN / serial number (any case, spaces ignored) and the worksheet fills in from the fleet record. Or choose the vehicle from the fleet list.');
    const go = h('button', { type: 'button', class: 'btn primary wide', 'data-testid': 'nf-vin-go', disabled: true }, 'Create worksheet');
    let match = null;
    const inp = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false', placeholder: 'VIN / serial number', 'data-testid': 'nf-vin', 'aria-label': 'VIN or serial number' });
    const upd = () => {
      const v = inp.value.trim(); match = v ? findByVin(getCtx().fleet, v) : null; go.disabled = !v;
      if (!v) { status.textContent = 'Type or paste the VIN / serial number (any case, spaces ignored) and the worksheet fills in from the fleet record. Or choose the vehicle from the fleet list.'; go.textContent = 'Create worksheet'; }
      else if (match) { const vw = vehicleView(match, getCtx()); status.textContent = `Fleet match: ${match.short} · ${vw.type} · ${match.model}. LIN, model, TM and the other header fields will be filled in.`; go.textContent = `Create 5988-E for ${match.short}`; }
      else { status.textContent = 'No fleet vehicle has that VIN. You can still make the worksheet and type the other fields by hand (a LIN cannot be worked out from a VIN alone).'; go.textContent = 'Create blank worksheet with this VIN'; }
    };
    inp.addEventListener('input', upd);
    go.addEventListener('click', () => { const v = inp.value.trim(); if (!v) return; api.close(); if (match) openFormEditorFor(match.key); else { const f = newForm(null, { settings: st.settings }); f.serial = v; st.forms.push(f); commit({ render: false }); openFormEditor(f.id, true); } });
    const pickFleet = h('button', { type: 'button', class: 'btn wide', 'data-testid': 'nf-fleet', onClick: async () => {
      const ctx = getCtx();
      const items = ctx.fleet.map((v) => ({ v, vw: vehicleView(v, ctx) })).filter((u) => u.vw.status !== 'TURNED IN').sort((a, c) => a.v.key.localeCompare(c.v.key, 'en', { numeric: true })).map((u) => ({ id: u.v.key, label: u.v.short, sub: `${u.vw.type} · ${u.v.model} · ${idLine(u.v) || 'no LIN / VIN'}`, badge: u.vw.status, thumb: thumbFor(u.v) }));
      if (!items.length) { toast('Import the fleet first (or type a VIN).', 'bad'); return; }
      const r = await pick({ title: 'Choose vehicle for 5988-E', items }); if (r) { api.close(); openFormEditorFor(r); }
    } }, 'Choose vehicle from the fleet list');
    b.append(field('VIN / serial number', inp), status, go, h('p', { class: 'hint' }, 'or'), pickFleet);
  } });
}
export function openFormEditorFor(key, link = {}) {
  const st = S(); const ctx = getCtx(); const v = ctx.fleetByKey.get(key); const vw = v ? vehicleView(v, ctx) : null;
  const f = newForm(v, { settings: st.settings, tmByType: st.tmByType, typeName: vw ? vw.type : '', tm: v ? tmFor(v, st, ctx) : null, link }); st.forms.push(f); commit({ render: false }); openFormEditor(f.id, true);
}
export function openFormEditor(id, isNew = false) {
  const st = S(); const f = st.forms.find((x) => x.id === id); if (!f) return; const original = JSON.stringify(f);
  openSheet({ title: `5988-E · ${f.adminNumber || 'vehicle'}`, tall: true, onClose: () => { if (isNew && !f.faults.length && JSON.stringify(f) === original) { st.forms = st.forms.filter((x) => x.id !== f.id); removeFaultPhotos(f.id).catch(() => {}); } commit(); },
    build: (b, api) => {
      const body = safeAppend(h('div', { class: 'form' })); b.append(body);
      let withPhotos = false; const pdfOpt = h('div', { class: 'pdf-opt', 'data-testid': 'form-pdf-opt' }); // "Include fault photos page": OFF every time the worksheet is opened
      const photoCount = () => f.faults.reduce((n, x) => n + faultPhotoCount(f.id, x.id), 0);
      const drawPdfOpt = () => {
        const n = photoCount(); if (!n) withPhotos = false; clear(pdfOpt);
        const cb = h('input', { type: 'checkbox', checked: withPhotos, disabled: !n, 'data-testid': 'form-pdf-photos', onChange: () => { withPhotos = cb.checked; } });
        pdfOpt.append(h('label', { class: 'toggle' }, cb, h('span', { class: 'tl' }, 'Include fault photos page', h('small', { class: 'hint' }, n ? `Adds page(s) after the worksheet with the ${n} fault photo${n === 1 ? '' : 's'} and a caption (fault number and description). Off by default; the 5988-E page itself is not changed.` : 'No fault photos yet. Add photos on a fault line first.'))));
      };
      const reg = {}; // inputs by field, so a VIN autofill can update them in place (no re-render: the keyboard stays up)
      const txt = (label, key, o = {}) => { const inp = h('input', { type: 'text', value: f[key] || '', autocomplete: 'off', autocapitalize: o.cap || 'characters', 'data-testid': 'F-' + key, onInput: (e) => { f[key] = e.target.value; f.updated = new Date().toISOString(); o.onInput && o.onInput(e.target.value); } }); reg[key] = inp; return field(label, inp, o.hint); };
      const setF = (key, val) => { f[key] = val; if (reg[key]) reg[key].value = val; };
      const vinStatus = h('p', { class: 'hint', 'data-testid': 'F-vin-status', role: 'status' }, ''); const linHint = h('div', { class: 'hint', 'data-testid': 'F-lin-hint' });
      const updLinHint = () => {
        clear(linHint); if (f.lin || !f.model) return; const sg = suggestLin(getCtx().fleet, f.model, st.settings, { exceptKey: f.vehicleKey });
        linHint.append(sg ? h('span', null, `No LIN yet. Other fleet vehicles of ${sg.basis} use `, h('b', { class: 'mono' }, sg.lin), ` (${sg.count}). A LIN cannot be derived from the VIN - confirm it. `, h('button', { type: 'button', class: 'btn small', 'data-testid': 'F-lin-suggest', onClick: () => { setF('lin', sg.lin); f.updated = new Date().toISOString(); updLinHint(); } }, 'Use ' + sg.lin)) : h('span', null, 'No LIN on file. A LIN cannot be derived from a VIN; type it from the data plate / GCSS.'));
      };
      const fillFromVehicle = (v, { overwrite }) => {
        const ctx = getCtx(); const hd = headerFromVehicle(v, ctx, st); const put = (k, val) => { if (overwrite || !f[k]) setF(k, val); };
        f.vehicleKey = hd.vehicleKey; f.vehicleId = hd.vehicleId; put('adminNumber', hd.adminNumber); put('lin', hd.lin); put('model', hd.model); put('noun', hd.noun); put('nsn', hd.nsn); put('registration', hd.registration);
        if (hd.serial) setF('serial', hd.serial);
        if (hd.uic && (overwrite || !effUic())) { f.uicOverride = true; f.uic = hd.uic; if (reg.uic) reg.uic.value = hd.uic; const hh = body.querySelector('[data-testid="F-uic-hint"]'); if (hh) hh.textContent = 'Changed for this form only.'; }
        if (hd.pubs && (overwrite || !f.pubs.some((p) => p.tm))) { f.pubs.forEach((p, i) => { const n = hd.pubs[i] || { tm: '', date: '', change: '' }; Object.assign(p, { tm: n.tm || '', date: n.date || '', change: n.change || '' }); for (const k of ['tm', 'date', 'change']) { const el = body.querySelector(`[data-testid="F-pub${i}-${k}"]`); if (el) el.value = p[k]; } }); }
        if (hd.pmcsRef && (overwrite || !f.pmcsRef)) f.pmcsRef = hd.pmcsRef;
        f.updated = new Date().toISOString(); updLinHint();
      };
      const onVin = (val) => {
        const v = val.trim(); if (!v) { vinStatus.textContent = ''; return; }
        const m = findByVin(getCtx().fleet, v);
        if (m) { const sameLink = m.key === f.vehicleKey; fillFromVehicle(m, { overwrite: !sameLink }); vinStatus.textContent = sameLink ? `VIN matches ${m.short} (this worksheet's vehicle); empty fields filled in.` : `VIN matched fleet vehicle ${m.short}: admin number, LIN, model, TM and UIC filled in.`; vinStatus.className = 'hint go'; }
        else { vinStatus.className = 'hint'; vinStatus.textContent = vinKey(v).length < 4 ? '' : 'No fleet vehicle has this VIN. Enter the other fields by hand (a LIN cannot be derived from a VIN).'; }
      };
      const effUic = () => formUic(f, st.settings);
      const uicField = () => {
        const inp = reg.uic = h('input', { type: 'text', value: effUic(), autocomplete: 'off', autocapitalize: 'characters', placeholder: st.settings.unitUic ? '' : 'set Unit UIC in Settings', 'data-testid': 'F-uic', onInput: (e) => { const v = e.target.value.trim(); f.updated = new Date().toISOString(); if (v === String(st.settings.unitUic || '').trim()) { f.uicOverride = false; f.uic = ''; } else { f.uicOverride = true; f.uic = v; } hint.textContent = hintText(); } });
        const hintText = () => (f.uicOverride ? 'Changed for this form only.' : st.settings.unitUic ? 'From Settings > Unit UIC.' : 'Blank: set the Unit UIC in More > Settings.');
        const hint = h('small', { class: 'hint', 'data-testid': 'F-uic-hint' }, hintText());
        return h('div', { class: 'field' }, h('label', null, h('span', { class: 'lbl' }, 'UIC'), inp), hint, f.uicOverride ? h('button', { type: 'button', class: 'btn small', 'data-testid': 'F-uic-reset', onClick: () => { f.uicOverride = false; f.uic = ''; draw(); } }, 'Use Settings UIC') : null);
      };
      const draw = () => {
        clear(body); const warns = validateForm(f, { settings: st.settings });
        body.append(h('div', { class: 'note', role: 'note' }, DISCLAIMER));
        body.append(h('h3', null, 'Equipment data'), h('div', { class: 'grid2' }, txt('Admin number', 'adminNumber'), txt('VIN / Serial', 'serial', { onInput: onVin }), txt('LIN', 'lin', { onInput: updLinHint }), txt('Equip model', 'model', { onInput: updLinHint }), txt('Registration', 'registration')), vinStatus, linHint, txt('Equip noun', 'noun'), txt('Equip NSN', 'nsn', { hint: 'Not in the GCSS export - type it if you want it on the form' }),
          h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Date'), h('button', { type: 'button', class: 'select-btn dt-btn', 'data-testid': 'F-date', 'data-value': f.date || '', onClick: async () => { const r = await pickDate({ title: 'Form date', value: f.date || '', allowClear: false }); if (r === undefined) return; f.date = r || f.date; draw(); } }, h('span', { class: 'val' }, f.date ? fmtDate(f.date) : 'Tap to set'))), uicField()),
          field('Type inspection', segmented(INSPECTION_TYPES.map(([c, n]) => [c, c, n]), f.typeInsp, (v) => { f.typeInsp = v; }, { label: 'Type of inspection', cls: 'wrapseg' })),
          h('div', { class: 'grid2' }, field('Reading type', segmented(READING_TYPES.map(([c, n]) => [c, c, n]), f.readingType, (v) => { f.readingType = v; }, { label: 'Reading type' })), txt('Current reading', 'reading', { hint: '' })));
        { const vv = getCtx().fleetByKey.get(f.vehicleKey); const r = vv ? tmFor(vv, st) : null;
          body.append(h('h3', null, 'Publications (TM number / date / change)'));
          if (r) body.append(h('p', { class: 'hint', 'data-testid': 'F-tm-note' }, r.resolved ? `Auto-filled from the vehicle's TM (${r.level.startsWith('builtin') ? 'built-in table' : 'your entry'}): ${r.label}. Check it against your manual; enter the date and change number from the TM itself.${r.pmcs && !/^TM\s[\w&-]+$/i.test(r.pmcs) ? ' PMCS: ' + r.pmcs : ''}` : 'TM not found - enter manually (or set it on the vehicle / model in Fleet).')); }
        f.pubs.forEach((p, i) => body.append(h('div', { class: 'grid3' }, ...['tm', 'date', 'change'].map((k) => field(k === 'tm' ? `TM ${i + 1}` : k === 'date' ? 'Date' : 'Change', h('input', { type: 'text', value: p[k] || '', autocomplete: 'off', autocapitalize: 'characters', 'data-testid': `F-pub${i}-${k}`, onInput: (e) => { p[k] = e.target.value; } }))))));
        const vwt = (getCtx().fleetByKey.get(f.vehicleKey) || null); const tname = vwt ? vehicleView(vwt, getCtx()).type : '';
        body.append(h('div', { class: 'row' }, f.pubs.length < 4 ? btn('+ Add TM line', () => { f.pubs.push({ tm: '', date: '', change: '' }); draw(); }, 'small') : null, f.model ? btn(`Save these TMs for model ${f.model}`, () => { const ps = f.pubs.filter((p) => p.tm); st.tmByModel[modelKey(f.model)] = { ...(st.tmByModel[modelKey(f.model)] || {}), tm10: (ps[0] || {}).tm || '', pmcs: (ps[1] || {}).tm || '' }; commit({ render: false }); toast('Saved for this model'); }, 'small', { 'data-testid': 'F-tm-remember' }) : null));
        body.append(h('h3', null, 'Inspector'), h('div', { class: 'grid2' }, txt("Inspector's LIC #", 'inspLic'), txt('Time', 'inspTime')), txt('Inspector name / rank (prints on SIGNATURE line - leave blank to sign by hand)', 'inspName', { cap: 'words' }), txt('Maintenance supervisor / designated rep (optional)', 'supName', { cap: 'words' }));
        body.append(h('h3', null, 'Add a fault: tap the status symbol'));
        const symRow = h('div', { class: 'symrow', role: 'group', 'aria-label': 'Add fault by status symbol' });
        for (const s of [...SYMBOLS, ...(st.settings.showEPrefix ? [LEGACY_SYMBOL] : [])]) symRow.append(h('button', { type: 'button', class: 'sym s-' + (s.code === '-' ? 'dash' : s.code === '/' ? 'diag' : s.code === 'CX' ? 'cx' : s.code === 'E' ? 'e' : 'x'), title: s.title, 'aria-label': 'Add ' + s.title, 'data-testid': 'add-' + s.code, onClick: () => openFaultSheet(f, null, s.code, draw) }, h('b', null, s.code === 'CX' ? 'X' : s.code === '-' ? '--' : s.code), h('small', null, s.code === 'CX' ? 'circled' : s.code === 'X' ? 'NMC' : s.code === '/' ? 'shortcoming' : s.code === '-' ? 'due' : 'legacy')));
        body.append(symRow, h('details', { class: 'legend' }, h('summary', null, 'What the symbols mean'), h('ul', null, SYMBOLS.map((s) => h('li', null, s.short)), h('li', null, 'Circled TM item number = the fault is in the TM "equipment not ready/available" (NMC) column.'), h('li', null, 'Last-name initial = satisfactory / corrected.'))));
        const sorted = sortFaults(f.faults);
        if (!sorted.length) body.append(h('p', { class: 'muted' }, 'No faults yet.'));
        sorted.forEach((x) => body.append(h('div', { class: 'fault-line', 'data-testid': 'fault-line', 'data-fault': x.id }, h('button', { type: 'button', class: 'faultrow', 'data-testid': 'fault-row', onClick: () => openFaultSheet(f, x, x.symbol, draw) }, h('span', { class: 'fnum' + (x.circleItem ? ' circ' : '') }, String(x.item).padStart(4, '0')), h('span', { class: 'fsym s-' + (x.symbol === '-' ? 'dash' : x.symbol === '/' ? 'diag' : x.symbol === 'CX' ? 'cx' : 'x') }, symbolText(x.symbol)), h('span', { class: 'fdesc' }, x.desc || '(no description)', x.action ? h('small', null, 'Action: ' + x.action) : null)), faultPhotoStrip(f, x, { onChange: drawPdfOpt }))));
        if (sorted.length) body.append(h('p', { class: 'hint', 'data-testid': 'fault-photo-help' }, FAULT_PHOTO_HELP), pdfOpt);
        drawPdfOpt();
        body.append(h('h3', null, 'Parts required (optional)'));
        f.parts.forEach((p, i) => body.append(h('button', { type: 'button', class: 'faultrow', onClick: () => openPartSheet(f, p, draw) }, h('span', { class: 'fnum' }, p.fault || '—'), h('span', { class: 'fdesc' }, `${p.noun || p.niin || 'part'} · ${p.doc || 'no doc #'}`))));
        body.append(btn('+ Add part line', () => openPartSheet(f, null, draw), 'small'));
        if (warns.length) body.append(h('div', { class: 'card warn', 'data-testid': 'form-warnings' }, h('b', null, 'Check before printing'), h('ul', null, warns.map((w) => h('li', null, w)))));
      };
      draw(); updLinHint();
      api.foot.append(
        h('button', { class: 'btn danger', type: 'button', 'data-testid': 'form-delete', onClick: async () => { const np = photoCount(); if (await confirmBox({ title: 'Delete worksheet?', message: 'This removes the saved worksheet from the app.' + (np ? ` Its ${np} fault photo${np === 1 ? '' : 's'} will be deleted too.` : ''), okText: 'Delete', danger: true })) { st.forms = st.forms.filter((x) => x.id !== f.id); isNew = false; commit(); await removeFaultPhotos(f.id); api.close(); } } }, 'Delete'),
        h('button', { class: 'btn', type: 'button', 'data-testid': 'form-save', onClick: () => { f.updated = new Date().toISOString(); commit(); toast('Worksheet saved'); } }, 'Save'),
        h('button', { class: 'btn primary', type: 'button', 'data-testid': 'form-pdf', onClick: async () => {
          f.updated = new Date().toISOString(); commit({ render: false });
          try { const faultPhotos = withPhotos ? await collectFaultPhotos(f) : null; const bytes = buildFormPdf(f, { unitName: st.settings.unitName, uic: formUic(f, st.settings), faultPhotos }); const r = await shareOrDownload(bytes, formFileName(f), 'application/pdf', { title: `DA Form 5988-E worksheet ${f.adminNumber || ''}`, text: 'Worksheet aid - not an official form.' });
            if (r.method === 'download') toast('PDF saved to Downloads / Files'); else if (r.method === 'share') toast('Shared'); window.__lastPdf = { size: bytes.length, name: formFileName(f), method: r.method, faultPhotos: faultPhotos ? faultPhotos.reduce((n, g) => n + g.images.length, 0) : 0 };
          } catch (e) { console.error(e); toast('Could not make the PDF: ' + e.message, 'bad'); }
        } }, 'Make PDF / share'));
    } });
}
/** the photos of each fault, in print order, as JPEG bytes: [{fault, images:[Uint8Array]}] */
async function collectFaultPhotos(form) {
  const out = [];
  for (const fault of sortFaults(form.faults)) {
    const images = []; for (const k of faultPhotoKeys(form.id, fault.id)) { try { const b = await getPhotoBlob(k, 'full'); if (b) images.push(new Uint8Array(await b.arrayBuffer())); } catch { /* skip an unreadable photo */ } }
    if (images.length) out.push({ fault, images });
  }
  return out;
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
      body.append(h('div', { class: 'grid2' }, field('TM item number', h('input', { type: 'text', value: d.item, autocapitalize: 'characters', autocomplete: 'off', 'data-testid': 'fl-item', onInput: (e) => { d.item = e.target.value.trim(); } }), 'Sorted by this number on the form (1, 2, 3a, 10).'), h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Fault date'), h('button', { type: 'button', class: 'select-btn dt-btn', 'data-testid': 'fl-date', 'data-value': d.date || '', onClick: async () => { const r = await pickDate({ title: 'Fault date', value: d.date || '', allowClear: false }); if (r === undefined) return; d.date = r || d.date; draw(); } }, h('span', { class: 'val' }, d.date ? fmtDate(d.date) : 'Tap to set')))));
      { const ki = knownItems(form.model, st); if (ki.length) body.append(btn('Pick a known TM item number', async () => { const r = await pick({ title: 'Known PMCS item numbers', items: ki.slice().sort((a, c) => compareItems(a.n, c.n)).map((k) => ({ id: k.n, label: k.n, sub: k.desc, badge: k.from === 'saved' ? 'saved' : 'used before' })), note: 'Item numbers you saved for this model or used on earlier worksheets.' }); if (r) { const k = ki.find((x) => x.n === r); d.item = k.n; if (!d.desc && k.desc) d.desc = k.desc; draw(); } }, 'small', { 'data-testid': 'fl-known' })); }
      body.append(toggle('Circle the item number (fault is in the TM "not ready / available" column)', !!d.circleItem, (v) => { d.circleItem = v; }));
      const desc = h('textarea', { rows: 3, value: d.desc, placeholder: 'Describe the fault', 'aria-label': 'Fault description', 'data-testid': 'fl-desc', onInput: (e) => { d.desc = e.target.value; } });
      body.append(field('Deficiency / shortcoming description', desc), btn('Pick from preset list', async () => {
        const items = st.presets.map((p) => ({ id: p.id, label: p.desc, badge: p.symbol === '-' ? '--' : p.symbol })); const r = await pick({ title: 'Fault presets', items, note: STARTER_PRESETS_LABEL + ' (suggested symbols only - the TM decides)' });
        if (r) { const p = st.presets.find((x) => x.id === r); d.desc = p.desc; if (isNew && d.symbol !== 'CX') { d.symbol = p.symbol; d.circleItem = p.symbol === 'X'; } draw(); }
      }, 'small', { 'data-testid': 'fl-preset' }));
      body.append(field('Corrective action', h('textarea', { rows: 2, value: d.action || '', 'data-testid': 'fl-action', onInput: (e) => { d.action = e.target.value; } })), h('div', { class: 'grid2' }, field('Oper hrs', h('input', { type: 'text', inputmode: 'decimal', value: d.hrs || '', onInput: (e) => { d.hrs = e.target.value; } })), field('LIC #', h('input', { type: 'text', value: d.lic || '', autocapitalize: 'characters', onInput: (e) => { d.lic = e.target.value; } }))));
    };
    draw();
    api.foot.append(!isNew ? h('button', { class: 'btn danger', type: 'button', 'data-testid': 'fl-delete', onClick: async () => { const np = faultPhotoCount(form.id, d.id); if (np && !(await confirmBox({ title: 'Delete fault?', message: `This fault and its ${np} photo${np === 1 ? '' : 's'} will be deleted.`, okText: 'Delete', danger: true }))) return; form.faults = form.faults.filter((x) => x.id !== d.id); form.updated = new Date().toISOString(); commit({ render: false }); await removeFaultPhotos(form.id, d.id); api.close(); done(); } }, 'Delete') : null, h('button', { class: 'btn', type: 'button', onClick: () => api.close() }, 'Cancel'),
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
