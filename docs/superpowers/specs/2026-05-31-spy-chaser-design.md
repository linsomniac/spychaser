# Spy Chaser — Design Specification

**Date:** 2026-05-31
**Status:** Approved (brainstorming complete; ready for implementation planning)

## 1. Concept

Spy Chaser is a top-down, vertically-scrolling vehicular-combat arcade game inspired by
*Spy Hunter* (1983). The player drives an interceptor up an endless road, gunning down or
ramming enemy vehicles, dodging hazards, collecting special weapons from a weapons van, and
chasing a high score — all while avoiding harm to civilian vehicles. Progression is endless
with scripted set-pieces at score/distance milestones.

The game runs **entirely in the browser with no backend** and aims for the "feel" of the
original arcade: tense, fast, score-driven, with the signature mechanics intact.

## 2. Goals & Non-Goals

### Goals
- Faithful recreation of the iconic *Spy Hunter* mechanics (see §6).
- Modern flat-vector graphics over retro arcade gameplay.
- Endless play with scripted set-pieces (weapons van, enemy waves, water, weather, helicopter).
- Original spy/driving chiptune music + procedural SFX, with a mute toggle.
- 100% client-side; runs from static files, no build step required to play.
- Deterministic, testable simulation core.

### Non-Goals
- No backend, accounts, networking, or online leaderboards (high score is local only).
- No use of the copyrighted "Peter Gunn" theme — music is original and merely evocative.
- No mobile/touch controls in v1 (optional stretch; see §11).
- No level editor, multiplayer, or save/continue of in-progress runs.

## 3. Platform & Tech

- **Language/runtime:** Vanilla JavaScript, ES modules. No framework.
- **Rendering:** HTML5 Canvas 2D.
- **Build:** None. Source is plain ES modules.
- **Serving:** Static files via any static server (e.g. `python3 -m http.server`). ES modules
  require HTTP(S) origin, so double-click-`file://` is not supported by design; a one-line
  static server is the documented way to run it.
- **Display:** Fixed **portrait virtual resolution** (target 540×720) representing the logical
  game world. Canvas is DPR-aware and scaled to fit the viewport with letterboxing; all game
  logic uses virtual coordinates so behavior is resolution-independent.
- **Persistence:** High score stored in `localStorage`.
- **Dependencies:** None at runtime. Tests use Node's built-in test runner (`node --test`),
  also zero dependencies.

## 4. Architecture

**Chosen model: Lightweight OOP entities + system functions.**

- Each entity is a small class exposing a common interface: `update(dt, world)`, `draw(ctx)`,
  and a `bounds` accessor for collision. Entities hold their own state and behavior.
- Cross-cutting concerns are plain functions operating over the `world`: collision resolution,
  the spawn director, road generation, scoring/lives, weapons, weather.
- This keeps each unit small, independently understandable, and testable. (ECS and a monolithic
  game object were considered and rejected as over- and under-engineered respectively for this
  scale.)

### Module layout

