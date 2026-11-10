# LCC Web SDK version

lcc-playable renders scenes with the **LCC Web SDK** from XGRIDS. The SDK is closed source and is not in this
repository. `npm run setup` downloads it from the XGRIDS download server and puts `lcc-sdk-three.js` and its type
declarations into `vendor/lcc-web-sdk/` (git-ignored).

| | |
|-|-|
| Version | **0.6.4** (pinned in `tools/setup.mjs`, written to `vendor/lcc-web-sdk/VERSION`) |
| Source | the official release, https://www.xgrids.com/us/support/download/lcc-for-web |
| Check | sha256 of the zip; setup stops on a mismatch |
| Terms | XGRIDS terms. The SDK may be redistributed inside your game (`npm run build` includes it). |

Without network access to the download server, download the same version from the page above and put
`sdk/lcc-sdk-three.js` from the zip into `vendor/lcc-web-sdk/`. Other versions are not tested.

## What lcc-playable uses

- `LCCRender.load({camera, scene, renderer, renderLib, canvas, dataPath, appKey, useEnv, useIndexDB, loadingEffect,
  maxSplats, pixelRatio, maxHostCacheSize, maxGpuCacheSize, ...})`, `LCCRender.update()`, `LCCRender.unload()`,
  `LCCRender.dispose()`.
- On the loaded scene: `setMaxSplats`, `setLodAutoLevelUp`, `checkFrameStable`, `intersectsRayFromOriginExt`
  (collision rays), `raycastFromOrigin` (splat rays).

Not used: the clip calls (`setClipBox`, `setClipPrism`, `setClipPlane`). In 0.6.4 tests on the Stanford sample, any
box or prism also removed the environment (sky) splats, and planes along Z cut either the whole scene or nothing, so
they could not remove floating splats above a scene. For dark blobs in the sky, use `sky: 'plain'` (docs/api.md).

Everything else (ground, walkability, collision for scenes without a mesh, cameras, physics) is lcc-playable's own code
and reads the scene files directly. Issues found in 0.6.4 and reported to XGRIDS are worked around in that code; when
an SDK release fixes one, the workaround can go.

## Scene format

The scene files follow the open [LCC2 format](https://github.com/xgrids/LCC2Whitepaper) from XGRIDS (version 0.0.3 in
the samples): the `.lcc2` JSON, splats in `data/3dgs/*.sog`, collision meshes as PLY, and `.btree` BVH files.
lcc-playable reads the JSON, the PLY meshes and the `.sog` files itself, without the SDK. Use the white paper, and the
other repositories at https://github.com/xgrids, when you need more than the SDK offers; the SDK is not planned to
get editing calls. The white paper has its own license terms: games show "Data Organization Format originated from XGRIDS" on the
loading screen (`src/ui.js`), and the build writes the other notices to `THIRD_PARTY_NOTICES.txt`.

## Upgrading

lcc-playable follows the official SDK releases. To move to a new version:

1. In `tools/setup.mjs`, set `version`, `url` and `sha256` of the new zip (`sha256sum LCC-Web-<version>.zip`).
2. `npm run setup -- --force`.
3. Read the SDK's release notes and `vendor/lcc-web-sdk/lcc-sdk-three.d.ts` for changes to the calls listed above.
4. `npm run lint && npm run typecheck && npm test`, then run the four examples with `npm run check -- games/<id> --auto`
   on a scene with a collision mesh and on one without (see [CONTRIBUTING.md](../CONTRIBUTING.md)), and one build with
   `npm run check -- dist/<id> --dist --auto`.
5. Update the version in this page and add a `CHANGELOG.md` entry.

Games you already built keep the SDK version they were built with; rebuild them to update.
