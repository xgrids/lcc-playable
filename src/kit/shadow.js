// Shadows on the scene ground under a character or prop, so it stands on the captured ground instead of floating
// over it. Splats have no shadow pass, so this is the stand-in.
//
//   shadow(p, hero.root);                              // the hero's own shape, animated, cast by a fixed sun
//   shadow(p, coin, { shape: 'disc', radius: 0.35 });  // a soft round blob (cheap: pickups, many small things)
//
// shape 'figure' (default): the object is drawn from the sun into a 128 px tile of a shared texture, and that
// silhouette is laid on the ground, sharp at the feet and softer farther away, plus a small dark contact blob under
// the feet. A walking character casts a walking shadow. Up to 64 figure shadows per game (more become discs); at most
// 6 silhouettes are redrawn per frame, the others reuse their last one moved along with the object, so with many
// characters the pose lags by a frame or two. Farther than `figureWithin` m from the camera it becomes a disc.
// shape 'disc': a soft dark disc, `radius` m.
// Both sit on the ground under the object (tilted with the slope), grow lighter as the object rises (jumps,
// flight), and hide when the object is hidden or more than `fade` m above the ground.
import * as THREE from 'three';

const vert = 'varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }';
const frag = `
uniform sampler2D map; uniform mat4 lightVP; uniform vec4 tile; uniform vec3 feet, shift;
uniform float texel, figure, opacity, blobR, blobA, reach;
varying vec3 vW;
void main() {
  float d = distance(vW, feet);
  float b = blobR > 0.0 ? clamp(1.0 - (d / blobR) * (d / blobR), 0.0, 1.0) * blobA : 0.0;
  float s = 0.0;
  if (figure > 0.0) {
    vec4 l = lightVP * vec4(vW + shift, 1.0); vec2 uv = l.xy / l.w * 0.5 + 0.5;
    float t = clamp(d / reach, 0.0, 1.0);
    float r = texel * mix(0.8, 3.5, t); // contact hardening: sharp at the feet, softer away from them
    float m = 4.0 * texel;              // stay inside this shadow's tile of the atlas
    for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++)
      s += texture2D(map, tile.xy + clamp(uv + vec2(float(i), float(j)) * r, m, 1.0 - m) * tile.zw).a;
    s *= (1.0 / 9.0) * figure * mix(1.0, 0.65, t);
    s *= step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  }
  float a = 1.0 - (1.0 - s) * (1.0 - b);
  if (a < 0.004) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a * opacity);
}`;
const geom = new THREE.PlaneGeometry(2, 2); // the scene is Z up: a plane in XY lies on the ground
const UP = new THREE.Vector3(0, 0, 1);

// The silhouette pass draws every object with one unlit material (only coverage matters), so no lit shader runs.
const flat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });

// All silhouettes of a playable share one atlas render target and are drawn together once per frame in
// p.onLateUpdate, which the core runs after the game's updates and the character animation, so the pose is current. The atlas has no depth buffer (a silhouette is just coverage) and each tile is cleared with a
// color-only scissored clear: a scissored depth clear stalled every frame on ANGLE/D3D11 (765 ms frames, Edge on
// Windows, fps example).
const TILE = 128, ATLAS = 1024, PER = ATLAS / TILE, BUDGET = 6;
const atlases = new Map(); // playable -> { rt, free tiles, queue of jobs, pass scene, users }
const atlasOf = (p) => {
  let a = atlases.get(p);
  if (!a) {
    a = { rt: new THREE.WebGLRenderTarget(ATLAS, ATLAS, { depthBuffer: false }), free: [...Array(PER * PER).keys()], queue: [], pass: new THREE.Scene(), users: 0 };
    a.pass.overrideMaterial = flat;
    atlases.set(p, a);
    const atlas = a;
    p.onLateUpdate(() => { if (atlases.get(p) === atlas && atlas.queue.length) drawAtlas(p, atlas); });
  }
  return a;
};
const drawAtlas = (p, a) => {
  const jobs = a.queue.sort((x, y) => y.age() - x.age()).slice(0, BUDGET); // stalest first
  a.queue.length = 0;
  const r = p.renderer, prevRT = r.getRenderTarget(), prevAuto = r.autoClear, prevColor = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha();
  r.setClearColor(0x000000, 0); r.autoClear = false; a.rt.scissorTest = true;
  for (const j of jobs) {
    const x = (j.tile % PER) * TILE, y = Math.floor(j.tile / PER) * TILE;
    a.rt.viewport.set(x, y, TILE, TILE); a.rt.scissor.set(x, y, TILE, TILE);
    r.setRenderTarget(a.rt); r.clear(true, false, false); // same target every time: only viewport and scissor change
    a.pass.children[0] = j.obj; r.render(a.pass, j.cam); a.pass.children.length = 0; // obj keeps its real parent
    j.done();
  }
  a.rt.scissorTest = false;
  r.setRenderTarget(prevRT); r.setClearColor(prevColor, prevAlpha); r.autoClear = prevAuto;
};

