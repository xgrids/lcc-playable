// Movement controllers driven by p.input, grounded on the scene geometry.
import * as THREE from 'three';

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Walk/run/jump on the real ground of the scene. Movement is blocked where the scene is not walkable
 * (walls, water, outside the captured area), with sliding along edges. Heights come from p.geo.groundAt.
 *
 *   const walker = new Walker(p, { character: hero, position: p.spawn() });
 *   p.onUpdate((dt) => { walker.update(dt, { yaw: cam.yaw }); cam.update(dt, walker.position, walker.heading); });
 *
 * update(dt, { yaw, move, jump, run }): yaw = the direction "forward" means (camera yaw); move/jump/run default
 * to p.input. faceMove (default true) turns the body toward the movement; set false for first person.
 * If `character` is given, idle/walk/run/jump animations are played for you.
 */
export class Walker {
  constructor(p, { position, character, radius = 0.25, speed = 3.5, runSpeed = 6.5, jumpSpeed = 4.8, gravity = 14, faceMove = true, turnRate = 10, maxStepUp = 0.45 } = {}) {
    Object.assign(this, { p, character, radius, speed, runSpeed, jumpSpeed, gravity, faceMove, turnRate, maxStepUp });
    const s = position || p.spawn();
    this.position = new THREE.Vector3(s[0] ?? s.x, s[1] ?? s.y, s[2] ?? s.z);
    this.velocity = new THREE.Vector3();
    this.heading = 0; this.onGround = true; this.moving = false; this.landT = 0;
    if (character) { p.scene.add(character.root); this.#sync(); }
    p.player ??= this; // `npm run check` reads p.player.position
  }
  /** Teleport (snaps to the ground). */
  teleport(x, y, heading = this.heading) {
    const q = this.p.geo.nearestWalkable(x, y, this.radius) || [x, y, this.p.geo.groundAt(x, y)];
    this.position.set(q[0], q[1], q[2]); this.ground = q[2]; this.velocity.set(0, 0, 0); this.heading = heading; this.onGround = true; this.#sync();
  }
  update(dt, { yaw = this.heading, move = this.p.input.move, jump = this.p.input.pressed('jump'), run = this.p.input.held('run') } = {}) {
    const { p, position: P } = this, geo = p.geo;
    const sp = run ? this.runSpeed : this.speed;
    const fx = Math.cos(yaw), fy = Math.sin(yaw);
    let vx = (fx * move.y + fy * move.x) * sp, vy = (fy * move.y - fx * move.x) * sp;
    this.moving = Math.hypot(vx, vy) > 0.05;
    if (this.faceMove) { if (this.moving) this.heading += wrap(Math.atan2(vy, vx) - this.heading) * Math.min(1, dt * this.turnRate); }
    else this.heading = yaw;
    // horizontal move with sliding
    // ground under the feet; over a hole (stair riser, grid gap) keep the last good value
    const groundHere = (x, y, prev) => { const v = geo.groundAt(x, y); return geo.walkable(x, y, 0) && Number.isFinite(v) && Math.abs(v - prev) < 1.5 ? v : prev; };
    this.ground ??= Number.isFinite(geo.groundAt(P.x, P.y)) ? geo.groundAt(P.x, P.y) : P.z;
    const g0 = this.ground;
    let rad = this.radius;
    const ok = (x, y) => geo.walkable(x, y, rad) && (!this.onGround || geo.groundAt(x, y) - g0 <= this.maxStepUp || P.z > geo.groundAt(x, y) - 0.05);
    // blocked: try the move turned by up to 75 degrees either way (slides along walls and around poles)
    let moved = false;
    for (const a of [0, 0.45, -0.45, 0.9, -0.9, 1.3, -1.3]) {
      const c = Math.cos(a), s = Math.sin(a), k = a ? Math.cos(a) : 1;
      const mx = (vx * c - vy * s) * k, my = (vx * s + vy * c) * k;
      if (ok(P.x + mx * dt, P.y + my * dt)) { P.x += mx * dt; P.y += my * dt; vx = mx; vy = my; moved = true; break; }
    }
    // still blocked: squeeze through gaps narrower than the body (the grid is coarse, real passages are a bit wider)
    if (!moved) { rad = 0; if (ok(P.x + vx * dt, P.y + vy * dt)) { P.x += vx * dt; P.y += vy * dt; moved = true; } }
    // stairs often have one-cell holes (vertical risers leave no ground sample): step over a hole if there is
    // walkable ground within a step height just beyond it
    if (!moved && this.onGround) {
      const l = Math.hypot(vx, vy);
      if (l > 0) {
        for (const d of [0.3, 0.4, 0.5, 0.6]) {
          const ax = P.x + vx / l * d, ay = P.y + vy / l * d, ga = geo.groundAt(ax, ay);
          if (geo.walkable(ax, ay, 0) && Math.abs(ga - g0) <= Math.max(this.maxStepUp, d)) { P.x += vx * dt; P.y += vy * dt; moved = true; break; }
        }
      }
    }
    if (!moved) { vx = 0; vy = 0; }
    this.velocity.x = vx; this.velocity.y = vy;
    // vertical
    const g = (this.ground = groundHere(P.x, P.y, g0));
    if (this.onGround && jump) { this.velocity.z = this.jumpSpeed; this.onGround = false; this.character?.play('jumpStart', { once: true, fade: 0.1 }); }
    if (this.onGround) {
      if (P.z - g > 0.5) this.onGround = false; // walked off a ledge
      else { P.z += (g - P.z) * Math.min(1, dt * 18); this.velocity.z = 0; }
    }
    if (!this.onGround) {
      this.velocity.z -= this.gravity * dt; P.z += this.velocity.z * dt;
      if (P.z <= g && this.velocity.z <= 0) { P.z = g; this.onGround = true; this.landT = 0.15; this.velocity.z = 0; }
    }
    this.landT -= dt;
    this.#animate(run);
    this.#sync();
  }
  #animate(run) {
    const c = this.character; if (!c) return;
    if (!this.onGround) { if (this.velocity.z < 2) c.play(c.has('jumpAir') ? 'jumpAir' : 'jump'); }
    else if (this.landT > 0 && c.has('jumpLand')) c.play('jumpLand', { once: true, fade: 0.08 });
    else if (this.moving) c.play(run && c.has('run') ? (c.has('sprint') ? 'sprint' : 'run') : (Math.hypot(this.velocity.x, this.velocity.y) > 2.5 && c.has('run') ? 'run' : 'walk'));
    else c.play('idle');
  }
  #sync() {
    const c = this.character; if (!c) return;
    c.root.position.copy(this.position); c.root.rotation.z = this.heading; c.update(0);
  }
}

