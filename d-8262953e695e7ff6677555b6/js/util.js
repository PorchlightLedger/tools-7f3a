// Small shared helpers (no DOM, runs in browser and node)
export const pad = (n, w = 2) => String(n).padStart(w, '0');
export const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
export function nowHHMM(now = new Date()) { return `${pad(now.getHours())}${pad(now.getMinutes())}`; }

function validYMD(y, m, d) {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
export const isoFromYMD = (y, m, d) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

/** Parse many date spellings to ISO yyyy-mm-dd; returns null when it cannot be read. */
export function parseDateLoose(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date && !isNaN(v)) return todayISO(v);
  let s = String(v).trim();
  if (!s) return null;
  let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s))) return validYMD(+m[1], +m[2], +m[3]) ? isoFromYMD(+m[1], +m[2], +m[3]) : null;
  if ((m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(s))) return validYMD(+m[1], +m[2], +m[3]) ? isoFromYMD(+m[1], +m[2], +m[3]) : null;
  if ((m = /^(\d{1,2})[\/.](\d{1,2})[\/.](\d{2}|\d{4})(?:\s.*)?$/.exec(s))) {
    let y = +m[3]; if (m[3].length === 2) y += y >= 70 ? 1900 : 2000;
    return validYMD(y, +m[1], +m[2]) ? isoFromYMD(y, +m[1], +m[2]) : null; // US order: month/day/year
  }
  if ((m = /^(\d{1,2})[ \-]?([A-Za-z]{3})[A-Za-z]*[ \-,]*(\d{2}|\d{4})$/.exec(s))) {
    const mi = MONTHS.indexOf(m[2].toUpperCase()) + 1; let y = +m[3]; if (m[3].length === 2) y += y >= 70 ? 1900 : 2000;
    return mi && validYMD(y, mi, +m[1]) ? isoFromYMD(y, mi, +m[1]) : null;
  }
  if ((m = /^([A-Za-z]{3})[A-Za-z]*\.? (\d{1,2}),? (\d{4})$/.exec(s))) {
    const mi = MONTHS.indexOf(m[1].toUpperCase()) + 1;
    return mi && validYMD(+m[3], mi, +m[2]) ? isoFromYMD(+m[3], mi, +m[2]) : null;
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) { // Excel serial date
    const n = Math.floor(+s);
    if (n >= 20000 && n <= 80000) { const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000); return isoFromYMD(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
  }
  if (/^\d{8}$/.test(s)) { const y = +s.slice(0, 4), mo = +s.slice(4, 6), d = +s.slice(6); if (validYMD(y, mo, d)) return isoFromYMD(y, mo, d); }
  return null;
}
export function dayNum(iso) { // days since 1970-01-01 (UTC math: DST safe)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); if (!m) return NaN;
  return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000);
}
export const daysBetween = (aISO, bISO) => dayNum(bISO) - dayNum(aISO); // b - a
export function addDays(iso, n) { const d = new Date((dayNum(iso) + n) * 86400000); return isoFromYMD(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
/** 17-OCT-2026 style */
export function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); if (!m) return iso || '';
  return `${m[3]}-${MONTHS[+m[2] - 1]}-${m[1]}`;
}
export function fmtDateShort(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); if (!m) return iso || '';
  return `${m[3]}-${MONTHS[+m[2] - 1]}`;
}
/** accept "0630", "6:30", "06:30", "630" -> "0630" ; invalid -> null ; '' -> '' */
export function normTime(v) {
  if (v === null || v === undefined) return '';
  const s = String(v).trim(); if (!s) return '';
  let m = /^(\d{1,2}):?(\d{2})$/.exec(s);
  if (!m && /^\d{3,4}$/.test(s)) m = /^(\d{1,2})(\d{2})$/.exec(s);
  if (!m) return null;
  const h = +m[1], mi = +m[2]; if (h > 23 || mi > 59) return null;
  return pad(h) + pad(mi);
}
export const timeForInput = (t) => (t && t.length === 4 ? `${t.slice(0, 2)}:${t.slice(2)}` : '');
export function fmtTime(t) { return t && t.length === 4 ? t : ''; }

let _uid = 0;
export function uid(prefix = 'id') {
  _uid = (_uid + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${_uid.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}
export const clean = (s) => String(s ?? '').replace(/[\u00a0\u200b]/g, ' ').trim();
export const normKeyText = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
export function truthyMark(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return ['x', 'y', 'yes', 'true', '1', '✓', '✔', 'qual', 'q'].includes(s);
}
export function toArrayBufferView(x) { return x instanceof Uint8Array ? x : new Uint8Array(x); }
export function safeFilePart(s) { return String(s || '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'file'; }
export function stampForFile(now = new Date()) { return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`; }