/**
 * @param {object} p the playable
 * @param {THREE.Object3D} obj object to follow (its world position is the feet / bottom)
 * @param {{shape?: 'figure'|'disc', radius?: number, opacity?: number, fade?: number, still?: boolean,
 *          ground?: (x: number, y: number) => number, sun?: number[], figureWithin?: number}} [opt]
 *   shape: 'figure' (the object's own silhouette, default) or 'disc';
 *   radius: disc radius in m at ground contact (default 0.6: a person); with 'figure' the contact blob is half of it;
 *   opacity: darkness (default 0.55); fade: height above ground where the shadow is gone (default 6 m);
 *   still: position it once (objects that do not move); ground: height of the surface under (x, y) when it is not
 *   the scene ground, e.g. a road: (x, y) => road.at(s).z;
 *   sun: direction from the ground toward the sun, Z up (default [0.5, 0.35, 1]: high, shadows fall toward -X -Y);
 *   figureWithin: beyond this distance to the camera use the disc (default 30 m)
 * @returns {{mesh: THREE.Mesh, update(): void, dispose(): void}}
 */
export function shadow(p, obj, { shape = 'figure', radius = 0.6, opacity = 0.55, fade = 6, still = false, ground, sun = [0.5, 0.35, 1], figureWithin = 30 } = {}) {
  const u = {
    map: { value: null }, lightVP: { value: new THREE.Matrix4() }, tile: { value: new THREE.Vector4() }, texel: { value: 1 / TILE },
    figure: { value: 0 }, opacity: { value: opacity }, blobR: { value: radius }, blobA: { value: 1 }, reach: { value: 1 },
    feet: { value: new THREE.Vector3() }, shift: { value: new THREE.Vector3() },
  };
  const mat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms: u, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const mesh = new THREE.Mesh(geom, mat); mesh.renderOrder = 5; mesh.name = 'shadow'; // after the splats (they write no depth), before props
  p.scene.add(mesh);

  // figure: an orthographic camera looking along the sunlight, sized to the object's bounding sphere
  const dir = new THREE.Vector3(...sun).normalize(); if (dir.z < 0.3) { dir.z = 0.3; dir.normalize(); } dir.negate(); // light travel direction
  let atlas = null, tile = -1, cam = null, R = 0, lift = 0, age = Infinity, job = null;
  if (shape === 'figure') {
    obj.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(obj), pos = obj.getWorldPosition(new THREE.Vector3());
    if (box.isEmpty()) { R = radius * 1.5; lift = R; } else { R = 0.5 * box.getSize(new THREE.Vector3()).length() * 1.1; lift = box.getCenter(new THREE.Vector3()).z - pos.z; }
    atlas = atlasOf(p); atlas.users++; tile = atlas.free.shift() ?? -1;
    cam = new THREE.OrthographicCamera(-R, R, R, -R, 0.01, 4 * R + 2);
    if (dir.z < -0.99) cam.up.set(1, 0, 0); else cam.up.set(0, 0, 1); // lookAt needs an up that is not the view direction
    u.map.value = atlas.rt.texture; u.tile.value.set((tile % PER) / PER, Math.floor(tile / PER) / PER, 1 / PER, 1 / PER);
    u.reach.value = Math.max(0.5, 2 * R / -dir.z);
  }
  const drawnAt = new THREE.Vector3(), lightVP = new THREE.Matrix4();
  const unqueue = () => { if (job) { const i = atlas.queue.indexOf(job); if (i >= 0) atlas.queue.splice(i, 1); job = null; } };
  const queue = (c) => {
    cam.position.copy(c).addScaledVector(dir, -(2 * R + 1)); cam.lookAt(c); cam.updateMatrixWorld();
    lightVP.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const at = c.clone();
    job = { obj, cam, tile, age: () => age, done: () => { u.lightVP.value.copy(lightVP); drawnAt.copy(at); age = 0; job = null; u.figure.value = 1; } };
    atlas.queue.push(job);
  };

  const w = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), g = new THREE.Vector3();
  const gAt = (x, y) => (ground ? ground(x, y) : p.geo?.groundAt(x, y));
  const update = () => {
    let o = obj, visible = !!obj.parent; while (o && visible) { if (!o.visible) visible = false; o = o.parent; }
    obj.getWorldPosition(w);
    const gz = gAt(w.x, w.y), h = w.z - gz;
    if (!visible || !Number.isFinite(gz) || h > fade || h < -1) { mesh.visible = false; unqueue(); age = Infinity; return; }
    const k = 1 - Math.max(0, h) / fade;
    // ground plane under the feet, tilted with the slope (0.5 m either side)
    const zx = gAt(w.x + 0.5, w.y) - gAt(w.x - 0.5, w.y), zy = gAt(w.x, w.y + 0.5) - gAt(w.x, w.y - 0.5);
    n.set(Number.isFinite(zx) && Math.abs(zx) < 1 ? -zx : 0, Number.isFinite(zy) && Math.abs(zy) < 1 ? -zy : 0, 1).normalize();
    u.feet.value.set(w.x, w.y, gz);
    mesh.visible = true; mesh.quaternion.setFromUnitVectors(UP, n);
    u.opacity.value = opacity * k * k;
    if (tile >= 0 && p.camera.position.distanceTo(w) < figureWithin) {
      c.set(w.x, w.y, w.z + lift);
      age++; if (!job) queue(c);
      u.shift.value.copy(drawnAt).sub(c); // the last silhouette, moved to where the object is now
      // the silhouette lands where the sunlight through the object's center meets the ground plane
      const dn = Math.min(-0.3, dir.dot(n)), t = g.copy(u.feet.value).sub(c).dot(n) / dn;
      mesh.position.copy(c).addScaledVector(dir, t).addScaledVector(n, 0.03);
      mesh.scale.setScalar(R / -dn + 0.2);
      u.figure.value = age === Infinity ? 0 : 1; // not drawn yet: only the contact blob for this frame
      u.blobR.value = radius * 0.5; u.blobA.value = 0.6;
    } else {
      unqueue(); age = Infinity;
      const s = radius * (0.6 + 0.4 * k);
      mesh.position.set(w.x, w.y, gz).addScaledVector(n, 0.03); mesh.scale.setScalar(s);
      u.figure.value = 0; u.blobR.value = s; u.blobA.value = 1;
    }
  };
  update();
  if (!still) p.onUpdate(update);
  return {
    mesh, update,
    dispose() {
      mesh.removeFromParent(); mat.dispose();
      if (atlas) {
        unqueue();
        if (tile >= 0) atlas.free.push(tile);
        tile = -1;
        if (--atlas.users === 0) { atlas.rt.dispose(); atlases.delete(p); }
        atlas = null;
      }
      obj = new THREE.Object3D();
    },
  };
}
