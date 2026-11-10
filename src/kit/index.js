// lcc-playable/kit: gameplay helpers on top of the core. Optional: use them, change a copy, or write your own.
// They only use the public core API (p, p.geo, controllers). API reference: docs/api.md#kit-gameplay-helpers
export { loadCharacter } from './character.js';
export { label, beacon, coin, placeAlong, collectibles } from './props.js';
export { makeRoad } from './road.js';
export { minimap } from './minimap.js';
export { patrol } from './npc.js';
export { toon, outline } from './style.js';
export { shadow } from './shadow.js';
