// Keyboard, mouse and touch input in one place. Touch controls (joystick + buttons) appear on touch devices.
//
//   p.input.move          {x, y} in [-1, 1]: x = right, y = forward (WASD / arrows / left joystick)
//   p.input.held('jump')  action is held;  p.input.pressed('jump')  pressed this frame
//   p.input.consumeLook() {dx, dy} mouse / touch-drag delta since the last call (pixels)
//
// Default actions: jump (Space), run (Shift), fire (left mouse / Enter), alt (right mouse / E),
// left/right (A,D or arrows, for lane changes), down (S / Ctrl / arrow down), interact (F).
// Rebind or add: p.input.bind('dash', ['KeyQ'], { label: 'Dash' }). Actions with a label get a touch button.
// Autopilots drive the same API: p.input.setMove(x, y), p.input.setHeld('jump', true).

const DEFAULTS = {
  jump: { keys: ['Space'], label: 'Jump' },
  run: { keys: ['ShiftLeft', 'ShiftRight'] },
  fire: { keys: ['Mouse0', 'Enter'] },
  alt: { keys: ['Mouse2', 'KeyE'] },
  left: { keys: ['KeyA', 'ArrowLeft'] },
  right: { keys: ['KeyD', 'ArrowRight'] },
  up: { keys: ['KeyW', 'ArrowUp'] },
  down: { keys: ['KeyS', 'ArrowDown', 'ControlLeft'] },
  interact: { keys: ['KeyF'] },
};

// headless checks (?check): a locked pointer stalls screenshots in headless Chromium
const NO_LOCK = typeof location !== 'undefined' && new URLSearchParams(location.search).has('check');

