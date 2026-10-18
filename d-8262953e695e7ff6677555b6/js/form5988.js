// DA Form 5988-E worksheet: data model + PDF layout.
// The 5988-E is an electronically generated (EGA) Army form printed by GCSS-Army (monospaced text blocks: EQUIPMENT DATA /
// PARTS REQUIRED / MAINTENANCE FAULTS). APD publishes no blank PDF for it, so this layout follows public training
// material of the printed form. This is a WORKSHEET AID. It does NOT replace the official form / GCSS-Army record.
import { PdfDoc, jpegSize, pdfSafe } from './pdf.js';
import { fmtDate, parseDateLoose, todayISO, MONTHS, uid, pad, sortFaults } from './util.js';
import { vehIds } from './rules.js';
import { tmPubs } from './tmdata.js';

export const SYMBOLS = [
  { code: 'X', label: 'X', title: 'X - deficiency that places the equipment in an inoperable status (NMC)', short: 'X = deficiency: equipment inoperable (NMC)' },
  { code: 'CX', label: 'X (circled)', title: 'Circled X - may be operated under specific limitations (commander / designated rep only)', short: 'Circled X = may be operated under specific limitations directed by higher authority / locally, until corrected. Only the commander or designated representative may circle an X' },
  { code: '/', label: '/', title: 'Diagonal - shortcoming: material defect other than a deficiency; correct to make the item completely serviceable', short: '/ (diagonal) = shortcoming: material defect that is not a deficiency but must be corrected to make the item completely serviceable' },
  { code: '-', label: '--', title: 'Dash - a required inspection / component replacement / check / test is due but not done, or an overdue MWO', short: '-- (horizontal dash) = required inspection, replacement, check or test is due but not accomplished, or overdue MWO' },
];
export const LEGACY_SYMBOL = { code: 'E', label: 'E', title: 'E - safety deadline (appears in ULLS-era 5988-E training slides; verify before use)', short: 'E = safety deadline (legacy ULLS-era training material; verify)' };
export const INSPECTION_TYPES = [['B', 'Before'], ['D', 'During'], ['A', 'After'], ['W', 'Weekly'], ['M', 'Monthly'], ['Q', 'Quarterly'], ['S', 'Semi-annual']];
export const READING_TYPES = [['M', 'Miles'], ['H', 'Hours'], ['K', 'Kilometers'], ['R', 'Rounds']];
export const symbolText = (c) => (c === '-' ? '--' : c === 'CX' ? 'X' : c);
export const CIRCLED_X_PREFIX = 'CLEARED FOR LIMITED OPERATIONS - ';

/** UIC printed on the form: the per-form override when set, otherwise the Settings "Unit UIC" (so a unit move updates every form without an override). */
export function formUic(form, settings = {}) { return form.uicOverride ? String(form.uic || '').trim() : String(settings.unitUic || '').trim(); }
export function newForm(vehicle, { settings = {}, tmByType = {}, typeName = '', tm = null, now = new Date(), link = {} } = {}) {
  const tms = (tmByType && typeName && tmByType[typeName]) || [];
  const ids = vehicle ? vehIds(vehicle) : { vin: '', lin: '' };
  const auto = tm && tm.resolved ? tmPubs(tm, 2) : null;
  // the vehicle's own UIC (GCSS column) fills the form when it differs from the Settings UIC (a per-form override; Settings stays the default)
  const vUic = vehicle ? String(vehicle.uic || '').trim() : ''; const sUic = String((settings && settings.unitUic) || '').trim(); const uicOv = !!vUic && vUic !== sUic;
  return {
    id: uid('f'), sv: 2, vehicleKey: vehicle ? vehicle.key : '', vehicleId: vehicle ? vehicle.vid || '' : '', tripId: link.tripId || '', entryId: link.entryId || '', date: todayISO(now), uic: uicOv ? vUic : '', uicOverride: uicOv, adminNumber: vehicle ? vehicle.short || vehicle.bumper : '', serial: ids.vin, lin: ids.lin,
    model: vehicle ? vehicle.model || '' : '', registration: vehicle ? vehicle.registration || '' : '', noun: vehicle ? vehicle.desc || '' : '', nsn: vehicle ? vehicle.nsn || '' : '',
    typeInsp: 'B', readingType: 'M', reading: '', pmcsRef: tm && tm.resolved && tm.pmcs ? tm.pmcs : '',
    pubs: auto || [0, 1].map((i) => ({ tm: (tms[i] && tms[i].tm) || '', date: (tms[i] && tms[i].date) || '', change: (tms[i] && tms[i].change) || '' })),
    inspLic: '', inspTime: '', inspName: '', inspTime2: '', supName: '',
    faults: [], parts: [], created: now.toISOString(), updated: now.toISOString(),
  };
}
export function newFault(form, symbol = '/', desc = '') {
  const nums = form.faults.map((f) => parseInt(f.item, 10)).filter((n) => !isNaN(n)); const next = nums.length ? Math.max(...nums) + 1 : 1;
  return { id: uid('x'), item: String(next), date: form.date || todayISO(), symbol, desc, action: symbol === 'CX' ? CIRCLED_X_PREFIX : '', hrs: '', lic: '', circleItem: symbol === 'X' };
}
export function newPart() { return { id: uid('p'), fault: '', doc: '', niin: '', noun: '', qtyDue: '', qtyRec: '', status: '', date: '', comp: '', pri: '', dlc: '' }; }
/** does the form carry an NMC-level fault (X / circled X)? */
export function formHasNMC(form) { return form.faults.some((f) => f.symbol === 'X' || f.symbol === 'CX'); }
export function formDateText(iso) { return fmtDate(iso); }
function dd(iso) { const d = parseDateLoose(iso); if (!d) return ''; const [y, m, day] = d.split('-'); return `${day}-${MONTHS[+m - 1]}-${y.slice(2)}`; }

