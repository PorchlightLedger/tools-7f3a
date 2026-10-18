// Backup / restore (JSON) and sharing helpers
import { normalizeState, SCHEMA } from './store.js';
import { stampForFile } from './util.js';

export const APP_ID = 'dispatch-app';
export function makeBackup(state, now = new Date()) {
  return JSON.stringify({ app: APP_ID, format: 1, schema: SCHEMA, exportedAt: now.toISOString(), warning: 'Contains roster personal data (PII) and fleet data. May be CUI. Store and share only per your SOP.', state }, null, 1);
}
export function backupFileName(now = new Date()) { return `dispatch-backup-${stampForFile(now)}.json`; }
export function parseBackup(text) { return parseBackupInfo(text).state; }
/** -> {state, exportedAt (ISO or ''), schema}. Same checks as parseBackup. */
export function parseBackupInfo(text) {
  let o; try { o = JSON.parse(text); } catch { throw new Error('That file is not valid JSON.'); }
  if (!o || o.app !== APP_ID || !o.state || typeof o.state !== 'object') throw new Error('That is not a backup file from this app.');
  if (typeof o.schema === 'number' && o.schema > SCHEMA) throw new Error('This backup is from a newer version of the app. Update the app first.');
  const s = normalizeState(o.state);
  // defensive: never carry DODID / DOB if a foreign file sneaked them in
  s.roster = s.roster.map((p) => { const { dodid, dob, ssn, DODID, DOB, ...rest } = p; return rest; });
  const at = typeof o.exportedAt === 'string' && !Number.isNaN(new Date(o.exportedAt).getTime()) ? o.exportedAt : '';
  return { state: s, exportedAt: at, schema: typeof o.schema === 'number' ? o.schema : 0 };
}
/**
 * Share a file via the Web Share API when the device can share files, else download it.
 * returns {method:'share'|'download'|'cancelled'}
 */
export async function shareOrDownload(bytes, filename, mime, { title = '', text = '' } = {}) {
  const blob = new Blob([bytes], { type: mime }); let file = null;
  try { file = new File([blob], filename, { type: mime }); } catch { /* old browsers */ }
  if (file && navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
    try { await navigator.share({ files: [file], title, text }); return { method: 'share' }; }
    catch (e) { if (e && e.name === 'AbortError') return { method: 'cancelled' }; /* else fall through to download */ }
  }
  downloadBlob(blob, filename); return { method: 'download' };
}
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export function mailtoLink(to, subject, body) {
  return `mailto:${encodeURIComponent(to || '').replace(/%40/g, '@').replace(/%2C/g, ',')}?subject=${encodeURIComponent(subject || '')}&body=${encodeURIComponent(body || '')}`;
}
