// The on-disk / over-the-wire layout of preprocessed geometry (`<scene>/prep/`, written by `npm run scene -- prep`).
import { SceneGeometry } from './query.js';

export const PREP_DIR = 'prep/';
export const PREP_FILES = { floor: 'floor.f32', clear: 'clear.f32', walk: 'walk.u8', dist: 'dist.f32' };

/** Load prep files with an async reader `get(name) -> ArrayBuffer`. */
export async function readPrep(get) {
  const grid = JSON.parse(new TextDecoder().decode(await get('grid.json')));
  const [floor, clear, walk, dist, poses] = await Promise.all([
    get(PREP_FILES.floor).then((b) => new Float32Array(b)),
    get(PREP_FILES.clear).then((b) => new Float32Array(b)),
    get(PREP_FILES.walk).then((b) => new Uint8Array(b)),
    get(PREP_FILES.dist).then((b) => new Float32Array(b)),
    get('poses.json').then((b) => JSON.parse(new TextDecoder().decode(b))),
  ]);
  return new SceneGeometry({ grid, floor, clear, walk, dist, poses });
}

/** Files to write for a geometry: [[name, Uint8Array]]. */
export function prepFiles(g) {
  const enc = new TextEncoder();
  const u8 = (a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  return [
    ['grid.json', enc.encode(JSON.stringify({ ...g.grid, files: PREP_FILES }, null, 1))],
    [PREP_FILES.floor, u8(g.floor)], [PREP_FILES.clear, u8(g.clear)], [PREP_FILES.walk, u8(g.walk)], [PREP_FILES.dist, u8(g.dist)],
    ['poses.json', enc.encode(JSON.stringify(g.poses))],
  ];
}
