// Web Worker: build the walkability grid of a scene from its collision meshes, or, when the scene has none, estimate
// it from the splats (less accurate, see splats.js). The capture trajectory (info/poses.json) is optional.
// message in: { metaUrl, res }   messages out: { progress, phase } ... then { result } or { error }
import { parsePly, buildGeometry, buildFromLayers } from './prep.js';
import { splatLayersFromScene } from './splats.js';

onmessage = async ({ data: { metaUrl, res } }) => {
  try {
    const base = metaUrl.slice(0, metaUrl.lastIndexOf('/') + 1);
    const meta = await (await fetch(metaUrl)).json();
    const files = meta.root?.meshFiles || [];
    const get = async (rel) => { const r = await fetch(base + rel); if (!r.ok) throw new Error(`${base + rel}: HTTP ${r.status}`); return r; };
    const posesP = fetch(base + 'info/poses.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
    let g;
    if (files.length) {
      const meshes = new Array(files.length); let done = 0, next = 0;
      await Promise.all(Array.from({ length: 6 }, async () => {
        while (next < files.length) {
          const i = next++;
          meshes[i] = parsePly(new Uint8Array(await (await get(files[i])).arrayBuffer()));
          postMessage({ progress: ++done / files.length, phase: 'download' });
        }
      }));
      const posesJson = await posesP;
      postMessage({ progress: 1, phase: 'build' });
      g = buildGeometry(meshes, posesJson, { res });
    } else {
      const L = await splatLayersFromScene(meta, async (rel) => new Uint8Array(await (await get(rel)).arrayBuffer()), { res, onProgress: (v) => postMessage({ progress: v, phase: 'splats' }) });
      postMessage({ progress: 1, phase: 'build' });
      g = buildFromLayers(L, await posesP);
    }
    postMessage({ result: g }, [g.floor.buffer, g.clear.buffer, g.walk.buffer, g.dist.buffer]);
  } catch (e) {
    postMessage({ error: String(e?.message || e) });
  }
};
