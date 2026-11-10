#!/usr/bin/env node
// npm run scene -- <command> [scene] [args]      Inspect LCC scenes. Output is JSON on stdout (images go to files).
//
// <scene> is a local scene name (folder under scenes/), or an http(s) URL of a .lcc2 file (must allow CORS for shots).
//
//   list                                   local scenes
//   add <folder|zip> --name <name> [--copy]  import a downloaded scene (zip is extracted into scenes/<name>)
//   prep <scene>                           precompute walkable geometry into <scene>/prep/ (optional; speeds up loading,
//                                          recommended for large collision meshes and for scenes without one, see `info`)
//   info <scene>                           size, walkable area, trajectory segments, geometry source (collision mesh,
//                                          or estimated from the splats when the scene has none), and `data`: the
//                                          scene checked against docs/scene-data.md
//   route <scene> [--seg N] [--from M] [--to M] [--step 2] [--save route.json]
//                                          walkable route along the capture trajectory: length, closed, steps, narrow parts
//   regions <scene> [--n 8] [--r 1.5]      most open areas (plazas, arenas, finish areas)
//   at <scene> x,y [x,y ...]               ground, headroom, clearance, walkable for points
//   path <scene> x1,y1 x2,y2 [--r 0.4]     walkable path between two points
//   plot <scene> out.png [--points pts.json] [--crop x0,y0,x1,y1]
//                                          pts.json: [[x, y], ...] (points), or {lines: [[[x, y], ...], ...], points: [[x, y], ...]};
//                                          `route --save` writes a file you can pass directly
//                                          top-down map: walkable area, trajectory, your lines/points, 10 m grid
//   shot <scene> --out dir [--name view] --view "px,py,pz:tx,ty,tz[:fov]" [--view ...]
//                                          real rendered views (headless Chromium + GPU), one jpg per view:
//                                          <name>-<n>.jpg, numbered on from the files already there
//   coverage <scene> pts.json [--reach 6]  how much of the scene a path/point set uses (same file formats as plot)
//
// Saved routes (`route --save f`): {lines, route}; route = [[meters, x, y, z, clearance, headroom], ...]. headroom is
// null under open sky (no ceiling above).
import { readFile, writeFile, mkdir, symlink, cp, access, readdir, rm } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { ROOT, SCENES, SDK_FILE, listScenes, resolveScene, metaFile, chromeArgs, SAMPLE_DATA_PAGES } from './env.mjs';
import { getGeometry, computeGeometry, writePrep, sceneReader } from '../src/geometry/node.js';
import { browserSplatGeometry } from './splatgeo.mjs';
import { meshInfo } from '../src/geometry/prep.js';
import { encodePng } from './png.mjs';

const argv = process.argv.slice(2);
const flag = (k, d) => { const i = argv.indexOf(k); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const bool = (k) => { const i = argv.indexOf(k); if (i < 0) return false; argv.splice(i, 1); return true; };
const multi = (k) => { const o = []; for (let i; (i = argv.indexOf(k)) >= 0;) { o.push(argv[i + 1]); argv.splice(i, 2); } return o; };
// errors: one JSON line on stderr and exit code 1, no stack trace (set DEBUG=1 for the stack)
for (const ev of ['uncaughtException', 'unhandledRejection']) process.on(ev, (e) => { console.error(JSON.stringify({ error: e?.message || String(e) })); if (process.env.DEBUG) console.error(e); process.exit(1); });
const out = (o) => console.log(JSON.stringify(o, (k, v) => (v === Infinity ? 'inf' : typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1000) / 1000 : v)));
const fail = (msg) => { console.error(msg); process.exit(1); };
const P = (s) => s.split(',').map(Number);
const exists = (p) => access(p).then(() => true, () => false);

