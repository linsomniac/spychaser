// audio/sfx.js
//
// Procedural sound effects (Phase 12, spec §8): a speed-tracking engine hum,
// machine-gun fire, explosions, a weapon-load jingle, a civilian-hit warning, a
// low-cars alarm, and the helicopter rotor. Everything is synthesized live from
// oscillators / filtered noise on the shared AudioEngine's sfx bus.
//
// AIDEV-NOTE: HEADLESS-SAFE. The pure speed->pitch mapping (engineFreq) and the
// gun rate-limit bookkeeping are unit-tested (test/sfx.test.js); all actual
// synthesis is guarded behind a live + audible AudioEngine, so every trigger is
// a quiet no-op in Node / when muted / before unlock. The sim can therefore fire
// SFX events unconditionally (see core/game.js) without any DOM dependency.

/** Engine-hum frequency band (Hz). idle = at rest, max = at top speed. */
const ENGINE = Object.freeze({ idle: 70, max: 240 });

/**
 * Map the player's forward speed to the engine-hum oscillator frequency. Pure:
 * a clamped linear ramp from `idle` (speed 0) to `max` (speed == maxSpeed). A
 * degenerate maxSpeed (<= 0) collapses to idle so we never divide by zero.
 * @param {number} speed current forward speed (virtual px/s)
 * @param {number} maxSpeed top speed used to normalize (virtual px/s)
 * @param {{idle:number, max:number}} [band]
 * @returns {number} oscillator frequency in Hz
 */
export function engineFreq(speed, maxSpeed, band = ENGINE) {
  if (maxSpeed <= 0) return band.idle;
  const t = Math.max(0, Math.min(1, speed / maxSpeed));
  return band.idle + (band.max - band.idle) * t;
}

export class Sfx {
  /**
   * @param {import("./audio.js").AudioEngine} audio shared engine (ctx + sfxBus)
   */
  constructor(audio) {
    /** @type {import("./audio.js").AudioEngine} */
    this.audio = audio;

    // --- Continuous engine hum (two detuned oscillators + a lowpass). ---
    /** @type {OscillatorNode|null} */
    this._engOscA = null;
    /** @type {OscillatorNode|null} */
    this._engOscB = null;
    /** @type {GainNode|null} */
    this._engGain = null;
    /** @type {BiquadFilterNode|null} */
    this._engFilter = null;
    this._engineOn = false;

    // --- Helicopter rotor (pulsing filtered noise). ---
    /** @type {AudioBufferSourceNode|null} */
    this._rotorSrc = null;
    /** @type {GainNode|null} */
    this._rotorGain = null;
    /** @type {OscillatorNode|null} thump LFO */
    this._rotorLfo = null;
    this._rotorOn = false;

    // AIDEV-NOTE: gun fire is rate-limited so a held trigger (autofire) can't
    // spawn one oscillator per 60 Hz frame — that would both swamp the mix and
    // leak voices. We accept at most one shot per gunMinInterval. _now is the
    // clock, injectable in tests for determinism.
    /** seconds between accepted gunshots (matches the gun cadence feel). */
    this.gunMinInterval = 0.05;
    this._lastGunAt = -Infinity;

    // Civilian warning + low-cars alarm are also rate-limited so a sustained
    // condition doesn't stack overlapping beeps.
    this._lastWarnAt = -Infinity;
    this._warnMinInterval = 0.4;
    this._lastAlarmAt = -Infinity;
    this._alarmMinInterval = 0.8;

    /** clock source (audio-clock seconds); injectable for tests. */
    this._now = () => this.audio.now();
  }

  // --- internals --------------------------------------------------------------

  /** Whether synthesis should actually happen right now. */
  get _live() {
    return this.audio.audible && !!this.audio.sfxBus && !!this.audio.ctx;
  }

  /** The sfx bus a voice should route into (null headless). */
  get _bus() {
    return this.audio.sfxBus;
  }

