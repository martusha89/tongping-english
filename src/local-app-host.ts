import crypto from "node:crypto";

export const LOCAL_APP_HOST_ASSET = "/assets/local-app-host-v1.js";
export const LOCAL_APP_COOKIE = "tongping_local_app";
export const LOCAL_APP_BRIDGE_ORIGIN = "http://127.0.0.1:45922";
export const LOCAL_APP_LAUNCH_TTL_MS = 60_000;
export const LOCAL_APP_SESSION_TTL_MS = 4 * 60 * 60 * 1_000;
export const LOCAL_APP_IDLE_TTL_MS = 30 * 60 * 1_000;

const IDENTITY_RE = /^[a-z0-9._-]{1,40}$/;
const PROFILE_RE = /^[a-zA-Z0-9._-]{1,64}$/;

export const LOCAL_APP_TOOL_ALLOWLIST = new Set([
  "browser_app_camera_frame",
  "browser_app_companion_seek_source",
  "browser_app_context_info",
  "browser_app_external_login_finish",
  "browser_app_external_login_start",
  "browser_app_history",
  "browser_app_image_link",
  "browser_app_key",
  "browser_app_look_share",
  "browser_app_navigate",
  "browser_app_refresh",
  "browser_app_reload",
  "browser_app_takeover",
  "browser_app_ticket_context",
  "browser_app_type",
  "browser_app_voice_transcribe",
  "browser_companion_context",
  "browser_screenshot",
]);

export type LocalAppLaunch = {
  code: string;
  identity: string;
  profile: string;
  bridgeOrigin: string;
  bridgeToken: string;
  expiresAt: number;
};

export type LocalAppSession = {
  id: string;
  csrf: string;
  identity: string;
  profile: string;
  bridgeOrigin: string;
  bridgeToken: string;
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number;
};

export class LocalAppSessionStore {
  private readonly launches = new Map<string, LocalAppLaunch>();
  private readonly sessions = new Map<string, LocalAppSession>();

  createLaunch(input: {
    identity: string;
    profile: string;
    bridgeOrigin?: string;
    bridgeToken: string;
  }, now = Date.now()): LocalAppLaunch {
    this.cleanup(now);
    const identity = validateLocalAppIdentity(input.identity);
    const profile = validateLocalAppProfile(input.profile);
    const bridgeOrigin = validateBridgeOrigin(
      input.bridgeOrigin ?? LOCAL_APP_BRIDGE_ORIGIN,
    );
    const bridgeToken = validateBridgeToken(input.bridgeToken);
    const launch: LocalAppLaunch = {
      code: randomToken(),
      identity,
      profile,
      bridgeOrigin,
      bridgeToken,
      expiresAt: now + LOCAL_APP_LAUNCH_TTL_MS,
    };
    this.launches.set(launch.code, launch);
    return launch;
  }

  consumeLaunch(code: string, now = Date.now()): LocalAppSession | null {
    this.cleanup(now);
    const launch = this.launches.get(code);
    if (!launch || launch.expiresAt <= now) return null;
    this.launches.delete(code);
    const session: LocalAppSession = {
      id: randomToken(),
      csrf: randomToken(),
      identity: launch.identity,
      profile: launch.profile,
      bridgeOrigin: launch.bridgeOrigin,
      bridgeToken: launch.bridgeToken,
      createdAt: now,
      lastUsedAt: now,
      expiresAt: now + LOCAL_APP_SESSION_TTL_MS,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string | null | undefined, now = Date.now()): LocalAppSession | null {
    this.cleanup(now);
    if (!id) return null;
    const session = this.sessions.get(id);
    if (!session) return null;
    if (
      session.expiresAt <= now ||
      now - session.lastUsedAt > LOCAL_APP_IDLE_TTL_MS
    ) {
      this.sessions.delete(id);
      return null;
    }
    session.lastUsedAt = now;
    return session;
  }

  revoke(id: string | null | undefined): void {
    if (id) this.sessions.delete(id);
  }

  cleanup(now = Date.now()): void {
    for (const [code, launch] of this.launches) {
      if (launch.expiresAt <= now) this.launches.delete(code);
    }
    for (const [id, session] of this.sessions) {
      if (
        session.expiresAt <= now ||
        now - session.lastUsedAt > LOCAL_APP_IDLE_TTL_MS
      ) {
        this.sessions.delete(id);
      }
    }
  }
}

export function validateLocalAppIdentity(value: unknown): string {
  if (typeof value !== "string" || !IDENTITY_RE.test(value)) {
    throw new Error("Invalid local app identity");
  }
  return value;
}

export function validateLocalAppProfile(value: unknown): string {
  if (typeof value !== "string" || !PROFILE_RE.test(value)) {
    throw new Error("Invalid local app profile");
  }
  return value;
}

export function validateBridgeOrigin(value: unknown): string {
  if (value !== LOCAL_APP_BRIDGE_ORIGIN) {
    throw new Error("Invalid local conversation bridge origin");
  }
  return value;
}

export function validateBridgeToken(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_-]{43,128}$/.test(value)
  ) {
    throw new Error("Invalid local conversation bridge token");
  }
  return value;
}

