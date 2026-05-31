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
import { config } from "./data/config.js";
import { palette } from "./data/palette.js";

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

  const loop = new Loop({
    step: config.FIXED_STEP,
    maxFrameTime: config.MAX_FRAME_TIME,
    update: (dt) => {
      // Phase 0: advance the stub world. Input snapshot is read here so wiring
      // is exercised even though the world doesn't consume it yet.
      input.snapshot();
      input.consumePressed();
      world.update(dt);
    },
    render: (_alpha) => {
      // Clear the whole backing store (letterbox bars included) to background.
      gameCanvas.clear(palette.background);
      // Establish the virtual coordinate system for any world drawing.
      gameCanvas.applyTransform();
      // Phase 0 renderer: just paint the play field so the letterbox is visible.
      const { ctx } = gameCanvas;
      ctx.fillStyle = palette.road;
      ctx.fillRect(0, 0, world.width, world.height);
    },
  });

  loop.start();

  // Expose for debugging in the console; harmless in production.
  // @ts-ignore
  window.__spychaser = { world, loop, input, gameCanvas };
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
}

export { boot };
