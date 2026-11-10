// Type declarations for lcc-playable/kit (gameplay helpers). Full reference: docs/api.md. Coordinates: Z up, meters.
import type * as THREE from 'three';
import type { Playable, SceneGeometry, Route, Vec3, Walker, Navigator } from '../index.js';

export interface Character {
  id: string; root: THREE.Group; mixer: THREE.AnimationMixer; height: number; roles: string[]; readonly action: string | null;
  has(action: string): boolean;
  play(action: string, opt?: { fade?: number; once?: boolean; speed?: number }): THREE.AnimationAction;
  /** Does nothing: animations advance automatically. */
  update(dt?: number): void;
  /** Remove for good and stop animating. */
  dispose(): void;
}
/** 'human' | 'robot' | a .glb URL */
export function loadCharacter(id?: string, opt?: { height?: number; tint?: number; roles?: Record<string, string> }): Promise<Character>;

export interface Road {
  group: THREE.Group; length: number; closed: boolean; sharedLen: number;
  at(s: number): { x: number; y: number; z: number; tx: number; ty: number; width: number; shared: boolean };
  shared(s: number): boolean;
}
export function makeRoad(geo: SceneGeometry, centerline: number[][], opt?: { width?: number | ((s: number, i: number) => number); lanes?: number | ((s: number) => number); lift?: number; maxSlope?: number; step?: number; closed?: boolean; color?: number; edgeColor?: number; laneColor?: number }): Road;

export function label(text: string, opt?: { sub?: string; color?: number; height?: number; background?: string }): THREE.Sprite & { setText(text: string, sub?: string): void };
export function beacon(p: Playable, position: Vec3 | number[], opt?: { color?: number; label?: string; sub?: string; radius?: number; height?: number; showWithin?: number }): { root: THREE.Group; label: THREE.Sprite | null; position: THREE.Vector3; visible: boolean };
export function coin(color?: number): THREE.Mesh;
export function placeAlong(geo: SceneGeometry, route: Route, spacing?: number, opt?: { side?: number; r?: number; start?: number; end?: number }): Vec3[];
export interface Collectibles { items: THREE.Object3D[]; got: number; total: number; readonly left: number; reset(): void; nearest(pos: THREE.Vector3): THREE.Object3D | null }
export function collectibles(p: Playable, points: number[][], opt?: { mesh?: () => THREE.Object3D; radius?: number; height?: number; spin?: number; sound?: string | false; showWithin?: number; score?: number; shadow?: number | false; onCollect?: (item: THREE.Object3D, index: number) => void }): Collectibles;
export interface Minimap {
  canvas: HTMLCanvasElement; range: number; visible: boolean;
  track(list: { position: THREE.Vector3; userData?: any; parent?: any }[], opt?: { color?: string; size?: number; edge?: boolean; when?: (o: any) => boolean }): object;
  untrack(t: object): void;
  dispose(): void;
}
/** @experimental may change in a 0.x minor release (see docs/api.md, Stability). */
export function minimap(p: Playable, opt?: { size?: number; range?: number; rotate?: boolean; corner?: 'top-right' | 'bottom-right' | 'top-left' | 'bottom-left'; opacity?: number; fps?: number }): Minimap;
export interface Npc {
  character: Character; walker: Walker; nav: Navigator; target: number[] | null; paused: boolean;
  stop(): void; resume(): void; near(pos: THREE.Vector3, d?: number): boolean; dispose(): void;
}
/** @experimental may change in a 0.x minor release (see docs/api.md, Stability). */
export function patrol(p: Playable, character: string | Character, opt?: { points?: number[][]; wander?: number; home?: number[]; speed?: number; wait?: [number, number]; loop?: boolean; height?: number; tint?: number; faceWithin?: number; showWithin?: number; seed?: number; shadow?: boolean }): Promise<Npc>;
/** Shadow on the scene ground under `obj`, following it every frame (`still: true`: once). 'figure' (default): the object's own animated silhouette cast by a fixed sun; 'disc': a soft round blob. */
export function shadow(p: Playable, obj: THREE.Object3D, opt?: { shape?: 'figure' | 'disc'; radius?: number; opacity?: number; fade?: number; still?: boolean; ground?: (x: number, y: number) => number; sun?: number[]; figureWithin?: number }): { mesh: THREE.Mesh; update(): void; dispose(): void };
export function toon(color: number, opt?: { outline?: number; outlineColor?: number; emissive?: number }): THREE.MeshToonMaterial;
export function outline<T extends THREE.Object3D>(obj: T): T;