// ---- text fitting (PDF) ----
const FS_NORMAL = 9, FS_MIN = 6, MAX_FIT_LINES = 4;
/** a value on one line: newlines / tabs become spaces, WinAnsi-safe characters only */
export const oneLine = (v) => pdfSafe(String(v ?? '').replace(/[\r\n\t\u2028\u2029]+/g, ' '));
/** fit one value into `w` columns of 9 pt Courier: as is when it fits; else a smaller font (not below FS_MIN) so it still fits one line; else wrapped at FS_MIN
 *  (at most MAX_FIT_LINES lines, the last one ends in "..." if there is still more). Returns { size, lines }. */
export function fitText(value, w) {
  const s = oneLine(value); if (s.length <= w) return { size: FS_NORMAL, lines: [s] };
  const cap = Math.floor(w * FS_NORMAL / FS_MIN);
  if (s.length <= cap) return { size: Math.floor((FS_NORMAL * w / s.length) * 100) / 100, lines: [s] };
  let lines = wrap(s, cap); // (wrap also collapses runs of spaces)
  if (lines.length > MAX_FIT_LINES) { lines = lines.slice(0, MAX_FIT_LINES); const l = lines[MAX_FIT_LINES - 1]; lines[MAX_FIT_LINES - 1] = l.slice(0, Math.max(0, cap - 3)) + '...'; }
  return { size: FS_MIN, lines };
}
// widths (columns) the PDF gives each field before it has to shrink / wrap, and the widths where text is simply cut off
const FIT_W = { adminNumber: 35, noun: 35, tm: 51, partNoun: 14 };
const CUT_W = { model: 24, registration: 30, serial: 30, nsn: 24, lin: 24, change: 10, pubDate: 10, pmcsRef: 90 };
function lengthWarnings(form) {
  const w = []; const len = (v) => oneLine(v).length;
  const fit = (label, v, max) => { const n = len(v); if (n > max) w.push(`${label} is ${n} characters long: the PDF prints it in smaller type${n > Math.floor(max * FS_NORMAL / FS_MIN) ? ' and wraps it' : ''}.`); };
  const cut = (label, v, max) => { const n = len(v); if (n > max) w.push(`${label} is ${n} characters long: only the first ${max} fit on the PDF.`); };
  fit('Admin number', form.adminNumber, FIT_W.adminNumber); fit('Equipment noun', form.noun, FIT_W.noun);
  (form.pubs || []).forEach((p, i) => { fit(`TM ${i + 1} number`, p.tm, FIT_W.tm); cut(`TM ${i + 1} change`, p.change, CUT_W.change); });
  cut('Model', form.model, CUT_W.model); cut('Registration', form.registration, CUT_W.registration); cut('VIN / serial', form.serial, CUT_W.serial); cut('NSN', form.nsn, CUT_W.nsn);
  (form.parts || []).forEach((p, i) => fit(`Part ${i + 1} noun`, p.noun, FIT_W.partNoun));
  for (const f of form.faults || []) if (String(f.desc || '').length > 600) w.push(`Item ${f.item || '?'}: the fault description is ${String(f.desc).length} characters; it prints over several lines (and may continue on the next page).`);
  if (/[\n\r]/.test([form.adminNumber, form.noun, ...(form.pubs || []).map((p) => p.tm), ...(form.parts || []).map((p) => p.noun)].join(''))) w.push('A one-line field contains a line break; the PDF prints it as a space.');
  return w;
}
export function validateForm(form, { settings = {} } = {}) {
  const w = [];
  if (!formUic(form, settings)) w.push('No UIC (set the Unit UIC in More > Settings, or type one for this form).');
  if (!form.adminNumber) w.push('No vehicle / admin number.');
  if (!form.pubs.some((p) => p.tm)) w.push('No TM publication entered (TM number and date go in the EQUIPMENT DATA block).');
  w.push(...lengthWarnings(form));
  const seen = new Map();
  for (const f of form.faults) {
    if (!f.desc) w.push(`Item ${f.item || '?'}: no fault description.`);
    if (!f.item) w.push('A fault has no item number.');
    if (f.symbol === 'CX' && !/limit/i.test(f.action)) w.push(`Item ${f.item}: circled X normally carries a limitation in the corrective action (e.g. "CLEARED FOR LIMITED OPERATIONS - ...").`);
    seen.set(f.item, (seen.get(f.item) || 0) + 1);
  }
  for (const [k, n] of seen) if (n > 1 && k) w.push(`Item number ${k} is used ${n} times.`);
  return w;
}
function wrap(text, n) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' '); const lines = []; let cur = '';
  for (let w of words) {
    while (w.length > n) { if (cur) { lines.push(cur); cur = ''; } lines.push(w.slice(0, n)); w = w.slice(n); }
    if (!w) continue;
    if (!cur) cur = w; else if ((cur + ' ' + w).length <= n) cur += ' ' + w; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur); return lines.length ? lines : [''];
}
const COLS = 100; // characters per line at 9pt Courier = 540pt
export const FORM_FOOTER = 'Worksheet aid - not an official form. Verify against the TM and GCSS-Army. Layout follows public descriptions of DA Form 5988-E.';

