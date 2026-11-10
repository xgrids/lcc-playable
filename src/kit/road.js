// Solid roads that follow the terrain: tracks, level paths, guide lines.
import * as THREE from 'three';

/**
 * Lay an opaque road along a centerline [[x, y], ...], slightly above the ground, following slopes and turning
 * steps into ramps. Edge lines and optional dashed lane lines sit on top. Where the route passes near itself
 * (switchbacks, crossings), the two parts merge into one surface without stray edge lines.
 * @param {import('../index.js').SceneGeometry} geo
 * @param {number[][]} centerline
 * @param {{width?: number | ((s: number, i: number) => number), lanes?: number | ((s: number) => number), lift?: number,
 *   maxSlope?: number, step?: number, closed?: boolean, color?: number, edgeColor?: number, laneColor?: number}} [opt]
 *   width: meters, or a function of distance along the road (narrow it where the scene is narrow).
 * @returns {{group: THREE.Group, length: number, closed: boolean,
 *   at: (s: number) => {x: number, y: number, z: number, tx: number, ty: number, width: number, shared: boolean},
 *   shared: (s: number) => boolean, sharedLen: number}}
 *   at(s): position, unit tangent and width s meters along the road. shared(s): this spot overlaps another part
 *   of the route; do not put obstacles there (players on the other part would hit them).
 */
