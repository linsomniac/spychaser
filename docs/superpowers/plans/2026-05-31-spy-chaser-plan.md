# Spy Chaser — Implementation Plan

> **For agentic workers:** This plan is executed **workflow-driven** (the `build-spy-chaser`
> workflow) per the user's explicit request — one capable subagent implements each phase
> test-first, an independent subagent verifies it, with a bounded fix loop. Phases are
> dependency-ordered and built sequentially on a shared tree. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build a browser-based, Spy Hunter-inspired top-down vehicular-combat arcade game that
runs entirely client-side with no backend.

**Architecture:** Vanilla-JS ES modules with a deterministic, canvas-decoupled fixed-timestep
simulation (seeded PRNG) and a thin Canvas 2D render layer; lightweight OOP entities with
plain-function systems (collision, spawn director, road, scoring, weapons, weather).

**Tech Stack:** Vanilla JavaScript (ES modules), HTML5 Canvas 2D, Web Audio API; tests via Node's
built-in `node --test` (zero dependencies); served statically via `python3 -m http.server`.

**Spec:** `docs/superpowers/specs/2026-05-31-spy-chaser-design.md`
**Date:** 2026-05-31
**Approach:** Incremental, phased. Pure-logic modules are built **test-first** (`node --test`,
zero deps). Rendering/entity/feel work is verified in-browser. Each phase ends with a concrete,
checkable **Definition of Done (DoD)**. Phases are ordered by dependency.

## Conventions

- **Run:** `python3 -m http.server` from repo root, open `http://localhost:8000`.
- **Test:** `node --test` from repo root (discovers `test/*.test.js`).
- **Determinism:** all randomness flows through `engine/rng.js` (seeded). Simulation is steppable
  without canvas/`raf`.
- **Format/lint:** match surrounding style; small focused modules; AIDEV- anchor comments on any
  tricky/important/bug-prone code.
- After each phase: tests green + manual browser check where applicable + commit.

---

## Phase 0 — Scaffold & engine harness

**Goal:** A served page running a fixed-timestep loop on a blank, DPR-correct canvas, with the
deterministic primitives tested.

- [ ] `index.html` (canvas + `<script type="module" src="src/main.js">`), `README.md` (run/test).
- [ ] `engine/rng.js` — mulberry32 + `int(max)`, `range(a,b)`, `pick(arr)`. **Test first.**
- [ ] `engine/pool.js` — generic object pool (acquire/release/forEachActive). **Test first.**
- [ ] `engine/loop.js` — accumulator fixed timestep (60 Hz), capped max delta; `update`/`render`
      callbacks; steppable for tests. **Test first** (N steps → N×dt simulated time, clamp works).
- [ ] `engine/canvas.js` — DPR scaling, resize, virtual(540×720)→screen letterbox transform.
- [ ] `engine/input.js` — keydown/up → input-state object; key map per spec §9 (incl. F **or**
      Shift = special).
- [ ] `data/config.js`, `data/palette.js` — tunables (spec §12) + colors (spec §7).
- [ ] `core/world.js` — minimal entity registry + scroll position (stub).
- [ ] `main.js` — bootstrap canvas + loop; clear to palette background each frame.

**DoD:** `node --test` passes (rng, pool, loop). Browser shows a stable, correctly-scaled blank
play-field; resizing keeps aspect/letterbox; loop runs at fixed step.

---

## Phase 1 — Procedural road & scrolling

**Goal:** Endless scrolling road with curves, variable width, shoulders, sectors.

- [ ] `systems/road.js` — seeded generation of segments (straight/curve, width, shoulder, water
      flag), sampled by scroll distance; sector counter. **Test first** (determinism for a seed;
      width/curve bounds; sector advances; water flag appears).
- [ ] Extend `core/world.js` — scroll advances by speed; exposes road sampling for render/collision.
- [ ] `render/renderer.js` — draw shoulders, road body, lane dashes with scroll offset and curve.

**DoD:** Browser shows an endless road that curves and varies width with green shoulders; road
generation tests pass and are deterministic.

---

## Phase 2 — Player car & driving

