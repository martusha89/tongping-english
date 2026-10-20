import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BrowserService, type BrowserAction } from "./browser-service.js";
import type { LiveFrameMediaMeta, LiveMediaEvent } from "./browser-manager.js";
import { loadConfig } from "./config.js";
import { LocalGateway, type HumanBrowserAction } from "./gateway.js";
import { WebSocket } from "ws";
import { proxyAgentFor } from "./ws-proxy-agent.js";
import { encodeLiveWsPacket } from "./live-ws-hub.js";
import { encodeOpusWorkerAudioPacket } from "./audio-ws-hub.js";
import { encodeMediaSegmentPacket } from "./media-ws-hub.js";
import OpusScript from "opusscript";
import { loadOrCreateWorkerDeviceId } from "./worker-device-identity.js";
import { openWorkerServiceSession, type WorkerServiceSession } from "./worker-service-session.js";
import { HOSTED_WORKER_ACTIONS, isUploadUrl, UPLOAD_MAX_BYTES, UPLOAD_MAX_FILES, UPLOAD_NAME } from "./hosted-ai-tools.js";

// Every log line carries the local time, so a drop can be matched to when it happened.
for (const method of ["log", "error", "warn"] as const) {
  const original = console[method].bind(console);
  console[method] = (...args: unknown[]) => {
    const now = new Date();
    const stamp = [now.getHours(), now.getMinutes(), now.getSeconds()]
      .map((part) => String(part).padStart(2, "0"))
      .join(":");
    original(stamp, ...args);
  };
}

const cloudUrl = requiredEnv("TONGPING_CLOUD_URL").replace(/\/+$/, "");
const workerName = process.env.TONGPING_WORKER_NAME?.trim() || os.hostname();
const WORKER_BUILD = "v95";
const config = loadConfig();
const service = new BrowserService(config);
const gateway = new LocalGateway(service, workerName);
const tokenFile = path.join(config.homeDir, "cloud-worker-token");
const trustedTransport = process.env.TONGPING_TRUSTED_WORKER_TRANSPORT === "1";
// Batch 1 hosted command mode: only under trusted transport and an explicit
// flag. The legacy private poll/result path stays byte-identical when off.
const hostedCommands =
  trustedTransport && process.env.TONGPING_HOSTED_COMMANDS === "1";
let trustedSession: WorkerServiceSession | null = null;
let token = "";

if (trustedTransport) {
  trustedSession = await openWorkerServiceSession(config.homeDir, cloudUrl);
} else {
  token =
    process.env.TONGPING_WORKER_TOKEN?.trim() ||
    (await readOptional(tokenFile));
  if (!token) {
    const pairCode = process.env.TONGPING_PAIR_CODE?.trim();
    if (!pairCode) {
      throw new Error("No worker token. Set TONGPING_PAIR_CODE once to pair this computer.");
    }
    console.error("Pairing this computer with TongPing cloud...");
    token = await pairWorker(pairCode);
    await fs.mkdir(config.homeDir, { recursive: true });
    await fs.writeFile(tokenFile, token + "\n", { encoding: "utf8", mode: 0o600 });
    console.error("TongPing worker paired; token stored at " + tokenFile);
  }
}

// Local installation identity is independent of the legacy pairing token.
await loadOrCreateWorkerDeviceId(config.homeDir);

console.error(
  "TongPing worker " + workerName +
  " -> " + cloudUrl + "; state=" + config.homeDir,
);

console.error("Worker " + (trustedTransport ? "session opened" : "paired/authorized") + ". Starting long-poll loop...");

let stopping = false;
let activePoll: AbortController | null = null;

// A rejected or expired session is replaced from the device credential: a
// server restart or deploy drops sessions, and stopping here left every
// Worker offline until someone restarted it by hand. Only a rejected device
// (the session endpoint itself answers 401/403) stops the transport.
let renewingSession: Promise<void> | null = null;
const SESSION_RENEW_AHEAD_MS = 60_000;
// Opening a session retires the previous one on the server, so a late 401
// for the old credential must not throw away the one just opened, and two
// Workers sharing one device must not replace each other every second.
const SESSION_REJECT_QUIET_MS = 30_000;
let lastSessionRenewedAt = 0;
let rejectBackoffMs = 0;
const socketCredential = new WeakMap<WebSocket, string>();

// After a network outage a socket can stay "open" here while the server has
// long forgotten it (half-open TCP), and nothing would ever reconnect it.
// Ping every 15 s; no pong by the next ping means it is dead: terminate it so
// the normal close → reconnect path runs.
const SOCKET_PING_MS = 15_000;
function keepSocketAlive(socket: WebSocket): void {
  let awaitingPong = false;
  let timer: NodeJS.Timeout | null = null;
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
  socket.on("pong", () => { awaitingPong = false; });
  socket.once("open", () => {
    timer = setInterval(() => {
      if (socket.readyState !== WebSocket.OPEN) return stop();
      if (awaitingPong) {
        console.error("websocket heartbeat lost; reconnecting:", socket.url.replace(/\?.*$/, ""));
        stop();
        try { socket.terminate(); } catch {}
        return;
      }
      awaitingPong = true;
      try { socket.ping(); } catch {}
    }, SOCKET_PING_MS);
    timer.unref?.();
  });
  socket.once("close", stop);
  socket.once("error", stop);
}

function noteSocketCredential(socket: WebSocket): void {
  if (trustedSession) socketCredential.set(socket, trustedSession.sessionCredential);
}

function credentialOf(headers: Record<string, string>): string | undefined {
  return /^Worker (\S+)$/.exec(headers.authorization ?? "")?.[1];
}

function renewTrustedSession(reason: string, keepCurrent = false, rejectedCredential?: string): void {
  if (!trustedTransport || stopping || renewingSession) return;
  if (rejectedCredential !== undefined && trustedSession && trustedSession.sessionCredential !== rejectedCredential) {
    return;
  }
  const rejected = reason === "rejected";
  if (!keepCurrent) {
    trustedSession = null;
    activePoll?.abort();
  }
  console.error("Trusted Worker session " + reason + "; opening a new one.");
  renewingSession = (async () => {
    if (rejected && Date.now() - lastSessionRenewedAt < SESSION_REJECT_QUIET_MS) {
      // Rejected again soon after a renewal: likely another Worker on this
      // device took the session. Back off instead of trading it every second.
      rejectBackoffMs = Math.min(Math.max(rejectBackoffMs * 2, SESSION_REJECT_QUIET_MS), 5 * 60_000);
      console.error("worker session renew: rejected again soon; waiting " + Math.round(rejectBackoffMs / 1000) + " s");
      await sleep(rejectBackoffMs);
    } else if (rejected) {
      rejectBackoffMs = 0;
    }
    let backoffMs = 1_000;
    while (!stopping) {
      try {
        trustedSession = await openWorkerServiceSession(config.homeDir, cloudUrl);
        lastSessionRenewedAt = Date.now();
        activePoll?.abort();
        console.error("Trusted Worker session renewed.");
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/HTTP (401|403)\b/.test(message)) {
          stopping = true;
          trustedSession = null;
          activePoll?.abort();
          console.error("Trusted Worker device rejected; transport stopped.");
          return;
        }
        console.error("worker session renew:", message);
        await sleep(backoffMs);
        backoffMs = Math.min(backoffMs * 2, 30_000);
      }
    }
  })().finally(() => { renewingSession = null; });
}

function rejectTrustedHttp(response: Response, sentHeaders: Record<string, string>): void {
  if (trustedTransport && (response.status === 401 || response.status === 403)) {
    renewTrustedSession("rejected", false, credentialOf(sentHeaders));
  }
}

type ExternalLoginSession = {
  child: ChildProcess;
  pid: number;
  executable: string;
  url: string;
  startedAt: string;
};

const externalLogins = new Map<string, ExternalLoginSession>();

type LiveFrame = {
  buffer: Buffer;
  width: number;
  height: number;
  sequence: number;
  capturedAt: number;
  media: LiveFrameMediaMeta | null;
};

type LiveAudioChunk = {
  buffer: Buffer;
  sampleRate: number;
  channels: number;
  frames: number;
  sequence: number;
  capturedAt: number;
};

const audioStarted = new Set<string>();
const audioStreams = new Map<string, WebSocket>();
const audioHealth = new Map<string, {
  lastChunkAt: number;
  armed: boolean;
  restarting: boolean;
}>();
const AUDIO_OPUS_BITRATE = 32_000;
const AUDIO_OPUS_FRAME_MS = 20;

type AudioOpusState = {
  encoder: OpusScript;
  sampleRate: number;
  channels: number;
  frameSize: number;
  pending: Buffer;
  transportSequence: number;
};

const audioOpusStates = new Map<string, AudioOpusState>();

const mediaDesired = new Set<string>();
const mediaStarted = new Set<string>();
const companionQualityDegraded = new Set<string>();
const mediaModes = new Map<string, "media" | "companion">();
const mediaStreams = new Map<string, WebSocket>();
const mediaRestarting = new Set<string>();

const liveStarted = new Set<string>();

