// Walkable geometry and routes on a tiny synthetic scene: a 20 x 10 m floor with a 1 m step and a wall.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGeometry } from '../src/geometry/prep.js';
import { SceneGeometry } from '../src/geometry/query.js';

function box(v, f, [x0, y0, z0], [x1, y1, z1], { bottom = true } = {}) {
  const b = v.length / 3;
  for (const z of [z0, z1]) for (const y of [y0, y1]) for (const x of [x0, x1]) v.push(x, y, z);
  const q = (a, b2, c, d) => f.push(b + a, b + b2, b + c, b + a, b + c, b + d);
  if (bottom) q(0, 1, 3, 2);
  q(4, 6, 7, 5); q(0, 4, 5, 1); q(2, 3, 7, 6); q(0, 2, 6, 4); q(1, 5, 7, 3);
}
function meshes() {
  const v = [], f = [];
  // floor in three pieces around the wall's footprint (scans have no floor under walls)
  box(v, f, [0, 0, -0.2], [20, 6, 0]); box(v, f, [0, 6, -0.2], [6, 10, 0]); box(v, f, [6.4, 6, -0.2], [20, 10, 0]);
  box(v, f, [12, 0, 0], [20, 10, 1]);           // raised platform: 1 m step
  box(v, f, [6, 6, 0], [6.4, 10, 3], { bottom: false }); // wall, 3 m high
  return [{ v: Float32Array.from(v), f: Uint32Array.from(f) }];
}
function scene(posesJson) { return new SceneGeometry(buildGeometry(meshes(), posesJson)); }
const walkedPoses = []; for (let x = 0.5; x <= 11; x += 0.25) walkedPoses.push({ T: [x, 3, 1.5] });
const geo = scene({ poses: walkedPoses });

test('ground height and walkability', () => {
  assert.ok(Math.abs(geo.groundAt(3, 3)) < 0.05);
  assert.ok(geo.walkable(3, 3, 0.3));
  assert.ok(!geo.walkable(6.2, 8, 0)); // inside the wall
});
test('route follows the capture trajectory', () => {
  const r = geo.route({ step: 1 });
  assert.ok(r.length > 8 && r.length < 12, `length ${r.length}`);
  const s = r.sample(r.at[0] + 2);
  assert.ok(Math.abs(s.y - 3) < 0.6 && Math.abs(s.yaw) < 0.3, JSON.stringify(s));
  assert.ok(r.every(2).length >= 4);
});
test('route errors are clear', () => {
  assert.throws(() => geo.route({ seg: 7 }), /unknown segment 7/);
});
test('findPath goes around the wall', () => {
  const path = geo.findPath([4, 8], [8, 8], 0.25);
  assert.ok(path && path.length > 2);
  assert.ok(Math.min(...path.map((q) => q[1])) < 6.1, 'detours below the wall');
});
test('openest and regions', () => {
  assert.ok(geo.openest());
  assert.ok(geo.regions({ n: 2 }).length >= 1);
});

test('without a trajectory: ground, the largest area, and a route through open areas', () => {
  const g = scene(null);
  assert.ok(Math.abs(g.groundAt(3, 3)) < 0.05);
  assert.ok(g.walkable(3, 3, 0.3));
  assert.equal(g.stats.walkedPoses, 0);
  const r = g.route({ step: 1 });
  assert.equal(r.source, 'regions');
  assert.ok(r.points.length > 1 && r.points.every((q) => g.walkable(q[0], q[1])));
  assert.equal(g.coverage(r.points).trackCover, null);
});
test('poses far above the ground (chairlift, drone) are not walked', () => {
  // walk along y = 3 for 5 m, ride 8 m above the floor to the platform, walk on it
  const poses = [];
  for (let x = 0.5; x <= 5; x += 0.25) poses.push({ T: [x, 3, 1.5] });
  for (let x = 5.25; x < 14; x += 0.25) poses.push({ T: [x, 3, 8] });
  for (let x = 14; x <= 19.5; x += 0.25) poses.push({ T: [x, 3, 2.5] });
  const g = scene({ poses });
  assert.equal(g.stats.walkedPoses, g.poses.filter((p) => p[5]).length);
  assert.ok(g.poses.filter((p) => p[2] === 8).every((p) => p[5] === 0), 'ride poses are not walked');
  assert.ok(g.walkable(16, 5, 0), 'platform walked on: part of the main area');
  const runs = g.walkedRuns();
  assert.equal(runs.length, 2, 'the ride splits the trajectory');
  const r = g.route({ step: 1 });
  assert.equal(r.source, 'trajectory');
  assert.ok(Math.min(...r.points.map((q) => q[0])) > 13, 'route is the longest walked piece (on the platform)');
});
