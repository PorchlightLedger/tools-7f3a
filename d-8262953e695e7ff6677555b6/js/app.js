import { store, S } from './ctx.js';
import { h, clear, toast, $, $$, closeAllSheets, openSheet, safeAppend } from './dom.js';
import { renderToday } from './views/today.js';
import { renderDispatch } from './views/dispatch.js';
import { renderFleet } from './views/fleet.js';
import { renderRoster } from './views/roster.js';
import { renderMore } from './views/more.js';
import { renderBanners, setUpdateReady } from './banners.js';
import { loadPhotoIndex, reconcilePhotos, pruneFaultPhotos, onPhotosChanged } from './photos.js';

const ROUTES = { today: ['Today', renderToday], dispatch: ['Dispatch', renderDispatch], fleet: ['Fleet', renderFleet], roster: ['Roster', renderRoster], more: ['More', renderMore] };
let current = null, scrollMemo = {};
export function route() { const [tab, ...rest] = (location.hash || '#today').slice(1).split('/'); return { tab: ROUTES[tab] ? tab : 'today', rest }; }


export function render() {
  const main = safeAppend($('#main')); const { tab, rest } = route(); const scroll = main.scrollTop;
  const r = ROUTES[tab]; const top = safeAppend($('#top-actions')); clear(top);
  if (current && current.tab !== tab) scrollMemo[current.tab] = window.scrollY;
  const fresh = !current || current.tab !== tab || current.rest.join('/') !== rest.join('/');
  clear(main);
  try { const title = r[1](main, rest, top) || r[0]; $('#page-title').textContent = title; document.title = `${title} - Dispatch`; }
  catch (e) { console.error(e); main.append(h('div', { class: 'card bad' }, 'Something went wrong drawing this screen: ' + e.message)); }
  $$('.tabbar a').forEach((a) => { const on = a.dataset.tab === tab; a.classList.toggle('on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  if (fresh) window.scrollTo(0, scrollMemo[tab] && current && current.tab === tab ? scrollMemo[tab] : 0);
  current = { tab, rest }; renderBanners();
}

async function boot() {
  await store.load();
  await loadPhotoIndex(); reconcilePhotos(store.state.fleet).catch(() => {});
  if (store.loaded) pruneFaultPhotos(store.state.forms).catch(() => {}); // fault photos of worksheets / faults that no longer exist (only when the saved state really loaded)
  store.onStatus(() => renderBanners());
  store.subscribe(() => { if (!document.querySelector('.sheet-wrap') || true) renderKeepScroll(); });
  onPhotosChanged(() => renderKeepScroll());
  window.addEventListener('hashchange', () => { closeAllSheets(); render(); });
  window.addEventListener('pagehide', () => store.flush());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') store.flush(); });
  render();
  if (store.mode === 'memory') toast('Storage is unavailable (private mode?). Data will be lost when you close the app.', 'bad');
  registerSW();
  document.documentElement.dataset.ready = '1';
}
function renderKeepScroll() { const y = window.scrollY; render(); window.scrollTo(0, y); }

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) setUpdateReady(); }); // sticky banner with a Reload button (a toast disappears before it is read)
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    const check = () => { if (navigator.onLine) reg.update().catch(() => {}); };
    check(); window.addEventListener('online', check); document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    window.__swReg = reg;
  }).catch((e) => console.warn('service worker not registered', e));
}
boot().catch((e) => { console.error(e); document.body.prepend(h('pre', { class: 'card bad' }, 'Startup failed: ' + e.message)); });
