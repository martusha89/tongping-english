import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { pickTicketQuote, ticketMoodFromAudio } from "../src/mcp-server.js";

test("the quote is the latest short cue that has already played, never a future one", () => {
  const cues = [
    { startTime: 10, text: "很早的一句" },
    { startTime: 50, text: "你穿过那棵横倒的树" },
    { startTime: 58, text: "这一句实在太长了它会被跳过因为票根上放不下这么长的台词所以要选前面那句" },
    { startTime: 90, text: "还没播到的台词" },
  ];
  assert.equal(pickTicketQuote(cues, 60), "你穿过那棵横倒的树");
  assert.equal(pickTicketQuote(cues, 5), null);
  assert.equal(pickTicketQuote(cues, null), null);
  assert.equal(pickTicketQuote(undefined, 60), null);
});

test("mood is deterministic words, omitted when audio is thin", () => {
  assert.equal(
    ticketMoodFromAudio({ state: "steady", energy: 0.2, rhythmicDensity: 1 }),
    "steady · low energy · relaxed",
  );
  assert.equal(
    ticketMoodFromAudio({ state: "peak", energy: 0.9, rhythmicDensity: 5 }),
    "peak · high energy · rhythmically dense",
  );
  assert.equal(ticketMoodFromAudio(null), null);
  assert.equal(ticketMoodFromAudio({ state: null, energy: null }), null);
});

test("a stale page after a video switch contributes no title, quote or mood", () => {
  const app = fs.readFileSync(new URL("../src/browser-app.ts", import.meta.url), "utf8");
  assert.match(app, /Math\.abs\(data\.durationSeconds - companionSourceDuration\) > 1/);
  assert.match(app, /return \{ pageTitle: "", quote: null, mood: null \};/);
  const server = fs.readFileSync(new URL("../src/mcp-server.ts", import.meta.url), "utf8");
  assert.match(server, /"browser_watch_ticket",/);
  assert.match(server, /SHARED_TICKET_TTL_MS = 30 \* 60_000/);
});
