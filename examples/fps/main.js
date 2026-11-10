// First-person shooter with a cartoon blaster: clear waves of robots in the open areas of the scene.
// Shows: FirstPersonCamera + Walker (faceMove off), a toon-shaded weapon attached to the camera, hitscan with
// p.raycast (scene) + distance checks (robots), Rapier crates you can knock over, robot NPCs that chase the player
// with Navigator (straight line when clear, A* around obstacles).
import * as THREE from 'three';
import { createPlayable, createPhysics, Walker, Navigator, FirstPersonCamera, sfx, rng, clock } from 'lcc-playable';
import { loadCharacter, shadow, toon, outline } from 'lcc-playable/kit';

const SCENE = '/scenes/your-scene/scene.lcc2'; // `npm run new` sets this; `?scene=<url>` overrides it
const WAVES = 5, PER_WAVE = 4, HP = 100;

const p = await createPlayable({
  scene: SCENE,
  title: 'Splat Blaster',
  instructions: 'Click to aim with the mouse. WASD to move, Space to jump.\nLeft click / Enter: shoot. Clear 5 waves of robots.',
});
const geo = p.geo;
p.input.button('fire', 'Fire'); p.input.button('jump', 'Jump');
p.ui.crosshair(true);

// Arena: the most open area; spawn points for robots around the walkable area near it.
const arena = geo.regions({ n: 1, minRadius: 2 })[0];
const R = rng(3);
const spawnPoints = [];
for (let k = 0; spawnPoints.length < 12 && k < 4000; k++) {
  const a = R() * Math.PI * 2, d = 8 + R() * 14;
  const x = arena.x + Math.cos(a) * d, y = arena.y + Math.sin(a) * d;
  if (geo.walkable(x, y, 0.5) && geo.findPath([arena.x, arena.y], [x, y], 0.3)) spawnPoints.push([x, y, geo.groundAt(x, y)]);
}
p.playArea = [[arena.x, arena.y], ...spawnPoints.map((q) => [q[0], q[1]])];

// ---------- player ----------
const walker = new Walker(p, { position: [arena.x, arena.y, arena.z], faceMove: false, speed: 4.5, runSpeed: 7 });
const fp = new FirstPersonCamera(p, { height: 1.6 });
p.camera.fov = 75; p.camera.updateProjectionMatrix();

// ---------- cartoon blaster, attached to the camera ----------
const gun = new THREE.Group();
const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.09, 0.11), toon(0x3fb6ff, { outline: 0.01 })); gun.add(body);
const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.15, 0.07), toon(0xff8a3d, { outline: 0.01 })); grip.position.set(-0.09, -0.09, 0); grip.rotation.z = 0.3; gun.add(grip);
const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.16, 16), toon(0xffd93d, { outline: 0.01 })); barrel.rotation.z = Math.PI / 2; barrel.position.x = 0.24; gun.add(barrel);
const tank = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), toon(0x7cff6b, { emissive: 0x1a5a10, outline: 0.01 })); tank.position.set(-0.02, 0.07, 0); gun.add(tank);
outline(gun);
const flash = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff4a0 })); flash.position.x = 0.34; flash.visible = false; gun.add(flash);
// p.viewmodel is drawn on top of everything in camera space: -Z forward, +X right, +Y up. The gun's +X points forward.
gun.rotation.set(0, Math.PI / 2 + 0.08, 0); gun.position.set(0.2, -0.19, -0.55); gun.scale.setScalar(0.85);
p.viewmodel.add(gun);

// ---------- physics crates in the arena ----------
const phys = await createPhysics(p);
const crateMat = toon(0xc98a4b);
const crates = [];
for (let i = 0; i < 6; i++) {
  const a = (i / 6) * Math.PI * 2, x = arena.x + Math.cos(a) * 2.5, y = arena.y + Math.sin(a) * 2.5;
  if (!geo.walkable(x, y, 0.3)) continue;
  const m = outline(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), crateMat));
  p.props.add(m); phys.add(m, { mass: 4, position: [x, y, geo.groundAt(x, y) + 0.3 + (i % 2) * 0.7] }); crates.push(m);
}

// ---------- robots ----------
const robots = [];
let spawning = false;
async function spawnWave(n) {
  spawning = true;
  for (let i = 0; i < n; i++) {
    const ch = await loadCharacter('robot', { height: 1.4, tint: [0xff5555, 0x55ff88, 0xffcc33][i % 3] });
    const q = spawnPoints[(i * 5 + wave * 3) % spawnPoints.length];
    const w = new Walker(p, { character: ch, position: q, speed: 1.8 + wave * 0.4 });
    robots.push({ ch, w, nav: new Navigator(p, w, { repath: 2 }), sh: shadow(p, ch.root, { radius: 0.5 }), hp: 3, cool: 0, dead: 0 });
  }
  spawning = false;
}
const say = (t) => p.ui.toast(t, 1500);
let hp = HP, wave = 0, kills = 0, fireCool = 0;
p.player = walker;

p.onStart(async () => {
  spawning = true;
  for (const r of robots) { r.ch.dispose(); r.sh.dispose(); }
  robots.length = 0; hp = HP; wave = 1; kills = 0;
  walker.teleport(arena.x, arena.y, 0); fp.yaw = 0; fp.pitch = 0;
  await spawnWave(PER_WAVE); say('Wave 1');
});

