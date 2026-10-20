import { McpServer } from "@modelcontextprotocol/server";
import { pickTicketQuote, ticketMoodFromAudio } from "./ticket-quote.js";
import {
  BROWSER_APP_URI,
  browserAppPublicOrigin,
  browserAppUiDomain,
  renderBrowserApp,
} from "./browser-app.js";
import {
  CLAUDE_BROWSER_APP_URI,
  renderClaudeBrowserApp,
} from "./claude-browser-app.js";
import * as z from "zod/v4";
import type { BrowserAction } from "./browser-service.js";
import type { BrowserGateway } from "./gateway.js";
import { BROWSER_WAIT_DEFAULT_MS, BROWSER_WAIT_MAX_MS } from "./action-limits.js";
import { assessCompanionVisualCue } from "./companion-policy.js";
import { MusicCompanionLedger } from "./music-companion-ledger.js";
import type { CompanionFrameSelection } from "./companion-frame-buffer.js";
import {
  mergeIntervals as mergeCompanionCoverageIntervals,
  type CompanionCoverageInterval,
  type CompanionCoverageModality,
  type CompanionMediaSessionIdentity,
  type CompanionPerceptionPacketInput,
  type CompanionPerceptionPacketReceipt,
  type CompanionPerceptionStatus,
} from "./companion-perception-ledger.js";
import { xianyuOpenItem, xianyuSearch } from "./adapters/xianyu.js";
import { appChatLedger } from "./app-chat-ledger.js";
import { transcribeVoiceNote } from "./voice-input.js";
import { canonicalIdentity } from "./identity-alias.js";
import {
  createBrowserAudioUrl,
  createBrowserMediaUrl,
  createBrowserCompanionHlsUrl,
  createBrowserChatUrl,
  createBrowserWatchCollectionUrl,
  createBrowserWatchCollectionWriteUrl,
  createBrowserControlUrl,
  createBrowserFrameUrl,
  createBrowserSingleFrameUrl,
  createBrowserInputUrl,
  createBrowserLiveUrl,
} from "./browser-app-ticket.js";

const BROWSER_APP_MIME_TYPE = "text/html;profile=mcp-app";

function stampBrowserAppBuildOnMediaUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const build =
      BROWSER_APP_URI.match(/-v(\d+)$/)?.[1] ?? "0";
    url.searchParams.set("app_build", build);
    return url.toString();
  } catch {
    return rawUrl;
  }
}

// Shared across MCP server instances: the HTTP handler builds a fresh
// server per request, so per-instance maps lost what the app stored before
// the assistant's next call read it.
const sharedWatchTickets = new Map<string, {
  ticketNo: string;
  imageBase64: string;
  mimeType: string;
  meta: Record<string, unknown>;
  sharedAt: number;
}>();
const SHARED_TICKET_TTL_MS = 30 * 60_000;
const sharedLooks = new Map<string, {
  imageBase64: string;
  mimeType: string;
  meta: Record<string, unknown>;
  sharedAt: number;
}>();

// v90: shared rules every AI host receives on connect (Claude, ChatGPT,
// Codex, anything added later), so group-chat etiquette lives in one place.
export const TONGPING_INSTRUCTIONS = [
  "TongPing is the user's shared remote browser. Its card has a GROUP CHAT shared by the user and several AIs (ChatGPT, Claude and others). Rules for every AI:",
  "1. Identity: always pass your own identity as name.entry — claude.chat (claude.ai), claude.code (Claude Code), claude.cloud, gpt.chat (ChatGPT), gpt.codex, gpt.work (ChatGPT cloud tasks); add -2 if that entry is already in the group. Tool defaults may belong to someone else. Never speak for another AI.",
  "2. When the user talks to you from the card or the group chat, your FIRST action is browser_app_chat_push with your reply; only then repeat it in your own chat. A reply that is not pushed never reaches them.",
  "3. Catch up with browser_app_room_read when they mention the group chat or browser_companion_context shows unread messages.",
  "4. If the topic is what is on screen, look yourself first: browser_screenshot for the current view, browser_look for a frame they shared (messages starting with 👀).",
  "5. If the user muted you, browser_app_chat_push fails: stay silent in the group until they unmute you.",
  "6. Group manners: answer the user; reply to another AI only when you are addressed or genuinely have something to add. Keep it short and conversational. Never trade messages back and forth with another AI.",
  "7. For co-watching use browser_companion_context; it is gated to what the user has actually seen, so never reveal what comes later.",
  "8. When the user turns on their camera (a 📷 group message), you may look at them with browser_camera_look whenever you want to, passing your own identity; they see a note each time you look. A muted AI cannot look.",
  "9. Sliders and login walls on Taobao, Tmall, Xianyu, JD, Bilibili and Google/YouTube cannot be passed inside TongPing. While the user is watching, TongPing opens that page in a normal Chrome window on their computer by itself: tell them to finish there and close the window, and TongPing takes the profile back automatically. Never try to solve a slider or captcha yourself.",
].join("\n");

// “Let Them See You”: the card uploads the user's (effects-rendered) camera frame every
// few seconds while their camera is on. Memory only, latest frame per profile,
// dropped the moment they turns the camera off or the card stops sending.
const CAMERA_FRAME_STALE_MS = 15_000;
const cameraFrames = new Map<string, {
  imageBase64: string;
  mimeType: "image/jpeg" | "image/png";
  capturedAt: number;
  lastLook: { by: string; at: number } | null;
}>();

