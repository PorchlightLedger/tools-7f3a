// Chalk planning: pure logic (no DOM). A "chalk" is a numbered load / lift. Vehicles are assigned to chalks in the plan
// (state.chalkPlan.assign[vehicleKey] = n); a trip (header + vehicle entries) carries the chalk number (trip.chalk). A chalk can have
// several vehicles and a trip holds all of them: 'Create trip from chalk' loads every vehicle of the chalk as an entry.
import { uid } from './util.js';
import { isActiveTrip, vehicleView, personLabel, personName, isNMC, vehicleUsable, towedUsable, evaluateTrip, tripEntries, newEntry, migrateTrip } from './rules.js';

export const chalkNums = (st) => st.chalkPlan.chalks.map((c) => c.n).sort((a, b) => a - b);
export const chalkLabel = (st, n) => { const c = st.chalkPlan.chalks.find((x) => x.n === +n); return `Chalk ${n}${c && c.label ? ' - ' + c.label : ''}`; };
export function addChalk(st) { const n = (Math.max(0, ...st.chalkPlan.chalks.map((c) => c.n))) + 1; st.chalkPlan.chalks.push({ n, label: '' }); return n; }
/** remove a chalk: its vehicles become unassigned, active trips lose the chalk number (trips are kept) */
export function removeChalk(st, n) {
  n = +n; st.chalkPlan.chalks = st.chalkPlan.chalks.filter((c) => c.n !== n);
  for (const k of Object.keys(st.chalkPlan.assign)) if (+st.chalkPlan.assign[k] === n) delete st.chalkPlan.assign[k];
  for (const t of st.trips) if (+t.chalk === n && isActiveTrip(t)) t.chalk = '';
}
/** put a vehicle on a chalk (n falsy = unassign). trips:true moves an active trip whose ONLY vehicle this is (a multi-vehicle trip keeps its own chalk;
 *  the planner then warns that the vehicle and its trip disagree). Vehicles added to a chalk are never silently added to its existing trips: see chalkOffers(). */
export function assignVehicleToChalk(st, key, n, { trips = true } = {}) {
  n = +n || 0;
  if (n && !st.chalkPlan.chalks.some((c) => c.n === n)) { st.chalkPlan.chalks.push({ n, label: '' }); st.chalkPlan.chalks.sort((a, b) => a.n - b.n); }
  if (n) st.chalkPlan.assign[key] = n; else delete st.chalkPlan.assign[key];
  const solo = (t) => { const e = tripEntries(t); return e.length === 1 && e[0].vehicle === key; };
  if (trips) for (const t of st.trips) if (isActiveTrip(t) && solo(t)) t.chalk = n || '';
  if (n) for (const t of st.trips) if (isActiveTrip(t) && !t.chalk && tripEntries(t).some((e) => e.vehicle === key)) t.chalk = n;
}
const hasKey = (t, key) => tripEntries(t).some((e) => e.vehicle === key || (e.towed || []).includes(key));
/** active trips (Planned / Out) that carry this vehicle, as a vehicle or as a trailer */
export const activeTripsWith = (st, key) => st.trips.filter((t) => isActiveTrip(t) && hasKey(t, key)).sort((a, b) => (a.no || 0) - (b.no || 0));
/** effective chalk of a vehicle: plan first, else the chalk of its active trip */
export function chalkOf(st, key) {
  const a = st.chalkPlan.assign[key]; if (a) return +a;
  const t = activeTripsWith(st, key).find((x) => x.chalk); return t ? +t.chalk : 0;
}
export const chalkTrips = (st, n) => st.trips.filter((t) => isActiveTrip(t) && +t.chalk === +n).sort((a, b) => (a.no || 0) - (b.no || 0));
/** vehicles planned on chalk n (fleet order), split into primary vehicles and trailers/towed items. NMC vehicles are included on purpose (they show as NO-GO). */
export function chalkVehicles(st, ctx, n) {
  const rows = ctx.fleet.filter((v) => +st.chalkPlan.assign[v.key] === +n).map((v) => ({ v, vw: vehicleView(v, ctx) })).filter(({ vw }) => vw.status !== 'TURNED IN' && vw.cls !== 'Mounted');
  rows.sort((a, b) => a.v.key.localeCompare(b.v.key, 'en', { numeric: true }));
  return { vehicles: rows.filter((r) => r.vw.cls !== 'Towed'), trailers: rows.filter((r) => r.vw.cls === 'Towed') };
}
/** a new (unsaved) trip draft with ALL of chalk n's vehicles as entries; the chalk's trailers ride on the first vehicle (move them in the editor) */
export function tripFromChalk(st, ctx, n, base = {}) {
  const { vehicles, trailers } = chalkVehicles(st, ctx, n);
  const entries = vehicles.map(({ v }) => newEntry({ vehicle: v.key, vid: v.vid || '' }));
  if (entries.length && trailers.length) entries[0].towed = trailers.map(({ v }) => v.key);
  return { id: uid('t'), no: 0, sv: 2, chalk: +n, status: 'Planned', dateOut: '', timeOut: '', dateBack: '', timeBack: '', dest: '', dispatcher: '', notes: '', entries, created: new Date().toISOString(), ...base };
}
/** chalk vehicles / trailers that are on chalk n but not on this (Planned) trip: offered to the user, never added silently */
export function chalkOffers(st, ctx, trip) {
  if (!trip || trip.status !== 'Planned' || !trip.chalk) return [];
  const on = new Set(tripEntries(trip).flatMap((e) => [e.vehicle, ...(e.towed || [])]));
  const { vehicles, trailers } = chalkVehicles(st, ctx, trip.chalk);
  return [...vehicles, ...trailers].filter(({ v }) => !on.has(v.key));
}
/** add vehicles (primary) or trailers to a trip. Trailers go on the first vehicle entry. returns number added */
export function addChalkOffers(trip, rows) {
  let n = 0; if (!Array.isArray(trip.entries)) migrateTrip(trip);
  for (const { v, vw } of rows) {
    if (vw.cls === 'Towed') { if (!trip.entries.length) continue; const e = trip.entries[0]; if (!e.towed.includes(v.key)) { e.towed.push(v.key); n++; } }
    else if (!trip.entries.some((e) => e.vehicle === v.key)) { trip.entries.push(newEntry({ vehicle: v.key, vid: v.vid || '' })); n++; }
  }
  return n;
}

