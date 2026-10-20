#!/usr/bin/env node
// TongPing Personal Edition self-test: with `npm run up` already running,
// exercise three workflows through the real MCP protocol:
//   1. Browsing: open a page and read its title and text
//   2. Video: open a page with <video>, read media state (playback time advances)
//   3. Chat: AI posts → another AI reads; human posts in card → AI reads
// Usage: npm run selftest            (connects to http://127.0.0.1:45921 by default)
//       npm run selftest -- --video https://example.com/some-video-page
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import WebSocket from "ws";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
loadEnvFile(path.join(root, ".env"));
const port = process.env.TONGPING_PORT?.trim() || "45921";
const base = (process.env.TONGPING_SELFTEST_URL?.trim() || `http://127.0.0.1:${port}`).replace(/\/+$/, "");
const home = path.resolve(expandHome(process.env.TONGPING_HOME?.trim() || path.join(os.homedir(), ".tongping")));
const tokenFile = path.join(home, "daemon", "daemon-token");
const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const PAGE_URL = argValue("--page", "https://example.com/");
// A 5-second CC0 clip from MDN (reachable from mainland China); Chrome autoplays a direct .mp4.
const VIDEO_URL = argValue("--video", "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4");
const PROFILE = argValue("--profile", "selftest");

if (!existsSync(tokenFile)) {
  fail(`Daemon token not found at ${tokenFile}. Run npm run up first and use the same TONGPING_HOME as at startup.`);
}
const token = readFileSync(tokenFile, "utf8").trim();
let sessionId = "";
let rpcId = 0;
const results = [];

async function rpc(method, params, { notify = false } = {}) {
  const body = { jsonrpc: "2.0", method, params };
  if (!notify) body.id = ++rpcId;
  const response = await fetch(base + "/mcp", {
    method: "POST",
    headers: {
      authorization: "Bearer " + token,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify(body),
  });
  sessionId = response.headers.get("mcp-session-id") || sessionId;
  if (notify) return null;
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status} ${text.slice(0, 300)}`);
  const json = text.trim().startsWith("{")
    ? JSON.parse(text)
    : JSON.parse(text.split("\n").filter((l) => l.startsWith("data:")).pop().slice(5));
  if (json.error) throw new Error(JSON.stringify(json.error));
  return json.result;
}

async function tool(name, toolArgs) {
  const result = await rpc("tools/call", { name, arguments: toolArgs });
  const text = (result.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  if (result.isError) throw new Error(`${name}: ${text.slice(0, 400)}`);
  let parsed = null;
  try { parsed = JSON.parse(text); } catch {}
  return { result, text, json: parsed ?? result.structuredContent ?? null };
}

async function step(label, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ label, ok: true, detail, ms: Date.now() - started });
    console.log(`✅ ${label}  ${detail ?? ""}`);
  } catch (error) {
    results.push({ label, ok: false, detail: String(error?.message ?? error), ms: Date.now() - started });
    console.log(`❌ ${label}  ${String(error?.message ?? error).slice(0, 500)}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`TongPing self-test → ${base}  (profile=${PROFILE})\n`);

await step("health: daemon online, worker connected", async () => {
  const health = await (await fetch(base + "/health")).json();
  if (!health.ok) throw new Error("health.ok=false");
  if (!health.worker?.connected) throw new Error("Worker not connected: check [worker] errors in the npm run up window");
  return `workerBuild=${health.workerBuild}`;
});

await step("MCP handshake + tool list", async () => {
  const init = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "tongping-selftest", version: "1" },
  });
  await rpc("notifications/initialized", {}, { notify: true });
  const list = await rpc("tools/list", {});
  const names = list.tools.map((t) => t.name);
  for (const must of ["browser_open", "browser_read", "browser_app", "browser_app_chat_push", "browser_app_room_read"]) {
    if (!names.includes(must)) throw new Error("Missing tool " + must);
  }
  return `${init.serverInfo?.name} · ${names.length} tools`;
});

