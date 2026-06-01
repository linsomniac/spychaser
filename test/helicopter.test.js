// test/helicopter.test.js
//
// Phase 7 — Mad Bomber helicopter + dropped bombs. Pure-logic, canvas-free:
//   * Helicopter enters from the top, hovers, tracks the player's x, drops bombs
//     on a cadence, and is immune to bullets (missile-only — enforced in
//     collision.js / damage()).
//   * Bomb falls, detonates at road level, exposes a blast window, then dies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/data/config.js";
import {
  Helicopter,
  Bomb,
  HELI_PHASE,
  createEnemy,
} from "../src/entities/enemies.js";

const H = config.helicopter;
const BOMB = config.bomb;

// Minimal world stub: the heli reads world.player.{x,y}.
function worldWith(player) {
  return { player, config };
}

test("Helicopter constructs with full hp, ENTERING phase, bullet immunity", () => {
  const h = new Helicopter(270, -40);
  assert.equal(h.type, "helicopter");
  assert.equal(h.active, true);
  assert.equal(h.dead, false);
  assert.equal(h.bulletproof, true, "immune to bullets");
  assert.equal(h.hp, H.hp);
  assert.equal(h.phase, HELI_PHASE.ENTERING);
});

test("Helicopter bounds is a top-left AABB derived from its center", () => {
  const h = new Helicopter(200, 120);
  const b = h.bounds;
  assert.equal(b.x, 200 - H.width / 2);
  assert.equal(b.y, 120 - H.height / 2);
  assert.equal(b.w, H.width);
  assert.equal(b.h, H.height);
});

test("Helicopter descends during ENTERING and transitions to TRACKING at hoverY", () => {
  const h = new Helicopter(270, -H.height);
  const world = worldWith({ x: 270, y: 600 });
  let guard = 0;
  while (h.phase === HELI_PHASE.ENTERING && guard < 1000) {
    h.update(1 / 60, world);
    guard++;
  }
  assert.equal(h.phase, HELI_PHASE.TRACKING);
  // Clamped to the hover line on arrival (no overshoot past it).
  assert.equal(h.y, H.hoverY);
});

test("Helicopter tracks the player's x while TRACKING without overshoot", () => {
  const h = new Helicopter(100, H.hoverY);
  h.phase = HELI_PHASE.TRACKING;
  const world = worldWith({ x: 400, y: 600 });
  const before = h.x;
  h.update(0.1, world);
  assert.ok(h.x > before, "moved toward the player's x");
  assert.ok(h.x <= 400, "did not overshoot the player's x");
});

test("Helicopter does not jitter inside the track deadzone", () => {
  const h = new Helicopter(200, H.hoverY);
  h.phase = HELI_PHASE.TRACKING;
  const world = worldWith({ x: 200 + H.trackDeadzone - 1, y: 600 });
  const before = h.x;
  h.update(0.1, world);
  assert.equal(h.x, before, "stayed put inside the deadzone");
});

test("Helicopter drops a bomb event every bombInterval while TRACKING", () => {
  const h = new Helicopter(270, H.hoverY);
  h.phase = HELI_PHASE.TRACKING;
  const world = worldWith({ x: 270, y: 600 });
  const dt = 1 / 60;
  const steps = Math.round((H.bombInterval * 3) / dt);
  let drops = 0;
  for (let i = 0; i < steps; i++) {
    const events = h.update(dt, world);
    drops += events.filter((e) => e.type === "bomb").length;
  }
  assert.equal(drops, 3, "one bomb per interval over three intervals");
});

test("Helicopter bomb events carry the heli's current position", () => {
  const h = new Helicopter(270, H.hoverY);
  h.phase = HELI_PHASE.TRACKING;
  h.bombTimer = H.bombInterval; // force a drop this tick
  const ev = h.update(1 / 60, worldWith({ x: 270, y: 600 }));
  const bomb = ev.find((e) => e.type === "bomb");
  assert.ok(bomb, "a bomb was dropped");
  assert.equal(bomb.x, h.x);
  assert.equal(bomb.y, h.y);
});

test("Helicopter does NOT drop bombs while ENTERING", () => {
  const h = new Helicopter(270, -H.height);
  const world = worldWith({ x: 270, y: 600 });
  for (let i = 0; i < 300; i++) {
    if (h.phase !== HELI_PHASE.ENTERING) break;
    const ev = h.update(1 / 60, world);
    assert.equal(ev.filter((e) => e.type === "bomb").length, 0);
  }
});

