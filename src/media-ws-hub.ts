import { admitCard, cardFromUrl, registerCardSocket } from "./card-authority.js";
import type http from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, WebSocket } from "ws";
import { admitWorkerSocket, workerSocketCurrent, type WorkerTransportAuthority, type WorkerTransportAuthenticator } from "./worker-transport-authority.js";

/** Close code the card uses when the person leaves Watch Together for LIVE. */
export const COMPANION_LEAVE_CLOSE_CODE = 4001;

export interface CompanionPlaybackStatus {
  profile: string;
  currentTime: number | null;
  duration: number | null;
  sourcePts: number | null;
  bufferStartPts: number | null;
  bufferEndPts: number | null;
  sourceDuration: number | null;
  presentationDateMs: number | null;
  paused: boolean;
  ended: boolean;
  readyState: number;
  wallClockAt: number;
  receivedAt: number;
}

export interface MediaWsHubOptions {
  authenticateWorker: WorkerTransportAuthenticator;
  authenticateApp: (
    profile: string,
    url: URL,
    request: http.IncomingMessage,
  ) => boolean;
  onWorkerPresence?: (profile: string, connected: boolean) => void;
  onAppPresence?: (profile: string, connected: boolean) => void;
  onAppReady?: (profile: string) => void;
  onCompanionReady?: (profile: string, entry: string | null) => void;
  onCompanionPause?: (profile: string, paused: boolean) => void;
  onAppModeClosed?: (
    profile: string,
    mode: "media" | "companion" | null,
    /** True when the card closed it on purpose ("Back to LIVE"), not a drop. */
    leftOnPurpose?: boolean,
  ) => void;
  onWorkerStreamStart?: (
    profile: string,
    streamId: string,
    mimeType: string,
    isCurrent?: () => Promise<boolean>,
  ) => void | Promise<void>;
  onWorkerSegment?: (
    profile: string,
    streamId: string,
    segment: {
      sequence: number;
      capturedAt: number;
      bytes: number;
      payload: Buffer;
    },
  ) => void | Promise<void>;
  onWorkerStreamEnd?: (
    profile: string,
    streamId: string,
  ) => void | Promise<void>;
  /** Newest-card-wins scope per profile; default is one global scope. */
  cardScope?: (profile: string) => string;
}

const HEADER_BYTES = 12;
const MAX_MEDIA_PAYLOAD = 2_000_000;
const MAX_TEXT_BYTES = 8_000;

export function encodeMediaSegmentPacket(input: {
  buffer: Buffer;
  sequence: number;
  capturedAt: number;
}): Buffer {
  const payload = Buffer.from(input.buffer);
  if (payload.length <= 0 || payload.length > MAX_MEDIA_PAYLOAD) {
    throw new Error("invalid media segment payload");
  }
  const packet = Buffer.allocUnsafe(HEADER_BYTES + payload.length);
  packet.writeUInt32BE(input.sequence >>> 0, 0);
  packet.writeBigUInt64BE(
    BigInt(Math.max(0, Math.round(input.capturedAt))),
    4,
  );
  payload.copy(packet, HEADER_BYTES);
  return packet;
}

export function parseMediaSegmentPacket(packet: Buffer): {
  sequence: number;
  capturedAt: number;
  bytes: number;
  payload: Buffer;
} | null {
  if (
    packet.length <= HEADER_BYTES ||
    packet.length > HEADER_BYTES + MAX_MEDIA_PAYLOAD
  ) {
    return null;
  }
  const sequence = packet.readUInt32BE(0);
  const capturedAt = Number(packet.readBigUInt64BE(4));
  if (!Number.isSafeInteger(capturedAt) || capturedAt <= 0) {
    return null;
  }
  return {
    sequence,
    capturedAt,
    bytes: packet.length - HEADER_BYTES,
    payload: Buffer.from(packet.subarray(HEADER_BYTES)),
  };
}

