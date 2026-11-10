// Cartoon look for props, weapons and pickups.
import * as THREE from 'three';

/** Toon material with a dark outline shell: the cartoon look for props, weapons and pickups. */
export function toon(color, { outline = 0.03, outlineColor = 0x111111, emissive = 0 } = {}) {
  const m = new THREE.MeshToonMaterial({ color, emissive });
  m.userData.outline = outline; m.userData.outlineColor = outlineColor;
  return m;
}
/** Add an inverted-hull outline to every mesh under `obj` whose material came from toon(). */
export function outline(obj) {
  const add = [];
  obj.traverse((o) => {
    if (!o.isMesh || o.userData.isOutline || !o.material?.userData?.outline) return;
    const m = new THREE.Mesh(o.geometry, new THREE.MeshBasicMaterial({ color: o.material.userData.outlineColor, side: THREE.BackSide }));
    m.userData.isOutline = true; o.geometry.computeBoundingSphere(); m.scale.setScalar(1 + Math.min(0.12, o.material.userData.outline / Math.max(0.05, o.geometry.boundingSphere.radius)));
    add.push([o, m]);
  });
  for (const [o, m] of add) o.add(m);
  return obj;
}
