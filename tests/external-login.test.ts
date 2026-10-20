import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("v50 manual local login handoff is explicit and worker-gated", async () => {
  const worker = await readFile(
    new URL("../src/worker-client.ts", import.meta.url),
    "utf8",
  );
  const daemon = await readFile(
    new URL("../src/daemon.ts", import.meta.url),
    "utf8",
  );
  const server = await readFile(
    new URL("../src/mcp-server.ts", import.meta.url),
    "utf8",
  );
  const app = await readFile(
    new URL("../src/browser-app.ts", import.meta.url),
    "utf8",
  );

  assert.match(worker, /const WORKER_BUILD = "v95"/);
  assert.match(worker, /human_external_login_start/);
  assert.match(worker, /human_external_login_finish/);
  assert.match(worker, /browser_close_profile/);
  assert.match(worker, /--user-data-dir=/);
  assert.match(worker, /No normal desktop Chrome\/Edge installation/);
  assert.match(worker, /accounts\.google\.com/);
  assert.match(worker, /signin\/rejected/);

  assert.match(daemon, /externalLoginEnabled: workerBuildAtLeast\(lastWorkerBuild, 28\)/);
  assert.match(server, /browser_app_external_login_start/);
  assert.match(server, /browser_app_external_login_finish/);
  assert.match(app, /id="localLogin"/);
  assert.match(app, /Signed in — reconnect/);
  assert.match(app, /Local sign-in requires Windows Worker v28\+\./);

  const finishStart = server.indexOf('"browser_app_external_login_finish"');
  const finishEnd = server.indexOf('"browser_app_click"', finishStart);
  const finishBlock = server.slice(finishStart, finishEnd);
  assert.match(finishBlock, /browserAppStateFromExternalLoginFinish/);
  assert.doesNotMatch(finishBlock, /await browserAppState/);
});
