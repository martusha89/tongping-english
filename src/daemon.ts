import "./env-file.js";
import { PACKAGE_VERSION } from "./package-version.js";
import { SharedImageStore, type SharedImageMime } from "./shared-images.js";
import { createSharedImageTicket, verifySharedImageTicket } from "./shared-image-ticket.js";
import crypto from "node:crypto";
import http from "node:http";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  hostHeaderValidation,
  originValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { bearerMatches, loadOrCreateDaemonToken } from "./auth.js";
import { EnrollmentRejected, WorkerEnrollmentStore } from "./worker-enrollment-store.js";
import { WorkerConnectionRegistry, WorkerSessionRejected } from "./worker-connection-registry.js";
import type { WorkerTransportAuthority } from "./worker-transport-authority.js";
import { PRIVATE_COMPAT_HUMAN_USER_ID } from "./private-persistent-owner.js";
import { ownerScope } from "./route-identity.js";
import { createPrivateTrustedWorkerGateway } from "./private-trusted-worker-gateway.js";
import { PrivateWorkerPairingAuthority, privatePairingAuthorityEnabled } from "./worker-pairing-authority.js";
import { BrowserService, type BrowserAction, type BrowserReply } from "./browser-service.js";
import { loadConfig } from "./config.js";
import { resolveDeploymentMode } from "./deployment-mode.js";
import { acquireDaemonLock } from "./daemon-lock.js";
import { LocalGateway, type BrowserGateway } from "./gateway.js";
import { renderLivePage } from "./live-page.js";
import { BROWSER_APP_URI } from "./browser-app.js";
import {
  LOCAL_APP_COOKIE,
  LOCAL_APP_HOST_ASSET,
  LocalAppSessionStore,
  clearLocalAppCookie,
  cookieValue,
  localAppCookie,
  localAppRequestIsLoopback,
  localAppRequestOriginAllowed,
  parseLocalMcpPayload,
  renderLocalAppHostPage,
  renderLocalAppLaunchRequiredPage,
  scopeLocalAppToolArguments,
} from "./local-app-host.js";
import { createTongpingMcpServer } from "./mcp-server.js";
import { TongpingOAuthService } from "./oauth-service.js";
import { RemoteWorkerRelay } from "./worker-relay.js";
import { LiveWsHub } from "./live-ws-hub.js";
import { AudioWsHub } from "./audio-ws-hub.js";
import { MediaWsHub } from "./media-ws-hub.js";
import { DelayedCompanionHls, sourceTimelineFromResult, type CompanionSourceTimelineAnchor } from "./delayed-companion-hls.js";
import {
  companionHlsRecoveryReason,
  companionHlsSessionHealthy,
} from "./companion-hls-recovery.js";
import { appChatLedger } from "./app-chat-ledger.js";
import {
  OWNER_WATCH_COLLECTION_ID,
  WatchCollectionStore,
} from "./watch-collection-store.js";
import { CompanionFrameBuffer } from "./companion-frame-buffer.js";
import { HostedProfileBindingStore, resolveVerifiedRoute } from "./hosted-profile-binding-store.js";
import { readPrivateTrustedCompanionFrame, readPrivateTrustedCompanionFrameStatus } from "./private-trusted-companion-frame.js";
import { CompanionPerceptionLedger } from "./companion-perception-ledger.js";
import { analyzePcmWindow } from "./audio-vision.js";
import {
  createBrowserFrameUrl,
  createBrowserSingleFrameUrl,
  createBrowserInputUrl,
  deriveBrowserAppSigningKey,
  verifyBrowserControlTicket,
  verifyBrowserFrameTicket,
  verifyBrowserInputTicket,
  verifyBrowserLiveTicket,
  createBrowserWatchCollectionTicket,
  verifyBrowserWatchCollectionTicket,
} from "./browser-app-ticket.js";

const deploymentMode = resolveDeploymentMode(process.env);
if (deploymentMode === "hosted") {
  throw new Error("Hosted mode is not part of the personal edition");
}

const config = loadConfig();
const host = process.env.TONGPING_HOST?.trim() || "127.0.0.1";
const port = parsePort(process.env.TONGPING_PORT);
const service = new BrowserService(config);
const remoteWorkerMode =
  process.env.TONGPING_REMOTE_WORKER === "1";
const enrollmentStore = new WorkerEnrollmentStore(config.homeDir);
const workerConnections = new WorkerConnectionRegistry(enrollmentStore);
const hostedProfileBindings = new HostedProfileBindingStore(config.homeDir);
const privatePairingAuthority = privatePairingAuthorityEnabled(process.env)
  ? new PrivateWorkerPairingAuthority(enrollmentStore)
  : null;
const trustedWorkerTransport = process.env.TONGPING_TRUSTED_WORKER_TRANSPORT === "1";
if (trustedWorkerTransport && (!remoteWorkerMode || !privatePairingAuthority)) {
  throw new Error("Trusted Worker transport requires explicit private-single-user Worker authority");
}
const relay = remoteWorkerMode
  ? new RemoteWorkerRelay()
  : undefined;
const localFallback = process.env.TONGPING_LOCAL_FALLBACK === "1";
const localGateway = new LocalGateway(
  service,
  "streamable-http",
);
const browserGateway: BrowserGateway =
  trustedWorkerTransport
    ? createPrivateTrustedWorkerGateway(workerConnections, PRIVATE_COMPAT_HUMAN_USER_ID)
    : relay && localFallback
    ? {
        call: (action, args, client) =>
          relay.workerStatus().connected
            ? relay.call(action, args, client)
            : localGateway.call(action, args, client),
        human: (action, args, client) =>
          relay.workerStatus().connected
            ? relay.human(action, args, client)
            : localGateway.human(action, args, client),
      }
    : relay
    // Personal edition: the worker on this PC owns the only browser. While it
    // is busy (a first Chrome launch can take minutes) commands queue for it
    // instead of the daemon starting a second Chrome on a separate profile,
    // which split logins and made both launches stall.
    ? relay
    : localGateway;
const token = await loadOrCreateDaemonToken(config.homeDir);
const localAppSessions = new LocalAppSessionStore();
const workerToken = remoteWorkerMode && !trustedWorkerTransport
  ? await loadOrCreateWorkerToken(
      config.homeDir + "/worker-auth",
    )
  : "";
function workerTransportConnected(): boolean {
  // In trusted mode the bridge itself resolves zero/one/ambiguous targets and
  // fails closed. The legacy relay's liveness is irrelevant to that path.
  return trustedWorkerTransport || Boolean(relay?.workerStatus().connected);
}
const appSigningKey = deriveBrowserAppSigningKey(token);
const sharedImages = new SharedImageStore();
const privateSharedImageOwner = ownerScope(PRIVATE_COMPAT_HUMAN_USER_ID);
function createPrivateSharedImage(buffer: Buffer, mimeType: SharedImageMime) {
  const receipt = sharedImages.put(privateSharedImageOwner, buffer, mimeType);
  return { id: receipt.id, ticket: createSharedImageTicket(appSigningKey, receipt.id, privateSharedImageOwner, receipt.expiresAt) };
}
const frameCache = new Map<string, {
  buffer: Buffer;
  viewport: { width: number; height: number } | null;
  updatedAt: number;
}>();
const FRAME_CACHE_TTL_MS = 120_000;
const LIVE_BOUNDARY = "tongpingframe";
const liveFrameCache = new Map<string, {
  buffer: Buffer;
  viewport: { width: number; height: number } | null;
  sequence: number;
  capturedAt: number;
  media: import("./live-ws-hub.js").LiveFrameMediaMeta | null;
  updatedAt: number;
}>();
const liveSubscribers = new Map<string, Set<http.ServerResponse>>();
const companionFrameBuffer = new CompanionFrameBuffer({
  windowMs: 15_000,
  sampleIntervalMs: 500,
  maxFrames: 36,
  maxBytesPerProfile: 12_000_000,
});
const companionPerceptionLedger = new CompanionPerceptionLedger();
const liveFrameStats = {
  attempts: 0,
  accepted: 0,
  lastAt: null as string | null,
  lastProfile: null as string | null,
  lastBytes: 0,
  lastSequence: 0,
  captureClockBaselineMs: null as number | null,
  lastCaptureTransitMs: 0,
  avgCaptureTransitMs: 0,
  maxCaptureTransitMs: 0,
  captureLatencySamples: 0,
  subscribers: 0,
  lastError: null as string | null,
  lastHash: "",
  hashChanges: 0,
};
const liveStopTimers = new Map<string, NodeJS.Timeout>();
const liveActiveProfiles = new Set<string>();
const livePrimedProfiles = new Set<string>();
const audioStopTimers = new Map<string, NodeJS.Timeout>();
const audioPrimedProfiles = new Set<string>();
const audioPrimeStartedAt = new Map<string, number>();
const audioStallRecoveringProfiles = new Set<string>();
const audioStallLastAttemptAt = new Map<string, number>();
const mediaStopTimers = new Map<string, NodeJS.Timeout>();
const mediaPrimedProfiles = new Set<string>();
const companionMediaProfiles = new Set<string>();
const mediaRestartInFlightProfiles = new Set<string>();
const companionRetryAttempts = new Map<string, number>();
const companionRetryTimers = new Map<string, NodeJS.Timeout>();
const companionAppCloseTimers = new Map<string, NodeJS.Timeout>();
const companionAudioStoppedProfiles = new Set<string>();
const companionSourceTimeline = new Map<string, CompanionSourceTimelineAnchor>();
const companionSourceTimelineRefreshing = new Set<string>();
const delayedCompanionHls = new DelayedCompanionHls();
const companionCommandStats = {
  attempts: 0,
  lastAt: null as string | null,
  lastProfile: null as string | null,
  lastMode: null as "media" | "companion" | null,
  lastOk: null as boolean | null,
  lastError: null as string | null,
  lastResult: null as Record<string, unknown> | null,
};

const COMPANION_RETRY_DELAYS_MS = [750, 1_500, 3_000, 5_000, 8_000];
const COMPANION_SLOW_RETRY_MS = 10_000;
// Why the last companion capture failed to attach, for the viewer's
// waiting screen (e.g. a locked PC cannot share a tab).
const companionAttachIssues = new Map<string, { reason: string; at: number }>();
export function companionIssueCode(reason: string): "locked" | "no-video" | "retrying" {
  if (/could not start video source|notreadable|screen is locked/i.test(reason)) return "locked";
  if (/no-video/i.test(reason)) return "no-video";
  return "retrying";
}
const COMPANION_REWIND_MAX_SECONDS = 90;
const companionRewindCheckedEntry = new Map<string, string>();


async function refreshCompanionSourceTimeline(
  profile: string,
): Promise<CompanionSourceTimelineAnchor | null> {
  if (companionSourceTimelineRefreshing.has(profile)) {
    return companionSourceTimeline.get(profile) ?? null;
  }
  companionSourceTimelineRefreshing.add(profile);
  try {
    const requestedAt = Date.now();
    // v71+ workers answer a clock-only read; the full media context scans
    // the page for subtitles and is far too heavy to poll.
    const reply = workerBuildAtLeast(lastWorkerBuild, 71)
      ? await browserGateway.human(
          "human_media_clock",
          { profile },
          "companion-source-timeline",
        )
      : await browserGateway.call(
          "browser_media_context",
          { profile, lookbackSeconds: 0, maxCues: 1 },
          "companion-source-timeline",
        );
    // The page clock was read somewhere inside the round trip.
    const anchor = reply.ok
      ? sourceTimelineFromResult(
          reply.result,
          Math.round((requestedAt + Date.now()) / 2),
        )
      : null;
    if (anchor) companionSourceTimeline.set(profile, anchor);
    return anchor;
  } finally {
    companionSourceTimelineRefreshing.delete(profile);
  }
}


function clearCompanionRetry(profile: string): void {
  const timer = companionRetryTimers.get(profile);
  if (timer) clearTimeout(timer);
  companionRetryTimers.delete(profile);
  companionRetryAttempts.delete(profile);
}

function scheduleCompanionRetry(profile: string): void {
  if (companionRetryTimers.has(profile)) return;
  const attempt = companionRetryAttempts.get(profile) ?? 0;
  // After the quick retries, keep trying slowly for as long as a card is
  // watching: right after a navigation the page often has no playable video
  // yet, and giving up left the viewer stuck until they re-entered.
  const delay =
    COMPANION_RETRY_DELAYS_MS[attempt] ?? COMPANION_SLOW_RETRY_MS;
  companionRetryAttempts.set(profile, attempt + 1);
  const timer = setTimeout(() => {
    companionRetryTimers.delete(profile);
    if (
      mediaWsHub.appSubscribers(profile) <= 0 ||
      !mediaWsHub.appReady(profile) ||
      mediaWsHub.appMode(profile) !== "companion"
    ) {
      return;
    }
    primeCompanionMediaProfile(profile);
  }, delay);
  timer.unref?.();
  companionRetryTimers.set(profile, timer);
}

function cancelCompanionAppClose(profile: string): void {
  const timer = companionAppCloseTimers.get(profile);
  if (timer) clearTimeout(timer);
  companionAppCloseTimers.delete(profile);
}

function scheduleCompanionAppClose(profile: string): void {
  cancelCompanionAppClose(profile);
  const timer = setTimeout(() => {
    companionAppCloseTimers.delete(profile);

    if (
      mediaWsHub.appSubscribers(profile) > 0 &&
      mediaWsHub.appReady(profile) &&
      mediaWsHub.appMode(profile) === "companion"
    ) {
      return;
    }

    mediaPrimedProfiles.delete(profile);
    companionMediaProfiles.delete(profile);
    companionAudioStoppedProfiles.delete(profile);
    companionSourceTimeline.delete(profile);
    clearCompanionRetry(profile);
    void delayedCompanionHls.stop(profile).then(() => {
      // The viewer left companion: after ffmpeg has flushed and exited,
      // delete this watch's recording.
      setTimeout(() => {
        if (mediaWsHub.appMode(profile) === "companion") return;
        void delayedCompanionHls.purge(profile);
      }, 5_000).unref?.();
    });

    if (
      relay &&
      workerTransportConnected() &&
      workerBuildAtLeast(lastWorkerBuild, 47)
    ) {
      void browserGateway
        .human(
          "human_media_stop",
          { profile },
          "companion-app-close",
        )
        .catch(() => {});
    }
  }, 10_000);
  timer.unref?.();
  companionAppCloseTimers.set(profile, timer);
}

const watchCollectionStore = new WatchCollectionStore();

function companionAuthorityActive(profile: string): boolean {
  return (
    companionMediaProfiles.has(profile) ||
    mediaWsHub.appMode(profile) === "companion"
  );
}

function primeLiveProfile(profile: string): void {
  if (
    !relay ||
    !workerTransportConnected() ||
    !workerBuildAtLeast(lastWorkerBuild, 19) ||
    livePrimedProfiles.has(profile) ||
    companionAuthorityActive(profile)
  ) {
    return;
  }

  livePrimedProfiles.add(profile);
  void browserGateway
    .human("human_live_start", { profile }, "live-ws")
    .then((reply) => {
      if (!reply.ok) {
        livePrimedProfiles.delete(profile);
        liveFrameStats.lastError =
          reply.error ?? "worker live start failed";
        return;
      }
      liveActiveProfiles.add(profile);
      liveFrameStats.lastError = null;
    })
    .catch((error) => {
      livePrimedProfiles.delete(profile);
      liveFrameStats.lastError =
        error instanceof Error ? error.message : String(error);
    });
}