const MAX_LIVE_IN_FLIGHT = 1;
const LIVE_FRAME_ACK_TIMEOUT_MIN_MS = 10_000;
const LIVE_FRAME_ACK_TIMEOUT_MAX_MS = 30_000;
const LIVE_FRAME_ACK_TIMEOUT_MULTIPLIER = 6;

type LiveUploadState = {
  busy: boolean;
  latest: LiveFrame | null;
  lastSentAt: number;
  inFlight: Map<string, number>;
  capturedFrames: number;
  overwrittenFrames: number;
  sentFrames: number;
  ackedFrames: number;
  bufferedDrops: number;
  ackTimeoutResets: number;
  lastAckMs: number;
  avgAckMs: number;
  maxAckMs: number;
  ackSamples: number;
  currentAckTimeoutMs: number;
  lastDiagAt: number;
  lastFrameBytes: number;
};

const liveUploadState = new Map<string, LiveUploadState>();
const liveStreams = new Map<string, WebSocket>();
const controlStreams = new Map<string, WebSocket>();
const liveControlChains = new Map<string, Promise<void>>();
const controlReconnectTimers = new Map<string, NodeJS.Timeout>();
// Pilot devices get exactly one browser profile, always named "default".
const HOSTED_LIVE_PROFILE = "default";
const HOSTED_MEDIA_ACTIONS = new Set([
  "human_media_start",
  "human_media_restart",
  "human_media_pause",
  "human_media_clock",
  "human_media_seek",
  "human_media_stop",
]);
const liveWatchdogLastRestartAt = new Map<string, number>();

// Auto local verification: while the user is watching (live view on), a
// slider or login wall on a shopping site is handed to a normal local
// Chrome window; closing that window hands the profile straight back.
const AUTO_VERIFY_CHECK_MS = 3_000;
const AUTO_VERIFY_COOLDOWN_MS = 10 * 60_000;
const autoVerifySessions = new Map<string, { wasLive: boolean }>();
const autoVerifyCooldownUntil = new Map<string, number>();
let autoVerifyBusy = false;
const autoVerifyTimer = setInterval(() => {
  if (autoVerifyBusy || stopping || !desktopLoginSupported()) return;
  autoVerifyBusy = true;
  void (async () => {
    // 1. A handed-off window was closed: take the profile back.
    for (const [profile, handoff] of [...autoVerifySessions]) {
      const session = externalLogins.get(profile);
      if (session && childStillRunning(session)) continue;
      autoVerifySessions.delete(profile);
      autoVerifyCooldownUntil.set(profile, Date.now() + AUTO_VERIFY_COOLDOWN_MS);
      try {
        if (session) await finishExternalLogin(profile);
        if (handoff.wasLive) await ensureLive(profile);
        console.error("auto local verification resumed:", profile);
      } catch (error) {
        console.error("auto local verification resume:", error instanceof Error ? error.message : String(error));
      }
    }
    // 2. Someone is watching and the page asks for a human check.
    for (const profile of [...liveStarted]) {
      if (externalLogins.has(profile) || autoVerifySessions.has(profile)) continue;
      if ((autoVerifyCooldownUntil.get(profile) ?? 0) > Date.now()) continue;
      const challenge = await service.verificationChallenge(profile).catch(() => null);
      if (!challenge) continue;
      autoVerifySessions.set(profile, { wasLive: true });
      try {
        await startExternalLogin(profile, challenge.url);
        console.error("auto local verification opened:", profile, challenge.reason);
      } catch (error) {
        autoVerifySessions.delete(profile);
        autoVerifyCooldownUntil.set(profile, Date.now() + AUTO_VERIFY_COOLDOWN_MS);
        console.error("auto local verification:", error instanceof Error ? error.message : String(error));
      }
    }
  })().finally(() => {
    autoVerifyBusy = false;
  });
}, AUTO_VERIFY_CHECK_MS);
autoVerifyTimer.unref?.();
const liveHealth = new Map<string, {
  lastFrameAt: number;
  burstWindowStartedAt: number;
  burstFrames: number;
  armed: boolean;
  restarting: boolean;
}>();

