import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../src/browser-app.ts", import.meta.url), "utf8");

test("pausing holds the frame on screen with a paused badge, and it clears on resume/leave/seek", () => {
  assert.match(app, /<div class="pausedOverlay" id="pausedOverlay" hidden>/);
  const pause = app.slice(app.indexOf("function toggleCompanionUserPause() {"));
  assert.ok(pause.indexOf("showPausedOverlay(video);") < pause.indexOf("try { video.pause(); } catch {}"));
  assert.ok(pause.includes("hidePausedOverlay();"));
  assert.match(app, /function stopCompanionPlayback\(returnToLive = true\) \{\n  companionModeActive = false;\n  companionUserPaused = false;\n  hidePausedOverlay\(\);/);
});

test("the menu is laid out as fields, paired actions, skins and a footer", () => {
  const menu = app.slice(app.indexOf('<div class="menuSheet"'), app.indexOf('<div class="skinToast"'));
  assert.ok(menu.indexOf('class="menuField"') < menu.indexOf('class="menuActions"'));
  assert.ok(menu.indexOf('class="menuActions"') < menu.indexOf('id="menuSkins"'));
  assert.match(menu, /id="fullscreen" class="actionButton"[\s\S]*?<span class="buttonLabel">Fullscreen<\/span>/);
});

test("the ticket sheet opens from the top, clear of the host composer", () => {
  assert.match(app, /\.ticketOverlay\{align-items:flex-start;padding:max\(12px,env\(safe-area-inset-top,0px\)\) 12px 150px\}/);
  assert.match(app, /\.drawer \.toolbar #refresh\{grid-area:auto\}/);
});
