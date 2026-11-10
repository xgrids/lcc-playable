// Parkour runner: run along a solid road that follows the capture route through the whole scene.
// Change lanes, jump over low walls, slide under bars, collect coins. Three hits and you are out.
// Shows: makeRoad (lanes that narrow with the scene, shared overlaps), obstacles placed with road.at(s),
// props shown only near the player, FollowCamera, an autopilot that really dodges by pressing the same keys a player
// would (p.input.tap), so `npm run check --auto` tests the real controls.
import * as THREE from 'three';
import { createPlayable, FollowCamera, sfx, rng } from 'lcc-playable';
import { loadCharacter, makeRoad, shadow, toon, outline } from 'lcc-playable/kit';

const SCENE = '/scenes/your-scene/scene.lcc2'; // `npm run new` sets this; `?scene=<url>` overrides it
const SPEED = 7.5;            // m/s
const LANE_W = 1.1;           // meters per lane
const LIVES = 3;

const p = await createPlayable({
  scene: SCENE,
  title: 'Splat Dash',
  instructions: 'A / D or ← → (swipe on phones): change lane\nSpace / ↑: jump    S / ↓: slide\nDodge walls and bars, grab the coins.',
});
const geo = p.geo;
p.input.button('jump', 'Jump'); p.input.bind('slide', ['KeyS', 'ArrowDown'], { label: 'Slide' });

// ---------- track: the capture route, as wide as the scene allows (1 to 3 lanes) ----------
const route = geo.route({ step: 1, smooth: 4 });
const lanesAt = (s) => {
  const i = Math.min(route.at.length - 1, Math.max(0, route.at.findIndex((a) => a >= s)));
  return Math.max(1, Math.min(3, Math.floor((route.points[i][3] * 2 + 0.4) / LANE_W)));
};
const road = makeRoad(geo, route.points, { width: (s) => lanesAt(s) * LANE_W, lanes: lanesAt });
p.scene.add(road.group);
p.playArea = route.points.map((q) => [q[0], q[1]]);
const laneOffset = (s, lane) => { const L = Math.round(road.at(s).width / LANE_W); const l = Math.max(0, Math.min(L - 1, lane)); return (l - (L - 1) / 2) * LANE_W; };
const place = (s, off) => { const a = road.at(s); return { x: a.x - a.ty * off, y: a.y + a.tx * off, z: a.z, yaw: Math.atan2(a.ty, a.tx), a }; };

// ---------- obstacles and coins ----------
const R = rng(7);
const wallMat = toon(0xe8573b), barMat = toon(0x3b8ee8), coinMat = toon(0xffc83d, { emissive: 0x553300 });
const obstacles = [], coins = [];
for (let s = 25; s < road.length - 15; s += 14 + R() * 10) {
  if (road.shared(s)) continue; // overlapping parts of the route: players on the other part would hit it too
  const L = Math.round(road.at(s).width / LANE_W);
  // only where the lane count is the same for the 12 m before: lanes that appear or merge right at an obstacle
  // move the player sideways while they try to dodge
  if ([2, 4, 6, 8, 10, 12].some((d) => Math.round(road.at(s - d).width / LANE_W) !== L)) continue;
  const kind = R() < 0.5 ? 'wall' : 'bar';
  // block all lanes but one (or all lanes for single-lane parts: then it must be jumped / slid)
  const free = L > 1 ? Math.floor(R() * L) : -1;
  for (let lane = 0; lane < L; lane++) {
    if (lane === free) continue;
    const q = place(s, laneOffset(s, lane));
    const m = kind === 'wall'
      ? new THREE.Mesh(new THREE.BoxGeometry(0.35, LANE_W * 0.9, 0.55), wallMat)
      : new THREE.Mesh(new THREE.BoxGeometry(0.15, LANE_W * 0.95, 0.15), barMat);
    m.position.set(q.x, q.y, q.z + (kind === 'wall' ? 0.275 : 1.15)); m.rotation.z = q.yaw;
    if (kind === 'bar') for (const sd of [-1, 1]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.2), barMat); post.rotation.x = Math.PI / 2; post.position.set(0, sd * LANE_W * 0.45, -0.58); m.add(post); }
    outline(m); p.props.add(m);
    obstacles.push({ mesh: m, s, lane, kind });
  }
}
for (let s = 15; s < road.length - 5; s += 4) {
  if (obstacles.some((o) => Math.abs(o.s - s) < 3)) continue;
  const lane = Math.floor(s / 40) % Math.round(road.at(s).width / LANE_W);
  const q = place(s, laneOffset(s, lane));
  const m = outline(new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.08, 10, 24), coinMat));
  m.position.set(q.x, q.y, q.z + 0.9); m.rotation.set(Math.PI / 2, 0, q.yaw + Math.PI / 2);
  p.props.add(m); coins.push({ mesh: m, s, lane });
}

// ---------- runner ----------
const hero = await loadCharacter('human');
p.scene.add(hero.root);
const cam = new FollowCamera(p, { distance: 4.2, height: 2.0, orbit: false });
const run = { s: 0, lane: 0, off: 0, z: 0, vz: 0, slide: 0, hits: 0, coins: 0, inv: 0 };
shadow(p, hero.root, { ground: () => road.at(run.s).z + 0.02 }); // on the road surface, which is above the scene ground
p.player = { position: hero.root.position };

