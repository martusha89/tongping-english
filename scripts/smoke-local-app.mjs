import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = await mkdtemp(path.join(os.tmpdir(), "tongping-local-room-"));
const port = 45931;
const token = "tongping-local-room-smoke-token";
const bridgeToken = "tongping-local-room-smoke-bridge-token-1234567890";
const bridgeMessages = [];
let daemon;
let browser;
const daemonErrors = [];
const browserEvents = [];

const bridge = http.createServer(async (request, response) => {
  const origin = request.headers.origin ?? "";
  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("access-control-allow-methods", "POST, OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }
  if (request.headers.authorization !== `Bridge ${bridgeToken}`) {
    response.writeHead(401);
    response.end("Unauthorized");
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  bridgeMessages.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  response.writeHead(202, { "content-type": "application/json" });
  response.end(JSON.stringify({ ok: true }));
});

try {
  await new Promise((resolve, reject) => {
    bridge.once("error", reject);
    bridge.listen(45922, "127.0.0.1", resolve);
  });
  for (const authorization of [undefined, "Bridge wrong-conversation-token"]) {
    const rejected = await fetch("http://127.0.0.1:45922/message", {
      method: "POST",
      headers: {
        origin: `http://127.0.0.1:${port}`,
        "content-type": "application/json",
        ...(authorization ? { authorization } : {}),
      },
      body: JSON.stringify({
        text: "must not arrive",
        identity: "cassian.varen",
        profile: "cass-marta",
      }),
    });
    if (rejected.status !== 401) {
      throw new Error("Conversation bridge accepted an unauthenticated message");
    }
  }

  const env = {
    ...process.env,
    TONGPING_HOME: home,
    TONGPING_PORT: String(port),
    TONGPING_TOKEN: token,
    TONGPING_CHANNEL: "chrome",
  };
  delete env.TONGPING_REMOTE_WORKER;
  daemon = spawn(process.execPath, ["--import", "tsx", "src/daemon.ts"], {
    cwd: root,
    env,
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });
  daemon.stderr.on("data", (chunk) => {
    daemonErrors.push(String(chunk));
    if (daemonErrors.length > 20) daemonErrors.shift();
  });

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const health = await fetch(`http://127.0.0.1:${port}/health`);
      if (health.ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const health = await fetch(`http://127.0.0.1:${port}/health`);
  if (!health.ok) throw new Error("Temporary TongPing daemon did not become healthy");

  const launchResponse = await fetch(
    `http://127.0.0.1:${port}/v1/local-app/launch`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        identity: "cassian.varen",
        profile: "cass-marta",
        bridgeOrigin: "http://127.0.0.1:45922",
        bridgeToken,
      }),
    },
  );
  const launch = await launchResponse.json();
  if (!launchResponse.ok || typeof launch.url !== "string") {
    throw new Error(`Local room launch failed (${launchResponse.status})`);
  }

  browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    ignoreDefaultArgs: ["--disable-component-update"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("console", (message) => browserEvents.push(`console: ${message.text()}`));
  page.on("pageerror", (error) => browserEvents.push(`pageerror: ${error.message}`));
  await page.goto(launch.url, { waitUntil: "domcontentloaded" });
  try {
    await page.locator("#status").filter({ hasText: "connected" }).waitFor({
      timeout: 20_000,
    });
  } catch (error) {
    const status = await page.locator("#status").textContent().catch(() => "missing");
    const fatal = await page.locator("#fatalText").textContent().catch(() => "missing");
    throw new Error([
      `Host did not connect (status=${status}; fatal=${fatal})`,
      ...browserEvents.slice(-20),
      ...daemonErrors.slice(-10).map((line) => `daemon: ${line.trim()}`),
    ].join("\n"), { cause: error });
  }

  const card = page.frameLocator("#card");
  await card.getByText("Group chat", { exact: true }).waitFor();
  await card.getByText("Watch Together", { exact: true }).waitFor();
  await card.locator("#talkText").fill("Local room bridge smoke test");
  await card.locator("#talkSend").click();

  const messageDeadline = Date.now() + 10_000;
  while (bridgeMessages.length === 0 && Date.now() < messageDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (bridgeMessages.length !== 1) {
    throw new Error("Card message did not reach the local conversation bridge");
  }
  if (bridgeMessages[0]?.text !== "Local room bridge smoke test") {
    throw new Error("Conversation bridge received the wrong message");
  }
  await card.getByText("Local room bridge smoke test", { exact: true }).waitFor();

  if (process.env.TONGPING_SMOKE_SCREENSHOT) {
    await page.screenshot({
      path: process.env.TONGPING_SMOKE_SCREENSHOT,
      fullPage: true,
    });
  }

  console.log("Local TongPing room smoke test passed");
} finally {
  await browser?.close().catch(() => {});
  bridge.closeAllConnections?.();
  await new Promise((resolve) => bridge.close(resolve));
  if (daemon && daemon.exitCode === null) {
    const exited = once(daemon, "exit").catch(() => []);
    daemon.kill();
    await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
  }
  await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
