// Tolerant CSV / TSV / pasted-text parser and CSV writer
export function detectDelimiter(text) {
  // quote-aware: count candidate delimiters per logical line over the first ~6000 characters
  const sample = text.slice(0, 6000); const cands = ['\t', ',', ';', '|']; const per = cands.map(() => [0]); let q = false;
  for (const ch of sample) {
    if (ch === '"') { q = !q; continue; }
    if (q) continue;
    if (ch === '\n') { if (per[0].length < 10) per.forEach((a) => a.push(0)); continue; }
    const i = cands.indexOf(ch); if (i >= 0) per[i][per[i].length - 1]++;
  }
  let best = ',', bs = -1;
  cands.forEach((d, i) => { const counts = per[i].filter((_, k) => k < per[i].length); const nz = counts.filter((n) => n > 0); const min = nz.length ? Math.min(...nz) : 0; const s = min * 100 + counts.reduce((a, b) => a + b, 0); if (s > bs) { bs = s; best = d; } });
  return best;
}
export function parseDelimited(text, delimiter) {
  if (text == null) return [];
  text = String(text).replace(/^\uFEFF/, '');
  const d = delimiter || detectDelimiter(text);
  const rows = []; let row = [], cell = '', q = false, i = 0; const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i += 2; continue; } q = false; i++; continue; }
      cell += ch; i++; continue;
    }
    if (ch === '"' && cell === '') { q = true; i++; continue; }
    if (ch === d) { row.push(cell); cell = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
    cell += ch; i++;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}
const needsQuote = /[",\r\n]|^\s|\s$/;
export function toCSV(rows) {
  return rows.map((r) => r.map((c) => {
    let s = c == null ? '' : String(c);
    if (/^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s; // neutralise spreadsheet formulas
    return needsQuote.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n') + '\r\n';
}