/** The scene against docs/scene-data.md: one entry per item, status 'ok' | 'warn' | 'missing' (optional data not there). */
function dataChecks(meta, geo, mi) {
  const c = [], add = (item, status, detail) => c.push({ item, status, detail });
  const bb = meta.root?.boundingBox, g = geo.grid.stats;
  const zr = bb ? (bb.max[2] - bb.min[2]) / Math.max(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1]) : NaN;
  add('z-up', !(zr < 1) || g.walkableM2 < 50 ? 'warn' : 'ok', !(zr < 1) ? `the scene is ${zr.toFixed(1)}x taller than wide: is it Y-up? Export it Z-up` : g.walkableM2 < 50 ? `only ${g.walkableM2} m² of walkable ground: is the scene Z-up, in meters?` : `${g.walkableM2} m² of up-facing walkable ground`);
  const h = geo.walked.map((q) => q[2] - geo.groundAt(q[0], q[1])).filter(Number.isFinite).sort((x, y) => x - y), hm = h[h.length >> 1];
  if (!h.length && g.poses) add('meters', 'warn', `none of the ${g.poses} trajectory poses is 0.3–3.8 m above walkable ground: wrong scale or up axis, or the capture was not walked (vehicle, drone)`);
  else if (!h.length) add('meters', 'missing', 'no capture trajectory to check the scale against; check in `shot` that a door is about 2 m high');
  else add('meters', hm > 0.8 && hm < 2.8 ? 'ok' : 'warn', `the capture camera was carried ${hm.toFixed(2)} m above the ground (median; 1.2–2.2 m is normal for handheld and backpack capture)`);
  add('collision mesh', mi.files.length ? 'ok' : 'missing', mi.files.length ? `${mi.faces} faces in ${mi.files.length} file(s)` : 'estimated from the splats instead (docs/api.md#scenes-without-a-collision-mesh)');
  add('capture trajectory', geo.walked.length ? 'ok' : 'missing', geo.walked.length ? `${geo.walked.length} poses carried over the ground` : 'routes tour the open areas instead');
  add('size', meta.totalSplats > 100e6 ? 'warn' : 'ok', `${(meta.totalSplats / 1e6).toFixed(1)} M splats${meta.totalSplats > 100e6 ? ': measure frame rate and memory early (docs/performance.md)' : ''}`);
  return c;
}
const log = (m) => console.error(m);

const cmd = argv.shift();
const geoOf = async (arg) => getGeometry(resolveScene(arg), { cacheRoot: join(ROOT, '.cache'), log, splats: browserSplatGeometry });

