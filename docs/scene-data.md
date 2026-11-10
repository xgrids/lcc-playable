# Scene data: what a playable scene needs

lcc-playable plays in `.lcc2` scenes exported from XGRIDS LCC. This page lists what it reads, what is required, and
what happens when something is missing. `npm run scene -- info <scene>` checks a scene against this list in its
`data` field (`ok`, `warn`, or `missing` for optional data).

## Checklist

| Item | Needed | Used for | Without it |
|-|-|-|-|
| `.lcc2` file with its `data/` folder (SOG splats) | required | rendering (LCC Web SDK) | nothing loads |
| Z up | required | ground, walkability, gravity, cameras | ground is not found; `info` warns |
| Meters, real scale | required | characters (1.7 m), speeds, step and headroom limits | characters look tiny or huge; `info` warns when the capture camera height is off |
| Collision mesh (`root.meshFiles`, `.ply`) | recommended | exact ground, walls, collision rays, physics | estimated from the splats; less exact under trees, at railings and thin objects ([details](api.md#scenes-without-a-collision-mesh)) |
| Capture trajectory (`info/poses.json`) | optional | picking the ground on several floors, the default route past the landmarks, coverage | ground is the lowest walkable layer, the main area is the largest connected one, routes tour the open areas |
| Size | – | frame rate and memory | above about 100 M splats, measure early ([performance.md](performance.md)) |

The checks behind `info`:
- **z-up**: the bounding box is wider than tall, and there are at least 50 m² of up-facing walkable ground.
- **meters**: the median height of the capture camera over the ground is 0.8–2.8 m (1.2–2.2 m is normal for handheld
  and backpack scanners). Needs a trajectory; without one, check a door height in `npm run scene -- shot`.

## Folder layout

What an LCC export looks like, and what lcc-playable reads from it:

```
<scene>/
  <name>.lcc2         scene description (JSON): splat levels, bounding box, root.meshFiles
  data/               splats (.sog) and, if exported, the collision mesh (.ply)
  info/poses.json     capture trajectory (optional)
  prep/               written by lcc-playable: precomputed walkable grid (see below)
```

`prep/` is written the first time a scene command (`info`, `route`, `plot`, `prep`, ...) runs, and by `npm run build`.
Games load it instead of computing the grid in every browser. Delete it after replacing the scene's files.

## Capturing a scene to play in

Recommendations for new captures meant for games. The data is usable without them, but games get better with them.

- **Walk the paths players will use**, at walking height, and close loops where you can. The trajectory becomes the
  default route, and splats are sharpest next to it.
- **Mark parts that were not walked.** Rides on vehicles, lifts or drones are recognized by height (more than 3.8 m
  above the ground) and ignored, but a ride at ground level (a cart, a boat) looks like walking.
- **Export the collision mesh** when the scanner has LiDAR. Scenes from cameras or phones without LiDAR work too; their
  ground and walls are estimated.
- **Keep Z up and real scale** in the export. Both are required.

What makes the captured data cleaner, from scanning practice (handheld LiDAR scanners):
- **Start and end at the same spot**, with the device placed the same way. This closes the loop and keeps the scene
  from drifting.
- **Walk steadily**: no sudden starts, stops or turns. Take sharp corners slowly, sideways, so both sides are seen.
- **After entering a new room or area**, pause and move the device slowly up, down and around before walking on.
- **Look behind pillars, furniture and corners** from a second direction; parts seen from one side only become holes
  in the ground and walls.
- **Plan around mirrors, glass and moving people.** Reflections and crowds become floating splats and false walls,
  which end up in the walkable area and the collision. Keep the lighting steady.
- **Sky and far background** become environment splats and often hold dark blobs. Games can hide them with
  `sky: 'plain'` ([api.md](api.md)), but a clean sky looks better.

## When a scene has no collision mesh

Nothing has to be done for most games: lcc-playable estimates the ground and obstacles from the splats
([api.md](api.md#scenes-without-a-collision-mesh)). The estimate is 2.5D (a few height layers per 0.2 m cell), so
walking, paths, routes and cameras work, while overhangs, bridges, sloped walls, railings and ground under dense trees
are less exact. When that is not enough, in this order:

1. **Ask for an export with the mesh.** If the data came from a LiDAR scanner, the developer can usually export it
   again with the collision mesh. This is the exact answer.
2. **Fit the game to the estimate.** Run `npm run scene -- plot`, keep tracks, spawns and goals on clearly walkable
   areas, and avoid gameplay under trees or on bridges.
3. **Patch the few places that matter** with simple colliders in game code (invisible boxes or ramps added to the
   physics world, blocked cells in the walk grid), instead of rebuilding the whole scene.
4. **Generate a collision mesh from the splats.** The splats are plain data: the `.lcc2` JSON and the `.sog` files are
   described in the open [LCC2 white paper](https://github.com/xgrids/LCC2Whitepaper), and `src/geometry/sog.js`
   decodes them. One way to do it:
   - decode the finest level of detail that fits in memory; drop faint (low opacity) and large (blurry) splats, and
     splats far from the capture trajectory when there is one;
   - voxelize the rest (about 0.1 m), weighting each voxel by splat opacity, and close small holes;
   - extract a surface (marching cubes; `splat-transform` at https://github.com/xgrids has an implementation) and
     simplify it;
   - check it against the splats in the viewer, then write it as binary PLY into a copy of the scene and list it in
     `root.meshFiles`. lcc-playable then treats the scene as one with a collision mesh. The LCC2 White Paper license
     asks you to mark modified files: say so in the copy's `description` and in the notes you pass on with it.

   This is a larger job than a game usually needs; do it once per scene, outside the game, and keep the result with
   the scene data.
