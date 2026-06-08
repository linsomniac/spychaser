// test/effects_ricochet.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { ParticleSystem } from "../src/render/effects.js";
import { createRng } from "../src/engine/rng.js";

test("ricochetSpark spawns a small deterministic burst", () => {
  const a = new ParticleSystem();
  const b = new ParticleSystem();
  a.ricochetSpark(100, 100, createRng(5));
  b.ricochetSpark(100, 100, createRng(5));
  assert.ok(a.activeCount > 0, "spawned at least one spark");
  assert.equal(a.activeCount, b.activeCount, "same seed => same spark count (deterministic)");
});
