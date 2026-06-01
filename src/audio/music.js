// audio/music.js
//
// An ORIGINAL spy/driving chiptune loop (Phase 12, spec §8). It is split into:
//
//   1. PURE, CANVAS/AUDIO-FREE sequencer math (Sequencer, note<->frequency
//      helpers, the SONG pattern data, patternStep). These are unit-tested
//      headlessly (test/music.test.js) — they never touch AudioContext.
//   2. A thin browser-only Music player that, given an AudioCtx wrapper from
//      audio/audio.js, schedules oscillator events for each upcoming step on a
//      look-ahead timer. The player imports nothing DOM/Audio at module top
//      level; the ctx is INJECTED.
//
// AIDEV-NOTE: This melody is deliberately ORIGINAL and merely evocative of a
// tense spy/driving groove. It MUST NOT be the copyrighted "Peter Gunn" theme
// (spec §2 non-goals). It is a minor-key riff with a walking-ish bass, a broken
// arpeggio, and a syncopated lead — its own thing. The "not Peter Gunn" guard
// in the tests asserts the bass is not a single repeated low-E ostinato.

// ---------------------------------------------------------------------------
// Note / frequency math (pure)
// ---------------------------------------------------------------------------

/** Semitone offsets from C within an octave, sharps + flats accepted. */
const NOTE_SEMITONES = Object.freeze({
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  Fb: 4,
  "E#": 5,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
  Cb: 11,
  "B#": 12,
});

/**
 * Convert a scientific-pitch note name (e.g. "A4", "C#3", "Eb4") to a MIDI
 * number. Rests — null, undefined, or "." — return null (not a note).
 * MIDI 69 == A4 == 440 Hz; MIDI 60 == middle C (C4).
 * @param {string|null|undefined} name
 * @returns {number|null}
 */
export function noteToMidi(name) {
  if (name == null || name === ".") return null;
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(String(name).trim());
  if (!m) return null;
  const letter = m[1].toUpperCase();
  const accidental = m[2];
  const octave = parseInt(m[3], 10);
  const semitone = NOTE_SEMITONES[letter + accidental];
  if (semitone == null) return null;
  // MIDI octave convention: C-1 = 0, so C{oct} = (oct + 1) * 12.
  return (octave + 1) * 12 + semitone;
}

/**
 * Equal-temperament MIDI-number -> frequency in Hz (A4 = MIDI 69 = 440 Hz).
 * @param {number} midi
 * @returns {number}
 */
export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Convenience: a note name straight to Hz, or null for a rest. */
export function noteToFreq(name) {
  const midi = noteToMidi(name);
  return midi == null ? null : midiToFreq(midi);
}

/**
 * Seconds per sequencer step for a given tempo + subdivision.
 * @param {number} bpm beats (quarter notes) per minute.
 * @param {number} stepsPerBeat grid subdivision (4 => 16th-note steps).
 * @returns {number} seconds per step.
 */
export function stepDuration(bpm, stepsPerBeat) {
  return 60 / bpm / stepsPerBeat;
}

/**
 * Read a track's note at an arbitrary (possibly out-of-range, looped) step
 * index. The scheduler passes ABSOLUTE step numbers that keep climbing across
 * loops, so wrap modulo the pattern length here.
 * @param {ReadonlyArray<string|null>} track
 * @param {number} step absolute step index (>= 0)
 * @returns {string|null}
 */
export function patternStep(track, step) {
  const n = track.length;
  // (% n + n) % n keeps negative inputs well-defined too.
  return track[((step % n) + n) % n];
}

// ---------------------------------------------------------------------------
// Sequencer (pure step indexing)
// ---------------------------------------------------------------------------

export class Sequencer {
  /**
   * @param {Object} opts
   * @param {number} opts.bpm tempo in beats per minute.
   * @param {number} opts.stepsPerBeat grid subdivision (4 = 16th notes).
   * @param {number} opts.steps number of steps in one loop.
   */
  constructor({ bpm, stepsPerBeat, steps }) {
    this.bpm = bpm;
    this.stepsPerBeat = stepsPerBeat;
    this.steps = steps;
    /** seconds per step. */
    this.stepDuration = stepDuration(bpm, stepsPerBeat);
    /** seconds for one full loop. */
    this.loopDuration = this.stepDuration * steps;
  }

