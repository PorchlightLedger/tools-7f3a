// Business rules (mirrors the spreadsheet system's rules). Pure functions - no DOM, no storage.
import { parseDateLoose, daysBetween, dayNum, todayISO, clean, normKeyText, uid, fmtDate } from './util.js';

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
/** minutes since midnight of an "HHMM" time, or null when blank / unreadable */
const hhmmMin = (t) => { const m = /^(\d{2})(\d{2})$/.exec(String(t == null ? '' : t)); return m ? (+m[1]) * 60 + (+m[2]) : null; };
/** The period a trip keeps its vehicles / people busy: {known, start, end} in minutes (day number * 1440 + minutes; end may be Infinity).
 *  dateBack defaults to dateOut. A day without a time counts as the whole day (start 0000, end 2359), so unknown times are never treated as free.
 *  An Out trip is physically out NOW: it starts no later than `asOf`, and once its return date has passed without it being set Back it stays busy
 *  (open ended) until it is set Back - a missing vehicle is a real risk. A trip with no date out cannot be placed in time and collides with everything. */
export function tripSpan(t, asOf = todayISO()) {
  const out = t.status === 'Out'; const d0 = parseDateLoose(t.dateOut);
  if (!d0) return { known: false, start: -Infinity, end: Infinity, overdue: false };
  let d1 = parseDateLoose(t.dateBack) || d0; if (d1 < d0) d1 = d0; // a return before the departure is flagged elsewhere (DATE_BACK)
  const a = parseDateLoose(asOf) || todayISO(); const overdue = out && d1 < a;
  const t0 = hhmmMin(t.timeOut), t1 = hhmmMin(t.timeBack);
  let start = dayNum(d0) * 1440 + (t0 == null ? 0 : t0); let end = overdue ? Infinity : dayNum(d1) * 1440 + (t1 == null ? 1439 : t1);
  if (out) start = Math.min(start, dayNum(a) * 1440);
  if (end < start) end = start;
  return { known: true, start, end, overdue };
}
/** An Out trip whose return date (dateBack, else dateOut) is before `asOf` and that has not been set Back. */
export const isPastDue = (t, asOf = todayISO()) => t.status === 'Out' && tripSpan(t, asOf).overdue;
/** Do two trips collide? Same rule for vehicles, towed items and people: the date ranges dateOut..dateBack (with times when they exist) intersect.
 *  Planned trips on different, non-overlapping days do not collide; an Out trip is busy through its return date and beyond while it is overdue.
 *  `asOf` (ctx.asOf) is the as-of day used for the overdue rule; it defaults to the local today. */
export function tripsOverlap(a, b, asOf = todayISO()) {
  if (!isActiveTrip(a) || !isActiveTrip(b)) return false;
  const x = tripSpan(a, asOf), y = tripSpan(b, asOf);
  if (!x.known || !y.known) return true;
  return x.start <= y.end && y.start <= x.end;
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
  for (const e of t.entries) { if (!e.id) e.id = uid('e'); if (!Array.isArray(e.pax)) e.pax = []; if (!Array.isArray(e.towed)) e.towed = []; for (const k of ['vehicle', 'vid', 'driver', 'tc']) if (typeof e[k] !== 'string') e[k] = ''; e.pmcs = e.pmcs === true; cleanOverride(e); }
  if (!t.id) t.id = uid('t'); t.sv = 2; return t;
}
export function tripPeople(t) { return tripEntries(t).flatMap((e) => [['Driver', e.driver], ['TC / A-driver', e.tc], ...(e.pax || []).map((p, i) => [`Pax ${i + 1}`, p])]).filter(([, id]) => id); }
export function entryPeople(e) { return [['Driver', e.driver], ['TC / A-driver', e.tc], ...(e.pax || []).map((p, i) => [`Pax ${i + 1}`, p])].filter(([, id]) => id); }
export function tripVehicleKeys(t) { return tripEntries(t).flatMap((e) => [e.vehicle, ...(e.towed || [])]).filter(Boolean); }
/** keys of the primary vehicles (not trailers) on a trip */
export function tripMainKeys(t) { return tripEntries(t).map((e) => e.vehicle).filter(Boolean); }
/** other active trips that collide with `cand` and use this vehicle/towed key */
export function vehicleConflicts(key, cand, trips, asOf) { return trips.filter((t) => t.id !== cand.id && tripsOverlap(t, cand, asOf) && tripVehicleKeys(t).includes(key)); }
export function personConflicts(id, cand, trips, asOf) { return trips.filter((t) => t.id !== cand.id && tripsOverlap(t, cand, asOf) && tripPeople(t).some(([, pid]) => pid === id)); }

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
    const free = vehicleConflicts(v.key, probe, ctx.trips, ctx.asOf).length === 0;
    if (vehicleUsable(vw) && free) c.dispatchable++;
    if (towedUsable(vw) && free) c.towable++;
    if (!free) c.vehiclesOut++;
  }
  c.nmc = c.nmcm + c.nmcs + c.nmcx; c.fmcRate = c.onHand ? c.fmc / c.onHand : 0; return c;
}
export const pct = (r) => `${(Math.round(r * 10000) / 100).toFixed(2)}%`;

