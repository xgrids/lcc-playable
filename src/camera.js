// Cameras that are never blocked: by the scene (collision rays) or by your own props (fading).
import * as THREE from 'three';

/**
 * Keep a follow camera out of walls: cast collision rays from `target` (the character's chest) toward `desired`
 * (where the camera wants to be). If blocked, move the camera in front of the hit; if that is closer than minDist,
 * raise it and try again. Pass the playable: it uses p.raycast (the scene's collision mesh, or the grid estimated
 * from the splats when the scene has none). Passing the SDK renderer (p.lcc) still works for scenes with a mesh.
 * radius > 0 adds two parallel rays offset sideways (3x the cost) so the frame edges also stay clear.
 * splats: true also casts against the splats (10-15 ms per ray: not every frame): catches foliage without collision mesh.
 * Only handles the scene. For your own props use fadeOccluders.
 * @returns {number[]} camera position [x, y, z]
 */
export function safeCamera(scene, target, desired, { minDist = 1.5, lift = 0.8, tries = 3, pad = 0.3, radius = 0, splats = false } = {}) {
  const [tx, ty, tz] = target;
  const isPlayable = typeof scene?.raycast === 'function' && 'geo' in scene, lcc = isPlayable ? scene.lcc : scene;
  const ray1 = (o, d, L) => {
    const dir = { x: d[0] / L, y: d[1] / L, z: d[2] / L };
    let free = L;
    if (isPlayable) { const h = scene.raycast(o, d, L); if (h) free = h.distance - pad; }
    else { const hit = lcc?.intersectsRayFromOriginExt?.({ origin: { x: o[0], y: o[1], z: o[2] }, direction: dir, maxDistance: L }); if (hit) free = Math.hypot(hit.point.x - o[0], hit.point.y - o[1], hit.point.z - o[2]) - pad; }
    if (splats) { // splat ray (10-15 ms): catches foliage that has no collision mesh
      const h = lcc?.raycastFromOrigin?.({ origin: { x: o[0], y: o[1], z: o[2] }, direction: dir, maxDistance: L, radius: 0.05, opacityThreshold: 0.5 });
      if (h) free = Math.min(free, Math.hypot(h.x - o[0], h.y - o[1], h.z - o[2]) - pad);
    }
    return free;
  };
  const cast = (p) => {
    const d = [p[0] - tx, p[1] - ty, p[2] - tz], L = Math.hypot(...d) || 1e-6;
    let free = ray1(target, d, L);
    if (radius > 0) { // two parallel rays offset sideways: also pull in when the frame edge grazes a railing or statue
      const h = Math.hypot(d[0], d[1]) || 1e-6, sx = -d[1] / h * radius, sy = d[0] / h * radius;
      for (const k of [-1, 1]) free = Math.min(free, ray1([tx + sx * k, ty + sy * k, tz], d, L));
    }
    return { d, L, free: Math.min(L, free) };
  };
  let p = desired;
  for (let k = 0; k <= tries; k++) {
    const r = cast(p);
    if (r.free >= r.L - 1e-3) return p;
    if (r.free >= minDist || k === tries) { const s = Math.max(0.3, r.free) / r.L; return [tx + r.d[0] * s, ty + r.d[1] * s, tz + r.d[2] * s]; }
    p = [p[0], p[1], p[2] + lift];
  }
  return p;
}

/**
 * Fade game objects that block the view: objects closer than `near` to the camera, or crossing the line from the
 * camera to `target`, become translucent and fade back when clear. Call every frame. Materials are cloned on first
 * fade so shared materials are untouched. Returns the number of faded objects.
 */