function stopLiveProfileIfIdle(
  profile: string,
  client: string,
): void {
  const companionActive = companionAuthorityActive(profile);
  if (
    !relay ||
    !workerTransportConnected() ||
    !workerBuildAtLeast(lastWorkerBuild, 19) ||
    (!companionActive && liveWsHub.appSubscribers(profile) !== 0)
  ) {
    return;
  }

  void browserGateway
    .human("human_live_stop", { profile }, client)
    .then(() => {
      livePrimedProfiles.delete(profile);
      liveActiveProfiles.delete(profile);
    })
    .catch(() => {
      livePrimedProfiles.delete(profile);
      liveActiveProfiles.delete(profile);
    });
}

function stopLiveProfileForCompanion(profile: string): void {
  if (
    !relay ||
    !workerTransportConnected() ||
    !workerBuildAtLeast(lastWorkerBuild, 19)
  ) {
    livePrimedProfiles.delete(profile);
    liveActiveProfiles.delete(profile);
    return;
  }

  void browserGateway
    .human("human_live_stop", { profile }, "companion-live-stop")
    .then(() => {
      livePrimedProfiles.delete(profile);
      liveActiveProfiles.delete(profile);
    })
    .catch(() => {
      livePrimedProfiles.delete(profile);
      liveActiveProfiles.delete(profile);
    });
}

function primeConnectedAppProfiles(): void {
  for (const profile of liveWsHub.appProfiles()) {
    if (liveWsHub.appSubscribers(profile) > 0) {
      primeLiveProfile(profile);
    }
  }
}

function primeAudioProfile(profile: string): void {
  if (
    !relay ||
    !workerTransportConnected() ||
    !workerBuildAtLeast(lastWorkerBuild, 27) ||
    audioPrimedProfiles.has(profile)
  ) {
    return;
  }

  audioPrimedProfiles.add(profile);
  audioPrimeStartedAt.set(profile, Date.now());
  void browserGateway
    .human("human_audio_start", { profile }, "audio-ws")
    .then((reply) => {
      if (!reply.ok) {
        audioPrimedProfiles.delete(profile);
        audioPrimeStartedAt.delete(profile);
      }
    })
    .catch(() => {
      audioPrimedProfiles.delete(profile);
      audioPrimeStartedAt.delete(profile);
    });
}

function primeConnectedAudioProfiles(): void {
  for (const profile of audioWsHub.appProfiles()) {
    if (audioWsHub.appSubscribers(profile) > 0) {
      primeAudioProfile(profile);
    }
  }
}

function stopAudioProfileForCompanion(profile: string): void {
  const pendingStop = audioStopTimers.get(profile);
  if (pendingStop) {
    clearTimeout(pendingStop);
    audioStopTimers.delete(profile);
  }

  // Companion HLS owns the delayed audio track. Realtime audio must release
  // its separate getDisplayMedia capture so only one tab-share remains.
  audioPrimedProfiles.delete(profile);
  audioPrimeStartedAt.delete(profile);
  audioStallRecoveringProfiles.delete(profile);
  audioStallLastAttemptAt.delete(profile);

  if (
    !relay ||
    !workerTransportConnected() ||
    !workerBuildAtLeast(lastWorkerBuild, 27) ||
    companionAudioStoppedProfiles.has(profile)
  ) {
    return;
  }

  companionAudioStoppedProfiles.add(profile);
  void browserGateway
    .human("human_audio_stop", { profile }, "companion-audio-stop")
    .catch(() => {
      companionAudioStoppedProfiles.delete(profile);
    });
}

function primeMediaProfile(profile: string): void {
  if (
    !relay ||
    !workerTransportConnected() ||
    !workerBuildAtLeast(lastWorkerBuild, 47) ||
    companionMediaProfiles.has(profile) ||
    mediaWsHub.appMode(profile) === "companion" ||
    mediaPrimedProfiles.has(profile)
  ) {
    return;
  }

  void delayedCompanionHls.stop(profile);
  mediaPrimedProfiles.add(profile);
  mediaRestartInFlightProfiles.add(profile);
  void browserGateway
    .human(
      "human_media_restart",
      { profile, mode: "media" },
      "media-ws",
    )
    .then((reply) => {
      if (!reply.ok) mediaPrimedProfiles.delete(profile);
    })
    .catch(() => {
      mediaPrimedProfiles.delete(profile);
    })
    .finally(() => {
      mediaRestartInFlightProfiles.delete(profile);
    });
}

function primeCompanionMediaProfile(
  profile: string,
  force = false,
): void {
  const retryAttempt = companionRetryAttempts.get(profile) ?? 0;
  if (
    !relay ||
    !workerTransportConnected() ||
    !workerBuildAtLeast(lastWorkerBuild, 53) ||
    (mediaPrimedProfiles.has(profile) &&
      companionMediaProfiles.has(profile)) ||
    (!force && companionRetryTimers.has(profile))
  ) {
    return;
  }

  if (force) {
    clearCompanionRetry(profile);
  }

  companionMediaProfiles.add(profile);
  mediaPrimedProfiles.add(profile);
  mediaRestartInFlightProfiles.add(profile);
  companionCommandStats.attempts += 1;
  companionCommandStats.lastAt = new Date().toISOString();
  companionCommandStats.lastProfile = profile;
  companionCommandStats.lastMode = "companion";
  companionCommandStats.lastOk = null;
  companionCommandStats.lastError = null;
  companionCommandStats.lastResult = null;
  void browserGateway
    .human(
      "human_media_restart",
      { profile, mode: "companion" },
      "companion-hls",
    )
    .then((reply) => {
      companionCommandStats.lastAt = new Date().toISOString();
      const result =
        reply.ok &&
        reply.result &&
        typeof reply.result === "object" &&
        !Array.isArray(reply.result)
          ? reply.result as Record<string, unknown>
          : null;
      const attached = reply.ok && result?.attached === true;
      companionCommandStats.lastOk = attached;
      companionCommandStats.lastError = attached
        ? null
        : reply.ok
          ? "companion capture not attached"
          : reply.error ?? "companion media restart failed";
      companionCommandStats.lastResult = result;
      if (attached) {
        companionAttachIssues.delete(profile);
      } else {
        const reason =
          typeof result?.reason === "string"
            ? result.reason
            : companionCommandStats.lastError ?? "";
        companionAttachIssues.set(profile, { reason, at: Date.now() });
      }
      if (!attached) {
        mediaPrimedProfiles.delete(profile);
        companionMediaProfiles.delete(profile);
        void delayedCompanionHls.stop(profile);
        scheduleCompanionRetry(profile);
      } else {
        clearCompanionRetry(profile);
      }
    })
    .catch((error) => {
      companionCommandStats.lastAt = new Date().toISOString();
      companionCommandStats.lastOk = false;
      companionCommandStats.lastError =
        error instanceof Error ? error.message : String(error);
      mediaPrimedProfiles.delete(profile);
      companionMediaProfiles.delete(profile);
      void delayedCompanionHls.stop(profile);
      scheduleCompanionRetry(profile);
    })
    .finally(() => {
      mediaRestartInFlightProfiles.delete(profile);
    });
}

function primeConnectedMediaProfiles(): void {
  for (const profile of mediaWsHub.appProfiles()) {
    if (
      mediaWsHub.appSubscribers(profile) <= 0 ||
      !mediaWsHub.appReady(profile)
    ) {
      continue;
    }

    if (mediaWsHub.appMode(profile) === "companion") {
      primeCompanionMediaProfile(profile);
    } else {
      primeMediaProfile(profile);
    }
  }
}

const liveStallRecoveringProfiles = new Set<string>();
const liveStallLastAttemptAt = new Map<string, number>();

