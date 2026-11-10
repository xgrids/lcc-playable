// Static file server with CORS and Range support (no dependencies). Used by `npm run dev`, check and scene shot.
//   /scenes/<name>/...  -> scenes folder (LCC_SCENES)      everything else -> repository root
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, resolve, relative, isAbsolute } from 'node:path';
import { ROOT, SCENES, listScenes, resolveScene } from './env.mjs';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.lcc2': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.css': 'text/css', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml' };

export function staticHandler(mounts) {
  return async (req, res) => {
    try { await handle(mounts, req, res); } catch (e) { if (!res.headersSent) res.writeHead(500); res.end(); }
  };
}

async function handle(mounts, req, res) {
  let url;
  try { url = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
  // CORS only for scenes (the LCC SDK and `scene shot` fetch them cross-origin); everything else is same-origin
  if (url.startsWith('/scenes/')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Range');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  if (url === '/' && mounts.length > 1) { res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-cache' }).end(homePage()); return; }
  // hidden files and folders (.git, .cache, .env) are never served
  if (url.split('/').some((seg) => seg.startsWith('.'))) { res.writeHead(404).end('not found'); return; }
  const [prefix, dir] = mounts.find(([p]) => url.startsWith(p));
  let file = resolve(dir, '.' + url.slice(prefix.length - 1));
  const rel = relative(dir, file);
  if (rel.startsWith('..') || isAbsolute(rel)) { res.writeHead(403).end(); return; }
  let st;
  try { st = await stat(file); if (st.isDirectory()) { file = join(file, 'index.html'); st = await stat(file); } } catch { res.writeHead(404).end('not found'); return; }
  const type = TYPES[extname(file)] || 'application/octet-stream';
  const send = (opts) => { const r = createReadStream(file, opts); r.on('error', () => res.destroy()); r.pipe(res); };
  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    let start = NaN, end = NaN;
    if (m && m[1] !== '') { start = +m[1]; end = m[2] !== '' ? Math.min(+m[2], st.size - 1) : st.size - 1; }
    else if (m && m[2] !== '') { start = Math.max(0, st.size - +m[2]); end = st.size - 1; }
    if (!(start >= 0) || !(end >= start) || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }).end(); return; }
    res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes' });
    if (req.method === 'HEAD') res.end(); else send({ start, end });
  } else {
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
    if (req.method === 'HEAD') res.end(); else send();
  }
}

// The dev server's home page: links to every game, example (with each local scene) and build.
function homePage() {
  const dirs = (d) => { try { return readdirSync(join(ROOT, d), { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(join(ROOT, d, e.name, 'index.html'))).map((e) => e.name).sort(); } catch { return []; } };
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const scenes = listScenes().map((n) => { try { return resolveScene(n); } catch { return null; } }).filter(Boolean);
  const li = (href, text, note = '') => `<li><a href="${esc(href)}">${esc(text)}</a>${note ? ` <small>${esc(note)}</small>` : ''}</li>`;
  const games = dirs('games'), examples = dirs('examples'), builds = dirs('dist');
  // newest modification time under a folder (skips prep/ and data files)
  const newest = (d) => { let t = 0; try { for (const e of readdirSync(d, { withFileTypes: true })) { const f = join(d, e.name); if (e.isDirectory()) { if (e.name !== 'prep' && e.name !== 'node_modules') t = Math.max(t, newest(f)); } else if (/\.(m?js|html|json|css)$/.test(e.name)) t = Math.max(t, statSync(f).mtimeMs); } } catch {} return t; };
  const buildNote = (b) => {
    let info; try { info = JSON.parse(readFileSync(join(ROOT, 'dist', b, 'build.json'), 'utf8')); } catch { return { note: 'unknown build time (rebuild to track it)', old: true }; }
    const built = Date.parse(info.built), changed = Math.max(newest(join(ROOT, 'src')), newest(join(ROOT, info.game)));
    const when = new Date(built).toLocaleString();
    return changed > built ? { note: `built ${when}; outdated: sources changed since. Rebuild: npm run build -- ${info.game}`, old: true } : { note: `built ${when}, up to date` };
  };
  return `<!doctype html><meta charset="utf-8"><title>lcc-playable</title>
<style>body{font:15px system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 16px;color:#222}a{color:#0a58ca}small{color:#777}code{background:#f2f2f2;padding:1px 4px}</style>
<h1>lcc-playable</h1>
<h2>Games</h2><ul>${games.map((g) => li(`/games/${g}/`, g)).join('') || '<li>none yet: <code>npm run new -- &lt;id&gt; --from explore --scene &lt;name&gt;</code></li>'}</ul>
<h2>Examples</h2><ul>${scenes.length ? examples.flatMap((e) => scenes.map((sc) => li(`/examples/${e}/?scene=${sc.webPath}`, `${e}`, `scene: ${sc.name}`))).join('') : '<li>no scenes yet: <code>npm run scene -- add &lt;folder-or-zip&gt; --name &lt;name&gt;</code></li>'}</ul>
${builds.length ? `<h2>Builds</h2><p><small>Snapshots made by <code>npm run build</code>; they do not change when the code changes. Play the game under Games for the current version.</small></p><ul>${builds.map((b) => { const n = buildNote(b); return li(`/dist/${b}/`, b, (n.old ? '⚠ ' : '') + n.note); }).join('')}</ul>` : ''}
<h2>Scenes</h2><ul>${scenes.map((sc) => `<li>${esc(sc.name)} <small>${esc(sc.webPath)}</small></li>`).join('') || '<li>none</li>'}</ul>`;
}

/**
 * Start a server on `port` (0 = random). Serves the repo, or `root` (e.g. a dist folder).
 * Listens on 127.0.0.1 only; pass host '0.0.0.0' (npm run dev -- --host 0.0.0.0) to test from a phone on the LAN.
 */
export function startServer(port = 0, { root, host = process.env.HOST || '127.0.0.1' } = {}) {
  const mounts = root ? [['/', normalize(root)]] : [['/scenes/', SCENES], ['/', ROOT]];
  const srv = createServer(staticHandler(mounts));
  return new Promise((ok, fail) => { srv.once('error', fail); srv.listen(port, host, () => ok(srv)); });
}
