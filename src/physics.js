// Rapier physics with the scene as static collision.
//
//   const phys = await createPhysics(p);                       // gravity -9.81 along -Z
//   const crate = new THREE.Mesh(new THREE.BoxGeometry(.6,.6,.6), mat); p.props.add(crate);
//   phys.add(crate, { shape: 'box', mass: 3, position: [x, y, z + 2] });   // the mesh follows the body
//   const hit = phys.raycast([x, y, z], [dx, dy, dz], 50);     // {point, normal, distance, mesh?}
//
// The scene's collision mesh is streamed in as fixed trimesh colliders, chunk by chunk, within `radius` meters
// of `phys.focus` (default: the camera). Chunks far away are dropped. createPhysics hooks phys.step into the
// frame loop, so you do not call step yourself. Scenes without a collision mesh get the walkable grid instead
// (ground and 2.5 m blocks where there is no ground; coarser than a real mesh).
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { parsePly } from './geometry/prep.js';

let ready = null;

/**
 * @param {object} p the playable
 * @param {{gravity?: number, scene?: boolean, radius?: number}} [opt]
 */
export async function createPhysics(p, { gravity = -9.81, scene = true, radius = 45 } = {}) {
  ready ||= RAPIER.init();
  await ready;
  const world = new RAPIER.World({ x: 0, y: 0, z: gravity });
  const bodies = new Map(); // handle -> { body, mesh }
  const meshOf = new Map(); // collider handle -> mesh
  const base = p.url.slice(0, p.url.lastIndexOf('/') + 1);
  // collision chunks: octree nodes with mesh data and a bounding box
  const chunks = [];
  const files = p.meta.root?.meshFiles || [];
  (function walk(n) {
    if (!n) return;
    if (n.data?.mesh && n.boundingBox) chunks.push({ file: files[n.data.mesh.name], min: n.boundingBox.min, max: n.boundingBox.max, state: 'out', collider: null });
    for (const k in n.child || {}) walk(n.child[k]);
  })(p.meta.root);
  const focus = new THREE.Vector3();
  let acc = 0, loading = 0, dirty = true, freed = false;
  // scene queries only see colliders after a world step; refresh lazily before a raycast
  const refresh = () => { if (!dirty) return; const t = world.timestep; world.timestep = 0; world.step(); world.timestep = t; dirty = false; };

  const phys = {
    RAPIER, world, focus: null, chunks,
    /**
     * Give a mesh a rigid body. shape: 'box' | 'sphere' | 'capsule' | 'cylinder' (sized from the mesh's bounding box
     * unless `size` is given: box [hx, hy, hz], sphere r, capsule/cylinder [halfHeight, r], all along Z).
     * mass 0 or fixed: true -> static; kinematic: true -> moved by you (setNextKinematicTranslation).
     */
    add(mesh, { shape = 'box', size, mass = 1, fixed = false, kinematic = false, position, restitution = 0.2, friction = 0.7, ccd = false, sensor = false } = {}) {
      if (position) mesh.position.set(position[0], position[1], position[2]);
      mesh.updateMatrixWorld(true);
      const desc = fixed || mass === 0 ? RAPIER.RigidBodyDesc.fixed() : kinematic ? RAPIER.RigidBodyDesc.kinematicPositionBased() : RAPIER.RigidBodyDesc.dynamic();
      const q = mesh.quaternion;
      desc.setTranslation(mesh.position.x, mesh.position.y, mesh.position.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setCcdEnabled(ccd);
      const body = world.createRigidBody(desc);
      const box = new THREE.Box3().setFromObject(mesh), ext = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
      let cd;
      if (shape === 'sphere') cd = RAPIER.ColliderDesc.ball(size ?? Math.max(ext.x, ext.y, ext.z));
      else if (shape === 'capsule') { const [hh, r] = size ?? [Math.max(0.01, ext.z - Math.max(ext.x, ext.y)), Math.max(ext.x, ext.y)]; cd = RAPIER.ColliderDesc.capsule(hh, r).setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }); }
      else if (shape === 'cylinder') { const [hh, r] = size ?? [ext.z, Math.max(ext.x, ext.y)]; cd = RAPIER.ColliderDesc.cylinder(hh, r).setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }); }
      else { const [x, y, z] = size ?? [ext.x, ext.y, ext.z]; cd = RAPIER.ColliderDesc.cuboid(x, y, z); }
      cd.setRestitution(restitution).setFriction(friction).setSensor(sensor);
      if (!(fixed || mass === 0)) cd.setMass(mass);
      const collider = world.createCollider(cd, body);
      bodies.set(body.handle, { body, mesh }); meshOf.set(collider.handle, mesh); dirty = true;
      mesh.userData.body = body;
      return body;
    },
    remove(meshOrBody) {
      const body = meshOrBody.userData?.body ?? meshOrBody;
      const e = bodies.get(body.handle); if (!e) return;
      for (let i = 0; i < body.numColliders(); i++) meshOf.delete(body.collider(i).handle);
      bodies.delete(body.handle); world.removeRigidBody(body); delete e.mesh.userData.body;
    },
    /** Ray against the scene and all bodies. Returns {point, normal, distance, mesh, body} or null. */
    raycast(origin, dir, maxDistance = 100, { excludeBody } = {}) {
      refresh();
      const L = Math.hypot(dir[0], dir[1], dir[2]) || 1;
      const ray = new RAPIER.Ray({ x: origin[0], y: origin[1], z: origin[2] }, { x: dir[0] / L, y: dir[1] / L, z: dir[2] / L });
      const hit = world.castRayAndGetNormal(ray, maxDistance, true, undefined, undefined, undefined, excludeBody);
      if (!hit) return null;
      const t = hit.timeOfImpact ?? hit.toi, pt = ray.pointAt(t);
      const mesh = meshOf.get(hit.collider.handle) || null;
      return { point: [pt.x, pt.y, pt.z], normal: [hit.normal.x, hit.normal.y, hit.normal.z], distance: t, mesh, body: mesh?.userData.body || null };
    },
    /** Push a body: impulse [x, y, z] (N*s), optionally at a world point. */
    impulse(meshOrBody, imp, at) {
      const b = meshOrBody.userData?.body ?? meshOrBody;
      if (at) b.applyImpulseAtPoint({ x: imp[0], y: imp[1], z: imp[2] }, { x: at[0], y: at[1], z: at[2] }, true);
      else b.applyImpulse({ x: imp[0], y: imp[1], z: imp[2] }, true);
    },
    /** Called by the frame loop. */
    step(dt) {
      if (freed) return;
      world.timestep = Math.min(dt, 1 / 30);
      world.step(); dirty = false;
      for (const { body, mesh } of bodies.values()) {
        if (body.isFixed()) continue;
        const t = body.translation(), r = body.rotation();
        mesh.position.set(t.x, t.y, t.z); mesh.quaternion.set(r.x, r.y, r.z, r.w);
      }
      if (scene && (acc += dt) > 0.4) { acc = 0; stream(); }
    },
    /** Free the Rapier world (p.dispose() calls it). */
    dispose() { if (freed) return; freed = true; for (const c of chunks) c.state = 'failed'; world.free(); bodies.clear(); if (p.physics === phys) p.physics = null; },
    /** Resolves when scene chunks around the focus are loaded (call after placing the player). */
    async sceneReady({ timeout = 15000 } = {}) {
      stream(); const t0 = performance.now();
      while (loading) { if (performance.now() - t0 > timeout) { console.warn('physics: scene chunks still loading after', timeout, 'ms'); return; } await new Promise((r) => setTimeout(r, 50)); }
    },
  };

  async function load(c) {
    c.state = 'loading'; loading++;
    try {
      const r = await fetch(base + c.file);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const m = parsePly(new Uint8Array(await r.arrayBuffer()));
      if (c.state === 'loading' && !freed) { c.collider = world.createCollider(RAPIER.ColliderDesc.trimesh(m.v, m.f)); c.state = 'in'; dirty = true; }
    } catch (e) {
      // retry a failed chunk at most 3 times, with growing delays; then give up on it
      c.fails = (c.fails || 0) + 1;
      console.warn('physics: chunk failed', c.file, String(e?.message || e), c.fails < 3 ? '(will retry)' : '(giving up)');
      c.state = c.fails < 3 ? 'wait' : 'failed';
      if (c.fails < 3) setTimeout(() => { if (c.state === 'wait') c.state = 'out'; }, 1000 * 2 ** c.fails);
    }
    loading--;
  }
  // scenes without a collision mesh: a mesh of the walkable grid around the focus (ground and wall blocks), rebuilt
  // when the focus has moved a third of the radius
  let gridCollider = null; const gridAt = new THREE.Vector3(Infinity, 0, 0);
  function streamGrid() {
    if (!p.geo || gridAt.distanceTo(focus) < radius / 3) return;
    gridAt.copy(focus);
    const m = p.geo.toMesh(focus.x, focus.y, radius);
    if (gridCollider) world.removeCollider(gridCollider, false);
    gridCollider = m.f.length ? world.createCollider(RAPIER.ColliderDesc.trimesh(m.v, m.f)) : null; dirty = true;
  }
  function stream() {
    focus.copy(phys.focus || p.camera.position);
    if (!chunks.length) { streamGrid(); return; }
    for (const c of chunks) {
      const dx = Math.max(c.min[0] - focus.x, 0, focus.x - c.max[0]), dy = Math.max(c.min[1] - focus.y, 0, focus.y - c.max[1]), dz = Math.max(c.min[2] - focus.z, 0, focus.z - c.max[2]);
      const d = Math.hypot(dx, dy, dz);
      if (d < radius && c.state === 'out') load(c);
      else if (d > radius * 1.5 && c.state !== 'out') { if (c.collider) world.removeCollider(c.collider, false); c.collider = null; c.state = 'out'; }
    }
  }

  p.physics = phys;
  if (scene) await phys.sceneReady();
  return phys;
}
