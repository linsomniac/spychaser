// test/audioBridge.test.js
//
// The browser audio BRIDGE (Phase 12 glue). It connects the headless World's
// per-tick audio-event queue + continuous state (engine speed, helicopter
// presence) to the AudioEngine / Music / Sfx. The bridge itself contains the
// decision logic (which we test here against a SPY Sfx) while the actual sound
// synthesis stays headless-safe. No real Web Audio is used.

import { test } from "node:test";
import assert from "node:assert/strict";
import { AudioBridge } from "../src/audio/bridge.js";

/** A spy that records which SFX triggers the bridge calls. */
function makeSpySfx() {
  const calls = [];
  const rec =
    (name) =>
    (...args) =>
      calls.push([name, ...args]);
  return {
    calls,
    machineGun: rec("machineGun"),
    explosion: rec("explosion"),
    weaponLoad: rec("weaponLoad"),
    civilianWarning: rec("civilianWarning"),
    lowCarsAlarm: rec("lowCarsAlarm"),
    ricochet: rec("ricochet"),
    setEngineSpeed: rec("setEngineSpeed"),
    startEngine: rec("startEngine"),
    stopEngine: rec("stopEngine"),
    startRotor: rec("startRotor"),
    stopRotor: rec("stopRotor"),
  };
}

/** A fake audio engine exposing just what the bridge touches. */
function makeFakeAudio() {
  return {
    muted: false,
    unlocked: true,
    toggleMuteCalls: 0,
    // Mirrors AudioEngine.audible: a live, unlocked, un-muted engine.
    get audible() {
      return !this.muted && this.unlocked;
    },
    toggleMute() {
      this.muted = !this.muted;
      this.toggleMuteCalls += 1;
      return this.muted;
    },
  };
}

/** A fake music transport. */
function makeFakeMusic() {
  return {
    playing: false,
    start() {
      this.playing = true;
    },
    stop() {
      this.playing = false;
    },
  };
}

/** A minimal fake world with the audio surface the bridge reads. */
function makeWorld(over = {}) {
  let queue = [];
  return {
    state: "playing",
    helicopter: null,
    player: { speed: 0 },
    config: { player: { maxSpeed: 420 } },
    _queue: queue,
    pushAudio(type) {
      this._queue.push({ type });
    },
    drainAudioEvents() {
      const out = this._queue;
      this._queue = [];
      return out;
    },
    ...over,
  };
}

function makeBridge() {
  const audio = makeFakeAudio();
  const music = makeFakeMusic();
  const sfx = makeSpySfx();
  const bridge = new AudioBridge({ audio, music, sfx });
  return { bridge, audio, music, sfx };
}

test("bridge: dispatches queued world audio events to the matching SFX", () => {
  const { bridge, sfx } = makeBridge();
  const world = makeWorld();
  world.pushAudio("gun");
  world.pushAudio("explosion");
  world.pushAudio("civilianWarning");
  world.pushAudio("lowCars");
  world.pushAudio("weaponLoad");
  bridge.update(world, "playing");
  const names = sfx.calls.map((c) => c[0]);
  assert.ok(names.includes("machineGun"));
  assert.ok(names.includes("explosion"));
  assert.ok(names.includes("civilianWarning"));
  assert.ok(names.includes("lowCarsAlarm"));
  assert.ok(names.includes("weaponLoad"));
});

test("the bridge maps a 'ricochet' event to sfx.ricochet while playing", () => {
  const { bridge, sfx } = makeBridge();
  const world = makeWorld();
  world.pushAudio("ricochet");
  bridge.update(world, "playing");
  assert.ok(sfx.calls.some(([name]) => name === "ricochet"), "ricochet SFX fired");
});

test("bridge: starts the engine hum + music when entering PLAYING", () => {
  const { bridge, sfx, music } = makeBridge();
  const world = makeWorld();
  bridge.update(world, "playing");
  assert.ok(sfx.calls.some((c) => c[0] === "startEngine"));
  assert.equal(music.playing, true);
});

test("bridge: tracks engine pitch to the player's speed while playing", () => {
  const { bridge, sfx } = makeBridge();
  const world = makeWorld({ player: { speed: 210 } });
  bridge.update(world, "playing");
  const call = sfx.calls.find((c) => c[0] === "setEngineSpeed");
  assert.ok(call, "setEngineSpeed not called");
  assert.equal(call[1], 210);
  assert.equal(call[2], 420);
});