```
spychaser/
  index.html
  src/
    main.js                 # bootstrap: canvas, input, audio, start loop
    engine/
      loop.js               # fixed-timestep loop (accumulator), update/render split
      input.js              # keyboard state + key mapping
      canvas.js             # DPR scaling, resize, virtual->screen transform, letterbox
      rng.js                # seeded PRNG (mulberry32) + helpers
      pool.js               # generic object pool (bullets, particles)
    core/
      game.js               # top-level orchestrator; owns world + systems + state machine
      world.js              # entity registry, road state, scroll position, score/lives state
      states.js             # game state machine: ATTRACT, PLAYING, PAUSED, GAME_OVER
    systems/
      director.js           # schedules spawns + set-pieces by distance/score (seeded)
      collision.js          # AABB broad/narrow phase over world entities
      road.js               # procedural road: straights/curves, width, shoulders, water
      weapons.js            # machine gun + special weapons behavior/effects
      weather.js            # fog and ice modifiers
      scoring.js            # score, bonus-time window, spare-car banking, lives state machine
    entities/
      player.js             # interceptor (and boat-mode variant behavior)
      enemies.js            # Switchblade, Enforcer, Road Lord, Mad Bomber (heli), Barrel Dumper
      projectiles.js        # bullets, missiles, dropped bombs, rolling barrels
      hazards.js            # oil slick, smoke screen (deployed specials as field hazards)
      civilian.js           # civilian vehicles
      weaponsVan.js         # the weapons van set-piece + ramp pickup
      boat.js               # boat-mode transition handling for water sections
    render/
      renderer.js           # draws road, shoulders, scenery, entities (Y-sorted), particles
      hud.js                # score/hi-score, distance/sector, bonus bar, cars-left, weapon box
      effects.js            # particle system: explosions, splashes, sparks
      shapes.js             # reusable vector car/vehicle drawing helpers
      screens.js            # attract/title, pause, game-over overlays (canvas-drawn)
    audio/
      audio.js              # Web Audio context, master gain, mute, unlock-on-gesture
      music.js              # original chiptune sequencer (bass/arp/lead oscillators)
      sfx.js                # procedural sound effects
    data/
      config.js             # tunables: speeds, spawn rates, thresholds, scoring values
      palette.js            # flat-vector color palette
  test/
    *.test.js               # node --test for pure-logic modules
  README.md                 # how to run + how to test
```

## 5. Game Loop & Data Flow

- **Fixed-timestep simulation** at 60 Hz using an accumulator, with a capped maximum delta to
  avoid the "spiral of death". Simulation is decoupled from rendering and from
  `requestAnimationFrame` so it can be stepped headlessly in tests.
- **Input** is sampled each frame into an input-state object consumed by the simulation.
- **Determinism:** all randomness flows through the seeded PRNG (`rng.js`). Given the same seed
  and the same input sequence, a run is reproducible — this underpins testing and a replay
  smoke-test.
- **Per simulation tick:** advance scroll by current speed → run spawn director → update all
  entities → resolve collisions → update particles → update scoring/HUD state.
- **Per render frame:** clear → draw road + shoulders + scenery (with scroll offset) → draw
  entities sorted by Y → draw particles → draw HUD → draw active overlay (if any).
- **Memory:** bullets and particles use object pools to minimize GC churn.

## 6. Mechanics (Full Faithful Recreation)

### Player
- **Steering** left/right (lateral movement within and at the edges of the play area).
- **Accelerate/brake** (up/down) controls scroll speed and the car's vertical screen position.
- **Machine gun:** forward fire, unlimited ammo (hold to autofire).
- **Special weapon:** consumable, loaded from the weapons van; deployed with F or Shift.
- **Off-road:** driving onto the grass shoulder slows the car and causes damage; leaving the
  play area entirely is a crash.

### Road
- Procedural generation of straights and curves with variable width and grass shoulders.
- **Water sections:** entering via the boathouse switches the player to **boat mode** for the
  water stretch, then back to the car on return to road.
- Endless, with a **sector counter** that advances with distance.

### Weapons van
- Appears as a periodic set-piece. Driving into the rear ramp **loads a random special weapon**.

### Special-weapons arsenal
- **Missiles** (front): destroy tough enemies and the helicopter.
- **Oil slick** (rear): pursuing cars spin out.
- **Smoke screen** (rear): blinds/causes crashes in followers.

### Enemies
- **Switchblade:** car that pulls alongside and extends tire-slashing blades.
- **Enforcer:** bulletproof heavy car — must be rammed off the road or hit with a special.
- **Road Lord:** armed vehicle that shoots back.
- **Mad Bomber:** helicopter that flies overhead and drops bombs; destroyable only by missiles.
- **Barrel Dumper:** truck ahead that spills rolling barrels as hazards.

