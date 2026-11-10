// Type declarations for lcc-playable. Full reference: docs/api.md. Coordinates: Z up, meters.
// `npm run typecheck` compiles test/types/smoke.ts against this file.
import type * as THREE from 'three';

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type PlayState = 'loading' | 'title' | 'playing' | 'paused' | 'won' | 'lost';

export interface PlayableOptions {
  /** URL or path of the scene's .lcc2 file. `?scene=` in the page URL overrides it. */
  scene: string;
  title?: string; subtitle?: string; instructions?: string;
  autoStart?: boolean;
  maxSplats?: number;
  env?: boolean;
  /** 'scene' (default): the captured sky. 'plain' or [zenith, horizon] colors: a gradient sky, without the environment splats (and their floaters). */
  sky?: 'scene' | 'plain' | [number, number];
  geometry?: 'auto' | 'prep' | 'runtime';
  fov?: number;
  /** Max render resolution per CSS pixel (default 1; `?hd` = 2). */
  pixelRatio?: number;
  /** Lower resolution / splat budget while frames are slow (default true). */
  adaptive?: boolean;
  container?: HTMLElement;
  /** Built-in texts for your language. */
  strings?: Partial<Record<'loading' | 'play' | 'playAgain' | 'win' | 'lose' | 'paused' | 'resume' | 'error' | 'reload' | 'jump' | 'contextLost' | 'best' | 'newBest', string>>;
  /** Pause on blur / hidden tab / mouse released (default true). */
  pauseOnBlur?: boolean;
  preserveDrawingBuffer?: boolean;
  /** localStorage key for the best score (default: title + scene); false turns it off. */
  bestKey?: string | false;
  /** SDK cache sizes for streamed scene data, MB (`?cache=host,gpu`). */
  cache?: { hostMB?: number; gpuMB?: number };
  /** Best = lowest p.score. */
  lowerIsBetter?: boolean;
}

export interface RayHit { point: Vec3; normal: Vec3; distance: number }

export interface Playable {
  THREE: typeof THREE;
  renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
  /** Game objects. They fade when they block the camera. */
  props: THREE.Group;
  /** Drawn on top in camera space (-Z forward, +X right, +Y up): first-person weapons, cockpits. */
  viewmodel: THREE.Group;
  ui: UI; input: Input; geo: SceneGeometry & { source: 'prep' | 'cache' | 'runtime'; ms: number };
  /** true when the scene has no collision mesh: ground, walkability and collision rays are estimated from the splats. */
  estimated: boolean;
  params: URLSearchParams;
  state: PlayState; ready: boolean; running: boolean; error: string | null;
  /** True with `?auto`: the autopilot drives the game. */
  auto: boolean;
  time: number; playTime: number; score: number; fps: number;
  /** Where the player can go; `npm run check` reports coverage from it. */
  playArea: number[][] | null;
  /** Anything `npm run check` should print. */
  info: Record<string, unknown>;
  result: null | { state: 'won' | 'lost'; text: string; time: number; score: number; best: number | null; newBest: boolean; [k: string]: unknown };
  /** Best recorded score for this game and scene (localStorage), null before the first scored round. */
  best: number | null;
  /** Record a score by hand; true when it is a new best. p.win / p.lose do this for you. */
  recordScore(score?: number): boolean;
  /** Stop and remove everything (canvas, overlays, listeners, SDK scene, physics). @experimental */
  dispose(): void;
  /** True after the WebGL context was lost (an error card offers a reload). */
  contextLost?: boolean;
  player?: { position: THREE.Vector3 };
  physics?: Physics;
  quality: { preset: 'low' | 'high' | string; pixelRatio: number; maxSplats: number; steps: number; cache: { hostMB?: number; gpuMB?: number } };
  pause(): Promise<void>;
  /** Debug overlay (`?debug` or the ` key). */
  debug: { readonly on: boolean };
  drawCalls?: number;
  lcc: any; meta: any; url: string;
  onUpdate(fn: (dt: number, p: Playable) => void): Playable;
  /** Every frame, also while paused: after the onUpdate callbacks and onFrame hooks (character animation), right before drawing. For work that must see the frame's final positions and poses (shadows, overlays). */
  onLateUpdate(fn: (dt: number, p: Playable) => void): Playable;
  onStart(fn: (p: Playable) => void): Playable;
  setAutopilot(fn: (dt: number) => void): Playable;
  run(): Promise<void>;
  start(): void;
  win(text?: string, extra?: Record<string, unknown>): Promise<void>;
  lose(text?: string, extra?: Record<string, unknown>): Promise<void>;
  spawn(): Vec3;
  showNear(objects: THREE.Object3D[], center: THREE.Vector3, radius?: number): void;
  raycast(origin: Vec3, dir: Vec3, maxDistance?: number): RayHit | null;
  /** @experimental cost and accuracy depend on the SDK version */
  raycastSplats(origin: Vec3, dir: Vec3, maxDistance?: number, opt?: { radius?: number; opacity?: number }): { point: Vec3; distance: number } | null;
}
export function createPlayable(options: PlayableOptions): Promise<Playable>;

