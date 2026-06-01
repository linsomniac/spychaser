// test/audio.test.js
//
// The audio engine's PURE/observable behavior (Phase 12): the mute/volume gain
// math, headless safety (no Web Audio => quiet no-ops), and the gesture-unlock +
// mute lifecycle exercised against a minimal FAKE AudioContext. No real Web
// Audio is used; we inject a fake context constructor.

import { test } from "node:test";
import assert from "node:assert/strict";
import { AudioEngine, muteFactor } from "../src/audio/audio.js";

// --- Pure gain math ---------------------------------------------------------

test("muteFactor: muted => 0 regardless of volume", () => {
  assert.equal(muteFactor(true, 1), 0);
  assert.equal(muteFactor(true, 0.5), 0);
});

test("muteFactor: unmuted => the (clamped) volume", () => {
  assert.equal(muteFactor(false, 0.6), 0.6);
  assert.equal(muteFactor(false, 2), 1); // clamps high
  assert.equal(muteFactor(false, -1), 0); // clamps low
});

// --- A minimal fake Web Audio graph for lifecycle tests ---------------------

class FakeParam {
  constructor(v) {
    this.value = v;
    this.events = [];
  }
  setValueAtTime(v, t) {
    this.value = v;
    this.events.push(["set", v, t]);
  }
  linearRampToValueAtTime(v, t) {
    this.value = v;
    this.events.push(["ramp", v, t]);
  }
  cancelScheduledValues(t) {
    this.events.push(["cancel", t]);
  }
}

class FakeGain {
  constructor() {
    this.gain = new FakeParam(1);
    this.connectedTo = null;
  }
  connect(node) {
    this.connectedTo = node;
  }
}

class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.state = "suspended";
    this.destination = { name: "destination" };
    this.resumed = 0;
  }
  createGain() {
    return new FakeGain();
  }
  resume() {
    this.state = "running";
    this.resumed += 1;
    return Promise.resolve();
  }
}

class FakeTarget {
  constructor() {
    this.listeners = new Map();
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) {
    this.listeners.get(type)?.delete(fn);
  }
  dispatch(type) {
    for (const fn of this.listeners.get(type) ?? []) fn();
  }
  count() {
    let n = 0;
    for (const s of this.listeners.values()) n += s.size;
    return n;
  }
}

// --- Headless safety --------------------------------------------------------

test("AudioEngine: headless (no context ctor) is a quiet no-op", () => {
  const a = new AudioEngine({ contextCtor: null });
  // Force the lazy resolver to find nothing by relying on Node having no
  // AudioContext global.
  assert.equal(a.ensureContext(), typeof globalThis.AudioContext !== "undefined");
  // Toggling mute and unlocking never throw even with no graph.
  assert.doesNotThrow(() => a.toggleMute());
  assert.doesNotThrow(() => a.setVolume(0.4));
  assert.equal(a.now(), 0);
  assert.equal(a.audible, false);
});

// --- Lifecycle against the fake context -------------------------------------

test("AudioEngine: ensureContext builds master + music + sfx buses", () => {
  const a = new AudioEngine({ contextCtor: FakeAudioContext });
  assert.equal(a.ensureContext(), true);
  assert.ok(a.ctx instanceof FakeAudioContext);
  assert.ok(a.masterGain && a.musicBus && a.sfxBus);
  // Master gain starts at the unmuted volume; sub-buses feed the master.
  assert.equal(a.masterGain.gain.value, 0.6);
  assert.equal(a.musicBus.connectedTo, a.masterGain);
  assert.equal(a.sfxBus.connectedTo, a.masterGain);
  assert.equal(a.masterGain.connectedTo, a.ctx.destination);
});

test("AudioEngine: ensureContext is idempotent (one context)", () => {
  const a = new AudioEngine({ contextCtor: FakeAudioContext });
  a.ensureContext();
  const ctx = a.ctx;
  a.ensureContext();
  assert.equal(a.ctx, ctx);
});

test("AudioEngine: starts muted => master gain is 0", () => {
  const a = new AudioEngine({ contextCtor: FakeAudioContext, muted: true });
  a.ensureContext();
  assert.equal(a.masterGain.gain.value, 0);
});

test("AudioEngine: toggleMute flips state and ramps the master gain", () => {
  const a = new AudioEngine({ contextCtor: FakeAudioContext, volume: 0.5 });
  a.ensureContext();
  assert.equal(a.toggleMute(), true); // now muted
  assert.equal(a.masterGain.gain.value, 0);
  assert.equal(a.toggleMute(), false); // unmuted
  assert.equal(a.masterGain.gain.value, 0.5);
});

test("AudioEngine: first gesture unlocks + resumes, then detaches listeners", () => {
  const a = new AudioEngine({ contextCtor: FakeAudioContext });
  const target = new FakeTarget();
  a.installGestureUnlock(target);
  assert.ok(target.count() > 0, "listeners installed");
  assert.equal(a.unlocked, false);

  target.dispatch("keydown"); // first gesture
  assert.equal(a.unlocked, true);
  assert.equal(a.ctx.state, "running");
  assert.equal(a.ctx.resumed, 1);
  assert.equal(target.count(), 0, "listeners removed after unlock");
});

test("AudioEngine: audible only when live + unlocked + unmuted", () => {
  const a = new AudioEngine({ contextCtor: FakeAudioContext });
  a.ensureContext();
  assert.equal(a.audible, false); // not unlocked yet
  a.unlock();
  assert.equal(a.audible, true);
  a.setMuted(true);
  assert.equal(a.audible, false);
});
