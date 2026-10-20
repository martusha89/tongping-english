import crypto from "node:crypto";
import fs from "node:fs/promises";
import { isIP } from "node:net";
import type http from "node:http";

type ClientRecord = {
  client_id: string;
  redirect_uris: string[];
  token_endpoint_auth_method: "none";
  grant_types: string[];
  response_types: string[];
  scope: string;
};

type CodeRecord = {
  client_id: string;
  redirect_uri: string;
  challenge: string;
  scope: string;
  exp: number;
};

type TokenRecord = {
  client_id: string;
  scope: string;
  exp: number;
};

type RefreshRecord = {
  client_id: string;
  scope: string;
};

type Store = {
  clients: Record<string, ClientRecord>;
  codes: Record<string, CodeRecord>;
  tokens: Record<string, TokenRecord>;
  refresh: Record<string, RefreshRecord>;
};

const CODE_TTL = 300;
const TOKEN_TTL = 30 * 24 * 3600;
const PASSWORD_FAILURE_WINDOW_MS = 10 * 60_000;
const PASSWORD_FAILURE_LIMIT = 10;

export class TongpingOAuthService {
  private store: Store = emptyStore();
  private readonly passwordFailures = new Map<string, number[]>();

  constructor(
    private readonly publicUrl: string,
    private readonly password: string,
    private readonly storeFile: string,
    private readonly clockMs: () => number = Date.now,
    private readonly trustedProxyAddresses: readonly string[] = [],
  ) {}

  async init(): Promise<void> {
    try {
      const parsed = JSON.parse(
        await fs.readFile(this.storeFile, "utf8"),
      ) as Partial<Store>;
      this.store = {
        clients: parsed.clients ?? {},
        codes: parsed.codes ?? {},
        tokens: parsed.tokens ?? {},
        refresh: parsed.refresh ?? {},
      };
    } catch {
      this.store = emptyStore();
    }
    await this.gc();
  }

  enabled(): boolean {
    return Boolean(this.publicUrl && this.password);
  }

  tokenValid(token: string): boolean {
    if (!token) return false;
    const rec = this.store.tokens[token];
    return Boolean(rec && rec.exp > now());
  }

  // v90: lets the MCP factory tell which host (Claude / ChatGPT) holds a
  // token, so per-host card metadata can differ.
  tokenRedirectUris(token: string): string[] {
    const rec = token ? this.store.tokens[token] : undefined;
    if (!rec || rec.exp <= now()) return [];
    return this.store.clients[rec.client_id]?.redirect_uris ?? [];
  }

  wwwAuthenticate(resourcePath = "/mcp"): string {
    const path =
      resourcePath.startsWith("/") ? resourcePath : `/${resourcePath}`;
    return (
      `Bearer resource_metadata="${this.publicUrl}` +
      `/.well-known/oauth-protected-resource${path}"`
    );
  }

