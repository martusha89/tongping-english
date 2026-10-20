import { admitCard, cardFromUrl, registerCardSocket } from "./card-authority.js";
import type http from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, WebSocket } from "ws";
import { admitWorkerSocket, workerSocketCurrent, type WorkerTransportAuthority, type WorkerTransportAuthenticator } from "./worker-transport-authority.js";
import type { RouteScope } from "./route-identity.js";

export interface LiveFrameMediaMeta {
  sessionId: string;
  playerIdentity: string;
  mediaIdentity: string;
  epoch: number;
  sourcePlayheadPts: number;
  framePts: number | null;
  ptsSource: "rvfc-media-time" | "html-media-currentTime";
  ptsQuality: "frame-timestamp" | "playhead-estimate";
  ptsSampleAgeMs: number | null;
  playbackState: "playing" | "paused" | "waiting" | "seeking" | "ended";
  playbackRate: number;
  readyState: number;
  sampledAt: number;
  sampleAgeAtCaptureMs?: number;
  transition: string | null;
}

export interface LiveWsFrame {
  packet: Buffer;
  sequence: number;
  width: number;
  height: number;
  capturedAt: number;
  bytes: number;
  media: LiveFrameMediaMeta | null;
}

export interface LiveWsHubOptions {
  authenticateWorker: WorkerTransportAuthenticator;
  resolveWorkerRoute?: (authority: WorkerTransportAuthority, alias: string) => Promise<RouteScope | null>;
  onWorkerRouteRetired?: (route: RouteScope) => void;
  authorizeControlProducer?: (authority: WorkerTransportAuthority) => Promise<boolean>;
  authenticateApp: (
    profile: string,
    url: URL,
    request: http.IncomingMessage,
  ) => boolean;
  onFrame?: (profile: string, frame: LiveWsFrame, route: RouteScope | null) => void;
  onWorkerPresence?: (profile: string, connected: boolean) => void;
  onControlWorkerPresence?: (profile: string, connected: boolean) => void;
  onAppPresence?: (profile: string, connected: boolean) => void;
  onAppCommand?: (
    profile: string,
    message: Record<string, unknown>,
    ws: WebSocket,
  ) => void;
}

