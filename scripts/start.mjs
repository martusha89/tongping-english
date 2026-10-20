#!/usr/bin/env node
// TongPing Personal Edition one-command startup:
//   1. Load .env (existing command-line environment variables take precedence)
//   2. Start daemon (MCP service + card + group chat), listening locally only
//   3. Wait for daemon health, then start the local worker (the process that opens Chrome)
//   4. One Ctrl+C stops both processes
//
// Daemon and worker use separate subdirectories under one TONGPING_HOME to avoid competing for
// the same Chromium profile lock.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
loadEnvFile(path.join(root, ".env"));

const major = Number(process.versions.node.split(".")[0]);
if (major < 20) {
  fail(`Node.js 20 or newer is required; current version is ${process.version}. Upgrade Node.js first.`);
}
if (!existsSync(path.join(root, "node_modules"))) {
  fail("Dependencies are not installed. Run this in the project directory first: npm ci");
}

const home = path.resolve(
  expandHome(process.env.TONGPING_HOME?.trim() || path.join(os.homedir(), ".tongping")),
);
const port = process.env.TONGPING_PORT?.trim() || "45921";
const localUrl = `http://127.0.0.1:${port}`;
const daemonHome = path.join(home, "daemon");
const workerHome = path.join(home, "worker");
const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");

// Publishing through a tunnel: accept the tunnel hostname without making the
// user hand-maintain TONGPING_ALLOWED_HOSTS / _ORIGINS.
const publicHost = (() => {
  try { return new URL(process.env.TONGPING_PUBLIC_ORIGIN?.trim() || "").hostname; } catch { return ""; }
})();
const loopbackHosts = ["localhost", "127.0.0.1", "[::1]"];
const hostAllowList = (name) => {
  const configured = process.env[name]?.trim();
  if (configured) return configured;
  return [...loopbackHosts, ...(publicHost ? [publicHost] : [])].join(",");
};

if (!hasCommand("ffmpeg")) {
  console.warn("Note: ffmpeg was not found. Browsing and chat work, but Watch Together (delayed buffered playback) will stay at 0 seconds buffered.");
  console.warn("      See the “Install ffmpeg” section in docs/INSTALL.md for installation instructions.");
}

const children = [];
let stopping = false;

const daemon = run("daemon", path.join(root, "src", "daemon.ts"), {
  TONGPING_HOME: daemonHome,
  TONGPING_PORT: port,
  TONGPING_HOST: process.env.TONGPING_HOST?.trim() || "127.0.0.1",
  TONGPING_REMOTE_WORKER: "1",
  TONGPING_ALLOWED_HOSTS: hostAllowList("TONGPING_ALLOWED_HOSTS"),
  TONGPING_ALLOWED_ORIGINS: hostAllowList("TONGPING_ALLOWED_ORIGINS"),
  // Personal edition: the local worker authenticates with the daemon's
  // worker-token file. Both switches are required for that token path.
  TONGPING_DEPLOYMENT_MODE: "private-single-user",
  TONGPING_PAIRING_AUTHORITY: "private-single-user",
  // The worker opens its audio/video helper tab against this origin.
  TONGPING_CLOUD_URL: localUrl,
});

await waitForHealth(localUrl, daemon);
const workerToken = readFileSync(path.join(daemonHome, "worker-auth", "worker-token"), "utf8").trim();

run("worker", path.join(root, "src", "worker-client.ts"), {
  TONGPING_HOME: workerHome,
  TONGPING_CLOUD_URL: localUrl,
  TONGPING_WORKER_TOKEN: workerToken,
  TONGPING_WORKER_NAME: process.env.TONGPING_WORKER_NAME?.trim() || os.hostname(),
  // Optional local subtitles (npm run asr:install puts the service here).
  TONGPING_ASR_DIR: path.resolve(expandHome(process.env.TONGPING_ASR_DIR?.trim() || path.join(home, "asr"))),
});

const publicOrigin = process.env.TONGPING_PUBLIC_ORIGIN?.trim();
console.log("");
console.log("==============================================");
console.log(" TongPing Personal Edition is running");
console.log(`  Local health: ${localUrl}/health`);
console.log(`  Local MCP:     ${localUrl}/mcp`);
console.log(`  Mobile/web takeover: ${localUrl}/live`);
console.log(`  Daemon token:  ${path.join(daemonHome, "daemon-token")}`);
if (publicOrigin) {
  console.log(`  Public MCP URL (enter in Claude / ChatGPT): ${publicOrigin.replace(/\/+$/, "")}/mcp`);
} else {
  console.log("  TONGPING_PUBLIC_ORIGIN is not set: only local clients (Claude Code / Codex) can connect.");
}
console.log(" To stop: press Ctrl+C in this window");
console.log("==============================================");
console.log("");

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

function run(name, entry, extraEnv) {
  const child = spawn(process.execPath, [tsxCli, entry], {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const prefix = `[${name}] `;
  const pipe = (stream, out) => {
    let buffered = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      buffered += chunk;
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? "";
      for (const line of lines) out.write(prefix + line + "\n");
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code, signal) => {
    if (stopping) return;
    console.error(`${prefix}Exited (code=${code ?? "-"} signal=${signal ?? "-"}); stopping all of TongPing.`);
    console.error("Copy the preceding few dozen log lines to AI and ask it to troubleshoot using docs/TROUBLESHOOTING.md.");
    stopAll(code || 1);
  });
  children.push(child);
  return child;
}

async function waitForHealth(url, child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) process.exit(child.exitCode || 1);
    try {
      const response = await fetch(url + "/health");
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  console.error(`${url}/health did not respond within 60 seconds. Port ${port} may be in use; run npm run doctor to check.`);
  stopAll(1);
}

function stopAll(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  setTimeout(() => {
    for (const child of children) {
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    process.exit(code);
  }, 4_000).unref();
  Promise.all(children.map((child) =>
    child.exitCode !== null ? null : new Promise((resolve) => child.once("exit", resolve)),
  )).then(() => process.exit(code));
}

function loadEnvFile(file) {
  if (!existsSync(file)) return;
  const text = readFileSync(file, "utf8").replace(/^﻿/, "");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && /^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function expandHome(value) {
  return value === "~" || value.startsWith("~/") || value.startsWith("~\\")
    ? path.join(os.homedir(), value.slice(1))
    : value;
}

function hasCommand(command) {
  try {
    return spawnSync(command, ["-version"], { stdio: "ignore", windowsHide: true }).status === 0;
  } catch {
    return false;
  }
}

function fail(message) {
  console.error("Error: " + message);
  process.exit(1);
}
