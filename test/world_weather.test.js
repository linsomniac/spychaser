// test/world_weather.test.js
//
// Phase 9 — weather integration at the World level: a "weather" director
// set-piece triggers a fog OR ice episode, the episode advances and clears on
// its own, an ICE episode makes the player's steering slippery, and reset wipes
// it. The weather LOGIC itself is unit-tested in weather.test.js; these assert
// the wiring (world.update -> weather machine -> player handling).

import { test } from "node:test";
import assert from "node:assert/strict";

import { World } from "../src/core/world.js";
import { config } from "../src/data/config.js";
import { WEATHER_FOG, WEATHER_ICE } from "../src/systems/weather.js";

const dt = config.FIXED_STEP;

test("world: a 'weather' set-piece triggers a fog or ice episode", () => {
  const w = new World({ seed: 7 });
  assert.equal(w.weather.active, null, "no weather at start");
  w._realizeSpawn({ kind: "setpiece", name: "weather" });
  assert.ok(
    w.weather.active === WEATHER_FOG || w.weather.active === WEATHER_ICE,
    "weather episode is active after the set-piece",
  );
});

test("world: the weather kind is deterministic for a seed", () => {
  function rolled(seed) {
    const w = new World({ seed });
    w._realizeSpawn({ kind: "setpiece", name: "weather" });
    return w.weather.active;
  }
  assert.equal(rolled(12345), rolled(12345));
});

test("world: a triggered episode advances and eventually clears", () => {
  const w = new World({ seed: 7 });
  w._realizeSpawn({ kind: "setpiece", name: "weather" });
  const kind = w.weather.active;
  assert.ok(kind, "episode active");
  const def = kind === WEATHER_FOG ? config.weather.fog : config.weather.ice;
  const total = def.duration + def.fadeOut + 1.0;
  const steps = Math.ceil(total / dt);
  for (let i = 0; i < steps; i++) w.update(dt);
  assert.equal(w.weather.active, null, "weather clears after its duration");
  assert.equal(w.weather.intensity, 0);
});

test("world: an ICE episode makes the player's steering slippery (carries momentum)", () => {
  // Compare the same scripted steer input under dry vs full-ice handling. On dry
  // road the car stops moving laterally the instant the steer input is released;
  // on ice it keeps sliding (iceVx carries momentum), so it drifts further.
  function driveAndCoast(useIce) {
    const w = new World({ seed: 99 });
    // Force the road flat-ish by sampling at the start; keep distance modest so
    // we stay on dry road (no water this early for this seed region).
    if (useIce) {
      w.weather.trigger(WEATHER_ICE);
      // Ramp ice to full intensity so the contrast is unambiguous.
      const warm = Math.ceil(config.weather.ice.fadeIn / dt) + 2;
      for (let i = 0; i < warm; i++) w.weather.update(dt);
    }
    const p = w.player;
    p.x = config.VIRTUAL_WIDTH / 2;
    // Steer right for a while.
    for (let i = 0; i < 30; i++) {
      p.update(dt, { right: true }, w.road, 0, w.weather);
    }
    const xAtRelease = p.x;
    // Now release the steer input and coast.
    for (let i = 0; i < 30; i++) {
      p.update(dt, {}, w.road, 0, w.weather);
    }
    return { drift: p.x - xAtRelease };
  }

  const dry = driveAndCoast(false);
  const icy = driveAndCoast(true);
  assert.ok(
    Math.abs(dry.drift) < 1e-6,
    "dry car stops sliding instantly when steer is released",
  );
  assert.ok(icy.drift > 1e-3, "icy car keeps drifting after releasing the steer");
});

test("world: fog does NOT change the car's handling (visual only)", () => {
  function run(useFog) {
    const w = new World({ seed: 3 });
    if (useFog) {
      w.weather.trigger(WEATHER_FOG);
      const warm = Math.ceil(config.weather.fog.fadeIn / dt) + 2;
      for (let i = 0; i < warm; i++) w.weather.update(dt);
    }
    const p = w.player;
    p.x = config.VIRTUAL_WIDTH / 2;
    for (let i = 0; i < 20; i++) p.update(dt, { right: true }, w.road, 0, w.weather);
    return p.x;
  }
  assert.ok(Math.abs(run(true) - run(false)) < 1e-9, "fog leaves steering identical");
});

test("world: reset clears any active weather", () => {
  const w = new World({ seed: 7 });
  w._realizeSpawn({ kind: "setpiece", name: "weather" });
  assert.ok(w.weather.active);
  w.reset();
  assert.equal(w.weather.active, null, "reset clears weather");
  assert.equal(w.weather.intensity, 0);
  assert.equal(w.player.iceVx, 0, "reset zeroes the player's ice momentum");
});

test("world: identical seeds + inputs reproduce the weather timeline", () => {
  function run(seed) {
    const w = new World({ seed });
    const out = [];
    for (let i = 0; i < 1500; i++) {
      if (i === 100) w._realizeSpawn({ kind: "setpiece", name: "weather" });
      w.setInput({ accel: true, right: i % 3 === 0 });
      w.update(dt);
      out.push([w.weather.active, Number(w.weather.intensity.toFixed(6)), Number(w.player.x.toFixed(4))]);
    }
    return out;
  }
  assert.deepEqual(run(2026), run(2026));
});

export default null;
