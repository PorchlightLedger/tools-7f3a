// Legacy Excel .xls reader (BIFF8, plus basic BIFF5): OLE2 / CFB container + Workbook stream. Offline, no dependencies, no DOM.
// Cells -> strings (numbers as JS numbers rendered like the .xlsx reader's raw values). readXls(bytes) -> [{name, rows:[[string]]}]
export const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
export const isOle2 = (b) => b && b.length >= 8 && OLE_MAGIC.every((m, i) => b[i] === m);
export class XlsError extends Error { constructor(msg, code) { super(msg); this.code = code || 'xls'; } }
const PASSWORD_MSG = 'This Excel file is password-protected. Open it in Excel, remove the password (Save As without a password), or save it as .csv, then import again.';

// ---------- OLE2 compound file ----------
function u16(b, o) { return b[o] | (b[o + 1] << 8); }
function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
const ENDOFCHAIN = 0xfffffffe, FREESECT = 0xffffffff;

export function parseCfb(bytes) {
  if (!isOle2(bytes) || bytes.length < 512) throw new XlsError('Not an OLE2 (legacy Office) file.');
  const ssz = 1 << u16(bytes, 0x1e), mssz = 1 << u16(bytes, 0x20);
  if (ssz !== 512 && ssz !== 4096) throw new XlsError('Unsupported or damaged Excel file (sector size).');
  const secOff = (n) => (n + 1) * ssz; const nSec = Math.max(0, Math.floor((bytes.length - ssz) / ssz) + 1);
  const sector = (n) => { const o = secOff(n); if (o >= bytes.length) throw new XlsError('Damaged Excel file (sector beyond end of file).'); return bytes.subarray(o, Math.min(o + ssz, bytes.length)); };
  // FAT sector list (header DIFAT + DIFAT chain)
  const difat = []; for (let i = 0; i < 109; i++) { const v = u32(bytes, 0x4c + i * 4); if (v !== FREESECT) difat.push(v); }
  let dn = u32(bytes, 0x44), guard = 0;
  while (dn !== ENDOFCHAIN && dn !== FREESECT && guard++ < 100000) { const s = sector(dn); for (let i = 0; i < ssz / 4 - 1; i++) { const v = u32(s, i * 4); if (v !== FREESECT) difat.push(v); } dn = u32(s, ssz - 4); }
  const fat = []; for (const fs of difat) { if (secOff(fs) >= bytes.length) continue; const s = sector(fs); for (let i = 0; i + 4 <= s.length; i += 4) fat.push(u32(s, i)); }
  const chain = (start, table, max) => { const out = []; let n = start, g = 0; while (n !== ENDOFCHAIN && n !== FREESECT && n < table.length && g++ <= max) out.push(n), (n = table[n]); return out; };
  const readChain = (start) => { const secs = chain(start, fat, nSec + 8); const out = new Uint8Array(secs.length * ssz); let o = 0; for (const s of secs) { const d = sector(s); out.set(d, o); o += d.length; } return out.subarray(0, o); };
  // directory
  const dir = readChain(u32(bytes, 0x30)); const entries = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const nl = Math.min(u16(dir, o + 0x40), 64); const type = dir[o + 0x42]; if (!type) continue;
    let name = ''; for (let i = 0; i + 2 <= nl - 2; i += 2) name += String.fromCharCode(u16(dir, o + i));
    entries.push({ name, type, start: u32(dir, o + 0x74), size: u32(dir, o + 0x78) });
  }
  const root = entries.find((e) => e.type === 5);
  let mini = null, miniFat = null;
  const ensureMini = () => {
    if (mini) return; if (!root) throw new XlsError('Damaged Excel file (no root entry).');
    mini = readChain(root.start); const mf = readChain(u32(bytes, 0x3c)); miniFat = []; for (let i = 0; i + 4 <= mf.length; i += 4) miniFat.push(u32(mf, i));
  };
  const cutoff = u32(bytes, 0x38) || 4096;
  const stream = (e) => {
    if (e.size < cutoff) {
      ensureMini(); const secs = chain(e.start, miniFat, e.size / mssz + 8); const out = new Uint8Array(secs.length * mssz); let o = 0;
      for (const s of secs) { const d = mini.subarray(s * mssz, s * mssz + mssz); out.set(d, o); o += d.length; } return out.subarray(0, Math.min(o, e.size));
    }
    return readChain(e.start).subarray(0, e.size);
  };
  return { entries, stream, find: (n) => entries.find((e) => e.type === 2 && e.name.toLowerCase() === n.toLowerCase()) };
}

