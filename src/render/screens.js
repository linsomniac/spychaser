// render/screens.js
//
// Full-field overlay screens (spec §5 "draw active overlay (if any)"; plan
// Phase 11): the ATTRACT/title screen, the PAUSED overlay, and the GAME_OVER
// panel (score + hi-score, NEW RECORD banner). These draw OVER the scene in the
// same virtual coordinate space the rest of render/* uses (the DPR + letterbox
// transform is already applied by engine/canvas.js).
//
// AIDEV-NOTE: As with render/hud.js, the DRAWING here is Canvas-only, but the
// PURE decision/formatting logic is split into exported free functions
// (overlayForState, gameOverSummary) that are unit-tested headlessly in
// test/screens.test.js (spec §5: keep logic out of the canvas layer). The class
// reads the game-flow state + world but never mutates them.

import { palette } from "../data/palette.js";
import { GameState } from "../core/states.js";
import { formatScore } from "./hud.js";

/**
 * Decide which overlay to draw for a given game-flow state. Returns the overlay
 * id ("title" | "pause" | "gameover") or null for PLAYING / any unknown state
 * (fail-safe: an unrecognized state simply shows the clean play field, never
 * throws). Pure.
 * @param {string|undefined} state a GameState value
 * @returns {"title"|"pause"|"gameover"|null}
 */
export function overlayForState(state) {
  switch (state) {
    case GameState.ATTRACT:
      return "title";
    case GameState.PAUSED:
      return "pause";
    case GameState.GAME_OVER:
      return "gameover";
    default:
      return null;
  }
}

/**
 * Build the formatted game-over summary the panel renders: the run's score and
 * the (possibly just-beaten) high score, both arcade-formatted, plus a NEW
 * RECORD flag. A new record is a positive score that meets or beats the stored
 * high score (the cold-start 0/0 case is explicitly NOT a record). Pure: takes
 * plain numbers, returns plain display data.
 * @param {{score?:number, hiScore?:number}} scoring
 * @returns {{score:string, hiScore:string, newRecord:boolean}}
 */
export function gameOverSummary(scoring = {}) {
  const score = Math.max(0, Math.floor(scoring.score || 0));
  const hiScore = Math.max(0, Math.floor(scoring.hiScore || 0));
  return {
    score: formatScore(score),
    hiScore: formatScore(hiScore),
    newRecord: score > 0 && score >= hiScore,
  };
}

export class Screens {
  /**
   * @param {import("../engine/canvas.js").GameCanvas} gameCanvas
   */
  constructor(gameCanvas) {
    this.gameCanvas = gameCanvas;
    /** @type {CanvasRenderingContext2D} */
    this.ctx = gameCanvas.ctx;
  }

  /**
   * Draw whichever overlay the game-flow state calls for, OVER the already-drawn
   * scene. No-op while PLAYING. Caller passes the StateMachine's current state
   * and the world (for the live score/hi-score on the game-over panel).
   * @param {string} state a GameState value
   * @param {import("../core/world.js").World} [world]
   */
  draw(state, world) {
    const overlay = overlayForState(state);
    if (!overlay) return;
    if (overlay === "title") this.drawTitle();
    else if (overlay === "pause") this.drawPause();
    else if (overlay === "gameover") this.drawGameOver(world);
  }

  // --- Shared chrome ----------------------------------------------------------

  /**
   * Dim the whole play field behind an overlay so the foreground text reads.
   * @param {number} alpha 0..1 scrim opacity
   * @private
   */
  _scrim(alpha) {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = palette.background;
    ctx.fillRect(0, 0, this.gameCanvas.virtualWidth, this.gameCanvas.virtualHeight);
    ctx.restore();
  }

  /**
   * Centered text helper. Draws at the field's horizontal center.
   * @param {string} text
   * @param {number} y baseline-ish y (uses textBaseline middle)
   * @param {{font?:string, color?:string}} [opts]
   * @private
   */
  _centerText(text, y, opts = {}) {
    const { ctx } = this;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = opts.color ?? palette.hudText;
    ctx.font = opts.font ?? "800 28px system-ui, sans-serif";
    ctx.fillText(text, this.gameCanvas.virtualWidth / 2, y);
    ctx.restore();
  }