export class LiveWsHub {
  private readonly wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: 8_500_000,
  });
  private readonly apps = new Map<string, Set<WebSocket>>();
  private readonly appFrameCredits = new Map<WebSocket, number>();
  private readonly appLastSentVersion = new Map<WebSocket, number>();
  private readonly latestVersion = new Map<string, number>();
  private readonly appLastFrameSentAt = new Map<WebSocket, number>();
  private readonly appLastSentFrame = new Map<WebSocket, {
    sequence: number;
    capturedAt: number;
    receivedAt: number;
    media: LiveFrameMediaMeta | null;
  }>();
  private readonly latestPresented = new Map<string, {
    sequence: number;
    capturedAt: number;
    frameReceivedAt: number;
    ackReceivedAt: number;
    clientPresentedAt: number | null;
    presentationSemantics: string;
    media: LiveFrameMediaMeta | null;
  }>();
  private readonly workers = new Map<string, WebSocket>();
  private readonly controlWorkers = new Map<string, WebSocket>();
  private readonly controlAuthorities = new WeakMap<WebSocket, WorkerTransportAuthority>();
  private readonly workerMeta = new Map<string, {
    build: string;
    name: string;
    connectedAt: string;
  }>();
  private readonly controlWorkerMeta = new Map<string, {
    build: string;
    name: string;
    connectedAt: string;
  }>();
  private readonly latest = new Map<string, Buffer>();
  private readonly latestFrameMedia = new Map<string, {
    sequence: number;
    capturedAt: number;
    receivedAt: number;
    media: LiveFrameMediaMeta | null;
  }>();
  private readonly pendingWorkerFrameMedia = new Map<
    string,
    Map<string, LiveFrameMediaMeta>
  >();
  private workerCommandSeq = 0;
  private readonly workerCommandStats = {
    attempts: 0,
    sent: 0,
    acks: 0,
    replies: 0,
    timeouts: 0,
    pings: 0,
    pongs: 0,
    lastPongLatencyMs: 0,
    lastProfile: "",
    lastType: "",
    lastLatencyMs: 0,
    lastError: "",
  };
  private readonly workerCommandPending = new Map<string, {
    startedAt: number,
    profile: string;
    ws: WebSocket;
    resolve: (value: { ok: boolean; error?: string }) => void;
    timer: NodeJS.Timeout;
  }>();
  private readonly deliveryStats = {
    framesSent: 0,
    renderAcks: 0,
    presentedAcks: 0,
    droppedAcks: 0,
    mismatchedAcks: 0,
    catchupSends: 0,
    nextFrameCredits: 0,
    lastRenderAckMs: 0,
    avgRenderAckMs: 0,
    maxRenderAckMs: 0,
  };
  private renderAckSamples = 0;
  private readonly mediaSidecarStats = {
    received: 0,
    parsed: 0,
    matchedToFrame: 0,
    frameWithoutMeta: 0,
    lastProfile: "",
    lastSequence: 0,
    lastCapturedAt: 0,
    lastMediaPts: null as number | null,
  };
  private readonly workerFrameReceiptStats = {
    framesReceived: 0,
    receiptAcksSent: 0,
  };
  private readonly workerTransportDiag = new Map<string, {
    capturedFrames: number;
    overwrittenFrames: number;
    sentFrames: number;
    ackedFrames: number;
    bufferedDrops: number;
    ackTimeoutResets: number;
    inFlight: number;
    maxInFlight: number;
    lastAckMs: number;
    avgAckMs: number;
    maxAckMs: number;
    currentAckTimeoutMs: number;
    socketBufferedAmount: number;
    sampledAt: number;
    receivedAt: number;
  }>();

  private readonly upgradeStats = {
    appAttempts: 0,
    appAccepted: 0,
    appRejected: 0,
    appRejectedTicket: 0,
    appRejectedCard: 0,
    appCloses: 0,
    lastAppCloseCode: 0,
    lastAppCloseReason: "",
    workerAttempts: 0,
    workerAccepted: 0,
    workerRejected: 0,
    workerCloses: 0,
    lastWorkerCloseCode: 0,
    lastWorkerCloseReason: "",
    controlWorkerAttempts: 0,
    controlWorkerAccepted: 0,
    controlWorkerRejected: 0,
    controlWorkerCloses: 0,
    lastControlWorkerCloseCode: 0,
    lastControlWorkerCloseReason: "",
  };

  constructor(private readonly options: LiveWsHubOptions) {}

  handleUpgrade(
    request: http.IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): boolean {
    let url: URL;
    try {
      url = new URL(
        request.url ?? "/",
        `http://${request.headers.host ?? "localhost"}`,
      );
    } catch {
      socket.destroy();
      return true;
    }

    if (
      url.pathname !== "/v1/worker/live-ws" &&
      url.pathname !== "/v1/worker/control-ws" &&
      url.pathname !== "/v1/app/live-ws"
    ) {
      return false;
    }

    const profile = url.searchParams.get("profile") ?? "";
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(profile)) {
      rejectUpgrade(socket, 400, "Invalid profile");
      return true;
    }

    const role =
      url.pathname === "/v1/worker/live-ws"
        ? "worker"
        : url.pathname === "/v1/worker/control-ws"
          ? "worker-control"
          : "app";
    if (role === "app") {
      this.upgradeStats.appAttempts += 1;
    } else if (role === "worker-control") {
      this.upgradeStats.controlWorkerAttempts += 1;
    } else {
      this.upgradeStats.workerAttempts += 1;
    }

    if (role !== "app") {
      void this.upgradeWorker(request, socket, head, profile, role);
      return true;
    }

    if (!this.options.authenticateApp(profile, url, request)) {
      this.upgradeStats.appRejected += 1;
      this.upgradeStats.appRejectedTicket += 1;
      rejectUpgrade(socket, 403, "Invalid or expired live ticket");
      return true;
    }

    const card = cardFromUrl(url);
    if (!admitCard(card)) {
      this.upgradeStats.appRejected += 1;
      this.upgradeStats.appRejectedCard += 1;
      rejectUpgrade(socket, 409, "A newer TongPing card is open");
      return true;
    }

    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.upgradeStats.appAccepted += 1;
      const release = registerCardSocket(card, () => ws.close(4009, "newer card"));
      ws.on("close", release);
      this.acceptApp(profile, ws);
    });
    return true;
  }

  private async upgradeWorker(request: http.IncomingMessage, socket: Duplex, head: Buffer,
    profile: string, role: "worker" | "worker-control"): Promise<void> {
    let authority: WorkerTransportAuthority | null = null;
    let current = false;
    let route: RouteScope | null = null;
    try {
      authority = await this.options.authenticateWorker(request);
      current = authority === true || !!authority && await authority.isCurrent();
      if (current && authority && authority !== true && role === "worker" && this.options.resolveWorkerRoute) {
        route = await this.options.resolveWorkerRoute(authority, profile);
        current = !!route && await authority.isCurrent();
      }
    } catch {}
    if (!authority || !current || socket.destroyed) {
      if (role === "worker-control") this.upgradeStats.controlWorkerRejected += 1;
      else this.upgradeStats.workerRejected += 1;
      if (!socket.destroyed) rejectUpgrade(socket, 401, "Unauthorized worker");
      return;
    }
    try {
      this.wss.handleUpgrade(request, socket, head, (ws) => {
        ws.pause();
        void (async () => {
          if (!await admitWorkerSocket(authority, ws)) {
            ws.terminate();
            return;
          }
          if (role === "worker") {
            if (route && authority !== true && this.options.onWorkerRouteRetired) {
              await authority.registerRetirementResource(() => this.options.onWorkerRouteRetired?.(route));
            }
            if (!await workerSocketCurrent(authority, ws)) { ws.terminate(); return; }
            this.upgradeStats.workerAccepted += 1;
            this.acceptWorker(profile, ws, request, authority, route);
          } else {
            this.upgradeStats.controlWorkerAccepted += 1;
            this.acceptControlWorker(profile, ws, request, authority);
          }
          ws.resume();
        })().catch(() => ws.terminate());
      });
    } catch { socket.destroy(); }
  }

  close(): void {
    for (const ws of this.workers.values()) {
      ws.close(1001, "server shutdown");
    }
    for (const ws of this.controlWorkers.values()) {
      ws.close(1001, "server shutdown");
    }
    for (const clients of this.apps.values()) {
      for (const ws of clients) ws.close(1001, "server shutdown");
    }
    this.workers.clear();
    this.controlWorkers.clear();
    this.workerMeta.clear();
    this.controlWorkerMeta.clear();
    this.apps.clear();
    this.appFrameCredits.clear();
    this.appLastSentVersion.clear();
    this.appLastFrameSentAt.clear();
    this.appLastSentFrame.clear();
    this.latestPresented.clear();
    this.latest.clear();
    this.latestFrameMedia.clear();
    this.pendingWorkerFrameMedia.clear();
    this.latestVersion.clear();
    for (const pending of this.workerCommandPending.values()) {
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, error: "Server shutdown" });
    }
    this.workerCommandPending.clear();
    this.wss.close();
  }

  stats() {
    return {
      ...this.upgradeStats,
      appSubscribers: this.appSubscribers(),
      appProfiles: this.apps.size,
      workerProfiles: this.workers.size,
      workerMeta: Object.fromEntries(this.workerMeta),
      controlWorkerProfiles: this.controlWorkers.size,
      controlWorkerMeta: Object.fromEntries(this.controlWorkerMeta),
      workerCommands: { ...this.workerCommandStats },
      delivery: { ...this.deliveryStats },
      mediaSidecar: { ...this.mediaSidecarStats },
      workerFrameReceipts: { ...this.workerFrameReceiptStats },
      workerTransportDiag: Object.fromEntries(this.workerTransportDiag),
    };
  }

  appProfiles(): string[] {
    return [...this.apps.keys()];
  }

  appSubscribers(profile?: string): number {
    if (profile) return this.apps.get(profile)?.size ?? 0;
    let total = 0;
    for (const clients of this.apps.values()) total += clients.size;
    return total;
  }

  presentationStatus(profile: string) {
    const latest = this.latestPresented.get(profile) ?? null;
    return {
      profile,
      viewerCount: this.appSubscribers(profile),
      ambiguousViewer:
        this.appSubscribers(profile) > 1,
      lastPresented: latest
        ? {
            ...latest,
            ackSemantics:
              "render-surface-commit-observed-by-browser-app",
            physicalDisplayConfirmed: false,
          }
        : null,
    };
  }

  controlWorkerConnected(profile: string): boolean {
    return this.controlWorkers.get(profile)?.readyState === WebSocket.OPEN;
  }

  async workerCommand(
    profile: string,
    payload: Record<string, unknown>,
    timeoutMs = 2_000,
  ): Promise<{ ok: boolean; error?: string }> {
    const ws = this.controlWorkers.get(profile);
    const authority = ws ? this.controlAuthorities.get(ws) ?? true : true;
    if (!ws || !await workerSocketCurrent(authority, ws) ||
      (this.options.authorizeControlProducer && !await this.options.authorizeControlProducer(authority)) ||
      this.controlWorkers.get(profile) !== ws || ws.readyState !== WebSocket.OPEN) {
      return {
        ok: false,
        error: "Realtime worker control websocket is not connected",
      };
    }

    const id = "wcmd-" + (++this.workerCommandSeq);
    const startedAt = Date.now();
    this.workerCommandStats.attempts += 1;
    this.workerCommandStats.lastProfile = profile;
    this.workerCommandStats.lastType =
      typeof payload.type === "string" ? payload.type : "";
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.workerCommandPending.delete(id);
        this.workerCommandStats.timeouts += 1;
        this.workerCommandStats.lastLatencyMs = Date.now() - startedAt;
        this.workerCommandStats.lastError = "timeout";
        resolve({ ok: false, error: "Realtime worker command timed out" });
      }, timeoutMs);
      timer.unref?.();

      this.workerCommandPending.set(id, { profile, ws, resolve, timer, startedAt });
      try {
        try {
          const pingStamp = Buffer.from(String(startedAt));
          ws.ping(pingStamp, undefined, () => {});
          this.workerCommandStats.pings += 1;
        } catch {}
        ws.send(JSON.stringify({ ...payload, id }), (error) => {
          if (error) {
            this.workerCommandStats.lastError = error.message;
            return;
          }
          this.workerCommandStats.sent += 1;
        });
      } catch (error) {
        clearTimeout(timer);
        this.workerCommandPending.delete(id);
        this.workerCommandStats.lastError =
          error instanceof Error ? error.message : String(error);
        resolve({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  workerConnected(profile: string): boolean {
    const ws = this.workers.get(profile);
    return Boolean(ws && ws.readyState === WebSocket.OPEN);
  }

  private acceptWorker(
    profile: string,
    ws: WebSocket,
    request: http.IncomingMessage,
    authority: WorkerTransportAuthority = true,
    route: RouteScope | null = null,
  ): void {
    const existing = this.workers.get(profile);
    if (existing && existing !== ws) {
      existing.close(1012, "replaced");
    }

    this.workers.set(profile, ws);
    const buildHeader = request.headers["x-tongping-worker-build"];
    const nameHeader = request.headers["x-tongping-worker"];
    this.workerMeta.set(profile, {
      build: Array.isArray(buildHeader)
        ? String(buildHeader[0] ?? "")
        : String(buildHeader ?? ""),
      name: Array.isArray(nameHeader)
        ? String(nameHeader[0] ?? "")
        : String(nameHeader ?? ""),
      connectedAt: new Date().toISOString(),
    });
    this.options.onWorkerPresence?.(profile, true);

    ws.on("message", async (data, isBinary) => {
      if (this.workers.get(profile) !== ws || !await workerSocketCurrent(authority, ws) || this.workers.get(profile) !== ws) return;
      if (!isBinary) {
        const text = normalizeBuffer(data).toString("utf8");
        if (text.length > 16_000) return;
        try {
          const parsed = JSON.parse(text);
          if (
            parsed &&
            parsed.type === "frame_transport_diag"
          ) {
            const diag = parseWorkerTransportDiag(parsed);
            if (diag) {
              this.workerTransportDiag.set(profile, {
                ...diag,
                receivedAt: Date.now(),
              });
            }
            return;
          }

          if (
            parsed &&
            parsed.type === "frame_media_meta" &&
            Number.isInteger(parsed.sequence) &&
            parsed.sequence >= 0 &&
            Number.isSafeInteger(parsed.capturedAt) &&
            parsed.capturedAt > 0
          ) {
            this.mediaSidecarStats.received += 1;
            this.mediaSidecarStats.lastProfile = profile;
            this.mediaSidecarStats.lastSequence = parsed.sequence;
            this.mediaSidecarStats.lastCapturedAt = parsed.capturedAt;
            const media = parseLiveFrameMediaMeta(parsed.media);
            if (!media) return;
            this.mediaSidecarStats.parsed += 1;
            this.mediaSidecarStats.lastMediaPts =
              media.framePts ?? media.sourcePlayheadPts;
            let pending = this.pendingWorkerFrameMedia.get(profile);
            if (!pending) {
              pending = new Map<string, LiveFrameMediaMeta>();
              this.pendingWorkerFrameMedia.set(profile, pending);
            }
            pending.set(
              frameMetaKey(parsed.sequence, parsed.capturedAt),
              media,
            );
            while (pending.size > 64) {
              const oldest = pending.keys().next().value as
                | string
                | undefined;
              if (!oldest) break;
              pending.delete(oldest);
            }
          }
        } catch {}
        return;
      }

      const packet = normalizeBuffer(data);
      const frame = parseFramePacket(packet);
      if (!frame) {
        ws.close(1003, "invalid frame packet");
        return;
      }

      const pending = this.pendingWorkerFrameMedia.get(profile);
      const metaKey = frameMetaKey(
        frame.sequence,
        frame.capturedAt,
      );
      frame.media = pending?.get(metaKey) ?? null;
      pending?.delete(metaKey);
      if (frame.media) {
        this.mediaSidecarStats.matchedToFrame += 1;
      } else {
        this.mediaSidecarStats.frameWithoutMeta += 1;
      }
      const receivedAt = Date.now();
      this.workerFrameReceiptStats.framesReceived += 1;
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({
            type: "frame_received",
            sequence: frame.sequence,
            capturedAt: frame.capturedAt,
          }));
          this.workerFrameReceiptStats.receiptAcksSent += 1;
        } catch {}
      }

      this.latest.set(profile, frame.packet);
      this.latestFrameMedia.set(profile, {
        sequence: frame.sequence,
        capturedAt: frame.capturedAt,
        receivedAt,
        media: frame.media,
      });
      const version = (this.latestVersion.get(profile) ?? 0) + 1;
      this.latestVersion.set(profile, version);
      this.options.onFrame?.(profile, frame, route);
      this.broadcast(profile, frame.packet, version);
    });

    ws.on("close", (code, reason) => {
      this.upgradeStats.workerCloses += 1;
      this.upgradeStats.lastWorkerCloseCode = Number(code) || 0;
      this.upgradeStats.lastWorkerCloseReason =
        reason?.toString("utf8").slice(0, 160) ?? "";
      if (this.workers.get(profile) === ws) {
        this.workers.delete(profile);
        this.workerMeta.delete(profile);
        this.pendingWorkerFrameMedia.delete(profile);
        this.workerTransportDiag.delete(profile);
        this.options.onWorkerPresence?.(profile, false);
      }
    });

    ws.on("error", () => {});
  }

  private acceptControlWorker(
    profile: string,
    ws: WebSocket,
    request: http.IncomingMessage,
    authority: WorkerTransportAuthority = true,
  ): void {
    const existing = this.controlWorkers.get(profile);
    if (existing && existing !== ws) {
      existing.close(1012, "replaced");
    }

    this.controlWorkers.set(profile, ws);
    this.controlAuthorities.set(ws, authority);
    this.options.onControlWorkerPresence?.(profile, true);
    const buildHeader = request.headers["x-tongping-worker-build"];
    const nameHeader = request.headers["x-tongping-worker"];
    this.controlWorkerMeta.set(profile, {
      build: Array.isArray(buildHeader)
        ? String(buildHeader[0] ?? "")
        : String(buildHeader ?? ""),
      name: Array.isArray(nameHeader)
        ? String(nameHeader[0] ?? "")
        : String(nameHeader ?? ""),
      connectedAt: new Date().toISOString(),
    });

    ws.on("message", async (data, isBinary) => {
      if (this.controlWorkers.get(profile) !== ws || !await workerSocketCurrent(authority, ws) || this.controlWorkers.get(profile) !== ws) return;
      if (isBinary) return;
      const text = normalizeBuffer(data).toString("utf8");
      if (text.length > 16_000) return;
      try {
        const parsed = JSON.parse(text);
        if (
          parsed &&
          parsed.type === "worker_command_ack" &&
          typeof parsed.id === "string"
        ) {
          const pending = this.workerCommandPending.get(parsed.id);
          if (pending && pending.profile === profile && pending.ws === ws) {
            this.workerCommandStats.acks += 1;
            this.workerCommandStats.lastLatencyMs =
              Date.now() - pending.startedAt;
            this.workerCommandStats.lastError = "";
          }
          return;
        }
        if (
          parsed &&
          parsed.type === "worker_command_result" &&
          typeof parsed.id === "string"
        ) {
          const pending = this.workerCommandPending.get(parsed.id);
          if (!pending || pending.profile !== profile || pending.ws !== ws) return;
          this.workerCommandPending.delete(parsed.id);
          clearTimeout(pending.timer);
          this.workerCommandStats.replies += 1;
          this.workerCommandStats.lastLatencyMs =
            Date.now() - pending.startedAt;
          this.workerCommandStats.lastError =
            parsed.ok === true
              ? ""
              : typeof parsed.error === "string"
                ? parsed.error.slice(0, 300)
                : "worker error";
          pending.resolve({
            ok: parsed.ok === true,
            ...(parsed.ok === true
              ? {}
              : {
                  error:
                    typeof parsed.error === "string"
                      ? parsed.error.slice(0, 300)
                      : "Realtime worker command failed",
                }),
          });
        }
      } catch {}
    });

    ws.on("pong", async (data) => {
      if (this.controlWorkers.get(profile) !== ws || !await workerSocketCurrent(authority, ws) || this.controlWorkers.get(profile) !== ws) return;
      this.workerCommandStats.pongs += 1;
      const sentAt = Number(normalizeBuffer(data).toString("utf8"));
      if (Number.isFinite(sentAt) && sentAt > 0) {
        this.workerCommandStats.lastPongLatencyMs =
          Math.max(0, Date.now() - sentAt);
      }
    });

    ws.on("close", (code, reason) => {
      this.upgradeStats.controlWorkerCloses += 1;
      this.upgradeStats.lastControlWorkerCloseCode = Number(code) || 0;
      this.upgradeStats.lastControlWorkerCloseReason =
        reason?.toString("utf8").slice(0, 160) ?? "";
      if (this.controlWorkers.get(profile) === ws) {
        this.controlWorkers.delete(profile);
        this.controlWorkerMeta.delete(profile);
        this.options.onControlWorkerPresence?.(profile, false);
      }
      for (const [id, pending] of this.workerCommandPending) {
        if (pending.ws !== ws) continue;
        this.workerCommandPending.delete(id);
        clearTimeout(pending.timer);
        pending.resolve({
          ok: false,
          error: "Realtime worker control websocket closed",
        });
      }
    });

    ws.on("error", () => {});
  }

  private rememberSentFrame(
    profile: string,
    ws: WebSocket,
    packet: Buffer,
  ): void {
    const frame = parseFramePacket(packet);
    if (!frame) return;
    const latestMeta = this.latestFrameMedia.get(profile);
    const metaMatches =
      latestMeta !== undefined &&
      latestMeta.sequence === frame.sequence &&
      latestMeta.capturedAt === frame.capturedAt;
    this.appLastSentFrame.set(ws, {
      sequence: frame.sequence,
      capturedAt: frame.capturedAt,
      receivedAt: metaMatches
        ? latestMeta.receivedAt
        : Date.now(),
      media: metaMatches ? latestMeta.media : null,
    });
  }

  private acceptApp(profile: string, ws: WebSocket): void {
    let clients = this.apps.get(profile);
    const wasEmpty = !clients || clients.size === 0;
    if (!clients) {
      clients = new Set<WebSocket>();
      this.apps.set(profile, clients);
    }

    // ChatGPT hosts may mount more than one iframe for one visible card
    // (and the user may have web + mobile open). Allow a small bounded fanout
    // instead of killing the previous viewer and causing 1012 reconnect loops.
    while (clients.size >= 6) {
      const oldest = clients.values().next().value as WebSocket | undefined;
      if (!oldest) break;
      clients.delete(oldest);
      oldest.close(1013, "viewer limit");
    }

    clients.add(ws);
    this.appFrameCredits.set(ws, 1);
    this.appLastSentVersion.set(ws, 0);
    if (wasEmpty) this.options.onAppPresence?.(profile, true);

    const latest = this.latest.get(profile);
    const latestVersion = this.latestVersion.get(profile) ?? 0;
    if (
      latest &&
      ws.readyState === WebSocket.OPEN &&
      ws.bufferedAmount < 1_000_000
    ) {
      this.appFrameCredits.set(ws, 0);
      this.appLastSentVersion.set(ws, latestVersion);
      this.appLastFrameSentAt.set(ws, Date.now());
      this.deliveryStats.framesSent += 1;
      this.rememberSentFrame(profile, ws, latest);
      ws.send(latest, { binary: true }, () => {});
    }

    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      const text = normalizeBuffer(data).toString("utf8");
      if (text.length > 16_000) return;
      try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;

        const message = parsed as Record<string, unknown>;
        if (message.type === "frame_ready") {
          const sentAt = this.appLastFrameSentAt.get(ws);
          const expected = this.appLastSentFrame.get(ws);
          const ackSequence =
            typeof message.sequence === "number"
              ? Math.floor(message.sequence)
              : null;
          const ackCapturedAt =
            typeof message.capturedAt === "number"
              ? Math.floor(message.capturedAt)
              : null;
          const outcome =
            typeof message.outcome === "string"
              ? message.outcome.slice(0, 80)
              : "legacy";
          const presentationSemantics =
            typeof message.presentationSemantics === "string"
              ? message.presentationSemantics.slice(0, 80)
              : "legacy-frame-ready";
          const ackMatches =
            expected !== undefined &&
            ackSequence === expected.sequence &&
            ackCapturedAt === expected.capturedAt;

          if (sentAt) {
            const ackMs = Math.max(0, Date.now() - sentAt);
            this.deliveryStats.renderAcks += 1;
            this.deliveryStats.lastRenderAckMs = ackMs;
            this.deliveryStats.maxRenderAckMs = Math.max(
              this.deliveryStats.maxRenderAckMs,
              ackMs,
            );
            this.renderAckSamples += 1;
            this.deliveryStats.avgRenderAckMs +=
              (ackMs - this.deliveryStats.avgRenderAckMs) /
              this.renderAckSamples;
            this.appLastFrameSentAt.delete(ws);
          }

          if (outcome === "presented" && ackMatches && expected) {
            this.deliveryStats.presentedAcks += 1;
            this.latestPresented.set(profile, {
              sequence: expected.sequence,
              capturedAt: expected.capturedAt,
              frameReceivedAt: expected.receivedAt,
              ackReceivedAt: Date.now(),
              clientPresentedAt:
                typeof message.presentedAt === "number" &&
                Number.isFinite(message.presentedAt)
                  ? Math.floor(message.presentedAt)
                  : null,
              presentationSemantics,
              media: expected.media,
            });
          } else if (outcome !== "presented") {
            this.deliveryStats.droppedAcks += 1;
          } else {
            this.deliveryStats.mismatchedAcks += 1;
          }
          this.appLastSentFrame.delete(ws);

          // If the app was busy decoding while newer frames arrived, jump
          // straight to the newest unseen frame. If it is already current,
          // grant one credit for the next worker frame.
          const latest = this.latest.get(profile);
          const latestVersion = this.latestVersion.get(profile) ?? 0;
          const lastSentVersion = this.appLastSentVersion.get(ws) ?? 0;
          if (
            latest &&
            latestVersion > lastSentVersion &&
            ws.readyState === WebSocket.OPEN &&
            ws.bufferedAmount < 1_000_000
          ) {
            this.appFrameCredits.set(ws, 0);
            this.appLastSentVersion.set(ws, latestVersion);
            this.appLastFrameSentAt.set(ws, Date.now());
            this.deliveryStats.catchupSends += 1;
            this.deliveryStats.framesSent += 1;
            this.rememberSentFrame(profile, ws, latest);
            ws.send(latest, { binary: true }, () => {});
          } else {
            this.deliveryStats.nextFrameCredits += 1;
            this.appFrameCredits.set(ws, 1);
          }
          return;
        }

        if (message.type === "resync_frame") {
          const id = typeof message.id === "string"
            ? message.id.slice(0, 80)
            : "";
          const latest = this.latest.get(profile);
          const latestVersion = this.latestVersion.get(profile) ?? 0;
          const reply = () => {
            if (ws.readyState !== WebSocket.OPEN || !id) return;
            ws.send(JSON.stringify({
              type: "command_result",
              id,
              ok: true,
              resynced: Boolean(latest),
            }), () => {});
          };

          if (
            latest &&
            ws.readyState === WebSocket.OPEN &&
            ws.bufferedAmount < 1_000_000
          ) {
            this.appFrameCredits.set(ws, 0);
            this.appLastSentVersion.set(ws, latestVersion);
            this.appLastFrameSentAt.set(ws, Date.now());
            this.deliveryStats.framesSent += 1;
            this.rememberSentFrame(profile, ws, latest);
            ws.send(latest, { binary: true }, () => reply());
          } else {
            reply();
          }
          return;
        }

        this.options.onAppCommand?.(
          profile,
          message,
          ws,
        );
      } catch {}
    });

    const cleanup = () => {
      const current = this.apps.get(profile);
      if (!current) return;
      current.delete(ws);
      this.appFrameCredits.delete(ws);
      this.appLastSentVersion.delete(ws);
      this.appLastFrameSentAt.delete(ws);
      this.appLastSentFrame.delete(ws);
      if (current.size === 0) {
        this.apps.delete(profile);
        this.options.onAppPresence?.(profile, false);
      }
    };

    ws.on("close", (code, reason) => {
      this.upgradeStats.appCloses += 1;
      this.upgradeStats.lastAppCloseCode = Number(code) || 0;
      this.upgradeStats.lastAppCloseReason =
        reason?.toString("utf8").slice(0, 160) ?? "";
      cleanup();
    });
    ws.on("error", cleanup);
  }

  private broadcast(profile: string, packet: Buffer, version: number): void {
    const clients = this.apps.get(profile);
    if (!clients) return;

    for (const ws of [...clients]) {
      if (ws.readyState !== WebSocket.OPEN) {
        clients.delete(ws);
        this.appFrameCredits.delete(ws);
        this.appLastSentVersion.delete(ws);
        continue;
      }
      if ((this.appFrameCredits.get(ws) ?? 0) <= 0) continue;
      if (ws.bufferedAmount > 1_000_000) continue;
      this.appFrameCredits.set(ws, 0);
      this.appLastSentVersion.set(ws, version);
      this.appLastFrameSentAt.set(ws, Date.now());
      this.deliveryStats.framesSent += 1;
      this.rememberSentFrame(profile, ws, packet);
      ws.send(packet, { binary: true }, () => {});
    }

    if (clients.size === 0) {
      this.apps.delete(profile);
      this.options.onAppPresence?.(profile, false);
    }
  }

}