const liveWatchdog = setInterval(() => {
  const now = Date.now();
  for (const profile of liveStarted) {
    // Companion capture owns the tab's presentation path. Sparse CDP frames
    // while that recorder is active are not a reason to churn screencast.
    if (
      mediaStarted.has(profile) &&
      mediaModes.get(profile) === "companion"
    ) {
      continue;
    }

    const health = liveHealth.get(profile);
    if (!health || !health.armed || health.restarting) continue;
    if (now - health.lastFrameAt < 15_000) continue;

    const previousRestartAt =
      liveWatchdogLastRestartAt.get(profile) ?? 0;
    if (now - previousRestartAt < 30_000) continue;
    liveWatchdogLastRestartAt.set(profile, now);

    health.restarting = true;
    health.armed = false;
    console.error(
      "live screencast watchdog restart:",
      profile,
      "stallMs=" + String(now - health.lastFrameAt),
    );

    void (async () => {
      try {
        await service.stopLiveScreencast(profile).catch(() => {});
        if (!liveStarted.has(profile)) return;
        await startLiveCapture(profile);
      } catch (error) {
        console.error(
          "live screencast watchdog:",
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        const current = liveHealth.get(profile);
        if (current) {
          current.restarting = false;
          current.lastFrameAt = Date.now();
          current.burstWindowStartedAt = Date.now();
          current.burstFrames = 0;
        }
      }
    })();
  }
}, 500);
liveWatchdog.unref?.();

const audioWatchdog = setInterval(() => {
  const now = Date.now();
  for (const profile of audioStarted) {
    const health = audioHealth.get(profile);
    if (!health || !health.armed || health.restarting) continue;
    if (now - health.lastChunkAt < 3_000) continue;

    health.restarting = true;
    health.armed = false;
    console.error(
      "live audio watchdog restart:",
      profile,
      "stallMs=" + String(now - health.lastChunkAt),
    );

    void (async () => {
      try {
        await service.stopLiveAudio(profile).catch(() => {});
        if (!audioStarted.has(profile)) return;
        await ensureAudio(profile);
      } catch (error) {
        console.error(
          "live audio watchdog:",
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        const current = audioHealth.get(profile);
        if (current) {
          current.restarting = false;
          current.lastChunkAt = Date.now();
        }
      }
    })();
  }
}, 500);
audioWatchdog.unref?.();

// While someone watches (live view or Watch Together), keep the browser window from
// sitting minimized: a minimized Chrome stops painting.
const windowRestoreTimer = setInterval(() => {
  if (stopping) return;
  const profiles = new Set([...liveStarted, ...mediaStarted]);
  for (const profile of profiles) {
    void service.restoreWindowIfMinimized(profile).then((restored) => {
      if (restored) console.error("browser window was minimized; restored:", profile);
    }).catch(() => {});
  }
}, 5_000);
windowRestoreTimer.unref?.();

// Hosted (pilot) live view: keep the route's control channel open so the
// server can start/stop the screencast and relay the card's input.
if (hostedCommands) {
  const keepHostedControl = () => {
    // A socket object can linger after the network dropped under it; only an
    // open (or opening) one counts as connected.
    const current = controlStreams.get(HOSTED_LIVE_PROFILE);
    if (
      stopping ||
      current?.readyState === WebSocket.OPEN ||
      current?.readyState === WebSocket.CONNECTING
    ) return;
    void ensureControlSocket(HOSTED_LIVE_PROFILE).catch((error) => {
      console.error(
        "hosted control websocket:",
        error instanceof Error ? error.message : String(error),
      );
    });
  };
  keepHostedControl();
  const hostedControlTimer = setInterval(keepHostedControl, 5_000);
  hostedControlTimer.unref?.();
}

while (!stopping) {
  let command: any | null = null;
  let routed = false;
  try {
    const polled = await poll();
    if (!polled) continue;
    command = polled.command;
    if (isHostedCommandEnvelope(command)) {
      if (!hostedCommands) {
        // Opt-in is disabled: never execute a hosted envelope and never
        // acknowledge it. Fail closed; the command is left to expire.
        continue;
      }
      routed = true;
      const rejection = validateHostedCommand(command, polled.receivedAt);
      if (rejection) {
        // Reject without executing; the broker returns a terminal error.
        await postResult(command, { ok: false, error: rejection }, true);
        continue;
      }
      // Recheck immediately before local execution. Body parsing and any
      // synchronous validation time consume the ttl captured when response
      // headers first arrived.
      if (Date.now() >= polled.receivedAt + command.ttl_ms) {
        await postResult(
          command,
          { ok: false, error: "hosted command ttl elapsed" },
          true,
        );
        continue;
      }
    }
    if (routed && command.action === "browser_screenshot") {
      // A small JPEG: AI hosts such as ChatGPT file a large PNG away as an
      // unreadable resource instead of showing it to the model.
      command = { ...command, args: { ...command.args, format: "small-jpeg" } };
    }
    if (routed && command.action === "browser_set_files") {
      // Hosted uploads name files by URL; fetch them here, on the device.
      command = { ...command, args: { ...command.args, files: await downloadUploadFiles(command.args?.files) } };
    }
    const reply = await execute(command);
    const compactReply = await externalizeFrame(command, reply);
    await postResult(command, compactReply, routed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!stopping && command?.id) {
      try {
        await postResult(command, { ok: false, error: message }, routed);
      } catch {}
    }
    console.error("worker loop:", message);
    if (stopping) break;
    await sleep(1500);
  }
}

clearInterval(liveWatchdog);
clearInterval(audioWatchdog);
for (const profile of [...audioStarted]) {
  await stopAudio(profile);
}
for (const profile of [...mediaDesired]) {
  await stopMedia(profile);
}
for (const profile of [...liveStarted]) {
  await stopLive(profile);
}
await service.close();

async function execute(command: any) {
  const profile =
    typeof command.args?.profile === "string"
      ? command.args.profile
      : "";

  if (
    command.op === "human" &&
    command.action === "human_status" &&
    profile
  ) {
    const reply = await gateway.human(
      "human_status",
      command.args ?? {},
      command.client,
    );
    if (
      reply?.ok &&
      reply.result &&
      typeof reply.result === "object"
    ) {
      (reply.result as Record<string, unknown>).externalLogin =
        externalLoginStatus(profile);
    }
    return reply;
  }

  if (
    command.op === "human" &&
    command.action === "human_external_login_start" &&
    profile
  ) {
    return {
      ok: true,
      result: await startExternalLogin(
        profile,
        typeof command.args?.url === "string"
          ? command.args.url
          : "",
      ),
    };
  }

  if (
    command.op === "human" &&
    command.action === "human_external_login_finish" &&
    profile
  ) {
    return {
      ok: true,
      result: await finishExternalLogin(profile),
    };
  }

  if (profile && externalLogins.has(profile)) {
    return {
      ok: false,
      error:
        `Profile ${profile} is in local manual-login mode. ` +
        "Finish that login before remote/model control resumes.",
    };
  }

  if (
    command.op === "human" &&
    command.action === "human_live_start" &&
    profile
  ) {
    await ensureLive(profile);
    return {
      ok: true,
      result: {
        profile,
        live: true,
        transport: "websocket",
      },
    };
  }

  if (
    command.op === "human" &&
    command.action === "human_live_stop" &&
    profile
  ) {
    await stopLive(profile);
    return {
      ok: true,
      result: {
        profile,
        live: false,
        transport: "websocket",
      },
    };
  }

  if (
    command.op === "human" &&
    command.action === "human_audio_start" &&
    profile
  ) {
    const result = await ensureAudio(profile);
    return {
      ok: true,
      result: {
        profile,
        audio: true,
        transport: "websocket-pcm16",
        ...result,
      },
    };
  }

  if (
    command.op === "human" &&
    command.action === "human_audio_stop" &&
    profile
  ) {
    await stopAudio(profile);
    return {
      ok: true,
      result: {
        profile,
        audio: false,
        transport: "websocket-pcm16",
      },
    };
  }

  if (
    command.op === "human" &&
    command.action === "human_media_start" &&
    profile
  ) {
    const mode =
      command.args?.mode === "companion" ? "companion" : "media";
    if (mode === "companion") {
      companionQualityDegraded.delete(profile);
    }
    const result = await ensureMedia(profile, mode);
    return {
      ok: true,
      result: {
        profile,
        media: true,
        transport: "websocket-webm-vp8",
        ...result,
      },
    };
  }

  if (
    command.op === "human" &&
    command.action === "human_media_restart" &&
    profile
  ) {
    const mode =
      command.args?.mode === "companion" ? "companion" : "media";
    // A server-driven restart (new viewer, watchdog, seek) says nothing about
    // the uplink, so it keeps the current tier. Only real upload backpressure
    // (scheduleMediaRestart) drops a session to the safe tier.
    await stopMedia(profile);
    const result = await ensureMedia(profile, mode);
    return {
      ok: true,
      result: {
        profile,
        media: true,
        transport: "websocket-webm-vp8",
        ...result,
      },
    };
  }

  if (
    command.op === "human" &&
    command.action === "human_media_clock" &&
    profile
  ) {
    return { ok: true, result: await service.readMediaClock(profile) };
  }

  if (
    command.op === "human" &&
    command.action === "human_media_seek" &&
    profile
  ) {
    // Hosted Watch Together start-from-top: the same seek the personal relay calls as
    // browser_media_seek (which the hosted media lane does not carry).
    return gateway.call(
      "browser_media_seek",
      { profile, targetSeconds: Number(command.args?.targetSeconds ?? 0) },
      command.client,
    );
  }

  if (
    command.op === "human" &&
    command.action === "human_media_pause" &&
    profile
  ) {
    const paused = command.args?.paused === true;
    const result = await service.pauseLiveMedia(profile, paused);
    return {
      ok: true,
      result: {
        profile,
        ...(result as Record<string, unknown>),
      },
    };
  }

  if (
    command.op === "human" &&
    command.action === "human_media_stop" &&
    profile
  ) {
    await stopMedia(profile);
    companionQualityDegraded.delete(profile);
    return {
      ok: true,
      result: {
        profile,
        media: false,
        transport: "websocket-webm-vp8",
      },
    };
  }

  const runOnce = async () => {
    if (command.op === "call") {
      return gateway.call(
        command.action as BrowserAction,
        command.args ?? {},
        command.client,
      );
    }
    if (command.op === "human") {
      return gateway.human(
        command.action as HumanBrowserAction,
        command.args ?? {},
        command.client,
      );
    }
    return { ok: false, error: "Unknown worker command." };
  };

  let reply = await runOnce();
  if (
    !reply?.ok &&
    (command.action === "browser_screenshot" ||
      command.action === "human_preview")
  ) {
    await sleep(250);
    reply = await runOnce();
  }

  if (
    reply?.ok &&
    profile &&
    command.action === "browser_close_profile"
  ) {
    await stopAudio(profile);
    await stopLive(profile);
  }

  return reply;
}


function normalizeExternalLoginProfile(profile: string): string {
  const trimmed = profile.trim();
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(trimmed)) {
    throw new Error("Invalid browser profile.");
  }
  return trimmed;
}

function externalLoginStatus(profile: string): Record<string, unknown> {
  const normalized = normalizeExternalLoginProfile(profile);
  const session = externalLogins.get(normalized);
  if (!session) {
    return {
      active: false,
      supported: desktopLoginSupported(),
    };
  }
  const processRunning = childStillRunning(session);
  return {
    active: true,
    supported: true,
    processRunning,
    readyToResume: !processRunning,
    pid: session.pid,
    browser: path.basename(session.executable),
    url: session.url,
    startedAt: session.startedAt,
  };
}

function desktopLoginSupported(): boolean {
  if (process.platform === "win32" || process.platform === "darwin") {
    return true;
  }
  return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

async function startExternalLogin(
  profile: string,
  requestedUrl: string,
): Promise<Record<string, unknown>> {
  const normalized = normalizeExternalLoginProfile(profile);
  const existing = externalLogins.get(normalized);
  if (existing) return externalLoginStatus(normalized);

  if (!desktopLoginSupported()) {
    throw new Error(
      "Local manual login needs a desktop session on the paired worker.",
    );
  }

  const url = normalizeExternalLoginUrl(requestedUrl);
  const executable = await findDesktopBrowserExecutable();
  const userDataDir = path.join(config.profilesDir, normalized);

  await gateway
    .human(
      "human_takeover_end",
      { profile: normalized },
      workerName,
    )
    .catch(() => undefined);
  await stopAudio(normalized);
  await stopLive(normalized);

  const closeReply = await gateway.call(
    "browser_close_profile",
    { profile: normalized },
    workerName,
  );
  if (!closeReply.ok) {
    throw new Error(
      closeReply.error ?? "Could not release the browser profile.",
    );
  }

  await fs.mkdir(userDataDir, { recursive: true });
  await sleep(250);

  const child = spawn(
    executable,
    [
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--new-window",
      url,
    ],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    },
  );

  if (!child.pid) {
    throw new Error("Desktop browser did not return a process id.");
  }

  const session: ExternalLoginSession = {
    child,
    pid: child.pid,
    executable,
    url,
    startedAt: new Date().toISOString(),
  };
  externalLogins.set(normalized, session);
  child.unref();

  await sleep(500);
  if (!childStillRunning(session)) {
    externalLogins.delete(normalized);
    throw new Error(
      "Desktop browser exited immediately. Check Chrome/Edge on the paired worker.",
    );
  }

  console.error(
    "local manual login started:",
    normalized,
    path.basename(executable),
    "pid=" + String(session.pid),
  );
  return externalLoginStatus(normalized);
}

async function finishExternalLogin(
  profile: string,
): Promise<Record<string, unknown>> {
  const normalized = normalizeExternalLoginProfile(profile);
  const session = externalLogins.get(normalized);
  if (!session) {
    return {
      active: false,
      supported: desktopLoginSupported(),
      resumed: false,
    };
  }

  if (childStillRunning(session)) {
    throw new Error(
      "The local login window is still open. Finish signing in on the computer and close that Chrome/Edge window, then click “Signed in, reconnect.”",
    );
  }

  const openReply = await gateway.call(
    "browser_open",
    { profile: normalized, url: session.url },
    workerName,
  );
  if (!openReply.ok) {
    throw new Error(
      (openReply.error ?? "Could not reopen the browser profile.") +
        " If the local Chrome/Edge window is still open, close that login window before trying again.",
    );
  }

  externalLogins.delete(normalized);
  console.error("local manual login finished:", normalized);
  return {
    active: false,
    supported: true,
    resumed: true,
    url: session.url,
    browser: openReply.result,
  };
}

function normalizeExternalLoginUrl(value: string): string {
  const fallback = "https://example.com/";
  const raw = value.trim() || fallback;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Manual-login URL must be a valid http(s) URL.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Manual-login URL must use http or https.");
  }

  // A Google rejection URL is a dead end. Restart the owning ChatGPT flow
  // in a normal local browser instead of reopening the rejected callback.
  if (
    parsed.hostname === "accounts.google.com" &&
    parsed.pathname.includes("/signin/rejected")
  ) {
    return fallback;
  }
  return parsed.toString();
}

