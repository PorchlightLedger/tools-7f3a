// Shared view bits
import { h } from './dom.js';
import { fmtDate, fmtDateShort, fmtTime } from './util.js';
import { personLabel, personName, missingGcssId } from './rules.js';

export const STATUS_CLASS = { FMC: 'go', NMCM: 'nogo', NMCS: 'nogo', 'NMC-X': 'nmcx', 'TURNED IN': 'muted', UNKNOWN: 'warn', 'NO STATUS': 'warn' };
export const RESULT_CLASS = { GO: 'go', WARN: 'warn', 'NO-GO': 'nogo', BACK: 'muted', CANCELLED: 'muted' };
export const statusChip = (s, extra = '') => h('span', { class: 'chip ' + (STATUS_CLASS[s] || 'warn') + ' ' + extra, 'data-status': s }, s);
export const resultChip = (r) => h('span', { class: 'chip big ' + (RESULT_CLASS[r] || ''), 'data-result': r }, r);
export const gcssBadge = (p) => (missingGcssId(p) ? h('span', { class: 'chip orange', title: 'No GCSS-Army ID', 'data-testid': 'no-gcss-badge' }, 'no GCSS ID') : null);
export function nameWithId(p, id) { return p ? h('span', null, personLabel(p), ' ', missingGcssId(p) ? h('span', { class: 'chip orange' }, 'no GCSS ID') : h('small', { class: 'mono' }, p.gcssId)) : h('span', { class: 'muted' }, id || '—'); }
export const tripTimes = (t) => `${t.dateOut ? fmtDateShort(t.dateOut) : '—'} ${fmtTime(t.timeOut)}${t.dateBack || t.timeBack ? ' → ' + (t.dateBack ? fmtDateShort(t.dateBack) : '') + ' ' + fmtTime(t.timeBack) : ''}`.trim();
export function piiNote(cls = '') { return h('div', { class: 'note pii ' + cls, role: 'note' }, h('b', null, 'Personal data: '), 'the roster contains PII and may be CUI. It stays on this phone. Do not screenshot or share it outside your SOP. Use Export backup only to a place you trust.'); }
export function emptyCard(title, msg, ...actions) { return h('div', { class: 'card empty-card' }, h('h3', null, title), h('p', null, msg), h('div', { class: 'row' }, ...actions)); }
export const btn = (label, onClick, cls = '', attrs = {}) => h('button', { type: 'button', class: 'btn ' + cls, onClick, ...attrs }, label);
export function chips(options, value, onChange, { label = '' } = {}) {
  const wrap = h('div', { class: 'filters', role: 'group', 'aria-label': label });
  for (const [val, text] of options) wrap.append(h('button', { type: 'button', class: 'fchip' + (val === value ? ' on' : ''), 'aria-pressed': String(val === value), 'data-val': val, onClick: () => onChange(val) }, text));
  return wrap;
}
export { personName, fmtDate };
/** small "Lic no." text next to a driver (operator license number; separate from the GCSS-Army ID) */
export function licNoBadge(p) { return p && p.licNo ? h('small', { class: 'mono', 'data-testid': 'lic-no' }, ' · Lic ' + p.licNo) : null; }
