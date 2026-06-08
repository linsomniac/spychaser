# Spy Chaser — Gameplay Fixes Design

- **Date:** 2026-06-07
- **Status:** Approved (design); pending implementation plan
- **Author:** Sean + Claude
- **Scope:** Readability, spawn-density, overlap, and helicopter-lifecycle fixes to the
  existing game. No new subsystems; this tunes and corrects behavior already built.

## 1. Background

A playtest of the current build surfaced four gameplay problems plus several related
fairness gaps found in a follow-up review:

1. Four enemy types render as only **two** looks — and the gameplay-critical
   "bulletproof" Enforcer is visually identical to the shootable Barrel Dumper
   (both purple) and the Switchblade/Road Lord pair (both pink-red).
2. Enemy cars **stack directly on top of each other** (2–4 in a column).
3. The game gets **too hard too fast** — the road is saturated within ~1 minute.
4. Helicopters feel **frequent / never let up**; the player cannot "wait one out."

A diagnostic review (5-agent sweep, recorded in the session) confirmed the root
causes and quantified them. Key correction to the original report: on `main` **two
helicopters cannot literally coexist** (the `!this.helicopter` guard at
`core/world.js:749` holds). What is real is that a helicopter **never leaves on its
own** (TRACKING has no exit except a missile kill) and there is **no enforced break**
before the next one.

### Determinism context (read before any change)

The simulation is fully deterministic from a seed + input sequence. Two replay
goldens depend on this: `test/replay.test.js` and `test/replay_modes.test.js`. Any
change that (a) alters the RNG draw **count/order** on the world RNG, or (b) alters
enemy **trajectories** (which feed collisions → scoring → player position), will shift
those goldens. **All of the changes below do one or both**, so re-recording both
replay goldens is an expected, planned step — exactly as commit `06c1f7d` did. The
render goldens added in `6547031` (canvas smoke + mode-transition golden) will also
need re-baselining because the enemy art changes.

The guiding rule for new logic: **keep RNG draw counts fixed** (don't make the number
of `rng.*` calls depend on runtime state), and prefer **pure-geometry** logic that
draws no RNG at all, so future seeds stay stable.

## 2. Goals / Non-goals

**Goals**

- Each enemy type is visually distinct and the must-ram Enforcer is unmistakable.
- Enemies never sit stacked on the same spot; the on-screen population is bounded.
- Difficulty ramps within the 60s bonus window but is readable, not a wall.
- A helicopter can be dispatched **or** waited out, and is always followed by a break.
- Two selected fairness fixes: guaranteed missiles before the first heli, and ricochet
  feedback on bulletproof/immune targets.

**Non-goals (deferred, explicitly out of scope this pass)**

- Pausing ground threats over water/boat sections.
- Civilian-autofire bonus-suspension forgiveness.
- Changing bomb blast geometry (kept as intended pressure — see §6.4).
- Any new enemy type, weapon, or set-piece.

## 3. Decisions (from brainstorming)

| Area | Decision |
|------|----------|
| Enemy identity | **B — color + silhouette/marking** per type |
| Difficulty | **Concurrent cap ~6, gentle ramp** |
| Overlap | **Soft separation** (no stacking; flanking allowed) |
| Helicopter | **Wait-out 16s, 40s enforced break** |
| Extra fixes | **Missiles before first heli** + **bulletproof ricochet cue** |

## 4. Detailed design

### 4.1 Enemy visual identity (option B)

Files: `src/data/palette.js`, `src/entities/enemies.js`, `src/render/shapes.js`.

