import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import type { Duplex } from "node:stream";

/**
 * The Worker's long-lived sockets (live frames, control, audio, Watch Together media)
 * use `ws`, which ignores HTTPS_PROXY. On a home line where the direct route
 * to the server drops half its packets but the user's proxy is clean, those
 * sockets need the proxy too: tunnel them with an HTTP CONNECT.
 */
class ConnectTunnelAgent extends https.Agent {
  constructor(private readonly proxy: URL) {
    super({ keepAlive: false });
  }

  override createConnection(
    options: http.RequestOptions & { servername?: string },
    callback?: (error: Error | null, socket: Duplex) => void,
  ): Duplex | undefined {
    const host = String(options.host ?? options.hostname ?? "");
    const port = Number(options.port ?? 443);
    const request = http.request({
      host: this.proxy.hostname,
      port: Number(this.proxy.port || 80),
      method: "CONNECT",
      path: `${host}:${port}`,
      headers: { host: `${host}:${port}` },
    });
    request.once("connect", (response, socket) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        callback?.(new Error(`proxy CONNECT ${host}:${port} → ${response.statusCode}`), socket);
        return;
      }
      const secure = tls.connect({
        socket,
        servername: options.servername || host,
        ALPNProtocols: ["http/1.1"],
      });
      callback?.(null, secure);
    });
    request.once("error", (error) => callback?.(error, request.socket as Duplex));
    request.end();
    return undefined;
  }
}

function proxyFromEnv(): URL | null {
  const raw =
    process.env.HTTPS_PROXY ??
    process.env.https_proxy ??
    process.env.ALL_PROXY ??
    process.env.all_proxy ??
    "";
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

function bypassesProxy(hostname: string): boolean {
  if (/^(localhost|127\.|::1$|\[::1\])/i.test(hostname)) return true;
  const list = (process.env.NO_PROXY ?? process.env.no_proxy ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const host = hostname.toLowerCase();
  return list.some((item) =>
    item === "*" ||
    host === item.replace(/^\./, "") ||
    host.endsWith(item.startsWith(".") ? item : "." + item));
}

let cached: { key: string; agent: https.Agent } | null = null;

/** An agent for a wss:// URL when an HTTP proxy is configured, else undefined. */
export function proxyAgentFor(rawUrl: string | URL): https.Agent | undefined {
  const url = typeof rawUrl === "string" ? new URL(rawUrl) : rawUrl;
  if (url.protocol !== "wss:" && url.protocol !== "https:") return undefined;
  if (bypassesProxy(url.hostname)) return undefined;
  const proxy = proxyFromEnv();
  if (!proxy) return undefined;
  if (!cached || cached.key !== proxy.href) {
    cached = { key: proxy.href, agent: new ConnectTunnelAgent(proxy) };
  }
  return cached.agent;
}
