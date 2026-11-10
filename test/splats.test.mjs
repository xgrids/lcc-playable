// Ground and walkability estimated from splats (scenes without a collision mesh), on synthetic splats:
// a 12 x 12 m floor of flat splats at z = 0 and a 2 x 2 m pillar of upright splats in the middle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splatLayers } from '../src/geometry/splats.js';
import { buildFromLayers } from '../src/geometry/prep.js';
import { SceneGeometry } from '../src/geometry/query.js';

function splats() {
  const pos = [], scale = [], quat = [], opacity = [];
  const add = (x, y, z, s, q) => { pos.push(x, y, z); scale.push(...s); quat.push(...q); opacity.push(0.9); };
  for (let x = 0; x <= 12; x += 0.1) for (let y = 0; y <= 12; y += 0.1) {
    if (x > 5 && x < 7 && y > 5 && y < 7) continue;
    add(x, y, (Math.sin(x * 7 + y * 3) * 0.01), [0.08, 0.08, 0.005], [1, 0, 0, 0]); // flat, normal +z
  }
  const up = [Math.SQRT1_2, Math.SQRT1_2, 0, 0]; // rotate the thin axis into the horizontal: an upright splat
  for (let z = 0.05; z < 2.5; z += 0.1) for (let t = 0; t <= 2; t += 0.1) for (const [x, y] of [[5 + t, 5], [5 + t, 7], [5, 5 + t], [7, 5 + t]]) add(x, y, z, [0.08, 0.005, 0.08], up);
  const n = opacity.length;
  return { count: n, pos: Float32Array.from(pos), scale: Float32Array.from(scale), quat: Float32Array.from(quat), opacity: Float32Array.from(opacity) };
}
const L = splatLayers([splats()]);
const geo = new SceneGeometry(buildFromLayers(L, null));

test('flat splats give walkable ground at their height', () => {
  assert.equal(geo.grid.source, 'splats');
  assert.ok(Math.abs(geo.groundAt(2, 2)) < 0.15, `ground ${geo.groundAt(2, 2)}`);
  assert.ok(geo.walkable(2, 2, 0.3));
  assert.ok(geo.walkable(10, 10, 0.3));
});
test('upright splats are an obstacle; paths go around it', () => {
  assert.ok(!geo.walkable(6, 6, 0), 'inside the pillar');
  assert.ok(!geo.walkable(5, 6, 0), 'on the pillar wall');
  const path = geo.findPath([3, 6], [9, 6], 0.3);
  assert.ok(path && path.every((q) => Math.abs(q[1] - 6) > 0.9 || q[0] < 4.6 || q[0] > 7.4), 'detours around the pillar');
});
test('collision rays and physics mesh from the grid', () => {
  const down = geo.raycast([2, 2, 3], [0, 0, -1], 10);
  assert.ok(down && Math.abs(down.point[2]) < 0.2 && down.normal[2] === 1, JSON.stringify(down));
  const side = geo.raycast([3, 6, 1], [1, 0, 0], 10);
  assert.ok(side && side.point[0] > 4.4 && side.point[0] < 5.4, JSON.stringify(side));
  assert.equal(geo.raycast([6, 6, 1], [0, 0, 1], 3), null, 'a ray inside a gap that never sees ground does not hit the gap');
  assert.equal(geo.raycast([3, 6, 4], [1, 0, 0], 10), null, 'passes above the 2.5 m wall blocks');
  const m = geo.toMesh(6, 6, 20);
  assert.ok(m.f.length > 100 && m.v.length % 3 === 0);
});