async function findDesktopBrowserExecutable(): Promise<string> {
  const candidates: string[] = [];
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA;
    const programFiles = process.env.PROGRAMFILES;
    const programFilesX86 = process.env["PROGRAMFILES(X86)"];
    if (local) {
      candidates.push(
        path.join(local, "Google", "Chrome", "Application", "chrome.exe"),
        path.join(local, "Microsoft", "Edge", "Application", "msedge.exe"),
      );
    }
    if (programFiles) {
      candidates.push(
        path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
        path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
      );
    }
    if (programFilesX86) {
      candidates.push(
        path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
        path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
      );
    }
  } else if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    );
  } else {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/microsoft-edge",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
    );
  }

  if (
    config.executablePath &&
    !/playwright|ms-playwright/i.test(config.executablePath)
  ) {
    candidates.push(config.executablePath);
  }

  for (const candidate of [...new Set(candidates)]) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
  }

  throw new Error(
    "No normal desktop Chrome/Edge installation was found on the paired worker.",
  );
}

function childStillRunning(session: ExternalLoginSession): boolean {
  if (session.child.exitCode !== null || session.child.killed) {
    return false;
  }
  try {
    process.kill(session.pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function ensureAudio(profile: string): Promise<Record<string, unknown>> {
  await ensureAudioSocket(profile);

  const prior = audioHealth.get(profile);
  if (!prior) {
    audioHealth.set(profile, {
      lastChunkAt: Date.now(),
      armed: false,
      restarting: false,
    });
  }

  try {
    const result = await service.startLiveAudio(profile, (chunk) => {
      const health = audioHealth.get(profile);
      if (health) {
        health.lastChunkAt = Date.now();
        health.armed = true;
      }
      sendAudioChunk(profile, chunk);
    });
    audioStarted.add(profile);
    console.error(
      "live audio started:",
      profile,
      "supported=" + String(result.supported),
      "videos=" + String(result.videoCount),
      "tracks=" + String(result.audioTracks),
      "ctx=" + String(result.state),
    );
    return result;
  } catch (error) {
    audioStarted.delete(profile);
    throw error;
  }
}

async function stopAudio(profile: string): Promise<void> {
  audioStarted.delete(profile);
  audioHealth.delete(profile);
  const stream = audioStreams.get(profile);
  audioStreams.delete(profile);
  if (stream) {
    try { stream.close(1000, "audio ended"); } catch {}
  }
  const opus = audioOpusStates.get(profile);
  if (opus) {
    try { opus.encoder.delete(); } catch {}
    audioOpusStates.delete(profile);
  }
  await service.stopLiveAudio(profile).catch(() => {});
}

function sendAudioChunk(profile: string, chunk: LiveAudioChunk): void {
  const socket = audioStreams.get(profile);
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    if (audioStarted.has(profile)) {
      void ensureAudioSocket(profile).catch((error) => {
        console.error(
          "audio websocket reconnect:",
          error instanceof Error ? error.message : String(error),
        );
      });
    }
    return;
  }
  if (socket.bufferedAmount > 96_000) return;

  try {
    const state = ensureAudioOpusState(profile, chunk);
    state.pending = state.pending.length
      ? Buffer.concat([state.pending, chunk.buffer])
      : Buffer.from(chunk.buffer);
    const pcmBytesPerFrame =
      state.frameSize * state.channels * 2;

    while (state.pending.length >= pcmBytesPerFrame) {
      if (socket.bufferedAmount > 96_000) break;

      const pcm = Buffer.from(
        state.pending.subarray(0, pcmBytesPerFrame),
      );
      state.pending = Buffer.from(
        state.pending.subarray(pcmBytesPerFrame),
      );
      const encoded = state.encoder.encode(
        pcm,
        state.frameSize,
      );
      state.transportSequence += 1;
      socket.send(
        encodeOpusWorkerAudioPacket({
          buffer: encoded,
          sequence: state.transportSequence,
          sampleRate: state.sampleRate,
          channels: state.channels,
          frames: state.frameSize,
          capturedAt: chunk.capturedAt,
        }),
        { binary: true, compress: false },
      );
    }
  } catch (error) {
    console.error(
      "audio opus encode:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function ensureAudioOpusState(
  profile: string,
  chunk: LiveAudioChunk,
): AudioOpusState {
  const current = audioOpusStates.get(profile);
  if (
    current &&
    current.sampleRate === chunk.sampleRate &&
    current.channels === chunk.channels
  ) {
    return current;
  }

  if (current) {
    try { current.encoder.delete(); } catch {}
    audioOpusStates.delete(profile);
  }

  const sampleRate = chunk.sampleRate;
  const channels = chunk.channels;
  if (
    ![8_000, 12_000, 16_000, 24_000, 48_000].includes(sampleRate) ||
    channels !== 1
  ) {
    throw new Error(
      "unsupported audio format for Opus transport",
    );
  }
  const frameSize = Math.round(
    sampleRate * AUDIO_OPUS_FRAME_MS / 1000,
  );
  const encoder = new OpusScript(
    sampleRate as 8000 | 12000 | 16000 | 24000 | 48000,
    channels,
    OpusScript.Application.AUDIO,
  );
  encoder.setBitrate(AUDIO_OPUS_BITRATE);
  const state: AudioOpusState = {
    encoder,
    sampleRate,
    channels,
    frameSize,
    pending: Buffer.alloc(0),
    transportSequence: 0,
  };
  audioOpusStates.set(profile, state);
  return state;
}

async function ensureAudioSocket(profile: string): Promise<WebSocket> {
  const existing = audioStreams.get(profile);
  if (existing?.readyState === WebSocket.OPEN) return existing;
  if (existing?.readyState === WebSocket.CONNECTING) {
    await waitForSocketOpen(existing);
    return existing;
  }

  if (existing) {
    try { existing.terminate(); } catch {}
    audioStreams.delete(profile);
  }

  const url = new URL(cloudUrl + "/v1/worker/audio-ws");
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("profile", profile);

  const socket = new WebSocket(url, {
    headers: workerHeaders(),
    perMessageDeflate: false,
    handshakeTimeout: 8_000,
    family: 4,
    agent: proxyAgentFor(url),
  });
  noteSocketCredential(socket);
  keepSocketAlive(socket);
  audioStreams.set(profile, socket);

  const cleanup = () => {
    if (audioStreams.get(profile) === socket) {
      audioStreams.delete(profile);
    }
  };
  socket.once("close", cleanup);
  socket.once("error", cleanup);

  await waitForSocketOpen(socket);
  return socket;
}


async function ensureMedia(
  profile: string,
  mode: "media" | "companion" = "media",
): Promise<Record<string, unknown>> {
  mediaDesired.add(profile);
  mediaModes.set(profile, mode);
  await ensureMediaSocket(profile);
  if (mediaStarted.has(profile) && mediaModes.get(profile) === mode) {
    return {
      profile,
      attached: true,
      captureMode: "tab-output-webm",
      mode,
      qualityTier:
        mode === "companion"
          ? (companionQualityDegraded.has(profile) ? "safe" : "hq-test")
          : "legacy",
    };
  }

  try {
    const result = await service.startLiveMedia(
      profile,
      (event) => sendMediaEvent(profile, event),
      mode === "companion"
        ? {
            includeAudio: true,
            chunkMs: 1_000,
            // HD by default; after real upload backpressure this session
            // falls back to a still-watchable safe budget.
            videoBitsPerSecond: companionQualityDegraded.has(profile)
              ? 900_000
              : 2_000_000,
            audioBitsPerSecond: companionQualityDegraded.has(profile)
              ? 64_000
              : 96_000,
            keepSourcePlaying: true,
            // H.264 in WebM: the server copies it instead of re-encoding.
            preferH264: true,
          }
        : {},
    ) as Record<string, unknown>;
    const attached = result.attached === true;
    if (attached) {
      mediaStarted.add(profile);
    } else {
      // A failed tab-capture attach must not retry by opening another helper
      // page. The app falls back to realtime JPEG and a future explicit
      // media restart may try again.
      mediaStarted.delete(profile);
    }
    const qualityTier =
      mode === "companion"
        ? (companionQualityDegraded.has(profile) ? "safe" : "hq-test")
        : "legacy";
    console.error(
      "live media started:",
      profile,
      qualityTier,
      JSON.stringify(result),
    );
    return {
      ...result,
      qualityTier,
    };
  } catch (error) {
    mediaStarted.delete(profile);
    throw error;
  }
}

async function stopMedia(profile: string): Promise<void> {
  mediaDesired.delete(profile);
  mediaStarted.delete(profile);
  mediaModes.delete(profile);
  const stream = mediaStreams.get(profile);
  mediaStreams.delete(profile);
  if (stream) {
    try { stream.close(1000, "media ended"); } catch {}
  }
  await service.stopLiveMedia(profile).catch(() => {});
}

function sendMediaEvent(profile: string, event: LiveMediaEvent): void {
  const socket = mediaStreams.get(profile);
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    if (mediaDesired.has(profile)) {
      void ensureMediaSocket(profile).catch((error) => {
        console.error(
          "media websocket reconnect:",
          error instanceof Error ? error.message : String(error),
        );
      });
    }
    return;
  }

  try {
    if (event.type === "start" || event.type === "end") {
      socket.send(JSON.stringify({
        type:
          event.type === "start"
            ? "media_stream_start"
            : "media_stream_end",
        streamId: event.streamId,
        mimeType: event.mimeType,
        capturedAt: event.capturedAt,
      }));
      return;
    }

    if (!event.buffer || event.buffer.length <= 0) return;
    // Watch Together plays from a delayed buffer, so a short uplink hiccup (a proxy
    // pause, a Wi-Fi blip) can drain on its own; ~16 s at 2 Mbit/s before
    // the recorder is torn down, which costs every viewer a full rebuffer.
    const backpressureLimit =
      mediaModes.get(profile) === "companion"
        ? 4_000_000
        : 256_000;
    if (socket.bufferedAmount > backpressureLimit) {
      scheduleMediaRestart(profile);
      return;
    }

    socket.send(
      encodeMediaSegmentPacket({
        buffer: event.buffer,
        sequence: event.sequence,
        capturedAt: event.capturedAt,
      }),
      { binary: true, compress: false },
    );
  } catch (error) {
    console.error(
      "media segment upload:",
      error instanceof Error ? error.message : String(error),
    );
    scheduleMediaRestart(profile);
  }
}

// She switched tabs (e.g. clicked a Bilibili video that opens a new tab while
// the old page keeps playing a carousel): record the tab she now looks at.
// Same restart as a server-driven human_media_restart: keeps the quality tier.
const tabFollowTimers = new Map<string, NodeJS.Timeout>();
service.onShownTabChange((profile) => {
  if (!mediaStarted.has(profile) || stopping) return;
  clearTimeout(tabFollowTimers.get(profile));
  tabFollowTimers.set(profile, setTimeout(() => {
    tabFollowTimers.delete(profile);
    if (!mediaStarted.has(profile) || mediaRestarting.has(profile) || stopping) return;
    const mode = mediaModes.get(profile) ?? "media";
    mediaRestarting.add(profile);
    void (async () => {
      try {
        await stopMedia(profile);
        await ensureMedia(profile, mode);
        console.error("media followed shown tab:", profile, mode);
      } catch (error) {
        console.error("media follow tab:", error instanceof Error ? error.message : String(error));
      } finally {
        mediaRestarting.delete(profile);
      }
    })();
  }, 600));
});

function scheduleMediaRestart(profile: string): void {
  if (
    !mediaDesired.has(profile) ||
    mediaRestarting.has(profile) ||
    stopping
  ) {
    return;
  }
  mediaRestarting.add(profile);
  setTimeout(() => {
    void (async () => {
      try {
        if (mediaModes.get(profile) === "companion") {
          companionQualityDegraded.add(profile);
        }
        await service.stopLiveMedia(profile).catch(() => {});
        mediaStarted.delete(profile);
        const stream = mediaStreams.get(profile);
        if (stream) {
          mediaStreams.delete(profile);
          try { stream.close(1000, "media restart"); } catch {}
        }
        if (!stopping && mediaDesired.has(profile)) {
          await ensureMedia(
            profile,
            mediaModes.get(profile) ?? "media",
          );
        }
      } catch (error) {
        console.error(
          "media restart:",
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        mediaRestarting.delete(profile);
      }
    })();
  }, 250).unref?.();
}

async function ensureMediaSocket(profile: string): Promise<WebSocket> {
  const existing = mediaStreams.get(profile);
  if (existing?.readyState === WebSocket.OPEN) return existing;
  if (existing?.readyState === WebSocket.CONNECTING) {
    await waitForSocketOpen(existing);
    return existing;
  }

  if (existing) {
    try { existing.terminate(); } catch {}
    mediaStreams.delete(profile);
  }

  const url = new URL(cloudUrl + "/v1/worker/media-ws");
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("profile", profile);

  const socket = new WebSocket(url, {
    headers: workerHeaders(),
    perMessageDeflate: false,
    handshakeTimeout: 8_000,
    family: 4,
    agent: proxyAgentFor(url),
  });
  noteSocketCredential(socket);
  keepSocketAlive(socket);
  mediaStreams.set(profile, socket);

  const cleanup = () => {
    if (mediaStreams.get(profile) === socket) {
      mediaStreams.delete(profile);
    }
  };
  socket.once("close", cleanup);
  socket.once("error", cleanup);

  await waitForSocketOpen(socket);
  return socket;
}

async function ensureLive(profile: string): Promise<void> {
  if (liveStarted.has(profile)) {
    await Promise.all([
      ensureLiveSocket(profile),
      ensureControlSocket(profile),
    ]);
    return;
  }
  await Promise.all([
    ensureLiveSocket(profile),
    ensureControlSocket(profile),
  ]);
  liveStarted.add(profile);
  try {
    await startLiveCapture(profile);
  } catch (error) {
    liveStarted.delete(profile);
    liveHealth.delete(profile);
    throw error;
  }
  console.error("live screencast started:", profile);
}

async function startLiveCapture(profile: string): Promise<void> {
  liveHealth.set(profile, {
    lastFrameAt: Date.now(),
    burstWindowStartedAt: Date.now(),
    burstFrames: 0,
    armed: false,
    restarting: liveHealth.get(profile)?.restarting ?? false,
  });
  await service.startLiveScreencast(profile, (frame) => {
    noteLiveFrame(profile);
    queueLiveFrame(profile, frame);
  });
}

function noteLiveFrame(profile: string): void {
  const now = Date.now();
  let health = liveHealth.get(profile);
  if (!health) {
    health = {
      lastFrameAt: now,
      burstWindowStartedAt: now,
      burstFrames: 0,
      armed: false,
      restarting: false,
    };
    liveHealth.set(profile, health);
  }

  health.lastFrameAt = now;
  if (now - health.burstWindowStartedAt > 2_000) {
    health.burstWindowStartedAt = now;
    health.burstFrames = 0;
  }
  health.burstFrames += 1;
  if (health.burstFrames >= 4) {
    health.armed = true;
  }
}

async function stopLive(profile: string): Promise<void> {
  liveStarted.delete(profile);
  liveUploadState.delete(profile);
  liveHealth.delete(profile);
  liveControlChains.delete(profile);
  liveWatchdogLastRestartAt.delete(profile);
  const reconnectTimer = controlReconnectTimers.get(profile);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  controlReconnectTimers.delete(profile);
  // In hosted mode the control socket is the long-lived command channel.
  if (!hostedCommands) {
    const control = controlStreams.get(profile);
    controlStreams.delete(profile);
    if (control) {
      try { control.close(1000, "live control ended"); } catch {}
    }
  }
  const stream = liveStreams.get(profile);
  liveStreams.delete(profile);
  if (stream) {
    try { stream.close(1000, "live view ended"); } catch {}
  }
  await service.stopLiveScreencast(profile).catch(() => {});
}

function queueLiveFrame(profile: string, frame: LiveFrame): void {
  const state = ensureLiveUploadState(profile);
  state.capturedFrames += 1;
  if (state.latest) state.overwrittenFrames += 1;
  state.latest = frame;
  maybeSendLiveTransportDiag(profile, state);
  if (!state.busy) void pumpLiveFrames(profile, state);
}

function ensureLiveUploadState(profile: string): LiveUploadState {
  let state = liveUploadState.get(profile);
  if (!state) {
    state = {
      busy: false,
      latest: null,
      lastSentAt: 0,
      inFlight: new Map<string, number>(),
      capturedFrames: 0,
      overwrittenFrames: 0,
      sentFrames: 0,
      ackedFrames: 0,
      bufferedDrops: 0,
      ackTimeoutResets: 0,
      lastAckMs: 0,
      avgAckMs: 0,
      maxAckMs: 0,
      ackSamples: 0,
      currentAckTimeoutMs: LIVE_FRAME_ACK_TIMEOUT_MIN_MS,
      lastDiagAt: 0,
      lastFrameBytes: 0,
    };
    liveUploadState.set(profile, state);
  }
  return state;
}

function liveFrameKey(sequence: number, capturedAt: number): string {
  return String(Math.floor(sequence)) + ":" + String(Math.floor(capturedAt));
}

async function pumpLiveFrames(
  profile: string,
  state: LiveUploadState,
): Promise<void> {
  if (state.busy) return;
  state.busy = true;
  try {
    while (state.latest && !stopping) {
      if (state.inFlight.size >= MAX_LIVE_IN_FLIGHT) {
        const oldestSentAt = Math.min(...state.inFlight.values());
        const timeoutMs = currentLiveFrameAckTimeoutMs(state);
        state.currentAckTimeoutMs = timeoutMs;
        if (
          Number.isFinite(oldestSentAt) &&
          Date.now() - oldestSentAt > timeoutMs
        ) {
          state.ackTimeoutResets += 1;
          state.inFlight.clear();
          const socket = liveStreams.get(profile);
          if (socket) {
            liveStreams.delete(profile);
            try { socket.terminate(); } catch {}
          }
          maybeSendLiveTransportDiag(profile, state, true);
        }
        break;
      }

      try {
        const waitMs = Math.max(
          0,
          50 - (Date.now() - state.lastSentAt),
        );
        if (waitMs > 0) await sleep(waitMs);

        if (state.inFlight.size >= MAX_LIVE_IN_FLIGHT) {
          break;
        }

        // Latest-frame-wins is decided only after pacing and after an ACK
        // window slot is available. Frames that arrive while blocked collapse
        // into one newest candidate instead of entering the websocket backlog.
        const frame = state.latest;
        state.latest = null;
        if (!frame) continue;

        state.lastFrameBytes = frame.buffer.length;
        const sent = await uploadLiveFrame(profile, frame);
        if (!sent) {
          state.bufferedDrops += 1;
          maybeSendLiveTransportDiag(profile, state);
          continue;
        }

        const sentAt = Date.now();
        state.inFlight.set(
          liveFrameKey(frame.sequence, frame.capturedAt),
          sentAt,
        );
        state.sentFrames += 1;
        state.lastSentAt = sentAt;
        maybeSendLiveTransportDiag(profile, state);
      } catch (error) {
        console.error(
          "live frame upload:",
          error instanceof Error ? error.message : String(error),
        );
        await sleep(250);
      }
    }
  } finally {
    state.busy = false;
    if (
      state.latest &&
      !stopping &&
      state.inFlight.size < MAX_LIVE_IN_FLIGHT
    ) {
      void pumpLiveFrames(profile, state);
    }
  }
}

async function uploadLiveFrame(
  profile: string,
  frame: LiveFrame,
): Promise<boolean> {
  const socket = await ensureLiveSocket(profile);
  if (socket.bufferedAmount > 96_000) {
    return false;
  }
  if (frame.media) {
    socket.send(
      JSON.stringify({
        type: "frame_media_meta",
        sequence: frame.sequence,
        capturedAt: frame.capturedAt,
        media: frame.media,
      }),
      { binary: false, compress: false },
    );
  }
  socket.send(
    encodeLiveWsPacket(frame),
    { binary: true, compress: false },
  );
  return true;
}

function noteLiveFrameReceived(
  profile: string,
  sequence: number,
  capturedAt: number,
): void {
  const state = liveUploadState.get(profile);
  if (!state) return;
  const key = liveFrameKey(sequence, capturedAt);
  const sentAt = state.inFlight.get(key);
  if (sentAt === undefined) return;

  state.inFlight.delete(key);
  const ackMs = Math.max(0, Date.now() - sentAt);
  state.ackedFrames += 1;
  state.ackSamples += 1;
  state.lastAckMs = ackMs;
  state.maxAckMs = Math.max(state.maxAckMs, ackMs);
  state.avgAckMs +=
    (ackMs - state.avgAckMs) / state.ackSamples;
  state.currentAckTimeoutMs = currentLiveFrameAckTimeoutMs(state);
  maybeSendLiveTransportDiag(profile, state);

  if (state.latest && !state.busy && !stopping) {
    void pumpLiveFrames(profile, state);
  }
}

function currentLiveFrameAckTimeoutMs(
  state: LiveUploadState,
): number {
  const learned =
    state.ackSamples > 0 && state.avgAckMs > 0
      ? state.avgAckMs * LIVE_FRAME_ACK_TIMEOUT_MULTIPLIER
      : LIVE_FRAME_ACK_TIMEOUT_MIN_MS;
  return Math.max(
    LIVE_FRAME_ACK_TIMEOUT_MIN_MS,
    Math.min(
      LIVE_FRAME_ACK_TIMEOUT_MAX_MS,
      Math.round(learned),
    ),
  );
}

function maybeSendLiveTransportDiag(
  profile: string,
  state: LiveUploadState,
  force = false,
): void {
  const now = Date.now();
  if (!force && now - state.lastDiagAt < 1_000) return;
  const socket = liveStreams.get(profile);
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  state.lastDiagAt = now;
  try {
    socket.send(JSON.stringify({
      type: "frame_transport_diag",
      capturedFrames: state.capturedFrames,
      overwrittenFrames: state.overwrittenFrames,
      sentFrames: state.sentFrames,
      ackedFrames: state.ackedFrames,
      bufferedDrops: state.bufferedDrops,
      ackTimeoutResets: state.ackTimeoutResets,
      inFlight: state.inFlight.size,
      maxInFlight: MAX_LIVE_IN_FLIGHT,
      lastAckMs: state.lastAckMs,
      avgAckMs: Math.round(state.avgAckMs * 10) / 10,
      maxAckMs: state.maxAckMs,
      currentAckTimeoutMs: state.currentAckTimeoutMs,
      socketBufferedAmount: socket.bufferedAmount,
      lastFrameBytes: state.lastFrameBytes,
      sampledAt: now,
    }));
  } catch {}
}

async function ensureLiveSocket(
  profile: string,
): Promise<WebSocket> {
  const existing = liveStreams.get(profile);
  if (existing?.readyState === WebSocket.OPEN) {
    return existing;
  }
  if (existing?.readyState === WebSocket.CONNECTING) {
    await waitForSocketOpen(existing);
    return existing;
  }

  if (existing) {
    try { existing.terminate(); } catch {}
    liveStreams.delete(profile);
  }

  const url = new URL(cloudUrl + "/v1/worker/live-ws");
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("profile", profile);

  const socket = new WebSocket(url, {
    headers: workerHeaders(),
    perMessageDeflate: false,
    handshakeTimeout: 8_000,
    family: 4,
    agent: proxyAgentFor(url),
  });
  noteSocketCredential(socket);
  keepSocketAlive(socket);
  liveStreams.set(profile, socket);

  // Realtime pointer/control stays on the separate control websocket.
  // This upload websocket receives only tiny frame-receipt ACKs so the worker
  // can bound media backlog without coupling user controls to frame traffic.
  socket.on("message", (data, isBinary) => {
    if (isBinary) return;
    const text = Buffer.isBuffer(data)
      ? data.toString("utf8")
      : Array.isArray(data)
        ? Buffer.concat(data).toString("utf8")
        : String(data);
    if (text.length > 4_000) return;
    try {
      const message = JSON.parse(text);
      if (
        message &&
        message.type === "frame_received" &&
        Number.isInteger(message.sequence) &&
        Number.isSafeInteger(message.capturedAt)
      ) {
        noteLiveFrameReceived(
          profile,
          message.sequence,
          message.capturedAt,
        );
      }
    } catch {}
  });

  const cleanup = () => {
    if (liveStreams.get(profile) === socket) {
      liveStreams.delete(profile);
    }
    const state = liveUploadState.get(profile);
    if (state) {
      state.inFlight.clear();
      if (state.latest && !state.busy && !stopping) {
        void pumpLiveFrames(profile, state);
      }
    }
  };
  socket.once("close", cleanup);
  socket.once("error", cleanup);

  await waitForSocketOpen(socket);
  return socket;
}

async function ensureControlSocket(
  profile: string,
): Promise<WebSocket> {
  const existing = controlStreams.get(profile);
  if (existing?.readyState === WebSocket.OPEN) return existing;
  if (existing?.readyState === WebSocket.CONNECTING) {
    await waitForSocketOpen(existing);
    return existing;
  }

  if (existing) {
    try { existing.terminate(); } catch {}
    controlStreams.delete(profile);
  }

  const url = new URL(cloudUrl + "/v1/worker/control-ws");
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("profile", profile);

  const socket = new WebSocket(url, {
    headers: workerHeaders(),
    perMessageDeflate: false,
    handshakeTimeout: 8_000,
    family: 4,
    agent: proxyAgentFor(url),
  });
  noteSocketCredential(socket);
  keepSocketAlive(socket);
  controlStreams.set(profile, socket);

  socket.on("message", (data, isBinary) => {
    if (isBinary) return;
    const text = Buffer.isBuffer(data)
      ? data.toString("utf8")
      : Array.isArray(data)
        ? Buffer.concat(data).toString("utf8")
        : String(data);
    if (text.length > 16_000) return;

    let message: any;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (!message || typeof message !== "object") return;

    if (
      message.type === "live_restart" &&
      typeof message.id === "string"
    ) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: "worker_command_ack",
          id: message.id,
          ok: true,
        }));
      }

      const previous = liveControlChains.get(profile) ?? Promise.resolve();
      const next = previous
        .catch(() => {})
        .then(async () => {
          try {
            await service.stopLiveScreencast(profile).catch(() => {});
            if (!liveStarted.has(profile)) {
              throw new Error("Live view is no longer active");
            }
            await startLiveCapture(profile);
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({
                type: "worker_command_result",
                id: message.id,
                ok: true,
              }));
            }
          } catch (error) {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({
                type: "worker_command_result",
                id: message.id,
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              }));
            }
          }
        })
        .finally(() => {
          if (liveControlChains.get(profile) === next) {
            liveControlChains.delete(profile);
          }
        });
      liveControlChains.set(profile, next);
      return;
    }

    if (hostedCommands && typeof message.id === "string") {
      const reply = (payload: Record<string, unknown>) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "worker_command_result", id: message.id, ...payload }));
        }
      };
      const fail = (error: unknown) =>
        reply({ ok: false, error: error instanceof Error ? error.message : String(error) });
      if (message.type === "live_start") {
        void ensureLive(profile).then(() => reply({ ok: true }), fail);
        return;
      }
      if (message.type === "live_stop") {
        void stopLive(profile).then(() => reply({ ok: true }), fail);
        return;
      }
      if (message.type === "audio_start") {
        if (externalLogins.has(profile)) {
          reply({ ok: false, error: "local login in progress" });
          return;
        }
        void ensureAudio(profile).then(() => reply({ ok: true }), fail);
        return;
      }
      if (message.type === "audio_stop") {
        void stopAudio(profile).then(() => reply({ ok: true }), fail);
        return;
      }
      // Watch Together: the same media commands the personal relay sends, by name.
      if (message.type === "media" && HOSTED_MEDIA_ACTIONS.has(message.action)) {
        if (externalLogins.has(profile) && message.action !== "human_media_stop") {
          reply({ ok: false, error: "local login in progress" });
          return;
        }
        const args = message.args && typeof message.args === "object" && !Array.isArray(message.args) ? message.args : {};
        void execute({ op: "human", action: message.action, args: { ...args, profile } })
          .then((result) => reply({ ok: result?.ok === true, result: result?.result, error: result?.error }), fail);
        return;
      }
      if (message.type === "pointer" && externalLogins.has(profile)) {
        reply({ ok: false, error: "The local login window is still open. Finish signing in before reconnecting." });
        return;
      }
      if (message.type === "app_command") {
        void runHostedAppCommand(profile, message.action, message.args)
          .then((result) => reply({ ok: true, result }), fail);
        return;
      }
    }

    if (
      message.type !== "pointer" ||
      typeof message.id !== "string" ||
      !["down", "move", "up"].includes(message.phase) ||
      typeof message.x !== "number" ||
      typeof message.y !== "number" ||
      (message.button !== undefined &&
        message.button !== "left" &&
        message.button !== "right") ||
      (message.clickCount !== undefined &&
        typeof message.clickCount !== "number")
    ) {
      return;
    }
    const button: "left" | "right" =
      message.button === "right" ? "right" : "left";
    const clickCount = Math.max(
      1,
      Math.min(2, Math.round(Number(message.clickCount ?? 1))),
    );

    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: "worker_command_ack",
        id: message.id,
        ok: true,
      }));
    }

    const previous = liveControlChains.get(profile) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(async () => {
        try {
          await service.humanPointerRealtime(
            profile,
            message.phase,
            message.x,
            message.y,
            "app-ws",
            button,
            clickCount,
          );
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
              type: "worker_command_result",
              id: message.id,
              ok: true,
            }));
          }
        } catch (error) {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
              type: "worker_command_result",
              id: message.id,
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }));
          }
        }
      })
      .finally(() => {
        if (liveControlChains.get(profile) === next) {
          liveControlChains.delete(profile);
        }
      });
    liveControlChains.set(profile, next);
  });

  const cleanup = () => {
    if (controlStreams.get(profile) === socket) {
      controlStreams.delete(profile);
    }
    if ((!liveStarted.has(profile) && !hostedCommands) || stopping) return;
    if (controlReconnectTimers.has(profile)) return;
    const timer = setTimeout(() => {
      controlReconnectTimers.delete(profile);
      void ensureControlSocket(profile).catch((error) => {
        console.error(
          "live control websocket reconnect:",
          error instanceof Error ? error.message : String(error),
        );
      });
    }, 500);
    timer.unref?.();
    controlReconnectTimers.set(profile, timer);
  };
  socket.once("close", cleanup);
  socket.once("error", cleanup);

  await waitForSocketOpen(socket);
  return socket;
}