// ---------- the GO / WARN / NO-GO engine ----------
/** a valid license that expires BEFORE the trip's last day (the expiry day itself still counts). Already-expired / missing licenses are handled by licenseState. */
const licenseEndsBeforeTrip = (p, tripEnd) => { const e = p && p.licExp ? parseDateLoose(p.licExp) : ''; return !!(e && tripEnd && e < tripEnd); };
const licMidMsg = (who, p, tripEnd) => `${who} ${personName(p).toUpperCase()}: LICENSE EXPIRES ${fmtDate(p.licExp)} BEFORE THE TRIP ENDS (${fmtDate(tripEnd)})`;
const LICMSG = { MISSING: 'LICENSE DATE MISSING', INVALID: 'LICENSE DATE UNREADABLE', EXPIRED: 'LICENSE EXPIRED' };
/** a fleet record whose description / model reads like a trailer or towed asset (used only to word the unmapped-model warning) */
const looksLikeTrailer = (v) => /\b(TRL|TRLR|TRAILER|SEMITRAILER|SEMI-TRAILER|LOWBOY|LOW BOY|WATER BUFFALO|BUFFALO|M149|M1101|M1095|M870|GENERATOR|GEN SET|LIGHT SET)\b/i.test(`${v.desc || ''} ${v.model || ''}`);
/** Evaluate one vehicle entry of a trip. `seen` (person id -> label) is shared across the whole trip so one person on two vehicles is caught. */
function evaluateEntry(entry, trip, ctx, { seen, prefix, usedKeys }) {
  const st = ctx.settings; const res = { entry, result: '', blockers: [], warnings: [], driverGcssId: '', tcGcssId: '', vehicleType: '', vehicleStatus: '', vehicle: null };
  const B = (code, msg, pid) => res.blockers.push({ code, msg: prefix + msg, raw: msg, entry: entry.id, ...(pid ? { pid } : {}) }); const W = (code, msg, pid) => res.warnings.push({ code, msg: prefix + msg, raw: msg, entry: entry.id, ...(pid ? { pid } : {}) });
  const evalDate = parseDateLoose(trip.dateOut) || ctx.asOf;
  const tripEnd = parseDateLoose(trip.dateBack) || parseDateLoose(trip.dateOut) || ''; // last day of the trip (dateBack, else dateOut)
  const win = Math.max(0, +st.licenseWindow || 0);
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
      if (vehicleConflicts(v.key, trip, ctx.trips, ctx.asOf).length) B('VEH_BUSY', 'VEHICLE IS ALSO ON ANOTHER ACTIVE TRIP');
      if (usedKeys.has(v.key)) B('VEH_TWICE', 'VEHICLE IS LISTED TWICE ON THIS TRIP');
      usedKeys.add(v.key);
      if (vview.source === 'override' && vview.status === 'FMC') W('VEH_LOCAL', 'VEHICLE STATUS FMC IS A LOCAL (WALK-AROUND) CHANGE, NOT CONFIRMED IN GCSS');
    }
  }
  const person = (id) => ctx.rosterById.get(id);
  const seenCheck = (label, id) => { if (!id) return; if (seen.has(id)) B('PERSON_TWICE', `${label.toUpperCase()}: SAME PERSON LISTED TWICE ON THIS TRIP (${seen.get(id)} and ${label})`, id); else seen.set(id, label); };
  if (!entry.driver) B('NO_DRIVER', 'NO DRIVER SELECTED');
  else {
    const d = person(entry.driver); seenCheck('Driver', entry.driver);
    if (!d) B('DRV_NOT_FOUND', 'DRIVER NOT ON ROSTER (pick from list)', entry.driver);
    else {
      res.driverGcssId = clean(d.gcssId);
      if (!personAvailable(d, st)) B('DRV_INACTIVE', `DRIVER NOT ACTIVE (${d.status || 'no status'})`, d.id);
      const ls = licenseState(d, evalDate, win);
      const midTrip = !LICMSG[ls] && licenseEndsBeforeTrip(d, tripEnd);
      if (LICMSG[ls]) B('DRV_LIC', 'DRIVER ' + LICMSG[ls], d.id); else if (midTrip) B('DRV_LIC_MIDTRIP', licMidMsg('DRIVER', d, tripEnd), d.id); else if (ls === 'EXPIRING') W('DRV_LIC_SOON', `DRIVER LICENSE EXPIRES WITHIN ${win} DAYS (${d.licExp})`, d.id);
      if (vview && vview.mapped && vview.ruleOk && vview.qual && vview.qual !== 'NONE' && !hasQual(d, vview.qual)) B('DRV_QUAL', `DRIVER NOT QUALIFIED ON ${vview.type}`, d.id);
      if (personConflicts(d.id, trip, ctx.trips, ctx.asOf).length) B('DRV_BUSY', 'DRIVER IS ALSO ON ANOTHER ACTIVE TRIP', d.id);
      if (!res.driverGcssId && st.gcssIdRule !== 'OFF') (st.gcssIdRule === 'BLOCK' ? B : W)('DRV_GCSS_ID', 'DRIVER HAS NO GCSS-ARMY ID (needed to enter the dispatch in GCSS-Army)', d.id);
      for (const tk of entry.towed || []) {
        const tv = ctx.fleetByKey.get(tk); if (!tv) continue; const tw = vehicleView(tv, ctx);
        if (tw.ruleOk && tw.qual && tw.qual !== 'NONE' && !hasQual(d, tw.qual)) W('TOW_QUAL', `DRIVER NOT QUALIFIED ON TOWED ITEM (${tw.type})`, d.id);
      }
    }
  }
  if (entry.tc) {
    const c = person(entry.tc); seenCheck('TC / A-driver', entry.tc);
    if (!c) B('TC_NOT_FOUND', 'TC / A-DRIVER NOT ON ROSTER', entry.tc);
    else {
      res.tcGcssId = clean(c.gcssId);
      if (!personAvailable(c, st)) B('TC_INACTIVE', 'TC / A-DRIVER NOT ACTIVE', c.id);
      if (personConflicts(c.id, trip, ctx.trips, ctx.asOf).length) B('TC_BUSY', 'TC / A-DRIVER IS ALSO ON ANOTHER ACTIVE TRIP', c.id);
      const ls = licenseState(c, evalDate, win);
      const tcPut = String(st.tcRule).toUpperCase() === 'BLOCK' ? B : W;
      if (LICMSG[ls]) tcPut('TC_LIC', 'TC / A-DRIVER ' + LICMSG[ls], c.id);
      else if (licenseEndsBeforeTrip(c, tripEnd)) tcPut('TC_LIC_MIDTRIP', licMidMsg('TC / A-DRIVER', c, tripEnd), c.id); // same WARN / BLOCK rule as the other TC license checks
      else if (ls === 'EXPIRING') W('TC_LIC_SOON', 'TC / A-DRIVER LICENSE EXPIRES SOON', c.id);
      if (st.tcQualWarn && vview && vview.ruleOk && vview.qual && vview.qual !== 'NONE' && !hasQual(c, vview.qual)) W('TC_QUAL', `TC / A-DRIVER NOT QUALIFIED ON ${vview.type}`, c.id);
      if (!res.tcGcssId && st.gcssIdRule !== 'OFF') W('TC_GCSS_ID', 'TC / A-DRIVER HAS NO GCSS-ARMY ID', c.id);
    }
  }
  (entry.pax || []).forEach((id, i) => {
    if (!id) return; const label = `Pax ${i + 1}`; const p = person(id); seenCheck(label, id);
    if (!p) B('PAX_NOT_FOUND', `${label.toUpperCase()} NOT ON ROSTER`, id);
    else { if (!personAvailable(p, st)) B('PAX_INACTIVE', `${label.toUpperCase()} NOT ACTIVE`, p.id); if (personConflicts(p.id, trip, ctx.trips, ctx.asOf).length) B('PAX_BUSY', `${label.toUpperCase()} IS ALSO ON ANOTHER ACTIVE TRIP`, p.id); }
  });
  for (const tk of entry.towed || []) {
    const tv = ctx.fleetByKey.get(tk);
    if (!tv) { B('TOW_NOT_FOUND', 'TOWED ITEM NOT IN FLEET LIST'); continue; }
    const tw = vehicleView(tv, ctx); const nm = tv.short || tv.bumper;
    // status gates apply to EVERY towed item whatever its mapped class (a recovery tow or an unmapped model must not fail open)
    if (tw.status === 'TURNED IN') B('TOW_TURNED_IN', `TOWED ITEM ${nm} WAS TURNED IN (off the books)`); // never overridable
    else if (tw.status === 'NMC-X') B('TOW_NMCX', `TOWED ITEM ${nm} IS NMC-X (permanent NMC)`); // never overridable
    // NMCM / NMCS / GCSS not-dispatchable stay overridable (a recovery tow of a down item is plausible)
    else if (tw.status === 'NMCM' || tw.status === 'NMCS') B('TOW_STATUS', `TOWED ITEM ${nm} IS ${tw.status}`);
    else if (tw.cls === 'Towed' && tw.status !== 'FMC') B('TOW_STATUS', `TOWED ITEM ${nm} IS ${tw.status}`);
    if (tw.gcssNotDispatchable) B('TOW_GCSS_ND', `TOWED ITEM ${nm}: GCSS SAYS NOT DISPATCHABLE`);
    if (tw.cls === 'Unmapped') W('TOW_UNMAPPED', `TOWED ITEM ${nm}: MODEL NOT IN TYPE MAP${looksLikeTrailer(tv) ? ' (looks like a trailer: add it to the Type map as Towed)' : ' AND IT DOES NOT LOOK LIKE A TRAILER (check it is really being towed)'}`);
    else if (tw.cls !== 'Towed') W('TOW_CLASS', `TOWED ITEM ${nm} IS NOT A TRAILER TYPE (recovery tow?)`);
    if (tw.cls === 'Towed' && !tw.ruleOk && tw.mapped) W('TOW_RULE', `NO QUALIFICATION RULE FOR TOWED TYPE ${tw.type}`);
    if (vehicleConflicts(tv.key, trip, ctx.trips, ctx.asOf).length) B('TOW_BUSY', `TOWED ITEM ${nm} IS ALSO ON ANOTHER ACTIVE TRIP`);
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
  // commander override: the result stays an honest NO-GO; blocksOut says whether anything still stops the trip from going Out.
  res.entries.forEach((r) => { r.override = overrideStatus(r.entry, r); });
  res.overrides = res.entries.filter((r) => r.override).map((r) => ({ entry: r.entry, ...r.override }));
  res.overriddenEntries = res.nogoEntries.filter((r) => r.override && r.override.covers);
  res.blockingEntries = res.nogoEntries.filter((r) => !(r.override && r.override.covers));
  res.blocksOut = res.blockingEntries.length > 0 || res.blockers.some((b) => !b.entry);
  res.result = res.blockers.length ? 'NO-GO' : res.warnings.length ? 'WARN' : 'GO';
  return res;
}
/** NO-GO reasons that `next` (an edited copy of an Out trip) has and `prev` (the saved trip, evaluated as Out) did not. Only reasons that still block Out count
 *  (an overridden vehicle is not "blocking"). A reason is identified by trip entry, vehicle, code, text and person, so swapping in a different blocked
 *  vehicle or person is NEW even when the text is the same. Used so that saving other edits to an already-Out trip is not refused because of an
 *  old NO-GO (a vehicle that went NMC after it left), while changing to a blocked vehicle / person still is. */
