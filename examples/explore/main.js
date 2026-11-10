// Explore & collect: walk through the real scene and pick up every coin along the capture route before time runs out.
// Shows: createPlayable, Walker + FollowCamera, the capture route, placeAlong + collectibles, a minimap, wandering NPCs,
// an autopilot for checks.
import { createPlayable, Walker, Navigator, FollowCamera, clock } from 'lcc-playable';
import { loadCharacter, placeAlong, collectibles, minimap, patrol, shadow } from 'lcc-playable/kit';

const SCENE = '/scenes/your-scene/scene.lcc2'; // `npm run new` sets this; `?scene=<url>` overrides it
const PACE = 4;           // m/s the time limit allows for (running is 6.5; corners and crowds slow players down)
const MAX_ROUTE = 900;    // meters: longer captures (campuses) are cut here, so a round stays under 4 minutes
const SPACING = 12;       // meters between coins along the route

const p = await createPlayable({
  scene: SCENE,
  title: 'Coin Walk',
  instructions: 'Collect every coin along the way.\nMouse to look around (click to capture it; Esc releases). WASD / arrows or the joystick to walk,\nShift to run, Space to jump. On phones: drag to look.',
});
const geo = p.geo;

// Route through the whole scene, following the capture trajectory (best splat quality, passes every landmark).
const route = geo.route({ step: 1, to: MAX_ROUTE });
p.playArea = route.points;
const TIME_LIMIT = Math.max(90, Math.ceil(route.length / PACE / 30) * 30); // seconds, scaled to the route

// Coins: every SPACING meters along the route, alternating sides, always on walkable ground.
// collectibles() spins them, shows only the near ones, picks them up and resets at every start.
const coins = collectibles(p, placeAlong(geo, route, SPACING));

const hero = await loadCharacter('human');
shadow(p, hero.root); // contact shadow: the character stands on the captured ground
const walker = new Walker(p, { character: hero });
const cam = new FollowCamera(p, { distance: 4, height: 2.2 });

// Minimap with the coins; two robots wandering around the middle of the route for some life.
minimap(p, { range: 30 }).track(coins.items, { color: '#ffc83d' });
for (const [n, s] of [[0, 0.3], [1, 0.6]]) { const q = route.sample(route.length * s); await patrol(p, 'robot', { wander: 6, home: [q.x, q.y], tint: [0x55ff88, 0xff5555][n], seed: n + 1 }); }

p.onStart(() => {
  const s = route.sample(0);
  walker.teleport(s.x, s.y, s.yaw);
  cam.yaw = walker.heading; cam.reset();
});

p.onUpdate((dt) => {
  if (p.state === 'playing') walker.update(dt, { yaw: cam.yaw });
  cam.update(dt, walker.position, walker.heading);
  const left = Math.max(0, TIME_LIMIT - p.playTime);
  p.info = { coins: coins.got, total: coins.total, position: walker.position.toArray().map((v) => +v.toFixed(2)) };
  p.ui.hud(`Coins ${coins.got} / ${coins.total}\nTime ${clock(left)}`);
  if (p.state === 'playing') {
    if (coins.left === 0) { p.win(`All ${coins.total} coins in ${clock(p.playTime)}.`); }
    else if (left <= 0) { p.lose(`${coins.got} of ${coins.total} coins.`); }
  }
});

// Autopilot (?auto): walk the route the coins were placed on, steering with the same input the player uses.
// `npm run check -- games/<id> --auto` plays a full round with it.
const nav = new Navigator(p, walker);
let k = 0;
p.onStart(() => { k = 0; });
p.setAutopilot((dt) => {
  const P = walker.position;
  // turn the camera like a player moving the mouse: gently toward where the character walks
  const d = walker.heading - cam.yaw; cam.yaw += Math.atan2(Math.sin(d), Math.cos(d)) * Math.min(1, dt * 2.5);
  while (k < route.points.length - 1 && Math.hypot(route.points[k][0] - P.x, route.points[k][1] - P.y) < 1.5) k++;
  // end of the route: pick up whatever was missed
  const left = k >= route.points.length - 1 && coins.nearest(P);
  if (left) nav.goTo(left.position.x, left.position.y, cam.yaw);
  else nav.goTo(route.points[k][0], route.points[k][1], cam.yaw);
});

p.run();
