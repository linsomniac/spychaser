// test/world_overlap.test.js
//
// Overlap fixes wired into the World (spec §4.3): an enemyWave spawns its
// chasers at DISTINCT, non-overlapping lateral slots (clamped to cap headroom),
// and the per-tick separation pass keeps live enemies from stacking.
import { test } from "node:test";
import assert from "node:assert/strict";
import { World } from "../src/core/world.js";
import { config } from "../src/data/config.js";
import { createEnemy } from "../src/entities/enemies.js";
import { createWeaponsVan } from "../src/entities/weaponsVan.js";
import { Civilian } from "../src/entities/civilian.js";

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

test("a headless run never leaves vehicles hard-overlapping (enemies/civilians/vans)", () => {
  const w = new World({ seed: 42 });
  let hardStacks = 0;
  for (let t = 0; t < 1500; t++) {
    w.setInput({ accel: true, fire: true });
    w.update(DT);
    // All movable + van bodies (exclude the player: its van-ramp overlap is intended).
    const all = [...w.enemies, ...w.civilians, ...w.vans];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j];
        const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
        // "Hard" overlap = deep penetration (well inside both bodies).
        if (dx < (a.width + b.width) / 4 && dy < (a.height + b.height) / 4) hardStacks++;
      }
    }
  }
  // NOTE: 0 is exact (deterministic run, no RNG). If this ever trips, suspect the
  // cap (maxConcurrentEnemies.end) vs. road width — single-pass de-penetration
  // can't fully re-resolve a body clamped against a narrow road edge.
  assert.equal(hardStacks, 0, `vehicles hard-overlapped ${hardStacks} times across the run`);
});

test("the player shoves an overlapping enemy aside AND the ram still fires", () => {
  const w = new World({ seed: 1 });
  const e = createEnemy("enforcer", w.player.x, { config: w.config });
  e.y = w.player.y; // overlap the player
  w.enemies.push(e);
  const ramHpBefore = e.ramHp;
  const playerXBefore = w.player.x;
  w.setInput({}); // no steering
  w.update(DT);
  // Ram fired this tick (resolution runs AFTER the damage pass).
  assert.equal(e.ramHp, ramHpBefore - 1, "ram hit landed before the shove");
  // Enemy was shoved clear; the player (immovable) did not move.
  assert.ok(
    Math.abs(e.x - w.player.x) >= (w.player.width + e.width) / 2,
    "enemy shoved out of the player's body",
  );
  assert.equal(w.player.x, playerXBefore, "heavy player is never pushed");
});

test("the heavy player shoves a civilian aside without penalty (not destroyed)", () => {
  const w = new World({ seed: 1 });
  const civ = new Civilian(w.player.x, w.player.x, { config: w.config });
  civ.y = w.player.y; // overlap the player
  w.civilians.push(civ);
  const scoreBefore = w.score;
  const hitsBefore = w.civilianHits;
  w.update(DT);
  assert.ok(
    Math.abs(civ.x - w.player.x) >= (w.player.width + civ.width) / 2,
    "civilian shoved aside",
  );
  assert.equal(civ.active, true, "civilian not destroyed by a bump");
  assert.equal(w.civilianHits, hitsBefore, "no civilian-hit counted for a bump");
  assert.ok(w.score >= scoreBefore, "no penalty deducted for a bump");
});

test("an enemy bounces off the immovable weapons van", () => {
  const w = new World({ seed: 1 });
  const van = createWeaponsVan(w.player.x, 0, { config: w.config });
  van.y = w.player.y - (van.height / 2 - van.def.rampHeight / 2); // ramp over the player
  w.vans.push(van);
  const e = createEnemy("switchblade", van.x, { config: w.config });
  e.y = van.y;
  w.enemies.push(e);
  const vanXBefore = van.x;
  w.update(DT);
  assert.equal(van.x, vanXBefore, "van is immovable");
  assert.ok(
    Math.abs(e.x - van.x) >= (e.width + van.width) / 2,
    "enemy pushed off the van",
  );
});

test("the player can still sit in the van ramp (overlap preserved for loading)", () => {
  const w = new World({ seed: 1 });
  const van = createWeaponsVan(w.player.x, 0, { config: w.config });
  van.y = w.player.y - (van.height / 2 - van.def.rampHeight / 2);
  w.vans.push(van);
  w.update(DT);
  const overlap =
    Math.abs(w.player.x - van.x) < (w.player.width + van.width) / 2 &&
    Math.abs(w.player.y - van.y) < (w.player.height + van.height) / 2;
  assert.ok(overlap, "player still overlaps the van after resolution (ramp loadable)");
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
