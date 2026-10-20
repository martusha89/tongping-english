import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(
  new URL("../src/browser-app.ts", import.meta.url),
  "utf8",
);

test("mobile trackpad tap tolerates iOS pointer jitter", () => {
  for (const token of [
    "startX: event.clientX",
    "startY: event.clientY",
    "const netDistance = Math.hypot(",
    "netDistance <= 16",
    "gesture.distance <= 32",
    "elapsed <= 560",
  ]) {
    assert.ok(app.includes(token), token);
  }
});

test("plain left tap stays on realtime websocket with a real press interval", () => {
  const start = app.indexOf("async function clickRemote");
  const end = app.indexOf("function setNudgeStatus", start);
  assert.ok(start >= 0 && end > start);
  const body = app.slice(start, end);
  assert.ok(body.includes('postPointer("down"'));
  assert.ok(body.includes("setTimeout(resolve, 36)"));
  assert.ok(body.includes('postPointer("up"'));
  assert.ok(body.includes("Sending…"));
  assert.ok(body.includes("Sent"));
});

test("double and right click still preserve ordered pointer down/up", () => {
  const start = app.indexOf("async function clickRemote");
  const end = app.indexOf("function setNudgeStatus", start);
  const body = app.slice(start, end);
  assert.ok(body.includes('const down = postPointer("down"'));
  assert.ok(body.includes("setTimeout(resolve, 36)"));
  assert.ok(body.includes('const up = postPointer("up"'));
  assert.ok(body.includes('await Promise.all([down, up])'));
  assert.ok(app.includes("shared-browser-v93"));
});
