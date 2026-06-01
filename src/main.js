// main.js
//
// Browser bootstrap. This is the only module that touches the DOM at startup.
// It wires the engine harness to the top-level orchestrator:
//   GameCanvas (DPR + letterbox) + Input (keyboard) + Game (world + state
//   machine + render) + Loop (fixed-timestep timing).
//
// AIDEV-NOTE: All gameplay + flow logic lives in core/* and engine/* (no DOM).
// main.js is the thin imperative shell: it constructs the collaborators, hands
// them to core/game.js, and bridges the loop to requestAnimationFrame. Keep
// logic out of here so it stays unit-testable (the Game is driven headlessly in
// test/game.test.js).

import { GameCanvas } from "./engine/canvas.js";
import { Input } from "./engine/input.js";
import { Loop } from "./engine/loop.js";
import { Game } from "./core/game.js";
import { Renderer } from "./render/renderer.js";
import { Screens } from "./render/screens.js";
import { config } from "./data/config.js";
import { AudioEngine } from "./audio/audio.js";
import { Music } from "./audio/music.js";
import { Sfx } from "./audio/sfx.js";
import { AudioBridge } from "./audio/bridge.js";

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

  // The orchestrator owns the World + the game-flow StateMachine. A time-derived
  // seed makes each session differ while reset() reseeds reproducibly per run;
  // tests construct Game with an explicit seed + injected randomSeed instead.
  const game = new Game({ seed: (Date.now() & 0x7fffffff) || 1 });
  const renderer = new Renderer(gameCanvas);
  const screens = new Screens(gameCanvas);

  game.attachInput(input);
  game.attachRender(gameCanvas, renderer, screens);

  // --- Audio (Phase 12). The engine stays SILENT until the browser autoplay
  // policy is satisfied: installGestureUnlock() arms one-shot listeners that
  // create + resume the AudioContext on the first user gesture (key/click). The
  // bridge couples the world's audio events + engine/heli state to Music + Sfx;
  // it is headless-safe so it never throws before unlock. M toggles mute.
  const audioEngine = new AudioEngine();
  audioEngine.installGestureUnlock(window);
  const music = new Music(audioEngine);
  const sfx = new Sfx(audioEngine);
  const audioBridge = new AudioBridge({ audio: audioEngine, music, sfx });
  game.attachAudio(audioBridge);

  const loop = new Loop({
    step: config.FIXED_STEP,
    maxFrameTime: config.MAX_FRAME_TIME,
    // The orchestrator samples input, runs flow + sim for this fixed step, and
    // drains the input edge buffer so each press fires exactly once.
    update: (dt) => game.update(dt),
    // Draw the (possibly frozen) scene plus the active screen overlay.
    render: (alpha) => game.render(alpha),
  });
  game.loop = loop;

  loop.start();

  // Expose for debugging in the console; harmless in production.
  // @ts-ignore
  window.__spychaser = {
    game,
    loop,
    input,
    gameCanvas,
    renderer,
    screens,
    audioEngine,
    music,
    sfx,
    audioBridge,
  };
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
}

export { boot };
