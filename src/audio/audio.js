// audio/audio.js
//
// The shared Web Audio engine for Spy Chaser (Phase 12, spec §8): one
// AudioContext, a master gain node, a music sub-bus and an sfx sub-bus, a mute
// toggle (bound to "M" in the input map), and unlock-on-first-gesture to satisfy
// browser autoplay policy.
//
// AIDEV-NOTE: This module is HEADLESS-SAFE. It must construct and behave
// sensibly with NO Web Audio present (Node tests, server-side). All audio work
// is guarded behind a live `ctx`; without one every method is a quiet no-op. We
// do NOT import or construct AudioContext at module load — the constructor
// resolves the constructor lazily from globalThis so importing this file never
// throws in Node.
//
// AIDEV-NOTE: muteFactor() is pulled out as a PURE helper so the mute/volume
// math is unit-tested without a real GraphAudioParam (test/audio.test.js).

/**
 * The master-gain value for a given mute state + base volume. Pure: no audio.
 * @param {boolean} muted
 * @param {number} volume 0..1 base master volume
 * @returns {number} the gain to apply to the master node (0 when muted)
 */
export function muteFactor(muted, volume) {
  if (muted) return 0;
  // Clamp to a sane range so a bad config can't blow out the output.
  return Math.max(0, Math.min(1, volume));
}

/**
 * Resolve a usable AudioContext constructor from the global scope, or null when
 * Web Audio is unavailable (Node, or a very old browser). Kept lazy so importing
 * this module never touches Web Audio.
 * @returns {(new () => AudioContext)|null}
 */
function resolveAudioContextCtor() {
  if (typeof globalThis === "undefined") return null;
  const g = /** @type {any} */ (globalThis);
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

export class AudioEngine {
  /**
   * @param {Object} [opts]
   * @param {number} [opts.volume] base master volume (0..1), default 0.6.
   * @param {boolean} [opts.muted] start muted, default false.
   * @param {(new () => AudioContext)|null} [opts.contextCtor] override the
   *   AudioContext constructor (injectable for tests / fakes).
   */
  constructor(opts = {}) {
    /** base master volume (pre-mute). */
    this.volume = opts.volume ?? 0.6;
    /** whether output is muted (toggled with M). */
    this.muted = opts.muted ?? false;
    /** whether the context has been unlocked by a user gesture. */
    this.unlocked = false;

    /** @type {(new () => AudioContext)|null} */
    this._ctorOverride = opts.contextCtor ?? null;

    /** @type {AudioContext|null} the live context, or null when headless. */
    this.ctx = null;
    /** @type {GainNode|null} master gain (drives mute/volume). */
    this.masterGain = null;
    /** @type {GainNode|null} music sub-bus (Music routes here). */
    this.musicBus = null;
    /** @type {GainNode|null} sfx sub-bus (Sfx routes here). */
    this.sfxBus = null;

    // AIDEV-NOTE: bound once so add/removeEventListener pair up correctly.
    this._onGesture = () => this.unlock();
    this._gestureTarget = null;
    this._gestureEvents = ["pointerdown", "keydown", "touchstart", "mousedown"];
  }

  /**
   * Create the AudioContext + gain graph if Web Audio is available. Safe to call
   * more than once (idempotent). Returns true if a live context exists after the
   * call. Does NOT resume the context — that happens on the first gesture
   * (unlock()), per autoplay policy.
   * @returns {boolean}
   */
  ensureContext() {
    if (this.ctx) return true;
    const Ctor = this._ctorOverride ?? resolveAudioContextCtor();
    if (!Ctor) return false;
    try {
      this.ctx = new Ctor();
    } catch {
      this.ctx = null;
      return false;
    }
    // Build the graph: master -> destination; music/sfx -> master.
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = muteFactor(this.muted, this.volume);
    this.masterGain.connect(this.ctx.destination);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 1;
    this.musicBus.connect(this.masterGain);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 1;
    this.sfxBus.connect(this.masterGain);
    return true;
  }

  /**
   * Register one-shot unlock listeners on the given target (window by default).
   * The FIRST user gesture creates+resumes the context (autoplay policy). The
   * listeners remove themselves once unlocked. No-op when there is no DOM.
   * @param {EventTarget|null} [target]
   */
  installGestureUnlock(target = typeof window !== "undefined" ? window : null) {
    if (!target || typeof target.addEventListener !== "function") return;
    this._gestureTarget = target;
    for (const type of this._gestureEvents) {
      target.addEventListener(type, this._onGesture, { passive: true });
    }
  }

  /** Remove any installed gesture-unlock listeners. */
  _removeGestureUnlock() {
    const target = this._gestureTarget;
    if (!target || typeof target.removeEventListener !== "function") return;
    for (const type of this._gestureEvents) {
      target.removeEventListener(type, this._onGesture);
    }
    this._gestureTarget = null;
  }

  /**
   * Unlock + resume the audio context on a user gesture. Idempotent: after the
   * first successful unlock the gesture listeners are removed. No-op headless.
   * @returns {boolean} whether a live, unlocked context exists.
   */
  unlock() {
    if (!this.ensureContext()) return false;
    // Resume a suspended context (Chrome starts it suspended until a gesture).
    if (this.ctx && this.ctx.state === "suspended" && typeof this.ctx.resume === "function") {
      // Resume returns a promise; we don't await it (fire-and-forget is fine).
      try {
        this.ctx.resume();
      } catch {
        /* ignore */
      }
    }
    this.unlocked = true;
    this._removeGestureUnlock();
    return true;
  }

  /**
   * Toggle mute (the "M" key). Applies immediately to the master gain. Returns
   * the new muted state.
   * @returns {boolean}
   */
  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /**
   * Set the muted state and apply it to the master gain.
   * @param {boolean} muted
   */
  setMuted(muted) {
    this.muted = !!muted;
    this._applyMasterGain();
  }

  /**
   * Set the base master volume (0..1) and apply it (respecting mute).
   * @param {number} volume
   */
  setVolume(volume) {
    this.volume = volume;
    this._applyMasterGain();
  }

  /**
   * Push the current mute/volume to the master gain node with a short ramp so
   * toggling mute doesn't click. No-op without a live context.
   * @private
   */
  _applyMasterGain() {
    if (!this.masterGain || !this.ctx) return;
    const target = muteFactor(this.muted, this.volume);
    const now = this.now();
    const g = this.masterGain.gain;
    try {
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(target, now + 0.03);
    } catch {
      // Fallback for fakes without ramp support.
      g.value = target;
    }
  }

  /** Current audio-clock time in seconds (0 headless). */
  now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /** Whether audio can actually be heard right now (live + unlocked + unmuted). */
  get audible() {
    return !!this.ctx && this.unlocked && !this.muted;
  }
}

export default AudioEngine;
