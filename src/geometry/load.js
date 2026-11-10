// Browser: get the walkability grid for a scene.
// Order: <scene>/prep/ (offline preprocessing) -> IndexedDB cache -> compute in a Web Worker (then cache).
import { SceneGeometry } from './query.js';
import { readPrep, PREP_DIR } from './files.js';

const DB = 'lcc-playable', STORE = 'geometry', VERSION = 2; // 2: walked poses only, splat estimate

function idb() {
  return new Promise((ok, fail) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error);
  });
}
async function idbGet(key) {
  try { const db = await idb(); return await new Promise((ok) => { const q = db.transaction(STORE).objectStore(STORE).get(key); q.onsuccess = () => ok(q.result); q.onerror = () => ok(undefined); }); } catch { return undefined; }
}
async function idbPut(key, val) {
  try { const db = await idb(); await new Promise((ok) => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(val, key); t.oncomplete = ok; t.onerror = ok; }); } catch { /* quota or private mode: ignore */ }
}

/**
 * @param {string} metaUrl absolute URL of the scene's .lcc2 file
 * @param {{source?: 'auto'|'prep'|'runtime', cache?: boolean, res?: number, workerUrl?: string|URL, onProgress?: (p: number, phase: string) => void}} [opt]
 * @returns {Promise<SceneGeometry & {source: string, ms: number}>}
 */
export async function loadGeometry(metaUrl, { source = 'auto', cache = true, res = 0.2, workerUrl, onProgress = () => {} } = {}) {
  const t0 = performance.now();
  const base = metaUrl.slice(0, metaUrl.lastIndexOf('/') + 1);
  const done = (g, src) => Object.assign(g, { source: src, ms: Math.round(performance.now() - t0) });
  if (source !== 'runtime') {
    const head = await fetch(base + PREP_DIR + 'grid.json', { method: 'HEAD' }).catch(() => null);
    if (head?.ok) {
      const g = await readPrep(async (f) => { const r = await fetch(base + PREP_DIR + f); if (!r.ok) throw new Error(`${base + PREP_DIR + f}: HTTP ${r.status}`); return r.arrayBuffer(); });
      return done(g, 'prep');
    }
    if (source === 'prep') throw new Error(`no preprocessed geometry at ${base + PREP_DIR} (run: npm run scene -- prep <scene>)`);
  }
  const meta = await (await fetch(metaUrl)).json();
  const key = `${VERSION}|${metaUrl}|${meta.totalSplats}|${meta.root?.meshFiles?.length}|${res}`;
  if (cache) { const hit = await idbGet(key); if (hit) return done(new SceneGeometry(hit), 'cache'); }
  const url = workerUrl || globalThis.PLAYABLE_CONFIG?.geometryWorker || new URL('./worker.js', import.meta.url);
  const data = await new Promise((ok, fail) => {
    const w = new Worker(url, { type: 'module' });
    w.onmessage = ({ data: m }) => {
      if (m.progress !== undefined) onProgress(m.progress, m.phase);
      if (m.result) { ok(m.result); w.terminate(); }
      if (m.error) { fail(new Error(m.error)); w.terminate(); }
    };
    w.onerror = (e) => { fail(new Error(`geometry worker failed: ${e.message || e}`)); w.terminate(); };
    w.postMessage({ metaUrl, res });
  });
  if (cache) idbPut(key, data);
  return done(new SceneGeometry(data), 'runtime');
}
