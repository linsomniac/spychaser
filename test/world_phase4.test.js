// test/world_phase4.test.js
// Integration coverage for Phase-4 wiring in core/world.js: spawning, enemy
// behavior realization, collisions, scoring, and culling — all headless.
import { test } from "node:test";
import assert from "node:assert/strict";
import { World } from "../src/core/world.js";
import { createEnemy } from "../src/entities/enemies.js";
import { Civilian } from "../src/entities/civilian.js";
import { config } from "../src/data/config.js";

function freshWorld() {
  const w = new World({ seed: 1 });
  // AIDEV-NOTE: silence the spawn director so these collision/scoring tests stay
  // isolated (no stray director-spawned traffic). The Phase-5 director replaced
  // the old debug spawner; stubbing its update() is the modern equivalent of the
  // former `w._debugSpawn = () => {}`.
  w.director.update = () => [];
  return w;
}

test("a player bullet kills a killable enemy and scores it", () => {
  const w = freshWorld();
  const enemy = createEnemy("switchblade", w.player.x, { config });
  enemy.y = w.player.y - 100;
  enemy.hp = 1; // one shot
  w.enemies.push(enemy);
  // Place a player bullet on top of the enemy.
  w.projectiles.spawn({ x: enemy.x, y: enemy.y, vx: 0, vy: 0, ttl: 5 });
  const score0 = w.score;
  w.update(1 / 60);
  assert.equal(enemy.dead, true);
  assert.equal(w.score, score0 + config.enemies.switchblade.scoreValue);
  // Bullet consumed; enemy culled from the live list.
  assert.equal(w.projectiles.activeCount, 0);
  assert.ok(!w.enemies.includes(enemy));
});

test("an Enforcer absorbs bullets without dying or scoring", () => {
  const w = freshWorld();
  const enf = createEnemy("enforcer", w.player.x, { config });
  enf.y = w.player.y - 100;
  w.enemies.push(enf);
  w.projectiles.spawn({ x: enf.x, y: enf.y, vx: 0, vy: 0, ttl: 5 });
  const score0 = w.score;
  w.update(1 / 60);
  assert.equal(enf.dead, false);
  assert.equal(w.score, score0); // no points
  assert.equal(w.projectiles.activeCount, 0); // bullet absorbed
});

test("shooting a civilian applies the penalty and removes it", () => {
  const w = freshWorld();
  w.score = 1000;
  const civ = new Civilian(w.player.x, w.player.x, { config });
  civ.y = w.player.y - 80;
  w.civilians.push(civ);
  w.projectiles.spawn({ x: civ.x, y: civ.y, vx: 0, vy: 0, ttl: 5 });
  w.update(1 / 60);
  assert.equal(w.civilianHits, 1);
  assert.equal(w.score, 1000 - config.civilians.scorePenalty);
  assert.ok(!w.civilians.includes(civ));
});

test("score never goes negative on a civilian penalty", () => {
  const w = freshWorld();
  w.score = 50;
  const civ = new Civilian(w.player.x, w.player.x, { config });
  civ.y = w.player.y - 80;
  w.civilians.push(civ);
  w.projectiles.spawn({ x: civ.x, y: civ.y, vx: 0, vy: 0, ttl: 5 });
  w.update(1 / 60);
  assert.equal(w.score, 0);
});

test("an enemy bullet hitting the player chips its damage and is consumed", () => {
  const w = freshWorld();
  w.hostiles.spawnEnemyBullet(w.player.x, w.player.y, 0, 0);
  w.update(1 / 60);
  // Hybrid model: a bullet is a chip hit (not an instant wreck).
  assert.equal(w.player.damage, config.combat.bulletDamage);
  assert.equal(w.player.crashed, false);
  assert.equal(w.hostiles.activeCount, 0);
});

test("a barrel hitting the player wrecks it and is consumed", () => {
  const w = freshWorld();
  w.hostiles.spawnBarrel(w.player.x, w.player.y);
  const cars0 = w.scoring.cars;
  w.update(1 / 60); // collision wrecks the car + consumes the barrel
  assert.equal(w.player.crashed, true, "barrel wrecked the car");
  assert.equal(w.hostiles.activeCount, 0);
  // Hybrid model: the lives machine registers the wreck on the next tick.
  w.update(1 / 60);
  assert.ok(
    w.player.invulnerable || w.scoring.cars < cars0,
    "the wreck was registered (respawn / car spent)",
  );
});