/** Everything the planner shows. ctx = rules context. platoon = '' or 'all' for no filter. */
export function chalkSummary(st, ctx, { platoon = 'all' } = {}) {
  const chalks = st.chalkPlan.chalks.slice().sort((a, b) => a.n - b.n).map((c) => ({ n: c.n, label: c.label || '', items: [], trips: chalkTrips(st, c.n), counts: { vehicles: 0, drivers: 0, tcs: 0, pax: 0, people: 0 }, warnings: [] }));
  const byN = new Map(chalks.map((c) => [c.n, c])); const unassigned = [];
  const rows = ctx.fleet.map((v) => ({ v, vw: vehicleView(v, ctx) })).filter(({ vw }) => vw.status !== 'TURNED IN' && vw.cls !== 'Mounted' && (platoon === 'all' || !platoon || vw.platoon === platoon));
  rows.sort((a, b) => a.v.key.localeCompare(b.v.key, 'en', { numeric: true }));
  const evals = new Map(); const evalOf = (t) => { if (!evals.has(t.id)) evals.set(t.id, evaluateTrip(t, ctx)); return evals.get(t.id); };
  const peopleChalks = new Map(); // person id -> Set of chalks
  const peopleVeh = new Map(); // person id -> Map(vehicle key -> chalk) over all active trips
  for (const t of st.trips.filter(isActiveTrip)) for (const e of tripEntries(t)) for (const pid of [e.driver, e.tc, ...(e.pax || [])].filter(Boolean)) { if (!peopleVeh.has(pid)) peopleVeh.set(pid, new Map()); peopleVeh.get(pid).set(e.vehicle || '(none)', chalkOf(st, e.vehicle) || +t.chalk || 0); }
  for (const { v, vw } of rows) {
    const n = chalkOf(st, v.key); const mine = activeTripsWith(st, v.key);
    const trip = mine.find((t) => +t.chalk === n) || mine[0] || null; const entry = trip ? tripEntries(trip).find((e) => e.vehicle === v.key) || null : null;
    const towedBy = trip && !entry ? tripEntries(trip).find((e) => (e.towed || []).includes(v.key)) || null : null;
    const it = { v, vw, trip, entry, towedBy, chalk: n, driver: entry && ctx.rosterById.get(entry.driver) || null, tc: entry && ctx.rosterById.get(entry.tc) || null, pax: entry ? (entry.pax || []).map((id) => ctx.rosterById.get(id)).filter(Boolean) : [] };
    if (!n || !byN.has(n)) { unassigned.push(it); continue; }
    byN.get(n).items.push(it);
  }
  for (const c of chalks) {
    const people = new Set();
    for (const it of c.items) {
      c.counts.vehicles++; const t = it.trip; const e = it.entry; const nm = it.v.short;
      if (e && e.driver) { c.counts.drivers++; people.add(e.driver); }
      if (e && e.tc) { c.counts.tcs++; people.add(e.tc); }
      if (e) { c.counts.pax += (e.pax || []).length; (e.pax || []).forEach((p) => people.add(p)); }
      for (const pid of e ? [e.driver, e.tc, ...(e.pax || [])].filter(Boolean) : []) { if (!peopleChalks.has(pid)) peopleChalks.set(pid, new Set()); peopleChalks.get(pid).add(c.n); }
      if (isNMC(it.vw.status)) c.warnings.push({ level: 'bad', key: it.v.key, msg: `${nm} is ${it.vw.status} (not mission capable)` });
      else if (it.vw.status !== 'FMC') c.warnings.push({ level: 'bad', key: it.v.key, msg: `${nm} status is ${it.vw.status}` });
      else if (it.vw.cls === 'Vehicle' && !vehicleUsable(it.vw)) c.warnings.push({ level: 'warn', key: it.v.key, msg: `${nm} cannot be dispatched (${it.vw.ruleProblem || 'GCSS says not dispatchable'})` });
      else if (it.vw.cls === 'Towed' && !towedUsable(it.vw)) c.warnings.push({ level: 'warn', key: it.v.key, msg: `${nm} cannot be dispatched (GCSS says not dispatchable)` });
      if (it.vw.cls === 'Vehicle') {
        if (!t) c.warnings.push({ level: 'info', key: it.v.key, msg: `${nm} has no trip yet (no driver)` });
        else if (!e) c.warnings.push({ level: 'warn', key: it.v.key, msg: `${nm} is on chalk ${c.n} but not on trip #${t.no}` });
        else {
          if (!e.driver) c.warnings.push({ level: 'warn', key: it.v.key, msg: `${nm}: trip #${t.no} has no driver` });
          if (!e.tc) c.warnings.push({ level: 'warn', key: it.v.key, msg: `${nm}: no TC / A-driver on trip #${t.no}` });
          if (+t.chalk && +t.chalk !== c.n) c.warnings.push({ level: 'warn', key: it.v.key, msg: `${nm} is on chalk ${c.n} but its trip #${t.no} is chalk ${t.chalk}` });
        }
      }
      if (t && e) { const er = evalOf(t).entries.find((r) => r.entry === e); if (er && er.result === 'NO-GO') c.warnings.push({ level: 'bad', key: it.v.key, msg: `${nm}: trip #${t.no} is NO-GO for this vehicle (${er.blockers.length} reason${er.blockers.length === 1 ? '' : 's'})` }); }
    }
    for (const t of c.trips) { const off = chalkOffers(st, ctx, t); if (off.length) c.warnings.push({ level: 'warn', key: '', msg: `Trip #${t.no} (Planned) is missing ${off.length} chalk vehicle${off.length === 1 ? '' : 's'}: ${off.map((r) => r.v.short).join(', ')} - open the trip to add ${off.length === 1 ? 'it' : 'them'}` }); }
    c.counts.people = people.size;
    if (!c.items.length) c.warnings.push({ level: 'info', key: '', msg: 'No vehicles on this chalk yet' });
  }
  for (const [pid, set] of peopleChalks) if (set.size > 1) { const p = ctx.rosterById.get(pid); const msg = `${personName(p) || pid} is on chalks ${[...set].sort((a, b) => a - b).join(' and ')}`; for (const n of set) byN.get(n).warnings.push({ level: 'warn', key: '', msg }); }
  for (const [pid, m] of peopleVeh) if (m.size > 1) { const p = ctx.rosterById.get(pid); const keys = [...m.keys()]; const names = keys.map((k) => (ctx.fleetByKey.get(k) || {}).short || k); const msg = `${personName(p) || pid} is on two vehicles (${names.join(' and ')})`; const seenN = new Set(); for (const ch of m.values()) if (byN.has(ch) && !seenN.has(ch)) { seenN.add(ch); byN.get(ch).warnings.push({ level: 'warn', key: '', msg }); } }
  return { chalks, unassigned, totals: { assigned: chalks.reduce((s, c) => s + c.counts.vehicles, 0), unassigned: unassigned.length, warnings: chalks.reduce((s, c) => s + c.warnings.filter((w) => w.level !== 'info').length, 0) } };
}
export { personLabel };
