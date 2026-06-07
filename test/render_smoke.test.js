// test/render_smoke.test.js
//
// CANVAS DRAW-PATH SMOKE TEST (plan Phase 13 polish; closes a real coverage
// hole). The rest of the suite tests only pure, canvas-free logic, so every
// draw()/render() path shipped completely unexercised: a draw() calling a ctx
// method that no longer exists, reading an entity field the sim stopped
// maintaining (undefined.foo), or referencing a renamed/undefined symbol would
// all ship green and only blow up in a real browser. This test runs the real
// Renderer / Screens / entity draw() code against a FAKE 2D context that records
// nothing and never paints — we only assert that nothing throws. (It does NOT
// catch wrong colors: setting ctx.fillStyle to an undefined palette key is a
// no-op in a real canvas too, so that class needs a visual check, not this.)
//
// AIDEV-NOTE: the fake ctx implements EXACTLY the CanvasRenderingContext2D
// surface the codebase uses (grep `ctx\.` over render/ + entities/). If a draw
// path starts using a new ctx method, this test throws "ctx.foo is not a
// function" — that is intentional: extend makeFakeCtx() when you add one. Keep
// it a real method set (not a catch-all Proxy) so genuine typos still surface.

import { test } from "node:test";
import assert from "node:assert/strict";

import { World } from "../src/core/world.js";
import { config } from "../src/data/config.js";
import { GameCanvas } from "../src/engine/canvas.js";
import { Renderer } from "../src/render/renderer.js";
import { Screens } from "../src/render/screens.js";
import { GameState } from "../src/core/states.js";
import { createEnemy } from "../src/entities/enemies.js";
import { Civilian } from "../src/entities/civilian.js";
import { createWeaponsVan } from "../src/entities/weaponsVan.js";
import { createHazard } from "../src/entities/hazards.js";

const DT = config.FIXED_STEP;

/** A no-op 2D context covering the full surface the renderer/entities use. */
function makeFakeCtx() {
  const noop = () => {};
  const gradient = { addColorStop: noop };
  return {
    // --- mutable draw state (plain assignable props) ---
    fillStyle: "#000",
    strokeStyle: "#000",
    lineWidth: 1,
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    font: "10px sans-serif",
    textAlign: "start",
    textBaseline: "alphabetic",
    // --- path / shape methods ---
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    arcTo: noop,
    ellipse: noop,
    fill: noop,
    stroke: noop,
    fillRect: noop,
    fillText: noop,
    // --- transform / state stack ---
    save: noop,
    restore: noop,
    translate: noop,
    scale: noop,
    setTransform: noop,
    // --- gradients ---
    createLinearGradient: () => gradient,
  };
}

/** A GameCanvas backed by a fake <canvas> element + fake ctx (no DOM needed). */
function makeGameCanvas() {
  const ctx = makeFakeCtx();
  const el = {
    width: config.VIRTUAL_WIDTH,
    height: config.VIRTUAL_HEIGHT,
    clientWidth: config.VIRTUAL_WIDTH,
    clientHeight: config.VIRTUAL_HEIGHT,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  };
  return new GameCanvas(el);
}

test("render: a rich headless run (traffic + heli + ice + boat) paints every frame without throwing", () => {
  // Seed 1 + straight throttle traverses ice, the helicopter, water/boat mode,
  // and fog (see test/replay_modes.test.js), so painting across the whole run
  // exercises the road/water/boathouse rows, both weather overlays, the boat and
  // helicopter draws, particles, the HUD, and ground traffic.
  const renderer = new Renderer(makeGameCanvas());
  const w = new World({ seed: 1 });
  assert.doesNotThrow(() => {
    for (let t = 0; t < 2700; t++) {
      w.setInput({ accel: true, fire: true });
      w.update(DT);
      if (t % 15 === 0) renderer.render(w);
    }
    renderer.render(w); // final boat-mode frame
  });
});

test("render: fog and ice weather overlays draw at full intensity without throwing", () => {
  // Force each episode and ramp it to peak so the gradient / tint code actually
  // runs (drawFog/drawIce early-return at zero intensity).
  for (const kind of ["fog", "ice"]) {
    const renderer = new Renderer(makeGameCanvas());
    const w = new World({ seed: 7 });
    for (let t = 0; t < 60; t++) {
      w.setInput({ accel: true });
      w.update(DT);
    }
    w.weather.trigger(kind);
    for (let i = 0; i < 200; i++) w.weather.update(DT); // ramp past fadeIn to peak
    assert.equal(kind === "fog" ? w.weather.isFog : w.weather.isIce, true);
    assert.ok(w.weather.intensity > 0, "weather should be at non-zero intensity");
    assert.doesNotThrow(() => renderer.render(w));
  }
});

test("render: every entity type's draw() executes", () => {
  // Force one of each drawable into a live world so no entity draw path depends
  // on a particular seed happening to spawn it within a bounded run.
  const renderer = new Renderer(makeGameCanvas());
  const w = new World({ seed: 3 });
  for (let t = 0; t < 120; t++) {
    w.setInput({ accel: true, fire: true });
    w.update(DT);
  }
  const opts = { config: w.config };
  const cx = w.width / 2;
  for (const type of ["switchblade", "enforcer", "roadLord", "barrelDumper"]) {
    w.enemies.push(createEnemy(type, cx, opts));
  }
  w.civilians.push(new Civilian(cx, cx, opts));
  w.vans.push(createWeaponsVan(cx, -10, opts));
  w.hazards.push(createHazard("oil", cx, 200, opts));
  w.hazards.push(createHazard("smoke", cx, 320, opts));
  w.helicopter = createEnemy("helicopter", cx, opts);
  w.hostiles.spawnBarrel(cx, 120);
  w.hostiles.spawnEnemyBullet(cx, 140, 0, 200);
  w.particles.explosion(cx, 260, w.rng);

  assert.doesNotThrow(() => renderer.render(w));
});

test("render: title / pause / game-over overlays draw without throwing", () => {
  const gc = makeGameCanvas();
  const screens = new Screens(gc);
  gc.applyTransform();
  const w = new World({ seed: 5 });
  for (let t = 0; t < 60; t++) {
    w.setInput({ accel: true, fire: true });
    w.update(DT);
  }
  assert.doesNotThrow(() => {
    screens.draw(GameState.ATTRACT, w);
    screens.draw(GameState.PAUSED, w);
    screens.draw(GameState.GAME_OVER, w);
    screens.draw(GameState.PLAYING, w); // overlayForState -> null (no-op path)
  });
});
