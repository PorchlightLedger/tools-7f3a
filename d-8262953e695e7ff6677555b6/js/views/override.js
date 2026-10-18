// Commander override of a NO-GO vehicle: the dialog (typed name + reason + confirmation) and the "Commander override: NAME" marker.
// The override RECORDS an approval on the trip entry (see rules.js). It is not a login or a lock.
import { h, openSheet, confirmBox, toast, field } from '../dom.js';
import { getCtx } from '../ctx.js';
import { evaluateTrip, canOverrideEntry, applyOverride, removeOverride, checkOverrideInput, personLabel, NON_OVERRIDABLE, NON_OVERRIDABLE_WHY, OVERRIDE_NAME_MAX, OVERRIDE_REASON_MAX } from '../rules.js';
import { fmtDate } from '../util.js';

export const OVERRIDE_NOTE = 'This only records who approved sending this vehicle Out. It is a record, not a security lock: nobody is signed in, and anyone holding this phone could type any name. The approving commander is responsible for the decision.';
const pad2 = (n) => String(n).padStart(2, '0');
/** "17 Oct 2026 14:05" in the phone's local time (ISO timestamp in, '' when unreadable) */
export function stampText(iso) { const d = new Date(iso); if (!iso || isNaN(d)) return ''; return `${fmtDate(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }

/** one reason as text, with the person it is about next to it ("DRIVER LICENSE EXPIRED - SGT Doe"); r = {msg, raw?, pid?} */
export function reasonLine(r) { const p = r.pid ? getCtx().rosterById.get(r.pid) : null; const m = r.raw || r.msg; return p ? `${m} - ${personLabel(p)}` : m; }
/** why an override no longer covers (st = overrideStatus) */
export function outdatedWhy(st) { return !st.sameVehicle ? 'vehicle changed' : !st.sameCrew ? `${st.crewChanged.join(' / ')} changed` : st.extra.some((b) => NON_OVERRIDABLE.includes(b.code)) ? 'a reason that cannot be overridden' : 'new NO-GO reason'; }
/** the visible marker for an entry that carries an override. st = overrideStatus() result (or null when the trip is not being checked). */
export function overrideMark(entry, st) {
  const o = entry.override; if (!o || !o.by) return null;
  const note = st && !st.needed ? ' (not needed now)' : st && !st.covers ? ' (OUTDATED: ' + outdatedWhy(st) + ', does not cover Out)' : '';
  const legacy = st ? st.legacy : !['driver', 'tc', 'pax', 'towed'].some((k) => o[k] !== undefined);
  return h('div', { class: 'override-mark' + (st && st.needed && !st.covers ? ' stale' : ''), 'data-testid': 'override-mark', 'data-by': o.by, 'data-legacy': legacy ? '1' : null, role: 'note' },
    h('b', null, 'Commander override: ' + o.by), note ? h('span', null, note) : null,
    h('small', null, `Reason: ${o.reason}${o.at ? ' · ' + stampText(o.at) : ''}`),
    o.reasons && o.reasons.length ? h('small', { 'data-testid': 'override-overrode' }, 'Overrode: ' + o.reasons.map(reasonLine).join('; ')) : null,
    legacy ? h('small', { 'data-testid': 'override-legacy' }, 'Recorded before crews were kept: it covers this vehicle and these reasons only, whoever the crew is. Undo and record again to tie it to the current crew.') : null);
}

/** undo button handler: confirm, then remove the override from the entry. */
export async function undoOverride(entry, label, after) {
  const o = entry.override; if (!o) return;
  const ok = await confirmBox({ title: 'Remove commander override?', message: `Remove the override by ${o.by} from ${label}. If the vehicle is still NO-GO it will block Out again.`, okText: 'Remove override', danger: true });
  if (!ok) return; removeOverride(entry); after(); toast('Commander override removed');
}

/** open the override dialog for one vehicle entry of `trip` (a saved trip or an editor draft). Evaluates as if the trip were going Out, so Out-only reasons (PMCS) are included.
 *  onDone() runs after the override is recorded (the caller saves / redraws). */
export function openOverrideDialog(trip, entry, onDone) {
  const ctx = getCtx(); const ev = evaluateTrip({ ...trip, status: 'Out' }, ctx); const er = ev.entries && ev.entries.find((r) => r.entry === entry);
  const v = ctx.fleetByKey.get(entry.vehicle); const label = (v && (v.short || v.bumper)) || entry.vehicle || 'vehicle';
  const can = canOverrideEntry(er);
  if (!can.ok && can.blocked && can.blocked.length) { // explain instead of a bare refusal
    openSheet({ title: 'Cannot be overridden', build: (b, api) => { b.append(h('p', null, h('b', null, label), ' has reasons no commander can waive:'), h('ul', { class: 'reasons', 'data-testid': 'override-blocked' }, can.blocked.map((m) => h('li', { class: 'bad' }, reasonLine(m)))),
      h('div', { class: 'note warn', 'data-testid': 'override-why-not' }, NON_OVERRIDABLE_WHY), er.blockers.length > can.blocked.length ? h('p', { class: 'hint' }, 'Other reasons: ' + er.blockers.filter((m) => !can.blocked.includes(m)).map(reasonLine).join('; ')) : null); api.foot.append(h('button', { class: 'btn primary', type: 'button', onClick: () => api.close() }, 'OK')); } });
    return;
  }
  if (!can.ok) { toast(can.error, 'bad'); return; }
  openSheet({ title: 'Commander override', tall: true, build: (b, api) => {
    const err = h('p', { class: 'tr-msg bad', role: 'alert', 'data-testid': 'override-error' });
    const name = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'words', maxlength: OVERRIDE_NAME_MAX, placeholder: 'e.g. CPT Lee', 'data-testid': 'override-name', 'aria-label': 'Approving commander name', autofocus: true });
    const why = h('textarea', { rows: 3, maxlength: OVERRIDE_REASON_MAX, placeholder: 'Short reason (required)', 'data-testid': 'override-reason', 'aria-label': 'Reason for the override' });
    b.append(h('p', null, h('b', null, label), ' is NO-GO for these reasons. Overriding lets the trip go Out anyway:'),
      h('ul', { class: 'reasons', 'data-testid': 'override-reasons' }, can.reasons.map((m) => h('li', { class: 'bad' }, reasonLine(m)))),
      h('p', { class: 'hint', 'data-testid': 'override-limits' }, 'It covers this vehicle, these reasons and this crew / load (driver, TC, passengers, trailers). Change any of them and it no longer covers. ' + NON_OVERRIDABLE_WHY),
      h('div', { class: 'note warn', 'data-testid': 'override-honest' }, h('b', null, 'This is a record, not a lock. '), OVERRIDE_NOTE),
      field("Approving commander's name (required)", name), field('Reason (required)', why), err);
    const review = h('button', { class: 'btn danger', type: 'button', 'data-testid': 'override-review', onClick: async () => {
      const inp = checkOverrideInput({ by: name.value, reason: why.value }); err.textContent = inp.error; if (!inp.ok) { (inp.by ? why : name).focus(); return; }
      const ok = await confirmBox({ title: 'Record commander override?', okText: 'Yes, record override', cancelText: 'Go back', danger: true,
        html: h('div', null, h('p', null, h('b', null, inp.by), ` approves ${label} going Out although it is NO-GO.`), h('p', null, 'Reason: ' + inp.reason), h('ul', { class: 'reasons' }, can.reasons.map((m) => h('li', { class: 'bad' }, reasonLine(m)))), h('p', { class: 'hint' }, 'Recorded on the trip with this name, the reason and the time. You can undo it later. It is not a security lock.')) });
      if (!ok) return;
      const r = applyOverride(entry, er, { by: inp.by, reason: inp.reason }); if (!r.ok) { err.textContent = r.error; return; }
      api.close(); onDone(); toast(`Commander override recorded: ${inp.by}`);
    } }, 'Review and record override');
    api.foot.append(h('button', { class: 'btn', type: 'button', onClick: () => api.close() }, 'Cancel'), review);
  } });
}
