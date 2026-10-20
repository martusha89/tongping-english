#!/usr/bin/env node
// TongPing group chat listener for AI running on this computer (Claude Code, Codex).
//
// Long-polls group chat and prints one JSON line per new message from you or another AI.
// An AI session monitors it in the background and wakes to reply on each output line.
//
//   npm run room:watch -- --me claude.code
//
// --me     Your name.entry identity (claude.code, gpt.codex…); omits your own messages (default claude.code)
// --from   Start after this seq (default: only new messages from now on)
//
// Read-only. Reply with MCP tool browser_app_chat_push; view the screen with browser_screenshot / browser_look.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
loadEnvFile(path.join(root, ".env"));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
// Same folding as src/identity-alias.ts, so a short --me still matches.
const LEGACY = { claude: "claude.chat", gpt: "gpt.chat", chatgpt: "gpt.chat", codex: "gpt.codex" };
const canonical = (value) => {
  const v = String(value || "").trim().toLowerCase();
  if (LEGACY[v]) return LEGACY[v];
  const dashed = /^(claude|gpt)-(chat|code|cloud|codex|work)(-\d+)?$/.exec(v);
  if (dashed) return dashed[1] + "." + dashed[2] + (dashed[3] || "");
  const terminal = /^claude-(?:opus|sonnet|fable|haiku)(-\d+)?$/.exec(v);
  return terminal ? "claude.code" + (terminal[1] || "") : v;
};
const me = canonical(opt("me", "claude.code"));

const home = path.resolve(expandHome(process.env.TONGPING_HOME?.trim() || path.join(os.homedir(), ".tongping")));
const tokenFile = path.join(home, "daemon", "worker-auth", "worker-token");
if (!fs.existsSync(tokenFile)) {
  console.error(`Cannot find ${tokenFile}. Run npm run up first and ensure TONGPING_HOME matches.`);
  process.exit(1);
}
const token = fs.readFileSync(tokenFile, "utf8").trim();
const origin = `http://127.0.0.1:${process.env.TONGPING_PORT?.trim() || "45921"}`;
const headers = { authorization: "Worker " + token };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function read(after, wait) {
  const url = `${origin}/v1/worker/room?after=${after}&wait=${wait}`;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout((wait + 15) * 1000) });
  if (!response.ok) throw new Error("room HTTP " + response.status);
  return response.json();
}

let after = Number(opt("from", "-1"));
if (!(after >= 0)) {
  // Start from "now": skip history so a restart does not replay old messages.
  after = (await read(0, 0)).latestSeq ?? 0;
}
console.log(JSON.stringify({ watching: true, me, after }));

let failures = 0;
for (;;) {
  try {
    const data = await read(after, 25);
    failures = 0;
    for (const m of data.messages ?? []) {
      after = Math.max(after, m.seq);
      if (m.role === "assistant" && m.identity === me) continue;
      console.log(JSON.stringify({
        seq: m.seq,
        from: m.role === "user" ? "user" : m.identity,
        text: m.text,
        look: m.text.startsWith("👀") || undefined,
        camera: m.text.startsWith("📷") || undefined,
        youAreMuted: (data.muted ?? []).includes(me) || undefined,
      }));
    }
    if (Number.isSafeInteger(data.latestSeq)) after = Math.max(after, data.latestSeq);
  } catch (error) {
    failures += 1;
    if (failures === 3) console.log(JSON.stringify({ warning: "Cannot connect to TongPing; retrying (is TongPing stopped?)", error: String(error.message || error) }));
    await sleep(Math.min(30_000, 2_000 * failures));
  }
}

function expandHome(value) {
  return value === "~" || value.startsWith("~/") || value.startsWith("~\\") ? path.join(os.homedir(), value.slice(1)) : value;
}
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && /^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && process.env[key] === undefined) process.env[key] = value;
  }
}
