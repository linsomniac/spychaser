# Spy Chaser

A top-down, Spy Hunter-style arcade chase game. Drive your weaponized car up an
endless road, dodge and destroy enemy vehicles, and rack up a high score.

Built with vanilla JavaScript (ES modules) and the Canvas 2D API. No
dependencies, no bundler, no build step.

## Run

The game is pure static files served as ES modules, so it needs to be served
over HTTP (opening `index.html` via `file://` will not work because browsers
block module loading from the filesystem).

Use any static file server from the project root, for example:

```sh
# Python 3 (no install needed on most systems)
python3 -m http.server 8080

# or Node's built-in (Node 18+ has no bundled server; use npx if you like)
npx --yes http-server -p 8080
```

Then open <http://localhost:8080/> in a modern browser.

## Test

The simulation/engine logic is decoupled from the DOM and Canvas so it can be
unit tested with Node's built-in test runner — no dependencies required.

```sh
node --test
# or
npm test
```

You can also syntax-check any single module without a browser:

```sh
node --check src/engine/loop.js
```

### Determinism & the replay regression guard

The whole simulation is a pure function of `(seed, input sequence)`: all
randomness flows through the seeded `mulberry32` PRNG in `engine/rng.js`, and the
sim advances on a fixed timestep with no reliance on wall-clock time. Given the
same seed and the same recorded inputs, a run reproduces bit-for-bit.

`test/replay.test.js` exploits this: it drives the real `World` headlessly with a
fixed seed and a scripted input sequence for 1800 ticks (30 simulated seconds)
and asserts the exact end-state (distance, score, cars, sector, player pose,
set-piece schedule) plus the PRNG cursor. It is the project's whole-system
regression net — any unintended change to RNG ordering, handling math, spawn
cadence, scoring, or set-piece scheduling trips it. (When a change is
intentional, re-record the golden snapshot from a known-good run; the file's
header comment explains how.)

## Controls

| Action          | Keys                                |
| --------------- | ----------------------------------- |
| Steer left      | Left Arrow / A                      |
| Steer right     | Right Arrow / D                     |
| Accelerate      | Up Arrow / W                        |
| Brake / reverse | Down Arrow / S                      |
| Fire weapon     | Space                               |
| Special weapon  | F **or** Shift                      |
| Pause           | P / Esc                             |
| Mute            | M                                   |
| Start / confirm | Enter                               |

## Audio

Original spy/driving chiptune music plus procedural SFX (engine hum, machine
gun, explosions, weapon-load jingle, civilian-hit warning, low-cars alarm,
helicopter rotor) via the Web Audio API. Audio is unlocked on the first user
gesture (browser autoplay policy) and `M` toggles mute. The music is original
and merely evocative — it is **not** the copyrighted "Peter Gunn" theme.

## Architecture overview

The codebase is split into a **deterministic, canvas-free simulation** and a thin
**render/audio layer** that reads from it but never mutates it.

- **Fixed-timestep loop** (`engine/loop.js`): an accumulator advances the sim in
  exact `1/60 s` steps with a capped max delta (no "spiral of death"). The loop
  is steppable so tests drive it directly without `requestAnimationFrame`.
- **The sim** (`core/world.js` + `systems/*` + `entities/*`): the single source
  of truth. `world.update(dt)` scrolls the road, runs the spawn director, updates
  entities, resolves collisions, ages particles, and advances scoring/weather.
  None of these modules import Canvas or `AudioContext` at module top level, so
  they run headlessly under `node --test`.
- **Entities** are small classes with a common `update(dt, world)` / `draw(ctx)`
  / `bounds` interface; **systems** are plain functions over the world (collision,
  director, road, weapons, scoring, weather). This keeps each unit small and
  independently testable (spec §4).
- **The orchestrator** (`core/game.js`) owns the world and the game-flow state
  machine (`core/states.js`: attract → playing → paused → game-over), gating
  whether the sim advances and threading input edges into transitions.
- **Render/audio** (`render/*`, `audio/*`) is the only browser-coupled layer.
  The renderer draws road → bullets → entities (Y-sorted) → particles → weather →
  HUD; the audio bridge drains a plain per-tick event queue the world emits, so
  the sim stays Web-Audio-free.
- **Determinism**: all randomness flows through `engine/rng.js`; see the replay
  guard above.

## Project layout

```
index.html              Canvas host + module bootstrap
src/
  main.js               Browser bootstrap: wires canvas, input, loop, world, audio
  engine/
    rng.js              Deterministic mulberry32 PRNG (int/range/pick)
    pool.js             Generic object pool (bullets, particles)
    loop.js             Fixed-timestep accumulator loop (steppable, testable)
    canvas.js           DPR scaling, resize, 540x720 virtual letterbox
    input.js            Keyboard input mapping (see spec section 9)
  core/
    game.js             Top-level orchestrator: world + state machine + input
    world.js            Simulation world (entities, road, scoring, scroll)
    states.js           Game-flow state machine (attract/playing/paused/over)
  systems/
    director.js         Seeded spawn director + set-piece scheduling
    collision.js        AABB broad/narrow-phase collision
    road.js             Procedural road (curves, width, shoulders, water)
    weapons.js          Machine gun + special weapons (missiles/oil/smoke)
    weather.js          Fog (visibility) + ice (traction) episodes
    scoring.js          Score, bonus-time window, spare-car lives machine
  entities/
    player.js           Interceptor handling (car + boat modes, ice steering)
    enemies.js          Switchblade/Enforcer/Road Lord/Barrel Dumper + helicopter
    civilian.js         Neutral pass-through traffic
    projectiles.js      Pooled bullets / enemy bullets / barrels
    hazards.js          Deployed oil slick + smoke screen field hazards
    weaponsVan.js       Weapons-van set-piece + ramp pickup
    boat.js             Boat-mode handling for water sections
  render/
    renderer.js         Scene draw (road, entities, particles, weather, HUD)
    hud.js              Score/hi-score, distance/sector, bonus bar, cars, weapon
    effects.js          Pooled particle system (muzzle/hit/explosion/splash)
    shapes.js           Reusable vector vehicle drawing helpers
    screens.js          Attract/title, pause, game-over overlays
  audio/
    audio.js            Web Audio engine: context, master gain, mute, unlock
    music.js            Original chiptune step-sequencer (bass/arp/lead)
    sfx.js              Procedural sound effects (engine/gun/explosion/rotor/...)
    bridge.js           Couples the headless world's audio events to Music + Sfx
  data/
    config.js           Gameplay tunables (playtest-tuned)
    palette.js          Flat-vector color palette
test/                   node --test unit + replay-regression tests
docs/                   Design spec and implementation plan
```
