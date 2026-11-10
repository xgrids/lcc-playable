// Decode LCC splat files (`.sog`, SOG version 2): a zip of lossless WebP images plus meta.json.
// Browser only (main thread or Worker): WebP is decoded with createImageBitmap + OffscreenCanvas.
//
//   means_l/means_u  16-bit position per axis, log-encoded: v = lerp(mins, maxs, q / 65535), p = sign(v) (e^|v| - 1)
//   scales           RGB = codebook indices, scale = e^codebook[i] (one sigma, meters)
//   quats            smallest-three: RGB = the three smaller components, (byte / 255 - 0.5) * sqrt 2; A - 252 = index
//                    of the largest component in (w, x, y, z)
//   sh0              A = opacity (0..255)
// Splat i is pixel i of every image (row-major).

/** Read a zip held in memory: Map name -> Uint8Array. Stored and deflated entries. */
export async function readZip(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let e = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('sog: not a zip file');
  const count = dv.getUint16(e + 10, true); let o = dv.getUint32(e + 16, true);
  const out = new Map();
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(o, true) !== 0x02014b50) throw new Error('sog: bad zip directory');
    const method = dv.getUint16(o + 10, true), csize = dv.getUint32(o + 20, true);
    const nlen = dv.getUint16(o + 28, true), xlen = dv.getUint16(o + 30, true), clen = dv.getUint16(o + 32, true), lho = dv.getUint32(o + 42, true);
    const name = new TextDecoder().decode(u8.subarray(o + 46, o + 46 + nlen));
    o += 46 + nlen + xlen + clen;
    const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    const raw = u8.subarray(start, start + csize);
    if (method === 0) out.set(name, raw);
    else if (method === 8) out.set(name, new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()));
    else throw new Error(`sog: zip method ${method} not supported`);
  }
  return out;
}

async function pixels(bytes) {
  const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/webp' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0); bmp.close();
  return g.getImageData(0, 0, c.width, c.height, { colorSpace: 'srgb' }).data;
}

/**
 * Decode one .sog file.
 * @param {Uint8Array} u8
 * @returns {Promise<{count: number, pos: Float32Array, scale: Float32Array, quat: Float32Array, opacity: Float32Array}>}
 *   pos/scale: xyz per splat; quat: (w, x, y, z) per splat; opacity 0..1.
 */
export async function decodeSog(u8) {
  const z = await readZip(u8);
  const meta = JSON.parse(new TextDecoder().decode(z.get('meta.json')));
  if (meta.version !== 2) throw new Error(`sog: version ${meta.version} not supported (expected 2)`);
  const n = meta.count;
  const img = async (f) => { const b = z.get(f); if (!b) throw new Error(`sog: ${f} missing`); return pixels(b); };
  const [ml, mu, sc, qt, s0] = await Promise.all([img(meta.means.files[0]), img(meta.means.files[1]), img(meta.scales.files[0]), img(meta.quats.files[0]), img(meta.sh0.files[0])]);
  const { mins, maxs } = meta.means, cb = meta.scales.codebook;
  const pos = new Float32Array(n * 3), scale = new Float32Array(n * 3), quat = new Float32Array(n * 4), opacity = new Float32Array(n);
  const ecb = cb.map(Math.exp), R = Math.SQRT2 / 255, h = Math.SQRT1_2;
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    for (let a = 0; a < 3; a++) {
      const v = mins[a] + (maxs[a] - mins[a]) * ((mu[p + a] << 8) | ml[p + a]) / 65535;
      pos[i * 3 + a] = Math.sign(v) * (Math.exp(Math.abs(v)) - 1);
      scale[i * 3 + a] = ecb[sc[p + a]];
    }
    const a = qt[p] * R - h, b = qt[p + 1] * R - h, c = qt[p + 2] * R - h, d = Math.sqrt(Math.max(0, 1 - a * a - b * b - c * c));
    const m = qt[p + 3] - 252, q = i * 4;
    if (m === 0) { quat[q] = d; quat[q + 1] = a; quat[q + 2] = b; quat[q + 3] = c; }
    else if (m === 1) { quat[q] = a; quat[q + 1] = d; quat[q + 2] = b; quat[q + 3] = c; }
    else if (m === 2) { quat[q] = a; quat[q + 1] = b; quat[q + 2] = d; quat[q + 3] = c; }
    else { quat[q] = a; quat[q + 1] = b; quat[q + 2] = c; quat[q + 3] = d; }
    opacity[i] = s0[p + 3] / 255;
  }
  return { count: n, pos, scale, quat, opacity };
}

/**
 * The splat files of one level of detail. Level 0 is the coarsest (fewest splats). Each level of the .lcc2 octree
 * holds the whole scene; the environment (sky) file is not included.
 * @returns {{level: number, levels: number, files: string[], splats: number}}
 */
export function splatLevel(meta, level) {
  const files = meta.root?.splatFiles || [], by = [];
  (function walk(nd, depth) {
    const g = nd?.data?.['3dgs'];
    if (g) { const l = (by[depth] ||= { files: new Set(), splats: 0 }); l.files.add(files[g.name]); l.splats += g.count; }
    for (const k in nd?.child || {}) walk(nd.child[k], depth + 1);
  })(meta.root, 0);
  const levels = by.filter(Boolean);
  if (!levels.length) throw new Error('the scene has no splat files (root.splatFiles)');
  const l = Math.max(0, Math.min(levels.length - 1, level));
  return { level: l, levels: levels.length, files: [...levels[l].files], splats: levels[l].splats };
}
