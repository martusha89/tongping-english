import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../src/browser-app.ts", import.meta.url), "utf8");

test("a new card folds room history instead of deleting it", () => {
  assert.match(app, /let chatEarlierThroughSeq = -1;/);
  assert.match(app, /chatEarlierThroughSeq < 0 && Number\.isSafeInteger\(data\.latestSeq\)/);
  assert.match(app, /"↑ View " \+ earlier\.length \+ " earlier"/);
  // Unsynced local messages (seq 0) are never folded away.
  assert.match(app, /m\.seq > 0 && m\.seq <= chatEarlierThroughSeq/);
});

test("voice failures are shown on the hold button itself", () => {
  assert.match(app, /function flashVoiceError\(short, detail\)/);
  assert.match(app, /flashVoiceError\("Microphone is unavailable here"/);
});