### Civilians
- Grey civilian cars that must NOT be destroyed. Destroying a civilian incurs a score penalty
  and suspends the bonus (mirrors the original's protect-the-innocent rule).

### Weather set-pieces
- **Fog:** reduced draw distance / visibility.
- **Ice:** reduced traction; steering becomes slippery.

### Scoring & lives — the classic mechanic
- The run starts with a **bonus-time window** during which wrecked cars are replaced for free.
- Crossing a **score threshold** (default 10,000) before the window expires **banks a set number
  of spare cars**.
- After the window ends, each wreck costs a car; the game ends at zero cars.
- **High score** persists in `localStorage`.

### Set-pieces / progression
- Endless road; scripted events fire at score/distance milestones: weapons van appearances,
  intensifying enemy waves, helicopter threat, water sections, and weather episodes. The spawn
  director schedules these deterministically from the seed.

## 7. Visual Style — Modern Flat Vector

- Flat colors, rounded shapes, soft drop shadows, restrained gradients.
- **Palette:** green shoulders, slate road, white lane dashes, blue player car, red/orange
  enemies, grey civilians, teal/yellow weapons van, blue water. Centralized in `data/palette.js`.
- Vehicles drawn as rounded-rect vector shapes with windshields and accent details via shared
  helpers in `render/shapes.js`.
- Explosions/effects as expanding circles and shards; smooth easing on UI transitions.
- **HUD:** score + hi-score (top-left), distance/sector (top-right), bonus-time bar, cars-left
  icons (bottom-left), loaded-weapon box (bottom-right).

## 8. Audio — Music + SFX

- **Web Audio API**, master gain node, **mute toggle (M)**. Audio context is unlocked on first
  user gesture (browser autoplay policy).
- **Music:** an original, looping spy/driving chiptune (bassline + arpeggio + lead) built from
  oscillators driven by a small step-sequencer. Evokes the original's energy without copying the
  copyrighted theme.
- **SFX (procedural):** speed-tracking engine hum, machine-gun fire, explosions, weapon-load
  jingle, civilian-hit warning, low-cars alarm, helicopter rotor.

## 9. Controls

| Action            | Keys                     |
|-------------------|--------------------------|
| Steer left/right  | ← / → or A / D           |
| Accelerate/brake  | ↑ / ↓ or W / S           |
| Fire machine gun  | Space (hold to autofire) |
| Special weapon    | **F or Shift**           |
| Pause             | P or Esc                 |
| Mute              | M                        |
| Start / confirm   | Enter                    |

## 10. Testing Strategy

- **Unit tests** via Node's built-in `node --test` (zero dependencies) for pure-logic modules:
  - collision math (`collision.js`)
  - road generation (`road.js`)
  - spawn-director scheduling and set-piece timing (`director.js`)
  - scoring / bonus-window / spare-car lives state machine (`scoring.js`)
  - special-weapon effects (`weapons.js`)
  - PRNG determinism (`rng.js`)
- Simulation is decoupled from canvas and `requestAnimationFrame`, allowing it to be stepped
  headlessly with a seeded RNG.
- **Replay smoke-test:** a fixed seed + recorded input sequence run for N ticks, asserting the
  simulation reaches an expected state without errors (regression guard).
- **Manual/visual verification** in-browser for feel, rendering, and audio.
- TDD is applied to the pure-logic modules: write the test first, then implement.

## 11. Open / Optional (v1 stretch)

- On-screen touch controls and/or mobile layout (out of scope for v1).
- Additional special weapons or enemy variants beyond the set in §6.
- Difficulty/accessibility options menu.

## 12. Tunable Defaults (initial; in `data/config.js`)

These are starting values to be tuned during playtest, centralized for easy iteration:

- Virtual resolution: 540×720.
- Simulation rate: 60 Hz; max delta clamp: 0.25 s.
- Bonus-time window: ~60 s; score threshold to bank spare cars: 10,000; spare cars banked: 3.
- Base scroll speed and top speed (low/high range), enemy spawn cadence, set-piece milestone
  spacing — all defined in config and tuned in playtest.
