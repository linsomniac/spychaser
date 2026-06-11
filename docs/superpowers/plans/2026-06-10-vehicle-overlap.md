# Vehicle Overlap Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the weak enemy-only separation with one pure cross-category overlap-resolution pass so vehicles never overlap, make the player/van immovable so the player shoves cars aside (fixing the un-rammable Enforcer), and trim the concurrent cap so hard separation fits the road.

**Architecture:** A new pure module `src/systems/separation.js` exposes `resolveOverlaps(bodies, opts)` — lateral hard de-penetration, no RNG. The World builds the vehicle list each tick (player, vans, enemies, civilians) and calls it **after** the damage/ram pass and culling, so ramming still registers before cars are pushed apart. Player and van carry an `immovable` flag.

**Tech Stack:** Vanilla JS (ES modules), Canvas 2D, Node's built-in test runner (`node --test`). No build step. Source spec: `docs/superpowers/specs/2026-06-10-vehicle-overlap-design.md`.

---

## ⚠️ Golden-test sequencing (read first)

The two whole-system replay goldens — `test/replay.test.js` and `test/replay_modes.test.js` — pin the entire deterministic stream. **Task 2 changes vehicle positions and the cap, so both goldens go RED the moment Task 2 lands, and stay red until re-recorded in Tasks 3–4.** This is the same planned, mechanical churn as the prior pass. Rules:

- Do NOT re-record them piecemeal or touch the golden files before Tasks 3–4.
- At each Task-2 commit, confirm **only those two files** fail; a third failure is a real regression.
- **Task 1 is a pure, unwired new module — the whole suite (including both goldens) must stay fully green.**

Baseline before starting: `git checkout vehicle-overlap` branch (spec already committed at `97e9114`). `node --test` is currently green (517 tests) on this branch.

---

## File Structure

| File | Responsibility | Tasks |
|------|----------------|-------|
| `src/systems/separation.js` | NEW — pure `resolveOverlaps(bodies, opts)` lateral de-penetration | 1 |
| `test/separation.test.js` | NEW — unit tests for `resolveOverlaps` | 1 |
| `src/entities/player.js` | `this.immovable = true` | 2 |
| `src/entities/weaponsVan.js` | `this.immovable = true` | 2 |
| `src/entities/enemies.js` | remove the superseded `separateEnemies` | 2 |
| `src/data/config.js` | cap `end: 6→5`; drop `separation.push`; comment updates | 2 |
| `src/core/world.js` | call `resolveOverlaps` after collisions+cull; drop `separateEnemies`; rename clamp helper | 2 |
| `test/world_overlap.test.js` | tighten run-wide overlap check + player-shove/van tests | 2 |
| `test/enemy_separation.test.js` | DELETE (function moved to the new module) | 2 |
| `test/replay.test.js`, `test/replay_modes.test.js` | re-recorded goldens | 3, 4 |

---

## Task 1: Pure `resolveOverlaps` module (stays fully green — not yet wired)

**Files:**
- Create: `src/systems/separation.js`
- Create: `test/separation.test.js`

- [ ] **Step 1: Write the failing unit tests**

Create `test/separation.test.js`:

