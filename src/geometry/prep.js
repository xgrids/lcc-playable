// Scene geometry preprocessing. Pure JS, runs in a Web Worker, the main thread, or Node.
//
// Input: the scene's collision meshes (binary PLY, listed in .lcc2 `root.meshFiles`) and, optionally, the capture
// trajectory (`info/poses.json`). The trajectory is only a hint: the scanner may have ridden a chairlift, a vehicle or
// a drone. Poses whose camera is not 0.3-3.8 m above walkable ground are marked as not walked and ignored.
// Output: a 2D grid (default 0.2 m) over the scene with, per cell:
//   floor  ground height (NaN = no ground)
//   clear  headroom above the ground (Infinity = open sky)
//   walk   1 = walkable and connected to a walked pose (or, without walked poses, to the largest walkable area),
//          2 = walkable but isolated, 0 = not walkable
//   dist   distance to the nearest non-walkable cell or step edge (m), only meaningful where walk == 1
// plus the trajectory, decimated to ~0.5 m: [x, y, cameraZ, groundZ, segment, walked (1/0)].
// Coordinates are the scene's native Z-up frame, meters.

export const PARAMS = {
  HEAD: 1.0,    // min headroom for a walkable cell (lower than a person, so you can pass under branches)
  NZ_MIN: 0.8,  // min normal z for a ground face (about 37 degrees)
  STEP: 0.25,   // max height difference between neighbouring walkable cells (a stair step)
  CAM_MIN: 0.3, // a walked pose has its camera CAM_MIN..CAM_MAX above an upward-facing layer with headroom
  CAM_MAX: 3.8, //   (handheld or on a pole); higher poses are chairlifts, vehicles or drones
  MAXL: 8,      // max collision layers stored per cell
};

/** Parse a binary little-endian PLY with float xyz vertices and polygon faces. */
export function parsePly(u8) {
  const head0 = new TextDecoder('latin1').decode(u8.subarray(0, Math.min(u8.length, 4096)));
  const end = head0.indexOf('end_header\n');
  if (end < 0) throw new Error('PLY: no end_header');
  const head = head0.slice(0, end);
  if (!head.includes('binary_little_endian')) throw new Error('PLY: only binary_little_endian is supported');
  const nv = +head.match(/element vertex (\d+)/)[1];
  const nf = +head.match(/element face (\d+)/)[1];
  const vprops = (head.split('element vertex')[1].split('element face')[0].match(/property float \w+/g) || []).length;
  if (!/property list uchar (u?int|int32|uint32) vertex_ind/.test(head)) throw new Error('PLY: unexpected face format');
  let o = end + 'end_header\n'.length;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const v = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++, o += vprops * 4) {
    v[i * 3] = dv.getFloat32(o, true); v[i * 3 + 1] = dv.getFloat32(o + 4, true); v[i * 3 + 2] = dv.getFloat32(o + 8, true);
  }
  const f = [];
  for (let i = 0; i < nf; i++) {
    const n = dv.getUint8(o); o += 1;
    const a = dv.getInt32(o, true);
    for (let k = 1; k + 1 < n; k++) f.push(a, dv.getInt32(o + k * 4, true), dv.getInt32(o + (k + 1) * 4, true));
    o += n * 4;
  }
  return { v, f: Uint32Array.from(f) };
}

/** Capture trajectory segments from info/poses.json: single capture `poses`, or fused maps `fusionPoses`. */
export function poseSegments(posesJson) {
  if (!posesJson) return [];
  return posesJson.poses ? [posesJson.poses] : (posesJson.fusionPoses || []);
}

/**
 * Surface layers per grid cell: up to MAXL heights (ascending) where a vertical line through the cell center meets a
 * surface, and whether that surface faces up (something you can stand on). Built from collision meshes here, or
 * from splats in splats.js; buildFromLayers turns them into the walkability grid.
 * @typedef {{X0: number, Y0: number, W: number, H: number, res: number, hz: Float32Array, hup: Uint8Array, hn: Uint8Array,
 *   bbox: number[], triangles?: number, splats?: number, source: 'mesh'|'splats'}} Layers
 */

/** Empty layers for a bounding box [xmin, ymin, zmin, xmax, ymax, zmax]. */
export function makeLayers(bb, res, source) {
  const { MAXL } = PARAMS;
  const X0 = Math.floor(bb[0] / res) * res, Y0 = Math.floor(bb[1] / res) * res;
  const W = Math.ceil((bb[3] - X0) / res) + 1, H = Math.ceil((bb[4] - Y0) / res) + 1;
  const N = W * H;
  const L = { X0, Y0, W, H, res, hz: new Float32Array(N * MAXL).fill(NaN), hup: new Uint8Array(N * MAXL), hn: new Uint8Array(N), bbox: bb, source };
  return L;
}

