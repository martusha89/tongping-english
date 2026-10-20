import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(
  new URL("../src/browser-app.ts", import.meta.url),
  "utf8",
);

test("companion UI exposes explicit LIVE, preparing, and companion states", () => {
  for (const token of [
    'id="modeStatus"',
    'id="companionPrep"',
    'id="companionProgressBar"',
    'id="companionCancel"',
    'id="companionStart"',
    'let companionPhase = "idle"',
    '"Preparing"',
    '"Watch Together"',
    '"LIVE"',
  ]) {
    assert.ok(app.includes(token), token);
  }
});

test("preparing mode can always return to realtime", () => {
  assert.ok(app.includes('$("companionCancel").addEventListener'));
  assert.ok(app.includes('stopCompanionPlayback(true)'));
  assert.ok(app.includes('function stopCompanionPlayback'));
  assert.ok(app.includes('ensureLiveSocket();'));
  assert.ok(app.includes('refreshImage();'));
});

test("loading UI represents Actual buffering work rather than a blind timer", () => {
  assert.ok(app.includes('async function probeCompanionPlaylist'));
  assert.ok(app.includes('cache: "no-store"'));
  assert.ok(app.includes('segmentCount'));
  assert.ok(app.includes('#TONGPING-BUFFERED-SECONDS:'));
  assert.ok(app.includes('Building a short buffer'));
  assert.ok(app.includes('Actual buffer'));
  assert.ok(app.includes('Math.floor(companionBufferedSeconds)'));
});

test("native autoplay failure becomes an explicit start affordance", () => {
  assert.ok(app.includes('companionPhase = "ready"'));
  assert.ok(app.includes('$("companionStart").addEventListener'));
  assert.ok(app.includes('startPreparedCompanionPlayback'));
});

test("playback and buffering events drive the companion overlay", () => {
  assert.ok(app.includes('$("mediaVideo").addEventListener("playing"'));
  assert.ok(app.includes('companionPhase = "playing"'));
  assert.ok(app.includes('$("mediaVideo").addEventListener("waiting"'));
  assert.ok(app.includes('$("mediaVideo").addEventListener("stalled"'));
  assert.ok(app.includes('companionPhase = "buffering"'));
});

test("cute preparing animation is CSS-only and resource identity is fresh", () => {
  assert.ok(app.includes('@keyframes companionBounce'));
  assert.ok(app.includes('class="companionTv"'));
  assert.ok(app.includes('class="companionDot"'));
  assert.ok(app.includes('shared-browser-v93'));
});
