// Built-in TM (technical manual) lookup: GCSS "Model number" / LIN -> operator manual (-10) used for the PMCS tables.
//
// Every number below was checked against a public source on 17 Oct 2026 and the source is recorded per row.
//   level 'apd'     = the number appears on an armypubs.army.mil (Army Publishing Directorate) record or listing, or in the
//                     title of an APD record that covers the model.
//   level 'manual'  = confirmed from the manual's own cover / title text or a public library listing of that manual (an APD record was
//                     not found / not consulted). Check the edition date on your copy.
// Models that could not be verified are NOT in this table: the app shows "TM not found - enter manually".
// The table is only a starting point: any vehicle or whole model can be overridden in the app (see resolveTm), and an override always wins.
// Edition dates / change numbers are deliberately NOT stored: look them up on the TM you are holding.
import { clean } from './util.js';

export const TM_NOT_FOUND = 'TM not found - enter manually';
const APD = 'https://armypubs.army.mil/ProductMaps/PubForm/Details.aspx?PUB_ID=';

export const TM_TABLE = [
  { id: 'hmmwv-387', models: ['M1151', 'M1151A1', 'M1152', 'M1152A1', 'M1165', 'M1165A1', 'M1167', 'M1113', 'M1114'], lins: ['T34704', 'T37588', 'T56383', 'T11588', 'T38873', 'T34840', 'T61630', 'T92446'],
    tm10: 'TM 9-2320-387-10', title: 'Operator manual, HMMWV M1113/M1114/M1151/M1152/M1165/M1167 series (incl. A1 / IAP-armor ready)', level: 'apd', url: APD + '1021841',
    source: 'APD record TM 9-2320-387-13&P (inactive) footnote: superseded by TM 9-2320-387-10 and TM 9-2320-387-23&P, both dated 30 Apr 2023; model list from the manual cover.' },
  { id: 'hmmwv-280', models: ['M1097', 'M1097A1', 'M1097A2'], lins: ['T07679'],
    tm10: 'TM 9-2320-280-10', title: 'Operator manual, M998 series HMMWV incl. heavy variant M1097/M1097A1/M1097A2', level: 'manual', url: 'https://www.nsndepot.com/Library/TM/TM-9-2320-280-10',
    source: 'Manual cover (Jan 1996) lists M1097, M1097A1, M1097A2 (NSN 2320-01-380-8604); LIN T07679 = "TRUCK, UTILITY, 1-1/4 TON, M1097 (HMMWV)". Not confirmed on an APD record - confirm the current edition.' },
  { id: 'lmtv-391', models: ['M1078A1', 'M1079A1'], lins: ['T60081', 'T93484'],
    tm10: 'TM 9-2320-391-10', pmcs: 'TM 9-2320-391-10, Chapter 4 PMCS: Tables 1-5 all models, Tables 6-10 M1078A1 (before / during / after / weekly / monthly)', title: 'Operator manual, M1078A1 series 2-1/2 ton 4x4 LMTV', level: 'manual', url: 'https://www.armyproperty.com/tm/9-2320-391-10',
    source: 'Public TM library index (LIN T60081 / T93484, NSN 2320-01-447-6343 / -3888 / -4938) and the TM contents list. Hand receipt TM 9-2320-391-10-HR cites it. Not confirmed on an APD record.' },
  { id: 'mtv-333', models: ['M1078A1P2WW', 'M1078A1P2WOW', 'M1078A1P2', 'M1157A1P2WW', 'M1157A1P2WOW', 'M1157A1P2', 'M1088A1P2', 'M1083A1P2', 'M1085A1P2', 'M1087A1P2', 'M1089A1P2', 'M1148A1P2'], lins: ['T59448', 'T42131', 'T65342', 'T65274'],
    tm10: 'TM 9-2320-333-23&P', pmcs: 'TM 9-2320-333-23&P (EM 0372): combined operator and field maintenance manual - the operator PMCS tables are inside it', title: 'Interactive electronic operator and field maintenance manual, FMTV / MTV A1P2 trucks (M1078A1P2, M1157A1P2, ...)', level: 'apd', url: APD + '1028374',
    source: 'APD record EM 0372 (12/30/2023, ACTIVE): "TM 9-2320-333-23&P ... M1157A1P2 10 ton dump with/without winch, M1078A1P2 ..." (CUI, distribution C - AKO/AESIP access).' },
  { id: 'mtv-392', models: ['M1088A1', 'M1088', 'M1083A1', 'M1084A1', 'M1085A1', 'M1086A1', 'M1087A1', 'M1089A1'], lins: ['T61239', 'T61307'],
    tm10: 'TM 9-2320-392-10-2', pmcs: 'TM 9-2320-392-10-2: PMCS for Model M1088A1 (before / weekly / monthly)', title: 'Operator manual (vol 2), M1083A1 series 5-ton 6x6 MTV, includes M1088A1 tractor', level: 'manual', url: 'https://www.armyproperty.com/tm/9-2320-392-10-2',
    source: 'Public TM library: TM 9-2320-392-10-2 lists M1088A1 (NSN 2320-01-447-3893, LIN T61239 / 2320-01-447-3900, LIN T61307) and has "PMCS Procedures for Model M1088A1". Not confirmed on an APD record. If your M1088 is an A1P2 truck use TM 9-2320-333-23&P instead (enter it per model).' },
  { id: 'het-let', models: ['M983A4LET', 'M983A4'], lins: ['T60946'],
    tm10: 'TM 9-2320-341-10', title: 'Operator manual, M983A4 Light Equipment Transporter (LET) 8x8', level: 'manual', url: 'https://www.armyproperty.com/tm/9-2320-341-10',
    source: 'Public TM library: TM 9-2320-341-10 covers M983A4 LET (NSN 2320-01-534-2229, LIN T60946); the older HEMTT TM 9-2320-279-10-1 does not cover the A4 LET. Not confirmed on an APD record.' },
  { id: 'hmee', models: ['TP I HMEE-I', 'HMEE-I', 'HMEE'], lins: ['H53576'],
    tm10: 'TM 5-2420-232-10', title: 'Operator manual, High Mobility Engineer Excavator Type I (HMEE-I)', level: 'manual', url: 'https://www.armyproperty.com/nsn/2420-01-535-4061',
    source: 'Public TM library / NSN 2420-01-535-4061 (LIN H53576). APD lists the armored (AOA) HMEE operator manual as TB 5-2540-233-10 (05/15/2008, ACTIVE) - use it if yours has the armor kit.' },
  { id: 'd7r', models: ['TYPE II'], lins: ['T05026'],
    tm10: 'TM 5-2410-241-10', title: 'Operator manual, Caterpillar D7R Series II dozer (Type I with winch, Type II with ripper)', level: 'manual', url: 'https://constructionbulldozers.tpub.com/TM-5-2410-241-10/',
    source: 'Public TM library: manual title "D7R Series II dozer, Type I with winch / Type II with ripper"; LIN T05026 = "TRACTOR, FULL TRACKED, LOW SPEED, T5, TYPE II, W/RIPPER". The GCSS model text "TYPE II" is generic - confirm it is the D7R.' },
  { id: 'grader-120m', models: ['120M'], lins: ['M05001'],
    tm10: 'TM 5-3805-293-10', title: 'Operator manual, motorized road grader 120M', level: 'manual', url: 'https://constructiongrader.tpub.com/TM-5-3805-293-10/',
    source: 'Public TM library title "Operator Manual for Motorized Road Grader Model 120M" (LIN M05001 = MOTOR GRADER). Not confirmed on an APD record.' },
  { id: 'm400', models: ['M400W', 'M400T'], lins: ['L77215'],
    tm10: 'TM 5-3805-292-10', title: 'Operator manual, M400T / M400W skid steer loader', level: 'manual', url: APD + '85623',
    source: 'Public TM library title "Operators Manual for M400T and M400W"; APD record LO 5-3805-292-13 (08/21/2009, ACTIVE) covers the same loaders (NSN 3805-01-552-4487 for M400W) but is a lubrication order, so confirm the -10 edition.' },
  { id: 'deuce', models: ['DV100'], lins: ['T76541'],
    tm10: 'TM 5-2430-200-10', title: 'Operator manual, Deployable Universal Combat Earthmover (DEUCE) model DV100', level: 'manual', url: APD + '84569',
    source: 'Public TM library title; APD record TB 5-2430-200-13&P (05/30/2008, ACTIVE) is the armored (AOA) DV100 operator and field manual - use it if yours has the armor kit.' },
  { id: 'm870a3', models: ['M870A3'], lins: ['S70594'],
    tm10: 'TM 5-2330-325-13&P', title: 'Operator and field maintenance manual, semitrailer M870A3 (MHET) 40 ton lowbed', level: 'manual', url: 'https://www.nsndepot.com/Library/TM/TM-5-2330-325-13-P',
    source: 'Manual cover dated 23 Jun 2014: "This manual supersedes TM 5-2330-325-14&P dated 30 June 2004". LIN S70594 = SEMITRAILER, LOW BED, 40 TON.' },
  { id: 'm1101', models: ['M1101', 'M1102'], lins: ['T95992'],
    tm10: 'TM 9-2330-392-14&P', title: 'Operator through field maintenance manual with RPSTL, M1101 / M1102 trailer', level: 'manual', url: 'https://www.armyproperty.com/tm/9-2330-392-14',
    source: 'Public TM library: TM 9-2330-392-14&P covers M1101 (NSN 2330-01-387-5443, LIN T95992). Not confirmed on an APD record.' },
  { id: 'm1095', models: ['M1095', 'M1082'], lins: ['T95555'],
    tm10: 'TM 9-2330-394-13&P-1', title: 'Operator and field maintenance manual (vol 1 of 2), M1082 LMTVT / M1095 MTVT trailers', level: 'apd', url: APD + '88039',
    source: 'APD record TM 9-2330-394-13&P-1 (09/25/2015, ACTIVE, change 001 listed): "M1095 series 5 ton medium tactical vehicle trailer, NSN 2330-01-449-1776". Volume 2 is TM 9-2330-394-13&P-2.' },
  { id: 'm149a2', models: ['M149A2', 'M149A1', 'M149'], lins: ['W98825'],
    tm10: 'TM 9-2330-267-14&P', title: 'Operator through direct support maintenance manual with RPSTL, M149 / M149A1 / M149A2 water tank trailer', level: 'manual', url: 'https://www.armyproperty.com/tm/9-2330-267-14P',
    source: 'Public TM library: TM 9-2330-267-14&P covers M149A2 (NSN 2330-01-108-7367, LIN W98825). Not confirmed on an APD record.' },
  { id: 'mep831', models: ['MEP831', 'MEP-831A', 'MEP831A', 'MEP-832A'], lins: ['G18358'],
    tm10: 'TM 9-6115-639-13&P', title: 'Operator and field maintenance manual with RPSTL, 3 kW tactical quiet generator set MEP-831A / MEP-832A', level: 'apd', url: APD + '1003536',
    source: 'APD record TM 9-6115-639-13&P (08/31/2017, ACTIVE): MEP-831A (NSN 6115-01-285-3012).' },
  { id: 'pu2001', models: ['PU-2001'], lins: ['L26934'],
    tm10: 'TM 9-6115-755-13&P', title: 'Operator and field maintenance manual, 5 kW light tactical trailer-mounted generator set PU-2001 (TO 35C2-3-531-11)', level: 'manual', url: 'https://radionerds.com/images/3/32/086807_TM_9-6115-755-13P.pdf',
    source: 'Public copy of the manual titled TM 9-6115-755-13&P / TO 35C2-3-531-11 covering PU-2001 (NSN 6115-01-562-3992). Not confirmed on an APD record.' },
  { id: 'crows', models: ['60201886-03', 'M153'], lins: ['A90594'],
    tm10: 'TM 9-1090-219-10', title: 'Operator manual, armament subsystem remotely operated, M153 CROWS (P/N 60201886-03)', level: 'apd', url: APD + '1028246',
    source: 'APD record TM 9-1090-219-10 (02/05/2024, ACTIVE, supersedes the 30 Mar 2017 edition).' },
];
// Not resolved (no operator manual number could be verified; the app shows "TM not found - enter manually"):
//   924HLTLDR (Caterpillar 924H loader, LIN L76897): only field-maintenance TM 5-3805-298-23-1/-2/-4 was found in public libraries - no -10 verified.
export const TM_UNRESOLVED_NOTES = { '924HLTLDR': 'Only field maintenance volumes (TM 5-3805-298-23-1/-2/-4) were found publicly. No operator -10 verified. Enter the TM from your TM list.' };

