// Estimate surface layers from the splats themselves, for scenes without a collision mesh. Pure JS (browser and Node);
// decoding the .sog files needs a browser (see sog.js).
//
// Every opaque, reasonably small splat votes for a surface at its height in the cells under it. Flat splats whose
// thinnest axis points up (ground, floors, stairs) vote for a walkable surface and are spread over their footprint,
// tilted along their plane; all others (walls, trunks, furniture, foliage) vote for an obstacle at their height.
// Per cell, the votes are sorted by height and grouped into layers; layers with too little weight are dropped as
// noise. Small holes in the ground are filled from the neighbours. The result has the same form as meshLayers(), so
// ground, walkability, paths and routes work the same way, with lower accuracy: see docs/api.md.
import { PARAMS, makeLayers, insertLayer } from './prep.js';
import { decodeSog, splatLevel } from './sog.js';

export const SPLAT_PARAMS = {
  MIN_OPACITY: 0.1,   // fainter splats are ignored
  MAX_SIGMA: 1.0,     // splats with a larger axis (m) are ignored (blurry backgrounds, floaters)
  FLAT: 0.4,          // flat: thinnest axis < FLAT x the middle one
  FOOT_MAX: 0.4,      // max footprint radius of a ground splat (m)
  GAP: 0.2,           // votes closer than this in height form one layer
  THIN: 0.3,          // a layer thinner than this (m) is a surface; thicker ones are obstacles
  W_GROUND: 0.3,      // min opacity sum for a surface layer
  W_OBSTACLE: 0.6,    // min opacity sum for an obstacle layer
  UNDER: 0.35,        // layers below the heaviest surface with less than this share of its weight are noise
  LIFT: 0.08,         // ground splat centers sit this much below the collision mesh (median of two scenes,
                      //   religious_center and Stanford: -0.08 and -0.09 m); surfaces are raised by it
  MAX_SPLATS: 4e6,    // use the finest level of detail with at most this many splats
  SPECK: 2,           // see step 6
  HOLE: 5,            // see step 7
  TRIM: 0.002,        // drop this share of splats on each side of each axis when sizing the grid (stray splats)
};

/**
 * @param {{pos: Float32Array, scale: Float32Array, quat: Float32Array, opacity: Float32Array, count: number}[]} parts decoded splats
 * @param {{res?: number}} [opt]
 * @returns {import('./prep.js').Layers}
 */
