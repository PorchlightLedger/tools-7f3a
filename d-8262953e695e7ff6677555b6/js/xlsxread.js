// Tiny .xlsx reader: first-class goal is GCSS-Army / roster exports saved as .xlsx. No DOM needed.
import { unzipIndex } from './zip.js';

const dec = new TextDecoder();
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
function colIndex(ref) { const m = /^([A-Z]+)/.exec(ref); let n = 0; for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }
function textOf(xml) { // concatenates all <t> (handles rich text), ignores phonetic <rPh>
  xml = xml.replace(/<rPh[\s\S]*?<\/rPh>/g, '');
  let out = ''; const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g; let m; while ((m = re.exec(xml))) out += m[1];
  return unesc(out);
}
function parseShared(xml) { const out = []; const re = /<si>([\s\S]*?)<\/si>|<si\/>/g; let m; while ((m = re.exec(xml))) out.push(m[1] ? textOf(m[1]) : ''); return out; }
function parseSheet(xml, shared) {
  const rows = []; const rre = /<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g; let rm; let rowNo = 0;
  while ((rm = rre.exec(xml))) {
    rowNo++; const rn = /\br="(\d+)"/.exec(rm[0].slice(0, rm[0].indexOf('>') + 1)); const target = rn ? +rn[1] - 1 : rowNo - 1;
    while (rows.length < target) rows.push([]);
    const row = []; const body = rm[1] || '';
    const cre = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g; let cm;
    while ((cm = cre.exec(body))) {
      const attrs = cm[1], inner = cm[2] || ''; const ref = /\br="([A-Z]+\d+)"/.exec(attrs); const t = /\bt="(\w+)"/.exec(attrs);
      const ci = ref ? colIndex(ref[1]) : row.length; let val = '';
      if (t && t[1] === 'inlineStr') val = textOf(inner);
      else { const v = /<v>([\s\S]*?)<\/v>/.exec(inner); if (v) { const raw = unesc(v[1]); val = t && t[1] === 's' ? (shared[+raw] ?? '') : t && t[1] === 'b' ? (raw === '1' ? 'TRUE' : 'FALSE') : raw; } }
      while (row.length < ci) row.push(''); row[ci] = val;
    }
    rows.push(row);
  }
  return rows;
}
/** -> [{name, rows:[[string]]}] */
export async function readXlsx(bytes) {
  const idx = unzipIndex(bytes); const get = async (n) => { const f = idx.get(n); return f ? dec.decode(await f()) : null; };
  const wbXml = await get('xl/workbook.xml'); if (!wbXml) throw new Error('Not an Excel .xlsx workbook (xl/workbook.xml missing).');
  const relsXml = (await get('xl/_rels/workbook.xml.rels')) || '';
  const rels = {}; for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) { const id = /\bId="([^"]+)"/.exec(m[0]); const tg = /\bTarget="([^"]+)"/.exec(m[0]); if (id && tg) rels[id[1]] = tg[1]; }
  const sharedXml = await get('xl/sharedStrings.xml'); const shared = sharedXml ? parseShared(sharedXml) : [];
  const sheets = [];
  for (const m of wbXml.matchAll(/<sheet\b[^>]*>/g)) {
    const name = /\bname="([^"]*)"/.exec(m[0]); const rid = /\br:id="([^"]+)"/.exec(m[0]); if (!rid) continue;
    let target = rels[rid[1]]; if (!target) continue; target = target.replace(/^\//, ''); const path = target.startsWith('xl/') ? target : 'xl/' + target;
    const sx = await get(path); if (sx == null) continue;
    sheets.push({ name: unesc(name ? name[1] : 'Sheet'), rows: parseSheet(sx, shared) });
  }
  return sheets;
}
