// test/world_audio.test.js
//
// The World's AUDIO-EVENT QUEUE (Phase 12 wiring). The sim is canvas/audio-free,
// so instead of calling SFX directly it appends plain event tags to
// world.audioEvents during update(); the browser audio bridge drains them each
// frame and triggers the matching procedural sound. These tests assert the
// right tags fire on the right sim events — fully headless, no Web Audio.

import { test } from "node:test";
import assert from "node:assert/strict";
import { World } from "../src/core/world.js";
import { createEnemy } from "../src/entities/enemies.js";
import { Civilian } from "../src/entities/civilian.js";

/** Step the world once with a given input snapshot. */
function step(world, input = {}, dt = 1 / 60) {
  world.setInput(input);
  world.update(dt);
}

test("World: starts with an empty audio-event queue", () => {
  const w = new World({ seed: 1, storage: null });
  assert.ok(Array.isArray(w.audioEvents));
  assert.equal(w.audioEvents.length, 0);
});

test("World: firing the machine gun queues a 'gun' audio event", () => {
  const w = new World({ seed: 1, storage: null });
  // A cold gun fires on the first held tick.
  step(w, { fire: true });
  assert.ok(w.audioEvents.some((e) => e.type === "gun"));
});

test("World: drainAudioEvents returns and clears the queue", () => {
  const w = new World({ seed: 1, storage: null });
  step(w, { fire: true });
  const drained = w.drainAudioEvents();
  assert.ok(drained.length > 0);
  assert.equal(w.audioEvents.length, 0);
  // Draining again yields nothing new.
  assert.equal(w.drainAudioEvents().length, 0);
});

test("World: destroying an enemy with a bullet queues an 'explosion'", () => {
  const w = new World({ seed: 1, storage: null });
  // Place a 1-HP standard enemy right on top of a player bullet.
  const enemy = createEnemy("switchblade", w.player.x, { config: w.config });
  enemy.y = w.player.y - 40;
  enemy.hp = 1; // ensure one shot kills
  w.enemies.push(enemy);
  // Spawn a bullet overlapping the enemy.
  w.projectiles.spawn({
    x: enemy.x,
    y: enemy.y,
    vx: 0,
    vy: -10,
    category: "playerBullet",
    damage: 5,
    ttl: 1,
  });
  step(w);
  assert.ok(w.audioEvents.some((e) => e.type === "explosion"));
});

test("World: shooting a civilian queues BOTH an explosion and a civilian warning", () => {
  const w = new World({ seed: 1, storage: null });
  const civ = new Civilian(w.player.x, w.player.x, { config: w.config });
  civ.y = w.player.y - 40;
  w.civilians.push(civ);
  w.projectiles.spawn({
    x: civ.x,
    y: civ.y,
    vx: 0,
    vy: -10,
    category: "playerBullet",
    damage: 1,
    ttl: 1,
  });
  step(w);
  assert.ok(w.audioEvents.some((e) => e.type === "explosion"));
  assert.ok(w.audioEvents.some((e) => e.type === "civilianWarning"));
});

test("World: a player wreck queues an 'explosion'", () => {
  const w = new World({ seed: 1, storage: null });
  // Force a crash directly, then step so _handleCrash sees the rising edge.
  w.player.crashed = true;
  step(w);
  assert.ok(w.audioEvents.some((e) => e.type === "explosion"));
});

test("World: a wreck that drops cars low queues a 'lowCars' alarm", () => {
  const w = new World({ seed: 1, storage: null });
  // Suspend the bonus so the wreck actually SPENDS a car (bonusActive is a
  // getter; suspending it revokes the free-replacement window).
  w.scoring.bonusSuspended = true;
  // Start with 2 spare cars so the wreck leaves 1 (low) and survives.
  w.scoring.cars = 2;
  w.player.crashed = true;
  step(w);
  assert.ok(w.audioEvents.some((e) => e.type === "lowCars"));
});

test("World: the weapons-van set-piece queues a 'weaponLoad' cue", () => {
  const w = new World({ seed: 1, storage: null });
  // Directly realize a weaponsVan set-piece (bypassing the director schedule).
  w._realizeSpawn({ kind: "setpiece", name: "weaponsVan" });
  assert.ok(w.audioEvents.some((e) => e.type === "weaponLoad"));
});

test("World: audio events are deterministic for a seed + input sequence", () => {
  const run = () => {
    const w = new World({ seed: 7, storage: null });
    const tags = [];
    for (let i = 0; i < 240; i++) {
      step(w, { fire: true, accel: true });
      for (const e of w.drainAudioEvents()) tags.push(e.type);
    }
    return tags;
  };
  assert.deepEqual(run(), run());
});

test("World: reset clears the audio-event queue", () => {
  const w = new World({ seed: 1, storage: null });
  step(w, { fire: true });
  assert.ok(w.audioEvents.length > 0);
  w.reset();
  assert.equal(w.audioEvents.length, 0);
});
