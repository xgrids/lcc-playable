#!/usr/bin/env node
// npm run check -- games/<id> [options]      Open a game in headless Chromium (GPU) and report what happened.
//
//   --auto                 open with ?auto: the game's autopilot plays a full round. Waits for p.result
//                          (p.win / p.lose) or --timeout, and takes --shots screenshots spread evenly over the
//                          whole round; the last one is the moment the round ended (before the end card).
//   --timeout 300          wall-clock seconds to wait for the round to finish (with --auto). Real time runs 10-20%
//                          ahead of p.playTime (loading, frame stalls): a 180 s round needs about 220 s.
//   --wait 2               seconds to play before the screenshot (without --auto); --eval and --keys run first,
//                          right after the game starts, so the wait comes after them
//   --keys "KeyW:1500,Space:200"   hold keys for N ms, in order (without --auto)
//   --eval "js"            evaluate an expression in the page (can await; `p` = the playable); repeatable
//   --shots 3              number of screenshots
//   --out shots/<id>       screenshot folder (default: .cache/check/<id>)
//   --query "a=1&b=2"      extra URL parameters
//   --dist                 the folder is a build output (npm run build): serve only that folder, as a host would
//
// Output JSON: { ok, errors, loadMs, state, result, info, coverage, camera, files, shotTimes }
//   ok=false: fix `errors` first. result: what p.win/p.lose reported. coverage: from p.playArea. shotTimes: p.playTime of each --auto screenshot.
//   camera.blocked: the scene blocks the line from camera to player (needs p.player or p.info.position).
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { startServer } from './serve.mjs';
import { ROOT, chromeArgs, SDK_FILE } from './env.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const target = args.find((a, i) => !a.startsWith('--') && !(args[i - 1] || '').startsWith('--')) || args[0];
if (args.includes('--help') || args.includes('-h')) { const src = await (await import('node:fs/promises')).readFile(new URL(import.meta.url), 'utf8'); console.log(src.split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n')); process.exit(0); }
if (!target || target.startsWith('--')) { console.error('usage: npm run check -- games/<id> [--auto]'); process.exit(1); }
if (!existsSync(SDK_FILE)) { console.error('LCC Web SDK missing: run `npm run setup`'); process.exit(1); }
const AUTO = args.includes('--auto');
const dir = resolve(target), rel = relative(ROOT, dir).replace(/\\/g, '/');
const DIST = args.includes('--dist');
if ((!DIST && rel.startsWith('..')) || !existsSync(join(dir, 'index.html'))) { console.error(`${dir}/index.html not found (games must be inside the repository)`); process.exit(1); }
const id = rel.split('/').pop();
const outDir = resolve(opt('--out', join(ROOT, '.cache/check', id)));
const SHOTS = +opt('--shots', AUTO ? 3 : 1), TIMEOUT = +opt('--timeout', 300) * 1000, WAIT = +opt('--wait', 2) * 1000;
const query = ['mute', 'check', AUTO ? 'auto' : '', opt('--query', '')].filter(Boolean).join('&');

const srv = await startServer(0, DIST ? { root: dir } : {});
const base = `http://127.0.0.1:${srv.address().port}`;
const browser = await chromium.launch({ args: chromeArgs() });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
const benign = /appKey|encode type|favicon\.ico|\/prep\/grid\.json|\/info\/poses\.json|Failed to load resource: the server responded with a status of 404/;
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !benign.test(m.text())) errors.push(`console.error: ${m.text().slice(0, 300)}`); });
page.on('response', (r) => { if (r.status() >= 400 && !benign.test(r.url())) errors.push(`http ${r.status()}: ${r.url()}`); });