- Add palette entries: `enemyArmed` (Road Lord, hot orange ~`#ff8c1a`),
  `enemyTruck` (Barrel Dumper, steel ~`#5a6472`), and `heliBody` (gunmetal, replaces
  the heli's reuse of `enemyHeavy`). Exact hues are tweakable.
- Remap `ENEMY_COLORS` 1:1:
  - `switchblade → palette.enemy` (pink-red), sleeker body (smaller corner radius).
  - `roadLord → palette.enemyArmed` (orange) + twin gun-port marks.
  - `enforcer → palette.enemyHeavy` (purple) + **white armor outline + chevron** +
    boxier radius. The armor cue is driven off `this.bulletproof`, not the type
    string, so any future bulletproof type inherits it.
  - `barrelDumper → palette.enemyTruck` (steel) + boxy truck profile + cargo-barrel
    mark.
- `drawVehicle` gains a generic **`outline`** style option (stroke around the body);
  the existing `stripe` and `radius` options are reused. Type-specific glyphs
  (chevron / gun ports / barrel) are drawn in `enemies.js` after the body via a small
  local-transform helper, keeping `shapes.js` free of game knowledge.
- Helicopter body recolored to `palette.heliBody`; its rotor disc already makes it
  shape-distinct.

Risk: pure visual. No sim/collision behavior changes. Render goldens re-baseline.

### 4.2 Difficulty pacing — concurrent cap + gentler ramp

Files: `src/data/config.js`, `src/systems/director.js`, `src/core/world.js`.

- **Concurrent-enemy cap (primary lever).** New
  `director.maxConcurrentEnemies: { start: 3, end: 6 }`. The world passes
  `liveEnemyCount: this.enemies.length` into `director.update(ctx)`. In `update()`,
  when the cadence fires, compute `cap = round(lerp(start, end, difficulty(distance)))`;
  if `liveEnemyCount >= cap`, **skip the whole spawn decision** — return before
  calling `decideSpawn`, so **no RNG is drawn** when capped. The spawn timer still
  resets, so the next attempt is one interval later. Cap counts **enemies only**
  (civilians are non-lethal). Deliberate simplification: at peak, civilians are also
  briefly suppressed during a capped tick; acceptable (road thins, stays calm).
- **Softer cadence:** `minInterval 0.65 → 1.0` (keep `maxInterval 2.4`);
  `rampDistance 30000 → 34000` ⇒ full difficulty ~50s at full throttle (680 px/s),
  just inside the 60s `bonusWindow`. Heli milestone at 20000 still lands ~29s — the
  `06c1f7d` goal is preserved.
- **Longer warmup:** `warmupDistance 700 → 1600` (~2.4s at full throttle, ~6s idle).
- **More early neutral traffic:** `civilianChanceStart 0.45 → 0.55`
  (`civilianChanceEnd 0.22` unchanged).
- **Spread hard types:** `enemyUnlock → [{0,1},{6000,2},{16000,3},{30000,4}]`.
- **Tame waves:** `enemyWave.spacing 11000 → 14000`; the realized burst is clamped to
  the remaining cap headroom (`min(wavePack, cap - liveEnemyCount)`), never blowing
  past the ceiling.

Determinism: capped ticks draw no RNG; under replay (fixed input) the live count is
reproducible, so this is deterministic going forward. Goldens re-record.

### 4.3 Enemy overlap — soft separation + non-overlapping spawns

Files: `src/data/config.js`, `src/entities/enemies.js` (or a `world` pass),
`src/core/world.js`, `src/systems/director.js`.

- **Lateral separation nudge (pure geometry, no RNG).** New
  `enemies.separation: { push: 80, marginX: 6, marginY: 8 }`. After the per-enemy
  steering/update each tick, run an O(n²) pass over active enemies (n ≤ cap+, trivial):
  for each pair whose vertical bands overlap
  (`|y_i − y_j| < (h_i+h_j)/2 + marginY`) and that are laterally close
  (`|x_i − x_j| < (w_i+w_j)/2 + marginX`), push each apart by `push·dt·0.5` along
  `sign(x_i − x_j)`. If `x_i == x_j`, break the tie deterministically by array index
  (lower index goes left). Clamp results to the on-road band. This prevents direct
  stacking while still allowing side-by-side flanking ("pack" feel).
- **enemyWave lane-spread.** Replace the N independent `pickLane` draws with: sample
  the road once at the wave row, split the usable band
  `[leftEdge+half, rightEdge−half]` into `count` equal slots, and place chaser k at
  slot-k center + a small seeded jitter (**one `rng.range` per chaser — same draw
  count as today**, only the resulting x changes). Cars start un-stacked; combined
  with separation they stay that way. Resolve the wave's road-sample row to match
  `decideSpawn` (`distance + VIRTUAL_HEIGHT`) for consistency.
- **Cadence-spawn de-overlap (deterministic, no extra RNG).** In `world._realizeSpawn`
  for an enemy, after computing x, if the new AABB at `spawnY` overlaps an active
  enemy in that y-band, shift x by a fixed step along the band
  (offsets `0, +d, −d, +2d, −2d, …`, `d = maxEnemyWidth/2 + marginX`, clamped to the
  band), taking the first clear slot. No RNG drawn, so the stream is untouched by this
  step.

Design intent reminder: overlap is a **soft** constraint (flanking OK); separation is a
nudge, not a hard collision.

### 4.4 Helicopter lifecycle — wait-out + enforced break

Files: `src/data/config.js`, `src/entities/enemies.js`, `src/core/world.js`.

- **Wait-out.** New `helicopter.trackDuration: 16`. `Helicopter` gets
  `this.trackTimer = 0` in the constructor; in the TRACKING branch of `update()`,
  `trackTimer += dt`, and when `trackTimer >= def.trackDuration`, set
  `phase = LEAVING` and return — **leaving it alive** (`dead` stays `false`). Because
  the world only scores the heli when `helicopter.dead` (missile kill), a waited-out
  heli correctly awards **zero** points. Missile kill behavior is unchanged (still
  scores 1000).
- **Enforced break.** New `helicopter.cooldown: 40` (seconds). Add `_heliCooldown` to
  the World constructor and `reset()` (init 0); decrement it each `update()` alongside
  `_specialCooldown`. Set `_heliCooldown = config.helicopter.cooldown` at the moment the
  heli is retired (`this.helicopter = null`). Change the spawn guard at
  `_realizeSpawn` to `ev.name === "helicopter" && !this.helicopter && this._heliCooldown <= 0`.
  A milestone that fires during the cooldown is dropped (matches the existing
  one-shot-guard semantics).
- **Decisive exit.** Raise `helicopter.leaveSpeed 220 → 300` so a departing heli clears
  the top quickly and never visually overlaps a future entry.
- **Harden the singleton.** Add an `AIDEV-NOTE` at the guard documenting the invariant:
  `helicopter` must remain a single field and realize must stay synchronous; if either
  changes, the guard must become a real concurrency check.

Determinism: all heli changes are timer-only (no RNG). `_heliCooldown` is added to
`reset()` so runs stay replay-stable.

### 4.5 Guaranteed missiles before the first helicopter

Files: `src/entities/weaponsVan.js`, `src/systems/weapons.js`, `src/data/config.js`,
`src/core/world.js`.

- The **first** special delivered in a run is always `missiles`; subsequent loads stay
  random. The world tracks `_firstSpecialDelivered` (init false, reset in `reset()`).
  On the first successful van delivery, load `missiles` **without** drawing the random
  kind (so the first load draws no kind RNG); set the flag.
- The first weapons-van milestone fires at distance 3000, well before the helicopter
  milestone at 20000, so a player who engages the van system at all has missiles in
  hand for the first heli. (We cannot force the player to tuck into the van; this
  guarantees the *availability*, not the pickup.)

Determinism: removes one kind-draw on the first load → goldens re-record.

### 4.6 Ricochet feedback on bulletproof / immune targets

Files: `src/render/effects.js`, `src/core/world.js`, `src/systems/collision.js`,
audio event tag in the bridge.

- Add a **ricochet spark** particle variant (small, cool-white/grey) and a `"ricochet"`
  audio-event tag.
- **Enforcer:** in the player-bullets-vs-enemies pass, when a non-missile bullet hits a
  `bulletproof` enemy (damage returns false), emit the ricochet spark + `"ricochet"`
  cue instead of the generic hit spark. The bullet is still consumed (as today).
- **Helicopter:** when a **non-missile** bullet overlaps the heli, emit a ricochet
  spark + cue but **do not consume** the bullet and **do not** damage the heli — this
  preserves the existing `test/heli-collision.test.js` contract (bullets pass through).
  Throttle the cue so a held trigger doesn't spam audio every frame.

Determinism: added particle/audio may draw world RNG (hit-spark style) → goldens
re-record. The `collision.js` heli function stays pure; ricochet emission lives in the
world pass.

## 5. Testing plan

**Re-recorded goldens (planned, not failures):**

- `test/replay.test.js` and `test/replay_modes.test.js` — re-record from a known-good
  run. The re-recorded run MUST still survive the 60s window (`state === "playing"`)
  and `replay_modes` must still cross ice/heli/boat transitions before committing.
- Render goldens from `6547031` (canvas smoke + mode-transition) — re-baseline for the
  new enemy art.

**New unit tests:**

- Separation: two enemies seeded on the same x in overlapping y-bands diverge to a
  non-overlapping gap within N ticks, with no RNG consumed.
- Concurrent cap: live enemy count never exceeds `cap(distance)`; a capped tick draws
  no RNG.
- enemyWave: a wave produces `count` **non-overlapping** x at spawn, clamped to cap
  headroom.
- Helicopter wait-out: TRACKING → LEAVING after `trackDuration`, `dead === false`,
  scores zero.
- Helicopter cooldown: after a heli retires, a `helicopter` milestone during the
  cooldown is a no-op; after the cooldown elapses it spawns.
- First-van load is `missiles`; the second is random again.
- Ricochet: non-missile bullet on Enforcer emits ricochet (still consumed); on the heli
  emits ricochet **and is not consumed / no damage**.

**Updated existing tests:**

- `test/director.test.js` — `unlockedEnemyCount` cases keyed to old distances
  (5000/14000/26000) → new (6000/16000/30000); any assertion of exact
  `0.65`/`30000` cadence values.
- Any `world_heli` / `helicopter` test whose horizon now exceeds `trackDuration` gets a
  config override so it still asserts the intended phase.

**Full suite:** `node --test` must pass (currently 482 tests + the new ones).

## 6. Risks & notes

1. **Golden churn is the main risk** — broad but mechanical. Re-record in one place,
   verify the re-recorded run still exercises the same milestones, commit goldens
   alongside the code change.
2. **Separation tuning** (`push`/`margin`) is a feel call; start at the values above and
   adjust after a playtest. Guard against jitter with the deadband and the index
   tiebreak.
3. **Cap feel** — `end: 6` on a 4-lane road. If it reads too sparse/dense after
   playtest, adjust `start`/`end` only (one-line tunable).
4. **Bomb geometry unchanged.** With `trackDuration: 16` the player faces ~11 bombs per
   un-missiled encounter; they remain dodgeable by strafing (player lateral 360 ≫ heli
   track 120). If a missile-less wait-out proves unfair in playtest, revisit
   `bomb.detonateY`/`blastRadius` (currently out of scope).
5. **Hue bikeshed** — `enemyArmed`/`enemyTruck`/`heliBody` values are provisional; quick
   to tweak in `palette.js` without touching logic.
