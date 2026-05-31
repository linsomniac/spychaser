// test/enemies.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createEnemy,
  approach,
  Enemy,
  Switchblade,
  Enforcer,
  RoadLord,
  BarrelDumper,
  ENEMY_TYPES,
} from "../src/entities/enemies.js";
import { config } from "../src/data/config.js";

// Minimal world stub: enemies only read world.player.
function worldWith(player) {
  return { player };
}

test("approach moves toward target without overshoot", () => {
  assert.equal(approach(0, 10, 3), 3);
  assert.equal(approach(0, 10, 100), 10); // snaps, no overshoot
  assert.equal(approach(10, 0, 4), 6);
  assert.equal(approach(5, 5, 2), 5);
});

test("createEnemy builds the right subclass and spawn position", () => {
  assert.ok(createEnemy("switchblade", 100) instanceof Switchblade);
  assert.ok(createEnemy("enforcer", 100) instanceof Enforcer);
  assert.ok(createEnemy("roadLord", 100) instanceof RoadLord);
  assert.ok(createEnemy("barrelDumper", 100) instanceof BarrelDumper);
  const e = createEnemy("roadLord", 120);
  assert.equal(e.x, 120);
  assert.equal(e.y, config.enemies.spawnY);
  assert.equal(e.active, true);
  assert.equal(e.dead, false);
});

test("createEnemy throws on unknown type", () => {
  assert.throws(() => createEnemy("tank", 0));
});

test("all ENEMY_TYPES are constructible and carry their tunables", () => {
  for (const t of ENEMY_TYPES) {
    const e = createEnemy(t, 50);
    assert.equal(e.type, t);
    assert.equal(e.width, config.enemies[t].width);
  }
});

test("enemy bounds is a top-left AABB derived from its center", () => {
  const e = createEnemy("switchblade", 100);
  e.y = 200;
  const b = e.bounds;
  assert.equal(b.x, 100 - e.width / 2);
  assert.equal(b.y, 200 - e.height / 2);
  assert.equal(b.w, e.width);
  assert.equal(b.h, e.height);
});

test("enemies drift downward and steer toward the player each tick", () => {
  const e = createEnemy("roadLord", 0);
  const y0 = e.y;
  const world = worldWith({ x: 1000, y: 600 });
  e.update(0.5, world);
  assert.equal(e.y, y0 + config.enemies.roadLord.approachSpeed * 0.5);
  assert.equal(e.x, config.enemies.roadLord.steerSpeed * 0.5); // moved toward player
});

test("switchblade slashes when alongside and respects its cooldown", () => {
  const e = createEnemy("switchblade", 100);
  // Put the player right beside the enemy at spawn row (within slash ranges).
  const world = worldWith({ x: 100, y: config.enemies.spawnY });
  const ev1 = e.update(0.016, world);
  assert.equal(ev1.length, 1);
  assert.equal(ev1[0].type, "slash");
  assert.equal(ev1[0].enemy, e);
  // Immediately after, still cooling down -> no slash.
  const ev2 = e.update(0.016, world);
  assert.equal(ev2.length, 0);
});

test("switchblade does not slash when not alongside", () => {
  const e = createEnemy("switchblade", 100);
  const world = worldWith({ x: 400, y: 700 }); // far in x and y
  const ev = e.update(0.016, world);
  assert.equal(ev.length, 0);
});

test("enforcer is bulletproof and immune to damage", () => {
  const e = createEnemy("enforcer", 100);
  assert.equal(e.bulletproof, true);
  assert.equal(e.damage(100), false);
  assert.equal(e.dead, false);
  assert.equal(e.active, true);
});

test("enforcer steers to ram and emits no projectiles", () => {
  const e = createEnemy("enforcer", 0);
  const ev = e.update(0.1, worldWith({ x: 500, y: 600 }));
  assert.equal(ev.length, 0);
  assert.ok(e.x > 0);
});

test("road lord fires downward bullets on cadence", () => {
  const e = createEnemy("roadLord", 100);
  const world = worldWith({ x: 100, y: 600 });
  const ev1 = e.update(0.016, world); // cooldown starts ready -> fires
  assert.equal(ev1.length, 1);
  assert.equal(ev1[0].type, "enemyBullet");
  assert.ok(ev1[0].vy > 0); // travels down
  assert.equal(e.update(0.016, world).length, 0); // cooling
  const ev3 = e.update(config.enemies.roadLord.fireCooldown, world);
  assert.equal(ev3.length, 1);
});

test("barrel dumper drops barrels on cadence", () => {
  const e = createEnemy("barrelDumper", 100);
  const world = worldWith({ x: 100, y: 600 });
  const ev1 = e.update(0.016, world);
  assert.equal(ev1.length, 1);
  assert.equal(ev1[0].type, "barrel");
  assert.equal(e.update(0.016, world).length, 0);
});

test("damage kills a killable enemy when hp reaches zero", () => {
  const e = createEnemy("switchblade", 0); // hp 2
  assert.equal(e.damage(1), false);
  assert.equal(e.hp, 1);
  assert.equal(e.damage(1), true);
  assert.equal(e.dead, true);
  assert.equal(e.active, false);
});

test("update is a no-op for a dead enemy", () => {
  const e = createEnemy("roadLord", 100);
  e.dead = true;
  const y0 = e.y;
  assert.deepEqual(e.update(1, worldWith({ x: 100, y: 600 })), []);
  assert.equal(e.y, y0);
});

test("isOffscreen detects pass-by-bottom", () => {
  const e = createEnemy("roadLord", 100);
  e.y = config.VIRTUAL_HEIGHT + 200;
  assert.ok(e.isOffscreen(config.VIRTUAL_HEIGHT));
  e.y = 100;
  assert.ok(!e.isOffscreen(config.VIRTUAL_HEIGHT));
});

test("behavior is deterministic given identical state", () => {
  const a = createEnemy("roadLord", 50);
  const b = createEnemy("roadLord", 50);
  const wa = worldWith({ x: 200, y: 600 });
  const wb = worldWith({ x: 200, y: 600 });
  for (let i = 0; i < 30; i++) {
    const ea = a.update(0.05, wa);
    const eb = b.update(0.05, wb);
    assert.equal(ea.length, eb.length);
    assert.equal(a.x, b.x);
    assert.equal(a.y, b.y);
  }
});

// Sanity: base Enemy default behavior emits nothing.
test("base Enemy.behave returns no events", () => {
  const e = new Enemy("enforcer", 0);
  assert.deepEqual(e.behave(0.1, worldWith({ x: 0, y: 0 })), []);
});
