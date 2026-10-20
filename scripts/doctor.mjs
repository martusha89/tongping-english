#!/usr/bin/env node
// TongPing Personal Edition health check: npm run doctor
// Read-only checks; changes no files. Prints a diagnostic summary with all tokens and passwords redacted,
// which can be sent in full to AI with docs/TROUBLESHOOTING.md for troubleshooting.
import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const envFile = path.join(root, ".env");
const envFromFile = loadEnvFile(envFile);
const env = (key) => process.env[key]?.trim() || "";
const rows = [];
const add = (level, id, message, fix = "") => rows.push({ level, id, message, fix });

const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const port = env("TONGPING_PORT") || "45921";
const home = path.resolve(expandHome(env("TONGPING_HOME") || path.join(os.homedir(), ".tongping")));
const localUrl = `http://127.0.0.1:${port}`;

// 1. Node.js
const major = Number(process.versions.node.split(".")[0]);
if (major >= 20) add("ok", "node", `Node.js ${process.version}`);
else add("fail", "node", `Node.js ${process.version} is too old`, "Install Node.js 20 LTS or newer (see INSTALL.md step 1)");

// 2. Dependencies
if (!existsSync(path.join(root, "node_modules"))) {
  add("fail", "deps", "node_modules not found", "Run npm ci in the project directory");
} else {
  for (const dep of ["playwright", "tsx", "ws", "@modelcontextprotocol/server"]) {
    const file = path.join(root, "node_modules", ...dep.split("/"), "package.json");
    if (!existsSync(file)) add("fail", "deps", `Missing dependency ${dep}`, "Delete node_modules and rerun npm ci");
  }
  if (!rows.some((r) => r.id === "deps")) {
    const pw = JSON.parse(readFileSync(path.join(root, "node_modules", "playwright", "package.json"), "utf8"));
    add("ok", "deps", `Dependencies installed (playwright ${pw.version})`);
  }
}

// 3. Browser
const channel = env("TONGPING_CHANNEL");
const exe = env("TONGPING_EXECUTABLE_PATH");
if (exe) {
  if (existsSync(exe)) add("ok", "browser", "Using a custom browser path");
  else add("fail", "browser", "TONGPING_EXECUTABLE_PATH points to a nonexistent file", "Set a valid chrome.exe / chromium path, or remove this line");
} else if (channel) {
  const found = findChannel(channel);
  if (found) add("ok", "browser", `Using local ${channel}`);
  else add("fail", "browser", `TONGPING_CHANNEL=${channel}, but this browser was not found locally`, "Install Chrome/Edge, or remove this line and use npx playwright install chromium");
} else {
  const bundled = await playwrightChromium();
  if (major < 20) add("info", "browser", "Node.js is too old; upgrade Node before checking the browser");
  else if (bundled) {
    const missing = linuxMissingLibs(bundled);
    if (missing.length) add("fail", "browser", `Playwright Chromium is missing system libraries: ${missing.slice(0, 4).join(", ")}${missing.length > 4 ? " …" : ""}`, "Run sudo npx playwright install-deps chromium (see TROUBLESHOOTING B3)");
    else add("ok", "browser", "Using Playwright's bundled Chromium");
  }
  else if (findChannel("chrome")) add("warn", "browser", "Chrome is installed, but .env lacks TONGPING_CHANNEL=chrome and Playwright Chromium is not installed", "Add TONGPING_CHANNEL=chrome to .env (recommended), or run npx playwright install chromium");
  else add("fail", "browser", "No browser available", "Run npx playwright install chromium (add --with-deps on Linux), or install Chrome and set TONGPING_CHANNEL=chrome");
}

// 4. ffmpeg (companion / voice input)
const ff = spawnSync("ffmpeg", ["-version"], { encoding: "utf8", windowsHide: true });
if (ff.status === 0) add("ok", "ffmpeg", ff.stdout.split("\n")[0].slice(0, 60));
else add("warn", "ffmpeg", "ffmpeg not found: Watch Together stays at 0 seconds buffered, and Hold to talk is unavailable", "Install ffmpeg and add it to PATH (see “Install ffmpeg” in INSTALL.md), then reopen the terminal");

// 4b. Optional local subtitles
const asrDir = path.resolve(expandHome(env("TONGPING_ASR_DIR") || path.join(home, "asr")));
const asrPython = process.platform === "win32" ? path.join(asrDir, ".venv", "Scripts", "python.exe") : path.join(asrDir, ".venv", "bin", "python");
if (existsSync(asrPython) && existsSync(path.join(asrDir, "asr_server.py"))) {
  add("ok", "asr", `Local subtitles installed${env("HF_ENDPOINT") ? ` (model mirror ${env("HF_ENDPOINT")})` : ""}`);
} else {
  add("info", "asr", "Local subtitles not installed (optional): AI cannot read dialogue in unsubtitled videos", "If needed, run npm run asr:install (add -- --cn in mainland China); see INSTALL.md 5b");
}

