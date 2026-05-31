// main.js
//
// Browser bootstrap. This is the only module that touches the DOM at startup.
// It wires together the engine harness:
//   GameCanvas (DPR + letterbox) + Input (keyboard) + World (sim) + Loop (timing)
// and runs a render that, for Phase 0, simply clears the canvas to the palette
// background. Later phases add a renderer that draws the world.
//
// AIDEV-NOTE: All gameplay math lives in core/* and engine/* (no DOM). main.js
// is the thin imperative shell; keep logic out of here so it stays testable.

import { GameCanvas } from "./engine/canvas.js";
import { Input } from "./engine/input.js";
import { Loop } from "./engine/loop.js";
import { World } from "./core/world.js";
import { Renderer } from "./render/renderer.js";
import { config } from "./data/config.js";

function boot() {
  const canvasEl = /** @type {HTMLCanvasElement|null} */ (
    document.getElementById("game")
  );
  if (!canvasEl) {
    throw new Error('Missing <canvas id="game"> element');
  }

  const gameCanvas = new GameCanvas(canvasEl);
  gameCanvas.listen();

  const input = new Input();
  input.attach(window);

  // Deterministic-but-varied seed: time-derived so each session differs, while
  // tests can still construct World with an explicit seed.
  const world = new World({ seed: (Date.now() & 0x7fffffff) || 1 });
  const renderer = new Renderer(gameCanvas);

  const loop = new Loop({
    step: config.FIXED_STEP,
    maxFrameTime: config.MAX_FRAME_TIME,
    update: (dt) => {
      // Input snapshot is read here so wiring is exercised even though the
      // world doesn't consume it yet (player driving arrives in Phase 2).
      input.snapshot();
      input.consumePressed();
      world.update(dt);
    },
    render: (_alpha) => {
      // Phase 1 renderer: draw the scrolling procedural road.
      renderer.render(world);
    },
  });

  loop.start();

  // Expose for debugging in the console; harmless in production.
  // @ts-ignore
  window.__spychaser = { world, loop, input, gameCanvas, renderer };
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
}

export { boot };
