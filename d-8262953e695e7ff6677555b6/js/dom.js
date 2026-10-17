// Tiny DOM helpers: element builder, bottom sheets, dialogs, pickers, toasts. No third-party code.
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'disabled') el.disabled = !!v;
    else if (k === 'selected') el.selected = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) { if (kid == null || kid === false) continue; el.append(kid.nodeType ? kid : document.createTextNode(String(kid))); }
  return el;
}
/** Element.append that skips null/undefined/false (plain append() would print the word "null"). */
export function safeAppend(el) { if (el.__safe) return el; el.__safe = true; const raw = el.append.bind(el); el.append = (...k) => raw(...k.flat(Infinity).filter((x) => x != null && x !== false)); return el; }
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

let toastTimer = null;
export function toast(msg, kind = '') {
  let box = document.getElementById('toast'); if (!box) { box = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(box); }
  box.className = 'toast show ' + kind; box.textContent = msg; clearTimeout(toastTimer); toastTimer = setTimeout(() => { box.className = 'toast'; }, kind === 'bad' ? 6000 : 3200);
}

const stack = [];
/** open a bottom sheet. build(body, api) fills it. returns api {close, el, body} */
export function openSheet({ title, tall = false, build, footer, onClose, labelFor }) {
  const opener = document.activeElement;
  const overlay = h('div', { class: 'overlay' });
  const closeBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onClick: () => api.close() }, '✕');
  const titleEl = h('h2', { id: 'sh' + stack.length + Date.now(), class: 'sheet-title' }, title);
  const body = safeAppend(h('div', { class: 'sheet-body' }));
  const foot = safeAppend(h('div', { class: 'sheet-foot' }));
  const el = h('div', { class: 'sheet' + (tall ? ' tall' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleEl.id, tabindex: '-1' }, h('div', { class: 'sheet-head' }, titleEl, closeBtn), body, foot);
  const wrap = h('div', { class: 'sheet-wrap' }, overlay, el);
  const api = {
    el, body, foot, titleEl, closed: false,
    setTitle: (t) => { titleEl.textContent = t; },
    close(result) { if (api.closed) return; api.closed = true; wrap.remove(); const i = stack.indexOf(api); if (i >= 0) stack.splice(i, 1); if (!stack.length) document.body.classList.remove('noscroll'); try { opener && opener.focus && opener.focus(); } catch { /* */ } onClose && onClose(result); },
  };
  overlay.addEventListener('click', () => api.close());
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); api.close(); } });
  document.body.append(wrap); document.body.classList.add('noscroll'); stack.push(api);
  build && build(body, api); footer && footer(foot, api);
  if (!foot.childNodes.length) foot.remove();
  setTimeout(() => { const f = el.querySelector('[autofocus]') || el; f.focus({ preventScroll: true }); }, 30);
  return api;
}
export const closeAllSheets = () => [...stack].reverse().forEach((s) => s.close());
export const sheetDepth = () => stack.length;

export function confirmBox({ title = 'Confirm', message = '', okText = 'OK', cancelText = 'Cancel', danger = false, html = null }) {
  return new Promise((res) => {
    let done = false; const fin = (v) => { if (!done) { done = true; res(v); } };
    openSheet({ title, onClose: () => fin(false),
      build: (b) => { b.append(html ? html : h('p', { class: 'pre' }, message)); },
      footer: (f, api) => { f.append(h('button', { class: 'btn', type: 'button', onClick: () => { fin(false); api.close(); } }, cancelText), h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), type: 'button', 'data-testid': 'confirm-ok', onClick: () => { fin(true); api.close(); } }, okText)); } });
  });
}
export function typedConfirm({ title, message, word, okText = 'Confirm' }) {
  return new Promise((res) => {
    let done = false; const fin = (v) => { if (!done) { done = true; res(v); } };
    openSheet({ title, onClose: () => fin(false),
      build: (b, api) => {
        const input = h('input', { type: 'text', autocapitalize: 'characters', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', 'aria-label': `Type ${word} to confirm`, 'data-testid': 'typed-word', autofocus: true });
        const ok = h('button', { class: 'btn danger', type: 'button', disabled: true, 'data-testid': 'typed-ok', onClick: () => { fin(true); api.close(); } }, okText);
        input.addEventListener('input', () => { ok.disabled = input.value.trim().toUpperCase() !== word; });
        b.append(h('p', { class: 'pre' }, message), h('label', { class: 'field' }, h('span', null, `Type ${word} to confirm`), input));
        api.foot.append(h('button', { class: 'btn', type: 'button', onClick: () => { fin(false); api.close(); } }, 'Cancel'), ok);
      } });
  });
}
export function field(label, input, hint) { return h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), input, hint ? h('small', { class: 'hint' }, hint) : null); }
export function segmented(options, value, onChange, { label = '', cls = '' } = {}) {
  const wrap = h('div', { class: 'seg ' + cls, role: 'radiogroup', 'aria-label': label });
  const draw = (v) => { clear(wrap); options.forEach(([val, text, sub]) => { const b = h('button', { type: 'button', class: 'seg-btn' + (val === v ? ' on' : ''), role: 'radio', 'aria-checked': String(val === v), 'data-val': val, onClick: () => { value = val; draw(val); onChange(val); } }, text, sub ? h('small', null, sub) : null); wrap.append(b); }); };
  draw(value); wrap.setValue = (v) => { value = v; draw(v); }; return wrap;
}
export function toggle(label, checked, onChange, hint) {
  const input = h('input', { type: 'checkbox', checked, onChange: () => onChange(input.checked) });
  return h('label', { class: 'toggle' }, input, h('span', { class: 'tl' }, label, hint ? h('small', { class: 'hint' }, hint) : null));
}
/**
 * list picker with search. items: [{id,label,sub,badge,badgeClass,disabled}]. multi => returns array. Returns undefined when dismissed.
 * more: optional {label, items} -> checkbox that swaps to the longer list.
 */