export function encodeLiveWsPacket(input: {
  buffer: Buffer;
  sequence: number;
  width: number;
  height: number;
  capturedAt: number;
}): Buffer {
  if (input.buffer.length <= 0 || input.buffer.length > 8_000_000) {
    throw new Error("invalid live frame size");
  }
  const header = Buffer.allocUnsafe(20);
  header.writeUInt32BE(input.sequence >>> 0, 0);
  header.writeUInt32BE(Math.max(1, Math.round(input.width)) >>> 0, 4);
  header.writeUInt32BE(Math.max(1, Math.round(input.height)) >>> 0, 8);
  header.writeBigUInt64BE(
    BigInt(Math.max(0, Math.floor(input.capturedAt))),
    12,
  );
  return Buffer.concat([header, input.buffer]);
}

export function parseFramePacket(
  packet: Buffer): LiveWsFrame | null {
  if (packet.length < 21 || packet.length > 8_500_000) return null;
  const sequence = packet.readUInt32BE(0);
  const width = packet.readUInt32BE(4);
  const height = packet.readUInt32BE(8);
  const capturedAt = Number(packet.readBigUInt64BE(12));
  if (
    width <= 0 ||
    height <= 0 ||
    width > 20_000 ||
    height > 20_000 ||
    !Number.isSafeInteger(capturedAt)
  ) {
    return null;
  }
  return {
    packet,
    sequence,
    width,
    height,
    capturedAt,
    bytes: packet.length - 20,
    media: null,
  };
}

