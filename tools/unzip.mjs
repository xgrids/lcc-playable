// Minimal zip extraction in plain Node (no `unzip` / `tar` needed): stored and deflated entries, ZIP64 sizes and
// offsets, streamed to disk so multi-GB scenes do not need memory. Entries that would land outside `dest`
// (absolute paths, `..`) are refused. Encrypted entries and other compression methods throw.
import { open, mkdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { createInflateRaw } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { join, resolve, relative, dirname, isAbsolute } from 'node:path';

const u64 = (b, o) => Number(b.readBigUInt64LE(o));

async function readAt(fh, pos, len) { const b = Buffer.alloc(len); const { bytesRead } = await fh.read(b, 0, len, pos); return b.subarray(0, bytesRead); }

/** List entries: [{ name, method, csize, size, offset, dir, flags }]. */
export async function listZip(file) {
  const fh = await open(file, 'r');
  try {
    const { size } = await fh.stat();
    const tail = await readAt(fh, Math.max(0, size - 65557), Math.min(size, 65557));
    let e = -1; for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('not a zip file (no end of central directory)');
    let count = tail.readUInt16LE(e + 10), cdSize = tail.readUInt32LE(e + 12), cdOff = tail.readUInt32LE(e + 16);
    if (count === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) { // ZIP64
      const loc = e - 20;
      if (loc < 0 || tail.readUInt32LE(loc) !== 0x07064b50) throw new Error('zip64 locator missing');
      const z = await readAt(fh, u64(tail, loc + 8), 56);
      if (z.readUInt32LE(0) !== 0x06064b50) throw new Error('zip64 end record missing');
      count = u64(z, 32); cdSize = u64(z, 40); cdOff = u64(z, 48);
    }
    const cd = await readAt(fh, cdOff, cdSize), out = [];
    for (let o = 0, n = 0; n < count; n++) {
      if (cd.readUInt32LE(o) !== 0x02014b50) throw new Error('bad central directory');
      const flags = cd.readUInt16LE(o + 8), method = cd.readUInt16LE(o + 10);
      let csize = cd.readUInt32LE(o + 20), size = cd.readUInt32LE(o + 24), offset = cd.readUInt32LE(o + 42);
      const nl = cd.readUInt16LE(o + 28), xl = cd.readUInt16LE(o + 30), cl = cd.readUInt16LE(o + 32);
      const name = cd.toString(flags & 0x800 ? 'utf8' : 'latin1', o + 46, o + 46 + nl);
      for (let x = o + 46 + nl, end = x + xl; x + 4 <= end;) { // ZIP64 extra field: only the fields that overflowed
        const id = cd.readUInt16LE(x), len = cd.readUInt16LE(x + 2);
        if (id === 1) { let q = x + 4; if (size === 0xffffffff) { size = u64(cd, q); q += 8; } if (csize === 0xffffffff) { csize = u64(cd, q); q += 8; } if (offset === 0xffffffff) offset = u64(cd, q); }
        x += 4 + len;
      }
      out.push({ name, method, csize, size, offset, flags, dir: name.endsWith('/') });
      o += 46 + nl + xl + cl;
    }
    return out;
  } finally { await fh.close(); }
}

/** Extract `file` into `dest`. Returns the number of files written. onProgress(bytesDone, bytesTotal). */
export async function extractZip(file, dest, { onProgress } = {}) {
  const entries = await listZip(file), root = resolve(dest);
  const total = entries.reduce((a, e) => a + e.size, 0); let done = 0, files = 0;
  const fh = await open(file, 'r');
  try {
    for (const e of entries) {
      const rel = e.name.replace(/\\/g, '/');
      const target = resolve(root, rel), r = relative(root, target);
      if (isAbsolute(rel) || r.startsWith('..') || isAbsolute(r)) throw new Error(`zip entry outside the target folder: ${e.name}`);
      if (e.dir) { await mkdir(target, { recursive: true }); continue; }
      if (e.flags & 1) throw new Error(`encrypted zip entry: ${e.name}`);
      if (e.method !== 0 && e.method !== 8) throw new Error(`unsupported compression (method ${e.method}) for ${e.name}`);
      const h = await readAt(fh, e.offset, 30);
      if (h.readUInt32LE(0) !== 0x04034b50) throw new Error(`bad local header for ${e.name}`);
      const start = e.offset + 30 + h.readUInt16LE(26) + h.readUInt16LE(28);
      await mkdir(dirname(target), { recursive: true });
      const src = Readable.from((async function* () {
        for (let pos = start, end = start + e.csize; pos < end;) { const b = await readAt(fh, pos, Math.min(1 << 20, end - pos)); if (!b.length) throw new Error(`truncated zip: ${e.name}`); pos += b.length; yield b; }
      })());
      let written = 0;
      const count = async function* (s) { for await (const b of s) { written += b.length; done += b.length; onProgress?.(done, total); yield b; } };
      if (e.method === 8) await pipeline(src, createInflateRaw(), count, createWriteStream(target));
      else await pipeline(src, count, createWriteStream(target));
      if (written !== e.size) throw new Error(`size mismatch for ${e.name}: ${written} != ${e.size}`);
      files++;
    }
  } finally { await fh.close(); }
  return files;
}