export function makeRoad(geo, centerline, opt = {}) {
  const sd = { walkable: (x, y, r) => geo.walkable(x, y, r), floorAt: (x, y) => geo.groundAt(x, y), nearestWalkable: (x, y, r) => geo.nearestWalkable(x, y, r) };
  const { lift = 0.04, step = 0.25, color = 0x1f3a8a, edgeColor = 0x22e5ff, laneColor = 0xffffff } = opt;
  const widthF = typeof opt.width === 'function' ? opt.width : () => opt.width ?? 2.4;
  const lanesF = typeof opt.lanes === 'function' ? opt.lanes : () => opt.lanes ?? 1;
  // resample
  const src = centerline.map((p) => [p[0], p[1]]);
  const closed = opt.closed ?? (src.length > 2 && Math.hypot(src[0][0] - src.at(-1)[0], src[0][1] - src.at(-1)[1]) < 3);
  if (closed) src.push(src[0]);
  const P = [src[0]], S = [0];
  for (let i = 1; i < src.length; i++) {
    const [ax, ay] = src[i - 1], [bx, by] = src[i], d = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.round(d / step));
    for (let k = 1; k <= n; k++) { P.push([ax + (bx - ax) * k / n, ay + (by - ay) * k / n]); S.push(S.at(-1) + d / n); }
  }
  const N = P.length, length = S[N - 1];
  // tangents (central difference), widths (smoothed), ground heights (median filter + smoothing)
  const T = P.map((_, i) => {
    const a = P[closed ? (i - 2 + N - 1) % (N - 1) : Math.max(0, i - 2)], b = P[closed ? (i + 2) % (N - 1) : Math.min(N - 1, i + 2)];
    const tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1; return [tx / l, ty / l];
  });
  const smooth = (arr, k) => arr.map((_, i) => { let s = 0, n = 0; for (let j = i - k; j <= i + k; j++) { const q = closed ? (j + N - 1) % (N - 1) : Math.min(N - 1, Math.max(0, j)); if (Number.isFinite(arr[q])) { s += arr[q]; n++; } } return n ? s / n : 0; });
  const Wd = smooth(S.map((s, i) => widthF(s, i)), 6);
  // ground height: walkable cells only; side samples more than 0.3 m off the center are ignored (statues, railings)
  const zRaw = P.map(([x, y], i) => {
    const fc = sd.walkable(x, y) ? sd.floorAt(x, y) : sd.nearestWalkable(x, y, 0)?.[2];
    if (!Number.isFinite(fc)) return NaN;
    let m = fc;
    for (const o of [-0.35, 0.35]) { const ox = x - T[i][1] * o * Wd[i], oy = y + T[i][0] * o * Wd[i]; if (!sd.walkable(ox, oy)) continue; const f = sd.floorAt(ox, oy); if (Math.abs(f - fc) < 0.3) m = Math.max(m, f); }
    return m;
  });
  for (let i = 0; i < N; i++) if (!Number.isFinite(zRaw[i])) zRaw[i] = zRaw[i - 1] ?? zRaw.find(Number.isFinite) ?? 0;
  const med = zRaw.map((_, i) => { const w = []; for (let j = i - 3; j <= i + 3; j++) w.push(zRaw[closed ? (j + N - 1) % (N - 1) : Math.min(N - 1, Math.max(0, j))]); return w.sort((a, b) => a - b)[3]; });
  const Z = smooth(med, 4).map((z, i) => Math.max(z, med[i]) + lift); // never below the ground; steps become ramps
  const rise = (opt.maxSlope ?? 0.7) * step; // slope limit flattens jumps to another layer near walls
  for (let i = 1; i < N; i++) Z[i] = Math.min(Z[i], Z[i - 1] + rise);
  for (let i = N - 2; i >= 0; i--) Z[i] = Math.min(Z[i], Z[i + 1] + rise);
  // Self-overlap: is (x,y,z) on the road surface of *another* part of the route (> 2 m away along the route,
  // within that part's half width, < 0.6 m height difference)? Used to skip edges/lane lines there and for shared(s).
  const cell = 2, grid = new Map(), key = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  P.forEach(([x, y], i) => { const k = key(x, y); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); });
  const maxW = Math.max(...Wd), R = Math.ceil(maxW / 2 / cell) + 1;
  const arc = (a, b) => { const d = Math.abs(S[a] - S[b]); return closed ? Math.min(d, length - d) : d; };
  const onOther = (x, y, z, i, margin) => {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    for (let gx = cx - R; gx <= cx + R; gx++) for (let gy = cy - R; gy <= cy + R; gy++) {
      for (const j of grid.get(`${gx},${gy}`) || []) {
        if (arc(i, j) < Math.max(2, Wd[i] + Wd[j])) continue;
        if (Math.abs(Z[j] - z) < 0.6 && Math.hypot(P[j][0] - x, P[j][1] - y) < Wd[j] / 2 - margin) return true;
      }
    }
    return false;
  };
  const sideHidden = (sgn) => P.map(([x, y], i) => onOther(x - T[i][1] * sgn * Wd[i] / 2, y + T[i][0] * sgn * Wd[i] / 2, Z[i], i, 0.05));
  const hideL = sideHidden(-1), hideR = sideHidden(1);
  const sharedAt = P.map(([x, y], i) => hideL[i] || hideR[i] || onOther(x, y, Z[i], i, -Wd[i] / 2));
  for (let i = 0; i < N; i++) Z[i] += 0.008 * S[i] / (length || 1);
  const strip = (offA, offB, dz, hidden) => { // ribbon between two offsets; skip where hidden[i]
    const pos = [], idx = [];
    for (let i = 0; i < N; i++) {
      const [x, y] = P[i], nx = -T[i][1], ny = T[i][0], a = offA(i), b = offB(i);
      pos.push(x + nx * a, y + ny * a, Z[i] + dz, x + nx * b, y + ny * b, Z[i] + dz);
      if (i && !(hidden && (hidden[i] || hidden[i - 1]))) { const q = 2 * i; idx.push(q - 2, q - 1, q, q - 1, q + 1, q); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
  };
  const group = new THREE.Group(); group.name = 'road';
  const side = THREE.DoubleSide;
  // overlapping parts would z-fight: a 0-8 mm rise along the route keeps one on top
  group.add(new THREE.Mesh(strip((i) => -Wd[i] / 2, (i) => Wd[i] / 2, 0), new THREE.MeshStandardMaterial({ color, roughness: 0.7, side })));
  const edgeMat = new THREE.MeshBasicMaterial({ color: edgeColor, side }), ew = 0.12;
  group.add(new THREE.Mesh(strip((i) => -Wd[i] / 2, (i) => -Wd[i] / 2 + ew, 0.01, hideL), edgeMat));
  group.add(new THREE.Mesh(strip((i) => Wd[i] / 2 - ew, (i) => Wd[i] / 2, 0.01, hideR), edgeMat));
  // dashed lane lines
  const laneMat = new THREE.MeshBasicMaterial({ color: laneColor, side });
  const maxL = Math.max(...S.map((s) => lanesF(s)));
  for (let k = 1; k < maxL; k++) {
    const pos = [], idx = [];
    for (let i = 1; i < N; i++) {
      const L = lanesF(S[i]); if (k >= L || Math.floor(S[i] / 1.5) % 2) continue;
      const o0 = (j) => -Wd[j] / 2 + Wd[j] * k / L;
      if ([i - 1, i].some((j) => onOther(P[j][0] - T[j][1] * o0(j), P[j][1] + T[j][0] * o0(j), Z[j], j, 0.05))) continue;
      for (const j of [i - 1, i]) { const [x, y] = P[j], nx = -T[j][1], ny = T[j][0], o = o0(j); for (const d of [-0.04, 0.04]) pos.push(x + nx * (o + d), y + ny * (o + d), Z[j] + 0.015); }
      const q = pos.length / 3 - 4; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
    }
    if (pos.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); group.add(new THREE.Mesh(g, laneMat)); }
  }
  const at = (s) => {
    s = closed ? ((s % length) + length) % length : Math.min(length, Math.max(0, s));
    let lo = 0, hi = N - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
    const t = (s - S[lo]) / ((S[hi] - S[lo]) || 1), L = (a, b) => a + (b - a) * t;
    return { x: L(P[lo][0], P[hi][0]), y: L(P[lo][1], P[hi][1]), z: L(Z[lo], Z[hi]), tx: L(T[lo][0], T[hi][0]), ty: L(T[lo][1], T[hi][1]), width: L(Wd[lo], Wd[hi]), shared: sharedAt[lo] || sharedAt[hi] };
  };
  const sharedLen = S.reduce((a, _, i) => a + (i && sharedAt[i] ? S[i] - S[i - 1] : 0), 0);
  return { group, length, closed, at, shared: (s) => at(s).shared, sharedLen };
}

