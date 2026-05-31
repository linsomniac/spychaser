import { test } from "node:test";
import assert from "node:assert/strict";

import { World } from "../src/core/world.js";
import { config } from "../src/data/config.js";

test("world: initializes to virtual dimensions and clean state", () => {
  const w = new World({ seed: 1 });
  assert.equal(w.width, config.VIRTUAL_WIDTH);
  assert.equal(w.height, config.VIRTUAL_HEIGHT);
  assert.equal(w.time, 0);
  assert.equal(w.ticks, 0);
  assert.equal(w.distance, 0);
  assert.equal(w.state, "playing");
});

test("world: update advances time, ticks, and distance", () => {
  const w = new World({ seed: 1 });
  const dt = config.FIXED_STEP;
  w.update(dt);
  assert.equal(w.ticks, 1);
  assert.ok(Math.abs(w.time - dt) < 1e-12);
  assert.ok(Math.abs(w.distance - config.road.baseScrollSpeed * dt) < 1e-9);
});

test("world: update is a no-op when not playing", () => {
  const w = new World({ seed: 1 });
  w.state = "paused";
  w.update(config.FIXED_STEP);
  assert.equal(w.ticks, 0);
  assert.equal(w.time, 0);
});

test("world: same seed yields identical RNG stream (deterministic sim)", () => {
  const a = new World({ seed: 2026 });
  const b = new World({ seed: 2026 });
  const sa = [a.rng.next(), a.rng.next(), a.rng.next()];
  const sb = [b.rng.next(), b.rng.next(), b.rng.next()];
  assert.deepEqual(sa, sb);
});

test("world: reset restores clean state and can reseed", () => {
  const w = new World({ seed: 1 });
  for (let i = 0; i < 10; i++) w.update(config.FIXED_STEP);
  w.reset(99);
  assert.equal(w.time, 0);
  assert.equal(w.ticks, 0);
  assert.equal(w.distance, 0);
  assert.equal(w.state, "playing");
  // Reseeded stream should match a fresh world with that seed.
  const fresh = new World({ seed: 99 });
  assert.equal(w.rng.next(), fresh.rng.next());
});

test("world: config tunables are present and sane", () => {
  assert.ok(config.FIXED_STEP > 0);
  assert.ok(config.VIRTUAL_WIDTH === 540 && config.VIRTUAL_HEIGHT === 720);
  assert.ok(config.player.startLives >= 1);
  assert.ok(config.weapons.bullet.speed > 0);
});