function frameMetaKey(
  sequence: number,
  capturedAt: number,
): string {
  return String(Math.floor(sequence)) + ":" + String(Math.floor(capturedAt));
}

function parseWorkerTransportDiag(value: any): {
  capturedFrames: number;
  overwrittenFrames: number;
  sentFrames: number;
  ackedFrames: number;
  bufferedDrops: number;
  ackTimeoutResets: number;
  inFlight: number;
  maxInFlight: number;
  lastAckMs: number;
  avgAckMs: number;
  maxAckMs: number;
  currentAckTimeoutMs: number;
  socketBufferedAmount: number;
  sampledAt: number;
} | null {
  const keys = [
    "capturedFrames",
    "overwrittenFrames",
    "sentFrames",
    "ackedFrames",
    "bufferedDrops",
    "ackTimeoutResets",
    "inFlight",
    "maxInFlight",
    "lastAckMs",
    "avgAckMs",
    "maxAckMs",
    "currentAckTimeoutMs",
    "socketBufferedAmount",
    "sampledAt",
  ] as const;
  const out: Record<string, number> = {};
  for (const key of keys) {
    const number = Number(value?.[key]);
    if (!Number.isFinite(number) || number < 0) return null;
    out[key] = number;
  }
  if (
    out.inFlight! > 64 ||
    out.maxInFlight! > 64 ||
    out.socketBufferedAmount! > 100_000_000 ||
    !Number.isSafeInteger(out.sampledAt!)
  ) {
    return null;
  }
  return out as any;
}