  async handle(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
  ): Promise<boolean> {
    if (
      request.method === "GET" &&
      url.pathname.startsWith(
        "/.well-known/oauth-authorization-server",
      )
    ) {
      sendJson(response, 200, {
        issuer: this.publicUrl,
        authorization_endpoint: `${this.publicUrl}/oauth/authorize`,
        token_endpoint: `${this.publicUrl}/oauth/token`,
        registration_endpoint: `${this.publicUrl}/oauth/register`,
        response_types_supported: ["code"],
        grant_types_supported: [
          "authorization_code",
          "refresh_token",
        ],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        scopes_supported: ["mcp", "offline_access"],
      });
      return true;
    }

    if (
      request.method === "GET" &&
      url.pathname.startsWith(
        "/.well-known/oauth-protected-resource",
      )
    ) {
      const prefix = "/.well-known/oauth-protected-resource";
      const suffix = url.pathname
        .slice(prefix.length)
        .replace(/\/+$/, "");
      sendJson(response, 200, {
        resource: suffix ? this.publicUrl + suffix : this.publicUrl,
        authorization_servers: [this.publicUrl],
        bearer_methods_supported: ["header"],
        scopes_supported: ["mcp"],
      });
      return true;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/oauth/register"
    ) {
      const body = await readJson(request);
      const redirectUris = stringArray(body.redirect_uris);
      if (!redirectUris.length || redirectUris.some((uri) => !isAllowedRedirectUri(uri))) {
        sendJson(response, 400, {
          error: "invalid_client_metadata",
          error_description: "redirect_uris must use HTTPS or loopback HTTP without credentials or fragments",
        });
        return true;
      }
      const clientId = `mb-${crypto.randomBytes(12).toString("base64url")}`;
      const rec: ClientRecord = {
        client_id: clientId,
        redirect_uris: redirectUris,
        token_endpoint_auth_method: "none",
        grant_types: stringArray(body.grant_types).length
          ? stringArray(body.grant_types)
          : ["authorization_code", "refresh_token"],
        response_types: stringArray(body.response_types).length
          ? stringArray(body.response_types)
          : ["code"],
        scope:
          typeof body.scope === "string" && body.scope.trim()
            ? body.scope.trim()
            : "mcp offline_access",
      };
      this.store.clients[clientId] = rec;
      await this.save();
      sendJson(response, 201, {
        ...rec,
        client_id_issued_at: now(),
      });
      return true;
    }

    if (
      url.pathname === "/oauth/authorize" &&
      (request.method === "GET" || request.method === "POST")
    ) {
      const params =
        request.method === "GET"
          ? Object.fromEntries(url.searchParams.entries())
          : await readForm(request);
      if (request.method === "GET") {
        sendHtml(response, 200, loginPage(params));
        return true;
      }

      const supplied =
        typeof params._pw === "string" ? params._pw : "";
      const source = passwordAttemptSource(request, this.trustedProxyAddresses);
      const currentMs = this.clockMs();
      const recent = (this.passwordFailures.get(source) ?? [])
        .filter((at) => at > currentMs - PASSWORD_FAILURE_WINDOW_MS);
      if (recent.length >= PASSWORD_FAILURE_LIMIT) {
        response.setHeader("retry-after", String(Math.max(1, Math.ceil((recent[0]! + PASSWORD_FAILURE_WINDOW_MS - currentMs) / 1000))));
        sendHtml(response, 429, loginPage(params, "Too many attempts. Please try again later."));
        return true;
      }
      if (!safeEqual(supplied, this.password)) {
        recent.push(currentMs);
        this.passwordFailures.set(source, recent);
        sendHtml(
          response,
          401,
          loginPage(params, "Incorrect password. Please try again."),
        );
        return true;
      }
      this.passwordFailures.delete(source);

      const clientId = asString(params.client_id);
      const redirectUri = asString(params.redirect_uri);
      const challenge = asString(params.code_challenge);
      const challengeMethod =
        asString(params.code_challenge_method) || "S256";
      const state = asString(params.state);
      const client = this.store.clients[clientId];

      if (
        !client ||
        !redirectUri ||
        !challenge ||
        challengeMethod !== "S256"
      ) {
        sendJson(response, 400, { error: "invalid_request" });
        return true;
      }
      if (!isAllowedRedirectUri(redirectUri) || !client.redirect_uris.includes(redirectUri)) {
        sendJson(response, 400, {
          error: "invalid_redirect_uri",
        });
        return true;
      }

      const code = crypto.randomBytes(24).toString("base64url");
      this.store.codes[code] = {
        client_id: clientId,
        redirect_uri: redirectUri,
        challenge,
        scope: asString(params.scope) || "mcp offline_access",
        exp: now() + CODE_TTL,
      };
      await this.gc();
      await this.save();

      const target = new URL(redirectUri);
      target.searchParams.set("code", code);
      if (state) target.searchParams.set("state", state);
      response.writeHead(302, {
        location: target.toString(),
        "cache-control": "no-store",
      });
      response.end();
      return true;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/oauth/token"
    ) {
      const form = await readForm(request);
      const grant = asString(form.grant_type);

      if (grant === "authorization_code") {
        const code = asString(form.code);
        const verifier = asString(form.code_verifier);
        const redirectUri = asString(form.redirect_uri);
        const rec = this.store.codes[code];
        if (!rec || rec.exp <= now()) {
          sendJson(response, 400, { error: "invalid_grant" });
          return true;
        }
        if (
          !verifyPkce(verifier, rec.challenge) ||
          (redirectUri && redirectUri !== rec.redirect_uri)
        ) {
          sendJson(response, 400, { error: "invalid_grant" });
          return true;
        }

        delete this.store.codes[code];
        const access = crypto.randomBytes(32).toString("base64url");
        const refresh = crypto.randomBytes(32).toString("base64url");
        this.store.tokens[access] = {
          client_id: rec.client_id,
          scope: rec.scope,
          exp: now() + TOKEN_TTL,
        };
        this.store.refresh[refresh] = {
          client_id: rec.client_id,
          scope: rec.scope,
        };
        await this.gc();
        await this.save();
        sendJson(response, 200, {
          access_token: access,
          token_type: "Bearer",
          expires_in: TOKEN_TTL,
          refresh_token: refresh,
          scope: rec.scope,
        });
        return true;
      }

      if (grant === "refresh_token") {
        const refresh = asString(form.refresh_token);
        const rec = this.store.refresh[refresh];
        if (!rec) {
          sendJson(response, 400, { error: "invalid_grant" });
          return true;
        }
        const access = crypto.randomBytes(32).toString("base64url");
        this.store.tokens[access] = {
          client_id: rec.client_id,
          scope: rec.scope,
          exp: now() + TOKEN_TTL,
        };
        await this.gc();
        await this.save();
        sendJson(response, 200, {
          access_token: access,
          token_type: "Bearer",
          expires_in: TOKEN_TTL,
          refresh_token: refresh,
          scope: rec.scope,
        });
        return true;
      }

      sendJson(response, 400, {
        error: "unsupported_grant_type",
      });
      return true;
    }

    return false;
  }

  private async gc(): Promise<void> {
    const n = now();
    this.store.codes = Object.fromEntries(
      Object.entries(this.store.codes).filter(
        ([, rec]) => rec.exp > n,
      ),
    );
    this.store.tokens = Object.fromEntries(
      Object.entries(this.store.tokens).filter(
        ([, rec]) => rec.exp > n,
      ),
    );
  }

