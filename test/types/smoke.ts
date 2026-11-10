// Type smoke test: the declarations in src/index.d.ts compile against the way the examples and docs use them.
// `npm run typecheck`. Not executed.
import { createPlayable, Walker, Navigator, Flyer, FollowCamera, FirstPersonCamera, createPhysics, sfx, rng, clock, onFrame, assetUrl } from 'lcc-playable';
import { loadCharacter, makeRoad, placeAlong, collectibles, beacon, label, minimap, patrol, shadow, toon, outline } from 'lcc-playable/kit';
import type { Playable, Route } from 'lcc-playable';
import type { Npc } from 'lcc-playable/kit';

async function main() {
  const p: Playable = await createPlayable({ scene: '/scenes/x/scene.lcc2', title: 'T', strings: { play: '开始', newBest: '新纪录' }, bestKey: false, lowerIsBetter: true });
  const route: Route = p.geo.route({ step: 1 });
  const p2 = await createPlayable({ scene: '/scenes/x/scene.lcc2', sky: 'plain' }); await createPlayable({ scene: 'y', sky: [0x4f8fdc, 0xd6e6f2] });
  const sh = shadow(p2, p2.scene, { radius: 0.5, ground: (x, y) => x + y }); sh.update(); sh.dispose();
  const s = route.sample(10); const yaw: number = s.yaw;
  const coins = collectibles(p, placeAlong(p.geo, route, 12), { onCollect: () => sfx('coin') });
  const left: number = coins.left;
  const hero = await loadCharacter('human', { height: 1.7 });
  const walker = new Walker(p, { character: hero, position: [s.x, s.y, s.z] });
  const cam = new FollowCamera(p, { distance: 4 });
  const nav = new Navigator(p, walker, { repath: 2 });
  const map = minimap(p, { range: 30 }); map.track(coins.items, { color: '#fc3', edge: true }); map.visible = false;
  const npc: Npc = await patrol(p, 'robot', { wander: 6, faceWithin: 3 });
  if (npc.near(walker.position)) npc.stop();
  const b = beacon(p, [0, 0, 0], { label: 'Go' }); b.visible = false;
  const sign = label('你好'); sign.setText('再见', 'sub');
  const road = makeRoad(p.geo, route.points, { width: 2 }); const w: number = road.at(5).width;
  const fp = new FirstPersonCamera(p); const f: number = fp.forward[0];
  const fly = new Flyer(p, { minAltitude: 3 }); const alt: number = fly.altitude;
  const phys = await createPhysics(p); await phys.sceneReady({ timeout: 5000 }); phys.dispose();
  p.input.tap('jump'); p.input.setMove(0, 1); p.input.setHeld('run', true);
  p.onStart(() => walker.teleport(s.x, s.y, yaw));
  p.onUpdate((dt) => { walker.update(dt, { yaw: cam.yaw }); cam.update(dt, walker.position, walker.heading); nav.goTo(0, 0, cam.yaw, { apply: false }); });
  p.setAutopilot((dt) => { void dt; });
  p.onLateUpdate((dt, q) => { void dt; void q.camera; });
  const off: () => void = onFrame((dt) => { void dt; }); off();
  const au: string = assetUrl('characters/manifest.json'); void au;
  const best: number | null = p.best; const isBest: boolean = p.recordScore(10);
  const r = rng(1)(); const c: string = clock(12); const m = outline(new p.THREE.Mesh(undefined, toon(0xff0000)));
  await p.win('ok', { sound: false }); if (p.result) { const nb: boolean = p.result.newBest; void nb; }
  p.dispose();
  void [left, w, f, alt, best, isBest, r, c, m];
}
void main;
