// Photo UI pieces: list thumbnails, the single photo slot on the vehicle detail, model photo, full view, share.
import { h, openSheet, toast, clear, confirmBox } from './dom.js';
import { shareOrDownload } from './backup.js';
import { effectivePhoto, photoUrl, photoMeta, hasPhoto, vehicleKeyOf, modelPhotoKey, setVehiclePhoto, setModelPhoto, removePhoto, getPhotoBlob, fmtBytes, faultPhotoKeys, addFaultPhoto, FAULT_PHOTO_MAX } from './photos.js';
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

// ----- fault photos on the DA 5988-E worksheet (up to FAULT_PHOTO_MAX per fault; device only, never in the backup / xlsx) -----
export const FAULT_PHOTO_HELP = `Fault photos (up to ${FAULT_PHOTO_MAX} per fault) are stored only on this phone. They are NOT in the JSON backup or the spreadsheet. They go into the PDF only if you tick "Include fault photos page" before making it.`;
const faultNo = (f) => (/^\d+$/.test(String(f.item || '')) ? String(f.item).padStart(4, '0').slice(-4) : String(f.item || '?'));
/** view one fault photo full size, with previous / next when the fault has several */
export function openFaultPhotoViewer(form, fault, startKey) {
  const keys = faultPhotoKeys(form.id, fault.id); let i = Math.max(0, keys.indexOf(startKey)); if (!keys.length) return;
  openSheet({ title: `Fault ${faultNo(fault)} photo`, build: (b, api) => {
    const img = h('img', { class: 'photo-full', alt: '', 'data-testid': 'fault-photo-full' }); const cap = h('p', { class: 'hint', 'data-testid': 'fault-photo-caption' });
    const prev = h('button', { type: 'button', class: 'btn small', 'data-testid': 'fault-photo-prev', onClick: () => { i = (i + keys.length - 1) % keys.length; show(); } }, '‹ Previous');
    const next = h('button', { type: 'button', class: 'btn small', 'data-testid': 'fault-photo-next', onClick: () => { i = (i + 1) % keys.length; show(); } }, 'Next ›');
    const show = () => { img.removeAttribute('src'); img.alt = `Fault ${faultNo(fault)} photo ${i + 1} of ${keys.length}`; cap.textContent = `Fault ${faultNo(fault)}${fault.desc ? ' - ' + fault.desc : ''} (photo ${i + 1} of ${keys.length})`; photoUrl(keys[i], 'full').then((u) => { if (u) img.src = u; }); };
    b.append(img, cap, keys.length > 1 ? h('div', { class: 'row' }, prev, next) : null); show();
  } });
}
/** the photo strip of one fault line: thumbnails (tap = full size, X = remove) and the Add photo controls. Redraws itself; onChange() tells the worksheet to refresh its PDF option. */
export function faultPhotoStrip(form, fault, { onChange = () => {} } = {}) {
  const box = h('div', { class: 'fault-photos', 'data-testid': 'fault-photos', 'data-fault': fault.id }); let busy = false;
  const lib = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true', 'data-testid': 'fault-photo-file' });
  const cam = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true', 'data-testid': 'fault-photo-cam' });
  const add = async (files) => {
    if (busy || !files.length) return; busy = true; let added = 0, err = '';
    try { toast('Saving photo…'); for (const f of files) { try { await addFaultPhoto(form.id, fault.id, f); added++; } catch (e) { err = (e && e.message) || 'storage error'; break; } } }
    finally { busy = false; }
    if (err) toast((added ? `${added} saved. ` : '') + (/up to/.test(err) ? err : 'Could not use that picture: ' + err), 'bad'); else toast(added === 1 ? 'Photo added' : `${added} photos added`);
    redraw(); onChange();
  };
  for (const inp of [lib, cam]) inp.addEventListener('change', async () => { const fs = [...(inp.files || [])]; inp.value = ''; await add(fs); });
  const redraw = () => {
    clear(box); const keys = faultPhotoKeys(form.id, fault.id); const n = keys.length;
    const row = h('div', { class: 'fp-row' });
    keys.forEach((k, idx) => {
      const img = h('img', { class: 'vthumb-img', alt: '', draggable: 'false', 'data-testid': 'fault-photo-img' }); photoUrl(k, 'thumb').then((u) => { if (u) img.src = u; }).catch(() => {});
      row.append(h('span', { class: 'fphoto', 'data-testid': 'fault-photo', 'data-key': k },
        h('button', { type: 'button', class: 'fphoto-open', 'data-testid': 'fault-photo-open', 'aria-label': `View photo ${idx + 1} of fault ${faultNo(fault)} full size`, onClick: () => openFaultPhotoViewer(form, fault, k) }, img),
        h('button', { type: 'button', class: 'fphoto-x', 'data-testid': 'fault-photo-remove', 'aria-label': `Remove photo ${idx + 1} of fault ${faultNo(fault)}`, onClick: async () => {
          if (!(await confirmBox({ title: 'Remove this photo?', message: `Removes photo ${idx + 1} of fault ${faultNo(fault)} from this phone.`, okText: 'Remove photo', danger: true }))) return;
          await removePhoto(k); toast('Photo removed'); redraw(); onChange();
        } }, '✕')));
    });
    if (n < FAULT_PHOTO_MAX) row.append(h('button', { type: 'button', class: 'btn small', 'data-testid': 'fault-photo-take', onClick: () => cam.click() }, 'Add photo: camera'), h('button', { type: 'button', class: 'btn small', 'data-testid': 'fault-photo-choose', onClick: () => lib.click() }, 'Add photo: library'));
    box.append(row, h('small', { class: 'hint', 'data-testid': 'fault-photo-count' }, n ? `${n} of ${FAULT_PHOTO_MAX} photos` : 'No photos'), lib, cam);
  };
  redraw(); return box;
}
