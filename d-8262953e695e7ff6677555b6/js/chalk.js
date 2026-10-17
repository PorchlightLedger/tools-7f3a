// Chalk planning: pure logic (no DOM). A "chalk" is a numbered load / lift. Vehicles are assigned to chalks in the plan
// (state.chalkPlan.assign[vehicleKey] = n); trips carry the same chalk number (trip.chalk). The two are kept in sync.
import { isActiveTrip, vehicleView, personLabel, personName, isNMC, vehicleUsable, towedUsable, evaluateTrip } from './rules.js';

export const chalkNums = (st) => st.chalkPlan.chalks.map((c) => c.n).sort((a, b) => a - b);
export const chalkLabel = (st, n) => { const c = st.chalkPlan.chalks.find((x) => x.n === +n); return `Chalk ${n}${c && c.label ? ' - ' + c.label : ''}`; };
export function addChalk(st) { const n = (Math.max(0, ...st.chalkPlan.chalks.map((c) => c.n))) + 1; st.chalkPlan.chalks.push({ n, label: '' }); return n; }
/** remove a chalk: its vehicles become unassigned, active trips lose the chalk number (trips are kept) */
export function removeChalk(st, n) {
  n = +n; st.chalkPlan.chalks = st.chalkPlan.chalks.filter((c) => c.n !== n);
  for (const k of Object.keys(st.chalkPlan.assign)) if (+st.chalkPlan.assign[k] === n) delete st.chalkPlan.assign[k];
  for (const t of st.trips) if (+t.chalk === n && isActiveTrip(t)) t.chalk = '';
}
/** put a vehicle on a chalk (n falsy = unassign). trips:true also moves the vehicle's active trips to that chalk. */
export function assignVehicleToChalk(st, key, n, { trips = true } = {}) {
  n = +n || 0;
  if (n && !st.chalkPlan.chalks.some((c) => c.n === n)) { st.chalkPlan.chalks.push({ n, label: '' }); st.chalkPlan.chalks.sort((a, b) => a.n - b.n); }
  if (n) st.chalkPlan.assign[key] = n; else delete st.chalkPlan.assign[key];
  if (trips) for (const t of st.trips) if (isActiveTrip(t) && t.vehicle === key) t.chalk = n || '';
  if (n) for (const t of st.trips) if (isActiveTrip(t) && t.vehicle === key && !t.chalk) t.chalk = n;
}
/** effective chalk of a vehicle: plan first, else the chalk of its active trip */
export function chalkOf(st, key) {
  const a = st.chalkPlan.assign[key]; if (a) return +a;
  const t = st.trips.find((x) => isActiveTrip(x) && x.vehicle === key && x.chalk); return t ? +t.chalk : 0;
}
const activeTripFor = (st, key) => st.trips.filter((t) => isActiveTrip(t) && t.vehicle === key).sort((a, b) => (a.no || 0) - (b.no || 0))[0] || null;

/** Everything the planner shows. ctx = rules context. platoon = '' or 'all' for no filter. */
export function chalkSummary(st, ctx, { platoon = 'all' } = {}) {
  const chalks = st.chalkPlan.chalks.slice().sort((a, b) => a.n - b.n).map((c) => ({ n: c.n, label: c.label || '', items: [], counts: { vehicles: 0, drivers: 0, tcs: 0, pax: 0, people: 0 }, warnings: [] }));
  const byN = new Map(chalks.map((c) => [c.n, c])); const unassigned = [];
  const rows = ctx.fleet.map((v) => ({ v, vw: vehicleView(v, ctx) })).filter(({ vw }) => vw.status !== 'TURNED IN' && vw.cls !== 'Mounted' && (platoon === 'all' || !platoon || vw.platoon === platoon));
  rows.sort((a, b) => a.v.key.localeCompare(b.v.key, 'en', { numeric: true }));
  const peopleChalks = new Map(); // person id -> Set of chalks
  for (const { v, vw } of rows) {
    const n = chalkOf(st, v.key); const trip = activeTripFor(st, v.key);
    const it = { v, vw, trip, chalk: n, driver: trip && ctx.rosterById.get(trip.driver) || null, tc: trip && ctx.rosterById.get(trip.tc) || null, pax: trip ? (trip.pax || []).map((id) => ctx.rosterById.get(id)).filter(Boolean) : [] };
    if (!n || !byN.has(n)) { unassigned.push(it); continue; }
    const c = byN.get(n); c.items.push(it);
  }
  for (const c of chalks) {
    let people = new Set();
    for (const it of c.items) {
      c.counts.vehicles++; const t = it.trip;
      if (t && t.driver) { c.counts.drivers++; people.add(t.driver); }
      if (t && t.tc) { c.counts.tcs++; people.add(t.tc); }
      if (t) { c.counts.pax += (t.pax || []).length; (t.pax || []).forEach((p) => people.add(p)); }
      for (const pid of t ? [t.driver, t.tc, ...(t.pax || [])].filter(Boolean) : []) { if (!peopleChalks.has(pid)) peopleChalks.set(pid, new Set()); peopleChalks.get(pid).add(c.n); }
      const nm = it.v.short;
      if (isNMC(it.vw.status)) c.warnings.push({ level: 'bad', key: it.v.key, msg: `${nm} is ${it.vw.status} (not mission capable)` });
      else if (it.vw.status !== 'FMC') c.warnings.push({ level: 'bad', key: it.v.key, msg: `${nm} status is ${it.vw.status}` });
      else if (it.vw.cls === 'Vehicle' && !vehicleUsable(it.vw)) c.warnings.push({ level: 'warn', key: it.v.key, msg: `${nm} cannot be dispatched (${it.vw.ruleProblem || 'GCSS says not dispatchable'})` });
      else if (it.vw.cls === 'Towed' && !towedUsable(it.vw)) c.warnings.push({ level: 'warn', key: it.v.key, msg: `${nm} cannot be dispatched (GCSS says not dispatchable)` });
      if (it.vw.cls === 'Vehicle' && !t) c.warnings.push({ level: 'info', key: it.v.key, msg: `${nm} has no trip yet (no driver)` });
      else if (t && it.vw.cls === 'Vehicle' && !t.driver) c.warnings.push({ level: 'warn', key: it.v.key, msg: `${nm}: trip #${t.no} has no driver` });
      if (t) { const ev = evaluateTrip(t, ctx); if (ev.result === 'NO-GO') c.warnings.push({ level: 'bad', key: it.v.key, msg: `${nm}: trip #${t.no} is NO-GO (${ev.blockers.length} reason${ev.blockers.length === 1 ? '' : 's'})` }); }
    }
    c.counts.people = people.size;
    if (!c.items.length) c.warnings.push({ level: 'info', key: '', msg: 'No vehicles on this chalk yet' });
  }
  for (const [pid, set] of peopleChalks) if (set.size > 1) { const p = ctx.rosterById.get(pid); const msg = `${personName(p) || pid} is on chalks ${[...set].sort((a, b) => a - b).join(' and ')}`; for (const n of set) byN.get(n).warnings.push({ level: 'warn', key: '', msg }); }
  return { chalks, unassigned, totals: { assigned: chalks.reduce((s, c) => s + c.counts.vehicles, 0), unassigned: unassigned.length, warnings: chalks.reduce((s, c) => s + c.warnings.filter((w) => w.level !== 'info').length, 0) } };
}
export { personLabel };
