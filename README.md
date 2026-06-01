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

## Project layout

```
index.html              Canvas host + module bootstrap
src/
  main.js               Browser bootstrap: wires canvas, input, loop, world
  engine/
    rng.js              Deterministic mulberry32 PRNG (int/range/pick)
    pool.js             Generic object pool
    loop.js             Fixed-timestep accumulator loop (steppable, testable)
    canvas.js           DPR scaling, resize, 540x720 virtual letterbox
    input.js            Keyboard input mapping (see spec section 9)
  core/
    world.js            Simulation world (stub in Phase 0)
  audio/
    audio.js            Web Audio engine: context, master gain, mute, unlock
    music.js            Original chiptune step-sequencer (bass/arp/lead)
    sfx.js              Procedural sound effects (engine/gun/explosion/rotor/...)
    bridge.js           Couples the headless world's audio events to Music + Sfx
  data/
    config.js           Gameplay tunables
    palette.js          Flat-vector color palette
test/                   node --test unit tests for pure-logic modules
docs/                   Design spec and implementation plan
```