/** Add a surface at height z to cell c (merges surfaces closer than 5 cm; when full, drops the highest). */
export function insertLayer(L, c, z, up) {
  const { MAXL } = PARAMS, { hz, hup, hn } = L;
  const b = c * MAXL, n = hn[c];
  for (let k = 0; k < n; k++) if (Math.abs(hz[b + k] - z) < 0.05) { if (up) hup[b + k] = 1; return; }
  let k = n < MAXL ? n : MAXL - 1;
  if (n === MAXL && z > hz[b + k]) return;
  while (k > 0 && hz[b + k - 1] > z) { hz[b + k] = hz[b + k - 1]; hup[b + k] = hup[b + k - 1]; k--; }
  hz[b + k] = z; hup[b + k] = up ? 1 : 0;
  if (n < MAXL) hn[c] = n + 1;
}

/** Layers from collision meshes: intersect a vertical line through every cell center with every triangle. */
export function meshLayers(meshes, { res: RES = 0.2 } = {}) {
  const { NZ_MIN } = PARAMS;
  const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  let triCount = 0;
  for (const m of meshes) {
    for (let i = 0; i < m.v.length; i += 3) for (let a = 0; a < 3; a++) { bb[a] = Math.min(bb[a], m.v[i + a]); bb[a + 3] = Math.max(bb[a + 3], m.v[i + a]); }
    triCount += m.f.length / 3;
  }
  if (!triCount) throw new Error('scene has no collision triangles');
  const L = makeLayers(bb, RES, 'mesh'); L.triangles = triCount;
  const { X0, Y0, W, H } = L;
  for (const { v, f } of meshes) {
    for (let t = 0; t < f.length; t += 3) {
      const a = f[t] * 3, b = f[t + 1] * 3, c = f[t + 2] * 3;
      const ax = v[a], ay = v[a + 1], az = v[a + 2], bx = v[b], by = v[b + 1], bz = v[b + 2], cx = v[c], cy = v[c + 1], cz = v[c + 2];
      const ux = bx - ax, uy = by - ay, uz = bz - az, wx = cx - ax, wy = cy - ay, wz = cz - az;
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const nl = Math.hypot(nx, ny, nz);
      if (nl === 0 || Math.abs(nz) < 1e-9) continue; // vertical face
      const up = Math.abs(nz) / nl >= NZ_MIN;
      const det = ux * wy - uy * wx;
      const i0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - X0) / RES - 0.5)), i1 = Math.min(W - 1, Math.floor((Math.max(ax, bx, cx) - X0) / RES - 0.5));
      const j0 = Math.max(0, Math.ceil((Math.min(ay, by, cy) - Y0) / RES - 0.5)), j1 = Math.min(H - 1, Math.floor((Math.max(ay, by, cy) - Y0) / RES - 0.5));
      for (let j = j0; j <= j1; j++) {
        const py = Y0 + (j + 0.5) * RES - ay;
        for (let i = i0; i <= i1; i++) {
          const px = X0 + (i + 0.5) * RES - ax;
          const l1 = (px * wy - py * wx) / det, l2 = (ux * py - uy * px) / det;
          if (l1 < 0 || l2 < 0 || l1 + l2 > 1) continue;
          insertLayer(L, j * W + i, az + l1 * uz + l2 * wz, up);
        }
      }
    }
  }
  return L;
}

/**
 * Build the walkability grid from collision meshes.
 * @param {{v: Float32Array, f: Uint32Array}[]} meshes
 * @param {object|null} posesJson parsed info/poses.json, or null when the scene has none
 * @param {{res?: number, log?: (msg: string) => void}} [opt]
 */
export function buildGeometry(meshes, posesJson, { res = 0.2, log = () => {} } = {}) {
  const L = meshLayers(meshes, { res });
  log(`raster ${L.W}x${L.H} @ ${res} m, ${L.triangles} triangles`);
  return buildFromLayers(L, posesJson, { log });
}

/**
 * Walkability grid from surface layers (see Layers): ground, headroom, the main walkable area, distance field.
 * @param {Layers} L
 * @param {object|null} posesJson
 */