const liveWsHub = new LiveWsHub({
  authenticateWorker: authenticateWorkerTransport,
  resolveWorkerRoute: async (authority, alias) => {
    if (!trustedWorkerTransport) return null;
    return authority === true ? null : resolveVerifiedRoute(authority, alias, hostedProfileBindings);
  },
  onWorkerRouteRetired: (route) => companionFrameBuffer.clear(route),
  authorizeControlProducer: async (authority) => {
    if (!trustedWorkerTransport) return true;
    if (authority === true) return false;
    const unique = await workerConnections.resolveUniqueActiveConnection(PRIVATE_COMPAT_HUMAN_USER_ID);
    return unique?.context.sessionId === authority.context.sessionId &&
      unique.context.deviceId === authority.context.deviceId;
  },
  authenticateApp: (profile, url) =>
    verifyBrowserLiveTicket(
      appSigningKey,
      profile,
      url.searchParams.get("exp"),
      url.searchParams.get("sig"),
    ),
  onWorkerPresence: (profile, connected) => {
    if (connected) return;
    livePrimedProfiles.delete(profile);
    liveActiveProfiles.delete(profile);
    if (liveWsHub.appSubscribers(profile) > 0) {
      setTimeout(
        () => primeLiveProfile(profile),
        0,
      ).unref?.();
    }
  },
  onControlWorkerPresence: (profile, connected) => {
    if (connected) return;
    livePrimedProfiles.delete(profile);
    if (liveWsHub.appSubscribers(profile) > 0) {
      setTimeout(
        () => primeLiveProfile(profile),
        0,
      ).unref?.();
    }
  },
  onFrame: (profile, frame, route) => {
    liveFrameStats.attempts += 1;
    liveFrameStats.accepted += 1;
    liveFrameStats.lastAt = new Date().toISOString();
    liveFrameStats.lastProfile = profile;
    liveFrameStats.lastBytes = frame.bytes;
    liveFrameStats.lastSequence = frame.sequence;
    const rawCaptureDeltaMs = Date.now() - frame.capturedAt;
    liveFrameStats.captureClockBaselineMs =
      liveFrameStats.captureClockBaselineMs === null
        ? rawCaptureDeltaMs
        : Math.min(liveFrameStats.captureClockBaselineMs, rawCaptureDeltaMs);
    const captureTransitMs = Math.max(
      0,
      rawCaptureDeltaMs - liveFrameStats.captureClockBaselineMs,
    );
    liveFrameStats.lastCaptureTransitMs = captureTransitMs;
    liveFrameStats.maxCaptureTransitMs = Math.max(
      liveFrameStats.maxCaptureTransitMs,
      captureTransitMs,
    );
    liveFrameStats.captureLatencySamples += 1;
    liveFrameStats.avgCaptureTransitMs +=
      (captureTransitMs - liveFrameStats.avgCaptureTransitMs) /
      liveFrameStats.captureLatencySamples;
    liveFrameStats.lastError = null;
    const jpeg = Buffer.from(frame.packet.subarray(20));
    const frameHash = crypto.createHash("sha1").update(jpeg).digest("hex").slice(0, 12);
    if (liveFrameStats.lastHash && liveFrameStats.lastHash !== frameHash) {
      liveFrameStats.hashChanges += 1;
    }
    liveFrameStats.lastHash = frameHash;
    const viewport = {
      width: frame.width,
      height: frame.height,
    };
    liveFrameCache.set(profile, {
      buffer: jpeg,
      viewport,
      sequence: frame.sequence,
      capturedAt: frame.capturedAt,
      media: frame.media,
      updatedAt: Date.now(),
    });
    const companionInput = {
      buffer: jpeg,
      viewport,
      sequence: frame.sequence,
      capturedAt: frame.capturedAt,
      media: frame.media,
    };
    if (trustedWorkerTransport) {
      if (route) companionFrameBuffer.push(route, companionInput);
    } else {
      companionFrameBuffer.pushLegacy(profile, companionInput);
    }
    if (frame.media) {
      companionPerceptionLedger.activate(
        profile,
        {
          sessionId: frame.media.sessionId,
          playerIdentity: frame.media.playerIdentity,
          mediaIdentity: frame.media.mediaIdentity,
          epoch: frame.media.epoch,
        },
        frame.media.framePts ?? frame.media.sourcePlayheadPts,
      );
    }
    broadcastLiveFrame(
      profile,
      jpeg,
      viewport,
      frame.sequence,
      frame.capturedAt,
    );
  },
  onAppCommand: (profile, message, ws) => {
    const id =
      typeof message.id === "string" ? message.id.slice(0, 80) : "";
    const type =
      typeof message.type === "string" ? message.type : "";

    const reply = (payload: Record<string, unknown>) => {
      if (ws.readyState !== 1) return;
      ws.send(JSON.stringify({ ...payload, id }), () => {});
    };

    if (type === "takeover") {
      const takeover = message.takeover === true;
      void browserGateway
        .human(
          takeover ? "human_takeover_start" : "human_takeover_end",
          { profile },
          "app-ws",
        )
        .then((result) => {
          if (!result.ok) {
            reply({
              type: "command_result",
              ok: false,
              error: result.error ?? "Takeover switch failed",
            });
            return;
          }
          reply({
            type: "command_result",
            ok: true,
            takeover,
          });
        })
        .catch((error) => {
          reply({
            type: "command_result",
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      return;
    }

    if (type === "pointer") {
      const phase =
        typeof message.phase === "string" ? message.phase : "";
      const x =
        typeof message.x === "number" ? message.x : NaN;
      const y =
        typeof message.y === "number" ? message.y : NaN;
      const button =
        message.button === "right" ? "right" : "left";
      const clickCount =
        typeof message.clickCount === "number"
          ? Math.max(1, Math.min(2, Math.round(message.clickCount)))
          : 1;
      if (
        !["down", "move", "up"].includes(phase) ||
        !Number.isFinite(x) ||
        !Number.isFinite(y)
      ) {
        reply({
          type: "command_result",
          ok: false,
          error: "Invalid pointer command",
        });
        return;
      }
      void liveWsHub
        .workerCommand(
          profile,
          { type: "pointer", phase, x, y, button, clickCount },
          8_000,
        )
        .then((result) => {
          reply({
            type: "command_result",
            ok: result.ok,
            ...(result.ok
              ? {}
              : { error: result.error ?? "Realtime pointer failed" }),
          });
        })
        .catch((error) => {
          reply({
            type: "command_result",
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }
  },
  onAppPresence: (profile, connected) => {
    const pendingStop = liveStopTimers.get(profile);
    if (pendingStop) {
      clearTimeout(pendingStop);
      liveStopTimers.delete(profile);
    }

    if (connected) {
      primeLiveProfile(profile);
      return;
    }

    if (
      !relay ||
      !workerTransportConnected() ||
      !workerBuildAtLeast(lastWorkerBuild, 19)
    ) {
      return;
    }

    const timer = setTimeout(() => {
      liveStopTimers.delete(profile);
      stopLiveProfileIfIdle(profile, "live-ws-idle");
    }, 3000);
    timer.unref?.();
    liveStopTimers.set(profile, timer);
  },
});




const liveStallWatchdog = setInterval(() => {
  if (!relay || !workerTransportConnected()) return;
  const now = Date.now();

  for (const profile of liveWsHub.appProfiles()) {
    if (liveWsHub.appSubscribers(profile) <= 0) continue;
    if (
      companionMediaProfiles.has(profile) ||
      mediaWsHub.appMode(profile) === "companion"
    ) {
      continue;
    }

    const latest = liveFrameCache.get(profile);
    if (!latest) continue;
    const stallMs = now - latest.updatedAt;

    // Realtime capture may legitimately deliver sparse frames when the page is
    // visually quiet or the latest-frame transport is pacing under load.
    // Do not restart Chromium every few seconds just because no JPEG arrived.
    // A real recovery requires a sustained 12s frame stall, and attempts are
    // rate-limited to once every 20s.
    if (stallMs < 12_000) continue;

    const previousAttempt = liveStallLastAttemptAt.get(profile) ?? 0;
    if (
      liveStallRecoveringProfiles.has(profile) ||
      now - previousAttempt < 20_000
    ) {
      continue;
    }

    // v34/v35 can wedge their long-poll worker loop while stopping a dead
    // screencast. Do not make an old worker worse. v36+ has bounded teardown
    // and a dedicated realtime restart command over the control websocket.
    if (!workerBuildAtLeast(lastWorkerBuild, 36)) {
      liveFrameStats.lastError = "live-stall-requires-worker-v36";
      continue;
    }

    liveStallRecoveringProfiles.add(profile);
    liveStallLastAttemptAt.set(profile, now);
    liveFrameStats.lastError = "live-screencast-stall-recovery";

    void liveWsHub
      .workerCommand(profile, { type: "live_restart" }, 3_000)
      .then((reply) => {
        liveFrameStats.lastError = reply.ok
          ? null
          : reply.error ?? "live realtime restart failed";
      })
      .catch((error) => {
        liveFrameStats.lastError =
          error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        liveStallRecoveringProfiles.delete(profile);
      });
  }
}, 1_000);
liveStallWatchdog.unref?.();

const audioWsHub = new AudioWsHub({
  authenticateWorker: authenticateWorkerTransport,
  authenticateApp: (profile, url) =>
    verifyBrowserLiveTicket(
      appSigningKey,
      profile,
      url.searchParams.get("exp"),
      url.searchParams.get("sig"),
    ),
  onWorkerPresence: (profile, connected) => {
    if (connected) return;
    audioPrimedProfiles.delete(profile);
    audioPrimeStartedAt.delete(profile);
    if (audioWsHub.appSubscribers(profile) > 0) {
      setTimeout(() => primeAudioProfile(profile), 0).unref?.();
    }
  },
  onAppPresence: (profile, connected) => {
    const pendingStop = audioStopTimers.get(profile);
    if (pendingStop) {
      clearTimeout(pendingStop);
      audioStopTimers.delete(profile);
    }

    if (connected) {
      primeAudioProfile(profile);
      return;
    }

    if (
      !relay ||
      !workerTransportConnected() ||
      !workerBuildAtLeast(lastWorkerBuild, 27)
    ) {
      audioPrimedProfiles.delete(profile);
      return;
    }

    const timer = setTimeout(() => {
      audioStopTimers.delete(profile);
      if (
        audioWsHub.appSubscribers(profile) !== 0 ||
        !workerTransportConnected()
      ) {
        return;
      }
      void browserGateway
        .human("human_audio_stop", { profile }, "audio-ws-idle")
        .then(() => {
          audioPrimedProfiles.delete(profile);
          audioPrimeStartedAt.delete(profile);
        })
        .catch(() => {
          audioPrimedProfiles.delete(profile);
          audioPrimeStartedAt.delete(profile);
        });
    }, 3000);
    timer.unref?.();
    audioStopTimers.set(profile, timer);
  },
});


const audioStallWatchdog = setInterval(() => {
  const now = Date.now();
  if (!relay || !workerTransportConnected()) return;

  for (const profile of audioWsHub.appProfiles()) {
    if (
      audioWsHub.appSubscribers(profile) <= 0 ||
      !audioPrimedProfiles.has(profile) ||
      !audioWsHub.workerConnected(profile) ||
      audioStallRecoveringProfiles.has(profile)
    ) {
      continue;
    }

    const lastChunkAge = audioWsHub.workerLastChunkAgeMs(profile, now);
    const primedFor = now - (audioPrimeStartedAt.get(profile) ?? now);
    const stalled =
      lastChunkAge !== null
        ? lastChunkAge >= 3_000
        : primedFor >= 4_000;
    if (!stalled) continue;

    const previousAttempt = audioStallLastAttemptAt.get(profile) ?? 0;
    if (now - previousAttempt < 6_000) continue;

    audioStallRecoveringProfiles.add(profile);
    audioStallLastAttemptAt.set(profile, now);

    void browserGateway
      .call(
        "browser_media_context",
        { profile, lookbackSeconds: 0, maxCues: 1 },
        "audio-stall-watchdog",
      )
      .then(async (mediaReply) => {
        const result =
          mediaReply?.ok &&
          mediaReply.result &&
          typeof mediaReply.result === "object"
            ? mediaReply.result as Record<string, any>
            : null;
        const media =
          result?.media && typeof result.media === "object"
            ? result.media as Record<string, any>
            : null;

        // Never open an audio helper merely because an empty/paused page has
        // a sound viewer attached. Recovery authority requires active media.
        if (
          !media ||
          media.paused !== false ||
          Number(media.readyState ?? 0) < 2
        ) {
          return;
        }

        const restart = await browserGateway.human(
          "human_audio_start",
          { profile },
          "audio-stall-recovery",
        );
        if (!restart.ok) {
          audioPrimedProfiles.delete(profile);
          audioPrimeStartedAt.delete(profile);
          return;
        }

        audioPrimedProfiles.add(profile);
        audioPrimeStartedAt.set(profile, Date.now());
      })
      .catch(() => {})
      .finally(() => {
        audioStallRecoveringProfiles.delete(profile);
      });
  }
}, 1_000);
audioStallWatchdog.unref?.();


const companionHlsRecoveringProfiles = new Set<string>();

const mediaWsHub = new MediaWsHub({
  authenticateWorker: authenticateWorkerTransport,
  authenticateApp: (profile, url) =>
    verifyBrowserLiveTicket(
      appSigningKey,
      profile,
      url.searchParams.get("exp"),
      url.searchParams.get("sig"),
    ),
  onWorkerPresence: (profile, connected) => {
    // human_media_restart intentionally tears down the old media websocket
    // before attaching the replacement. Do not mistake that expected gap for
    // lost authority or a second companion capture will be started.
    if (connected || mediaRestartInFlightProfiles.has(profile)) return;
    mediaPrimedProfiles.delete(profile);
    companionMediaProfiles.delete(profile);
    void delayedCompanionHls.stop(profile);
  },
  onAppReady: (_profile) => {
    // LIVE uses the realtime JPEG lane. Do not pre-start WebM here:
    // companion_ready owns the only buffered media capture.
  },
  onCompanionPause: (profile, paused) => {
    setCompanionPaused(profile, paused);
  },
  onCompanionReady: (profile, entry) => {
    // Tracked separately from companionEntries: the playlist request for
    // this entry often arrives (and records it) before companion_ready.
    const freshEntry =
      entry !== null && companionRewindCheckedEntry.get(profile) !== entry;
    if (entry !== null) companionRewindCheckedEntry.set(profile, entry);
    noteCompanionEntry(profile, entry);
    cancelCompanionAppClose(profile);
    stopLiveProfileForCompanion(profile);
    stopAudioProfileForCompanion(profile);
    const producing = companionCaptureProducing(profile);
    if (producing && !freshEntry) return;
    void (async () => {
      const timeline =
        await refreshCompanionSourceTimeline(profile).catch(() => null);
      // A viewer who starts watching a clip that only just began wants it
      // from the top, not from wherever the PC already is. Longer-running
      // playback (joining a film half way) is left where it is.
      if (
        freshEntry &&
        timeline &&
        timeline.sourcePts > 1 &&
        timeline.sourcePts <= COMPANION_REWIND_MAX_SECONDS &&
        workerBuildAtLeast(lastWorkerBuild, 73)
      ) {
        const rewound = await browserGateway
          .call("browser_media_seek", { profile, targetSeconds: 0 }, "companion-start-from-top")
          .catch(() => null);
        if (rewound?.ok) {
          companionSourceTimeline.set(profile, {
            ...timeline,
            sourcePts: 0,
            wallClockMs: Date.now(),
          });
          if (producing) {
            // Media captured before the rewind is not part of this watch.
            await delayedCompanionHls.stop(profile).catch(() => {});
            mediaPrimedProfiles.delete(profile);
          }
          primeCompanionMediaProfile(profile, true);
          return;
        }
      }
      if (producing) return;
      primeCompanionMediaProfile(profile, true);
    })();
  },
  onAppModeClosed: (profile, mode) => {
    if (mode !== "companion") return;
    scheduleCompanionAppClose(profile);
  },
  onWorkerStreamStart: async (profile, streamId, mimeType, isCurrent) => {
    if (!companionMediaProfiles.has(profile)) return;
    await delayedCompanionHls.start(
      profile,
      streamId,
      mimeType,
      companionSourceTimeline.get(profile) ?? null,
      isCurrent,
    );
    if (isCurrent && !(await isCurrent())) return;
    if (companionPausedProfiles.has(profile)) {
      // A replacement recorder starts playing; the viewer is still paused.
      delayedCompanionHls.setPaused(profile, true);
      pushCompanionPauseToWorker(profile, true);
    }
  },
  onWorkerSegment: (profile, streamId, segment) => {
    if (!companionMediaProfiles.has(profile)) return;
    delayedCompanionHls.write(profile, streamId, segment.payload);
  },
  onWorkerStreamEnd: async (profile, streamId) => {
    await delayedCompanionHls.stop(profile, streamId);
  },
  onAppPresence: (profile, connected) => {
    const pendingStop = mediaStopTimers.get(profile);
    if (pendingStop) {
      clearTimeout(pendingStop);
      mediaStopTimers.delete(profile);
    }

    if (connected) {
      // Socket presence alone is not capture authority. Wait for media_ready.
      return;
    }

    if (
      !relay ||
      !workerTransportConnected() ||
      !workerBuildAtLeast(lastWorkerBuild, 47)
    ) {
      mediaPrimedProfiles.delete(profile);
      companionMediaProfiles.delete(profile);
      void delayedCompanionHls.stop(profile);
      return;
    }

    const timer = setTimeout(() => {
      mediaStopTimers.delete(profile);
      if (
        mediaWsHub.appSubscribers(profile) !== 0 ||
        !workerTransportConnected()
      ) {
        return;
      }
      void browserGateway
        .human("human_media_stop", { profile }, "media-ws-idle")
        .then(() => {
          mediaPrimedProfiles.delete(profile);
          companionMediaProfiles.delete(profile);
          void delayedCompanionHls.stop(profile);
        })
        .catch(() => {
          mediaPrimedProfiles.delete(profile);
          companionMediaProfiles.delete(profile);
          void delayedCompanionHls.stop(profile);
        });
    }, 3000);
    timer.unref?.();
    mediaStopTimers.set(profile, timer);
  },
});



function companionCaptureProducing(profile: string): boolean {
  if (
    !companionMediaProfiles.has(profile) ||
    !mediaPrimedProfiles.has(profile)
  ) {
    return false;
  }
  const status = delayedCompanionHls.status() as {
    sessions?: Array<{
      profile?: unknown;
      exited: boolean;
      ageMs: number;
      chunksIn: number;
      lastChunkAgeMs: number | null;
    }>;
  };
  return (status.sessions ?? []).some(
    (row) => row.profile === profile && companionHlsSessionHealthy(row),
  );
}

// When a card last entered companion mode (keyed by the app's entry token).
// Segments captured before that are an earlier watch session, e.g. the
// buffer left over from before the viewer went back to LIVE.
const companionEntries = new Map<string, { entry: string; atMs: number }>();

function noteCompanionEntry(profile: string, entry: string | null): void {
  if (!entry) return;
  const current = companionEntries.get(profile)?.entry;
  if (current === entry) return;
  // Entries are the card's entry timestamps: an older card still polling
  // its playlist must not move the cutoff back and forth.
  if (
    current !== undefined &&
    Number.isFinite(Number(current)) &&
    Number.isFinite(Number(entry)) &&
    Number(entry) < Number(current)
  ) {
    return;
  }
  companionEntries.set(profile, { entry, atMs: Date.now() });
  // A fresh watch session starts playing; release a pause left by the last.
  if (companionPausedProfiles.has(profile)) setCompanionPaused(profile, false);
}

// Companion pause holds the source video and the recorder together, so
// resuming continues from exactly where the viewer stopped.
const companionPausedProfiles = new Set<string>();

function setCompanionPaused(profile: string, paused: boolean): void {
  if (paused === companionPausedProfiles.has(profile)) return;
  if (paused) companionPausedProfiles.add(profile);
  else companionPausedProfiles.delete(profile);
  delayedCompanionHls.setPaused(profile, paused);
  if (
    !relay ||
    !workerTransportConnected() ||
    !workerBuildAtLeast(lastWorkerBuild, 69)
  ) {
    return;
  }
  pushCompanionPauseToWorker(profile, paused);
}

// v90: the worker refuses a pause while its capture is between recorders
// ("No live media capture for this profile."). Retry a few times while the
// viewer still wants that state, and re-apply it when a new recorder starts.
function pushCompanionPauseToWorker(
  profile: string,
  paused: boolean,
  attempt = 0,
): void {
  if (
    !relay ||
    !workerTransportConnected() ||
    !workerBuildAtLeast(lastWorkerBuild, 69)
  ) {
    return;
  }
  const retry = () => {
    if (attempt >= 3) return;
    setTimeout(() => {
      if (companionPausedProfiles.has(profile) !== paused) return;
      pushCompanionPauseToWorker(profile, paused, attempt + 1);
    }, 1_500).unref?.();
  };
  void browserGateway
    .human("human_media_pause", { profile, paused }, "companion-pause")
    .then((reply) => {
      if (!reply.ok) retry();
    })
    .catch(retry);
}

const COMPANION_SOURCE_SAMPLE_MS = (() => {
  const raw = Number(process.env.TONGPING_COMPANION_SAMPLE_MS ?? "3000");
  return Number.isFinite(raw) && raw >= 0 ? raw : 3_000;
})();
const companionSourceSampler = setInterval(() => {
  if (COMPANION_SOURCE_SAMPLE_MS === 0) return;
  if (!relay || !workerTransportConnected()) return;
  const status = delayedCompanionHls.status() as {
    sessions?: Array<{ profile?: unknown; exited: boolean }>;
  };
  for (const row of status.sessions ?? []) {
    const profile = typeof row.profile === "string" ? row.profile : "";
    if (
      !profile ||
      row.exited ||
      !companionMediaProfiles.has(profile) ||
      companionPausedProfiles.has(profile) ||
      // Older workers only have the heavy full media read.
      !workerBuildAtLeast(lastWorkerBuild, 71)
    ) {
      continue;
    }
    void refreshCompanionSourceTimeline(profile)
      .then((sample) => {
        if (sample) delayedCompanionHls.noteSourceTimeline(profile, sample);
      })
      .catch(() => {});
  }
}, Math.max(1_000, COMPANION_SOURCE_SAMPLE_MS || 3_000));
companionSourceSampler.unref?.();

// Recordings left from before this daemon started belong to no watch.
void delayedCompanionHls.purgeAll();

const companionHlsRecoveryLastAttemptAt = new Map<string, number>();
const companionHlsWatchdog = setInterval(() => {
  if (!relay || !workerTransportConnected()) return;

  const status = delayedCompanionHls.status() as {
    sessions?: Array<{
      profile?: unknown;
      exited: boolean;
      ageMs: number;
      chunksIn: number;
      lastChunkAgeMs: number | null;
    }>;
  };

  for (const row of status.sessions ?? []) {
    const profile =
      typeof row.profile === "string" ? row.profile : "";
    if (!profile || companionHlsRecoveringProfiles.has(profile) ||
        mediaRestartInFlightProfiles.has(profile) ||
        companionPausedProfiles.has(profile)) continue;
    const now = Date.now();
    const lastAttemptAt = companionHlsRecoveryLastAttemptAt.get(profile) ?? 0;
    if (!companionHlsRecoveryReason(row, now, lastAttemptAt)) continue;
    if (
      mediaWsHub.appSubscribers(profile) <= 0 ||
      !mediaWsHub.appReady(profile) ||
      mediaWsHub.appMode(profile) !== "companion"
    ) {
      continue;
    }

    companionHlsRecoveryLastAttemptAt.set(profile, now);
    companionHlsRecoveringProfiles.add(profile);
    void delayedCompanionHls
      .stop(profile)
      .catch(() => {})
      .then(() => {
        mediaPrimedProfiles.delete(profile);
        companionMediaProfiles.add(profile);
        primeCompanionMediaProfile(profile, true);
      })
      .finally(() => {
        setTimeout(() => {
          companionHlsRecoveringProfiles.delete(profile);
        }, 3_000).unref?.();
      });
  }
}, 1_000);
companionHlsWatchdog.unref?.();


let lastWorkerBuild = "";
const workerPollStats = {
  active: 0,
  maxActive: 0,
  total: 0,
};
const workerResultStats = {
  attempts: 0,
  accepted: 0,
  rejected: 0,
  lastAt: null as string | null,
};
const frameUploadStats = {
  attempts: 0,
  lastAt: null as string | null,
  lastProfile: null as string | null,
  lastBytes: 0,
  lastError: null as string | null,
};
const publicUrl =
  process.env.TONGPING_PUBLIC_ORIGIN?.trim().replace(/\/+$/, "") ?? "";
const oauthPassword =
  process.env.TONGPING_OAUTH_PASSWORD?.trim() ||
  (await readOptionalText(config.homeDir + "/oauth-password"));
const oauth =
  publicUrl && oauthPassword
    ? new TongpingOAuthService(
        publicUrl,
        oauthPassword,
        config.homeDir + "/oauth-store.json",
        Date.now,
        parseCsv(process.env.TONGPING_TRUSTED_PROXY_ADDRESSES, []),
      )
    : undefined;
await oauth?.init();
const lock = await acquireDaemonLock(config.homeDir);
const mcpAppBundlePath = fileURLToPath(
  import.meta.resolve("@modelcontextprotocol/ext-apps/app-with-deps"),
);
const localAppHostBundlePath = fileURLToPath(
  new URL("../assets/local-app-host-v1.js", import.meta.url),
);

const ACTIONS = new Set<BrowserAction>([
  "browser_profiles",
  "browser_open",
  "browser_back",
  "browser_forward",
  "browser_reload",
  "browser_audio_vision",
  "browser_media_context",
  "browser_read",
  "browser_snapshot",
  "browser_hover",
  "browser_click",
  "browser_double_click",
  "browser_request_click_approval",
  "browser_approval_status",
  "browser_type",
  "browser_press",
  "browser_select",
  "browser_set_files",
  "browser_scroll",
  "browser_wait",
  "browser_screenshot",
  "browser_close_profile",
]);

const allowedHosts = parseCsv(
  process.env.TONGPING_ALLOWED_HOSTS,
  ["localhost", "127.0.0.1", "[::1]"],
);
const allowedOrigins = parseCsv(
  process.env.TONGPING_ALLOWED_ORIGINS,
  ["localhost", "127.0.0.1", "[::1]"],
);

const validateHost = hostHeaderValidation(allowedHosts);
const validateOrigin = originValidation(allowedOrigins);

function requestFromClaudeHost(request: Request | undefined): boolean {
  const auth = request?.headers.get("authorization") ?? "";
  if (!oauth || !auth.startsWith("Bearer ")) return false;
  return oauth
    .tokenRedirectUris(auth.slice("Bearer ".length))
    .some((uri) => /^https:\/\/([a-z0-9-]+\.)*claude\.ai\//i.test(uri));
}

const httpMcp = createMcpHandler(
  (ctx) =>
    createTongpingMcpServer(
      browserGateway,
      PACKAGE_VERSION,
      {
        appSigningKey,
        createSharedImage: createPrivateSharedImage,
        claudeHost: requestFromClaudeHost(ctx?.requestInfo),
        // Expose WebSocket live view only after the local worker has the
        // isolated v19 WS transport. Older workers stay on stable snapshots.
        liveEnabled: workerBuildAtLeast(lastWorkerBuild, 19),
        externalLoginEnabled: workerBuildAtLeast(lastWorkerBuild, 28),
        getWorkerBuild: () => lastWorkerBuild,
        companionFrameSource: trustedWorkerTransport ? "companion-buffer" : "companion-hls-buffer",
        // The profile the user's open card is showing, for tools called
        // without an explicit profile.
        getViewerProfile: () =>
          mediaWsHub.appProfiles()[0] ?? liveWsHub.appProfiles()[0] ?? null,
        getCompanionPlaybackStatus: (profile) =>
          mediaWsHub.companionPlaybackStatus(profile),
        seekCompanionSource: async (profile, targetSeconds) => {
          const seekReply = await browserGateway.call(
            "browser_media_seek",
            { profile, targetSeconds },
            "companion-source-seek",
          );
          if (!seekReply.ok) {
            throw new Error(
              seekReply.error ?? "Source media seek failed.",
            );
          }

          const result =
            seekReply.result &&
            typeof seekReply.result === "object" &&
            !Array.isArray(seekReply.result)
              ? seekReply.result as Record<string, unknown>
              : {};
          const currentTime =
            typeof result.currentTime === "number" &&
            Number.isFinite(result.currentTime)
              ? Math.max(0, result.currentTime)
              : Math.max(0, targetSeconds);
          const duration =
            typeof result.duration === "number" &&
            Number.isFinite(result.duration) &&
            result.duration >= 0
              ? result.duration
              : null;
          const playbackRate =
            typeof result.playbackRate === "number" &&
            Number.isFinite(result.playbackRate) &&
            result.playbackRate > 0
              ? result.playbackRate
              : 1;
          const sourceTimeline: CompanionSourceTimelineAnchor = {
            sourcePts: currentTime,
            sourceDuration: duration,
            wallClockMs: Date.now(),
            playbackRate,
          };
          companionSourceTimeline.set(profile, sourceTimeline);

          await delayedCompanionHls.stop(profile).catch(() => {});
          mediaPrimedProfiles.delete(profile);
          companionMediaProfiles.add(profile);
          mediaRestartInFlightProfiles.add(profile);
          try {
            const restart = await browserGateway.human(
              "human_media_restart",
              { profile, mode: "companion" },
              "companion-source-seek",
            );
            if (!restart.ok) {
              throw new Error(
                restart.error ?? "Companion capture restart failed.",
              );
            }
          } finally {
            mediaRestartInFlightProfiles.delete(profile);
          }

          return {
            ...result,
            sourceTimeline,
            companionRestarted: true,
          };
        },
        getCompanionAudioVision: async (profile, seconds) => {
          const playback = mediaWsHub.companionPlaybackStatus(profile);
          if (
            !playback ||
            playback.currentTime === null ||
            Date.now() - playback.receivedAt > 5_000
          ) {
            return {
              available: false,
              ready: false,
              source: "companion-hls-buffer",
              error: "No fresh companion playback clock.",
            };
          }
          const pcm = await delayedCompanionHls.audioPcmAtPlayback(
            profile,
            playback,
            seconds,
          );
          if (!pcm) {
            return {
              available: false,
              ready: false,
              source: "companion-hls-buffer",
              error: "Buffered HLS audio is not available yet.",
            };
          }

          const readout = analyzePcmWindow(profile, pcm, seconds);
          return {
            available: readout.ready,
            source: "companion-hls-buffer",
            playbackTime: playback.currentTime,
            presentationDateMs: playback.presentationDateMs,
            ...readout,
          };
        },
        getCompanionFrame: async (profile, lookbackSeconds) => {
          if (trustedWorkerTransport) {
            return readPrivateTrustedCompanionFrame(
              workerConnections, hostedProfileBindings, PRIVATE_COMPAT_HUMAN_USER_ID,
              companionFrameBuffer, profile, lookbackSeconds,
            );
          }
          const playback = mediaWsHub.companionPlaybackStatus(profile);
          if (
            !playback ||
            playback.currentTime === null ||
            Date.now() - playback.receivedAt > 5_000
          ) {
            return null;
          }
          return await delayedCompanionHls.frameAtPlayback(
            profile,
            playback,
            lookbackSeconds,
          );
        },
        getCompanionFrameStatus: async (profile) => {
          if (trustedWorkerTransport) {
            const status = await readPrivateTrustedCompanionFrameStatus(
              workerConnections, hostedProfileBindings, PRIVATE_COMPAT_HUMAN_USER_ID,
              companionFrameBuffer, profile,
            );
            return status
              ? { source: "trusted-companion-buffer", ...status }
              : null;
          }
          return {
            ...delayedCompanionHls.status(profile),
            playback: mediaWsHub.companionPlaybackStatus(profile),
            source: "companion-hls-buffer",
          };
        },
        getPresentationStatus: (profile) =>
          liveWsHub.presentationStatus(profile),
        issuePerceptionPacket: (input) =>
          companionPerceptionLedger.issue(input),
        commitPerceptionPacket: (packetId, options) =>
          companionPerceptionLedger.commit(packetId, options),
        failPerceptionPacket: (packetId, reason) =>
          companionPerceptionLedger.fail(packetId, reason),
        getPerceptionStatus: (profile) =>
          companionPerceptionLedger.status(profile),
      },
    ),
  { responseMode: "json" },
);
const nodeMcpHandler = toNodeHandler(httpMcp);

let localMcpRequestId = 0;

async function localMcpRequest(
  method: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const id = ++localMcpRequestId;
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
      origin: `http://127.0.0.1:${port}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > 16_000_000) {
    throw new Error("Local MCP response was too large");
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > 16_000_000) {
    throw new Error("Local MCP response was too large");
  }
  if (!response.ok) {
    throw new Error(`Local MCP request failed (${response.status})`);
  }
  return parseLocalMcpPayload(
    text,
    response.headers.get("content-type"),
    id,
  );
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`,
    );

    if (oauth && (await oauth.handle(request, response, url))) {
      return;
    }

    if (
      request.method === "GET" &&
      url.pathname === "/assets/tongping-icon.png"
    ) {
      const body = await readFile(
        fileURLToPath(new URL("../assets/tongping-icon.png", import.meta.url)),
      );
      response.writeHead(200, {
        "content-type": "image/png",
        "content-length": body.length,
        "cache-control": "public, max-age=86400",
        "access-control-allow-origin": "*",
      });
      response.end(body);
      return;
    }

    // Camera face effects for "Let Them See You", built from the original demo by
    // scripts/build-camera-fx.mjs; the card loads them only when the camera opens.
    const cameraFxAsset = /^\/assets\/camera-fx\/(geometry|engine)\.js$/.exec(url.pathname);
    if (request.method === "GET" && cameraFxAsset) {
      const body = await readFile(
        fileURLToPath(new URL("../assets/camera-fx/" + cameraFxAsset[1] + ".js", import.meta.url)),
      );
      response.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "content-length": body.length,
        "cache-control": "public, max-age=3600",
        "access-control-allow-origin": "*",
      });
      response.end(body);
      return;
    }

    if (
      request.method === "GET" &&
      url.pathname === "/assets/mcp-app-v2.js"
    ) {
      const body = await readFile(mcpAppBundlePath);
      response.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "content-length": body.length,
        "cache-control": "public, max-age=31536000, immutable",
        "access-control-allow-origin": "*",
      });
      response.end(body);
      return;
    }

    if (
      request.method === "GET" &&
      url.pathname === LOCAL_APP_HOST_ASSET
    ) {
      const body = await readFile(localAppHostBundlePath);
      response.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "content-length": body.length,
        "cache-control": "public, max-age=31536000, immutable",
      });
      response.end(body);
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/v1/local-app/launch"
    ) {
      if (!localAppRequestAllowed(request)) {
        return sendJson(response, 404, { ok: false, error: "Not found" });
      }
      if (!bearerMatches(request.headers.authorization, token)) {
        return sendJson(response, 401, { ok: false, error: "Unauthorized" });
      }
      const body = await readJsonBody(request, 16_384);
      const launch = localAppSessions.createLaunch({
        identity: requiredBodyString(body, "identity"),
        profile: requiredBodyString(body, "profile"),
        bridgeOrigin:
          typeof body.bridgeOrigin === "string" ? body.bridgeOrigin : undefined,
        bridgeToken: requiredBodyString(body, "bridgeToken"),
      });
      return sendJson(response, 200, {
        ok: true,
        url: `http://127.0.0.1:${port}/app/launch?code=${encodeURIComponent(launch.code)}`,
        expiresAt: new Date(launch.expiresAt).toISOString(),
      });
    }

    if (
      request.method === "GET" &&
      url.pathname === "/app/launch"
    ) {
      if (!localAppRequestAllowed(request)) {
        return sendJson(response, 404, { ok: false, error: "Not found" });
      }
      const code = url.searchParams.get("code") ?? "";
      const previousSessionId = cookieValue(
        request.headers.cookie,
        LOCAL_APP_COOKIE,
      );
      const session = localAppSessions.consumeLaunch(code);
      if (!session) {
        response.writeHead(303, {
          location: "/app",
          "set-cookie": clearLocalAppCookie(),
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
        });
        response.end();
        return;
      }
      localAppSessions.revoke(previousSessionId);
      response.writeHead(303, {
        location: "/app",
        "set-cookie": localAppCookie(session.id),
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      });
      response.end();
      return;
    }

    if (request.method === "GET" && url.pathname === "/app") {
      if (!localAppRequestAllowed(request)) {
        return sendJson(response, 404, { ok: false, error: "Not found" });
      }
      const session = localAppSessionFromRequest(request);
      const nonce = crypto.randomBytes(18).toString("base64url");
      return sendLocalAppHtml(
        response,
        session
          ? renderLocalAppHostPage(session, nonce)
          : renderLocalAppLaunchRequiredPage(nonce),
        nonce,
      );
    }

    if (
      request.method === "GET" &&
      url.pathname === "/v1/local-app/card"
    ) {
      const session = localAppSessionFromRequest(request);
      if (!session) {
        response.setHeader("set-cookie", clearLocalAppCookie());
        return sendJson(response, 401, {
          ok: false,
          error: "Local app session expired. Open the TongPing room again.",
        });
      }
      const resource = await localMcpRequest("resources/read", {
        uri: BROWSER_APP_URI,
      });
      const contents = Array.isArray(resource.contents) ? resource.contents : [];
      const card = contents.find(
        (value) =>
          value &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          typeof (value as { text?: unknown }).text === "string",
      ) as { text: string } | undefined;
      if (!card) throw new Error("TongPing card resource was empty");
      return sendLocalAppCardHtml(response, card.text);
    }

    if (
      request.method === "POST" &&
      url.pathname === "/v1/local-app/bootstrap"
    ) {
      const session = localAppApiSession(request);
      if (!session) {
        response.setHeader("set-cookie", clearLocalAppCookie());
        return sendJson(response, 401, {
          ok: false,
          error: "Local app session expired. Open the TongPing room again.",
        });
      }
      const initialResult = await localMcpRequest("tools/call", {
        name: "browser_app",
        arguments: {
          identity: session.identity,
          profile: session.profile,
        },
      });
      return sendJson(response, 200, {
        initialResult,
      });
    }

    if (
      request.method === "POST" &&
      url.pathname === "/v1/local-app/message"
    ) {
      const session = localAppApiSession(request);
      if (!session) {
        response.setHeader("set-cookie", clearLocalAppCookie());
        return sendJson(response, 401, {
          ok: false,
          error: "Local app session expired. Open the TongPing room again.",
        });
      }
      const body = await readJsonBody(request, 64_000);
      const text = requiredBodyString(body, "text").trim();
      if (!text || text.length > 16_000) {
        return sendJson(response, 400, {
          ok: false,
          error: "Invalid chat message",
        });
      }
      const bridgeResponse = await fetch(`${session.bridgeOrigin}/message`, {
        method: "POST",
        headers: {
          authorization: `Bridge ${session.bridgeToken}`,
          "content-type": "application/json",
          origin: `http://127.0.0.1:${port}`,
        },
        body: JSON.stringify({
          text,
          identity: session.identity,
          profile: session.profile,
        }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!bridgeResponse.ok) {
        return sendJson(response, 502, {
          ok: false,
          error: "Hearthside conversation bridge is not attached",
        });
      }
      return sendJson(response, 202, { ok: true });
    }

    if (
      request.method === "POST" &&
      url.pathname === "/v1/local-app/tool"
    ) {
      const session = localAppApiSession(request);
      if (!session) {
        response.setHeader("set-cookie", clearLocalAppCookie());
        return sendJson(response, 401, {
          ok: false,
          error: "Local app session expired. Open the TongPing room again.",
        });
      }
      const body = await readJsonBody(request, 12_000_000);
      const name = requiredBodyString(body, "name");
      const args = scopeLocalAppToolArguments(
        name,
        body.arguments,
        session,
      );
      const result = await localMcpRequest("tools/call", {
        name,
        arguments: args,
      });
      return sendJson(response, 200, result);
    }

    if (
      request.method === "GET" &&
      url.pathname === "/v1/app/frame"
    ) {
      const profile = requiredQuery(url, "profile");
      const valid = verifyBrowserFrameTicket(
        appSigningKey,
        profile,
        url.searchParams.get("exp"),
        url.searchParams.get("sig"),
      );
      if (!valid) {
        return sendJson(response, 403, {
          ok: false,
          error: "Invalid or expired frame ticket",
        });
      }

      // A finite frame request is distinct from the long-lived compatibility
      // stream. Model-side screenshots prefer the already-flowing live JPEG;
      // worker-exported screenshots ask for their exact uploaded PNG.
      const singleFrameSource = url.searchParams.get("once");
      if (singleFrameSource === "live") {
        const latest = liveFrameCache.get(profile);
        if (latest && Date.now() - latest.updatedAt <= 10_000) {
          return sendImage(
            response,
            latest.buffer,
            latest.viewport,
            "image/jpeg",
            true,
          );
        }
        return sendJson(response, 404, {
          ok: false,
          error: "No fresh live frame is available",
        });
      }
      if (singleFrameSource === "frame" || singleFrameSource === "1") {
        const cached = frameCache.get(profile);
        if (cached && Date.now() - cached.updatedAt <= FRAME_CACHE_TTL_MS) {
          return sendImage(
            response,
            cached.buffer,
            cached.viewport,
            "image/png",
            true,
          );
        }
        return sendJson(response, 404, {
          ok: false,
          error: "No fresh uploaded frame is available",
        });
      }

      if (
        remoteWorkerMode &&
        workerBuildAtLeast(lastWorkerBuild, 19)
      ) {
        response.writeHead(200, {
          "content-type":
            "multipart/x-mixed-replace; boundary=" + LIVE_BOUNDARY,
          "cache-control": "no-store, no-cache, must-revalidate",
          pragma: "no-cache",
          "access-control-allow-origin": "*",
          "x-accel-buffering": "no",
        });
        response.flushHeaders?.();

        const latest = liveFrameCache.get(profile);
        if (latest) {
          writeLivePart(
            response,
            latest.buffer,
            latest.viewport,
            latest.sequence,
            latest.capturedAt,
            "image/jpeg",
          );
        }

        let subscribers = liveSubscribers.get(profile);
        if (!subscribers) {
          subscribers = new Set();
          liveSubscribers.set(profile, subscribers);
        } else {
          for (const previous of [...subscribers]) {
            subscribers.delete(previous);
            liveFrameStats.subscribers = Math.max(
              0,
              liveFrameStats.subscribers - 1,
            );
            try { previous.end(); } catch {}
          }
        }
        subscribers.add(response);
        liveFrameStats.subscribers += 1;

        // v19+ legacy frame viewers are passive compatibility clients.
        // Only a real /v1/app/live-ws subscriber may request live capture.
        const cleanup = () => {
          const current = liveSubscribers.get(profile);
          if (current?.delete(response)) {
            liveFrameStats.subscribers = Math.max(
              0,
              liveFrameStats.subscribers - 1,
            );
            if (current.size === 0) {
              liveSubscribers.delete(profile);
            }
          }

          // Do not stop v19 live capture from a legacy frame viewer closing.
          // The worker lease expires naturally when the WebSocket viewer is gone.
        };
        request.once("aborted", cleanup);
        response.once("close", cleanup);
        return;
      }

      if (remoteWorkerMode) {
        const cached = frameCache.get(profile);
        if (cached && Date.now() - cached.updatedAt <= FRAME_CACHE_TTL_MS) {
          return sendPng(response, cached.buffer, cached.viewport, true);
        }
        const placeholder = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL6WQAAAABJRU5ErkJggg==",
          "base64",
        );
        return sendPng(response, placeholder, { width: 1, height: 1 }, true);
      }
      const previewReply = await browserGateway.human(
        "human_preview",
        { profile },
        "app-frame",
      );
      if (!previewReply.ok) {
        return sendJson(response, 502, {
          ok: false,
          error:
            previewReply.error ??
            "Browser worker preview failed",
        });
      }
      const preview =
        previewReply.result as Record<string, unknown>;
      const image =
        typeof preview.base64 === "string"
          ? Buffer.from(preview.base64, "base64")
          : Buffer.alloc(0);
      const viewport =
        preview.viewport &&
        typeof preview.viewport === "object"
          ? preview.viewport as {
              width: number;
              height: number;
            }
          : null;
      if (!image.length) {
        return sendJson(response, 502, {
          ok: false,
          error: "Browser worker returned no frame",
        });
      }
      return sendPng(
        response,
        image,
        viewport,
        true,
      );
    }

    if (
      request.method === "GET" &&
      url.pathname === "/v1/app/live"
    ) {
      const profile = requiredQuery(url, "profile");
      const valid = verifyBrowserLiveTicket(
        appSigningKey,
        profile,
        url.searchParams.get("exp"),
        url.searchParams.get("sig"),
      );
      if (!valid) {
        return sendJson(response, 403, {
          ok: false,
          error: "Invalid or expired live ticket",
        });
      }

      response.writeHead(200, {
        "content-type":
          "multipart/x-mixed-replace; boundary=" + LIVE_BOUNDARY,
        "cache-control": "no-store, no-cache, must-revalidate",
        pragma: "no-cache",
        "access-control-allow-origin": "*",
        "x-accel-buffering": "no",
      });
      response.flushHeaders?.();

      const latest = liveFrameCache.get(profile);
      if (latest) {
        writeLivePart(
          response,
          latest.buffer,
          latest.viewport,
          latest.sequence,
          latest.capturedAt,
          "image/jpeg",
        );
      }

      let subscribers = liveSubscribers.get(profile);
      if (!subscribers) {
        subscribers = new Set();
        liveSubscribers.set(profile, subscribers);
      } else {
        for (const previous of [...subscribers]) {
          subscribers.delete(previous);
          liveFrameStats.subscribers = Math.max(
            0,
            liveFrameStats.subscribers - 1,
          );
          try { previous.end(); } catch {}
        }
      }
      subscribers.add(response);
      liveFrameStats.subscribers += 1;

      let liveLeaseTimer: NodeJS.Timeout | undefined;
      if (!workerBuildAtLeast(lastWorkerBuild, 19)) {
        const renewLiveLease = () => {
          void browserGateway.human(
            "human_live_start",
            { profile },
            "app-live",
          ).catch(() => {});
        };
        renewLiveLease();
        liveLeaseTimer = setInterval(
          renewLiveLease,
          20_000,
        );
      }

      const cleanup = () => {
        if (liveLeaseTimer) clearInterval(liveLeaseTimer);
        const current = liveSubscribers.get(profile);
        if (current?.delete(response)) {
          liveFrameStats.subscribers = Math.max(
            0,
            liveFrameStats.subscribers - 1,
          );
          if (current.size === 0) liveSubscribers.delete(profile);
        }
      };
      request.once("aborted", cleanup);
      response.once("close", cleanup);
      return;
    }

    if (
      request.method === "OPTIONS" &&
      (url.pathname === "/v1/app/pointer" ||
       url.pathname === "/v1/app/control")
    ) {
      response.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "600",
      });
      response.end();
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/v1/app/control"
    ) {
      const profile = requiredQuery(url, "profile");
      const identity = requiredQuery(url, "identity");
      const valid = verifyBrowserControlTicket(
        appSigningKey,
        profile,
        identity,
        url.searchParams.get("exp"),
        url.searchParams.get("sig"),
      );
      if (!valid) {
        return sendJson(response, 403, {
          ok: false,
          error: "Invalid or expired control ticket",
        });
      }

      const body = await readJsonBody(request);
      if (typeof body.takeover !== "boolean") {
        return sendJson(response, 400, {
          ok: false,
          error: "takeover must be boolean",
        });
      }

      const reply = await browserGateway.human(
        body.takeover ? "human_takeover_start" : "human_takeover_end",
        { profile },
        identity,
      );
      if (!reply.ok) {
        return sendJson(response, 502, {
          ok: false,
          error: reply.error ?? "Takeover switch failed",
        });
      }

      return sendJson(response, 200, {
        ok: true,
        takeover: body.takeover,
        inputUrl: body.takeover
          ? createBrowserInputUrl(
              publicUrl,
              appSigningKey,
              profile,
              identity,
              180,
            )
          : "",
      });
    }

    if (
      request.method === "POST" &&
      url.pathname === "/v1/app/pointer"
    ) {
      const profile = requiredQuery(url, "profile");
      const identity = requiredQuery(url, "identity");
      const valid = verifyBrowserInputTicket(
        appSigningKey,
        profile,
        identity,
        url.searchParams.get("exp"),
        url.searchParams.get("sig"),
      );
      if (!valid) {
        return sendJson(response, 403, {
          ok: false,
          error: "Invalid or expired input ticket",
        });
      }
      const body = await readJsonBody(request);
      const phase = requiredBodyString(body, "phase");
      if (!["down", "move", "up"].includes(phase)) {
        return sendJson(response, 400, {
          ok: false,
          error: "Invalid pointer phase",
        });
      }
      const x = requiredBodyNumber(body, "x");
      const y = requiredBodyNumber(body, "y");
      const pointerReply = workerBuildAtLeast(lastWorkerBuild, 29)
        ? await liveWsHub.workerCommand(
            profile,
            { type: "pointer", phase, x, y },
          )
        : await browserGateway.human(
            "human_pointer",
            { profile, phase, x, y },
            identity,
          );
      if (!pointerReply.ok) {
        return sendJson(response, 502, {
          ok: false,
          error:
            pointerReply.error ??
            "Browser worker pointer failed",
        });
      }
      const responseBody = JSON.stringify({
        ok: true,
        result:
          "result" in pointerReply
            ? pointerReply.result
            : undefined,
      });
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(responseBody),
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      });
      response.end(responseBody);
      return;
    }

    if (
      request.method === "OPTIONS" &&
      (
        url.pathname === "/v1/app/watch-collection" ||
        url.pathname === "/v1/app/watch-ticket-image"
      )
    ) {
      response.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "600",
      });
      response.end();
      return;
    }

    if (
      request.method === "GET" &&
      url.pathname === "/v1/app/watch-ticket-image"
    ) {
      const profile = requiredQuery(url, "profile");
      const exp = url.searchParams.get("exp");
      const sig = url.searchParams.get("sig");
      if (
        !verifyBrowserWatchCollectionTicket(
          appSigningKey,
          profile,
          "read",
          exp,
          sig,
        )
      ) {
        return sendJson(response, 403, {
          ok: false,
          error: "Invalid or expired watch collection ticket",
        });
      }
      // v90: single owner collection; the card's own collectionId is ignored.
      const collectionId = OWNER_WATCH_COLLECTION_ID;
      const ticketId = requiredQuery(url, "ticketId");
      const image = await watchCollectionStore.image(
        collectionId,
        ticketId,
      );
      if (!image) {
        return sendJson(response, 404, {
          ok: false,
          error: "Watch ticket image not found",
        });
      }
      response.writeHead(200, {
        "content-type": image.mimeType,
        "content-length": image.buffer.length,
        "cache-control": "private, max-age=60",
        "access-control-allow-origin": "*",
      });
      response.end(image.buffer);
      return;
    }

    if (
      (request.method === "GET" || request.method === "POST") &&
      url.pathname === "/v1/app/watch-collection"
    ) {
      const profile = requiredQuery(url, "profile");
      const exp = url.searchParams.get("exp");
      const sig = url.searchParams.get("sig");
      if (
        !verifyBrowserWatchCollectionTicket(
          appSigningKey,
          profile,
          request.method === "POST" ? "write" : "read",
          exp,
          sig,
        )
      ) {
        return sendJson(response, 403, {
          ok: false,
          error: "Invalid or expired watch collection ticket",
        });
      }

      const withImageUrls = (
        collectionId: string,
        doc: Awaited<ReturnType<WatchCollectionStore["get"]>>,
      ) => {
        if (!doc) {
          return {
            enabled: false,
            collectionId,
            tickets: [],
          };
        }
        const imageTicket = createBrowserWatchCollectionTicket(appSigningKey, profile, "read");
        const signed = new URLSearchParams({
          profile,
          exp: String(imageTicket.exp),
          sig: imageTicket.sig,
          collectionId,
        });
        return {
          ...doc,
          tickets: doc.tickets.map((ticket) => ({
            ...ticket,
            imageUrl:
              "/v1/app/watch-ticket-image?" +
              signed.toString() +
              "&ticketId=" +
              encodeURIComponent(ticket.id),
          })),
        };
      };

      if (request.method === "GET") {
        const collectionId = OWNER_WATCH_COLLECTION_ID;
        const doc = await watchCollectionStore.get(collectionId);
        const payload = JSON.stringify({
          ok: true,
          collection: withImageUrls(collectionId, doc),
        });
        response.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "content-length": Buffer.byteLength(payload),
          "cache-control": "no-store",
          "access-control-allow-origin": "*",
        });
        response.end(payload);
        return;
      }

      const body = await readJsonBody(request, 4_000_000);
      const action = requiredBodyString(body, "action");
      const collectionId = OWNER_WATCH_COLLECTION_ID;

      let doc: Awaited<ReturnType<WatchCollectionStore["get"]>> = null;

      if (action === "enable") {
        doc = await watchCollectionStore.enable(collectionId);
      } else if (action === "disable") {
        doc = await watchCollectionStore.disable(collectionId);
      } else if (action === "clear") {
        doc = await watchCollectionStore.clear(collectionId);
      } else if (action === "delete") {
        const ticketId = requiredBodyString(body, "ticketId");
        doc = await watchCollectionStore.remove(
          collectionId,
          ticketId,
        );
      } else if (action === "destroy") {
        await watchCollectionStore.destroy(collectionId);
        doc = null;
      } else if (action === "add") {
        const ticket =
          body.ticket &&
          typeof body.ticket === "object" &&
          !Array.isArray(body.ticket)
            ? body.ticket as Record<string, unknown>
            : {};
        const imageMimeType =
          ticket.imageMimeType === "image/png"
            ? "image/png"
            : "image/jpeg";
        doc = await watchCollectionStore.add(
          collectionId,
          {
            id: requiredBodyString(ticket, "id"),
            title:
              typeof ticket.title === "string"
                ? ticket.title
                : "",
            platform:
              typeof ticket.platform === "string"
                ? ticket.platform
                : "",
            url:
              typeof ticket.url === "string"
                ? ticket.url
                : "",
            watchedAt:
              typeof ticket.watchedAt === "string"
                ? ticket.watchedAt
                : new Date().toISOString(),
            imageMimeType,
            imageBase64: requiredBodyString(
              ticket,
              "imageBase64",
            ),
          },
        );
      } else {
        return sendJson(response, 400, {
          ok: false,
          error: "Unknown watch collection action",
        });
      }

      const payload = JSON.stringify({
        ok: true,
        collection: withImageUrls(collectionId, doc),
      });
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(payload),
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      });
      response.end(payload);
      return;
    }

    if (
      request.method === "OPTIONS" &&
      url.pathname === "/v1/app/chat"
    ) {
      response.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "600",
      });
      response.end();
      return;
    }

    if (
      (request.method === "GET" || request.method === "POST") &&
      url.pathname === "/v1/app/chat"
    ) {
      const profile = requiredQuery(url, "profile");
      const exp = url.searchParams.get("exp");
      const sig = url.searchParams.get("sig");
      if (
        !verifyBrowserLiveTicket(
          appSigningKey,
          profile,
          exp,
          sig,
        )
      ) {
        return sendJson(response, 403, {
          ok: false,
          error: "Invalid or expired chat ticket",
        });
      }

      const identity =
        (url.searchParams.get("identity") ?? "gpt")
          .trim()
          .toLowerCase();

      if (request.method === "POST") {
        const body = await readJsonBody(request);
        if (body.action === "clear") {
          // The user clears the group chat from their card.
          const clearedThroughSeq = appChatLedger.clearMessages();
          const payload = JSON.stringify({ ok: true, clearedThroughSeq });
          response.writeHead(200, {
            "content-type": "application/json; charset=utf-8",
            "content-length": Buffer.byteLength(payload),
            "cache-control": "no-store",
            "access-control-allow-origin": "*",
          });
          response.end(payload);
          return;
        }
        if (body.action === "mute") {
          // v90 group chat: The user mutes/unmutes an AI from the card.
          const muted = appChatLedger.setMuted(
            requiredBodyString(body, "identity"),
            body.muted === true,
          );
          const payload = JSON.stringify({ ok: true, muted });
          response.writeHead(200, {
            "content-type": "application/json; charset=utf-8",
            "content-length": Buffer.byteLength(payload),
            "cache-control": "no-store",
            "access-control-allow-origin": "*",
          });
          response.end(payload);
          return;
        }
        const text = requiredBodyString(body, "text");
        const clientId =
          typeof body.clientId === "string"
            ? body.clientId
            : undefined;
        const message = appChatLedger.push({
          profile,
          identity,
          role: "user",
          text,
          ...(clientId ? { clientId } : {}),
        });
        const payload = JSON.stringify({
          ok: true,
          message,
        });
        response.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "content-length": Buffer.byteLength(payload),
          "cache-control": "no-store",
          "access-control-allow-origin": "*",
        });
        response.end(payload);
        return;
      }

      const afterRaw = Number(
        url.searchParams.get("after") ?? "0",
      );
      const after =
        Number.isSafeInteger(afterRaw) && afterRaw >= 0
          ? afterRaw
          : 0;
      const result = appChatLedger.read(
        profile,
        identity,
        after,
      );
      const payload = JSON.stringify({
        ok: true,
        ...result,
      });
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(payload),
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      });
      response.end(payload);
      return;
    }

    if (
      request.method === "GET" &&
      url.pathname === "/v1/app/companion-hls"
    ) {
      const profile = requiredQuery(url, "profile");
      const exp = url.searchParams.get("exp");
      const sig = url.searchParams.get("sig");
      if (
        !verifyBrowserLiveTicket(
          appSigningKey,
          profile,
          exp,
          sig,
        )
      ) {
        return sendJson(response, 403, {
          ok: false,
          error: "Invalid or expired companion ticket",
        });
      }

      const delayRaw = Number(url.searchParams.get("delay") ?? "30");
      const delay = Number.isFinite(delayRaw)
        ? Math.max(8, Math.min(90, Math.round(delayRaw)))
        : 30;
      const entryParam = url.searchParams.get("entry");
      if (entryParam && /^[A-Za-z0-9._-]{1,80}$/.test(entryParam)) {
        noteCompanionEntry(profile, entryParam);
      }
      const signed = new URLSearchParams({
        profile,
        exp: exp ?? "",
        sig: sig ?? "",
      }).toString();
      const playWait =
        url.searchParams.get("_playwait") === "1";
      const entryAtMs = companionEntries.get(profile)?.atMs ?? null;
      let playlist = await delayedCompanionHls.playlist(
        profile,
        delay,
        signed,
        entryAtMs,
      );
      if (playWait && !playlist) {
        const deadline = Date.now() + 180_000;
        while (!playlist && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          playlist = await delayedCompanionHls.playlist(
            profile,
            delay,
            signed,
            companionEntries.get(profile)?.atMs ?? null,
          );
        }
      }
      const bufferedSeconds =
        await delayedCompanionHls.bufferedSeconds(
          profile,
          companionEntries.get(profile)?.atMs ?? null,
        );
      const baseBody =
        playlist ??
        [
          "#EXTM3U",
          "#EXT-X-VERSION:7",
          "#EXT-X-TARGETDURATION:2",
          "#EXT-X-MEDIA-SEQUENCE:0",
          "",
        ].join("\n");
      const body = baseBody.replace(
        "#EXTM3U\n",
        "#EXTM3U\n#TONGPING-BUFFERED-SECONDS:" +
          bufferedSeconds.toFixed(3) +
          "\n" +
          (() => {
            const issue = companionAttachIssues.get(profile);
            return issue && Date.now() - issue.at < 60_000
              ? "#TONGPING-CAPTURE-ISSUE:" + companionIssueCode(issue.reason) + "\n"
              : "";
          })(),
      );
      response.writeHead(200, {
        "content-type": "application/vnd.apple.mpegurl",
        "content-length": Buffer.byteLength(body),
        "cache-control": "no-store, max-age=0",
        "access-control-allow-origin": "*",
      });
      response.end(body);
      return;
    }

    if (
      request.method === "GET" &&
      url.pathname.startsWith("/v1/app/shared-image/")
    ) {
      const id = url.pathname.split("/")[4] ?? "";
      const owner = verifySharedImageTicket(appSigningKey, url.searchParams.get("ticket"), id);
      if (!owner) {
        response.writeHead(403, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
        response.end("Invalid or expired image ticket.");
        return;
      }
      const image = sharedImages.get(owner, id);
      if (!image) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("This link has expired. Generate the ticket again.");
        return;
      }
      response.writeHead(200, {
        "content-type": image.mimeType,
        "content-length": image.buffer.length,
        "cache-control": "private, no-store",
      });
      response.end(image.buffer);
      return;
    }

    if (
      request.method === "GET" &&
      url.pathname === "/v1/app/companion-file"
    ) {
      const profile = requiredQuery(url, "profile");
      const exp = url.searchParams.get("exp");
      const sig = url.searchParams.get("sig");
      if (
        !verifyBrowserLiveTicket(
          appSigningKey,
          profile,
          exp,
          sig,
        )
      ) {
        return sendJson(response, 403, {
          ok: false,
          error: "Invalid or expired companion ticket",
        });
      }
      const name = requiredQuery(url, "name");
      const body = await delayedCompanionHls.file(profile, name);
      if (!body) {
        return sendJson(response, 404, {
          ok: false,
          error: "Companion segment is not available",
        });
      }
      response.writeHead(200, {
        "content-type": "video/mp4",
        "content-length": body.length,
        "cache-control": "private, max-age=20",
        "access-control-allow-origin": "*",
      });
      response.end(body);
      return;
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return sendJson(response, 200, {
        ok: true,
        service: "tongping",
        version: PACKAGE_VERSION,
        mcp: "/mcp",
        live: "/live",
        oauth: Boolean(oauth),
        remoteWorker: remoteWorkerMode,
        worker: relay?.workerStatus() ?? null,
        workerBuild: lastWorkerBuild || null,
        workerPoll: workerPollStats,
        workerResult: workerResultStats,
        frameUpload: frameUploadStats,
        liveFrame: {
          ...liveFrameStats,
          subscribers: liveWsHub.appSubscribers(),
        },
        liveWs: liveWsHub.stats(),
        presentation:
          liveFrameStats.lastProfile
            ? liveWsHub.presentationStatus(liveFrameStats.lastProfile)
            : null,
        perception:
          liveFrameStats.lastProfile
            ? companionPerceptionLedger.status(liveFrameStats.lastProfile)
            : null,
        companionBuffer: trustedWorkerTransport
          ? companionFrameBuffer.aggregate()
          : liveFrameStats.lastProfile
            ? companionFrameBuffer.statusLegacy(liveFrameStats.lastProfile)
            : null,
        audioWs: audioWsHub.stats(),
        mediaWs: mediaWsHub.stats(),
        delayedCompanion: delayedCompanionHls.status(),
        companionCommand: companionCommandStats,
      });
    }

    if (request.method === "GET" && url.pathname === "/capture-helper") {
      return sendHtml(
        response,
        '<!doctype html><html><head><meta charset="utf-8"><title>TongPing Capture Helper</title><script>globalThis.__name=globalThis.__name||((target,value)=>target);</script></head><body></body></html>',
      );
    }

    if (request.method === "GET" && url.pathname === "/live") {
      return sendHtml(response, renderLivePage());
    }

    if (request.method === "POST" && url.pathname === "/v1/worker/enrollment-challenge") {
      if (!remoteWorkerMode || !privatePairingAuthority) {
        return sendJson(response, 403, { ok: false, error: "Trusted private pairing authority unavailable" });
      }
      if (!bearerMatches(request.headers.authorization, token)) {
        return sendJson(response, 401, { ok: false, error: "Unauthorized pairing authority" });
      }
      const issued = await privatePairingAuthority.issueChallenge();
      return sendJson(response, 200, { ok: true, ...issued });
    }

    if (request.method === "POST" && url.pathname === "/v1/worker/enroll") {
      if (!remoteWorkerMode || !privatePairingAuthority) {
        return sendJson(response, 403, { ok: false, error: "Trusted private pairing authority unavailable" });
      }
      const body = await readJsonBody(request);
      if (Object.keys(body).some((key) => !["challenge", "device_id", "name", "build"].includes(key)) ||
        typeof body.challenge !== "string" || typeof body.device_id !== "string" ||
        (body.name !== undefined && typeof body.name !== "string") ||
        (body.build !== undefined && typeof body.build !== "string")) {
        return sendJson(response, 400, { ok: false, error: "Invalid enrollment request" });
      }
      try {
        const enrolled = await privatePairingAuthority.redeem(body.challenge, body.device_id);
        return sendJson(response, 200, {
          ok: true,
          device_id: enrolled.deviceId,
          human_user_id: enrolled.humanUserId,
          credential_version: enrolled.credentialVersion,
          credential: enrolled.credential,
        });
      } catch (error) {
        if (error instanceof EnrollmentRejected) {
          return sendJson(response, 401, { ok: false, error: "Enrollment rejected" });
        }
        throw error;
      }
    }

    if (request.method === "POST" && url.pathname === "/v1/worker/session") {
      if (!remoteWorkerMode || !privatePairingAuthority) {
        return sendJson(response, 403, { ok: false, error: "Trusted Worker session authority unavailable" });
      }
      const body = await readJsonBody(request);
      if (Object.keys(body).some((key) => !["device_id", "device_credential", "name", "build"].includes(key)) ||
        typeof body.device_id !== "string" || typeof body.device_credential !== "string" ||
        (body.name !== undefined && typeof body.name !== "string") ||
        (body.build !== undefined && typeof body.build !== "string")) {
        return sendJson(response, 400, { ok: false, error: "Invalid Worker session request" });
      }
      try {
        const opened = await workerConnections.openSession(body.device_id, body.device_credential);
        return sendJson(response, 200, {
          ok: true,
          human_user_id: opened.context.humanUserId,
          device_id: opened.context.deviceId,
          session_id: opened.context.sessionId,
          session_credential: opened.sessionCredential,
          expires_at: opened.expiresAt,
        });
      } catch (error) {
        if (error instanceof WorkerSessionRejected) {
          return sendJson(response, 401, { ok: false, error: "Worker session rejected" });
        }
        throw error;
      }
    }

    if (request.method === "POST" && url.pathname === "/v1/worker/revoke-device") {
      if (!remoteWorkerMode || !privatePairingAuthority) {
        return sendJson(response, 403, { ok: false, error: "Trusted Worker session authority unavailable" });
      }
      if (!bearerMatches(request.headers.authorization, token)) {
        return sendJson(response, 401, { ok: false, error: "Unauthorized pairing authority" });
      }
      const body = await readJsonBody(request);
      if (Object.keys(body).some((key) => key !== "device_id") || typeof body.device_id !== "string") {
        return sendJson(response, 400, { ok: false, error: "Invalid revoke request" });
      }
      try {
        return sendJson(response, 200, { ok: true, revoked: await workerConnections.revokeDevice(body.device_id) });
      } catch (error) {
        if (error instanceof EnrollmentRejected) {
          return sendJson(response, 400, { ok: false, error: "Invalid revoke request" });
        }
        throw error;
      }
    }

    if (
      request.method === "POST" &&
      url.pathname === "/v1/worker/pair"
    ) {
      if (trustedWorkerTransport || !privatePairingAuthority) {
        return sendJson(response, 403, { ok: false, error: "Legacy Worker pairing unavailable" });
      }
      if (!relay || !workerToken) {
        return sendJson(response, 404, {
          ok: false,
          error: "Remote worker mode is disabled",
        });
      }
      const body = await readJsonBody(request);
      const code = requiredBodyString(body, "code");
      const name = requiredBodyString(body, "name");
      const pairFile =
        config.homeDir + "/worker-pair-code";
      const expected =
        await readOptionalText(pairFile);
      if (!expected || !safeSecretEqual(code, expected)) {
        return sendJson(response, 401, {
          ok: false,
          error: "Invalid or expired pairing code",
        });
      }
      await unlink(pairFile).catch(() => {});
      return sendJson(response, 200, {
        ok: true,
        token: workerToken,
        worker: name,
      });
    }

    // v90 group chat watch: local AIs on the user's PC (terminal Claude, Codex)
    // long-poll the room with the PC's worker credential and get woken when
    // The user or another AI speaks. Read-only; posting still goes through the
    // MCP tool browser_app_chat_push.
    if (
      request.method === "GET" &&
      url.pathname === "/v1/worker/room"
    ) {
      const workerAuthority = await authenticateWorkerTransport(request);
      if (!workerAuthority) {
        return sendJson(response, 401, { ok: false, error: "Unauthorized worker" });
      }
      await transportTestBarrier("room-admitted");
      const afterRaw = Number(url.searchParams.get("after") ?? "0");
      const after = Number.isSafeInteger(afterRaw) && afterRaw >= 0 ? afterRaw : 0;
      const waitRaw = Number(url.searchParams.get("wait") ?? "0");
      const waitMs = Number.isFinite(waitRaw) ? Math.max(0, Math.min(25, waitRaw)) * 1000 : 0;
      const deadline = Date.now() + waitMs;
      let result = appChatLedger.read(undefined, undefined, after);
      while (result.messages.length === 0 && Date.now() < deadline && !request.destroyed) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        result = appChatLedger.read(undefined, undefined, after);
      }
      if (!(await trustedHandleStillCurrent(workerAuthority))) {
        return sendJson(response, 401, { ok: false, error: "Stale Worker session" });
      }
      return sendJson(response, 200, { ok: true, ...result });
    }

    if (
      request.method === "POST" &&
      url.pathname === "/v1/worker/poll"
    ) {
      if (!relay) {
        return sendJson(response, 404, {
          ok: false,
          error: "Remote worker mode is disabled",
        });
      }
      const workerAuthority = await authenticateWorkerTransport(request);
      if (!workerAuthority) {
        return sendJson(response, 401, {
          ok: false,
          error: "Unauthorized worker",
        });
      }
      await transportTestBarrier("poll-admitted");
      lastWorkerBuild =
        headerString(request.headers["x-tongping-worker-build"]) ?? lastWorkerBuild;
      // App viewers often reconnect before the worker after a daemon restart.
      // Re-prime live capture once worker authority is actually present.
      setTimeout(primeConnectedAppProfiles, 0).unref?.();
      setTimeout(primeConnectedAudioProfiles, 0).unref?.();
      setTimeout(primeConnectedMediaProfiles, 0).unref?.();
      workerPollStats.active += 1;
      workerPollStats.total += 1;
      workerPollStats.maxActive = Math.max(workerPollStats.maxActive, workerPollStats.active);
      try {
        const command = workerAuthority === true
          ? await relay.nextCommand(20_000)
          : await workerAuthority.nextCommand(20_000);
        if (!(await trustedHandleStillCurrent(workerAuthority))) {
          return sendJson(response, 401, { ok: false, error: "Stale Worker session" });
        }
        if (!command) {
          response.writeHead(204, {
            "cache-control": "no-store",
          });
          response.end();
          return;
        }
        return sendJson(response, 200, command);
      } finally {
        workerPollStats.active = Math.max(0, workerPollStats.active - 1);
      }
    }

    if (
      request.method === "POST" &&
      url.pathname === "/v1/worker/live-stream"
    ) {
      if (!relay) {
        return sendJson(response, 404, {
          ok: false,
          error: "Remote worker mode is disabled",
        });
      }
      const workerAuthority = await authenticateWorkerTransport(request);
      if (!workerAuthority) {
        return sendJson(response, 401, {
          ok: false,
          error: "Unauthorized worker",
        });
      }

      const profile = requiredQuery(url, "profile");
      if (!/^[a-zA-Z0-9._-]{1,64}$/.test(profile)) {
        return sendJson(response, 400, {
          ok: false,
          error: "Invalid profile",
        });
      }

      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive",
      });
      response.flushHeaders?.();

      let pending = Buffer.alloc(0);
      let frames = 0;

      try {
        for await (const chunk of request) {
          if (!(await trustedHandleStillCurrent(workerAuthority))) {
            response.destroy();
            return;
          }
          const incoming = Buffer.isBuffer(chunk)
            ? chunk
            : Buffer.from(chunk);
          pending =
            pending.length === 0
              ? incoming
              : Buffer.concat([pending, incoming]);

          while (pending.length >= 24) {
            if (!(await trustedHandleStillCurrent(workerAuthority))) {
              response.destroy();
              return;
            }
            const bytes = pending.readUInt32BE(0);
            if (bytes <= 0 || bytes > 8_000_000) {
              const soi = pending.indexOf(Buffer.from([0xff, 0xd8]), 1);
              if (soi >= 24) {
                pending = pending.subarray(soi - 24);
                liveFrameStats.lastError = "live-stream-resync";
                continue;
              }
              if (pending.length > 256_000) {
                pending = pending.subarray(-23);
                liveFrameStats.lastError = "live-stream-resync-drop";
              }
              break;
            }
            const packetBytes = 24 + bytes;
            if (pending.length < packetBytes) break;

            if (pending[24] !== 0xff || pending[25] !== 0xd8) {
              const soi = pending.indexOf(Buffer.from([0xff, 0xd8]), 25);
              if (soi >= 24) {
                pending = pending.subarray(soi - 24);
                liveFrameStats.lastError = "live-stream-jpeg-resync";
                continue;
              }
              pending = pending.subarray(1);
              liveFrameStats.lastError = "live-stream-byte-resync";
              continue;
            }

            const sequence = pending.readUInt32BE(4);
            const width = pending.readUInt32BE(8);
            const height = pending.readUInt32BE(12);
            const capturedAt = Number(pending.readBigUInt64BE(16));
            const image = Buffer.from(
              pending.subarray(24, packetBytes),
            );
            pending = pending.subarray(packetBytes);

            liveFrameStats.attempts += 1;
            liveFrameStats.accepted += 1;
            liveFrameStats.lastAt = new Date().toISOString();
            liveFrameStats.lastProfile = profile;
            liveFrameStats.lastBytes = image.length;
            liveFrameStats.lastSequence = sequence;
            liveFrameStats.lastError = null;

            const viewport =
              width > 0 && height > 0
                ? { width, height }
                : null;

            liveFrameCache.set(profile, {
              buffer: image,
              viewport,
              sequence,
              capturedAt,
              media: null,
              updatedAt: Date.now(),
            });

            broadcastLiveFrame(
              profile,
              image,
              viewport,
              sequence,
              capturedAt,
            );
            frames += 1;
            if (frames === 1) await transportTestBarrier("live-stream-first-frame");
          }

          if (pending.length > 9_000_000) {
            throw new Error("Live stream parser buffer overflow");
          }
        }

        if (!(await trustedHandleStillCurrent(workerAuthority))) {
          response.destroy();
          return;
        }

        response.end(
          JSON.stringify({
            ok: true,
            profile,
            frames,
          }),
        );
      } catch (error) {
        liveFrameStats.lastError =
          error instanceof Error ? error.message : String(error);
        if (!response.writableEnded) {
          response.end();
        }
      }
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/v1/worker/live-frame"
    ) {
      if (!relay) {
        return sendJson(response, 404, {
          ok: false,
          error: "Remote worker mode is disabled",
        });
      }
      const workerAuthority = await authenticateWorkerTransport(request);
      if (!workerAuthority) {
        return sendJson(response, 401, {
          ok: false,
          error: "Unauthorized worker",
        });
      }
      const profile = requiredQuery(url, "profile");
      liveFrameStats.attempts += 1;
      liveFrameStats.lastAt = new Date().toISOString();
      liveFrameStats.lastProfile = profile;
      liveFrameStats.lastBytes = 0;
      liveFrameStats.lastError = null;
      if (!/^[a-zA-Z0-9._-]{1,64}$/.test(profile)) {
        liveFrameStats.lastError = "invalid-profile";
        return sendJson(response, 400, {
          ok: false,
          error: "Invalid profile",
        });
      }
      let image: Buffer;
      try {
        image = await readRawBody(request, 8_000_000, "live-frame-body");
      } catch (error) {
        liveFrameStats.lastError =
          error instanceof Error ? error.message : String(error);
        throw error;
      }
      if (!(await trustedHandleStillCurrent(workerAuthority))) {
        return sendJson(response, 401, { ok: false, error: "Stale Worker session" });
      }
      if (image.length === 0) {
        liveFrameStats.lastError = "empty-frame";
        return sendJson(response, 400, {
          ok: false,
          error: "Empty live frame",
        });
      }
      const width = positiveIntQuery(url, "width");
      const height = positiveIntQuery(url, "height");
      const sequence = Math.max(
        0,
        Math.floor(Number(url.searchParams.get("seq") || "0") || 0),
      );
      const capturedAt = Math.max(
        0,
        Math.floor(
          Number(url.searchParams.get("capturedAt") || String(Date.now())) ||
          Date.now(),
        ),
      );
      const viewport =
        width && height ? { width, height } : null;
      liveFrameCache.set(profile, {
        buffer: image,
        viewport,
        sequence,
        capturedAt,
        media: null,
        updatedAt: Date.now(),
      });
      liveFrameStats.accepted += 1;
      liveFrameStats.lastBytes = image.length;
      liveFrameStats.lastSequence = sequence;
      broadcastLiveFrame(
        profile,
        image,
        viewport,
        sequence,
        capturedAt,
      );
      return sendJson(response, 200, {
        ok: true,
        profile,
        bytes: image.length,
        sequence,
        subscribers: liveSubscribers.get(profile)?.size ?? 0,
      });
    }

    if (
      request.method === "POST" &&
      url.pathname === "/v1/worker/frame"
    ) {
      if (!relay) {
        return sendJson(response, 404, { ok: false, error: "Remote worker mode is disabled" });
      }
      const workerAuthority = await authenticateWorkerTransport(request);
      if (!workerAuthority) {
        return sendJson(response, 401, { ok: false, error: "Unauthorized worker" });
      }
      const profile = requiredQuery(url, "profile");
      frameUploadStats.attempts += 1;
      frameUploadStats.lastAt = new Date().toISOString();
      frameUploadStats.lastProfile = profile;
      frameUploadStats.lastBytes = 0;
      frameUploadStats.lastError = null;
      if (!/^[a-zA-Z0-9._-]{1,64}$/.test(profile)) {
        frameUploadStats.lastError = "invalid-profile";
        return sendJson(response, 400, { ok: false, error: "Invalid profile" });
      }
      let image: Buffer;
      try {
        image = await readRawBody(request, 40_000_000, "frame-body");
      } catch (error) {
        frameUploadStats.lastError =
          error instanceof Error ? error.message : String(error);
        throw error;
      }
      if (!(await trustedHandleStillCurrent(workerAuthority))) {
        return sendJson(response, 401, { ok: false, error: "Stale Worker session" });
      }
      frameUploadStats.lastBytes = image.length;
      if (image.length === 0) {
        frameUploadStats.lastError = "empty-frame";
        return sendJson(response, 400, { ok: false, error: "Empty frame" });
      }
      const width = positiveIntQuery(url, "width");
      const height = positiveIntQuery(url, "height");
      frameCache.set(profile, {
        buffer: image,
        viewport: width && height ? { width, height } : null,
        updatedAt: Date.now(),
      });
      return sendJson(response, 200, {
        ok: true,
        bytes: image.length,
        frameUrl: createBrowserSingleFrameUrl(
          `http://127.0.0.1:${port}`,
          appSigningKey,
          profile,
          45,
          "frame",
        ),
      });
    }

    if (
      request.method === "POST" &&
      url.pathname === "/v1/worker/result"
    ) {
      if (!relay) {
        return sendJson(response, 404, {
          ok: false,
          error: "Remote worker mode is disabled",
        });
      }
      const workerAuthority = await authenticateWorkerTransport(request);
      if (!workerAuthority) {
        return sendJson(response, 401, {
          ok: false,
          error: "Unauthorized worker",
        });
      }
      const body = await readJsonBody(request, 1_000_000, "result-body");
      if (!(await trustedHandleStillCurrent(workerAuthority))) {
        return sendJson(response, 401, { ok: false, error: "Stale Worker session" });
      }
      const id = requiredBodyString(body, "id");
      const rawReply = body.reply;
      if (
        !rawReply ||
        typeof rawReply !== "object" ||
        Array.isArray(rawReply)
      ) {
        return sendJson(response, 400, {
          ok: false,
          error: "Invalid worker reply",
        });
      }
      workerResultStats.attempts += 1;
      workerResultStats.lastAt = new Date().toISOString();
      const accepted = workerAuthority === true
        ? relay.complete(id, rawReply as BrowserReply)
        : await workerAuthority.complete(id, rawReply as BrowserReply);
      if (accepted) workerResultStats.accepted += 1;
      else workerResultStats.rejected += 1;
      return sendJson(response, accepted ? 200 : 409, {
        ok: accepted,
      });
    }

    if (url.pathname === "/mcp") {
      if (
        !validateHost(request, response) ||
        !validateOrigin(request, response)
      ) {
        return;
      }
      if (!(await requestAuthorized(request))) {
        return sendUnauthorized(response, url.pathname);
      }
      await nodeMcpHandler(request, response);
      return;
    }

    if (!bearerMatches(request.headers.authorization, token)) {
      return sendJson(response, 401, {
        ok: false,
        error: "Unauthorized",
      });
    }

    const humanClient =
      headerString(request.headers["x-tongping-client"]) ?? "human-mobile";

    if (
      request.method === "GET" &&
      url.pathname === "/v1/human/status"
    ) {
      const profile = requiredQuery(url, "profile");
      return sendJson(
        response,
        200,
        await service.humanStatus(profile),
      );
    }

    if (
      request.method === "GET" &&
      url.pathname === "/v1/human/screenshot"
    ) {
      const profile = requiredQuery(url, "profile");
      const preview = await service.humanPreview(profile);
      return sendPng(response, preview.buffer, preview.viewport);
    }

    if (
      request.method === "POST" &&
      url.pathname === "/v1/human/approval/decision"
    ) {
      const body = await readJsonBody(request);
      const approvalId = requiredBodyString(body, "approvalId");
      const approved = requiredBodyBoolean(body, "approved");
      return sendJson(
        response,
        200,
        await service.humanApprovalDecision(
          approvalId,
          approved,
          humanClient,
        ),
      );
    }

    if (
      request.method === "POST" &&
      url.pathname === "/v1/human/takeover/start"
    ) {
      const body = await readJsonBody(request);
      const profile = requiredBodyString(body, "profile");
      return sendJson(
        response,
        200,
        await service.humanTakeoverStart(profile, humanClient),
      );
    }

    if (
      request.method === "POST" &&
      url.pathname === "/v1/human/takeover/end"
    ) {
      const body = await readJsonBody(request);
      const profile = requiredBodyString(body, "profile");
      return sendJson(
        response,
        200,
        await service.humanTakeoverEnd(profile, humanClient),
      );
    }

    if (
      request.method === "POST" &&
      url.pathname === "/v1/human/context-info"
    ) {
      const body = await readJsonBody(request);
      const profile = requiredBodyString(body, "profile");
      const x = requiredBodyNumber(body, "x");
      const y = requiredBodyNumber(body, "y");
      return sendJson(
        response,
        200,
        await service.humanContextInfo(profile, x, y),
      );
    }

    if (
      request.method === "POST" &&
      url.pathname === "/v1/human/click"
    ) {
      const body = await readJsonBody(request);
      const profile = requiredBodyString(body, "profile");
      const x = requiredBodyNumber(body, "x");
      const y = requiredBodyNumber(body, "y");
      return sendJson(
        response,
        200,
        await service.humanClick(profile, x, y, humanClient),
      );
    }

    if (
      request.method === "POST" &&
      url.pathname === "/v1/human/drag"
    ) {
      const body = await readJsonBody(request);
      const profile = requiredBodyString(body, "profile");
      const startX = requiredBodyNumber(body, "startX");
      const startY = requiredBodyNumber(body, "startY");
      const endX = requiredBodyNumber(body, "endX");
      const endY = requiredBodyNumber(body, "endY");
      const steps =
        typeof body.steps === "number" && Number.isFinite(body.steps)
          ? body.steps
          : 18;
      return sendJson(
        response,
        200,
        await service.humanDrag(
          profile,
          startX,
          startY,
          endX,
          endY,
          steps,
          humanClient,
        ),
      );
    }

    if (
      request.method === "POST" &&
      url.pathname === "/v1/human/type"
    ) {
      const body = await readJsonBody(request);
      const profile = requiredBodyString(body, "profile");
      const text = requiredBodyString(body, "text");
      if (text.length > 10_000) {
        throw new Error("Human text input is limited to 10,000 characters.");
      }
      return sendJson(
        response,
        200,
        await service.humanType(profile, text, humanClient),
      );
    }

    if (
      request.method === "POST" &&
      url.pathname === "/v1/human/key"
    ) {
      const body = await readJsonBody(request);
      const profile = requiredBodyString(body, "profile");
      const key = requiredBodyString(body, "key");
      return sendJson(
        response,
        200,
        await service.humanKey(profile, key, humanClient),
      );
    }

    if (request.method === "POST" && url.pathname === "/v1/action") {
      const body = await readJsonBody(request);
      const action = body.action;
      const args = body.args;

      if (
        typeof action !== "string" ||
        !ACTIONS.has(action as BrowserAction) ||
        !args ||
        typeof args !== "object" ||
        Array.isArray(args)
      ) {
        return sendJson(response, 400, {
          ok: false,
          error: "Invalid browser action payload",
        });
      }

      const reply = await service.call({
        action: action as BrowserAction,
        args: args as Record<string, unknown>,
        client:
          headerString(request.headers["x-tongping-client"]) ?? "http",
      });

      return sendJson(response, reply.ok ? 200 : 400, reply);
    }

    return sendJson(response, 404, {
      ok: false,
      error: "Not found",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    return sendJson(response, 500, {
      ok: false,
      error: message,
    });
  }
});