const path = DIST ? '' : `/${rel}`;
const res = { ok: true, page: `${path}/?${query}`, errors, files: [], evals: [] };
const t0 = Date.now();
const shot = async (n) => { const f = join(outDir, `${id}${SHOTS > 1 ? '-' + n : ''}.jpg`); await page.screenshot({ path: f, type: 'jpeg', quality: 80 }); res.files.push(f); };
const state = () => page.evaluate(() => { const p = window.__playable; return p ? { state: p.state, error: p.error, ready: p.ready, running: p.running } : null; });
try {
  await mkdir(outDir, { recursive: true });
  await page.goto(`${base}${path}/?${query}`);
  await page.waitForFunction(() => window.__playable && (window.__playable.ready || window.__playable.error), null, { timeout: 180000 });
  res.loadMs = Date.now() - t0;
  // main.js may still be building the level after the scene is ready: give it up to 60 s to call p.run()
  await page.waitForFunction(() => window.__playable.running || window.__playable.error, null, { timeout: 60000 }).catch(() => {});
  // Start: press Enter on a title card, then wait for 'playing'
  await page.waitForTimeout(500);
  for (let k = 0; k < 20 && (await state())?.state !== 'playing'; k++) { await page.keyboard.press('Enter'); await page.waitForTimeout(300); }
  const st = await state();
  if (st?.error) errors.push(`p.error: ${st.error}`);
  if (!st?.running) errors.push('the game never started: call p.run() at the end of main.js');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--eval') res.evals.push(await page.evaluate(`(async () => { const p = window.__playable; return (${args[i + 1]}); })()`).then((v) => JSON.stringify(v)?.slice(0, 2000), (e) => `eval error: ${e.message.split('\n')[0]}`));
    if (args[i] === '--keys' && !AUTO) for (const kd of args[i + 1].split(',').filter(Boolean)) { const [k, ms] = kd.split(':'); await page.keyboard.down(k); await page.waitForTimeout(+ms || 300); await page.keyboard.up(k); }
  }
  if (AUTO) {
    const hasAuto = await page.evaluate(() => !!window.__playable.autopilot);
    if (!hasAuto) errors.push('--auto: the game has no autopilot (p.setAutopilot)');
    // Screenshots spread over the whole round, whose length is not known in advance: keep frames every `gap` ms in
    // memory (at most 4 per wanted shot, thinning out and doubling the gap when full), then write SHOTS of them
    // evenly spaced, ending with the last frame before the round ended.
    const t1 = Date.now(); let frames = [], gap = 2000, last = -Infinity;
    const grab = async () => { frames.push({ t: await page.evaluate(() => window.__playable.playTime), buf: await page.screenshot({ type: 'jpeg', quality: 80 }) }); last = Date.now();
      if (frames.length > 4 * SHOTS) { frames = frames.filter((_, i) => i % 2 === 1 || i === frames.length - 1); gap *= 2; } };
    for (;;) {
      await page.waitForTimeout(500);
      const s = await state();
      if (s?.error) { errors.push(`p.error: ${s.error}`); break; }
      if (s?.state === 'won' || s?.state === 'lost') break;
      if (Date.now() - t1 > TIMEOUT) { errors.push(`--auto: round not finished after ${TIMEOUT / 1000}s of real time (autopilot stuck, or the round is longer: raise --timeout)`); break; }
      if (Date.now() - last >= gap) await grab();
    }
    if (!frames.length) await grab();
    const pick = SHOTS === 1 ? [frames.length - 1] : Array.from({ length: SHOTS }, (_, i) => Math.round(i * (frames.length - 1) / (SHOTS - 1)));
    res.shotTimes = [];
    for (let i = 0; i < SHOTS; i++) { const fr = frames[pick[i]], f = join(outDir, `${id}${SHOTS > 1 ? '-' + (i + 1) : ''}.jpg`); await writeFile(f, fr.buf); res.files.push(f); res.shotTimes.push(+fr.t.toFixed(1)); }
  } else {
    await page.waitForTimeout(WAIT);
    for (let n = 1; n <= SHOTS; n++) { await shot(n); if (n < SHOTS) await page.waitForTimeout(1000); }
  }
  Object.assign(res, await page.evaluate(() => {
    const p = window.__playable, c = p.camera.position;
    const pl = p.player?.position || (p.info?.position && { x: p.info.position[0], y: p.info.position[1], z: p.info.position[2] });
    let camera = { position: [c.x, c.y, c.z].map((v) => +v.toFixed(2)) };
    if (pl) {
      const t = [pl.x, pl.y, pl.z + 1.2], d = [t[0] - c.x, t[1] - c.y, t[2] - c.z], L = Math.hypot(...d);
      const h = p.raycast([c.x, c.y, c.z], d, L);
      camera = { ...camera, toPlayer: +L.toFixed(2), blocked: !!h && h.distance < L - 0.3, cameraAboveGround: +(c.z - p.geo.groundAt(c.x, c.y)).toFixed(2) };
    }
    return { state: p.state, result: p.result, playTime: +p.playTime.toFixed(1), fps: Math.round(p.fps), info: p.info, camera,
      coverage: p.playArea ? p.geo.coverage(p.playArea) : 'set p.playArea = [[x, y], ...] to get scene coverage',
      geometry: p.geo && { source: p.geo.source, ms: p.geo.ms } };
  }));
} catch (e) {
  errors.push(`check: ${e.message.split('\n')[0]}`);
}
res.ok = errors.length === 0;
res.ms = Date.now() - t0;
console.log(JSON.stringify(res, null, 1));
await browser.close(); srv.close();
process.exit(res.ok ? 0 : 1);
