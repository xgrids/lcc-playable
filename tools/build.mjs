#!/usr/bin/env node
// npm run build -- games/<id> [--scene-url <url>] [--no-scene] [--out dist/<id>]
//
// Bundle a game into a static folder you can host anywhere (any static server or CDN; HTTPS recommended):
//   dist/<id>/index.html, main.js (game + lcc-playable + three + LCC Web SDK + Rapier), geometry-worker.js,
//   assets/characters/*, and the scene.
// Scene: a local scene is copied into dist/<id>/scenes/<name>/ with precomputed geometry (prep/), so players
// do not compute it in the browser. --scene-url <url-of-.lcc2> uses a scene you host elsewhere instead
// (that server must send CORS headers). --no-scene keeps the scene URL as written in main.js.
// Licensing: the bundle contains the LCC Web SDK (XGRIDS terms; redistribution inside games is allowed; without an
// appKey it shows a small XGRIDS watermark on deployed sites). XGRIDS sample scenes are for testing only and
// must not be published commercially; use scenes you have the rights to.
import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile, rm, stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { ROOT, SCENES, SDK_FILE, PORT, resolveScene } from './env.mjs';
import { computeGeometry, writePrep } from '../src/geometry/node.js';
import { browserSplatGeometry } from './splatgeo.mjs';

const args = process.argv.slice(2);
const VALUED = ['--out', '--scene-url'];
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const target = args.find((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1]));
const fail = (m) => { console.error(m); process.exit(1); };
const USAGE = 'usage: npm run build -- games/<id> [--out dist/<id>] [--scene-url <url-of-.lcc2>] [--no-scene]';
if (args.includes('--help') || args.includes('-h')) { console.log(USAGE); process.exit(0); }
if (!target) fail(USAGE);
if (!existsSync(SDK_FILE)) fail('LCC Web SDK missing: run `npm run setup`');
const src = resolve(target), id = src.split(/[\\/]/).filter(Boolean).pop();
if (!existsSync(join(src, 'main.js'))) fail(`${src}/main.js not found`);
const out = resolve(opt('--out') || join(ROOT, 'dist', id));
// --out is deleted and rewritten: refuse anything that is not clearly a build folder
const inside = (a, b) => { const r = relative(b, a); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };
if (inside(ROOT, out) || inside(src, out) || inside(out, src) || ['src', 'examples', 'games', 'scenes', 'vendor', 'tools', 'assets', 'node_modules', '.git'].some((d) => inside(out, join(ROOT, d))))
  fail(`refusing to write the build to ${out}: pick an empty folder outside the sources (default dist/<id>)`);
if (existsSync(out) && (await readdir(out)).length && !existsSync(join(out, 'build.json')))
  fail(`${out} exists, is not empty and is not a previous build (no build.json): pick another --out or empty it yourself`);
await rm(out, { recursive: true, force: true }); await mkdir(out, { recursive: true });
const t0 = Date.now();

const alias = {
  'lcc-playable/kit': join(ROOT, 'src/kit/index.js'),
  'lcc-playable': join(ROOT, 'src/index.js'),
  '@xgrids/lcc-sdk-three': SDK_FILE,
};
const common = { bundle: true, format: 'esm', target: 'es2022', minify: true, legalComments: 'none', alias, logLevel: 'error', supported: { 'top-level-await': true } };
// game: physics.js is a dynamic import -> its own chunk, only downloaded by games that use physics
await build({ ...common, entryPoints: { main: join(src, 'main.js') }, outdir: out, splitting: true, chunkNames: 'chunks/[name]-[hash]' });
await build({ ...common, entryPoints: { 'geometry-worker': join(ROOT, 'src/geometry/worker.js') }, outdir: out });
await cp(join(ROOT, 'assets/characters'), join(out, 'assets/characters'), { recursive: true });
// copy any other files of the game (images, sounds, extra html), except sources
for (const e of await readdir(src, { withFileTypes: true })) {
  if (/\.(m?js)$/.test(e.name) || e.name === 'index.html') continue;
  await cp(join(src, e.name), join(out, e.name), { recursive: true });
}

