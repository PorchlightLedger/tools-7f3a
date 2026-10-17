// Minimal PDF 1.4 writer: standard-14 fonts (WinAnsi), text, lines, rects, circles. Letter portrait by default.
const FONTS = { courier: 'F1', courierBold: 'F2', helv: 'F3', helvBold: 'F4' };
const BASE = { F1: 'Courier', F2: 'Courier-Bold', F3: 'Helvetica', F4: 'Helvetica-Bold' };
const MAP = { '\u2013': '-', '\u2014': '-', '\u2018': "'", '\u2019': "'", '\u201c': '"', '\u201d': '"', '\u2022': '*', '\u2026': '...', '\u00a0': ' ', '\u2192': '->', '\u2713': 'v', '\u2715': 'x' };
function pdfStr(s) {
  let o = '';
  for (const ch of String(s ?? '')) {
    let c = MAP[ch] ?? ch; const code = c.charCodeAt(0);
    if (c.length > 1) { o += c; continue; }
    if (code < 32 || code > 255) c = '?';
    if (c === '(' || c === ')' || c === '\\') o += '\\' + c; else o += c;
  }
  return '(' + o + ')';
}
const f2 = (n) => (Math.round(n * 100) / 100).toString();
export class PdfDoc {
  constructor({ width = 612, height = 792, title = 'Document' } = {}) { this.W = width; this.H = height; this.title = title; this.pages = []; this.cur = null; this.addPage(); }
  addPage() { this.cur = []; this.pages.push(this.cur); return this; }
  // y is measured from the TOP of the page (more natural for forms)
  text(x, y, str, { font = 'courier', size = 9, color = null } = {}) {
    const f = FONTS[font] || 'F1'; const col = color ? `${color.map(f2).join(' ')} rg ` : '0 g ';
    this.cur.push(`BT ${col}/${f} ${f2(size)} Tf ${f2(x)} ${f2(this.H - y)} Td ${pdfStr(str)} Tj ET`); return this;
  }
  line(x1, y1, x2, y2, w = 0.5) { this.cur.push(`${f2(w)} w ${f2(x1)} ${f2(this.H - y1)} m ${f2(x2)} ${f2(this.H - y2)} l S`); return this; }
  rect(x, y, w, h, { lw = 0.5, fill = null } = {}) {
    if (fill) this.cur.push(`${fill.map(f2).join(' ')} rg ${f2(x)} ${f2(this.H - y - h)} ${f2(w)} ${f2(h)} re f 0 g`);
    if (lw) this.cur.push(`${f2(lw)} w ${f2(x)} ${f2(this.H - y - h)} ${f2(w)} ${f2(h)} re S`); return this;
  }
  circle(cx, cy, r, lw = 0.8) { return this.ellipse(cx, cy, r, r, lw); }
  ellipse(cx, cy, rx, ry, lw = 0.8) {
    const kx = 0.5523 * rx, ky = 0.5523 * ry, X = cx, Y = this.H - cy;
    this.cur.push(`${f2(lw)} w ${f2(X + rx)} ${f2(Y)} m ${f2(X + rx)} ${f2(Y + ky)} ${f2(X + kx)} ${f2(Y + ry)} ${f2(X)} ${f2(Y + ry)} c ${f2(X - kx)} ${f2(Y + ry)} ${f2(X - rx)} ${f2(Y + ky)} ${f2(X - rx)} ${f2(Y)} c ${f2(X - rx)} ${f2(Y - ky)} ${f2(X - kx)} ${f2(Y - ry)} ${f2(X)} ${f2(Y - ry)} c ${f2(X + kx)} ${f2(Y - ry)} ${f2(X + rx)} ${f2(Y - ky)} ${f2(X + rx)} ${f2(Y)} c S`); return this;
  }
  dashedLine(x1, y1, x2, y2, w = 0.5, on = 2, off = 2) { this.cur.push(`[${on} ${off}] 0 d`); this.line(x1, y1, x2, y2, w); this.cur.push('[] 0 d'); return this; }
  save() {
    const objs = []; const add = (s) => { objs.push(s); return objs.length; };
    const catalog = add(''), pages = add('');
    const fontIds = {}; for (const k of Object.keys(BASE)) fontIds[k] = add(`<< /Type /Font /Subtype /Type1 /BaseFont /${BASE[k]} /Encoding /WinAnsiEncoding >>`);
    const res = `<< /Font << ${Object.keys(BASE).map((k) => `/${k} ${fontIds[k]} 0 R`).join(' ')} >> >>`;
    const kids = [];
    this.pages.forEach((ops) => {
      const content = ops.join('\n'); const cid = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${this.W} ${this.H}] /Resources ${res} /Contents ${cid} 0 R >>`));
    });
    const info = add(`<< /Title ${pdfStr(this.title)} /Producer (Dispatch app offline PDF writer) /Creator (Dispatch app) >>`);
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pages} 0 R >>`;
    objs[pages - 1] = `<< /Type /Pages /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
    let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'; const offs = [];
    objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const u8 = new Uint8Array(out.length); for (let i = 0; i < out.length; i++) u8[i] = out.charCodeAt(i) & 255; return u8;
  }
}
export const COURIER_W = 0.6; // advance width per em for Courier