```js
// test/separation.test.js
//
// Unified vehicle overlap resolution (spec 2026-06-10 §4.1). Pure geometry, NO
// RNG: lateral hard de-penetration with a movability model — movable bodies are
// pushed apart, an immovable body (player/van) pushes movable bodies fully out,
// and two immovable bodies are left untouched (the van-ramp invariant).
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveOverlaps } from "../src/systems/separation.js";

/** A minimal vehicle body. */
function body(x, y, width = 40, height = 60) {
  return { x, y, width, height };
}

const MX = 6, MY = 8;
const opts = (over = {}) => ({ marginX: MX, marginY: MY, ...over });

test("two overlapping movable bodies split apart to a marginX gap", () => {
  const a = body(100, 100);
  const b = body(100, 100); // exactly stacked
  resolveOverlaps([a, b], opts());
  // Gap between near edges == marginX.
  const gap = Math.abs(a.x - b.x) - (a.width + b.width) / 2;
  assert.ok(Math.abs(gap - MX) < 1e-9, `gap ${gap} != marginX ${MX}`);
  assert.ok(a.x < b.x, "lower index goes left on an exact tie");
});

test("an immovable body pushes a movable body fully out and does not move", () => {
  const player = body(100, 100);
  const enemy = body(100, 100);
  resolveOverlaps([player, enemy], opts({ immovable: (e) => e === player }));
  assert.equal(player.x, 100, "immovable body never moves");
  assert.ok(Math.abs(enemy.x - player.x) >= (player.width + enemy.width) / 2, "enemy pushed clear");
});

test("two immovable bodies overlapping are left untouched (ramp invariant)", () => {
  const player = body(100, 100);
  const van = body(100, 100, 64, 104);
  resolveOverlaps([player, van], opts({ immovable: () => true }));
  assert.equal(player.x, 100);
  assert.equal(van.x, 100);
});

test("a custom clampX is applied to pushed positions", () => {
  const a = body(100, 100);
  const b = body(100, 100);
  resolveOverlaps([a, b], opts({ clampX: () => 50 }));
  assert.equal(a.x, 50);
  assert.equal(b.x, 50);
});

test("bodies clear of each other in y are not separated", () => {
  const a = body(100, 0);
  const b = body(100, 500); // far apart vertically
  resolveOverlaps([a, b], opts());
  assert.equal(a.x, 100);
  assert.equal(b.x, 100);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/separation.test.js`
Expected: FAIL — `Cannot find module '../src/systems/separation.js'`.

- [ ] **Step 3: Implement the module**

Create `src/systems/separation.js`:

```js
// systems/separation.js
//
// Unified vehicle overlap resolution (spec 2026-06-10). One pure, RNG-free pass
// over ALL on-road vehicles (player, vans, enemies, civilians) that prevents them
// from overlapping. Lateral-only (x); vertical spacing comes from differing
// approachSpeeds. Replaces the old soft, enemy-only `separateEnemies` nudge.
//
// AIDEV-NOTE: movability model. Each body is "immovable" (player + weapons van)
// or movable (enemies, civilians). For an overlapping pair: two immovable bodies
// are left alone (this no-op is what keeps the player able to sit in the van's
// rear ramp to load a special); an immovable + movable pair pushes the movable
// one fully out; two movable bodies split the penetration. Resolving exactly the
// penetration settles a pair to a `marginX` lateral gap. The World runs this AFTER
// its damage/ram pass so a ram still registers before cars are shoved apart.

/**
 * Resolve lateral overlaps among vehicle bodies in place (mutates body.x).
 * @param {Array<{x:number,y:number,width:number,height:number}>} bodies
 * @param {object} [opts]
 * @param {number} [opts.marginX=0] lateral slack added to the overlap test / gap
 * @param {number} [opts.marginY=0] vertical slack for the band-overlap test
 * @param {(b:object)=>boolean} [opts.immovable] true => never pushed (player/van)
 * @param {(x:number, b:object)=>number} [opts.clampX] keep a pushed body on-road
 */
export function resolveOverlaps(bodies, opts = {}) {
  const marginX = opts.marginX ?? 0;
  const marginY = opts.marginY ?? 0;
  const immovable = opts.immovable ?? (() => false);
  const clampX = opts.clampX ?? ((x) => x);
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j];
      if (Math.abs(a.y - b.y) >= (a.height + b.height) / 2 + marginY) continue;
      const pen = (a.width + b.width) / 2 + marginX - Math.abs(a.x - b.x);
      if (pen <= 0) continue;
      const ai = immovable(a);
      const bi = immovable(b);
      if (ai && bi) continue;
      // Lower index (a) goes left on an exact tie — deterministic.
      const dir = a.x === b.x ? -1 : Math.sign(a.x - b.x);
      if (ai) {
        b.x = clampX(b.x - dir * pen, b);
      } else if (bi) {
        a.x = clampX(a.x + dir * pen, a);
      } else {
        a.x = clampX(a.x + dir * (pen / 2), a);
        b.x = clampX(b.x - dir * (pen / 2), b);
      }
    }
  }
}

export default resolveOverlaps;
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `node --test test/separation.test.js`
Expected: PASS (5/5).

- [ ] **Step 5: Run the FULL suite — must stay fully green**

Run: `node --test`
Expected: PASS — all existing tests + the 5 new ones green, **including both replay goldens** (this module is not wired into the sim yet).

- [ ] **Step 6: Commit**

```bash
git add src/systems/separation.js test/separation.test.js
git commit -m "$(cat <<'EOF'
Add pure resolveOverlaps vehicle de-penetration module

