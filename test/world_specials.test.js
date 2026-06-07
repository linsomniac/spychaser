// test/world_specials.test.js
// Integration coverage for the special-weapon path wired into core/world.js
// (spec §6 "Special-weapons arsenal" + "Weapons van"). The pure modules
// (weapons.js / weaponsVan.js / hazards.js) are unit-tested elsewhere; this
// exercises their LIVE wiring through World: van spawn -> load -> deploy ->
// missiles/hazards -> effects. All headless.
import { test } from "node:test";
import assert from "node:assert/strict";
import { World } from "../src/core/world.js";
import { createSpecial } from "../src/systems/weapons.js";
import { createEnemy, HELI_PHASE } from "../src/entities/enemies.js";
import { config } from "../src/data/config.js";

function freshWorld() {
  const w = new World({ seed: 7 });
  // Silence the director so only our scripted set-pieces/entities exist.
  w.director.update = () => [];
  return w;
}

test("firing a loaded MISSILES special spawns player missiles into the pool", () => {
  const w = freshWorld();
  w.player.special = createSpecial("missiles");
  const before = w.projectiles.activeCount;
  const fired = w.fireSpecial();
  assert.equal(fired, true, "fireSpecial reports a deployment");
  assert.ok(w.projectiles.activeCount > before, "missiles were spawned");
  assert.equal(
    w.player.special.charge,
    config.weapons.specials.missiles.charge - 1,
    "one charge consumed",
  );
});

test("firing a REAR special (oil) deploys a field hazard behind the player", () => {
  const w = freshWorld();
  w.player.special = createSpecial("oil");
  const fired = w.fireSpecial();
  assert.equal(fired, true);
  assert.equal(w.hazards.length, 1, "one hazard deployed");
  assert.equal(w.hazards[0].kind, "oil");
  // Deployed behind (below) the player.
  assert.ok(w.hazards[0].y > w.player.y, "hazard sits behind the car");
});

test("fireSpecial is a no-op with no loaded special", () => {
  const w = freshWorld();
  w.player.special = null;
  assert.equal(w.fireSpecial(), false);
  assert.equal(w.projectiles.activeCount, 0);
  assert.equal(w.hazards.length, 0);
});

test("a depleted special clears the loaded slot", () => {
  const w = freshWorld();
  w.player.special = createSpecial("oil"); // charge 2
  w.fireSpecial();
  // Advance past the special cooldown before the second deployment.
  const ticks = Math.ceil(config.weapons.special.cooldown * 60) + 1;
  for (let i = 0; i < ticks; i++) w.update(1 / 60);
  w.fireSpecial(); // second use empties it
  assert.equal(w.player.special, null, "empty special is unloaded");
});

test("deployed oil hazard spins out an overlapping enemy through the live sim", () => {
  const w = freshWorld();
  w.player.special = createSpecial("oil");
  w.fireSpecial();
  const hazard = w.hazards[0];
  // Put a switchblade right on top of the hazard.
  const e = createEnemy("switchblade", hazard.x, { config });
  e.y = hazard.y;
  w.enemies.push(e);
  w.update(1 / 60);
  assert.ok((e.spinTimer ?? 0) > 0, "enemy is spinning out from the oil");
});

test("a loaded MISSILES special, fired through the sim, destroys the helicopter", () => {
  const w = freshWorld();
  w._realizeSpawn({ kind: "setpiece", name: "helicopter" });
  const h = w.helicopter;
  h.y = config.helicopter.hoverY;
  h.phase = HELI_PHASE.TRACKING;
  w.player.x = h.x; // line the nose up under the heli
  // Fire missiles and let them travel up into the heli.
  let guard = 0;
  while (h && !h.dead && guard < 600) {
    if (w.player.special == null) w.player.special = createSpecial("missiles");
    w.fireSpecial();
    w.update(1 / 60);
    guard++;
  }
  assert.equal(h.dead, true, "the helicopter is destroyed by fired missiles");
});

test("missiles destroy the bulletproof Enforcer ('hit with a special', spec §6)", () => {
  const w = freshWorld();
  const enf = createEnemy("enforcer", w.player.x, { config });
  enf.y = w.player.y - 100; // ahead of the player
  w.enemies.push(enf);
  const score0 = w.score;
  // A regular bullet does nothing (bulletproof) — but missiles bypass armor.
  for (let i = 0; i < config.enemies.enforcer.ramHp; i++) {
    w.projectiles.spawn({
      x: enf.x, y: enf.y, vx: 0, vy: 0,
      category: "playerMissile", kind: "missile",
      damage: config.weapons.specials.missiles.damage,
      ttl: 5, w: 8, h: 20,
    });
  }
  w.update(1 / 60);
  assert.equal(enf.dead, true, "missiles bypass armor and destroy the Enforcer");
  assert.equal(
    w.score,
    score0 + config.enemies.enforcer.scoreValue,
    "the special kill scored",
  );
});

test("a single missile no longer one-shots the helicopter (hp = hit count)", () => {
  const w = freshWorld();
  w._realizeSpawn({ kind: "setpiece", name: "helicopter" });
  const h = w.helicopter;
  h.y = config.helicopter.hoverY;
  h.phase = HELI_PHASE.TRACKING;
  // Inject ONE real missile (damage 5) directly onto the heli.
  w.projectiles.spawn({
    x: h.x, y: h.y, vx: 0, vy: 0,
    category: "playerMissile", kind: "missile",
    damage: config.weapons.specials.missiles.damage, // 5 — for ground enemies
    ttl: 5, w: 8, h: 20,
  });
  w.update(1 / 60);
  assert.equal(h.dead, false, "one missile only chips the heli (hp 3 = 3 hits)");
  assert.equal(h.hp, config.helicopter.hp - 1, "took exactly one hit, not 5 damage");
});

test("the weaponsVan set-piece spawns a live van that can load a special", () => {
  const w = freshWorld();
  w._realizeSpawn({ kind: "setpiece", name: "weaponsVan" });
  assert.equal(w.vans.length, 1, "a van is instantiated, not just a jingle");
  const van = w.vans[0];
  // Drive the van down onto the player so the player sits in its rear ramp,
  // and prime it one step short of delivering.
  van.x = w.player.x;
  van.y = w.player.y - van.height / 2; // ramp band lands over the player
  van.loadProgress = van.loadFrames - 1;
  w.update(1 / 60);
  assert.ok(w.player.special, "a special was loaded from the van");
  assert.equal(van.delivered, true, "the van delivers exactly once");
});
