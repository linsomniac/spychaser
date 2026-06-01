// test/sfx.test.js
//
// Pure SFX math + headless safety (Phase 12). The procedural sound effects are
// browser-only (oscillators/noise on a live AudioContext), but the engine-hum
// speed mapping is pure and unit-tested here. We also assert the Sfx manager is
// headless-safe: with no live audio every trigger is a quiet no-op that never
// throws (so the sim/tests can fire SFX events freely).

import { test } from "node:test";
import assert from "node:assert/strict";
import { Sfx, engineFreq } from "../src/audio/sfx.js";
import { AudioEngine } from "../src/audio/audio.js";

// --- engineFreq: speed -> pitch mapping (pure) ------------------------------

test("engineFreq: at rest it sits at the idle frequency", () => {
  const f = engineFreq(0, 420, { idle: 70, max: 240 });
  assert.equal(f, 70);
});

test("engineFreq: at top speed it reaches the max frequency", () => {
  const f = engineFreq(420, 420, { idle: 70, max: 240 });
  assert.equal(f, 240);
});

test("engineFreq: it rises monotonically with speed", () => {
  const opt = { idle: 70, max: 240 };
  const a = engineFreq(100, 420, opt);
  const b = engineFreq(200, 420, opt);
  const c = engineFreq(300, 420, opt);
  assert.ok(a < b && b < c);
});

test("engineFreq: clamps below idle and above max (out-of-range speed)", () => {
  const opt = { idle: 70, max: 240 };
  assert.equal(engineFreq(-100, 420, opt), 70); // negative speed -> idle
  assert.equal(engineFreq(99999, 420, opt), 240); // over top -> max
});

test("engineFreq: a zero maxSpeed does not divide by zero", () => {
  const f = engineFreq(50, 0, { idle: 70, max: 240 });
  assert.ok(Number.isFinite(f));
  assert.equal(f, 70); // degenerate range collapses to idle
});

// --- Headless safety: every trigger is a no-op without live audio -----------

function headlessSfx() {
  // An audio engine with no usable context (forced via a null ctor) — Node has
  // no AudioContext global, so this stays headless.
  const audio = new AudioEngine({ contextCtor: null });
  return new Sfx(audio);
}

test("Sfx: constructs headlessly and exposes the documented triggers", () => {
  const sfx = headlessSfx();
  for (const m of [
    "machineGun",
    "explosion",
    "weaponLoad",
    "civilianWarning",
    "lowCarsAlarm",
    "setEngineSpeed",
    "startEngine",
    "stopEngine",
    "startRotor",
    "stopRotor",
  ]) {
    assert.equal(typeof sfx[m], "function", `missing trigger ${m}`);
  }
});

test("Sfx: all triggers are quiet no-ops when audio is not live", () => {
  const sfx = headlessSfx();
  assert.doesNotThrow(() => {
    sfx.machineGun();
    sfx.explosion();
    sfx.weaponLoad();
    sfx.civilianWarning();
    sfx.lowCarsAlarm();
    sfx.setEngineSpeed(200, 420);
    sfx.startEngine();
    sfx.stopEngine();
    sfx.startRotor();
    sfx.stopRotor();
  });
});

test("Sfx: machineGun rate-limits so a flood can't spawn a voice per call", () => {
  // Even though headless makes the actual audio a no-op, the rate-limit cursor
  // is pure bookkeeping we can observe: many same-instant calls accept at most
  // one. We drive an injected clock so it's deterministic.
  let t = 0;
  const sfx = headlessSfx();
  sfx._now = () => t; // inject a deterministic clock
  let accepted = 0;
  for (let i = 0; i < 50; i++) {
    if (sfx._acceptGunShot()) accepted += 1;
  }
  assert.equal(accepted, 1, "same-instant flood collapses to one shot");
  // After the min interval elapses, another shot is accepted.
  t += sfx.gunMinInterval + 1e-6;
  assert.equal(sfx._acceptGunShot(), true);
});