A pure, RNG-free lateral overlap-resolution pass with a movability model
(immovable player/van push movable enemies/civilians; two immovable bodies are a
no-op for the van ramp). Not wired into the sim yet — suite stays fully green.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Wire it in, make player/van immovable, trim the cap, remove the old pass

**Files:**
- Modify: `src/entities/player.js` (constructor, ~line 118)
- Modify: `src/entities/weaponsVan.js` (constructor, ~line 41)
- Modify: `src/entities/enemies.js` (remove `separateEnemies`, ~lines 60-89)
- Modify: `src/data/config.js` (`separation` ~line 221; `maxConcurrentEnemies` ~line 392)
- Modify: `src/core/world.js` (import ~line 31-37; separation call ~line 428-433; clamp helper ~line 785; add new call after cull ~line 504)
- Modify: `test/world_overlap.test.js`
- Delete: `test/enemy_separation.test.js`

> From here the two replay goldens are EXPECTED RED until Tasks 3–4. Confirm nothing else regresses.

- [ ] **Step 1: Write the failing world tests (replace the run-wide check, add shove/van tests)**

In `test/world_overlap.test.js`, **replace** the test `"a headless run never leaves enemies overlapping after the separation pass"` (the whole `test(...=> {...})` block) with the stronger version below, and **add** the three new tests after it. Also add the two imports at the top (after the existing `config` import):

```js
import { createEnemy } from "../src/entities/enemies.js";
import { createWeaponsVan } from "../src/entities/weaponsVan.js";
```

Replacement + additions:

```js
test("a headless run never leaves vehicles hard-overlapping (enemies/civilians/vans)", () => {
  const w = new World({ seed: 42 });
  let hardStacks = 0;
  for (let t = 0; t < 1500; t++) {
    w.setInput({ accel: true, fire: true });
    w.update(DT);
    // All movable + van bodies (exclude the player: its van-ramp overlap is intended).
    const all = [...w.enemies, ...w.civilians, ...w.vans];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j];
        const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
        // "Hard" overlap = deep penetration (well inside both bodies).
        if (dx < (a.width + b.width) / 4 && dy < (a.height + b.height) / 4) hardStacks++;
      }
    }
  }
  assert.equal(hardStacks, 0, `vehicles hard-overlapped ${hardStacks} times across the run`);
});

test("the player shoves an overlapping enemy aside AND the ram still fires", () => {
  const w = new World({ seed: 1 });
  const e = createEnemy("enforcer", w.player.x, { config: w.config });
  e.y = w.player.y; // overlap the player
  w.enemies.push(e);
  const ramHpBefore = e.ramHp;
  const playerXBefore = w.player.x;
  w.setInput({}); // no steering
  w.update(DT);
  // Ram fired this tick (resolution runs AFTER the damage pass).
  assert.equal(e.ramHp, ramHpBefore - 1, "ram hit landed before the shove");
  // Enemy was shoved clear; the player (immovable) did not move.
  assert.ok(
    Math.abs(e.x - w.player.x) >= (w.player.width + e.width) / 2,
    "enemy shoved out of the player's body",
  );
  assert.equal(w.player.x, playerXBefore, "heavy player is never pushed");
});

test("an enemy bounces off the immovable weapons van", () => {
  const w = new World({ seed: 1 });
  const van = createWeaponsVan(w.player.x, 0, { config: w.config });
  van.y = w.player.y - (van.height / 2 - van.def.rampHeight / 2); // ramp over the player
  w.vans.push(van);
  const e = createEnemy("switchblade", van.x, { config: w.config });
  e.y = van.y;
  w.enemies.push(e);
  const vanXBefore = van.x;
  w.update(DT);
  assert.equal(van.x, vanXBefore, "van is immovable");
  assert.ok(
    Math.abs(e.x - van.x) >= (e.width + van.width) / 2,
    "enemy pushed off the van",
  );
});

test("the player can still sit in the van ramp (overlap preserved for loading)", () => {
  const w = new World({ seed: 1 });
  const van = createWeaponsVan(w.player.x, 0, { config: w.config });
  van.y = w.player.y - (van.height / 2 - van.def.rampHeight / 2);
  w.vans.push(van);
  w.update(DT);
  const overlap =
    Math.abs(w.player.x - van.x) < (w.player.width + van.width) / 2 &&
    Math.abs(w.player.y - van.y) < (w.player.height + van.height) / 2;
  assert.ok(overlap, "player still overlaps the van after resolution (ramp loadable)");
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/world_overlap.test.js`
Expected: FAIL — `createEnemy`/`createWeaponsVan` import is fine, but the player passes through enemies (no shove), so "player shoves an overlapping enemy aside" fails (enemy still overlaps / player may even be pushed), and enemies pass through the van. (Some assertions may currently pass; at least the shove/van ones fail.)

