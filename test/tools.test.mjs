// CLI tools: --help works without side effects, build refuses dangerous output folders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const run = (...a) => spawnSync(process.execPath, a, { cwd: ROOT, encoding: 'utf8' });

for (const t of ['setup', 'scene', 'new', 'check', 'build']) {
  test(`${t} --help exits 0`, () => { const r = run(`tools/${t}.mjs`, '--help'); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /npm run/); });
}
test('build refuses to overwrite the repository', () => {
  const r = run('tools/build.mjs', 'examples/explore', '--out', '.');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /refusing|SDK missing/);
});
test('new rejects bad ids', () => {
  const r = run('tools/new.mjs', 'Bad_ID', '--from', 'explore');
  assert.notEqual(r.status, 0);
});
