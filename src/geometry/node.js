// Node: build or load scene geometry for the CLI. Local scene folders and http(s) URLs.
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parsePly, buildGeometry } from './prep.js';
import { readPrep, prepFiles, PREP_DIR } from './files.js';

const exists = (p) => access(p).then(() => true, () => false);

/** Read a scene file: local folder or URL. */
export function sceneReader(scene) {
  if (scene.kind === 'url') {
    const base = scene.url.slice(0, scene.url.lastIndexOf('/') + 1);
    return async (rel) => { const r = await fetch(base + rel); if (!r.ok) throw new Error(`${base + rel}: HTTP ${r.status}`); return new Uint8Array(await r.arrayBuffer()); };
  }
  return async (rel) => new Uint8Array(await readFile(join(scene.dir, rel)));
}

/**
 * Compute geometry (no caching): from collision meshes, or, for scenes without one, with `splats(scene)`, which
 * estimates it from the splats in a browser (WebP decoding; tools/splatgeo.mjs passes a headless Chromium one).
 */
export async function computeGeometry(scene, { res = 0.2, log = () => {}, splats } = {}) {
  const get = sceneReader(scene);
  const meta = JSON.parse(new TextDecoder().decode(await get(scene.meta)));
  const files = meta.root?.meshFiles || [];
  if (!files.length) {
    if (!splats) throw new Error('scene has no collision mesh (root.meshFiles is empty); estimating it from the splats needs a browser');
    log(`no collision mesh: estimating ground from the splats for ${scene.name} (headless Chromium) ...`);
    return splats(scene, { res });
  }
  const meshes = []; let next = 0;
  await Promise.all(Array.from({ length: 8 }, async () => { while (next < files.length) { const i = next++; meshes[i] = parsePly(await get(files[i])); } }));
  // the trajectory is optional (a missing file gives null)
  const poses = await get('info/poses.json').then((b) => JSON.parse(new TextDecoder().decode(b)), () => null);
  return buildGeometry(meshes, poses, { res, log });
}

/** Write geometry as a prep/ folder. */
export async function writePrep(dir, g) {
  await mkdir(dir, { recursive: true });
  for (const [name, bytes] of prepFiles(g)) await writeFile(join(dir, name), bytes);
}

/**
 * Geometry for CLI use. Local scenes: <dir>/prep/ if present, else compute and write it there.
 * URL scenes: computed once and cached under <root>/.cache/geometry/<hash>/.
 */
export async function getGeometry(scene, { cacheRoot, log = () => {}, splats } = {}) {
  const dir = scene.kind === 'local' ? join(scene.dir, PREP_DIR) : join(cacheRoot, 'geometry', createHash('sha1').update(scene.url).digest('hex').slice(0, 16));
  // prep v1 trusted every capture pose (also chairlift and vehicle rides): rebuild it
  const stale = async () => !(await exists(join(dir, 'grid.json'))) || JSON.parse(await readFile(join(dir, 'grid.json'), 'utf8')).version < 2;
  if (await stale()) {
    log(`computing geometry for ${scene.name} ...`);
    await writePrep(dir, await computeGeometry(scene, { log, splats }));
  }
  return readPrep(async (f) => { const b = await readFile(join(dir, f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
}
