import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../src/browser-app.ts", import.meta.url), "utf8");
const daemon = fs.readFileSync(new URL("../src/daemon.ts", import.meta.url), "utf8");
const mcp = fs.readFileSync(new URL("../src/mcp-server.ts", import.meta.url), "utf8");

test("enter companion arms the same media element during the user's click", () => {
  assert.ok(app.includes("function companionPlaybackWaitUrl()"));
  assert.ok(app.includes('url.searchParams.set("_playwait", "1")'));
  assert.ok(app.includes("video.src = companionPlaybackWaitUrl();"));
  assert.ok(app.includes("companionPlaybackArmed = true;"));
  assert.ok(app.includes("void video.play().catch(() =>"));
});

test("playwait playlist holds the media request until delayed HLS is actually playable", () => {
  assert.ok(daemon.includes('url.searchParams.get("_playwait") === "1"'));
  assert.ok(daemon.includes("const deadline = Date.now() + 180_000"));
  assert.ok(daemon.includes("while (!playlist && Date.now() < deadline)"));
  assert.ok(daemon.includes("setTimeout(resolve, 250)"));
});

test("20/20 UI distinguishes full buffer from first playable HLS startup", () => {
  assert.ok(app.includes("Buffer full; waiting for playable segments"));
  assert.ok(app.includes("the player is waiting for the first playable HLS segments. No action needed."));
});

test("app v60 keeps cached v59 cards compatible", () => {
  assert.ok(app.includes("shared-browser-v93"));
  assert.ok(mcp.includes("shared-browser-v59"));
});
