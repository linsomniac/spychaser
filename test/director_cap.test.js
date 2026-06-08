// test/director_cap.test.js
//
// Difficulty pacing (spec §4.2): a concurrent-enemy cap is the primary density
// lever. When the cap is reached the director SKIPS the whole spawn decision and
// draws NO RNG (so the seeded stream stays stable going forward). The cap lerps
// from start->end with difficulty.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Director } from "../src/systems/director.js";
import { createRng } from "../src/engine/rng.js";
import { config } from "../src/data/config.js";

function roadStub() {
  const W = config.VIRTUAL_WIDTH;
  const width = 320;
  return {
    sampleAt() {
      return { centerX: W / 2, width, leftEdge: W / 2 - width / 2, rightEdge: W / 2 + width / 2 };
    },
  };
}

test("spawnCap lerps from start at distance 0 to end at rampDistance", () => {
  const d = new Director({ config });
  const { start, end } = config.director.maxConcurrentEnemies;
  assert.equal(d.spawnCap(0), start);
  assert.equal(d.spawnCap(config.director.rampDistance), end);
  // Monotonic non-decreasing.
  let prev = 0;
  for (let x = 0; x <= config.director.rampDistance; x += 1000) {
    const c = d.spawnCap(x);
    assert.ok(c >= prev, `cap decreased at ${x}`);
    prev = c;
  }
});

test("a capped spawn tick draws NO RNG (stream stays put)", () => {
  const d = new Director({ config });
  const rng = createRng(123);
  const road = roadStub();
  // distance in (warmup, firstAt of every set-piece) so no set-piece fires here.
  const distance = 2000;
  // First tick: lazily seeds set-pieces (draws RNG — not what we measure).
  d.update(1 / 60, { distance, speed: 300, road, rng, liveEnemyCount: 99 });
  const before = rng.seed();
  // A big dt trips the cadence this tick; liveEnemyCount >> cap => capped.
  const evs = d.update(3.0, { distance, speed: 300, road, rng, liveEnemyCount: 99 });
  const after = rng.seed();
  assert.equal(after, before, "capped spawn tick must not advance the RNG");
  assert.equal(evs.filter((e) => e.kind === "enemy" || e.kind === "civilian").length, 0);
});

test("below the cap, the cadence still produces a spawn", () => {
  const d = new Director({ config });
  const rng = createRng(123);
  const road = roadStub();
  const distance = 2000;
  d.update(1 / 60, { distance, speed: 300, road, rng, liveEnemyCount: 0 });
  const evs = d.update(3.0, { distance, speed: 300, road, rng, liveEnemyCount: 0 });
  assert.ok(
    evs.some((e) => e.kind === "enemy" || e.kind === "civilian"),
    "uncapped cadence should spawn",
  );
});