test("ramming an Enforcer damages both (mutual ram, player not removed)", () => {
  const w = freshWorld();
  const enf = createEnemy("enforcer", w.player.x, { config });
  enf.y = w.player.y; // overlapping
  w.enemies.push(enf);
  const ramHp0 = enf.ramHp;
  w.update(1 / 60);
  assert.ok(w.player.damage > 0, "the player took ram damage");
  assert.ok(enf.ramHp < ramHp0, "the Enforcer lost ram tolerance");
  assert.ok(w.enemies.includes(w.player) === false); // player isn't an enemy
});

test("player vs civilian is pass-through (reported, no damage/removal)", () => {
  const w = freshWorld();
  const civ = new Civilian(w.player.x, w.player.x, { config });
  civ.y = w.player.y; // overlapping
  w.civilians.push(civ);
  w.update(1 / 60);
  assert.equal(w.player.touchingCivilian, true);
  assert.ok(w.civilians.includes(civ)); // not destroyed by contact
});

test("the enemyWave set-piece spawns a burst of chasers (spec §6, #13)", () => {
  const w = freshWorld();
  const before = w.enemies.length;
  w._realizeSpawn({ kind: "setpiece", name: "enemyWave" });
  assert.equal(
    w.enemies.length - before,
    config.enemies.wavePack,
    "the milestone spawns an actual wave, not just a marker",
  );
  // The trigger is still recorded for the HUD/observability.
  assert.ok(w.setpieces.some((s) => s.name === "enemyWave"));
});

test("a Road Lord spawns a hostile bullet into the hostiles pool", () => {
  const w = freshWorld();
  const rl = createEnemy("roadLord", w.player.x, { config });
  rl.y = 50;
  w.enemies.push(rl);
  w.update(1 / 60); // first tick fires (cooldown starts ready)
  let found = false;
  w.hostiles.forEach((p) => {
    if (p.category === "enemyBullet") found = true;
  });
  assert.ok(found);
});

test("a Barrel Dumper drops a barrel into the hostiles pool", () => {
  const w = freshWorld();
  const bd = createEnemy("barrelDumper", w.player.x, { config });
  bd.y = 50;
  w.enemies.push(bd);
  w.update(1 / 60);
  let found = false;
  w.hostiles.forEach((p) => {
    if (p.category === "barrel") found = true;
  });
  assert.ok(found);
});

test("off-screen enemies and civilians are culled", () => {
  const w = freshWorld();
  const e = createEnemy("roadLord", w.player.x, { config });
  e.y = config.VIRTUAL_HEIGHT + 500;
  w.enemies.push(e);
  const c = new Civilian(w.player.x, w.player.x, { config });
  c.y = config.VIRTUAL_HEIGHT + 500;
  w.civilians.push(c);
  w.update(1 / 60);
  assert.equal(w.enemies.length, 0);
  assert.equal(w.civilians.length, 0);
});

test("the spawn director eventually produces traffic", () => {
  const w = new World({ seed: 5 }); // real seeded director (Phase 5)
  // AIDEV-NOTE: assert that spawns HAPPEN over the run, not that any survive to
  // the final instant — fast cars can all scroll off the bottom. Run long enough
  // to clear the director warmup distance.
  let ever = false;
  for (let i = 0; i < 900; i++) {
    w.update(1 / 60); // ~15s
    if (w.enemies.length + w.civilians.length > 0) ever = true;
  }
  assert.ok(ever, "the director should produce traffic over a run");
});

test("reset clears Phase-4 state", () => {
  const w = new World({ seed: 2 });
  for (let i = 0; i < 300; i++) w.update(1 / 60);
  w.score = 500;
  w.reset();
  assert.equal(w.enemies.length, 0);
  assert.equal(w.civilians.length, 0);
  assert.equal(w.score, 0);
  assert.equal(w.civilianHits, 0);
  assert.equal(w.hostiles.activeCount, 0);
});
