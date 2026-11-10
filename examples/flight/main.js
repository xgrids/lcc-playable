// Flight tour: fly a little toon plane through rings placed over the capture route, a scenic lap of the scene.
// Shows: Flyer (keeps a safe height, pulls up before the scene), a chase camera without collision, rings
// spaced along geo.route, a scenic autopilot. Good base for drone tours, gliders, birds.
import * as THREE from 'three';
import { createPlayable, Flyer, safeCamera, sfx, clock } from 'lcc-playable';
import { shadow, toon, outline } from 'lcc-playable/kit';

const SCENE = '/scenes/your-scene/scene.lcc2'; // `npm run new` sets this; `?scene=<url>` overrides it
const RING_SPACING = 30;   // meters along the route
const RING_HEIGHT = 5;     // meters above the route (keep it low: splats get blurry far from the capture path)

const p = await createPlayable({
  scene: SCENE,
  title: 'Sky Tour',
  instructions: 'W / S or ↑ ↓: climb / dive    A / D or ← →: turn\nShift: boost    Fly through every ring.',
  env: true,
});
const geo = p.geo;
p.input.button('run', 'Boost');

const route = geo.route({ step: 2, smooth: 8 });
p.playArea = route.points.map((q) => [q[0], q[1]]);
const start = route.points[0], next = route.points[3];
const fly = new Flyer(p, { position: [start[0], start[1], start[2] + RING_HEIGHT], yaw: Math.atan2(next[1] - start[1], next[0] - start[0]) });
p.player = fly;

// ---------- rings along the route, at a height the plane can reach ----------
// Flying height along the route: high enough to clear everything within 20 m before and after (roofs, and trees
// where the collision mesh has them; foliage often has no collision, so stay a few meters above it).
const safe = route.points.map((q) => fly.safeHeight(q[0], q[1], 6));
const flyZ = route.points.map((q, i) => { let h = q[2] + RING_HEIGHT; for (let j = Math.max(0, i - 10); j <= Math.min(safe.length - 1, i + 10); j++) h = Math.max(h, safe[j] + 0.8); return h + (route.points[i][4] < 30 ? 3 : 0); });
const rings = [];
const ringMat = toon(0xff5ea8, { emissive: 0x401030 });
for (let s = RING_SPACING; s < route.length - 5; s += RING_SPACING) {
  let i = route.at.findIndex((a) => a >= s);
  // only where the sky is open above the flying height (not under trees or roofs); look a few meters further if not
  for (let j = i; j < Math.min(route.points.length, i + 8); j++) if (route.points[j][4] > flyZ[j] - route.points[j][2] + 3) { i = j; break; }
  const q = route.points[i], n = route.points[Math.min(route.points.length - 1, i + 2)];
  if (!(q[4] > flyZ[i] - q[2] + 3)) continue;
  const m = outline(new THREE.Mesh(new THREE.TorusGeometry(2.5, 0.2, 12, 40), ringMat));
  const yaw = Math.atan2(n[1] - q[1], n[0] - q[0]);
  // foliage often has no collision mesh: look down through the splats and lift the ring above any canopy
  let z = flyZ[i];
  const top = p.raycastSplats([q[0], q[1], z + 40], [0, 0, -1], 40 + z - q[2]);
  if (top && top.point[2] > z - 2) z = top.point[2] + 3;
  m.position.set(q[0], q[1], z); m.rotation.set(0, Math.PI / 2, yaw, 'ZYX');
  p.props.add(m); rings.push({ mesh: m, yaw, i, done: false });
}

// ---------- toon plane ----------
const plane = new THREE.Group();
const fuse = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.1, 6, 12), toon(0xffd23f)); fuse.rotation.z = Math.PI / 2; plane.add(fuse);
const wing = new THREE.Mesh(new THREE.BoxGeometry(0.45, 2.6, 0.06), toon(0x3fa9ff)); wing.position.set(0.1, 0, 0.05); plane.add(wing);
const tail = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.9, 0.05), toon(0x3fa9ff)); tail.position.set(-0.7, 0, 0.08); plane.add(tail);
const fin = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.4), toon(0xff5e5e)); fin.position.set(-0.72, 0, 0.28); plane.add(fin);
const prop = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.9, 0.08), toon(0x333333)); prop.position.x = 0.8; plane.add(prop);
outline(plane);
const model = new THREE.Group(); model.add(plane); p.scene.add(model);
shadow(p, model, { radius: 1.2, opacity: 0.35, fade: 12 }); // shows the height above the ground when flying low


const camPos = new THREE.Vector3(), look = new THREE.Vector3();
let got = 0, frame = 0, safeCam = null, splatDist = Infinity;

