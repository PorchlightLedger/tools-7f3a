// Roster import / export. NEVER stores DODID, SSN or DOB: those columns are dropped on import.
import { clean, normKeyText, parseDateLoose, truthyMark } from './util.js';
import { parseDelimited, toCSV } from './csv.js';
import { normStatusName, allQualNames, FLAG_FIELDS } from './rules.js';

const ALIAS = {
  id: 'id', personid: 'id', soldierid: 'id', rosterid: 'id', pid: 'id', idno: 'id',
  status: 'status', personnelstatus: 'status', dutystatus: 'status',
  platoon: 'platoon', plt: 'platoon', section: 'platoon',
  rank: 'rank', grade: 'rank', last: 'last', lastname: 'last', surname: 'last', first: 'first', firstname: 'first', name: 'fullname', fullname: 'fullname',
  licenseexp: 'licExp', licenseexpiration: 'licExp', licexp: 'licExp', licenseexpires: 'licExp', licenseexpdate: 'licExp', driverlicenseexp: 'licExp', expiration: 'licExp', licenseexpirationdate: 'licExp', licensedate: 'licExp', operatorlicenseexp: 'licExp',
  ammo: 'ammo', hazmat: 'hazmat', nvd: 'nvd',
  gcssid: 'gcssId', gcssarmyid: 'gcssId', gcssarmyuserid: 'gcssId', gcssuserid: 'gcssId', gcssarmy: 'gcssId', gcss: 'gcssId', gcssarmyusername: 'gcssId',
  notes: 'note', note: 'note', remarks: 'note',
};
const DROP = new Set(['dodid', 'dod', 'dodidnumber', 'edipi', 'dob', 'dateofbirth', 'birthdate', 'birthday', 'ssn', 'socialsecuritynumber', 'last4', 'ssn4', 'ssnlast4', 'sin']);
const LICENSE_LIKE = new Set(['licenseno', 'licensenumber', 'dlnumber', 'driverlicensenumber', 'license']);

export function parseRosterRows(rows, settings, { existing = [] } = {}) {
  if (!rows.length) throw new Error('Nothing to import.');
  // header = first row that contains something mapping to last name or name or id
  let hi = -1, map = null;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const m = {}; rows[i].forEach((c, j) => { const f = ALIAS[normKeyText(c)]; if (f && !(f in m)) m[f] = j; });
    if (('last' in m || 'fullname' in m) && ('id' in m || 'status' in m || 'first' in m || 'rank' in m)) { hi = i; map = m; break; }
  }
  if (hi < 0) throw new Error('Could not find a header row. Expected columns such as ID, Status, Platoon, Rank, Last name, First name, License Exp, AMMO, HAZMAT, NVD, GCSS ID and one column per qualification.');
  const hdr = rows[hi]; const known = allQualNames(settings); const knownNorm = new Map(known.map((q) => [normKeyText(q), q]));
  const qualCols = []; const ignored = [], dropped = [], newQuals = [];
  hdr.forEach((c, j) => {
    const n = normKeyText(c); const name = clean(c); if (!name) return;
    if (Object.values(map).includes(j)) return;
    if (DROP.has(n)) { dropped.push(name); return; }
    if (LICENSE_LIKE.has(n)) { dropped.push(name + ' (license number not stored)'); return; }
    if (knownNorm.has(n)) { qualCols.push({ j, qual: knownNorm.get(n) }); return; }
    // unknown column: treat as a new qualification if its cells look like X marks
    const vals = rows.slice(hi + 1).map((r) => clean(r[j])).filter(Boolean);
    if (vals.length && vals.every((v) => truthyMark(v))) { qualCols.push({ j, qual: name }); newQuals.push(name); } else ignored.push(name);
  });
  const people = []; const issues = { rows: 0, noId: 0, dupIds: [], badLicense: [], generatedIds: 0, unknownStatus: [], matchedByName: 0, ambiguous: [] };
  // rows without an ID are matched to people already in the app by normalized last + first name (rank only breaks a tie), so importing the same
  // file twice - or a file with no ID column - updates people instead of adding a second copy (and trips keep pointing at the right person)
  const nameKey = (l, f) => normKeyText(l) + '|' + normKeyText(f); const byName = new Map();
  for (const p of existing) { const k = nameKey(p.last, p.first); if (!byName.has(k)) byName.set(k, []); byName.get(k).push(p); }
  const ids = new Set(existing.map((p) => p.id)); let seq = 0;
  const nextId = () => { let id; do { seq++; id = 'P' + String(seq).padStart(3, '0'); } while (ids.has(id)); return id; };
  const get = (r, f) => (f in map ? clean(r[map[f]]) : '');
  const batch = new Set();
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i]; if (!r.some((c) => clean(c))) continue;
    let last = get(r, 'last'), first = get(r, 'first');
    if (!last && 'fullname' in map) { const fn = get(r, 'fullname'); if (fn.includes(',')) { [last, first] = fn.split(',').map((x) => x.trim()); } else { const parts = fn.split(/\s+/); last = parts.pop() || ''; first = parts.join(' '); } }
    if (!last && !first && !get(r, 'id')) continue; issues.rows++;
    let id = get(r, 'id');
    if (!id) {
      issues.noId++; let m = (last || first) ? byName.get(nameKey(last, first)) || [] : [];
      if (m.length > 1) { const rk = normKeyText(get(r, 'rank')); if (rk) { const f = m.filter((p) => normKeyText(p.rank) === rk); if (f.length) m = f; } }
      if (m.length > 1) { issues.ambiguous.push(`${last}${first ? ', ' + first : ''}`); continue; } // two people with that name: do not guess
      if (m.length === 1) { id = m[0].id; issues.matchedByName++; } else { id = nextId(); issues.generatedIds++; ids.add(id); }
    }
    if (batch.has(id.toUpperCase())) { issues.dupIds.push(id); continue; } batch.add(id.toUpperCase());
    const lic = get(r, 'licExp'); let licExp = '', licExpRaw = '';
    if (lic) { const d = parseDateLoose(lic); if (d) licExp = d; else { licExpRaw = lic; issues.badLicense.push(id); } }
    const p = { id, status: normStatusName(get(r, 'status'), settings), platoon: get(r, 'platoon'), rank: get(r, 'rank'), last, first, licExp, licExpRaw, gcssId: get(r, 'gcssId'), note: get(r, 'note'), quals: [] };
    for (const f of FLAG_FIELDS) p[f] = f in map ? truthyMark(r[map[f]]) : false;
    for (const q of qualCols) if (truthyMark(r[q.j])) p.quals.push(q.qual);
    if (p.status && !settings.statuses.some((s) => normKeyText(s.name) === normKeyText(p.status))) issues.unknownStatus.push(`${id}: ${p.status}`);
    people.push(p);
  }
  if (!people.length && !issues.ambiguous.length) throw new Error('Header found but no people rows below it.');
  return { people, issues, newQuals, dropped, ignored, hasGcssCol: 'gcssId' in map, hasFlagCols: FLAG_FIELDS.filter((f) => f in map), hasQualCols: qualCols.length > 0, hasLicCol: 'licExp' in map, hasStatusCol: 'status' in map };
}
export const parseRosterText = (text, settings, o) => parseRosterRows(parseDelimited(text), settings, o);