test("bridge: stops the engine + music when leaving PLAYING", () => {
  const { bridge, sfx, music } = makeBridge();
  const world = makeWorld();
  bridge.update(world, "playing");
  sfx.calls.length = 0;
  bridge.update(world, "gameover");
  assert.ok(sfx.calls.some((c) => c[0] === "stopEngine"));
  assert.equal(music.playing, false);
});

test("bridge: starts the rotor when a helicopter appears, stops it when gone", () => {
  const { bridge, sfx } = makeBridge();
  const world = makeWorld();
  // No heli yet.
  bridge.update(world, "playing");
  assert.ok(!sfx.calls.some((c) => c[0] === "startRotor"));
  // Heli appears.
  world.helicopter = { dead: false };
  bridge.update(world, "playing");
  assert.ok(sfx.calls.some((c) => c[0] === "startRotor"));
  sfx.calls.length = 0;
  // Heli gone.
  world.helicopter = null;
  bridge.update(world, "playing");
  assert.ok(sfx.calls.some((c) => c[0] === "stopRotor"));
});

test("bridge: the rotor is silenced while not playing even if a heli lingers", () => {
  const { bridge, sfx } = makeBridge();
  const world = makeWorld({ helicopter: { dead: false } });
  bridge.update(world, "playing"); // rotor on
  assert.ok(sfx.calls.some((c) => c[0] === "startRotor"));
  sfx.calls.length = 0;
  bridge.update(world, "paused"); // pause -> rotor off
  assert.ok(sfx.calls.some((c) => c[0] === "stopRotor"));
});

test("bridge: toggleMute flips the engine mute and returns the new state", () => {
  const { bridge, audio } = makeBridge();
  assert.equal(audio.muted, false);
  const muted = bridge.toggleMute();
  assert.equal(muted, true);
  assert.equal(audio.muted, true);
  assert.equal(audio.toggleMuteCalls, 1);
});

test("bridge: a paused tick drains events but does not re-fire them on resume", () => {
  const { bridge, sfx } = makeBridge();
  const world = makeWorld();
  world.pushAudio("explosion");
  // While paused we still drain the queue (so it doesn't pile up) but suppress
  // sound — and crucially the event is consumed, not replayed on resume.
  bridge.update(world, "paused");
  assert.equal(world.drainAudioEvents().length, 0, "queue was drained");
  sfx.calls.length = 0;
  bridge.update(world, "playing");
  assert.ok(!sfx.calls.some((c) => c[0] === "explosion"), "no stale replay");
});

// --- Regression M2: starting/encountering loops while muted must re-arm --------
// Bug: the bridge latched _playingAudioOn/_rotorOn true on the first PLAYING
// frame regardless of audibility, while Sfx.start* no-op when muted. Un-muting
// (M only ramps master gain) never re-entered the start branch, so a game begun
// while muted stayed silent for the whole session. Fix: gate the START on
// audibility so un-muting arms the engine hum + rotor.
test("bridge: a game started while muted arms the engine hum on un-mute (M2)", () => {
  const { bridge, audio, sfx, music } = makeBridge();
  audio.muted = true; // muted before the run begins
  const world = makeWorld();
  bridge.update(world, "playing");
  assert.ok(!sfx.calls.some((c) => c[0] === "startEngine"), "engine not armed while muted");
  audio.muted = false; // player presses M
  bridge.update(world, "playing");
  assert.ok(sfx.calls.some((c) => c[0] === "startEngine"), "engine starts after un-mute");
  assert.equal(music.playing, true);
});

test("bridge: a helicopter seen while muted gets its rotor on un-mute (M2)", () => {
  const { bridge, audio, sfx } = makeBridge();
  audio.muted = true;
  const world = makeWorld({ helicopter: { dead: false } });
  bridge.update(world, "playing");
  assert.ok(!sfx.calls.some((c) => c[0] === "startRotor"), "rotor not armed while muted");
  audio.muted = false;
  bridge.update(world, "playing");
  assert.ok(sfx.calls.some((c) => c[0] === "startRotor"), "rotor starts after un-mute");
});
