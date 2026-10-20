import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { SharedImageStore } from "../src/shared-images.js";
import { brandHumanUserId, ownerScope } from "../src/route-identity.js";

const read = (name: string) => fs.readFileSync(new URL("../src/" + name, import.meta.url), "utf8");

test("shared images are served by an unguessable id and expire", () => {
  const store = new SharedImageStore();
  const owner = ownerScope(brandHumanUserId("private"));
  const id = store.put(owner, Buffer.from("png"), "image/png").id;
  assert.match(id, /^[A-Za-z0-9_-]{20,}$/);
  assert.equal(store.get(owner, id)?.mimeType, "image/png");
  assert.equal(store.get(owner, "nope-nope-nope-nope-nope"), null);
});

test("“Show Everyone” parks the frame and asks the model to fetch it with browser_look", () => {
  const app = read("browser-app.ts");
  const look = app.slice(app.indexOf("async function showCurrentFrameToAi() {"), app.indexOf("async function sendToAi() {"));
  assert.ok(look.indexOf('call("browser_app_look_share"') < look.indexOf("app.sendMessage("));
  assert.match(look, /Call browser_look/);
  const server = read("mcp-server.ts");
  assert.match(server, /"browser_look",/);
});

test("saving a ticket opens a hosted PNG in the system browser", () => {
  const app = read("browser-app.ts");
  assert.match(app, /call\("browser_app_image_link"/);
  assert.match(app, /app\.openLink\(\{ url \}\)/);
  const daemon = read("daemon.ts");
  assert.match(daemon, /url\.pathname\.startsWith\("\/v1\/app\/shared-image\/"\)/);
});

test("static on-page labels are not subtitles; spoken/read lines win over DOM text", () => {
  const manager = read("browser-manager.ts");
  assert.match(manager, /visibleDomDistinct >= 2/);
  assert.match(manager, /: spokenCues\.length > 0\n          \? spokenCues\n          : visibleDomCues;/);
});
