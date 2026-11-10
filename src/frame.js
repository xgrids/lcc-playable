// Per-frame hooks for code that does not have the playable, such as character animation in the kit.
// The frame loop runs them with dt after the game's onUpdate callbacks and before its onLateUpdate callbacks.
export const tickers = new Set();

/**
 * Run `fn(dt)` every frame, after every playable's onUpdate callbacks and before its onLateUpdate callbacks,
 * also while paused. For modules that have no playable to call onUpdate on. Returns a function that removes it.
 */
export function onFrame(fn) { tickers.add(fn); return () => { tickers.delete(fn); }; }
