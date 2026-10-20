import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../src/browser-app.ts", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../src/mcp-server.ts", import.meta.url), "utf8");
const daemon = fs.readFileSync(new URL("../src/daemon.ts", import.meta.url), "utf8");

test("camera effects are built from the original demo and served lazily", () => {
  const engine = fs.readFileSync(new URL("../assets/camera-fx/engine.js", import.meta.url), "utf8");
  assert.match(engine, /window\.TongpingCameraFx=\{open,close,flip,setLook/);
  assert.match(engine, /class SceneRenderer/);
  assert.ok(fs.existsSync(new URL("../assets/camera-fx/geometry.js", import.meta.url)));
  assert.match(daemon, /\^\\\/assets\\\/camera-fx\\\/\(geometry\|engine\)\\\.js\$/);
  assert.match(app, /loadCameraScript\("geometry"\)/);
});

test("the card asks for the camera and allows the face model CDN", () => {
  assert.match(server, /permissions: \{ microphone: \{\}, camera: \{\} \}/);
  assert.match(server, /"https:\/\/storage\.googleapis\.com"/);
});

test("muted AIs cannot look, and frames live in memory only", () => {
  const look = server.slice(server.indexOf('"browser_camera_look"'), server.indexOf('"browser_app_image_link"'));
  assert.match(look, /appChatLedger\.isMuted\(who\)/);
  assert.ok(look.indexOf("isMuted") < look.indexOf("cameraFrames.get"), "mute check before reading the frame");
  assert.match(server, /if \(!active\) \{\s*cameraFrames\.delete\(profile\);/);
  assert.doesNotMatch(look, /writeFile|appendFile/);
});

test("each look is reported back so the card can tell the user", () => {
  assert.match(server, /frame\.lastLook = \{ by: who, at: Date\.now\(\) \}/);
  assert.match(app, /" looked at you"/);
  assert.match(app, /if \(Date\.parse\(look\.at\) < cameraOpenedAt\) return;/);
});

test("“Show Everyone” shares their camera frame while the camera is on", () => {
  assert.match(app, /const cameraShot = cameraOn \? captureCameraFrame\(960\) : null;/);
  assert.match(app, /mode: cameraShot \? "camera"/);
});

test("looking requires the AI's own identity, with no host default", () => {
  const look = server.slice(server.indexOf('"browser_camera_look"'), server.indexOf('"browser_app_image_link"'));
  assert.match(look, /identity: z\.string\(\)\.regex\(\/\^\[a-z0-9\._-\]\{1,40\}\$\/\),/);
  assert.doesNotMatch(look, /identity: identitySchema/);
});
