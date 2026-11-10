// Zip extraction (tools/unzip.mjs) on zips built here: stored + deflated entries, folders, UTF-8 names, zip slip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractZip, listZip } from '../tools/unzip.mjs';

function zip(entries) { // [{ name, data?: Buffer, deflate?: boolean }] -> Buffer (CRC left 0: the extractor checks sizes)
  const locals = [], central = []; let off = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8'), raw = e.data || Buffer.alloc(0), body = e.deflate ? deflateRawSync(raw) : raw;
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x800, 6); h.writeUInt16LE(e.deflate ? 8 : 0, 8);
    h.writeUInt32LE(body.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(name.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8); c.writeUInt16LE(e.deflate ? 8 : 0, 10);
    c.writeUInt32LE(body.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(off, 42);
    locals.push(h, name, body); central.push(c, name); off += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}

test('extracts stored and deflated entries, folders and UTF-8 names', async () => {
  const d = await mkdtemp(join(tmpdir(), 'lp-unzip-')), z = join(d, 'a.zip'), out = join(d, 'out');
  const big = Buffer.alloc(3 << 20, 'splat '); // spans several 1 MB reads
  await writeFile(z, zip([{ name: 'Scene/' }, { name: 'Scene/scene.lcc2', data: Buffer.from('{"a":1}') }, { name: 'Scene/data/big.bin', data: big, deflate: true }, { name: 'Scene/寺庙.txt', data: Buffer.from('ok'), deflate: true }]));
  assert.equal((await listZip(z)).length, 4);
  assert.equal(await extractZip(z, out), 3);
  assert.equal(await readFile(join(out, 'Scene/scene.lcc2'), 'utf8'), '{"a":1}');
  assert.ok((await readFile(join(out, 'Scene/data/big.bin'))).equals(big));
  assert.equal(await readFile(join(out, 'Scene/寺庙.txt'), 'utf8'), 'ok');
  await rm(d, { recursive: true, force: true });
});

test('refuses entries outside the target folder and non-zip files', async () => {
  const d = await mkdtemp(join(tmpdir(), 'lp-unzip-')), z = join(d, 'evil.zip'), out = join(d, 'out');
  await writeFile(z, zip([{ name: '../escaped.txt', data: Buffer.from('x') }]));
  await assert.rejects(extractZip(z, out), /outside the target folder/);
  await assert.rejects(access(join(d, 'escaped.txt')));
  await writeFile(join(d, 'no.zip'), 'hello');
  await assert.rejects(listZip(join(d, 'no.zip')), /not a zip/);
  await rm(d, { recursive: true, force: true });
});
