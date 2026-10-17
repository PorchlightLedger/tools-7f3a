// Minimal .xlsx writer (OOXML, inline strings, store-only zip). Opens in Excel, Numbers, LibreOffice, Sheets.
import { zipStore } from './zip.js';
import { dayNum } from './util.js';

const esc = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function colName(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - m) / 26); } return s; }

// style ids (cellXfs order below)
export const ST = { normal: 0, header: 1, date: 2, wrap: 3, go: 4, warn: 5, nogo: 6, title: 7, note: 8, muted: 9 };
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="dd\\-mmm\\-yyyy"/></numFmts>
<fonts count="5"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF595959"/><name val="Calibri"/></font></fonts>
<fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1F3864"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFC6EFCE"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFEB9C"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFC7CE"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="10">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="5" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** cell: string | number | boolean | null | {v, s?:styleKey, type?:'date'|'text'} */
function cellXml(ref, cell) {
  if (cell === null || cell === undefined || cell === '') return '';
  let v = cell, s = null, type = null;
  if (typeof cell === 'object' && !(cell instanceof Date)) { v = cell.v; s = cell.s; type = cell.type; }
  if (v === null || v === undefined || v === '') return s ? `<c r="${ref}" s="${ST[s] ?? 0}"/>` : '';
  const sa = s ? ` s="${ST[s] ?? 0}"` : '';
  if (type === 'date') {
    const n = dayNum(v);
    if (!isNaN(n)) return `<c r="${ref}" s="${ST.date}"><v>${n + 25569}</v></c>`;
    return `<c r="${ref}"${sa} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  }
  const sTop = sa || ` s="${ST.wrap}"`; // numbers / booleans: top-aligned like the text cells beside them
  if (typeof v === 'number' && isFinite(v) && type !== 'text') return `<c r="${ref}"${sTop}><v>${v}</v></c>`;
  if (typeof v === 'boolean') return `<c r="${ref}"${sTop} t="b"><v>${v ? 1 : 0}</v></c>`;
  let str = String(v);
  if (/^[=+@]/.test(str)) str = "'" + str; // never let imported text turn into a formula
  return `<c r="${ref}"${sa} t="inlineStr"><is><t xml:space="preserve">${esc(str)}</t></is></c>`;
}
/** wrap estimate: number of lines `text` needs in a column `width` characters wide (greedy word wrap, honours newlines) */
export function wrapLines(text, width) {
  const lim = Math.max(1, Math.floor(width - 1)); let total = 0;
  for (const para of String(text ?? '').split(/\r?\n/)) {
    let lines = 1, cur = 0;
    for (let w of para.split(/\s+/).filter(Boolean)) {
      while (w.length > lim) { if (cur) { lines++; cur = 0; } w = w.slice(lim); if (w.length) { lines++; cur = 0; } }
      if (!cur) cur = w.length; else if (cur + 1 + w.length <= lim) cur += 1 + w.length; else { lines++; cur = w.length; }
    }
    total += lines;
  }
  return Math.max(1, total);
}
const cellText = (c) => (c === null || c === undefined ? '' : typeof c === 'object' && !(c instanceof Date) ? (c.type === 'date' ? '31-Dec-2026' : String(c.v ?? '')) : String(c));
/** Auto layout: column widths from content (capped by sh.cols[i], which then acts as the max width), wrap style on plain text cells,
 *  explicit row heights from the estimated line counts (Excel does not auto-fit rows of generated files on open). */
export function layoutSheet(sh) {
  const rows = sh.rows || []; let maxC = 0; rows.forEach((r) => { if (r.length > maxC) maxC = r.length; });
  const hdr = sh.headerRow ?? 0; const caps = sh.cols || []; const widths = [];
  for (let c = 0; c < maxC; c++) {
    const cap = caps[c] || 30; let w = 0;
    rows.forEach((r, ri) => { const t = cellText(r[c]); if (!t) return; if (ri === hdr) { const lw = Math.max(...t.split(/\s+/).map((x) => x.length)); w = Math.max(w, Math.min(lw + 2, cap)); } else { const m = Math.max(...t.split(/\r?\n/).map((x) => x.length)); w = Math.max(w, m * 1.05 + 2); } });
    widths.push(Math.round(Math.min(cap, Math.max(6, w)) * 10) / 10);
  }
  const heights = rows.map((r, ri) => { let lines = 1; for (let c = 0; c < r.length; c++) { const t = cellText(r[c]); if (t) lines = Math.max(lines, wrapLines(t, widths[c])); } return lines <= 1 ? null : Math.min(409, Math.round((lines * 15 + 2) * 10) / 10); });
  const wrapped = rows.map((r, ri) => r.map((c) => { if (ri === hdr || c === '' || c === null || c === undefined) return c; if (typeof c === 'string') return { v: c, s: 'wrap', type: 'text' }; if (typeof c === 'object' && !c.s && !c.type && typeof c.v === 'string') return { ...c, s: 'wrap' }; return c; }));
  return { rows: wrapped, widths, heights };
}
export function sheetXml(sh0) {
  const lay = sh0.autosize ? layoutSheet(sh0) : null;
  const sh = lay ? { ...sh0, rows: lay.rows, cols: lay.widths } : sh0; const heights = lay ? lay.heights : [];
  const rows = sh.rows || []; let maxC = 0; rows.forEach((r) => { if (r.length > maxC) maxC = r.length; });
  const hdrRow = sh.headerRow ?? 0; // index of header row (or -1)
  let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
  if (sh.autosize) x += '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>';
  x += `<dimension ref="A1:${colName(Math.max(0, maxC - 1))}${Math.max(1, rows.length)}"/>`;
  x += '<sheetViews><sheetView workbookViewId="0"' + (sh.tabSelected ? ' tabSelected="1"' : '') + '>';
  if (sh.freeze !== false && hdrRow >= 0) x += `<pane ySplit="${hdrRow + 1}" topLeftCell="A${hdrRow + 2}" activePane="bottomLeft" state="frozen"/>`;
  x += '</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>';
  if (sh.cols && sh.cols.length) x += '<cols>' + sh.cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>';
  x += '<sheetData>';
  rows.forEach((r, ri) => {
    x += heights[ri] ? `<row r="${ri + 1}" ht="${heights[ri]}" customHeight="1">` : `<row r="${ri + 1}">`;
    r.forEach((c, ci) => {
      let cc = c;
      if (ri === hdrRow && c !== null && c !== undefined && c !== '') cc = { v: typeof c === 'object' ? c.v : c, s: 'header', type: 'text' };
      x += cellXml(colName(ci) + (ri + 1), cc);
    });
    x += '</row>';
  });
  x += '</sheetData>';
  if (sh.autofilter !== false && hdrRow >= 0 && rows.length > hdrRow + 1 && maxC > 0) x += `<autoFilter ref="A${hdrRow + 1}:${colName(maxC - 1)}${rows.length}"/>`;
  if (sh.validations && sh.validations.length) x += `<dataValidations count="${sh.validations.length}">` + sh.validations.map((v) => `<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorTitle="Not an option" error="${esc(v.error || 'Pick one of the listed values')}" sqref="${v.sqref}"><formula1>${esc('"' + v.list.join(',') + '"')}</formula1></dataValidation>`).join('') + '</dataValidations>';
  x += '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup orientation="landscape"' + (sh.autosize ? ' fitToWidth="1"' : '') + ' fitToHeight="0"/>';
  x += '</worksheet>';
  return x.replace('<sheetFormatPr', sh.fitWidth === false ? '<sheetFormatPr' : '<sheetFormatPr');
}
export function cleanSheetName(n, used) {
  let s = String(n || 'Sheet').replace(/[\[\]:*?\/\\]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31) || 'Sheet';
  let base = s, i = 2; while (used.has(s.toLowerCase())) { s = base.slice(0, 28) + ' ' + i++; }
  used.add(s.toLowerCase()); return s;
}
/** sheets: [{name, rows, cols?, headerRow?}] -> Uint8Array (.xlsx) */
export function buildXlsx(sheets, meta = {}) {
  const used = new Set(); const names = sheets.map((s) => cleanSheetName(s.name, used));
  const files = [];
  files.push({ name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>` });
  files.push({ name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>' });
  const iso = (meta.created || new Date()).toISOString().replace(/\.\d+Z$/, 'Z');
  files.push({ name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(meta.title || 'Dispatch export')}</dc:title><dc:creator>Dispatch app (offline)</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created></cp:coreProperties>` });
  files.push({ name: 'docProps/app.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Dispatch app</Application></Properties>' });
  files.push({ name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` });
  files.push({ name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` });
  files.push({ name: 'xl/styles.xml', data: STYLES });
  sheets.forEach((s, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml({ ...s, tabSelected: i === 0 }) }));
  return zipStore(files, meta.created || new Date());
}
