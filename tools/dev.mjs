#!/usr/bin/env node
// npm run dev [-- --port 8091] [--host 0.0.0.0]: serve the repository for local preview.
// Default host 127.0.0.1 (this machine only). --host 0.0.0.0 makes it reachable from the LAN (phones): it then
// serves the repository's non-hidden files to anyone on the network.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { startServer } from './serve.mjs';
import { ROOT, PORT, SDK_FILE, listScenes } from './env.mjs';

const i = process.argv.indexOf('--port');
const port = i > 0 ? +process.argv[i + 1] : PORT;
if (!existsSync(SDK_FILE)) console.warn('warning: LCC Web SDK missing, run `npm run setup` first');
const hi = process.argv.indexOf('--host');
const host = hi > 0 ? process.argv[hi + 1] : undefined;
await startServer(port, { host });
if (host && host !== '127.0.0.1' && host !== 'localhost') console.warn(`warning: listening on ${host}: anyone on your network can read the repository files`);
const games = existsSync(join(ROOT, 'games')) ? readdirSync(join(ROOT, 'games'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];
console.log(`lcc-playable dev server: http://localhost:${port}/`);
for (const g of games) console.log(`  game     http://localhost:${port}/games/${g}/`);
for (const e of readdirSync(join(ROOT, 'examples'))) console.log(`  example  http://localhost:${port}/examples/${e}/?scene=/scenes/<name>/<file>.lcc2`);
console.log(`  scenes: ${listScenes().join(', ') || '(none, see npm run scene -- add)'}`);
