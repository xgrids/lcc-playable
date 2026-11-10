// Screen overlays: loading bar, title card, HUD, toasts, end card. Plain DOM, styled once.
//
//   p.ui.hud('Score 12   Time 0:31')            top-left text (multi-line ok); p.ui.hud(text, 'right') top-right
//   p.ui.toast('Checkpoint!', 1500)
//   p.ui.title({ title, subtitle, instructions, button })  -> Promise, resolves when the player starts
//   p.ui.end({ title, text, button })                       -> Promise, resolves on "play again"
//   p.ui.error(message, hint)                               full-screen error with a Reload button
// createPlayable shows the title/end cards for you; call these directly only for custom flows.
// Built-in texts come from createPlayable({ strings }) (see DEFAULT_STRINGS).
// The loading screen shows the LCC2 format attribution (CREDIT). The LCC2 white paper license requires it in every
// product that uses the format, so it is not a string option; do not remove it. Cards do not repeat it.

const CSS = `
.lp-ui{position:fixed;inset:0;pointer-events:none;font:15px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:#fff;z-index:10}
.lp-hud{position:absolute;top:12px;left:14px;white-space:pre;text-shadow:0 1px 3px #000,0 0 8px rgba(0,0,0,.6);font-weight:600}
.lp-hud.right{left:auto;right:14px;text-align:right}
.lp-hud.center{left:50%;transform:translateX(-50%);text-align:center}
.lp-toast{position:absolute;top:22%;left:50%;transform:translateX(-50%);font-size:28px;font-weight:800;text-shadow:0 2px 8px #000;opacity:0;transition:opacity .25s}
.lp-card{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.35);pointer-events:auto}
.lp-card>div{max-width:min(520px,88vw);padding:26px 30px;border-radius:16px;background:rgba(15,20,30,.82);text-align:center;box-shadow:0 10px 40px rgba(0,0,0,.5)}
.lp-card h1{margin:0 0 6px;font-size:30px}.lp-card h2{margin:0 0 14px;font-size:16px;font-weight:500;opacity:.8}
.lp-card p{white-space:pre-line;opacity:.9;margin:10px 0 18px}
.lp-card button{font:700 18px system-ui;padding:12px 34px;border:0;border-radius:999px;background:#ffcc33;color:#222;cursor:pointer}
.lp-load{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0b0f16;pointer-events:auto;transition:opacity .4s}
.lp-load .bar{width:min(320px,70vw);height:6px;border-radius:3px;background:#223;overflow:hidden}.lp-load i{display:block;height:100%;width:0;background:#ffcc33;transition:width .2s}
.lp-load p{opacity:.7;margin-top:12px;font-size:13px}
.lp-err>div{background:rgba(60,12,16,.92)}.lp-err pre{white-space:pre-wrap;text-align:left;font-size:12px;opacity:.75;max-height:30vh;overflow:auto}
.lp-credit{font-size:11px;opacity:.6;margin:14px 0 0}.lp-credit a{color:inherit}
.lp-cross{position:absolute;left:50%;top:50%;width:18px;height:18px;margin:-9px 0 0 -9px;display:none}
.lp-cross:before,.lp-cross:after{content:"";position:absolute;background:#fff;box-shadow:0 0 3px #000}
.lp-cross:before{left:8px;top:0;width:2px;height:18px}.lp-cross:after{top:8px;left:0;height:2px;width:18px}`;

export const CREDIT = { text: 'Data Organization Format originated from XGRIDS', url: 'https://github.com/xgrids/LCC2Whitepaper' };
const credit = () => { const e = document.createElement('p'); e.className = 'lp-credit'; const a = document.createElement('a'); a.href = CREDIT.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = CREDIT.text; e.appendChild(a); return e; };

export const DEFAULT_STRINGS = {
  loading: 'Loading scene…', play: 'Play', playAgain: 'Play again', win: 'You win!', lose: 'Game over',
  paused: 'Paused', resume: 'Continue', error: 'Something went wrong', reload: 'Reload', jump: 'Jump',
  contextLost: 'The graphics were reset (the GPU ran out of memory or the driver restarted). Reload to continue.',
  best: 'Best', newBest: 'New best!',
};

