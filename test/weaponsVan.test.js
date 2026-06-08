// test/weaponsVan.test.js
//
// Pure-logic coverage for the weapons van set-piece (Phase 6). The van drives
// ahead; tucking into its rear ramp for enough continuous steps loads a random
// special. Load logic is RNG-injected so it is deterministic in tests.
import test from "node:test";
import assert from "node:assert/strict";
import {
  WeaponsVan,
  createWeaponsVan,
  rampZone,
  inRamp,
  updateVanLoad,
} from "../src/entities/weaponsVan.js";
import { createRng } from "../src/engine/rng.js";
import { SPECIAL_KINDS } from "../src/systems/weapons.js";

// A player-like body: center-based x/y with width/height (matches Player).
function fakePlayer(x, y) {
  return { x, y, width: 36, height: 64 };
}

test("createWeaponsVan has size and an empty load state", () => {
  const v = createWeaponsVan(100, 50);
  assert.ok(v instanceof WeaponsVan);
  assert.ok(v.width > 0 && v.height > 0);
  assert.equal(v.loadProgress, 0);
  assert.equal(v.delivered, false);
  assert.equal(v.active, true);
});

test("van exposes a top-left AABB via bounds (center-based position)", () => {
  const v = createWeaponsVan(100, 50);
  assert.equal(v.bounds.x, 100 - v.width / 2);
  assert.equal(v.bounds.y, 50 - v.height / 2);
});

test("rampZone is a band at the rear (bottom) of the van", () => {
  const v = createWeaponsVan(100, 50);
  const z = rampZone(v);
  const b = v.bounds;
  assert.ok(z.y > b.y, "ramp is toward the back, not the front");
  assert.ok(z.y + z.h <= b.y + b.h + 1e-9);
  assert.ok(z.w < v.width, "ramp is inset from the van sides");
});

test("inRamp detects a player tucked into the rear ramp", () => {
  const v = createWeaponsVan(100, 50);
  const z = rampZone(v);
  const player = fakePlayer(z.x + z.w / 2, z.y + z.h / 2);
  assert.equal(inRamp(v, player), true);
});

test("inRamp is false for a player far away", () => {
  const v = createWeaponsVan(100, 50);
  assert.equal(inRamp(v, fakePlayer(1000, 1000)), false);
});

test("updateVanLoad accumulates progress while tucked in", () => {
  const v = createWeaponsVan(100, 50);
  const z = rampZone(v);
  const player = fakePlayer(z.x + z.w / 2, z.y + z.h / 2);
  const rng = createRng(1);
  const result = updateVanLoad(v, player, rng);
  assert.equal(result, null, "no special until enough steps");
  assert.ok(v.loadProgress > 0);
});

test("updateVanLoad resets progress when the player leaves the ramp", () => {
  const v = createWeaponsVan(100, 50);
  const z = rampZone(v);
  const tucked = fakePlayer(z.x + z.w / 2, z.y + z.h / 2);
  const rng = createRng(1);
  updateVanLoad(v, tucked, rng);
  updateVanLoad(v, tucked, rng);
  assert.ok(v.loadProgress >= 2);
  updateVanLoad(v, fakePlayer(1000, 1000), rng);
  assert.equal(v.loadProgress, 0);
});

test("updateVanLoad delivers a random special after enough steps", () => {
  const v = createWeaponsVan(100, 50, { loadFrames: 3 });
  const z = rampZone(v);
  const player = fakePlayer(z.x + z.w / 2, z.y + z.h / 2);
  const rng = createRng(99);
  assert.equal(updateVanLoad(v, player, rng), null);
  assert.equal(updateVanLoad(v, player, rng), null);
  const special = updateVanLoad(v, player, rng);
  assert.ok(special, "a special is delivered");
  assert.ok(SPECIAL_KINDS.includes(special.kind));
  assert.equal(v.delivered, true);
});

test("updateVanLoad with a forced kind delivers that kind and draws NO rng", () => {
  const v = createWeaponsVan(100, 50, { loadFrames: 1 });
  const z = rampZone(v);
  const player = fakePlayer(z.x + z.w / 2, z.y + z.h / 2);
  const rng = createRng(99);
  const before = rng.seed();
  const special = updateVanLoad(v, player, rng, "missiles");
  assert.equal(special.kind, "missiles", "forced kind delivered");
  assert.equal(rng.seed(), before, "forced delivery must not advance the RNG");
});

test("updateVanLoad delivers at most once per van", () => {
  const v = createWeaponsVan(100, 50, { loadFrames: 1 });
  const z = rampZone(v);
  const player = fakePlayer(z.x + z.w / 2, z.y + z.h / 2);
  const rng = createRng(3);
  assert.ok(updateVanLoad(v, player, rng));
  assert.equal(updateVanLoad(v, player, rng), null, "van already delivered");
});

test("van delivery is deterministic for a fixed seed", () => {
  const make = () => {
    const v = createWeaponsVan(100, 50, { loadFrames: 1 });
    const z = rampZone(v);
    return updateVanLoad(v, fakePlayer(z.x + z.w / 2, z.y + z.h / 2), createRng(5));
  };
  assert.equal(make().kind, make().kind);
});