/**
 * Arcade flight for scenic tours (plane, glider, drone, bird). Keeps a safe height above the ground and pulls up
 * before it would fly into the scene (collision rays ahead).
 *   move.y: pitch up/down (or climb/descend), move.x: bank/turn, run: boost, down: slow down.
 * Properties: position, yaw, pitch, roll (for the model), speed, altitude (above ground).
 */
export class Flyer {
  constructor(p, { position, yaw = 0, speed = 10, minSpeed = 5, maxSpeed = 22, minAltitude = 2.5, maxAltitude = 30, turnRate = 1.8, climbRate = 4, avoidSplats = true } = {}) {
    Object.assign(this, { p, yaw, speed, minSpeed, maxSpeed, minAltitude, maxAltitude, turnRate, climbRate, avoidSplats });
    this.frame = 0; this.splatClimb = 0;
    const s = position || (() => { const q = p.spawn(); return [q[0], q[1], q[2] + 6]; })();
    this.position = new THREE.Vector3(s[0] ?? s.x, s[1] ?? s.y, s[2] ?? s.z);
    p.player ??= this;
    this.pitch = 0; this.roll = 0; this.vz = 0; this.lastGround = p.geo.groundAt(this.position.x, this.position.y) || 0; this.bump = 0;
  }
  get altitude() { return this.position.z - this.ground(this.position.x, this.position.y); }
  /** Lowest safe flying height at (x, y): highest surface within r meters (roofs, tree tops included) + minAltitude.
   *  Use it to place rings or waypoints the plane can actually reach. */
  safeHeight(x, y, r = 3) {
    let g = -Infinity;
    for (let a = 0; a < 8; a++) for (const d of [0, r * 0.5, r]) { const v = this.p.geo.groundAt(x + Math.cos(a * Math.PI / 4) * d, y + Math.sin(a * Math.PI / 4) * d); if (Number.isFinite(v)) g = Math.max(g, v); }
    return (Number.isFinite(g) ? g : this.lastGround) + this.minAltitude;
  }
  ground(x, y) {
    // grid ground where we have it; outside the grid keep the last known ground
    const g = this.p.geo.groundAt(x, y); if (Number.isFinite(g)) this.lastGround = g; return this.lastGround;
  }
  update(dt, { move = this.p.input.move, boost = this.p.input.held('run'), brake = this.p.input.held('down') && !this.p.input.held('up') } = {}) {
    const P = this.position;
    const target = boost ? this.maxSpeed : brake ? this.minSpeed : (this.minSpeed + this.maxSpeed) / 2.2;
    this.speed += (target - this.speed) * Math.min(1, dt * 1.5);
    this.roll += (-move.x * 0.7 - this.roll) * Math.min(1, dt * 4);
    this.yaw -= move.x * this.turnRate * dt;
    let climb = move.y * this.climbRate;
    // safety: stay above minAltitude, below maxAltitude, and look ahead along the flight path for the scene
    const ahead = 2.2 * this.speed;
    const hx = Math.cos(this.yaw), hy = Math.sin(this.yaw);
    let floor = this.safeHeight(P.x, P.y, 1.5);
    for (const f of [0.3, 0.6, 1]) floor = Math.max(floor, this.safeHeight(P.x + hx * ahead * f, P.y + hy * ahead * f, 1.5));
    if (P.z < floor) climb = Math.max(climb, (floor - P.z) * 2.5);
    if (P.z > this.ground(P.x, P.y) + this.maxAltitude) climb = Math.min(climb, -1);
    {
      const hit = this.p.raycast?.([P.x, P.y, P.z], [hx, hy, 0], ahead);
      if (hit) { const d = hit.distance; climb = Math.max(climb, this.climbRate * 2 * (1 - d / ahead) + 1); if (d < 2) { this.speed = Math.max(this.minSpeed, this.speed * 0.6); this.bump = 0.3; } }
    }
    // foliage usually has no collision mesh: 4 times a second also cast against the splats ahead (10-15 ms per ray)
    if (this.avoidSplats && this.frame++ % 15 === 0) {
      const h = this.p.raycastSplats?.([P.x, P.y, P.z], [hx, hy, 0], ahead * 0.8);
      this.splatClimb = h ? this.climbRate * 1.5 * (1 - h.distance / (ahead * 0.8)) + 1.5 : 0;
    }
    if (this.splatClimb > 0) climb = Math.max(climb, this.splatClimb);
    this.vz += (climb - this.vz) * Math.min(1, dt * 3);
    this.pitch = Math.atan2(this.vz, this.speed);
    P.x += hx * this.speed * dt; P.y += hy * this.speed * dt; P.z += this.vz * dt;
    this.bump = Math.max(0, this.bump - dt);
  }
}

