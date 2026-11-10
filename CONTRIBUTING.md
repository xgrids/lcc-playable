# Contributing

Thanks for helping. Issues and merge requests or pull requests are welcome.

## Setup

```sh
npm install && npm run setup        # LCC Web SDK + headless Chromium
npm run scene -- add <scene-folder-or-zip> --name <name>   # a scene you may use for testing
```

## Before you send a change

1. `npm run lint && npm run typecheck && npm test` (no GPU needed; CI runs the same). Changed `src/index.d.ts` or `src/kit/index.d.ts`? Use the new API in `test/types/smoke.ts`.
2. If you touched `src/` or an example, run every example with its autopilot on a real scene and look at the screenshots:
   ```sh
   for ex in explore runner fps flight; do npm run new -- t-$ex --from $ex --scene <name>; npm run check -- games/t-$ex --auto; done
   ```
   Every run must report `ok: true` and `state: "won"`, at about 60 fps, with `camera.blocked: false`. Delete `games/t-*` afterwards.
3. Update `docs/api.md`, the type declarations and `CHANGELOG.md` when the API changes. `AGENTS.md` holds the rules coding agents follow: keep it short and true.

## Conventions

- **Core or kit.** The core (`src/`, `lcc-playable`) only takes what every game in a captured scene needs: scene
  loading and the game loop, ground, walkable area, collision, movement, cameras, routes, coverage, checks, the build.
  Gameplay helpers go into the kit (`src/kit/`, `lcc-playable/kit`) and may only use the public core API: kit files
  import the core only from `../index.js`, and the core never imports from the kit (`npm run lint` checks both). If a
  helper needs something the core does not export, make it public (types, `docs/api.md`, CHANGELOG) instead of
  importing an internal module. Rules for one game type go into an example or `docs/game-types.md`.

- Plain ES modules, no build step for development, no new runtime dependencies without discussion.
- Coordinates are the scene's own: Z up, meters. Headings in radians around Z, 0 = +X.
- Code and docs in English. Keep comments for the why.
- Do not commit scenes, the SDK (`vendor/`) or build output. XGRIDS sample scenes are for testing only.

## Release checklist

- The four example checks above pass; `npm run build` of one example works when served alone (`npm run check -- dist/<id> --dist --auto`).
- `CHANGELOG.md` has the version and date; `package.json` version matches.
