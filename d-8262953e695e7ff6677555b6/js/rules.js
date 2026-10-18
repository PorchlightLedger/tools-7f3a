// Business rules (mirrors the spreadsheet system's rules). Pure functions - no DOM, no storage.
import { parseDateLoose, daysBetween, todayISO, clean, normKeyText, uid } from './util.js';

export const DEFAULT_PREFIXES = []; // optional extra prefixes to strip; a leading unit code before the final "A-123" style token is detected automatically
export const DEFAULT_TURNED_IN = []; // editable in Settings (turned in / off the books)
export const VEHICLE_STATUSES = ['FMC', 'NMCM', 'NMCS'];
export const TRIP_STATUSES = ['Planned', 'Out', 'Back', 'Cancelled'];

// GCSS Model number -> type -> qualification (like the workbook Setup sheet). Editable on the device.
// cls: Vehicle (dispatchable alone) | Towed (trailer / towed item) | Mounted (cannot be dispatched alone)
// qual: exact qualification name, or NONE
export const DEFAULT_MODEL_MAP = [
  ['M1151A1', 'HMMWV (M1151)', 'HMMWV (M1151)', 'Vehicle'], ['M1151', 'HMMWV (M1151)', 'HMMWV (M1151)', 'Vehicle'],
  ['M1152', 'HMMWV (M1152)', 'HMMWV (M1152)', 'Vehicle'], ['M1152A1', 'HMMWV (M1152)', 'HMMWV (M1152)', 'Vehicle'],
  ['M1165A1', 'HMMWV (M1165)', 'HMMWV (M1165)', 'Vehicle'], ['M1165', 'HMMWV (M1165)', 'HMMWV (M1165)', 'Vehicle'],
  ['M1097', 'HMMWV (M1097)', 'HMMWV (M1097)', 'Vehicle'], ['M1097A2', 'HMMWV (M1097)', 'HMMWV (M1097)', 'Vehicle'],
  ['M1078A1', 'LMTV (M1078)', 'LMTV (M1078)', 'Vehicle'], ['M1078A1P2WW', 'LMTV (M1078)', 'LMTV (M1078)', 'Vehicle'], ['M1078A1P2WOW', 'LMTV (M1078)', 'LMTV (M1078)', 'Vehicle'],
  ['M1157A1P2WW', '10T Dump (M1157)', '10T Dump (M1157)', 'Vehicle'], ['M1157A1P2WOW', '10T Dump (M1157)', '10T Dump (M1157)', 'Vehicle'],
  ['M1088A1', 'Tractor Truck (M1088)', 'Tractor Truck (M1088)', 'Vehicle'],
  ['M983A4LET', 'HEMTT LET (M983)', 'HEMTT LET (M983)', 'Vehicle'],
  ['TP I HMEE-I', 'HMEE', 'HMEE', 'Vehicle'],
  ['924HLTLDR', '924H Loader', '924H Loader', 'Vehicle'], ['TYPE II', 'D7 Dozer', 'D7 Dozer', 'Vehicle'], ['120M', '120M Grader', '120M Grader', 'Vehicle'],
  ['M400W', 'Skid Steer (M400W)', 'Skid Steer (M400W)', 'Vehicle'], ['DV100', 'DEUCE (DV100)', 'DEUCE (DV100)', 'Vehicle'],
  ['M870A3', 'Low Boy TRL (M870)', 'Low Boy TRL (M870)', 'Towed'], ['M1101', 'Cargo TRL (M1101)', 'Cargo TRL (M1101)', 'Towed'],
  ['M1095', 'Flatbed TRL (M1095)', 'Flatbed TRL (M1095)', 'Towed'], ['M149A2', 'Water Buffalo (M149)', 'Water Buffalo (M149)', 'Towed'],
  ['MEP831', 'Generator Set (MEP831)', 'NONE', 'Towed'], ['PU-2001', 'Generator Set (PU-2001)', 'NONE', 'Towed'],
  ['60201886-03', 'Armament (M153)', 'NONE', 'Mounted'],
].map(([model, type, qual, cls]) => ({ model, type, qual, cls }));

export const DEFAULT_PERSON_STATUSES = [
  { name: 'Active', available: true },
  { name: 'Deployed', available: false },
  { name: 'Inactive', available: false },
];
export const DEFAULT_PLATOONS = ['HQ', '1st', '2nd', '3rd', 'Supply'];
export const FLAG_FIELDS = ['ammo', 'hazmat', 'nvd'];

export function defaultSettings() {
  return {
    recipient: '', unitName: '', dispatcherDefault: '', unitUic: '', platoonRules: [],
    licenseWindow: 30, tcRule: 'WARN', tcQualWarn: false, pmcsRule: 'WARN', gcssIdRule: 'WARN',
    agingAmber: 30, agingRed: 90, gcssStaleDays: 7, asOfOverride: '',
    prefixes: [...DEFAULT_PREFIXES], turnedIn: [...DEFAULT_TURNED_IN],
    modelMap: DEFAULT_MODEL_MAP.map((m) => ({ ...m })), statuses: DEFAULT_PERSON_STATUSES.map((s) => ({ ...s })), platoons: [...DEFAULT_PLATOONS],
    extraQuals: [], xlsxIncludeRoster: false, xlsxIncludeFleet: true, showEPrefix: false, platoonExcludeX: true,
  };
}