await step("Browsing: open a page and read its text", async () => {
  // A Chrome launch can stall once (antivirus scan, leftover process).
  // Retry a single time before calling it a failure.
  try {
    await tool("browser_open", { profile: PROFILE, url: PAGE_URL });
  } catch (error) {
    if (!/did not answer in time|Timeout \d+ms exceeded/.test(String(error?.message))) throw error;
    console.log("   …Browser startup timed out; retrying once automatically");
    await sleep(5_000);
    await tool("browser_open", { profile: PROFILE, url: PAGE_URL });
  }
  const read = await tool("browser_read", { profile: PROFILE });
  const blob = read.text;
  if (!/Example Domain|example/i.test(blob) && PAGE_URL.includes("example.com")) {
    throw new Error("Could not read example.com text: " + blob.slice(0, 200));
  }
  return `Read ${blob.length} characters`;
});

await step("Video: open a video page and read playback state", async () => {
  await tool("browser_open", { profile: PROFILE, url: VIDEO_URL });
  await sleep(1_000);
  // Start playback the way a user would: a real click on the video element.
  const snap = await tool("browser_snapshot", { profile: PROFILE });
  const first = await tool("browser_media_context", { profile: PROFILE, lookbackSeconds: 30, maxCues: 5 });
  const media = findMedia(first.json);
  if (!media) throw new Error("No readable <video> found on the page: " + first.text.slice(0, 300));
  if (media.paused !== false) {
    // Autoplay is often blocked; press play through the page itself.
    const ref = findVideoRef(snap.json);
    if (ref) await tool("browser_click", { profile: PROFILE, ref }).catch(() => {});
    else await tool("browser_press", { profile: PROFILE, key: "k" }).catch(() => {});
    await sleep(3_000);
  }
  const t1 = findMedia((await tool("browser_media_context", { profile: PROFILE, lookbackSeconds: 30, maxCues: 5 })).json);
  await sleep(1_500);
  const t2 = findMedia((await tool("browser_media_context", { profile: PROFILE, lookbackSeconds: 30, maxCues: 5 })).json);
  const advanced = t1 && t2 && Number(t2.currentTime) > Number(t1.currentTime);
  const finished = t2 && Number(t2.currentTime) > 0 && Number(t2.duration) > 0 &&
    Number(t2.currentTime) >= Number(t2.duration) - 0.25;
  if (finished && !advanced) return `Clip finished playing (${Number(t2.duration).toFixed(1)}s)`;
  if (!advanced) {
    throw new Error(`Video playback time did not advance (${t1?.currentTime} → ${t2?.currentTime}, paused=${t2?.paused})`);
  }
  return `currentTime ${Number(t1.currentTime).toFixed(1)}s → ${Number(t2.currentTime).toFixed(1)}s, duration ${t2.duration ?? "?"}s`;
});

await step("Video: capture a frame", async () => {
  const shot = await rpc("tools/call", { name: "browser_screenshot", arguments: { profile: PROFILE } });
  const image = (shot.content ?? []).find((c) => c.type === "image");
  if (!image) throw new Error("No image in screenshot result");
  return `JPEG/PNG base64 ${image.data.length} characters`;
});

let ticket = null;
let liveUrl = null;
let mediaUrl = null;
let hlsUrl = null;
await step("Open TongPing card (obtain a card ticket)", async () => {
  const app = await tool("browser_app", { profile: PROFILE, identity: "claude.code" });
  ticket = findChatTicket(app.result);
  liveUrl = findUrl(app.result, /\/v1\/app\/live-ws\?/);
  mediaUrl = findUrl(app.result, /\/v1\/app\/media-ws\?/);
  hlsUrl = findUrl(app.result, /\/v1\/app\/companion-hls\?/);
  if (!ticket) throw new Error("No chat ticket in browser_app result");
  if (!liveUrl) throw new Error("No live-ws URL in browser_app result (worker too old?)");
  return "ok";
});