function shoot() {
  fireCool = 0.22; sfx('shoot'); flash.visible = true; setTimeout(() => (flash.visible = false), 50);
  const o = p.camera.position, d = fp.forward;
  const wall = p.raycast([o.x, o.y, o.z], d, 80);
  const maxD = wall ? wall.distance : 80;
  // nearest robot whose body (capsule ~0.4 m) the ray passes through, before the wall
  let best = null, bestT = maxD;
  for (const r of robots) {
    if (r.dead) continue;
    const c = r.w.position.clone().add(new THREE.Vector3(0, 0, 0.75)), v = c.clone().sub(o);
    const t = v.x * d[0] + v.y * d[1] + v.z * d[2]; if (t < 0 || t > bestT) continue;
    const miss = Math.hypot(v.x - d[0] * t, v.y - d[1] * t, v.z - d[2] * t);
    if (miss < 0.45) { best = r; bestT = t; }
  }
  if (best) {
    best.hp--; best.ch.play('hit', { once: true, fade: 0.05 }); sfx('pop');
    if (best.hp <= 0) { best.dead = 1.5; best.ch.play('death', { once: true }); kills++; p.score = kills; }
    return;
  }
  const h = phys.raycast([o.x, o.y, o.z], d, maxD + 0.5);
  if (h?.body) phys.impulse(h.body, [d[0] * 12, d[1] * 12, d[2] * 12 + 3], h.point);
}

p.onUpdate((dt) => {
  const playing = p.state === 'playing';
  fp.update(dt, walker.position);
  if (playing) walker.update(dt, { yaw: fp.yaw });
  phys.focus = walker.position;
  fireCool -= dt;
  gun.position.y = -0.19 + Math.sin(p.time * 8) * (walker.moving ? 0.008 : 0.002);
  gun.rotation.z = fireCool > 0.12 ? 0.15 : 0;
  if (playing && fireCool <= 0 && p.input.held('fire')) shoot();

  for (const r of robots) {
    if (r.dead) { r.dead -= dt; if (r.dead <= 0) { r.ch.dispose(); r.sh.dispose(); r.gone = true; } continue; }
    const P = r.w.position, toPlayer = Math.hypot(walker.position.x - P.x, walker.position.y - P.y);
    if (playing && toPlayer > 1.3) { r.nav.goTo(walker.position.x, walker.position.y, 0, { apply: false, dt }); r.w.update(dt, { yaw: 0, move: r.nav.move, jump: false, run: false }); }
    else { r.w.update(dt, { move: { x: 0, y: 0 }, jump: false, run: false }); r.w.heading = Math.atan2(walker.position.y - P.y, walker.position.x - P.x); }
    r.cool -= dt;
    if (playing && toPlayer < 1.5 && r.cool <= 0) { r.cool = 1.2; hp -= 10; r.ch.play('punch', { once: true }); sfx('hit'); }
  }
  for (let i = robots.length - 1; i >= 0; i--) if (robots[i].gone) robots.splice(i, 1);

  p.info = { wave, kills, hp, robots: robots.filter((r) => !r.dead).length, position: walker.position.toArray().map((v) => +v.toFixed(2)) };
  p.ui.hud(`Wave ${wave}/${WAVES}   Robots ${p.info.robots}\nHP ${Math.max(0, hp)}   Time ${clock(p.playTime)}`);
  if (!playing) return;
  if (hp <= 0) { p.lose(`Wave ${wave}, ${kills} robots.`); return; }
  if (!robots.length && wave > 0 && !spawning) {
    if (wave >= WAVES) { p.win(`${kills} robots in ${clock(p.playTime)}.`); }
    else { wave++; say(`Wave ${wave}`); spawnWave(PER_WAVE + wave - 1); }
  }
});

// Autopilot (?auto): turn toward the nearest robot in view, shoot when it is in the crosshair, back off if close.
p.setAutopilot((dt) => {
  const alive = robots.filter((r) => !r.dead);
  const o = walker.position;
  const t = alive.sort((a, b) => a.w.position.distanceTo(o) - b.w.position.distanceTo(o))[0];
  if (!t) { p.input.setMove(0, 0); return; }
  const tp = t.w.position, dx = tp.x - o.x, dy = tp.y - o.y, dist = Math.hypot(dx, dy);
  const wantYaw = Math.atan2(dy, dx), wantPitch = Math.atan2(tp.z + 0.75 - (o.z + 1.6), dist);
  let dyaw = Math.atan2(Math.sin(wantYaw - fp.yaw), Math.cos(wantYaw - fp.yaw));
  fp.yaw += Math.max(-4 * dt, Math.min(4 * dt, dyaw)); fp.pitch += (wantPitch - fp.pitch) * Math.min(1, dt * 6);
  const eye = [o.x, o.y, o.z + 1.6], los = p.raycast(eye, [dx, dy, tp.z + 0.75 - eye[2]], dist);
  p.input.setHeld('fire', Math.abs(dyaw) < 0.06 && !los);
  p.input.setMove(0, dist < 3 ? -1 : los ? 1 : 0);
});

p.run();
