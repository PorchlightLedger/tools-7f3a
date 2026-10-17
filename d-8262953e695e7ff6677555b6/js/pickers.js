// In-app date and time pickers (bottom sheets with explicit OK / Cancel).
// Why not <input type=date|time>? iOS Safari fires "change" while the wheel is still turning; the old editor re-drew the form on
// every change, which closed the wheel and froze the value. Here nothing is committed until the user taps OK, and no control is
// ever re-created while it is being used (buttons only change class).
import { h, openSheet } from './dom.js';
import { pad, normTime, parseDateLoose, todayISO, nowHHMM, fmtDate, MONTHS } from './util.js';

const monthName = (m) => ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m];

/** @returns Promise<string|undefined> 'HHMM', '' when cleared, undefined when cancelled */
export function pickTime({ title = 'Time', value = '', allowClear = true } = {}) {
  return new Promise((res) => {
    let done = false; const fin = (v) => { if (!done) { done = true; res(v); } };
    let cur = normTime(value) || ''; // 'HHMM' or ''
    openSheet({ title, onClose: () => fin(undefined),
      build: (b, api) => {
        const disp = h('div', { class: 'pk-disp', 'data-testid': 'pk-display', 'aria-live': 'polite' });
        const typed = h('input', { type: 'text', inputmode: 'numeric', maxlength: '5', autocomplete: 'off', placeholder: 'HHMM', 'aria-label': 'Type the time as HHMM (24 hour)', 'data-testid': 'pk-time-text', class: 'pk-text' });
        const hBtns = [], mBtns = [];
        const hh = () => (cur ? +cur.slice(0, 2) : null), mm = () => (cur ? +cur.slice(2) : null);
        const paint = (fromText = false) => {
          disp.textContent = cur ? `${cur.slice(0, 2)}:${cur.slice(2)}` : '--:--'; disp.dataset.value = cur;
          hBtns.forEach((x, i) => { const on = hh() === i; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
          mBtns.forEach((x) => { const on = mm() === +x.dataset.m; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
          if (!fromText) typed.value = cur;
        };
        const set = (H, M) => { cur = pad(H) + pad(M); paint(); };
        const hourGrid = h('div', { class: 'pk-grid pk-hours', role: 'group', 'aria-label': 'Hour' });
        for (let i = 0; i < 24; i++) { const x = h('button', { type: 'button', class: 'pk-cell', 'data-testid': 'pk-h-' + pad(i), 'aria-pressed': 'false', onClick: () => set(i, mm() ?? 0) }, pad(i)); hBtns.push(x); hourGrid.append(x); }
        const minGrid = h('div', { class: 'pk-grid pk-mins', role: 'group', 'aria-label': 'Minute' });
        for (let i = 0; i < 60; i += 5) { const x = h('button', { type: 'button', class: 'pk-cell', 'data-m': String(i), 'data-testid': 'pk-m-' + pad(i), 'aria-pressed': 'false', onClick: () => set(hh() ?? 0, i) }, pad(i)); mBtns.push(x); minGrid.append(x); }
        const step = (dm) => { let t = (hh() ?? 0) * 60 + (mm() ?? 0) + dm; t = ((t % 1440) + 1440) % 1440; set(Math.floor(t / 60), t % 60); };
        typed.addEventListener('input', () => { const n = normTime(typed.value); if (n) { cur = n; paint(true); } else if (!typed.value.trim()) { cur = ''; paint(true); } });
        b.append(disp,
          h('div', { class: 'pk-row' }, h('button', { type: 'button', class: 'btn small', 'data-testid': 'pk-minus', onClick: () => step(-1) }, '−1 min'), h('button', { type: 'button', class: 'btn small', 'data-testid': 'pk-plus', onClick: () => step(1) }, '+1 min'), h('button', { type: 'button', class: 'btn small', 'data-testid': 'pk-minus5', onClick: () => step(-5) }, '−5'), h('button', { type: 'button', class: 'btn small', 'data-testid': 'pk-plus5', onClick: () => step(5) }, '+5'), h('button', { type: 'button', class: 'btn small', 'data-testid': 'pk-now', onClick: () => { cur = nowHHMM(); paint(); } }, 'Now')),
          h('div', { class: 'pk-lbl' }, 'Hour (24 h)'), hourGrid, h('div', { class: 'pk-lbl' }, 'Minute'), minGrid,
          h('div', { class: 'pk-lbl' }, 'Or type HHMM'), typed);
        paint();
        api.foot.append(allowClear ? h('button', { class: 'btn', type: 'button', 'data-testid': 'pk-clear', onClick: () => { fin(''); api.close(); } }, 'Clear') : null,
          h('button', { class: 'btn', type: 'button', 'data-testid': 'pk-cancel', onClick: () => { fin(undefined); api.close(); } }, 'Cancel'),
          h('button', { class: 'btn primary', type: 'button', 'data-testid': 'pk-ok', onClick: () => { if (!cur) { fin(''); } else fin(cur); api.close(); } }, 'OK'));
      } });
  });
}

/** @returns Promise<string|undefined> 'YYYY-MM-DD', '' when cleared, undefined when cancelled */
export function pickDate({ title = 'Date', value = '', allowClear = true } = {}) {
  return new Promise((res) => {
    let done = false; const fin = (v) => { if (!done) { done = true; res(v); } };
    let sel = parseDateLoose(value) || ''; const start = sel || todayISO(); let vy = +start.slice(0, 4), vm = +start.slice(5, 7) - 1;
    openSheet({ title, onClose: () => fin(undefined),
      build: (b, api) => {
        const disp = h('div', { class: 'pk-disp', 'data-testid': 'pk-display', 'aria-live': 'polite' });
        const head = h('div', { class: 'pk-month', 'aria-live': 'polite' });
        const grid = h('div', { class: 'pk-cal', role: 'grid' });
        const typed = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: 'YYYY-MM-DD', 'aria-label': 'Type the date as YYYY-MM-DD', 'data-testid': 'pk-date-text', class: 'pk-text' });
        const cells = new Map();
        const paintSel = (fromText = false) => { disp.textContent = sel ? fmtDate(sel) : '—'; disp.dataset.value = sel; for (const [iso, x] of cells) { const on = iso === sel; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); } if (!fromText) typed.value = sel; };
        const drawMonth = () => {
          grid.replaceChildren(); cells.clear(); head.textContent = `${monthName(vm)} ${vy}`;
          for (const d of ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']) grid.append(h('span', { class: 'pk-dow', 'aria-hidden': 'true' }, d));
          const first = new Date(Date.UTC(vy, vm, 1)); const lead = (first.getUTCDay() + 6) % 7; const n = new Date(Date.UTC(vy, vm + 1, 0)).getUTCDate();
          for (let i = 0; i < lead; i++) grid.append(h('span', { class: 'pk-pad', 'aria-hidden': 'true' }));
          const today = todayISO();
          for (let d = 1; d <= n; d++) { const iso = `${pad(vy, 4)}-${pad(vm + 1)}-${pad(d)}`; const x = h('button', { type: 'button', class: 'pk-cell' + (iso === today ? ' today' : ''), 'data-testid': 'pk-d-' + iso, 'aria-pressed': 'false', 'aria-label': fmtDate(iso), onClick: () => { sel = iso; paintSel(); } }, String(d)); cells.set(iso, x); grid.append(x); }
          paintSel(true);
        };
        const nav = (dm) => { vm += dm; while (vm < 0) { vm += 12; vy--; } while (vm > 11) { vm -= 12; vy++; } drawMonth(); };
        typed.addEventListener('input', () => { const d = parseDateLoose(typed.value); if (d && /^\d{4}-\d\d-\d\d$/.test(typed.value.trim())) { sel = d; vy = +d.slice(0, 4); vm = +d.slice(5, 7) - 1; drawMonth(); } else if (!typed.value.trim()) { sel = ''; paintSel(true); } });
        b.append(disp, h('div', { class: 'pk-row' }, h('button', { type: 'button', class: 'btn small', 'data-testid': 'pk-prev-year', 'aria-label': 'Previous year', onClick: () => nav(-12) }, '«'), h('button', { type: 'button', class: 'btn small', 'data-testid': 'pk-prev', 'aria-label': 'Previous month', onClick: () => nav(-1) }, '‹'), head, h('button', { type: 'button', class: 'btn small', 'data-testid': 'pk-next', 'aria-label': 'Next month', onClick: () => nav(1) }, '›'), h('button', { type: 'button', class: 'btn small', 'data-testid': 'pk-next-year', 'aria-label': 'Next year', onClick: () => nav(12) }, '»')),
          grid, h('div', { class: 'pk-row' }, h('button', { type: 'button', class: 'btn small', 'data-testid': 'pk-today', onClick: () => { sel = todayISO(); vy = +sel.slice(0, 4); vm = +sel.slice(5, 7) - 1; drawMonth(); } }, 'Today')), h('div', { class: 'pk-lbl' }, 'Or type YYYY-MM-DD'), typed);
        drawMonth(); paintSel();
        api.foot.append(allowClear ? h('button', { class: 'btn', type: 'button', 'data-testid': 'pk-clear', onClick: () => { fin(''); api.close(); } }, 'Clear') : null,
          h('button', { class: 'btn', type: 'button', 'data-testid': 'pk-cancel', onClick: () => { fin(undefined); api.close(); } }, 'Cancel'),
          h('button', { class: 'btn primary', type: 'button', 'data-testid': 'pk-ok', onClick: () => { fin(sel); api.close(); } }, 'OK'));
      } });
  });
}
export { MONTHS };