/**
 * The TongPing card's own buttons (navigate, history, reload, typing, keys,
 * takeover) for a hosted route. A fixed list: anything else is refused.
 */
async function runHostedAppCommand(
  profile: string,
  action: unknown,
  rawArgs: unknown,
): Promise<unknown> {
  const args =
    rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
      ? (rawArgs as Record<string, unknown>)
      : {};
  // While a local login window owns the profile, only status and the
  // login hand-back may touch it (anything else would relaunch the browser).
  if (
    externalLogins.has(profile) &&
    action !== "status" &&
    action !== "external_login_start" &&
    action !== "external_login_finish"
  ) {
    throw new Error("The local login window is still open. Finish signing in on the computer and close that window, then click “Signed in, reconnect.”");
  }
  const unwrap = (reply: { ok: boolean; result?: unknown; error?: string }) => {
    if (!reply.ok) throw new Error(reply.error ?? "Browser action failed");
    return reply.result;
  };
  // Navigation is a model-path action, so drop human takeover around it and
  // restore it afterwards, as the personal card does.
  const withoutTakeover = async (run: () => Promise<{ ok: boolean; result?: unknown; error?: string }>) => {
    const status = unwrap(await gateway.human("human_status", { profile }, "app-ws")) as { takeover?: { active?: unknown } } | undefined;
    const hadTakeover = status?.takeover?.active === true;
    if (hadTakeover) unwrap(await gateway.human("human_takeover_end", { profile }, "app-ws"));
    try {
      return unwrap(await run());
    } finally {
      if (hadTakeover) await gateway.human("human_takeover_start", { profile }, "app-ws").catch(() => undefined);
    }
  };
  switch (action) {
    case "status": {
      const status = unwrap(await gateway.human("human_status", { profile }, "app-ws"));
      return { ...(status as Record<string, unknown>), externalLogin: externalLoginStatus(profile) };
    }
    case "external_login_start":
      return startExternalLogin(profile, typeof args.url === "string" ? args.url : "");
    case "external_login_finish":
      return finishExternalLogin(profile);
    case "navigate":
      if (typeof args.url !== "string") throw new Error("url is required");
      return withoutTakeover(() => gateway.call("browser_open", { profile, url: args.url }, "app-ws"));
    case "history":
      return withoutTakeover(() => gateway.call(args.direction === "forward" ? "browser_forward" : "browser_back", { profile }, "app-ws"));
    case "reload":
      return withoutTakeover(() => gateway.call("browser_reload", { profile }, "app-ws"));
    case "type":
      if (typeof args.text !== "string") throw new Error("text is required");
      return unwrap(await gateway.human("human_type", { profile, text: args.text }, "app-ws"));
    case "key":
      if (typeof args.key !== "string") throw new Error("key is required");
      return unwrap(await gateway.human("human_key", { profile, key: args.key }, "app-ws"));
    case "takeover":
      return unwrap(await gateway.human(args.takeover === true ? "human_takeover_start" : "human_takeover_end", { profile }, "app-ws"));
    case "media_context":
      return unwrap(await gateway.call("browser_media_context", { profile, lookbackSeconds: 600, maxCues: 300 }, "app-ws"));
    case "context_info":
      return unwrap(await gateway.human("human_context_info", { profile, x: args.x, y: args.y }, "app-ws"));
    default:
      throw new Error("This TongPing card action is not available on hosted devices yet.");
  }
}