  /**
   * The WRAPPED step index playing at absolute time `t` (seconds since the song
   * started). Wraps modulo `steps` so it indexes the pattern arrays directly.
   * @param {number} t seconds (>= 0)
   * @returns {number} 0..steps-1
   */
  stepIndexAt(t) {
    const abs = Math.floor(t / this.stepDuration);
    return ((abs % this.steps) + this.steps) % this.steps;
  }

  /**
   * The ABSOLUTE step number at time `t` (does NOT wrap; climbs across loops).
   * @param {number} t seconds (>= 0)
   * @returns {number}
   */
  absStepAt(t) {
    return Math.floor(t / this.stepDuration);
  }

  /**
   * Absolute start time (seconds) of absolute step number `absStep`.
   * @param {number} absStep
   * @returns {number}
   */
  stepStartTime(absStep) {
    return absStep * this.stepDuration;
  }

  /**
   * Every step whose START falls in the half-open window [from, to). Returns
   * objects with the WRAPPED pattern index plus the ABSOLUTE start time, so the
   * scheduler can both look up the note (wrapped) and place it on the audio
   * clock (absolute). Used by the browser look-ahead scheduler.
   *
   * AIDEV-NOTE: half-open [from, to) so adjacent calls (to == next from) never
   * double-schedule the boundary step. The first candidate is the first absolute
   * step at or after `from`.
   * @param {number} from seconds (inclusive)
   * @param {number} to seconds (exclusive)
   * @returns {Array<{step:number, time:number}>}
   */
  stepsInWindow(from, to) {
    const out = [];
    let abs = Math.ceil(from / this.stepDuration - 1e-9);
    if (abs < 0) abs = 0;
    for (let t = abs * this.stepDuration; t < to - 1e-12; t += this.stepDuration) {
      out.push({
        step: ((abs % this.steps) + this.steps) % this.steps,
        time: t,
      });
      abs += 1;
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// SONG — the original chiptune patterns
// ---------------------------------------------------------------------------

// AIDEV-NOTE: 16-step (one bar of 16th notes) loop in E minor, original. The
// bass walks E-G-A-B with chromatic passing tones (NOT a static low-E ostinato),
// the arp outlines Em / G / D triads in a broken pattern, and the lead is a
// sparse, syncopated motif sitting above. "." or null = rest. Pitches are kept
// in singable ranges per track (bass low, arp mid, lead high).
export const SONG = Object.freeze({
  bpm: 132,
  stepsPerBeat: 4, // 16th-note grid
  steps: 16,

  // Driving bassline: walking E minor with chromatic approach tones.
  bass: Object.freeze([
    "E2", ".", "E2", "G2",
    "A2", ".", "A2", "B2",
    "C3", ".", "B2", "A2",
    "G2", "A2", "B2", "D3",
  ]),

  // Broken arpeggio outlining Em / G / D — sits in the middle register.
  arp: Object.freeze([
    "E3", "G3", "B3", "G3",
    "E3", "G3", "B3", "D4",
    "G3", "B3", "D4", "B3",
    "D4", "A3", "F#3", "D4",
  ]),

  // Sparse syncopated lead motif on top (lots of rests for tension).
  lead: Object.freeze([
    "E4", ".", ".", "G4",
    ".", "B4", ".", ".",
    "A4", ".", "G4", ".",
    "F#4", ".", "E4", ".",
  ]),
});

// ---------------------------------------------------------------------------
// Music — browser-only oscillator scheduler (AudioCtx injected)
// ---------------------------------------------------------------------------

/**
 * Per-track voice settings (oscillator type + relative gain + envelope). Pure
 * data; consumed only by the browser scheduler.
 */
const VOICES = Object.freeze({
  bass: { type: "triangle", gain: 0.32, hold: 0.9, attack: 0.005, release: 0.06 },
  arp: { type: "square", gain: 0.12, hold: 0.55, attack: 0.004, release: 0.05 },
  lead: { type: "sawtooth", gain: 0.16, hold: 0.7, attack: 0.006, release: 0.08 },
});

export class Music {
  /**
   * @param {import("./audio.js").AudioEngine} audio the shared audio engine
   *   (provides .ctx, .now(), a music bus gain node, and the running flag).
   * @param {typeof SONG} [song]
   */
  constructor(audio, song = SONG) {
    /** @type {import("./audio.js").AudioEngine} */
    this.audio = audio;
    /** @type {typeof SONG} */
    this.song = song;
    /** @type {Sequencer} */
    this.seq = new Sequencer({
      bpm: song.bpm,
      stepsPerBeat: song.stepsPerBeat,
      steps: song.steps,
    });

    /** Whether the music transport is running. */
    this.playing = false;
    /** AudioContext time (seconds) at which the song's t=0 sits. */
    this._startTime = 0;
    /** How far ahead (audio-clock seconds) we have already scheduled. */
    this._scheduledUntil = 0;
    /** setInterval handle for the look-ahead pump. */
    this._timer = null;

    // AIDEV-NOTE: look-ahead scheduling (the standard Web Audio pattern). We run
    // a coarse JS timer every TICK seconds and, on each tick, schedule all notes
    // whose start falls within the next LOOKAHEAD seconds onto the precise audio
    // clock. This decouples musical timing (sample-accurate) from the jittery JS
    // timer.
    this._lookahead = 0.2; // seconds of audio scheduled ahead
    this._tickMs = 60; // JS timer cadence (ms)
  }

  /** Start (or restart) the transport from the top of the loop. */
  start() {
    const ctx = this.audio && this.audio.ctx;
    if (!ctx) return; // headless / no Web Audio: no-op
    if (this.playing) return;
    this.playing = true;
    this._startTime = this.audio.now();
    this._scheduledUntil = this._startTime;
    this._pump();
    if (typeof setInterval === "function") {
      this._timer = setInterval(() => this._pump(), this._tickMs);
    }
  }

  /** Stop the transport (silences future notes; in-flight ones ring out). */
  stop() {
    this.playing = false;
    if (this._timer != null && typeof clearInterval === "function") {
      clearInterval(this._timer);
    }
    this._timer = null;
  }

  /**
   * Schedule every step whose start lands in the next look-ahead window onto the
   * audio clock. Idempotent across overlapping calls thanks to the half-open
   * window and the advancing `_scheduledUntil` cursor.
   * @private
   */
  _pump() {
    const ctx = this.audio && this.audio.ctx;
    if (!ctx || !this.playing) return;
    const horizon = this.audio.now() + this._lookahead;
    // Window of SONG-relative time we still need to fill.
    const from = this._scheduledUntil - this._startTime;
    const to = horizon - this._startTime;
    if (to <= from) return;
    const events = this.seq.stepsInWindow(from, to);
    for (const ev of events) {
      const when = this._startTime + ev.time;
      this._scheduleStep(ev.step, when);
    }
    this._scheduledUntil = horizon;
  }

  /**
   * Schedule the three voices' notes for one step at audio time `when`.
   * @param {number} step wrapped pattern index
   * @param {number} when audio-clock time (seconds)
   * @private
   */
  _scheduleStep(step, when) {
    for (const track of ["bass", "arp", "lead"]) {
      const note = patternStep(this.song[track], step);
      const freq = noteToFreq(note);
      if (freq == null) continue; // rest
      this._playNote(VOICES[track], freq, when);
    }
  }

  /**
   * One enveloped oscillator note routed through the music bus.
   * @param {{type:string,gain:number,hold:number,attack:number,release:number}} voice
   * @param {number} freq Hz
   * @param {number} when audio-clock start time (seconds)
   * @private
   */
  _playNote(voice, freq, when) {
    const ctx = this.audio.ctx;
    const bus = this.audio.musicBus;
    if (!ctx || !bus) return;
    const dur = this.seq.stepDuration * voice.hold;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = voice.type;
    osc.frequency.setValueAtTime(freq, when);
    // Click-free attack/release envelope.
    env.gain.setValueAtTime(0.0001, when);
    env.gain.exponentialRampToValueAtTime(voice.gain, when + voice.attack);
    const stopAt = when + dur;
    env.gain.setValueAtTime(voice.gain, Math.max(when + voice.attack, stopAt - voice.release));
    env.gain.exponentialRampToValueAtTime(0.0001, stopAt);
    osc.connect(env);
    env.connect(bus);
    osc.start(when);
    osc.stop(stopAt + 0.02);
  }
}

export default Music;