export class UI {
  constructor(strings = {}) {
    this.strings = { ...DEFAULT_STRINGS, ...strings };
    const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s); this.styleEl = s;
    this.root = document.createElement('div'); this.root.className = 'lp-ui'; document.body.appendChild(this.root);
    this.huds = {};
    this.toastEl = this.#el('div', 'lp-toast');
    this.cross = this.#el('div', 'lp-cross');
    this.loadEl = this.#el('div', 'lp-load'); this.loadEl.innerHTML = '<div class="bar"><i></i></div><p></p>'; this.loadEl.querySelector('p').textContent = this.strings.loading; this.loadEl.appendChild(credit());
  }
  #el(tag, cls) { const e = document.createElement(tag); e.className = cls; this.root.appendChild(e); return e; }

  loading(progress, text) {
    this.loadEl.querySelector('i').style.width = `${Math.round(progress * 100)}%`;
    if (text) this.loadEl.querySelector('p').textContent = text;
  }
  hideLoading() { this.loadEl.style.opacity = 0; setTimeout(() => this.loadEl.remove(), 400); }

  hud(text, slot = 'left') {
    if (!this.huds[slot]) this.huds[slot] = this.#el('div', `lp-hud ${slot}`);
    if (this.huds[slot].textContent !== text) this.huds[slot].textContent = text;
  }
  toast(text, ms = 1400) {
    this.toastEl.textContent = text; this.toastEl.style.opacity = 1;
    clearTimeout(this.toastT); this.toastT = setTimeout(() => (this.toastEl.style.opacity = 0), ms);
  }
  crosshair(on = true) { this.cross.style.display = on ? 'block' : 'none'; }

  /**
   * A centered card with a button; resolves when the player clicks it or presses Enter / Space. Keys are ignored for
   * the first 0.6 s (a key still held from the game must not skip the card) and auto-repeat never counts.
   */
  card({ title = '', subtitle = '', text = '', button = this.strings.play, className = '' } = {}) {
    if (document.pointerLockElement) document.exitPointerLock?.();
    return new Promise((ok) => {
      const c = this.#el('div', 'lp-card' + (className ? ' ' + className : '')), t0 = performance.now();
      c.innerHTML = `<div>${title ? `<h1></h1>` : ''}${subtitle ? '<h2></h2>' : ''}${text ? '<p></p>' : ''}<button></button></div>`;
      if (title) c.querySelector('h1').textContent = title;
      if (subtitle) c.querySelector('h2').textContent = subtitle;
      if (text) c.querySelector('p').textContent = text;
      const b = c.querySelector('button'); b.textContent = button;
      const go = () => { removeEventListener('keydown', key); c.remove(); ok(); };
      const key = (e) => { if ((e.code === 'Enter' || e.code === 'Space') && !e.repeat && performance.now() - t0 > 600) { e.preventDefault(); e.stopImmediatePropagation(); go(); } };
      b.addEventListener('click', go); addEventListener('keydown', key);
      this.closeCard = go; this.cardKey = key;
    });
  }
  title({ title, subtitle, instructions, button = this.strings.play } = {}) { return this.card({ title, subtitle, text: instructions, button }); }
  end({ title = this.strings.lose, text = '', button = this.strings.playAgain } = {}) { return this.card({ title, text, button }); }
  /** Remove all overlays. */
  dispose() { clearTimeout(this.toastT); if (this.cardKey) removeEventListener('keydown', this.cardKey); this.root.remove(); this.styleEl.remove(); }
  /** Full-screen error with the message, an optional hint and a Reload button. Shown once. */
  error(message, hint = '') {
    if (this.errorShown) return; this.errorShown = true;
    this.loadEl?.remove();
    const c = this.#el('div', 'lp-card lp-err');
    c.innerHTML = '<div><h1></h1><p></p><pre></pre><button></button></div>';
    c.querySelector('h1').textContent = this.strings.error;
    c.querySelector('p').textContent = hint;
    c.querySelector('pre').textContent = String(message).slice(0, 1500);
    const b = c.querySelector('button'); b.textContent = this.strings.reload; b.onclick = () => location.reload();
  }
}