- [ ] **Step 3: Make the player and van immovable**

In `src/entities/player.js`, in the constructor right after `this.x = this.config.VIRTUAL_WIDTH / 2;` (~line 118), add:

```js
    // AIDEV-NOTE: the player is a "heavy" body for overlap resolution (spec
    // 2026-06-10): it shoves enemies/civilians out of its lane and is never pushed
    // itself, so steering stays input-exact. systems/separation.js reads this.
    this.immovable = true;
```

In `src/entities/weaponsVan.js`, in the constructor right after `this.active = true;` (~line 41), add:

```js
    // AIDEV-NOTE: the van is immovable for overlap resolution — enemies bounce off
    // it, but the player can still overlap its rear ramp to load (two immovable
    // bodies are a no-op in systems/separation.js).
    this.immovable = true;
```

- [ ] **Step 4: Trim the cap and drop the dead `push` tunable (config)**

In `src/data/config.js`:

(a) Replace the `separation` line + its AIDEV-NOTE (~line 216-221) with:

```js
    // AIDEV-NOTE: overlap-resolution margins (spec 2026-06-10). systems/separation.js
    // runs a pure, RNG-free HARD lateral de-penetration over all vehicles each tick;
    // a resolved pair settles to a `marginX` gap, with `marginY` slack on the
    // vertical band test. (The old soft `push` speed is gone — de-penetration has no
    // push rate.)
    separation: Object.freeze({ marginX: 6, marginY: 8 }),
```

(b) Change the cap end from 6 to 5 (~line 392):

```js
    maxConcurrentEnemies: Object.freeze({ start: 3, end: 5 }), // end 6->5: hard de-penetration must fit the narrowest road (spec 2026-06-10)
```

- [ ] **Step 5: Remove the superseded `separateEnemies` from `enemies.js`**

First confirm the only references are the world call (being replaced) and the deleted test:

Run: `grep -rn "separateEnemies" src/ test/`
Expected: `src/entities/enemies.js` (definition + export), `src/core/world.js` (import + call), `test/enemy_separation.test.js`.

In `src/entities/enemies.js`, delete the entire `separateEnemies` function and its doc comment (the block from `/**` … `export function separateEnemies(enemies, dt, opts = {}) { … }`, ~lines 60-89). Leave the `approach` helper above it and the `Enemy` class below it intact.

- [ ] **Step 6: Wire `resolveOverlaps` into the World (and drop the old pass)**

In `src/core/world.js`:

(a) Update the enemies import (~lines 31-37) — drop `separateEnemies`, keep `ENEMY_TYPES`:

```js
import {
  createEnemy,
  Bomb,
  HELI_PHASE,
  ENEMY_TYPES,
} from "../entities/enemies.js";
```

(b) Add the new module import near the other systems imports (next to the `Director` import line):

```js
import { resolveOverlaps } from "../systems/separation.js";
```

