// Content-sniffing table reader for imports. Decides by magic bytes / content, NOT by file name or MIME type (iOS often gives neither).
// readTable(bytes) -> {kind:'xls'|'xlsx'|'html'|'spreadsheetml'|'text', sheets:[{name,rows}]} (kind 'text': sheets is empty and .text holds the decoded text)
import { readXlsx } from './xlsxread.js';
import { readXls, isOle2, XlsError } from './xlsread.js';

const PASSWORD_MSG = 'This Excel file is password-protected. Open it in Excel, remove the password (Save As without a password), or save it as .csv, then import again.';
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"' };
export const unent = (s) => s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, g) => { if (g[0] === '#') { const n = g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : +g.slice(1); try { return String.fromCodePoint(n); } catch { return ''; } } return ENT[g.toLowerCase()] ?? m; });

export function decodeText(bytes) {
  let b = bytes;
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  const probe = b.subarray(0, 400); let zeros = 0; for (const x of probe) if (x === 0) zeros++;
  if (probe.length > 4 && zeros > probe.length / 4) return new TextDecoder(probe[0] === 0 ? 'utf-16be' : 'utf-16le').decode(b);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b).replace(/^\uFEFF/, ''); } catch { try { return new TextDecoder('windows-1252').decode(b); } catch { return new TextDecoder().decode(b); } }
}
function looksBinary(bytes) { const n = Math.min(bytes.length, 2000); let bad = 0; for (let i = 0; i < n; i++) { const x = bytes[i]; if (x === 0 || (x < 9) || (x > 13 && x < 32 && x !== 27)) bad++; } return n > 0 && bad / n > 0.02; }

/** HTML tables -> sheets (regex based; works without a DOM). */
export function parseHtmlTables(html) {
  const sheets = []; const tre = /<table\b[\s\S]*?<\/table>/gi; let tm, k = 0;
  while ((tm = tre.exec(html))) {
    k++; const rows = []; const rre = /<tr\b[^>]*>([\s\S]*?)(?=<tr\b|<\/tr>|<\/table>)/gi; let rm;
    while ((rm = rre.exec(tm[0]))) {
      const row = []; const cre = /<t([dh])\b([^>]*)>([\s\S]*?)(?=<t[dh]\b|<\/t[dh]>|<\/tr>|$)/gi; let cm;
      while ((cm = cre.exec(rm[1]))) {
        const txt = unent(cm[3].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
        row.push(txt); const span = /colspan\s*=\s*["']?(\d+)/i.exec(cm[2]); if (span) for (let i = 1; i < Math.min(+span[1], 50); i++) row.push('');
      }
      rows.push(row);
    }
    if (rows.length) sheets.push({ name: 'Table ' + k, rows });
  }
  return sheets;
}
/** Excel 2003 XML (SpreadsheetML) -> sheets */
export function parseSpreadsheetML(xml) {
  const sheets = []; const wre = /<(?:\w+:)?Worksheet\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?Worksheet>/gi; let wm;
  while ((wm = wre.exec(xml))) {
    const nm = /(?:\w+:)?Name\s*=\s*"([^"]*)"/i.exec(wm[1]); const rows = []; const rre = /<(?:\w+:)?Row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?Row>)/gi; let rm;
    while ((rm = rre.exec(wm[2]))) {
      const ri = /(?:\w+:)?Index\s*=\s*"(\d+)"/i.exec(rm[1]); if (ri) while (rows.length < +ri[1] - 1) rows.push([]);
      const row = []; const cre = /<(?:\w+:)?Cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?Cell>)/gi; let cm;
      while ((cm = cre.exec(rm[2] || ''))) {
        const ci = /(?:\w+:)?Index\s*=\s*"(\d+)"/i.exec(cm[1]); if (ci) while (row.length < +ci[1] - 1) row.push('');
        const d = /<(?:\w+:)?Data\b[^>]*>([\s\S]*?)<\/(?:\w+:)?Data>/i.exec(cm[2] || ''); row.push(d ? unent(d[1].replace(/<[^>]*>/g, '')) : '');
        const ma = /(?:\w+:)?MergeAcross\s*=\s*"(\d+)"/i.exec(cm[1]); if (ma) for (let i = 0; i < Math.min(+ma[1], 50); i++) row.push('');
      }
      rows.push(row);
    }
    sheets.push({ name: nm ? unent(nm[1]) : 'Sheet', rows });
  }
  return sheets;
}

export async function readTable(bytes) {
  if (!bytes || !bytes.length) throw new Error('That file is empty.');
  if (isOle2(bytes)) {
    try { return { kind: 'xls', sheets: readXls(bytes) }; } catch (e) { if (e instanceof XlsError) throw new Error(e.message); throw new Error('Could not read that Excel (.xls) file - it may be damaged. Save it as .csv or .xlsx from Excel and try again.'); }
  }
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    try { return { kind: 'xlsx', sheets: await readXlsx(bytes) }; } catch (e) { throw new Error('That looks like a zip file but not an Excel .xlsx workbook (' + (e.message || e) + ').'); }
  }
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) throw new Error('That is a PDF, not a spreadsheet. Export the list from GCSS-Army as Excel or CSV.');
  if (looksBinary(bytes)) {
    const probe = bytes.subarray(0, 400); let zeros = 0; for (const x of probe) if (x === 0) zeros++;
    const utf16 = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff) || (probe.length > 4 && zeros > probe.length / 4);
    if (!utf16) throw new Error('That file is not a spreadsheet or text file this app can read (.xls, .xlsx, .csv, .txt).');
  }
  const text = decodeText(bytes); const head = text.slice(0, 4000).trimStart().toLowerCase();
  if (head.startsWith('<?xml') || head.startsWith('<workbook') || head.includes('urn:schemas-microsoft-com:office:spreadsheet')) {
    if (/<(\w+:)?workbook\b/i.test(text) && /<(\w+:)?worksheet\b/i.test(text)) { const sheets = parseSpreadsheetML(text); if (sheets.length) return { kind: 'spreadsheetml', sheets }; }
    throw new Error('That XML file is not an Excel 2003 XML spreadsheet. Export as Excel or CSV instead.');
  }
  if (head.startsWith('<') && /<(html|table|!doctype|body|head|meta)\b/.test(head.slice(0, 4000)) || /<table\b/i.test(text.slice(0, 20000))) {
    const sheets = parseHtmlTables(text); if (sheets.length) return { kind: 'html', sheets };
    throw new Error('That file is a web page without a table in it (often a sign-in page or error page saved as .xls). Export the list from GCSS-Army again.');
  }
  return { kind: 'text', sheets: [], text };
}
export { PASSWORD_MSG };