const key = (s) => clean(s).toUpperCase().replace(/\s+/g, ' ');
export const builtinByModel = (() => { const m = new Map(); for (const r of TM_TABLE) for (const x of r.models) m.set(key(x), r); return m; })();
export const builtinByLin = (() => { const m = new Map(); for (const r of TM_TABLE) for (const x of r.lins || []) m.set(key(x), r); return m; })();
export const modelKey = key;

/**
 * Resolve the TM for a vehicle. Priority (first hit wins):
 *   1. manual entry on the vehicle            (v.tmSet)
 *   2. manual entry for the vehicle's model   (tmByModel[MODEL])
 *   3. TMs remembered for the vehicle type    (tmByType[type])  - legacy "Remember TMs" lists
 *   4. built-in table by model, then by LIN
 *   5. unresolved
 * returns {tm10, pmcs, title, level: 'vehicle'|'model'|'type'|'builtin-apd'|'builtin-manual'|'none', source, url, note, resolved}
 */
export function resolveTm(v, { tmByModel = {}, tmByType = {}, typeName = '' } = {}) {
  const none = { tm10: '', pmcs: '', title: '', level: 'none', source: '', url: '', note: (TM_UNRESOLVED_NOTES[key(v && v.model)] || ''), resolved: false, label: TM_NOT_FOUND };
  if (!v) return none;
  const t = v.tmSet; if (t && (clean(t.tm10) || clean(t.pmcs))) return { tm10: clean(t.tm10), pmcs: clean(t.pmcs), title: clean(t.title), level: 'vehicle', source: 'Entered for this vehicle', url: '', note: '', resolved: true, label: clean(t.tm10) || clean(t.pmcs) };
  const m = tmByModel[key(v.model)]; if (m && (clean(m.tm10) || clean(m.pmcs))) return { tm10: clean(m.tm10), pmcs: clean(m.pmcs), title: clean(m.title), level: 'model', source: 'Entered for model ' + clean(v.model), url: '', note: '', resolved: true, label: clean(m.tm10) || clean(m.pmcs) };
  const ty = tmByType && typeName && tmByType[typeName]; if (ty && ty.length && clean(ty[0].tm)) return { tm10: clean(ty[0].tm), pmcs: clean((ty[1] || {}).tm), title: '', level: 'type', source: 'Remembered for vehicle type ' + typeName, url: '', note: '', resolved: true, label: clean(ty[0].tm) };
  const b = builtinByModel.get(key(v.model)) || builtinByLin.get(key(v.linSet || v.lin));
  if (b) return { tm10: b.tm10, pmcs: b.pmcs || '', title: b.title, level: b.level === 'apd' ? 'builtin-apd' : 'builtin-manual', source: b.source, url: b.url, note: '', resolved: true, label: b.tm10, rowId: b.id };
  return none;
}
export function tmLevelText(level) { return ({ vehicle: 'entered for this vehicle', model: 'entered for this model', type: 'remembered for this type', 'builtin-apd': 'built-in (Army Publishing Directorate record)', 'builtin-manual': 'built-in (public manual listing - verify edition)', none: 'not found' })[level] || ''; }
/** the TM lines to put on a 5988-E: [{tm, date, change}] (date / change are never guessed) */
export function tmPubs(res, n = 2) {
  const out = []; if (res.tm10) out.push({ tm: res.tm10, date: '', change: '' });
  const plain = /^(TM|TB)\s[0-9A-Z-]+(&P)?(-\d+)?$/i.test(clean(res.pmcs)); // a bare TM number goes on its own line; descriptive text stays a note
  if (plain && clean(res.pmcs).toUpperCase() !== clean(res.tm10).toUpperCase()) out.push({ tm: clean(res.pmcs), date: '', change: '' });
  while (out.length < n) out.push({ tm: '', date: '', change: '' }); return out;
}
/** TM item numbers known for a model: saved list entered by the user + item numbers used on earlier worksheets for this model */
export function knownItems(model, st) {
  const out = new Map(); const mk = key(model);
  const saved = (st.tmByModel && st.tmByModel[mk] && st.tmByModel[mk].items) || [];
  for (const it of saved) if (clean(it.n)) out.set(clean(it.n), { n: clean(it.n), desc: clean(it.desc), from: 'saved' });
  for (const f of st.forms || []) if (key(f.model) === mk) for (const x of f.faults || []) { const n = clean(x.item); if (n && !out.has(n)) out.set(n, { n, desc: clean(x.desc), from: 'used' }); }
  return [...out.values()];
}
