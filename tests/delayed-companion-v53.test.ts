import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  createBrowserCompanionHlsUrl,
  deriveBrowserAppSigningKey,
  verifyBrowserLiveTicket,
} from "../src/browser-app-ticket.js";

test("v53 companion worker records audio+video while legacy media remains opt-in", () => {
  const worker = fs.readFileSync(
    new URL("../src/worker-client.ts", import.meta.url),
    "utf8",
  );
  const manager = fs.readFileSync(
    new URL("../src/browser-manager.ts", import.meta.url),
    "utf8",
  );
  assert.match(worker, /const WORKER_BUILD = "v95"/);
  assert.match(worker, /command\.args\?\.mode === "companion"/);
  assert.match(worker, /includeAudio: true/);
  assert.match(worker, /chunkMs: 1_000/);
  assert.match(worker, /videoBitsPerSecond: companionQualityDegraded\.has\(profile\)/);
  assert.match(worker, /\? 900_000/);
  assert.match(worker, /: 2_000_000/);
  assert.match(worker, /audioBitsPerSecond: companionQualityDegraded\.has\(profile\)/);
  assert.match(worker, /\? 64_000/);
  assert.match(worker, /: 96_000/);
  assert.match(manager, /audio: includeAudio/);
  assert.match(manager, /video\/webm;codecs=vp8,opus/);
  assert.match(manager, /recorder\.requestData\(\)/);
});

test("companion media websocket handshake is explicit and does not forward raw WebM to the app", () => {
  const hub = fs.readFileSync(
    new URL("../src/media-ws-hub.ts", import.meta.url),
    "utf8",
  );
  const daemon = fs.readFileSync(
    new URL("../src/daemon.ts", import.meta.url),
    "utf8",
  );
  assert.match(hub, /message\.type !== "companion_ready"/);
  assert.match(hub, /this\.appModes\.get\(app\) === "companion"/);
  assert.match(daemon, /primeCompanionMediaProfile/);
  assert.match(daemon, /mode: "companion"/);
  assert.match(daemon, /delayedCompanionHls\.write/);
});

test("companion HLS URL uses the existing signed live authority", () => {
  const key = deriveBrowserAppSigningKey("test-token");
  const url = new URL(
    createBrowserCompanionHlsUrl(
      "https://browser.example.test",
      key,
      "gpt-self",
      300,
      20,
      1_700_000_000_000,
    ),
  );
  assert.equal(url.pathname, "/v1/app/companion-hls");
  assert.equal(url.searchParams.get("delay"), "20");
  assert.equal(
    verifyBrowserLiveTicket(
      key,
      "gpt-self",
      url.searchParams.get("exp"),
      url.searchParams.get("sig"),
      1_700_000_000_000,
    ),
    true,
  );
});

test("app exposes delayed companion as a distinct mode and fresh resource", () => {
  const app = fs.readFileSync(
    new URL("../src/browser-app.ts", import.meta.url),
    "utf8",
  );
  assert.match(app, /id="companion"/);
  assert.match(app, /let companionModeActive = false/);
  assert.match(app, /"companion_ready"/);
  assert.match(app, /companionPlaylistUrl/);
  assert.match(app, /shared-browser-v93/);
  assert.match(app, /about /);
});
