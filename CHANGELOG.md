# Changelog

lcc-playable follows [semantic versioning](https://semver.org/). Before 1.0, minor versions (0.x) may change the API; the stable core is listed in `docs/api.md`.

## 0.3.0 (2026-11-10)

Added
- `p.onLateUpdate(fn)`: every frame, after all `onUpdate` callbacks and the character animation, right before drawing (also while paused). `onFrame(fn)`: a per-frame hook for modules without a playable. `assetUrl(path)`: URL of a file in the runtime assets folder. The kit now uses only these public APIs.
- `npm run lint` checks the core/kit boundary: kit files import the core only from `../index.js`, the core never imports the kit.

Changed
- `shadow(p, obj)` casts the object's own silhouette by default (`shape: 'figure'`): drawn from a fixed sun (`sun`, default high from +X +Y) into a tile of one shared 1024 px texture, laid on the ground sharp at the feet and softer away from them, with a small contact blob, tilted with the slope. A walking character casts a walking shadow. Up to 64 per game, at most 6 redrawn per frame (the others reuse their last silhouette), a disc beyond `figureWithin` (30 m). `shape: 'disc'` is the previous blob; `collectibles` use it. Cost measured in Edge on Windows (RTX 3060, frame rate uncapped): fps example with 6 robots 2.3 to 3.4 ms per frame, explore 2.2 to 2.4 ms.

## 0.2.0 (2026-11-05)

Added
- LCC2 White Paper attribution: the loading screen and every card show "Data Organization Format originated from XGRIDS" with a link to the white paper; `NOTICE`, the README and the build's `THIRD_PARTY_NOTICES.txt` carry the notices the white paper asks for.
- `docs/scene-data.md`: what to do when a scene has no collision mesh. `docs/lcc-sdk.md`: the scene format and what lcc-playable reads itself.
- `shadow(p, obj)` in the kit: soft contact shadows on the scene ground; `collectibles` and `patrol` add them by default (`shadow: false`), and all four examples use them.
- `createPlayable({ sky: 'plain' | [zenith, horizon] })`: a gradient sky instead of the environment splats, which hides dark floating blobs in captured skies.
- `docs/scene-data.md`: capture practice that makes data cleaner (loop closure, steady walking, mirrors and crowds).
- `scene info` reports `data`: the scene checked against `docs/scene-data.md` (Z up, meters, collision mesh, trajectory, size).
- Docs: `docs/get-scenes.md` (download samples, give a scene to the agent), `docs/scene-data.md` (what a playable scene needs), `docs/lcc-sdk.md` (SDK version and upgrading).
- Scenes without a collision mesh: ground, walkability, collision rays and physics are estimated from the splats (`src/geometry/sog.js` decodes `.sog` files, `splats.js` builds the grid). Runs in the browser Worker, and in headless Chromium for the CLI. `p.estimated`, `grid.source`, `geo.raycast()`, `geo.toMesh()`. `p.raycast` answers from the grid in such scenes; `safeCamera(p, ...)` and `Flyer` go through `p.raycast` (passing `p.lcc` to `safeCamera` still works). `scene add` accepts such scenes with a note; the CLI saves the estimate in `prep/`.
- `minimap(p)`: round map of the walkable ground with tracked markers (experimental).
- `patrol(p, character, {points | wander})`: NPCs that walk on their own (experimental).
- Best score per game and scene in localStorage: `p.best`, `p.recordScore()`, shown on the end card; options `bestKey`, `lowerIsBetter`.
- `p.dispose()`: removes the game completely; `createPlayable` works again afterwards (experimental).
- WebGL context loss stops the loop and shows a reload card (`p.contextLost`).
- `p.input.tap(action)`: one-frame press for autopilots.
- `cache: {hostMB, gpuMB}` option and `?cache=` for the SDK's memory caches; the low preset uses smaller caches.
- `Navigator`: `repath` distance and `dt` option; follows a goal that moves a little without a new search.
- `npm run typecheck` (TypeScript smoke test of `src/index.d.ts`), in CI.
- `docs/performance.md`: measured fps and memory, and the settings that change them.

Changed
- The library is split in two entry points. `lcc-playable` (core): `createPlayable`, `SceneGeometry`, `loadGeometry`, `Walker`, `Flyer`, `Navigator`, cameras, `createPhysics`, `Input`, `UI`, `sfx`, `rng`, `clock`. `lcc-playable/kit` (gameplay helpers): `loadCharacter`, `placeAlong`, `collectibles`, `coin`, `beacon`, `label`, `makeRoad`, `minimap`, `patrol`, `toon`, `outline`. To update, import those names from `'lcc-playable/kit'` and add `"lcc-playable/kit": "/src/kit/index.js"` to the import map in `index.html`. `p.loadCharacter` is removed: import `loadCharacter` from the kit.
- The capture trajectory (`info/poses.json`) is optional and only a hint. Poses whose camera is not 0.3–3.8 m above walkable ground (chairlifts, vehicles, drones) no longer set the ground level, the main area or the route. Without walked poses: the lowest walkable layer, the largest connected area, and `route()` tours the open areas (`route.source`). New `walkedRuns()`, `tour()`, `segments()[].longestRun`, `stats.walkedPoses`; `scene plot` shows non-walked poses in orange. Prep files are version 2; the CLI rebuilds version 1.
- `check --auto`: screenshots are spread over the whole round, the last one at its end (they used to fall in the first 12–24 s); `shotTimes` reports when each was taken. The default `--timeout` is 300 s of real time.
- Docs from an end-to-end test with three fresh agent sessions: `Navigator`, `collectibles` spin, `beacon`, `patrol` and `minimap` details; `findPath` lengths and doorways with clearance 0; round length vs. check time; saved route format; game types guided tour, delivery, hide and seek.
- `check` waits up to 60 s for `p.run()` after the scene is ready (level building on large scenes).
- `scene add` extracts zips itself (no `unzip` or `tar` needed); entries outside the target folder are refused.
- `scene shot` writes `<name>-<n>.jpg` numbered after existing files instead of overwriting `v0.jpg`… (`--name`).
- Runner example: the autopilot presses the same keys as a player. FPS example: robots chase with `Navigator`.
- Explore example: minimap and two wandering robots. The time limit follows the route length, and the route is cut at 900 m on long captures.
- Runner example: no obstacles where the lane count changes within the 12 m before them (the autopilot was hit there on long routes).
- README: screenshots of the four examples in the Stanford sample scene.
- Characters that are hidden are no longer animated.

## 0.1.0 (unreleased)

First public version.

- `createPlayable`: loads an LCC scene and its walkable geometry, title/end/pause cards, on-screen error card, adaptive quality (resolution, then splat budget), phone preset, localisable texts, `?debug` overlay.
- Scene geometry from the collision mesh and capture trajectory: ground, walkability, clearance, A* paths, routes (`route.sample`, `route.every`), open regions, coverage. Precompute with `npm run scene -- prep`.
- Characters (realistic human, cartoon robot) with automatic animation; `Walker`, `Flyer`, `Navigator`; `FollowCamera` (mouse look, kept clear of walls) and `FirstPersonCamera`.
- Props: `placeAlong`, `collectibles`, `beacon`, `label`, `coin`; `makeRoad`; Rapier physics with streamed scene collision.
- CLI: `setup`, `scene` (info, route, plot, shot, ...), `new`, `check` (headless GPU check with autopilot), `dev`, `build` (static bundle with third-party notices).
- Examples: explore, runner, fps, flight.
