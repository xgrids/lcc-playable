// Small helpers that games keep re-writing.
import * as THREE from 'three';

/** Seeded random in [0, 1). Use for repeatable level layouts. */
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Small WebAudio synth for game sounds without asset files: sfx('coin' | 'jump' | 'hit' | 'shoot' | 'win' | 'lose'). */
let ac = null;
// Browsers (iOS Safari especially) start audio suspended until a user gesture: resume on the first one.
if (typeof addEventListener === 'function') for (const ev of ['pointerdown', 'keydown', 'touchend']) addEventListener(ev, () => { try { ac ||= new AudioContext(); if (ac.state === 'suspended') ac.resume(); } catch {} }, { once: true, capture: true });
export function sfx(kind = 'coin', volume = 0.2) {
  try { ac ||= new AudioContext(); } catch { return; }
  if (new URLSearchParams(location.search).has('mute')) return;
  const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
  const P = { coin: ['square', 880, 1320, 0.12], jump: ['sine', 300, 600, 0.18], hit: ['sawtooth', 220, 60, 0.3], shoot: ['square', 600, 150, 0.12], win: ['triangle', 520, 1040, 0.6], lose: ['triangle', 400, 100, 0.6], pop: ['sine', 500, 900, 0.08] }[kind] || ['sine', 440, 440, 0.1];
  o.type = P[0]; o.frequency.setValueAtTime(P[1], t); o.frequency.exponentialRampToValueAtTime(P[2], t + P[3]);
  g.gain.setValueAtTime(volume, t); g.gain.exponentialRampToValueAtTime(0.001, t + P[3]);
  o.connect(g).connect(ac.destination); o.start(t); o.stop(t + P[3] + 0.02);
}

/** mm:ss */
export const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