(c) Remove the old separation call (~lines 428-433) — delete this block entirely:

```js
    // Soft separation (spec §4.3): nudge overlapping enemies apart (pure geometry,
    // no RNG), clamped to the road at each enemy's row.
    separateEnemies(this.enemies, dt, {
      config: this.config,
      clampX: (x, e) => this._clampEnemyToRoad(x, e),
    });
```

(d) Add the unified resolution AFTER the cull + heli-retire block. Insert it right after the heli-retire `if (...) { this.helicopter = null; this._heliCooldown = ...; }` block (~after line 504) and before the `// --- Persist the high score ...` comment:

```js
    // --- Vehicle overlap resolution (spec 2026-06-10). One pure, RNG-free pass
    // over ALL vehicles AFTER the damage/ram pass + culling, so a ram registers
    // before cars are shoved apart. The player + vans are immovable (heavy); they
    // push movable enemies/civilians out and are never pushed themselves. ---
    resolveOverlaps([this.player, ...this.vans, ...this.enemies, ...this.civilians], {
      marginX: this.config.enemies.separation.marginX,
      marginY: this.config.enemies.separation.marginY,
      immovable: (b) => !!b.immovable,
      clampX: (x, b) => this._clampBodyToRoad(x, b),
    });
```

(e) Rename the clamp helper `_clampEnemyToRoad` → `_clampBodyToRoad` (~line 785) and generalize its doc:

```js
  /**
   * Clamp a vehicle body's x to the road body at its current screen row (used by
   * the overlap-resolution pass so a push never leaves the asphalt). Pure.
   * @param {number} x
   * @param {{y:number, width:number}} body
   * @returns {number}
   * @private
   */
  _clampBodyToRoad(x, body) {
    const worldDist = this.distance + (this.height - body.y);
    const s = this.road.sampleAt(worldDist);
    const half = body.width / 2;
    const lo = s.leftEdge + half;
    const hi = s.rightEdge - half;
    if (hi <= lo) return s.centerX;
    return x < lo ? lo : x > hi ? hi : x;
  }
```

(The `_deoverlapEnemyX` spawn helper and the `enemyWave` lane-spread are unchanged.)

- [ ] **Step 7: Delete the superseded test file**

```bash
git rm test/enemy_separation.test.js
```

- [ ] **Step 8: Run the overlap + special tests**

Run: `node --test test/world_overlap.test.js test/world_specials.test.js test/world_first_missile.test.js`
Expected: PASS — the shove/van/ramp tests pass; the van-ramp loading tests in `world_specials`/`world_first_missile` still pass (player↔van overlap preserved).

- [ ] **Step 9: Run the full suite — only the two replay goldens may fail**

Run: `node --test`
Expected: PASS for everything EXCEPT `test/replay.test.js` and `test/replay_modes.test.js` (expected red — positions + cap shifted the seeded stream). Confirm there is **no third failure** (in particular `director_cap.test.js`, which reads `end` symbolically, must still pass). Do NOT touch the golden files.

- [ ] **Step 10: Commit**

```bash
git add src/entities/player.js src/entities/weaponsVan.js src/entities/enemies.js src/data/config.js src/core/world.js test/world_overlap.test.js
git rm test/enemy_separation.test.js
git commit -m "$(cat <<'EOF'
Resolve all vehicle overlaps; heavy player shoves cars aside

Wire the pure resolveOverlaps pass into the World (after the damage/ram pass +
cull) over player+vans+enemies+civilians; the player and van are immovable so
they push movable cars out and the player can still sit in the van ramp. Removes
the superseded soft enemy-only separateEnemies, trims the concurrent cap 6->5 so
hard de-penetration fits the narrowest road, and drops the dead separation.push.

The two whole-system replay goldens are intentionally left red here; re-recorded
in the next tasks.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Re-record the primary replay golden (`test/replay.test.js`)

**Files:**
- Create (temp): `_record_replay.mjs` (repo root; deleted in this task)
- Modify: `test/replay.test.js` (the `GOLDEN` block)

- [ ] **Step 1: Write the recorder**

Create `_record_replay.mjs` at the repo root (it MUST replicate `scriptedInput`, `REPLAY_SEED` (4242), and `REPLAY_TICKS` (1800) from `test/replay.test.js` — open that file and confirm before running):

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
const world = new World({ seed: 4242 });
const dt = config.FIXED_STEP;
for (let t = 0; t < 1800; t++) {
  world.setInput(scriptedInput(t));
  world.update(dt);
}
console.log(JSON.stringify({
  ticks: world.ticks, state: world.state, score: world.score, cars: world.cars,
  sector: world.sector, distance: world.distance, playerX: world.player.x,
  playerY: world.player.y, playerSpeed: world.player.speed,
  playerSurface: world.player.surface, playerDamage: world.player.damage,
  setpieceNames: world.setpieces.map((s) => s.name), rngCursor: world.rng.next(),
}, null, 2));
```

