#!/usr/bin/env node
// npm run new -- <id> --from <example> --scene <name|url>
// Copy examples/<example>/ to games/<id>/ and point it at the scene. Examples: see examples/ (explore, runner, fps, flight).
import { cp, readFile, writeFile, access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, PORT, listScenes, resolveScene } from './env.mjs';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const id = args.find((a, i) => !a.startsWith('--') && !['--from', '--scene', '--title'].includes(args[i - 1]));
const USAGE = 'usage: npm run new -- <id> --from <example> --scene <name|url> [--title "My Game"]   (id: lowercase letters, digits, -)';
if (args.includes('--help') || args.includes('-h')) { console.log(USAGE); process.exit(0); }
const examples = (await readdir(join(ROOT, 'examples'))).sort();
const from = opt('--from') || 'explore';
const fail = (m) => { console.error(m); process.exit(1); };
if (!id || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(id)) fail(USAGE);
if (!examples.includes(from)) fail(`unknown example "${from}". Available: ${examples.join(', ')}`);
const scenes = listScenes();
const sceneArg = opt('--scene') || (scenes.length === 1 ? scenes[0] : undefined);
if (!sceneArg) fail(`pass --scene. Local scenes: ${scenes.join(', ') || '(none; npm run scene -- add)'}`);
const s = resolveScene(sceneArg);
const url = s.kind === 'url' ? s.url : s.webPath;
if (!url) fail('local scenes must be under scenes/ (npm run scene -- add)');
if (/['"\\\\`\n<>]/.test(url)) fail(`scene URL contains characters that are not allowed: ${url}`);
const dir = join(ROOT, 'games', id);
if (await access(dir).then(() => true, () => false)) fail(`already exists: ${dir}`);
await cp(join(ROOT, 'examples', from), dir, { recursive: true });
const main = join(dir, 'main.js');
const src = await readFile(main, 'utf8');
if (!src.includes("'/scenes/your-scene/scene.lcc2'")) fail('example main.js has no SCENE placeholder');
// the game's title on the start card: --title, or the id in title case ("temple-delivery" -> "Temple Delivery")
const title = (opt('--title') || id.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')).replace(/[\\'\n]/g, '');
const out = src.replace("'/scenes/your-scene/scene.lcc2'", `'${url}'`).replace(/^(\s*title:\s*)'[^'\n]*'/m, `$1'${title}'`);
await writeFile(main, out);
await writeFile(join(dir, 'index.html'), (await readFile(join(dir, 'index.html'), 'utf8')).replace(/<title>[^<]*<\/title>/, `<title>${title.replace(/[&<>]/g, '')}</title>`));
console.log(JSON.stringify({ dir, from, scene: url, preview: `http://localhost:${PORT}/games/${id}/`, check: `npm run check -- games/${id}` }));
