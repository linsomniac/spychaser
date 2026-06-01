// test/heli-collision.test.js
//
// Phase 7 collision rules:
//   * Machine-gun bullets pass THROUGH the helicopter (immune) — not consumed,
//     no damage. Missiles damage it and are consumed; the hp-th missile kills it.
//   * A detonated bomb's circular blast damages targets within its radius, once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/data/config.js";
import {
  circleOverlapsBounds,
  resolveMissilesVsHelicopter,
  resolveBombBlast,
} from "../src/systems/collision.js";
import { Helicopter, Bomb, HELI_PHASE } from "../src/entities/enemies.js";

const H = config.helicopter;

// Pooled-projectile-like records (matching entities/projectiles.js shape): a
// center-based (x,y) with a `bounds` top-left AABB and a `category`.
function projectile(x, y, w, h, category, extra = {}) {
  const p = { x, y, w, h, category, active: true, damage: 1, ...extra };
  Object.defineProperty(p, "bounds", {
    enumerable: false,
    get() {
      return { x: this.x - this.w / 2, y: this.y - this.h / 2, w: this.w, h: this.h };
    },
  });
  return p;
}
const bullet = (x, y) => projectile(x, y, 6, 16, "playerBullet");
const missile = (x, y) => projectile(x, y, 8, 20, "playerMissile", { kind: "missile", damage: 1 });

test("circleOverlapsBounds: detects a circle overlapping an AABB", () => {
  // Circle at (0,0) r=10 vs a box whose nearest corner is well inside.
  assert.equal(circleOverlapsBounds(0, 0, 10, { x: 5, y: 5, w: 4, h: 4 }), true);
});

test("circleOverlapsBounds: rejects a circle clear of the AABB", () => {
  assert.equal(circleOverlapsBounds(0, 0, 5, { x: 100, y: 100, w: 4, h: 4 }), false);
});

test("bullets pass through the helicopter: no damage, not consumed", () => {
  const h = new Helicopter(270, H.hoverY);
  h.phase = HELI_PHASE.TRACKING;
  const b = bullet(270, H.hoverY);
  const hits = resolveMissilesVsHelicopter([b], h);
  assert.equal(hits.length, 0, "no missile hit registered");
  assert.equal(b.active, true, "bullet survives (immune heli)");
  assert.equal(h.hp, H.hp, "hp unchanged");
  assert.equal(h.dead, false);
});

test("a missile damages the helicopter and is consumed", () => {
  const h = new Helicopter(270, H.hoverY);
  h.phase = HELI_PHASE.TRACKING;
  const m = missile(270, H.hoverY);
  const hits = resolveMissilesVsHelicopter([m], h);
  assert.equal(hits.length, 1);
  assert.equal(m.active, false, "missile consumed");
  assert.equal(h.hp, H.hp - 1);
  assert.equal(h.dead, false, "survives a single non-lethal hit");
});

test("hp missiles destroy the helicopter and send it LEAVING", () => {
  const h = new Helicopter(270, H.hoverY);
  h.phase = HELI_PHASE.TRACKING;
  let totalHits = 0;
  for (let i = 0; i < H.hp; i++) {
    totalHits += resolveMissilesVsHelicopter([missile(270, H.hoverY)], h).length;
  }
  assert.equal(totalHits, H.hp);
  assert.equal(h.dead, true);
  assert.equal(h.active, false);
  assert.equal(h.phase, HELI_PHASE.LEAVING);
});

test("a missile that misses does not damage the heli or get consumed", () => {
  const h = new Helicopter(270, H.hoverY);
  h.phase = HELI_PHASE.TRACKING;
  const m = missile(0, 700);
  const hits = resolveMissilesVsHelicopter([m], h);
  assert.equal(hits.length, 0);
  assert.equal(m.active, true);
  assert.equal(h.hp, H.hp);
});

test("no missile hits resolve against a dead/inactive helicopter", () => {
  const h = new Helicopter(270, H.hoverY);
  h.active = false;
  const hits = resolveMissilesVsHelicopter([missile(270, H.hoverY)], h);
  assert.equal(hits.length, 0);
});

test("a detonated bomb blasts a target inside its radius", () => {
  const detonateY = config.bomb.detonateY * config.VIRTUAL_HEIGHT;
  const b = new Bomb(270, detonateY);
  b.detonated = true;
  const player = {
    bounds: {
      x: 270 + config.bomb.blastRadius - 10 - 16,
      y: detonateY - 28,
      w: 32,
      h: 56,
    },
    active: true,
  };
  const hits = resolveBombBlast([b], [player]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].target, player);
});

test("a bomb does not blast a target outside its radius", () => {
  const detonateY = config.bomb.detonateY * config.VIRTUAL_HEIGHT;
  const b = new Bomb(270, detonateY);
  b.detonated = true;
  const far = {
    bounds: { x: 270 + config.bomb.blastRadius + 200, y: detonateY, w: 32, h: 56 },
    active: true,
  };
  const hits = resolveBombBlast([b], [far]);
  assert.equal(hits.length, 0);
});

test("an undetonated bomb does not blast", () => {
  const b = new Bomb(270, 200);
  const player = { bounds: { x: 270 - 16, y: 200 - 28, w: 32, h: 56 }, active: true };
  const hits = resolveBombBlast([b], [player]);
  assert.equal(hits.length, 0);
});

test("each bomb blast is applied at most once (blastApplied guard)", () => {
  const detonateY = config.bomb.detonateY * config.VIRTUAL_HEIGHT;
  const b = new Bomb(270, detonateY);
  b.detonated = true;
  const player = { bounds: { x: 270 - 16, y: detonateY - 28, w: 32, h: 56 }, active: true };
  const first = resolveBombBlast([b], [player]);
  const second = resolveBombBlast([b], [player]);
  assert.equal(first.length, 1);
  assert.equal(second.length, 0, "blast not re-applied for the same bomb");
});