export function localAppCookie(
  sessionId: string,
  maxAgeSeconds = Math.floor(LOCAL_APP_SESSION_TTL_MS / 1000),
): string {
  return [
    `${LOCAL_APP_COOKIE}=${encodeURIComponent(sessionId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ].join("; ");
}

export function clearLocalAppCookie(): string {
  return localAppCookie("", 0);
}

export function cookieValue(
  cookieHeader: string | undefined,
  name: string,
): string | null {
  if (!cookieHeader) return null;
  for (const pair of cookieHeader.split(";")) {
    const at = pair.indexOf("=");
    if (at < 0) continue;
    if (pair.slice(0, at).trim() !== name) continue;
    try {
      return decodeURIComponent(pair.slice(at + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function localAppRequestOriginAllowed(
  origin: string | undefined,
  port: number,
): boolean {
  return (
    origin === `http://127.0.0.1:${port}` ||
    origin === `http://localhost:${port}`
  );
}

export function localAppRequestIsLoopback(
  remoteAddress: string | undefined,
): boolean {
  return (
    remoteAddress === "127.0.0.1" ||
    remoteAddress === "::1" ||
    remoteAddress === "::ffff:127.0.0.1"
  );
}

export function scopeLocalAppToolArguments(
  name: string,
  raw: unknown,
  session: Pick<LocalAppSession, "identity" | "profile">,
): Record<string, unknown> {
  if (!LOCAL_APP_TOOL_ALLOWLIST.has(name)) {
    throw new Error("Tool is not available to the standalone app");
  }
  const args =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : {};
  if (
    typeof args.identity === "string" &&
    args.identity !== session.identity
  ) {
    throw new Error("Standalone app identity mismatch");
  }
  if (typeof args.profile === "string" && args.profile !== session.profile) {
    throw new Error("Standalone app profile mismatch");
  }
  args.profile = session.profile;
  if (name.startsWith("browser_app_")) args.identity = session.identity;
  return args;
}

export function parseLocalMcpPayload(
  text: string,
  contentType: string | null,
  expectedId: number,
): Record<string, unknown> {
  const payloads: unknown[] = [];
  if (contentType?.includes("text/event-stream")) {
    for (const event of text.split(/\r?\n\r?\n/)) {
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trimStart())
        .join("\n")
        .trim();
      if (data) payloads.push(JSON.parse(data));
    }
  } else {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) payloads.push(...parsed);
    else payloads.push(parsed);
  }
  const message = payloads.find(
    (value) =>
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as { id?: unknown }).id === expectedId,
  ) as { result?: unknown; error?: { message?: unknown } } | undefined;
  if (!message) throw new Error("Local MCP response was empty");
  if (message.error) {
    throw new Error(
      typeof message.error.message === "string"
        ? message.error.message
        : "Local MCP request failed",
    );
  }
  if (!message.result || typeof message.result !== "object") {
    throw new Error("Local MCP response was invalid");
  }
  return message.result as Record<string, unknown>;
}