  /**
   * Rate-limit gate for gunshots (pure bookkeeping, no audio). Returns true and
   * advances the cursor when a shot is accepted; false to drop it.
   * @returns {boolean}
   * @private
   */
  _acceptGunShot() {
    const t = this._now();
    if (t - this._lastGunAt < this.gunMinInterval) return false;
    this._lastGunAt = t;
    return true;
  }

  /**
   * One short enveloped oscillator blip routed to the sfx bus.
   * @param {Object} o
   * @param {string} o.type oscillator type
   * @param {number} o.freq start frequency (Hz)
   * @param {number} [o.endFreq] optional pitch sweep target
   * @param {number} o.dur seconds
   * @param {number} o.gain peak gain
   * @param {number} [o.when] start time (defaults to now)
   * @private
   */
  _blip({ type, freq, endFreq, dur, gain, when }) {
    if (!this._live) return;
    const ctx = this.audio.ctx;
    const t0 = when ?? this._now();
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (endFreq != null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t0 + dur);
    }
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(env);
    env.connect(this._bus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /**
   * A burst of filtered white noise (used for explosions / gun crack).
   * @param {Object} o
   * @param {number} o.dur seconds
   * @param {number} o.gain peak gain
   * @param {number} o.cutoff lowpass cutoff (Hz)
   * @param {"lowpass"|"highpass"|"bandpass"} [o.filterType]
   * @param {number} [o.when]
   * @private
   */
  _noiseBurst({ dur, gain, cutoff, filterType = "lowpass", when }) {
    if (!this._live) return;
    const ctx = this.audio.ctx;
    const t0 = when ?? this._now();
    const frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(cutoff, t0);
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, t0);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(env);
    env.connect(this._bus);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  // --- Engine hum (speed-tracking) -------------------------------------------

  /**
   * Start the continuous engine hum (idempotent). Two slightly detuned oscillators
   * through a lowpass for a gritty motor. No-op headless / inaudible.
   */
  startEngine() {
    if (this._engineOn || !this._live) return;
    const ctx = this.audio.ctx;
    const t0 = this._now();
    this._engGain = ctx.createGain();
    this._engGain.gain.value = 0.06;
    this._engFilter = ctx.createBiquadFilter();
    this._engFilter.type = "lowpass";
    this._engFilter.frequency.value = 800;
    this._engOscA = ctx.createOscillator();
    this._engOscB = ctx.createOscillator();
    this._engOscA.type = "sawtooth";
    this._engOscB.type = "square";
    const f = engineFreq(0, 1);
    this._engOscA.frequency.setValueAtTime(f, t0);
    this._engOscB.frequency.setValueAtTime(f * 0.5, t0); // sub an octave down
    this._engOscA.connect(this._engFilter);
    this._engOscB.connect(this._engFilter);
    this._engFilter.connect(this._engGain);
    this._engGain.connect(this._bus);
    this._engOscA.start(t0);
    this._engOscB.start(t0);
    this._engineOn = true;
  }

  /** Stop the engine hum (idempotent). */
  stopEngine() {
    if (!this._engineOn) return;
    const t0 = this._now();
    try {
      this._engOscA?.stop(t0 + 0.02);
      this._engOscB?.stop(t0 + 0.02);
    } catch {
      /* already stopped */
    }
    this._engOscA = this._engOscB = null;
    this._engGain = this._engFilter = null;
    this._engineOn = false;
  }

  /**
   * Track the engine hum pitch to the player's speed. Safe to call every frame.
   * @param {number} speed current forward speed (virtual px/s)
   * @param {number} maxSpeed top speed (virtual px/s)
   */
  setEngineSpeed(speed, maxSpeed) {
    if (!this._engineOn || !this._live) return;
    const f = engineFreq(speed, maxSpeed);
    const t = this._now();
    // AIDEV-NOTE: glide the pitch (setTargetAtTime) so speed changes sound like
    // revving rather than stepping; the sub-osc stays an octave below.
    try {
      this._engOscA.frequency.setTargetAtTime(f, t, 0.05);
      this._engOscB.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    } catch {
      this._engOscA.frequency.value = f;
      this._engOscB.frequency.value = f * 0.5;
    }
  }

  // --- One-shot SFX -----------------------------------------------------------

  /** Machine-gun shot: a short noise crack + a quick pitch-down blip. Rate-limited. */
  machineGun() {
    if (!this._acceptGunShot()) return;
    if (!this._live) return;
    this._noiseBurst({ dur: 0.05, gain: 0.18, cutoff: 1800, filterType: "highpass" });
    this._blip({ type: "square", freq: 320, endFreq: 120, dur: 0.06, gain: 0.08 });
  }

  /** Explosion: a low boom of filtered noise with a falling tone. */
  explosion() {
    if (!this._live) return;
    this._noiseBurst({ dur: 0.45, gain: 0.35, cutoff: 900, filterType: "lowpass" });
    this._blip({ type: "triangle", freq: 160, endFreq: 40, dur: 0.4, gain: 0.18 });
  }

  /** Weapon-load jingle: a short rising arpeggio when a special is picked up. */
  weaponLoad() {
    if (!this._live) return;
    const t0 = this._now();
    const sd = 0.09;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6 (major triad up)
    notes.forEach((freq, i) => {
      this._blip({ type: "square", freq, dur: sd * 1.4, gain: 0.1, when: t0 + i * sd });
    });
  }

  /** Civilian-hit warning: a harsh two-tone descending buzz. Rate-limited. */
  civilianWarning() {
    const t = this._now();
    if (t - this._lastWarnAt < this._warnMinInterval) return;
    this._lastWarnAt = t;
    if (!this._live) return;
    this._blip({ type: "sawtooth", freq: 440, endFreq: 220, dur: 0.18, gain: 0.16 });
    this._blip({ type: "sawtooth", freq: 330, endFreq: 160, dur: 0.22, gain: 0.14, when: t + 0.12 });
  }

  /** Low-cars alarm: an urgent repeated high beep. Rate-limited. */
  lowCarsAlarm() {
    const t = this._now();
    if (t - this._lastAlarmAt < this._alarmMinInterval) return;
    this._lastAlarmAt = t;
    if (!this._live) return;
    this._blip({ type: "square", freq: 880, dur: 0.1, gain: 0.14 });
    this._blip({ type: "square", freq: 880, dur: 0.1, gain: 0.14, when: t + 0.16 });
  }

  // --- Helicopter rotor -------------------------------------------------------

  /**
   * Start the helicopter rotor: looping filtered noise whose amplitude is
   * pulsed by a low-frequency oscillator for the "whump-whump" thump.
   * Idempotent. No-op headless / inaudible.
   */
  startRotor() {
    if (this._rotorOn || !this._live) return;
    const ctx = this.audio.ctx;
    const t0 = this._now();
    // ~1s of looping noise.
    const frames = Math.max(1, Math.floor(ctx.sampleRate));
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 360;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    // The thump LFO modulates the gain.
    const lfo = ctx.createOscillator();
    lfo.type = "sawtooth";
    lfo.frequency.value = 11; // ~11 thumps/sec
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.09;
    lfo.connect(lfoDepth);
    lfoDepth.connect(gain.gain);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this._bus);
    // Fade in to the base level.
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.05, t0 + 0.3);
    src.start(t0);
    lfo.start(t0);
    this._rotorSrc = src;
    this._rotorGain = gain;
    this._rotorLfo = lfo;
    this._rotorOn = true;
  }

  /** Stop the rotor (idempotent). */
  stopRotor() {
    if (!this._rotorOn) return;
    const t0 = this._now();
    try {
      if (this._rotorGain) {
        this._rotorGain.gain.cancelScheduledValues(t0);
        this._rotorGain.gain.setValueAtTime(this._rotorGain.gain.value, t0);
        this._rotorGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
      }
      this._rotorSrc?.stop(t0 + 0.3);
      this._rotorLfo?.stop(t0 + 0.3);
    } catch {
      /* already stopped */
    }
    this._rotorSrc = null;
    this._rotorGain = null;
    this._rotorLfo = null;
    this._rotorOn = false;
  }
}

export default Sfx;