p.onStart(() => {
  Object.assign(run, { s: 2, lane: Math.floor(Math.round(road.at(2).width / LANE_W) / 2), off: 0, z: 0, vz: 0, slide: 0, hits: 0, coins: 0, inv: 0 });
  for (const c of coins) c.taken = false;
  for (const o of obstacles) o.hit = false;
  cam.reset();
});

// swipe on touch screens
let touch0 = null;
addEventListener('touchstart', (e) => { touch0 = [e.touches[0].clientX, e.touches[0].clientY]; });
addEventListener('touchend', (e) => {
  if (!touch0) return; const t = e.changedTouches[0], dx = t.clientX - touch0[0], dy = t.clientY - touch0[1]; touch0 = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 40) return;
  if (Math.abs(dx) > Math.abs(dy)) run.lane += dx > 0 ? 1 : -1; else if (dy < 0) jump(); else run.slide = 0.8;
});
const jump = () => { if (run.z <= 0.01) { run.vz = 5.2; sfx('jump'); } };

p.onUpdate((dt) => {
  const playing = p.state === 'playing';
  if (playing) {
    if (p.input.pressed('left')) run.lane--;
    if (p.input.pressed('right')) run.lane++;
    if (p.input.pressed('jump') || p.input.pressed('up')) jump();
    if (p.input.pressed('slide') && run.z <= 0.01) run.slide = 0.8;
    run.s += SPEED * dt;
  }
  const L = Math.round(road.at(run.s).width / LANE_W);
  run.lane = Math.max(0, Math.min(L - 1, run.lane));
  run.off += (laneOffset(run.s, run.lane) - run.off) * Math.min(1, dt * 10);
  run.vz -= 16 * dt; run.z = Math.max(0, run.z + run.vz * dt); if (run.z === 0) run.vz = Math.max(0, run.vz);
  run.slide = Math.max(0, run.slide - dt); run.inv = Math.max(0, run.inv - dt);
  const q = place(run.s, run.off);
  hero.root.position.set(q.x, q.y, q.z + run.z); hero.root.rotation.z = q.yaw;
  hero.play(!playing ? 'idle' : run.z > 0.05 ? 'jumpAir' : run.slide > 0 ? 'slide' : 'run');
  cam.update(dt, hero.root.position, q.yaw);

  // collisions and pickups (by distance along the road and lane offset)
  for (const o of obstacles) {
    o.mesh.visible = Math.abs(o.s - run.s) < 40 && o.s > run.s - 3;
    if (!playing || o.hit || run.inv > 0 || Math.abs(o.s - run.s) > 0.4 || Math.abs(laneOffset(o.s, o.lane) - run.off) > LANE_W * 0.6) continue;
    const cleared = o.kind === 'wall' ? run.z > 0.5 : run.slide > 0;
    if (!cleared) { o.hit = true; run.hits++; run.inv = 1; sfx('hit'); p.ui.toast(run.hits >= LIVES ? 'Out!' : 'Ouch!'); }
  }
  for (const c of coins) {
    c.mesh.visible = !c.taken && Math.abs(c.s - run.s) < 40 && c.s > run.s - 2;
    c.mesh.rotation.z += dt * 3;
    if (playing && !c.taken && Math.abs(c.s - run.s) < 0.6 && Math.abs(laneOffset(c.s, c.lane) - run.off) < 0.6 && run.z < 1) { c.taken = true; run.coins++; sfx('coin'); }
  }
  p.score = run.coins * 10 + Math.floor(run.s);
  p.info = { s: +run.s.toFixed(1), length: Math.round(road.length), lane: run.lane, hits: run.hits, coins: run.coins };
  p.ui.hud(`Score ${p.score}   Coins ${run.coins}   ${'♥'.repeat(Math.max(0, LIVES - run.hits))}\n${Math.floor(run.s)} / ${Math.round(road.length)} m`);
  if (playing && run.hits >= LIVES) { p.lose(`You ran ${Math.floor(run.s)} m.`); }
  if (playing && run.s >= road.length - 3) { p.win(`Finished ${Math.round(road.length)} m with ${run.coins} coins.`); }
});

// Autopilot (?auto): look at the next obstacle group and steer to the free lane, or jump / slide, with key taps.
p.setAutopilot(() => {
  const ahead = obstacles.filter((o) => o.s > run.s - 0.2 && o.s < run.s + 9);
  if (!ahead.length) return;
  const s0 = ahead[0].s, group = ahead.filter((o) => Math.abs(o.s - s0) < 0.5);
  const L = Math.round(road.at(s0).width / LANE_W);
  const blocked = new Set(group.map((o) => o.lane));
  const free = [...Array(L).keys()].filter((l) => !blocked.has(l)).sort((a, b) => Math.abs(a - run.lane) - Math.abs(b - run.lane))[0];
  if (free !== undefined && s0 - run.s < 8) { if (free !== run.lane) p.input.tap(free < run.lane ? 'left' : 'right'); return; }
  const d = s0 - run.s;
  if (group[0].kind === 'wall' && d < 2.2 && d > 0.6) p.input.tap('jump');
  if (group[0].kind === 'bar' && d < 1.5 && run.z <= 0.01 && run.slide <= 0) p.input.tap('slide');
});

p.run();
