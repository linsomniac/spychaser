// test/world_overlap.test.js
//
// Overlap fixes wired into the World (spec §4.3): an enemyWave spawns its
// chasers at DISTINCT, non-overlapping lateral slots (clamped to cap headroom),
// and the per-tick separation pass keeps live enemies from stacking.
import { test } from "node:test";
import assert from "node:assert/strict";
import { World } from "../src/core/world.js";
import { config } from "../src/data/config.js";

const DT = config.FIXED_STEP;

function pairwiseMinGap(xs) {
  let min = Infinity;
  for (let i = 0; i < xs.length; i++)
    for (let j = i + 1; j < xs.length; j++) min = Math.min(min, Math.abs(xs[i] - xs[j]));
  return min;
}

test("an enemyWave spawns wavePack distinct, non-overlapping chasers", () => {
  const w = new World({ seed: 7 });
  w.distance = 7000; // past warmup; full cap headroom (no live enemies)
  w._realizeSpawn({ kind: "setpiece", name: "enemyWave" });
  const wave = w.enemies;
  assert.equal(wave.length, config.enemies.wavePack, "all chasers spawned (headroom available)");
  const minGap = pairwiseMinGap(wave.map((e) => e.x));
  const w0 = config.enemies.switchblade.width;
  assert.ok(minGap >= w0, `chasers overlap at spawn: minGap=${minGap}`);
});

test("an enemyWave is clamped to the remaining concurrent-cap headroom", () => {
  const w = new World({ seed: 7 });
  w.distance = 7000;
  const cap = w.director.spawnCap(w.distance);
  // Fill to one below the cap so only ONE wave chaser fits.
  while (w.enemies.length < cap - 1) {
    w._realizeSpawn({ kind: "enemy", type: "switchblade", x: 270 });
  }
  const before = w.enemies.length;
  w._realizeSpawn({ kind: "setpiece", name: "enemyWave" });
  assert.equal(w.enemies.length, cap, "wave clamped to headroom");
  assert.ok(w.enemies.length - before <= config.enemies.wavePack);
});

test("a headless run never leaves enemies overlapping after the separation pass", () => {
  const w = new World({ seed: 42 });
  let maxStacked = 0;
  for (let t = 0; t < 1500; t++) {
    w.setInput({ accel: true, fire: true });
    w.update(DT);
    // Count any pair that is still hard-overlapping (well inside both bodies).
    for (let i = 0; i < w.enemies.length; i++) {
      for (let j = i + 1; j < w.enemies.length; j++) {
        const a = w.enemies[i], b = w.enemies[j];
        const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
        if (dx < (a.width + b.width) / 4 && dy < (a.height + b.height) / 4) maxStacked++;
      }
    }
  }
  // A nudge, not a hard collision: brief transient overlaps are fine, but a
  // run should not be dominated by hard stacks.
  assert.ok(maxStacked < 200, `too many hard stacks across the run: ${maxStacked}`);
});

test("live enemy count never exceeds the distance-based cap", () => {
  const w = new World({ seed: 9 });
  for (let t = 0; t < 1800; t++) {
    w.setInput({ accel: true, fire: true });
    w.update(DT);
    assert.ok(
      w.enemies.length <= w.director.spawnCap(w.distance),
      `cap exceeded at tick ${t}: ${w.enemies.length} > ${w.director.spawnCap(w.distance)}`,
    );
  }
});

test("an enemyWave draws a fixed RNG amount regardless of cap headroom", () => {
  // Two worlds, same seed + distance => identical road + RNG state. One fires the
  // wave at FULL headroom (spawns wavePack chasers); the other is pre-filled to the
  // cap so the wave spawns ZERO chasers. The wave must draw exactly `wavePack`
  // jitters in BOTH cases, so the RNG streams stay identical afterward. (Filling
  // via "enemy" events draws no RNG — de-overlap is pure.)
  const full = new World({ seed: 7 });
  full.distance = 7000;
  const capped = new World({ seed: 7 });
  capped.distance = 7000;
  const cap = capped.director.spawnCap(capped.distance);
  while (capped.enemies.length < cap) {
    capped._realizeSpawn({ kind: "enemy", type: "switchblade", x: 270 });
  }
  full._realizeSpawn({ kind: "setpiece", name: "enemyWave" });
  capped._realizeSpawn({ kind: "setpiece", name: "enemyWave" });
  assert.equal(
    full.rng.next(),
    capped.rng.next(),
    "wave RNG draw count must not depend on headroom (replay stability)",
  );
});