export function fadeOccluders(camera, target, objects, { near = 1.2, radius = 0.25, opacity = 0.25, speed = 10, dt = 1 / 60 } = {}) {
  const c = camera.position, [tx, ty, tz] = target;
  const dx = tx - c.x, dy = ty - c.y, dz = tz - c.z, L2 = dx * dx + dy * dy + dz * dz || 1e-6;
  let n = 0;
  for (const o of objects) {
    if (!o.visible) continue;
    const u = o.userData;
    if (!u._fadeBox) { u._fadeBox = new o.position.constructor(); u._fadeR = 0; }
    // bounding sphere in local space, computed once from the child geometry boxes
    if (!u._fadeLocal) {
      let r = 0; const ctr = new o.position.constructor();
      o.updateWorldMatrix(true, true);
      const inv = o.matrixWorld.clone().invert(), pts = [];
      o.traverse((m) => { if (!m.geometry) return; m.geometry.computeBoundingBox?.(); const b = m.geometry.boundingBox; if (!b) return; for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) pts.push(new o.position.constructor(x, y, z).applyMatrix4(m.matrixWorld).applyMatrix4(inv)); });
      if (pts.length) { pts.forEach((p) => ctr.add(p)); ctr.multiplyScalar(1 / pts.length); r = Math.max(...pts.map((p) => p.distanceTo(ctr))); }
      u._fadeLocal = ctr; u._fadeR = r;
    }
    u._fadeBox.copy(u._fadeLocal).applyMatrix4(o.matrixWorld);
    const p = u._fadeBox, r = u._fadeR * Math.max(o.scale.x, o.scale.y, o.scale.z);
    // distance from the sphere to the segment camera -> target
    const t = Math.max(0, Math.min(1, ((p.x - c.x) * dx + (p.y - c.y) * dy + (p.z - c.z) * dz) / L2));
    const qx = c.x + dx * t - p.x, qy = c.y + dy * t - p.y, qz = c.z + dz * t - p.z;
    const block = Math.hypot(qx, qy, qz) < r + radius && t < 0.97;
    const close = p.distanceTo(c) < r + near;
    const goal = block || close ? opacity : 1;
    const cur = u._fadeOp ?? 1;
    if (goal === 1 && cur === 1) continue;
    const next = goal < cur ? Math.max(goal, cur - speed * dt) : Math.min(goal, cur + speed * dt);
    u._fadeOp = next; if (goal < 1) n++;
    o.traverse((m) => {
      if (!m.material) return;
      if (!m.userData._fadeMat) { // clone so objects sharing the material are not affected
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        m.userData._fadeOrig = mats.map((x) => ({ transparent: x.transparent, opacity: x.opacity, depthWrite: x.depthWrite }));
        m.material = Array.isArray(m.material) ? mats.map((x) => x.clone()) : m.material.clone();
        m.userData._fadeMat = true;
      }
      (Array.isArray(m.material) ? m.material : [m.material]).forEach((x, i) => {
        const orig = m.userData._fadeOrig[i];
        const tr = next >= 1 ? orig.transparent : true;
        if (x.transparent !== tr) x.needsUpdate = true;
        x.transparent = tr; x.opacity = next >= 1 ? orig.opacity : orig.opacity * next; x.depthWrite = next >= 1 ? orig.depthWrite : false;
      });
      if (m.userData.isOutline) m.visible = next >= 0.99; // toon outline shells would show through a faded object
    });
  }
  return n;
}


/**
 * Third-person follow camera with scene collision and prop fading built in.
 *   const cam = new FollowCamera(p, { distance: 4, height: 2.2 });
 *   cam.update(dt, player.position, heading);   // every frame
 * Default (orbit: true): the mouse (pointer lock, click to capture) or a touch drag turns the camera, and the player
 * moves relative to it: pass `yaw: cam.yaw` to Walker.update. Keys never turn the camera (that makes people dizzy).
 * orbit: false: the camera stays behind `heading` (on-rails games such as runners).
 * `splats` (default false): every `splatEvery` frames one splat ray (10-15 ms, so it costs frames), alternating between the player's
 * chest and feet, pulls the camera in front of foliage, statues and railings without collision mesh, which
 * otherwise fill the view as a blurry blob.
 */