p.onStart(() => {
  for (const r of rings) r.lift = 0;
  fly.position.set(start[0], start[1], flyZ[0] + 2); fly.yaw = Math.atan2(next[1] - start[1], next[0] - start[0]); fly.speed = 10;
  for (const r of rings) r.done = false; got = 0;
  camPos.set(fly.position.x - Math.cos(fly.yaw) * 8, fly.position.y - Math.sin(fly.yaw) * 8, fly.position.z + 3);
});

p.onUpdate((dt) => {
  const playing = p.state === 'playing';
  if (playing) fly.update(dt);
  const P = fly.position;
  model.position.copy(P); model.rotation.set(fly.roll, -fly.pitch, fly.yaw, 'ZYX');
  prop.rotation.x += dt * 40;
  // chase camera: behind and above, smoothed, pulled in front of trees and walls between it and the plane
  const want = new THREE.Vector3(P.x - Math.cos(fly.yaw) * 6, P.y - Math.sin(fly.yaw) * 6, P.z + 2);
  camPos.lerp(want, 1 - Math.exp(-4 * dt));
  // collision rays every frame (cheap); splats: true also checks foliage without collision mesh, but a splat ray
  // costs 10-15 ms, so only 5 times a second
  const withSplats = frame++ % 12 === 0;
  safeCam = new THREE.Vector3(...safeCamera(p, [P.x, P.y, P.z], camPos.toArray(), { minDist: 2.5, lift: 1.5, splats: withSplats, tries: 1 }));
  if (withSplats) splatDist = safeCam.distanceTo(P);           // how far back the camera can be without foliage in between
  if (safeCam.distanceTo(P) > splatDist) safeCam.sub(P).setLength(Math.max(2.5, splatDist)).add(P);
  camPos.lerp(safeCam, 0.5);
  p.camera.position.copy(camPos);
  look.set(P.x + Math.cos(fly.yaw) * 4, P.y + Math.sin(fly.yaw) * 4, P.z); p.camera.lookAt(look);

  for (const r of rings) {
    r.mesh.visible = !r.done && r.mesh.position.distanceTo(P) < 120;
    if (playing && !r.done && r.mesh.position.distanceTo(P) < 2.8) { r.done = true; got++; p.score = got; sfx('coin'); }
  }
  const nextRing = rings.find((r) => !r.done);
  // detailed splats only load near the camera: re-check the canopy above the next ring as we approach
  if (nextRing && (nextRing.lift ?? 0) < 4 && nextRing.mesh.position.distanceTo(P) < 45 && frame % 20 === 0) {
    const m = nextRing.mesh.position, top = p.raycastSplats([m.x, m.y, m.z + 40], [0, 0, -1], 41);
    if (top && top.point[2] > m.z - 2.5) m.z = top.point[2] + 3;
    nextRing.lift = (nextRing.lift ?? 0) + 1;
  }
  p.info = { rings: got, total: rings.length, altitude: +fly.altitude.toFixed(1), speed: +fly.speed.toFixed(1), position: P.toArray().map((v) => +v.toFixed(1)) };
  p.ui.hud(`Rings ${got} / ${rings.length}   Time ${clock(p.playTime)}\nAltitude ${fly.altitude.toFixed(0)} m   Speed ${(fly.speed * 3.6).toFixed(0)} km/h`);
  if (playing && !nextRing) { p.win(`All ${rings.length} rings in ${clock(p.playTime)}.`); }
  if (playing && p.playTime > 300) p.lose(`${got} of ${rings.length} rings.`);
});

// Autopilot (?auto): follow the route a few points ahead at the planned height; the rings sit on that line.
let k = 0;
p.onStart(() => { k = 0; });
p.setAutopilot(() => {
  const P = fly.position;
  const ring = rings.find((r) => !r.done);
  const stop = ring ? ring.i : route.points.length - 1; // never run ahead of the next ring
  while (k < stop && Math.hypot(route.points[k][0] - P.x, route.points[k][1] - P.y) < 8) k++;
  // close to the next ring (along the route): aim straight at it
  const t = ring && ring.i - k < 6 ? [ring.mesh.position.x, ring.mesh.position.y] : route.points[k];
  const a = Math.atan2(t[1] - P.y, t[0] - P.x), dyaw = Math.atan2(Math.sin(a - fly.yaw), Math.cos(a - fly.yaw));
  p.input.setMove(Math.max(-1, Math.min(1, -dyaw * 2.5)), Math.max(-1, Math.min(1, ((ring && ring.i - k < 6 ? ring.mesh.position.z : flyZ[k]) - P.z) * 0.6)));
  p.input.setHeld('down', Math.abs(dyaw) > 0.4);
  p.input.setHeld('run', false);
});

p.run();
