// Shared app context for views
import { Store } from './store.js';
import { buildContext } from './rules.js';
export const store = new Store();
export const S = () => store.state;
export const getCtx = () => buildContext({ settings: store.state.settings, fleet: store.state.fleet, roster: store.state.roster, trips: store.state.trips, now: new Date() });
export const commit = (o) => store.commit(o);
export const APP_VERSION = '1.0.0';
export function go(hash) { if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = hash; }
