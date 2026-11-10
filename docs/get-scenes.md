# Getting a scene and giving it to your agent

lcc-playable does not download scenes, and coding agents should not either. You get the scene, put it on your machine,
and tell the agent where it is.

## Option 1: your own capture

Export the scene from XGRIDS LCC as `.lcc2` (Z up, meters, with the collision mesh if the scanner has LiDAR; see
[scene-data.md](scene-data.md)). You get a folder or a zip with a `.lcc2` file, a `data/` folder and usually
`info/poses.json`.

## Option 2: XGRIDS sample scenes

1. Open the sample data page of the XGRIDS developer site:
   https://developer.xgrids.com/#/download?page=sampledata
2. Register and log in (downloads need an account).
3. Pick a scene and download it in LCC format (`.lcc2`). Scenes are a few hundred MB to several GB.
4. Keep the zip, or extract it; both work.

**Terms.** Sample scenes may be used for testing, learning and evaluation. They are not licensed for commercial use.
Do not publish games built on them commercially; use scenes you captured or have the rights to.

## Giving the scene to the agent

Tell the agent where the file is and what to call it. For example:

> The scene is at `~/Downloads/campus.zip`. Import it as `campus` and make an explore game in it.

The agent runs:

```sh
npm run scene -- add ~/Downloads/campus.zip --name campus   # a zip is extracted into scenes/campus/
npm run scene -- add ~/scans/campus --name campus           # a folder is linked, not copied (--copy to copy)
npm run scene -- info campus                                # size, walkable area, and the `data` checks
```

You can also run these commands yourself and then tell the agent the scene name. `npm run scene -- list` shows what is
imported.

Notes:
- `scenes/` is git-ignored: scene data is never committed.
- A linked folder stays where it is; lcc-playable writes its precomputed geometry into `<folder>/prep/`.
- **WSL**: files downloaded in Windows are under `/mnt/c/Users/<you>/Downloads/`. Importing from there works, but
  loading is faster from the Linux file system: copy the zip into WSL first, or use `--copy`.
- The first scene command on a new scene computes its walkable geometry, once (on the test machine: 4 s for the
  Stanford sample, 7 s for the NWU sample, which has no collision mesh).