export function renderLocalAppHostPage(
  session: LocalAppSession,
  nonce: string,
): string {
  const config = safeInlineJson({
    csrf: session.csrf,
    identity: session.identity,
    profile: session.profile,
  });
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="referrer" content="no-referrer">
  <title>TongPing · Local Room</title>
  <style nonce="${escapeHtml(nonce)}">
    :root{color-scheme:dark;--ink:#08090b;--panel:#101216;--line:rgba(255,255,255,.11);--text:#f4efe8;--muted:#9b9da4;--live:#ef6f51}
    *{box-sizing:border-box}
    html,body{width:100%;height:100%;margin:0;background:var(--ink);color:var(--text);font-family:"Segoe UI Variable Text","Aptos",sans-serif;overflow:hidden}
    body:before{content:"";position:fixed;inset:0;pointer-events:none;background:radial-gradient(circle at 12% 0%,rgba(239,111,81,.12),transparent 32%),linear-gradient(115deg,transparent 0 48%,rgba(255,255,255,.025) 48.1% 48.25%,transparent 48.35%);opacity:.9}
    .room{position:relative;width:100%;height:100%;display:grid;grid-template-rows:46px minmax(0,1fr);padding:10px;gap:8px}
    .bar{display:flex;align-items:center;gap:12px;padding:0 14px;border:1px solid var(--line);border-radius:14px;background:rgba(16,18,22,.88);backdrop-filter:blur(18px);box-shadow:0 20px 55px rgba(0,0,0,.35)}
    .mark{display:flex;align-items:center;gap:9px;font-weight:750;letter-spacing:.01em}
    .pulse{width:9px;height:9px;border-radius:50%;background:var(--live);box-shadow:0 0 0 5px rgba(239,111,81,.12),0 0 22px rgba(239,111,81,.6)}
    .detail{font:600 11px/1.2 ui-monospace,"Cascadia Code",monospace;color:var(--muted);letter-spacing:.08em;text-transform:uppercase}
    .spacer{flex:1}
    #status{font-size:12px;color:var(--muted)}
    .stage{position:relative;min-height:0;border:1px solid var(--line);border-radius:18px;overflow:hidden;background:#0c0d10;box-shadow:0 28px 80px rgba(0,0,0,.48)}
    iframe{display:block;width:100%;height:100%;border:0;background:#0c0d10}
    .fatal{position:absolute;inset:0;display:none;place-items:center;padding:32px;background:#0c0d10;text-align:center}
    .fatal.on{display:grid}
    .fatal strong{display:block;font-size:24px;margin-bottom:8px}
    .fatal p{max-width:560px;margin:0;color:var(--muted);line-height:1.55}
    body[data-mode="fullscreen"] .room{padding:0;grid-template-rows:0 minmax(0,1fr);gap:0}
    body[data-mode="fullscreen"] .bar{opacity:0;pointer-events:none}
    body[data-mode="fullscreen"] .stage{border:0;border-radius:0}
    @media(max-width:720px){.room{padding:0;gap:0;grid-template-rows:42px minmax(0,1fr)}.bar{border-radius:0;border-left:0;border-right:0}.detail{display:none}.stage{border-radius:0;border-left:0;border-right:0}}
  </style>
</head>
<body>
  <main class="room">
    <header class="bar">
      <div class="mark"><span class="pulse"></span><span>TongPing</span></div>
      <span class="detail">Local room · ${escapeHtml(session.profile)}</span>
      <span class="spacer"></span>
      <span id="status">Connecting the room…</span>
    </header>
    <section class="stage">
      <iframe id="card" title="TongPing shared browser and group chat" allow="camera; microphone; clipboard-write" sandbox="allow-scripts allow-forms allow-downloads allow-popups"></iframe>
      <div class="fatal" id="fatal"><div><strong>The room could not open.</strong><p id="fatalText">Ask Hearthside to open the TongPing room again.</p></div></div>
    </section>
  </main>
  <script id="tongping-local-config" type="application/json" nonce="${escapeHtml(nonce)}">${config}</script>
  <script type="module" src="${LOCAL_APP_HOST_ASSET}"></script>
</body>
</html>`;
}

export function renderLocalAppLaunchRequiredPage(nonce: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>TongPing · Local Room</title><style nonce="${escapeHtml(nonce)}">html{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#090a0c;color:#f3eee7;font-family:"Segoe UI Variable Text","Aptos",sans-serif}.card{max-width:560px;margin:24px;padding:34px;border:1px solid rgba(255,255,255,.12);border-radius:22px;background:#111318;box-shadow:0 30px 90px rgba(0,0,0,.5)}b{font-size:24px}p{color:#a6a8ae;line-height:1.6}</style></head><body><section class="card"><b>Open this room from Hearthside.</b><p>Ask your Hearthside agent to open the TongPing room. Hearthside will create a short-lived local session and open the full TongPing card without putting the daemon token in this browser.</p></section></body></html>`;
}

function randomToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function safeInlineJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