// scene
const main = await readFile(join(src, 'main.js'), 'utf8');
const sceneRef = main.match(/const SCENE = '([^']+)'/)?.[1];
const scenes = {};
let sceneNote = 'scene URL unchanged';
if (args.includes('--no-scene')) {
  // nothing
} else if (opt('--scene-url')) {
  if (sceneRef) scenes[sceneRef] = opt('--scene-url');
  sceneNote = `scene from ${opt('--scene-url')} (needs CORS)`;
} else if (sceneRef?.startsWith('/scenes/')) {
  const name = sceneRef.split('/')[2];
  const s = resolveScene(name);
  const dst = join(out, 'scenes', name);
  await cp(s.dir, dst, { recursive: true, dereference: true, filter: (p) => !relative(s.dir, p).startsWith('prep') });
  await writePrep(join(dst, 'prep'), await computeGeometry(s, { splats: browserSplatGeometry }));
  scenes[sceneRef] = `./scenes/${name}/${s.meta}`;
  sceneNote = `scene copied to scenes/${name}/ (+ prep/)`;
}

const config = { assets: './assets/', geometryWorker: './geometry-worker.js', scenes };
let html = await readFile(join(src, 'index.html'), 'utf8');
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, `<script>window.PLAYABLE_CONFIG = ${JSON.stringify(config).replace(/</g, '\\u003c')};</script>\n`);
html = html.replace(/<script type="module" src="\.\/main\.js"><\/script>/, '<script type="module" src="./main.js"></script>');
await writeFile(join(out, 'index.html'), html);

// THIRD_PARTY_NOTICES.txt: licenses of everything bundled
const lic = async (f) => { try { return await readFile(f, 'utf8'); } catch { return '(license file not found: ' + f + ')'; } };
await writeFile(join(out, 'THIRD_PARTY_NOTICES.txt'), [
  'This game was built with lcc-playable (Apache-2.0).',
  'It bundles the following third-party software and assets.\n',
  '== LCC Web SDK (XGRIDS) ==\nProprietary; subject to the XGRIDS terms: https://www.xgrids.com/us/support/download/lcc-for-web\nRedistribution as part of this game is permitted by XGRIDS.\n',
  '== LCC2 Data Organization Format (XGRIDS) ==\nData Organization Format originated from XGRIDS. This game reads scene data in the LCC2 Data Organization Format, which it uses and distributes under authorization from XGRIDS pursuant to the LCC2 White Paper (https://github.com/xgrids/LCC2Whitepaper). XGRIDS and its affiliates own and retain all intellectual property and other rights in the Data Organization Format. Without the prior written consent of XGRIDS, the Data Organization Format may not be used for training or fine-tuning any artificial intelligence model that competes, directly or indirectly, with XGRIDS products or services.\n',
  '== three.js (MIT) ==\n' + await lic(join(ROOT, 'node_modules/three/LICENSE')),
  '== @dimforge/rapier3d-compat (Apache-2.0) ==\n' + await lic(join(ROOT, 'node_modules/@dimforge/rapier3d-compat/LICENSE')),
  ...await Promise.all((await readdir(join(ROOT, 'assets/characters'))).filter((f) => f.startsWith('LICENSE')).map(async (f) => `== assets/characters/${f} ==\n` + await lic(join(ROOT, 'assets/characters', f)))),
  '== Scene data ==\nThe scene is not covered by any of the licenses above. XGRIDS sample scenes are for testing only and not licensed for commercial use.',
].join('\n'));

// build.json: when and from what this was built (the dev home page uses it to flag outdated builds)
await writeFile(join(out, 'build.json'), JSON.stringify({ game: relative(ROOT, src).replace(/\\/g, '/'), built: new Date().toISOString(), scene: sceneNote }, null, 1));

const size = async (d) => { let n = 0; for (const e of await readdir(d, { withFileTypes: true })) n += e.isDirectory() ? await size(join(d, e.name)) : (await stat(join(d, e.name))).size; return n; };
const mb = (b) => +(b / 1e6).toFixed(1);
console.log(JSON.stringify({
  out, ms: Date.now() - t0, totalMB: mb(await size(out)),
  codeMB: mb((await stat(join(out, 'main.js'))).size), scene: sceneNote,
  preview: inside(out, ROOT) ? `npm run dev, then http://localhost:${PORT}/${relative(ROOT, out).replace(/\\/g, '/')}/` : `serve ${out} with any static web server`,
  note: 'Contains the LCC Web SDK (XGRIDS terms; redistribution allowed). Without an appKey a small XGRIDS watermark shows on deployed sites. Do not publish XGRIDS sample scenes commercially.',
}, null, 1));
