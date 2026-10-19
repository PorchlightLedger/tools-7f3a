// Send feedback: builds an email draft (mailto:) to the developer. Pure functions; nothing is stored and nothing is sent by the app.
import { mailtoLink } from './backup.js';
import { clean } from './util.js';

/** Where feedback goes. The repo is public: this address is visible in the app code (the owner chose that). '' = the draft opens with no recipient. */
export const FEEDBACK_EMAIL = 'joshua.b.wildman@gmail.com';
export const FEEDBACK_TYPES = ['Bug', 'Recommendation', 'Feature request'];
export const FEEDBACK_MAX = 4000; // keeps the mailto: link a size mail apps accept

export const feedbackSubject = (type) => `Dispatch app feedback - ${FEEDBACK_TYPES.includes(type) ? type : 'Recommendation'}`;
/** plain-text body: the note, the optional name / rank, the build id and the date */
export function feedbackBody({ type, text, name = '', build = '', date = '' }) {
  const t = String(text || '').replace(/\r\n?/g, '\n').trim().slice(0, FEEDBACK_MAX); const n = clean(name);
  return [`Type: ${FEEDBACK_TYPES.includes(type) ? type : 'Recommendation'}`, '', t, '', ...(n ? [`From: ${n}`] : []), `App build: ${build || 'unknown'}`, `Date: ${date}`].join('\n');
}
/** the mailto: link; `to` defaults to FEEDBACK_EMAIL and may be '' (no recipient: the user picks one in the mail app) */
export function feedbackMailto(fb, to = FEEDBACK_EMAIL) { return mailtoLink(clean(to), feedbackSubject(fb.type), feedbackBody(fb)); }