// ---------- BIFF ----------
let cp1252; try { cp1252 = new TextDecoder('windows-1252'); } catch { cp1252 = null; }
const latin = (b) => (cp1252 ? cp1252.decode(b) : String.fromCharCode(...b));
const utf16 = (b) => { let s = ''; for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode(b[i] | (b[i + 1] << 8)); return s; };
const f64 = (b, o) => new DataView(b.buffer, b.byteOffset + o, 8).getFloat64(0, true);
function rk(v) {
  let n; if (v & 2) n = v >> 2; else { const d = new DataView(new ArrayBuffer(8)); d.setUint32(4, (v & 0xfffffffc) >>> 0, true); n = d.getFloat64(0, true); }
  return v & 1 ? n / 100 : n;
}
const numStr = (n) => (Number.isFinite(n) ? String(n) : '');
const ERR = { 0: '#NULL!', 7: '#DIV/0!', 15: '#VALUE!', 23: '#REF!', 29: '#NAME?', 36: '#NUM!', 42: '#N/A' };

/** Reads BIFF8 unicode strings possibly spread over several CONTINUE chunks. chunks: Uint8Array[] */
class Chunked {
  constructor(chunks) { this.c = chunks; this.i = 0; this.p = 0; }
  get left() { return this.c[this.i].length - this.p; }
  next() { if (this.i + 1 >= this.c.length) throw new XlsError('Damaged Excel file (string table truncated).'); this.i++; this.p = 0; }
  byte() { while (this.left <= 0) this.next(); return this.c[this.i][this.p++]; }
  u16() { const a = this.byte(); return a | (this.byte() << 8); }
  u32() { const a = this.u16(); return (a | (this.u16() << 16)) >>> 0; }
  skip(n) { while (n > 0) { if (this.left <= 0) { this.next(); continue; } const t = Math.min(n, this.left); this.p += t; n -= t; } }
  atEnd() { return this.i >= this.c.length - 1 && this.left <= 0; }
  /** string with cch given; header flags read here. hasLen16: reads the u16 length itself. */
  ustring(cch) {
    if (cch == null) cch = this.u16();
    const flags = this.byte(); let hi = flags & 1; const runs = flags & 8 ? this.u16() : 0; const ext = flags & 4 ? this.u32() : 0;
    let out = '', remaining = cch;
    while (remaining > 0) {
      if (this.left <= 0) { this.next(); hi = this.byte() & 1; continue; } // new chunk starts with a fresh high-byte flag
      const per = hi ? 2 : 1; const n = Math.min(remaining, Math.floor(this.left / per)); if (n === 0) { this.next(); hi = this.byte() & 1; continue; }
      const sl = this.c[this.i].subarray(this.p, this.p + n * per); out += hi ? utf16(sl) : latin(sl); this.p += n * per; remaining -= n;
    }
    this.skip(runs * 4 + ext); return out;
  }
}

/** Splits a BIFF stream from offset into records, merging CONTINUE (0x3C) into the preceding record's chunks. */
function* records(s, start) {
  let o = start, cur = null;
  while (o + 4 <= s.length) {
    const id = u16(s, o), len = u16(s, o + 2); const d = s.subarray(o + 4, Math.min(o + 4 + len, s.length)); o += 4 + len;
    if (id === 0x3c && cur) { cur.chunks.push(d); continue; }
    if (cur) yield cur; cur = { id, chunks: [d], get data() { return this.chunks[0]; } };
  }
  if (cur) yield cur;
}

