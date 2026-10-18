// Fleet photos: ONE photo per fleet entry (vehicle or trailer) plus ONE optional photo per MODEL. A vehicle's own photo overrides the model photo.
// Stored in their own IndexedDB database ("dispatch-photos", never in the JSON state / localStorage) as small JPEG blobs: a full image
// (max 1280 px, JPEG q0.7, EXIF/GPS dropped by the re-encode) and a ~160 px thumbnail for lists. Keyed by the stable vehicle id (v:<vid>) or the model (m:<MODEL>).
// Photos are NOT part of the JSON backup or the xlsx. No images ship with the app: the user attaches their own.
import { clean } from './util.js';

export const PHOTO_MAX = 1280, PHOTO_QUALITY = 0.7, THUMB_MAX = 160;
const DB = 'dispatch-photos', ST = 'photos';
export const vehicleKeyOf = (v) => (v && v.vid ? 'v:' + v.vid : '');
/** model photo key: upper-case letters and digits of the GCSS model number ("M1151A1" -> "m:M1151A1", "TP I HMEE-I" -> "m:TPIHMEEI") */
export const modelPhotoKey = (model) => { const m = clean(model).toUpperCase().replace(/[^A-Z0-9]/g, ''); return m ? 'm:' + m : ''; };

// ----- storage backends (IndexedDB in the browser, a Map for node tests / no-IndexedDB fallback) -----
const enc = async (rec) => { const o = { ...rec }; for (const f of ['full', 'thumb']) { const b = rec[f]; if (b && typeof b.arrayBuffer === 'function') { o[f] = await b.arrayBuffer(); o[f + 'Type'] = b.type || 'image/jpeg'; } } return o; };
const dec = (r) => { if (!r) return r; const o = { ...r }; for (const f of ['full', 'thumb']) { if (r[f] instanceof ArrayBuffer) { o[f] = new Blob([r[f]], { type: r[f + 'Type'] || 'image/jpeg' }); } } return o; };
function idbBackend() {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => { if (typeof indexedDB === 'undefined') return rej(new Error('no indexedDB')); const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(ST, { keyPath: 'key' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error('blocked')); }));
  const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction(ST, mode); const os = t.objectStore(ST); let out; const q = fn(os); if (q) q.onsuccess = () => { out = q.result; }; t.oncomplete = () => res(out); t.onerror = t.onabort = () => rej(t.error || new Error('Photo storage error')); }); };
  return {
    kind: 'indexeddb',
    // Pictures are stored as ArrayBuffer + MIME type, not as Blob objects: WebKit/Safari can fail to store Blobs in IndexedDB in some storage modes ("Error preparing Blob/File data").
    get: async (k) => dec(await tx('readonly', (os) => os.get(k))), put: async (rec) => { const encoded = await enc(rec); return tx('readwrite', (os) => os.put(encoded)); }, del: (k) => tx('readwrite', (os) => os.delete(k)), all: () => tx('readonly', (os) => os.getAll()), clear: () => tx('readwrite', (os) => os.clear()),
    async drop() { try { const db = await open(); db.close(); } catch { /* */ } dbp = null; await new Promise((res) => { try { const r = indexedDB.deleteDatabase(DB); r.onsuccess = r.onerror = r.onblocked = () => res(); } catch { res(); } }); },
  };
}
export function memoryBackend() { const m = new Map(); return { kind: 'memory', get: async (k) => m.get(k), put: async (r) => { m.set(r.key, r); }, del: async (k) => { m.delete(k); }, all: async () => [...m.values()], clear: async () => m.clear(), drop: async () => m.clear() }; }
let backend = null; const be = () => backend || (backend = typeof indexedDB !== 'undefined' ? idbBackend() : memoryBackend());
export function setPhotoBackend(b) { backend = b; index.clear(); urls.clear(); }

