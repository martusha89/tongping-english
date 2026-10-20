import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("after 30s without a mirrored reply the panel points to the host conversation", () => {
  const app = fs.readFileSync(new URL("../src/browser-app.ts", import.meta.url), "utf8");
  assert.match(app, /if \(waited >= 30000\) \{/);
  assert.match(app, /may have replied in the main conversation. Scroll down to check/);
  assert.match(app, /\[REQUIRED, do not skip\] IN-APP CHAT RELAY/);
});
