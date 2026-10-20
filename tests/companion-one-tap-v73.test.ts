import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../src/browser-app.ts", import.meta.url), "utf8");

test("ready state never exposes a second Start Companion button", () => {
  assert.ok(app.includes('$("companionStart").classList.remove("on")'));
  assert.ok(!app.includes('classList.toggle("on", companionPhase === "ready")'));
});

test("ready copy explicitly says playback is automatic", () => {
  assert.ok(app.includes("Buffer ready; starting automatically…"));
  assert.ok(app.includes("No action needed; reconnecting audio and video on the same recording timeline."));
  assert.ok(!app.includes("Tap to start watching together"));
  assert.ok(!app.includes("Tap “Start watching together” again"));
});

test("playlist probe retries play on the original media src without rebinding it", () => {
  const start = app.indexOf("if (segmentCount >= 2 &&");
  const end = app.indexOf("} catch {}", start);
  const block = app.slice(start, end);
  assert.ok(block.includes("await video.play()"));
  assert.ok(block.includes("scheduleCompanionProbe(900)"));
  assert.ok(!block.includes("video.src ="));
});

test("automatic retry preserves diagnostics without asking for another tap", () => {
  assert.ok(app.includes('setNudgeStatus("Retrying autoplay · " + detail)'));
});

test("App v89 is the fresh resource identity", () => {
  assert.ok(app.includes("shared-browser-v93"));
});