export function readXlsStream(s) {
  const first = u16(s, 0); if (first !== 0x0809 && first !== 0x0009 && first !== 0x0209 && first !== 0x0409) throw new XlsError('Not an Excel workbook stream.');
  const ver = u16(s, 4); const biff8 = ver >= 0x0600;
  const sheetsMeta = []; let sst = []; let codepage = 1252;
  // globals
  let depth = 0;
  for (const r of records(s, 0)) {
    const d = r.data;
    if (r.id === 0x0809 || r.id === 0x0009 || r.id === 0x0209 || r.id === 0x0409) { depth++; continue; }
    if (r.id === 0x000a) { depth--; if (depth <= 0) break; continue; }
    if (r.id === 0x002f) throw new XlsError(PASSWORD_MSG, 'password');
    if (r.id === 0x0042) codepage = u16(d, 0);
    if (r.id === 0x0085) {
      const off = u32(d, 0), type = d[5]; const cch = d[6]; let name;
      if (biff8) { const hi = d[7] & 1; name = hi ? utf16(d.subarray(8, 8 + cch * 2)) : latin(d.subarray(8, 8 + cch)); } else name = latin(d.subarray(7, 7 + cch));
      sheetsMeta.push({ off, type, name });
    }
    if (r.id === 0x00fc && biff8) {
      const c = new Chunked(r.chunks); c.skip(4); const uniq = c.u32(); sst = [];
      try { for (let i = 0; i < uniq; i++) sst.push(c.ustring()); } catch (e) { if (!(e instanceof XlsError)) throw e; if (!sst.length) throw e; }
    }
  }
  const out = [];
  for (const sm of sheetsMeta) {
    if (sm.type !== 0) continue; if (sm.off >= s.length) continue;
    const grid = []; const put = (r, c, v) => { if (r > 65535 || c > 255) return; (grid[r] || (grid[r] = []))[c] = v; };
    let dep = 0, pend = null; const strAt = (r) => { const c = new Chunked(r.chunks); return biff8 ? c.ustring() : latin(r.data.subarray(2, 2 + u16(r.data, 0))); };
    for (const r of records(s, sm.off)) {
      const d = r.data;
      if (r.id === 0x0809 || r.id === 0x0009 || r.id === 0x0209 || r.id === 0x0409) { dep++; continue; }
      if (r.id === 0x000a) { dep--; if (dep <= 0) break; continue; }
      if (dep !== 1) continue; if (r.id !== 0x0207 && d.length < 6) continue;
      switch (r.id) {
        case 0x00fd: { const i = u32(d, 6); put(u16(d, 0), u16(d, 2), sst[i] ?? ''); break; }
        case 0x0204: case 0x00d6: { const c = new Chunked(r.chunks); c.skip(6); put(u16(d, 0), u16(d, 2), biff8 ? c.ustring() : latin(d.subarray(8, 8 + u16(d, 6)))); break; }
        case 0x0203: put(u16(d, 0), u16(d, 2), numStr(f64(d, 6))); break;
        case 0x027e: put(u16(d, 0), u16(d, 2), numStr(rk(u32(d, 6)))); break;
        case 0x00bd: { const row = u16(d, 0), c0 = u16(d, 2); const n = Math.floor((d.length - 6) / 6); for (let k = 0; k < n; k++) put(row, c0 + k, numStr(rk(u32(d, 6 + k * 6)))); break; }
        case 0x0205: put(u16(d, 0), u16(d, 2), d[7] ? (ERR[d[6]] || '#ERR') : d[6] ? 'TRUE' : 'FALSE'); break;
        case 0x0006: {
          const row = u16(d, 0), col = u16(d, 2);
          if (u16(d, 12) === 0xffff) { const t = d[6]; if (t === 0) pend = [row, col]; else if (t === 1) put(row, col, d[8] ? 'TRUE' : 'FALSE'); else if (t === 2) put(row, col, ERR[d[8]] || '#ERR'); else put(row, col, ''); }
          else put(row, col, numStr(f64(d, 6)));
          break;
        }
        case 0x0207: if (pend) { put(pend[0], pend[1], biff8 ? new Chunked(r.chunks).ustring() : latin(d.subarray(2, 2 + u16(d, 0)))); pend = null; } break;
        default: break;
      }
    }
    const rows = []; for (let r = 0; r < grid.length; r++) { const row = grid[r] || []; const o = []; for (let c = 0; c < row.length; c++) o.push(row[c] ?? ''); rows.push(o); }
    out.push({ name: sm.name, rows });
  }
  return out;
}

/** bytes (Uint8Array of a .xls file) -> [{name, rows}] */
export function readXls(bytes) {
  const cfb = parseCfb(bytes);
  const wb = cfb.find('Workbook') || cfb.find('Book');
  if (!wb) {
    if (cfb.find('EncryptedPackage') || cfb.find('EncryptionInfo')) throw new XlsError(PASSWORD_MSG, 'password');
    throw new XlsError('That file is a Microsoft Office file but not an Excel workbook (no Workbook stream).');
  }
  return readXlsStream(cfb.stream(wb));
}
