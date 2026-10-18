// Persistence: IndexedDB (preferred) with localStorage fallback. Everything stays on this device.
import { defaultSettings, migrateTrip } from './rules.js';
import { uid } from './util.js';

// schema 2: trips = header + entries[] (one per vehicle); fleet vehicles / trips / entries / forms carry stable unique ids (vid / id) so records can be matched when shared between phones later.
export const SCHEMA = 2;
const DB = 'dispatch-app', KV = 'kv', KEY = 'state', LS_KEY = 'dispatch-app:state';

export const STARTER_PRESETS_LABEL = 'STARTER SET - EDIT TO MATCH YOUR TM / PMCS';
export const STARTER_PRESETS = [
  // [description, suggested status symbol]. Suggested symbols are generic starting points only - the TM PMCS table decides.
  ['Tire worn / cut / exposed cords', 'X'], ['Tire low pressure', '/'], ['Service or parking brake inoperative / out of adjustment', 'X'],
  ['Fuel leak', 'X'], ['Engine oil leak (check TM leak class)', '/'], ['Coolant leak (check TM leak class)', '/'], ['Hydraulic fluid leak (check TM leak class)', '/'],
  ['Headlight / blackout light inoperative', '/'], ['Brake / tail light inoperative', '/'], ['Windshield wiper inoperative', '/'], ['Horn inoperative', '/'],
  ['Mirror cracked / missing', '/'], ['Seat belt / restraint damaged or missing', 'X'], ['Fire extinguisher missing / seal broken / expired', 'X'],
  ['Battery terminal corroded / cable loose', '/'], ['Exhaust leak / damaged exhaust shield', 'X'], ['Canvas / bows / troop seats damaged', '/'],
  ['Steering play excessive / binding', 'X'], ['Gauge / warning light inoperative', '/'], ['Data plate / markings missing', '/'],
  ['Radio / mount / kit missing per MTOE', '-'], ['Required service / inspection due (enter what and when)', '-'], ['BII / COEI item missing (list item)', '/'],
].map(([desc, symbol], i) => ({ id: 'pre' + i, desc, symbol }));

export function emptyState() {
  return {
    schema: SCHEMA, settings: defaultSettings(), roster: [], fleet: [], trips: [], chalkSeq: 0,
    gcss: { exportDate: '', importedAt: '', fileName: '', rows: 0 }, rosterMeta: { importedAt: '' },
    presets: STARTER_PRESETS.map((p) => ({ ...p })), tmByType: {}, tmByModel: {}, chalkPlan: { chalks: [], assign: {} }, forms: [], ui: { dismissedPii: false, lastLocations: [] },
  };
}
/** fill in anything missing (older backups / partial files) without losing data */
export function normalizeState(raw) {
  const base = emptyState(); const s = { ...base, ...(raw || {}) };
  s.settings = { ...base.settings, ...(raw && raw.settings ? raw.settings : {}) };
  for (const k of ['roster', 'fleet', 'trips', 'forms', 'presets']) if (!Array.isArray(s[k])) s[k] = base[k];
  if (!Array.isArray(s.settings.modelMap) || !s.settings.modelMap.length) s.settings.modelMap = base.settings.modelMap;
  if (!Array.isArray(s.settings.statuses) || !s.settings.statuses.length) s.settings.statuses = base.settings.statuses;
  if (!Array.isArray(s.settings.prefixes)) s.settings.prefixes = base.settings.prefixes;
  if (!Array.isArray(s.settings.turnedIn)) s.settings.turnedIn = base.settings.turnedIn;
  if (!Array.isArray(s.settings.platoons)) s.settings.platoons = base.settings.platoons;
  if (!Array.isArray(s.settings.extraQuals)) s.settings.extraQuals = [];
  s.gcss = { ...base.gcss, ...(s.gcss || {}) }; s.rosterMeta = { ...base.rosterMeta, ...(s.rosterMeta || {}) }; s.ui = { ...base.ui, ...(s.ui || {}) };
  if (!s.tmByType || typeof s.tmByType !== 'object') s.tmByType = {};
  if (!s.tmByModel || typeof s.tmByModel !== 'object' || Array.isArray(s.tmByModel)) s.tmByModel = {};
  if (!Array.isArray(s.settings.platoonRules)) s.settings.platoonRules = [];
  if (typeof s.settings.unitUic !== 'string') s.settings.unitUic = '';
  const cp = s.chalkPlan && typeof s.chalkPlan === 'object' ? s.chalkPlan : {};
  s.chalkPlan = { chalks: (Array.isArray(cp.chalks) ? cp.chalks : []).map((c) => (typeof c === 'object' && c ? { n: +c.n, label: String(c.label || '') } : { n: +c, label: '' })).filter((c) => c.n > 0), assign: cp.assign && typeof cp.assign === 'object' && !Array.isArray(cp.assign) ? { ...cp.assign } : {} };
  // trips: older data used `chalk` as an auto trip counter. It is now the trip number `no`; `chalk` is the planned chalk (or '').
  s.trips = s.trips.filter((t) => t && typeof t === 'object');
  for (const t of s.trips) { if (!('no' in t)) { t.no = t.chalk || 0; t.chalk = ''; } if (t.chalk === null || t.chalk === undefined) t.chalk = ''; migrateTrip(t); }
  // stable unique ids: vehicles (vid), trips / entries / forms (id)
  s.fleet = s.fleet.filter((v) => v && typeof v === 'object'); for (const v of s.fleet) if (!v.vid) v.vid = uid('v');
  const vidOf = new Map(s.fleet.map((v) => [v.key, v.vid]));
  for (const t of s.trips) for (const e of t.entries) if (e.vehicle && !e.vid) e.vid = vidOf.get(e.vehicle) || '';
  s.forms = s.forms.filter((f) => f && typeof f === 'object');
  for (const f of s.forms) { if (!f.id) f.id = uid('f'); if (f.uicOverride === undefined) f.uicOverride = !!String(f.uic || '').trim(); if (!f.vehicleId && f.vehicleKey && vidOf.has(f.vehicleKey)) f.vehicleId = vidOf.get(f.vehicleKey); f.sv = 2; }
  s.schema = SCHEMA; return s;
}

