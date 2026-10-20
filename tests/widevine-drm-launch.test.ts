import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const browserManager = fs.readFileSync(
  new URL("../src/browser-manager.ts", import.meta.url),
  "utf8",
);

test("Chrome component updates stay enabled for Widevine DRM", () => {
  assert.match(
    browserManager,
    /ignoreDefaultArgs:\s*\["--disable-component-update"\]/,
  );
});
