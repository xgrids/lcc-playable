# Game types

Notes for the four examples and for game types without an example. Every type follows the rules in `AGENTS.md`: the scene is the star, real scale, solid roads, unblocked camera, and an autopilot that wins `npm run check --auto`.

## Explore & collect (`examples/explore`)
Walk the capture route and collect items placed along it, against a timer. Best default when the scene is small, irregular, or the developer just wants to show the place. Variations: hidden objects near landmarks (place them at `shot` positions you identified), photo spots, a treasure hunt with clues, NPC quests (`loadCharacter('robot')` standing at `regions()`).
- Place items with `route.points` spaced 10–15 m, nudged sideways within `clearanceAt`.
- Autopilot: follow the route with `Navigator`, then pick up anything missed.

## Runner / parkour (`examples/runner`)
Auto-run along a `makeRoad` track built on `geo.route()`. Lanes follow the scene width (`clearanceAt`), 1–3 lanes. Walls to jump, bars to slide under, coins. Reference: 404 m route in a 1,800 m² temple, one round 53 s at 7.5 m/s.
- Use `route.steps_m` from `npm run scene -- route` as natural jump spots.
- Skip obstacles where `road.shared(s)` is true (the route overlaps itself).
- Autopilot: look up the next obstacle group, move to the free lane, otherwise jump or slide at the right distance.

## First-person shooter (`examples/fps`)
Waves of robot enemies in the most open area (`geo.regions()[0]`), a toon blaster in `p.viewmodel`, physics crates that react to shots. Keep weapons cartoonish (`toon()` + `outline()`, bright colors, no realistic guns).
- Hitscan: `p.raycast` for the wall distance, then a distance-to-ray test against enemy bodies; `phys.raycast` for crates.
- Enemies: `Walker` with a robot character, `findPath` every second toward the player.
- Variations: target practice with pop-up targets, paintball, capture the flag between `regions()`.
- Autopilot: turn toward the nearest enemy, fire when on target and in line of sight.

## Flight tour (`examples/flight`)
A small toon plane flies through rings over the capture route: a scenic lap. Its shadow on the ground (radius 1.2, `fade: 12`) shows how low it flies. Good for showing a whole scene quickly, and for large outdoor scenes. Variations: drone photo tour, glider, bird, balloon.
- Keep it low: 5–8 m over the route. Splats far from the capture path or high above it are blurry.
- Ring height: `Flyer.safeHeight` over the route ±20 m, plus a splat ray from above for tree canopies (foliage often has no collision mesh). Re-check when the plane gets close, because detailed splats load near the camera.
- Chase camera with `safeCamera(..., {splats: true})` every few frames, so trees do not fill the view.
- Autopilot: follow the route points, aim straight at the next ring when close.

## Guided tour (no example)
Walk to landmarks one after another; each shows a short text when reached. The game type most specific to captured places (campus, museum, property, shop). Start from `examples/explore`.
- Identify landmarks with `shot` along the route, then pick route meters near them. Only the next `beacon` is visible; a minimap marker with `edge: true` and the distance on the HUD guide the player.
- Long texts: your own panel (DOM element over the canvas), not `p.ui.toast` (one line). Do not pause the game for it.
- No lose condition is fine; record the time as the best score (`lowerIsBetter`).
- Captures often walk back the way they came: skip such stretches by joining route pieces with `findPath`.

## Delivery / courier (no example)
Pick up parcels and bring them to landmarks before time runs out. Start from `examples/explore`.
- Plan the round at startup: a greedy tour through pickups and drops with `findPath`, then set the time limit from its length (about 5 m/s plus a margin; `findPath` lengths are 10–30% longer than the walk).
- Carried parcels attached to the player go in `p.scene`, not `p.props` (they would fade all the time).
- Without a trajectory, check with `plot` that the drop points are in one connected area.

## Hide and seek / treasure hunt (no example)
Find hidden items in a time limit, with patrolling NPCs as a threat. Start from `examples/explore`.
- Hide items next to obstacles: from route points, step 2–6 m sideways to a walkable spot with low `clearanceAt`, and keep only spots `findPath` reaches without a long detour. Spread them with farthest-point selection (routes loop back on themselves).
- A HUD arrow or minimap toward the nearest item keeps a large scene findable in a few minutes.
- `patrol` NPCs keep walking on the title and end cards: reposition them in `onStart`.

## Ski / downhill (no example)
For scenes with a real slope: ski halls, mountain roads, stadium stands, ramps.
- Pick the trajectory segment with the largest height drop: `npm run scene -- info` lists `segments` with `zStart`/`zEnd`. Fused maps have many; choose by length and drop, do not screenshot every segment.
- Track: `makeRoad` along `geo.route({seg})`, run from the high end to the low end (reverse the points if needed).
- Speed from slope: `v += (g * sin(slope) - drag * v) * dt`, slope from `groundAt` along the road. Gates or flags at `road.at(s)`, alternating sides; jumps at `steps_m`.
- Character: `human` with `crouch` while carving; skis are thin toon boxes on an extra Group around `ch.root`, tilted with the slope.
- Autopilot: steer to the next gate's side, like the runner.

## Racing / karting (no example)
Like the runner, but the player steers freely on a wide `makeRoad` (`width` from `clearanceAt × 2`), with a kart built from toon primitives. Laps on closed routes (`route.closed`). Opponent karts: robots following the centerline with an offset.

## Puzzle / physics (no example)
Rapier crates, balls and dominoes in open `regions()`: knock targets down, push blocks onto pads, bowling. `createPhysics` streams scene collision around the camera, so props rest on real steps and walls.