// 5. Config
if (!existsSync(envFile)) add("warn", "env", "No .env file (using all defaults)", "Copy .env.example to .env");
else add("ok", "env", `Loaded .env (${Object.keys(envFromFile).length} settings)`);
const publicOrigin = env("TONGPING_PUBLIC_ORIGIN");
const password = env("TONGPING_OAUTH_PASSWORD");
if (publicOrigin) {
  let parsed = null;
  try { parsed = new URL(publicOrigin); } catch {}
  if (!parsed) add("fail", "public", "TONGPING_PUBLIC_ORIGIN is not a valid URL", "Use a URL such as https://xxxx.trycloudflare.com, without /mcp");
  else {
    if (parsed.protocol !== "https:") add("fail", "public", "TONGPING_PUBLIC_ORIGIN must use https://", "Claude and ChatGPT both require HTTPS connector URLs");
    if (parsed.pathname !== "/" ) add("fail", "public", "TONGPING_PUBLIC_ORIGIN must contain only the origin, with no path", `Change to ${parsed.origin}`);
    if (!rows.some((r) => r.id === "public")) add("ok", "public", `Public address ${parsed.host}`);
  }
  if (!password) add("fail", "oauth", "Public origin set without TONGPING_OAUTH_PASSWORD; OAuth stays disabled and Claude/ChatGPT cannot connect", "Set a password of at least 12 characters in .env");
  else if (password.length < 12) add("warn", "oauth", "OAuth password is shorter than 12 characters", "Publicly reachable; use a longer random password");
  else add("ok", "oauth", "OAuth password is set");
} else {
  add("info", "public", "No public origin set: only local clients (Claude Code / Codex / Claude Desktop) can connect", "For claude.ai / ChatGPT web, see INSTALL.md step 6");
}

// 6. Data directory
try {
  if (existsSync(home)) {
    accessSync(home, constants.W_OK);
    add("ok", "home", `Data directory is writable`);
  } else add("info", "home", "Data directory not yet created (created automatically on first npm run up)");
} catch {
  add("fail", "home", "Data directory is not writable", "Choose another TONGPING_HOME or fix directory permissions");
}

// 7. Running daemon
let health = null;
try {
  const response = await fetch(localUrl + "/health", { signal: AbortSignal.timeout(3000) });
  health = await response.json();
} catch {}
if (!health) {
  const busy = await portBusy(Number(port));
  if (busy) add("fail", "daemon", `Port ${port} is occupied by another program, not TongPing`, "Stop the program using the port, or change TONGPING_PORT in .env");
  else add("info", "daemon", "TongPing is not running", "Run npm run up");
} else {
  add(health.service === "tongping" ? "ok" : "fail", "daemon", `Daemon online, version ${health.version}`);
  if (health.version && health.version !== pkg.version) {
    add("warn", "version", `Running version is ${health.version}; code version is ${pkg.version}`, "After upgrading, stop with Ctrl+C and rerun npm run up");
  }
  if (health.worker?.connected) add("ok", "worker", `Worker connected (${health.workerBuild})`);
  else add("fail", "worker", "Worker is not connected to daemon", "Check [worker] errors in the npm run up window; often the browser is not installed correctly");
  if (publicOrigin && password && health.oauth !== true) add("fail", "oauth", "Daemon has not enabled OAuth", "Restart npm run up after changing .env");
  const dc = health.delayedCompanion;
  const cc = health.companionCommand;
  if (cc?.lastMode === "companion" && cc?.lastOk && dc && dc.active === 0 && health.mediaWs?.companionAppProfiles?.length) {
    add("warn", "companion", "Watch Together requested but no buffering session exists (likely missing ffmpeg)", "Install ffmpeg and restart");
  }
  const badExits = (dc?.recentExits ?? []).filter((exit) => exit.exitCode !== 0);
  if (badExits.length) add("warn", "companion", `ffmpeg recently exited abnormally ${badExits.length} times`, "Send delayedCompanion.recentExits from the summary below to AI");
}

// 8. Public reachability
if (publicOrigin && health) {
  try {
    const response = await fetch(publicOrigin.replace(/\/+$/, "") + "/.well-known/oauth-authorization-server", { signal: AbortSignal.timeout(8000) });
    if (response.ok) add("ok", "tunnel", "Public address reaches local TongPing");
    else add("fail", "tunnel", `Public address returned HTTP ${response.status}`, response.status === 403 ? "Host allowlist issue: check TONGPING_ALLOWED_HOSTS" : "Check that the tunnel points to 127.0.0.1:" + port);
  } catch (error) {
    add("fail", "tunnel", "Public address unreachable: " + String(error?.cause?.code || error?.message || error).slice(0, 80), "Tunnel is stopped, address changed (temporary tunnels change on each restart), or local network is blocking it");
  }
}