export interface RouteSample { x: number; y: number; z: number; yaw: number; clearance: number; headroom: number; i: number; s: number }
export interface Route { seg: number | null; source: 'trajectory' | 'regions'; length: number; closed: boolean; fullLength: number; at: number[]; points: [number, number, number, number, number][];
  sample(s: number): RouteSample; every(spacing: number, opt?: { start?: number; end?: number }): RouteSample[] }
export interface Coverage { span: number; areaCover: number; trackCover: number | null; length: number; reach: number; segments?: number; bestSeg?: number; segCover?: number; segSpan?: number; error?: string }
export class SceneGeometry {
  res: number; stats: { walkableM2: number; isolatedM2: number; maxClearance: number; poses: number; walkedPoses?: number; poseSegments: number };
  bounds: [number, number, number, number]; trackBounds: [number, number, number, number];
  poses: number[][];
  groundAt(x: number, y: number): number;
  headroomAt(x: number, y: number): number;
  clearanceAt(x: number, y: number): number;
  walkable(x: number, y: number, r?: number): boolean;
  at(x: number, y: number): { x: number; y: number; ground: number; headroom: number; clearance: number; walkable: boolean };
  nearestWalkable(x: number, y: number, r?: number): Vec3 | null;
  openest(): [number, number, number, number] | null;
  randomPoint(r?: number, rng?: () => number): Vec3 | null;
  findPath(a: Vec2 | number[], b: Vec2 | number[], r?: number): Vec3[] | null;
  segments(): { seg: number; length: number; longestRun: number; start: Vec2; end: Vec2; zStart: number; zEnd: number; zMin: number; zMax: number }[];
  walkedRuns(): { seg: number; points: Vec3[]; length: number }[];
  raycast(origin: Vec3, dir: Vec3, maxDistance?: number, opt?: { wall?: number }): { point: Vec3; normal: Vec3; distance: number } | null;
  toMesh(cx: number, cy: number, radius?: number, opt?: { step?: number; wall?: number }): { v: Float32Array; f: Uint32Array };
  tour(opt?: { n?: number; r?: number }): Vec2[];
  route(opt?: { from?: number; to?: number; step?: number; smooth?: number; r?: number; seg?: number }): Route;
  regions(opt?: { n?: number; minRadius?: number }): { x: number; y: number; z: number; radius: number }[];
  coverage(playArea: number[][], reach?: number): Coverage;
}
export function loadGeometry(metaUrl: string, opt?: { source?: 'auto' | 'prep' | 'runtime'; cache?: boolean; res?: number; workerUrl?: string | URL; onProgress?: (p: number, phase: string) => void }): Promise<SceneGeometry>;

export interface Move { x: number; y: number }
export class Walker {
  constructor(p: Playable, opt?: { position?: Vec3 | number[]; character?: Character; radius?: number; speed?: number; runSpeed?: number; jumpSpeed?: number; gravity?: number; faceMove?: boolean; turnRate?: number; maxStepUp?: number });
  position: THREE.Vector3; velocity: THREE.Vector3; heading: number; onGround: boolean; moving: boolean;
  update(dt: number, opt?: { yaw?: number; move?: Move; jump?: boolean; run?: boolean }): void;
  teleport(x: number, y: number, heading?: number): void;
}
export class Flyer {
  constructor(p: Playable, opt?: { position?: Vec3 | number[]; yaw?: number; speed?: number; minSpeed?: number; maxSpeed?: number; minAltitude?: number; maxAltitude?: number; turnRate?: number; climbRate?: number; avoidSplats?: boolean });
  position: THREE.Vector3; yaw: number; pitch: number; roll: number; speed: number; readonly altitude: number;
  safeHeight(x: number, y: number, r?: number): number;
  update(dt: number, opt?: { move?: Move; boost?: boolean; brake?: boolean }): void;
}
/** @experimental may change in a 0.x minor release (see docs/api.md, Stability). */
export class Navigator {
  constructor(p: Playable, walker: Walker, opt?: { lookahead?: number; run?: boolean; repath?: number });
  stuck: number; move: Move; path: number[][];
  goTo(x: number, y: number, yaw: number, opt?: { apply?: boolean; dt?: number }): number;
}

