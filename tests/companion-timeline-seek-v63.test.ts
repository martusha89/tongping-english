import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../src/browser-app.ts", import.meta.url), "utf8");
const hls = fs.readFileSync(new URL("../src/delayed-companion-hls.ts", import.meta.url), "utf8");
const manager = fs.readFileSync(new URL("../src/browser-manager.ts", import.meta.url), "utf8");
const service = fs.readFileSync(new URL("../src/browser-service.ts", import.meta.url), "utf8");
const mcp = fs.readFileSync(new URL("../src/mcp-server.ts", import.meta.url), "utf8");
const daemon = fs.readFileSync(new URL("../src/daemon.ts", import.meta.url), "utf8");
const hub = fs.readFileSync(new URL("../src/media-ws-hub.ts", import.meta.url), "utf8");
const worker = fs.readFileSync(new URL("../src/worker-client.ts", import.meta.url), "utf8");

test("v63 exposes whole-source timeline with explicit buffered window", () => {
  assert.ok(app.includes('id="companionTimeline"'));
  assert.ok(app.includes('id="companionSeek"'));
  assert.ok(app.includes('id="timelineBuffered"'));
  assert.ok(app.includes('id="timelineCurrent"'));
  assert.ok(app.includes('id="timelineDuration"'));
  assert.ok(app.includes("companionBufferStartPts"));
  assert.ok(app.includes("companionBufferEndPts"));
  assert.ok(app.includes("companionSourceDuration"));
});

test("buffered seek stays inside HLS and never calls source seek", () => {
  const start = app.indexOf("async function seekCompanionToSource(");
  const end = app.indexOf("function updateCompanionPreparingUi", start);
  const block = app.slice(start, end);
  assert.ok(block.includes("if (insideBuffer)"));
  assert.ok(block.includes("video.currentTime = Math.max(0, mediaTime)"));
  assert.ok(block.includes("staying in Watch Together"));
  const inside = block.slice(block.indexOf("if (insideBuffer)"), block.indexOf("companionSeekPending = true"));
  assert.ok(!inside.includes("browser_app_companion_seek_source"));
});

test("out-of-buffer seek uses source media seek and rebuilds companion epoch", () => {
  const start = app.indexOf("async function seekCompanionToSource(");
  const end = app.indexOf("function updateCompanionPreparingUi", start);
  const block = app.slice(start, end);
  assert.ok(block.includes('"browser_app_companion_seek_source"'));
  assert.ok(block.includes("outside the current buffer"));
  assert.ok(block.includes("video.src = companionPlaybackWaitUrl()"));
  assert.ok(block.includes("scheduleCompanionProbe(250)"));

  assert.ok(mcp.includes('"browser_app_companion_seek_source"'));
  assert.ok(mcp.includes("options.seekCompanionSource(profile, targetSeconds)"));
  assert.ok(daemon.includes('"browser_media_seek"'));
  assert.ok(daemon.includes('"human_media_restart"'));
  assert.ok(daemon.includes('"companion-source-seek"'));
});

test("worker source seek directly controls active HTMLMediaElement currentTime", () => {
  assert.ok(service.includes('| "browser_media_seek"'));
  assert.ok(service.includes('case "browser_media_seek"'));
  assert.ok(manager.includes("async seekMedia("));
  assert.ok(manager.includes("chosen.currentTime = Math.max(0, target)"));
  assert.ok(worker.includes('const WORKER_BUILD = "v95"'));
});

test("HLS playlist maps buffered segment wall clock back to source PTS", () => {
  assert.ok(hls.includes("interface CompanionSourceTimelineAnchor"));
  assert.ok(hls.includes("#TONGPING-SOURCE-ANCHOR-PTS:"));
  assert.ok(hls.includes("#TONGPING-SOURCE-ANCHOR-DATE-MS:"));
  assert.ok(hls.includes("#TONGPING-BUFFER-START-PTS:"));
  assert.ok(hls.includes("#TONGPING-BUFFER-END-PTS:"));
  assert.ok(hls.includes("#TONGPING-SOURCE-DURATION:"));
  assert.ok(daemon.includes("refreshCompanionSourceTimeline(profile)"));
});

test("companion playback reports source PTS and spoiler gate consumes source PTS", () => {
  assert.ok(app.includes("sourcePts,"));
  assert.ok(app.includes("bufferStartPts: companionBufferStartPts"));
  assert.ok(hub.includes("sourcePts: number | null"));
  assert.ok(mcp.includes("playback?.sourcePts"));
  assert.ok(mcp.includes("cue.startTime <= delayedCutoff"));
});