/** Download browser_set_files URLs into the small-file payloads BrowserService takes. */
async function downloadUploadFiles(raw: unknown): Promise<Array<{ name: string; mimeType: string; base64: string }>> {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > UPLOAD_MAX_FILES) throw new Error("files must list 1-4 files");
  const files: Array<{ name: string; mimeType: string; base64: string }> = [];
  for (const item of raw) {
    const url = item && typeof item === "object" ? (item as Record<string, unknown>).url : undefined;
    if (!isUploadUrl(url)) throw new Error("file url must be a public http(s) URL");
    const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
    // A redirect must not land on a private or local address either.
    if (!isUploadUrl(response.url)) throw new Error("file url redirected to a blocked address");
    if (!response.ok || !response.body) throw new Error("download failed: HTTP " + response.status);
    const parts: Buffer[] = [];
    let size = 0;
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > UPLOAD_MAX_BYTES) throw new Error("file is larger than 4 MB");
      parts.push(Buffer.from(chunk));
    }
    if (size < 1) throw new Error("file is empty");
    const type = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    const mimeType = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(type) ? type : "application/octet-stream";
    const given = (item as Record<string, unknown>).name;
    const fromPath = decodeURIComponent(new URL(response.url).pathname.split("/").pop() ?? "").replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 120);
    const name = typeof given === "string" && UPLOAD_NAME.test(given) ? given : UPLOAD_NAME.test(fromPath) ? fromPath : "file";
    files.push({ name, mimeType, base64: Buffer.concat(parts).toString("base64") });
  }
  return files;
}