**Goal:** Controllable interceptor with arcade handling.

- [ ] `render/shapes.js` — reusable vector vehicle drawing (body, windshield, accents).
- [ ] `entities/player.js` — steering (lateral), accel/brake (speed + vertical position), bounds;
      off-road shoulder = slow + damage; leaving field = crash. Pure handling math **test-first**
      (accel curve, steer clamp, off-road speed penalty).
- [ ] Wire input → player; renderer draws player (Y-sorted hook ready).

**DoD:** Drive the blue car in-browser: steer, accelerate/brake, road keeps up; shoulder slows you;
handling unit tests pass.

---

## Phase 3 — Machine gun, projectiles & collision

**Goal:** Forward autofire and a tested collision system.

- [ ] `systems/collision.js` — AABB broad/narrow phase over world entities. **Test first**
      (overlap/no-overlap, edge-touch, category filtering).
- [ ] `entities/projectiles.js` — pooled bullets (spawn, travel, expire).
- [ ] `systems/weapons.js` — machine gun: fire cadence, spawn bullets (Space hold = autofire).
      Cadence logic **test-first**.
- [ ] `render/effects.js` — particle system (pooled): muzzle sparks, hit sparks.

**DoD:** Hold Space → bullets stream forward, expire off-screen; collision unit tests pass;
particles render.

---

## Phase 4 — Ground enemies & civilians

**Goal:** The core road combat cast.

- [ ] `entities/enemies.js` — Switchblade (pulls alongside, tire-slash), Enforcer (bulletproof,
      ram-only), Road Lord (returns fire), Barrel Dumper (spills rolling barrels). Per-enemy
      steering/attack logic; explosions on death.
- [ ] `entities/civilian.js` — grey civilian cars; pass-through traffic.
- [ ] Extend `projectiles.js` — enemy bullets + rolling barrels (pooled).
- [ ] Hook into `collision.js`: bullet↔enemy, player↔enemy (ram/crash), player↔barrel,
      bullet↔civilian (penalty marker), player↔civilian.
- [ ] Temporary debug spawner to exercise behaviors (replaced in Phase 5).

**DoD:** Each enemy type spawns and behaves per spec; can be shot/rammed appropriately; Enforcer
resists bullets; destroying a civilian is flagged for penalty; explosions show.

---

## Phase 5 — Spawn director & set-pieces

**Goal:** Deterministic escalating spawns and milestone set-pieces.

- [ ] `systems/director.js` — schedule enemy/civilian spawns by distance/score; queue set-pieces
      (weapons van, waves, helicopter, water, weather) at milestones; all seeded. **Test first**
      (same seed → same schedule; difficulty escalates with distance; set-piece spacing).
- [ ] Replace the Phase-4 debug spawner with the director.

**DoD:** Play produces escalating, varied traffic and scheduled set-piece triggers; director tests
pass and are deterministic.

---

## Phase 6 — Weapons van & special weapons

**Goal:** Pickup-driven special arsenal.

- [ ] `entities/weaponsVan.js` — van set-piece; driving into the rear ramp loads a random special.
- [ ] `systems/weapons.js` — add specials: front **missiles**, rear **oil slick**, rear
      **smoke screen**; consume on use (F or Shift). Effect/selection logic **test-first**.
- [ ] `entities/hazards.js` — deployed oil slick & smoke as field hazards that spin out / blind
      pursuers (collision hooks).

**DoD:** Van appears, ramp pickup loads a special shown in HUD slot; deploying missiles destroys
tough enemies, oil slick spins out followers, smoke disrupts them; weapon-effect tests pass.

---

## Phase 7 — Mad Bomber helicopter

**Goal:** Aerial threat requiring missiles.

- [ ] `entities/enemies.js` — helicopter: enters as set-piece, tracks overhead, drops bombs along
      the road; immune to guns, destroyed only by missiles.
- [ ] Bomb projectiles + blast collision; rotor handled in audio later.

**DoD:** Helicopter set-piece triggers; bombs threaten the player; missiles (and only missiles)
destroy it.

---

## Phase 8 — Water sections & boat mode

**Goal:** Boathouse transition to water gameplay.

