# Spy Chaser — Vehicle Overlap Resolution Design

- **Date:** 2026-06-10
- **Status:** Approved (design); pending implementation plan
- **Author:** Sean + Claude
- **Scope:** Replace the weak, enemy-only separation with a single cross-category
  overlap-resolution pass so vehicles stop overlapping, and make the player a
  "heavy" body that shoves cars aside (fixing the un-rammable Enforcer). Tuning +
  one new pure module; no new gameplay subsystems.
- **Supersedes:** the soft `separateEnemies` nudge from
  `2026-06-07-spy-chaser-gameplay-fixes-design.md` §4.3.

## 1. Background

A follow-up playtest of the shipped gameplay-fixes build showed the overlap
problem was only partly solved:

1. **Enemies still overlap each other.** The shipped `separateEnemies` push is
   `~0.67 px/tick` per car while steering pulls enemies toward the player's x at
   `1–2.5 px/tick`, so steering overwhelms separation and same-lane enemies
   re-stack. (Flagged as a feel-risk in the prior spec §6.2.)
2. **Enemies overlap the weapons van and civilians.** `separateEnemies` only
   iterates `this.enemies` — vans (`this.vans`) and civilians (`this.civilians`)
   were never in the pass, so enemies drive straight through both.
3. **The player passes through enemies.** The player↔enemy collision pass
   (`world._resolveCollisions`) applies ram *damage* on overlap but no
   *positional* response, and the player's x is purely input-driven. So the
   player and enemies freely occupy the same space, and the bulletproof Enforcer
   (which matches the player's x) is hard to "bump off the road" — you can't get
   solid directional contact, you just co-occupy a lane trading chip damage.

### Determinism context (read before any change)

The simulation is deterministic from seed + input. The two replay goldens
(`test/replay.test.js`, `test/replay_modes.test.js`) pin it. This change alters
vehicle **positions** (and thus downstream collisions → scoring → player
position), so **both goldens must be re-recorded** — the same planned, mechanical
step taken in commits `06c1f7d` and the prior gameplay-fixes pass. The new pass is
**pure geometry and draws no RNG**, so future seeds stay stable.

## 2. Goals / Non-goals

**Goals**

- No two vehicles visibly overlap: enemies vs enemies, vs the van, vs civilians.
- The player is a "heavy" body — it shoves enemies and civilians out of its lane
  on contact and is never itself blocked/trapped (steering stays crisp).
- The bulletproof Enforcer becomes reliably rammable: pressing into it shoves it
  toward the road edge while the existing mutual-ram grinds its ram-tolerance down.
- The weapons-van ramp still works (the player must be able to overlap the van to
  load a special).

**Non-goals (deferred, explicitly out of scope)**

- An explicit "shoved fully onto the shoulder ⇒ instant wreck" kill. The
  cornering-grind already makes the Enforcer killable via its existing `ramHp`;
  adding an off-road instakill is a separate feel change.
- Vertical (front/back) push. Resolution is lateral-only (x), matching the road's
  lane model; vertical spacing already emerges from differing `approachSpeed`s.
- Pausing ground threats over water (still deferred from the prior spec).
- Any new enemy type, weapon, or set-piece.

## 3. Decisions (from brainstorming)

| Area | Decision |
|------|----------|
| Player contact | **Heavy player** — immovable; shoves enemies/civilians aside |
| AI separation | **Hard de-penetration** — vehicles never overlap (resolved every tick) |
| Player ↔ van | **Not separated** (both immovable) — preserves ramp loading |
| Civilian bump | **No penalty** for a non-destructive bump (only *shooting* a civilian penalizes, unchanged) |
| Density | Trim concurrent cap **`end: 6 → 5`** so hard separation stays clean on narrow roads |
| Ordering | Resolve overlaps **after** the damage/ram pass, so ramming still registers |

## 4. Detailed design

### 4.1 The resolution pass — `src/systems/separation.js` (new, pure)

A new pure module owns the geometry, since the pass now spans every vehicle type
(it no longer belongs in `entities/enemies.js`).

```
resolveOverlaps(bodies, { marginX, marginY, immovable, clampX })
```

- `bodies`: array of vehicle entities, each exposing center `x, y` and `width,
  height` (player, vans, enemies, civilians — built by the World each tick).
- `immovable(body) => boolean`: true for the player and vans.
- `clampX(x, body) => number`: road-aware lateral clamp (keeps a pushed body on
  the asphalt).
- `marginX`, `marginY`: slack added to the overlap tests (reuse
  `config.enemies.separation.marginX/marginY`).

Algorithm — pairwise `O(n²)` over `bodies` (n is tiny: cap 5 enemies + a few
civilians + ≤1 van + player), **no RNG**:

For each pair `(a, b)` with `i < j`:
1. Vertical band: skip unless `|a.y − b.y| < (a.h + b.h)/2 + marginY`.
2. Penetration: `pen = (a.w + b.w)/2 + marginX − |a.x − b.x|`; skip if `pen ≤ 0`.
3. Direction: `dir = (a.x === b.x) ? −1 : sign(a.x − b.x)` (lower index goes left
   on an exact tie — fully deterministic).
4. Resolve by movability:
   - both immovable → **skip** (player↔van, van↔van: no-op — this is what keeps
     the ramp loadable);
   - `a` immovable, `b` movable → `b.x = clampX(b.x − dir·pen, b)` (push `b` fully
     out);
   - `b` immovable, `a` movable → `a.x = clampX(a.x + dir·pen, a)`;
   - both movable → `a.x = clampX(a.x + dir·pen/2, a)`,
     `b.x = clampX(b.x − dir·pen/2, b)` (split).

Resolving exactly `pen` settles the pair to a `marginX` lateral gap (just-apart),
so AI cars look cleanly separated. Lateral-only; `y` is never touched.

### 4.2 World wiring (`src/core/world.js`)

- Remove the existing `separateEnemies(this.enemies, …)` call (after the enemy
  update loop) and its import; import `resolveOverlaps`.
- After `_resolveCollisions()` **and** the dead/off-screen culling, build the body
  list and resolve:
  ```js
  const bodies = [this.player, ...this.vans, ...this.enemies, ...this.civilians];
  resolveOverlaps(bodies, {
    marginX: this.config.enemies.separation.marginX,
    marginY: this.config.enemies.separation.marginY,
    immovable: (b) => !!b.immovable,
    clampX: (x, b) => this._clampBodyToRoad(x, b),
  });
  ```
- Generalize `_clampEnemyToRoad(x, enemy)` → `_clampBodyToRoad(x, body)` (identical
  body — samples the road at the body's row and clamps to `[leftEdge+half,
  rightEdge−half]`; immovable bodies are never passed to it).

**Ordering is load-bearing.** Running resolution *after* the ram/damage pass means:
this tick the player↔Enforcer overlap is detected and the mutual ram (`ramHp`)
applies, *then* the Enforcer is shoved aside. Because the Enforcer chases the
player's x, it re-enters contact next tick → rammed again → shoved again → cornered
against the road edge until `ramHp` (3) depletes. Ram damage values are unchanged;
the shove just makes the contact controllable. (If resolution ran *before* the ram
pass, the cars would already be apart and the ram would never fire — the bug
inverts.)

### 4.3 Movability flags

- `src/entities/player.js`: set `this.immovable = true` in the constructor. (The
  boat is the same player entity and stays immovable.)
- `src/entities/weaponsVan.js`: set `this.immovable = true` in the constructor.
- Enemies and civilians carry no flag (treated as movable — `!!b.immovable` is
  false). The player is never moved by the pass; its x stays purely input-driven,
  so control feel is unchanged.

### 4.4 Density vs. road width (`src/data/config.js`)

Hard de-penetration means a too-full lane physically can't fit. The narrowest road
is `minWidth: 240`; at peak the cap could pack 6 cars (`~6 × 45 ≈ 270 px`) which
won't fit. Mitigations:

- Trim `director.maxConcurrentEnemies.end: 6 → 5` (keep `start: 3`). One-line
  tunable; `spawnCap` and the wave clamp read it symbolically.
- Genuine overflow clamps to the road band (`clampX`), so the worst case is a
  couple of cars kissing at the verge — far better than stacking.

The old soft `push` magnitude is no longer used (hard de-penetration has no push
*speed*): **remove `config.enemies.separation.push`**, keeping `marginX`/`marginY`.

### 4.5 Civilian bumps

The heavy player shoves civilians aside, but a non-destructive bump carries **no
penalty** and does **no damage** — only *shooting* a civilian still triggers the
penalty/bonus-suspension (unchanged `collidePairs(bullets, civilians, …)` pass).
The existing player↔civilian contact pass (which sets `touchingCivilian`, no
damage) is unchanged; the new resolution simply pushes the civilian out afterward.

### 4.6 Cleanup of the superseded pass

- Delete `separateEnemies` from `src/entities/enemies.js` (and its export). The
  cadence-spawn `_deoverlapEnemyX` and the `enemyWave` slot lane-spread are
  **kept** — they place fresh spawns cleanly (and the wave preserves its fixed
  `wavePack` RNG-draw-count contract); the per-tick `resolveOverlaps` handles the
  rest.

## 5. Testing plan

**New unit tests — `test/separation.test.js`** (pure `resolveOverlaps`):

- Two movable bodies overlapping split apart to a `marginX` gap; equal-x tie →
  lower index goes left.
- Immovable + movable: only the movable one moves, pushed fully out.
- Two immovable bodies (player + van) overlapping are left untouched (ramp-load
  invariant).
- A custom `clampX` is honored (pushed positions are clamped).
- The pass draws no RNG (function takes no rng; assert by signature + a contact
  scenario that mutates only x).

**Updated `test/world_overlap.test.js`:**

- Tighten the run-wide assertion: across a headless run, **no** hard overlap
  remains among any vehicle pair (enemies, civilians, van) after the pass.
- Player shoves an enemy: place an enemy on the player's x; after a tick the enemy
  is laterally displaced and no longer overlaps the player.
- Enemy bounces off the van: an enemy overlapping a van is pushed out; the van does
  not move.
- **Player↔van ramp preserved:** an enemy is pushed off the van, but the player
  positioned in the van's ramp still overlaps it (so van loading is unaffected) —
  guard against a regression that would break weapon pickups.
- **Ram still fires after the shove (integration):** with the player pressed into a
  bulletproof Enforcer that chases the player's x, over enough ticks the Enforcer's
  `ramHp` reaches 0 (it dies) — proving resolution-after-collision keeps ramming
  working.
- Keep the existing cap / wave-distinctness / fixed-RNG-draw-count tests (cap now
  reads `end: 5` symbolically).

**Replace `test/enemy_separation.test.js`** with `test/separation.test.js` (the
function moved modules; the old soft-nudge divergence test no longer applies).

**Re-recorded goldens (planned):** `test/replay.test.js` and
`test/replay_modes.test.js` re-recorded from known-good runs; the primary run must
still end `state: "playing"`, and the modes run must still cross ice + helicopter +
boat and end afloat (adjust seed/ticks only if a crossing is lost — same
contingency as last pass).

**Full suite:** `node --test` green (currently 517 tests + the new ones, minus the
removed soft-nudge test).

## 6. Risks & notes

1. **Golden churn** — broad but mechanical; re-record once after the code lands.
2. **Cap/road-width feel** — `end: 5` + edge-clamping is the safeguard; if peak
   density still reads too tight on `minWidth` roads, drop `end` to 4 (one line).
   If it reads too sparse, raise it back — but verify hard separation still fits.
3. **Ram cadence vs. shove** — `combat.ramInterval` (0.5 s) gates ram hits while the
   shove is per-tick; the player re-closes the `marginX` gap in one tick at
   `steerSpeed` 360, so a held press lands a ram every interval. If the Enforcer
   feels slippery to corner, lower `marginX` or raise `ramEnemyHp`.
4. **Immovable boat** — the player stays immovable in boat mode; intended (the boat
   shouldn't be shoved by traffic either).
5. **Two-immovable overlap is a deliberate no-op** — relied on for the van ramp. If
   a future change makes the van movable or adds a second immovable interactive
   body, revisit the skip rule.
