// Where runtime files live. In development they are next to src/; `npm run build` sets window.PLAYABLE_CONFIG.
const C = globalThis.PLAYABLE_CONFIG || {};
export const ASSETS_URL = C.assets ? new URL(C.assets, location.href).href : new URL('../assets/', import.meta.url).href;
/** Absolute URL of a file in the runtime assets folder (`assets/` in development, `./assets/` in a build). */
export const assetUrl = (path = '') => new URL(path, ASSETS_URL).href;
/** Resolve a scene reference (URL or path) to an absolute URL, applying build-time remapping. */
export function sceneUrl(scene) {
  // ?scene= is a development convenience. In builds (PLAYABLE_CONFIG set) it is ignored unless the build allows it,
  // and then only same-origin scenes are accepted, so a link cannot make your published game load other content.
  let q = new URLSearchParams(location.search).get('scene');
  if (q && globalThis.PLAYABLE_CONFIG && (!C.allowSceneParam || new URL(q, location.href).origin !== location.origin)) q = null;
  const s = q || scene;
  if (!s) throw new Error('createPlayable: missing `scene` (URL or path of a .lcc2 file)');
  return new URL(C.scenes?.[s] ?? s, location.href).href;
}