export class FollowCamera {
  constructor(p, { distance = 4, height = 2.2, lookHeight = 1.3, radius = 0.3, stiffness = 6, fade = true, orbit = true, every = 1, splats = false, splatEvery = 6, groundClear = 1.2, sensitivity = 0.0025 } = {}) {
    Object.assign(this, { p, distance, height, lookHeight, radius, stiffness, fade, orbit, every, splats, splatEvery, groundClear, sensitivity });
    this.yaw = 0; this.pitch = 0.35; this.frame = 0; this.safe = null;
    if (orbit) p.input.usePointerLock(true);
    this.pitch = Math.atan2(height - lookHeight * 0.5, distance);
    this.splatFrac = [1, 1]; this.splatFrame = 0; // allowed fraction of the camera distance, from [chest, feet] rays
    this.pos = new THREE.Vector3(); this.look = new THREE.Vector3(); this.first = true;
  }
  update(dt, target, heading = 0) {
    const { p } = this, cam = p.camera;
    if (this.orbit) {
      const l = p.input.consumeLook();
      this.yaw -= l.dx * this.sensitivity; this.pitch = Math.min(1.1, Math.max(-0.15, this.pitch + l.dy * this.sensitivity));
    } else {
      let d = heading - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 4);
    }
    const chest = [target.x, target.y, target.z + this.lookHeight];
    const h = this.orbit ? Math.sin(this.pitch) * this.distance + this.lookHeight * 0.5 : this.height;
    const back = this.orbit ? Math.cos(this.pitch) * this.distance : this.distance;
    const want = [target.x - Math.cos(this.yaw) * back, target.y - Math.sin(this.yaw) * back, target.z + h];
    if (!this.safe || this.frame++ % this.every === 0) this.safe = p.lcc ? safeCamera(p, chest, want, { radius: this.radius }) : want;
    let cpos = this.safe;
    if (this.splats && p.lcc?.raycastFromOrigin) {
      if (this.splatFrame++ % this.splatEvery === 0) {
        const k = (this.splatFrame / this.splatEvery | 0) % 2; // 0: chest, 1: feet
        const o = k ? [target.x, target.y, target.z + 0.3] : chest;
        const d = [cpos[0] - o[0], cpos[1] - o[1], cpos[2] - o[2]], L = Math.hypot(...d) || 1e-6;
        const hit = p.lcc.raycastFromOrigin({ origin: { x: o[0], y: o[1], z: o[2] }, direction: { x: d[0] / L, y: d[1] / L, z: d[2] / L }, maxDistance: L, radius: 0.05, opacityThreshold: 0.5 });
        this.splatFrac[k] = hit ? Math.max(0.3, (Math.hypot(hit.x - o[0], hit.y - o[1], hit.z - o[2]) - 0.4) / L) : 1;
      }
      const f = Math.min(...this.splatFrac);
      if (f < 1) { const m = Math.max(f, 1.2 / Math.max(1.2, Math.hypot(cpos[0] - chest[0], cpos[1] - chest[1], cpos[2] - chest[2])));
        cpos = chest.map((c, i) => c + (cpos[i] - c) * m); }
    }
    // keep clear of the ground under the camera too (a ledge above the player fills the view as a blurry slab)
    const gz = p.geo?.groundAt?.(cpos[0], cpos[1]);
    if (Number.isFinite(gz) && cpos[2] < gz + this.groundClear && gz - target.z < 2.5) cpos = [cpos[0], cpos[1], gz + this.groundClear];
    this.pos.set(...cpos);
    if (this.first) { cam.position.copy(this.pos); this.first = false; }
    else cam.position.lerp(this.pos, 1 - Math.exp(-this.stiffness * dt));
    this.look.set(chest[0], chest[1], chest[2] - 0.1);
    cam.lookAt(this.look);
    if (this.fade) fadeOccluders(cam, chest, p.props.children, { dt });
  }
  /** Snap to the target immediately (after a teleport or restart). */
  reset() { this.first = true; }
}

/**
 * First-person camera: eye at `height` above the feet, yaw/pitch from mouse (pointer lock) or touch drag.
 *   const fp = new FirstPersonCamera(p, { height: 1.6 });
 *   fp.update(dt, player.position);   // then move the player relative to fp.yaw
 */
export class FirstPersonCamera {
  constructor(p, { height = 1.6, sensitivity = 0.0022, yaw = 0, pitch = 0 } = {}) {
    Object.assign(this, { p, height, sensitivity, yaw, pitch });
    p.input.usePointerLock(true);
  }
  update(dt, feet) {
    const l = this.p.input.consumeLook();
    this.yaw -= l.dx * this.sensitivity; this.pitch = Math.min(1.45, Math.max(-1.45, this.pitch - l.dy * this.sensitivity));
    const cam = this.p.camera;
    cam.position.set(feet.x, feet.y, feet.z + this.height);
    const cp = Math.cos(this.pitch);
    cam.lookAt(cam.position.x + Math.cos(this.yaw) * cp, cam.position.y + Math.sin(this.yaw) * cp, cam.position.z + Math.sin(this.pitch));
  }
  /** Unit view direction [x, y, z]. */
  get forward() { const cp = Math.cos(this.pitch); return [Math.cos(this.yaw) * cp, Math.sin(this.yaw) * cp, Math.sin(this.pitch)]; }
}