export function createTongpingMcpServer(
  rawGateway: BrowserGateway,
  version = "0.3.0",
  options: {
    appSigningKey?: Buffer;
    createSharedImage?: (
      buffer: Buffer,
      mimeType: "image/png" | "image/jpeg",
    ) => { id: string; ticket: string } | Promise<{ id: string; ticket: string }>;
    liveEnabled?: boolean;
    externalLoginEnabled?: boolean;
    claudeHost?: boolean;
    getWorkerBuild?: () => string;
    getCompanionFrame?: (
      profile: string,
      lookbackSeconds: number,
    ) =>
      | CompanionFrameSelection
      | null
      | Promise<CompanionFrameSelection | null>;
    companionFrameSource?: "companion-buffer" | "companion-hls-buffer";
    getCompanionFrameStatus?: (
      profile: string,
    ) => unknown | Promise<unknown>;
    getViewerProfile?: () => string | null;
    getCompanionPlaybackStatus?: (
      profile: string,
    ) => {
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
    } | null;
    getCompanionAudioVision?: (
      profile: string,
      seconds: number,
    ) => unknown | Promise<unknown>;
    seekCompanionSource?: (
      profile: string,
      targetSeconds: number,
    ) => unknown | Promise<unknown>;
    getPresentationStatus?: (
      profile: string,
    ) => {
      profile: string;
      viewerCount: number;
      ambiguousViewer: boolean;
      lastPresented: null | {
        sequence: number;
        capturedAt: number;
        frameReceivedAt: number;
        ackReceivedAt: number;
        clientPresentedAt: number | null;
        presentationSemantics: string;
        media: import("./live-ws-hub.js").LiveFrameMediaMeta | null;
        ackSemantics: string;
        physicalDisplayConfirmed: boolean;
      };
    };
    issuePerceptionPacket?: (
      input: CompanionPerceptionPacketInput,
    ) => CompanionPerceptionPacketReceipt;
    commitPerceptionPacket?: (
      packetId: string,
      options?: {
        modalities?: CompanionCoverageModality[];
        attemptId?: string | null;
      },
    ) => CompanionPerceptionPacketReceipt | null;
    failPerceptionPacket?: (
      packetId: string,
      reason: string,
    ) => CompanionPerceptionPacketReceipt | null;
    getPerceptionStatus?: (
      profile: string,
    ) => CompanionPerceptionStatus;
  } = {},
): McpServer {
  // Read-only tools must never launch a profile just to read it (that opened
  // blank Chrome windows whenever a model omitted profile and got
  // "default"). An inactive profile falls back to the one the user's card
  // is watching, and the reply says so; otherwise the call is refused.
  const READ_ONLY_ACTIONS = new Set<string>([
    "browser_media_context",
    "browser_audio_vision",
    "browser_snapshot",
    "browser_read",
    "browser_screenshot",
  ]);
  const gateway: BrowserGateway = {
    human: (action, args, clientOverride) =>
      rawGateway.human(action, args, clientOverride),
    call: async (action, args, clientOverride) => {
      if (!READ_ONLY_ACTIONS.has(action)) {
        return rawGateway.call(action, args, clientOverride);
      }
      const requested =
        typeof args?.profile === "string" && args.profile ? args.profile : "default";
      const listing = await rawGateway
        .call("browser_profiles", {}, clientOverride)
        .catch(() => null);
      const rows =
        listing?.ok && Array.isArray(listing.result)
          ? listing.result as Array<{ profile?: string; active?: boolean }>
          : null;
      if (!rows || rows.some((row) => row.profile === requested && row.active)) {
        return rawGateway.call(action, { ...args, profile: requested }, clientOverride);
      }
      const viewer = options.getViewerProfile?.() ?? null;
      if (viewer && rows.some((row) => row.profile === viewer && row.active)) {
        const reply = await rawGateway.call(action, { ...args, profile: viewer }, clientOverride);
        if (reply.ok && reply.result && typeof reply.result === "object" && !Array.isArray(reply.result)) {
          (reply.result as Record<string, unknown>).profileRedirect = {
            requested,
            used: viewer,
            reason: "The requested profile has no open browser; used the one the user is watching.",
          };
        }
        return reply;
      }
      return {
        ok: false,
        error:
          "Profile " + requested +
          " has no open browser window. Open a page there with browser_open first, or pass the profile the user is watching.",
      };
    },
  };
  const musicCompanionLedger = new MusicCompanionLedger();
  const server = new McpServer(
    {
      name: "tongping",
      version,
    },
    { instructions: TONGPING_INSTRUCTIONS },
  );
  const appOrigin = browserAppPublicOrigin();
  const appDomain = browserAppUiDomain();

  // v90: one McpServer is built per MCP session. Claude refuses ext-apps
  // cards whose ui meta carries `domain` or openai/* keys (see the Claude
  // host contract note by claudeUiMeta), while ChatGPT needs them.
  // Strip them for this session only, once the client says it is Claude.
  const browserAppToolMeta: Record<string, unknown> = {
    "ui/resourceUri": BROWSER_APP_URI,
    "openai/outputTemplate": BROWSER_APP_URI,
    ui: {
      resourceUri: BROWSER_APP_URI,
      visibility: ["model", "app"],
    },
  };
  // The HTTP handler builds a fresh server per request, so the host is
  // decided by the daemon from the request's OAuth client (options.claudeHost).
  const claudeHostSession = options.claudeHost === true;
  function isClaudeHostSession(): boolean {
    return claudeHostSession;
  }
  if (claudeHostSession) {
    delete browserAppToolMeta["openai/outputTemplate"];
  }
  const lastVisualInspectionAt = new Map<string, number>();
  const appWsOrigin = appOrigin
    .replace(/^https:/, "wss:")
    .replace(/^http:/, "ws:");

  function textResult(value: unknown) {
    return {
      content: [
        {
          type: "text" as const,
          text:
            typeof value === "string"
              ? value
              : JSON.stringify(value, null, 2),
        },
      ],
    };
  }

  function errorResult(message: string) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: message }],
    };
  }

  async function call(
    action: BrowserAction,
    args: Record<string, unknown>,
  ) {
    const reply = await gateway.call(action, args);
    if (!reply.ok) {
      return errorResult(reply.error ?? "Browser action failed");
    }
    return textResult(reply.result);
  }


  const registerBrowserAppTool = (
    name: string,
    config: Record<string, unknown>,
    handler: (args: any) => any,
  ) => (server.registerTool as any)(name, config, handler);

  const registerBrowserAppResource = (
    name: string,
    uri: string,
    config: Record<string, unknown>,
    handler: (...args: any[]) => any,
  ) => (server.registerResource as any)(name, uri, config, handler);

  // v90: cards opened from claude.ai act and are labelled as Claude unless
  // the caller names another identity.
  const defaultIdentity = claudeHostSession ? "claude.chat" : "gpt.chat";
  const identitySchema = z
    .string()
    .regex(/^[a-z0-9._-]{1,40}$/)
    .default(defaultIdentity);
  const profileSchema = z
    .string()
    .regex(/^[a-zA-Z0-9._-]{1,64}$/)
    .default("default");

  function appToolResult(
    value: Record<string, unknown>,
    message = "TongPing app state updated.",
  ) {
    return {
      content: [{ type: "text" as const, text: message }],
      structuredContent: value,
      _meta: {
        "ui/resourceUri": BROWSER_APP_URI,
        ...(isClaudeHostSession()
          ? {}
          : { "openai/outputTemplate": BROWSER_APP_URI }),
        ui: { resourceUri: BROWSER_APP_URI },
      },
    };
  }

  function appError(message: string) {
    return {
      isError: true as const,
      content: [{ type: "text" as const, text: message }],
    };
  }

  async function browserAppState(
    identity: string,
    profile: string,
    withFrame: boolean,
  ): Promise<Record<string, unknown>> {
    const statusReply = await gateway.human(
      "human_status",
      { profile },
      identity,
    );
    if (!statusReply.ok) {
      throw new Error(statusReply.error ?? "Browser status failed");
    }

    const status = asRecord(statusReply.result);
    const browser = asRecord(status.browser);
    const takeover = asRecord(status.takeover);
    const externalLogin = asRecord(status.externalLogin);
    const externalLoginActive = externalLogin.active === true;
    const state: Record<string, unknown> = {
      kind: "tongping",
      version: "0.4.0-wip",
      appUiBuild: BROWSER_APP_URI.split("-").at(-1) ?? "",
      workerBuild: options.getWorkerBuild?.() ?? "",
      identity,
      profile,
      title: "",
      url:
        externalLoginActive && typeof externalLogin.url === "string"
          ? externalLogin.url
          : typeof browser.url === "string"
            ? browser.url
            : "",
      takeover: takeover.active === true,
      takeoverOwner:
        typeof takeover.owner === "string" ? takeover.owner : "",
      externalLoginEnabled: options.externalLoginEnabled === true,
      externalLogin: {
        active: externalLoginActive,
        supported: externalLogin.supported !== false,
        processRunning: externalLogin.processRunning === true,
        readyToResume: externalLogin.readyToResume === true,
        browser:
          typeof externalLogin.browser === "string"
            ? externalLogin.browser
            : "",
        startedAt:
          typeof externalLogin.startedAt === "string"
            ? externalLogin.startedAt
            : "",
      },
      appUrl:
        appOrigin + "/live?profile=" + encodeURIComponent(profile),
    };

    let liveReady = false;
    if (options.appSigningKey) {
      state.frameUrl = createBrowserFrameUrl(
        appOrigin,
        options.appSigningKey,
        profile,
        180,
      );
      state.controlUrl = createBrowserControlUrl(
        appOrigin,
        options.appSigningKey,
        profile,
        identity,
        180,
      );
      state.inputUrl =
        state.takeover === true
          ? createBrowserInputUrl(
              appOrigin,
              options.appSigningKey,
              profile,
              identity,
              180,
            )
          : "";
      if (options.liveEnabled) {
        liveReady = true;
        state.liveUrl = createBrowserLiveUrl(
          appOrigin,
          options.appSigningKey,
          profile,
          3600,
        );
        state.audioUrl = createBrowserAudioUrl(
          appOrigin,
          options.appSigningKey,
          profile,
          3600,
        );
        state.mediaUrl = stampBrowserAppBuildOnMediaUrl(
          createBrowserMediaUrl(
            appOrigin,
            options.appSigningKey,
            profile,
            3600,
          ),
        );
        state.companionHlsUrl = createBrowserCompanionHlsUrl(
          appOrigin,
          options.appSigningKey,
          profile,
          3600,
          30,
        );
        state.chatUrl = createBrowserChatUrl(
          appOrigin,
          options.appSigningKey,
          profile,
          3600,
        );
        state.watchCollectionUrl = createBrowserWatchCollectionUrl(
          appOrigin,
          options.appSigningKey,
          profile,
          3600,
        );
        state.watchCollectionWriteUrl = createBrowserWatchCollectionWriteUrl(
          appOrigin,
          options.appSigningKey,
          profile,
          3600,
        );
      }
    }

    if (!withFrame || liveReady) {
      return state;
    }

    const previewReply = await gateway.human(
      "human_preview",
      { profile },
      identity,
    );
    if (!previewReply.ok) {
      throw new Error(previewReply.error ?? "Browser preview failed");
    }
    const preview = asRecord(previewReply.result);
    state.title =
      typeof preview.title === "string" ? preview.title : "";
    if (typeof preview.url === "string") state.url = preview.url;
    state.viewport = asRecord(preview.viewport);
    state.mimeType =
      typeof preview.mimeType === "string"
        ? preview.mimeType
        : "image/png";
    if (!options.appSigningKey) {
      state.base64 =
        typeof preview.base64 === "string" ? preview.base64 : "";
    }
    return state;
  }

  function browserAppStateFromExternalLoginFinish(
    identity: string,
    profile: string,
    value: unknown,
  ): Record<string, unknown> {
    const resumed = asRecord(value);
    const browser = asRecord(resumed.browser);
    const state: Record<string, unknown> = {
      kind: "tongping",
      version: "0.4.0-wip",
      identity,
      profile,
      title: typeof browser.title === "string" ? browser.title : "",
      url:
        typeof browser.url === "string"
          ? browser.url
          : typeof resumed.url === "string"
            ? resumed.url
            : "",
      takeover: false,
      takeoverOwner: "",
      externalLoginEnabled: options.externalLoginEnabled === true,
      externalLogin: {
        active: false,
        supported: true,
        processRunning: false,
        readyToResume: false,
        browser: "",
        startedAt: "",
      },
      appUrl:
        appOrigin + "/live?profile=" + encodeURIComponent(profile),
    };

    if (browser.viewport && typeof browser.viewport === "object") {
      state.viewport = browser.viewport;
    }

    if (options.appSigningKey) {
      state.frameUrl = createBrowserFrameUrl(
        appOrigin,
        options.appSigningKey,
        profile,
        180,
      );
      state.controlUrl = createBrowserControlUrl(
        appOrigin,
        options.appSigningKey,
        profile,
        identity,
        180,
      );
      state.inputUrl = "";
      if (options.liveEnabled) {
        state.liveUrl = createBrowserLiveUrl(
          appOrigin,
          options.appSigningKey,
          profile,
          3600,
        );
        state.audioUrl = createBrowserAudioUrl(
          appOrigin,
          options.appSigningKey,
          profile,
          3600,
        );
        state.mediaUrl = stampBrowserAppBuildOnMediaUrl(
          createBrowserMediaUrl(
            appOrigin,
            options.appSigningKey,
            profile,
            3600,
          ),
        );
        state.companionHlsUrl = createBrowserCompanionHlsUrl(
          appOrigin,
          options.appSigningKey,
          profile,
          3600,
          30,
        );
        state.chatUrl = createBrowserChatUrl(
          appOrigin,
          options.appSigningKey,
          profile,
          3600,
        );
        state.watchCollectionUrl = createBrowserWatchCollectionUrl(
          appOrigin,
          options.appSigningKey,
          profile,
          3600,
        );
        state.watchCollectionWriteUrl = createBrowserWatchCollectionWriteUrl(
          appOrigin,
          options.appSigningKey,
          profile,
          3600,
        );
      }
    }

    return state;
  }

  server.registerTool(
    "browser_app_chat_push",
    {
      title: "TongPing · Mirror Reply",
      description:
        "Post your reply into the TongPing group chat (shared by the user and the other AIs such as ChatGPT and Claude). Call it when the model context says the message came from the in-app chat relay, or when the user asks you to say something in the group chat. Pass your own visible reply text; never speak for another AI. Fails if the user has muted you.",
      inputSchema: z.object({
        identity: identitySchema.default(defaultIdentity),
        profile: profileSchema,
        text: z.string().min(1).max(16000),
      }),
    },
    async ({ identity, profile, text }) => {
      try {
        const message = appChatLedger.push({
          identity,
          profile,
          role: "assistant",
          text,
        });
        return textResult({
          ok: true,
          mirrored: true,
          seq: message.seq,
          profile,
          identity,
        });
      } catch (error) {
        return errorResult(errorMessage(error));
      }
    },
  );

  // v90 group chat: catch up on what the user and the other AIs said.
  server.registerTool(
    "browser_app_room_read",
    {
      title: "TongPing · Group Chat",
      description:
        "Read the TongPing group chat you have not seen yet (messages from the user and the other AIs since your last read or post). Use it when the user mentions the group chat or when browser_companion_context reports unread group messages, then answer with browser_app_chat_push. Before replying to something about the screen, look yourself: browser_screenshot for the current view, browser_look for a frame they shared (👀). Also tells you whether the user has muted you.",
      inputSchema: z.object({
        identity: identitySchema.default(defaultIdentity),
        limit: z.number().int().min(1).max(100).default(40),
      }),
    },
    async ({ identity, limit }) => {
      try {
        const result = appChatLedger.unread(identity, limit);
        return textResult({
          identity,
          youAreMuted: result.muted.includes(identity),
          muted: result.muted,
          lookHint:
            "If a message is about what is on screen, call browser_screenshot yourself; a 👀 message means the user shared a frame you can fetch with browser_look.",
          unread: result.messages.map((item) => ({
            seq: item.seq,
            from: item.role === "user" ? "user" : item.identity,
            text: item.text,
            at: item.createdAt,
          })),
          latestSeq: result.latestSeq,
        });
      } catch (error) {
        return errorResult(errorMessage(error));
      }
    },
  );

  function groupChatPeek(identity: string) {
    try {
      const pending = appChatLedger.peekUnread(identity);
      return {
        unreadCount: pending.length,
        youAreMuted: appChatLedger.isMuted(identity),
        recent: pending.slice(-5).map((item) => ({
          from: item.role === "user" ? "user" : item.identity,
          text: item.text.slice(0, 300),
        })),
        hint:
          pending.length > 0
            ? "Unread group chat. Call browser_app_room_read to catch up (marks read); if it is about the screen, look yourself with browser_screenshot (or browser_look for a 👀 shared frame); then reply with browser_app_chat_push if you have something to say."
            : undefined,
      };
    } catch {
      return undefined;
    }
  }

  const appOnly = {
    ui: {
      visibility: ["app"] as ("app" | "model")[],
    },
  };

  // ----- Watch memory ticket: real-session context + AI hand-off -----

  registerBrowserAppTool(
    "browser_app_ticket_context",
    {
      title: "TongPing · Ticket Context",
      description:
        "App-only: real watch-session context for the memory ticket (title, one already-played short subtitle, compact audio mood). Never returns future subtitles.",
      inputSchema: z.object({
        identity: identitySchema,
        profile: profileSchema,
      }),
      _meta: appOnly,
    },
    async ({ profile }) => {
      try {
        const mediaReply = await gateway.call("browser_media_context", {
          profile,
          lookbackSeconds: 600,
          maxCues: 300,
        });
        const raw = mediaReply.ok ? (mediaReply.result as any) : null;
        const playback = options.getCompanionPlaybackStatus?.(profile) ?? null;
        const companionFresh =
          playback !== null &&
          playback.sourcePts !== null &&
          Date.now() - playback.receivedAt <= 5_000;
        // Companion: what the user has actually been shown (delayed clock).
        // Live: the page is what they see, so its own clock is the boundary.
        const cutoff: number | null = companionFresh
          ? playback!.sourcePts
          : typeof raw?.media?.currentTime === "number"
            ? raw.media.currentTime
            : null;
        const quote = pickTicketQuote(raw?.subtitles, cutoff);
        let mood: string | null = null;
        if (companionFresh && options.getCompanionAudioVision) {
          const audio = await Promise.resolve(
            options.getCompanionAudioVision(profile, 10),
          ).catch(() => null) as any;
          mood = ticketMoodFromAudio(audio?.summary ?? audio?.readout?.summary ?? null);
        }
        return appToolResult({
          profile,
          url: typeof raw?.url === "string" ? raw.url : "",
          pageTitle: typeof raw?.title === "string" ? raw.title : "",
          quote,
          mood,
          durationSeconds:
            typeof raw?.media?.duration === "number" && Number.isFinite(raw.media.duration)
              ? raw.media.duration
              : null,
          cutoffMediaTime: cutoff,
          futureCuesReturned: false,
          clock: companionFresh ? "companion-buffer" : "live-page",
        });
      } catch (error) {
        return appError(errorMessage(error));
      }
    },
  );

  // Hold-to-talk: the card records a short voice note, we transcribe it and
  // hand the text back to the composer. Nothing is sent to the chat here.
  registerBrowserAppTool(
    "browser_app_voice_transcribe",
    {
      title: "TongPing · Voice Note",
      description:
        "App-only: transcribe a short hold-to-talk voice note (SenseVoice) into text plus a non-neutral emotion label.",
      inputSchema: z.object({
        identity: identitySchema,
        profile: profileSchema,
        audioBase64: z.string().min(16).max(2_100_000),
        mimeType: z.string().max(80).default("audio/mp4"),
      }),
      _meta: appOnly,
    },
    async ({ audioBase64, mimeType }) => {
      try {
        const result = await transcribeVoiceNote(
          Buffer.from(audioBase64, "base64"),
          mimeType,
        );
        return appToolResult({ kind: "tongping-voice-note", ...result });
      } catch (error) {
        return appError(errorMessage(error));
      }
    },
  );

  registerBrowserAppTool(
    "browser_app_ticket_share",
    {
      title: "TongPing · Share Ticket With AI",
      description:
        "App-only: hand the finished memory ticket image to the assistant, who reads it back with browser_watch_ticket.",
      inputSchema: z.object({
        identity: identitySchema,
        profile: profileSchema,
        ticketNo: z.string().min(1).max(40),
        imageBase64: z.string().min(16).max(3_000_000),
        mimeType: z.enum(["image/jpeg", "image/png"]).default("image/jpeg"),
        title: z.string().max(200).default(""),
        platform: z.string().max(40).default(""),
        watchedAt: z.string().max(40).default(""),
        quote: z.string().max(80).default(""),
        mood: z.string().max(60).default(""),
      }),
      _meta: appOnly,
    },
    async ({ profile, ticketNo, imageBase64, mimeType, title, platform, watchedAt, quote, mood }) => {
      sharedWatchTickets.set(profile, {
        ticketNo,
        imageBase64,
        mimeType,
        meta: { title, platform, watchedAt, quote, mood },
        sharedAt: Date.now(),
      });
      return appToolResult({ ok: true, profile, ticketNo });
    },
  );

  // “Show Everyone”: hosts drop images the app sends; park the exact frame and let
  // the assistant fetch it with browser_look (tool results reach the model).

  registerBrowserAppTool(
    "browser_app_look_share",
    {
      title: "TongPing · Share Look",
      description: "App-only: store the frame the user pointed at with “Show Everyone”.",
      inputSchema: z.object({
        identity: identitySchema,
        profile: profileSchema,
        imageBase64: z.string().min(16).max(3_000_000),
        mimeType: z.enum(["image/jpeg", "image/png"]).default("image/jpeg"),
        url: z.string().max(2000).default(""),
        mode: z.string().max(20).default(""),
      }),
      _meta: appOnly,
    },
    async ({ profile, imageBase64, mimeType, url, mode }) => {
      sharedLooks.set(profile, {
        imageBase64,
        mimeType,
        meta: { url, mode },
        sharedAt: Date.now(),
      });
      return appToolResult({ ok: true, profile });
    },
  );

  server.registerTool(
    "browser_look",
    {
      title: "TongPing · What the User Pointed At",
      description:
        "See the exact frame the user just shared with the TongPing “Show Everyone” button (any AI can fetch it, not only the card's). Call this when a system message or a group chat 👀 message says they shared a frame, then respond to what is in the image.",
      inputSchema: z.object({
        profile: z.string().default(""),
      }),
    },
    async ({ profile: requested }) => {
      const profile = requested || options.getViewerProfile?.() || "default";
      const shared =
        sharedLooks.get(profile) ??
        [...sharedLooks.values()].sort((a, b) => b.sharedAt - a.sharedAt)[0];
      if (!shared || Date.now() - shared.sharedAt > 10 * 60_000) {
        return textResult({
          available: false,
          note: "No “Show Everyone” frame in the last 10 minutes. Ask the user to press it again.",
        });
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              available: true,
              sharedAt: new Date(shared.sharedAt).toISOString(),
              ...shared.meta,
            }),
          },
          { type: "image" as const, data: shared.imageBase64, mimeType: shared.mimeType },
        ],
      };
    },
  );

  registerBrowserAppTool(
    "browser_app_camera_frame",
    {
      title: "TongPing · Camera Frame",
      description:
        "App-only: while the user's camera is on, keep their latest frame for AIs that want to look; active=false drops it at once. Returns who looked last so the card can tell their.",
      inputSchema: z.object({
        identity: identitySchema,
        profile: profileSchema,
        active: z.boolean(),
        imageBase64: z.string().max(1_500_000).default(""),
        mimeType: z.enum(["image/jpeg", "image/png"]).default("image/jpeg"),
      }),
      _meta: appOnly,
    },
    async ({ profile, active, imageBase64, mimeType }) => {
      const previous = cameraFrames.get(profile);
      if (!active) {
        cameraFrames.delete(profile);
        return appToolResult({ ok: true, active: false, lastLook: null });
      }
      if (imageBase64.length >= 16) {
        cameraFrames.set(profile, {
          imageBase64,
          mimeType,
          capturedAt: Date.now(),
          lastLook: previous?.lastLook ?? null,
        });
      }
      const lastLook = cameraFrames.get(profile)?.lastLook ?? null;
      return appToolResult({
        ok: true,
        active: true,
        lastLook: lastLook ? { by: lastLook.by, at: new Date(lastLook.at).toISOString() } : null,
      });
    },
  );

  server.registerTool(
    "browser_camera_look",
    {
      title: "TongPing · Look at the User",
      description:
        "Look at the user through their camera (with the face effects they chose) while they have “Let Them See You” turned on in the TongPing card. Call it when you want to see them; they are told each time you look. Identity is required and must be your own `name.entry` identity (claude.chat, claude.code, gpt.chat, gpt.codex, gpt.work): their card shows that name. Muted AIs are refused.",
      inputSchema: z.object({
        // Required, no host default: their card names whoever looked, so a
        // forgotten identity must not be credited to someone else.
        identity: z.string().regex(/^[a-z0-9._-]{1,40}$/),
        profile: z.string().default(""),
      }),
    },
    async ({ identity, profile: requested }) => {
      const who = canonicalIdentity(identity);
      if (appChatLedger.isMuted(who)) {
        return textResult({
          available: false,
          note: "The user has muted " + who + " in TongPing, so you cannot see their camera until they unmute you.",
        });
      }
      const profile = requested || options.getViewerProfile?.() || "default";
      const frame =
        cameraFrames.get(profile) ??
        [...cameraFrames.values()].sort((a, b) => b.capturedAt - a.capturedAt)[0];
      if (!frame || Date.now() - frame.capturedAt > CAMERA_FRAME_STALE_MS) {
        for (const [key, value] of cameraFrames) {
          if (Date.now() - value.capturedAt > CAMERA_FRAME_STALE_MS) cameraFrames.delete(key);
        }
        return textResult({
          available: false,
          note: "The user's camera is off right now. Don't ask them to turn it on unless they wants to.",
        });
      }
      frame.lastLook = { by: who, at: Date.now() };
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              available: true,
              capturedAt: new Date(frame.capturedAt).toISOString(),
              note: "This is the user live through their camera, with their chosen face effect. She will see that you looked.",
            }),
          },
          { type: "image" as const, data: frame.imageBase64, mimeType: frame.mimeType },
        ],
      };
    },
  );

  registerBrowserAppTool(
    "browser_app_image_link",
    {
      title: "TongPing · Image Link",
      description: "App-only: host an image briefly so the system browser can open and save it.",
      inputSchema: z.object({
        identity: identitySchema,
        profile: profileSchema,
        imageBase64: z.string().min(16).max(8_000_000),
        mimeType: z.enum(["image/png", "image/jpeg"]).default("image/png"),
        name: z.string().max(60).default("ticket"),
      }),
      _meta: appOnly,
    },
    async ({ imageBase64, mimeType, name }) => {
      if (!options.createSharedImage) return errorResult("Shared image authority is unavailable");
      const { id, ticket } = await options.createSharedImage(Buffer.from(imageBase64, "base64"), mimeType);
      const extension = mimeType === "image/png" ? ".png" : ".jpg";
      const safeName = name.replace(/[^A-Za-z0-9._-]/g, "") || "ticket";
      return appToolResult({
        ok: true,
        url: appOrigin + "/v1/app/shared-image/" + id + "/" + safeName + extension + "?ticket=" + encodeURIComponent(ticket),
      });
    },
  );

  server.registerTool(
    "browser_watch_ticket",
    {
      title: "TongPing · Watch Ticket",
      description:
        "Read the memory ticket image the user just asked you to turn into an AI commemorative ticket (legacy: the card no longer has an AI ticket button, so this is normally empty). Returns the exact ticket image plus its text fields. Use this image as the only visual reference.",
      inputSchema: z.object({
        profile: profileSchema,
      }),
    },
    async ({ profile }) => {
      const shared = sharedWatchTickets.get(profile);
      if (!shared || Date.now() - shared.sharedAt > SHARED_TICKET_TTL_MS) {
        return textResult({
          profile,
          available: false,
          note: "No ticket was shared in the last 30 minutes. The card no longer sends tickets to AIs; do not ask the user to press a ticket button.",
        });
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              profile,
              available: true,
              ticketNo: shared.ticketNo,
              sharedAt: new Date(shared.sharedAt).toISOString(),
              ...shared.meta,
            }),
          },
          {
            type: "image" as const,
            data: shared.imageBase64,
            mimeType: shared.mimeType,
          },
        ],
      };
    },
  );

  registerBrowserAppTool(
    "browser_app_claude_lab",
    {
      title: "TongPing · Claude Lab",
      description:
        "Developer diagnostics only: a bare Claude-host rendering lab. Do NOT use this to open TongPing for the user or to watch/chat together — that is always browser_app, in every host including Claude.",
      inputSchema: z.object({
        profile: profileSchema.default("xiaohongshu"),
        url: z.string().url().optional(),
      }),
      // Frozen Claude host contract:
      // resourceUri only. No "openai/*" keys, no visibility hints.
      _meta: {
        "ui/resourceUri": CLAUDE_BROWSER_APP_URI,
        ui: { resourceUri: CLAUDE_BROWSER_APP_URI },
      },
    },
    async ({ profile, url }) => {
      const identity = "claude.chat";
      const openReply = await gateway.call(
        "browser_open",
        { profile, ...(url ? { url } : {}) },
        identity,
      );
      if (!openReply.ok) {
        return appError(openReply.error ?? "Claude lab browser open failed");
      }
      // withFrame=true: the console needs the viewport to convert click coordinates and frameUrl to display the image
      const state = await browserAppState(identity, profile, true);
      const opened = asRecord(openReply.result);
      if (typeof opened.title === "string") state.title = opened.title;
      if (typeof opened.url === "string") state.url = opened.url;
      if (opened.viewport && typeof opened.viewport === "object") {
        state.viewport = opened.viewport;
      }
      state.kind = "tongping-claude-lab";
      state.labResource = CLAUDE_BROWSER_APP_URI;
      // 2026-09-20: reverted the embedded-resource experiment.
      // Large payloads in the tool result crash the claude.ai MCP app loader
      // ("Failed to load this connector") - same trap voice_card / sticker_card /
      // study_open each hit. Keep the result light; the host fetches the UI via
      // resources/read using the resourceUri hint below.
      return {
        content: [
          {
            type: "text" as const,
            text: "Claude Lab opened. Isolated from the ChatGPT browser card.",
          },
        ],
        structuredContent: state,
        _meta: {
          "ui/resourceUri": CLAUDE_BROWSER_APP_URI,
          ui: { resourceUri: CLAUDE_BROWSER_APP_URI },
        },
      };
    },
  );

  registerBrowserAppTool(
    "browser_app",
    {
      title: "TongPing",
      description:
        "Open the shared TongPing interactive app — the card to use whenever the user asks to open TongPing, in any host including Claude. ChatGPT, Claude, Codex and other identities can share the same persistent browser profiles while keeping separate audit identities.",
      inputSchema: z.object({
        identity: identitySchema,
        // v90: omitted profile follows the browser the user is watching, so a
        // second AI's card opens the same page instead of another profile.
        profile: z.string().regex(/^[a-zA-Z0-9._-]{1,64}$/).optional(),
        url: z.string().url().optional(),
      }),
      _meta: browserAppToolMeta,
    },
    async ({ identity, profile: requestedProfile, url }) => {
      const profile =
        requestedProfile ?? options.getViewerProfile?.() ?? "default";
      let opened: Record<string, unknown> | null = null;

      // Opening the App UI itself must remain possible during human takeover,
      // otherwise the user can get locked out of the very control surface
      // needed to return control to the model. Navigation remains blocked.
      if (url) {
        const openReply = await gateway.call(
          "browser_open",
          { profile, url },
          identity,
        );
        if (!openReply.ok) {
          return appError(openReply.error ?? "Browser open failed");
        }
        opened = asRecord(openReply.result);
      }

      const state = await browserAppState(identity, profile, false);
      if (opened) {
        if (typeof opened.title === "string") state.title = opened.title;
        if (typeof opened.url === "string") state.url = opened.url;
        if (opened.viewport && typeof opened.viewport === "object") {
          state.viewport = opened.viewport;
        }
      }

      return appToolResult(
        state,
        "Opened TongPing profile " + profile +
          " as " + identity +
          ". Human live view: " + String(state.appUrl ?? ""),
      );
    },
  );

  registerBrowserAppTool(
    "browser_app_refresh",
    {
      description: "Refresh the live screenshot and status for the Browser App.",
      inputSchema: z.object({
        identity: identitySchema,
        profile: profileSchema,
        appUiBuild: z.string().max(16).optional(),
      }),
      _meta: appOnly,
    },
    async ({ identity, profile, appUiBuild }) => {
      try {
        // v78 and older cards reconnect whenever a ticket string changes,
        // so only cards that compare stable targets get re-signed lanes.
        const buildMatch = /^v?(\d{1,6})$/i.exec(appUiBuild ?? "");
        const renewsTickets = buildMatch !== null && Number(buildMatch[1]) >= 79;
        if (options.appSigningKey && options.liveEnabled && !renewsTickets) {
          return appToolResult({
            kind: "tongping",
            version: "0.4.0-wip",
            identity,
            profile,
            externalLoginEnabled: options.externalLoginEnabled === true,
            frameUrl: createBrowserFrameUrl(
              appOrigin,
              options.appSigningKey,
              profile,
              180,
            ),
          });
        }
        if (options.appSigningKey && options.liveEnabled) {
          return appToolResult({
            kind: "tongping",
            version: "0.4.0-wip",
            identity,
            profile,
            externalLoginEnabled: options.externalLoginEnabled === true,
            frameUrl: createBrowserFrameUrl(
              appOrigin,
              options.appSigningKey,
              profile,
              180,
            ),
            // Re-sign every long-lived lane on each poll: an open card used
            // to keep its first hour-long tickets forever, so any reconnect
            // after an hour was refused. The app keeps healthy sockets and
            // only uses these fresh tickets when it has to reconnect.
            controlUrl: createBrowserControlUrl(
              appOrigin,
              options.appSigningKey,
              profile,
              identity,
              180,
            ),
            liveUrl: createBrowserLiveUrl(
              appOrigin,
              options.appSigningKey,
              profile,
              3600,
            ),
            audioUrl: createBrowserAudioUrl(
              appOrigin,
              options.appSigningKey,
              profile,
              3600,
            ),
            mediaUrl: stampBrowserAppBuildOnMediaUrl(
              createBrowserMediaUrl(
                appOrigin,
                options.appSigningKey,
                profile,
                3600,
              ),
            ),
            companionHlsUrl: createBrowserCompanionHlsUrl(
              appOrigin,
              options.appSigningKey,
              profile,
              3600,
              30,
            ),
            chatUrl: createBrowserChatUrl(
              appOrigin,
              options.appSigningKey,
              profile,
              3600,
            ),
            watchCollectionUrl: createBrowserWatchCollectionUrl(
              appOrigin,
              options.appSigningKey,
              profile,
              3600,
            ),
            watchCollectionWriteUrl: createBrowserWatchCollectionWriteUrl(
              appOrigin,
              options.appSigningKey,
              profile,
              3600,
            ),
          });
        }
        return appToolResult(
          await browserAppState(identity, profile, true),
        );
      } catch (error) {
        return appError(errorMessage(error));
      }
    },
  );

  registerBrowserAppTool(
    "browser_app_takeover",
    {
      description:
        "Start or end direct human takeover of a persistent browser profile.",
      inputSchema: z.object({
        identity: identitySchema,
        profile: profileSchema,
        takeover: z.boolean(),
      }),
      _meta: appOnly,
    },
    async ({ identity, profile, takeover }) => {
      const reply = await gateway.human(
        takeover ? "human_takeover_start" : "human_takeover_end",
        { profile },
        identity,
      );
      if (!reply.ok) {
        return appError(reply.error ?? "Takeover switch failed");
      }
      try {
        return appToolResult(
          await browserAppState(identity, profile, true),
        );
      } catch (error) {
        return appError(errorMessage(error));
      }
    },
  );

  registerBrowserAppTool(
    "browser_app_external_login_start",
    {
      description:
        "Hand a profile to a normal local Chrome/Edge window on the paired desktop worker for manual sign-in. The model cannot control that profile until the local window is closed and resumed.",
      inputSchema: z.object({
        identity: identitySchema,
        profile: profileSchema,
        url: z.string().url().optional(),
      }),
      _meta: appOnly,
    },
    async ({ identity, profile, url }) => {
      if (!options.externalLoginEnabled) {
        return appError(
          "Local sign-in requires Windows Worker v28 or later. Update the local worker and try again.",
        );
      }

      let resolvedUrl = url;
      const looksLikeFallback =
        !resolvedUrl ||
        resolvedUrl === "https://chatgpt.com/" ||
        resolvedUrl === "https://example.com/";
      if (looksLikeFallback) {
        try {
          const current = await browserAppState(identity, profile, false);
          const candidate =
            typeof current.url === "string" ? current.url.trim() : "";
          if (
            candidate &&
            /^https?:\/\//i.test(candidate) &&
            candidate !== "https://chatgpt.com/" &&
            candidate !== "https://example.com/"
          ) {
            resolvedUrl = candidate;
          }
        } catch {
          // Let the worker perform its own final validation/fallback.
        }
      }

      const reply = await gateway.human(
        "human_external_login_start",
        { profile, ...(resolvedUrl ? { url: resolvedUrl } : {}) },
        identity,
      );
      if (!reply.ok) {
        return appError(reply.error ?? "Local manual login failed to start");
      }
      try {
        return appToolResult(
          await browserAppState(identity, profile, false),
          "Local manual login window opened on the paired desktop worker.",
        );
      } catch (error) {
        return appError(errorMessage(error));
      }
    },
  );

  registerBrowserAppTool(
    "browser_app_external_login_finish",
    {
      description:
        "Resume TongPing after the user finishes manual sign-in and closes the local Chrome/Edge window.",
      inputSchema: z.object({
        identity: identitySchema,
        profile: profileSchema,
      }),
      _meta: appOnly,
    },
    async ({ identity, profile }) => {
      if (!options.externalLoginEnabled) {
        return appError(
          "Local sign-in requires Windows Worker v28 or later. Update the local worker and try again.",
        );
      }
      const reply = await gateway.human(
        "human_external_login_finish",
        { profile },
        identity,
      );
      if (!reply.ok) {
        return appError(reply.error ?? "Local manual login could not resume");
      }
      return appToolResult(
        browserAppStateFromExternalLoginFinish(
          identity,
          profile,
          reply.result,
        ),
        "TongPing resumed after local manual login.",
      );
    },
  );

  registerBrowserAppTool(
    "browser_app_click",
    {
      description:
        "Click viewport coordinates while the user holds direct human takeover.",
      inputSchema: z.object({
        identity: identitySchema,
        profile: profileSchema,
        x: z.number().finite().nonnegative(),
        y: z.number().finite().nonnegative(),
      }),
      _meta: appOnly,
    },
    async ({ identity, profile, x, y }) => {
      const reply = await gateway.human(
        "human_click",
        { profile, x, y },
        identity,
      );
      if (!reply.ok) return appError(reply.error ?? "Click failed");
      return appToolResult(
        {
          kind: "tongping-action",
          identity,
          profile,
          action: "click",
        },
        "Browser click sent.",
      );
    },
  );

  registerBrowserAppTool(
    "browser_app_drag",
    {
      description:
        "Replay a direct human drag gesture across viewport coordinates while takeover is active.",
      inputSchema: z.object({
        identity: identitySchema,
        profile: profileSchema,
        startX: z.number().finite().nonnegative(),
        startY: z.number().finite().nonnegative(),
        endX: z.number().finite().nonnegative(),
        endY: z.number().finite().nonnegative(),
        steps: z.number().int().min(2).max(60).default(18),
      }),
      _meta: appOnly,
    },
    async ({
      identity,
      profile,
      startX,
      startY,
      endX,
      endY,
      steps,
    }) => {
      const reply = await gateway.human(
        "human_drag",
        { profile, startX, startY, endX, endY, steps },
        identity,
      );
      if (!reply.ok) return appError(reply.error ?? "Drag failed");
      return appToolResult(
        {
          kind: "tongping-action",
          identity,
          profile,
          action: "drag",
        },
        "Browser drag sent.",
      );
    },
  );

  registerBrowserAppTool(
    "browser_app_type",
    {
      description:
        "Send direct human text input while takeover is active. Browser audit records only character count.",
      inputSchema: z.object({
        identity: identitySchema,
        profile: profileSchema,
        text: z.string().max(10000),
      }),
      _meta: appOnly,
    },
    async ({ identity, profile, text }) => {
      const reply = await gateway.human(
        "human_type",
        { profile, text },
        identity,
      );
      if (!reply.ok) return appError(reply.error ?? "Typing failed");
      return appToolResult(
        {
          kind: "tongping-action",
          identity,
          profile,
          action: "type",
          chars: text.length,
        },
        `Sent ${text.length} characters to the browser.`,
      );
    },
  );

  registerBrowserAppTool(
    "browser_app_key",
    {
      description: "Send a direct human browser key while takeover is active.",
      inputSchema: z.object({
        identity: identitySchema,
        profile: profileSchema,
        key: z
          .enum(["Enter", "Escape", "Tab", "Backspace"])
          .default("Enter"),
      }),
      _meta: appOnly,
    },
    async ({ identity, profile, key }) => {
      const reply = await gateway.human(
        "human_key",
        { profile, key },
        identity,
      );
      if (!reply.ok) return appError(reply.error ?? "Key press failed");
      return appToolResult(
        {
          kind: "tongping-action",
          identity,
          profile,
          action: "key",
          key,
        },
        `Sent ${key}.`,
      );
    },
  );

  registerBrowserAppTool(
    "browser_app_companion_seek_source",
    {
      description:
        "Seek the source HTML media to an absolute source timestamp, then rebuild the companion capture/HLS epoch. App-only; used when a timeline seek falls outside the currently buffered companion window.",
      inputSchema: z.object({
        identity: identitySchema,
        profile: profileSchema,
        targetSeconds: z.number().min(0).max(86_400),
      }),
      _meta: appOnly,
    },
    async ({ identity, profile, targetSeconds }) => {
      if (!options.seekCompanionSource) {
        return appError("Companion source seek is unavailable.");
      }
      try {
        const result = await Promise.resolve(
          options.seekCompanionSource(profile, targetSeconds),
        );
        return appToolResult(
          {
            kind: "tongping-companion-source-seek",
            identity,
            profile,
            targetSeconds,
            result,
          },
          "Source media seeked to " +
            targetSeconds.toFixed(2) +
            " seconds; companion buffer is rebuilding.",
        );
      } catch (error) {
        return appError(
          error instanceof Error ? error.message : String(error),
        );
      }
    },
  );

  registerBrowserAppTool(
    "browser_app_navigate",
    {
      description:
        "Navigate the shared persistent browser from the App address bar, preserving human takeover if it was active.",
      inputSchema: z.object({
        identity: identitySchema,
        profile: profileSchema,
        url: z.string().url(),
      }),
      _meta: appOnly,
    },
    async ({ identity, profile, url }) => {
      const beforeReply = await gateway.human(
        "human_status",
        { profile },
        identity,
      );
      const before = asRecord(beforeReply.result);
      const wasTaken =
        beforeReply.ok && asRecord(before.takeover).active === true;

      if (wasTaken) {
        const release = await gateway.human(
          "human_takeover_end",
          { profile },
          identity,
        );
        if (!release.ok) {
          return appError(release.error ?? "Could not release takeover");
        }
      }

      const openReply = await gateway.call(
        "browser_open",
        { profile, url },
        identity,
      );
      if (!openReply.ok) {
        if (wasTaken) {
          await gateway.human(
            "human_takeover_start",
            { profile },
            identity,
          );
        }
        return appError(openReply.error ?? "Navigation failed");
      }

      if (wasTaken) {
        const retake = await gateway.human(
          "human_takeover_start",
          { profile },
          identity,
        );
        if (!retake.ok) {
          return appError(
            retake.error ?? "Navigated, but could not restore takeover",
          );
        }
      }

      try {
        return appToolResult(
          await browserAppState(identity, profile, true),
        );
      } catch (error) {
        return appError(errorMessage(error));
      }
    },
  );


  registerBrowserAppTool(
    "browser_app_history",
    {
      description:
        "Navigate backward or forward in the shared browser history, preserving human takeover.",
      inputSchema: z.object({
        identity: identitySchema,
        profile: profileSchema,
        direction: z.enum(["back", "forward"]),
      }),
      _meta: appOnly,
    },
    async ({ identity, profile, direction }) => {
      const beforeReply = await gateway.human(
        "human_status",
        { profile },
        identity,
      );
      const before = asRecord(beforeReply.result);
      const wasTaken =
        beforeReply.ok && asRecord(before.takeover).active === true;

      if (wasTaken) {
        const release = await gateway.human(
          "human_takeover_end",
          { profile },
          identity,
        );
        if (!release.ok) {
          return appError(release.error ?? "Could not release takeover");
        }
      }

      const navReply = await gateway.call(
        direction === "back" ? "browser_back" : "browser_forward",
        { profile },
        identity,
      );

      if (!navReply.ok) {
        if (wasTaken) {
          await gateway.human(
            "human_takeover_start",
            { profile },
            identity,
          );
        }
        return appError(navReply.error ?? "History navigation failed");
      }

      if (wasTaken) {
        const retake = await gateway.human(
          "human_takeover_start",
          { profile },
          identity,
        );
        if (!retake.ok) {
          return appError(
            retake.error ?? "Navigated, but could not restore takeover",
          );
        }
      }

      try {
        return appToolResult(
          await browserAppState(identity, profile, true),
        );
      } catch (error) {
        return appError(errorMessage(error));
      }
    },
  );

  registerBrowserAppTool(
    "browser_app_reload",
    {
      description:
        "Reload the current shared browser page, preserving human takeover.",
      inputSchema: z.object({
        identity: identitySchema,
        profile: profileSchema,
      }),
      _meta: appOnly,
    },
    async ({ identity, profile }) => {
      const beforeReply = await gateway.human(
        "human_status",
        { profile },
        identity,
      );
      const before = asRecord(beforeReply.result);
      const wasTaken =
        beforeReply.ok && asRecord(before.takeover).active === true;

      if (wasTaken) {
        const release = await gateway.human(
          "human_takeover_end",
          { profile },
          identity,
        );
        if (!release.ok) {
          return appError(release.error ?? "Could not release takeover");
        }
      }

      const reloadReply = await gateway.call(
        "browser_reload",
        { profile },
        identity,
      );

      if (!reloadReply.ok) {
        if (wasTaken) {
          await gateway.human(
            "human_takeover_start",
            { profile },
            identity,
          );
        }
        return appError(reloadReply.error ?? "Reload failed");
      }

      if (wasTaken) {
        const retake = await gateway.human(
          "human_takeover_start",
          { profile },
          identity,
        );
        if (!retake.ok) {
          return appError(
            retake.error ?? "Reloaded, but could not restore takeover",
          );
        }
      }

      try {
        return appToolResult(
          await browserAppState(identity, profile, true),
        );
      } catch (error) {
        return appError(errorMessage(error));
      }
    },
  );

  registerBrowserAppTool(
    "browser_app_context_info",
    {
      description:
        "Inspect the page target under viewport coordinates during human takeover for the mirrored context menu.",
      inputSchema: z.object({
        identity: identitySchema,
        profile: profileSchema,
        x: z.number().finite().nonnegative(),
        y: z.number().finite().nonnegative(),
      }),
      _meta: appOnly,
    },
    async ({ identity, profile, x, y }) => {
      const reply = await gateway.human(
        "human_context_info",
        { profile, x, y },
        identity,
      );
      if (!reply.ok) {
        return appError(reply.error ?? "Context target lookup failed");
      }
      return appToolResult({
        kind: "tongping-context",
        identity,
        profile,
        ...asRecord(reply.result),
      });
    },
  );

  const uiMeta = {
    csp: {
      // jsdelivr / googleapis: MediaPipe face landmarker for the camera effects.
      resourceDomains: [appOrigin, "https://cdn.jsdelivr.net"],
      connectDomains: [
        appOrigin,
        appWsOrigin,
        "https://cdn.jsdelivr.net",
        "https://storage.googleapis.com",
      ],
    },
    // Hold-to-talk and “Let Them See You”; hosts may decline, the card feature-detects.
    permissions: { microphone: {}, camera: {} },
    prefersBorder: false,
    ...(appDomain ? { domain: appDomain } : {}),
  };
  if (claudeHostSession) delete (uiMeta as Record<string, unknown>).domain;

  // Claude host contract:
  // a "domain" field here makes EVERY ext-apps card fail with
  // "Failed to load this connector". Declare CSP allowlists only and let
  // claude.ai use its default sandbox domain. Never add domain / openai/* keys.
  const claudeUiMeta = {
    csp: {
      resourceDomains: [appOrigin],
      connectDomains: [appOrigin],
    },
  };

  registerBrowserAppResource(
    "TongPing Claude Lab",
    CLAUDE_BROWSER_APP_URI,
    {
      mimeType: BROWSER_APP_MIME_TYPE,
      description:
        "Isolated Claude-host MCP App rendering and bridge diagnostics lab.",
      _meta: { ui: claudeUiMeta },
    },
    async () => ({
      contents: [
        {
          uri: CLAUDE_BROWSER_APP_URI,
          mimeType: BROWSER_APP_MIME_TYPE,
          text: renderClaudeBrowserApp(appOrigin),
          _meta: { ui: claudeUiMeta },
        },
      ],
    }),
  );

  registerBrowserAppResource(
    "TongPing Shared Browser",
    BROWSER_APP_URI,
    {
      mimeType: BROWSER_APP_MIME_TYPE,
      description:
        "Large shared persistent-browser controller for direct human takeover and AI collaboration.",
      _meta: { ui: uiMeta },
    },
    async () => ({
      contents: [
        {
          uri: BROWSER_APP_URI,
          mimeType: BROWSER_APP_MIME_TYPE,
          text: renderBrowserApp(appOrigin),
          _meta: { ui: uiMeta },
        },
      ],
    }),
  );

  for (const recentCompatUri of [
    "ui://tongping/shared-browser-v72",
    "ui://tongping/shared-browser-v71",
    "ui://tongping/shared-browser-v70",
    "ui://tongping/shared-browser-v69",
    "ui://tongping/shared-browser-v68",
    "ui://tongping/shared-browser-v67",
    "ui://tongping/shared-browser-v66",
    "ui://tongping/shared-browser-v65",
    "ui://tongping/shared-browser-v64",
    "ui://tongping/shared-browser-v63",
    "ui://tongping/shared-browser-v62",
    "ui://tongping/shared-browser-v61",
    "ui://tongping/shared-browser-v60",
    "ui://tongping/shared-browser-v59",
    "ui://tongping/shared-browser-v58",
    "ui://tongping/shared-browser-v57",
    "ui://tongping/shared-browser-v56",
    "ui://tongping/shared-browser-v55",
    "ui://tongping/shared-browser-v54",
    "ui://tongping/shared-browser-v53",
    "ui://tongping/shared-browser-v52",
    "ui://tongping/shared-browser-v51",
    "ui://tongping/shared-browser-v50",
    "ui://tongping/shared-browser-v49",
    "ui://tongping/shared-browser-v48",
    "ui://tongping/shared-browser-v47",
    "ui://tongping/shared-browser-v46",
    "ui://tongping/shared-browser-v45",
    "ui://tongping/shared-browser-v44",
    "ui://tongping/shared-browser-v43",
    "ui://tongping/shared-browser-v42",
    "ui://tongping/shared-browser-v41",
    "ui://tongping/shared-browser-v40",
    "ui://tongping/shared-browser-v39",
    "ui://tongping/shared-browser-v38",
    "ui://tongping/shared-browser-v37",
    "ui://tongping/shared-browser-v36",
    "ui://tongping/shared-browser-v35",
    "ui://tongping/shared-browser-v30",
    "ui://tongping/shared-browser-v29",
    "ui://tongping/shared-browser-v28",
    "ui://tongping/shared-browser-v27",
    "ui://tongping/shared-browser-v26",
    "ui://tongping/shared-browser-v25",
    "ui://tongping/shared-browser-v24",
  ]) {
    registerBrowserAppResource(
      "TongPing recent compatibility " + recentCompatUri,
      recentCompatUri,
      {
        mimeType: BROWSER_APP_MIME_TYPE,
        description:
          "Compatibility alias for recent TongPing cards, serving the current renderer.",
        _meta: { ui: uiMeta },
      },
      async () => ({
        contents: [
          {
            uri: recentCompatUri,
            mimeType: BROWSER_APP_MIME_TYPE,
            text: renderBrowserApp(appOrigin),
            _meta: { ui: uiMeta },
          },
        ],
      }),
    );
  }

  registerBrowserAppResource(
    "TongPing Shared Browser v12 compatibility",
    "ui://tongping/shared-browser-v12",
    {
      mimeType: BROWSER_APP_MIME_TYPE,
      description:
        "Compatibility alias for TongPing v12 cards, serving the current renderer.",
      _meta: { ui: uiMeta },
    },
    async () => ({
      contents: [
        {
          uri: "ui://tongping/shared-browser-v12",
          mimeType: BROWSER_APP_MIME_TYPE,
          text: renderBrowserApp(appOrigin),
          _meta: { ui: uiMeta },
        },
      ],
    }),
  );

  registerBrowserAppResource(
    "TongPing Shared Browser v11 compatibility",
    "ui://tongping/shared-browser-v11",
    {
      mimeType: BROWSER_APP_MIME_TYPE,
      description:
        "Compatibility alias for TongPing v11 cards, serving the current renderer.",
      _meta: { ui: uiMeta },
    },
    async () => ({
      contents: [
        {
          uri: "ui://tongping/shared-browser-v11",
          mimeType: BROWSER_APP_MIME_TYPE,
          text: renderBrowserApp(appOrigin),
          _meta: { ui: uiMeta },
        },
      ],
    }),
  );

  registerBrowserAppResource(
    "TongPing Shared Browser v5 compatibility",
    "ui://tongping/shared-browser-v5",
    {
      mimeType: BROWSER_APP_MIME_TYPE,
      description:
        "Compatibility alias for TongPing v5 cards.",
      _meta: { ui: uiMeta },
    },
    async () => ({
      contents: [
        {
          uri: "ui://tongping/shared-browser-v5",
          mimeType: BROWSER_APP_MIME_TYPE,
          text: renderBrowserApp(appOrigin),
          _meta: { ui: uiMeta },
        },
      ],
    }),
  );

  registerBrowserAppResource(
    "TongPing Shared Browser v4 compatibility",
    "ui://tongping/shared-browser-v4",
    {
      mimeType: BROWSER_APP_MIME_TYPE,
      description:
        "Compatibility alias for TongPing v4 cards.",
      _meta: { ui: uiMeta },
    },
    async () => ({
      contents: [
        {
          uri: "ui://tongping/shared-browser-v4",
          mimeType: BROWSER_APP_MIME_TYPE,
          text: renderBrowserApp(appOrigin),
          _meta: { ui: uiMeta },
        },
      ],
    }),
  );

  registerBrowserAppResource(
    "TongPing Shared Browser v3 compatibility",
    "ui://tongping/shared-browser-v3",
    {
      mimeType: BROWSER_APP_MIME_TYPE,
      description:
        "Compatibility alias for TongPing v3 cards.",
      _meta: { ui: uiMeta },
    },
    async () => ({
      contents: [
        {
          uri: "ui://tongping/shared-browser-v3",
          mimeType: BROWSER_APP_MIME_TYPE,
          text: renderBrowserApp(appOrigin),
          _meta: { ui: uiMeta },
        },
      ],
    }),
  );

  registerBrowserAppResource(
    "TongPing Shared Browser v2 compatibility",
    "ui://tongping/shared-browser-v2",
    {
      mimeType: BROWSER_APP_MIME_TYPE,
      description:
        "Compatibility alias for previously rendered TongPing cards.",
      _meta: { ui: uiMeta },
    },
    async () => ({
      contents: [
        {
          uri: "ui://tongping/shared-browser-v2",
          mimeType: BROWSER_APP_MIME_TYPE,
          text: renderBrowserApp(appOrigin),
          _meta: { ui: uiMeta },
        },
      ],
    }),
  );

  server.registerTool(
    "xianyu_search",
    {
      description:
        "Search Xianyu/Goofish with the persistent browser profile and return normalized item links plus page text. This is a thin adapter over the generic browser core.",
      inputSchema: z.object({
        profile: z.string().default("goofish"),
        query: z.string().min(1),
        maxResults: z.number().int().min(1).max(50).default(20),
      }),
    },
    async ({ profile, query, maxResults }) => {
      try {
        return textResult(
          await xianyuSearch(gateway, {
            profile,
            query,
            maxResults,
          }),
        );
      } catch (error) {
        return errorResult(
          error instanceof Error ? error.message : String(error),
        );
      }
    },
  );

  server.registerTool(
    "xianyu_open_item",
    {
      description:
        "Open one Xianyu item by numeric item id or goofish.com item URL and return page text plus semantic interactive elements.",
      inputSchema: z.object({
        profile: z.string().default("goofish"),
        item: z.string().min(1),
      }),
    },
    async ({ profile, item }) => {
      try {
        return textResult(
          await xianyuOpenItem(gateway, {
            profile,
            item,
          }),
        );
      } catch (error) {
        return errorResult(
          error instanceof Error ? error.message : String(error),
        );
      }
    },
  );

  server.registerTool(
    "browser_profiles",
    {
      description:
        "List persistent browser profiles and whether they are currently active.",
      inputSchema: z.object({}),
    },
    async () => call("browser_profiles", {}),
  );

  server.registerTool(
    "browser_open",
    {
      description:
        "Open or reuse one persistent browser profile, optionally navigating to a URL. Login state stays in that profile on disk.",
      inputSchema: z.object({
        profile: z.string().default("default"),
        url: z.string().url().optional(),
      }),
    },
    async ({ profile, url }) =>
      call("browser_open", {
        profile,
        ...(url ? { url } : {}),
      }),
  );

  server.registerTool(
    "browser_audio_vision",
    {
      description:
        "Read local DSP-derived audio/music signals from the current browser media without sending raw audio to the model. Returns recent loudness, band energy, spectral centroid, onset density, pitch, chroma, key estimate, harmonic change, BPM/beat phase, state, section events, and timeline.",
      inputSchema: z.object({
        profile: z.string().default("default"),
        seconds: z.number().min(1).max(30).default(5),
      }),
    },
    async ({ profile, seconds }) =>
      call("browser_audio_vision", { profile, seconds }),
  );

  server.registerTool(
    "browser_media_context",
    {
      description:
        "Read media context from the computer source browser. Subtitle cues are gated by the source playhead, not by how far the viewer has watched in a delayed companion stream. Use browser_companion_context when viewer progress matters.",
      inputSchema: z.object({
        profile: z.string().default("default"),
        lookbackSeconds: z.number().min(0).max(3600).default(120),
        maxCues: z.number().int().min(1).max(500).default(120),
      }),
    },
    async ({ profile, lookbackSeconds, maxCues }) =>
      call("browser_media_context", {
        profile,
        lookbackSeconds,
        maxCues,
      }),
  );

  server.registerTool(
    "browser_companion_context",
    {
      description:
        "Read one spoiler-safe co-watching context anchored to the user's buffered HLS playback clock. Subtitles are gated to the delayed playback position; realtime source audio is never used while buffered audio DSP is unavailable. Set cumulativeMusicHistory=true for music listening: already-heard lyrics and DSP features accumulate from song start to the current the user playback cutoff while future material remains sealed.",
      inputSchema: z.object({
        profile: z.string().default("default"),
        audioSeconds: z.number().min(1).max(30).default(5),
        lookbackSeconds: z.number().min(0).max(3600).default(120),
        maxCues: z.number().int().min(1).max(500).default(120),
        cumulativeMusicHistory: z.boolean().default(false),
      }),
    },
    async ({ profile, audioSeconds, lookbackSeconds, maxCues, cumulativeMusicHistory }) => {
      // The PC runs ahead of the user's delayed playback (20 s, more after a
      // pause or stall). Fetch a wide window measured from the PC clock and
      // cut the lookback from the user's own clock below, or every cue they have
      // already heard falls outside a PC-relative window.
      const mediaReply = await gateway.call("browser_media_context", {
        profile,
        lookbackSeconds: cumulativeMusicHistory
          ? 3600
          : Math.min(3600, lookbackSeconds + 900),
        maxCues: 500,
      });
      if (!mediaReply.ok) {
        return errorResult(mediaReply.error ?? "Media context failed");
      }

      const playback = options.getCompanionPlaybackStatus?.(profile) ?? null;
      const playbackFresh =
        playback !== null &&
        playback.currentTime !== null &&
        Date.now() - playback.receivedAt <= 5_000;
      const rawMediaContext = mediaReply.result as any;
      const delayedCutoff =
        playbackFresh && playback?.sourcePts !== null
          ? playback?.sourcePts ?? null
          : null;
      const mediaContext =
        delayedCutoff === null
          ? {
              ...rawMediaContext,
              media: rawMediaContext?.media
                ? {
                    ...rawMediaContext.media,
                    currentTime: null,
                  }
                : null,
              subtitles: [],
              spoilerBoundary: {
                ...(rawMediaContext?.spoilerBoundary ?? {}),
                mode: "timestamp-gated",
                cutoffMediaTime: null,
                futureCuesReturned: false,
                lookbackSeconds,
              },
            }
          : {
              ...rawMediaContext,
              media: rawMediaContext?.media
                ? {
                    ...rawMediaContext.media,
                    currentTime: delayedCutoff,
                    paused: playback?.paused ?? rawMediaContext.media.paused,
                    readyState:
                      playback?.readyState ?? rawMediaContext.media.readyState,
                  }
                : rawMediaContext?.media ?? null,
              subtitles: Array.isArray(rawMediaContext?.subtitles)
                ? rawMediaContext.subtitles
                    .filter((cue: any) =>
                      typeof cue?.startTime === "number" &&
                      cue.startTime <= delayedCutoff &&
                      (typeof cue.endTime === "number" ? cue.endTime : cue.startTime) >=
                        delayedCutoff - (cumulativeMusicHistory ? delayedCutoff : lookbackSeconds)
                    )
                    .slice(-Math.max(1, Math.min(500, cumulativeMusicHistory ? 500 : maxCues)))
                : [],
              spoilerBoundary: {
                ...(rawMediaContext?.spoilerBoundary ?? {}),
                mode: "timestamp-gated",
                cutoffMediaTime: delayedCutoff,
                futureCuesReturned: false,
                lookbackSeconds,
              },
            };

      // Never read realtime Audio Vision while in the buffered companion lane:
      // source audio is ahead of the user's delayed HLS playback and could leak
      // future content. Analyze the same delayed HLS audio the user is hearing.
      const audio =
        playbackFresh && options.getCompanionAudioVision
          ? await Promise.resolve(
              options.getCompanionAudioVision(
                profile,
                cumulativeMusicHistory ? Math.max(30, audioSeconds) : audioSeconds,
              ),
            )
          : {
              available: false,
              ready: false,
              source: "companion-hls-buffer",
              seconds: audioSeconds,
              error:
                "No fresh buffered companion playback clock is available.",
            };
      const musicHistory =
        cumulativeMusicHistory && delayedCutoff !== null
          ? musicCompanionLedger.merge(
              [
                profile,
                rawMediaContext?.url ?? "",
                rawMediaContext?.title ?? "",
                rawMediaContext?.media?.duration ?? "unknown-duration",
              ].join("|"),
              delayedCutoff,
              audio as any,
              Array.isArray(mediaContext?.subtitles)
                ? mediaContext.subtitles
                : [],
            )
          : null;
      const visualCue = assessCompanionVisualCue({
        mediaContext,
        audioVision: audio,
        lastVisualInspectionAt: lastVisualInspectionAt.get(profile) ?? null,
      });
      const presentation =
        options.getPresentationStatus?.(profile) ?? {
          profile,
          viewerCount: 0,
          ambiguousViewer: false,
          lastPresented: null,
        };
      const presentedMedia = presentation.lastPresented?.media ?? null;
      const tongpingPresentedPts =
        delayedCutoff ??
        presentedMedia?.framePts ??
        presentedMedia?.sourcePlayheadPts ??
        null;
      const sourcePlayheadPts =
        typeof rawMediaContext?.media?.currentTime === "number"
          ? rawMediaContext.media.currentTime
          : null;
      const latestBufferedFrame =
        await Promise.resolve(
          options.getCompanionFrame?.(profile, 0) ?? null,
        );
      const receiptMedia =
        latestBufferedFrame?.media ?? null;
      const receiptSession =
        mediaSessionFromLiveMeta(receiptMedia);
      const observedAtPts =
        finiteMediaPts(sourcePlayheadPts) ??
        finiteMediaPts(receiptMedia?.framePts) ??
        finiteMediaPts(receiptMedia?.sourcePlayheadPts);
      const perceptionReceipt =
        receiptSession && observedAtPts !== null
          ? options.issuePerceptionPacket?.({
              profile,
              session: receiptSession,
              observedAtPts,
              source: "companion-context",
              ...buildCompanionContextCoverage(
                mediaContext,
                audio,
                observedAtPts,
              ),
            }) ?? null
          : null;
      const perception =
        options.getPerceptionStatus?.(profile) ?? null;
      const solCommittedPts =
        perception?.solCommittedPts ?? null;
      const perceptionSkewSeconds =
        tongpingPresentedPts !== null &&
        solCommittedPts !== null
          ? tongpingPresentedPts - solCommittedPts
          : null;

      return textResult({
        profile,
        groupChat: groupChatPeek(defaultIdentity),
        media: mediaContext,
        audio,
        musicHistory,
        visualCue,
        presentation,
        timingModel: {
          sourcePlayheadPts,
          tongpingPresentedPts,
          tongpingPresentedPtsStatus:
            tongpingPresentedPts === null
              ? "unavailable"
              : delayedCutoff !== null
                ? "companion-hls-player-current-time"
                : presentedMedia?.ptsQuality === "frame-timestamp"
                  ? "rvfc-frame-pts-bound-to-presented-remote-frame"
                  : "playhead-estimate-bound-to-presented-remote-frame",
          tongpingPresentedPtsSource:
            delayedCutoff !== null
              ? "companion-hls-player"
              : presentedMedia?.ptsSource ?? null,
          mediaSession:
            delayedCutoff !== null
              ? {
                  sessionId: null,
                  playerIdentity: "companion-hls-player",
                  mediaIdentity: null,
                  epoch: null,
                  playbackState: playback?.paused ? "paused" : "playing",
                  playbackRate: 1,
                }
              : presentedMedia
                ? {
                    sessionId: presentedMedia.sessionId,
                    playerIdentity: presentedMedia.playerIdentity,
                    mediaIdentity: presentedMedia.mediaIdentity,
                    epoch: presentedMedia.epoch,
                    playbackState: presentedMedia.playbackState,
                    playbackRate: presentedMedia.playbackRate,
                  }
                : null,
          solCommittedPts,
          solCommittedPtsStatus:
            perception?.solCommittedPtsStatus ?? "unavailable",
          perceptionSkewSeconds,
          perceptionSkewStatus:
            perceptionSkewSeconds === null
              ? "awaiting-tongping-presented-and-ai-committed-pts"
              : "measured-from-presented-vs-engineering-committed-frontier",
          note:
            "Source player time, the user-presented PTS, and AI committed PTS are separate measurements. AI committed PTS is an engineering processing frontier, not a claim of semantic correctness.",
        },
        perceptionReceipt,
        perception,
        audioTiming: {
          clockDomain: "companion-hls-buffer",
          canonicalPtsMapped: delayedCutoff !== null,
          note:
            "Realtime source audio is intentionally excluded during companion playback. Audio Vision is computed from the same delayed HLS audio the user is hearing.",
        },
        companionBuffer:
          (await Promise.resolve(
            (await Promise.resolve(
              options.getCompanionFrameStatus?.(profile) ?? null,
            )),
          )) ?? {
            available: false,
          },
        visualPolicy: {
          defaultSilenceThresholdSeconds: 5,
          visualCooldownSeconds: 4,
          noSubtitleHeartbeatSeconds: 10,
          screenshotAutomatic: false,
          preferredVisualSource: "companion-hls-buffer",
          companionBufferWindowSeconds: 15,
          note:
            "A visualCue is advisory. Prefer browser_companion_frame so video playback is not interrupted; user reactions may justify an immediate buffered visual check.",
        },
        lanePolicy: {
          bufferedMedia: {
            purpose:
              "video/audio/subtitle/visual perception timeline",
            ordering:
              "ordered-by-media-identity-epoch-and-pts",
            coordinateAuthority: false,
          },
          realtimeControl: {
            purpose:
              "navigation, search, click, input, media control and content actions",
            mediaControlsImmediate: true,
            note:
              "Buffered perception backlog must not delay pause, resume, seek, volume, navigation, or user interaction.",
          },
          transitionToControl: {
            requireRealtimePageState: true,
            requireTargetIdentityRevalidation: true,
            bufferedCoordinatesReusable: false,
          },
        },
        contract: {
          spoilerSafe: true,
          futureSubtitleCuesReturned: false,
          rawAudioTransferredToModel: false,
        },
      });
    },
  );

  server.registerTool(
    "browser_companion_frame",
    {
      description:
        "Read one already-observed frame from the rolling co-watching buffer without pausing video or taking a new screenshot. lookbackSeconds selects a frame at or before that point in recent wall-clock history, so future frames are never returned.",
      inputSchema: z.object({
        profile: z.string().default("default"),
        lookbackSeconds: z.number().min(0).max(15).default(0),
      }),
    },
    async ({ profile, lookbackSeconds }) => {
      const frame = await Promise.resolve(
        options.getCompanionFrame?.(
          profile,
          lookbackSeconds,
        ) ?? null,
      );
      if (!frame) {
        return textResult({
          profile,
          available: false,
          source: "companion-buffer",
          lookbackSeconds,
          buffer:
            options.getCompanionFrameStatus?.(profile) ?? null,
          playbackInterrupted: false,
          fallbackScreenshotUsed: false,
          controlSafety: {
            coordinateAuthority: false,
            bufferedCoordinatesReusable: false,
            requireRealtimePageState: true,
            requireTargetIdentityRevalidation: true,
          },
        });
      }

      lastVisualInspectionAt.set(profile, Date.now());
      const frameSession = mediaSessionFromLiveMeta(frame.media);
      const framePts =
        finiteMediaPts(frame.media?.framePts) ??
        finiteMediaPts(frame.media?.sourcePlayheadPts);
      const perceptionReceipt =
        frameSession && framePts !== null
          ? options.issuePerceptionPacket?.({
              profile,
              session: frameSession,
              observedAtPts: framePts,
              source: "companion-frame",
              coverage: {
                context: [{ startPts: framePts, endPts: framePts }],
                visual: [{ startPts: framePts, endPts: framePts }],
                metadata: [{ startPts: framePts, endPts: framePts }],
              },
              missing: {},
            }) ?? null
          : null;
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              profile,
              available: true,
              source: options.companionFrameSource ?? "companion-hls-buffer",
              lookbackSeconds,
              sequence: frame.sequence,
              capturedAt: frame.capturedAt,
              storedAt: frame.storedAt,
              ageMs: frame.ageMs,
              requestedLookbackMs: frame.requestedLookbackMs,
              offsetFromTargetMs: frame.offsetFromTargetMs,
              viewport: frame.viewport,
              media: frame.media ?? null,
              perceptionReceipt,
              playbackInterrupted: false,
              fallbackScreenshotUsed: false,
              futureFrameReturned: false,
              controlSafety: {
                coordinateAuthority: false,
                bufferedCoordinatesReusable: false,
                requireRealtimePageState: true,
                requireTargetIdentityRevalidation: true,
                note:
                  "This frame is perception evidence only. Before navigation, click, like, comment, or other realtime control, reacquire current page state and revalidate the target media identity.",
              },
            }),
          },
          {
            type: "image" as const,
            data: frame.buffer.toString("base64"),
            mimeType: "image/jpeg",
          },
        ],
      };
    },
  );

  server.registerTool(
    "browser_companion_commit",
    {
      description:
        "Mark one previously returned companion perception receipt as processed. If its media/session/epoch is still current, its explicit coverage is committed; stale work is invalidated instead of advancing AI progress. Use failed when processing did not complete.",
      inputSchema: z.object({
        profile: z.string().default("default"),
        packetId: z.string().min(8).max(128),
        attemptId: z.string().min(8).max(128).optional(),
        outcome: z.enum(["processed", "failed"]).default("processed"),
        reason: z.string().max(240).optional(),
        modalities: z.array(
          z.enum(["context", "subtitle", "audio", "visual", "metadata"]),
        ).max(5).optional(),
      }),
    },
    async ({
      profile,
      packetId,
      attemptId,
      outcome,
      reason,
      modalities,
    }) => {
      const receipt =
        outcome === "failed"
          ? options.failPerceptionPacket?.(
              packetId,
              reason?.trim() || "processing-failed",
            ) ?? null
          : options.commitPerceptionPacket?.(packetId, {
              modalities,
              attemptId: attemptId ?? null,
            }) ?? null;

      if (!receipt) {
        return errorResult(
          "Unknown perception packet or perception ledger unavailable.",
        );
      }
      if (receipt.profile !== profile) {
        return errorResult(
          "Perception packet belongs to a different browser profile.",
        );
      }

      return textResult({
        receipt,
        perception:
          options.getPerceptionStatus?.(profile) ?? null,
        staleResultRejected:
          receipt.disposition === "invalidated",
        committed:
          receipt.disposition === "accepted" &&
          receipt.committedAt !== null,
      });
    },
  );

  server.registerTool(
    "browser_read",
    {
      description:
        "Read the current page or a CSS selector. format=text returns visible text; format=html returns bounded outerHTML plus resolved img currentSrc/src metadata, useful for image carousels.",
      inputSchema: z.object({
        profile: z.string().default("default"),
        selector: z.string().default("body"),
        maxChars: z.number().int().min(1000).max(100000).default(30000),
        format: z.enum(["text", "html"]).default("text"),
      }),
    },
    async ({ profile, selector, maxChars, format }) => {
      const relayPrefix = "__tongping_chat_push__::";
      if (selector.startsWith(relayPrefix)) {
        const payload = selector.slice(relayPrefix.length);
        const splitAt = payload.indexOf("::");
        if (splitAt <= 0) {
          return errorResult("Invalid in-app chat relay selector.");
        }
        const identity = payload.slice(0, splitAt);
        const text = payload.slice(splitAt + 2);
        try {
          const message = appChatLedger.push({
            profile,
            identity,
            role: "assistant",
            text,
          });
          return textResult({
            ok: true,
            mirrored: true,
            compatibilityRelay: "browser_read",
            seq: message.seq,
            profile,
            identity,
          });
        } catch (error) {
          return errorResult(errorMessage(error));
        }
      }
      return call("browser_read", {
        profile,
        selector,
        maxChars,
        format,
      });
    },
  );

  server.registerTool(
    "browser_snapshot",
    {
      description:
        "Return a compact semantic snapshot. selector scopes the DOM root, offset paginates large pages, and includeImages adds visible img src/alt/dimensions. Refs are temporary.",
      inputSchema: z.object({
        profile: z.string().default("default"),
        maxElements: z.number().int().min(1).max(250).default(120),
        selector: z.string().default("body"),
        offset: z.number().int().min(0).max(10000).default(0),
        includeImages: z.boolean().default(false),
      }),
    },
    async ({ profile, maxElements, selector, offset, includeImages }) =>
      call("browser_snapshot", {
        profile,
        maxElements,
        selector,
        offset,
        includeImages,
      }),
  );

  server.registerTool(
    "browser_hover",
    {
      description:
        "Hover either a semantic ref or viewport coordinates. Use this to reveal controls that only enter the DOM on hover, then take a fresh browser_snapshot.",
      inputSchema: z.object({
        profile: z.string().default("default"),
        ref: z.string().optional(),
        x: z.number().finite().nonnegative().optional(),
        y: z.number().finite().nonnegative().optional(),
      }),
    },
    async ({ profile, ref, x, y }) =>
      call("browser_hover", {
        profile,
        ...(ref ? { ref } : {}),
        ...(x !== undefined ? { x } : {}),
        ...(y !== undefined ? { y } : {}),
      }),
  );

  server.registerTool(
    "browser_click",
    {
      description:
        "Click either a semantic ref or viewport coordinates. Coordinate clicks are a fallback for visible controls without refs; sensitive coordinate targets are blocked and must use the ref approval flow.",
      inputSchema: z.object({
        profile: z.string().default("default"),
        ref: z.string().optional(),
        x: z.number().finite().nonnegative().optional(),
        y: z.number().finite().nonnegative().optional(),
        approvalId: z.string().optional(),
      }),
    },
    async ({ profile, ref, x, y, approvalId }) =>
      call("browser_click", {
        profile,
        ...(ref ? { ref } : {}),
        ...(x !== undefined ? { x } : {}),
        ...(y !== undefined ? { y } : {}),
        ...(approvalId ? { approvalId } : {}),
      }),
  );

  server.registerTool(
    "browser_request_click_approval",
    {
      description:
        "Request the user's explicit one-shot approval for a click target classified as purchase/payment/destructive. The approval expires and is bound to the exact target.",
      inputSchema: z.object({
        profile: z.string().default("default"),
        ref: z.string(),
        reason: z.string().max(300).optional(),
      }),
    },
    async ({ profile, ref, reason }) =>
      call("browser_request_click_approval", {
        profile,
        ref,
        ...(reason ? { reason } : {}),
      }),
  );

  server.registerTool(
    "browser_approval_status",
    {
      description:
        "Check one explicit click approval request. Approved tokens are one-shot and must be passed to browser_click.",
      inputSchema: z.object({
        profile: z.string().default("default"),
        approvalId: z.string(),
      }),
    },
    async ({ profile, approvalId }) =>
      call("browser_approval_status", {
        profile,
        approvalId,
      }),
  );

  server.registerTool(
    "browser_double_click",
    {
      description:
        "Double-click one semantic element ref. Useful for native gestures such as double-clicking a video to like it.",
      inputSchema: z.object({
        profile: z.string().default("default"),
        ref: z.string(),
      }),
    },
    async ({ profile, ref }) =>
      call("browser_double_click", { profile, ref }),
  );

  server.registerTool(
    "browser_type",
    {
      description:
        "Fill or append text into an element ref from the latest snapshot. Password fields are always blocked; enter credentials manually.",
      inputSchema: z.object({
        profile: z.string().default("default"),
        ref: z.string(),
        text: z.string(),
        append: z.boolean().default(false),
      }),
    },
    async ({ profile, ref, text, append }) =>
      call("browser_type", { profile, ref, text, append }),
  );

  server.registerTool(
    "browser_press",
    {
      description:
        "Press a safe navigation/submit key on one semantic element ref, such as Enter, Escape, Tab, Space, or Arrow keys.",
      inputSchema: z.object({
        profile: z.string().default("default"),
        ref: z.string(),
        key: z.enum([
          "Enter", "Escape", "Tab", "Space",
          "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
          "Home", "End", "PageUp", "PageDown",
        ]),
      }),
    },
    async ({ profile, ref, key }) =>
      call("browser_press", { profile, ref, key }),
  );

  server.registerTool(
    "browser_select",
    {
      description: "Select an option value in a select element ref.",
      inputSchema: z.object({
        profile: z.string().default("default"),
        ref: z.string(),
        value: z.string(),
      }),
    },
    async ({ profile, ref, value }) =>
      call("browser_select", { profile, ref, value }),
  );

  server.registerTool(
    "browser_set_files",
    {
      description:
        "Attach 1-8 small files to a file-input ref. Intended for small image uploads; each file is capped at 4 MB and total payload at 8 MB. This stages files in the form but does not publish or submit the form.",
      inputSchema: z.object({
        profile: z.string().default("default"),
        ref: z.string(),
        files: z.array(z.object({
          name: z.string().min(1).max(120),
          mimeType: z.string().min(3).max(120),
          base64: z.string().min(4),
        })).min(1).max(8),
      }),
    },
    async ({ profile, ref, files }) =>
      call("browser_set_files", { profile, ref, files }),
  );

  server.registerTool(
    "browser_scroll",
    {
      description:
        "Scroll the current page by a signed number of CSS pixels. Positive values scroll down.",
      inputSchema: z.object({
        profile: z.string().default("default"),
        deltaY: z.number().int().min(-10000).max(10000).default(800),
      }),
    },
    async ({ profile, deltaY }) =>
      call("browser_scroll", { profile, deltaY }),
  );

  server.registerTool(
    "browser_wait",
    {
      description: "Wait briefly for a dynamic page to settle.",
      inputSchema: z.object({
        profile: z.string().default("default"),
        ms: z.number().int().min(0).max(BROWSER_WAIT_MAX_MS).default(BROWSER_WAIT_DEFAULT_MS),
      }),
    },
    async ({ profile, ms }) =>
      call("browser_wait", { profile, ms }),
  );

  server.registerTool(
    "browser_screenshot",
    {
      description:
        "Capture the current viewport. Omit profile to capture the browser the user is watching in their open TongPing card. When live view is active, reuse its newest frame without interrupting video playback.",
      inputSchema: z.object({
        profile: z.string().default(""),
        fullPage: z.boolean().default(false),
      }),
    },
    async ({ profile: requestedProfile, fullPage }) => {
      const viewerProfile = options.getViewerProfile?.() ?? null;
      const profile = requestedProfile || viewerProfile || "default";
      // Never launch a blank window just to photograph it: say which
      // browser the user is actually on instead.
      const profilesReply = await gateway.call("browser_profiles", {});
      const profiles = Array.isArray(profilesReply.result)
        ? profilesReply.result as Array<{ profile?: string; active?: boolean; url?: string; modelReadable?: boolean }>
        : [];
      const target = profiles.find((row) => row.profile === profile);
      if (target?.modelReadable === false) {
        return errorResult("This browser page uses a privileged URL and cannot be captured by model tools.");
      }
      if (profilesReply.ok && (!target || !target.active)) {
        const watching = profiles.find((row) => row.profile === viewerProfile && row.active);
        return textResult({
          available: false,
          profile,
          reason: "This profile has no open browser window, so there is nothing to capture.",
          userIsViewing: watching
            ? { profile: watching.profile, url: watching.url ?? "" }
            : null,
          hint: watching
            ? "Call browser_screenshot again with profile=" + watching.profile + " (or omit profile)."
            : "Ask the user which profile to look at.",
        });
      }
      if (
        !fullPage &&
        options.appSigningKey &&
        options.liveEnabled &&
        profilesReply.ok &&
        target?.active &&
        target.modelReadable === true &&
        typeof target.url === "string"
      ) {
        const singleFrameUrl = createBrowserSingleFrameUrl(
          appOrigin,
          options.appSigningKey,
          profile,
          45,
          "live",
        );
        try {
          const liveFrameResponse = await fetch(singleFrameUrl, {
            signal: AbortSignal.timeout(3_000),
          });
          if (liveFrameResponse.ok) {
            const imageBase64 = Buffer.from(
              await liveFrameResponse.arrayBuffer(),
            ).toString("base64");
            // Recheck after the fetch so a navigation while the frame is in
            // flight cannot turn a previously readable profile into output.
            const currentReply = await gateway.call("browser_profiles", {});
            const current = Array.isArray(currentReply.result)
              ? (currentReply.result as Array<{ profile?: string; active?: boolean; url?: string; modelReadable?: boolean }>)
                  .find((row) => row.profile === profile)
              : undefined;
            if (
              imageBase64 &&
              currentReply.ok &&
              current?.active &&
              current.modelReadable === true &&
              current.url === target.url
            ) {
              lastVisualInspectionAt.set(profile, Date.now());
              return {
                content: [
                  { type: "text" as const, text: JSON.stringify({ fullPage: false, source: "live-frame-cache" }) },
                  {
                    type: "image" as const,
                    data: imageBase64,
                    mimeType: liveFrameResponse.headers.get("content-type")?.split(";")[0] ?? "image/jpeg",
                  },
                ],
              };
            }
          }
        } catch {
          // No safe fresh frame: use the worker's guarded screenshot path.
        }
      }
      const reply = await gateway.call("browser_screenshot", {
        profile,
        fullPage,
      });

      if (!reply.ok) {
        return errorResult(reply.error ?? "Screenshot failed");
      }

      const payload = reply.result as {
        title?: string;
        url?: string;
        fullPage?: boolean;
        mimeType?: string;
        base64?: string;
        frameUrl?: string;
      };

      let imageBase64 = payload?.base64 ?? "";
      if (!imageBase64 && payload?.frameUrl) {
        const frameResponse = await fetch(payload.frameUrl, {
          signal: AbortSignal.timeout(10_000),
        });
        if (!frameResponse.ok) {
          return errorResult(`Screenshot frame fetch failed: HTTP ${frameResponse.status}`);
        }
        imageBase64 = Buffer.from(
          await frameResponse.arrayBuffer(),
        ).toString("base64");
      }
      if (!imageBase64) {
        return errorResult(
          "Screenshot response did not include image data",
        );
      }

      lastVisualInspectionAt.set(profile, Date.now());
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              title: payload.title,
              url: payload.url,
              fullPage: payload.fullPage,
              frameUrl:
                options.appSigningKey
                  ? createBrowserFrameUrl(
                      appOrigin,
                      options.appSigningKey,
                      profile,
                      45,
                    )
                  : undefined,
            }),
          },
          {
            type: "image" as const,
            data: imageBase64,
            mimeType: payload.mimeType ?? "image/png",
          },
        ],
      };
    },
  );

  server.registerTool(
    "browser_close_profile",
    {
      description:
        "Close the live browser process for one profile. Persistent cookies and storage remain on disk.",
      inputSchema: z.object({
        profile: z.string().default("default"),
      }),
    },
    async ({ profile }) =>
      call("browser_close_profile", { profile }),
  );

  return server;
}