await step("Video: card live view (continuous WebSocket frames)", async () => {
  if (!liveUrl) throw new Error("Previous step did not obtain a live-ws URL");
  await tool("browser_open", { profile: PROFILE, url: VIDEO_URL });
  const stats = await new Promise((resolve, reject) => {
    const ws = new WebSocket(liveUrl, { headers: { origin: base } });
    let frames = 0, bytes = 0;
    const timer = setTimeout(() => { ws.close(); resolve({ frames, bytes }); }, 6_000);
    ws.on("message", (data, isBinary) => {
      if (!isBinary) return;
      frames++; bytes += data.length;
      // Same flow control as the card: acknowledge each presented frame.
      ws.send(JSON.stringify({ type: "frame_ready", outcome: "presented", presentedAt: Date.now() }));
    });
    ws.on("error", (error) => { clearTimeout(timer); reject(error); });
    ws.on("close", (code) => { if (frames === 0 && code !== 1005) { clearTimeout(timer); reject(new Error("live-ws closed with code=" + code)); } });
  });
  if (stats.frames < 5) throw new Error(`Only ${stats.frames} frames in 6 seconds (expected ≥5)`);
  return `Received ${stats.frames} frames in 6 seconds, ${Math.round(stats.bytes / 1024)} KB`;
});

const hasFfmpeg = (() => {
  try { return spawnSync("ffmpeg", ["-version"], { stdio: "ignore", windowsHide: true }).status === 0; } catch { return false; }
})();
if (!hasFfmpeg) {
  console.log("⏭️  Watch Together: skipped (ffmpeg not found; install it, reopen the terminal, and rerun the self-test to check this)");
} else {
  await step("Video: Watch Together buffer produces segments (ffmpeg → HLS)", async () => {
    if (!mediaUrl || !hlsUrl) throw new Error("No Watch Together URLs in browser_app result");
    await tool("browser_open", { profile: PROFILE, url: VIDEO_URL });
    const ws = new WebSocket(mediaUrl, { headers: { origin: base } });
    await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
    ws.send(JSON.stringify({ type: "companion_ready" }));
    const playlistUrl = new URL(hlsUrl);
    playlistUrl.searchParams.set("delay", "8");
    let playlist = "";
    const deadline = Date.now() + 60_000;
    try {
      while (Date.now() < deadline) {
        await sleep(2_000);
        // The sample clip is only 5 s; replay it so the recorder keeps getting
        // moving frames (a still page buffers far slower than real time).
        const media = findMedia((await tool("browser_media_context", { profile: PROFILE, lookbackSeconds: 5, maxCues: 1 })).json);
        if (media && (media.ended || media.paused || Number(media.currentTime) >= Number(media.duration) - 0.3)) {
          const ref = findVideoRef((await tool("browser_snapshot", { profile: PROFILE })).json);
          if (ref) await tool("browser_click", { profile: PROFILE, ref }).catch(() => {});
        }
        playlist = await (await fetch(playlistUrl)).text();
        if ((playlist.match(/\.m4s/g) || []).length >= 2) break;
      }
      const segments = (playlist.match(/\.m4s/g) || []).length;
      if (segments < 2) {
        const buffered = /#TONGPING-BUFFERED-SECONDS:([0-9.]+)/.exec(playlist)?.[1];
        throw new Error(`No segments produced within 60 seconds (${buffered ?? "?"} seconds buffered). Check the companion item in npm run doctor`);
      }
      const init = /#EXT-X-MAP:URI="([^"]+)"/.exec(playlist)?.[1];
      if (!init) throw new Error("No init segment in playlist");
      const initResponse = await fetch(new URL(init, playlistUrl));
      if (!initResponse.ok) throw new Error(`Cannot fetch init segment: HTTP ${initResponse.status}`);
      const bytes = (await initResponse.arrayBuffer()).byteLength;
      return `${segments} segments, init ${bytes} bytes`;
    } finally {
      ws.close();
    }
  });
}