/** fault photo attachment pages. groups = [{fault, images:[Uint8Array JPEG | null]}] in print order. Appended AFTER the unchanged 5988-E page(s); returns the number of photo pages added. */
function faultPhotoPages(pdf, form, groups, { unitName, uicText, page0, footer }) {
  const LM = 36, CW = 540, GAP = 12, BW = (CW - 2 * GAP) / 3, BH = 178, TOP = 78, BOTTOM = 745; let page = page0, y = TOP, added = 0;
  const head = () => {
    pdf.addPage(); page++; added++;
    pdf.text(LM, 40, 'DA FORM 5988-E WORKSHEET - FAULT PHOTOS', { font: 'helvBold', size: 12 }); { const dt = `Date: ${fmtDate(form.date) || ''}`; pdf.text(LM + CW - dt.length * 4.4, 40, dt, { font: 'helv', size: 8 }); }
    pdf.text(LM, 54, [`Admin number: ${form.adminNumber || '-'}`, form.serial ? `VIN / serial: ${form.serial}` : '', unitName ? String(unitName).slice(0, 40) : '', uicText ? `UIC: ${uicText}` : ''].filter(Boolean).join('   '), { font: 'helv', size: 8 });
    pdf.text(LM, 65, 'Photos attached for reference. The worksheet pages before this are unchanged. Photos stay on the phone unless you share this PDF.', { font: 'helv', size: 7, color: [0.35, 0.35, 0.35] });
    y = TOP;
  };
  for (const g of groups) {
    const f = g.fault; const imgs = (g.images || []).slice(0, 3); if (!imgs.length) continue;
    const itemTxt = /^\d+$/.test(String(f.item || '')) ? String(f.item).padStart(4, '0').slice(-4) : String(f.item || '').slice(0, 7);
    let d = wrap(f.desc || '(no description)', 105); if (d.length > 3) { d = d.slice(0, 3); d[2] = d[2].slice(0, 102) + '...'; }
    const need = 14 + d.length * 10 + 6 + BH + 22;
    if (!added || y + need > BOTTOM) { if (added) footer(page); head(); }
    pdf.text(LM, y + 9, `FAULT ${itemTxt}   STATUS ${symbolText(f.symbol)}   ${fmtDate(f.date) || ''}`, { font: 'helvBold', size: 9 }); y += 14;
    for (const ln of d) { pdf.text(LM, y + 8, ln, { font: 'helv', size: 8.5 }); y += 10; }
    y += 6;
    imgs.forEach((jpeg, i) => {
      const x = LM + i * (BW + GAP); const dim = jpeg ? jpegSize(jpeg) : null; let ok = false, hh = 40;
      if (dim) { const sc = Math.min(BW / dim.w, BH / dim.h); const w = dim.w * sc; hh = dim.h * sc; ok = pdf.image(x, y, w, hh, jpeg); if (ok) pdf.rect(x, y, w, hh, { lw: 0.5 }); else hh = 40; }
      if (!ok) { pdf.rect(x, y, BW, 40, { lw: 0.5 }); pdf.text(x + 6, y + 24, '(photo unavailable)', { font: 'helv', size: 8 }); }
      pdf.text(x, y + hh + 9, `Fault ${itemTxt} - photo ${i + 1} of ${imgs.length}`, { font: 'helv', size: 7 });
    });
    y += BH + 22;
  }
  if (added) footer(page); return added;
}
export function buildFormPdf(form, { unitName = '', uic = null, now = new Date(), faultPhotos = null } = {}) {
  const uicText = uic === null ? String(form.uic || '').trim() : String(uic || '').trim();
  const FS = 9, CW = FS * 0.6, LH = 11.5, X0 = (612 - COLS * CW) / 2; // centred
  const pdf = new PdfDoc({ title: `DA Form 5988-E worksheet ${form.adminNumber || ''}` });
  let y = 0, page = 1;
  const T = (col, str, o = {}) => pdf.text(X0 + col * CW, y, str, { size: FS, font: o.bold ? 'courierBold' : 'courier' });
  const center = (str, o = {}) => T(Math.max(0, Math.floor((COLS - str.length) / 2)), str, o);
  const right = (str, o = {}) => T(COLS - str.length, str, o);
  const section = (name) => { const dash = COLS - name.length; const l = Math.floor(dash / 2); T(0, '-'.repeat(l) + name + '-'.repeat(dash - l), { bold: true }); };
  const footer = () => { pdf.text(36, 770, FORM_FOOTER, { font: 'helv', size: 6.5, color: [0.35, 0.35, 0.35] }); pdf.text(540, 770, `Page ${page}`, { font: 'helv', size: 6.5, color: [0.35, 0.35, 0.35] }); };
  const top = () => {
    y = 48; T(0, `Date: ${fmtDate(form.date) || ''}`); center('EQUIPMENT MAINTENANCE AND INSPECTION WORKSHEET', { bold: true }); right(`DA FORM 5988-E`, { bold: true }); y += LH;
    T(0, unitName ? unitName.slice(0, 40) : ''); right(uicText ? `UIC: ${uicText}` : 'UIC: ________'); y += LH * 1.4;
  };
  const mk = (cells) => { let line = ''; for (const [col, str] of cells) { line = line.padEnd(col) + str; } return line; };
  const FC = { item: 0, date: 5, st: 16, desc: 23, act: 56, hrs: 86, lic: 92 }; const DW = 32, AW = 29;
  const faultHeader = () => {
    section('MAINTENANCE FAULTS'); y += LH;
    T(0, mk([[FC.item, 'ITEM'], [FC.date, 'FAULT'], [FC.st, 'FAULT'], [FC.desc, 'FAULT'], [FC.act, 'CORRECTIVE'], [FC.hrs, 'OPER']]), { bold: true }); y += LH;
    T(0, mk([[FC.item, 'NUM'], [FC.date, 'DATE'], [FC.st, 'STATUS'], [FC.desc, 'DESCRIPTION'], [FC.act, 'ACTION'], [FC.hrs, 'HRS'], [FC.lic, 'LIC#']]), { bold: true }); y += LH;
  };
  const newPage = () => { footer(); pdf.addPage(); page++; top(); faultHeader(); };
  top();
  // EQUIPMENT DATA
  section('EQUIPMENT DATA'); y += LH * 1.2;
  const kv = (col, label, val, w) => T(col, `${label}: ${String(val || '').slice(0, w)}`);
  // a value that may be longer than its column: normal length prints exactly as before; longer is shrunk, then wrapped (extra lines are returned)
  const TS = (col, str, size) => pdf.text(X0 + col * CW, y, str, { size, font: 'courier' });
  const kvFit = (col, label, val, w) => {
    const fit = fitText(val, w); if (fit.size === FS && fit.lines.length === 1) { T(col, `${label}: ${fit.lines[0]}`); return 0; }
    T(col, `${label}: `); const vc = col + label.length + 2; const y0 = y; fit.lines.forEach((ln, i) => { y = y0 + i * LH; TS(vc, ln, fit.size); }); y = y0; return fit.lines.length - 1;
  };
  const row = (extra) => { y += LH * (1 + extra); };
  let ex = kvFit(0, 'ADMIN NUMBER', form.adminNumber, FIT_W.adminNumber); kv(50, 'VIN / SERIAL NUM', form.serial, 30); row(ex);
  kv(0, 'EQUIP MODEL', form.model, 24); kv(50, 'REGISTRATION', form.registration, 30); y += LH;
  ex = kvFit(0, 'EQUIP NOUN', form.noun, FIT_W.noun); kv(50, 'TYPE INSP', form.typeInsp, 4); row(ex);
  kv(0, 'EQUIP NSN', form.nsn, 24); kv(50, 'CURRENT READING', `${form.readingType || ''} ${form.reading || ''}`.trim(), 30); y += LH;
  kv(0, 'LIN', form.lin, 24); y += LH * 1.6;
  T(34, 'NUMBER', { bold: true }); T(66, 'DATE', { bold: true }); T(78, 'CHANGE NUMBER', { bold: true }); y += LH;
  const pubs = form.pubs.filter((p) => p.tm || p.date || p.change); const pubRows = pubs.length ? pubs : [{ tm: '', date: '', change: '' }];
  for (const p of pubRows) {
    const fit = fitText(p.tm, FIT_W.tm); T(0, 'PUBLICATION:'); TS(14, fit.lines[0], fit.size); T(66, String(p.date || '').slice(0, 10)); T(80, String(p.change || '').slice(0, 10)); y += LH;
    for (const ln of fit.lines.slice(1)) { TS(14, ln, fit.size); y += LH; }
  }
  if (form.pmcsRef) { T(0, ('PMCS REF: ' + form.pmcsRef).slice(0, 100)); y += LH; }
  y += LH * 0.6;
  T(0, `INSPECTORS LIC #: ${form.inspLic ? form.inspLic : '________'}  TIME: ${form.inspTime ? form.inspTime : '____'}  SIGNATURE: ${form.inspName ? form.inspName.slice(0, 28) : '______________________'}  TIME: ${form.inspTime2 ? form.inspTime2 : '____'}`); y += LH * 1.8;
  // PARTS REQUIRED
  section('PARTS REQUIRED'); y += LH;
  const PC = { fault: 0, doc: 6, niin: 20, noun: 31, due: 46, rec: 52, st: 58, date: 65, comp: 72, pri: 79, dlc: 84 };
  T(0, mk([[PC.due, 'QTY'], [PC.rec, 'QTY']]), { bold: true }); y += LH;
  T(0, mk([[PC.fault, 'FAULT'], [PC.doc, 'DOC NUM'], [PC.niin, 'NIIN'], [PC.noun, 'NOUN'], [PC.due, 'DUE'], [PC.rec, 'REC'], [PC.st, 'STATUS'], [PC.date, 'DATE'], [PC.comp, 'COMP'], [PC.pri, 'PRI'], [PC.dlc, 'DLC']]), { bold: true }); y += LH;
  if (!form.parts.length) { T(0, '(none entered)'); y += LH; }
  for (const p of form.parts) {
    const nf = fitText(p.noun, FIT_W.partNoun); const plain = nf.size === FS && nf.lines.length === 1;
    if (y + nf.lines.length * LH > 735) { footer(); pdf.addPage(); page++; top(); section('PARTS REQUIRED (continued)'); y += LH * 1.2; }
    T(0, mk([[PC.fault, String(p.fault || '').slice(0, 5)], [PC.doc, String(p.doc || '').slice(0, 13)], [PC.niin, String(p.niin || '').slice(0, 10)], [PC.noun, plain ? nf.lines[0] : ''], [PC.due, String(p.qtyDue || '').slice(0, 5)], [PC.rec, String(p.qtyRec || '').slice(0, 5)], [PC.st, String(p.status || '').slice(0, 6)], [PC.date, String(p.date || '').slice(0, 6)], [PC.comp, String(p.comp || '').slice(0, 6)], [PC.pri, String(p.pri || '').slice(0, 3)], [PC.dlc, String(p.dlc || '').slice(0, 3)]]));
    if (!plain) nf.lines.forEach((ln, i) => { const y0 = y; y = y0 + i * LH; TS(PC.noun, ln, nf.size); y = y0; });
    y += LH * (plain ? 1 : nf.lines.length);
  }
  y += LH * 0.8;
  faultHeader();
  const need = (lines) => { if (y + lines * LH > 735) newPage(); };
  if (!form.faults.length) { T(0, '(no faults entered)'); y += LH; }
  const sorted = sortFaults(form.faults);
  for (const f of sorted) {
    const d = wrap(oneLine(f.desc), DW), a = wrap(oneLine(f.action || ''), AW); const n = Math.max(d.length, a.length);
    const PAGE_LINES = Math.floor((735 - 48 - LH * 7) / LH); // lines one page can hold under the repeated headers
    const split = n > PAGE_LINES; if (!split) need(n + 0.4); else need(3);
    const itemTxt = /^\d+$/.test(String(f.item || '')) ? String(f.item).padStart(4, '0').slice(-4) : String(f.item || '').slice(0, 7);
    T(FC.item, itemTxt); T(FC.date, dd(f.date)); T(FC.st + 2, symbolText(f.symbol), { bold: true });
    if (f.circleItem) pdf.ellipse(X0 + (FC.item + 2) * CW, y - 3.3, 2.5 * CW, 7.2, 0.7); // circled TM item number: fault is in the TM "not ready/available" column
    if (f.symbol === 'CX') pdf.circle(X0 + (FC.st + 2.5) * CW, y - 3, 6.5, 0.9);
    for (let i = 0; i < n; i++) {
      if (split && i && y + LH > 735) { newPage(); T(FC.item, itemTxt); T(FC.date, '(cont.)'); } // a very long description continues on the next page instead of running off the sheet
      if (d[i]) T(FC.desc, d[i]); if (a[i]) T(FC.act, a[i]);
      if (i === 0) { if (f.hrs) T(FC.hrs, String(f.hrs).slice(0, 5)); if (f.lic) T(FC.lic, String(f.lic).slice(0, 10)); }
      y += LH;
    }
    y += LH * 0.25;
  }
  // legend
  need(9); y += LH * 0.6; pdf.dashedLine(X0, y - 8, X0 + COLS * CW, y - 8, 0.5); 
  pdf.text(X0, y, 'STATUS SYMBOLS (per DA Form 2404 / 5988-E instructions):', { font: 'helvBold', size: 7 }); y += 9;
  for (const s of SYMBOLS) { for (const ln of wrap(s.short, 150)) { pdf.text(X0, y, ln, { font: 'helv', size: 7 }); y += 8.5; } }
  pdf.text(X0, y, 'Circled TM item number = fault listed in the TM "equipment not ready/available" (NMC) column. Last-name initial = satisfactory / corrected.', { font: 'helv', size: 7 }); y += 8.5;
  pdf.text(X0, y, form.supName ? `MAINTENANCE SUPERVISOR / DESIGNATED REP (circled X / status change): ${form.supName}` : 'MAINTENANCE SUPERVISOR / DESIGNATED REP (circled X / status change): ______________________________', { font: 'helv', size: 7 }); y += 8.5;
  footer();
  // optional: fault photos on extra page(s) AFTER the unchanged 5988-E page(s)
  if (faultPhotos && faultPhotos.some((g) => g.images && g.images.some(Boolean))) faultPhotoPages(pdf, form, faultPhotos.map((g) => ({ ...g, images: (g.images || []).filter(Boolean) })), { unitName, uicText, page0: page, footer: (n) => { pdf.text(36, 770, FORM_FOOTER, { font: 'helv', size: 6.5, color: [0.35, 0.35, 0.35] }); pdf.text(540, 770, `Page ${n}`, { font: 'helv', size: 6.5, color: [0.35, 0.35, 0.35] }); } });
  return pdf.save();
}
export function formFileName(form) { return `5988-E_worksheet_${String(form.adminNumber || 'vehicle').replace(/[^A-Za-z0-9]+/g, '')}_${(form.date || '').replace(/-/g, '')}.pdf`; }
