// audio/bridge.js
//
// The audio BRIDGE (Phase 12 glue): the one place that couples the headless
// World to the Web Audio subsystem. Each frame it (a) drains the World's
// per-tick audio-event queue and fires the matching one-shot SFX, (b) keeps the
// continuous engine hum + music transport in sync with the game state, and
// (c) starts/stops the helicopter rotor as the heli set-piece comes and goes.
//
// AIDEV-NOTE: This module owns the DECISION logic (what to play and when) but
// performs NO synthesis itself — it delegates to Sfx / Music, which are
// headless-safe (every method is a no-op without a live, audible AudioEngine).
// That keeps the bridge fully unit-testable against fakes (test/audioBridge.test.js)
// and means the whole audio layer can be driven in Node without Web Audio.

/** World audio-event tag -> Sfx method name. */
const EVENT_TO_SFX = Object.freeze({
  gun: "machineGun",
  explosion: "explosion",
  civilianWarning: "civilianWarning",
  lowCars: "lowCarsAlarm",
  weaponLoad: "weaponLoad",
});

export class AudioBridge {
  /**
   * @param {Object} deps
   * @param {import("./audio.js").AudioEngine} deps.audio shared engine (mute/ctx)
   * @param {import("./music.js").Music} deps.music music transport
   * @param {import("./sfx.js").Sfx} deps.sfx procedural SFX
   */
  constructor({ audio, music, sfx }) {
    this.audio = audio;
    this.music = music;
    this.sfx = sfx;
    /** whether the PLAYING-only loops (engine hum + music) are currently on. */
    this._playingAudioOn = false;
    /** whether the helicopter rotor loop is currently on. */
    this._rotorOn = false;
  }

  /**
   * Advance the audio one frame for the given world + active game state.
   * @param {import("../core/world.js").World} world the sim world
   * @param {string} gameState the StateMachine state value (GameState.PLAYING ===
   *   "playing"); audio only sounds in the PLAYING state.
   */
  update(world, gameState) {
    const playing = gameState === "playing";

    // 1) Always DRAIN the world's event queue so it never piles up; only SOUND
    //    the events while actually playing (paused/menu ticks stay quiet but
    //    consume the queue so nothing replays on resume).
    const events = world.drainAudioEvents();
    if (playing) {
      for (const ev of events) {
        const method = EVENT_TO_SFX[ev.type];
        if (method) this.sfx[method]();
      }
    }

    // 2) Continuous PLAYING-only loops: engine hum + music transport.
    if (playing && !this._playingAudioOn) {
      this.sfx.startEngine();
      this.music.start();
      this._playingAudioOn = true;
    } else if (!playing && this._playingAudioOn) {
      this.sfx.stopEngine();
      this.music.stop();
      this._playingAudioOn = false;
    }
    if (playing) {
      // Track the engine pitch to the player's forward speed each frame.
      const maxSpeed = world.config?.player?.maxSpeed ?? 420;
      this.sfx.setEngineSpeed(world.player?.speed ?? 0, maxSpeed);
    }

    // 3) Helicopter rotor: on iff a live heli is present AND we are playing.
    const wantRotor = playing && !!world.helicopter && !world.helicopter.dead;
    if (wantRotor && !this._rotorOn) {
      this.sfx.startRotor();
      this._rotorOn = true;
    } else if (!wantRotor && this._rotorOn) {
      this.sfx.stopRotor();
      this._rotorOn = false;
    }
  }

  /**
   * Toggle global mute (the "M" key). Delegates to the engine; returns the new
   * muted state.
   * @returns {boolean}
   */
  toggleMute() {
    return this.audio.toggleMute();
  }

  /** Silence the continuous loops (e.g. on a hard reset). */
  silence() {
    if (this._playingAudioOn) {
      this.sfx.stopEngine();
      this.music.stop();
      this._playingAudioOn = false;
    }
    if (this._rotorOn) {
      this.sfx.stopRotor();
      this._rotorOn = false;
    }
  }
}

export default AudioBridge;