- [ ] `systems/road.js` — water stretches with boathouse entry/exit markers.
- [ ] `entities/boat.js` + `entities/player.js` — switch player to boat behavior on water, back to
      car on return; water-appropriate handling.
- [ ] Renderer: water band + splash particles.

**DoD:** Reaching a water section transitions car→boat through the boathouse and back; boat handles
on water; transition is smooth.

---

## Phase 9 — Weather (fog & ice)

**Goal:** Environmental difficulty set-pieces.

- [ ] `systems/weather.js` — fog (reduced draw distance / vignette) and ice (reduced traction /
      slippery steer) modifiers; integrate with renderer and player handling. Traction math
      **test-first**.

**DoD:** Fog visibly reduces visibility; ice makes steering slip; both trigger as set-pieces and
clear afterward; traction tests pass.

---

## Phase 10 — Scoring, lives & the bonus-time mechanic

**Goal:** The authentic score/lives loop.

- [ ] `systems/scoring.js` — score events (kills, distance, no-civilian-harm bonus), bonus-time
      window with free replacements, score-threshold→bank spare cars, lives state machine, civilian
      penalty + bonus suspension. **Test first** (window expiry, threshold banking, civilian
      penalty, game-over at zero).
- [ ] `localStorage` high-score load/save.
- [ ] `render/hud.js` — score + hi-score, distance/sector, bonus-time bar, cars-left icons, loaded
      weapon box (per layout mockup).

**DoD:** Full scoring/lives loop works; bonus window banks spare cars on threshold; civilian harm
penalizes; HUD reflects all state; high score persists across reloads; scoring tests pass.

---

## Phase 11 — Game state machine & screens

**Goal:** Attract → play → pause → game over flow.

- [ ] `core/states.js` — ATTRACT/title, PLAYING, PAUSED, GAME_OVER transitions.
- [ ] `render/screens.js` — title/attract, pause overlay, game-over (with score/hi-score) overlays.
- [ ] `core/game.js` — orchestrate world + systems + states; restart resets cleanly.

**DoD:** Title screen → Enter starts; P/Esc pauses; running out of cars → game over → restart; no
state leaks between runs.

---

## Phase 12 — Audio (music + SFX)

**Goal:** Original chiptune + procedural SFX with mute.

- [ ] `audio/audio.js` — Web Audio context, master gain, mute (M), unlock-on-first-gesture.
- [ ] `audio/music.js` — original spy/driving chiptune loop (bass + arp + lead via a small step
      sequencer). Sequencer step math **test-first**.
- [ ] `audio/sfx.js` — speed-tracking engine, machine gun, explosions, weapon-load jingle,
      civilian-hit warning, low-cars alarm, helicopter rotor.

**DoD:** Music loops during play; SFX fire on the right events; M toggles mute; audio unlocks on
first interaction (no autoplay errors).

---

## Phase 13 — Polish, balance, regression test & docs

**Goal:** Make it feel right and lock it in.

- [ ] `test/replay.test.js` — fixed seed + recorded input sequence run for N ticks → asserts an
      expected end-state (deterministic regression guard).
- [ ] Playtest-tune `data/config.js` (speeds, spawn cadence, bonus window/threshold, difficulty
      ramp) for arcade feel.
- [ ] Visual polish: particle tuning, transitions, color balance.
- [ ] Finalize `README.md` (run, test, controls, architecture overview).

**DoD:** Replay smoke-test passes; full `node --test` green; game plays start→game-over with good
feel and all spec §6 mechanics present; README complete.

---

## Final Acceptance (whole project)

- All spec §6 mechanics implemented: player driving, machine gun, specials (missiles/oil/smoke),
  weapons van, Switchblade/Enforcer/Road Lord/Mad Bomber/Barrel Dumper, civilians, water/boat,
  fog/ice, scoring with bonus-time spare-car mechanic, set-pieces.
- Runs from `python3 -m http.server` with no backend and no build step.
- Modern flat-vector visuals (spec §7); chiptune + SFX with mute (spec §8); controls per §9.
- `node --test` green including the deterministic replay regression test.
