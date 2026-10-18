import { S, getCtx, commit } from '../ctx.js';
import { h, openSheet, toast, field, toggle, segmented, clear } from '../dom.js';
import { isActiveTrip } from '../rules.js';
import { todayISO, stampForFile } from '../util.js';
import { buildDispatchWorkbook, dispatchEmailText } from '../dispatchxlsx.js';
import { shareOrDownload, mailtoLink } from '../backup.js';
import { btn } from '../ui.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export function openExportSheet({ tripId = '' } = {}) {
  const st = S(); let scope = tripId ? 'trip' : 'active';
  openSheet({ title: 'Share dispatch spreadsheet', tall: false,
    build: (b, api) => {
      const info = h('div', { 'data-testid': 'export-info' });
      const draw = () => {
        const trips = st.trips.filter((t) => (scope === 'trip' && t.id === tripId) || (scope === 'all') || (scope === 'active' && isActiveTrip(t)) || (scope === 'today' && (t.dateOut === todayISO() || t.dateBack === todayISO())));
        clear(info); info.append(h('p', null, `${trips.length} trip${trips.length === 1 ? '' : 's'} will be in the file.`),
          st.settings.recipient ? h('p', { class: 'hint' }, 'Email recipient (Settings): ', h('b', null, st.settings.recipient)) : h('p', { class: 'hint warn' }, 'No email recipient set (Settings). You will pick one in the share sheet / email app.'));
        return trips;
      };
      b.append(h('p', { class: 'hint' }, 'The .xlsx is built on this phone, offline. Nothing is uploaded. It contains names and may be PII / CUI - send it only per your SOP.'));
      if (tripId) b.append(h('p', { class: 'hint' }, 'Sharing this one trip (one row per vehicle).')); else b.append(field('Which trips', segmented([['active', 'Active'], ['today', 'Today'], ['all', 'All']], scope, (v) => { scope = v; draw(); }, { label: 'Which trips' })));
      b.append(toggle('Add Fleet Status sheet', st.settings.xlsxIncludeFleet, (v) => { st.settings.xlsxIncludeFleet = v; commit({ render: false }); }));
      b.append(toggle('Add Roster sheet (personal data!)', st.settings.xlsxIncludeRoster, (v) => { st.settings.xlsxIncludeRoster = v; commit({ render: false }); }, 'Off by default. Names, license dates and GCSS IDs.'));
      b.append(info); draw();
      const msg = h('div', { 'data-testid': 'export-msg' });
      b.append(msg);
      const make = () => { const trips = draw(); const now = new Date(); const bytes = buildDispatchWorkbook(st, { includeFleet: st.settings.xlsxIncludeFleet, includeRoster: st.settings.xlsxIncludeRoster, now, tripIds: trips.map((t) => t.id) }); return { bytes, trips, now }; };
      const send = h('button', { class: 'btn primary', type: 'button', 'data-testid': 'export-share', onClick: async () => {
        try {
          const { bytes, trips, now } = make(); const name = `dispatch-log-${stampForFile(now)}.xlsx`; const txt = dispatchEmailText(st, { now, count: trips.length });
          const r = await shareOrDownload(bytes, name, XLSX_MIME, { title: txt.subject, text: txt.body });
          clear(msg);
          if (r.method === 'share') { toast('Shared.'); api.close(); }
          else if (r.method === 'download') {
            msg.append(h('div', { class: 'note' }, h('b', null, 'Saved to your Downloads / Files: '), name, h('p', null, 'This browser cannot attach files to the share sheet, so attach that file to the email yourself.'),
              h('a', { class: 'btn primary', href: mailtoLink(st.settings.recipient, txt.subject, txt.body + '\n(Attach ' + name + ')'), 'data-testid': 'export-mailto' }, 'Open email draft')));
          }
        } catch (e) { console.error(e); toast('Could not build the spreadsheet: ' + e.message, 'bad'); }
      } }, 'Share / email .xlsx');
      api.foot.append(h('button', { class: 'btn', type: 'button', onClick: () => api.close() }, 'Close'), send);
    } });
}
