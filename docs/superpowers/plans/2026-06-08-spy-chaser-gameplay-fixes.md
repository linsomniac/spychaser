# Spy Chaser Gameplay Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the four playtest issues (lookalike enemies, stacking cars, too-fast difficulty, relentless helicopters) plus two fairness gaps, by tuning and correcting behavior that already exists — no new subsystems.

**Architecture:** Pure deterministic sim (seed + input → identical run). Director returns spawn *events*; the World realizes them. Enemies/heli return attack *events*. New logic keeps RNG draw counts a function of reproducible sim state only, and prefers pure-geometry (zero-RNG) passes, so future seeds stay stable. Source spec: `docs/superpowers/specs/2026-06-07-spy-chaser-gameplay-fixes-design.md`.

**Tech Stack:** Vanilla JS (ES modules), Canvas 2D, Web Audio, Node's built-in test runner (`node --test`). No build step, no deps.

---

## ⚠️ Golden-test sequencing (read before starting)

Two whole-system replay goldens pin the *entire* deterministic stream:
`test/replay.test.js` and `test/replay_modes.test.js`. Every balance/sim change in
Tasks **2–6** shifts that stream, so **both goldens are EXPECTED to be RED from the
moment Task 2 lands until they are re-recorded in Tasks 7–8.** This is the spec's
planned, mechanical churn (§5) — exactly what commit `06c1f7d` did for the last
retune. Rules while they are red:

- Do **NOT** re-record them piecemeal mid-task.
- At every commit in Tasks 2–6, confirm that **all OTHER tests are green** and that
  *only* those two goldens fail. A third failure means a real regression — fix it
  before committing.
- Task 1 is **pure-visual** and must leave the whole suite (including both goldens)
  **fully green** — it does not touch the sim.

Baseline before starting: `node --test` (currently 489 tests, all green).

---

## File Structure

| File | Responsibility | Tasks |
|------|----------------|-------|
| `src/data/palette.js` | + `enemyArmed`, `enemyTruck`, `heliBody` colors | 1 |
| `src/render/shapes.js` | `drawVehicle` gains an `outline` style option | 1 |
| `src/entities/enemies.js` | per-type colors + glyphs + heli recolor; `separateEnemies()`; heli `trackTimer`/wait-out | 1, 3, 4 |
| `src/data/config.js` | all retuned tunables + new config blocks | 2, 3, 4, 6 |
| `src/systems/director.js` | `spawnCap()`, concurrent-cap gate in `update()` | 2 |
| `src/core/world.js` | pass `liveEnemyCount`; separation call; spawn de-overlap; wave lane-spread; `_heliCooldown`; `_firstSpecialDelivered`; ricochet passes | 2, 3, 4, 5, 6 |
| `src/entities/weaponsVan.js` | `updateVanLoad` optional `forceKind` | 5 |
| `src/render/effects.js` | `ricochetSpark()` particle variant | 6 |
| `src/audio/sfx.js` | `ricochet()` one-shot | 6 |
| `src/audio/bridge.js` | map `"ricochet"` → `sfx.ricochet` | 6 |
| `test/*` | new unit tests + updated director/heli/van/sfx/bridge tests + re-recorded goldens | all |

---

## Task 1: Enemy visual identity (spec §4.1) — PURE VISUAL, stays fully green

**Files:**
- Modify: `src/data/palette.js` (Enemies block, ~line 30-34)
- Modify: `src/render/shapes.js` (`drawVehicle`, ~line 69-125)
- Modify: `src/entities/enemies.js` (`ENEMY_COLORS` ~line 34-39; `Enemy.draw` ~line 193-203; `Helicopter.draw` body fill ~line 433)
- Create: `test/enemy_identity.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/enemy_identity.test.js`:

```js
// test/enemy_identity.test.js
//
// Issue #1 guard: the four ground-enemy types must render as four DISTINCT
// colors (they previously shared two), and the gameplay-critical bulletproof
// Enforcer must carry a visible armor outline so it cannot be confused with the
// shootable Barrel Dumper. Pure draw-layer checks against a recording fake ctx.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ENEMY_COLORS, createEnemy, ENEMY_TYPES } from "../src/entities/enemies.js";
import { drawVehicle } from "../src/render/shapes.js";
import { palette } from "../src/data/palette.js";

// A fake 2D ctx that records the methods/styles the draw paths touch.
function recordingCtx() {
  const calls = [];
  const rec = (name) => (...args) => calls.push({ name, args });
  return {
    calls,
    _fill: null,
    _stroke: null,
    set fillStyle(v) { this._fill = v; calls.push({ name: "fillStyle", args: [v] }); },
    get fillStyle() { return this._fill; },
    set strokeStyle(v) { this._stroke = v; calls.push({ name: "strokeStyle", args: [v] }); },
    get strokeStyle() { return this._stroke; },
    lineWidth: 1, globalAlpha: 1, globalCompositeOperation: "source-over",
    beginPath: rec("beginPath"), closePath: rec("closePath"), moveTo: rec("moveTo"),
    lineTo: rec("lineTo"), arc: rec("arc"), arcTo: rec("arcTo"), ellipse: rec("ellipse"),
    fill: rec("fill"), stroke: rec("stroke"), fillRect: rec("fillRect"),
    save: rec("save"), restore: rec("restore"), translate: rec("translate"), scale: rec("scale"),
  };
}

test("the four enemy types map to four distinct body colors", () => {
  const colors = ENEMY_TYPES.map((t) => ENEMY_COLORS[t]);
  assert.equal(new Set(colors).size, 4, `expected 4 distinct colors, got ${colors}`);
  // The must-ram Enforcer and the shootable Barrel Dumper must NOT share a color.
  assert.notEqual(ENEMY_COLORS.enforcer, ENEMY_COLORS.barrelDumper);
});

test("drawVehicle strokes an outline when the outline style is set", () => {
  const ctx = recordingCtx();
  drawVehicle(ctx, 100, 100, 40, 60, { body: "#fff", outline: "#000", outlineWidth: 2 });
  assert.ok(ctx.calls.some((c) => c.name === "stroke"), "outline should stroke the body");
  assert.ok(ctx.calls.some((c) => c.name === "strokeStyle" && c.args[0] === "#000"));
});

test("the bulletproof Enforcer draws a white armor outline; others do not", () => {
  const opts = {};
  const enforcer = createEnemy("enforcer", 270, opts);
  const ec = recordingCtx();
  enforcer.draw(ec);
  assert.ok(
    ec.calls.some((c) => c.name === "strokeStyle" && c.args[0] === palette.hudText),
    "Enforcer should stroke a white (hudText) armor outline",
  );

  const switchblade = createEnemy("switchblade", 270, opts);
  const sc = recordingCtx();
  switchblade.draw(sc);
  assert.ok(
    !sc.calls.some((c) => c.name === "strokeStyle" && c.args[0] === palette.hudText),
    "Switchblade should NOT draw the armor outline",
  );
});

test("every enemy type draws without throwing", () => {
  for (const t of ENEMY_TYPES) {
    const e = createEnemy(t, 270, {});
    e.y = 200;
    assert.doesNotThrow(() => e.draw(recordingCtx()), `draw threw for ${t}`);
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/enemy_identity.test.js`
Expected: FAIL — `ENEMY_COLORS` is not exported (import error) and outline option does not exist.

- [ ] **Step 3: Add the palette colors**

In `src/data/palette.js`, replace the Enemies block:

```js
  // Enemies.
  enemy: "#ff4d6d", // Switchblade (vivid pink-red)
  enemyHeavy: "#9b5de5", // Enforcer (armored purple)
  enemyArmed: "#ff8c1a", // Road Lord (hot orange — armed car)
  enemyTruck: "#5a6472", // Barrel Dumper (steel truck)
  enemyAccent: "#2a1620", // enemy window/shadow detail
  heliBody: "#4a5260", // Mad Bomber helicopter (gunmetal)
```

- [ ] **Step 4: Add the `outline` option to `drawVehicle`**

In `src/render/shapes.js`, extend the `VehicleStyle` typedef (add two lines after `@property {string} [stripe]`):

```js
 * @property {string} [outline]      optional stroke color around the body
 * @property {number} [outlineWidth] outline stroke width (default 2)
```

Then in `drawVehicle`, immediately AFTER the body fill (after the `roundedRectPath(...); ctx.fill();` that fills `style.body`, ~line 101) and BEFORE the stripe block, insert:

```js
  // Optional armor outline (e.g. the bulletproof Enforcer). Stroked on the body
  // silhouette so it reads as plating regardless of body color.
  if (style.outline) {
    ctx.strokeStyle = style.outline;
    ctx.lineWidth = style.outlineWidth ?? 2;
    roundedRectPath(ctx, 0, 0, w, h, radius);
    ctx.stroke();
  }
```

- [ ] **Step 5: Remap `ENEMY_COLORS`, export it, and rewrite `Enemy.draw`**

In `src/entities/enemies.js`, replace the `ENEMY_COLORS` const (~line 34-39) with an exported, fully-distinct map:

```js
/**
 * Per-type body colors (spec §4.1). All four are DISTINCT so the cast is
 * readable; the bulletproof Enforcer additionally gets a white armor outline +
 * chevron in draw() (driven off `bulletproof`, not the type string).
 */
export const ENEMY_COLORS = {
  switchblade: palette.enemy, // pink-red
  enforcer: palette.enemyHeavy, // purple (+ armor outline)
  roadLord: palette.enemyArmed, // orange
  barrelDumper: palette.enemyTruck, // steel
};
```

Replace `Enemy.draw` (~line 193-203) with the per-type version + a glyph helper:

```js
  /**
   * Draw the enemy as an oncoming vehicle (facing down toward the player), with
   * a per-type silhouette + glyph so each of the four types is distinct (§4.1).
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    const body = ENEMY_COLORS[this.type] ?? palette.enemy;
    const minDim = Math.min(this.width, this.height);
    /** @type {import("../render/shapes.js").VehicleStyle} */
    const style = { body, accent: palette.enemyAccent };
    if (this.type === "switchblade") style.radius = minDim * 0.18; // sleek
    else if (this.type === "barrelDumper") style.radius = minDim * 0.12; // boxy truck
    // Armor cue is driven off `bulletproof` so any future bulletproof type inherits it.
    if (this.bulletproof) {
      style.outline = palette.hudText;
      style.outlineWidth = 2.5;
      style.radius = minDim * 0.14; // boxier heavy
    }
    drawVehicle(ctx, this.x, this.y, this.width, this.height, style, {
      facing: -1,
      shadow: true,
    });
    this._drawGlyph(ctx);
  }

  /**
   * Draw the type-specific marking on top of the body (screen space, centered on
   * the vehicle). Kept here so shapes.js stays free of game knowledge.
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawGlyph(ctx) {
    ctx.save();
    if (this.bulletproof) {
      // White chevron pointing toward the player — "armored, ram me".
      ctx.strokeStyle = palette.hudText;
      ctx.lineWidth = 2.5;
      const gw = this.width * 0.4;
      ctx.beginPath();
      ctx.moveTo(this.x - gw / 2, this.y - this.height * 0.08);
      ctx.lineTo(this.x, this.y + this.height * 0.06);
      ctx.lineTo(this.x + gw / 2, this.y - this.height * 0.08);
      ctx.stroke();
    } else if (this.type === "roadLord") {
      // Twin gun-port marks near the front (front of oncoming traffic = +y).
      ctx.fillStyle = palette.enemyAccent;
      const dx = this.width * 0.22;
      const gw = Math.max(3, this.width * 0.12);
      const gh = Math.max(4, this.height * 0.1);
      const gy = this.y + this.height * 0.28;
      ctx.fillRect(this.x - dx - gw / 2, gy - gh / 2, gw, gh);
      ctx.fillRect(this.x + dx - gw / 2, gy - gh / 2, gw, gh);
    } else if (this.type === "barrelDumper") {
      // Cargo-barrel mark on the truck bed.
      ctx.fillStyle = palette.barrel;
      ctx.beginPath();
      ctx.arc(this.x, this.y - this.height * 0.12, Math.max(4, this.width * 0.16), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = palette.barrelRim;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
  }
```

- [ ] **Step 6: Recolor the helicopter body**

In `src/entities/enemies.js`, in `Helicopter.draw` (~line 433), change the body fill:

```js
    // Body.
    ctx.fillStyle = palette.heliBody;
```

- [ ] **Step 7: Run the new test + the render smoke test**

Run: `node --test test/enemy_identity.test.js test/render_smoke.test.js`
Expected: PASS (all). The recolor/glyphs use only ctx methods the fake ctx already implements, so `render_smoke` stays green.

- [ ] **Step 8: Run the FULL suite — must be fully green (visual change only)**

Run: `node --test`
Expected: PASS — all 489 + 4 new tests green, **including both replay goldens** (this task does not touch the sim).

- [ ] **Step 9: Commit**

```bash
git add src/data/palette.js src/render/shapes.js src/entities/enemies.js test/enemy_identity.test.js
git commit -m "$(cat <<'EOF'
Give each enemy type a distinct color + marking (issue #1)

Four types shared two colors; the bulletproof Enforcer looked identical to the
shootable Barrel Dumper. Remap ENEMY_COLORS to four distinct hues, add a generic
drawVehicle outline option, draw a white armor outline + chevron on bulletproof
enemies (driven off `bulletproof`, not type), per-type glyphs, and recolor the
heli body to gunmetal. Pure visual; no sim change.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Difficulty pacing — concurrent cap + gentler ramp (spec §4.2)

**Files:**
- Modify: `src/data/config.js` (`director` block, ~line 343-386)
- Modify: `src/systems/director.js` (add `spawnCap`, gate `update`)
- Modify: `src/core/world.js` (pass `liveEnemyCount` into `director.update`, ~line 375-380)
- Modify: `test/director.test.js` (Enforcer unlock distance)
- Create: `test/director_cap.test.js`

> From here on, `test/replay.test.js` and `test/replay_modes.test.js` are EXPECTED RED until Tasks 7–8. Verify nothing else regresses.

- [ ] **Step 1: Write the failing tests**

Create `test/director_cap.test.js`:

```js
// test/director_cap.test.js
//
// Difficulty pacing (spec §4.2): a concurrent-enemy cap is the primary density
// lever. When the cap is reached the director SKIPS the whole spawn decision and
// draws NO RNG (so the seeded stream stays stable going forward). The cap lerps
// from start->end with difficulty.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Director } from "../src/systems/director.js";
import { createRng } from "../src/engine/rng.js";
import { config } from "../src/data/config.js";

function roadStub() {
  const W = config.VIRTUAL_WIDTH;
  const width = 320;
  return {
    sampleAt() {
      return { centerX: W / 2, width, leftEdge: W / 2 - width / 2, rightEdge: W / 2 + width / 2 };
    },
  };
}

test("spawnCap lerps from start at distance 0 to end at rampDistance", () => {
  const d = new Director({ config });
  const { start, end } = config.director.maxConcurrentEnemies;
  assert.equal(d.spawnCap(0), start);
  assert.equal(d.spawnCap(config.director.rampDistance), end);
  // Monotonic non-decreasing.
  let prev = 0;
  for (let x = 0; x <= config.director.rampDistance; x += 1000) {
    const c = d.spawnCap(x);
    assert.ok(c >= prev, `cap decreased at ${x}`);
    prev = c;
  }
});

test("a capped spawn tick draws NO RNG (stream stays put)", () => {
  const d = new Director({ config });
  const rng = createRng(123);
  const road = roadStub();
  // distance in (warmup, firstAt of every set-piece) so no set-piece fires here.
  const distance = 2000;
  // First tick: lazily seeds set-pieces (draws RNG — not what we measure).
  d.update(1 / 60, { distance, speed: 300, road, rng, liveEnemyCount: 99 });
  const before = rng.seed();
  // A big dt trips the cadence this tick; liveEnemyCount >> cap => capped.
  const evs = d.update(3.0, { distance, speed: 300, road, rng, liveEnemyCount: 99 });
  const after = rng.seed();
  assert.equal(after, before, "capped spawn tick must not advance the RNG");
  assert.equal(evs.filter((e) => e.kind === "enemy" || e.kind === "civilian").length, 0);
});