server.on("upgrade", (request, socket, head) => {
  if (mediaWsHub.handleUpgrade(request, socket, head)) return;
  if (audioWsHub.handleUpgrade(request, socket, head)) return;
  if (liveWsHub.handleUpgrade(request, socket, head)) return;
  socket.destroy();
});

server.listen(port, host, () => {
  console.error(
    `tongping daemon v${PACKAGE_VERSION} listening on http://${host}:${port}; state=${config.homeDir}`,
  );
  console.error(
    `Streamable HTTP MCP: http://${host}:${port}/mcp`,
  );
  console.error(
    `Mobile live view: http://${host}:${port}/live`,
  );
  console.error(
    "daemon auth token is stored locally; set TONGPING_TOKEN on remote clients",
  );
});

let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  await httpMcp.close();
  for (const timer of liveStopTimers.values()) clearTimeout(timer);
  liveStopTimers.clear();
  for (const timer of audioStopTimers.values()) clearTimeout(timer);
  audioStopTimers.clear();
  for (const timer of mediaStopTimers.values()) clearTimeout(timer);
  mediaStopTimers.clear();
  for (const timer of companionAppCloseTimers.values()) {
    clearTimeout(timer);
  }
  companionAppCloseTimers.clear();
  companionAudioStoppedProfiles.clear();
  companionHlsRecoveringProfiles.clear();
  clearInterval(companionHlsWatchdog);
  await delayedCompanionHls.close();
  mediaWsHub.close();
  clearInterval(audioStallWatchdog);
  audioWsHub.close();
  liveWsHub.close();
  await new Promise<void>((resolve) =>
    server.close(() => resolve()),
  );
  await service.close();
  await lock.release();
}