async function waitForSocketOpen(
  socket: WebSocket,
): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) return;
  if (socket.readyState !== WebSocket.CONNECTING) {
    throw new Error("live websocket is not connectable");
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const settleResolve = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const settleReject = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const timer = setTimeout(() => {
      try { socket.terminate(); } catch {}
      settleReject(new Error("live websocket open timeout after 8000ms"));
    }, 8_000);

    const cleanup = () => {
      clearTimeout(timer);
      socket.off("open", onOpen);
      socket.off("error", onError);
      socket.off("close", onClose);
      socket.off("unexpected-response", onUnexpectedResponse);
    };
    const onOpen = () => {
      settleResolve();
    };
    const onError = (error: Error) => {
      settleReject(new Error("live websocket error: " + error.message));
    };
    const onClose = (code: number, reason: Buffer) => {
      settleReject(
        new Error(
          "live websocket closed before open: " +
          code +
          (reason?.length ? " " + reason.toString("utf8").slice(0, 160) : ""),
        ),
      );
    };
    const onUnexpectedResponse = (_request: unknown, response: any) => {
      try { socket.terminate(); } catch {}
      if (response?.statusCode === 401 || response?.statusCode === 403) {
        renewTrustedSession("rejected", false, socketCredential.get(socket));
      }
      settleReject(
        new Error(
          "live websocket unexpected HTTP response: " +
          String(response?.statusCode ?? "unknown"),
        ),
      );
    };

    socket.once("open", onOpen);
    socket.once("error", onError);
    socket.once("close", onClose);
    socket.once("unexpected-response", onUnexpectedResponse);

    // The socket can transition CONNECTING -> OPEN in the tiny gap between
    // the pre-check above and listener registration. Re-check after handlers
    // are installed so a fast local/TLS handshake cannot lose the open event.
    if (socket.readyState === WebSocket.OPEN) {
      settleResolve();
    } else if (
      socket.readyState === WebSocket.CLOSING ||
      socket.readyState === WebSocket.CLOSED
    ) {
      settleReject(new Error("live websocket closed during open handshake"));
    }
  });
}