/**
 * Steering for autopilots and NPCs: walk toward a point, going around obstacles with A* when the straight line
 * is blocked. Drives p.input (so the game logic sees normal player input) unless you pass { apply: false }.
 *   const nav = new Navigator(p, walker);
 *   p.setAutopilot(() => nav.goTo(x, y, cam.yaw));
 * goTo returns the remaining straight-line distance. nav.stuck is seconds without progress.
 * NPCs: `const m = nav.goTo(x, y, 0, { apply: false })` then `npc.update(dt, { yaw: 0, move: nav.move })`.
 * repath: how far (m) the goal may move before the path is recomputed (raise it for many NPCs chasing a player).
 */
export class Navigator {
  constructor(p, walker, { lookahead = 0.8, run = true, repath = 1 } = {}) {
    Object.assign(this, { p, walker, lookahead, run, repath });
    this.path = []; this.goal = null; this.stuck = 0; this.last = null;
  }
  #clear(ax, ay, bx, by) {
    const geo = this.p.geo, L = Math.hypot(bx - ax, by - ay), n = Math.ceil(L / 0.1);
    let z = geo.groundAt(ax, ay);
    for (let i = 1; i <= n; i++) {
      const x = ax + (bx - ax) * i / n, y = ay + (by - ay) * i / n;
      if (!geo.walkable(x, y, 0)) return false;
      const g = geo.groundAt(x, y); if (Math.abs(g - z) > 0.45) return false; z = g;
    }
    return true;
  }
  goTo(x, y, yaw, { apply = true, dt = 1 / 60 } = {}) {
    const P = this.walker.position, geo = this.p.geo;
    this.stuck = this.last && Math.hypot(P.x - this.last[0], P.y - this.last[1]) < 0.02 ? this.stuck + dt : 0;
    this.last = [P.x, P.y];
    const moved = !this.goal || Math.hypot(this.goal[0] - x, this.goal[1] - y) > this.repath;
    if (moved || this.stuck > 0.7 || !this.path.length) {
      this.goal = [x, y]; this.stuck = 0;
      if (this.#clear(P.x, P.y, x, y)) this.path = [[x, y]];
      else {
        const a = geo.nearestWalkable(P.x, P.y, 0.2) || [P.x, P.y], b = geo.nearestWalkable(x, y, 0.2) || [x, y];
        this.path = geo.findPath(a, b, 0.2) || geo.findPath(a, b, 0) || [[x, y]];
        this.path.push([x, y]);
      }
    } else if (this.path.length) this.path[this.path.length - 1] = [x, y]; // follow a goal that moves a little
    while (this.path.length > 1 && Math.hypot(this.path[0][0] - P.x, this.path[0][1] - P.y) < this.lookahead) this.path.shift();
    const [tx, ty] = this.path[0];
    const rel = Math.atan2(ty - P.y, tx - P.x) - yaw;
    const m = { x: -Math.sin(rel), y: Math.cos(rel) };
    if (apply) { this.p.input.setMove(m.x, m.y); this.p.input.setHeld('run', this.run); }
    this.move = m;
    return Math.hypot(x - P.x, y - P.y);
  }
}