export function pick({ title, items, multi = false, selected = [], more = null, empty = 'Nothing to choose.', note = '', allowNone = null }) {
  return new Promise((res) => {
    let done = false; const fin = (v) => { if (!done) { done = true; res(v); } };
    let sel = new Set(multi ? selected : selected.slice(0, 1)); let showMore = false; let q = '';
    openSheet({ title, tall: true, onClose: () => fin(undefined),
      build: (b, api) => {
        const search = h('input', { type: 'search', class: 'search', placeholder: 'Search…', 'aria-label': 'Search', autocomplete: 'off', 'data-testid': 'pick-search' });
        const list = h('ul', { class: 'pick-list', role: multi ? 'listbox' : 'listbox', 'aria-multiselectable': String(multi) });
        const info = h('p', { class: 'hint' }, note);
        const draw = () => {
          clear(list); const src = showMore && more ? more.items : items; const needle = q.trim().toLowerCase();
          const shown = src.filter((i) => !needle || `${i.label} ${i.sub || ''} ${i.badge || ''}`.toLowerCase().includes(needle));
          if (allowNone && !multi) list.append(h('li', null, h('button', { type: 'button', class: 'pick-item', onClick: () => { fin(null); api.close(); } }, h('span', { class: 'pi-main' }, h('b', null, allowNone)))));
          if (!shown.length) list.append(h('li', { class: 'empty' }, empty));
          shown.forEach((i) => {
            const on = sel.has(i.id);
            const btn = h('button', { type: 'button', class: 'pick-item' + (on ? ' on' : ''), role: 'option', 'aria-selected': String(on), disabled: i.disabled, 'data-id': i.id, onClick: () => {
              if (multi) { if (sel.has(i.id)) sel.delete(i.id); else sel.add(i.id); draw(); } else { fin(i.id); api.close(); }
            } }, h('span', { class: 'pi-main' }, h('b', null, i.label), i.sub ? h('small', null, i.sub) : null), i.badge ? h('span', { class: 'chip ' + (i.badgeClass || '') }, i.badge) : null, multi ? h('span', { class: 'check', 'aria-hidden': 'true' }, on ? '✔' : '') : null);
            list.append(h('li', null, btn));
          });
        };
        search.addEventListener('input', () => { q = search.value; draw(); });
        b.append(search, info);
        if (more) b.append(toggle(more.label, false, (v) => { showMore = v; draw(); }));
        b.append(list); draw();
        if (multi) api.foot.append(h('button', { class: 'btn', type: 'button', onClick: () => { fin(undefined); api.close(); } }, 'Cancel'), h('button', { class: 'btn primary', type: 'button', 'data-testid': 'pick-done', onClick: () => { fin([...sel]); api.close(); } }, 'Done'));
      } });
  });
}
export async function readFileText(file) { return await file.text(); }
export async function readFileBytes(file) { return new Uint8Array(await file.arrayBuffer()); }
export function esc(s) { return String(s ?? ''); }
