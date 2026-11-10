// Rigged, animated characters at real-world scale.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { assetUrl, onFrame } from '../index.js';

const cache = new Map();
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

// Every loaded character; the playable's frame loop advances the ones that are in the scene.
const live = new Set();
// advance the animation of every character in the scene, once per frame
onFrame((dt) => { for (const c of live) if (c.root.parent && c.root.visible) c.mixer.update(dt); });

/**
 * Load a character. The returned object behaves like a prop: put `ch.root` in the scene,
 * `root.position` is the feet, `root.rotation.z` is the heading (0 = facing +X).
 * @param {string} id 'human' | 'robot' (see assets/characters/manifest.json), or a URL to your own .glb
 * @param {{height?: number, tint?: number, roles?: Record<string,string>}} [opt]
 *   height: scale to this height in meters (default 1.7 for human, 1.2 for robot);
 *   tint: blend clothes toward a color (0xRRGGBB), useful to tell NPCs apart;
 *   roles: for your own .glb, map action names to clip names.
 */
export async function loadCharacter(id = 'human', { height, tint, roles: roles0 } = {}) {
  if (!cache.has('manifest')) cache.set('manifest', fetch(assetUrl('characters/manifest.json')).then((r) => { if (!r.ok) throw new Error(`characters/manifest.json: HTTP ${r.status}`); return r.json(); }).catch((e) => { cache.delete('manifest'); throw e; }));
  const man = await cache.get('manifest');
  const def = man.characters[id] || (/\.(glb|gltf)(\?|$)/.test(id) ? { file: id, roles: roles0 || {} } : null);
  if (!def) throw new Error(`loadCharacter: unknown character "${id}". Available: ${Object.keys(man.characters).join(', ')}, or a .glb URL`);
  const url = /^(https?:|\/|\.)/.test(def.file) ? def.file : assetUrl('characters/' + def.file);
  if (!cache.has(url)) cache.set(url, loader.loadAsync(url).catch((e) => { cache.delete(url); throw new Error(`loadCharacter: could not load ${url}: ${e?.message || e}`); }));
  const gltf = await cache.get(url);
  const model = cloneSkinned(gltf.scene);
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    if (tint && o.material) { o.material = o.material.clone(); o.material.color?.lerp(new THREE.Color(tint), 0.5); }
  });
  // glTF is Y-up facing +Z; the scene is Z-up and we face +X.
  const inner = new THREE.Group(); inner.add(model); inner.rotation.set(Math.PI / 2, 0, Math.PI / 2, 'ZXY');
  const root = new THREE.Group(); root.add(inner); root.name = `character:${id}`;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3(); model.traverse((o) => { if (o.isMesh) box.expandByObject(o); });
  const h = height ?? (id === 'robot' ? 1.2 : 1.7);
  inner.scale.setScalar(h / (box.max.z - box.min.z || 1));
  root.updateMatrixWorld(true); box.makeEmpty(); model.traverse((o) => { if (o.isMesh) box.expandByObject(o); });
  inner.position.z -= box.min.z;
  const mixer = new THREE.AnimationMixer(model);
  const roleMap = { ...(def.roles || {}), ...(roles0 || {}) };
  const clips = new Map(gltf.animations.map((c) => [c.name, c]));
  const roles = [...new Set([...Object.keys(roleMap).filter((r) => clips.has(roleMap[r])), ...clips.keys()])];
  let cur = null, curRole = null;
  const ch = {
    id, root, mixer, height: h, roles,
    has: (r) => clips.has(roleMap[r] ?? r),
    get action() { return curRole; },
    /**
     * Switch animation with a cross-fade. Calling with the current action is free.
     * Common actions: idle walk run sprint jumpStart jumpAir jumpLand roll crouch slide hit death cheer punch aim shoot.
     * once: play one time and hold the last frame (jumps, hits, death).
     */
    play(role, { fade = 0.2, once = false, speed = 1 } = {}) {
      const clip = clips.get(roleMap[role] ?? role);
      if (!clip) { console.warn(`character ${id} has no action "${role}"; available: ${roles.join(' ')}`); return cur; }
      const act = mixer.clipAction(clip); act.timeScale = speed;
      if (role === curRole && act.isRunning()) return act;
      act.reset(); act.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); act.clampWhenFinished = once;
      if (cur && cur !== act) act.crossFadeFrom(cur, fade, false);
      act.play(); cur = act; curRole = role; return act;
    },
    /** Not needed: every character in the scene animates automatically. Kept for compatibility (does nothing). */
    update() {},
    /** Remove from the scene and stop animating it for good (enemies that died, NPCs you no longer need). */
    dispose() {
      live.delete(ch); root.removeFromParent(); mixer.stopAllAction(); mixer.uncacheRoot(model);
      if (tint) model.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) m.dispose?.(); }); // only tinted materials are per-character
    },
  };
  live.add(ch);
  ch.play(ch.has('idle') ? 'idle' : roles[0]);
  return ch;
}
