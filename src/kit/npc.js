// NPCs that walk around on their own: patrol a list of points, or wander near home. Animated, on the real ground.
//
//   const guard = await patrol(p, 'robot', { points: placeAlong(p.geo, route, 15).slice(0, 4) });
//   const local = await patrol(p, 'human', { wander: 8, home: [x, y], speed: 1.2 });
//   if (guard.near(p.player.position, 2)) p.ui.toast('Halt!');
//
// Each NPC is a Walker driven by a Navigator (straight line when clear, A* around obstacles). They walk while the
// game runs (also behind the title card, for life in the scene) and freeze while paused.
import { Walker, Navigator, rng as makeRng } from '../index.js';
import { loadCharacter } from './character.js';
import { shadow as addShadow } from './shadow.js';

/**
 * @param {object} p the playable
 * @param {string|object} character 'human' | 'robot' | a .glb URL | a loaded character
 * @param {{points?: number[][], wander?: number, home?: number[], speed?: number, wait?: [number, number],
 *          loop?: boolean, height?: number, tint?: number, faceWithin?: number, showWithin?: number, seed?: number}} [opt]
 *   points: [[x, y], ...] visited in order (loop: back to the first; else back and forth);
 *   wander: radius (m) around `home` (default: the first point or the spawn) for random walkable targets;
 *   wait: [min, max] seconds standing at each point; faceWithin: turn toward the player when closer than this (m);
 *   showWithin: hidden (and not animated) farther than this from the player (default 40 m); it keeps walking.
 * @returns {Promise<{character, walker, nav, target: number[]|null, paused: boolean, stop(): void, resume(): void,
 *          near(pos, d?): boolean, dispose(): void}>}
 */
export async function patrol(p, character, { points, wander, home, speed = 1.3, wait = [0.5, 2.5], loop = true, height, tint, faceWithin = 0, showWithin = 40, seed = 1, shadow = true } = {}) {
  const geo = p.geo, R = makeRng(seed);
  const ch = typeof character === 'string' ? await loadCharacter(character, { height, tint }) : character;
  if (!points?.length && !wander) throw new Error('patrol: give points [[x, y], ...] or wander: radius');
  const h = home || points?.[0] || p.spawn();
  const start = geo.nearestWalkable(h[0], h[1], 0.3) || [h[0], h[1], geo.groundAt(h[0], h[1])];
  const walker = new Walker(p, { character: ch, position: start, speed, runSpeed: speed });
  const nav = new Navigator(p, walker, { run: false, lookahead: 0.6 });
  const sh = shadow ? addShadow(p, ch.root, { radius: ch.height * 0.35 }) : null;
  let i = 0, dirn = 1, rest = R() * (wait[1] - wait[0]) + wait[0];
  const pick = () => {
    if (points?.length) {
      if (points.length > 1) {
        if (loop) i = (i + 1) % points.length;
        else { if (i + dirn < 0 || i + dirn >= points.length) dirn = -dirn; i += dirn; }
      }
      return points[i];
    }
    for (let k = 0; k < 40; k++) {
      const a = R() * Math.PI * 2, d = Math.sqrt(R()) * wander, x = start[0] + Math.cos(a) * d, y = start[1] + Math.sin(a) * d;
      if (geo.walkable(x, y, 0.3) && geo.findPath([walker.position.x, walker.position.y], [x, y], 0.2)) return [x, y];
    }
    return [start[0], start[1]];
  };
  const npc = {
    character: ch, walker, nav, target: points?.length ? points[0] : null, paused: false,
    stop() { npc.paused = true; }, resume() { npc.paused = false; },
    near(pos, d = 2) { return Math.hypot(pos.x - walker.position.x, pos.y - walker.position.y) < d && Math.abs(pos.z - walker.position.z) < 2; },
    dispose() { gone = true; sh?.dispose(); ch.dispose(); },
  };
  if (p.player === walker) p.player = undefined; // the first Walker claims p.player; an NPC must not
  let gone = false, stuckFor = 0;
  const still = { x: 0, y: 0 };
  p.onUpdate((dt) => {
    if (gone || p.state === 'paused' || p.state === 'loading') return;
    const P = walker.position, pl = p.player?.position;
    ch.root.visible = !pl || P.distanceTo(pl) < showWithin;
    if (faceWithin && pl && npc.near(pl, faceWithin)) { // stop and look at the player
      walker.update(dt, { move: still, jump: false, run: false });
      walker.heading = Math.atan2(pl.y - P.y, pl.x - P.x); return;
    }
    if (npc.paused || !npc.target || rest > 0) {
      rest -= dt; walker.update(dt, { move: still, jump: false, run: false });
      if (!npc.paused && rest <= 0 && !npc.target) npc.target = pick();
      return;
    }
    const d = nav.goTo(npc.target[0], npc.target[1], 0, { apply: false, dt });
    walker.update(dt, { yaw: 0, move: nav.move, jump: false, run: false });
    stuckFor = nav.stuck > 0.5 ? stuckFor + dt : 0;
    if (d < 0.5 || stuckFor > 3) { // arrived (or cannot get there): wait, then go on
      npc.target = null; stuckFor = 0; rest = R() * (wait[1] - wait[0]) + wait[0];
    }
  });
  return npc;
}