await step("Chat: AI posts → another AI reads it", async () => {
  const marker = "selftest-" + Date.now().toString(36);
  await tool("browser_app_chat_push", { identity: "claude.code", profile: PROFILE, text: "Hello, I am Claude in the self-test. " + marker });
  const read = await tool("browser_app_room_read", { identity: "gpt.chat", limit: 50 });
  const hit = (read.json?.unread ?? []).find((m) => String(m.text).includes(marker));
  if (!hit) throw new Error("gpt.chat did not read claude.code's message");
  return `gpt.chat read seq=${hit.seq} from=${hit.from}`;
});

await step("Chat: human posts in card → AI reads it", async () => {
  if (!ticket) throw new Error("Previous step did not obtain a ticket");
  const marker = "human-" + Date.now().toString(36);
  const url = new URL(ticket);
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "(Self-test) Human says: Are you there? " + marker, clientId: marker }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Card message failed: HTTP ${response.status} ${body.slice(0, 200)}`);
  await sleep(300);
  const read = await tool("browser_app_room_read", { identity: "claude.code", limit: 50 });
  const hit = (read.json?.unread ?? []).find((m) => String(m.text).includes(marker));
  if (!hit) throw new Error("claude.code did not read the human message");
  return `claude.code read from=${hit.from}`;
});

await step("Cleanup: close the self-test browser pages", async () => {
  await tool("browser_close_profile", { profile: PROFILE }).catch(() => {});
  return "ok";
});

const failed = results.filter((r) => !r.ok);
console.log("");
console.log(failed.length ? `Self-test finished: ${failed.length} checks failed (send the full output above to AI and ask it to read docs/TROUBLESHOOTING.md)` : "All self-tests passed 🎉");
process.exit(failed.length ? 1 : 0);

function findMedia(value) {
  let found = null;
  walk(value, (node) => {
    if (!found && node && typeof node === "object" && "currentTime" in node && ("paused" in node || "duration" in node)) found = node;
  });
  return found;
}

function findVideoRef(value) {
  let ref = null;
  walk(value, (node) => {
    if (!ref && node && typeof node === "object" && typeof node.ref === "string") {
      const tag = String(node.tag ?? node.role ?? node.kind ?? "").toLowerCase();
      if (tag.includes("video")) ref = node.ref;
    }
  });
  return ref;
}

function findUrl(value, pattern) {
  let url = null;
  walk(value, (node) => { if (!url && typeof node === "string" && pattern.test(node) && /^wss?:|^https?:/.test(node)) url = node; });
  return url;
}

function findChatTicket(value) {
  let url = null;
  walk(value, (node) => {
    if (!url && typeof node === "string" && /\/v1\/app\/chat\?/.test(node)) url = node;
  });
  if (url) return url.replace(/^wss?:/, (m) => (m === "wss:" ? "https:" : "http:"));
  return null;
}

function walk(value, visit, depth = 0) {
  if (depth > 40) return;
  visit(value);
  if (typeof value === "string" && value.length > 2 && (value[0] === "{" || value[0] === "[")) {
    try { walk(JSON.parse(value), visit, depth + 1); } catch {}
    return;
  }
  if (Array.isArray(value)) for (const item of value) walk(item, visit, depth + 1);
  else if (value && typeof value === "object") for (const key of Object.keys(value)) walk(value[key], visit, depth + 1);
}

function loadEnvFile(file) {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && /^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && process.env[key] === undefined) process.env[key] = value;
  }
}

function expandHome(value) {
  return value === "~" || value.startsWith("~/") || value.startsWith("~\\") ? path.join(os.homedir(), value.slice(1)) : value;
}

function fail(message) {
  console.error("Error: " + message);
  process.exit(1);
}