process.once("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});

process.once("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});

process.once("uncaughtException", (error) => {
  console.error(error);
  void shutdown().finally(() => process.exit(1));
});

process.once("unhandledRejection", (error) => {
  console.error(error);
  void shutdown().finally(() => process.exit(1));
});

async function loadOrCreateWorkerToken(
  dir: string,
): Promise<string> {
  const file = dir + "/worker-token";
  try {
    const existing = (await readFile(file, "utf8")).trim();
    if (existing) return existing;
  } catch {}
  await mkdir(dir, { recursive: true });
  const value = crypto.randomBytes(32).toString("base64url");
  await writeFile(file, value + "\n", {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  }).catch(() => {});
  return (await readFile(file, "utf8")).trim();
}

function safeSecretEqual(
  supplied: string,
  expected: string,
): boolean {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return (
    a.length === b.length &&
    crypto.timingSafeEqual(a, b)
  );
}

function workerAuthMatches(
  authorization: string | undefined,
  expected: string,
): boolean {
  if (!authorization?.startsWith("Worker ")) return false;
  return safeSecretEqual(
    authorization.slice("Worker ".length),
    expected,
  );
}

async function authenticateWorkerTransport(request: http.IncomingMessage): Promise<WorkerTransportAuthority | null> {
  if (!remoteWorkerMode) return null;
  if (trustedWorkerTransport) {
    const match = /^Worker ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization ?? "");
    return match ? workerConnections.authenticateWorkerSession(match[1]!) : null;
  }
  // The process-global token is a private compatibility path, never hosted authority.
  return privatePairingAuthority && workerToken && workerAuthMatches(request.headers.authorization, workerToken)
    ? true : null;
}

async function trustedHandleStillCurrent(authority: WorkerTransportAuthority): Promise<boolean> {
  return authority === true || authority.isCurrent();
}

/** Explicit test-only barrier for real HTTP body/callback race evidence. */
async function transportTestBarrier(key: string): Promise<void> {
  const dir = process.env.TONGPING_TEST_TRANSPORT_BARRIER_DIR;
  if (!dir || !trustedWorkerTransport) return;
  try { await readFile(`${dir}/${key}.arm`); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  await writeFile(`${dir}/${key}.entered`, "\n");
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try { await readFile(`${dir}/${key}.release`); return; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Worker transport test barrier timed out: ${key}`);
}

async function gatewayHumanResult(
  action: Parameters<BrowserGateway["human"]>[0],
  args: Record<string, unknown>,
  client: string,
): Promise<unknown> {
  const reply = await browserGateway.human(
    action,
    args,
    client,
  );
  if (!reply.ok) {
    throw new Error(
      reply.error ?? "Browser worker action failed",
    );
  }
  return reply.result;
}

async function requestAuthorized(
  request: http.IncomingMessage,
): Promise<boolean> {
  if (bearerMatches(request.headers.authorization, token)) {
    return true;
  }
  const auth = headerString(request.headers.authorization);
  if (!oauth || !auth?.startsWith("Bearer ")) return false;
  return oauth.tokenValid(auth.slice("Bearer ".length));
}

function sendUnauthorized(
  response: http.ServerResponse,
  resourcePath: string,
) {
  const body = JSON.stringify({
    ok: false,
    error: "Unauthorized",
  });
  response.writeHead(401, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    ...(oauth
      ? { "www-authenticate": oauth.wwwAuthenticate(resourcePath) }
      : {}),
  });
  response.end(body);
}

async function readOptionalText(file: string): Promise<string> {
  try {
    return (await readFile(file, "utf8")).trim();
  } catch {
    return "";
  }
}

function parsePort(value: string | undefined): number {
  const parsed = Number(value ?? "45921");
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(
      "TONGPING_PORT must be an integer between 1 and 65535.",
    );
  }
  return parsed;
}

function parseCsv(
  value: string | undefined,
  fallback: string[],
): string[] {
  const parsed = value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return parsed && parsed.length > 0 ? parsed : fallback;
}

function requiredQuery(url: URL, key: string): string {
  const value = url.searchParams.get(key)?.trim();
  if (!value) {
    throw new Error(`Missing query parameter: ${key}`);
  }
  return value;
}

function requiredBodyString(
  body: Record<string, unknown>,
  key: string,
): string {
  const value = body[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing string body field: ${key}`);
  }
  return value;
}

function requiredBodyBoolean(
  body: Record<string, unknown>,
  key: string,
): boolean {
  const value = body[key];
  if (typeof value !== "boolean") {
    throw new Error(`Missing boolean body field: ${key}`);
  }
  return value;
}

function requiredBodyNumber(
  body: Record<string, unknown>,
  key: string,
): number {
  const value = body[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Missing numeric body field: ${key}`);
  }
  return value;
}

function workerBuildAtLeast(value: string, minimum: number): boolean {
  const match = /^v(\d+)$/.exec(value.trim());
  return Boolean(match && Number(match[1]) >= minimum);
}

function positiveIntQuery(url: URL, key: string): number | null {
  const raw = url.searchParams.get(key);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 && value <= 20000 ? value : null;
}

async function readRawBody(
  request: http.IncomingMessage,
  maxBytes: number,
  barrierKey?: string,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBytes) throw new Error("Request body too large");
    chunks.push(buffer);
    if (barrierKey && chunks.length === 1) await transportTestBarrier(barrierKey);
  }
  return Buffer.concat(chunks);
}

async function readJsonBody(
  request: http.IncomingMessage,
  maxBytes = 1_000_000,
  barrierKey?: string,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBytes) {
      throw new Error("Request body too large");
    }
    chunks.push(buffer);
    if (barrierKey && chunks.length === 1) await transportTestBarrier(barrierKey);
  }

  if (chunks.length === 0) return {};

  const value = JSON.parse(
    Buffer.concat(chunks).toString("utf8"),
  ) as unknown;

  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error("JSON body must be an object");
  }

  return value as Record<string, unknown>;
}

function sendJson(
  response: http.ServerResponse,
  status: number,
  value: unknown,
) {
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
  body: string,
) {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "content-security-policy":
      "default-src 'self'; img-src 'self' blob: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
  response.end(body);
}

function sendLocalAppHtml(
  response: http.ServerResponse,
  body: string,
  nonce: string,
) {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "permissions-policy":
      "camera=(self), microphone=(self), clipboard-write=(self)",
    "content-security-policy": [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}'`,
      `style-src 'nonce-${nonce}'`,
      "img-src 'self' blob: data:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join("; "),
  });
  response.end(body);
}

