import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  createBrowserChatUrl,
  deriveBrowserAppSigningKey,
  verifyBrowserLiveTicket,
} from "../src/browser-app-ticket.js";

test("signed app chat URL reuses profile-bound live authority", () => {
  const key = deriveBrowserAppSigningKey("chat-test-token");
  const url = new URL(
    createBrowserChatUrl(
      "https://browser.example.test",
      key,
      "gpt-self",
      300,
      1_700_000_000_000,
    ),
  );
  assert.equal(url.pathname, "/v1/app/chat");
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

test("MCP server exposes one assistant mirror tool and app state chat URL", () => {
  const source = fs.readFileSync(
    new URL("../src/mcp-server.ts", import.meta.url),
    "utf8",
  );
  assert.equal(
    source.split('"browser_app_chat_push"').length - 1,
    1,
  );
  assert.match(source, /state.chatUrl = createBrowserChatUrl/);
  assert.match(source, /role: "assistant"/);
  assert.match(source, /Post your reply into the TongPing group chat/);
});

test("daemon exposes signed direct chat GET and POST routes", () => {
  const source = fs.readFileSync(
    new URL("../src/daemon.ts", import.meta.url),
    "utf8",
  );
  assert.ok(source.includes('url.pathname === "/v1/app/chat"'));
  assert.match(source, /request.method === "POST"/);
  assert.match(source, /appChatLedger.push/);
  assert.match(source, /appChatLedger.read/);
  assert.match(source, /access-control-allow-origin/);
});

test("browser app renders both roles and requests exact reply mirroring", () => {
  const app = fs.readFileSync(
    new URL("../src/browser-app.ts", import.meta.url),
    "utf8",
  );
  assert.match(app, /class="chatMessages" id="chatMessages"/);
  assert.match(app, /chatRow.user/);
  assert.match(app, /chatRow.assistant/);
  assert.match(app, /white-space:pre-wrap/);
  assert.match(app, /Replying/);
  assert.match(app, /browser_app_chat_push exactly once/);
  assert.match(app, /FIRST ACTION of your reply, before writing any text/);
  assert.match(app, /shared-browser-v93/);
  assert.doesNotMatch(app, /id="lastAsk"/);
});

test("browser app uses textContent for chat message bodies", () => {
  const app = fs.readFileSync(
    new URL("../src/browser-app.ts", import.meta.url),
    "utf8",
  );
  assert.match(app, /body.textContent = message.text/);
  assert.doesNotMatch(app, /chatBubble[sS]{0,300}innerHTML/);
});


test("cached connector catalogs can relay through browser_read without touching the page", () => {
  const server = fs.readFileSync(
    new URL("../src/mcp-server.ts", import.meta.url),
    "utf8",
  );
  const app = fs.readFileSync(
    new URL("../src/browser-app.ts", import.meta.url),
    "utf8",
  );
  assert.match(server, /__tongping_chat_push__::/);
  assert.match(server, /compatibilityRelay: "browser_read"/);
  assert.match(app, /If browser_app_chat_push is not available/);
  assert.ok(app.includes("__tongping_chat_push__::"));
});