  /** Convenience: virtual field width. @private */
  get _W() {
    return this.gameCanvas.virtualWidth;
  }
  /** Convenience: virtual field height. @private */
  get _H() {
    return this.gameCanvas.virtualHeight;
  }

  // --- Title / attract --------------------------------------------------------

  /**
   * The ATTRACT/title screen: a heavy scrim, the game title, a tagline, and a
   * blinking "PRESS ENTER" prompt plus the control legend.
   */
  drawTitle() {
    const W = this._W;
    const H = this._H;
    this._scrim(0.82);

    // Accent rule above the title.
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = palette.player;
    ctx.fillRect(W / 2 - 90, H * 0.26, 180, 4);
    ctx.restore();

    this._centerText("SPY CHASER", H * 0.34, {
      font: "900 46px system-ui, sans-serif",
      color: palette.player,
    });
    this._centerText("TOP-DOWN VEHICULAR COMBAT", H * 0.41, {
      font: "700 13px system-ui, sans-serif",
      color: palette.hudDim,
    });

    // Blinking prompt (driven by wall time so it pulses on the attract screen
    // without needing the sim to tick).
    const blink = Math.floor(Date.now() / 500) % 2 === 0;
    if (blink) {
      this._centerText("PRESS ENTER TO START", H * 0.6, {
        font: "800 20px system-ui, sans-serif",
        color: palette.success,
      });
    }

    this._controlsLegend(H * 0.74);
  }

  /**
   * The control legend block, shared by the title screen. A few centered lines.
   * @param {number} top first line's y
   * @private
   */
  _controlsLegend(top) {
    const lines = [
      "ARROWS / WASD  —  DRIVE",
      "SPACE  —  MACHINE GUN",
      "F / SHIFT  —  SPECIAL WEAPON",
      "P / ESC  —  PAUSE      M  —  MUTE",
    ];
    let y = top;
    for (const line of lines) {
      this._centerText(line, y, {
        font: "600 12px system-ui, sans-serif",
        color: palette.hudDim,
      });
      y += 22;
    }
  }

  // --- Pause ------------------------------------------------------------------

  /** The PAUSED overlay: a light scrim with PAUSED + a resume hint. */
  drawPause() {
    const H = this._H;
    this._scrim(0.55);
    this._centerText("PAUSED", H * 0.44, {
      font: "900 40px system-ui, sans-serif",
      color: palette.hudText,
    });
    this._centerText("PRESS P OR ESC TO RESUME", H * 0.53, {
      font: "700 14px system-ui, sans-serif",
      color: palette.hudDim,
    });
  }

  // --- Game over --------------------------------------------------------------

  /**
   * The GAME_OVER panel: heavy scrim, GAME OVER headline, the final score and
   * high score, an optional NEW RECORD banner, and a restart prompt.
   * @param {import("../core/world.js").World} [world]
   */
  drawGameOver(world) {
    const H = this._H;
    this._scrim(0.84);

    const summary = gameOverSummary(world ? world.scoring : {});

    this._centerText("GAME OVER", H * 0.32, {
      font: "900 44px system-ui, sans-serif",
      color: palette.danger,
    });

    if (summary.newRecord) {
      this._centerText("NEW HIGH SCORE!", H * 0.4, {
        font: "800 18px system-ui, sans-serif",
        color: palette.success,
      });
    }

    // Score + hi-score, label over value.
    this._centerText("SCORE", H * 0.49, {
      font: "700 12px system-ui, sans-serif",
      color: palette.hudDim,
    });
    this._centerText(summary.score, H * 0.535, {
      font: "800 30px system-ui, sans-serif",
      color: palette.hudText,
    });
    this._centerText("HI-SCORE", H * 0.6, {
      font: "700 12px system-ui, sans-serif",
      color: palette.hudDim,
    });
    this._centerText(summary.hiScore, H * 0.64, {
      font: "800 22px system-ui, sans-serif",
      color: palette.hudDim,
    });

    const blink = Math.floor(Date.now() / 500) % 2 === 0;
    if (blink) {
      this._centerText("PRESS ENTER TO PLAY AGAIN", H * 0.78, {
        font: "800 18px system-ui, sans-serif",
        color: palette.success,
      });
    }
  }
}

export default Screens;
