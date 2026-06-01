// test/weather.test.js
//
// Phase 9 — weather (fog & ice). Per the test-first rule these lock in the PURE
// traction math (how ice intensity scales the car's effective grip) and the
// Weather state machine that triggers, ramps, and clears fog/ice episodes by
// timer — all decoupled from canvas/raf so they step headlessly.

import test from "node:test";
import assert from "node:assert/strict";

import {
  iceTraction,
  fogVisibleFraction,
  Weather,
  WEATHER_FOG,
  WEATHER_ICE,
} from "../src/systems/weather.js";
import { config } from "../src/data/config.js";

const dt = config.FIXED_STEP;

// --- iceTraction: the pure traction math -------------------------------------

test("iceTraction: zero intensity leaves grip unchanged (dry road)", () => {
  const base = config.player.grip;
  assert.equal(iceTraction(0, base, config.weather.ice.minGripFactor), base);
});

test("iceTraction: full intensity drops grip to base * minGripFactor", () => {
  const base = config.player.grip;
  const f = config.weather.ice.minGripFactor;
  assert.ok(Math.abs(iceTraction(1, base, f) - base * f) < 1e-9);
});

test("iceTraction: full ice is slidier than the dry car (lower grip)", () => {
  const base = config.player.grip;
  const f = config.weather.ice.minGripFactor;
  assert.ok(iceTraction(1, base, f) < base, "ice grip must be below dry grip");
});

test("iceTraction: grip decreases monotonically as intensity rises", () => {
  const base = config.player.grip;
  const f = config.weather.ice.minGripFactor;
  let prev = Infinity;
  for (let i = 0; i <= 10; i++) {
    const g = iceTraction(i / 10, base, f);
    assert.ok(g <= prev + 1e-9, "grip should not increase with intensity");
    prev = g;
  }
});

test("iceTraction: clamps intensity outside [0,1]", () => {
  const base = config.player.grip;
  const f = config.weather.ice.minGripFactor;
  assert.equal(iceTraction(-5, base, f), base, "below 0 clamps to dry grip");
  assert.ok(
    Math.abs(iceTraction(5, base, f) - base * f) < 1e-9,
    "above 1 clamps to full ice",
  );
});

// --- fogVisibleFraction: visibility scales with intensity --------------------

test("fogVisibleFraction: zero intensity is fully visible (1)", () => {
  assert.equal(fogVisibleFraction(0, config.weather.fog.visibleFraction), 1);
});

test("fogVisibleFraction: full intensity reaches the configured floor", () => {
  const floor = config.weather.fog.visibleFraction;
  assert.ok(Math.abs(fogVisibleFraction(1, floor) - floor) < 1e-9);
});

test("fogVisibleFraction: visibility shrinks monotonically with intensity", () => {
  const floor = config.weather.fog.visibleFraction;
  let prev = Infinity;
  for (let i = 0; i <= 10; i++) {
    const v = fogVisibleFraction(i / 10, floor);
    assert.ok(v <= prev + 1e-9, "visible fraction should not grow with fog");
    prev = v;
  }
});

// --- Weather state machine: trigger / ramp / clear ---------------------------

test("Weather: starts clear with no active episode", () => {
  const w = new Weather();
  assert.equal(w.active, null, "no episode at start");
  assert.equal(w.intensity, 0, "intensity zero when clear");
  assert.equal(w.isFog, false);
  assert.equal(w.isIce, false);
});

test("Weather: trigger(fog) makes fog active and ramps intensity in", () => {
  const w = new Weather();
  w.trigger(WEATHER_FOG);
  assert.equal(w.active, WEATHER_FOG);
  assert.equal(w.isFog, true);
  assert.equal(w.isIce, false);
  // Right after trigger, intensity is still ~0 and climbs over fadeIn seconds.
  const i0 = w.intensity;
  for (let i = 0; i < 30; i++) w.update(dt);
  assert.ok(w.intensity > i0, "fog intensity ramps up during fade-in");
});

test("Weather: fog reaches full intensity after the fade-in window", () => {
  const w = new Weather();
  w.trigger(WEATHER_FOG);
  const steps = Math.ceil(config.weather.fog.fadeIn / dt) + 2;
  for (let i = 0; i < steps; i++) w.update(dt);
  assert.ok(Math.abs(w.intensity - 1) < 1e-6, "fog at full intensity mid-episode");
});