  private async save(): Promise<void> {
    const idx = this.storeFile.lastIndexOf("/");
    if (idx > 0) {
      await fs.mkdir(this.storeFile.slice(0, idx), {
        recursive: true,
      });
    }
    const tmp = `${this.storeFile}.tmp`;
    await fs.writeFile(
      tmp,
      JSON.stringify(this.store),
      { encoding: "utf8", mode: 0o600 },
    );
    await fs.rename(tmp, this.storeFile);
  }
}

function emptyStore(): Store {
  return { clients: {}, codes: {}, tokens: {}, refresh: {} };
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function passwordAttemptSource(
  request: http.IncomingMessage,
  trustedProxyAddresses: readonly string[],
): string {
  const peer = normalizeIp(request.socket.remoteAddress ?? "") || "unknown";
  const trustedLocalProxy = isLoopbackIp(peer) &&
    trustedProxyAddresses.some((address) => normalizeIp(address) === peer);
  if (!trustedLocalProxy) return peer;

  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded !== "string") return peer;
  // Caddy owns the header on this trusted connection. The rightmost address
  // is the nearest external hop when a trusted upstream chain is present.
  const client = normalizeIp(forwarded.split(",").at(-1)?.trim() ?? "");
  return client || peer;
}

function normalizeIp(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized.startsWith("::ffff:") && isIP(normalized.slice(7)) === 4) {
    return normalized.slice(7);
  }
  return isIP(normalized) ? normalized : "";
}

function isLoopbackIp(value: string): boolean {
  return value === "::1" || value.startsWith("127.");
}

function isAllowedRedirectUri(raw: string): boolean {
  if (!raw || raw !== raw.trim() || raw.includes("\\")) return false;
  let uri: URL;
  try {
    uri = new URL(raw);
  } catch {
    return false;
  }
  if (uri.username || uri.password || uri.hash) return false;
  if (uri.protocol === "https:") return true;
  return uri.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(uri.hostname.toLowerCase());
}

function verifyPkce(verifier: string, challenge: string): boolean {
  if (!verifier || !challenge) return false;
  const calc = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return safeEqual(calc, challenge);
}

function safeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

async function readBody(
  request: http.IncomingMessage,
  limit = 64 * 1024,
): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > limit) throw new Error("OAuth request body too large");
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readJson(
  request: http.IncomingMessage,
): Promise<Record<string, unknown>> {
  try {
    const raw = await readBody(request);
    const value = JSON.parse(raw || "{}");
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function readForm(
  request: http.IncomingMessage,
): Promise<Record<string, string>> {
  const raw = await readBody(request);
  return Object.fromEntries(new URLSearchParams(raw).entries());
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((x): x is string => typeof x === "string")
    : [];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[ch] ?? ch);
}

function loginPage(
  params: Record<string, unknown>,
  error = "",
): string {
  const keys = [
    "client_id",
    "redirect_uri",
    "response_type",
    "state",
    "code_challenge",
    "code_challenge_method",
    "scope",
    "resource",
  ];
  const hidden = keys
    .map((key) => {
      const value = asString(params[key]);
      return value
        ? `<input type="hidden" name="${esc(key)}" value="${esc(value)}">`
        : "";
    })
    .join("");
  const err = error
    ? `<p class="err">${esc(error)}</p>`
    : "";
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TongPing · Connection Authorization</title>
<style>
:root{color-scheme:light dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#151316;color:#f4f1f3}
form{width:min(360px,88vw);padding:28px;border:1px solid #4d4249;border-radius:20px;background:#211d20;box-shadow:0 14px 50px rgba(0,0,0,.28)}
h2{margin:0 0 7px;font-size:22px}p{margin:0 0 18px;color:#bcaeb7;font-size:14px;line-height:1.5}
input[type=password]{width:100%;box-sizing:border-box;padding:12px 13px;border:1px solid #5d5058;border-radius:11px;background:#171417;color:#fff;font-size:16px}
button{width:100%;margin-top:12px;padding:12px;border:0;border-radius:11px;background:#eee7eb;color:#211d20;font-weight:650;font-size:16px}
.err{color:#ff9c9c}
</style></head><body>
<form method="post">
<h2>TongPing</h2>
<p>Authorize the shared browser connection. Enter the TONGPING_OAUTH_PASSWORD set in your .env file.</p>
${err}${hidden}
<input type="password" name="_pw" placeholder="Authorization password" autocomplete="current-password" autofocus required>
<button type="submit">Authorize connection</button>
</form></body></html>`;
}

function sendJson(
  response: http.ServerResponse,
  status: number,
  value: unknown,
): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

function sendHtml(
  response: http.ServerResponse,
  status: number,
  body: string,
): void {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "content-security-policy":
      "default-src 'none'; style-src 'unsafe-inline'; " +
      "form-action 'self' https://chatgpt.com https://claude.ai " +
      "http://127.0.0.1:* http://localhost:*; " +
      "base-uri 'none'; frame-ancestors 'none'",
  });
  response.end(body);
}