// Report
const icon = { ok: "✅", warn: "⚠️ ", fail: "❌", info: "ℹ️ " };
console.log(`\nTongPing health check  (${pkg.name} ${pkg.version})\n`);
for (const row of rows) {
  console.log(`${icon[row.level]} [${row.id}] ${row.message}`);
  if (row.fix && row.level !== "ok") console.log(`      → ${row.fix}`);
}
const fails = rows.filter((r) => r.level === "fail").length;
console.log("\n----- Diagnostic summary (redacted; safe to send in full to AI) -----");
console.log(JSON.stringify({
  version: pkg.version,
  os: `${os.platform()} ${os.release()} ${os.arch()}`,
  node: process.version,
  port,
  home: redactPath(home),
  env: Object.fromEntries(Object.entries({ ...envFromFile, ...pickEnv() }).map(([k, v]) => [k, redactValue(k, v)])),
  checks: rows.map((r) => `${r.level}:${r.id}:${r.message}`),
  health: health ? {
    version: health.version, oauth: health.oauth, remoteWorker: health.remoteWorker,
    worker: health.worker && { connected: health.worker.connected, ageMs: health.worker.ageMs },
    workerBuild: health.workerBuild,
    liveWs: health.liveWs && { appAccepted: health.liveWs.appAccepted, appRejected: health.liveWs.appRejected, appRejectedTicket: health.liveWs.appRejectedTicket, appRejectedCard: health.liveWs.appRejectedCard, lastWorkerCloseReason: health.liveWs.lastWorkerCloseReason },
    mediaWs: health.mediaWs && { appReady: health.mediaWs.appReady, streamStarts: health.mediaWs.streamStarts, segmentsAccepted: health.mediaWs.segmentsAccepted, segmentsDroppedNoViewer: health.mediaWs.segmentsDroppedNoViewer },
    delayedCompanion: health.delayedCompanion && { active: health.delayedCompanion.active, recentExits: (health.delayedCompanion.recentExits ?? []).slice(-3).map((e) => ({ exitCode: e.exitCode, ageMs: e.ageMs, chunksIn: e.chunksIn, stderrTail: String(e.stderrTail ?? "").slice(-300) })) },
    companionCommand: health.companionCommand && { lastMode: health.companionCommand.lastMode, lastOk: health.companionCommand.lastOk, lastError: health.companionCommand.lastError },
  } : null,
}, null, 2));
console.log("----- End of summary -----\n");
process.exit(fails ? 1 : 0);

function pickEnv() {
  return Object.fromEntries(Object.keys(process.env).filter((k) => k.startsWith("TONGPING_")).map((k) => [k, process.env[k]]));
}
function redactValue(key, value) {
  if (/TOKEN|PASSWORD|SECRET|KEY/i.test(key)) return value ? `<set, ${String(value).length} characters>` : "<empty>";
  if (/HOME|PATH|FILE/i.test(key)) return redactPath(String(value));
  return value;
}
function redactPath(value) {
  const homeDir = os.homedir();
  return value.split(homeDir).join("~").split(homeDir.replaceAll("\\", "/")).join("~");
}
function findChannel(name) {
  const candidates = {
    chrome: process.platform === "win32"
      ? [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean).map((d) => path.join(d, "Google", "Chrome", "Application", "chrome.exe"))
      : process.platform === "darwin" ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/opt/google/chrome/chrome"],
    msedge: process.platform === "win32"
      ? [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"]].filter(Boolean).map((d) => path.join(d, "Microsoft", "Edge", "Application", "msedge.exe"))
      : process.platform === "darwin" ? ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
      : ["/usr/bin/microsoft-edge", "/opt/microsoft/msedge/msedge"],
  }[name] ?? [];
  return candidates.find((file) => { try { return statSync(file).isFile(); } catch { return false; } });
}
async function playwrightChromium() {
  // Importing playwright on Node < 20 makes it print a warning and exit the
  // whole process, which would hide the rest of this report.
  if (major < 20) return null;
  try {
    const { chromium } = await import("playwright");
    const file = chromium.executablePath();
    return file && existsSync(file) ? file : null;
  } catch { return null; }
}
function linuxMissingLibs(executable) {
  if (process.platform !== "linux") return [];
  const out = spawnSync("ldd", [executable], { encoding: "utf8" });
  if (out.status !== 0 || !out.stdout) return [];
  return out.stdout.split("\n").filter((line) => line.includes("not found")).map((line) => line.trim().split(/\s+/)[0]);
}
function portBusy(p) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(true));
    server.once("listening", () => server.close(() => resolve(false)));
    server.listen(p, "127.0.0.1");
  });
}
function loadEnvFile(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const raw of readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && /^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    out[key] = value;
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return out;
}
function expandHome(value) {
  return value === "~" || value.startsWith("~/") || value.startsWith("~\\") ? path.join(os.homedir(), value.slice(1)) : value;
}
