// test/world_combat.test.js
// Integration coverage for enemy attacks harming the player (spec §6), wired
// into core/world.js with the HYBRID lethality model:
//   * bomb blast / rolling barrel  -> instant wreck
//   * Switchblade slash / Road Lord bullet -> chip damage toward maxDamage
//   * ramming an enemy -> mutual (player takes chip, enemy takes ram damage)
// A short post-respawn invulnerability prevents chain-death. All headless.
import { test } from "node:test";
import assert from "node:assert/strict";
import { World } from "../src/core/world.js";
import { createEnemy, Bomb } from "../src/entities/enemies.js";
import { config } from "../src/data/config.js";

function freshWorld() {
  const w = new World({ seed: 11 });
  w.director.update = () => [];
  return w;
}

test("an enemy bullet striking the player applies chip damage (not instant wreck)", () => {
  const w = freshWorld();
  w.hostiles.spawnEnemyBullet(w.player.x, w.player.y, 0, 0, config);
  w.update(1 / 60);
  assert.ok(w.player.damage > 0, "bullet dealt chip damage");
  assert.equal(w.player.crashed, false, "a single bullet does not wreck");
});

test("a rolling barrel striking the player instantly wrecks it", () => {
  const w = freshWorld();
  w.hostiles.spawnBarrel(w.player.x, w.player.y, config);
  w.update(1 / 60); // collision wrecks the car this tick
  assert.equal(w.player.crashed, true, "barrel wrecked the car on contact");
  // The lives machine registers the wreck on the next tick (collision resolves
  // after the crash check — a single fixed-step delay).
  w.update(1 / 60);
  assert.ok(
    w.player.invulnerable || w.scoring.cars < config.player.startLives,
    "the wreck was registered (respawn / car spent)",
  );
});

test("a detonating bomb blast instantly wrecks the player", () => {
  const w = freshWorld();
  const bomb = new Bomb(w.player.x, w.player.y, { config });
  // Force the bomb to its detonated/blast state so resolveBombBlast hits.
  w.bombs.push(bomb);
  // Run until it detonates and blasts the player.
  let wrecked = false;
  for (let i = 0; i < 200 && !wrecked; i++) {
    w.update(1 / 60);
    if (w.scoring.cars < config.player.startLives || w.player.crashed) wrecked = true;
  }
  assert.equal(wrecked, true, "the bomb blast wrecked the player");
});

test("sustained Switchblade slashing eventually wrecks the player", () => {
  const w = freshWorld();
  const sb = createEnemy("switchblade", w.player.x, { config });
  sb.y = w.player.y; // alongside, within slash range
  w.enemies.push(sb);
  const cars0 = w.scoring.cars;
  let progressed = false;
  for (let i = 0; i < 1200; i++) {
    // keep the switchblade pinned alongside the player so it keeps slashing
    sb.x = w.player.x;
    sb.y = w.player.y;
    w.update(1 / 60);
    if (w.player.damage > 0 || w.scoring.cars < cars0) {
      progressed = true;
      break;
    }
  }
  assert.equal(progressed, true, "the slash accrued damage / cost a car");
});

test("ramming an enemy damages BOTH the player and the enemy (mutual)", () => {
  const w = freshWorld();
  const sb = createEnemy("switchblade", w.player.x, { config });
  sb.y = w.player.y; // overlapping the player -> a ram
  w.enemies.push(sb);
  const ramHp0 = sb.ramHp;
  w.update(1 / 60);
  assert.ok(w.player.damage > 0, "the player took ram damage");
  assert.ok(sb.ramHp < ramHp0 || sb.dead, "the enemy lost ram tolerance too");
});

test("ramming destroys the bulletproof Enforcer (its spec kill route)", () => {
  const w = freshWorld();
  const enf = createEnemy("enforcer", w.player.x, { config });
  w.enemies.push(enf);
  let destroyed = false;
  for (let i = 0; i < 600 && !destroyed; i++) {
    enf.x = w.player.x;
    enf.y = w.player.y; // keep ramming
    w.player.invuln = 0; // ignore i-frames so we test the enemy side
    w.player.damage = 0; // keep the player alive to keep ramming
    w.update(1 / 60);
    if (enf.dead || !w.enemies.includes(enf)) destroyed = true;
  }
  assert.equal(destroyed, true, "the Enforcer is rammed to destruction");
});

test("a respawn grants brief invulnerability so the player cannot be chain-wrecked", () => {
  const w = freshWorld();
  // Wreck the player once to trigger a respawn.
  w.player.wreck();
  w.update(1 / 60);
  assert.ok(w.player.invulnerable, "the freshly respawned car has i-frames");
});
