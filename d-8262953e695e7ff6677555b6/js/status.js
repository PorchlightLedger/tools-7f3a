// Pure helpers behind the status banners (no DOM, runs in node tests): save problems, backup age, as-of date notice, update-then-reload.
import { parseDateLoose, todayISO, daysBetween, localDayOf, fmtDate } from './util.js';

export const BACKUP_AMBER_DAYS = 7;
/** null when saving is fine, else {level:'bad', kind:'error'|'memory'|'fallback', text}. `store` = {mode, lastError}. */
export function saveProblem(store) {
  if (!store) return null;
  if (store.mode === 'memory') return { level: 'bad', kind: 'memory', text: 'Nothing is being saved: storage is unavailable (private browsing, or storage blocked). Everything you enter is lost when you close the app. Export a backup now, and install the app to the Home Screen.' };
  if (store.lastError) return { level: 'bad', kind: 'error', text: `Your last change could NOT be saved (${String(store.lastError).slice(0, 120)}). It is still on screen but will be lost if you close the app. Tap Retry, or export a backup.` };
  if (store.mode !== 'indexeddb') return { level: 'bad', kind: 'fallback', text: 'Using fallback storage (localStorage): the browser may clear it without warning. Keep backups, and install the app to the Home Screen.' };
  return null;
}
/** {days, text, amber}: days since the last backup / export (local days), text "Last backup: 3 days ago" | "Last backup: never". amber after 7 days, or never while there is data. */
export function backupStatus(lastBackupAt, { now = new Date(), hasData = true } = {}) {
  const d = lastBackupAt ? localDayOf(lastBackupAt) : ''; if (!d) return { days: null, text: 'Last backup: never', amber: !!hasData };
  const n = Math.max(0, daysBetween(d, todayISO(now)));
  return { days: n, text: `Last backup: ${n === 0 ? 'today' : n === 1 ? '1 day ago' : n + ' days ago'}`, amber: n > BACKUP_AMBER_DAYS };
}
/** the as-of date override notice: null when blank, or equals today (still reported when it is set but equal to today? no: only when it is NOT today) */
export function asOfNotice(settings, now = new Date()) {
  const d = parseDateLoose(settings && settings.asOfOverride); if (!d) return null; if (d === todayISO(now)) return null;
  return { date: d, text: `As-of date set to ${fmtDate(d)} (not today). Checks, license dates and counts use that date.` };
}
/** Check for a new service worker and reload. deps = {getReg, controllerChange(cb) -> unsubscribe, reload, timeoutMs}. Resolves 'reloaded' | 'updated' | 'none'.
 *  After reg.update() finds a worker that is installing / waiting, wait for the page to be taken over (controllerchange), at most timeoutMs, THEN reload;
 *  otherwise the reload could still be served by the old cache. */
export async function updateThenReload({ getReg, controllerChange, reload, timeoutMs = 4000 }) {
  let reg = null, swapped = false, fire = () => {};
  const off = controllerChange ? controllerChange(() => { swapped = true; fire(); }) : () => {};
  try { reg = await getReg(); if (reg) await reg.update(); } catch { /* offline: just reload */ }
  let kind = 'none';
  if (reg && (reg.installing || reg.waiting) && !swapped) {
    kind = 'updated';
    await new Promise((res) => { const t = setTimeout(res, timeoutMs); fire = () => { clearTimeout(t); res(); }; if (swapped) fire(); });
  } else if (swapped) kind = 'updated';
  try { off && off(); } catch { /* */ }
  reload(); return kind === 'none' ? 'reloaded' : kind;
}