export class FollowCamera {
  constructor(p: Playable, opt?: { distance?: number; height?: number; lookHeight?: number; radius?: number; stiffness?: number; fade?: boolean; orbit?: boolean; every?: number; splats?: boolean; splatEvery?: number; groundClear?: number; sensitivity?: number });
  yaw: number; pitch: number;
  update(dt: number, target: THREE.Vector3, heading?: number): void;
  reset(): void;
}
export class FirstPersonCamera {
  constructor(p: Playable, opt?: { height?: number; sensitivity?: number; yaw?: number; pitch?: number });
  yaw: number; pitch: number; readonly forward: Vec3;
  update(dt: number, feet: THREE.Vector3): void;
}
export function safeCamera(scene: Playable | any, target: Vec3, desired: Vec3 | number[], opt?: { minDist?: number; lift?: number; tries?: number; pad?: number; radius?: number; splats?: boolean }): Vec3;
export function fadeOccluders(camera: THREE.Camera, target: Vec3, objects: THREE.Object3D[], opt?: { near?: number; radius?: number; opacity?: number; speed?: number; dt?: number }): number;

export interface Physics {
  RAPIER: any; world: any; focus: THREE.Vector3 | null;
  add(mesh: THREE.Object3D, opt?: { shape?: 'box' | 'sphere' | 'capsule' | 'cylinder'; size?: number | number[]; mass?: number; fixed?: boolean; kinematic?: boolean; position?: Vec3 | number[]; restitution?: number; friction?: number; ccd?: boolean; sensor?: boolean }): any;
  remove(meshOrBody: any): void;
  raycast(origin: Vec3 | number[], dir: Vec3 | number[], maxDistance?: number, opt?: { excludeBody?: any }): (RayHit & { mesh: THREE.Object3D | null; body: any }) | null;
  impulse(meshOrBody: any, impulse: Vec3 | number[], at?: Vec3 | number[]): void;
  step(dt: number): void;
  sceneReady(opt?: { timeout?: number }): Promise<void>;
  dispose(): void;
}
/** @experimental may change in a 0.x minor release (see docs/api.md, Stability). */
export function createPhysics(p: Playable, opt?: { gravity?: number; scene?: boolean; radius?: number }): Promise<Physics>;

export class Input {
  readonly move: Move;
  held(action: string): boolean; pressed(action: string): boolean;
  bind(action: string, keys: string[], opt?: { label?: string }): Input;
  button(action: string, label: string): Input;
  usePointerLock(on?: boolean): Input;
  consumeLook(): { dx: number; dy: number };
  setMove(x: number | null, y?: number): void; setHeld(action: string, on: boolean): void;
  /** One-frame press for autopilots: pressed(action) is true for exactly one frame. */
  tap(action: string): void;
  clearVirtual(): void;
}
export class UI {
  hud(text: string, slot?: 'left' | 'right' | 'center'): void;
  toast(text: string, ms?: number): void;
  crosshair(on?: boolean): void;
  card(opt?: { title?: string; subtitle?: string; text?: string; button?: string }): Promise<void>;
  error(message: unknown, hint?: string): void;
  title(opt?: { title?: string; subtitle?: string; instructions?: string; button?: string }): Promise<void>;
  end(opt?: { title?: string; text?: string; button?: string }): Promise<void>;
}

export function sfx(kind?: 'coin' | 'jump' | 'hit' | 'shoot' | 'win' | 'lose' | 'pop', volume?: number): void;
export function rng(seed?: number): () => number;
export function clock(seconds: number): string;
/** Run fn(dt) every frame, after every playable's onUpdate callbacks and before its onLateUpdate callbacks, also while paused. For modules that have no playable (character animation). Returns a function that removes it. */
export function onFrame(fn: (dt: number) => void): () => void;
/** Absolute URL of a file in the runtime assets folder (`assets/` in development, `./assets/` in a build), e.g. assetUrl('characters/manifest.json'). */
export function assetUrl(path?: string): string;