export function newBlockingReasons(prev, next, ctx) {
  const evOf = (t) => evaluateTrip({ ...t, status: 'Out' }, ctx);
  const sigs = (t, ev, only) => { const veh = new Map(tripEntries(t).map((e) => [e.id, e.vehicle])); return ev.blockers.filter(only).map((b) => ({ b, sig: `${b.entry || ''}|${veh.get(b.entry) || ''}|${b.code}|${b.raw || b.msg}|${b.pid || ''}` })); };
  const e0 = evOf(prev), e1 = evOf(next); const old = new Set(sigs(prev, e0, () => true).map((x) => x.sig));
  const blocking = new Set(e1.blockingEntries.map((r) => r.entry.id));
  return sigs(next, e1, (b) => !b.entry || blocking.has(b.entry)).filter((x) => !old.has(x.sig)).map((x) => x.b);
}
/** what to remember about the check at the moment a trip went Out: {at, result, warnings[], blockers[]} (messages only; blockers are present only under a commander override) */
export function outCheckOf(ev, now = new Date()) { return { at: now.toISOString(), result: ev.result, warnings: ev.warnings.map((w) => w.msg), blockers: ev.blockers.map((b) => b.msg) }; }
// ---------- commander override of NO-GO vehicles ----------
// entry.override = {by, reason, at (ISO time), vehicle (fleet key it was given for), reasons:[{code, msg, pid?}] (the NO-GO reasons that were overridden, with the person they were about),
//   driver, tc, pax[], towed[] (the crew and trailers it was given for; ids)}. An override recorded before the crew was kept has none of those four fields: it is LEGACY (see overrideStatus).
// It RECORDS an approval (a typed name + reason). It is not a login or a lock: anyone holding the phone can type a name.
// Without a valid override a NO-GO vehicle still blocks Out exactly as before. An override only covers the reasons recorded when it was given:
// a new NO-GO reason (another fault ...) is not covered, and changing the vehicle drops it. A different driver / TC / passenger / towed item makes it OUTDATED (it no longer covers), because it was a decision about those people and that load.
/** Reasons no commander can waive. (a) data errors: nothing real to dispatch / the same item twice. (b) legal / readiness limits: an expired, missing or unreadable
 *  driver license date, a permanent-NMC (X, deadlined) vehicle and a turned-in (off the books) vehicle. NMCM / NMCS status, qualification gaps, PMCS, busy
 *  crews, GCSS ID rules etc. stay overridable. */
