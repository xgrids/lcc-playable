// Dev server: containment, hidden files, Range handling, home page.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer } from '../tools/serve.mjs';

let srv, port;
before(async () => { srv = await startServer(0); port = srv.address().port; });
after(() => srv.close());

const get = (path, headers = {}) => new Promise((ok, fail) => {
  http.get({ host: '127.0.0.1', port, path, headers }, (res) => { let n = 0; res.on('data', (d) => (n += d.length)); res.on('end', () => ok({ status: res.statusCode, headers: res.headers, length: n })); }).on('error', fail);
});

test('listens on 127.0.0.1 by default', () => assert.equal(srv.address().address, '127.0.0.1'));
test('serves repository files', async () => assert.equal((await get('/package.json')).status, 200));
test('home page lists games and examples', async () => assert.equal((await get('/')).status, 200));
test('never serves hidden files', async () => {
  for (const p of ['/.git/config', '/.cache/x', '/src/.env']) assert.equal((await get(p)).status, 404, p);
});
test('rejects path traversal', async () => {
  for (const p of ['/..%2F..%2Fetc%2Fpasswd', '/scenes/..%2F..%2Fpackage.json', '/%2e%2e/%2e%2e/etc/passwd']) assert.notEqual((await get(p)).status, 200, p);
});
test('Range: valid, clamped, suffix, invalid', async () => {
  const full = (await get('/package.json')).length;
  const a = await get('/package.json', { Range: 'bytes=0-9' });
  assert.equal(a.status, 206); assert.equal(a.length, 10);
  const b = await get('/package.json', { Range: 'bytes=5-999999' });
  assert.equal(b.status, 206); assert.equal(b.length, full - 5);
  const c = await get('/package.json', { Range: 'bytes=-10' });
  assert.equal(c.status, 206); assert.equal(c.length, 10);
  for (const r of ['bytes=-', 'bytes=999999-', 'bytes=10-5', 'nonsense']) assert.equal((await get('/package.json', { Range: r })).status, 416, r);
  assert.equal((await get('/package.json')).status, 200); // still alive
});
test('CORS headers only for scenes', async () => {
  assert.equal((await get('/package.json')).headers['access-control-allow-origin'], undefined);
});
