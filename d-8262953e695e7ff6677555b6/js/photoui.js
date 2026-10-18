// Photo UI pieces: list thumbnails, the single photo slot on the vehicle detail, model photo, full view, share.
import { h, openSheet, toast, clear } from './dom.js';
import { shareOrDownload } from './backup.js';
import { effectivePhoto, photoUrl, photoMeta, hasPhoto, vehicleKeyOf, modelPhotoKey, setVehiclePhoto, setModelPhoto, removePhoto, getPhotoBlob, fmtBytes } from './photos.js';
import { commit } from './ctx.js';

/** small thumbnail element for a fleet record (its own photo, else the model photo); null when there is none */
export function vthumb(v, { size = 'sm' } = {}) {
  const e = effectivePhoto(v); if (!e) return null;
  const img = h('img', { class: 'vthumb-img', alt: '', draggable: 'false', 'data-testid': 'vthumb-img', 'data-photo-key': e.key, 'data-photo-source': e.source });
  photoUrl(e.key, 'thumb').then((u) => { if (u) img.src = u; }).catch(() => {});
  return h('span', { class: 'vthumb ' + size, 'data-testid': 'vthumb', 'data-source': e.source }, img);
}
/** same, but for pick() items: returns a function that builds the element (pick() calls it per row) */
export const thumbFor = (v) => () => vthumb(v);

export async function openPhotoViewer(v) {
  const e = effectivePhoto(v); if (!e) return;
  openSheet({ title: `${v.short || v.bumper} photo`, build: (b) => {
    const img = h('img', { class: 'photo-full', alt: `${v.short || v.bumper} photo`, 'data-testid': 'photo-full' }); photoUrl(e.key, 'full').then((u) => { if (u) img.src = u; });
    b.append(img, h('p', { class: 'hint' }, e.source === 'vehicle' ? 'This vehicle\'s own photo.' : `Model photo for ${v.model} (shown because this vehicle has no photo of its own).`));
  } });
}
export async function sharePhoto(v) {
  const e = effectivePhoto(v); if (!e) { toast('No photo to share.', 'bad'); return; }
  const blob = await getPhotoBlob(e.key, 'full'); if (!blob) return;
  const name = `${String(v.short || v.bumper || 'vehicle').replace(/[^A-Za-z0-9]+/g, '')}_photo.jpg`;
  const r = await shareOrDownload(new Uint8Array(await blob.arrayBuffer()), name, 'image/jpeg', { title: `${v.short || ''} photo` });
  if (r.method === 'download') toast('Photo saved to Downloads / Files'); else if (r.method === 'share') toast('Shared');
}
function pickButtons({ idBase, label, onFile }) {
  // buttons + hidden file inputs (not inside a <label>). Library/camera chooser, and a second input with capture to open the camera directly.
  const lib = h('input', { type: 'file', accept: 'image/*', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true', 'data-testid': idBase + '-file' });
  const cam = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true', 'data-testid': idBase + '-cam' });
  for (const inp of [lib, cam]) inp.addEventListener('change', async () => { const f = inp.files && inp.files[0]; inp.value = ''; if (f) await onFile(f); });
  return [h('button', { type: 'button', class: 'btn small', 'data-testid': idBase + '-choose', onClick: () => lib.click() }, label.choose), h('button', { type: 'button', class: 'btn small', 'data-testid': idBase + '-take', onClick: () => cam.click() }, label.take), lib, cam];
}
/** the "Photo" block of the vehicle detail sheet (works for trailers too). redraw() re-renders the detail. */
export function photoSection(v, redraw) {
  const vk = vehicleKeyOf(v), mk = modelPhotoKey(v.model); const eff = effectivePhoto(v); const own = vk && hasPhoto(vk); const mph = mk && hasPhoto(mk);
  const sec = h('section', { class: 'card photo-card', 'data-testid': 'v-photo-section' }, h('h3', null, 'Photo'));
  const busy = async (fn, ok) => { try { toast('Saving photo…'); await fn(); commit(); toast(ok); redraw(); } catch (e) { console.error(e); toast('Could not use that picture: ' + ((e && e.message) || 'storage error'), 'bad'); } };
  const prev = vthumb(v, { size: 'lg' });
  if (prev) sec.append(h('button', { type: 'button', class: 'photo-prev', 'data-testid': 'v-photo-open', 'aria-label': 'View photo full size', onClick: () => openPhotoViewer(v) }, prev));
  sec.append(h('p', { class: 'hint', 'data-testid': 'v-photo-status' }, own ? `This vehicle's own photo (${fmtBytes(photoMeta(vk).bytes)}). Tap it for full size.` : eff ? `Showing the model photo for ${v.model}. Add this vehicle's own photo to override it.` : 'No photo yet. One photo per vehicle or trailer is enough to see what it is at a glance.'));
  sec.append(h('div', { class: 'row' }, ...pickButtons({ idBase: 'v-photo', label: { choose: own ? 'Replace photo' : 'Choose photo', take: 'Take photo' }, onFile: (f) => busy(() => setVehiclePhoto(v, f), 'Photo saved') }),
    own ? h('button', { type: 'button', class: 'btn small danger', 'data-testid': 'v-photo-remove', onClick: async () => { await removePhoto(vk); commit(); toast('Photo removed'); redraw(); } }, 'Remove photo') : null,
    eff ? h('button', { type: 'button', class: 'btn small', 'data-testid': 'v-photo-share', onClick: () => sharePhoto(v) }, 'Share photo') : null));
  if (mk) {
    const m = h('div', { class: 'model-photo', 'data-testid': 'v-model-photo' }, h('b', null, `Model photo: ${v.model}`), h('small', { class: 'hint', 'data-testid': 'v-model-photo-status' }, mph ? 'Set. Every vehicle of this model without its own photo shows it.' : 'Not set. Set it once and every vehicle of this model without its own photo shows it.'));
    m.append(h('div', { class: 'row' }, ...pickButtons({ idBase: 'v-mphoto', label: { choose: mph ? 'Replace model photo' : 'Set model photo', take: 'Take model photo' }, onFile: (f) => busy(() => setModelPhoto(v.model, f), 'Model photo saved') }),
      own && !mph ? h('button', { type: 'button', class: 'btn small', 'data-testid': 'v-mphoto-from-vehicle', onClick: async () => { const blob = await getPhotoBlob(vk, 'full'); await busy(() => setModelPhoto(v.model, blob), 'Model photo set from this vehicle'); } }, 'Use this photo for the model') : null,
      mph ? h('button', { type: 'button', class: 'btn small danger', 'data-testid': 'v-mphoto-remove', onClick: async () => { await removePhoto(mk); commit(); toast('Model photo removed'); redraw(); } }, 'Remove model photo') : null));
    sec.append(m);
  }
  return sec;
}
