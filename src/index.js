// lcc-playable core: what every game in a captured scene needs. Scene loading and the game loop, ground,
// walkable area and paths, collision, movement on the scene, cameras, routes and coverage, input, UI and checks.
// Gameplay helpers (characters, props, roads, minimap, NPCs, toon style) are in 'lcc-playable/kit'.
// API reference: docs/api.md
export { createPlayable } from './playable.js';
export { Walker, Flyer, Navigator } from './controller.js';
export { FollowCamera, FirstPersonCamera, safeCamera, fadeOccluders } from './camera.js';
export { Input } from './input.js';
export { UI } from './ui.js';
export { SceneGeometry } from './geometry/query.js';
export { loadGeometry } from './geometry/load.js';
export { rng, clock, sfx } from './util.js';
export { onFrame } from './frame.js';
export { assetUrl } from './config.js';

/** Rapier physics with the scene as static collision (see src/physics.js). Loaded on first use (~2 MB). */
export async function createPhysics(p, opt) {
  return (await import('./physics.js')).createPhysics(p, opt);
}
