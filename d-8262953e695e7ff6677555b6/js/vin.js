// VIN / serial lookup and LIN suggestions (pure logic, no DOM).
// Honest limit: a LIN cannot be derived from a VIN. A VIN only identifies a vehicle that is already in the fleet list; for a new VIN the app can
// only SUGGEST a LIN from other fleet vehicles of the same model (a LIN is assigned per equipment type), and the user must confirm it.
import { clean, normKeyText } from './util.js';
import { vehIds, modelLookup, modelInfo, vehicleView } from './rules.js';
import { resolveTm, tmPubs } from './tmdata.js';

/** case / space / dash insensitive VIN key ("1hg cm82-633a" -> "1HGCM82633A") */
export const vinKey = (s) => String(s ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
/** fleet vehicle whose VIN / serial (manual value wins over GCSS) equals the typed one. exceptKey skips one vehicle (e.g. the one being edited). */
export function findByVin(fleet, vin, { exceptKey = '' } = {}) {
  const k = vinKey(vin); if (k.length < 4) return null;
  return fleet.find((v) => v.key !== exceptKey && (vinKey(vehIds(v).vin) === k || vinKey(v.serial) === k || vinKey(v.vinSet) === k)) || null;
}
/** LIN suggestion for a model: the most common LIN among fleet vehicles of that model (or, failing that, of the same type name). null if none known. */
export function suggestLin(fleet, model, settings, { exceptKey = '' } = {}) {
  const m = clean(model).toUpperCase(); if (!m) return null;
  const lookup = modelLookup(settings); const myType = modelInfo(m, lookup).type;
  const tally = (pred) => { const c = new Map(); for (const v of fleet) { if (v.key === exceptKey) continue; const l = vehIds(v).lin; if (l && pred(v)) c.set(l, (c.get(l) || 0) + 1); } return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])); };
  let r = tally((v) => clean(v.model).toUpperCase() === m); let basis = 'model ' + m;
  if (!r.length && !/^UNMAPPED/.test(myType)) { r = tally((v) => modelInfo(v.model, lookup).type === myType); basis = 'type ' + myType; }
  return r.length ? { lin: r[0][0], count: r[0][1], basis, distinct: r.length } : null;
}
/** everything a 5988-E header takes from a fleet vehicle (the same set whether the form starts from the vehicle or from a typed VIN) */
export function headerFromVehicle(v, ctx, st) {
  const ids = vehIds(v); const vw = vehicleView(v, ctx); const tm = resolveTm(v, { tmByModel: st.tmByModel, tmByType: st.tmByType, typeName: vw.type });
  const unit = String((st.settings && st.settings.unitUic) || '').trim(); const vu = clean(v.uic);
  const pubs = tm && tm.resolved ? tmPubs(tm, 2) : null;
  return { vehicleKey: v.key, vehicleId: v.vid || '', adminNumber: v.short || v.bumper || '', serial: ids.vin, lin: ids.lin, model: v.model || '', noun: v.desc || '', nsn: v.nsn || '', registration: v.registration || '',
    uic: vu && vu !== unit ? vu : '', pubs, pmcsRef: tm && tm.resolved && tm.pmcs ? tm.pmcs : '' };
}
export const normModelText = normKeyText;