function mediaSessionFromLiveMeta(
  media: import("./live-ws-hub.js").LiveFrameMediaMeta | null | undefined,
): CompanionMediaSessionIdentity | null {
  if (!media) return null;
  if (
    !media.sessionId ||
    !media.playerIdentity ||
    !media.mediaIdentity ||
    !Number.isInteger(media.epoch) ||
    media.epoch < 0
  ) {
    return null;
  }
  return {
    sessionId: media.sessionId,
    playerIdentity: media.playerIdentity,
    mediaIdentity: media.mediaIdentity,
    epoch: media.epoch,
  };
}

function finiteMediaPts(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0
    ? value
    : null;
}

export function buildCompanionContextCoverage(
  mediaContext: any,
  audioVision: any,
  observedAtPts: number,
): Pick<CompanionPerceptionPacketInput, "coverage" | "missing"> {
  const subtitleIntervals: CompanionCoverageInterval[] = [];
  const subtitles = Array.isArray(mediaContext?.subtitles)
    ? mediaContext.subtitles
    : [];
  for (const cue of subtitles) {
    const start = finiteMediaPts(cue?.startTime);
    const end = finiteMediaPts(cue?.endTime);
    if (start === null || end === null) continue;
    subtitleIntervals.push({
      startPts: Math.min(start, end),
      endPts: Math.max(start, end),
    });
  }

  const audioTimeline = Array.isArray(audioVision?.timeline)
    ? audioVision.timeline
    : [];
  const audioAvailable =
    audioVision?.ready === true &&
    audioTimeline.length > 0;

  const metadataIntervals: CompanionCoverageInterval[] = [{
    startPts: observedAtPts,
    endPts: observedAtPts,
  }];
  const contextIntervals = mergeCompanionCoverageIntervals([
    ...subtitleIntervals,
    ...metadataIntervals,
  ]);

  const missing: CompanionPerceptionPacketInput["missing"] = {
    visual: "not-inspected-in-context",
  };
  if (mediaContext?.source === "none") {
    missing.subtitle = "subtitle-source-unavailable";
  }
  missing.audio = audioAvailable
    ? "audio-present-but-canonical-pts-unmapped"
    : "audio-timeline-unavailable";

  return {
    coverage: {
      context: contextIntervals,
      ...(subtitleIntervals.length > 0
        ? {
            subtitle:
              mergeCompanionCoverageIntervals(subtitleIntervals),
          }
        : {}),
      metadata: metadataIntervals,
    },
    missing,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export { pickTicketQuote, ticketMoodFromAudio } from "./ticket-quote.js";