test("Weather: a fog episode clears on its own after the duration", () => {
  const w = new Weather();
  w.trigger(WEATHER_FOG);
  const f = config.weather.fog;
  const total = f.duration + f.fadeOut + 0.5;
  const steps = Math.ceil(total / dt);
  for (let i = 0; i < steps; i++) w.update(dt);
  assert.equal(w.active, null, "episode cleared after duration + fade-out");
  assert.equal(w.intensity, 0, "intensity back to zero once clear");
});

test("Weather: intensity fades back out toward the end of the episode", () => {
  const w = new Weather();
  w.trigger(WEATHER_ICE);
  const ice = config.weather.ice;
  // Run past fade-in to full intensity (the hold phase), record the peak.
  const midSteps = Math.ceil((ice.fadeIn + 0.5) / dt);
  for (let i = 0; i < midSteps; i++) w.update(dt);
  const peak = w.intensity;
  assert.ok(Math.abs(peak - 1) < 1e-6, "reaches full intensity mid-episode");
  // Advance to the MIDDLE of the fade-out window: elapsed = duration+fadeOut/2,
  // which is still inside [duration, duration+fadeOut) so the episode is live.
  const target = ice.duration + ice.fadeOut * 0.5;
  while (w["_elapsed"] < target && w.active === WEATHER_ICE) w.update(dt);
  assert.equal(w.active, WEATHER_ICE, "still in the episode mid fade-out");
  assert.ok(w.intensity < peak, "intensity drops during fade-out");
  assert.ok(w.intensity > 0, "but has not fully cleared yet");
});

test("Weather: triggering a new episode replaces the current one", () => {
  const w = new Weather();
  w.trigger(WEATHER_FOG);
  for (let i = 0; i < 30; i++) w.update(dt);
  w.trigger(WEATHER_ICE);
  assert.equal(w.active, WEATHER_ICE, "new episode takes over");
  assert.equal(w.isIce, true);
  assert.equal(w.isFog, false);
});

test("Weather: effectiveGrip is the dry grip when clear, slidier under ice", () => {
  const w = new Weather();
  const base = config.player.grip;
  assert.equal(w.effectiveGrip(base), base, "no weather -> dry grip");

  w.trigger(WEATHER_ICE);
  const steps = Math.ceil(config.weather.ice.fadeIn / dt) + 2;
  for (let i = 0; i < steps; i++) w.update(dt);
  assert.ok(w.effectiveGrip(base) < base, "full ice -> reduced grip");
  assert.ok(
    Math.abs(w.effectiveGrip(base) - base * config.weather.ice.minGripFactor) < 1e-6,
    "full ice grip matches iceTraction",
  );
});

test("Weather: effectiveGrip is unaffected by fog (fog is visual only)", () => {
  const w = new Weather();
  const base = config.player.grip;
  w.trigger(WEATHER_FOG);
  const steps = Math.ceil(config.weather.fog.fadeIn / dt) + 2;
  for (let i = 0; i < steps; i++) w.update(dt);
  assert.equal(w.effectiveGrip(base), base, "fog never changes traction");
});

test("Weather: fogVisibility is 1 when clear and shrinks under fog", () => {
  const w = new Weather();
  assert.equal(w.fogVisibility(), 1, "clear -> fully visible");
  w.trigger(WEATHER_ICE);
  const steps = Math.ceil(config.weather.ice.fadeIn / dt) + 2;
  for (let i = 0; i < steps; i++) w.update(dt);
  assert.equal(w.fogVisibility(), 1, "ice is not fog -> visibility unchanged");

  const w2 = new Weather();
  w2.trigger(WEATHER_FOG);
  const fsteps = Math.ceil(config.weather.fog.fadeIn / dt) + 2;
  for (let i = 0; i < fsteps; i++) w2.update(dt);
  assert.ok(w2.fogVisibility() < 1, "full fog reduces visibility");
});

test("Weather: clear() ends any episode immediately", () => {
  const w = new Weather();
  w.trigger(WEATHER_FOG);
  for (let i = 0; i < 30; i++) w.update(dt);
  w.clear();
  assert.equal(w.active, null);
  assert.equal(w.intensity, 0);
});

test("Weather: an unknown kind is ignored (no episode)", () => {
  const w = new Weather();
  w.trigger("blizzard");
  assert.equal(w.active, null, "unknown weather kind does nothing");
});

test("Weather: deterministic — identical triggers produce identical timelines", () => {
  function run() {
    const w = new Weather();
    const out = [];
    for (let i = 0; i < 1200; i++) {
      if (i === 10) w.trigger(WEATHER_ICE);
      if (i === 700) w.trigger(WEATHER_FOG);
      w.update(dt);
      out.push([w.active, Number(w.intensity.toFixed(6))]);
    }
    return out;
  }
  assert.deepEqual(run(), run());
});

export default null;
