import { S, go } from '../ctx.js';
import { h, openSheet, toast, field, clear } from '../dom.js';
import { asOfBar } from '../banners.js';
import { mailtoLink } from '../backup.js';
import { btn } from '../ui.js';
import { slantHeader, slantReport, slantText, slantDate, slantAsOf, slantSubject } from '../slant.js';

/** loose address check: empty is fine (draft with no recipient); otherwise one address like a@b */
export const looseEmailOk = (s) => { const t = String(s || '').trim(); return !t || /^[^\s@,;<>]+@[^\s@,;<>]+$/.test(t); };

async function copyText(text) {
  try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; } } catch { /* fall through */ }
  try { const ta = h('textarea', { 'aria-hidden': 'true', readonly: '', style: 'position:fixed;left:-9999px;top:0;opacity:0' }); ta.value = text; document.body.append(ta); ta.select(); ta.setSelectionRange(0, text.length); const ok = document.execCommand && document.execCommand('copy'); ta.remove(); return !!ok; }
  catch { return false; }
}

export function renderReports(root, rest, top) {
  const st = S(); top.append(btn('‹ More', () => go('#more'), 'small'));
  const iso = slantAsOf(st.settings); const rep = slantReport(st.fleet, st.settings); const unit = slantHeader(st.settings); const text = slantText(rep, iso, unit); const subject = slantSubject(iso, unit);
  const send = async () => {
    if (typeof navigator.share === 'function') {
      try { await navigator.share({ title: subject, text }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; /* share sheet failed: fall back to copy */ }
    }
    toast((await copyText(text)) ? 'Sharing is not available here. The slant report was copied; paste it into a message or email.' : 'Could not share or copy the slant report on this device.');
  };
  const copy = async () => toast((await copyText(text)) ? 'Slant report copied' : 'Could not copy on this device');
  const table = h('table', { class: 'slant', 'data-testid': 'slant-table' }, h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Equipment'), h('th', { scope: 'col', class: 'num' }, 'On-hand'), h('th', { scope: 'col', class: 'num' }, 'NMC'))),
    h('tbody', null, rep.rows.map((r) => h('tr', { 'data-testid': 'slant-row', 'data-label': r.label },
      h('th', { scope: 'row' }, r.label), h('td', { class: 'num', 'data-col': 'onhand' }, String(r.onHand)),
      h('td', { class: 'num', 'data-col': 'nmc' }, String(r.nmc), r.x ? h('small', { class: 'xnote', 'data-testid': 'slant-x' }, `incl. ${r.x} X`) : null)))));
  root.append(asOfBar(),
    h('div', { class: 'row slant-actions' }, btn('Send', send, 'primary', { 'data-testid': 'slant-send' }), btn('Email draft', () => openEmailDraft(subject, text), '', { 'data-testid': 'slant-email' }), btn('Copy', copy, '', { 'data-testid': 'slant-copy' })),
    h('div', { class: 'card slant-card' }, unit ? h('h2', { class: 'slant-title', 'data-testid': 'slant-header' }, unit) : h('p', { class: 'hint slant-unit-hint', 'data-testid': 'slant-unit-hint' }, 'Set your unit name in More > Settings.'), h('p', { class: 'slant-date', 'data-testid': 'slant-date' }, `Slant report - ${slantDate(iso)}`), table));
  return 'Reports';
}

/** asks for an address each time; nothing is stored (not in settings, not in the state, not in localStorage) */
function openEmailDraft(subject, text) {
  openSheet({ title: 'Email draft', tall: false, build: (b, api) => {
    const input = h('input', { type: 'email', inputmode: 'email', autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', placeholder: 'name@example.mil (optional)', 'data-testid': 'slant-to', 'aria-label': 'Send the email draft to' });
    const err = h('p', { class: 'hint bad', role: 'alert', 'data-testid': 'slant-to-err' });
    const link = h('a', { class: 'btn primary', href: mailtoLink('', subject, text), 'data-testid': 'slant-mailto', onClick: (e) => { if (!looseEmailOk(input.value)) { e.preventDefault(); err.textContent = 'That does not look like an email address. Fix it, or clear it to open the draft with no recipient.'; return; } err.textContent = ''; setTimeout(() => api.close(), 400); } }, 'Open email draft');
    const upd = () => { link.setAttribute('href', mailtoLink(input.value.trim(), subject, text)); if (looseEmailOk(input.value)) err.textContent = ''; };
    input.addEventListener('input', upd);
    b.append(h('p', { class: 'hint' }, 'Type who it goes to. It is used only for this draft and is not saved. Leave it empty to pick the recipient in your email app.'), field('Send to', input), err);
    api.foot.append(h('button', { class: 'btn', type: 'button', onClick: () => api.close() }, 'Cancel'), link);
  } });
}
