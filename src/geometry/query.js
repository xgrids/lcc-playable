// Queries over the walkability grid produced by prep.js. Pure JS (browser and Node).
// Coordinates: scene-native Z-up, meters.

export class SceneGeometry {
  /** @param {{grid: object, floor: Float32Array, clear: Float32Array, walk: Uint8Array, dist: Float32Array, poses: number[][]}} d */
  constructor(d) {
    Object.assign(this, d);
    const g = d.grid;
    this.res = g.res; this.x0 = g.origin[0]; this.y0 = g.origin[1]; this.W = g.width; this.H = g.height;
    this.STEP = g.params.STEP;
    // poses where the scanner was carried over the ground (prep v1 files have no flag: all count as walked)
    this.walked = (d.poses || []).filter((p) => p[5] !== 0 && p[3] != null);
  }

  get stats() { return this.grid.stats; }
  /** Scene extent [xmin, ymin, xmax, ymax] covered by the grid. */
  get bounds() { return [this.x0, this.y0, this.x0 + this.W * this.res, this.y0 + this.H * this.res]; }
  /** Bounding box [xmin, ymin, xmax, ymax] of the walked capture trajectory, or of the walkable area without one. */
  get trackBounds() {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    const add = (x, y) => { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); };
    if (this.walked.length) for (const p of this.walked) add(p[0], p[1]);
    else for (let k = 0; k < this.walk.length; k++) if (this.walk[k] === 1) add(...this.center(k));
    return [a, b, c, d];
  }

  cell(x, y) {
    const i = Math.floor((x - this.x0) / this.res), j = Math.floor((y - this.y0) / this.res);
    return i < 0 || j < 0 || i >= this.W || j >= this.H ? -1 : j * this.W + i;
  }
  center(c) { return [this.x0 + ((c % this.W) + 0.5) * this.res, this.y0 + (((c / this.W) | 0) + 0.5) * this.res]; }

  /** Ground height at (x, y); NaN where there is no ground. */
  groundAt(x, y) { const c = this.cell(x, y); return c < 0 ? NaN : this.floor[c]; }
  /** Free height above the ground (m); Infinity under open sky. */
  headroomAt(x, y) { const c = this.cell(x, y); return c < 0 ? 0 : this.clear[c]; }
  /** Distance to the nearest obstacle or step edge (m); 0 where not walkable. */
  clearanceAt(x, y) { const c = this.cell(x, y); return c < 0 || this.walk[c] !== 1 ? 0 : this.dist[c]; }
  /** Walkable, in the main connected area (the one the capture walked through), and at least r meters from any edge. */
  walkable(x, y, r = 0) { const c = this.cell(x, y); return c >= 0 && this.walk[c] === 1 && this.dist[c] >= r; }
  /** Everything about one point. */
  at(x, y) { return { x, y, ground: this.groundAt(x, y), headroom: this.headroomAt(x, y), clearance: this.clearanceAt(x, y), walkable: this.walkable(x, y) }; }

  /**
   * Ray against the grid: the ground surface, and cells without ground (walls, bushes, the edge of the capture), which
   * count as solid up to `wall` m above the last ground the ray passed. Coarse (0.1 m steps); used for collision
   * rays in scenes without a collision mesh. Returns {point, normal, distance} or null.
   */
  raycast(origin, dir, maxDistance = 100, { wall = 2.5 } = {}) {
    const L = Math.hypot(dir[0], dir[1], dir[2]) || 1, d = [dir[0] / L, dir[1] / L, dir[2] / L], h = this.res / 2;
    // walls count only below `wall` m above ground the ray has seen (a ray starting over a gap in the estimate, or a
    // plane high above it, does not hit the gap)
    let ref = this.groundAt(origin[0], origin[1]);
    let prev = null;
    for (let t = 0; t <= maxDistance; t += h) {
      const x = origin[0] + d[0] * t, y = origin[1] + d[1] * t, z = origin[2] + d[2] * t, c = this.cell(x, y);
      if (c < 0) return null; // left the grid
      const f = this.floor[c];
      if (!Number.isNaN(f) && this.walk[c]) {
        if (z < f) return { point: [x, y, f], normal: [0, 0, 1], distance: t };
        const top = f + this.clear[c];
        if (Number.isFinite(top) && z > top && z < top + 0.5 && d[2] > 0) return { point: [x, y, top], normal: [0, 0, -1], distance: t };
        ref = f;
      } else if (z < ref + wall) { // false while ref is NaN
        const nx = prev ? prev[0] - x : -d[0], ny = prev ? prev[1] - y : -d[1], nl = Math.hypot(nx, ny) || 1;
        return { point: [x, y, z], normal: [nx / nl, ny / nl, 0], distance: t };
      }
      prev = [x, y];
    }
    return null;
  }

  /**
   * Triangle mesh of the grid around (cx, cy): ground quads every `step` cells, and `wall`-m blocks for cells without
   * ground next to ground. For physics in scenes without a collision mesh. {v: Float32Array, f: Uint32Array}
   */
  toMesh(cx, cy, radius = 45, { step = 2, wall = 2.5 } = {}) {
    const s = this.res * step, v = [], f = [], idx = new Map();
    const i0 = Math.max(0, Math.floor((cx - radius - this.x0) / s)), i1 = Math.min(Math.floor((this.W - 1) / step), Math.floor((cx + radius - this.x0) / s));
    const j0 = Math.max(0, Math.floor((cy - radius - this.y0) / s)), j1 = Math.min(Math.floor((this.H - 1) / step), Math.floor((cy + radius - this.y0) / s));
    const g = (i, j) => { const c = j * step * this.W + i * step; return this.walk[c] ? this.floor[c] : NaN; };
    const vert = (i, j) => { const k = j * 100000 + i; let n = idx.get(k); if (n === undefined) { n = v.length / 3; idx.set(k, n); v.push(this.x0 + (i * step + 0.5) * this.res, this.y0 + (j * step + 0.5) * this.res, g(i, j)); } return n; };
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
      const a = g(i, j), b = g(i + 1, j), c = g(i + 1, j + 1), e = g(i, j + 1);
      if ([a, b, c, e].some(Number.isNaN) || Math.max(a, b, c, e) - Math.min(a, b, c, e) > 0.5) continue;
      const A = vert(i, j), B = vert(i + 1, j), C = vert(i + 1, j + 1), E = vert(i, j + 1); f.push(A, B, C, A, C, E);
    }
    for (let j = j0 + 1; j < j1; j++) for (let i = i0 + 1; i < i1; i++) {
      if (!Number.isNaN(g(i, j))) continue;
      let lo = Infinity; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const z = g(i + di, j + dj); if (z < lo) lo = z; }
      if (!Number.isFinite(lo)) continue;
      const x0 = this.x0 + (i * step + 0.5) * this.res - s / 2, y0 = this.y0 + (j * step + 0.5) * this.res - s / 2, b = v.length / 3;
      for (const z of [lo - 0.5, lo + wall]) for (const y of [y0, y0 + s]) for (const x of [x0, x0 + s]) v.push(x, y, z);
      for (const q of [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]) f.push(b + q[0], b + q[1], b + q[2], b + q[0], b + q[2], b + q[3]);
    }
    return { v: Float32Array.from(v), f: Uint32Array.from(f) };
  }

  /** Nearest walkable point [x, y, z] with clearance >= r, or null. */
  nearestWalkable(x, y, r = 0) {
    const c0 = this.cell(x, y);
    if (c0 >= 0 && this.walk[c0] === 1 && this.dist[c0] >= r) return [x, y, this.floor[c0]];
    // expanding ring search, then full scan
    const ci = Math.floor((x - this.x0) / this.res), cj = Math.floor((y - this.y0) / this.res);
    for (let R = 1; R < 60; R++) {
      let best = -1, bd = Infinity;
      for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== R) continue;
        const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= this.W || j >= this.H) continue;
        const c = j * this.W + i; if (this.walk[c] !== 1 || this.dist[c] < r) continue;
        const d = di * di + dj * dj; if (d < bd) { bd = d; best = c; }
      }
      if (best >= 0) return [...this.center(best), this.floor[best]];
    }
    let best = -1, bd = Infinity;
    for (let c = 0; c < this.walk.length; c++) {
      if (this.walk[c] !== 1 || this.dist[c] < r) continue;
      const [cx, cy] = this.center(c), d = (cx - x) ** 2 + (cy - y) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    return best < 0 ? null : [...this.center(best), this.floor[best]];
  }

  /** The most open walkable point [x, y, z, clearance]. A good default spawn. */
  openest() {
    let best = -1;
    for (let c = 0; c < this.walk.length; c++) if (this.walk[c] === 1 && (best < 0 || this.dist[c] > this.dist[best])) best = c;
    if (best < 0) return null; // no walkable ground at all
    return [...this.center(best), this.floor[best], this.dist[best]];
  }

  /** Random walkable point [x, y, z] with clearance >= r. */
  randomPoint(r = 0, rng = Math.random) {
    for (let k = 0; k < 200000; k++) {
      const c = Math.floor(rng() * this.walk.length);
      if (this.walk[c] === 1 && this.dist[c] >= r) return [...this.center(c), this.floor[c]];
    }
    return null;
  }

  /**
   * A* over walkable cells (8-neighbour, step limit, prefers the middle of corridors).
   * @returns {number[][] | null} [[x, y, z], ...] from a to b, or null if unreachable.
   */
  findPath(a, b, r = 0) {
    const s = this.cell(a[0], a[1]), t = this.cell(b[0], b[1]), { W, H, STEP } = this;
    const ok = (c) => c >= 0 && this.walk[c] === 1 && this.dist[c] >= r;
    if (!ok(s) || !ok(t)) return null;
    const g = new Float32Array(W * H).fill(Infinity), from = new Int32Array(W * H).fill(-1), done = new Uint8Array(W * H);
    const heap = [[0, s]]; g[s] = 0;
    const push = (f, c) => { heap.push([f, c]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, rr = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (rr < heap.length && heap[rr][0] < heap[m][0]) m = rr; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const tx = t % W, ty = (t / W) | 0;
    const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
    while (heap.length) {
      const [, c] = pop();
      if (done[c]) continue; done[c] = 1;
      if (c === t) break;
      const i = c % W, j = (c / W) | 0;
      for (const [di, dj, w] of NB) {
        const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        const n = nj * W + ni; if (!ok(n) || Math.abs(this.floor[n] - this.floor[c]) > STEP) continue;
        const ng = g[c] + w * (1 + 1 / (0.3 + this.dist[n]));
        if (ng < g[n]) { g[n] = ng; from[n] = c; push(ng + 1.5 * Math.hypot(ni - tx, nj - ty), n); }
      }
    }
    if (from[t] < 0 && s !== t) return null;
    const out = [];
    for (let c = t; c >= 0; c = from[c]) { out.push([...this.center(c), this.floor[c]]); if (c === s) break; }
    return out.reverse();
  }

  /**
   * Walked pieces of the capture trajectory: walked poses in order, split where the scanner left the ground for
   * more than `gap` m (chairlift, vehicle, drone). Shorter gaps (a pose over a ledge) are bridged.
   * [{seg, points: [[x, y, groundZ], ...], length}]
   */
  walkedRuns({ gap = 8 } = {}) {
    const runs = []; let cur = null, prev = null;
    for (const p of this.walked) {
      const seg = p[4] ?? 0;
      if (cur && (cur.seg !== seg || Math.hypot(p[0] - prev[0], p[1] - prev[1]) > gap)) { if (cur.points.length > 1) runs.push(cur); cur = null; }
      if (!cur) cur = { seg, points: [], length: 0 }; else cur.length += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      cur.points.push([p[0], p[1], p[3]]);
      prev = p;
    }
    if (cur && cur.points.length > 1) runs.push(cur);
    return runs;
  }

  /**
   * Capture trajectory segments (fused maps have several), walked parts only:
   * [{seg, length, start, end, zStart, zEnd, zMin, zMax, longestRun}]. Empty when the scene has no walked trajectory.
   */
  segments() {
    const m = new Map();
    for (const r of this.walkedRuns()) { if (!m.has(r.seg)) m.set(r.seg, []); m.get(r.seg).push(r); }
    return [...m].map(([seg, rs]) => {
      const a = rs.flatMap((r) => r.points), z = (p) => p[2];
      return { seg, length: rs.reduce((s, r) => s + r.length, 0), start: a[0].slice(0, 2), end: a[a.length - 1].slice(0, 2), zStart: z(a[0]), zEnd: z(a[a.length - 1]),
        zMin: Math.min(...a.map(z)), zMax: Math.max(...a.map(z)), longestRun: Math.max(...rs.map((r) => r.length)) };
    });
  }

  /** A tour through the most open areas, joined by walkable paths: the route for scenes without a walked trajectory. */
  tour({ n = 8, r = 0.3 } = {}) {
    const left = this.regions({ n, minRadius: Math.max(1, r) }); if (!left.length) return [];
    const out = []; let cur = left.shift();
    out.push([cur.x, cur.y]);
    while (left.length) {
      left.sort((a, b) => Math.hypot(a.x - cur.x, a.y - cur.y) - Math.hypot(b.x - cur.x, b.y - cur.y));
      const nx = left.shift(), path = this.findPath([cur.x, cur.y], [nx.x, nx.y], r);
      if (!path) continue;
      for (const q of path.slice(1)) out.push([q[0], q[1]]);
      cur = nx;
    }
    return out;
  }

  /**
   * A walkable route through the scene. With a capture trajectory: the longest walked piece of it (the person
   * capturing the scene walked past every landmark, and splats are sharpest there; rides on chairlifts or vehicles
   * are left out). Without one: a tour through the most open areas (`source: 'regions'`).
   * @param {{from?: number, to?: number, step?: number, smooth?: number, r?: number, seg?: number}} [opt]
   *   from/to: meters along the route; seg: trajectory segment (default: the one with the longest walked piece).
   * @returns {{seg: number|null, source: 'trajectory'|'regions', length: number, closed: boolean, fullLength: number, at: number[], points: number[][]}}
   *   points: [x, y, z, clearance, headroom]; at[i]: meters along the route of points[i].
   */
  route({ from = 0, to = Infinity, step = 1, smooth = 3, r = 0.3, seg } = {}) {
    const runs = this.walkedRuns();
    let P, source = 'trajectory';
    if (!runs.length) {
      if (seg !== undefined) throw new Error(`route: unknown segment ${seg}; the scene has no walked capture trajectory`);
      P = this.tour({ r }); source = 'regions'; seg = null;
      if (P.length < 2) throw new Error('route: the scene has no capture trajectory and too little walkable ground for a tour');
    } else {
      if (seg !== undefined && !runs.some((g) => g.seg === seg)) throw new Error(`route: unknown segment ${seg}; the scene has segments ${[...new Set(runs.map((g) => g.seg))].join(', ')}`);
      const run = runs.filter((g) => seg === undefined || g.seg === seg).reduce((a, b) => (b.length > a.length ? b : a));
      seg = run.seg; P = run.points;
    }
    const raw = [P[0]]; let acc = 0;
    for (let i = 1; i < P.length; i++) {
      let [ax, ay] = raw[raw.length - 1]; const [bx, by] = P[i]; let d = Math.hypot(bx - ax, by - ay);
      while (acc + d >= step) { const t = (step - acc) / d; ax += (bx - ax) * t; ay += (by - ay) * t; raw.push([ax, ay]); d = Math.hypot(bx - ax, by - ay); acc = 0; }
      acc += d;
    }
    const snap = (q) => (this.walkable(q[0], q[1], r) ? q : this.nearestWalkable(q[0], q[1], r)?.slice(0, 2) ?? q);
    let pts = raw.map(snap);
    const k = Math.max(0, Math.round(smooth / step));
    if (k) pts = pts.map((_, i) => { let x = 0, y = 0, n = 0; for (let j = Math.max(0, i - k); j <= Math.min(pts.length - 1, i + k); j++) { x += pts[j][0]; y += pts[j][1]; n++; } return snap([x / n, y / n]); });
    const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const full = cum[cum.length - 1], keep = cum.map((_, i) => i).filter((i) => cum[i] >= from && cum[i] <= to);
    const at = keep.map((i) => cum[i]); pts = keep.map((i) => pts[i]);
    const length = at.length ? at[at.length - 1] - at[0] : 0;
    const a = pts[0], b = pts[pts.length - 1];
    const points = pts.map(([x, y]) => [x, y, this.groundAt(x, y), this.clearanceAt(x, y), this.headroomAt(x, y)]);
    return makeRoute({ seg, source, length, closed: Math.hypot(a[0] - b[0], a[1] - b[1]) < 3, fullLength: full, at, points });
  }

  /** The n most open areas: [{x, y, z, radius}], at least minRadius wide, non-overlapping. Good for arenas and plazas. */
  regions({ n = 8, minRadius = 1.5 } = {}) {
    const cand = [];
    for (let c = 0; c < this.walk.length; c++) if (this.walk[c] === 1 && this.dist[c] >= Math.max(minRadius, 0.5)) cand.push(c);
    cand.sort((a, b) => this.dist[b] - this.dist[a]);
    const picked = [];
    for (const c of cand) {
      const [x, y] = this.center(c), d = this.dist[c];
      if (picked.every((p) => Math.hypot(p.x - x, p.y - y) >= Math.max(p.radius, d) * 2)) picked.push({ x, y, z: this.floor[c], radius: d });
      if (picked.length >= n) break;
    }
    return picked;
  }

  /**
   * How much of the scene a game uses. playArea: a path or points [[x, y], ...] the player can reach.
   * span: game extent / trajectory extent (diagonals); areaCover: share of walkable area within `reach` m;
   * trackCover: share of trajectory points within `reach` m (roughly: share of landmarks the player sees up close).
   * Fused maps also get segCover/segSpan for the best-covered segment.
   */
  coverage(playArea, reach = 6) {
    const pts = (playArea || []).map((p) => [+p[0], +p[1]]).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (!pts.length) return { error: 'playArea is empty: set p.playArea = [[x, y], ...] (track centerline, level path, spawn points)' };
    let length = 0; const dense = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i], d = Math.hypot(bx - ax, by - ay); length += d;
      if (d < 20) for (let s = 1; s <= Math.ceil(d); s++) dense.push([ax + (bx - ax) * s / Math.ceil(d), ay + (by - ay) * s / Math.ceil(d)]);
      else dense.push(pts[i]);
    }
    const near = new Uint8Array(this.walk.length), R = Math.ceil(reach / this.res);
    for (const [x, y] of dense) {
      const c = this.cell(x, y); if (c < 0) continue; const ci = c % this.W, cj = (c / this.W) | 0;
      for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
        if (di * di + dj * dj > R * R) continue; const i = ci + di, j = cj + dj;
        if (i >= 0 && j >= 0 && i < this.W && j < this.H) near[j * this.W + i] = 1;
      }
    }
    let wa = 0, wn = 0; for (let c = 0; c < this.walk.length; c++) if (this.walk[c] === 1) { wa++; wn += near[c]; }
    const isNear = (p) => { const c = this.cell(p[0], p[1]); return c >= 0 && near[c]; };
    const diag = (a) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const p of a) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); } return Math.hypot(x1 - x0, y1 - y0); };
    const f = (v) => Math.round(v * 100) / 100;
    const W = this.walked;
    if (!W.length) return { span: f(diag(pts) / diag([[this.trackBounds[0], this.trackBounds[1]], [this.trackBounds[2], this.trackBounds[3]]])), areaCover: f(wn / wa), trackCover: null, length: f(length), reach };
    const tn = W.filter(isNear).length;
    const bySeg = new Map(); for (const p of W) { const k = p[4] ?? 0; const o = bySeg.get(k) || [0, 0]; o[0]++; o[1] += isNear(p) ? 1 : 0; bySeg.set(k, o); }
    let best = null; for (const [k, [n, m]] of bySeg) if (!best || m / n > best[1]) best = [k, m / n];
    const segs = bySeg.size;
    const segPoses = segs > 1 ? W.filter((p) => (p[4] ?? 0) === best[0]) : W;
    return { span: f(diag(pts) / diag(W)), areaCover: f(wn / wa), trackCover: f(tn / W.length), length: f(length), reach,
      ...(segs > 1 ? { segments: segs, bestSeg: best[0], segCover: f(best[1]), segSpan: f(diag(pts) / diag(segPoses)) } : {}) };
  }
}

