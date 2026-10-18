// Shared app context for views
import { Store } from './store.js';
import { buildContext, modelLookup, modelInfo } from './rules.js';
import { setPhotoTypeResolver } from './photos.js';
export const store = new Store();
export const S = () => store.state;
export const getCtx = () => buildContext({ settings: store.state.settings, fleet: store.state.fleet, roster: store.state.roster, trips: store.state.trips, now: new Date() });
export const commit = (o) => store.commit(o);
// photo fallback by type-map type: model number -> type name ('' when unmapped). The lookup is rebuilt only when the type map changes.
let typeLk = { sig: null, map: null };
setPhotoTypeResolver((model) => {
  const st = store.state.settings; const sig = JSON.stringify(st.modelMap || []); if (typeLk.sig !== sig) typeLk = { sig, map: modelLookup(st) };
  const i = modelInfo(model, typeLk.map); return i.mapped ? i.type : '';
});
import { BUILD_ID } from './version.js';
export const APP_VERSION = BUILD_ID; // the content hash of this build ('dev' when run from source)
export function go(hash) { if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = hash; }
