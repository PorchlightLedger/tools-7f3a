// More > Send feedback: a short form that opens an email draft to the developer. Nothing is saved on the phone and the app sends nothing itself.
import { go, APP_VERSION } from '../ctx.js';
import { h, field, segmented, toast } from '../dom.js';
import { btn } from '../ui.js';
import { fmtDate, todayISO } from '../util.js';
import { FEEDBACK_EMAIL, FEEDBACK_TYPES, FEEDBACK_MAX, feedbackMailto } from '../feedback.js';

export function renderFeedback(root, rest, top) {
  top.append(btn('‹ More', () => go('#more'), 'small'));
  let type = FEEDBACK_TYPES[0];
  const typeSeg = segmented(FEEDBACK_TYPES.map((t) => [t, t]), type, (v) => { type = v; upd(); }, { label: 'Type of feedback' }); typeSeg.dataset.testid = 'fb-type';
  const text = h('textarea', { rows: 6, maxlength: String(FEEDBACK_MAX), placeholder: 'What happened, or what would help? Do not include names, bumper numbers or roster data.', 'data-testid': 'fb-text', 'aria-label': 'Your feedback' });
  const name = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'words', maxlength: '80', placeholder: 'e.g. SSG Smith (optional)', 'data-testid': 'fb-name', 'aria-label': 'Your name / rank (optional)' });
  const err = h('p', { class: 'hint bad', role: 'alert', 'data-testid': 'fb-error' });
  const fb = () => ({ type, text: text.value, name: name.value, build: APP_VERSION, date: fmtDate(todayISO()) });
  const link = h('a', { class: 'btn primary wide', href: feedbackMailto(fb()), 'data-testid': 'fb-send', onClick: (e) => {
    if (!text.value.trim()) { e.preventDefault(); err.textContent = 'Type your feedback first.'; text.focus(); return; }
    link.setAttribute('href', feedbackMailto(fb())); err.textContent = '';
    setTimeout(() => { text.value = ''; name.value = ''; type = FEEDBACK_TYPES[0]; typeSeg.setValue(type); upd(); toast('Email draft opened. Send it from your email app.'); }, 400);
  } }, 'Send feedback');
  function upd() { link.setAttribute('href', feedbackMailto(fb())); if (text.value.trim()) err.textContent = ''; }
  text.addEventListener('input', upd); name.addEventListener('input', upd);
  root.append(h('div', { class: 'card', 'data-testid': 'fb-card' },
    h('p', null, 'Found a bug, or have an idea that would make dispatch easier? Send it to the developer.'),
    field('Type', typeSeg), field('Your feedback', text), field('Name / rank (optional)', name), err, link,
    h('p', { class: 'hint', 'data-testid': 'fb-note' }, `Opens an email draft${FEEDBACK_EMAIL ? ' to ' + FEEDBACK_EMAIL : ' (type the recipient in your email app)'} with the app build and today's date. Nothing is saved on this phone and nothing is sent until you tap Send in your email app. Keep names, bumper numbers and roster data out of it.`)));
  return 'Send feedback';
}
