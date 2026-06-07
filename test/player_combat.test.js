// test/player_combat.test.js
// The player's combat-damage API (Phase 10 completion, hybrid lethality model):
// applyDamage() accrues chip damage toward maxDamage and wrecks at the cap;
// wreck() is an instant kill; a post-respawn invulnerability window ignores both.
import test from "node:test";
import assert from "node:assert/strict";

import { Player } from "../src/entities/player.js";
import { Road } from "../src/systems/road.js";
import { config } from "../src/data/config.js";

const P = config.player;

test("applyDamage accrues chip damage toward maxDamage without wrecking", () => {
  const p = new Player({ config });
  p.applyDamage(30);
  assert.equal(p.damage, 30);
  assert.equal(p.crashed, false);
});

test("applyDamage that reaches maxDamage wrecks the car (and clamps)", () => {
  const p = new Player({ config });
  p.applyDamage(P.maxDamage + 999);
  assert.equal(p.damage, P.maxDamage, "clamped to maxDamage");
  assert.equal(p.crashed, true);
});

test("wreck() instantly crashes the player", () => {
  const p = new Player({ config });
  p.wreck();
  assert.equal(p.crashed, true);
  assert.equal(p.damage, P.maxDamage);
});

test("an invulnerable player ignores both chip damage and instant wreck", () => {
  const p = new Player({ config });
  p.invuln = 1.0;
  assert.equal(p.invulnerable, true);
  p.applyDamage(50);
  p.wreck();
  assert.equal(p.damage, 0, "no chip damage while invulnerable");
  assert.equal(p.crashed, false, "no wreck while invulnerable");
});

test("invulnerability counts down as the player updates", () => {
  const p = new Player({ config });
  const road = new Road({ seed: 1 });
  p.invuln = 0.05;
  p.update(1 / 60, {}, road, 100, null);
  assert.ok(p.invuln < 0.05, "i-frames decay over time");
});

test("reset() clears damage, crash and invulnerability", () => {
  const p = new Player({ config });
  p.applyDamage(40);
  p.invuln = 2;
  p.reset();
  assert.equal(p.damage, 0);
  assert.equal(p.crashed, false);
  assert.equal(p.invuln, 0);
});
