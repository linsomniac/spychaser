// test/specials.test.js
//
// Test-first coverage for the special-weapon economy (Phase 6):
// random load (deterministic via seeded RNG), ammo decrement/consume, slot
// gating, and per-special effect descriptors (front missiles vs rear hazards).
import test from "node:test";
import assert from "node:assert/strict";
import { createRng } from "../src/engine/rng.js";
import {
  loadRandomSpecial,
  createSpecial,
  canUseSpecial,
  consumeSpecial,
  specialEffect,
  SPECIAL_KINDS,
} from "../src/systems/weapons.js";

test("SPECIAL_KINDS exposes the loadable pool", () => {
  assert.deepEqual([...SPECIAL_KINDS].sort(), ["missiles", "oil", "smoke"]);
});

test("loadRandomSpecial returns a special drawn from the pool", () => {
  const rng = createRng(42);
  const s = loadRandomSpecial(rng);
  assert.ok(SPECIAL_KINDS.includes(s.kind));
  assert.ok(s.charge > 0);
  assert.equal(typeof s.name, "string");
});

test("loadRandomSpecial is deterministic for a fixed seed", () => {
  const a = loadRandomSpecial(createRng(7));
  const b = loadRandomSpecial(createRng(7));
  assert.equal(a.kind, b.kind);
  assert.equal(a.charge, b.charge);
});

test("loadRandomSpecial eventually yields each kind across seeds", () => {
  const seen = new Set();
  for (let seed = 0; seed < 300; seed++) {
    seen.add(loadRandomSpecial(createRng(seed)).kind);
  }
  assert.deepEqual([...seen].sort(), ["missiles", "oil", "smoke"]);
});

test("createSpecial builds a descriptor with config charge + slot", () => {
  const s = createSpecial("missiles");
  assert.equal(s.kind, "missiles");
  assert.equal(s.slot, "front");
  assert.equal(s.charge, 3);
  assert.equal(s.name, "MISSILES");
});

test("createSpecial throws on unknown kind", () => {
  assert.throws(() => createSpecial("laser"));
});

test("canUseSpecial respects slot and charge", () => {
  const s = createSpecial("oil"); // rear slot, charge 2
  assert.equal(canUseSpecial(s, "rear"), true);
  assert.equal(canUseSpecial(s, "front"), false);
  assert.equal(canUseSpecial(null, "rear"), false);
});

test("consumeSpecial decrements charge and returns the descriptor", () => {
  const s = createSpecial("smoke"); // charge 2
  const r1 = consumeSpecial(s);
  assert.equal(r1, s);
  assert.equal(s.charge, 1);
  consumeSpecial(s);
  assert.equal(s.charge, 0);
});

test("consumeSpecial refuses to go negative when empty", () => {
  const s = createSpecial("smoke");
  s.charge = 0;
  assert.equal(consumeSpecial(s), null);
  assert.equal(s.charge, 0);
});

test("consumeSpecial on null is a no-op returning null", () => {
  assert.equal(consumeSpecial(null), null);
});

test("a special is depleted (unusable) once charge hits zero", () => {
  const s = createSpecial("oil"); // charge 2
  consumeSpecial(s);
  assert.equal(canUseSpecial(s, "rear"), true);
  consumeSpecial(s);
  assert.equal(s.charge, 0);
  assert.equal(canUseSpecial(s, "rear"), false);
});

test("specialEffect(missiles) describes twin front projectiles", () => {
  const s = createSpecial("missiles");
  const fx = specialEffect(s, { x: 100, y: 200, width: 36, height: 64 });
  assert.equal(fx.type, "projectiles");
  assert.equal(fx.slot, "front");
  assert.ok(Array.isArray(fx.projectiles) && fx.projectiles.length === 2);
  for (const m of fx.projectiles) {
    assert.ok(m.vy < 0, "missiles travel up the screen");
    assert.equal(m.damage, 5);
    assert.equal(m.kind, "missile");
  }
  // The two missiles flank the car center symmetrically.
  const [a, b] = fx.projectiles;
  assert.ok(a.x < 100 && b.x > 100);
});

test("specialEffect(oil) deploys a rear hazard behind (below) the player", () => {
  const s = createSpecial("oil");
  const fx = specialEffect(s, { x: 100, y: 200, width: 36, height: 64 });
  assert.equal(fx.type, "hazard");
  assert.equal(fx.slot, "rear");
  assert.equal(fx.hazard, "oil");
  assert.ok(fx.y > 200, "deployed behind the player (larger y)");
});

test("specialEffect(smoke) deploys a rear smoke hazard", () => {
  const s = createSpecial("smoke");
  const fx = specialEffect(s, { x: 100, y: 200, width: 36, height: 64 });
  assert.equal(fx.type, "hazard");
  assert.equal(fx.hazard, "smoke");
  assert.ok(fx.y > 200);
});