test("Helicopter is immune to bullets: damage() never kills it", () => {
  const h = new Helicopter(270, H.hoverY);
  assert.equal(h.damage(1), false, "bullet damage ignored");
  assert.equal(h.hp, H.hp, "hp unchanged by bullets");
  assert.equal(h.dead, false);
  assert.equal(h.active, true);
});

test("Helicopter takes missile damage and dies after hp missile hits", () => {
  const h = new Helicopter(270, H.hoverY);
  h.phase = HELI_PHASE.TRACKING;
  let died = false;
  for (let i = 0; i < H.hp; i++) {
    died = h.missileHit(1);
  }
  assert.equal(died, true, "killed by the hp-th missile hit");
  assert.equal(h.dead, true);
  assert.equal(h.active, false);
  assert.equal(h.phase, HELI_PHASE.LEAVING, "flies off after defeat");
});

test("Helicopter survives a non-lethal missile hit and keeps tracking", () => {
  const h = new Helicopter(270, H.hoverY);
  h.phase = HELI_PHASE.TRACKING;
  const died = h.missileHit(1);
  assert.equal(died, false);
  assert.equal(h.hp, H.hp - 1);
  assert.equal(h.dead, false);
  assert.equal(h.phase, HELI_PHASE.TRACKING);
});

test("A defeated Helicopter flies up off the screen and drops no bombs", () => {
  const h = new Helicopter(270, H.hoverY);
  h.phase = HELI_PHASE.LEAVING;
  h.active = false; // dead-but-leaving still updates its position
  const world = worldWith({ x: 270, y: 600 });
  const before = h.y;
  const ev = h.update(0.2, world);
  assert.ok(h.y < before, "moving up off the screen");
  assert.equal(ev.filter((e) => e.type === "bomb").length, 0);
});

test("Helicopter isOffscreen only once it has flown above the top edge", () => {
  const h = new Helicopter(270, H.hoverY);
  assert.equal(h.isOffscreen(config.VIRTUAL_HEIGHT), false);
  h.y = -H.height - 100;
  assert.equal(h.isOffscreen(config.VIRTUAL_HEIGHT), true);
});

// --- Bombs -----------------------------------------------------------------

test("Bomb falls straight down and detonates at road level", () => {
  const b = new Bomb(270, 140);
  assert.equal(b.type, "bomb");
  assert.equal(b.detonated, false);
  assert.equal(b.active, true);
  const detonateY = BOMB.detonateY * config.VIRTUAL_HEIGHT;
  let guard = 0;
  while (!b.detonated && guard < 2000) {
    b.update(1 / 60);
    guard++;
  }
  assert.equal(b.detonated, true);
  assert.ok(b.y >= detonateY - BOMB.fallSpeed / 60 - 1);
});

test("Bomb bounds is a top-left AABB derived from its center", () => {
  const b = new Bomb(100, 50);
  const bb = b.bounds;
  assert.equal(bb.x, 100 - BOMB.width / 2);
  assert.equal(bb.y, 50 - BOMB.height / 2);
  assert.equal(bb.w, BOMB.width);
  assert.equal(bb.h, BOMB.height);
});

test("Bomb stays active through the blast window then deactivates", () => {
  const detonateY = BOMB.detonateY * config.VIRTUAL_HEIGHT;
  const b = new Bomb(270, detonateY);
  b.update(1 / 60); // crosses detonateY -> detonates
  assert.equal(b.detonated, true);
  assert.equal(b.active, true, "still active during the blast window");
  let guard = 0;
  while (b.active && guard < 2000) {
    b.update(1 / 60);
    guard++;
  }
  assert.equal(b.active, false, "blast window expired");
});

test("Bomb exposes its blast circle only while detonated", () => {
  const b = new Bomb(270, 200);
  assert.equal(b.blast(), null, "no blast before detonation");
  b.detonated = true;
  const blast = b.blast();
  assert.ok(blast);
  assert.equal(blast.x, b.x);
  assert.equal(blast.r, BOMB.blastRadius);
});

test("createEnemy can build a helicopter set-piece", () => {
  const h = createEnemy("helicopter", 270);
  assert.ok(h instanceof Helicopter);
  assert.equal(h.x, 270);
});
