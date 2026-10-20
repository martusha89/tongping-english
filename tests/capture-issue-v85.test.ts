import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const daemon = fs.readFileSync(new URL("../src/daemon.ts", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../src/browser-app.ts", import.meta.url), "utf8");

test("a failed attach reason reaches the waiting screen as a short issue code", () => {
  assert.match(daemon, /could not start video source\|notreadable/);
  assert.match(daemon, /"#TONGPING-CAPTURE-ISSUE:" \+ companionIssueCode\(issue\.reason\)/);
  assert.match(daemon, /if \(attached\) \{\n        companionAttachIssues\.delete\(profile\);/);
  assert.match(app, /"The computer appears to be locked"/);
  assert.match(app, /companionCaptureIssue && cachedSeconds < 1 && companionPhase === "preparing"/);
});