- [ ] **Step 2: Run it and verify survival**

Run: `node _record_replay.mjs`
**Verify `"state": "playing"`.** The run must still survive the window (this change does not make the game harder for the scripted run). If `state` is `"gameover"`, STOP and report — do not record a dead golden.

- [ ] **Step 3: Paste the values into the GOLDEN block**

In `test/replay.test.js`, update the `GOLDEN` fields (`score`, `cars`, `sector`, `distance`, `playerX`, `playerY`, `playerSpeed`, `playerSurface`, `playerDamage`, `setpieceNames`, `rngCursor`) to the printed values (full-precision floats). Keep `ticks: 1800` and `state: "playing"`. Update the AIDEV-NOTE inside the block to reference the 2026-06-10 vehicle-overlap pass instead of the previous one:

```js
  // AIDEV-NOTE: re-recorded for the 2026-06-10 vehicle-overlap pass (hard
  // de-penetration over all vehicles + heavy player + cap end 6->5). Positions and
  // the cap shifted the seeded stream; the run still survives the window. To
  // re-record after an intentional change: run this seed + scriptedInput for
  // REPLAY_TICKS in a tiny headless script (same body as runReplay) and print
  // snapshot(world). The re-recorded run MUST still end state "playing".
```

- [ ] **Step 4: Run the replay test**

Run: `node --test test/replay.test.js`
Expected: PASS (all 5 cases).

- [ ] **Step 5: Delete the recorder**

```bash
rm _record_replay.mjs
```

- [ ] **Step 6: Full suite — only replay_modes should remain red**

Run: `node --test`
Expected: PASS except `test/replay_modes.test.js` (1 test, re-recorded next). Confirm `test/replay.test.js` is green and no other failure.

- [ ] **Step 7: Commit**

```bash
git add test/replay.test.js
git commit -m "$(cat <<'EOF'
Re-record the primary replay golden for the vehicle-overlap pass

Hard de-penetration + heavy player + cap end 6->5 shift the deterministic stream;
re-record from a known-good run. The run still survives the full window.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Re-record the mode-transition replay golden (`test/replay_modes.test.js`)

**Files:**
- Create (temp): `_record_replay_modes.mjs` (repo root; deleted in this task)
- Modify: `test/replay_modes.test.js` (the `GOLDEN` block; possibly `SEED`/`TICKS`)

- [ ] **Step 1: Write the recorder**

Open `test/replay_modes.test.js` and note its current `SEED`, `TICKS`, and `scriptedInput` (straight throttle). Create `_record_replay_modes.mjs` at the repo root replicating them and latching the three crossings:

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
console.log(JSON.stringify({
  ticks: world.ticks, state: world.state, score: world.score, cars: world.cars,
  sector: world.sector, distance: world.distance, playerX: world.player.x,
  playerY: world.player.y, playerSpeed: world.player.speed,
  playerMode: world.player.mode, playerSurface: world.player.surface,
  ...visited, rngCursor: world.rng.next(),
}, null, 2));
```

- [ ] **Step 2: Run it and VERIFY the mode crossings**

Run: `node _record_replay_modes.mjs`
**Verify ALL of:** `everIce`, `everHelicopter`, `everBoat` are `true`, `state` is `"playing"`, `playerMode` is `"boat"`.