function parseLiveFrameMediaMeta(
  value: unknown,
): LiveFrameMediaMeta | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const data = value as Record<string, unknown>;
  const sessionId =
    typeof data.sessionId === "string" ? data.sessionId.slice(0, 160) : "";
  const playerIdentity =
    typeof data.playerIdentity === "string"
      ? data.playerIdentity.slice(0, 240)
      : "";
  const mediaIdentity =
    typeof data.mediaIdentity === "string"
      ? data.mediaIdentity.slice(0, 1_200)
      : "";
  const epoch = Number(data.epoch);
  const sourcePlayheadPts = Number(data.sourcePlayheadPts);
  const framePts =
    data.framePts === null || data.framePts === undefined
      ? null
      : Number(data.framePts);
  const ptsSource =
    data.ptsSource === "rvfc-media-time"
      ? "rvfc-media-time"
      : data.ptsSource === "html-media-currentTime"
        ? "html-media-currentTime"
        : null;
  const ptsQuality =
    data.ptsQuality === "frame-timestamp"
      ? "frame-timestamp"
      : data.ptsQuality === "playhead-estimate"
        ? "playhead-estimate"
        : null;
  const ptsSampleAgeMs =
    data.ptsSampleAgeMs === null || data.ptsSampleAgeMs === undefined
      ? null
      : Number(data.ptsSampleAgeMs);
  const playbackState =
    data.playbackState === "playing" ||
    data.playbackState === "paused" ||
    data.playbackState === "waiting" ||
    data.playbackState === "seeking" ||
    data.playbackState === "ended"
      ? data.playbackState
      : null;
  const playbackRate = Number(data.playbackRate);
  const readyState = Number(data.readyState);
  const sampledAt = Number(data.sampledAt);
  const sampleAgeAtCaptureMs =
    data.sampleAgeAtCaptureMs === undefined
      ? undefined
      : Number(data.sampleAgeAtCaptureMs);
  const transition =
    data.transition === null || data.transition === undefined
      ? null
      : typeof data.transition === "string"
        ? data.transition.slice(0, 80)
        : null;

  if (
    !sessionId ||
    !playerIdentity ||
    !mediaIdentity ||
    !Number.isInteger(epoch) ||
    epoch < 1 ||
    !Number.isFinite(sourcePlayheadPts) ||
    sourcePlayheadPts < 0 ||
    (framePts !== null && (!Number.isFinite(framePts) || framePts < 0)) ||
    !ptsSource ||
    !ptsQuality ||
    (ptsSampleAgeMs !== null &&
      (!Number.isFinite(ptsSampleAgeMs) ||
        ptsSampleAgeMs < 0 ||
        ptsSampleAgeMs > 10_000)) ||
    !playbackState ||
    !Number.isFinite(playbackRate) ||
    playbackRate <= 0 ||
    playbackRate > 16 ||
    !Number.isInteger(readyState) ||
    readyState < 0 ||
    readyState > 4 ||
    !Number.isSafeInteger(sampledAt) ||
    sampledAt <= 0 ||
    (sampleAgeAtCaptureMs !== undefined &&
      (!Number.isFinite(sampleAgeAtCaptureMs) ||
        sampleAgeAtCaptureMs < 0 ||
        sampleAgeAtCaptureMs > 10_000))
  ) {
    return null;
  }

  return {
    sessionId,
    playerIdentity,
    mediaIdentity,
    epoch,
    sourcePlayheadPts,
    framePts,
    ptsSource,
    ptsQuality,
    ptsSampleAgeMs,
    playbackState,
    playbackRate,
    readyState,
    sampledAt,
    ...(sampleAgeAtCaptureMs === undefined
      ? {}
      : { sampleAgeAtCaptureMs }),
    transition,
  };
}

function normalizeBuffer(
  value:
    | Buffer
    | ArrayBuffer
    | Buffer[],
): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (Array.isArray(value)) return Buffer.concat(value);
  return Buffer.from(value);
}

function rejectUpgrade(
  socket: Duplex,
  status: number,
  message: string,
): void {
  const body = message + "\n";
  socket.write(
    `HTTP/1.1 ${status} ${message}\r\n` +
      "Connection: close\r\n" +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      "\r\n" +
      body,
   );
  socket.destroy();
}
