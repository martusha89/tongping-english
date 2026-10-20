import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  LOCAL_APP_COOKIE,
  LOCAL_APP_SESSION_TTL_MS,
  LocalAppSessionStore,
  clearLocalAppCookie,
  cookieValue,
  localAppCookie,
  localAppRequestIsLoopback,
  localAppRequestOriginAllowed,
  parseLocalMcpPayload,
  renderLocalAppHostPage,
  scopeLocalAppToolArguments,
} from "../src/local-app-host.js";

test("local app launch codes are one-use and sessions expire", () => {
  const store = new LocalAppSessionStore();
  const now = 1_800_000_000_000;
  const launch = store.createLaunch(
    {
      identity: "cassian.varen",
      profile: "cass-marta",
      bridgeOrigin: "http://127.0.0.1:45922",
      bridgeToken: "A".repeat(43),
    },
    now,
  );
  const session = store.consumeLaunch(launch.code, now + 1);
  assert.ok(session);
  assert.equal(store.consumeLaunch(launch.code, now + 2), null);
  assert.equal(session.identity, "cassian.varen");
  assert.equal(session.profile, "cass-marta");
  assert.ok(store.get(session.id, now + 3));
  assert.equal(store.get(session.id, now + LOCAL_APP_SESSION_TTL_MS + 1), null);
});

test("local app cookie is host-only, HttpOnly, strict, and expiring", () => {
  const header = localAppCookie("session-value");
  assert.match(header, new RegExp(`^${LOCAL_APP_COOKIE}=session-value;`));
  assert.match(header, /Path=\//);
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Strict/);
  assert.match(header, /Max-Age=14400/);
  assert.doesNotMatch(header, /Domain=/);
  assert.equal(
    cookieValue(`${header}; another=value`, LOCAL_APP_COOKIE),
    "session-value",
  );
  assert.match(clearLocalAppCookie(), /Max-Age=0/);
});

test("local app host page contains no daemon credential or browser storage", () => {
  const store = new LocalAppSessionStore();
  const session = store.consumeLaunch(
    store.createLaunch({
      identity: "cassian.varen",
      profile: "cass-marta",
      bridgeToken: "B".repeat(43),
    }).code,
  );
  assert.ok(session);
  const html = renderLocalAppHostPage(session, "nonce-value");
  assert.match(html, /TongPing · Local Room/);
  assert.match(html, /id="card"/);
  assert.match(html, /local-app-host-v1\.js/);
  assert.doesNotMatch(html, /daemon-token|TONGPING_TOKEN|authorization/i);
  assert.doesNotMatch(html, /45922|bridgeToken|bridgeOrigin/);
  assert.doesNotMatch(html, /localStorage|sessionStorage|indexedDB/);
});

test("standalone app tools are closed and bound to one identity/profile", () => {
  const session = { identity: "cassian.varen", profile: "cass-marta" };
  assert.deepEqual(
    scopeLocalAppToolArguments(
      "browser_app_refresh",
      { identity: "cassian.varen", profile: "cass-marta", appUiBuild: "v93" },
      session,
    ),
    {
      identity: "cassian.varen",
      profile: "cass-marta",
      appUiBuild: "v93",
    },
  );
  assert.throws(
    () => scopeLocalAppToolArguments("browser_open", {}, session),
    /not available/,
  );
  assert.throws(
    () =>
      scopeLocalAppToolArguments(
        "browser_app_refresh",
        { identity: "gpt.chat" },
        session,
      ),
    /identity mismatch/,
  );
  assert.throws(
    () =>
      scopeLocalAppToolArguments(
        "browser_screenshot",
        { profile: "other" },
        session,
      ),
    /profile mismatch/,
  );
});

test("standalone app access is loopback and exact-origin only", () => {
  assert.equal(localAppRequestIsLoopback("127.0.0.1"), true);
  assert.equal(localAppRequestIsLoopback("::1"), true);
  assert.equal(localAppRequestIsLoopback("::ffff:127.0.0.1"), true);
  assert.equal(localAppRequestIsLoopback("192.168.1.8"), false);
  assert.equal(
    localAppRequestOriginAllowed("http://127.0.0.1:45921", 45921),
    true,
  );
  assert.equal(
    localAppRequestOriginAllowed("https://example.com", 45921),
    false,
  );
});

test("local MCP parser supports JSON and multiline SSE framing", () => {
  assert.deepEqual(
    parseLocalMcpPayload(
      JSON.stringify({ jsonrpc: "2.0", id: 7, result: { ok: true } }),
      "application/json",
      7,
    ),
    { ok: true },
  );
  assert.deepEqual(
    parseLocalMcpPayload(
      'event: message\ndata: {"jsonrpc":"2.0","id":8,\ndata: "result":{"ok":true}}\n\n',
      "text/event-stream",
      8,
    ),
    { ok: true },
  );
});

test("generated host bundle exists and never stores credentials", () => {
  const bundle = fs.readFileSync(
    new URL("../assets/local-app-host-v1.js", import.meta.url),
    "utf8",
  );
  assert.ok(bundle.length > 10_000);
  assert.match(bundle, /tongping-local-host/);
  assert.doesNotMatch(bundle, /localStorage|sessionStorage|TONGPING_TOKEN/);
});

test("local host uses the official bridge and daemon keeps the MCP token server-side", () => {
  const client = fs.readFileSync(
    new URL("../src/local-app-host-client.ts", import.meta.url),
    "utf8",
  );
  const daemon = fs.readFileSync(
    new URL("../src/daemon.ts", import.meta.url),
    "utf8",
  );
  assert.match(client, /new AppBridge\(/);
  assert.match(client, /new PostMessageTransport\(/);
  assert.match(client, /bridge\.oncalltool/);
  assert.match(client, /bridge\.onmessage/);
  assert.match(client, /bridge\.onupdatemodelcontext/);
  assert.match(client, /bridge\.sendToolInput/);
  assert.match(client, /bridge\.sendToolResult/);
  assert.doesNotMatch(client, /TONGPING_TOKEN|daemon-token/);
  assert.match(daemon, /url\.pathname === "\/v1\/local-app\/launch"/);
  assert.match(daemon, /request\.method === "POST"[\s\S]*url\.pathname === "\/v1\/local-app\/bootstrap"/);
  assert.match(daemon, /url\.pathname === "\/v1\/local-app\/tool"/);
  assert.match(daemon, /authorization: `Bridge \$\{session\.bridgeToken\}`/);
  assert.match(daemon, /scopeLocalAppToolArguments/);
  assert.match(daemon, /authorization: `Bearer \$\{token\}`/);
});