export const NON_OVERRIDABLE = ['NO_VEHICLE', 'VEH_NOT_FOUND', 'VEH_TWICE', 'TOW_SELF', 'TOW_TWICE', 'TOW_NOT_FOUND', 'PERSON_TWICE', 'STATUS_BAD', 'DRV_LIC', 'VEH_NMCX', 'VEH_TURNED_IN', 'TOW_NMCX', 'TOW_TURNED_IN'];
export const NON_OVERRIDABLE_WHY = 'A commander cannot waive a license requirement or dispatch a deadlined (X) or turned-in vehicle, and the same goes for a deadlined (X) or turned-in towed item. Data errors (no vehicle, the same vehicle or person twice, a trailer towing itself) are not a readiness call. Fix or remove them.';
export const OVERRIDE_NAME_MAX = 80, OVERRIDE_REASON_MAX = 300;
const reasonKey = (r) => `${r.code}|${r.raw || r.msg}`;
const oneLine = (x, max) => String(x == null ? '' : x).replace(/\s+/g, ' ').trim().slice(0, max);
/** drop a malformed override (odd imports / hand-edited backups) and trim the rest in place */
export function cleanOverride(e) {
  if (e && e.overrideLog !== undefined) {
    const log = (Array.isArray(e.overrideLog) ? e.overrideLog : []).filter((r) => r && typeof r === 'object' && oneLine(r.by, OVERRIDE_NAME_MAX))
      .map((r) => ({ by: oneLine(r.by, OVERRIDE_NAME_MAX), reason: oneLine(r.reason, OVERRIDE_REASON_MAX), at: typeof r.at === 'string' ? r.at : '', removedAt: typeof r.removedAt === 'string' ? r.removedAt : '' })).slice(-10);
    if (log.length) e.overrideLog = log; else delete e.overrideLog;
  }
  const o = e && e.override; if (o === undefined) return e;
  const ok = o && typeof o === 'object' && !Array.isArray(o) && oneLine(o.by, OVERRIDE_NAME_MAX) && oneLine(o.reason, OVERRIDE_REASON_MAX);
  if (!ok) { delete e.override; return e; }
  const idl = (a) => (Array.isArray(a) ? a : []).filter((x) => typeof x === 'string' && x);
  const crew = ['driver', 'tc', 'pax', 'towed'].some((k) => o[k] !== undefined) ? { driver: typeof o.driver === 'string' ? o.driver : '', tc: typeof o.tc === 'string' ? o.tc : '', pax: idl(o.pax), towed: idl(o.towed) } : {};
  e.override = { by: oneLine(o.by, OVERRIDE_NAME_MAX), reason: oneLine(o.reason, OVERRIDE_REASON_MAX), at: typeof o.at === 'string' ? o.at : '', vehicle: typeof o.vehicle === 'string' ? o.vehicle : '',
    reasons: (Array.isArray(o.reasons) ? o.reasons : []).filter((r) => r && typeof r === 'object' && typeof r.code === 'string').map((r) => ({ code: r.code, msg: String(r.msg == null ? '' : r.msg), ...(typeof r.pid === 'string' && r.pid ? { pid: r.pid } : {}) })), ...crew };
  return e;
}
/** the crew an override was given for ({driver, tc, pax, towed}), or null for a legacy override that did not record it */
export const overrideCrew = (o) => (o && ['driver', 'tc', 'pax', 'towed'].some((k) => o[k] !== undefined) ? { driver: o.driver || '', tc: o.tc || '', pax: [...(o.pax || [])].sort(), towed: [...(o.towed || [])].sort() } : null);
const crewOf = (e) => ({ driver: e.driver || '', tc: e.tc || '', pax: [...(e.pax || [])].filter(Boolean).sort(), towed: [...(e.towed || [])].filter(Boolean).sort() });
/** which roles differ between the recorded crew and the entry's current crew: [] when equal */
export function crewChanges(o, entry) {
  const a = overrideCrew(o); if (!a) return []; const b = crewOf(entry); const out = [];
  if (a.driver !== b.driver) out.push('driver'); if (a.tc !== b.tc) out.push('TC / A-driver'); if (a.pax.join('|') !== b.pax.join('|')) out.push('passengers'); if (a.towed.join('|') !== b.towed.join('|')) out.push('trailers / towed');
  return out;
}
/** state of an entry's override against its current evaluation `er`: null (none) | {override, covers, needed, extra[]}.
 *  covers: the entry is NO-GO and every current NO-GO reason (and the vehicle) is one the commander accepted. needed: the entry is NO-GO now. */
