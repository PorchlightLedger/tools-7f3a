// Export / import of SETTINGS ONLY (no roster, fleet, trips or forms). Lets a unit load its UIC and platoon rules from a small JSON file
// instead of baking them into the public app.
import { defaultSettings, compilePlatoonRule } from './rules.js';
import { clean } from './util.js';

export const SETTINGS_FORMAT = 'dispatch-settings';
const SKIP_EXPORT = new Set(['asOfOverride']);
const MAX_BYTES = 400000;

export function exportSettings(st) {
  const settings = {}; for (const [k, v] of Object.entries(st.settings)) if (!SKIP_EXPORT.has(k)) settings[k] = v;
  const out = { format: SETTINGS_FORMAT, version: 1, note: 'Settings only - no personal data.', settings };
  if (st.tmByModel && Object.keys(st.tmByModel).length) out.tmByModel = st.tmByModel;
  return JSON.stringify(out, null, 2);
}
const isStr = (x) => typeof x === 'string' && x.length <= 4000;
const strList = (a) => Array.isArray(a) && a.length <= 2000 && a.every(isStr);
const VALID = {
  unitUic: isStr, unitName: isStr, recipient: isStr, dispatcherDefault: isStr, platoonRules: (a) => Array.isArray(a) && a.length <= 200 && a.every((r) => r && typeof r === 'object' && isStr(r.label) && isStr(r.pattern)),
  prefixes: strList, turnedIn: strList, platoons: strList, extraQuals: strList,
  modelMap: (a) => Array.isArray(a) && a.length <= 1000 && a.every((m) => m && typeof m === 'object' && isStr(m.model) && isStr(m.type) && isStr(m.qual) && ['Vehicle', 'Towed', 'Mounted'].includes(m.cls)),
  statuses: (a) => Array.isArray(a) && a.length <= 50 && a.every((s) => s && typeof s === 'object' && isStr(s.name) && typeof s.available === 'boolean'),
  licenseWindow: Number.isFinite, agingAmber: Number.isFinite, agingRed: Number.isFinite, gcssStaleDays: Number.isFinite,
  tcRule: (x) => ['WARN', 'BLOCK'].includes(x), pmcsRule: (x) => ['WARN', 'BLOCK'].includes(x), gcssIdRule: (x) => ['WARN', 'BLOCK', 'OFF'].includes(x),
  tcQualWarn: (x) => typeof x === 'boolean', xlsxIncludeRoster: (x) => typeof x === 'boolean', xlsxIncludeFleet: (x) => typeof x === 'boolean', showEPrefix: (x) => typeof x === 'boolean',
};
/** -> {patch, tmByModel, ignored[], problems[]} ; throws a friendly Error when the file is not a settings file */
export function parseSettingsJson(text) {
  if (typeof text !== 'string' || text.length > MAX_BYTES) throw new Error('That file is too large to be a settings file.');
  let j; try { j = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw new Error('That is not a valid settings file (not JSON).'); }
  if (!j || typeof j !== 'object' || j.format !== SETTINGS_FORMAT || !j.settings || typeof j.settings !== 'object') throw new Error('That is not a dispatch settings file (missing "format": "dispatch-settings").');
  const defs = defaultSettings(); const patch = {}, ignored = [], problems = [];
  for (const [k, v] of Object.entries(j.settings)) {
    if (!(k in defs) || !VALID[k]) { ignored.push(k); continue; }
    if (!VALID[k](v)) { problems.push(`${k}: wrong type or too long`); continue; }
    patch[k] = typeof v === 'string' ? clean(v) : v;
  }
  if (patch.platoonRules) for (const r of patch.platoonRules) { const c = compilePlatoonRule(r); if (c.error) problems.push(`platoon rule "${r.label} | ${r.pattern}": ${c.error}`); }
  let tmByModel = null;
  if (j.tmByModel !== undefined) { if (j.tmByModel && typeof j.tmByModel === 'object' && !Array.isArray(j.tmByModel)) { tmByModel = {}; for (const [k, v] of Object.entries(j.tmByModel)) if (v && typeof v === 'object' && isStr(clean(v.tm10)) ) tmByModel[clean(k).toUpperCase()] = { tm10: clean(v.tm10), pmcs: clean(v.pmcs), items: Array.isArray(v.items) ? v.items.filter((i) => i && isStr(clean(i.n))).map((i) => ({ n: clean(i.n), desc: clean(i.desc) })) : [] }; } else problems.push('tmByModel: wrong type'); }
  return { patch, tmByModel, ignored, problems };
}
/** apply a parsed patch to state. Returns a list of the keys that changed. */
export function applySettings(st, parsed) {
  const changed = []; for (const [k, v] of Object.entries(parsed.patch)) { if (JSON.stringify(st.settings[k]) !== JSON.stringify(v)) changed.push(k); st.settings[k] = v; }
  if (parsed.tmByModel) { for (const [k, v] of Object.entries(parsed.tmByModel)) st.tmByModel[k] = v; if (Object.keys(parsed.tmByModel).length) changed.push('tmByModel'); }
  return changed;
}
export const settingsFileName = () => 'dispatch_settings.json';