// ---------- bumper keys ----------
/** Auto-detect: anything before a final "A-123" style token (letters, hyphen, digits, optional letters), separated by space/dash, is a unit prefix.
 *  "WXYZ12 A-362X" -> "A-362X", "WXYZ12-A-101" -> "A-101". Returns null when there is no such leading part. */
const TAIL_RE = /^(.*?[A-Za-z0-9])[\s\u00a0-]+([A-Za-z]{1,2}\s*-\s*\d+[A-Za-z]{0,3})$/;
// letters directly followed by digits (e.g. "SPT122") only count as the bumper when what comes before looks like a UIC (4+ chars incl. a digit);
// that keeps "A-SPT122" (no UIC in front) intact.
const TAIL_RE2 = /^(.{3,}?\d[A-Za-z0-9]*)[\s\u00a0-]+([A-Za-z]{2,4}\d+[A-Za-z]{0,3})$/;
function autoTail(raw) { const t = String(raw ?? '').trim(); const m = TAIL_RE.exec(t); if (m) return m[2]; const m2 = TAIL_RE2.exec(t); return m2 ? m2[2] : null; }
export function normBumper(s, prefixes = DEFAULT_PREFIXES, uic = '') {
  let k = String(s ?? '').replace(/[\s\u00a0\-]/g, '').toUpperCase();
  const pf = [...prefixes, uic].map((p) => String(p || '').replace(/[\s\u00a0\-]/g, '').toUpperCase()).filter(Boolean).sort((a, b) => b.length - a.length);
  for (const p of pf) if (k.startsWith(p) && k.length > p.length) return k.slice(p.length);
  const t = autoTail(s); return t ? t.replace(/[\s\u00a0\-]/g, '').toUpperCase() : k;
}
/** display form: unit prefix removed, e.g. "WXYZ12 A-362X" -> "A-362X" */
export function shortBumper(s, prefixes = DEFAULT_PREFIXES, uic = '') {
  let t = clean(s);
  const pf = [...prefixes, uic].map((p) => String(p || '').trim()).filter(Boolean).sort((a, b) => b.length - a.length);
  for (const p of pf) { if (t.toUpperCase().startsWith(p.toUpperCase()) && t.length > p.length) return t.slice(p.length).replace(/^[\s\-:]+/, ''); }
  const a = autoTail(t); return a ? a.replace(/\s*-\s*/, '-') : t;
}
/** The X rule: bumper ends in digit + X (A-362X). A-002G, A-011T, A-X10, A-12XX are NOT X. */
export function isXBumper(s, prefixes = DEFAULT_PREFIXES, uic = '') { return /[0-9]X$/.test(normBumper(s, prefixes, uic)); }

export function turnedInKeys(settings) { return new Set((settings.turnedIn || []).map((b) => normBumper(b, settings.prefixes)).filter(Boolean)); }
export function isTurnedIn(v, settings) { return turnedInKeys(settings).has(v.key); }

// ---------- platoon rules (generic: pattern -> label, first match wins, editable in Settings) ----------
/** One rule = {label, pattern}. pattern kinds:
 *   num<100 | num>=200 | num=5 | num 100-199, 1000-1999   numeric value of the FIRST digit run in the bumper (A-362X -> 362)
 *   re:<regex>                                                  case-insensitive regular expression on the short bumper
 *   glob: * any text, ? one char, # one digit, e.g. A-1##*       (matched against the short bumper, with or without hyphen)
 */