/** mode: 'merge' (update by ID, add new, blank cells do not erase) | 'replace' */
export function applyRoster(existing, parsed, mode = 'merge') {
  if (mode === 'replace') { const lic = new Map(existing.filter((p) => p.licNo).map((p) => [p.id.toUpperCase(), p.licNo])); return { roster: parsed.people.map((p) => ({ ...p, ...(lic.has(p.id.toUpperCase()) ? { licNo: lic.get(p.id.toUpperCase()) } : {}) })), added: parsed.people.length, updated: 0 }; }
  const byId = new Map(existing.map((p) => [p.id.toUpperCase(), p])); const out = existing.map((p) => ({ ...p })); let added = 0, updated = 0;
  for (const np of parsed.people) {
    const o = byId.get(np.id.toUpperCase());
    if (!o) { out.push({ ...np }); added++; continue; }
    const i = out.findIndex((p) => p.id.toUpperCase() === np.id.toUpperCase());
    const m = { ...out[i] };
    for (const f of ['status', 'platoon', 'rank', 'last', 'first', 'note']) if (np[f]) m[f] = np[f];
    if (parsed.hasLicCol) { m.licExp = np.licExp; m.licExpRaw = np.licExpRaw; }
    if (np.gcssId) m.gcssId = np.gcssId; else if (parsed.hasGcssCol && !m.gcssId) m.gcssId = '';
    for (const f of parsed.hasFlagCols) m[f] = np[f];
    if (parsed.hasQualCols) m.quals = np.quals;
    out[i] = m; updated++;
  }
  return { roster: out, added, updated };
}
export function rosterToRows(roster, settings, { includeNote = true } = {}) {
  const quals = allQualNames(settings); const extra = new Set(); roster.forEach((p) => (p.quals || []).forEach((q) => { if (!quals.some((k) => normKeyText(k) === normKeyText(q))) extra.add(q); }));
  const allQ = [...quals, ...extra];
  const head = ['ID', 'Status', 'Platoon', 'Rank', 'Last name', 'First name', 'License Exp', 'AMMO', 'HAZMAT', 'NVD', 'GCSS ID', ...(includeNote ? ['Notes'] : []), ...allQ];
  const rows = roster.map((p) => [p.id, p.status, p.platoon, p.rank, p.last, p.first, p.licExp || p.licExpRaw || '', p.ammo ? 'X' : '', p.hazmat ? 'X' : '', p.nvd ? 'X' : '', p.gcssId || '', ...(includeNote ? [p.note || ''] : []), ...allQ.map((q) => ((p.quals || []).some((x) => normKeyText(x) === normKeyText(q)) ? 'X' : ''))]);
  return [head, ...rows];
}
export const rosterToCSV = (roster, settings) => toCSV(rosterToRows(roster, settings));