test("below the cap, the cadence still produces a spawn", () => {
  const d = new Director({ config });
  const rng = createRng(123);
  const road = roadStub();
  const distance = 2000;
  d.update(1 / 60, { distance, speed: 300, road, rng, liveEnemyCount: 0 });
  const evs = d.update(3.0, { distance, speed: 300, road, rng, liveEnemyCount: 0 });
  assert.ok(
    evs.some((e) => e.kind === "enemy" || e.kind === "civilian"),
    "uncapped cadence should spawn",
  );
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/director_cap.test.js`
Expected: FAIL — `d.spawnCap is not a function` and `maxConcurrentEnemies` undefined.

- [ ] **Step 3: Retune the `director` config + add `maxConcurrentEnemies`**

In `src/data/config.js`, inside the `director` block, apply these exact edits:

- `maxInterval: 2.4,` → keep.
- `minInterval: 0.65,` → `minInterval: 1.0,`
- `rampDistance: 30000,` → `rampDistance: 34000,`
- `warmupDistance: 700,` → `warmupDistance: 1600,`
- `civilianChanceStart: 0.45,` → `civilianChanceStart: 0.55,`
- Replace the `enemyUnlock` array with:

```js
    enemyUnlock: [
      { distance: 0, count: 1 }, // Switchblade only
      { distance: 6000, count: 2 }, // + Road Lord
      { distance: 16000, count: 3 }, // + Barrel Dumper
      { distance: 30000, count: 4 }, // + Enforcer (hardest)
    ],
```

- Add a new key directly after `enemyUnlock` (before `laneSpread`):

```js
    // AIDEV-NOTE: Concurrent-enemy cap (spec §4.2) — the PRIMARY density lever.
    // The live ENEMY count (civilians excluded) may not exceed
    // round(lerp(start, end, difficulty)). When at/over the cap the director
    // skips the whole spawn decision and draws NO RNG (see systems/director.js),
    // so the seeded stream stays stable. Tune start/end here only.
    maxConcurrentEnemies: Object.freeze({ start: 3, end: 6 }),
```

- In the `setpieces` block, change `enemyWave` spacing:
  `enemyWave: Object.freeze({ firstAt: 6000, spacing: 11000, jitter: 1500 }),`
  → `enemyWave: Object.freeze({ firstAt: 6000, spacing: 14000, jitter: 1500 }),`

- [ ] **Step 4: Add `spawnCap` + the cap gate to the Director**

In `src/systems/director.js`, add a method right after `currentInterval` (~line 101):

```js
  /**
   * Max concurrent ground enemies allowed at a distance — round(lerp(start, end,
   * difficulty)). Civilians are NOT counted (they are non-lethal). The world
   * passes the live enemy count into update(); when it meets/exceeds this, the
   * cadence spawn is skipped entirely (spec §4.2).
   * @param {number} distance
   * @returns {number}
   */
  spawnCap(distance) {
    const c = this.config.director.maxConcurrentEnemies;
    return Math.round(lerp(c.start, c.end, this.difficulty(distance)));
  }
```

Then in `update()`, replace the cadence block (~line 174-180) with:

```js
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      // Reset to the current cadence (SET, not subtract) so a big dt can't bank
      // a burst of spawns in one tick.
      this.spawnTimer = this.currentInterval(distance);
      // AIDEV-NOTE: concurrent-cap gate (spec §4.2). At/over the cap we skip the
      // ENTIRE spawn decision — crucially BEFORE decideSpawn draws any RNG — so a
      // capped tick consumes nothing from the seeded stream. liveEnemyCount is the
      // live ground-enemy count the world feeds in (defaults to 0 for pure
      // director tests, which therefore never cap).
      const liveEnemyCount = ctx.liveEnemyCount ?? 0;
      if (liveEnemyCount < this.spawnCap(distance)) {
        events.push(this.decideSpawn(ctx));
      }
    }
```

- [ ] **Step 5: Feed `liveEnemyCount` from the World**

In `src/core/world.js`, update the `director.update` call (~line 375-380):

```js
    const spawnEvents = this.director.update(dt, {
      distance: this.distance,
      speed: this.speed,
      road: this.road,
      rng: this.rng,
      liveEnemyCount: this.enemies.length, // ground enemies only; cap lever (§4.2)
    });
```

- [ ] **Step 6: Update the Enforcer-unlock assertion in `test/director.test.js`**

In `test/director.test.js`, in the "tougher enemy types are gated by distance" test (~line 96-99), change the two `26000` literals to `30000`:

```js
  const earlyEnforcer = enemies.filter(
    (s) => s.type === "enforcer" && s.distance < 30000,
  );
  assert.equal(earlyEnforcer.length, 0, "Enforcer appeared before its unlock");
```

- [ ] **Step 7: Run the cap + director tests**

Run: `node --test test/director_cap.test.js test/director.test.js`
Expected: PASS (both files).

- [ ] **Step 8: Run the full suite — only the two replay goldens may fail**

Run: `node --test`
Expected: PASS for everything EXCEPT `test/replay.test.js` and `test/replay_modes.test.js` (expected red — stream shifted by the retune). Confirm **no third failure**.

- [ ] **Step 9: Commit**

```bash
git add src/data/config.js src/systems/director.js src/core/world.js test/director_cap.test.js test/director.test.js
git commit -m "$(cat <<'EOF'
Add concurrent-enemy cap + gentler difficulty ramp (issue #3)

Primary density lever: a round(lerp(3,6,difficulty)) cap on live ground enemies;
a capped cadence tick skips the whole spawn decision drawing zero RNG. Soften the
cadence floor (minInterval 0.65->1.0), stretch the ramp (rampDistance 30k->34k),
lengthen warmup (700->1600), raise early neutral traffic (civChanceStart
0.45->0.55), spread hard-type unlocks, and widen enemyWave spacing.

The two whole-system replay goldens are intentionally left red here; they are
re-recorded once after all sim changes land.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Enemy overlap — soft separation + non-overlapping spawns (spec §4.3)

**Files:**
- Modify: `src/data/config.js` (`enemies` block — add `separation`)
- Modify: `src/entities/enemies.js` (add exported `separateEnemies`)
- Modify: `src/core/world.js` (call separation; wave lane-spread; spawn de-overlap; import `ENEMY_TYPES`)
- Create: `test/enemy_separation.test.js`
- Create: `test/world_overlap.test.js`

- [ ] **Step 1: Write the failing pure-separation test**

Create `test/enemy_separation.test.js`:

```js
// test/enemy_separation.test.js
//
// Soft separation (spec §4.3): a pure-geometry, RNG-free pass nudges enemies
// apart so they never sit directly stacked, while still allowing side-by-side
// flanking. Tested directly on the pure function (no world, no steering).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createEnemy, separateEnemies } from "../src/entities/enemies.js";
import { config } from "../src/data/config.js";

const SEP = config.enemies.separation;
const DT = 1 / 60;

function stacked() {
  const a = createEnemy("switchblade", 270, {});
  const b = createEnemy("switchblade", 270, {});
  a.y = 100;
  b.y = 100; // identical position => maximal overlap
  return [a, b];
}

test("two stacked enemies diverge to a non-overlapping gap within a couple seconds", () => {
  const [a, b] = stacked();
  const clearGap = (a.width + b.width) / 2 + SEP.marginX;
  let ticks = 0;
  while (Math.abs(a.x - b.x) < clearGap && ticks < 240) {
    separateEnemies([a, b], DT, { config });
    ticks++;
  }
  assert.ok(Math.abs(a.x - b.x) >= clearGap, `still stacked after ${ticks} ticks`);
});

test("separation is index-deterministic: equal-x pair, lower index goes left", () => {
  const [a, b] = stacked();
  separateEnemies([a, b], DT, { config });
  assert.ok(a.x < b.x, "index 0 should be pushed left of index 1");
});

test("enemies far apart in y are untouched (no false separation)", () => {
  const a = createEnemy("switchblade", 270, {});
  const b = createEnemy("switchblade", 270, {});
  a.y = 0;
  b.y = 500;
  const ax = a.x, bx = b.x;
  separateEnemies([a, b], DT, { config });
  assert.equal(a.x, ax);
  assert.equal(b.x, bx);
});

test("a custom clampX is applied to the pushed positions", () => {
  const [a, b] = stacked();
  // Clamp everything to a tiny band so the push can't move anything.
  separateEnemies([a, b], DT, { config, clampX: () => 270 });
  assert.equal(a.x, 270);
  assert.equal(b.x, 270);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/enemy_separation.test.js`
Expected: FAIL — `separateEnemies` is not exported and `config.enemies.separation` is undefined.

- [ ] **Step 3: Add the `separation` config**

In `src/data/config.js`, inside the `enemies` block, add directly after `wavePack: 3,` (~line 214):

```js
    // AIDEV-NOTE: soft separation (spec §4.3). A pure-geometry per-tick pass
    // (entities/enemies.js separateEnemies) nudges enemies apart when their
    // bodies overlap, so they never sit directly stacked — flanking side-by-side
    // is still allowed. `push` is the px/s separation speed (split between the
    // pair); margins add a little slack to the overlap test. No RNG.
    separation: Object.freeze({ push: 80, marginX: 6, marginY: 8 }),
```

- [ ] **Step 4: Add the pure `separateEnemies` function**

In `src/entities/enemies.js`, add after the `approach` helper (~line 53):

```js
/**
 * Soft separation pass (spec §4.3). Pure geometry, NO RNG: for each pair of
 * active enemies whose bodies overlap vertically AND are laterally close, push
 * them apart by `push * dt * 0.5` each along sign(x_i - x_j). Equal x breaks the
 * tie by array index (lower index goes left) so it is fully deterministic. This
 * prevents direct stacking while allowing side-by-side flanking.
 * @param {Array<{x:number,y:number,width:number,height:number,active:boolean,dead:boolean}>} enemies
 * @param {number} dt seconds
 * @param {{config?: typeof config, clampX?: (x:number, e:object)=>number}} [opts]
 *   clampX keeps a pushed enemy on the road (the world injects a road-aware
 *   clamp); defaults to identity for pure tests.
 */
export function separateEnemies(enemies, dt, opts = {}) {
  const cfg = (opts.config ?? config).enemies.separation;
  const clampX = opts.clampX ?? ((x) => x);
  const list = enemies.filter((e) => e.active && !e.dead);
  const step = cfg.push * dt * 0.5;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (Math.abs(a.y - b.y) >= (a.height + b.height) / 2 + cfg.marginY) continue;
      if (Math.abs(a.x - b.x) >= (a.width + b.width) / 2 + cfg.marginX) continue;
      // Lower index (a) goes left when exactly aligned.
      const dir = a.x === b.x ? -1 : Math.sign(a.x - b.x);
      a.x = clampX(a.x + dir * step, a);
      b.x = clampX(b.x - dir * step, b);
    }
  }
}
```

- [ ] **Step 5: Run the pure test to verify it passes**

Run: `node --test test/enemy_separation.test.js`
Expected: PASS.

- [ ] **Step 6: Write the failing world-overlap test**

Create `test/world_overlap.test.js`:

```js
// test/world_overlap.test.js
//
// Overlap fixes wired into the World (spec §4.3): an enemyWave spawns its
// chasers at DISTINCT, non-overlapping lateral slots (clamped to cap headroom),
// and the per-tick separation pass keeps live enemies from stacking.
import { test } from "node:test";
import assert from "node:assert/strict";
import { World } from "../src/core/world.js";
import { config } from "../src/data/config.js";

const DT = config.FIXED_STEP;

function pairwiseMinGap(xs) {
  let min = Infinity;
  for (let i = 0; i < xs.length; i++)
    for (let j = i + 1; j < xs.length; j++) min = Math.min(min, Math.abs(xs[i] - xs[j]));
  return min;
}

test("an enemyWave spawns wavePack distinct, non-overlapping chasers", () => {
  const w = new World({ seed: 7 });
  w.distance = 7000; // past warmup; full cap headroom (no live enemies)
  w._realizeSpawn({ kind: "setpiece", name: "enemyWave" });
  const wave = w.enemies;
  assert.equal(wave.length, config.enemies.wavePack, "all chasers spawned (headroom available)");
  const minGap = pairwiseMinGap(wave.map((e) => e.x));
  const w0 = config.enemies.switchblade.width;
  assert.ok(minGap >= w0, `chasers overlap at spawn: minGap=${minGap}`);
});

test("an enemyWave is clamped to the remaining concurrent-cap headroom", () => {
  const w = new World({ seed: 7 });
  w.distance = 7000;
  const cap = w.director.spawnCap(w.distance);
  // Fill to one below the cap so only ONE wave chaser fits.
  while (w.enemies.length < cap - 1) {
    w._realizeSpawn({ kind: "enemy", type: "switchblade", x: 270 });
  }
  const before = w.enemies.length;
  w._realizeSpawn({ kind: "setpiece", name: "enemyWave" });
  assert.equal(w.enemies.length, cap, "wave clamped to headroom");
  assert.ok(w.enemies.length - before <= config.enemies.wavePack);
});

test("a headless run never leaves enemies overlapping after the separation pass", () => {
  const w = new World({ seed: 42 });
  let maxStacked = 0;
  for (let t = 0; t < 1500; t++) {
    w.setInput({ accel: true, fire: true });
    w.update(DT);
    // Count any pair that is still hard-overlapping (well inside both bodies).
    for (let i = 0; i < w.enemies.length; i++) {
      for (let j = i + 1; j < w.enemies.length; j++) {
        const a = w.enemies[i], b = w.enemies[j];
        const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
        if (dx < (a.width + b.width) / 4 && dy < (a.height + b.height) / 4) maxStacked++;
      }
    }
  }
  // A nudge, not a hard collision: brief transient overlaps are fine, but a
  // run should not be dominated by hard stacks.
  assert.ok(maxStacked < 200, `too many hard stacks across the run: ${maxStacked}`);
});

test("live enemy count never exceeds the distance-based cap", () => {
  const w = new World({ seed: 9 });
  for (let t = 0; t < 1800; t++) {
    w.setInput({ accel: true, fire: true });
    w.update(DT);
    assert.ok(
      w.enemies.length <= w.director.spawnCap(w.distance),
      `cap exceeded at tick ${t}: ${w.enemies.length} > ${w.director.spawnCap(w.distance)}`,
    );
  }
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `node --test test/world_overlap.test.js`
Expected: FAIL — the current wave loop uses independent `pickLane` draws (can overlap) and there is no separation pass / headroom clamp yet.

- [ ] **Step 8: Wire separation + wave lane-spread + spawn de-overlap into the World**

In `src/core/world.js`:

(a) Extend the enemies import (~line 31) to include `separateEnemies` and `ENEMY_TYPES`:

```js
import {
  createEnemy,
  Bomb,
  HELI_PHASE,
  separateEnemies,
  ENEMY_TYPES,
} from "../entities/enemies.js";
```

(b) After the enemy update loop (~line 384-387), add the separation pass:

```js
    // --- Enemies: behavior + realize their attack events. ---
    for (const e of this.enemies) {
      const events = e.update(dt, this);
      for (const ev of events) this._realizeEnemyEvent(ev);
    }
    // Soft separation (spec §4.3): nudge overlapping enemies apart (pure geometry,
    // no RNG), clamped to the road at each enemy's row.
    separateEnemies(this.enemies, dt, {
      config: this.config,
      clampX: (x, e) => this._clampEnemyToRoad(x, e),
    });
```

(c) Replace the enemy branch of `_realizeSpawn` (~line 715-716) with a de-overlapping version:

```js
    if (ev.kind === "enemy") {
      const def = this.config.enemies[ev.type];
      const sampleDistance = this.distance + this.config.VIRTUAL_HEIGHT;
      const x = this._deoverlapEnemyX(ev.x, def.width, def.height, sampleDistance);
      this.enemies.push(createEnemy(ev.type, x, { config: this.config }));
    } else if (ev.kind === "civilian") {
```

(d) Replace the `enemyWave` block in `_realizeSpawn` (~line 738-745) with the slot-based lane-spread (fixed RNG draw count = `wavePack`, cap-clamped realization):

```js
      // AIDEV-NOTE: spec §4.3 — the wave spawns its chasers across DISTINCT lateral
      // slots so they never start stacked. We always draw `wavePack` jitters (one
      // rng.range per slot — fixed draw count, replay-stable) but only realize the
      // first `count` chasers, where count is clamped to the concurrent-cap
      // headroom (§4.2). Road is sampled at the spawn row (distance + VIRTUAL_HEIGHT)
      // to match decideSpawn.
      if (ev.name === "enemyWave") {
        const wavePack = this.config.enemies.wavePack ?? 3;
        const half = this.config.enemies.switchblade.width / 2;
        const headroom = Math.max(0, this.director.spawnCap(this.distance) - this.enemies.length);
        const count = Math.min(wavePack, headroom);
        const s = this.road.sampleAt(this.distance + this.config.VIRTUAL_HEIGHT);
        const spread = (s.width / 2) * this.config.director.laneSpread;
        const lo = Math.max(s.leftEdge + half, s.centerX - spread);
        const hi = Math.min(s.rightEdge - half, s.centerX + spread);
        const span = Math.max(0, hi - lo);
        const slotW = span / wavePack;
        for (let k = 0; k < wavePack; k++) {
          // ONE rng draw per slot, ALWAYS (keeps the seeded draw count fixed).
          const jitter = this.rng.range(-slotW * 0.25, slotW * 0.25);
          if (k >= count) continue; // capped: drew the jitter, don't spawn
          const slotCenter = lo + slotW * (k + 0.5);
          const x = Math.max(lo, Math.min(hi, slotCenter + jitter));
          this.enemies.push(createEnemy("switchblade", x, { config: this.config }));
        }
      }
```

(e) Add two private helpers. Place them right before `_realizeSpawn` (~line 704):

```js
  /**
   * Clamp an enemy's x to the road body at its current screen row (used by the
   * separation pass so a nudge never pushes a car off the asphalt). Pure.
   * @param {number} x
   * @param {{y:number, width:number}} enemy
   * @returns {number}
   * @private
   */
  _clampEnemyToRoad(x, enemy) {
    const worldDist = this.distance + (this.height - enemy.y);
    const s = this.road.sampleAt(worldDist);
    const half = enemy.width / 2;
    const lo = s.leftEdge + half;
    const hi = s.rightEdge - half;
    if (hi <= lo) return s.centerX;
    return x < lo ? lo : x > hi ? hi : x;
  }

  /**
   * Pick a non-overlapping spawn x for a new enemy (spec §4.3): if `x` overlaps
   * an active enemy in the spawn y-band, step along the road band by a fixed
   * stride (0, +d, -d, +2d, -2d, ...) to the first clear slot. Pure: draws NO RNG
   * so the seeded stream is untouched by this de-overlap.
   * @param {number} x director-chosen lateral center
   * @param {number} width new enemy width
   * @param {number} height new enemy height
   * @param {number} sampleDistance road row to sample (top of field)
   * @returns {number}
   * @private
   */
  _deoverlapEnemyX(x, width, height, sampleDistance) {
    const sep = this.config.enemies.separation;
    const spawnY = this.config.enemies.spawnY;
    const s = this.road.sampleAt(sampleDistance);
    const lo = s.leftEdge + width / 2;
    const hi = s.rightEdge - width / 2;
    if (hi <= lo) return x;
    const maxW = ENEMY_TYPES.reduce((m, t) => Math.max(m, this.config.enemies[t].width), 0);
    const stride = maxW / 2 + sep.marginX;
    const near = this.enemies.filter(
      (e) => e.active && !e.dead && Math.abs(e.y - spawnY) < (e.height + height) / 2 + sep.marginY,
    );
    const clear = (cx) =>
      !near.some((e) => Math.abs(cx - e.x) < (width + e.width) / 2 + sep.marginX);
    const offsets = [0];
    for (let k = 1; k <= 4; k++) offsets.push(k * stride, -k * stride);
    for (const off of offsets) {
      const cand = Math.max(lo, Math.min(hi, x + off));
      if (clear(cand)) return cand;
    }
    return Math.max(lo, Math.min(hi, x)); // no clear slot; clamp on-road
  }
```

- [ ] **Step 9: Run the overlap tests**

Run: `node --test test/world_overlap.test.js test/enemy_separation.test.js`
Expected: PASS (both).

- [ ] **Step 10: Run the full suite — only the two replay goldens may fail**

Run: `node --test`
Expected: PASS for everything except `test/replay.test.js` + `test/replay_modes.test.js`. Confirm no third failure.

- [ ] **Step 11: Commit**

```bash
git add src/data/config.js src/entities/enemies.js src/core/world.js test/enemy_separation.test.js test/world_overlap.test.js
git commit -m "$(cat <<'EOF'
Stop enemies stacking: soft separation + non-overlapping spawns (issue #2)

Add a pure-geometry, RNG-free per-tick separation pass that nudges overlapping
enemies apart (flanking still allowed), spread enemyWave chasers across distinct
lateral slots clamped to cap headroom (fixed RNG draw count), and de-overlap
cadence spawns deterministically. Replay goldens remain red until re-record.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Helicopter lifecycle — wait-out + enforced break (spec §4.4)

**Files:**
- Modify: `src/data/config.js` (`helicopter` block — `trackDuration`, `cooldown`, `leaveSpeed`)
- Modify: `src/entities/enemies.js` (`Helicopter` constructor + TRACKING branch)
- Modify: `src/core/world.js` (`_heliCooldown`: ctor, update decrement, retire set, spawn guard, reset)
- Modify: `test/helicopter.test.js` (add wait-out test)
- Create: `test/world_heli_lifecycle.test.js`

- [ ] **Step 1: Write the failing pure wait-out test**

In `test/helicopter.test.js`, add after the "tracks the player's x" test (~line 66):

```js
test("Helicopter waits out: TRACKING -> LEAVING after trackDuration, still alive", () => {
  const h = new Helicopter(270, H.hoverY);
  h.phase = HELI_PHASE.TRACKING;
  const world = worldWith({ x: 270, y: 600 });
  const steps = Math.ceil(H.trackDuration / (1 / 60)) + 2;
  for (let i = 0; i < steps; i++) h.update(1 / 60, world);
  assert.equal(h.phase, HELI_PHASE.LEAVING, "left on its own after trackDuration");
  assert.equal(h.dead, false, "a waited-out heli is NOT destroyed (scores zero)");
  assert.equal(h.active, true);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/helicopter.test.js`
Expected: FAIL — `H.trackDuration` is undefined (NaN steps) and TRACKING never exits, so the heli stays in TRACKING.

- [ ] **Step 3: Add heli config (trackDuration, cooldown, leaveSpeed bump)**

In `src/data/config.js`, in the `helicopter` block, change `leaveSpeed` and add two keys:

```js
    leaveSpeed: 300, // px/s upward once defeated OR waited out (LEAVING) — was 220
    scoreValue: 1000, // points for destroying it (missile kill only)
    // AIDEV-NOTE: lifecycle (spec §4.4). A heli that is neither destroyed nor
    // missiled away still LEAVES on its own after trackDuration seconds of
    // tracking (the player can "wait it out"); it leaves ALIVE so it scores zero.
    // After ANY heli is retired the world enforces a `cooldown`-second break
    // before the next "helicopter" milestone may spawn one (core/world.js
    // _heliCooldown), so they never feel relentless / stacked.
    trackDuration: 16, // seconds of TRACKING before the heli gives up and leaves
    cooldown: 40, // enforced quiet break (seconds) after a heli is retired
```

- [ ] **Step 4: Add `trackTimer` + the TRACKING exit to the Helicopter**

In `src/entities/enemies.js`, in the `Helicopter` constructor, after `this.bombTimer = 0;` (~line 317):

```js
    // Seconds accumulated in TRACKING; when it reaches def.trackDuration the heli
    // gives up and leaves on its own (alive — see update()).
    this.trackTimer = 0;
```

In the TRACKING branch of `update()` (~line 349), add the wait-out check at the very top of the case (right after `case HELI_PHASE.TRACKING: {`):

```js
      case HELI_PHASE.TRACKING: {
        // Wait-out (spec §4.4): after trackDuration the heli leaves on its own,
        // ALIVE — `dead` stays false so the world awards no points (zero-score
        // wait-out). A missile kill still routes through missileHit().
        this.trackTimer += dt;
        if (this.trackTimer >= def.trackDuration) {
          this.phase = HELI_PHASE.LEAVING;
          return [];
        }
        // Lateral chase with a deadzone to avoid jitter when aligned.
        const dx = world.player.x - this.x;
```

(The rest of the TRACKING branch — chase + bomb cadence — is unchanged.)

- [ ] **Step 5: Run the pure heli tests**

Run: `node --test test/helicopter.test.js`
Expected: PASS (including the new wait-out test). The existing heli tests run < 16 s of sim each, so none trip the wait-out.

- [ ] **Step 6: Write the failing world-lifecycle test**

Create `test/world_heli_lifecycle.test.js`:

```js
// test/world_heli_lifecycle.test.js
//
// Helicopter lifecycle wired into the World (spec §4.4): a retired heli starts a
// cooldown break during which a new "helicopter" milestone is a no-op; once the
// break elapses the next milestone spawns again. A waited-out heli scores zero.
import { test } from "node:test";
import assert from "node:assert/strict";
import { World } from "../src/core/world.js";
import { config } from "../src/data/config.js";
import { Helicopter, HELI_PHASE } from "../src/entities/enemies.js";

const H = config.helicopter;

test("retiring a heli starts a cooldown that blocks the next one, then allows it", () => {
  const w = new World({ seed: 1 });
  w._realizeSpawn({ kind: "setpiece", name: "helicopter" });
  assert.ok(w.helicopter instanceof Helicopter);

  // Force it to LEAVING + off the top so the world retires it this tick.
  w.helicopter.phase = HELI_PHASE.LEAVING;
  w.helicopter.y = -H.height - 100;
  w.update(1 / 60);
  assert.equal(w.helicopter, null, "retired after leaving the screen");
  assert.ok(w._heliCooldown > 0, "cooldown armed on retire");

  // A milestone during the cooldown is dropped.
  w._realizeSpawn({ kind: "setpiece", name: "helicopter" });
  assert.equal(w.helicopter, null, "cooldown blocks a fresh heli");

  // Once the break elapses, the next milestone spawns one.
  w._heliCooldown = 0;
  w._realizeSpawn({ kind: "setpiece", name: "helicopter" });
  assert.ok(w.helicopter instanceof Helicopter, "spawns again after the cooldown");
});

test("a waited-out heli leaves alive and is never scored (dead stays false)", () => {
  const w = new World({ seed: 1 });
  w._realizeSpawn({ kind: "setpiece", name: "helicopter" });
  w.helicopter.y = H.hoverY;
  w.helicopter.phase = HELI_PHASE.TRACKING;
  let sawDead = false;
  let guard = 0;
  while (w.helicopter && guard < 4000) {
    w.update(1 / 60);
    if (w.helicopter) sawDead = sawDead || w.helicopter.dead;
    guard++;
  }
  assert.equal(w.helicopter, null, "heli eventually left and was retired");
  assert.equal(sawDead, false, "wait-out heli never marked dead => zero score path");
});

test("reset clears the heli cooldown", () => {
  const w = new World({ seed: 1 });
  w._heliCooldown = 99;
  w.reset();
  assert.equal(w._heliCooldown, 0);
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `node --test test/world_heli_lifecycle.test.js`
Expected: FAIL — `w._heliCooldown` is undefined and the spawn guard does not yet consult a cooldown.

- [ ] **Step 8: Wire `_heliCooldown` into the World**

In `src/core/world.js`:

(a) In the constructor, after `this._specialCooldown = 0;` (~line 158):

```js
    /**
     * Enforced quiet break (seconds) after a helicopter is retired (spec §4.4).
     * Counts down in update(); set to config.helicopter.cooldown when a heli is
     * retired. The "helicopter" milestone is a no-op while this is positive, so
     * the player always gets a break between helis.
     * @type {number}
     */
    this._heliCooldown = 0;
```

(b) In `update()`, alongside the special-cooldown decrement (~line 303-305):

```js
    if (this._specialCooldown > 0) {
      this._specialCooldown = Math.max(0, this._specialCooldown - dt);
    }
    if (this._heliCooldown > 0) {
      this._heliCooldown = Math.max(0, this._heliCooldown - dt);
    }
```

(c) In the retire block (~line 446-452), set the cooldown when the heli is cleared:

```js
    // Retire the helicopter once it has flown off the top (LEAVING + above edge).
    if (
      this.helicopter &&
      this.helicopter.phase === HELI_PHASE.LEAVING &&
      this.helicopter.isOffscreen(this.height)
    ) {
      this.helicopter = null;
      // Start the enforced break before the next heli may spawn (spec §4.4).
      this._heliCooldown = this.config.helicopter.cooldown;
    }
```

(d) Update the spawn guard (~line 749). Replace with a cooldown-aware guard + the hardening note:

```js
      // AIDEV-NOTE: spec §4.4 singleton + break invariant. A heli spawns only when
      // none is live AND the post-retire cooldown has elapsed, so they never stack
      // and the player always gets a break. INVARIANT: `helicopter` must stay a
      // single field and _realizeSpawn must stay synchronous; if either changes,
      // this guard must become a real concurrency check.
      if (ev.name === "helicopter" && !this.helicopter && this._heliCooldown <= 0) {
        this.helicopter = createEnemy("helicopter", this.player.x, {
          config: this.config,
        });
      }
```

(e) In `reset()`, after `this._specialCooldown = 0;` (~line 844):

```js
    this._specialCooldown = 0;
    this._heliCooldown = 0;
```

- [ ] **Step 9: Run the heli tests**

Run: `node --test test/world_heli_lifecycle.test.js test/world_heli.test.js test/helicopter.test.js`
Expected: PASS (all three). `test/world_heli.test.js` still passes: its first heli spawns from a zero cooldown, and its missile-kill run retires the heli without re-spawning.

- [ ] **Step 10: Run the full suite — only the two replay goldens may fail**

Run: `node --test`
Expected: PASS except `test/replay.test.js` + `test/replay_modes.test.js`. Confirm no third failure.

- [ ] **Step 11: Commit**

```bash
git add src/data/config.js src/entities/enemies.js src/core/world.js test/helicopter.test.js test/world_heli_lifecycle.test.js
git commit -m "$(cat <<'EOF'
Let helicopters be waited out + enforce a break between them (issue #4)

A heli now leaves on its own after trackDuration (16 s) of tracking — alive, so a
waited-out heli scores zero — and the world enforces a cooldown (40 s) break after
any heli retires before the next "helicopter" milestone can spawn one. Bump
leaveSpeed 220->300 so a departing heli clears the top before any re-entry.
Replay goldens remain red until re-record.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Guaranteed missiles before the first helicopter (spec §4.5)

**Files:**
- Modify: `src/entities/weaponsVan.js` (`updateVanLoad` optional `forceKind`; import `createSpecial`)
- Modify: `src/core/world.js` (`_firstSpecialDelivered`: ctor, van loop, reset)
- Modify: `test/weaponsVan.test.js` (forceKind test)
- Create: `test/world_first_missile.test.js`

- [ ] **Step 1: Write the failing van-level test**

In `test/weaponsVan.test.js`, add after the "delivers a random special" test (~line 92):

```js
test("updateVanLoad with a forced kind delivers that kind and draws NO rng", () => {
  const v = createWeaponsVan(100, 50, { loadFrames: 1 });
  const z = rampZone(v);
  const player = fakePlayer(z.x + z.w / 2, z.y + z.h / 2);
  const rng = createRng(99);
  const before = rng.seed();
  const special = updateVanLoad(v, player, rng, "missiles");
  assert.equal(special.kind, "missiles", "forced kind delivered");
  assert.equal(rng.seed(), before, "forced delivery must not advance the RNG");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/weaponsVan.test.js`
Expected: FAIL — `updateVanLoad` ignores the 4th argument and still draws a random kind.

- [ ] **Step 3: Add the `forceKind` path to `updateVanLoad`**

In `src/entities/weaponsVan.js`, extend the weapons import (~line 17):

```js
import { loadRandomSpecial, createSpecial } from "../systems/weapons.js";
```

Replace `updateVanLoad` (~line 152-164):

```js
/**
 * Advance the van's load handshake for one step. Returns a freshly loaded special
 * when delivery completes, else null.
 *
 *   - not in ramp        -> reset progress, return null
 *   - in ramp, building  -> bump progress, return null
 *   - in ramp, complete  -> mark delivered; return createSpecial(forceKind) if a
 *                           kind is forced (NO rng drawn), else loadRandomSpecial(rng)
 *   - already delivered  -> return null (one payload per van)
 *
 * @param {WeaponsVan} v
 * @param {{x:number,y:number,width:number,height:number}} player
 * @param {{pick:Function}} rng seeded RNG (engine/rng.js createRng)
 * @param {string|null} [forceKind] when set, deliver exactly this special kind
 *   without drawing the random kind from rng (spec §4.5 first-load guarantee).
 * @returns {object|null} a loaded special descriptor, or null
 */
export function updateVanLoad(v, player, rng, forceKind = null) {
  if (v.delivered || !v.active) return null;
  if (!inRamp(v, player)) {
    v.loadProgress = 0;
    return null;
  }
  v.loadProgress += 1;
  if (v.loadProgress >= v.loadFrames) {
    v.delivered = true;
    return forceKind ? createSpecial(forceKind) : loadRandomSpecial(rng);
  }
  return null;
}
```

- [ ] **Step 4: Track the first delivery in the World**

In `src/core/world.js`:

(a) In the constructor, after `this._heliCooldown = 0;` (added in Task 4):

```js
    /**
     * Whether the run's FIRST special has been delivered yet (spec §4.5). The
     * first van delivery is always `missiles` (drawn with NO kind RNG) so a player
     * who engages the van system has missiles in hand for the first helicopter;
     * subsequent loads stay random.
     * @type {boolean}
     */
    this._firstSpecialDelivered = false;
```

(b) Replace the van loop (~line 397-404):

```js
    for (const van of this.vans) {
      van.update(dt);
      // First delivery of the run is guaranteed missiles (no kind RNG); later
      // deliveries are random (spec §4.5).
      const forceKind = this._firstSpecialDelivered ? null : "missiles";
      const loaded = updateVanLoad(van, this.player, this.rng, forceKind);
      if (loaded) {
        this.player.special = loaded;
        this._firstSpecialDelivered = true;
        this._emitAudio("weaponLoad");
      }
    }
```

(c) In `reset()`, after `this._heliCooldown = 0;` (or next to the special reset, ~line 845):

```js
    this._firstSpecialDelivered = false;
```

- [ ] **Step 5: Write the failing world-level test**

Create `test/world_first_missile.test.js`:

```js
// test/world_first_missile.test.js
//
// Guaranteed first missiles (spec §4.5): the first van delivery in a run is
// always "missiles" so the player can engage the first helicopter; later loads
// stay random. We drop the player into a van's ramp and step one tick.
import { test } from "node:test";
import assert from "node:assert/strict";
import { World } from "../src/core/world.js";
import { createWeaponsVan, rampZone } from "../src/entities/weaponsVan.js";

/** Place a 1-frame van so its rear ramp sits over the player, then step once. */
function deliverOnce(w) {
  const van = createWeaponsVan(w.player.x, 0, { config: w.config, loadFrames: 1 });
  // Position the van so its rear-ramp band overlaps the player's body.
  van.y = w.player.y - (van.height / 2 - van.def.rampHeight / 2);
  w.vans.push(van);
  w.setInput({});
  w.update(w.config.FIXED_STEP);
  return w.player.special;
}

test("the first van delivery of a run is always missiles", () => {
  const w = new World({ seed: 13 });
  assert.equal(w._firstSpecialDelivered, false);
  const special = deliverOnce(w);
  assert.ok(special, "a special was delivered");
  assert.equal(special.kind, "missiles", "first delivery is missiles");
  assert.equal(w._firstSpecialDelivered, true);
});

test("reset re-arms the first-missile guarantee", () => {
  const w = new World({ seed: 13 });
  deliverOnce(w);
  assert.equal(w._firstSpecialDelivered, true);
  w.reset();
  assert.equal(w._firstSpecialDelivered, false);
});
```

- [ ] **Step 6: Run the first-missile tests**

Run: `node --test test/world_first_missile.test.js test/weaponsVan.test.js`
Expected: PASS (both). If `deliverOnce` does not deliver (special is null), the van/player geometry is off — verify `van.y` lands the ramp band over the player; the ramp band is `[van.y + height/2 - rampHeight, van.y + height/2]` and the player body spans `player.y ± height/2`.

- [ ] **Step 7: Run the full suite — only the two replay goldens may fail**

Run: `node --test`
Expected: PASS except `test/replay.test.js` + `test/replay_modes.test.js`. `test/world_specials.test.js`'s van test only asserts a truthy special, so it stays green (delivery is now deterministically missiles). Confirm no third failure.

- [ ] **Step 8: Commit**

```bash
git add src/entities/weaponsVan.js src/core/world.js test/weaponsVan.test.js test/world_first_missile.test.js
git commit -m "$(cat <<'EOF'
Guarantee the first weapons-van delivery is missiles (fairness, spec §4.5)

The first special delivered in a run is now always missiles (loaded without
drawing the random kind), so a player who engages the van system has the
heli-killing weapon before the first helicopter milestone; later loads stay
random. Replay goldens remain red until re-record.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Ricochet feedback on bulletproof / immune targets (spec §4.6)

**Files:**
- Modify: `src/data/config.js` (`helicopter` block — `ricochetInterval`)
- Modify: `src/render/effects.js` (add `ricochetSpark`)
- Modify: `src/audio/sfx.js` (add `ricochet` + rate-limit fields)
- Modify: `src/audio/bridge.js` (map `"ricochet"`)
- Modify: `src/core/world.js` (Enforcer ricochet branch; heli ricochet pass; import `aabbOverlap`; `_heliRicochetCd`)
- Modify: `test/sfx.test.js` (add `ricochet` to the trigger lists)
- Modify: `test/audioBridge.test.js` (spy + mapping assertion)
- Create: `test/effects_ricochet.test.js`
- Create: `test/world_ricochet.test.js`

- [ ] **Step 1: Write the failing effects + world tests**

Create `test/effects_ricochet.test.js`:

```js
// test/effects_ricochet.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { ParticleSystem } from "../src/render/effects.js";
import { createRng } from "../src/engine/rng.js";

test("ricochetSpark spawns a small deterministic burst", () => {
  const a = new ParticleSystem();
  const b = new ParticleSystem();
  a.ricochetSpark(100, 100, createRng(5));
  b.ricochetSpark(100, 100, createRng(5));
  assert.ok(a.activeCount > 0, "spawned at least one spark");
  assert.equal(a.activeCount, b.activeCount, "same seed => same spark count (deterministic)");
});
```

Create `test/world_ricochet.test.js`:

```js
// test/world_ricochet.test.js
//
// Ricochet feedback (spec §4.6): a plain bullet hitting the bulletproof Enforcer
// emits a "ricochet" cue (and is still consumed); a plain bullet overlapping the
// immune helicopter emits a ricochet cue but is NOT consumed and does NO damage
// (preserving the missile-only pass-through contract).
import { test } from "node:test";
import assert from "node:assert/strict";
import { World } from "../src/core/world.js";
import { config } from "../src/data/config.js";
import { createEnemy, HELI_PHASE } from "../src/entities/enemies.js";

const DT = config.FIXED_STEP;

test("a bullet on the bulletproof Enforcer ricochets (cue emitted, bullet consumed)", () => {
  const w = new World({ seed: 1 });
  const e = createEnemy("enforcer", w.player.x, { config: w.config });
  e.y = 200;
  w.enemies.push(e);
  w.projectiles.spawn({
    x: e.x, y: 200, vx: 0, vy: 0, category: "playerBullet", damage: 1, ttl: 5,
  });
  w.update(DT);
  assert.ok(w.audioEvents.some((a) => a.type === "ricochet"), "ricochet cue emitted");
  assert.equal(w.projectiles.toArray().length, 0, "bullet consumed");
  assert.equal(e.dead, false, "bulletproof Enforcer unharmed");
});

test("a plain bullet on the helicopter ricochets but is NOT consumed / no damage", () => {
  const w = new World({ seed: 1 });
  w._realizeSpawn({ kind: "setpiece", name: "helicopter" });
  const h = w.helicopter;
  h.y = config.helicopter.hoverY;
  h.phase = HELI_PHASE.TRACKING;
  w._heliRicochetCd = 0; // ensure not throttled this tick
  const b = w.projectiles.spawn({
    x: h.x, y: h.y, vx: 0, vy: 0, category: "playerBullet", damage: 1, ttl: 5,
  });
  w.update(DT);
  assert.ok(w.audioEvents.some((a) => a.type === "ricochet"), "ricochet cue emitted");
  assert.equal(b.active, true, "bullet passes through (not consumed)");
  assert.equal(h.hp, config.helicopter.hp, "heli takes no damage from bullets");
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/effects_ricochet.test.js test/world_ricochet.test.js`
Expected: FAIL — `ricochetSpark` does not exist; the world emits no `"ricochet"` events yet.

- [ ] **Step 3: Add `ricochetInterval` config**

In `src/data/config.js`, in the `helicopter` block, add after the `cooldown` line (Task 4):

```js
    ricochetInterval: 0.12, // min seconds between heli bullet-ricochet cues (spec §4.6)
```

- [ ] **Step 4: Add the `ricochetSpark` particle variant**

In `src/render/effects.js`, add a method after `hitSpark` (~line 194):

```js
  /**
   * Ricochet spark (spec §4.6): a small, short-lived cool-white/grey burst shown
   * when a plain bullet bounces off armor (Enforcer) or the immune helicopter.
   * Smaller and cooler than hitSpark so it reads as "no damage". Deterministic.
   * @param {number} x impact center x.
   * @param {number} y impact center y.
   * @param {{range:(a:number,b:number)=>number, int:(a:number,b:number)=>number, next:()=>number}} rng
   */
  ricochetSpark(x, y, rng) {
    const count = rng.int(3, 5);
    for (let i = 0; i < count; i++) {
      const ang = rng.range(0, Math.PI * 2);
      const spd = rng.range(40, 120);
      this.spawn({
        x: x + rng.range(-2, 2),
        y: y + rng.range(-2, 2),
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        ttl: rng.range(0.1, 0.22),
        size: rng.range(1, 2.5),
        color: rng.next() < 0.5 ? palette.hudText : palette.hudDim,
        drag: 6,
      });
    }
  }
```

- [ ] **Step 5: Add the `ricochet` SFX one-shot**

In `src/audio/sfx.js`, in the constructor, after the low-cars-alarm fields (~line 73):

```js
    // Ricochet ping is rate-limited so a held trigger on armor doesn't spam.
    this._lastRicochetAt = -Infinity;
    this._ricochetMinInterval = 0.08;
```

Add a method after `lowCarsAlarm()` (~line 280):

```js
  /** Ricochet: a short, bright metallic ping off armor. Rate-limited. */
  ricochet() {
    const t = this._now();
    if (t - this._lastRicochetAt < this._ricochetMinInterval) return;
    this._lastRicochetAt = t;
    if (!this._live) return;
    this._blip({ type: "square", freq: 1200, endFreq: 700, dur: 0.05, gain: 0.06 });
  }
```

- [ ] **Step 6: Map the `"ricochet"` event in the bridge**

In `src/audio/bridge.js`, add to `EVENT_TO_SFX` (~line 16-22):

```js
const EVENT_TO_SFX = Object.freeze({
  gun: "machineGun",
  explosion: "explosion",
  civilianWarning: "civilianWarning",
  lowCars: "lowCarsAlarm",
  weaponLoad: "weaponLoad",
  ricochet: "ricochet",
});
```

- [ ] **Step 7: Wire the ricochet passes into the World**

In `src/core/world.js`:

(a) Extend the collision import (~line 33-37) to include `aabbOverlap`:

```js
import {
  collidePairs,
  resolveMissilesVsHelicopter,
  resolveBombBlast,
  aabbOverlap,
} from "../systems/collision.js";
```

(b) In the constructor, after `this._heliCooldown = 0;`:

```js
    /**
     * Throttle (seconds) between helicopter bullet-ricochet cues so a held
     * trigger under the immune heli doesn't emit a spark/cue every frame (§4.6).
     * @type {number}
     */
    this._heliRicochetCd = 0;
```

(c) In `update()`, alongside the other cooldown decrements:

```js
    if (this._heliRicochetCd > 0) {
      this._heliRicochetCd = Math.max(0, this._heliRicochetCd - dt);
    }
```

(d) In `_resolveCollisions`, in the player-bullets-vs-enemies `onHit` (~line 599-608), replace the `if (died) { ... } else { ... }` with a three-way branch:

```js
        if (died) {
          this.particles.explosion(enemy.x, enemy.y, this.rng);
          this._emitAudio("explosion"); // Phase 12: enemy-death blast SFX
          // AIDEV-NOTE: route the kill through Scoring so a kill that crosses the
          // bonus threshold can bank spare cars (Phase 10). scoreValue 0 (Enforcer)
          // is a no-op there.
          this.scoring.addKill(enemy.def.scoreValue);
        } else if (enemy.bulletproof && !isMissile) {
          // Plain bullet bounced off armor (Enforcer): ricochet cue (spec §4.6).
          // The bullet is still consumed (as before).
          this.particles.ricochetSpark(bullet.x, bullet.y, this.rng);
          this._emitAudio("ricochet");
        } else {
          this.particles.hitSpark(bullet.x, bullet.y, this.rng);
        }
```

(e) In `_resolveCollisions`, inside the `if (this.helicopter && !this.helicopter.dead) { ... }` block, AFTER the `for (const hit of heliHits)` loop (~line 694), add the bullet-ricochet pass:

```js
      // AIDEV-NOTE: spec §4.6 — plain bullets are immune-pass-through on the heli
      // (collision.js stays pure on that), but give the player feedback: a
      // throttled ricochet spark + cue when a non-missile bullet overlaps the
      // heli. The bullet is NOT consumed and does NO damage (preserves
      // test/heli-collision.test.js).
      if (this._heliRicochetCd <= 0) {
        for (const p of this.projectiles.toArray()) {
          if (p.active === false) continue;
          if (p.category === "playerMissile" || p.kind === "missile") continue;
          if (!aabbOverlap(p.bounds, this.helicopter.bounds)) continue;
          this.particles.ricochetSpark(p.x, p.y, this.rng);
          this._emitAudio("ricochet");
          this._heliRicochetCd = this.config.helicopter.ricochetInterval;
          break; // one cue per throttle window
        }
      }
```

(f) In `reset()`, after `this._heliCooldown = 0;`:

```js
    this._heliRicochetCd = 0;
```

- [ ] **Step 8: Update the SFX trigger-list tests**

In `test/sfx.test.js`, add `"ricochet"` to BOTH lists: the documented-triggers list (~line 57-68, add after `"lowCarsAlarm"`) and the no-op-when-not-live block (~line 73-86, add `sfx.ricochet();`).

- [ ] **Step 9: Update the bridge test (spy + mapping)**

In `test/audioBridge.test.js`, add `ricochet: rec("ricochet"),` to `makeSpySfx()` (~line 26, after `lowCarsAlarm`), then add a test at the end of the file:

```js
test("the bridge maps a 'ricochet' event to sfx.ricochet while playing", () => {
  const { bridge, sfx, world } = makeRig(); // use the file's existing rig helper
  world.pushAudio("ricochet");
  bridge.update(world, "playing");
  assert.ok(sfx.calls.some(([name]) => name === "ricochet"), "ricochet SFX fired");
});
```

> Use whatever rig/world-construction helper the rest of `test/audioBridge.test.js` already uses (it builds an `AudioBridge` over the fakes + a fake world with `pushAudio`). Mirror an existing event-mapping test in that file rather than introducing a new construction pattern.

- [ ] **Step 10: Run the ricochet-related tests**

Run: `node --test test/effects_ricochet.test.js test/world_ricochet.test.js test/sfx.test.js test/audioBridge.test.js test/heli-collision.test.js`
Expected: PASS (all). `test/heli-collision.test.js` still passes — the ricochet lives in the world pass, not in `collision.js`, so bullets still pass through `resolveMissilesVsHelicopter`.

- [ ] **Step 11: Run the full suite — only the two replay goldens may fail**

Run: `node --test`
Expected: PASS except `test/replay.test.js` + `test/replay_modes.test.js`. Confirm no third failure.

- [ ] **Step 12: Commit**

```bash
git add src/data/config.js src/render/effects.js src/audio/sfx.js src/audio/bridge.js src/core/world.js test/effects_ricochet.test.js test/world_ricochet.test.js test/sfx.test.js test/audioBridge.test.js
git commit -m "$(cat <<'EOF'
Add ricochet feedback on bulletproof / immune targets (spec §4.6)

Plain bullets on the Enforcer now show a cool ricochet spark + "ricochet" SFX
(still consumed); plain bullets on the immune helicopter show a throttled
ricochet cue but pass through (not consumed, no damage), preserving the
missile-only contract. Replay goldens remain red until re-record (next tasks).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Re-record the primary replay golden (`test/replay.test.js`)

All sim-affecting changes are now in. Re-record the whole-system golden from a
known-good run (exactly as commit `06c1f7d` did) and verify the run still
survives the window.

**Files:**
- Create (temp): `_record_replay.mjs` (repo root; deleted in this task)
- Modify: `test/replay.test.js` (the `GOLDEN` block)

- [ ] **Step 1: Write the recorder script**

Create `_record_replay.mjs` at the repo root (it MUST replicate `scriptedInput`,
`REPLAY_SEED`, and `REPLAY_TICKS` from `test/replay.test.js` verbatim):

```js
// TEMP recorder for test/replay.test.js — delete after use.
import { World } from "./src/core/world.js";
import { config } from "./src/data/config.js";

function scriptedInput(tick) {
  const input = { accel: true, fire: true };
  const phase = tick % 80;
  if (phase < 12) input.left = true;
  else if (phase >= 40 && phase < 52) input.right = true;
  return input;
}
const SEED = 4242;
const TICKS = 1800;

const world = new World({ seed: SEED });
const dt = config.FIXED_STEP;
for (let t = 0; t < TICKS; t++) {
  world.setInput(scriptedInput(t));
  world.update(dt);
}
const snap = {
  ticks: world.ticks,
  state: world.state,
  score: world.score,
  cars: world.cars,
  sector: world.sector,
  distance: world.distance,
  playerX: world.player.x,
  playerY: world.player.y,
  playerSpeed: world.player.speed,
  playerSurface: world.player.surface,
  playerDamage: world.player.damage,
  setpieceNames: world.setpieces.map((s) => s.name),
  rngCursor: world.rng.next(),
};
console.log(JSON.stringify(snap, null, 2));
```

- [ ] **Step 2: Run the recorder and capture the snapshot**

Run: `node _record_replay.mjs`
Expected: prints a JSON snapshot. **Verify `"state": "playing"`** — the re-tuned
run MUST still survive the full 30 s window. If `state` is `"gameover"`, STOP: the
balance is now too hard (it should be easier, not harder) — re-check the Task 2
values before recording. Do not record a dead golden.

- [ ] **Step 3: Paste the captured values into the GOLDEN block**

In `test/replay.test.js`, update each field in the `GOLDEN` object (~line 66-90)
to the printed values: `score`, `cars`, `sector`, `distance`, `playerX`,
`playerY`, `playerSpeed`, `playerSurface`, `playerDamage`, `setpieceNames`, and
`rngCursor`. Keep `ticks: 1800` and `state: "playing"`. Replace the stale Phase-13
re-record note (~line 69-77) with a one-line note:

```js
  // AIDEV-NOTE: re-recorded for the 2026-06 gameplay-fixes pass (concurrent cap,
  // gentler ramp, soft separation, heli wait-out/cooldown, guaranteed first
  // missiles, ricochet feedback). Every one of those shifts the seeded stream;
  // the run still survives the window. Re-record from _record_replay.mjs if an
  // intentional change shifts these again.
```

- [ ] **Step 4: Run the replay test**

Run: `node --test test/replay.test.js`
Expected: PASS (all 5 cases in the file, including the determinism + Game-orchestrator cases, which read the same GOLDEN).

- [ ] **Step 5: Delete the recorder**

```bash
rm _record_replay.mjs
```

- [ ] **Step 6: Commit**

```bash
git add test/replay.test.js
git commit -m "$(cat <<'EOF'
Re-record the primary replay golden for the gameplay-fixes pass

The cap/ramp/separation/heli/missile/ricochet changes shift the deterministic
stream; re-record the whole-system golden from a known-good run. The run still
survives the full 60 s window (state "playing").

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Re-record the mode-transition replay golden (`test/replay_modes.test.js`)

**Files:**
- Create (temp): `_record_replay_modes.mjs` (repo root; deleted in this task)
- Modify: `test/replay_modes.test.js` (the `GOLDEN` block; possibly `SEED`/`TICKS`)

- [ ] **Step 1: Write the recorder script**

Create `_record_replay_modes.mjs` at the repo root (replicates the straight-throttle
script, `SEED`, `TICKS`, and the ice/heli/boat latches from
`test/replay_modes.test.js`):

```js
// TEMP recorder for test/replay_modes.test.js — delete after use.
import { World } from "./src/core/world.js";
import { config } from "./src/data/config.js";

const SEED = 1;
const TICKS = 2700;
const scriptedInput = () => ({ accel: true, fire: true });

const world = new World({ seed: SEED });
const dt = config.FIXED_STEP;
const visited = { everIce: false, everHelicopter: false, everBoat: false };
for (let t = 0; t < TICKS; t++) {
  world.setInput(scriptedInput(t));
  world.update(dt);
  if (world.weather.isIce) visited.everIce = true;
  if (world.helicopter !== null) visited.everHelicopter = true;
  if (world.player.isBoat) visited.everBoat = true;
}
const snap = {
  ticks: world.ticks,
  state: world.state,
  score: world.score,
  cars: world.cars,
  sector: world.sector,
  distance: world.distance,
  playerX: world.player.x,
  playerY: world.player.y,
  playerSpeed: world.player.speed,
  playerMode: world.player.mode,
  playerSurface: world.player.surface,
  ...visited,
  rngCursor: world.rng.next(),
};
console.log(JSON.stringify(snap, null, 2));
```

- [ ] **Step 2: Run the recorder and verify the mode crossings**

Run: `node _record_replay_modes.mjs`
Expected: prints a JSON snapshot. **Verify ALL of:** `everIce`, `everHelicopter`,
`everBoat` are `true`, `state` is `"playing"`, and `playerMode` is `"boat"`.

If any crossing is now missing (e.g. `everHelicopter` is `false` because the
retune moved milestones, or the run no longer reaches the water stretch in 2700
ticks): bump `TICKS` to 3200 in BOTH the recorder and the test and re-run; if a
crossing is still missing, try a different `SEED` (e.g. 2, 3, 7) in both files
until one run crosses all three and ends afloat. This contingency is anticipated
in spec §5. Record the seed/ticks you settled on.

- [ ] **Step 3: Paste the captured values into the GOLDEN block**

In `test/replay_modes.test.js`, update the `GOLDEN` object (~line 42-60) to the
printed values, and update `SEED`/`TICKS` constants if you changed them in Step 2.
Keep the latch fields (`everIce/everHelicopter/everBoat`) as `true` and
`playerMode: "boat"`.

- [ ] **Step 4: Run the mode-replay test**

Run: `node --test test/replay_modes.test.js`
Expected: PASS (all 3 cases — the mode-crossing proof, the golden end-state, and
the bit-for-bit determinism case).

- [ ] **Step 5: Delete the recorder**

```bash
rm _record_replay_modes.mjs
```

- [ ] **Step 6: Commit**

```bash
git add test/replay_modes.test.js
git commit -m "$(cat <<'EOF'
Re-record the mode-transition replay golden for the gameplay-fixes pass

Re-record the second whole-system golden; verified the run still crosses ice, the
helicopter, and boat mode and ends afloat after the cap/ramp/separation/heli/
missile/ricochet changes.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Full-suite green + render confirmation + memory note

**Files:**
- (verify only) all
- Update: project memory if appropriate

- [ ] **Step 1: Run the ENTIRE suite — everything green now**

Run: `node --test`
Expected: PASS — all tests green (489 original + the new tests; both replay
goldens now re-recorded). Zero failures.

- [ ] **Step 2: Confirm the render smoke path explicitly**

Run: `node --test test/render_smoke.test.js`
Expected: PASS — the new enemy art (outline + glyphs) and heli recolor paint
without throwing. (No new `ctx` methods were introduced, so `makeFakeCtx` did not
need extending. If this fails with `ctx.<method> is not a function`, a glyph used
a new ctx call — extend `makeFakeCtx()` in this file with that method.)

- [ ] **Step 3: Sanity-check the git log for the branch**

Run: `git log --oneline main..HEAD`
Expected: the spec commit + the nine implementation/golden commits, all on
`gameplay-fixes`.

- [ ] **Step 4: Update project memory (difficulty/balance note)**

The retune supersedes the values recorded in
`/home/sean/.claude/projects/-home-sean-aix-spychaser/memory/difficulty-and-banking-balance.md`
and `special-weapons-wiring.md`. Update those memory files to reflect: the
concurrent cap (3→6) as the primary density lever, `rampDistance` now 34000,
`warmupDistance` 1600, heli `trackDuration` 16 / `cooldown` 40, and the
guaranteed-first-missiles + ricochet additions. (Memory edits only — no code.)

- [ ] **Step 5: Report completion**

Summarize for the user: the four reported issues + two fairness fixes are
implemented and tested; both replay goldens were re-recorded (planned); the
branch `gameplay-fixes` is ready for a playtest. Flag the two explicit feel-tunes
to confirm in play (spec §6): separation `push`/`margin` and the cap `end: 6`, plus
the missile-less heli wait-out (~11 bombs/encounter) — all one-line tunables.

---

## Self-Review (completed against the spec)

**Spec coverage:**
- §4.1 enemy identity → Task 1 (palette, outline, per-type colors+glyphs, heli recolor). ✓
- §4.2 difficulty cap + ramp → Task 2 (`maxConcurrentEnemies`, `spawnCap`, gate, all retuned tunables). ✓
- §4.3 separation + non-overlapping spawns → Task 3 (`separateEnemies`, wave lane-spread, spawn de-overlap). ✓
- §4.4 heli wait-out + break → Task 4 (`trackDuration`, `trackTimer`, `_heliCooldown`, guard, `leaveSpeed`). ✓
- §4.5 first missiles → Task 5 (`forceKind`, `_firstSpecialDelivered`). ✓
- §4.6 ricochet → Task 6 (`ricochetSpark`, `ricochet` SFX, bridge map, Enforcer + heli passes). ✓
- §5 testing: both replay goldens re-recorded (Tasks 7–8); director/heli/van/sfx/bridge tests updated; new unit tests for separation, cap, wave, wait-out, cooldown, first-missile, ricochet; render smoke confirmed (Task 9). ✓

**Determinism rules honored:** capped cadence ticks draw zero RNG (before `decideSpawn`); wave keeps a fixed `wavePack` RNG draw count; separation, spawn de-overlap, heli timers, and the first-missile load draw no RNG; ricochet RNG lives in the world pass and is throttled. All draw-count changes are functions of reproducible sim state → replay-stable after re-record.

**Type/name consistency:** `spawnCap`, `separateEnemies`, `ENEMY_COLORS`, `_clampEnemyToRoad`, `_deoverlapEnemyX`, `_heliCooldown`, `_firstSpecialDelivered`, `_heliRicochetCd`, `ricochetSpark`, `ricochet`, `forceKind` are referenced consistently across the tasks that define and use them.