// ----- in-memory index (which keys have a photo, sizes) so lists can decide synchronously -----
const index = new Map(); // key -> {key, kind, ref, bumperKey, bytes, updated}
const urls = new Map(); // `${key}|${which}` -> {url, updated}
const listeners = new Set();
export const onPhotosChanged = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const changed = () => listeners.forEach((f) => { try { f(); } catch (e) { console.error(e); } });
const meta = (r) => ({ key: r.key, kind: r.kind, ref: r.ref, bumperKey: r.bumperKey || '', bytes: r.bytes || 0, updated: r.updated || '', w: r.w || 0, h: r.h || 0 });
export async function loadPhotoIndex() {
  index.clear(); try { for (const r of await be().all()) index.set(r.key, meta(r)); } catch (e) { console.warn('photos unavailable', e); }
  changed(); return index.size;
}
export const hasPhoto = (key) => !!key && index.has(key);
export const photoMeta = (key) => index.get(key) || null;
/** which photo a vehicle shows: its own, else its model's. -> {key, source:'vehicle'|'model'} or null */
export function effectivePhoto(v) {
  if (!v) return null; const vk = vehicleKeyOf(v); if (vk && index.has(vk)) return { key: vk, source: 'vehicle' };
  const mk = modelPhotoKey(v.model); if (mk && index.has(mk)) return { key: mk, source: 'model' };
  return null;
}
export const photoKeys = () => [...index.keys()];

async function urlFor(key, which) {
  const m = index.get(key); if (!m) return ''; const ck = key + '|' + which; const c = urls.get(ck); if (c && c.updated === m.updated) return c.url;
  const r = await be().get(key); if (!r) return ''; const blob = which === 'full' ? r.full : (r.thumb || r.full); if (!blob) return '';
  if (c) { try { URL.revokeObjectURL(c.url); } catch { /* */ } }
  const url = URL.createObjectURL(blob); urls.set(ck, { url, updated: m.updated }); return url;
}
export const photoUrl = (key, which = 'thumb') => urlFor(key, which);
export async function getPhotoBlob(key, which = 'full') { const r = await be().get(key); return r ? (which === 'thumb' ? r.thumb || r.full : r.full) : null; }

// ----- compression (browser only) -----
async function decode(blob) {
  if (typeof createImageBitmap === 'function') { try { const bm = await createImageBitmap(blob, { imageOrientation: 'from-image' }); return { src: bm, w: bm.width, h: bm.height, done: () => bm.close && bm.close() }; } catch { /* fall back to <img> */ } }
  const url = URL.createObjectURL(blob);
  try { const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That file is not an image this browser can read.')); i.src = url; }); return { src: img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) }; }
  catch (e) { URL.revokeObjectURL(url); throw e; }
}
const toJpeg = (canvas, q) => new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode the image.'))), 'image/jpeg', q));
export function fitSize(w, h, max) { const s = Math.min(1, max / Math.max(w, h)); return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) }; }
async function render(d, max, q) { const { w, h } = fitSize(d.w, d.h, max); const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(d.src, 0, 0, w, h); return { blob: await toJpeg(c, q), w, h }; }
/** downscale to <= PHOTO_MAX px JPEG (q0.7) plus a small thumbnail. Returns {full, thumb, w, h, bytes} */
export async function compressImage(file, { max = PHOTO_MAX, quality = PHOTO_QUALITY } = {}) {
  const d = await decode(file); try { const f = await render(d, max, quality); const t = await render(d, THUMB_MAX, 0.7); return { full: f.blob, thumb: t.blob, w: f.w, h: f.h, bytes: f.blob.size + t.blob.size }; } finally { d.done(); }
}
/** thumbnail only (for an already-small image, e.g. a model photo from the settings file) */
export async function makeThumb(blob) { const d = await decode(blob); try { const t = await render(d, THUMB_MAX, 0.7); return { thumb: t.blob, w: d.w, h: d.h }; } finally { d.done(); } }