if (!cmd || cmd === 'help' || cmd === '--help') {
  console.log((await readFile(new URL(import.meta.url), 'utf8')).split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
} else if (cmd === 'list') {
  const rows = [];
  for (const n of listScenes()) {
    const dir = join(SCENES, n);
    let meta = null; try { meta = metaFile(dir); } catch {}
    rows.push({ name: n, meta, url: meta ? `/scenes/${n}/${meta}` : null, prep: await exists(join(dir, 'prep/grid.json')) });
  }
  out({ scenes: rows, sampleData: rows.length ? undefined : `No scenes yet. Ask the user for a scene they own, or to download an XGRIDS sample (login required, testing only, not for commercial use) from ${SAMPLE_DATA_PAGES.join(' or ')}, then run: npm run scene -- add <folder-or-zip> --name <name>` });
} else if (cmd === 'add') {
  const name = flag('--name'); const copy = bool('--copy'); const src = argv[0];
  if (!src || !name) fail('usage: npm run scene -- add <folder|zip> --name <name> [--copy]');
  if (!/^[a-z0-9][a-z0-9_-]{0,40}$/.test(name)) fail('name: lowercase letters, digits, - and _');
  const dst = join(SCENES, name);
  if (await exists(dst)) fail(`${dst} already exists`);
  await mkdir(SCENES, { recursive: true });
  let dir = resolve(src);
  if (/\.zip$/i.test(src)) {
    const tmp = join(SCENES, `.${name}-unzip`); await rm(tmp, { recursive: true, force: true }); await mkdir(tmp);
    log(`extracting ${src} ...`);
    const { extractZip } = await import('./unzip.mjs');
    let shown = -1;
    try {
      const n = await extractZip(dir, tmp, { onProgress: (d, t) => { const pc = Math.floor(d / t * 10) * 10; if (pc !== shown) { shown = pc; log(`  ${pc}%`); } } });
      log(`extracted ${n} files`);
    } catch (e) { await rm(tmp, { recursive: true, force: true }); fail(`could not extract the zip: ${e.message}. Extract it yourself and pass the folder.`); }
    // the .lcc2 may sit in a subfolder
    const find = async (d, depth = 0) => { const es = await readdir(d, { withFileTypes: true }); if (es.some((e) => e.name.endsWith('.lcc2'))) return d; for (const e of es) if (e.isDirectory() && depth < 3) { const f = await find(join(d, e.name), depth + 1); if (f) return f; } return null; };
    const found = await find(tmp); if (!found) { await rm(tmp, { recursive: true, force: true }); fail('no .lcc2 file inside the zip'); }
    const { rename } = await import('node:fs/promises'); await rename(found, dst); if (found !== tmp) await rm(tmp, { recursive: true, force: true });
    dir = dst;
  } else {
    if (copy) await cp(dir, dst, { recursive: true }); else await symlink(dir, dst, process.platform === 'win32' ? 'junction' : 'dir');
  }
  const s = resolveScene(name);
  const meta = JSON.parse(await readFile(join(s.dir, s.meta), 'utf8'));
  const mi = meshInfo(meta);
  const problems = [];
  const notes = [];
  if (!mi.files.length) notes.push(`no collision mesh: ground, walkable area and collision are estimated from the splats. \`npm run scene -- info ${name}\` (or any scene command) computes the estimate once and saves it in prep/, so games load it instead of decoding the splats in every browser`);
  if (!(await exists(join(s.dir, 'info/poses.json')))) notes.push('no info/poses.json (capture trajectory): ground is the lowest walkable layer, the main area is the largest connected one, and route() tours the most open areas');
  out({ name, dir: s.dir, url: s.webPath, linked: !copy && !/\.zip$/i.test(src), collisionFaces: mi.faces, problems, notes: notes.length ? notes : undefined,
    next: problems.length ? 'this scene cannot be used for walking games' : `npm run scene -- info ${name} (its "data" field checks the scene against docs/scene-data.md)` });
} else if (cmd === 'prep') {
  const s = resolveScene(argv[0]);
  if (s.kind !== 'local') fail('prep works on local scenes; for a URL scene, download it and `add` it');
  const t0 = Date.now(); const g = await computeGeometry(s, { log, splats: browserSplatGeometry });
  await writePrep(join(s.dir, 'prep'), g);
  out({ scene: s.name, prep: join(s.dir, 'prep'), ms: Date.now() - t0, stats: g.grid.stats });
} else if (cmd === 'info') {
  const s = resolveScene(argv[0]);
  const meta = JSON.parse(new TextDecoder().decode(await sceneReader(s)(s.meta)));
  const mi = meshInfo(meta);
  const geo = await geoOf(argv[0]);
  const g = geo.grid, tb = geo.trackBounds;
  out({ scene: s.name, url: s.kind === 'url' ? s.url : s.webPath, coord: 'z-up, meters', splats: meta.totalSplats,
    extent: geo.bounds, trackExtent: tb, trackSize: [tb[2] - tb[0], tb[3] - tb[1]], walkableM2: g.stats.walkableM2, maxClearance: g.stats.maxClearance,
    poses: g.stats.poses, walkedPoses: g.stats.walkedPoses ?? g.stats.poses,
    segments: geo.segments().map((x) => ({ seg: x.seg, length: Math.round(x.length), longestRun: Math.round(x.longestRun), start: x.start, end: x.end, zStart: x.zStart, zEnd: x.zEnd })),
    geometry: g.source === 'splats' ? `estimated from the splats (level ${g.splatLevel}, ${g.splats} splats); check \`plot\`` : 'collision mesh',
    collisionFaces: mi.faces, collisionFiles: mi.files.length, data: dataChecks(meta, geo, mi),
    note: g.source === 'splats' ? 'no collision mesh: the estimate is saved in prep/ and games load it from there (without prep/, every browser downloads and decodes the splats first). Look at `plot` before designing the level'
      : mi.faces > 3e6 ? 'large collision mesh: run `npm run scene -- prep` so browsers load prep/ instead of computing it' : undefined });
} else if (cmd === 'route') {
  const geo = await geoOf(argv[0]);
  const seg = flag('--seg'), from = +flag('--from', 0), to = +flag('--to', Infinity), step = +flag('--step', 2), save = flag('--save');
  const rt = geo.route({ from, to, step: 0.5, seg: seg === undefined ? undefined : +seg });
  const p = rt.points, M = rt.at;
  const spans = (test, minLen = 1) => { const o = []; let a = -1; for (let i = 0; i <= p.length; i++) { const on = i < p.length && test(i); if (on && a < 0) a = i; if (!on && a >= 0) { const s0 = M[a], s1 = M[i - 1]; if (o.length && s0 - o.at(-1)[1] < 3) o.at(-1)[1] = s1; else o.push([s0, s1]); a = -1; } } return o.filter(([s0, s1]) => s1 - s0 >= minLen).map((q) => q.map(Math.round)); };
  const k = Math.max(1, Math.round(step / 0.5)), idx = p.map((_, i) => i).filter((i) => i % k === 0 || i === p.length - 1);
  const pts = idx.map((i) => [Math.round(M[i]), ...p[i]]);
  // saved file: `lines` for plot/coverage; `points` [meters, x, y, z, clearance, headroom] for your own use
  if (save) await writeFile(save, JSON.stringify({ lines: [idx.map((i) => [p[i][0], p[i][1]])], route: pts }));
  out({ seg: rt.seg, source: rt.source, length: rt.length, closed: rt.closed, fullLength: rt.fullLength,
    zRange: [Math.min(...p.map((q) => q[2])), Math.max(...p.map((q) => q[2]))],
    steps_m: spans((i) => i >= 2 && Math.abs(p[i][2] - p[i - 2][2]) > 0.25, 0), narrow_m: spans((i) => p[i][3] < 0.5, 4), lowHeadroom_m: spans((i) => p[i][4] < 2.2),
    coverage: geo.coverage(p),
    note: 'points: [meters along route, x, y, z, clearance, headroom]; headroom null = open sky. *_m ranges are meters along the route. Narrow parts: make the track single-lane there, do not skip them. steps: good spots for jumps.',
    saved: save || undefined, points: save ? `${pts.length} points written to ${save} (key "route": [meters, x, y, z, clearance, headroom], headroom null = open sky; key "lines": for plot/coverage)` : pts });
} else if (cmd === 'regions') {
  const geo = await geoOf(argv[0]);
  out(geo.regions({ n: +flag('--n', 8), minRadius: +flag('--r', 1.5) }));
} else if (cmd === 'at') {
  const geo = await geoOf(argv.shift());
  out(argv.map((s) => geo.at(...P(s))));
} else if (cmd === 'path') {
  const r = +flag('--r', 0.4); const geo = await geoOf(argv[0]);
  const path = geo.findPath(P(argv[1]), P(argv[2]), r);
  if (!path) out({ ok: false, reason: 'unreachable or an end point is not walkable (snap it with `at`/nearest walkable, or lower --r)' });
  else { let L = 0; for (let i = 1; i < path.length; i++) L += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); out({ ok: true, length: L, points: path.filter((_, i) => i % 5 === 0 || i === path.length - 1) }); }
} else if (cmd === 'coverage') {
  const reach = +flag('--reach', 6); const geo = await geoOf(argv[0]);
  const j = JSON.parse(await readFile(argv[1], 'utf8'));
  out(geo.coverage(Array.isArray(j) ? j : [...(j.lines || []).flat(), ...(j.points || [])], reach));
} else if (cmd === 'plot') {
  const ptsFile = flag('--points'), crop = flag('--crop');
  const geo = await geoOf(argv[0]); const file = argv[1] || 'plot.png';
  let lines = [], points = [];
  if (ptsFile) { const j = JSON.parse(await readFile(ptsFile, 'utf8')); if (Array.isArray(j)) points = j; else { lines = j.lines || []; points = j.points || []; } }
  const [x0, y0, x1, y1] = crop ? P(crop) : geo.bounds;
  const px = Math.max(geo.res / 2, Math.max(x1 - x0, y1 - y0) / 1600);
  const W = Math.ceil((x1 - x0) / px), H = Math.ceil((y1 - y0) / px);
  const img = Buffer.alloc((W * 3 + 1) * H);
  const set = (i, j, c) => { if (i < 0 || j < 0 || i >= W || j >= H) return; const o = j * (W * 3 + 1) + 1 + i * 3; img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2]; };
  const toPix = (x, y) => [Math.floor((x - x0) / px), H - 1 - Math.floor((y - y0) / px)];
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = x0 + (i + 0.5) * px, y = y1 - (j + 0.5) * px, c = geo.cell(x, y);
    let col = [20, 20, 20];
    if (c >= 0) { if (geo.walk[c] === 1) { const t = Math.min(1, geo.dist[c] / 2); col = [30, 80 + 175 * t, 40]; } else if (geo.walk[c] === 2) col = [60, 70, 90]; else if (!Number.isNaN(geo.floor[c])) col = [100, 45, 40]; }
    if (Math.abs(x / 10 - Math.round(x / 10)) * 10 < px / 2 || Math.abs(y / 10 - Math.round(y / 10)) * 10 < px / 2) col = col.map((v) => Math.min(255, v + 60));
    set(i, j, col);
  }
  for (const p of geo.poses) set(...toPix(p[0], p[1]), p[5] === 0 || p[3] == null ? [255, 150, 0] : [200, 200, 200]);
  for (const l of lines) for (let k = 1; k < l.length; k++) {
    const a = toPix(...l[k - 1]), b = toPix(...l[k]), n = Math.max(1, Math.hypot(b[0] - a[0], b[1] - a[1]));
    for (let s = 0; s <= n; s++) { const i = Math.round(a[0] + (b[0] - a[0]) * s / n), j = Math.round(a[1] + (b[1] - a[1]) * s / n); for (let d = -1; d <= 1; d++) { set(i + d, j, [255, 255, 255]); set(i, j + d, [255, 255, 255]); } }
  }
  for (const p of points) { const [i, j] = toPix(p[0], p[1]); for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) set(i + a, j + b, [255, 0, 255]); }
  await writeFile(file, encodePng(W, H, img));
  out({ file, width: W, height: H, metersPerPixel: px, extent: [x0, y0, x1, y1], up: '+y',
    legend: 'bright green = open walkable, dark green = walkable near an edge, blue-grey = isolated walkable, brown = obstacle, grey dots = capture trajectory (walked), orange dots = trajectory not on the ground (chairlift, vehicle, drone), white = your lines, magenta = your points, light grid = every 10 m' });
} else if (cmd === 'shot') {
  // files are <name>-<n>.jpg, numbered after the ones already in the folder (earlier shots are never overwritten)
  const outDir = flag('--out', 'shots'), prefix = flag('--name', 'view');
  if (!/^[\w.-]{1,60}$/.test(prefix)) fail('--name: letters, digits, . _ -');
  await mkdir(outDir, { recursive: true });
  const taken = (await readdir(outDir)).filter((f) => f.startsWith(prefix + '-') && f.endsWith('.jpg')).map((f) => f.slice(prefix.length + 1, -4)).filter((n) => /^[0-9]+$/.test(n)).map(Number);
  let next = taken.length ? Math.max(...taken) + 1 : 1;
  const views = multi('--view').map((v) => {
    const q = v.split(':'); return { name: `${prefix}-${next++}`, pos: P(q[0]), target: P(q[1]), fov: +q[2] || 60 };
  });
  if (!views.length) fail('give at least one --view "px,py,pz:tx,ty,tz"');
  const s = resolveScene(argv[0]);
  const { chromium } = await import('playwright');
  const { startServer } = await import('./serve.mjs');
  const srv = await startServer(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const data = s.kind === 'url' ? s.url : base + (s.webPath || fail('local scene must be under scenes/ (use `add`)'));
  const browser = await chromium.launch({ args: chromeArgs() });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`${base}/tools/shot.html?data=${encodeURIComponent(data)}`);
  await page.waitForFunction(() => window.shot && (window.shot.ready || window.shot.error), null, { timeout: 180000 });
  const err = await page.evaluate(() => window.shot.error); if (err) fail(err);
  await mkdir(outDir, { recursive: true });
  const res = [];
  for (const v of views) {
    await page.evaluate((v) => window.shot.setView(v.pos, v.target, v.fov), v);
    const st = await page.evaluate(() => window.shot.waitStable(20000));
    const file = join(outDir, `${v.name}.jpg`);
    await page.locator('canvas').screenshot({ path: file, type: 'jpeg', quality: 80 });
    res.push({ ...v, file, ...st });
  }
  out({ gpu: await page.evaluate(() => window.shot.gl()), shots: res });
  await browser.close(); srv.close();
} else {
  fail(`unknown command "${cmd}". Run: npm run scene -- help`);
}
