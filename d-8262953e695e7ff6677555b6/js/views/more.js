import { S, store, commit, go, APP_VERSION, getCtx } from '../ctx.js';
import { h, openSheet, toast, field, segmented, toggle, confirmBox, typedConfirm, clear, readFileText, closeAllSheets } from '../dom.js';
import { DEFAULT_MODEL_MAP, DEFAULT_PERSON_STATUSES, normBumper } from '../rules.js';
import { makeBackup, parseBackup, backupFileName, shareOrDownload } from '../backup.js';
import { openExportSheet } from './exporter.js';
import { renderWalk } from './walk.js';
import { renderForms, openPresetEditor } from './form.js';
import { btn, piiNote } from '../ui.js';
import { clean } from '../util.js';

export function renderMore(root, rest, top) {
  if (rest[0] === 'walk') return renderWalk(root, rest, top);
  if (rest[0] === 'forms') return renderForms(root, rest, top);
  if (rest[0] === 'settings') { setTimeout(() => { history.replaceState(null, '', '#more'); openSettings(); }, 0); }
  if (rest[0] === 'backup') { setTimeout(() => { history.replaceState(null, '', '#more'); openBackup(); }, 0); }
  const item = (title, sub, onClick, testid) => h('button', { type: 'button', class: 'menu-item', onClick, 'data-testid': testid }, h('span', null, h('b', null, title), h('small', null, sub)), h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'));
  root.append(piiNote(),
    h('div', { class: 'menu' },
      item('Walk-around (motor pool)', 'Tap a vehicle: status, fault notes, location, NMC-since', () => go('#more/walk'), 'menu-walk'),
      item('DA 5988-E worksheet', 'Pick vehicle, tap status symbols, make a PDF', () => go('#more/forms'), 'menu-forms'),
      item('Share dispatch spreadsheet', 'Build the .xlsx on this phone and send it', () => openExportSheet(), 'menu-export'),
      item('Settings', 'Email recipient, rules, type map, lists', () => openSettings(), 'menu-settings'),
      item('Backup, restore & wipe', 'JSON backup via share sheet; wipe all data', () => openBackup(), 'menu-backup'),
      item('About, privacy & help', `Version ${APP_VERSION} · works offline`, () => openHelp(), 'menu-help')));
  return 'More';
}

const lines = (t) => String(t || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
export function openSettings() {
  const st = S(); const s = st.settings;
  openSheet({ title: 'Settings', tall: true, build: (b, api) => {
    const num = (label, key, hint) => field(label, h('input', { type: 'number', inputmode: 'numeric', min: '0', value: String(s[key]), 'data-testid': 's-' + key, onChange: (e) => { s[key] = Math.max(0, parseInt(e.target.value, 10) || 0); commit({ render: false }); } }), hint);
    const sel = (label, key, opts, hint) => field(label, segmented(opts.map((o) => [o, o]), s[key], (v) => { s[key] = v; commit({ render: false }); }, { label }), hint);
    b.append(h('h3', null, 'Email'),
      field('Recipient email for the dispatch spreadsheet', h('input', { type: 'email', inputmode: 'email', autocomplete: 'off', autocapitalize: 'none', placeholder: 'not set', value: s.recipient, 'data-testid': 's-recipient', onInput: (e) => { s.recipient = e.target.value.trim(); commit({ render: false }); } }), 'Leave blank until known. Used for the mailto fallback; the share sheet lets you pick anyone.'),
      field('Unit name (shown on exports / forms)', h('input', { type: 'text', value: s.unitName, onInput: (e) => { s.unitName = e.target.value; commit({ render: false }); } })),
      field('Default dispatcher', h('input', { type: 'text', value: s.dispatcherDefault, 'data-testid': 's-dispatcher', onInput: (e) => { s.dispatcherDefault = e.target.value; commit({ render: false }); } })));
    b.append(h('h3', null, 'Dispatch rules'), num('License warning window (days)', 'licenseWindow', 'License expiring within this many days = WARN'),
      sel('TC / A-driver license problem is', 'tcRule', ['WARN', 'BLOCK']), toggle('Warn if TC / A-driver not qualified on the vehicle type', s.tcQualWarn, (v) => { s.tcQualWarn = v; commit({ render: false }); }),
      sel('Trip Out without PMCS marked is', 'pmcsRule', ['WARN', 'BLOCK']), sel('Driver without GCSS-Army ID is', 'gcssIdRule', ['WARN', 'BLOCK', 'OFF'], 'Default WARN (TC without an ID also warns). BLOCK makes the trip NO-GO.'),
      num('NMC aging: amber at (days)', 'agingAmber'), num('NMC aging: red at (days)', 'agingRed'), num('GCSS data stale after (days)', 'gcssStaleDays'),
      field('As-of date override (testing only)', h('input', { type: 'date', value: s.asOfOverride || '', onChange: (e) => { s.asOfOverride = e.target.value; commit({ render: false }); } }), 'Blank = today'));
    const ta = (label, val, rows, hint, testid) => { const t = h('textarea', { rows, value: val, spellcheck: 'false', autocapitalize: 'none', 'data-testid': testid }); return { el: field(label, t, hint), t }; };
    const turned = ta('Turned-in bumpers (off the books, excluded from counts), one per line', s.turnedIn.join('\n'), 3, 'Matching ignores prefix, dashes and case.', 's-turnedin');
    const pref = ta('Bumper prefixes to strip, one per line', s.prefixes.join('\n'), 2, 'Optional. A leading unit code before an "A-123" style number is removed automatically.', 's-prefixes');
    const stat = ta('Personnel statuses, one per line: Name | Y (can dispatch) or N', s.statuses.map((x) => `${x.name} | ${x.available ? 'Y' : 'N'}`).join('\n'), 4, 'Only statuses marked Y can drive.', 's-statuses');
    const plt = ta('Platoons, one per line', s.platoons.join('\n'), 4, '', 's-platoons');
    const xq = ta('Extra qualifications (not tied to a vehicle type), one per line', s.extraQuals.join('\n'), 2, '', 's-extraquals');
    const map = ta('Type map: GCSS Model number | Type name | Qualification (exact name or NONE) | Vehicle / Towed / Mounted', s.modelMap.map((m) => `${m.model} | ${m.type} | ${m.qual} | ${m.cls}`).join('\n'), 12, 'Every GCSS model must be listed. A blank qualification or an unlisted model makes that vehicle NO-GO (fail closed).', 's-typemap');
    b.append(h('h3', null, 'Lists'), turned.el, pref.el, stat.el, plt.el, xq.el, h('h3', null, 'Type map'), map.el,
      h('div', { class: 'row' }, btn('Reset type map to defaults', async () => { if (await confirmBox({ title: 'Reset type map?', message: 'Replaces your edits with the built-in list.', okText: 'Reset', danger: true })) { map.t.value = DEFAULT_MODEL_MAP.map((m) => `${m.model} | ${m.type} | ${m.qual} | ${m.cls}`).join('\n'); } }), btn('Edit 5988-E fault presets', () => openPresetEditor())));
    const err = h('p', { class: 'hint bad', role: 'alert' }); b.append(err);
    api.foot.append(h('button', { class: 'btn', type: 'button', onClick: () => api.close() }, 'Close'), h('button', { class: 'btn primary', type: 'button', 'data-testid': 's-save', onClick: () => {
      try {
        const mm = lines(map.t.value).map((l, i) => { const p = l.split('|').map((x) => x.trim()); if (p.length < 4 && p.length !== 3) throw new Error(`Type map line ${i + 1}: use "Model | Type | Qualification | Vehicle/Towed/Mounted"`); const cls = (p[3] || 'Vehicle').toLowerCase(); const C = { vehicle: 'Vehicle', towed: 'Towed', mounted: 'Mounted' }[cls]; if (!C) throw new Error(`Type map line ${i + 1}: class must be Vehicle, Towed or Mounted`); return { model: p[0], type: p[1], qual: p[2] || '', cls: C }; });
        const seen = new Set(); mm.forEach((m) => { const k = m.model.toUpperCase(); if (seen.has(k)) throw new Error(`Type map: duplicate model ${m.model}`); seen.add(k); });
        const sts = lines(stat.t.value).map((l, i) => { const p = l.split('|').map((x) => x.trim()); if (!p[0]) throw new Error(`Status line ${i + 1} is empty`); return { name: p[0], available: /^y/i.test(p[1] || '') }; });
        if (!sts.length) throw new Error('Keep at least one personnel status.');
        s.modelMap = mm; s.statuses = sts; s.platoons = lines(plt.t.value); s.extraQuals = lines(xq.t.value); s.prefixes = lines(pref.t.value).map((x) => x.replace(/\s+/g, '')); s.turnedIn = lines(turned.t.value);
        commit(); api.close(); toast('Settings saved');
      } catch (e) { err.textContent = e.message; toast(e.message, 'bad'); }
    } }, 'Save lists'));
  } });
}

export function openBackup() {
  const st = S();
  openSheet({ title: 'Backup, restore & wipe', tall: true, build: (b, api) => {
    b.append(piiNote(), h('p', null, `Storage: ${store.mode}. Roster ${st.roster.length}, fleet ${st.fleet.length}, trips ${st.trips.length}, 5988-E worksheets ${st.forms.length}.`));
    b.append(h('h3', null, 'Export backup'), h('p', { class: 'hint' }, 'A JSON file with everything in the app (includes personal data). Save it to Files / a secure place via the share sheet.'),
      h('button', { class: 'btn primary wide', type: 'button', 'data-testid': 'backup-export', onClick: async () => { await store.flush(); const bytes = new TextEncoder().encode(makeBackup(st)); const r = await shareOrDownload(bytes, backupFileName(), 'application/json', { title: 'Dispatch app backup (PII)' }); if (r.method !== 'cancelled') toast(r.method === 'share' ? 'Backup shared' : 'Backup saved to Downloads'); } }, 'Export backup'));
    const file = h('input', { type: 'file', accept: '.json,application/json', 'aria-label': 'Choose backup file', 'data-testid': 'backup-file' }); const msg = h('div', { 'data-testid': 'backup-msg' });
    file.addEventListener('change', async () => {
      const f = file.files[0]; if (!f) return; clear(msg);
      try { const state = parseBackup(await readFileText(f));
        const ok = await confirmBox({ title: 'Restore this backup?', message: `It contains ${state.roster.length} people, ${state.fleet.length} vehicles, ${state.trips.length} trips. This REPLACES everything now in the app.`, okText: 'Restore (replace all)', danger: true });
        if (ok) { await store.replace(state); closeAllSheets(); toast('Backup restored'); }
      } catch (e) { msg.append(h('div', { class: 'card bad', role: 'alert', 'data-testid': 'backup-error' }, e.message)); }
      file.value = '';
    });
    b.append(h('h3', null, 'Import backup'), field('Backup file (.json)', file), msg);
    b.append(h('h3', null, 'Wipe all data'), h('p', { class: 'hint' }, 'Deletes the roster, fleet, trips, forms and settings from this phone. The app itself stays installed. Make a backup first if you may need the data.'),
      h('button', { class: 'btn danger wide', type: 'button', 'data-testid': 'wipe', onClick: async () => { if (await typedConfirm({ title: 'Wipe ALL data?', message: 'This permanently deletes everything stored by this app on this device. It cannot be undone.', word: 'WIPE', okText: 'Wipe everything' })) { await store.wipe(); closeAllSheets(); go('#today'); toast('All data wiped'); } } }, 'Wipe all data…'));
    api.foot.append(h('button', { class: 'btn', type: 'button', onClick: () => api.close() }, 'Close'));
  } });
}

export function openHelp() {
  openSheet({ title: 'About, privacy & help', tall: true, build: (b, api) => {
    b.append(h('div', { class: 'help' },
      h('h3', null, 'Privacy'), h('ul', null, h('li', null, 'No server, no accounts, no analytics, no outside network calls. Everything is stored on this phone (IndexedDB).'), h('li', null, 'The app ships with no unit data. The roster and fleet are imported by you.'), h('li', null, 'The roster holds personal data. DODID, SSN and DOB are never stored (those columns are dropped on import). Treat the phone, backups and spreadsheets as PII / possibly CUI.'), h('li', null, 'Wipe all data: More > Backup, restore & wipe.')),
      h('h3', null, 'Rules (same as the spreadsheet system)'), h('ul', null, h('li', null, 'GCSS-Army is the source of truth for FMC / NMCM / NMCS. A local walk-around status is flagged and cleared when GCSS agrees.'), h('li', null, 'A bumper ending in digit + X (A-362X) is a permanent NMC (NMC-X): never dispatchable.'), h('li', null, 'Turned-in vehicles are off the books and excluded from counts (Settings > Turned-in bumpers).'), h('li', null, 'GO / WARN / NO-GO: vehicle must be FMC, not X / turned in, not already on a trip. Driver must be Active, license valid on the trip date, qualified for the vehicle type, not already on a trip. A driver without a GCSS-Army ID is a WARN.'), h('li', null, 'Unknown models and blank qualification rules fail closed (NO-GO).')),
      h('h3', null, 'Install on iPhone'), h('p', null, 'Safari > Share > Add to Home Screen. After the first load it works offline.'),
      h('h3', null, 'Version'), h('p', null, `Dispatch ${APP_VERSION}. Storage: ${store.mode}.`),
      h('div', { class: 'row' }, btn('Check for update / reload', async () => { try { const r = await navigator.serviceWorker.getRegistration(); if (r) await r.update(); } catch { /* offline */ } location.reload(); }, '', { 'data-testid': 'reload' }))));
    api.foot.append(h('button', { class: 'btn', type: 'button', onClick: () => api.close() }, 'Close'));
  } });
}