export class MediaWsHub {
  private readonly wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: MAX_MEDIA_PAYLOAD + HEADER_BYTES,
  });

  private readonly workers = new Map<string, WebSocket>();
  private readonly apps = new Map<string, WebSocket>();
  private readonly readyApps = new Set<WebSocket>();
  private readonly appModes = new Map<WebSocket, "media" | "companion">();
  private readonly appAuthority = new Map<WebSocket, { build: number; exp: number }>();
  private readonly companionPlayback = new Map<string, CompanionPlaybackStatus>();
  private readonly workerStreamIds = new Map<string, string>();

  private readonly counters = {
    workerAttempts: 0,
    workerAccepted: 0,
    workerRejected: 0,
    workerCloses: 0,
    appAttempts: 0,
    appAccepted: 0,
    appRejected: 0,
    appRejectedTicket: 0,
    appRejectedCard: 0,
    companionSuperseded: 0,
    appCloses: 0,
    appReady: 0,
    streamStarts: 0,
    streamEnds: 0,
    segmentsAccepted: 0,
    segmentsSent: 0,
    segmentsDroppedNoViewer: 0,
    segmentsDroppedBackpressure: 0,
    bytesAccepted: 0,
    bytesSent: 0,
    lastProfile: "",
    lastSequence: 0,
    lastBytes: 0,
    lastAt: "",
    lastMimeType: "",
    lastStreamId: "",
  };

  constructor(private readonly options: MediaWsHubOptions) {}

  handleUpgrade(
    request: http.IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): boolean {
    const host = request.headers.host || "localhost";
    const url = new URL(request.url || "/", "http://" + host);
    if (
      url.pathname !== "/v1/worker/media-ws" &&
      url.pathname !== "/v1/app/media-ws"
    ) {
      return false;
    }

    const profile = normalizeProfile(
      url.searchParams.get("profile") || "",
    );
    if (!profile) {
      rejectUpgrade(socket, 400, "Bad Request");
      return true;
    }

    const isWorker = url.pathname === "/v1/worker/media-ws";
    if (isWorker) this.counters.workerAttempts += 1;
    else this.counters.appAttempts += 1;

    if (isWorker) {
      void this.upgradeWorker(request, socket, head, profile);
      return true;
    }
    const allowed = this.options.authenticateApp(profile, url, request);
    if (!allowed) {
      this.counters.appRejected += 1;
      this.counters.appRejectedTicket += 1;
      rejectUpgrade(socket, 403, "Forbidden");
      return true;
    }

    const card = cardFromUrl(url);
    const scope = this.options.cardScope?.(profile) ?? "";
    if (!admitCard(card, Date.now(), scope)) {
      this.counters.appRejected += 1;
      this.counters.appRejectedCard += 1;
      rejectUpgrade(socket, 409, "Conflict");
      return true;
    }

    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.counters.appAccepted += 1;
      const release = registerCardSocket(card, () => ws.close(4009, "newer card"), scope);
      ws.on("close", release);
      const build = parseAppBuild(url.searchParams.get("app_build"));
      // v90: rank viewers by when their card was opened. Every open card
      // renews its ticket, so exp let an older card that reconnected with a
      // fresh ticket outrank (and kick) the card the user just opened.
      // Stamped cards (ms) always outrank unstamped ones (exp seconds).
      const exp = card > 0 ? card : parseAuthorityExp(url.searchParams.get("exp"));
      this.acceptApp(profile, ws, { build, exp });
    });
    return true;
  }

  private async upgradeWorker(request: http.IncomingMessage, socket: Duplex, head: Buffer, profile: string): Promise<void> {
    let authority: WorkerTransportAuthority | null = null;
    let current = false;
    try {
      authority = await this.options.authenticateWorker(request);
      current = authority === true || !!authority && await authority.isCurrent();
    } catch {}
    if (!authority || !current || socket.destroyed) {
      this.counters.workerRejected += 1;
      if (!socket.destroyed) rejectUpgrade(socket, 403, "Forbidden");
      return;
    }
    try {
      this.wss.handleUpgrade(request, socket, head, (ws) => {
        ws.pause();
        void (async () => {
          if (!await admitWorkerSocket(authority, ws)) { ws.terminate(); return; }
          this.counters.workerAccepted += 1;
          this.acceptWorker(profile, ws, authority);
          ws.resume();
        })().catch(() => ws.terminate());
      });
    } catch { socket.destroy(); }
  }

  stats(): Record<string, unknown> {
    return {
      ...this.counters,
      workerProfiles: this.workers.size,
      appProfiles: this.apps.size,
      readyAppProfiles: [...this.apps.entries()]
        .filter(([, ws]) => this.readyApps.has(ws))
        .map(([profile]) => profile)
        .sort(),
      companionAppProfiles: [...this.apps.entries()]
        .filter(([, ws]) => this.appModes.get(ws) === "companion")
        .map(([profile]) => profile)
        .sort(),
      appAuthority: [...this.apps.entries()].map(([profile, ws]) => ({
        profile,
        ...(this.appAuthority.get(ws) ?? { build: 0, exp: 0 }),
      })),
      profiles: [...new Set([
        ...this.workers.keys(),
        ...this.apps.keys(),
      ])].sort(),
    };
  }

  appProfiles(): string[] {
    return [...this.apps.keys()];
  }

  appSubscribers(profile?: string): number {
    if (profile) return this.apps.has(profile) ? 1 : 0;
    return this.apps.size;
  }

  appReady(profile: string): boolean {
    const ws = this.apps.get(profile);
    return Boolean(ws && this.readyApps.has(ws));
  }

  /**
   * Drop the Worker's media socket so the recording it still has queued
   * stops competing with the live view for her upload.
   */
  dropWorker(profile: string): void {
    const ws = this.workers.get(profile);
    if (ws) {
      try { ws.terminate(); } catch {}
    }
  }

  /** Turn the card's Watch Together session away (busy server, no points left): it shows why and goes back to LIVE. */
  refuseApp(profile: string, code: number, reason: string): void {
    const ws = this.apps.get(profile);
    if (ws) {
      try { ws.close(code, reason); } catch {}
    }
  }

  appMode(profile: string): "media" | "companion" | null {
    const ws = this.apps.get(profile);
    return ws ? this.appModes.get(ws) ?? null : null;
  }

  companionPlaybackStatus(profile: string): CompanionPlaybackStatus | null {
    return this.companionPlayback.get(profile) ?? null;
  }

  close(): void {
    for (const ws of this.workers.values()) {
      try { ws.close(1001, "server shutdown"); } catch {}
    }
    for (const ws of this.apps.values()) {
      try { ws.close(1001, "server shutdown"); } catch {}
    }
    this.workers.clear();
    this.apps.clear();
    this.readyApps.clear();
    this.appModes.clear();
    this.appAuthority.clear();
    this.companionPlayback.clear();
    this.workerStreamIds.clear();
    this.wss.close();
  }

  private acceptWorker(profile: string, ws: WebSocket, authority: WorkerTransportAuthority = true): void {
    const existing = this.workers.get(profile);
    if (existing && existing !== ws) {
      try { existing.close(1012, "replaced"); } catch {}
    }
    this.workers.set(profile, ws);
    this.options.onWorkerPresence?.(profile, true);

    // WebSocket message order must also hold across asynchronous HLS setup.
    // The first WebM chunk contains the container header; losing it makes
    // every later chunk of that recorder generation undecodable.
    let workerDelivery: Promise<void> = Promise.resolve();
    const enqueueWorkerDelivery = (task: () => void | Promise<void>) => {
      workerDelivery = workerDelivery.then(async () => {
        if (this.workers.get(profile) !== ws || !await workerSocketCurrent(authority, ws) || this.workers.get(profile) !== ws) return;
        await task();
      }).catch(() => {});
    };

    ws.on("message", async (data, isBinary) => {
      if (this.workers.get(profile) !== ws || !await workerSocketCurrent(authority, ws) || this.workers.get(profile) !== ws) return;
      const app = this.apps.get(profile);

      if (!isBinary) {
        const text = normalizeBuffer(data).toString("utf8");
        if (text.length > MAX_TEXT_BYTES) return;
        let message: any = null;
        try { message = JSON.parse(text); } catch { return; }
        if (
          !message ||
          (message.type !== "media_stream_start" &&
            message.type !== "media_stream_end")
        ) {
          return;
        }
        if (message.type === "media_stream_start") {
          this.counters.streamStarts += 1;
          this.counters.lastMimeType =
            typeof message.mimeType === "string"
              ? message.mimeType.slice(0, 160)
              : "";
          this.counters.lastStreamId =
            typeof message.streamId === "string"
              ? message.streamId.slice(0, 160)
              : "";
          if (this.counters.lastStreamId) {
            this.workerStreamIds.set(profile, this.counters.lastStreamId);
            const streamId = this.counters.lastStreamId;
            const mimeType = this.counters.lastMimeType;
            enqueueWorkerDelivery(() =>
              this.options.onWorkerStreamStart?.(profile, streamId, mimeType,
                async () => await workerSocketCurrent(authority, ws) && this.workers.get(profile) === ws),
            );
          }
        } else {
          this.counters.streamEnds += 1;
          const streamId =
            typeof message.streamId === "string"
              ? message.streamId.slice(0, 160)
              : this.workerStreamIds.get(profile) ?? "";
          if (streamId) {
            enqueueWorkerDelivery(() =>
              this.options.onWorkerStreamEnd?.(profile, streamId),
            );
          }
          this.workerStreamIds.delete(profile);
        }
        if (
          app?.readyState === WebSocket.OPEN &&
          this.appModes.get(app) !== "companion"
        ) {
          try { app.send(text); } catch {}
        }
        return;
      }

      const packet = normalizeBuffer(data);
      const segment = parseMediaSegmentPacket(packet);
      if (!segment) {
        try { ws.close(1003, "invalid media segment"); } catch {}
        return;
      }

      this.counters.segmentsAccepted += 1;
      this.counters.bytesAccepted += segment.bytes;
      this.counters.lastProfile = profile;
      this.counters.lastSequence = segment.sequence;
      this.counters.lastBytes = segment.bytes;
      this.counters.lastAt = new Date().toISOString();

      const streamId = this.workerStreamIds.get(profile) ?? "";
      if (streamId) {
        enqueueWorkerDelivery(() =>
          this.options.onWorkerSegment?.(profile, streamId, segment),
        );
      }

      if (
        !app ||
        app.readyState !== WebSocket.OPEN ||
        this.appModes.get(app) === "companion"
      ) {
        this.counters.segmentsDroppedNoViewer += 1;
        return;
      }
      if (app.bufferedAmount > 512_000) {
        this.counters.segmentsDroppedBackpressure += 1;
        return;
      }

      app.send(packet, { binary: true }, (error) => {
        if (!error) {
          this.counters.segmentsSent += 1;
          this.counters.bytesSent += segment.bytes;
        }
      });
    });

    ws.on("close", () => {
      this.counters.workerCloses += 1;
      if (this.workers.get(profile) === ws) {
        this.workers.delete(profile);
        this.workerStreamIds.delete(profile);
        this.options.onWorkerPresence?.(profile, false);
      }
    });
    ws.on("error", () => {});
  }

  private supersededCompanion(profile: string, ws: WebSocket): boolean {
    const mine = this.appAuthority.get(ws) ?? { build: 0, exp: 0 };
    for (const [otherProfile, other] of [...this.apps.entries()]) {
      if (otherProfile === profile || other === ws) continue;
      // Hosted users never supersede each other; personal keeps one scope.
      const scope = this.options.cardScope;
      if (scope && scope(otherProfile) !== scope(profile)) continue;
      if (
        other.readyState !== WebSocket.OPEN ||
        this.appModes.get(other) !== "companion"
      ) {
        continue;
      }
      const theirs = this.appAuthority.get(other) ?? { build: 0, exp: 0 };
      const incomingIsNewer =
        mine.build > theirs.build ||
        (mine.build === theirs.build && mine.exp > theirs.exp);
      this.counters.companionSuperseded += 1;
      if (!incomingIsNewer) {
        try { ws.close(1008, "stale companion viewer"); } catch {}
        return true;
      }
      try { other.close(1008, "newer companion viewer"); } catch {}
    }
    return false;
  }

  private acceptApp(
    profile: string,
    ws: WebSocket,
    authority: { build: number; exp: number },
  ): void {
    const existing = this.apps.get(profile);
    if (
      existing &&
      existing !== ws &&
      existing.readyState === WebSocket.OPEN
    ) {
      const current =
        this.appAuthority.get(existing) ?? { build: 0, exp: 0 };
      const incomingIsNewer =
        authority.build > current.build ||
        (
          authority.build === current.build &&
          authority.exp > current.exp
        );
      if (!incomingIsNewer) {
        this.counters.appRejected += 1;
        ws.on("error", () => {});
        try { ws.close(1008, "stale media viewer"); } catch {}
        return;
      }
      try { existing.close(1012, "newer media viewer"); } catch {}
    }

    const hadViewer = Boolean(
      existing && existing.readyState === WebSocket.OPEN,
    );
    this.apps.set(profile, ws);
    this.appAuthority.set(ws, authority);
    if (!hadViewer) this.options.onAppPresence?.(profile, true);

    ws.on("message", (data, isBinary) => {
      if (isBinary || this.apps.get(profile) !== ws) return;
      const text = normalizeBuffer(data).toString("utf8");
      if (text.length > MAX_TEXT_BYTES) return;
      let message: any = null;
      try { message = JSON.parse(text); } catch { return; }
      if (!message) return;

      if (message.type === "companion_pause") {
        if (this.appModes.get(ws) !== "companion") return;
        this.options.onCompanionPause?.(profile, message.paused === true);
        return;
      }

      if (message.type === "companion_playback_status") {
        if (this.appModes.get(ws) !== "companion") return;
        const finiteOrNull = (value: unknown): number | null =>
          typeof value === "number" && Number.isFinite(value)
            ? value
            : null;
        const currentTime = finiteOrNull(message.currentTime);
        const duration = finiteOrNull(message.duration);
        const sourcePts = finiteOrNull(message.sourcePts);
        const bufferStartPts = finiteOrNull(message.bufferStartPts);
        const bufferEndPts = finiteOrNull(message.bufferEndPts);
        const sourceDuration = finiteOrNull(message.sourceDuration);
        const presentationDateMs = finiteOrNull(message.presentationDateMs);
        this.companionPlayback.set(profile, {
          profile,
          currentTime:
            currentTime !== null && currentTime >= 0 ? currentTime : null,
          duration:
            duration !== null && duration >= 0 ? duration : null,
          sourcePts:
            sourcePts !== null && sourcePts >= 0 ? sourcePts : null,
          bufferStartPts:
            bufferStartPts !== null && bufferStartPts >= 0
              ? bufferStartPts
              : null,
          bufferEndPts:
            bufferEndPts !== null && bufferEndPts >= 0
              ? bufferEndPts
              : null,
          sourceDuration:
            sourceDuration !== null && sourceDuration >= 0
              ? sourceDuration
              : null,
          presentationDateMs:
            presentationDateMs !== null && presentationDateMs > 0
              ? Math.round(presentationDateMs)
              : null,
          paused: message.paused === true,
          ended: message.ended === true,
          readyState:
            typeof message.readyState === "number" &&
            Number.isFinite(message.readyState)
              ? Math.max(0, Math.min(4, Math.round(message.readyState)))
              : 0,
          wallClockAt:
            typeof message.wallClockAt === "number" &&
            Number.isFinite(message.wallClockAt)
              ? Math.round(message.wallClockAt)
              : 0,
          receivedAt: Date.now(),
        });
        return;
      }

      if (
        message.type !== "media_ready" &&
        message.type !== "companion_ready"
      ) {
        return;
      }
      const mode =
        message.type === "companion_ready" ? "companion" : "media";
      const announcedBuild = parseAppBuild(message.appUiBuild);
      const currentAuthority =
        this.appAuthority.get(ws) ?? { build: 0, exp: 0 };
      if (announcedBuild > currentAuthority.build) {
        currentAuthority.build = announcedBuild;
        this.appAuthority.set(ws, currentAuthority);
      }
      // Only the newest companion card may watch, whatever its profile.
      // A card left open in an older chat must not keep its own capture
      // (and audio) alive next to the one the user is actually looking at.
      if (mode === "companion" && this.supersededCompanion(profile, ws)) {
        return;
      }
      const previousMode = this.appModes.get(ws) ?? null;
      this.appModes.set(ws, mode);

      const wasReady = this.readyApps.has(ws);
      if (!wasReady) {
        this.readyApps.add(ws);
        this.counters.appReady += 1;
      }

      if (!wasReady || previousMode !== mode) {
        if (mode === "companion") {
          const entry =
            typeof message.entry === "string" &&
            /^[A-Za-z0-9._-]{1,80}$/.test(message.entry)
              ? message.entry
              : null;
          this.options.onCompanionReady?.(profile, entry);
        } else {
          this.options.onAppReady?.(profile);
        }
      }
    });

    ws.on("close", (code) => {
      this.counters.appCloses += 1;
      const mode = this.appModes.get(ws) ?? null;
      this.readyApps.delete(ws);
      this.appModes.delete(ws);
      this.appAuthority.delete(ws);
      if (this.apps.get(profile) === ws) {
        this.apps.delete(profile);
        this.companionPlayback.delete(profile);
        this.options.onAppModeClosed?.(profile, mode, code === COMPANION_LEAVE_CLOSE_CODE);
        this.options.onAppPresence?.(profile, false);
      }
    });
    ws.on("error", () => {});
  }
}

function parseAppBuild(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  if (typeof value !== "string") return 0;
  const match = value.trim().match(/^v?(\d{1,6})$/i);
  if (!match) return 0;
  const parsed = Number(match[1]);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function parseAuthorityExp(value: string | null): number {
  if (!value || !/^\d{1,12}$/.test(value)) return 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function normalizeBuffer(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (Array.isArray(data)) {
    return Buffer.concat(
      data.map((item) =>
        Buffer.isBuffer(item)
          ? item
          : Buffer.from(item as ArrayBuffer),
      ),
    );
  }
  return Buffer.from(data as ArrayBuffer);
}

function normalizeProfile(value: string): string {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(trimmed)) return "";
  return trimmed;
}

function rejectUpgrade(
  socket: Duplex,
  status: number,
  reason: string,
): void {
  try {
    socket.write(
      "HTTP/1.1 " + status + " " + reason + "\r\n" +
      "Connection: close\r\n" +
      "Content-Length: 0\r\n\r\n",
    );
  } catch {}
  try { socket.destroy(); } catch {}
}