export function overrideStatus(entry, er) {
  const o = entry && entry.override; if (!o || !o.by || !o.reason) return null;
  const needed = !!er && er.result === 'NO-GO'; const have = new Set((o.reasons || []).map(reasonKey));
  const extra = needed ? er.blockers.filter((b) => !have.has(reasonKey(b)) || NON_OVERRIDABLE.includes(b.code)) : [];
  const sameVehicle = !!entry.vehicle && o.vehicle === entry.vehicle;
  const legacy = !overrideCrew(o); const changed = legacy ? [] : crewChanges(o, entry); const sameCrew = !changed.length;
  return { override: o, needed, extra, sameVehicle, sameCrew, crewChanged: changed, legacy, covers: needed && sameVehicle && sameCrew && !extra.length };
}
/** can this entry (evaluated as `er`, ideally on an Out probe so Out-only reasons like PMCS are included) be overridden? -> {ok, reasons[], error} */
export function canOverrideEntry(er) {
  if (!er || er.result !== 'NO-GO') return { ok: false, reasons: [], blocked: [], error: 'This vehicle is not NO-GO, so there is nothing to override.' };
  const bad = er.blockers.filter((b) => NON_OVERRIDABLE.includes(b.code));
  if (bad.length) return { ok: false, reasons: er.blockers, blocked: bad, error: 'This cannot be overridden: ' + bad.map((b) => b.raw || b.msg).join('; ') + '. ' + NON_OVERRIDABLE_WHY };
  return { ok: true, reasons: er.blockers, blocked: [], error: '' };
}
/** check the typed name + reason: both required (not blank after trimming) -> {ok, by, reason, error} */
export function checkOverrideInput({ by, reason } = {}) {
  const b = oneLine(by, OVERRIDE_NAME_MAX), r = oneLine(reason, OVERRIDE_REASON_MAX);
  if (!b) return { ok: false, by: b, reason: r, error: "Type the approving commander's name." };
  if (!r) return { ok: false, by: b, reason: r, error: 'A short reason is required.' };
  return { ok: true, by: b, reason: r, error: '' };
}
/** record an override on `entry` (evaluated as `er`). Returns {ok, override, error}; changes nothing when it fails. */
export function applyOverride(entry, er, { by, reason, now = new Date() } = {}) {
  const inp = checkOverrideInput({ by, reason }); if (!inp.ok) return { ok: false, error: inp.error };
  if (!entry || !er || er.entry !== entry) return { ok: false, error: 'That vehicle entry does not match the checks.' };
  const can = canOverrideEntry(er); if (!can.ok) return { ok: false, error: can.error };
  const c = crewOf(entry); // the decision is about this vehicle, these reasons AND this crew / load
  entry.override = { by: inp.by, reason: inp.reason, at: now.toISOString(), vehicle: entry.vehicle, reasons: can.reasons.map((b) => ({ code: b.code, msg: b.raw || b.msg, ...(b.pid ? { pid: b.pid } : {}) })), driver: c.driver, tc: c.tc, pax: [...(entry.pax || [])].filter(Boolean), towed: [...(entry.towed || [])].filter(Boolean) };
  return { ok: true, override: entry.override, error: '' };
}
/** undo: remove the override from the entry. Returns true when there was one. */
export const OVERRIDE_LOG_MAX = 10;
export function removeOverride(entry, now = new Date()) {
  if (!(entry && entry.override)) return false;
  // keep a record that an override was given and later removed (audit trail), newest last, capped
  const log = Array.isArray(entry.overrideLog) ? entry.overrideLog : [];
  log.push({ by: entry.override.by, reason: entry.override.reason, at: entry.override.at || '', removedAt: now.toISOString() });
  entry.overrideLog = log.slice(-OVERRIDE_LOG_MAX); delete entry.override; return true;
}
/** every override on a trip, with the vehicle label: [{entry, vehicle, by, reason, at, reasons}] */
export function tripOverrides(t) { return tripEntries(t).filter((e) => e.override && e.override.by).map((e) => ({ entry: e, vehicle: e.vehicle, ...e.override })); }
/** "Commander override: NAME" (distinct names, in trip order) or '' */
export function overrideMarker(list) { const names = [...new Set((list || []).map((o) => o.by).filter(Boolean))]; return names.length ? 'Commander override: ' + names.join(', ') : ''; }
export function tripSummaryMessage(ev) {
  const list = ev.blockers.length ? ev.blockers : ev.warnings; if (!list.length) return '';
  return list[0].msg + (list.length > 1 ? ` (+${list.length - 1} more)` : '');
}

