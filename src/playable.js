// createPlayable: one call that sets up everything a game on an LCC scene needs.
import * as THREE from 'three';
import { LCCRender } from '@xgrids/lcc-sdk-three';
import { loadGeometry } from './geometry/load.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { sceneUrl } from './config.js';
import { tickers } from './frame.js';
import { createDebug } from './debug.js';
import { sfx } from './util.js';

/**
 * @typedef {'loading'|'title'|'playing'|'paused'|'won'|'lost'} PlayState
 *
 * @param {object} opt
 * @param {string} opt.scene URL or path of the scene's .lcc2 file. `?scene=` in the page URL overrides it.
 * @param {string} [opt.title] game title on the start card. Omit (or autoStart) to start immediately.
 * @param {string} [opt.subtitle]
 * @param {string} [opt.instructions] controls / goal text on the start card
 * @param {boolean} [opt.autoStart] skip the start card. `?auto` (autopilot) also skips it.
 * @param {number} [opt.maxSplats=3000000] splat budget (lower for phones)
 * @param {boolean} [opt.env=true] render the environment (sky) splats
 * @param {'scene'|'plain'|[number, number]} [opt.sky='scene'] 'scene': the captured sky (environment splats; may hold dark
 *   floaters). 'plain' or [zenith, horizon] colors: no environment splats, a gradient sky instead
 * @param {'auto'|'prep'|'runtime'} [opt.geometry='auto'] where walkable ground comes from (see loadGeometry)
 * @param {number} [opt.fov=65]
 * @param {number} [opt.pixelRatio=1] max render resolution per CSS pixel. Splats are fill-rate heavy: 2 on a
 *   high-DPI screen renders 4x the pixels (measured: 34 instead of 60 fps at 4K). `?hd` sets 2.
 * @param {boolean} [opt.adaptive=true] lower the resolution, then the splat budget, while frames take > 20 ms.
 *   Current values: p.quality.
 * @param {HTMLElement} [opt.container=document.body]
 * @param {object} [opt.strings] built-in texts (loading, play, playAgain, win, lose, paused, resume, error, reload, jump)
 *   for your language, e.g. { play: '开始', playAgain: '再来一局' }
 * @param {boolean} [opt.pauseOnBlur=true] pause when the tab is hidden, the window loses focus or the mouse is released
 * @param {{hostMB?: number, gpuMB?: number}} [opt.cache] memory the SDK may keep for streamed scene data: host (JS/CPU)
 *   and GPU, in MB. SDK defaults on desktop: 1536 / 3072 (lower on phones). The low preset uses 512 / 768.
 *   `?cache=host,gpu` overrides it.
 * @param {string|false} [opt.bestKey] localStorage key for the best score (default: derived from the title and scene);
 *   false turns it off. Higher p.score is better unless opt.lowerIsBetter.
 * @param {boolean} [opt.lowerIsBetter=false] best = lowest p.score (times, strokes)
 */
