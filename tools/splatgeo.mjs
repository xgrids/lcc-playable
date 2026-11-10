// Estimate scene geometry from the splats in headless Chromium, for scenes without a collision mesh. Runs the same
// Web Worker as the browser runtime (src/geometry/worker.js), so CLI and games get the same grid.
import { chromium } from 'playwright';
import { startServer } from './serve.mjs';
import { chromeArgs } from './env.mjs';

/** @returns {Promise<{grid, floor, clear, walk, dist, poses}>} */
export async function browserSplatGeometry(scene, { res = 0.2 } = {}) {
  const srv = await startServer(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const metaUrl = scene.kind === 'url' ? scene.url : base + scene.webPath;
  if (!metaUrl || metaUrl.endsWith('null')) throw new Error('estimating from splats works for scenes under scenes/ or URL scenes');
  const browser = await chromium.launch({ args: chromeArgs() });
  try {
    const page = await browser.newPage();
    await page.goto(base + '/');
    const r = await page.evaluate(async ([metaUrl, res]) => {
      const g = await new Promise((ok, fail) => {
        const w = new Worker('/src/geometry/worker.js', { type: 'module' });
        w.onmessage = ({ data: m }) => { if (m.result) ok(m.result); if (m.error) fail(new Error(m.error)); };
        w.onerror = (e) => fail(new Error(e.message || 'worker failed'));
        w.postMessage({ metaUrl, res });
      });
      const b64 = (a) => { const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
      return { grid: g.grid, poses: g.poses, floor: b64(g.floor), clear: b64(g.clear), walk: b64(g.walk), dist: b64(g.dist) };
    }, [metaUrl, res]);
    const buf = (s) => { const b = Buffer.from(s, 'base64'); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
    return { grid: r.grid, poses: r.poses, floor: new Float32Array(buf(r.floor)), clear: new Float32Array(buf(r.clear)), walk: new Uint8Array(buf(r.walk)), dist: new Float32Array(buf(r.dist)) };
  } finally { await browser.close(); srv.close(); }
}
