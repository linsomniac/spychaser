// test/weapons.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { MachineGun } from "../src/systems/weapons.js";
import { config } from "../src/data/config.js";

const COOLDOWN = config.player.fireCooldown;

// A minimal firing context the gun reads from / writes to.
function makeGun() {
  return new MachineGun();
}

test("first trigger pull fires immediately", () => {
  const gun = makeGun();
  // dt small; firing input held; cold gun should fire on the first tick.
  const shots = gun.update(1 / 60, true);
  assert.equal(shots, 1);
});

test("holding fire does NOT fire every tick (respects cadence)", () => {
  const gun = makeGun();
  gun.update(1 / 60, true); // first shot
  // Next immediate tick is well within the cooldown window -> no shot.
  const shots = gun.update(1 / 60, true);
  assert.equal(shots, 0);
});

test("holding fire fires again after the cooldown elapses", () => {
  const gun = makeGun();
  gun.update(1 / 60, true); // first shot at t=0
  let total = 0;
  // Advance just past one cooldown in small steps.
  let elapsed = 0;
  while (elapsed < COOLDOWN + 1e-6) {
    total += gun.update(1 / 60, true);
    elapsed += 1 / 60;
  }
  // Exactly one additional shot should have been emitted in that window.
  assert.equal(total, 1);
});

test("cadence over a long hold approximates shots = time / cooldown", () => {
  const gun = makeGun();
  let total = 0;
  const seconds = 3;
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) total += gun.update(1 / 60, true);
  const expected = Math.floor(seconds / COOLDOWN) + 1; // +1 for the immediate first shot
  // Allow off-by-one from discretization.
  assert.ok(
    Math.abs(total - expected) <= 1,
    `fired ${total}, expected ~${expected}`,
  );
});

test("releasing fire stops shots", () => {
  const gun = makeGun();
  gun.update(1 / 60, true);
  let total = 0;
  for (let i = 0; i < 120; i++) total += gun.update(1 / 60, false);
  assert.equal(total, 0);
});

test("a single large dt does not emit more than one shot (no burst)", () => {
  const gun = makeGun();
  // Even if dt is huge, a held trigger should not dump a whole magazine.
  const shots = gun.update(10, true);
  assert.equal(shots, 1);
});

test("releasing and re-pressing fires immediately again", () => {
  const gun = makeGun();
  gun.update(1 / 60, true); // shot 1
  // Hold for a couple ticks (within cooldown) then release.
  gun.update(1 / 60, true);
  gun.update(1 / 60, false); // release
  // Re-press while still inside the original cooldown window: the gun is "cold"
  // again after release, so the next press fires immediately.
  const shots = gun.update(1 / 60, true);
  assert.equal(shots, 1);
});

test("MachineGun.fire returns a spawn descriptor for the bullet", () => {
  const gun = makeGun();
  // The gun, given the player's muzzle position, produces a bullet spawn spec.
  const spec = gun.makeBulletSpec(100, 200);
  assert.equal(spec.x, 100);
  assert.equal(spec.y, 200);
  // Bullets travel upward (toward the top of the screen): negative vy.
  assert.ok(spec.vy < 0);
  assert.equal(Math.abs(spec.vy), config.weapons.bullet.speed);
  assert.equal(spec.category, "playerBullet");
});