// ---------- pickers: only usable options ----------
export function usableVehicles(ctx, trip, { exclude = [] } = {}) {
  const ex = new Set(exclude);
  return ctx.fleet.map((v) => ({ v, vw: vehicleView(v, ctx) })).filter(({ v, vw }) => !ex.has(v.key) && vehicleUsable(vw) && !vehicleConflicts(v.key, trip, ctx.trips, ctx.asOf).length)
    .sort((a, b) => a.v.key.localeCompare(b.v.key, 'en', { numeric: true }));
}
export function usableTowed(ctx, trip, { exclude = [] } = {}) {
  const ex = new Set([...tripMainKeys(trip), ...exclude]);
  return ctx.fleet.map((v) => ({ v, vw: vehicleView(v, ctx) })).filter(({ v, vw }) => towedUsable(vw) && !ex.has(v.key) && !vehicleConflicts(v.key, trip, ctx.trips, ctx.asOf).length)
    .sort((a, b) => a.v.key.localeCompare(b.v.key, 'en', { numeric: true }));
}
/** role: 'driver' (license + qual required) | 'tc' | 'pax' */
export function usablePeople(ctx, trip, role, vehicleKey, { exclude = [] } = {}) {
  const ex = new Set(exclude);
  const evalDate = parseDateLoose(trip.dateOut) || ctx.asOf;
  const tripEnd = parseDateLoose(trip.dateBack) || parseDateLoose(trip.dateOut) || ''; // last day of the trip (dateBack, else dateOut)
  const win = Math.max(0, +ctx.settings.licenseWindow || 0);
  const v = vehicleKey ? ctx.fleetByKey.get(vehicleKey) : null; const vw = v ? vehicleView(v, ctx) : null;
  return ctx.roster.filter((p) => {
    if (!personAvailable(p, ctx.settings)) return false;
    if (ex.has(p.id)) return false;
    if (personConflicts(p.id, trip, ctx.trips, ctx.asOf).length) return false;
    if (role === 'driver') {
      const ls = licenseState(p, evalDate, win); if (ls === 'MISSING' || ls === 'INVALID' || ls === 'EXPIRED' || licenseEndsBeforeTrip(p, tripEnd)) return false; // (a commander can still pick such a person from the full list and record an override)
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
