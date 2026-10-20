import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(
  new URL("../src/browser-app.ts", import.meta.url),
  "utf8",
);

test("show-to-ai button is visible in the mode bar", () => {
  for (const token of [
    'id="showToAi"',
    'id="showToAiLabel">Show Everyone',
    'Share the frame you see with the AIs in the group',
    'shared-browser-v93',
  ]) {
    assert.ok(app.includes(token), token);
  }
});

test("companion mode captures the frame actually presented to the user", () => {
  for (const token of [
    'companionModeActive',
    'video.readyState >= 2',
    'ctx.drawImage(video',
    'source: "companion-presented-frame"',
    'crossorigin="anonymous"',
  ]) {
    assert.ok(app.includes(token), token);
  }
});

test("live mode captures the already presented canvas without a new screenshot", () => {
  for (const token of [
    'const live = $("liveCanvas")',
    'canvasImageBlock(live, 0.6)',
    'source: "live-presented-frame"',
  ]) {
    assert.ok(app.includes(token), token);
  }
});

test("server screenshot is a fallback only when the presented frame cannot be captured", () => {
  for (const token of [
    'let captured = captureCurrentDisplayedFrame()',
    'captured = await fetchCurrentFrameFallback()',
    'name: "browser_screenshot"',
    'fullPage: false',
  ]) {
    assert.ok(app.includes(token), token);
  }
});

test("explicit visual check parks the frame and sends a short system trigger", () => {
  for (const token of [
    'USER_EXPLICIT_VISUAL_CHECK',
    'captured.image.data',
    'call the TongPing tool browser_look',
    '"[TongPing · System] " + userZhName() + " pressed “Show Everyone”',
    'browser_app_chat_push to post your response into the group chat before repeating it in your own chat',
    'chatRelayInstruction()',
  ]) {
    assert.ok(app.includes(token), token);
  }
});

test("show-to-ai does not change live or companion mode", () => {
  const start = app.indexOf("async function showCurrentFrameToAi()");
  const end = app.indexOf("async function sendToAi()", start);
  assert.ok(start >= 0 && end > start);
  const body = app.slice(start, end);
  assert.ok(!body.includes("companionModeActive ="));
  assert.ok(!body.includes("stopCompanionPlayback"));
  assert.ok(!body.includes("closeLiveSocket"));
});
