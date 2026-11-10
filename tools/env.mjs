// Shared paths and browser flags for the CLI tools.
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, existsSync } from 'node:fs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SCENES = resolve(process.env.LCC_SCENES || join(ROOT, 'scenes'));
export const SDK_DIR = join(ROOT, 'vendor/lcc-web-sdk');
export const SDK_FILE = join(SDK_DIR, 'lcc-sdk-three.js');
export const PORT = +(process.env.PORT || 8091);

export const SAMPLE_DATA_PAGES = [
  'https://developer.xgrids.com/#/download?page=sampledata',
];

export function listScenes() {
  try { return readdirSync(SCENES, { withFileTypes: true }).filter((d) => d.isDirectory() || d.isSymbolicLink()).map((d) => d.name).sort(); } catch { return []; }
}

// The .lcc2 file inside a local scene folder.
export function metaFile(dir) {
  const f = readdirSync(dir).find((n) => n.endsWith('.lcc2'));
  if (!f) throw new Error(`no .lcc2 file in ${dir}`);
  return f;
}

// Resolve a scene argument: a local scene name, a local folder, or an http(s) URL to a .lcc2 file.
// Returns { kind: 'local'|'url', name, dir?, url?, meta, webPath? }.
export function resolveScene(arg) {
  if (!arg) throw new Error(`missing scene. Local scenes: ${listScenes().join(', ') || '(none; run npm run scene -- add)'}`);
  if (/^https?:\/\//.test(arg)) return { kind: 'url', name: arg.split('/').slice(-2, -1)[0] || 'remote', url: arg, meta: arg.split('/').pop() };
  const dir = existsSync(join(SCENES, arg)) ? join(SCENES, arg) : resolve(arg);
  if (!existsSync(dir)) throw new Error(`scene "${arg}" not found. Local scenes: ${listScenes().join(', ') || '(none)'}`);
  const name = dir.startsWith(SCENES) ? dir.slice(SCENES.length + 1).split(/[\\/]/)[0] : null;
  const meta = metaFile(dir);
  return { kind: 'local', name, dir, meta, webPath: name ? `/scenes/${name}/${meta}` : null };
}

// Headless Chromium GPU flags. On Linux (including WSL2) ANGLE+EGL avoids falling back to SwiftShader.
// Override with LCC_CHROME_ARGS.
export function chromeArgs() {
  if (process.env.LCC_CHROME_ARGS !== undefined) return process.env.LCC_CHROME_ARGS.split(' ').filter(Boolean);
  if (process.platform === 'linux') {
    process.env.MESA_D3D12_DEFAULT_ADAPTER_NAME ||= 'NVIDIA';
    return ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'];
  }
  return ['--ignore-gpu-blocklist', '--enable-unsafe-webgpu'];
}