// ----- set / remove -----
async function putRec(key, kind, ref, bumperKey, parts) {
  const rec = { key, kind, ref, bumperKey: bumperKey || '', full: parts.full, thumb: parts.thumb || parts.full, w: parts.w || 0, h: parts.h || 0, bytes: (parts.full ? parts.full.size : 0) + (parts.thumb && parts.thumb !== parts.full ? parts.thumb.size : 0), type: 'image/jpeg', updated: new Date().toISOString() + '#' + Math.random().toString(36).slice(2, 6) };
  await be().put(rec); index.set(key, meta(rec)); changed(); return rec;
}
export const putRecForTest = putRec; // node tests store ready blobs without the browser-only compressor
/** attach (or replace) the ONE photo of a vehicle / trailer */
export async function setVehiclePhoto(v, file) { const k = vehicleKeyOf(v); if (!k) throw new Error('This vehicle has no id yet.'); return putRec(k, 'vehicle', v.vid, v.key, await compressImage(file)); }
/** attach (or replace) the photo shown for every vehicle of this model that has no photo of its own */
export async function setModelPhoto(model, file) { const k = modelPhotoKey(model); if (!k) throw new Error('This vehicle has no model.'); return putRec(k, 'model', clean(model).toUpperCase(), '', await compressImage(file)); }
/** store a ready JPEG (data URL from a settings file) as a model photo. thumbnail is generated when the browser can. */
export async function setModelPhotoBlob(model, blob) { const k = modelPhotoKey(model); if (!k) throw new Error('bad model'); let parts = { full: blob }; try { if (typeof document !== 'undefined') parts = { full: blob, ...(await makeThumb(blob)) }; } catch { /* keep full as thumb */ } return putRec(k, 'model', clean(model).toUpperCase(), '', parts); }
export async function removePhoto(key) {
  await be().del(key); index.delete(key); for (const w of ['thumb', 'full']) { const c = urls.get(key + '|' + w); if (c) { try { URL.revokeObjectURL(c.url); } catch { /* */ } urls.delete(key + '|' + w); } } changed();
}
export async function clearAllPhotos() { await be().clear(); index.clear(); for (const c of urls.values()) { try { URL.revokeObjectURL(c.url); } catch { /* */ } } urls.clear(); changed(); }
/** wipe-all: drop the whole photo database */
export async function dropPhotoDb() { try { await be().drop(); } catch { /* */ } index.clear(); urls.clear(); changed(); }
export function photoTotals() { let vehicle = 0, model = 0, bytes = 0; for (const m of index.values()) { if (m.kind === 'model') model++; else vehicle++; bytes += m.bytes; } return { count: vehicle + model, vehicle, model, bytes }; }
export const fmtBytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** a fleet re-import / restore can give vehicles new ids (e.g. after "wipe"): photos whose vehicle id is gone follow the bumper to the matching vehicle.
 *  returns the number re-keyed. Photos of vehicles that are really gone are kept (the vehicle may return in a later export). */
export async function reconcilePhotos(fleet) {
  const live = new Set(fleet.map((v) => v.vid).filter(Boolean)); const byBumper = new Map(fleet.map((v) => [v.key, v])); let n = 0;
  for (const m of [...index.values()]) {
    if (m.kind !== 'vehicle' || live.has(m.ref) || !m.bumperKey) continue;
    const v = byBumper.get(m.bumperKey); if (!v || !v.vid || index.has('v:' + v.vid)) continue;
    const r = await be().get(m.key); if (!r) continue; await be().del(m.key); index.delete(m.key);
    r.key = 'v:' + v.vid; r.ref = v.vid; await be().put(r); index.set(r.key, meta(r)); n++;
  }
  if (n) changed(); return n;
}
/** model keys of settings-type models that look like a Humvee (HMMWV by type / M11xx by model), for default model photos */
export const isHumveeModel = (model, type = '') => /HMMWV|HUMVEE/i.test(type) || /^M11(13|14|51|52|65|66|67|68|69|70)/i.test(clean(model)) || /HMMWV/i.test(model);

export function dataUrlToBlob(u) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(u || '')); if (!m) throw new Error('not a base64 image data URL');
  const bin = typeof atob === 'function' ? atob(m[2].replace(/\s/g, '')) : Buffer.from(m[2], 'base64').toString('binary'); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: m[1] });
}
export async function blobToDataUrl(blob) { const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); return `data:${blob.type || 'image/jpeg'};base64,` + (typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64')); }