function sendLocalAppCardHtml(
  response: http.ServerResponse,
  body: string,
) {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "content-security-policy": [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' blob: data:",
      "media-src 'self' blob: data:",
      "font-src 'self' data:",
      `connect-src 'self' ws://127.0.0.1:${port} ws://localhost:${port} https://cdn.jsdelivr.net https://storage.googleapis.com`,
      "worker-src 'self' blob:",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'self'",
    ].join("; "),
  });
  response.end(body);
}

function localAppRequestAllowed(request: http.IncomingMessage): boolean {
  if (!localAppRequestIsLoopback(request.socket.remoteAddress)) return false;
  const requestHost = request.headers.host?.toLowerCase();
  return (
    requestHost === `127.0.0.1:${port}` ||
    requestHost === `localhost:${port}` ||
    requestHost === `[::1]:${port}`
  );
}

function localAppSessionFromRequest(request: http.IncomingMessage) {
  if (!localAppRequestAllowed(request)) return null;
  const id = cookieValue(request.headers.cookie, LOCAL_APP_COOKIE);
  return localAppSessions.get(id);
}

function localAppApiSession(
  request: http.IncomingMessage,
  requireOrigin = true,
) {
  const session = localAppSessionFromRequest(request);
  if (!session) return null;
  const origin = request.headers.origin;
  if (
    (requireOrigin || origin !== undefined) &&
    !localAppRequestOriginAllowed(origin, port)
  ) {
    return null;
  }
  const provided = headerString(request.headers["x-tongping-csrf"]);
  if (!provided || !constantTimeTextEqual(provided, session.csrf)) return null;
  return session;
}

function constantTimeTextEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    crypto.timingSafeEqual(leftBytes, rightBytes)
  );
}

function writeLivePart(
  response: http.ServerResponse,
  buffer: Buffer,
  viewport: { width: number; height: number } | null,
  sequence: number,
  capturedAt: number,
  mimeType = "image/jpeg",
): void {
  if (response.destroyed || response.writableEnded) return;
  const header =
    "--" + LIVE_BOUNDARY + "\r\n" +
    "Content-Type: " + mimeType + "\r\n" +
    "Content-Length: " + buffer.length + "\r\n" +
    "X-Tongping-Sequence: " + sequence + "\r\n" +
    "X-Tongping-Captured-At: " + capturedAt + "\r\n" +
    "X-Tongping-Viewport-Width: " + (viewport?.width ?? 0) + "\r\n" +
    "X-Tongping-Viewport-Height: " + (viewport?.height ?? 0) + "\r\n\r\n";
  response.write(header);
  response.write(buffer);
  response.write("\r\n");
}

function broadcastLiveFrame(
  profile: string,
  buffer: Buffer,
  viewport: { width: number; height: number } | null,
  sequence: number,
  capturedAt: number,
): void {
  const subscribers = liveSubscribers.get(profile);
  if (!subscribers?.size) return;
  for (const response of [...subscribers]) {
    if (response.destroyed || response.writableEnded) {
      subscribers.delete(response);
      liveFrameStats.subscribers = Math.max(
        0,
        liveFrameStats.subscribers - 1,
      );
      continue;
    }
    if (response.writableLength > 2_000_000) {
      continue;
    }
    writeLivePart(
      response,
      buffer,
      viewport,
      sequence,
      capturedAt,
      "image/jpeg",
    );
  }
  if (subscribers.size === 0) liveSubscribers.delete(profile);
}

function sendImage(
  response: http.ServerResponse,
  buffer: Buffer,
  viewport: { width: number; height: number } | null,
  mimeType: "image/png" | "image/jpeg",
  cors = false,
) {
  response.writeHead(200, {
    "content-type": mimeType,
    "content-length": buffer.length,
    "cache-control": "no-store",
    ...(cors ? { "access-control-allow-origin": "*" } : {}),
    "x-tongping-viewport-width": String(viewport?.width ?? 0),
    "x-tongping-viewport-height": String(viewport?.height ?? 0),
  });
  response.end(buffer);
}

function sendPng(
  response: http.ServerResponse,
  buffer: Buffer,
  viewport: { width: number; height: number } | null,
  cors = false,
) {
  return sendImage(response, buffer, viewport, "image/png", cors);
}

function headerString(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