async function poll(): Promise<
  { readonly command: any; readonly receivedAt: number } | null
> {
  const controller = new AbortController();
  activePoll = controller;
  let response: Response;
  let headers: Record<string, string>;
  try {
    headers = workerHeaders();
    response = await fetch(
      cloudUrl + "/v1/worker/poll?name=" + encodeURIComponent(workerName),
      { method: "POST", headers, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]) },
    );
  } finally {
    if (activePoll === controller) activePoll = null;
  }
  rejectTrustedHttp(response, headers);
  if (response.status === 204) return null;
  if (!response.ok) {
    throw new Error("worker poll HTTP " + response.status + ": " + (await response.text()));
  }
  // Capture receipt before consuming the body so a delayed or stalled body
  // cannot refresh an almost-expired hosted command's ttl.
  const receivedAt = Date.now();
  return { command: await response.json(), receivedAt };
}

async function externalizeFrame(command: any, reply: any) {
  if (!reply?.ok || !reply.result || typeof reply.result !== "object") {
    return reply;
  }
  if (command.action !== "browser_screenshot" && command.action !== "human_preview") {
    return reply;
  }
  if (hostedCommands && command.action === "browser_screenshot") {
    // Hosted has no /v1/worker/frame: return the validated base64 inline so the
    // broker can validate the PNG and emit a bounded image content block.
    return reply;
  }
  const base64 = reply.result.base64;
  if (typeof base64 !== "string" || base64.length === 0) return reply;

  const profile = String(command.args?.profile || "default");
  const image = Buffer.from(base64, "base64");
  const viewport = reply.result.viewport && typeof reply.result.viewport === "object"
    ? reply.result.viewport
    : {};
  const uploaded = await uploadFrame(
    profile,
    image,
    Number(viewport.width || 0),
    Number(viewport.height || 0),
  );

  const result = { ...reply.result };
  delete result.base64;
  result.frameUrl = uploaded.frameUrl;
  result.bytes = image.length;
  return { ...reply, result };
}

async function uploadFrame(
  profile: string,
  image: Buffer,
  width: number,
  height: number,
): Promise<{ frameUrl: string }> {
  const url = new URL(cloudUrl + "/v1/worker/frame");
  url.searchParams.set("profile", profile);
  if (Number.isFinite(width) && width > 0) url.searchParams.set("width", String(Math.round(width)));
  if (Number.isFinite(height) && height > 0) url.searchParams.set("height", String(Math.round(height)));
  const payload = image.buffer.slice(
    image.byteOffset,
    image.byteOffset + image.byteLength,
  ) as ArrayBuffer;
  const headers = { ...workerHeaders(), "content-type": "image/png" };
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: payload,
    signal: AbortSignal.timeout(15_000),
  });
  rejectTrustedHttp(response, headers);
  if (!response.ok) {
    throw new Error("worker frame upload HTTP " + response.status + ": " + (await response.text()));
  }
  const body = await response.json() as { frameUrl?: string };
  if (!body.frameUrl) throw new Error("worker frame upload returned no frameUrl");
  return { frameUrl: body.frameUrl };
}

async function postResult(command: any, reply: unknown, routed: boolean) {
  // The hosted/legacy routing decision is made by the consumer loop from the
  // opt-in flag and envelope shape, never from the reply shape alone.
  const id =
    typeof command === "string" ? command : command?.id;
  const body = routed
    ? {
        v: 1,
        id,
        echo: {
          generation: command.route.generation,
          profile_id: command.route.profile_id,
          alias: command.route.alias,
          action: command.action,
          nonce: command.nonce,
        },
        reply,
      }
    : { id, reply };
  const headers = { ...workerHeaders(), "content-type": "application/json" };
  const response = await fetch(
    cloudUrl + "/v1/worker/result",
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    },
  );
  rejectTrustedHttp(response, headers);
  if (!response.ok) {
    throw new Error("worker result HTTP " + response.status + ": " + (await response.text()));
  }
}

function isHostedCommandEnvelope(command: any): boolean {
  return (
    typeof command === "object" &&
    command !== null &&
    command.v === 1 &&
    command.op === "call" &&
    typeof command.route === "object" &&
    command.route !== null
  );
}

function validateHostedCommand(command: any, receivedAt: number = Date.now()): string | null {
  if (!command || typeof command !== "object") return "malformed hosted command";
  if (command.v !== 1 || command.op !== "call") return "unsupported hosted command envelope";
  if (!command.route || command.route.generation !== trustedSession?.sessionId) {
    return "hosted command generation is stale";
  }
  if (
    typeof command.action !== "string" ||
    !(HOSTED_WORKER_ACTIONS as readonly string[]).includes(command.action)
  ) {
    return "hosted command action is not allowed";
  }
  if (
    !command.args ||
    typeof command.args !== "object" ||
    Array.isArray(command.args) ||
    command.args.profile !== command.route.alias
  ) {
    return "hosted command profile alias mismatch";
  }
  if (
    typeof command.ttl_ms !== "number" ||
    !Number.isFinite(command.ttl_ms) ||
    command.ttl_ms <= 0
  ) {
    return "hosted command ttl elapsed";
  }
  // The command must still be inside its ttl window measured from receipt.
  if (Date.now() >= receivedAt + command.ttl_ms) {
    return "hosted command ttl elapsed";
  }
  if (typeof command.id !== "string" || !/^c_[A-Za-z0-9_-]{22}$/.test(command.id)) {
    return "malformed hosted command id";
  }
  if (typeof command.nonce !== "string" || command.nonce.length < 16) {
    return "malformed hosted command nonce";
  }
  return null;
}

async function pairWorker(code: string): Promise<string> {
  const response = await fetch(
    cloudUrl + "/v1/worker/pair",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, name: workerName }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) {
    throw new Error("worker pairing HTTP " + response.status + ": " + (await response.text()));
  }
  const body = await response.json() as { token?: string };
  if (!body.token) throw new Error("Worker pairing response contained no token.");
  return body.token;
}

function workerHeaders(): Record<string, string> {
  const session = trustedSession;
  if (trustedTransport && (!session || Date.now() >= session.expiresAt)) {
    renewTrustedSession(session ? "expired" : "unavailable");
    throw new Error("Trusted Worker session expired or unavailable");
  }
  if (trustedTransport && Date.now() >= session!.expiresAt - SESSION_RENEW_AHEAD_MS) {
    // Swap in a fresh session before this one lapses; keep using it meanwhile.
    renewTrustedSession("expiring soon", true);
  }
  return {
    authorization: "Worker " + (trustedTransport ? session!.sessionCredential : token),
    // Header values must be ByteStrings; a Chinese device name would make
    // every request throw. ASCII names stay byte-identical.
    "x-tongping-worker": /^[ -~]*$/.test(workerName) ? workerName : encodeURIComponent(workerName),
    "x-tongping-worker-build": WORKER_BUILD,
  };
}

async function readOptional(file: string): Promise<string> {
  try {
    return (await fs.readFile(file, "utf8")).trim();
  } catch {
    return "";
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(name + " is required.");
  return value;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

process.once("SIGINT", () => { stopping = true; });
process.once("SIGTERM", () => { stopping = true; });
