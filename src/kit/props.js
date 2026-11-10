// Ready-made game props: labels, beacons, pickups placed along the route. Toon style, no asset files.
//
//   const pts = placeAlong(p.geo, route, 12);                       // walkable points every 12 m, alternating sides
//   const coins = collectibles(p, pts, { onCollect: () => sfx('coin') });
//   if (coins.left === 0) p.win(...);
//   const b = beacon(p, [x, y, z], { label: 'Gate', sub: 'Deliver here', color: 0xffc83d });
import * as THREE from 'three';
import { toon, outline } from './style.js';
import { sfx } from '../index.js';
import { shadow as addShadow } from './shadow.js';

const FONT = 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif';
const hex = (c) => '#' + c.toString(16).padStart(6, '0');

/**
 * A text sign that always faces the camera (canvas texture on a sprite). Any language; sized in meters.
 * @returns {THREE.Sprite} with `.setText(text, sub)`
 */
export function label(text, { sub = '', color = 0xffc83d, height = 0.8, background = 'rgba(12,16,22,0.78)' } = {}) {
  const c = document.createElement('canvas'), g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.setText = (t, st = '') => {
    const H = st ? 200 : 130;
    g.font = `bold 72px ${FONT}`; const w1 = g.measureText(t).width;
    g.font = `600 34px ${FONT}`; const w2 = st ? g.measureText(st).width : 0;
    c.width = Math.ceil(Math.max(w1, w2) + 90); c.height = H;
    g.fillStyle = background; g.beginPath(); g.roundRect(6, 6, c.width - 12, H - 12, 28); g.fill();
    g.strokeStyle = hex(color); g.lineWidth = 5; g.stroke();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#fff'; g.font = `bold 72px ${FONT}`; g.fillText(t, c.width / 2, st ? 76 : H / 2 + 2);
    if (st) { g.fillStyle = hex(color); g.font = `600 34px ${FONT}`; g.fillText(st, c.width / 2, 146); }
    tex.needsUpdate = true;
    s.scale.set(height * (c.width / H), height, 1);
  };
  s.setText(text, sub);
  return s;
}

/**
 * A destination marker: glowing ring on the ground, a light column and an optional label, gently pulsing.
 * Added to p.props (fades when it blocks the camera, hidden beyond `showWithin` meters from the player).
 * @returns {{root: THREE.Group, label: THREE.Sprite|null, position: THREE.Vector3, visible: boolean}}
 */
export function beacon(p, position, { color = 0xffc83d, label: text = '', sub = '', radius = 1.1, height = 5, showWithin = 60 } = {}) {
  const root = new THREE.Group(); root.position.set(...position);
  const basic = (opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.8, radius, 48), basic(0.9)); ring.position.z = 0.05;
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.15, radius * 0.45, height, 16, 1, true), basic(0.14));
  beam.rotation.x = Math.PI / 2; beam.position.z = height / 2;
  root.add(ring, beam);
  const sign = text ? label(text, { sub, color }) : null;
  if (sign) { sign.position.z = Math.min(height, 2.8); root.add(sign); }
  p.props.add(root);
  const b = { root, label: sign, position: root.position, visible: true };
  p.onUpdate(() => {
    const P = p.player?.position;
    root.visible = b.visible && (!P || root.position.distanceTo(P) < showWithin);
    const k = 1 + Math.sin(p.time * 3) * 0.06; ring.scale.set(k, k, 1);
  });
  return b;
}

/** A spinning toon coin (torus), 0.6 m wide. Pass it as `mesh` to collectibles, or use your own mesh factory. */
const coinGeo = new THREE.TorusGeometry(0.28, 0.09, 12, 28);
let coinMat = null;
export function coin(color = 0xffc83d) {
  const m = outline(new THREE.Mesh(coinGeo, color === 0xffc83d ? (coinMat ||= toon(color, { emissive: 0x553300 })) : toon(color, { emissive: 0x332200 })));
  m.rotation.x = Math.PI / 2;
  return m;
}

/**
 * Points every `spacing` meters along a route, nudged sideways (alternating) within the free width, on walkable
 * ground: [[x, y, z], ...]. For coins, checkpoints, NPCs, delivery stops.
 */
export function placeAlong(geo, route, spacing = 12, { side = 0.7, r = 0.45, start, end } = {}) {
  const out = [];
  for (const q of route.every(spacing, { start, end })) {
    const k = (out.length % 2 ? 1 : -1) * Math.min(side, geo.clearanceAt(q.x, q.y) * 0.4);
    const px = q.x - Math.sin(q.yaw) * k, py = q.y + Math.cos(q.yaw) * k;
    out.push(geo.walkable(px, py, r) ? [px, py, geo.groundAt(px, py)] : [q.x, q.y, q.z]);
  }
  return out;
}

/**
 * Pickups the player collects by walking into them. Updates itself every frame and resets at every start.
 * @param {number[][]} points [[x, y, z], ...] ground points (e.g. from placeAlong)
 * @param {{mesh?: () => THREE.Object3D, radius?: number, height?: number, spin?: number, sound?: string|false,
 *          showWithin?: number, score?: number, shadow?: number|false, onCollect?: (item, index) => void}} [opt]
 *   shadow: radius of the contact shadow under each item in m (default 0.35), false for none
 * @returns {{items: THREE.Object3D[], got: number, total: number, left: number, reset(): void, nearest(pos): THREE.Object3D|null}}
 */
export function collectibles(p, points, { mesh = coin, radius = 1.4, height = 0.9, spin = 3, sound = 'coin', showWithin = 40, score = 1, shadow = 0.35, onCollect } = {}) {
  const items = points.map((q) => { const m = mesh(); m.position.set(q[0], q[1], q[2] + height); m.userData.taken = false; p.props.add(m); if (shadow) addShadow(p, m, { shape: 'disc', radius: shadow }); return m; });
  const c = {
    items, got: 0, total: items.length,
    get left() { return c.total - c.got; },
    reset() { c.got = 0; for (const m of items) { m.userData.taken = false; m.visible = true; } },
    nearest(pos) { let best = null, d = Infinity; for (const m of items) if (!m.userData.taken) { const e = m.position.distanceTo(pos); if (e < d) { d = e; best = m; } } return best; },
  };
  p.onStart(() => c.reset());
  p.onUpdate((dt) => {
    const P = p.player?.position;
    items.forEach((m, i) => {
      if (m.userData.taken) { m.visible = false; return; }
      m.rotation.y += dt * spin;
      m.visible = !P || m.position.distanceTo(P) < showWithin;
      if (P && p.state === 'playing' && Math.hypot(m.position.x - P.x, m.position.y - P.y) < radius && Math.abs(m.position.z - height - P.z) < 2) {
        m.userData.taken = true; c.got++; p.score += score; if (sound) sfx(sound); onCollect?.(m, i);
      }
    });
  });
  return c;
}
