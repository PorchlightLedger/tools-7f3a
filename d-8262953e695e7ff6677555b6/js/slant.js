// Slant report: equipment on hand / NMC by category, generated live from the fleet. Pure functions (no DOM, no storage).
import { vehicleStatus, isXBumper, asOfDate } from './rules.js';
import { clean } from './util.js';

/** the unit line comes from the user's own Settings > Unit name (never baked into the app). '' when not set.
 *  Trimmed; line breaks / tabs (only possible through an imported settings file) become a space so the first line of the text and the mail subject stay one line. */
export const slantHeader = (settings) => clean(settings && settings.unitName).replace(/[\r\n\t]+/g, ' ').trim();

/** EDIT HERE. One entry per slant row, in print order.
 *  models: GCSS "Model number" keys (case-insensitive, exact). A vehicle whose model is listed here is counted in that row.
 *  names:  optional fallback for vehicles whose model is not listed in ANY row: a list of alternatives; each alternative is a list of
 *          regular expressions that must ALL match the vehicle's "model + material description" text (case-insensitive).
 *  A vehicle is counted in at most one row (model keys win over names; the first row that matches wins). Rows with no match show 0 / 0.
 *  Vehicles that fit no row (generators, CROWS, M1101 / M1095 trailers, ...) are simply not on the slant. FLA and LHS are deliberately not here. */
export const SLANT_ROWS = [
  { label: 'Humvee', models: ['M1151A1', 'M1152A1', 'M1165A1', 'M1097'] },
  { label: 'LMTV', models: ['M1078A1P2WW', 'M1078A1P2WOW'] },
  { label: 'Water trailer', models: ['M149A2'] },
  { label: 'Dump truck', models: ['M1157A1P2WW', 'M1157A1P2WOW'] },
  { label: 'Dozer', models: [] }, // no dozer model in the fleet today (TYPE II is counted as Type 2 / D6 below); add the model key here when one arrives
  { label: 'Skid steer', models: ['M400W'] },
  { label: 'HEMI', models: ['TP I HMEE-I'] },
  { label: 'Loader', models: ['924HLTLDR'] },
  { label: 'DV100 / Deuce', models: ['DV100'] },
  { label: 'Tractor', models: ['M1088A1'] },
  { label: '40-ton', models: ['M983A4LET'] }, // HEMTT tractor
  { label: '40-ton trailer', models: ['M870A3'] },
  { label: 'Type 2 / D6', models: ['TYPE II'] },
  { label: 'HEMTT wrecker', models: ['M984A4'], names: [[/\bHEMTT\b/i, /\bWRECKER\b/i]] },
  { label: 'MTV wrecker', models: ['M1089A1P2'], names: [[/\bMTV\b/i, /\bWRECKER\b/i]] },
  { label: 'HEMTT fueler', models: ['M978A4'], names: [[/\bHEMTT\b/i, /\b(FUELER|FUELING|FUEL SERVICING|TANKER)\b/i]] },
  { label: 'MTV fueler', models: [], names: [[/\bMTV\b/i, /\b(FUELER|FUELING|FUEL SERVICING|TANKER)\b/i]] },
];

const keyOf = (m) => clean(m).toUpperCase();
/** index into rows of the row this vehicle belongs to, or -1 */
export function slantRowIndex(v, rows = SLANT_ROWS) {
  const m = keyOf(v.model);
  if (m) { const i = rows.findIndex((r) => (r.models || []).some((x) => keyOf(x) === m)); if (i >= 0) return i; }
  const hay = `${clean(v.model)} ${clean(v.desc)}`;
  return rows.findIndex((r) => (r.names || []).some((alt) => alt.every((re) => re.test(hay))));
}

/** -> {rows:[{label, onHand, nmc, x}], uncovered, total}
 *  on-hand = every vehicle on the books in the row, INCLUDING X vehicles and turned-in vehicles.
 *  NMC = vehicles whose status is NMCM or NMCS, plus every vehicle whose admin / bumper number ends in digit + X (A-362X; isXBumper, the
 *  same rule as the app's NMC-X flag). One vehicle counts once even when it is both. X vehicles are counted in NMC even when turned in.
 *  A turned-in vehicle that is not X is off the books for status purposes (status TURNED IN) and is not NMC.
 *  x = how many of the row's NMC are X vehicles (shown on screen only). */
export function slantReport(fleet, settings, rows = SLANT_ROWS) {
  const out = rows.map((r) => ({ label: r.label, onHand: 0, nmc: 0, x: 0 })); let uncovered = 0;
  for (const v of fleet || []) {
    const i = slantRowIndex(v, rows); if (i < 0) { uncovered++; continue; }
    const row = out[i]; row.onHand++;
    const st = vehicleStatus(v, settings).status; const isX = isXBumper(v.bumper, settings.prefixes, v.uic);
    if (isX) { row.nmc++; row.x++; } else if (st === 'NMCM' || st === 'NMCS') row.nmc++;
  }
  return { rows: out, uncovered, total: (fleet || []).length };
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-10-18" -> "Oct 18, 2026" */
export function slantDate(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${MON[+m[2] - 1]} ${+m[3]}, ${m[1]}` : String(iso || ''); }
export const slantAsOf = (settings, now = new Date()) => asOfDate(settings, now);
/** `Slant report, <unit name> - <date>`; without a unit name `Slant report - <date>` */
export const slantSubject = (iso, unitName = '') => { const u = slantHeader({ unitName }); return `${u ? `Slant report, ${u}` : 'Slant report'} - ${slantDate(iso)}`; };

/** the plain-text table that is shared / copied / mailed: unit line (only when a unit name is set), date line, blank line, then exactly the 3-column table */
export function slantText(report, iso, unitName = '') {
  const rows = report.rows; const w = Math.max('Equipment'.length, ...rows.map((r) => r.label.length));
  const line = (a, b, c) => `${a.padEnd(w)}  ${String(b).padStart(7)}  ${String(c).padStart(3)}`;
  const unit = slantHeader({ unitName });
  return [...(unit ? [unit] : []), `Slant report - ${slantDate(iso)}`, '', line('Equipment', 'On-hand', 'NMC'), ...rows.map((r) => line(r.label, r.onHand, r.nmc))].join('\n');
}
