# Performance and memory

What a game costs, what you can turn down, and how to see it. Numbers below were measured on one scene and one
machine (RTX 3060 laptop GPU, Chromium, 1280×720, Windows/WSL2); treat them as a starting point, and measure your own
scene with `?debug` and `npm run check`.

## Measured: the Temple sample scene
Scene: 28.2 M splats in the file, 1,821 m² walkable, 966 k collision faces, 116 × 84 m.
Full round of the `explore` example (`npm run check -- games/<id> --auto`):

| setting | fps | JS heap | GPU memory over idle (peak) |
|-|-|-|-|
| default (`high`: 3 M splats, SDK caches) | 60 | 257 MB | 677 MB |
| `?quality=low` (1.5 M splats, caches 512 / 768 MB) | 59 | 307 MB | 598 MB |
| `?cache=256,384` | 60 | 228 MB | 610 MB |

- The walkable-ground grid is small: 13 bytes per 0.2 m cell, 3 MB for this scene (it grows with the scene's
  bounding area: about 0.3 MB per 1,000 m²).
- Splat budget changes after loading (`p.lcc.setMaxSplats`, adaptive quality) change the frame time, not the memory
  already allocated. Set budgets before loading (`maxSplats`, `cache`, `?quality`).
- Heap numbers vary by ±50 MB between runs (garbage collection timing).

## Knobs
| what | how | effect |
|-|-|-|
| splat budget | `createPlayable({ maxSplats })`, `?quality=low` | fewer splats drawn: faster on weak GPUs |
| SDK caches | `createPlayable({ cache: { hostMB, gpuMB } })`, `?cache=host,gpu` | caps memory for streamed scene data (SDK defaults on desktop 1536 / 3072 MB) |
| resolution | `pixelRatio` (default 1), `?hd` = 2 | splats are fill-rate bound: 2 on a 4K screen measured 34 instead of 60 fps |
| sky splats | `env: false` | skips the environment splats |
| automatic | `adaptive: true` (default) | lowers resolution (to 0.6), then the splat budget (to 1 M) after 4 s of slow frames; see `p.quality.steps` |
| geometry | `npm run scene -- prep <scene>` | ships the walkable grid, so browsers do not compute it from the collision mesh (recommended above 3 M faces) or estimate it from the splats (scenes without a collision mesh: NWU sample ready after 5.1 s with prep/, 9.4 s without) |

Phones and devices reporting ≤ 4 GB (`navigator.deviceMemory`) start with the low preset.

## Costs inside the game
- `p.raycastSplats` and `FollowCamera({ splats: true })`: 10–15 ms per splat ray on the main thread. A few per second.
- Collision rays (`p.raycast`, the cameras): cheap, use freely.
- Characters: each one is skinned and animated every frame; NPCs from `patrol` hide and stop animating beyond
  `showWithin` (40 m). The minimap redraws at 20 Hz; in a test, redrawing every frame (with two NPCs on screen) dropped the round from 60 to 46–49 fps.
- Many enemies chasing the player: `Navigator({ repath: 2 })` limits A* searches.

## Seeing it
`?debug` (or the ` key): fps, frame time (average and worst), main-thread time (much lower than the frame time means
the GPU is the bottleneck), resolution, splat budget, quality steps, player position. `npm run check` prints `fps`
and `p.quality`.

Untested so far: scenes much larger than the samples (several km²), and phones. Reports with numbers are welcome.