export class Input {
  constructor(canvas, { touch, jumpLabel = 'Jump', signal } = {}) {
    this.canvas = canvas;
    const on = (t, ev, fn, o = {}) => t.addEventListener(ev, fn, { ...o, signal });
    this.keys = new Set(); this.prev = new Set(); this.now = new Set();
    this.actions = {}; for (const [k, v] of Object.entries(DEFAULTS)) this.actions[k] = { ...v, keys: [...v.keys] };
    if (this.actions.jump.label) this.actions.jump.label = jumpLabel;
    this.virtualHeld = new Set(); this.virtualMove = null;
    this.stick = { x: 0, y: 0 }; this.look = { dx: 0, dy: 0 };
    this.touch = touch ?? (matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).has('touch'));
    this.pointerLock = false;
    on(window, 'keydown', (e) => { if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault(); this.keys.add(e.code); });
    on(window, 'keyup', (e) => this.keys.delete(e.code));
    on(window, 'blur', () => this.keys.clear());
    on(canvas, 'contextmenu', (e) => e.preventDefault());
    on(canvas, 'mousedown', (e) => {
      this.keys.add('Mouse' + e.button);
      if (this.pointerLock && document.pointerLockElement !== canvas) this.lock();
    });
    on(window, 'mouseup', (e) => this.keys.delete('Mouse' + e.button));
    on(window, 'mousemove', (e) => {
      // locked pointer, or a drag (also when pointer lock is unavailable, e.g. in an iframe)
      if (document.pointerLockElement === canvas || e.buttons & 1) { this.look.dx += e.movementX; this.look.dy += e.movementY; }
    });
    this.buttons = new Map(); this.taps = new Set(); this.pendingTaps = new Set();
    if (this.touch) this.#buildTouch();
  }
  /** Remove the touch controls (listeners go with the playable's dispose). */
  dispose() { this.stickEl?.remove(); this.btnBox?.remove(); this.css?.remove(); this.releaseAll(); }

  /** Bind an action to keys ('KeyQ', 'Mouse0', ...). A label adds an on-screen touch button. */
  bind(name, keys, { label } = {}) {
    this.actions[name] = { keys, label };
    if (this.touch && label) this.#addButton(name, label);
    return this;
  }
  /** Show a touch button for an existing action. */
  button(name, label) { this.actions[name].label = label; if (this.touch) this.#addButton(name, label); return this; }

  /** Capture the mouse (needs a recent click or key press). Failures (iframes, denied) are ignored: drag still works. */
  lock() { if (NO_LOCK) return; try { const r = this.canvas.requestPointerLock?.(); r?.catch?.(() => {}); } catch {} }
  /** Release all held keys and buttons (on start and pause, so nothing stays stuck). */
  releaseAll() { this.keys.clear(); this.clearVirtual(); }
  /** FPS-style mouse look: click the canvas to lock the pointer. */
  usePointerLock(on = true) { this.pointerLock = on; return this; }

  held(name) {
    if (this.virtualHeld.has(name)) return true;
    const a = this.actions[name]; if (!a) return false;
    return a.keys.some((k) => this.now.has(k)) || this.buttons.get(name)?.down === true;
  }
  pressed(name) { return this.held(name) && !this.#heldPrev(name); }

  get move() {
    if (this.virtualMove) return { ...this.virtualMove };
    const k = (n) => (this.held(n) ? 1 : 0);
    let x = k('right') - k('left') + this.stick.x, y = k('up') - k('down') + this.stick.y;
    const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    return { x, y };
  }
  consumeLook() { const l = { ...this.look }; this.look.dx = 0; this.look.dy = 0; return l; }

  // Autopilot hooks
  setMove(x, y) { this.virtualMove = x === null ? null : { x, y }; }
  setHeld(name, on) { if (on) this.virtualHeld.add(name); else this.virtualHeld.delete(name); }
  /** Press an action for exactly one frame, like a quick key press: `pressed(name)` is true this frame.
   *  A tap while the action is still down from the previous frame waits one frame. */
  tap(name) { if (this.prevHeld?.has(name)) this.pendingTaps.add(name); else { this.virtualHeld.add(name); this.taps.add(name); } }
  clearVirtual() { this.virtualMove = null; this.virtualHeld.clear(); this.taps.clear(); this.pendingTaps.clear(); }

  /** Called by the frame loop. */
  beginFrame() {
    this.prevHeld = new Set(Object.keys(this.actions).filter((n) => this.held(n)));
    for (const t of this.taps) this.virtualHeld.delete(t);
    this.taps.clear();
    for (const t of this.pendingTaps) if (!this.prevHeld.has(t)) { this.virtualHeld.add(t); this.taps.add(t); this.pendingTaps.delete(t); }
    this.now = new Set(this.keys);
    for (const b of this.buttons.values()) { b.wasDown = b.down; b.down = b.pressedNow || b.touching; b.pressedNow = false; }
  }
  #heldPrev(name) { return this.prevHeld?.has(name) ?? false; }

  #buildTouch() {
    const css = document.createElement('style');
    css.textContent = `.lp-stick{position:fixed;left:24px;bottom:24px;width:130px;height:130px;border-radius:50%;background:rgba(255,255,255,.15);border:2px solid rgba(255,255,255,.4);touch-action:none;z-index:20}
.lp-knob{position:absolute;left:40px;top:40px;width:50px;height:50px;border-radius:50%;background:rgba(255,255,255,.6)}
.lp-btns{position:fixed;right:20px;bottom:24px;display:flex;flex-direction:column-reverse;gap:12px;z-index:20}
.lp-btn{width:76px;height:76px;border-radius:50%;background:rgba(255,255,255,.2);border:2px solid rgba(255,255,255,.5);color:#fff;font:600 14px system-ui;touch-action:none;user-select:none}
.lp-btn.on{background:rgba(255,255,255,.5)}`;
    document.head.appendChild(css); this.css = css;
    const stick = document.createElement('div'); stick.className = 'lp-stick';
    const knob = document.createElement('div'); knob.className = 'lp-knob'; stick.appendChild(knob);
    document.body.appendChild(stick); this.stickEl = stick;
    let id = null;
    const set = (t) => {
      const r = stick.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      let x = (t.clientX - cx) / (r.width / 2), y = -(t.clientY - cy) / (r.height / 2); const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
      this.stick = { x, y }; knob.style.transform = `translate(${x * 40}px, ${-y * 40}px)`;
    };
    stick.addEventListener('touchstart', (e) => { e.preventDefault(); id = e.changedTouches[0].identifier; set(e.changedTouches[0]); });
    stick.addEventListener('touchmove', (e) => { e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === id) set(t); });
    const end = (e) => { for (const t of e.changedTouches) if (t.identifier === id) { id = null; this.stick = { x: 0, y: 0 }; knob.style.transform = ''; } };
    stick.addEventListener('touchend', end); stick.addEventListener('touchcancel', end);
    // drag anywhere else on the canvas to look around
    const looks = new Map();
    this.canvas.addEventListener('touchstart', (e) => { for (const t of e.changedTouches) looks.set(t.identifier, [t.clientX, t.clientY]); }, { passive: true });
    this.canvas.addEventListener('touchmove', (e) => { for (const t of e.changedTouches) { const q = looks.get(t.identifier); if (!q) continue; this.look.dx += (t.clientX - q[0]) * 1.5; this.look.dy += (t.clientY - q[1]) * 1.5; looks.set(t.identifier, [t.clientX, t.clientY]); } }, { passive: true });
    const lend = (e) => { for (const t of e.changedTouches) looks.delete(t.identifier); };
    this.canvas.addEventListener('touchend', lend); this.canvas.addEventListener('touchcancel', lend);
    this.btnBox = document.createElement('div'); this.btnBox.className = 'lp-btns'; document.body.appendChild(this.btnBox);
    for (const [name, a] of Object.entries(this.actions)) if (a.label) this.#addButton(name, a.label);
  }
  #addButton(name, label) {
    if (this.buttons.has(name)) { this.buttons.get(name).el.textContent = label; return; }
    const el = document.createElement('button'); el.className = 'lp-btn'; el.textContent = label;
    const b = { el, down: false, touching: false, pressedNow: false };
    el.addEventListener('touchstart', (e) => { e.preventDefault(); b.touching = true; b.pressedNow = true; el.classList.add('on'); });
    const up = (e) => { e.preventDefault(); b.touching = false; el.classList.remove('on'); };
    el.addEventListener('touchend', up); el.addEventListener('touchcancel', up);
    this.btnBox.appendChild(el); this.buttons.set(name, b);
  }
}
