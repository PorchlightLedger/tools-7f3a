// Persistent status banners (save problems, app update ready), the as-of date bar and the "Last backup" line. Plain DOM, no network.
import { store, S, commit } from './ctx.js';
import { h, toast, clear, $ } from './dom.js';
import { makeBackup, backupFileName, shareOrDownload } from './backup.js';
import { saveProblem, backupStatus, asOfNotice } from './status.js';

let updateReady = false;
/** remember that a newer version took over (the page still runs the old code until it is reloaded) */
export function setUpdateReady() { updateReady = true; renderBanners(); }
/** the date of the last completed JSON backup / xlsx export is kept in the state (state.ui.lastBackupAt) */
export function recordBackup(now = new Date()) { S().ui.lastBackupAt = now.toISOString(); commit(); }
/** export the JSON backup now (share sheet or download). Returns true when it was shared / saved. */
export async function exportBackupNow() {
  try {
    await store.flush(); const bytes = new TextEncoder().encode(makeBackup(S())); const r = await shareOrDownload(bytes, backupFileName(), 'application/json', { title: 'Dispatch app backup (PII)' });
    if (r.method === 'cancelled') return false; recordBackup(); toast(r.method === 'share' ? 'Backup shared' : 'Backup saved to Downloads'); return true;
  } catch (e) { console.error(e); toast('Could not make the backup: ' + ((e && e.message) || e), 'bad'); return false; }
}
export function renderBanners() {
  const box = $('#banners'); if (!box) return; clear(box);
  const p = saveProblem(store);
  if (p) box.append(h('div', { class: 'banner bad', role: 'alert', 'data-testid': 'save-banner', 'data-kind': p.kind }, h('span', { class: 'bn-text' }, p.text),
    h('span', { class: 'bn-btns' }, p.kind === 'error' ? h('button', { type: 'button', class: 'btn small', 'data-testid': 'save-retry', onClick: async () => { const ok = await store.retrySave(); toast(ok ? 'Saved.' : 'Still cannot save: ' + store.lastError, ok ? '' : 'bad'); renderBanners(); } }, 'Retry') : null,
      h('button', { type: 'button', class: 'btn small primary', 'data-testid': 'save-export', onClick: () => exportBackupNow() }, 'Export backup'))));
  if (updateReady) box.append(h('div', { class: 'banner info', role: 'status', 'data-testid': 'update-banner' }, h('span', { class: 'bn-text' }, 'App updated. Reload to use the new version.'),
    h('span', { class: 'bn-btns' }, h('button', { type: 'button', class: 'btn small primary', 'data-testid': 'update-reload', onClick: () => location.reload() }, 'Reload'))));
}
/** orange bar while an as-of date override is set (it changes every check, license date and count). null when not set / equals today. */
export function asOfBar() {
  const n = asOfNotice(S().settings); if (!n) return null;
  return h('div', { class: 'note asof', role: 'status', 'data-testid': 'asof-bar' }, h('span', null, n.text), h('button', { type: 'button', class: 'btn small', 'data-testid': 'asof-clear', onClick: () => { S().settings.asOfOverride = ''; commit(); toast('As-of date cleared: using today'); } }, 'Clear'));
}
/** "Last backup: N days ago" for More; amber after 7 days. */
export function backupLine() {
  const st = S(); const b = backupStatus(st.ui.lastBackupAt, { hasData: !!(st.roster.length || st.fleet.length || st.trips.length || st.forms.length) });
  return h('div', { class: 'note backup-age' + (b.amber ? ' warn' : ''), 'data-testid': 'backup-age', 'data-amber': b.amber ? '1' : '0' }, h('span', null, b.text), h('button', { type: 'button', class: 'btn small', 'data-testid': 'backup-now', onClick: () => exportBackupNow() }, 'Back up now'));
}