/**
 * Route helpers (added to every geo.route() result):
 *   route.sample(s)          point s meters along the route (same units as route.at), interpolated:
 *                            {x, y, z, yaw, clearance, headroom, i}; s is clamped to the route
 *   route.every(spacing, {start, end})   samples every `spacing` meters, e.g. coins or checkpoints
 */
function makeRoute(rt) {
  const { at, points } = rt;
  rt.sample = (s) => {
    const n = at.length; if (!n) return null;
    s = Math.min(at[n - 1], Math.max(at[0], s));
    let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (at[m] <= s) lo = m; else hi = m; }
    const a = points[lo], b = points[Math.min(hi, n - 1)], t = at[hi] > at[lo] ? (s - at[lo]) / (at[hi] - at[lo]) : 0;
    const L = (k) => a[k] + (b[k] - a[k]) * t;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    return { x: L(0), y: L(1), z: L(2), yaw: dx || dy ? Math.atan2(dy, dx) : 0, clearance: Math.min(a[3], b[3]), headroom: Math.min(a[4], b[4]), i: lo, s };
  };
  rt.every = (spacing, { start = at[0] + spacing / 2, end = at[at.length - 1] } = {}) => {
    const out = []; if (!(spacing > 0)) return out;
    for (let s = start; s <= end + 1e-6; s += spacing) out.push(rt.sample(s));
    return out;
  };
  return rt;
}
