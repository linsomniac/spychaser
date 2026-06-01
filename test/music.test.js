// test/music.test.js
//
// Pure step-sequencer math for the original chiptune (Phase 12). These tests
// drive the canvas/AudioContext-FREE logic in audio/music.js: step timing,
// loop wrap, note->frequency conversion, and the pattern lookups that the
// browser scheduler later turns into oscillator events. NO AudioContext here.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Sequencer,
  midiToFreq,
  noteToMidi,
  SONG,
  patternStep,
  stepDuration,
} from "../src/audio/music.js";

// --- Note / frequency math --------------------------------------------------

test("midiToFreq: A4 (MIDI 69) is 440 Hz", () => {
  assert.ok(Math.abs(midiToFreq(69) - 440) < 1e-9);
});

test("midiToFreq: an octave up doubles the frequency", () => {
  assert.ok(Math.abs(midiToFreq(81) - 880) < 1e-9);
});

test("midiToFreq: a semitone is the 12th root of two ratio", () => {
  const ratio = midiToFreq(70) / midiToFreq(69);
  assert.ok(Math.abs(ratio - Math.pow(2, 1 / 12)) < 1e-12);
});

test("noteToMidi: scientific-pitch names map to MIDI numbers", () => {
  assert.equal(noteToMidi("A4"), 69);
  assert.equal(noteToMidi("C4"), 60); // middle C
  assert.equal(noteToMidi("C0"), 12);
  assert.equal(noteToMidi("A#4"), 70);
  assert.equal(noteToMidi("Eb4"), 63); // flat == sharp of the prior note
});

test("noteToMidi: rests / nulls are not notes", () => {
  assert.equal(noteToMidi(null), null);
  assert.equal(noteToMidi("."), null);
});

// --- Step timing ------------------------------------------------------------

test("stepDuration: 120 BPM 16th-notes => 0.125 s per step", () => {
  // 120 BPM => 0.5 s per beat (quarter). A 16th is a quarter / 4 = 0.125 s.
  assert.ok(Math.abs(stepDuration(120, 4) - 0.125) < 1e-12);
});

test("stepDuration: 8th-note grid at 120 BPM => 0.25 s per step", () => {
  assert.ok(Math.abs(stepDuration(120, 2) - 0.25) < 1e-12);
});

// --- Sequencer step indexing ------------------------------------------------

test("Sequencer: stepIndexAt advances one step per stepDuration", () => {
  const seq = new Sequencer({ bpm: 120, stepsPerBeat: 4, steps: 16 });
  const sd = seq.stepDuration; // 0.125 s
  assert.equal(seq.stepIndexAt(0), 0);
  assert.equal(seq.stepIndexAt(sd * 0.5), 0); // still inside step 0
  assert.equal(seq.stepIndexAt(sd * 1.0), 1);
  assert.equal(seq.stepIndexAt(sd * 3.5), 3);
});

test("Sequencer: stepIndexAt wraps modulo the loop length", () => {
  const seq = new Sequencer({ bpm: 120, stepsPerBeat: 4, steps: 16 });
  const sd = seq.stepDuration;
  // Step 16 wraps back to 0; step 17 -> 1.
  assert.equal(seq.stepIndexAt(sd * 16), 0);
  assert.equal(seq.stepIndexAt(sd * 17), 1);
  assert.equal(seq.stepIndexAt(sd * 33), 1);
});

test("Sequencer: loopDuration is steps * stepDuration", () => {
  const seq = new Sequencer({ bpm: 120, stepsPerBeat: 4, steps: 16 });
  assert.ok(Math.abs(seq.loopDuration - 16 * 0.125) < 1e-12);
});

test("Sequencer: stepStartTime returns the absolute time a step begins", () => {
  const seq = new Sequencer({ bpm: 120, stepsPerBeat: 4, steps: 16 });
  const sd = seq.stepDuration;
  assert.ok(Math.abs(seq.stepStartTime(0) - 0) < 1e-12);
  assert.ok(Math.abs(seq.stepStartTime(5) - 5 * sd) < 1e-12);
  // Past one loop the absolute start keeps increasing (used by the scheduler).
  assert.ok(Math.abs(seq.stepStartTime(18) - 18 * sd) < 1e-12);
});

test("Sequencer: stepsInWindow lists each step whose start falls in [from,to)", () => {
  const seq = new Sequencer({ bpm: 120, stepsPerBeat: 4, steps: 16 });
  const sd = seq.stepDuration;
  // A window covering steps 2,3,4 (half-open) returns exactly those indices
  // along with their absolute start times.
  const got = seq.stepsInWindow(sd * 2, sd * 5);
  assert.deepEqual(
    got.map((e) => e.step),
    [2, 3, 4],
  );
  assert.ok(Math.abs(got[0].time - sd * 2) < 1e-12);
});

test("Sequencer: stepsInWindow wraps step indices across the loop boundary", () => {
  const seq = new Sequencer({ bpm: 120, stepsPerBeat: 4, steps: 16 });
  const sd = seq.stepDuration;
  // A window straddling the loop end: absolute steps 15,16,17 -> indices 15,0,1.
  const got = seq.stepsInWindow(sd * 15, sd * 18);
  assert.deepEqual(
    got.map((e) => e.step),
    [15, 0, 1],
  );
  // Absolute times keep climbing even though the index wrapped.
  assert.ok(Math.abs(got[1].time - sd * 16) < 1e-12);
});

// --- Song / pattern data ----------------------------------------------------

test("SONG defines bass, arp, and lead tracks over a fixed step count", () => {
  assert.ok(SONG.bass && SONG.arp && SONG.lead);
  assert.equal(SONG.steps, SONG.bass.length);
  assert.equal(SONG.steps, SONG.arp.length);
  assert.equal(SONG.steps, SONG.lead.length);
  assert.ok(SONG.steps >= 16);
});

test("SONG is original: it is NOT the Peter Gunn ostinato", () => {
  // The Peter Gunn riff is a repeated low E ostinato (E2 mostly). Guard that
  // our bass is not just a single repeated low E across the whole loop.
  const bassMidis = SONG.bass.map((n) => noteToMidi(n)).filter((m) => m != null);
  const distinct = new Set(bassMidis);
  assert.ok(distinct.size >= 3, "bass must use several distinct pitches");
  const eOstinato = bassMidis.every((m) => m === noteToMidi("E2"));
  assert.equal(eOstinato, false);
});

test("patternStep: reads a track's note at a wrapped step index", () => {
  // patternStep wraps so the scheduler can pass an absolute step number.
  const first = patternStep(SONG.bass, 0);
  assert.equal(patternStep(SONG.bass, SONG.steps), first);
  assert.equal(patternStep(SONG.bass, SONG.steps * 2 + 3), patternStep(SONG.bass, 3));
});

test("patternStep on a rest yields a non-note (null)", () => {
  // Build a tiny pattern with a known rest and confirm it reads as a rest.
  const pat = ["C4", ".", null, "E4"];
  assert.equal(noteToMidi(patternStep(pat, 1)), null);
  assert.equal(noteToMidi(patternStep(pat, 2)), null);
  assert.equal(noteToMidi(patternStep(pat, 0)), 60);
});
