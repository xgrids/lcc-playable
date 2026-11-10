// Minimap: a round top-down map of the walkable ground around the player, turned with the camera, with markers.
//
//   const map = minimap(p, { range: 30 });
//   map.track(coins.items, { color: '#ffc83d' });                  // taken pickups disappear by themselves
//   map.track([goal.root], { color: '#4dd2ff', size: 6, edge: true, when: () => goal.visible });
//
// The map image is drawn once from p.geo (walkable = light, open = lighter); every frame only a rotated crop is
// copied (about 0.1 ms). Markers beyond the range are dropped, or pinned to the rim with `edge: true`.

const SIDE = 2048; // largest side of the cached map image (px)

/**
 * @param {object} p the playable
 * @param {{size?: number, range?: number, rotate?: boolean, corner?: 'top-right'|'bottom-right'|'top-left'|'bottom-left', opacity?: number, fps?: number}} [opt]
 *   size: diameter in CSS px (default 170); range: meters from the center to the rim (default 30);
 *   rotate: turn with the camera so "up" is where the camera looks (default true).
 */
export function minimap(p, { size = 170, range = 30, rotate = true, corner, opacity = 0.9, fps = 20 } = {}) {
  const geo = p.geo;
  corner ??= p.input.touch ? 'top-right' : 'bottom-right';
  // ---- static map image from the walkability grid ----
  const k = Math.max(1, Math.ceil(Math.max(geo.W, geo.H) / SIDE)); // grid cells per image pixel
  const iw = Math.ceil(geo.W / k), ih = Math.ceil(geo.H / k);
  const img = document.createElement('canvas'); img.width = iw; img.height = ih;
  const ig = img.getContext('2d'), data = ig.createImageData(iw, ih), px = data.data;
  for (let j = 0; j < ih; j++) for (let i = 0; i < iw; i++) {
    let best = 0, open = 0;
    for (let b = 0; b < k; b++) for (let a = 0; a < k; a++) {
      const ci = i * k + a, cj = j * k + b; if (ci >= geo.W || cj >= geo.H) continue;
      const c = cj * geo.W + ci, w = geo.walk[c];
      if (w === 1) { best = 2; open = Math.max(open, geo.dist[c]); } else if (best < 1 && !Number.isNaN(geo.floor[c])) best = 1;
    }
    const o = (j * iw + i) * 4; // row j = grid row j; drawn in world units, so no flip here
    if (best === 2) { const t = Math.min(1, open / 2); px[o] = 120 + 90 * t; px[o + 1] = 140 + 90 * t; px[o + 2] = 150 + 80 * t; px[o + 3] = 255; }
    else if (best === 1) { px[o] = 55; px[o + 1] = 60; px[o + 2] = 70; px[o + 3] = 255; }
    else px[o + 3] = 0;
  }
  ig.putImageData(data, 0, 0);
  const mpp = geo.res * k; // meters per image pixel

  // ---- on-screen canvas ----
  const dpr = Math.min(2, devicePixelRatio || 1);
  const cv = document.createElement('canvas'); cv.width = cv.height = Math.round(size * dpr);
  const [v, h] = corner.split('-');
  Object.assign(cv.style, { position: 'fixed', [v]: v === 'top' ? '44px' : '16px', [h]: '16px', width: size + 'px', height: size + 'px',
    borderRadius: '50%', zIndex: 11, pointerEvents: 'none', opacity, boxShadow: '0 2px 12px rgba(0,0,0,.5)', background: 'rgba(10,14,20,.75)' });
  document.body.appendChild(cv);
  const g = cv.getContext('2d');
  const tracked = [];
  const dir = new p.THREE.Vector3();
  let shown = true, acc = 1;

  const map = {
    canvas: cv, range,
    /**
     * Show objects as dots. `list`: Object3D[] (or objects with .position), read every frame so you can add to it.
     * when(o): show this one (default: not taken by collectibles, still in the scene).
     */
    track(list, { color = '#ffc83d', size: s = 4, edge = false, when } = {}) { const t = { list, color, size: s, edge, when }; tracked.push(t); return t; },
    untrack(t) { const i = tracked.indexOf(t); if (i >= 0) tracked.splice(i, 1); },
    set visible(on) { shown = on; cv.style.display = on ? 'block' : 'none'; },
    get visible() { return shown; },
    dispose() { cv.remove(); tracked.length = 0; },
  };
  p.onUpdate((dt) => {
    if (!shown || (acc += dt) < 1 / fps) return; // redrawing every frame costs frames (canvas compositing)
    acc = 0;
    const P = p.player?.position || p.camera.position;
    p.camera.getWorldDirection(dir);
    const yaw = rotate && Math.hypot(dir.x, dir.y) > 1e-3 ? Math.atan2(dir.y, dir.x) : Math.PI / 2;
    const W = cv.width, R = W / 2, s = R / range; // canvas px per meter
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, W);
    g.save(); g.beginPath(); g.arc(R, R, R, 0, Math.PI * 2); g.clip();
    // world -> canvas: center on the player, turn so the view direction points up
    const rot = yaw - Math.PI / 2;
    g.translate(R, R); g.rotate(rot); g.scale(s, -s); g.translate(-P.x, -P.y);
    g.imageSmoothingEnabled = true;
    g.drawImage(img, geo.x0, geo.y0, iw * mpp, ih * mpp);
    g.restore();
    // markers (in screen space so dots stay round and upright)
    const c = Math.cos(-rot), sn = Math.sin(-rot);
    const toScreen = (x, y) => { const dx = x - P.x, dy = y - P.y; return [R + (dx * c - dy * sn) * s, R - (dx * sn + dy * c) * s]; };
    for (const t of tracked) for (const o of t.list) {
      if (!o?.position) continue;
      if (t.when ? !t.when(o) : o.userData?.taken || o.parent === null) continue;
      let [x, y] = toScreen(o.position.x, o.position.y);
      const d = Math.hypot(x - R, y - R), max = R - t.size * dpr - 2;
      if (d > max) { if (!t.edge) continue; x = R + (x - R) / d * max; y = R + (y - R) / d * max; }
      g.beginPath(); g.arc(x, y, t.size * dpr, 0, Math.PI * 2); g.fillStyle = t.color; g.fill();
      g.lineWidth = 1.5 * dpr; g.strokeStyle = 'rgba(0,0,0,.6)'; g.stroke();
    }
    // the player: an arrow along its heading (Walker.heading / Flyer.yaw), else the camera direction
    const hd = p.player?.heading ?? p.player?.yaw ?? yaw;
    g.save(); g.translate(R, R); g.rotate(yaw - hd); // arrow drawn pointing up = the view direction
    g.beginPath(); g.moveTo(0, -9 * dpr); g.lineTo(6 * dpr, 7 * dpr); g.lineTo(0, 3 * dpr); g.lineTo(-6 * dpr, 7 * dpr); g.closePath();
    g.fillStyle = '#fff'; g.fill(); g.lineWidth = 1.5 * dpr; g.strokeStyle = '#000'; g.stroke(); g.restore();
    g.beginPath(); g.arc(R, R, R - dpr, 0, Math.PI * 2); g.lineWidth = 2 * dpr; g.strokeStyle = 'rgba(255,255,255,.55)'; g.stroke();
  });
  return map;
}