**Contingency if any is missing:** bump `TICKS` to 3200 in the recorder and re-run; if a crossing is still missing, try `SEED` 2, 3, 5, 7, 11 until one run satisfies all five conditions. Record the final SEED/TICKS you settle on. Do NOT weaken the test's mode-crossing assertions to force a pass.

- [ ] **Step 3: Update the test (constants if changed + GOLDEN)**

In `test/replay_modes.test.js`: update `SEED`/`TICKS` if you changed them; update the `GOLDEN` fields (`ticks`, `score`, `cars`, `sector`, `distance`, `playerX`, `playerY`, `playerSpeed`, `playerMode`, `playerSurface`, `rngCursor`) to the printed values; keep `state: "playing"`, `everIce/everHelicopter/everBoat: true`, `playerMode: "boat"`. Update any stale dated comment about which tick each mode is reached.

- [ ] **Step 4: Run the modes test**

Run: `node --test test/replay_modes.test.js`
Expected: PASS (all 3 cases).

- [ ] **Step 5: Delete the recorder**

```bash
rm _record_replay_modes.mjs
```

- [ ] **Step 6: Full suite — everything green**

Run: `node --test`
Expected: PASS — 0 failures.

- [ ] **Step 7: Commit**

```bash
git add test/replay_modes.test.js
git commit -m "$(cat <<'EOF'
Re-record the mode-transition replay golden for the vehicle-overlap pass

Re-record the second whole-system golden; verified the run still crosses ice, the
helicopter, and boat mode and ends afloat after the overlap-resolution changes.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Full-suite green + render confirm + wrap

**Files:** (verify only)

- [ ] **Step 1: Whole suite green**

Run: `node --test`
Expected: PASS — all tests green (was 517; now minus the deleted `enemy_separation.test.js`, plus `separation.test.js` (5) and the new world-overlap tests). Zero failures.

- [ ] **Step 2: Confirm the render path**

Run: `node --test test/render_smoke.test.js`
Expected: PASS — this change is positional only (no new draw calls), so the render smoke path is unaffected.

- [ ] **Step 3: Branch log sanity**

Run: `git log --oneline main..HEAD`
Expected: the spec commit + the five implementation/golden commits on `vehicle-overlap`.

- [ ] **Step 4: Report completion**

Summarize: enemies no longer overlap each other, the van, or civilians; the player is heavy and shoves cars aside, making the Enforcer rammable; both goldens re-recorded. Branch `vehicle-overlap` ready for a playtest. Flag the one-line tunables to confirm in play: cap `end: 5` density, and `separation.marginX` (gap firmness / how grabby the Enforcer corner feels).

---

## Self-Review (completed against the spec)

**Spec coverage:**
- §4.1 `resolveOverlaps` pure module + movability rules → Task 1. ✓
- §4.2 world wiring after the damage pass + cull; clamp helper rename → Task 2 (steps 6). ✓
- §4.3 immovable flags on player + van → Task 2 (step 3). ✓
- §4.4 cap `end: 6→5`; remove `push` → Task 2 (step 4). ✓
- §4.5 civilian bump no penalty → no code change needed (the bullet-vs-civilian penalty pass is untouched; the new pass only repositions). Confirmed by leaving `_resolveCollisions` civilian handling unchanged. ✓
- §4.6 remove `separateEnemies`, keep `_deoverlapEnemyX` + wave lane-spread → Task 2 (step 5). ✓
- §5 tests: pure unit tests (Task 1), world shove/van/ramp + run-wide overlap (Task 2), delete `enemy_separation.test.js` (Task 2), re-record both goldens (Tasks 3–4), full suite (Task 5). ✓

**Determinism:** `resolveOverlaps` draws no RNG; it runs after the damage/ram pass so ramming still registers; positions/cap shift the goldens (re-recorded). Replay-stable going forward.

**Type/name consistency:** `resolveOverlaps`, `immovable`, `_clampBodyToRoad`, `config.enemies.separation.{marginX,marginY}`, `maxConcurrentEnemies.end` referenced consistently across tasks. `_clampEnemyToRoad` is renamed in exactly one place (its only caller was the deleted `separateEnemies` block).
