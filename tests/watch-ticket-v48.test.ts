import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(
  new URL("../src/browser-app.ts", import.meta.url),
  "utf8",
);
const daemon = fs.readFileSync(
  new URL("../src/daemon.ts", import.meta.url),
  "utf8",
);
const mcp = fs.readFileSync(
  new URL("../src/mcp-server.ts", import.meta.url),
  "utf8",
);

test("the ticket is a 3:1 stub drawn at 2x from the presented frame with real session fields", () => {
  for (const token of [
    'id="watchTicket"',
    'canvas.width = W;',
    'const W = 1800;',
    'const H = 600;',
    'captureCurrentDisplayedFrame()',
    'WATCH MEMORY TICKET',
    'WATCHED',
    'TOGETHER',
    'ADMIT TWO',
    'drawTicketBarcode(ctx, ticketNo',
    'return "MB-" + day + "-" + String(seq).padStart(3, "0");',
    'id="ticketDownload"',
    'id="ticketReframe"',
  ]) {
    assert.ok(app.includes(token), token);
  }
});

test("the ticket stays local: no AI ticket button and nothing sent to the AI", () => {
  assert.ok(!app.includes("ticketAiGenerate"), "AI ticket button removed");
  assert.ok(!app.includes("Generate AI memory ticket"));
  assert.ok(!app.includes("requestAiWatchTicket"));
  assert.ok(!app.includes('call("browser_app_ticket_share"'), "card never shares tickets with the AI");
  assert.ok(!app.includes("WATCH_TICKET_AI_REQUEST"));
  assert.ok(app.includes('id="ticketDownload"'));
});

test("collection mode is explicitly opt-in and default path does not create an id", () => {
  const init = app.indexOf("loadWatchCollectionLocalPrefs()");
  const ensure = app.indexOf("function ensureWatchCollectionId()");
  assert.ok(init >= 0);
  assert.ok(ensure >= 0);
  assert.ok(app.includes('safeLocalGet(WATCH_COLLECTION_ID_KEY)'));
  assert.ok(app.includes('showTicketPrivacy()'));
  assert.ok(app.includes('Agree and enable'));
  assert.ok(app.includes('Off by default'));
  assert.ok(app.includes('Original video and separate screenshots are not saved'));
  assert.ok(app.includes('Original video and separate screenshots are not saved'));
});

test("collection API supports enable disable add delete clear and destroy behind signed profile authority", () => {
  for (const token of [
    'url.pathname === "/v1/app/watch-collection"',
    'action === "enable"',
    'action === "disable"',
    'action === "add"',
    'action === "delete"',
    'action === "clear"',
    'action === "destroy"',
    'verifyBrowserLiveTicket',
  ]) {
    assert.ok(daemon.includes(token), token);
  }
  assert.ok(mcp.includes("watchCollectionUrl"));
  assert.ok(mcp.includes("createBrowserWatchCollectionUrl"));
});

test("collection stores finished ticket only, not a second raw frame field", () => {
  const store = fs.readFileSync(
    new URL("../src/watch-collection-store.ts", import.meta.url),
    "utf8",
  );
  assert.ok(store.includes("imageBase64"));
  assert.ok(!store.includes("sourceFrameBase64"));
  assert.ok(!store.includes("rawVideo"));
});

test("library UI exposes disable, delete and two-step clear semantics", () => {
  assert.ok(app.includes("disableWatchCollection"));
  assert.ok(app.includes('data-ticket-id'));
  assert.ok(app.includes('Select again to confirm'));
  assert.ok(app.includes('watchCollectionRequest("clear")'));
});

test("group chat has a two-tap clear that follows the server clear point", () => {
  assert.ok(app.includes('id="chatClear"'));
  assert.ok(app.includes('JSON.stringify({ action: "clear" })'));
  assert.ok(app.includes('button.textContent = "Confirm clear?";'));
  assert.ok(app.includes("dropClearedChat(data.clearedThroughSeq);"));
  assert.ok(!/\bconfirm\(/.test(app), "no browser dialogs inside the host");
});
