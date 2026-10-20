import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// The waiting-screen voice tip pointed at host voice mode, which cannot hear
// a companion card; voice now goes through the composer's hold-to-talk.
test("the waiting screen no longer suggests host voice mode", () => {
  const app = fs.readFileSync(new URL("../src/browser-app.ts", import.meta.url), "utf8");
  assert.doesNotMatch(app, /id="companionTip"/);
  assert.doesNotMatch(app, /Headphones work better/);
});
