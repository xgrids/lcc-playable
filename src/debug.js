// Debug overlay: `?debug` in the page URL, or press ` (backquote) to toggle.
// Shows fps, frame time (avg / worst over the last second), main-thread time per frame (game + SDK + draw
// submit; when it is far below the frame time, the GPU is the bottleneck), resolution, splat budget, quality
// steps, state, player position and the ground under it, geometry source, draw calls.
export function createDebug(p, { on = false, signal } = {}) {
  const el = document.createElement('pre');
  Object.assign(el.style, {
    position: 'fixed', left: '8px', bottom: '8px', margin: 0, padding: '6px 8px', zIndex: 30, pointerEvents: 'none',
    font: '12px/1.35 ui-monospace, Menlo, Consolas, monospace', color: '#cfe', background: 'rgba(0,0,0,.55)',
    borderRadius: '4px', whiteSpace: 'pre', display: on ? 'block' : 'none',
  });
  document.body.appendChild(el);
  addEventListener('keydown', (e) => { if (e.code === 'Backquote') { on = !on; el.style.display = on ? 'block' : 'none'; } }, { signal });
  signal?.addEventListener('abort', () => el.remove());
  let frames = [], work = [], last = 0;
  const f1 = (v, n = 1) => (Number.isFinite(v) ? v.toFixed(n) : '-');
  return {
    get on() { return on; },
    /** Called once per frame by the loop: frame interval and main-thread work, in ms. */
    frame(frameMs, workMs) {
      frames.push(frameMs); work.push(workMs);
      const now = performance.now();
      if (!on || now - last < 250) { if (frames.length > 240) { frames = frames.slice(-120); work = work.slice(-120); } return; }
      last = now;
      const n = Math.min(frames.length, Math.max(1, Math.round(1000 / (frames.reduce((a, b) => a + b, 0) / frames.length))));
      const fr = frames.slice(-n), wk = work.slice(-n);
      const avg = fr.reduce((a, b) => a + b, 0) / fr.length, worst = Math.max(...fr), cpu = wk.reduce((a, b) => a + b, 0) / wk.length;
      const c = p.renderer.domElement, q = p.quality || {}, P = p.player?.position;
      const g = P && p.geo ? p.geo.groundAt(P.x, P.y) : NaN;
      el.textContent = [
        `fps ${f1(1000 / avg, 0)}   frame ${f1(avg)} ms (worst ${f1(worst)})   main thread ${f1(cpu)} ms`,
        `canvas ${c.width}x${c.height} @${f1(p.renderer.getPixelRatio(), 2)}   splats ${f1((q.maxSplats || 0) / 1e6, 1)} M   quality steps ${q.steps ?? 0}`,
        `state ${p.state}   time ${f1(p.playTime)} s   score ${p.score}   draws ${p.drawCalls ?? '-'}`,
        P ? `player ${f1(P.x, 2)}, ${f1(P.y, 2)}, ${f1(P.z, 2)}   ground ${f1(g, 2)}   above ${f1(P.z - g, 2)} m` : 'player -',
        p.geo ? `geometry ${p.geo.source} (${p.geo.ms} ms)` : 'geometry loading',
      ].join('\n');
      frames = frames.slice(-n); work = work.slice(-n);
    },
  };
}
