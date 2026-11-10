# API reference

Two entry points:
- **`lcc-playable`, the core**: what every game in a captured scene needs. Scene loading and the game loop
  (`createPlayable`), ground, walkable area, paths, routes and coverage (`p.geo`), collision rays and physics,
  movement on the scene (`Walker`, `Flyer`, `Navigator`), cameras that stay out of walls, input, UI, autopilot hooks
  for `npm run check`.
- **`lcc-playable/kit`, gameplay helpers** (optional): characters, pickups, markers, roads, minimap, NPCs, toon style.
  See [Kit](#kit-gameplay-helpers-lcc-playablekit).

```js
import * as THREE from 'three';
import { createPlayable, Walker, Flyer, Navigator, FollowCamera, FirstPersonCamera, createPhysics,
  safeCamera, fadeOccluders, sfx, rng, clock } from 'lcc-playable';
import { loadCharacter, placeAlong, collectibles, makeRoad, toon, outline } from 'lcc-playable/kit';
```
Coordinates are the scene's native frame: **Z up, meters**. Headings/yaw are radians around Z, 0 = facing +X.
Type declarations: `src/index.d.ts`, `src/kit/index.d.ts`.

**Stability (0.x).** Everything not marked otherwise (createPlayable and `p`, SceneGeometry and routes, Walker,
Flyer, cameras, input, UI, and in the kit characters, props, roads) only changes in a minor release with a CHANGELOG entry that says how
to update. APIs marked *experimental* (`@experimental` in the types) may change in any 0.x release: `Navigator`,
`createPhysics`, `minimap`, `patrol`, `p.dispose()`, `p.raycastSplats()`.

## createPlayable(options) → Promise<p>
Creates the renderer, loads the splats and the walkable geometry (in parallel), and returns the playable `p`.

| option | default | |
|-|-|-|
| `scene` | required | URL/path of the `.lcc2` file. `?scene=` in the page URL overrides it. |
| `title`, `subtitle`, `instructions` | – | start card (skipped with `autoStart` or `?auto`) |
| `autoStart` | false | start without a card |
| `maxSplats` | 3 M (1.5 M on phones) | splat budget. `?quality=low` / `high` picks the preset |
| `env` | true | environment/sky splats |
| `sky` | `'scene'` | `'scene'`: the captured sky. `'plain'` or `[zenith, horizon]` colors (`0xRRGGBB`): a gradient sky instead of the environment splats. Use it when the captured sky has dark floating blobs (they are part of the environment splats) |
| `geometry` | `'auto'` | `'prep'`: require `prep/`; `'runtime'`: always compute |
| `fov` | 65 | |
| `pixelRatio` | 1 | max resolution per CSS pixel; splats are fill-rate bound, so 2 on high-DPI screens is about 2x slower. `?hd` = 2 |
| `strings` | English | built-in texts: `{loading, play, playAgain, win, lose, paused, resume, error, reload, jump, contextLost, best, newBest}`, e.g. `{play: '开始'}` |
| `pauseOnBlur` | true | pause when the tab is hidden, the window loses focus or the mouse is released (Esc) |
| `adaptive` | true | lowers resolution, then splat budget, while frames take > 20 ms; see `p.quality` |
| `cache` | SDK defaults | `{hostMB, gpuMB}`: memory the SDK keeps for streamed scene data (low preset: 512 / 768). See [performance.md](performance.md) |
| `bestKey` | title + scene | localStorage key for the best score; `false` turns best scores off |
| `lowerIsBetter` | false | best = lowest `p.score` (times, strokes) |

Geometry source in `'auto'` mode: `<scene>/prep/` if present (written by `npm run scene -- prep`, `info` or any other scene command, and by `build`), else IndexedDB cache, else computed in a Web Worker: from the collision mesh (about 1 s for a 2,000 m² scene, 7 s for 50,000 m²), or, for scenes without one, estimated from the splats (NWU sample, 1.6 M splats: the page was ready after 9.4 s instead of 5.1 s with prep/).

### p: lifecycle
- `p.onStart(fn)`: runs at every (re)start. Reset your state here.
- `p.onUpdate((dt, p) => …)`: every frame after `p.run()`, including on the title and end cards (check `p.state === 'playing'` for game logic).
- `p.onLateUpdate((dt, p) => …)`: every frame, also while paused and before `p.run()`, after all `onUpdate` callbacks and `onFrame` hooks (character animation), right before the frame is drawn. For work that must see the frame's final positions and poses, such as the kit's shadows. Game logic belongs in `onUpdate`.
- `p.run()`: call once at the end of setup. Shows the title card, then starts.
- `p.win(text, extra?)`, `p.lose(text, extra?)`: end the round with a win/lose sound (`extra.sound: false` to skip; `extra.title` for the card title); the end card follows after 0.8 s and offers a restart. `p.result` holds `{state, text, time, score, best, newBest, ...extra}`.
- Best score: `p.win`/`p.lose` record `p.score` in localStorage and the end card shows "Best: …" or "New best!". `p.best` (null before the first scored round). `extra.best: false` skips one round. Autopilot rounds are never recorded.
- `p.dispose()`: stops the loop, unloads the scene from the SDK, frees physics, removes the canvas, overlays and all listeners. For single-page apps that open and close games; afterwards `createPlayable` can be called again.
- WebGL context loss (GPU out of memory, driver reset): the loop stops and an error card offers a reload (`p.contextLost` is true). The splat data cannot be rebuilt in place.
- `p.state`: `'loading' | 'title' | 'playing' | 'paused' | 'won' | 'lost'`. Game logic should run only while `'playing'`; pausing then needs no code. `p.pause()` pauses by hand. `p.playTime`, `p.time`, `p.score`, `p.fps`.
- `p.setAutopilot(fn(dt))`: called every frame while playing when the page has `?auto`. Drive `p.input` from it. `p.auto` is true in that mode.
- `p.playArea = [[x, y], ...]`: where the player can go. `npm run check` reports scene coverage from it.
- `p.info = {...}`: anything you want `npm run check` to print.
- `p.player`: object with `.position` (set automatically by the first Walker/Flyer). Used by `check` for camera tests.

### p: three.js
`p.THREE`, `p.scene`, `p.camera` (Z up), `p.renderer`, `p.props` (Group for game objects: they fade when they block the camera; put things attached to the player, like a carried stack, in `p.scene` instead, or they fade all the time), `p.viewmodel` (Group drawn on top in camera space, -Z forward: first-person weapons, cockpit).

### p: scene queries
- `p.geo`: `SceneGeometry` (below).
- `p.spawn()` → `[x, y, z]`: start of the capture route, or the most open spot.
- `p.raycast(origin, dir, max = 100)` → `{point, normal, distance} | null`: against the collision mesh (fast, streamed around the camera), or, when `p.estimated`, against the estimated grid. Cameras and `Flyer` use it too.
- `p.estimated`: true when the scene has no collision mesh (see [Scenes without a collision mesh](#scenes-without-a-collision-mesh)).
- `p.raycastSplats(origin, dir, max = 50)` → `{point, distance} | null`: against the splats. Finds foliage that has no collision mesh. Costs 10-15 ms per ray on the main thread (measured, RTX 3060): a few per second at most, never every frame.
- `p.showNear(objects, center, radius = 40)`.
- `p.lcc`: the LCC Web SDK object. `p.meta`: the parsed `.lcc2`. `p.url`: scene URL.

### p.input
- `p.input.move` → `{x, y}` in [-1, 1] (x right, y forward): WASD, arrows, touch joystick.
- `p.input.held(name)`, `p.input.pressed(name)` (this frame). Actions: `jump` (Space), `run` (Shift), `fire` (left mouse, Enter), `alt` (right mouse, E), `left`, `right`, `up`, `down`, `interact` (F).
- `p.input.bind(name, ['KeyQ', 'Mouse0'], {label})`, `p.input.button(name, label)`: actions with a label get a touch button.
- `p.input.consumeLook()` → `{dx, dy}`: mouse (pointer lock or drag) / touch drag since last call.
- Autopilot: `p.input.setMove(x, y)`, `p.input.setHeld(name, bool)`, `p.input.tap(name)` (one-frame press: `pressed(name)` is true for exactly one frame, like a quick key press). Cleared at every start.
- Touch controls appear on touch devices, or with `?touch`.

### p.ui
The loading screen shows "Data Organization Format originated from XGRIDS" (required by the LCC2 White Paper license; not an option). `error(message, hint)` (full-screen error with Reload; shown for you on load and update errors) · `hud(text, slot = 'left' | 'right' | 'center')`, `toast(text, ms)` (one short line, 28 px; use your own panel for longer text), `crosshair(on)`, `title({...})`, `end({...})`, `card({title, subtitle, text, button})` → Promise.

## SceneGeometry (`p.geo`)
A 0.2 m grid computed from the scene's collision mesh, or, for scenes without one, estimated from the splats (`grid.source: 'splats'`, `p.estimated`; see below), using the capture trajectory as a hint when the scene has one (`info/poses.json` is optional). A capture pose counts as *walked* when its camera is 0.3–3.8 m above walkable ground; higher poses (chairlift, vehicle, drone) are ignored. Without walked poses, the ground is the lowest walkable layer and the main area is the largest connected one.
- `groundAt(x, y)` → height (NaN = no ground). `headroomAt(x, y)` → free height above the ground. `clearanceAt(x, y)` → distance to the nearest obstacle or step edge. `walkable(x, y, r = 0)` → walkable, in the main area (connected to the walked trajectory), ≥ r from edges. `at(x, y)` → all of these.
- `nearestWalkable(x, y, r)` → `[x, y, z] | null`. `randomPoint(r, rng)`. `openest()` → `[x, y, z, clearance]`.
- `findPath([x, y], [x, y], r)` → `[[x, y, z], ...] | null` (A*, step limit 0.25 m, prefers corridor centers). The path follows grid cells and corridor centers, so its length is 10–30% more than a `Navigator` actually walks (it cuts corners). Pass `r = 0.3` for places a `Walker` (radius 0.25) must reach: `walkable(x, y)` and `at()` are true for cells with `clearance` 0, such as doorways a Walker cannot pass; `plot` shows walkable cells cut off from the main area as blue-grey, and `walkable` is false there.
- `route({from, to, step = 1, smooth = 3, r = 0.3, seg})` → `{seg, source, length, closed, points: [[x, y, z, clearance, headroom]], at: [meters], sample(s), every(spacing, {start, end})}`: walkable route along the longest walked piece of the capture trajectory (`source: 'trajectory'`; a ride longer than 8 m splits a segment into pieces), or, without a walked trajectory, a tour through the most open areas joined by `findPath` (`source: 'regions'`, `seg: null`). `sample(s)` → `{x, y, z, yaw, clearance, headroom}` interpolated at s meters (yaw = route direction); `every(12)` → samples every 12 m. Throws a clear error for an unknown `seg`.
- `openest()` returns null when nothing is walkable.
- `segments()` → trajectory segments (fused maps have several), walked parts only: `{seg, length, longestRun, start, end, zStart, zEnd, zMin, zMax}`. Empty without a walked trajectory. `walkedRuns()` → the walked pieces. `tour({n, r})` → the open-area tour used by `route()`.
- `regions({n = 8, minRadius = 1.5})` → `[{x, y, z, radius}]` open areas.
- `coverage(playArea, reach = 6)` → `{span, areaCover, trackCover, length, segCover?}`; `trackCover` is null without a walked trajectory.
- `raycast(origin, dir, maxDistance, {wall = 2.5})` → `{point, normal, distance} | null` against the grid (ground, and cells without ground as `wall`-m walls). `toMesh(cx, cy, radius)` → `{v, f}` triangles of the grid.
- `bounds`, `trackBounds`, `stats` (`walkableM2`, `poses`, `walkedPoses`, `poseSegments`, ...). `grid.source`: `'mesh'` or `'splats'`.

### Scenes without a collision mesh
Scenes captured without LiDAR, or exported without `collision.ply`, work like any other scene; nothing changes in game code. The geometry is estimated from the splats:
- The finest level of detail with at most 4 M splats is decoded (`.sog`, SOG version 2): in the browser Worker, or in headless Chromium for the CLI (2–7 s for 1.6–3.8 M splats on the test machine). The CLI saves the result in `<scene>/prep/`, so games load it instead of estimating again.
- Flat, up-facing splats are ground; other splats are obstacles. Noise is filtered and small gaps are closed. Without a capture trajectory, the main area is the largest connected one.
- `p.raycast`, the cameras, `Flyer` and `createPhysics` use the grid: ground, and 2.5 m blocks where there is no ground.
- Accuracy, measured by hiding the LiDAR collision mesh of two scenes: walkable-area IoU 0.75 and 0.69; of the area estimated as walkable, 93% and 72% is walkable in the mesh; ground height within 0.25 m for 98% and 99% of cells. Typical misses: ground under dense trees (it reads as canopy), railings, thin poles and overhangs. Check `npm run scene -- plot` and keep tracks on clearly walkable ground.


## Movement
- `new Walker(p, {position, character, radius = 0.25, speed = 3.5, runSpeed = 6.5, jumpSpeed = 4.8, faceMove = true})`: walks on the real ground, blocked by obstacles, slides along walls, crosses stairs. `update(dt, {yaw, move, jump, run})` (defaults: `p.input`). `yaw` = what "forward" means (camera yaw). Plays idle/walk/run/jump on `character`. `teleport(x, y, heading)`. `position`, `heading`, `onGround`, `moving`.
- `new Flyer(p, {position, yaw, speed = 10, minSpeed = 5, maxSpeed = 22, minAltitude = 2.5, maxAltitude = 30, avoidSplats = true})`: arcade flight. `move.y` climbs, `move.x` turns, `run` boosts, `down` brakes. Keeps above the ground, pulls up before collision geometry and splats ahead. `safeHeight(x, y, r)` → lowest safe height there. `position`, `yaw`, `pitch`, `roll`, `speed`, `altitude`.
- `new Navigator(p, walker, {run = true, lookahead = 0.8, repath = 1})`: `goTo(x, y, yaw, {apply = true})` → remaining straight-line distance; steers toward the point through `p.input` (`setMove`, and holds `run` when `run` is true: 6.5 m/s), using A* when the straight line is blocked. `yaw` is the frame the move is expressed in (the camera yaw the player's input uses). `apply: false` only computes `nav.move` (for NPCs: `walker.update(dt, {yaw, move: nav.move})`). `nav.stuck`: seconds without progress. For autopilots and NPCs.
- `Walker` animation: `walk` below 2.5 m/s, `run` above, and `run` (or `sprint`) while `run` is held.

## Cameras
- `new FollowCamera(p, {distance = 4, height = 2.2, radius = 0.3, orbit = true, splats = false, groundClear = 1.2, sensitivity = 0.0025})`, then `update(dt, target, heading)`. Default: the mouse (pointer lock on click, drag as fallback) or touch drag turns it; move the player relative to `cam.yaw`. `orbit: false`: stays behind `heading` (runners, vehicles). Collision rays keep it out of walls (`splats: true` adds a splat ray every 6 frames for foliage, at a cost), and it stays `groundClear` above the ground under it; props in `p.props` fade when they block the view. `reset()` after teleports; set `cam.yaw` to face a direction.
- `new FirstPersonCamera(p, {height = 1.6, sensitivity})`, then `update(dt, feet)`. Pointer lock on click. `yaw`, `pitch`, `forward`.
- `safeCamera(p, target, desired, {minDist, lift, radius, splats})` → `[x, y, z]`: the low-level version, using `p.raycast`. `splats: true` also checks the splats (foliage).
- `fadeOccluders(camera, target, objects, {near = 1.2, opacity = 0.25, dt})`.

## Physics (Rapier, experimental)
`const phys = await createPhysics(p, {gravity = -9.81, radius = 45})`: loads Rapier (4.3 MB, only when called) and streams the scene's collision mesh as static colliders around `phys.focus` (default: the camera); scenes without one get the estimated grid as a mesh (ground and 2.5 m blocks). Steps itself.
- `phys.add(mesh, {shape: 'box' | 'sphere' | 'capsule' | 'cylinder', size, mass = 1, fixed, kinematic, position, restitution, friction, sensor})` → rigid body; the mesh follows it.
- `phys.raycast(origin, dir, max)` → `{point, normal, distance, mesh, body} | null` (scene and bodies).
- `phys.impulse(meshOrBody, [x, y, z], atPoint?)`, `phys.remove(meshOrBody)`, `phys.world` / `phys.RAPIER` for everything else.

## Helpers
`sfx('coin' | 'jump' | 'hit' | 'shoot' | 'win' | 'lose' | 'pop')` synthesized sounds (`?mute` silences); `rng(seed)` seeded random; `clock(seconds)` → `m:ss`.
`onFrame(fn(dt))` → `remove()`: a per-frame hook for modules that have no playable (the kit's character animation uses it); runs after every `onUpdate` callback and before `onLateUpdate`, also while paused. `assetUrl(path)`: absolute URL of a file in the runtime assets folder (`assets/` in development, `./assets/` in a build; `npm run build` copies `assets/characters/`).

## Kit: gameplay helpers (`lcc-playable/kit`)
Optional building blocks for common game types. They only use the core API above (they import the core only through `lcc-playable`'s entry; `npm run lint` checks it), so a game can use them, copy one
into its own folder and change it, or skip them. New gameplay features go here or into examples, not into the core.

```js
import { loadCharacter, placeAlong, collectibles, coin, beacon, label, makeRoad, minimap, patrol, shadow, toon, outline } from 'lcc-playable/kit';
```

### Characters
`loadCharacter(id = 'human', {height, tint, roles})` → `ch`. `id`: `'human'` (realistic, 1.5 MB, default height 1.7 m) or `'robot'` (cartoon, 0.2 MB, default 1.2 m, good for enemies and crowds), or a `.glb` URL (pass `roles` to map action names to its clips).
- `ch.root`: put in the scene; position = feet, `rotation.z` = heading.
- `ch.play(action, {fade = 0.2, once = false, speed = 1})`. Repeating the current action is free. Human actions: `idle walk run sprint jumpStart jumpAir jumpLand roll crouch crouchWalk slide hit death cheer dance punch aim shoot reload sit interact swim`. Robot: `idle walk run jump death hit cheer dance wave punch sit yes no thumbsUp`.
- Animations advance automatically for every character in the scene (`ch.update` is not needed). `ch.has(action)`, `ch.roles`, `ch.action`, `ch.mixer`.
- `ch.dispose()`: remove it for good (dead enemies). Removing `ch.root` from the scene only pauses it.
- The same id loads once; further calls clone it.

### Props: labels, markers, pickups
- `placeAlong(geo, route, spacing = 12, {side = 0.7, r = 0.45, start, end})` → `[[x, y, z]]`: walkable points along a route, alternating sides.
- `collectibles(p, points, {mesh = coin, radius = 1.4, height = 0.9, sound = 'coin', showWithin = 40, score = 1, onCollect})` → `{items, got, total, left, reset(), nearest(pos)}`: pickups collected by walking (or flying) into them, using `p.player.position`. Each item floats `height` m above its point and spins by `spin` rad/s (default 3) through `rotation.y`. coin() has `rotation.x = PI/2`, which makes that a spin around world Z (up). Give your own mesh `rotation.x = PI/2` too (and build it Y-up, as in three.js), or pass `spin: 0`; otherwise it tumbles. `score: 0` for pickups that do not add to `p.score`. `shadow` = radius of the contact shadow under each item (default 0.35), `false` for none. They update, cull and reset at every start by themselves; `p.score` counts them.
- `beacon(p, [x, y, z], {color, label, sub, radius = 1.1, height = 5, showWithin = 60})` → `{root, label, position, visible}`: a destination marker (pulsing ground ring, light column, sign). Set `visible = false` when done; reset it yourself in `onStart`. Change the sign with `b.label.setText(text, sub)`.
- `label(text, {sub, color, height = 0.8})` → camera-facing sign (`THREE.Sprite`, any language; `.setText(text, sub)`).
- `coin(color?)` → a toon coin mesh.

### Roads
`makeRoad(p.geo, centerline, {width = 2.4 | (s) => w, lanes = 1 | (s) => n, color, edgeColor, laneColor})` → `{group, length, closed, at(s), shared(s), sharedLen}`. Opaque road on the terrain; steps become ramps; overlapping parts merge. `at(s)` → `{x, y, z, tx, ty, width, shared}` at s meters. Add `road.group` to `p.scene`.

### Minimap (experimental)
`const map = minimap(p, {size = 170, range = 30, rotate = true, corner, fps = 20})`: round top-down map of the walkable ground around `p.player`, turned with the camera (`rotate: false` = +y up). Corner: bottom-right, or top-right on touch screens.
- `map.track(list, {color, size = 4, edge = false, when})`: dots for objects with `.position` (the list is read every frame). Collected pickups disappear by themselves; `edge: true` pins far markers to the rim (destinations); `when(o)` is called with each object of the list; return false to hide its dot.
- `map.untrack(t)`, `map.visible = false`, `map.dispose()`.

### NPCs (experimental)
`const npc = await patrol(p, 'robot' | 'human' | url | character, {points, wander, home, speed = 1.3, wait = [0.5, 2.5], loop = true, tint, faceWithin = 0, showWithin = 40, seed})`: an animated character that walks by itself (Walker + Navigator) on the real ground.
- `points: [[x, y], ...]` patrols in order (`loop: false` = back and forth); `wander: radius` picks random walkable targets around `home`.
- `faceWithin: 3` stops and faces the player when closer than 3 m (shopkeepers, quest givers). Farther than `showWithin` it is hidden and not animated, but keeps walking.
- NPCs keep walking on the title and end cards (they stop only while paused) and are not moved back at `onStart`: reposition them there with `npc.walker.teleport(x, y)` if a round must start the same way.
- `npc.near(pos, d = 2)` (horizontal distance < d and height difference < 2 m), `npc.stop()`, `npc.resume()`, `npc.dispose()`; `npc.walker`, `npc.nav`, `npc.character`, `npc.target`.
- For enemies that chase the player, drive your own Walker with `Navigator.goTo(x, y, 0, {apply: false})` (see the fps example).

### Shadows
`shadow(p, obj, {shape = 'figure', radius = 0.6, opacity = 0.55, fade = 6, still, ground, sun = [0.5, 0.35, 1], figureWithin = 30})` → `{mesh, update(), dispose()}`: a shadow on the scene ground under `obj`, following it every frame and tilted with the slope. `shape: 'figure'` draws `obj` from the sun into a 128 px tile of a shared texture every frame and lays that silhouette on the ground (sharp at the feet, softer away from them) with a small contact blob under the feet, so a walking character casts a walking shadow; it costs one extra small draw of `obj` per frame, and farther than `figureWithin` m from the camera it becomes the disc. `shape: 'disc'` is a soft round blob of `radius` m (cheap: use it for many small things). `sun`: direction from the ground toward the sun, Z up; use the same one for every shadow in a game, ideally matching the shadows in the captured scene. The shadow gets lighter as `obj` rises and is gone `fade` m above the ground. `ground(x, y)`: the height of the surface when it is not the scene ground (the runner passes the road height). `collectibles` (discs) and `patrol` (figures) add shadows by themselves (`shadow: false` to turn off). Call `dispose()` when the object is removed for good.

### Toon style
`toon(color, {outline = 0.03, emissive})` toon material; `outline(obj)` adds ink outlines to toon meshes.

## URL parameters
`?debug` (or the ` key) debug overlay: fps, frame and main-thread ms, resolution, splat budget, player position vs ground · `?scene=<url>` scene override · `?hd` render at up to 2x resolution on high-DPI screens · `?auto` autopilot mode (no cards; the round ends at win/lose) · `?mute` · `?touch` force touch controls · `?quality=low|high` splat budget and cache preset · `?cache=host,gpu` SDK cache sizes in MB · `?check` (set by `npm run check`) no pointer capture. In builds, `?scene` is ignored unless `PLAYABLE_CONFIG.allowSceneParam` is true, and then only same-origin scenes load.

## Build output
`npm run build -- games/<id>` writes `dist/<id>/` with `window.PLAYABLE_CONFIG = {assets, geometryWorker, scenes}` in `index.html`; `scenes` remaps scene paths written in `main.js` to their deployed location. The build includes the LCC Web SDK, which XGRIDS allows you to redistribute; without an XGRIDS appKey the SDK draws a small XGRIDS watermark in the bottom-right corner on deployed sites (not on localhost); everything else works the same.
