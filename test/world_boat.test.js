// test/world_boat.test.js
//
// Phase 8 — water-section integration at the World level: the world drives the
// player through the boathouse into boat mode and back, emits a deterministic
// boat-wake splash while afloat, and keeps the whole run reproducible from a
// seed. The transition LOGIC itself is unit-tested in boat.test.js / player.test.js;
// these assert the wiring (world.update -> player mode + particles).

import { test } from "node:test";
import assert from "node:assert/strict";

import { World } from "../src/core/world.js";
import { MODE_CAR, MODE_BOAT } from "../src/entities/boat.js";
import { config } from "../src/data/config.js";

/** Locate the first water section the road for a world seed will encounter. */
function firstWaterSection(world) {
  for (let d = 0; d <= 400000; d += 13) {
    const sect = world.road.waterSectionAt(d);
    if (sect) return sect;
  }
  throw new Error("no water section found");
}

test("world: driving over a water section switches the player car -> boat -> car", () => {
  const w = new World({ seed: 2026 });
  const dt = config.FIXED_STEP;
  const sect = firstWaterSection(w);

  // Place the world just shy of the water so a few ticks carry us in. The
  // player's row distance is world.distance + (height - player.y); align to it.
  const rowAhead = w.height - w.player.y;

  // 1) Before the water: car.
  w.distance = sect.start - rowAhead - 30;
  w.update(dt);
  assert.equal(w.player.mode, MODE_CAR, "car before the water");

  // 2) Inside the entry boathouse: boat.
  w.distance = sect.start - rowAhead + 5;
  w.update(dt);
  assert.equal(w.player.mode, MODE_BOAT, "entry boathouse -> boat");

  // 3) Open water: still a boat.
  w.distance = (sect.start + sect.end) / 2 - rowAhead;
  w.update(dt);
  assert.equal(w.player.mode, MODE_BOAT, "open water keeps the boat");

  // 4) Exit boathouse: back to a car.
  w.distance = sect.end - rowAhead - 5;
  w.update(dt);
  assert.equal(w.player.mode, MODE_CAR, "exit boathouse -> car");
});

test("world: a moving boat kicks up a wake splash (particles emitted)", () => {
  const w = new World({ seed: 2026 });
  const dt = config.FIXED_STEP;
  const sect = firstWaterSection(w);
  const rowAhead = w.height - w.player.y;

  // Enter via the boathouse so the player commits to boat mode, then settle
  // over open water (open water only PRESERVES the current mode by design).
  w.distance = sect.start - rowAhead + 5;
  w.update(dt);
  assert.equal(w.player.mode, MODE_BOAT, "entered boat mode via the boathouse");
  w.player.x = w.road.sampleAt((sect.start + sect.end) / 2).centerX;

  // Give the boat some forward speed, then run enough ticks to cross the wake
  // cadence at least once.
  w.player.speed = config.boat.maxSpeed * 0.8;
  const before = w.particles.activeCount;
  for (let i = 0; i < 12; i++) {
    // Keep the world parked over open water for the duration.
    w.distance = (sect.start + sect.end) / 2 - rowAhead;
    w.player.speed = config.boat.maxSpeed * 0.8;
    w.update(dt);
  }
  assert.ok(w.particles.activeCount > before, "boat wake should spawn splash particles");
});

test("world: a car on dry road never emits a boat wake", () => {
  const w = new World({ seed: 1 });
  const dt = config.FIXED_STEP;
  // 1 second of normal road driving.
  for (let i = 0; i < 60; i++) {
    w.setInput({ accel: true });
    w.update(dt);
  }
  assert.equal(w.player.mode, MODE_CAR);
  // The only particles a forward-driving car can make here are muzzle (not
  // firing) — none should be splash. We assert the wake timer never armed.
  assert.equal(w._wakeTimer, 0, "wake timer stays disarmed on dry land");
});

test("world: the boat-mode run is deterministic for a seed", () => {
  function run(seed) {
    const w = new World({ seed });
    const dt = config.FIXED_STEP;
    const sect = firstWaterSection(w);
    const rowAhead = w.height - w.player.y;
    // Enter through the entry boathouse to commit to boat mode.
    w.distance = sect.start - rowAhead + 5;
    w.update(dt);
    const out = [];
    for (let i = 0; i < 30; i++) {
      w.distance = (sect.start + sect.end) / 2 - rowAhead;
      w.player.speed = config.boat.maxSpeed * 0.7;
      w.setInput({ right: i % 2 === 0 });
      w.update(dt);
      out.push([w.player.x, w.player.mode, w.particles.activeCount]);
    }
    return out;
  }
  assert.deepEqual(run(2026), run(2026));
});

test("world: reset returns the player to car mode and disarms the wake", () => {
  const w = new World({ seed: 2026 });
  const dt = config.FIXED_STEP;
  const sect = firstWaterSection(w);
  const rowAhead = w.height - w.player.y;
  // Enter through the boathouse to commit to boat mode.
  w.distance = sect.start - rowAhead + 5;
  w.update(dt);
  assert.equal(w.player.mode, MODE_BOAT);

  w.reset();
  assert.equal(w.player.mode, MODE_CAR, "reset returns to car mode");
  assert.equal(w._wakeTimer, 0, "reset disarms the wake timer");
});

export default null;