export function compilePlatoonRule(rule) {
  const label = clean(rule && rule.label), pat = clean(rule && rule.pattern);
  if (!label) return { error: 'missing platoon label', label, pattern: pat };
  if (!pat) return { error: 'missing pattern', label, pattern: pat };
  try {
    if (/^re:/i.test(pat)) { const re = new RegExp(pat.slice(3).trim(), 'i'); return { label, pattern: pat, test: (b) => re.test(b) }; }
    if (/^num\b/i.test(pat)) {
      const conds = pat.replace(/^num/i, '').split(/,|\bor\b/i).map((c) => c.trim()).filter(Boolean).map((c) => {
        let m; if ((m = /^(<=|>=|<|>|=)\s*(\d+)$/.exec(c))) { const n = +m[2]; return { '<': (x) => x < n, '<=': (x) => x <= n, '>': (x) => x > n, '>=': (x) => x >= n, '=': (x) => x === n }[m[1]]; }
        if ((m = /^(\d+)\s*-\s*(\d+)$/.exec(c))) { const a = +m[1], b = +m[2]; return (x) => x >= a && x <= b; }
        if ((m = /^(\d+)$/.exec(c))) { const n = +m[1]; return (x) => x === n; }
        throw new Error('cannot read "' + c + '"');
      });
      if (!conds.length) throw new Error('no condition');
      return { label, pattern: pat, test: (b) => { const m = /\d+/.exec(b); if (!m) return false; const n = parseInt(m[0], 10); return conds.some((f) => f(n)); } };
    }
    const re = new RegExp('^' + pat.replace(/[.+^${}()|[\]\\-]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.').replace(/#/g, '\\d') + '$', 'i');
    return { label, pattern: pat, test: (b) => re.test(b) || re.test(b.replace(/[\s\-]/g, '')) };
  } catch (e) { return { error: String(e.message || e), label, pattern: pat }; }
}
const _prCache = new WeakMap();
export function compiledPlatoonRules(settings) {
  const rules = (settings && settings.platoonRules) || []; if (!Array.isArray(rules)) return [];
  let c = _prCache.get(rules); if (c && c.n === rules.length && c.sig === JSON.stringify(rules)) return c.list;
  const list = rules.map(compilePlatoonRule); _prCache.set(rules, { n: rules.length, sig: JSON.stringify(rules), list }); return list;
}
export function platoonRuleErrors(settings) { return compiledPlatoonRules(settings).filter((r) => r.error).map((r) => `${r.label || '(no label)'} | ${r.pattern}: ${r.error}`); }
/** platoon label of a short bumper text by rules; '' when nothing matches */
export function platoonByRules(short, settings) { const b = clean(short).toUpperCase(); for (const r of compiledPlatoonRules(settings)) if (!r.error && r.test(b)) return r.label; return ''; }
/** a manual per-vehicle platoon wins over the rules */
export function vehiclePlatoon(v, settings) {
  if (clean(v.platoonSet)) return clean(v.platoonSet);
  // permanent-NMC (X suffix) vehicles stay out of platoons unless the toggle is off (a platoon set by hand always wins)
  if (settings.platoonExcludeX !== false && isXBumper(v.bumper || v.short || '', settings.prefixes, v.uic)) return '';
  return platoonByRules(v.short || v.bumper, settings);
}
/** distinct platoon labels in rule order (for filters) */
export function platoonLabels(settings) { const seen = []; for (const r of compiledPlatoonRules(settings)) if (!r.error && !seen.includes(r.label)) seen.push(r.label); return seen; }
export function platoonText(rules) { return (rules || []).map((r) => `${r.label} | ${r.pattern}`).join('\n'); }
export function parsePlatoonText(text) { return String(text || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => { const i = l.indexOf('|'); return i < 0 ? { label: l, pattern: '' } : { label: l.slice(0, i).trim(), pattern: l.slice(i + 1).trim() }; }); }

// ---------- vehicle identifiers ----------
/** VIN / serial and LIN, with manual edits winning over the GCSS values */
export function vehIds(v) { return { vin: clean(v.vinSet) || clean(v.serial), lin: clean(v.linSet) || clean(v.lin) }; }
export const idLine = (v) => { const { vin, lin } = vehIds(v); return [lin ? `LIN ${lin}` : '', vin ? `VIN/Serial ${vin}` : ''].filter(Boolean).join(' · '); };

// ---------- model map ----------
export function modelLookup(settings) {
  const m = new Map(); for (const r of settings.modelMap || []) { const k = clean(r.model).toUpperCase(); if (k && !m.has(k)) m.set(k, r); } return m;
}
/** -> {type, qual, cls, mapped, ruleOk} ; ruleOk=false => fail closed (cannot dispatch) */
export function modelInfo(model, lookup) {
  const r = lookup.get(clean(model).toUpperCase());
  if (!r) return { type: `UNMAPPED (${clean(model) || 'no model'})`, qual: null, cls: 'Unmapped', mapped: false, ruleOk: false, ruleProblem: 'MODEL NOT IN TYPE MAP (add it in Settings > Type map)' };
  const qual = clean(r.qual); const type = clean(r.type);
  if (!type) return { type: `UNMAPPED (${clean(model)})`, qual: null, cls: r.cls || 'Vehicle', mapped: false, ruleOk: false, ruleProblem: 'TYPE NAME MISSING IN TYPE MAP' };
  if (!qual) return { type, qual: null, cls: r.cls || 'Vehicle', mapped: true, ruleOk: false, ruleProblem: `NO QUALIFICATION RULE FOR ${type} (type map). Enter a qualification name or NONE` };
  return { type, qual: qual.toUpperCase() === 'NONE' ? 'NONE' : qual, cls: r.cls || 'Vehicle', mapped: true, ruleOk: true };
}

// ---------- vehicle status ----------
/** Precedence: TURNED IN > NMC-X > local override > GCSS > UNKNOWN / NO STATUS */
export function vehicleStatus(v, settings) {
  const out = { status: 'NO STATUS', source: 'none', flags: [] };
  const x = isXBumper(v.bumper, settings.prefixes, v.uic);
  const g = String(v.gcss || '').trim().toUpperCase();
  const ov = v.override && VEHICLE_STATUSES.includes(String(v.override.status).toUpperCase()) ? String(v.override.status).toUpperCase() : '';
  if (turnedInKeys(settings).has(v.key)) { out.status = 'TURNED IN'; out.source = 'turned-in'; if (v.inExport !== false && g) out.flags.push('TURNED IN BUT STILL IN GCSS'); return out; }
  if (x) { out.status = 'NMC-X'; out.source = 'x'; if (g === 'FMC') out.flags.push('X VEHICLE BUT GCSS SHOWS FMC'); return out; }
  if (ov) {
    out.status = ov; out.source = 'override';
    if (VEHICLE_STATUSES.includes(g) && g !== ov) out.flags.push(`LOCAL STATUS ${ov} DIFFERS FROM GCSS (${g})`);
    else if (!g) out.flags.push('LOCAL STATUS - NOT IN GCSS');
    return out;
  }
  if (VEHICLE_STATUSES.includes(g)) { out.status = g; out.source = 'gcss'; return out; }
  if (g) { out.status = 'UNKNOWN'; out.source = 'gcss'; out.flags.push(`UNRECOGNIZED GCSS STATUS "${v.gcss}"`); return out; }
  out.status = 'NO STATUS'; out.flags.push(v.inExport === false ? 'NOT IN LATEST GCSS EXPORT' : 'NO STATUS'); return out;
}
export const isNMC = (st) => st === 'NMCM' || st === 'NMCS' || st === 'NMC-X';

export function daysNMC(v, st, asOf) {
  if (!isNMC(st)) return null; const d = parseDateLoose(v.nmcSince); if (!d) return null; const n = daysBetween(d, asOf); return n < 0 ? 0 : n;
}
export function nmcAging(days, settings) { if (days == null) return ''; return days >= settings.agingRed ? 'red' : days >= settings.agingAmber ? 'amber' : ''; }

export function asOfDate(settings, now = new Date()) { return parseDateLoose(settings.asOfOverride) || todayISO(now); }

// ---------- trips / busy ----------
export const isActiveTrip = (t) => t.status === 'Planned' || t.status === 'Out';
/** Do two trips collide? same rule for vehicles, towed items and people. */
export function tripsOverlap(a, b) {
  if (!isActiveTrip(a) || !isActiveTrip(b)) return false;
  if (a.status === 'Out' || b.status === 'Out') return true;
  if (!a.dateOut || !b.dateOut) return true;
  return a.dateOut === b.dateOut;
}
// ---------- trip shape: header + ordered vehicle entries (schema 2) ----------
// trip = {id, no, chalk, status, dateOut, timeOut, dateBack, timeBack, dest, dispatcher, notes, entries:[entry]}
// entry = {id, vehicle (fleet key), vid (fleet vehicle id), driver, tc, pax[], towed[], pmcs}
// Old (schema 1) trips carried vehicle/driver/tc/pax/towed/pmcs on the trip itself; tripEntries() reads either shape.
export const newEntry = (o = {}) => ({ id: uid('e'), vehicle: '', vid: '', driver: '', tc: '', pax: [], towed: [], pmcs: false, ...o });
export function tripEntries(t) {
  if (Array.isArray(t.entries)) return t.entries;
  return [{ id: (t.id || 't') + '-e1', vehicle: t.vehicle || '', vid: t.vid || '', driver: t.driver || '', tc: t.tc || '', pax: t.pax || [], towed: t.towed || [], pmcs: t.pmcs === true }];
}
/** convert a schema-1 trip in place to the entries shape (no data dropped; unknown extra fields stay) */
export function migrateTrip(t) {
  if (!t || typeof t !== 'object') return t;
  if (!Array.isArray(t.entries)) {
    const legacy = tripEntries(t)[0]; t.entries = (legacy.vehicle || legacy.driver || legacy.tc || legacy.pax.length || legacy.towed.length) ? [{ ...legacy, id: uid('e'), pax: [...legacy.pax], towed: [...legacy.towed] }] : [];
    for (const k of ['vehicle', 'vid', 'driver', 'tc', 'pax', 'towed', 'pmcs']) delete t[k];
  }
  for (const e of t.entries) { if (!e.id) e.id = uid('e'); if (!Array.isArray(e.pax)) e.pax = []; if (!Array.isArray(e.towed)) e.towed = []; for (const k of ['vehicle', 'vid', 'driver', 'tc']) if (typeof e[k] !== 'string') e[k] = ''; e.pmcs = e.pmcs === true; }
  if (!t.id) t.id = uid('t'); t.sv = 2; return t;
}
export function tripPeople(t) { return tripEntries(t).flatMap((e) => [['Driver', e.driver], ['TC / A-driver', e.tc], ...(e.pax || []).map((p, i) => [`Pax ${i + 1}`, p])]).filter(([, id]) => id); }
export function entryPeople(e) { return [['Driver', e.driver], ['TC / A-driver', e.tc], ...(e.pax || []).map((p, i) => [`Pax ${i + 1}`, p])].filter(([, id]) => id); }
export function tripVehicleKeys(t) { return tripEntries(t).flatMap((e) => [e.vehicle, ...(e.towed || [])]).filter(Boolean); }
/** keys of the primary vehicles (not trailers) on a trip */
export function tripMainKeys(t) { return tripEntries(t).map((e) => e.vehicle).filter(Boolean); }
/** other active trips that collide with `cand` and use this vehicle/towed key */
export function vehicleConflicts(key, cand, trips) { return trips.filter((t) => t.id !== cand.id && tripsOverlap(t, cand) && tripVehicleKeys(t).includes(key)); }
export function personConflicts(id, cand, trips) { return trips.filter((t) => t.id !== cand.id && tripsOverlap(t, cand) && tripPeople(t).some(([, pid]) => pid === id)); }

// ---------- roster ----------
export function normStatusName(raw, settings) {
  const n = normKeyText(raw); if (!n) return '';
  for (const s of settings.statuses) if (normKeyText(s.name) === n) return s.name;
  const aliases = { deployed: 'deployedtitle10', title10: 'deployedtitle10', t10: 'deployedtitle10', deployedt10: 'deployedtitle10' };
  const a = aliases[n]; if (a) for (const s of settings.statuses) if (normKeyText(s.name) === a) return s.name;
  return clean(raw);
}
export function personAvailable(p, settings) { const s = settings.statuses.find((x) => normKeyText(x.name) === normKeyText(p.status)); return !!(s && s.available); }
export function isActivePerson(p, settings) { return personAvailable(p, settings); }
/** license state at evalDate: MISSING | INVALID | EXPIRED | EXPIRING | OK. Expiry date itself is still valid. */
export function licenseState(p, evalDate, window = 30) {
  if (p.licExpRaw && !p.licExp) return 'INVALID';
  if (!p.licExp) return 'MISSING';
  const d = parseDateLoose(p.licExp); if (!d) return 'INVALID';
  if (d < evalDate) return 'EXPIRED';
  return daysBetween(evalDate, d) <= window ? 'EXPIRING' : 'OK';
}
export const hasQual = (p, qual) => !!qual && (p.quals || []).some((q) => normKeyText(q) === normKeyText(qual));
export function personName(p) { return p ? `${p.last || ''}${p.first ? ', ' + p.first : ''}`.trim() || p.id : ''; }
export function personLabel(p) { return p ? `${p.rank ? p.rank + ' ' : ''}${personName(p)}` : ''; }
export const missingGcssId = (p) => !clean(p.gcssId);
export function gcssIdStats(roster, settings) {
  const active = roster.filter((p) => isActivePerson(p, settings)); const missing = active.filter(missingGcssId);
  return { active: active.length, missing: missing.length, total: roster.length };
}

// ---------- fleet view / counts ----------
export function buildContext({ settings, fleet, roster, trips, now = new Date() }) {
  const asOf = asOfDate(settings, now);
  return { settings, asOf, trips: trips || [], fleet: fleet || [], roster: roster || [], lookup: modelLookup(settings), fleetByKey: new Map((fleet || []).map((v) => [v.key, v])), rosterById: new Map((roster || []).map((p) => [p.id, p])) };
}
export function vehicleView(v, ctx) {
  const s = vehicleStatus(v, ctx.settings); const mi = modelInfo(v.model, ctx.lookup);
  const gnd = clean(v.gcssDesc).toUpperCase() === 'NOT DISPATCHABLE';
  const days = daysNMC(v, s.status, ctx.asOf);
  return { ...s, ...mi, gcssNotDispatchable: gnd, days, aging: nmcAging(days, ctx.settings), platoon: vehiclePlatoon(v, ctx.settings), ...vehIds(v) };
}
/** Can this vehicle be dispatched on its own (ignoring trips)? */
export function vehicleUsable(view) { return view.status === 'FMC' && view.cls === 'Vehicle' && view.ruleOk && !view.gcssNotDispatchable; }
export function towedUsable(view) { return view.status === 'FMC' && view.cls === 'Towed' && !view.gcssNotDispatchable; }

export function fleetCounts(ctx) {
  const c = { onHand: 0, fmc: 0, nmcm: 0, nmcs: 0, nmcx: 0, unknown: 0, turnedIn: 0, nmc: 0, fmcRate: 0, dispatchable: 0, towable: 0, vehiclesOut: 0 };
  const probe = { id: '__probe__', status: 'Planned', dateOut: ctx.asOf };
  for (const v of ctx.fleet) {
    const vw = vehicleView(v, ctx);
    if (vw.status === 'TURNED IN') { c.turnedIn++; continue; }
    c.onHand++;
    if (vw.status === 'FMC') c.fmc++; else if (vw.status === 'NMCM') c.nmcm++; else if (vw.status === 'NMCS') c.nmcs++; else if (vw.status === 'NMC-X') c.nmcx++; else c.unknown++;
    const free = vehicleConflicts(v.key, probe, ctx.trips).length === 0;
    if (vehicleUsable(vw) && free) c.dispatchable++;
    if (towedUsable(vw) && free) c.towable++;
    if (!free) c.vehiclesOut++;
  }
  c.nmc = c.nmcm + c.nmcs + c.nmcx; c.fmcRate = c.onHand ? c.fmc / c.onHand : 0; return c;
}
export const pct = (r) => `${(Math.round(r * 10000) / 100).toFixed(2)}%`;

// ---------- the GO / WARN / NO-GO engine ----------
const LICMSG = { MISSING: 'LICENSE DATE MISSING', INVALID: 'LICENSE DATE UNREADABLE', EXPIRED: 'LICENSE EXPIRED' };
/** Evaluate one vehicle entry of a trip. `seen` (person id -> label) is shared across the whole trip so one person on two vehicles is caught. */
function evaluateEntry(entry, trip, ctx, { seen, prefix, usedKeys }) {
  const st = ctx.settings; const res = { entry, result: '', blockers: [], warnings: [], driverGcssId: '', tcGcssId: '', vehicleType: '', vehicleStatus: '', vehicle: null };
  const B = (code, msg) => res.blockers.push({ code, msg: prefix + msg, raw: msg, entry: entry.id }); const W = (code, msg) => res.warnings.push({ code, msg: prefix + msg, raw: msg, entry: entry.id });
  const evalDate = parseDateLoose(trip.dateOut) || ctx.asOf; const win = Math.max(0, +st.licenseWindow || 0);
  let vview = null;
  if (!entry.vehicle) B('NO_VEHICLE', 'NO VEHICLE SELECTED');
  else {
    const v = ctx.fleetByKey.get(entry.vehicle);
    if (!v) B('VEH_NOT_FOUND', 'VEHICLE NOT IN FLEET LIST');
    else {
      res.vehicle = v; vview = vehicleView(v, ctx); res.vehicleType = vview.type; res.vehicleStatus = vview.status;
      if (vview.status === 'TURNED IN') B('VEH_TURNED_IN', 'VEHICLE WAS TURNED IN (off the books)');
      else if (vview.status === 'NMC-X') B('VEH_NMCX', 'PERMANENT NMC (X) - AWAITING TURN-IN, CANNOT BE DISPATCHED');
      else if (vview.status === 'NMCM' || vview.status === 'NMCS') B('VEH_NMC', `VEHICLE IS ${vview.status}`);
      else if (vview.status === 'UNKNOWN' || vview.status === 'NO STATUS') B('VEH_UNKNOWN', 'VEHICLE STATUS UNKNOWN (not in GCSS export, no local status)');
      if (vview.cls === 'Towed') B('VEH_CLASS', 'TRAILER / TOWED ITEM - LIST IT UNDER TOWED, NOT AS VEHICLE');
      else if (vview.cls === 'Mounted') B('VEH_CLASS', 'MOUNTED ITEM CANNOT BE DISPATCHED ALONE');
      if (vview.gcssNotDispatchable) B('VEH_GCSS_ND', 'GCSS SAYS NOT DISPATCHABLE');
      if (!vview.ruleOk) B('VEH_RULE', vview.ruleProblem);
      if (vehicleConflicts(v.key, trip, ctx.trips).length) B('VEH_BUSY', 'VEHICLE IS ALSO ON ANOTHER ACTIVE TRIP');
      if (usedKeys.has(v.key)) B('VEH_TWICE', 'VEHICLE IS LISTED TWICE ON THIS TRIP');
      usedKeys.add(v.key);
      if (vview.source === 'override' && vview.status === 'FMC') W('VEH_LOCAL', 'VEHICLE STATUS FMC IS A LOCAL (WALK-AROUND) CHANGE, NOT CONFIRMED IN GCSS');
    }
  }
  const person = (id) => ctx.rosterById.get(id);
  const seenCheck = (label, id) => { if (!id) return; if (seen.has(id)) B('PERSON_TWICE', `${label.toUpperCase()}: SAME PERSON LISTED TWICE ON THIS TRIP (${seen.get(id)} and ${label})`); else seen.set(id, label); };
  if (!entry.driver) B('NO_DRIVER', 'NO DRIVER SELECTED');
  else {
    const d = person(entry.driver); seenCheck('Driver', entry.driver);
    if (!d) B('DRV_NOT_FOUND', 'DRIVER NOT ON ROSTER (pick from list)');
    else {
      res.driverGcssId = clean(d.gcssId);
      if (!personAvailable(d, st)) B('DRV_INACTIVE', `DRIVER NOT ACTIVE (${d.status || 'no status'})`);
      const ls = licenseState(d, evalDate, win);
      if (LICMSG[ls]) B('DRV_LIC', 'DRIVER ' + LICMSG[ls]); else if (ls === 'EXPIRING') W('DRV_LIC_SOON', `DRIVER LICENSE EXPIRES WITHIN ${win} DAYS (${d.licExp})`);
      if (vview && vview.mapped && vview.ruleOk && vview.qual && vview.qual !== 'NONE' && !hasQual(d, vview.qual)) B('DRV_QUAL', `DRIVER NOT QUALIFIED ON ${vview.type}`);
      if (personConflicts(d.id, trip, ctx.trips).length) B('DRV_BUSY', 'DRIVER IS ALSO ON ANOTHER ACTIVE TRIP');
      if (!res.driverGcssId && st.gcssIdRule !== 'OFF') (st.gcssIdRule === 'BLOCK' ? B : W)('DRV_GCSS_ID', 'DRIVER HAS NO GCSS-ARMY ID (needed to enter the dispatch in GCSS-Army)');
      for (const tk of entry.towed || []) {
        const tv = ctx.fleetByKey.get(tk); if (!tv) continue; const tw = vehicleView(tv, ctx);
        if (tw.ruleOk && tw.qual && tw.qual !== 'NONE' && !hasQual(d, tw.qual)) W('TOW_QUAL', `DRIVER NOT QUALIFIED ON TOWED ITEM (${tw.type})`);
      }
    }
  }
  if (entry.tc) {
    const c = person(entry.tc); seenCheck('TC / A-driver', entry.tc);
    if (!c) B('TC_NOT_FOUND', 'TC / A-DRIVER NOT ON ROSTER');
    else {
      res.tcGcssId = clean(c.gcssId);
      if (!personAvailable(c, st)) B('TC_INACTIVE', 'TC / A-DRIVER NOT ACTIVE');
      if (personConflicts(c.id, trip, ctx.trips).length) B('TC_BUSY', 'TC / A-DRIVER IS ALSO ON ANOTHER ACTIVE TRIP');
      const ls = licenseState(c, evalDate, win);
      if (LICMSG[ls]) (String(st.tcRule).toUpperCase() === 'BLOCK' ? B : W)('TC_LIC', 'TC / A-DRIVER ' + LICMSG[ls]);
      else if (ls === 'EXPIRING') W('TC_LIC_SOON', 'TC / A-DRIVER LICENSE EXPIRES SOON');
      if (st.tcQualWarn && vview && vview.ruleOk && vview.qual && vview.qual !== 'NONE' && !hasQual(c, vview.qual)) W('TC_QUAL', `TC / A-DRIVER NOT QUALIFIED ON ${vview.type}`);
      if (!res.tcGcssId && st.gcssIdRule !== 'OFF') W('TC_GCSS_ID', 'TC / A-DRIVER HAS NO GCSS-ARMY ID');
    }
  }
  (entry.pax || []).forEach((id, i) => {
    if (!id) return; const label = `Pax ${i + 1}`; const p = person(id); seenCheck(label, id);
    if (!p) B('PAX_NOT_FOUND', `${label.toUpperCase()} NOT ON ROSTER`);
    else { if (!personAvailable(p, st)) B('PAX_INACTIVE', `${label.toUpperCase()} NOT ACTIVE`); if (personConflicts(p.id, trip, ctx.trips).length) B('PAX_BUSY', `${label.toUpperCase()} IS ALSO ON ANOTHER ACTIVE TRIP`); }
  });
  for (const tk of entry.towed || []) {
    const tv = ctx.fleetByKey.get(tk);
    if (!tv) { B('TOW_NOT_FOUND', 'TOWED ITEM NOT IN FLEET LIST'); continue; }
    const tw = vehicleView(tv, ctx); const nm = tv.short || tv.bumper;
    if (tw.cls === 'Towed' && tw.status !== 'FMC') B('TOW_STATUS', `TOWED ITEM ${nm} IS ${tw.status}`);
    if (tw.cls !== 'Towed') W('TOW_CLASS', `TOWED ITEM ${nm} IS NOT A TRAILER TYPE (recovery tow?)`);
    if (tw.cls === 'Towed' && !tw.ruleOk && tw.mapped) W('TOW_RULE', `NO QUALIFICATION RULE FOR TOWED TYPE ${tw.type}`);
    if (vehicleConflicts(tv.key, trip, ctx.trips).length) B('TOW_BUSY', `TOWED ITEM ${nm} IS ALSO ON ANOTHER ACTIVE TRIP`);
    if (usedKeys.has(tk)) B('TOW_TWICE', `TOWED ITEM ${nm} IS ALSO LISTED ON ANOTHER VEHICLE OF THIS TRIP`);
    usedKeys.add(tk);
    if (tk === entry.vehicle) B('TOW_SELF', 'VEHICLE CANNOT TOW ITSELF');
  }
  if (trip.status === 'Out' && entry.pmcs !== true) (String(st.pmcsRule).toUpperCase() === 'BLOCK' ? B : W)('PMCS', 'PMCS NOT MARKED DONE');
  res.result = res.blockers.length ? 'NO-GO' : res.warnings.length ? 'WARN' : 'GO';
  return res;
}
/** Trip result = worst result of its vehicle entries (any NO-GO vehicle makes the trip NO-GO, so it cannot go Out until that vehicle is fixed or removed).
 *  res.entries[] holds each vehicle's own result / reasons; messages carry the vehicle bumper when the trip has more than one vehicle. */
export function evaluateTrip(trip, ctx) {
  const res = { result: '', blockers: [], warnings: [], driverGcssId: '', tcGcssId: '', vehicleType: '', vehicleStatus: '', entries: [] };
  if (!TRIP_STATUSES.includes(trip.status)) { res.result = 'NO-GO'; res.blockers.push({ code: 'STATUS_BAD', msg: 'UNKNOWN TRIP STATUS (use Planned / Out / Back / Cancelled)' }); return res; }
  if (!isActiveTrip(trip)) { res.result = trip.status.toUpperCase(); return res; }
  const entries = tripEntries(trip); const seen = new Map(); const usedKeys = new Set(); const multi = entries.length > 1;
  if (!entries.length) res.blockers.push({ code: 'NO_VEHICLE', msg: 'NO VEHICLE SELECTED' });
  entries.forEach((e, i) => {
    const v = ctx.fleetByKey.get(e.vehicle); const prefix = multi ? `${(v && (v.short || v.bumper)) || `Vehicle ${i + 1}`}: ` : '';
    const r = evaluateEntry(e, trip, ctx, { seen, prefix, usedKeys }); res.entries.push(r); res.blockers.push(...r.blockers); res.warnings.push(...r.warnings);
  });
  if (res.entries[0]) { const f = res.entries[0]; res.driverGcssId = f.driverGcssId; res.tcGcssId = f.tcGcssId; res.vehicleType = f.vehicleType; res.vehicleStatus = f.vehicleStatus; }
  const W = (code, msg) => res.warnings.push({ code, msg });
  if (trip.status === 'Out' && !trip.dateOut) W('DATE_OUT', 'SET DATE OUT');
  if (trip.dateOut && trip.dateBack && trip.dateBack < trip.dateOut) W('DATE_BACK', 'DATE BACK IS BEFORE DATE OUT');
  else if (trip.dateOut && trip.dateBack && trip.dateBack === trip.dateOut && trip.timeOut && trip.timeBack && trip.timeBack < trip.timeOut) W('TIME_BACK', 'TIME BACK IS BEFORE TIME OUT');
  res.nogoEntries = res.entries.filter((r) => r.result === 'NO-GO');
  res.result = res.blockers.length ? 'NO-GO' : res.warnings.length ? 'WARN' : 'GO';
  return res;
}
export function tripSummaryMessage(ev) {
  const list = ev.blockers.length ? ev.blockers : ev.warnings; if (!list.length) return '';
  return list[0].msg + (list.length > 1 ? ` (+${list.length - 1} more)` : '');
}

// ---------- pickers: only usable options ----------
export function usableVehicles(ctx, trip, { exclude = [] } = {}) {
  const ex = new Set(exclude);
  return ctx.fleet.map((v) => ({ v, vw: vehicleView(v, ctx) })).filter(({ v, vw }) => !ex.has(v.key) && vehicleUsable(vw) && !vehicleConflicts(v.key, trip, ctx.trips).length)
    .sort((a, b) => a.v.key.localeCompare(b.v.key, 'en', { numeric: true }));
}
export function usableTowed(ctx, trip, { exclude = [] } = {}) {
  const ex = new Set([...tripMainKeys(trip), ...exclude]);
  return ctx.fleet.map((v) => ({ v, vw: vehicleView(v, ctx) })).filter(({ v, vw }) => towedUsable(vw) && !ex.has(v.key) && !vehicleConflicts(v.key, trip, ctx.trips).length)
    .sort((a, b) => a.v.key.localeCompare(b.v.key, 'en', { numeric: true }));
}
/** role: 'driver' (license + qual required) | 'tc' | 'pax' */
export function usablePeople(ctx, trip, role, vehicleKey, { exclude = [] } = {}) {
  const ex = new Set(exclude);
  const evalDate = parseDateLoose(trip.dateOut) || ctx.asOf; const win = Math.max(0, +ctx.settings.licenseWindow || 0);
  const v = vehicleKey ? ctx.fleetByKey.get(vehicleKey) : null; const vw = v ? vehicleView(v, ctx) : null;
  return ctx.roster.filter((p) => {
    if (!personAvailable(p, ctx.settings)) return false;
    if (ex.has(p.id)) return false;
    if (personConflicts(p.id, trip, ctx.trips).length) return false;
    if (role === 'driver') {
      const ls = licenseState(p, evalDate, win); if (ls === 'MISSING' || ls === 'INVALID' || ls === 'EXPIRED') return false;
      if (vw && vw.ruleOk && vw.qual && vw.qual !== 'NONE' && !hasQual(p, vw.qual)) return false;
    }
    return true;
  }).sort((a, b) => personName(a).localeCompare(personName(b)));
}
export function allQualNames(settings) {
  const s = new Set(); for (const r of settings.modelMap || []) { const q = clean(r.qual); if (q && q.toUpperCase() !== 'NONE') s.add(q); }
  for (const q of settings.extraQuals || []) if (clean(q)) s.add(clean(q));
  return [...s];
}
