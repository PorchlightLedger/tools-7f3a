// GCSS-Army equipment export: parsing (CSV / pasted text / xlsx rows) and merge into the fleet
import { clean, normKeyText, parseDateLoose, todayISO } from './util.js';
import { parseDelimited } from './csv.js';
import { normBumper, shortBumper, vehicleStatus, modelLookup, modelInfo, turnedInKeys, VEHICLE_STATUSES } from './rules.js';

const COLS = {
  adminno: 'bumper', adminnumber: 'bumper', adminnr: 'bumper', bumper: 'bumper', bumpernumber: 'bumper',
  materialdescription: 'desc', description: 'desc', materialdesc: 'desc',
  modelnumber: 'model', model: 'model',
  operationalstatus: 'status', opstatus: 'status', operationalsts: 'status',
  equipment: 'asset', equipmentnumber: 'asset', assetno: 'asset', assetnumber: 'asset',
  serialnumber: 'serial', serial: 'serial', serialno: 'serial',
  functionallocation: 'funcLoc', funcloc: 'funcLoc',
  remark: 'remark', remarks: 'remark',
  unitidentificationcode: 'uic', uic: 'uic',
  statusstrctdesc: 'gcssDesc', statusstructuredesc: 'gcssDesc', statusstrctdescription: 'gcssDesc',
  registrationnumber: 'registration', registration: 'registration',
  userstatus: 'userStatus', storagelocation: 'storageLoc', linnumber: 'lin', lin: 'lin', material: 'nsn', workcenter: 'workCenter',
};
export function findGcssHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const map = {}; rows[i].forEach((c, j) => { const f = COLS[normKeyText(c)]; if (f && !(f in map)) map[f] = j; });
    if ('bumper' in map && ('status' in map || 'model' in map)) return { index: i, map };
  }
  return null;
}
function cleanAsset(v) { let s = clean(v).replace(/^'+/, ''); if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, ''); return s; }
function cleanStatus(raw) { return clean(raw).toUpperCase(); }
const isTotalsRow = (b) => /^(total|totals|result|overall result|grand total|count)\b/i.test(b);

/** rows: array of arrays of strings. Returns {vehicles, issues, header} or throws a friendly Error */
export function parseGcssRows(rows, settings) {
  const h = findGcssHeader(rows);
  if (!h) throw new Error('Could not find a header row with "Admin No." and "Operational Status" / "Model number". Export the equipment list from GCSS-Army with those columns, or paste it including the header row.');
  const { index, map } = h; const g = (r, f) => (f in map ? r[map[f]] ?? '' : '');
  const issues = { rows: 0, duplicates: [], noBumper: 0, unrecognizedStatus: [], repeatedHeaders: 0, totalsRows: 0, blankStatus: [], missingColumns: [] };
  for (const need of ['status', 'model', 'asset', 'serial', 'desc', 'funcLoc']) if (!(need in map)) issues.missingColumns.push(need);
  const seenKey = new Map(), seenAsset = new Map(); const vehicles = [];
  for (let i = index + 1; i < rows.length; i++) {
    const r = rows[i]; if (!r || !r.some((c) => clean(c))) continue;
    const bumper = clean(g(r, 'bumper'));
    if (!bumper) { if (r.some((c) => clean(c))) issues.noBumper++; continue; }
    if (normKeyText(bumper) === 'adminno' || normKeyText(bumper) === 'adminnumber') { issues.repeatedHeaders++; continue; }
    const firstCell = clean(r.find((c) => clean(c)) ?? '');
    if (isTotalsRow(bumper) || isTotalsRow(firstCell) || (/^\d+$/.test(bumper) && !clean(g(r, 'model')) && !clean(g(r, 'status')))) { issues.totalsRows++; continue; }
    const uic = clean(g(r, 'uic')); const key = normBumper(bumper, settings.prefixes, uic); if (!key) { issues.noBumper++; continue; }
    issues.rows++;
    if (seenKey.has(key)) { issues.duplicates.push(shortBumper(bumper, settings.prefixes, uic)); continue; }
    const asset = cleanAsset(g(r, 'asset')); if (asset && seenAsset.has(asset)) { issues.duplicates.push(shortBumper(bumper, settings.prefixes, uic) + ' (same asset #)'); continue; }
    const st = cleanStatus(g(r, 'status'));
    const v = {
      key, bumper, short: shortBumper(bumper, settings.prefixes, uic), uic, desc: clean(g(r, 'desc')), model: clean(g(r, 'model')), gcss: st, asset, serial: clean(g(r, 'serial')),
      registration: clean(g(r, 'registration')), funcLoc: clean(g(r, 'funcLoc')), gcssDesc: clean(g(r, 'gcssDesc')), userStatus: clean(g(r, 'userStatus')), storageLoc: clean(g(r, 'storageLoc')), remark: clean(g(r, 'remark')), nsn: clean(g(r, 'nsn')),
    };
    if (!st) issues.blankStatus.push(v.short); else if (!VEHICLE_STATUSES.includes(st)) issues.unrecognizedStatus.push(`${v.short}: ${st}`);
    seenKey.set(key, true); if (asset) seenAsset.set(asset, true); vehicles.push(v);
  }
  if (!vehicles.length) throw new Error('Header found but no vehicle rows below it.');
  return { vehicles, issues, header: map };
}
export function parseGcssText(text, settings) { return parseGcssRows(parseDelimited(text), settings); }

/**
 * Merge a parsed export into the existing fleet. GCSS fields are replaced; user fields (notes, location, nmcSince, override) are kept.
 * returns {fleet, report}
 */
export function mergeGcss(existing, parsed, settings, { exportDate = '', now = new Date() } = {}) {
  const today = todayISO(now); const stamp = parseDateLoose(exportDate) || today;
  const byKey = new Map(existing.map((v) => [v.key, v])); const byAsset = new Map(existing.filter((v) => v.asset).map((v) => [v.asset, v]));
  const used = new Set(); const out = []; const rep = { total: parsed.vehicles.length, added: [], updated: 0, unchanged: 0, statusChanges: [], missing: [], overridesDiffer: [], overridesResolved: [], xVehicles: [], xButFmc: [], turnedInStill: [], unmapped: [], notDispatchable: 0, issues: parsed.issues };
  const lookup = modelLookup(settings); const tk = turnedInKeys(settings);
  for (const nv of parsed.vehicles) {
    let old = byKey.get(nv.key) || (nv.asset && byAsset.get(nv.asset)) || null; if (old && used.has(old.key)) old = null;
    let rec;
    if (old) {
      used.add(old.key);
      const prevStatus = vehicleStatus(old, settings).status;
      rec = { ...old, ...nv, key: nv.key, notes: old.notes || '', location: old.location || '', nmcSince: old.nmcSince || '', override: old.override || null, walkAt: old.walkAt || '', inExport: true, lastImport: stamp };
      const newStatus = vehicleStatus(rec, settings).status;
      if (rec.override) {
        const o = String(rec.override.status).toUpperCase();
        if (o === nv.gcss) { rec.override = null; rep.overridesResolved.push(nv.short); } else rep.overridesDiffer.push(`${nv.short}: local ${o} vs GCSS ${nv.gcss || 'blank'}`);
      }
      const st2 = vehicleStatus(rec, settings).status;
      if (prevStatus !== st2) {
        rep.statusChanges.push(`${nv.short}: ${prevStatus} -> ${st2}`);
        const wasNmc = ['NMCM', 'NMCS', 'NMC-X'].includes(prevStatus), nowNmc = ['NMCM', 'NMCS', 'NMC-X'].includes(st2);
        if (!wasNmc && nowNmc && !rec.nmcSince) { rec.nmcSince = stamp; rec.nmcSinceAuto = true; }
        if (!nowNmc && st2 === 'FMC') { rec.nmcSince = ''; rec.nmcSinceAuto = false; }
      } else if (newStatus === st2 && JSON.stringify([old.desc, old.model, old.serial, old.funcLoc, old.remark, old.gcss, old.gcssDesc, old.asset]) === JSON.stringify([nv.desc, nv.model, nv.serial, nv.funcLoc, nv.remark, nv.gcss, nv.gcssDesc, nv.asset])) rep.unchanged++;
      rep.updated++;
    } else {
      rec = { ...nv, notes: '', location: '', nmcSince: '', override: null, walkAt: '', inExport: true, lastImport: stamp };
      const s0 = vehicleStatus(rec, settings).status; if (['NMCM', 'NMCS', 'NMC-X'].includes(s0)) { rec.nmcSince = ''; }
      rep.added.push(nv.short);
    }
    out.push(rec);
  }
  for (const v of existing) if (!used.has(v.key)) { out.push({ ...v, inExport: false, gcss: '' }); if (!tk.has(v.key)) rep.missing.push(v.short || v.bumper); }
  for (const v of out) {
    const s = vehicleStatus(v, settings);
    if (s.status === 'NMC-X') { rep.xVehicles.push(v.short); if (s.flags.some((f) => f.startsWith('X VEHICLE BUT'))) rep.xButFmc.push(v.short); }
    if (s.status === 'TURNED IN' && v.inExport !== false) rep.turnedInStill.push(v.short);
    const mi = modelInfo(v.model, lookup); if (!mi.mapped && s.status !== 'TURNED IN') rep.unmapped.push(`${v.short} (${v.model || 'no model'})`);
    if (clean(v.gcssDesc).toUpperCase() === 'NOT DISPATCHABLE') rep.notDispatchable++;
  }
  out.sort((a, b) => a.key.localeCompare(b.key, 'en', { numeric: true }));
  rep.exportDate = stamp; rep.unmappedModels = [...new Set(out.filter((v) => !modelInfo(v.model, lookup).mapped).map((v) => v.model || '(blank)'))];
  return { fleet: out, report: rep };
}