export function splatLayers(parts, { res = 0.2 } = {}) {
  const P = SPLAT_PARAMS, NZ_MIN = PARAMS.NZ_MIN;
  // 1. per splat: keep?, center, footprint radius, plane slope, flat-and-up
  let n = 0; for (const p of parts) n += p.count;
  const X = new Float32Array(n), Y = new Float32Array(n), Z = new Float32Array(n), Rf = new Float32Array(n);
  const GX = new Float32Array(n), GY = new Float32Array(n), Wt = new Float32Array(n), Up = new Uint8Array(n), SZ = new Float32Array(n);
  let m = 0;
  for (const p of parts) {
    for (let i = 0; i < p.count; i++) {
      const op = p.opacity[i]; if (op < P.MIN_OPACITY) continue;
      const s0 = p.scale[i * 3], s1 = p.scale[i * 3 + 1], s2 = p.scale[i * 3 + 2];
      if (Math.max(s0, s1, s2) > P.MAX_SIGMA) continue;
      const w = p.quat[i * 4], x = p.quat[i * 4 + 1], y = p.quat[i * 4 + 2], z = p.quat[i * 4 + 3];
      // rotation matrix rows (world = R * local)
      const r00 = 1 - 2 * (y * y + z * z), r01 = 2 * (x * y - w * z), r02 = 2 * (x * z + w * y);
      const r10 = 2 * (x * y + w * z), r11 = 1 - 2 * (x * x + z * z), r12 = 2 * (y * z - w * x);
      const r20 = 2 * (x * z - w * y), r21 = 2 * (y * z + w * x), r22 = 1 - 2 * (x * x + y * y);
      const sx = Math.sqrt((r00 * s0) ** 2 + (r01 * s1) ** 2 + (r02 * s2) ** 2);
      const sy = Math.sqrt((r10 * s0) ** 2 + (r11 * s1) ** 2 + (r12 * s2) ** 2);
      const sz = Math.sqrt((r20 * s0) ** 2 + (r21 * s1) ** 2 + (r22 * s2) ** 2);
      // thinnest axis and the middle one
      let k = 0, lo = s0; if (s1 < lo) { k = 1; lo = s1; } if (s2 < lo) { k = 2; lo = s2; }
      const mid = k === 0 ? Math.min(s1, s2) : k === 1 ? Math.min(s0, s2) : Math.min(s0, s1);
      let nx = k === 0 ? r00 : k === 1 ? r01 : r02, ny = k === 0 ? r10 : k === 1 ? r11 : r12, nz = k === 0 ? r20 : k === 1 ? r21 : r22;
      if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const flatUp = lo < P.FLAT * mid && nz >= NZ_MIN;
      X[m] = p.pos[i * 3]; Y[m] = p.pos[i * 3 + 1]; Z[m] = p.pos[i * 3 + 2]; Wt[m] = op; SZ[m] = sz;
      if (flatUp) { Up[m] = 1; Rf[m] = Math.min(P.FOOT_MAX, 1.2 * Math.max(sx, sy)); GX[m] = -nx / nz; GY[m] = -ny / nz; }
      else { Up[m] = 0; Rf[m] = Math.min(0.3, Math.max(sx, sy)); }
      m++;
    }
  }
  if (!m) throw new Error('no usable splats (all too faint or too large)');
  // 2. grid extent from trimmed percentiles (stray splats far outside the scene would blow up the grid)
  const bb = [0, 0, 0, 0, 0, 0];
  [X, Y, Z].forEach((A, a) => {
    const step = Math.max(1, Math.floor(m / 200000)), s = []; for (let i = 0; i < m; i += step) s.push(A[i]);
    s.sort((u, v) => u - v);
    bb[a] = s[Math.floor(P.TRIM * (s.length - 1))] - 1; bb[a + 3] = s[Math.ceil((1 - P.TRIM) * (s.length - 1))] + 1;
  });
  const L = makeLayers(bb, res, 'splats'); L.splats = m;
  const { X0, Y0, W, H } = L, N = W * H;
  // 3. votes per cell (two passes: count, then fill), each vote = height, weight, ground flag
  const forEachVote = (i, fn) => {
    const r = Rf[i], i0 = Math.max(0, Math.floor((X[i] - r - X0) / res)), i1 = Math.min(W - 1, Math.floor((X[i] + r - X0) / res));
    const j0 = Math.max(0, Math.floor((Y[i] - r - Y0) / res)), j1 = Math.min(H - 1, Math.floor((Y[i] + r - Y0) / res));
    if (i0 > i1 || j0 > j1 || Z[i] < bb[2] || Z[i] > bb[5]) return;
    for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) {
      const dx = X0 + (ii + 0.5) * res - X[i], dy = Y0 + (j + 0.5) * res - Y[i];
      if (dx * dx + dy * dy > r * r && !(ii === Math.floor((X[i] - X0) / res) && j === Math.floor((Y[i] - Y0) / res))) continue;
      const c = j * W + ii;
      if (Up[i]) fn(c, Z[i] + GX[i] * dx + GY[i] * dy);
      else if (SZ[i] > P.GAP) { fn(c, Z[i] - SZ[i]); fn(c, Z[i]); fn(c, Z[i] + SZ[i]); } // tall: a trunk, a pole
      else fn(c, Z[i]);
    }
  };
  const cnt = new Uint32Array(N + 1);
  for (let i = 0; i < m; i++) forEachVote(i, (c) => { cnt[c + 1]++; });
  for (let c = 0; c < N; c++) cnt[c + 1] += cnt[c];
  const V = cnt[N], vz = new Float32Array(V), vw = new Float32Array(V), vu = new Uint8Array(V), fillAt = cnt.slice(0, N);
  for (let i = 0; i < m; i++) forEachVote(i, (c, z) => { const o = fillAt[c]++; vz[o] = z; vw[o] = Wt[i]; vu[o] = Up[i]; });
  // 4. cluster votes per cell into layers
  const ord = [], cl = []; // cl: [z, weight, surface?, top] per layer
  for (let c = 0; c < N; c++) {
    const a = cnt[c], b = cnt[c + 1]; if (a === b) continue;
    ord.length = 0; for (let o = a; o < b; o++) ord.push(o);
    ord.sort((u, v) => vz[u] - vz[v]);
    let k = 0; cl.length = 0;
    while (k < ord.length) {
      let sw = 0, swz = 0, su = 0, last = vz[ord[k]], e = k;
      while (e < ord.length && vz[ord[e]] - last < P.GAP) { const o = ord[e]; sw += vw[o]; swz += vw[o] * vz[o]; if (vu[o]) su += vw[o]; last = vz[o]; e++; }
      // a thin layer is a surface you can stand on; a tall one (wall, trunk, bush) is an obstacle from bottom to top
      const z0 = vz[ord[k]], z1 = last;
      if (z1 - z0 < P.THIN || su >= 0.5 * sw) { if (sw >= P.W_GROUND) cl.push(swz / sw, sw, 1, 0); }
      else if (sw >= P.W_OBSTACLE) cl.push(z0, sw, 0, z1);
      k = e;
    }
    // sparse surfaces under the heaviest one are noise (reflections, splats behind the ground): drop them
    let wmax = 0, zmax = 0; for (let q = 0; q < cl.length; q += 4) if (cl[q + 2] && cl[q + 1] > wmax) { wmax = cl[q + 1]; zmax = cl[q]; }
    for (let q = 0; q < cl.length; q += 4) {
      const z = cl[q], w = cl[q + 1];
      if (cl[q + 2]) { if (z < zmax && w < P.UNDER * wmax) continue; insertLayer(L, c, z + P.LIFT, true); }
      else if (!(cl[q + 3] < zmax && w < P.UNDER * wmax)) { insertLayer(L, c, z, false); insertLayer(L, c, (z + cl[q + 3]) / 2, false); insertLayer(L, c, cl[q + 3], false); }
    }
  }
  // 5. smooth surfaces: each surface height becomes the median of itself and the nearest surfaces (within 0.3 m) of
  //    its 8 neighbours, so per-cell noise does not break walking (the step limit is 0.25 m)
  { const ML = PARAMS.MAXL, nz = new Float32Array(L.hz), g = [];
    for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
      const c = j * W + i;
      for (let q = 0; q < L.hn[c]; q++) {
        if (!L.hup[c * ML + q]) continue;
        const z = L.hz[c * ML + q]; g.length = 0; g.push(z);
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue; const nb = c + dj * W + di; let best = NaN, bd = 0.3;
          for (let r = 0; r < L.hn[nb]; r++) { const o = nb * ML + r; if (L.hup[o] && Math.abs(L.hz[o] - z) < bd) { bd = Math.abs(L.hz[o] - z); best = L.hz[o]; } }
          if (!Number.isNaN(best)) g.push(best);
        }
        g.sort((u, v) => u - v); nz[c * ML + q] = g[g.length >> 1];
      }
    }
    L.hz.set(nz); }
  // 6. remove specks: a layer up to 2 m above the cell's lowest surface with a similar layer in at most SPECK of the 8
  //    neighbours is noise (a floater, a stray splat). Real obstacles, even a thin pole, span more cells.
  { const ML = PARAMS.MAXL, drop = new Uint8Array(N * ML);
    const has = (nb, z) => { for (let r = 0; r < L.hn[nb]; r++) if (Math.abs(L.hz[nb * ML + r] - z) < 0.3) return true; return false; };
    for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
      const c = j * W + i; let g = NaN;
      for (let q = 0; q < L.hn[c]; q++) if (L.hup[c * ML + q]) { g = L.hz[c * ML + q]; break; }
      for (let q = 0; q < L.hn[c]; q++) {
        const z = L.hz[c * ML + q]; if (!(z > g + 0.15 && z < g + 2)) continue;
        let k = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if ((di || dj) && has(c + dj * W + di, z)) k++;
        if (k <= P.SPECK) drop[c * ML + q] = 1;
      }
    }
    for (let c = 0; c < N; c++) {
      let o = 0; const b = c * ML;
      for (let q = 0; q < L.hn[c]; q++) if (!drop[b + q]) { L.hz[b + o] = L.hz[b + q]; L.hup[b + o] = L.hup[b + q]; o++; }
      for (let q = o; q < L.hn[c]; q++) { L.hz[b + q] = NaN; L.hup[b + q] = 0; }
      L.hn[c] = o;
    } }
  // 7. fill small holes in the ground: a cell without a surface near the ground of at least HOLE of its 8 neighbours
  //    (at similar heights) gets their median
  for (let pass = 0; pass < 3; pass++) {
    const add = [];
    for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
      const c = j * W + i;
      const g = [];
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue; const nb = c + dj * W + di, base = nb * PARAMS.MAXL;
        for (let q = 0; q < L.hn[nb]; q++) if (L.hup[base + q]) { g.push(L.hz[base + q]); break; }
      }
      if (g.length < P.HOLE) continue;
      g.sort((u, v) => u - v);
      const med = g[g.length >> 1]; if (g[g.length - 1] - g[0] >= 0.3) continue;
      let near = false; for (let q = 0; q < L.hn[c]; q++) if (L.hz[c * PARAMS.MAXL + q] < med + 1) { near = true; break; }
      if (!near) add.push(c, med);
    }
    for (let q = 0; q < add.length; q += 2) insertLayer(L, add[q], add[q + 1], true);
  }
  return L;
}

/**
 * Fetch, decode and rasterize the splats of a scene (browser or Worker).
 * @param {object} meta parsed .lcc2
 * @param {(rel: string) => Promise<Uint8Array>} get reads a file relative to the .lcc2
 * @param {{res?: number, onProgress?: (p: number) => void}} [opt]
 */
export async function splatLayersFromScene(meta, get, { res = 0.2, onProgress = () => {} } = {}) {
  let lv = splatLevel(meta, 0);
  for (let l = lv.levels - 1; l > 0; l--) { const c = splatLevel(meta, l); if (c.splats <= SPLAT_PARAMS.MAX_SPLATS) { lv = c; break; } }
  const parts = new Array(lv.files.length); let next = 0, done = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < lv.files.length) { const i = next++; parts[i] = await decodeSog(await get(lv.files[i])); onProgress(++done / lv.files.length); }
  }));
  const L = splatLayers(parts, { res });
  L.level = lv.level;
  return L;
}