export function buildFromLayers(L, posesJson, { log = () => {}, close = L.source === 'splats' ? 1 : 0, closeObstacles = true } = {}) {
  const { HEAD, STEP, CAM_MIN, CAM_MAX, MAXL } = PARAMS;
  const { X0, Y0, W, H, hz, hup, hn } = L, RES = L.res, N = W * H, bb = L.bbox;

  // 2. Walked poses -> reference ground level, spread to all cells by BFS (nearest walked pose wins). Without walked
  //    poses the reference stays NaN and step 3 takes the lowest ground layer.
  const segs = poseSegments(posesJson);
  const poses = []; // [x, y, cameraZ, groundZ, segment, walked]
  segs.forEach((seg, si) => { let q = null; for (const p of seg) { const [x, y, z] = p.T; if (!q || Math.hypot(x - q[0], y - q[1]) >= 0.5) { q = [x, y, z, null, si, 0]; poses.push(q); } } });
  const cellOf = (x, y) => { const i = Math.floor((x - X0) / RES), j = Math.floor((y - Y0) / RES); return i < 0 || j < 0 || i >= W || j >= H ? -1 : j * W + i; };
  // highest upward layer CAM_MIN..CAM_MAX below the camera with room to stand on it, or NaN
  const groundUnder = (c, z) => {
    const b = c * MAXL, n = hn[c]; let g = NaN;
    for (let k = 0; k < n; k++) {
      if (!hup[b + k]) continue;
      const h = z - hz[b + k]; if (h < CAM_MIN || h > CAM_MAX) continue;
      if ((k + 1 < n ? hz[b + k + 1] - hz[b + k] : Infinity) >= HEAD) g = hz[b + k];
    }
    return g;
  };
  const gref = new Float32Array(N).fill(NaN);
  let queue = [];
  for (const q of poses) {
    const c = cellOf(q[0], q[1]); if (c < 0) continue;
    const g = groundUnder(c, q[2]); if (Number.isNaN(g)) continue;
    q[5] = 1;
    if (Number.isNaN(gref[c])) { gref[c] = g; queue.push(c); }
  }
  const nb4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let qi = 0; qi < queue.length; qi++) {
    const c = queue[qi], i = c % W, j = (c / W) | 0;
    for (const [di, dj] of nb4) {
      const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const n = nj * W + ni; if (Number.isNaN(gref[n])) { gref[n] = gref[c]; queue.push(n); }
    }
  }
  queue = null;

  // 3. Pick the ground layer per cell (prefer layers not above the reference level) and its headroom.
  const floor = new Float32Array(N).fill(NaN), clear = new Float32Array(N).fill(NaN);
  for (let c = 0; c < N; c++) {
    const b = c * MAXL, n = hn[c]; let best = -1, bestCost = Infinity;
    for (let k = 0; k < n; k++) {
      if (!hup[b + k]) continue;
      const cl = k + 1 < n ? hz[b + k + 1] - hz[b + k] : Infinity;
      if (cl < 0.3) continue; // thin sandwich
      const d = hz[b + k] - gref[c];
      const cost = Number.isNaN(d) ? k : (d > 0 ? d * 2 : -d);
      if (cost < bestCost) { bestCost = cost; best = k; }
    }
    if (best >= 0) { floor[c] = hz[b + best]; clear[c] = best + 1 < n ? hz[b + best + 1] - hz[b + best] : Infinity; }
  }

  // 4. Walkable + connected to a walked pose (flood fill with the step limit) + distance field. Without walked poses:
  //    the largest connected walkable area.
  const walk = new Uint8Array(N);
  for (let c = 0; c < N; c++) if (!Number.isNaN(floor[c]) && clear[c] >= HEAD) walk[c] = 2;
  // splat estimates have small gaps (sparse ground, specks): close the walkable mask over `close` cells, taking the
  // median ground and the smallest headroom of the walkable neighbours
  if (close > 0) {
    const m = new Uint8Array(N); for (let c = 0; c < N; c++) m[c] = walk[c] ? 1 : 0;
    const pass = (src, grow) => { // square dilation (grow) or erosion over `close` cells, separable
      const t = new Uint8Array(N), o = new Uint8Array(N);
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { let v = grow ? 0 : 1; for (let d = -close; d <= close; d++) { const x = i + d; const s0 = x < 0 || x >= W ? (grow ? 0 : 1) : src[j * W + x]; v = grow ? v | s0 : v & s0; } t[j * W + i] = v; }
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { let v = grow ? 0 : 1; for (let d = -close; d <= close; d++) { const y = j + d; const s0 = y < 0 || y >= H ? (grow ? 0 : 1) : t[y * W + i]; v = grow ? v | s0 : v & s0; } o[j * W + i] = v; }
      return o;
    };
    const closed = pass(pass(m, true), false), g = [];
    for (let c = 0; c < N; c++) {
      if (!closed[c] || walk[c] || (closeObstacles === false && !Number.isNaN(floor[c]))) continue;
      const i = c % W, j = (c / W) | 0; g.length = 0; let cl = Infinity;
      for (let dj = -close; dj <= close; dj++) for (let di = -close; di <= close; di++) {
        const x = i + di, y = j + dj; if (x < 0 || y < 0 || x >= W || y >= H) continue; const n = y * W + x;
        if (walk[n] && m[n]) { g.push(floor[n]); cl = Math.min(cl, clear[n]); }
      }
      if (g.length < 3) continue;
      g.sort((u, v) => u - v); floor[c] = g[g.length >> 1]; clear[c] = cl; walk[c] = 2;
    }
  }
  const fill = (seeds, from, to) => {
    const q = []; for (const c of seeds) if (walk[c] === from) { walk[c] = to; q.push(c); }
    for (let qi = 0; qi < q.length; qi++) {
      const c = q[qi], i = c % W, j = (c / W) | 0;
      for (const [di, dj] of nb4) {
        const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        const n = nj * W + ni; if (walk[n] === from && Math.abs(floor[n] - floor[c]) <= STEP) { walk[n] = to; q.push(n); }
      }
    }
    return q.length;
  };
  const walkedCells = poses.filter((q) => q[5]).map((q) => cellOf(q[0], q[1]));
  if (!fill(walkedCells, 2, 1)) {
    // label every area with 3, remember the largest, then turn it into 1 and the rest back into 2
    let best = -1, bestN = 0;
    for (let c = 0; c < N; c++) if (walk[c] === 2) { const n = fill([c], 2, 3); if (n > bestN) { bestN = n; best = c; } }
    if (best >= 0) fill([best], 3, 1);
    for (let c = 0; c < N; c++) if (walk[c] === 3) walk[c] = 2;
  }
  // Exact Euclidean distance transform (Felzenszwalb) from edge cells: non-walkable, or a step > STEP to a neighbour.
  const INF = 1e20, f2 = new Float64Array(N);
  for (let c = 0; c < N; c++) {
    let edge = walk[c] !== 1;
    if (!edge) { const i = c % W, j = (c / W) | 0; for (const [di, dj] of nb4) { const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= W || nj >= H || walk[nj * W + ni] !== 1 || Math.abs(floor[nj * W + ni] - floor[c]) > STEP) { edge = true; break; } } }
    f2[c] = edge ? 0 : INF;
  }
  const edt1 = (f, n, stride, off0) => {
    const d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1), g = new Float64Array(n);
    for (let q = 0; q < n; q++) g[q] = f[off0 + q * stride];
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s;
      for (;;) { const p = v[k]; s = ((g[q] + q * q) - (g[p] + p * p)) / (2 * q - 2 * p); if (s <= z[k] && k > 0) k--; else break; }
      if (s <= z[k]) { v[0] = q; z[0] = -INF; z[1] = INF; k = 0; continue; }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const p = v[k]; d[q] = (q - p) * (q - p) + g[p]; }
    for (let q = 0; q < n; q++) f[off0 + q * stride] = d[q];
  };
  for (let i = 0; i < W; i++) edt1(f2, H, W, i);
  for (let j = 0; j < H; j++) edt1(f2, W, 1, j * W);
  const dist = new Float32Array(N);
  let nWalk = 0, nIsl = 0, maxD = 0;
  for (let c = 0; c < N; c++) {
    if (walk[c] === 1) { dist[c] = Math.sqrt(f2[c]) * RES; nWalk++; maxD = Math.max(maxD, dist[c]); } else if (walk[c] === 2) nIsl++;
  }
  const posesOut = poses.map(([x, y, z, , si, walked]) => {
    const c = cellOf(x, y), g = c >= 0 ? floor[c] : NaN;
    return [+x.toFixed(3), +y.toFixed(3), +z.toFixed(3), Number.isNaN(g) ? null : +g.toFixed(3), si, walked];
  });
  log('walkable + distance field');
  const grid = {
    version: 2, coord: 'z-up', units: 'm', res: RES, origin: [X0, Y0], width: W, height: H,
    params: { ...PARAMS }, source: L.source, splatLevel: L.level, collisionBBox: bb, triangles: L.triangles, splats: L.splats,
    stats: { walkableM2: +(nWalk * RES * RES).toFixed(1), isolatedM2: +(nIsl * RES * RES).toFixed(1), maxClearance: +maxD.toFixed(2), poses: posesOut.length, walkedPoses: walkedCells.length, poseSegments: segs.length },
  };
  return { grid, floor, clear, walk, dist, poses: posesOut };
}

/** Collision mesh file list and total size estimate (triangles) from a parsed .lcc2 meta. */
export function meshInfo(meta) {
  const files = meta.root?.meshFiles || [];
  let faces = 0;
  const walk = (n) => { if (!n) return; if (n.data?.mesh) faces += n.data.mesh.face || 0; for (const k in n.child || {}) walk(n.child[k]); };
  walk(meta.root);
  return { files, faces };
}
