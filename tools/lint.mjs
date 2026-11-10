#!/usr/bin/env node
// npm run lint: syntax-check every JS file (node --check), and check the core/kit boundary: the kit imports the core
// only through its public entry (src/index.js), and the core never imports the kit. No dependencies.
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './env.mjs';

const SKIP = new Set(['node_modules', 'vendor', 'dist', 'scenes', 'games', '.git', '.cache']);
const files = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    if (SKIP.has(n)) continue;
    const f = join(d, n);
    if (statSync(f).isDirectory()) walk(f); else if (/\.m?js$/.test(n)) files.push(f);
  }
})(ROOT);
let bad = 0;
for (const f of files) {
  // browser modules with bare imports still parse fine with --check (it does not resolve imports)
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) { bad++; console.error(`${relative(ROOT, f)}:\n${r.stderr}`); }
}
// core/kit boundary (CONTRIBUTING.md): import specifiers, including `import('...')` in JSDoc types
const KIT = join(ROOT, 'src', 'kit'), SRC = join(ROOT, 'src');
const KIT_OK = (m) => m === 'three' || m.startsWith('three/addons/') || /^\.\/[\w-]+\.js$/.test(m) || m === '../index.js';
for (const f of files.concat(readdirSync(KIT).filter((n) => n.endsWith('.d.ts')).map((n) => join(KIT, n)))) {
  const inKit = f.startsWith(KIT + '/') || f.startsWith(KIT + '\\'), inCore = !inKit && (f.startsWith(SRC + '/') || f.startsWith(SRC + '\\'));
  if (!inKit && !inCore) continue;
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm)) {
    const spec = m[1];
    if (inKit && !KIT_OK(spec)) { bad++; console.error(`${relative(ROOT, f)}: imports '${spec}'. The kit uses the core only through '../index.js' (its public API).`); }
    if (inCore && /(^|\/)kit(\/|$)/.test(spec)) { bad++; console.error(`${relative(ROOT, f)}: imports '${spec}'. The core never imports the kit.`); }
  }
}
console.log(`${files.length} files checked, ${bad} with errors`);
process.exit(bad ? 1 : 0);