export async function createPlayable(opt = {}) {
  const q = new URLSearchParams(location.search);
  const container = opt.container || document.body;
  // every listener goes through this signal so p.dispose() removes them all
  const ac = new AbortController(), signal = ac.signal;
  const listen = (t, ev, fn, o = {}) => t.addEventListener(ev, fn, { ...o, signal });
  // preserveDrawingBuffer costs a little every frame; only checks and screenshots need it
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: !!(opt.preserveDrawingBuffer || q.has('check') || q.has('auto')) });
  const maxRatio = q.has('hd') ? 2 : opt.pixelRatio ?? 1;
  renderer.setPixelRatio(Math.min(devicePixelRatio, maxRatio));
  renderer.setSize(innerWidth, innerHeight);
  Object.assign(renderer.domElement.style, { display: 'block', touchAction: 'none' });
  Object.assign(document.body.style, { margin: 0, overflow: 'hidden', background: '#000' });
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  // plain sky: a vertical gradient behind everything, instead of the environment splats
  const sky = opt.sky === 'plain' ? [0x4f8fdc, 0xd6e6f2] : Array.isArray(opt.sky) ? opt.sky : null;
  if (sky) {
    const c = document.createElement('canvas'); c.width = 2; c.height = 256;
    const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256), hex = (v) => '#' + v.toString(16).padStart(6, '0');
    gr.addColorStop(0, hex(sky[0])); gr.addColorStop(0.55, hex(sky[1])); gr.addColorStop(1, hex(sky[1]));
    g.fillStyle = gr; g.fillRect(0, 0, 2, 256);
    scene.background = new THREE.CanvasTexture(c); scene.background.colorSpace = THREE.SRGBColorSpace;
  }
  const camera = new THREE.PerspectiveCamera(opt.fov ?? 65, innerWidth / innerHeight, 0.05, 2000);
  camera.up.set(0, 0, 1);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445544, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(10, -10, 20); scene.add(sun);
  listen(window, 'resize', () => { camera.aspect = viewCam.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); viewCam.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

  const props = new THREE.Group(); props.name = 'props'; scene.add(props);
  // Viewmodel: objects in camera space (first-person weapons, cockpit), drawn last on top of everything.
  // Coordinates: -Z forward, +X right, +Y up, meters from the eye.
  const viewScene = new THREE.Scene(), viewCam = new THREE.PerspectiveCamera(opt.fov ?? 65, innerWidth / innerHeight, 0.01, 10);
  const viewmodel = new THREE.Group(); viewScene.add(viewmodel, new THREE.HemisphereLight(0xffffff, 0x666666, 2.2));
  const vsun = new THREE.DirectionalLight(0xffffff, 1.5); vsun.position.set(1, 2, 1); viewScene.add(vsun);
  const ui = new UI(opt.strings);
  const input = new Input(renderer.domElement, { jumpLabel: ui.strings.jump, signal });
  const updates = [], starts = [], lates = [];
  const p = {
    THREE, renderer, scene, camera, props, viewmodel, ui, input, params: q,
    /** @type {PlayState} */ state: 'loading', ready: false, running: false, error: null,
    /** true when the scene has no collision mesh and its geometry is estimated from the splats. */
    estimated: false,
    /** true when the page was opened with ?auto: the game should drive itself (see setAutopilot). */
    auto: q.has('auto'),
    time: 0, playTime: 0, score: 0, fps: 60,
    /** Where the player can go: [[x, y], ...]. `npm run check` reports scene coverage from it. */
    playArea: null,
    /** Anything you want `npm run check` to see (score, lap, ...). */
    info: {},
    result: null,
    lcc: null, geo: null, meta: null, url: sceneUrl(opt.scene),
    onUpdate(fn) { updates.push(fn); return p; },
    /** Every frame, also while paused: after onUpdate and onFrame hooks (character animation), right before drawing. */
    onLateUpdate(fn) { lates.push(fn); return p; },
    /** Runs at every (re)start. Put your reset logic here. */
    onStart(fn) { starts.push(fn); return p; },
    setAutopilot(fn) { p.autopilot = fn; return p; },
    autopilot: null,
    run, start, win: (text, extra) => finish('won', text, extra), lose: (text, extra) => finish('lost', text, extra),
    /** A good spawn point [x, y, z]: start of the capture route if it is walkable, else the most open spot. */
    spawn() {
      let r = null; try { r = p.geo.route({ step: 2 }).points[0]; } catch {}
      if (r && p.geo.walkable(r[0], r[1], 0.4)) return r.slice(0, 3);
      const o = p.geo.openest(); if (!o) throw new Error('the scene has no walkable ground (check \`npm run scene -- plot\`; is the scene Z-up?)');
      return o.slice(0, 3);
    },
    /** Show only objects within `radius` of `center` (meshes do not depth-test well against far splats). */
    showNear(objects, center, radius = 40) { for (const o of objects) o.visible = o.position.distanceTo(center) < radius; },
    /** Ray against the splats themselves (finds foliage and other things the collision mesh lacks). Slower than
     *  raycast; use sparingly. Returns {point, distance} or null. */
    raycastSplats(origin, dir, maxDistance = 50, { radius = 0.05, opacity = 0.5 } = {}) {
      const L = Math.hypot(dir[0], dir[1], dir[2]) || 1;
      const h = p.lcc?.raycastFromOrigin?.({ origin: { x: origin[0], y: origin[1], z: origin[2] }, direction: { x: dir[0] / L, y: dir[1] / L, z: dir[2] / L }, maxDistance, radius, opacityThreshold: opacity });
      return h ? { point: [h.x, h.y, h.z], distance: Math.hypot(h.x - origin[0], h.y - origin[1], h.z - origin[2]) } : null;
    },
    /** Collision ray against the scene: {point, normal, distance} or null. Uses the collision mesh, or, in scenes
     *  without one (p.estimated), the grid estimated from the splats. */
    raycast(origin, dir, maxDistance = 100) {
      if (p.estimated) return p.geo?.raycast(origin, dir, maxDistance) ?? null;
      const L = Math.hypot(dir[0], dir[1], dir[2]) || 1;
      const h = p.lcc?.intersectsRayFromOriginExt?.({ origin: { x: origin[0], y: origin[1], z: origin[2] }, direction: { x: dir[0] / L, y: dir[1] / L, z: dir[2] / L }, maxDistance });
      return h ? { point: [h.point.x, h.point.y, h.point.z], normal: [h.normal.x, h.normal.y, h.normal.z], distance: Math.hypot(h.point.x - origin[0], h.point.y - origin[1], h.point.z - origin[2]) } : null;
    },
  };
  window.__playable = p;
  function showError(e, hint) { if (!p.auto) ui.error(e?.stack || e?.message || e, hint); }
  listen(window, 'unhandledrejection', (ev) => { if (p.state === 'loading' || p.error) return; p.error = String(ev.reason?.stack || ev.reason); console.error(ev.reason); showError(ev.reason, 'The game stopped because of an error in its code.'); });

  // Pause when the player leaves: tab hidden, window blurred, or the captured mouse released (Esc).
  let paused = false;
  async function pause() {
    if (paused || p.state !== 'playing' || p.auto || opt.pauseOnBlur === false) return;
    paused = true; p.state = 'paused'; input.releaseAll();
    await ui.card({ title: ui.strings.paused, button: ui.strings.resume });
    paused = false; if (p.state === 'paused') p.state = 'playing';
    if (input.pointerLock) input.lock();
  }
  p.pause = pause;
  listen(document, 'visibilitychange', () => { if (document.hidden) pause(); });
  listen(window, 'blur', () => pause());
  let wasLocked = false;
  listen(document, 'pointerlockchange', () => { const locked = document.pointerLockElement === renderer.domElement; if (wasLocked && !locked) pause(); wasLocked = locked; });

  // The SDK advances loading inside LCCRender.update(), so the loop must run before load() is called.
  const timer = new THREE.Timer();
  // Adaptive quality: after two 2 s windows in a row averaging over 20 ms per frame (under 50 fps; worst 10% ignored), step down the resolution (to 0.6),
  // then the splat budget (to 1 M). Never steps up again during the session.
  const adaptive = opt.adaptive ?? true;
  let win = [], slow = 0;
  const adapt = (d) => {
    if (p.playTime < 3) { win = []; return; } // the first seconds stream in splat detail and stall
    win.push(d); const sum = win.reduce((a, b) => a + b, 0); if (sum < 2) return;
    // mean without the worst 10% (one-off loading stalls); two slow windows in a row before stepping down
    const w = win.sort((a, b) => a - b).slice(0, Math.ceil(win.length * 0.9)), mean = w.reduce((a, b) => a + b, 0) / w.length; win = [];
    slow = mean >= 0.020 ? slow + 1 : 0;
    if (slow < 2 || !p.quality) return;
    slow = 0;
    const qy = p.quality;
    if (qy.pixelRatio > 0.6) { qy.pixelRatio = Math.max(0.6, +(qy.pixelRatio - 0.15).toFixed(2)); renderer.setPixelRatio(qy.pixelRatio); }
    else if (qy.maxSplats > 1e6) { qy.maxSplats = Math.max(1e6, Math.round(qy.maxSplats * 0.75)); p.lcc.setMaxSplats(qy.maxSplats); }
    else return;
    qy.steps++; console.info('lcc-playable: lowered quality', JSON.stringify(qy));
  };
  p.debug = createDebug(p, { on: q.has('debug'), signal });

  // WebGL context loss (GPU memory exhausted, driver reset, too many tabs): the splat data lives in GPU buffers the
  // SDK cannot rebuild in place, so stop the loop and offer a reload instead of showing a frozen frame.
  listen(renderer.domElement, 'webglcontextlost', (e) => {
    e.preventDefault(); p.contextLost = true; renderer.setAnimationLoop(null); input.releaseAll();
    console.error('lcc-playable: WebGL context lost');
    if (!p.auto) ui.error('WebGL context lost', ui.strings.contextLost); else p.error = 'WebGL context lost';
  });

  // Best score per game and scene, kept in localStorage. p.best is null until a round has finished.
  const bestKey = opt.bestKey === false ? null : opt.bestKey || `lcc-playable:best:${opt.title || location.pathname}:${p.url}`;
  const store = { get() { try { const v = bestKey && localStorage.getItem(bestKey); return v === null || v === undefined ? null : JSON.parse(v); } catch { return null; } },
    set(v) { try { if (bestKey) localStorage.setItem(bestKey, JSON.stringify(v)); } catch {} } };
  p.best = store.get();
  /** Record a finished round's score; returns true when it beats p.best. Called for you by p.win / p.lose. */
  p.recordScore = (score = p.score) => {
    if (!Number.isFinite(score) || p.auto) return false;
    if (score === 0 && p.best === null && !opt.lowerIsBetter) return false; // games that never score
    const better = p.best === null || (opt.lowerIsBetter ? score < p.best : score > p.best);
    if (better) { p.best = score; store.set(score); }
    return better;
  };
  let disposed = false;
  renderer.setAnimationLoop((ts) => {
    const w0 = performance.now();
    timer.update(ts);
    const dt = Math.min(timer.getDelta(), 0.05);
    p.time += dt; p.fps += ((1 / Math.max(1e-3, timer.getDelta() || dt)) - p.fps) * 0.02;
    input.beginFrame();
    try {
      if (p.state === 'playing') {
        p.playTime += dt;
        if (p.auto && p.autopilot) p.autopilot(dt);
        p.physics?.step(dt);
      }
      if (p.running) for (const f of updates) f(dt, p);
      for (const f of tickers) f(dt);
      for (const f of lates) f(dt, p);
      if (adaptive && p.state === 'playing') adapt(timer.getDelta());
    } catch (e) { p.error = String(e?.stack || e); console.error(e); renderer.setAnimationLoop(null); showError(e, 'The game stopped because of an error in its code.'); }
    LCCRender.update();
    renderer.render(scene, camera);
    p.drawCalls = renderer.info.render.calls;
    if (viewmodel.children.length) {
      if (viewCam.fov !== camera.fov) { viewCam.fov = camera.fov; viewCam.updateProjectionMatrix(); }
      renderer.autoClear = false; renderer.clearDepth(); renderer.render(viewScene, viewCam); renderer.autoClear = true;
    }
    p.debug.frame(timer.getDelta() * 1000, performance.now() - w0);
  });

  // Load splats and walkable geometry in parallel.
  let splatP = 0, geoP = 0;
  const progress = () => ui.loading(0.7 * splatP + 0.3 * geoP);
  // phones and low-memory devices start with a smaller splat budget and caches; ?quality=low|high overrides
  const preset = q.get('quality') || (matchMedia('(pointer: coarse)').matches || (navigator.deviceMemory || 8) <= 4 ? 'low' : 'high');
  const qc = (q.get('cache') || '').split(',').map(Number);
  const cache = { hostMB: qc[0] > 0 ? qc[0] : opt.cache?.hostMB ?? (preset === 'low' ? 512 : undefined), gpuMB: qc[1] > 0 ? qc[1] : opt.cache?.gpuMB ?? (preset === 'low' ? 768 : undefined) };
  const MB = (v) => (v > 0 ? Math.max(16, v) * 1048576 : undefined);
  try {
    const metaP = fetch(p.url).then((r) => { if (!r.ok) throw new Error(`${p.url}: HTTP ${r.status}`); return r.json(); });
    const [meta, geo] = await Promise.all([
      metaP,
      loadGeometry(p.url, { source: opt.geometry, onProgress: (v) => { geoP = v; progress(); } }),
      new Promise((ok, fail) => {
        p.lcc = LCCRender.load({
          camera, scene, renderer, renderLib: THREE, canvas: renderer.domElement,
          dataPath: p.url, useEnv: sky ? false : opt.env ?? true, useIndexDB: true, loadingEffect: false, appKey: null,
          maxHostCacheSize: MB(cache.hostMB), maxGpuCacheSize: MB(cache.gpuMB),
        }, ok, (v) => { splatP = v; progress(); }, () => fail(new Error(`failed to load scene ${p.url}`)));
        if (disposed) LCCRender.unload(p.lcc);
      }),
    ]);
    p.meta = meta; p.geo = geo;
    // no collision mesh: ground, walkability and collision rays (p.raycast, cameras, Flyer, physics) use the grid
    // estimated from the splats
    p.estimated = !(meta.root?.meshFiles?.length);
    p.quality = { preset, pixelRatio: renderer.getPixelRatio(), maxSplats: opt.maxSplats ?? (preset === 'low' ? 1_500_000 : 3_000_000), steps: 0, cache };
    p.lcc.setMaxSplats(p.quality.maxSplats);
    p.lcc.setLodAutoLevelUp(true);
    const s = p.spawn();
    camera.position.set(s[0] - 4, s[1], s[2] + 2.5); camera.lookAt(s[0], s[1], s[2] + 1.2);
  } catch (e) {
    p.error = String(e?.message || e); showError(e, 'The scene could not be loaded. Check the scene URL and that the scene folder has data/.'); throw e;
  }
  ui.hideLoading();
  p.ready = true;
  /**
   * Tear the game down: stops the loop, unloads the scene from the SDK, removes the canvas, overlays and every
   * listener. For single-page apps that open and close games; a normal game page never needs it.
   */
  p.dispose = () => {
    if (disposed) return; disposed = true;
    p.running = false; p.state = 'loading';
    renderer.setAnimationLoop(null);
    ac.abort();
    if (document.pointerLockElement === renderer.domElement) document.exitPointerLock?.();
    // unload alone leaves the SDK's root group in this scene and the next load attaches to it: release everything
    try { if (p.lcc) LCCRender.unload(p.lcc); LCCRender.dispose(); } catch (e) { console.warn('lcc-playable: unload failed', e); }
    p.physics?.dispose?.();
    for (const o of [...props.children]) o.removeFromParent();
    scene.traverse((o) => { o.geometry?.dispose?.(); for (const m of [].concat(o.material || [])) m.dispose?.(); });
    input.dispose(); ui.dispose();
    renderer.dispose(); renderer.domElement.remove();
    updates.length = 0; starts.length = 0; lates.length = 0;
    if (window.__playable === p) delete window.__playable;
  };
  return p;

  /** Call once your setup is done: shows the start card (unless autoStart / ?auto), then starts. */
  async function run() {
    if (p.running) return;
    p.running = true; p.state = 'title';
    if (opt.title && !opt.autoStart && !p.auto) await ui.title({ title: opt.title, subtitle: opt.subtitle, instructions: opt.instructions });
    start();
  }
  function start() {
    p.state = 'playing'; p.playTime = 0; p.score = 0; p.result = null;
    input.releaseAll();
    if (input.pointerLock) input.lock();
    for (const f of starts) f(p);
  }
  async function finish(state, text = '', extra = {}) {
    if (p.state !== 'playing') return;
    p.state = state; p.result = { state, text, time: +p.playTime.toFixed(2), score: p.score, ...extra };
    const prevBest = p.best, isBest = extra.best !== false && p.recordScore(p.score);
    p.result.best = p.best; p.result.newBest = isBest;
    input.clearVirtual();
    if (p.auto) return; // autopilot runs end here so `npm run check` can read p.result
    if (extra.sound !== false) sfx(state === 'won' ? 'win' : 'lose');
    await new Promise((ok) => setTimeout(ok, 800)); // let the last moment and toast be seen
    const bestLine = extra.best === false || p.best === null ? '' : isBest && prevBest !== null ? `\n${ui.strings.newBest}` : `\n${ui.strings.best}: ${p.best}`;
    await ui.end({ title: extra.title || (state === 'won' ? ui.strings.win : ui.strings.lose), text: text + bestLine });
    start();
  }
}