function idbOpen() {
  return new Promise((res, rej) => {
    if (typeof indexedDB === 'undefined') return rej(new Error('no indexedDB'));
    const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(KV);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error('blocked'));
  });
}
const idbGet = (db, k) => new Promise((res, rej) => { const q = db.transaction(KV).objectStore(KV).get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
const idbSet = (db, k, v) => new Promise((res, rej) => { const t = db.transaction(KV, 'readwrite'); t.objectStore(KV).put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });

export class Store {
  constructor() { this.state = emptyState(); this.db = null; this.mode = 'memory'; this.listeners = new Set(); this._t = null; this._dirty = false; this._saving = Promise.resolve(); this.lastError = ''; }
  async load() {
    try { this.db = await idbOpen(); this.mode = 'indexeddb'; const v = await idbGet(this.db, KEY); if (v) this.state = normalizeState(v); }
    catch (e) {
      this.mode = 'localstorage';
      try { const t = localStorage.getItem(LS_KEY); if (t) this.state = normalizeState(JSON.parse(t)); } catch (e2) { this.mode = 'memory'; this.lastError = String(e2); }
    }
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch { /* ignore */ }
    return this.state;
  }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  /** call after mutating this.state */
  commit({ render = true } = {}) {
    this._dirty = true; clearTimeout(this._t); this._t = setTimeout(() => this.flush(), 150);
    if (render) this.listeners.forEach((f) => { try { f(this.state); } catch (e) { console.error(e); } });
  }
  async flush() {
    clearTimeout(this._t); if (!this._dirty) return this._saving; this._dirty = false;
    const snapshot = JSON.parse(JSON.stringify(this.state));
    this._saving = this._saving.then(async () => {
      try {
        if (this.mode === 'indexeddb') await idbSet(this.db, KEY, snapshot);
        else if (this.mode === 'localstorage') localStorage.setItem(LS_KEY, JSON.stringify(snapshot));
      } catch (e) { this.lastError = String(e); console.error('save failed', e); }
    });
    return this._saving;
  }
  replace(state) { this.state = normalizeState(state); this.commit(); return this.flush(); }
  async wipe() {
    clearTimeout(this._t); this._dirty = false; await this._saving.catch(() => {});
    try { if (this.db) { this.db.close(); this.db = null; } } catch { /* */ }
    await new Promise((res) => { try { const r = indexedDB.deleteDatabase(DB); r.onsuccess = r.onerror = r.onblocked = () => res(); } catch { res(); } });
    try { localStorage.removeItem(LS_KEY); localStorage.clear(); } catch { /* */ }
    try { sessionStorage.clear(); } catch { /* */ }
    this.state = emptyState();
    try { this.db = await idbOpen(); this.mode = 'indexeddb'; } catch { this.mode = 'localstorage'; }
    this.listeners.forEach((f) => f(this.state));
  }
}
