import fs from "node:fs/promises";
import { CHALLENGE_DOM_PROBE, challengeFromUrl, isChallengeSite } from "./verification-challenge.js";
import path from "node:path";
import { chromium, type BrowserContext, type CDPSession, type Frame, type Page } from "playwright";
import type { BrowserConfig } from "./config.js";
import { gateSubtitleCues, type RawSubtitleCue } from "./media-context.js";
import { WindowsOcr, mergeOcrCue, pickSubtitleText } from "./subtitle-ocr.js";
import { LocalAsr, pcm16Rms, pcm16ToWav } from "./subtitle-asr.js";

interface ActiveProfile {
  context: BrowserContext;
  audioBindingInstalled?: boolean;
  mediaBindingInstalled?: boolean;
  asrBindingInstalled?: boolean;
  mediaClockBindingInstalled?: boolean;
  mediaClockInitInstalled?: boolean;
  /** Tabs in the order the person last looked at them (newest last). */
  shownPages: Page[];
}

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

interface LiveScreencast {
  session: CDPSession;
  page: Page;
  listener: (event: any) => void;
  onFrame: LiveFrameHandler;
}

type LiveFrameHandler = (frame: {
  buffer: Buffer;
  width: number;
  height: number;
  sequence: number;
  capturedAt: number;
  media: LiveFrameMediaMeta | null;
}) => void | Promise<void>;

export interface LiveAudioChunk {
  buffer: Buffer;
  sampleRate: number;
  channels: number;
  frames: number;
  sequence: number;
  capturedAt: number;
  mediaTime: number;
}

interface LiveAudioCapture {
  page: Page;
  capturePage?: Page;
  frame?: Frame;
  mode?: "tab-output" | "media-element";
  onChunk: (chunk: LiveAudioChunk) => void | Promise<void>;
  sequence: number;
  startedAt: number;
  lastChunkAt: number;
}

export interface LiveMediaEvent {
  type: "start" | "segment" | "end";
  streamId: string;
  mimeType: string;
  sequence: number;
  capturedAt: number;
  buffer?: Buffer;
}

interface LiveMediaCapture {
  page: Page;
  capturePage: Page;
  onEvent: (event: LiveMediaEvent) => void | Promise<void>;
  sequence: number;
  streamId: string;
}

export interface SnapshotElement {
  ref: string;
  tag: string;
  role: string | null;
  text: string;
  href: string | null;
  title: string | null;
  ariaLabel: string | null;
  dataE2E: string | null;
  ariaPressed: string | null;
  inputType: string | null;
  disabled: boolean;
  checked: boolean | null;
  src: string | null;
  alt: string | null;
  naturalWidth: number | null;
  naturalHeight: number | null;
  rect: { x: number; y: number; width: number; height: number } | null;
}

/** Keep viewport screenshots under the hosted 1.5 MiB PNG cap with margin. */
const SCREENSHOT_SOFT_LIMIT_BYTES = 1_400_000;

export class BrowserManager {
  private readonly active = new Map<string, ActiveProfile>();
  private readonly liveScreencasts = new Map<string, LiveScreencast>();
  private readonly liveAudioCaptures = new Map<string, LiveAudioCapture>();
  private readonly liveMediaCaptures = new Map<string, LiveMediaCapture>();
  private readonly liveMediaClock = new Map<string, LiveFrameMediaMeta>();
  private readonly mediaClockFallbackBusy = new Set<string>();
  private readonly mediaClockFallbackLastAttemptAt = new Map<string, number>();
  private readonly mediaClockFallbackState = new Map<string, {
    page: Page;
    documentKey: string;
    sessionId: string;
    epoch: number;
    lastPlayerIdentity: string;
    lastMediaIdentity: string;
    lastSeeking: boolean;
    lastSourcePlayheadPts: number | null;
    lastSampledAt: number;
    lastPlaybackState: LiveFrameMediaMeta["playbackState"] | "";
    lastPlaybackRate: number;
  }>();
  private mediaClockFallbackSessionSeq = 0;
  private readonly audioHelperPages = new Set<Page>();
  private readonly mediaHelperPages = new Set<Page>();
  private readonly observedSubtitleHistory = new Map<string, {
    mediaKey: string;
    cues: RawSubtitleCue[];
  }>();

  constructor(private readonly config: BrowserConfig) {}

  async open(profile: string, url?: string): Promise<Page> {
    const normalized = normalizeProfile(profile);
    let active = this.active.get(normalized);

    if (!active) {
      await fs.mkdir(this.config.profilesDir, { recursive: true });
      const userDataDir = path.join(this.config.profilesDir, normalized);
      await fs.mkdir(userDataDir, { recursive: true });

      const context = await chromium.launchPersistentContext(userDataDir, {
        headless: this.config.headless,
        executablePath: this.config.executablePath,
        channel: this.config.channel,
        // Chrome must be allowed to refresh Widevine before DRM-protected
        // services such as Netflix can start playback. Playwright disables
        // component updates by default, which sends Netflix to M7701-1003.
        ignoreDefaultArgs: ["--disable-component-update"],
        locale: this.config.locale,
        timezoneId: this.config.timezoneId,
        viewport: this.config.headless ? { width: 768, height: 1024 } : null,
        args: [
          "--disable-background-timer-throttling",
          "--disable-backgrounding-occluded-windows",
          "--disable-renderer-backgrounding",
          "--disable-features=CalculateNativeWinOcclusion",
          "--autoplay-policy=no-user-gesture-required",
          "--enable-experimental-web-platform-features",
          "--auto-select-tab-capture-source-by-title=TongPing Audio Source",
        ],
      });

      context.setDefaultTimeout(15_000);
      active = { context, shownPages: [] };
      this.active.set(normalized, active);
      await this.trackShownTab(normalized, active);
      // If the window is closed by hand (or Chrome crashes), forget this
      // context so the next request relaunches the profile instead of
      // failing forever with "Target page, context or browser has been closed".
      context.on("close", () => {
        if (this.active.get(normalized)?.context !== context) return;
        this.active.delete(normalized);
        this.liveMediaCaptures.delete(normalized);
        void this.stopLiveScreencast(normalized).catch(() => {});
        void this.stopLiveAudio(normalized).catch(() => {});
      });
    }

    let page = this.currentPage(active);
    if (!page) page = await active.context.newPage();

    if (url && page.url() !== url) {
      await page.goto(url, { waitUntil: "domcontentloaded" });
    }

    return page;
  }

  async page(profile: string): Promise<Page> {
    return this.open(profile);
  }

  /**
   * A minimized window stops painting: screenshots come back white and the
   * live view freezes. Bring it back (without stealing focus) if someone
   * minimized it. Only looks at a profile that is already running.
   */
  async restoreWindowIfMinimized(profile: string): Promise<boolean> {
    if (this.config.headless) return false;
    const active = this.active.get(normalizeProfile(profile));
    const page = active ? this.currentPage(active) : undefined;
    if (!page) return false;
    let cdp: CDPSession | undefined;
    try {
      cdp = await page.context().newCDPSession(page);
      const { windowId, bounds } = await cdp.send("Browser.getWindowForTarget") as {
        windowId: number;
        bounds: { windowState?: string };
      };
      if (bounds.windowState !== "minimized") return false;
      await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
      return true;
    } catch {
      return false;
    } finally {
      if (cdp) void cdp.detach().catch(() => undefined);
    }
  }

  private isUserPage(candidate: Page): boolean {
    return (
      !candidate.isClosed() &&
      !this.audioHelperPages.has(candidate) &&
      !this.mediaHelperPages.has(candidate) &&
      !isCaptureHelperPage(candidate)
    );
  }

  /**
   * The tab the person is looking at: the one most recently shown in the
   * window (a tab switch, or a link that opened a new tab). Falls back to
   * the newest tab when nothing has been shown yet.
   */
  private currentPage(active: ActiveProfile): Page | undefined {
    const open = active.context.pages().filter((page) => this.isUserPage(page));
    active.shownPages = active.shownPages.filter((page) => !page.isClosed());
    for (let i = active.shownPages.length - 1; i >= 0; i -= 1) {
      const page = active.shownPages[i];
      if (page && open.includes(page)) return page;
    }
    return open.at(-1);
  }

  private async trackShownTab(profile: string, active: ActiveProfile): Promise<void> {
    await active.context.exposeBinding(
      "__tongpingTabShown",
      ({ page }) => {
        if (this.active.get(profile) !== active || page.isClosed()) return;
        const before = this.currentPage(active);
        active.shownPages = active.shownPages.filter((item) => item !== page);
        active.shownPages.push(page);
        if (active.shownPages.length > 32) active.shownPages.shift();
        if (this.currentPage(active) !== before) this.followShownTab(profile);
      },
    );
    await active.context.addInitScript(installTongpingTabShownProbe);
    await Promise.allSettled(
      active.context.pages().map((page) => page.evaluate(installTongpingTabShownProbe)),
    );
  }

  private readonly followChains = new Map<string, Promise<void>>();
  private readonly shownTabListeners = new Set<(profile: string) => void>();

  /** Called after the person switches to another tab (live already followed). */
  onShownTabChange(listener: (profile: string) => void): void {
    this.shownTabListeners.add(listener);
  }

  /** Move a running live screencast onto the tab the person switched to. */
  private followShownTab(profile: string): void {
    const previous = this.followChains.get(profile) ?? Promise.resolve();
    const next = previous.then(async () => {
      const live = this.liveScreencasts.get(profile);
      const active = this.active.get(profile);
      if (!active) return;
      const page = this.currentPage(active);
      if (!page) return;
      if (live && page !== live.page) {
        await this.startLiveScreencast(profile, live.onFrame).catch(() => {});
      }
      const media = this.liveMediaCaptures.get(profile);
      if (media && media.page !== page) {
        for (const listener of this.shownTabListeners) {
          try { listener(profile); } catch {}
        }
      }
    }).catch(() => {});
    this.followChains.set(profile, next);
  }

  private readonly ocr = new WindowsOcr();
  private readonly ocrLoops = new Map<string, {
    timer: ReturnType<typeof setInterval>;
    busy: boolean;
    key: string;
    cues: RawSubtitleCue[];
    lastPts: number | null;
  }>();

  // While companion capture runs, read the burned-in subtitle band of the
  // on-screen video about once a second and keep timed cues (source media
  // time). They are served through readMediaContext, so the usual
  // timestamp gate still hides anything the user has not been shown yet.
  private startSubtitleOcr(profile: string): void {
    if (!this.ocr.available() || this.ocrLoops.has(profile)) return;
    const loop = {
      timer: setInterval(() => { void tick(); }, 1_000),
      busy: false,
      key: "",
      cues: [] as RawSubtitleCue[],
      lastPts: null as number | null,
    };
    loop.timer.unref?.();
    this.ocrLoops.set(profile, loop);
    const tick = async () => {
      if (loop.busy) return;
      const capture = this.liveMediaCaptures.get(profile);
      if (!capture || capture.page.isClosed()) {
        this.stopSubtitleOcr(profile);
        return;
      }
      loop.busy = true;
      try {
        const page = capture.page;
        // Crop the subtitle band from the video frame inside the page (no
        // CDP screenshot: on a headed window those flash the whole tab and
        // could leak into the companion recording).
        const info = await page.evaluate(() => {
          let best: HTMLVideoElement | null = null;
          let bestScore = -1;
          for (const video of Array.from(document.querySelectorAll("video"))) {
            const rect = video.getBoundingClientRect();
            const area =
              Math.max(0, Math.min(window.innerWidth, rect.right) - Math.max(0, rect.left)) *
              Math.max(0, Math.min(window.innerHeight, rect.bottom) - Math.max(0, rect.top));
            if (area <= 0 || video.videoWidth <= 0 || video.videoHeight <= 0) continue;
            const score = (video.paused ? 0 : 1_000_000_000) + area;
            if (score > bestScore) { best = video; bestScore = score; }
          }
          if (!best) return null;
          const vw = best.videoWidth;
          const vh = best.videoHeight;
          const sx = Math.round(vw * 0.08);
          const sy = Math.round(vh * 0.6);
          const sw = Math.round(vw * 0.84);
          const sh = Math.round(vh * 0.36);
          const scale = Math.min(1, 900 / sw);
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(sw * scale));
          canvas.height = Math.max(1, Math.round(sh * scale));
          const ctx = canvas.getContext("2d");
          if (!ctx) return null;
          let png = "";
          try {
            ctx.drawImage(best, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
            png = canvas.toDataURL("image/png");
          } catch {
            // Cross-origin video without CORS: the canvas is tainted.
            png = "";
          }
          return {
            png,
            cropWidth: canvas.width,
            currentTime: Number.isFinite(best.currentTime) ? best.currentTime : 0,
            duration: Number.isFinite(best.duration) ? best.duration : 0,
            paused: best.paused,
          };
        });
        if (!info || !info.png) return;
        if (info.paused && loop.lastPts === info.currentTime) return;
        loop.lastPts = info.currentTime;
        const key = page.url() + "|" + Math.round(info.duration);
        if (key !== loop.key) {
          loop.key = key;
          loop.cues = [];
        }
        const marker = info.png.indexOf("base64,");
        if (marker < 0) return;
        const lines = await this.ocr.recognize(Buffer.from(info.png.slice(marker + 7), "base64"));
        if (!lines) return;
        mergeOcrCue(loop.cues, pickSubtitleText(lines, info.cropWidth), info.currentTime);
      } catch {
        // A missed second is fine; the next tick tries again.
      } finally {
        loop.busy = false;
      }
    };
  }

  private stopSubtitleOcr(profile: string): void {
    const loop = this.ocrLoops.get(profile);
    if (!loop) return;
    clearInterval(loop.timer);
    this.ocrLoops.delete(profile);
  }

  private readonly asr = new LocalAsr();
  private readonly asrStates = new Map<string, {
    chunks: Buffer[];
    bytes: number;
    firstAt: number;
    busy: boolean;
    key: string;
    cues: RawSubtitleCue[];
  }>();

  // Collect ~8 s of companion audio, skip silence, transcribe locally and
  // keep cues on the source-media clock (so the usual gate still applies).
  private pushAsrAudio(profile: string, pcm: Buffer, capturedAt: number): void {
    if (!this.asr.available()) return;
    this.ensureAudioSourceClock(profile);
    let state = this.asrStates.get(profile);
    if (!state) {
      state = { chunks: [], bytes: 0, firstAt: 0, busy: false, key: "", cues: [] };
      this.asrStates.set(profile, state);
    }
    if (state.bytes === 0) state.firstAt = capturedAt;
    state.chunks.push(pcm);
    state.bytes += pcm.length;
    if (state.bytes < 16_000 * 2 * 8) return;
    const clip = Buffer.concat(state.chunks);
    const startAt = state.firstAt;
    state.chunks = [];
    state.bytes = 0;
    if (state.busy || pcm16Rms(clip) < 250) return;
    const clock = this.audioSourceClock.get(profile);
    if (!clock || Math.abs(startAt - clock.at) > 15_000) return;
    const pts0 = clock.paused
      ? clock.pts
      : clock.pts + ((startAt - clock.at) / 1000) * clock.rate;
    const key = clock.key;
    const current = state;
    current.busy = true;
    void this.asr.transcribe(pcm16ToWav(clip, 16_000)).then((segments) => {
      if (!segments) return;
      if (key !== current.key) {
        current.key = key;
        current.cues = [];
      }
      for (const segment of segments) {
        if (!segment.text) continue;
        current.cues.push({
          startTime: pts0 + segment.start,
          endTime: pts0 + Math.max(segment.start, segment.end),
          text: segment.text,
          track: "asr",
          language: "auto",
        });
      }
      if (current.cues.length > 600) current.cues.splice(0, current.cues.length - 600);
    }).catch(() => {}).finally(() => { current.busy = false; });
  }

  private readonly audioSourceClock = new Map<string, {
    pts: number;
    at: number;
    rate: number;
    paused: boolean;
    key: string;
  }>();
  private readonly audioSourceClockPollers = new Map<string, ReturnType<typeof setInterval>>();

  // Poll the on-screen video's clock (cheap read) while tab-output audio
  // capture is running, so audio features carry real media time.
  private ensureAudioSourceClock(profile: string): void {
    if (this.audioSourceClockPollers.has(profile)) return;
    const poll = async () => {
      if (!this.liveAudioCaptures.get(profile) && !this.liveMediaCaptures.get(profile)) {
        const timer = this.audioSourceClockPollers.get(profile);
        if (timer) clearInterval(timer);
        this.audioSourceClockPollers.delete(profile);
        this.audioSourceClock.delete(profile);
        return;
      }
      const reading = await this.readMediaClock(profile).catch(() => null);
      const media = reading?.media ?? null;
      if (!media) return;
      this.audioSourceClock.set(profile, {
        pts: media.currentTime,
        at: Date.now(),
        rate: media.playbackRate > 0 ? media.playbackRate : 1,
        paused: media.paused,
        key: (reading?.url ?? "") + "|" + Math.round(media.duration ?? 0),
      });
    };
    const timer = setInterval(() => { void poll(); }, 2_000);
    timer.unref?.();
    this.audioSourceClockPollers.set(profile, timer);
    void poll();
  }

  // tsx/esbuild keeps a __name() helper around named inner functions it
  // serializes into page.evaluate(). Pages that never started the live-audio
  // lane (e.g. companion-only watching) had no shim, so media reads threw
  // and reported no video. Install it wherever we evaluate named helpers.
  private async ensureNameShim(page: Page): Promise<void> {
    const shim =
      'globalThis.__name = globalThis.__name || ((target, value) => target);';
    await page.addInitScript({ content: shim }).catch(() => {});
    await Promise.all(
      page.frames().map((frame) => frame.evaluate(shim).catch(() => {})),
    );
  }

  // Just the source clock (no subtitle scan): cheap enough to poll every
  // few seconds during companion watching. readMediaContext walks the whole
  // page for subtitles, which starved tab capture when polled that often.
  async readMediaClock(profile: string): Promise<{
    profile: string;
    url: string;
    media: null | {
      currentTime: number;
      duration: number | null;
      paused: boolean;
      playbackRate: number;
    };
  }> {
    const normalized = normalizeProfile(profile);
    const page = await this.page(normalized);
    const media = await Promise.race([
      page.evaluate(() => {
        // Feeds like Douyin keep preloaded clips (sometimes already playing,
        // muted) outside the viewport. What the viewer sees wins: any video
        // with on-screen area beats every off-screen one, then playing, then
        // size.
        let best: HTMLVideoElement | null = null;
        let bestScore = -1;
        for (const video of Array.from(document.querySelectorAll("video"))) {
          const rect = video.getBoundingClientRect();
          const style = getComputedStyle(video);
          const area =
            style.visibility === "hidden" || Number(style.opacity) === 0
              ? 0
              : Math.max(0, Math.min(window.innerWidth, rect.right) - Math.max(0, rect.left)) *
                Math.max(0, Math.min(window.innerHeight, rect.bottom) - Math.max(0, rect.top));
          const score =
            (area > 0 ? 1_000_000_000_000 : 0) +
            (video.paused ? 0 : 1_000_000_000) +
            (video.readyState >= 2 ? 1_000_000 : 0) +
            Math.min(area, 999_999);
          if (score > bestScore) {
            best = video;
            bestScore = score;
          }
        }
        if (!best) return null;
        return {
          currentTime: Number.isFinite(best.currentTime) ? Math.max(0, best.currentTime) : 0,
          duration: Number.isFinite(best.duration) && best.duration >= 0 ? best.duration : null,
          paused: best.paused,
          playbackRate: Number.isFinite(best.playbackRate) ? best.playbackRate : 1,
        };
      }).catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
    ]);
    return { profile: normalized, url: page.url(), media };
  }

  async readMediaContext(
    profile: string,
    lookbackSeconds = 120,
    maxCues = 120,
  ): Promise<{
    profile: string;
    url: string;
    title: string;
    media: null | {
      tag: string;
      currentTime: number;
      duration: number | null;
      paused: boolean;
      readyState: number;
    };
    subtitles: ReturnType<typeof gateSubtitleCues>;
    spoilerBoundary: {
      mode: "timestamp-gated";
      cutoffMediaTime: number | null;
      futureCuesReturned: false;
      lookbackSeconds: number;
    };
    source:
      | "html-media-text-tracks"
      | "visible-subtitle-dom"
      | "visible-subtitle-dom-history"
      | "ocr-burned-in"
      | "asr-speech"
      | "ocr+asr"
      | "none";
  }> {
    const normalized = normalizeProfile(profile);
    const page = await this.page(normalized);
    await this.ensureNameShim(page);
    const frames = page.frames();
    const candidates: Array<{
      score: number;
      tag: string;
      currentTime: number;
      duration: number | null;
      paused: boolean;
      readyState: number;
      cues: RawSubtitleCue[];
      visibleSubtitle: string;
      observedCues: RawSubtitleCue[];
    }> = [];

    for (const frame of frames) {
      const result = await frame.evaluate(() => {
        const media = Array.from(
          document.querySelectorAll<HTMLMediaElement>("video, audio"),
        );
        if (media.length === 0) return null;

        const visibleArea = (element: HTMLMediaElement) => {
          const rect = element.getBoundingClientRect();
          const left = Math.max(0, rect.left);
          const top = Math.max(0, rect.top);
          const right = Math.min(window.innerWidth, rect.right);
          const bottom = Math.min(window.innerHeight, rect.bottom);
          return Math.max(0, right - left) * Math.max(0, bottom - top);
        };

        // On-screen video first: feeds keep preloaded clips off screen.
        media.sort((a, b) => {
          const score = (element: HTMLMediaElement) =>
            (visibleArea(element) > 0 ? 1_000_000_000_000 : 0) +
            (element.paused ? 0 : 1_000_000_000) +
            (element.readyState >= 2 ? 1_000_000 : 0) +
            Math.min(visibleArea(element), 999_999);
          return score(b) - score(a);
        });

        const chosen = media[0];
        if (!chosen) return null;
        const currentTime = Number.isFinite(chosen.currentTime)
          ? Math.max(0, chosen.currentTime)
          : 0;

        const cues: Array<{
          startTime: number;
          endTime: number;
          text: string;
          track: string;
          language: string;
        }> = [];

        for (const track of Array.from(chosen.textTracks ?? [])) {
          const list = track.cues;
          if (!list) continue;
          for (let index = 0; index < list.length; index += 1) {
            const cue = list[index] as TextTrackCue & { text?: string };
            if (!cue || !Number.isFinite(cue.startTime) || cue.startTime > currentTime) {
              continue;
            }
            cues.push({
              startTime: cue.startTime,
              endTime: Number.isFinite(cue.endTime) ? cue.endTime : cue.startTime,
              text: typeof cue.text === "string" ? cue.text : "",
              track: track.label || track.kind || "",
              language: track.language || "",
            });
          }
        }

        const selector = [
          '[class*="subtitle" i]',
          '[class*="caption" i]',
          '[data-e2e*="subtitle" i]',
          '[data-testid*="subtitle" i]',
          '[aria-label*="字幕"]',
          '[aria-label*="caption" i]',
          '[role="caption"]',
        ].join(",");

        const visibleSubtitleFor = (
          mediaElement: HTMLMediaElement,
        ): string => {
          const mediaRect = mediaElement.getBoundingClientRect();
          let subtitleElements: Element[] = [];
          try {
            subtitleElements = Array.from(document.querySelectorAll(selector));
          } catch {
            return "";
          }

          const visibleSubtitleCandidates = subtitleElements.flatMap((raw) => {
            try {
              if (!(raw instanceof Element) || raw === mediaElement) return [];
              const element = raw as HTMLElement;
              const tag = element.tagName.toLowerCase();

              const subtitleControlAncestor = element.closest(
                '.bpx-player-ctrl-subtitle, [class*="subtitle-menu" i], [class*="subtitle-setting" i], [class*="subtitle-box" i]',
              );
              if (subtitleControlAncestor) return [];
              if (
                tag === "button" ||
                tag === "input" ||
                tag === "select" ||
                element.getAttribute("role") === "button"
              ) {
                return [];
              }

              const className =
                typeof element.className === "string"
                  ? element.className
                  : element.getAttribute("class") || "";
              const signature = [
                className,
                element.id || "",
                element.getAttribute("data-e2e") || "",
                element.getAttribute("data-testid") || "",
              ].join(" ").toLowerCase();
              if (
                /danmaku|danmu|bullet|comment|toolbar|control|setting|menu|transcript|history|list/.test(
                  signature,
                )
              ) {
                return [];
              }

              const style = getComputedStyle(element);
              if (
                style.display === "none" ||
                style.visibility === "hidden" ||
                Number(style.opacity || "1") <= 0.01
              ) {
                return [];
              }

              const rect = element.getBoundingClientRect();
              if (rect.width <= 0 || rect.height <= 0) return [];
              if (mediaRect.width <= 0 || mediaRect.height <= 0) return [];

              const centerX = rect.left + rect.width / 2;
              const centerY = rect.top + rect.height / 2;
              const insideVideo =
                centerX >= mediaRect.left &&
                centerX <= mediaRect.right &&
                centerY >= mediaRect.top &&
                centerY <= mediaRect.bottom;
              if (!insideVideo) return [];
              if (rect.height > mediaRect.height * 0.45) return [];
              if (rect.width > mediaRect.width * 1.05) return [];

              const text = String(element.innerText || element.textContent || "")
                .replace(/\s+/g, " ")
                .trim();
              if (!text || text.length > 300) return [];
              if (/^(字幕|关闭字幕|开启字幕|cc)$/i.test(text)) return [];

              const captionPriority =
                element.getAttribute("role") === "caption" ||
                /subtitle-panel-text/i.test(className)
                  ? 2
                  : 1;

              return [{
                text,
                priority: captionPriority,
                area: rect.width * rect.height,
                depth: (() => {
                  let depth = 0;
                  let node: Element | null = element;
                  while (node && node !== document.body) {
                    depth += 1;
                    node = node.parentElement;
                  }
                  return depth;
                })(),
              }];
            } catch {
              return [];
            }
          });

          visibleSubtitleCandidates.sort(
            (a, b) =>
              b.priority - a.priority ||
              b.depth - a.depth ||
              a.area - b.area ||
              a.text.length - b.text.length,
          );
          return visibleSubtitleCandidates[0]?.text || "";
        };

        const visibleSubtitle = visibleSubtitleFor(chosen);

        type ObservedCue = {
          startTime: number;
          endTime: number;
          text: string;
          track: string;
          language: string;
        };
        type SubtitleRecorder = {
          mediaKey: string;
          cues: ObservedCue[];
          timerId: number;
          sample: () => void;
        };
        const recorderWindow = window as unknown as {
          __tongpingSubtitleRecorder?: SubtitleRecorder;
        };

        const activeMediaNow = () => {
          const items = Array.from(
            document.querySelectorAll<HTMLMediaElement>("video, audio"),
          );
          items.sort((a, b) => {
            const score = (element: HTMLMediaElement) =>
              (element.paused ? 0 : 1_000_000_000) +
              (element.readyState >= 2 ? 1_000_000 : 0) +
              visibleArea(element);
            return score(b) - score(a);
          });
          return items[0] ?? null;
        };

        if (!recorderWindow.__tongpingSubtitleRecorder) {
          const recorder: SubtitleRecorder = {
            mediaKey: "",
            cues: [],
            timerId: 0,
            sample: () => {},
          };
          recorder.sample = () => {
            try {
              const activeMedia = activeMediaNow();
              if (!activeMedia) return;
            const mediaTime = Number.isFinite(activeMedia.currentTime)
              ? Math.max(0, activeMedia.currentTime)
              : 0;
            const duration = Number.isFinite(activeMedia.duration)
              ? activeMedia.duration
              : "unknown-duration";
            const mediaKey = [
              location.href,
              activeMedia.tagName.toLowerCase(),
              duration,
            ].join("|");

            if (recorder.mediaKey !== mediaKey) {
              recorder.mediaKey = mediaKey;
              recorder.cues = [];
            }

            const text = visibleSubtitleFor(activeMedia)
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 2_000);
            const last = recorder.cues[recorder.cues.length - 1];

            if (text) {
              if (
                last &&
                last.text === text &&
                last.track === "visible-dom-observed" &&
                mediaTime >= last.startTime
              ) {
                last.endTime = Math.max(last.endTime, mediaTime);
              } else {
                recorder.cues.push({
                  startTime: mediaTime,
                  endTime: mediaTime,
                  text,
                  track: "visible-dom-observed",
                  language: "",
                });
              }
            } else if (last && mediaTime >= last.startTime) {
              last.endTime = Math.max(last.endTime, mediaTime);
            }

            const earliestKept = Math.max(0, mediaTime - 3_600);
              recorder.cues = recorder.cues
                .filter((cue) => cue.endTime >= earliestKept)
                .slice(-2_000);
            } catch {
              // SPA DOM churn or one malformed subtitle node must never make
              // the entire media context unavailable.
            }
          };
          recorder.timerId = window.setInterval(recorder.sample, 250);
          recorderWindow.__tongpingSubtitleRecorder = recorder;
        }

        recorderWindow.__tongpingSubtitleRecorder.sample();
        const observedCues =
          recorderWindow.__tongpingSubtitleRecorder.cues.map((cue) => ({
            ...cue,
          }));

        const score =
          (chosen.paused ? 0 : 1_000_000_000) +
          (chosen.readyState >= 2 ? 1_000_000 : 0) +
          visibleArea(chosen);

        return {
          score,
          tag: chosen.tagName.toLowerCase(),
          currentTime,
          duration: Number.isFinite(chosen.duration) ? chosen.duration : null,
          paused: chosen.paused,
          readyState: chosen.readyState,
          cues,
          visibleSubtitle,
          observedCues,
        };
      }).catch(() => null);

      if (result) {
        candidates.push(result);
        continue;
      }

      // Subtitle/DOM instrumentation is best-effort. A site-specific DOM
      // exception must not erase an otherwise valid HTML media element.
      const fallback = await frame.evaluate(() => {
        const media = Array.from(
          document.querySelectorAll<HTMLMediaElement>("video, audio"),
        );
        if (media.length === 0) return null;
        const visibleArea = (element: HTMLMediaElement) => {
          const rect = element.getBoundingClientRect();
          const left = Math.max(0, rect.left);
          const top = Math.max(0, rect.top);
          const right = Math.min(window.innerWidth, rect.right);
          const bottom = Math.min(window.innerHeight, rect.bottom);
          return Math.max(0, right - left) * Math.max(0, bottom - top);
        };
        const score = (element: HTMLMediaElement) =>
          (element.tagName === "VIDEO" && visibleArea(element) > 0 ? 1_000_000_000_000 : 0) +
          (element.paused ? 0 : 1_000_000_000) +
          (element.readyState >= 1 ? 1_000_000 : 0) +
          (element.tagName === "VIDEO" ? Math.min(visibleArea(element), 999_999) : 0);
        media.sort((a, b) => score(b) - score(a));
        const chosen = media[0];
        if (!chosen) return null;
        return {
          score: score(chosen),
          tag: chosen.tagName.toLowerCase(),
          currentTime:
            Number.isFinite(chosen.currentTime)
              ? Math.max(0, chosen.currentTime)
              : 0,
          duration:
            Number.isFinite(chosen.duration) && chosen.duration >= 0
              ? chosen.duration
              : null,
          paused: chosen.paused,
          readyState: chosen.readyState,
          cues: [],
          visibleSubtitle: "",
          observedCues: [],
        };
      }).catch(() => null);

      if (fallback) candidates.push(fallback);
    }

    candidates.sort((a, b) => b.score - a.score);
    const chosen = candidates[0] ?? null;
    const cutoff = chosen?.currentTime ?? null;
    const textTrackCues = chosen
      ? gateSubtitleCues(chosen.cues, chosen.currentTime, lookbackSeconds, maxCues)
      : [];
    const mediaKey = chosen
      ? [
          page.url(),
          chosen.tag,
          chosen.duration ?? "unknown-duration",
        ].join("|")
      : "";
    const visibleDomHistory =
      chosen && textTrackCues.length === 0
        ? chosen.observedCues.length > 0
          ? chosen.observedCues
          : this.recordObservedSubtitle(
              normalized,
              mediaKey,
              chosen.currentTime,
              chosen.visibleSubtitle,
            )
        : [];
    // A DOM "subtitle" that never changes is a label (for example, a collection/update badge),
    // not dialogue: require at least two different lines.
    const visibleDomDistinct = new Set(visibleDomHistory.map((cue) => cue.text)).size;
    const visibleDomCues =
      chosen && textTrackCues.length === 0 && visibleDomDistinct >= 2
        ? gateSubtitleCues(
            visibleDomHistory,
            chosen.currentTime,
            lookbackSeconds,
            maxCues,
          )
        : [];
    const domOrTrackCues = textTrackCues;
    // Burned-in subtitles read by OCR, gated by the same clock.
    const ocrLoop = this.ocrLoops.get(normalized);
    const ocrCues =
      chosen &&
      domOrTrackCues.length === 0 &&
      ocrLoop &&
      ocrLoop.cues.length > 0 &&
      ocrLoop.key.startsWith(page.url() + "|")
        ? gateSubtitleCues(ocrLoop.cues, chosen.currentTime, lookbackSeconds, maxCues)
        : [];
    // Speech transcribed locally, same gate.
    const asrState = this.asrStates.get(normalized);
    const asrCues =
      chosen &&
      domOrTrackCues.length === 0 &&
      asrState &&
      asrState.cues.length > 0 &&
      asrState.key.startsWith(page.url() + "|")
        ? gateSubtitleCues(asrState.cues, chosen.currentTime, lookbackSeconds, maxCues)
        : [];
    // Real text tracks first, then what was read (OCR) or heard (ASR),
    // and only then changing on-page caption text.
    const spokenCues = [...ocrCues, ...asrCues]
      .sort((a, b) => a.startTime - b.startTime)
      .slice(-Math.max(1, maxCues));
    const safeCues =
      textTrackCues.length > 0
        ? textTrackCues
        : spokenCues.length > 0
          ? spokenCues
          : visibleDomCues;

    return {
      profile: normalized,
      url: page.url(),
      title: await page.title(),
      media: chosen
        ? {
            tag: chosen.tag,
            currentTime: chosen.currentTime,
            duration: chosen.duration,
            paused: chosen.paused,
            readyState: chosen.readyState,
          }
        : null,
      subtitles: safeCues,
      spoilerBoundary: {
        mode: "timestamp-gated",
        cutoffMediaTime: cutoff,
        futureCuesReturned: false,
        lookbackSeconds: Math.max(0, Math.min(3600, lookbackSeconds)),
      },
      source:
        domOrTrackCues.length === 0 && ocrCues.length > 0 && asrCues.length > 0
          ? "ocr+asr"
          : domOrTrackCues.length === 0 && asrCues.length > 0
          ? "asr-speech"
          : ocrCues.length > 0 && domOrTrackCues.length === 0
          ? "ocr-burned-in"
          : textTrackCues.length > 0
          ? "html-media-text-tracks"
          : visibleDomCues.length > 1
            ? "visible-subtitle-dom-history"
            : visibleDomCues.length === 1
              ? "visible-subtitle-dom"
              : "none",
    };
  }

  private recordObservedSubtitle(
    profile: string,
    mediaKey: string,
    currentTime: number,
    visibleText: string,
  ): RawSubtitleCue[] {
    const cutoff = Number.isFinite(currentTime)
      ? Math.max(0, currentTime)
      : 0;
    let state = this.observedSubtitleHistory.get(profile);
    if (!state || state.mediaKey !== mediaKey) {
      state = { mediaKey, cues: [] };
      this.observedSubtitleHistory.set(profile, state);
    }

    const text = String(visibleText ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 2_000);

    if (text) {
      const last = state.cues[state.cues.length - 1];
      if (
        last &&
        last.track === "visible-dom-observed" &&
        last.text === text &&
        cutoff >= last.startTime
      ) {
        last.endTime = Math.max(last.endTime, cutoff);
      } else {
        state.cues.push({
          startTime: cutoff,
          endTime: cutoff,
          text,
          track: "visible-dom-observed",
          language: "",
        });
      }
    }

    // Bound memory while retaining enough local history for long lookbacks.
    const earliestKept = Math.max(0, cutoff - 3_600);
    state.cues = state.cues
      .filter((cue) => cue.endTime >= earliestKept)
      .slice(-2_000);
    this.observedSubtitleHistory.set(profile, state);
    return state.cues;
  }

  async close(profile: string): Promise<void> {
    const normalized = normalizeProfile(profile);
    await this.stopLiveScreencast(normalized);
    await this.stopLiveAudio(normalized);
    await this.stopLiveMedia(normalized);
    this.observedSubtitleHistory.delete(normalized);
    this.liveMediaClock.delete(normalized);
    this.mediaClockFallbackBusy.delete(normalized);
    this.mediaClockFallbackLastAttemptAt.delete(normalized);
    this.mediaClockFallbackState.delete(normalized);
    const active = this.active.get(normalized);
    if (!active) return;
    this.active.delete(normalized);
    await active.context.close();
  }

  async closeAll(): Promise<void> {
    const liveProfiles = [...this.liveScreencasts.keys()];
    const audioProfiles = [...this.liveAudioCaptures.keys()];
    const mediaProfiles = [...this.liveMediaCaptures.keys()];
    await Promise.allSettled(liveProfiles.map((profile) => this.stopLiveScreencast(profile)));
    await Promise.allSettled(audioProfiles.map((profile) => this.stopLiveAudio(profile)));
    await Promise.allSettled(mediaProfiles.map((profile) => this.stopLiveMedia(profile)));
    const entries = [...this.active.entries()];
    this.active.clear();
    this.observedSubtitleHistory.clear();
    this.liveMediaClock.clear();
    this.mediaClockFallbackBusy.clear();
    this.mediaClockFallbackLastAttemptAt.clear();
    this.mediaClockFallbackState.clear();
    await Promise.allSettled(entries.map(([, item]) => item.context.close()));
  }

  async startLiveScreencast(
    profile: string,
    onFrame: LiveFrameHandler,
  ): Promise<void> {
    const normalized = normalizeProfile(profile);
    const page = await this.page(normalized);
    const existing = this.liveScreencasts.get(normalized);
    if (existing && existing.page === page && !page.isClosed()) return;
    if (existing) await this.stopLiveScreencast(normalized);

    this.liveMediaClock.delete(normalized);
    await this.ensureMediaClockProbe(normalized, page);

    const session = await page.context().newCDPSession(page);
    await session.send("Page.setWebLifecycleState", { state: "active" }).catch(() => {});
    await session.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
    const viewport = await page.evaluate(() => ({
      width: Math.max(1, Math.round(window.innerWidth || document.documentElement.clientWidth || 1)),
      height: Math.max(1, Math.round(window.innerHeight || document.documentElement.clientHeight || 1)),
    }));
    let sequence = 0;

    const listener = (event: any) => {
      void session.send("Page.screencastFrameAck", {
        sessionId: event.sessionId,
      }).catch(() => {});
      if (!event?.data) return;
      sequence += 1;
      const capturedAt = Date.now();
      const latestMedia = this.liveMediaClock.get(normalized) ?? null;
      const media =
        latestMedia &&
        capturedAt >= latestMedia.sampledAt &&
        capturedAt - latestMedia.sampledAt <= 750
          ? {
              ...latestMedia,
              sampleAgeAtCaptureMs:
                capturedAt - latestMedia.sampledAt,
            }
          : null;
      if (!media) {
        this.scheduleMediaClockFallback(
          normalized,
          page,
          capturedAt,
        );
      }
      void Promise.resolve(onFrame({
        buffer: Buffer.from(String(event.data), "base64"),
        width: viewport.width,
        height: viewport.height,
        sequence,
        capturedAt,
        media,
      })).catch(() => {});
    };

    session.on("Page.screencastFrame", listener);
    await session.send("Page.startScreencast", {
      format: "jpeg",
      quality: 28,
      maxWidth: 640,
      maxHeight: 360,
      everyNthFrame: 1,
    });
    this.liveScreencasts.set(normalized, { session, page, listener, onFrame });
  }

  private async ensureMediaClockProbe(
    profile: string,
    page: Page,
  ): Promise<void> {
    const active = this.active.get(profile);
    if (!active) return;

    if (!active.mediaClockBindingInstalled) {
      await active.context.exposeBinding(
        "__tongpingMediaClock",
        async ({ page: sourcePage }, payload: unknown) => {
          const current = this.liveScreencasts.get(profile);
          if (current && current.page !== sourcePage) return;
          const parsed = parseLiveFrameMediaMeta(payload);
          if (!parsed) return;
          this.liveMediaClock.set(profile, parsed);
        },
      );
      active.mediaClockBindingInstalled = true;
    }

    if (!active.mediaClockInitInstalled) {
      await active.context.addInitScript(installTongpingMediaClockProbe);
      active.mediaClockInitInstalled = true;
    }

    await Promise.allSettled(
      page.frames().map((frame) =>
        frame.evaluate(installTongpingMediaClockProbe),
      ),
    );
  }

  private scheduleMediaClockFallback(
    profile: string,
    page: Page,
    now = Date.now(),
  ): void {
    const lastAttempt =
      this.mediaClockFallbackLastAttemptAt.get(profile) ?? 0;
    if (
      this.mediaClockFallbackBusy.has(profile) ||
      now - lastAttempt < 250
    ) {
      return;
    }
    this.mediaClockFallbackLastAttemptAt.set(profile, now);
    this.mediaClockFallbackBusy.add(profile);
    void this.sampleMediaClockFallback(profile, page)
      .catch(() => undefined)
      .finally(() => {
        this.mediaClockFallbackBusy.delete(profile);
      });
  }

  private async sampleMediaClockFallback(
    profile: string,
    page: Page,
  ): Promise<void> {
    if (page.isClosed()) return;

    const frames = page.frames();
    const samples = await Promise.all(
      frames.map(async (frame, frameIndex) => {
        const value = await frame.evaluate(() => {
          const media = Array.from(
            document.querySelectorAll<HTMLMediaElement>("video,audio"),
          );
          if (media.length === 0) return null;

          const visibleArea = (element: Element): number => {
            const rect = element.getBoundingClientRect();
            const width = Math.max(
              0,
              Math.min(rect.right, window.innerWidth) -
                Math.max(rect.left, 0),
            );
            const height = Math.max(
              0,
              Math.min(rect.bottom, window.innerHeight) -
                Math.max(rect.top, 0),
            );
            return width * height;
          };

          let best: HTMLMediaElement | null = null;
          let bestIndex = -1;
          let bestScore = -1;
          for (let index = 0; index < media.length; index += 1) {
            const element = media[index]!;
            const score =
              (!element.paused && !element.ended
                ? 1_000_000_000
                : 0) +
              (element.readyState >= 2 ? 1_000_000 : 0) +
              (element.tagName === "VIDEO"
                ? visibleArea(element)
                : 0);
            if (score > bestScore) {
              best = element;
              bestIndex = index;
              bestScore = score;
            }
          }
          if (!best) return null;

          const playbackState:
            | "playing"
            | "paused"
            | "waiting"
            | "seeking"
            | "ended" =
            best.seeking
              ? "seeking"
              : best.ended
                ? "ended"
                : best.paused
                  ? "paused"
                  : best.readyState < 3
                    ? "waiting"
                    : "playing";
          return {
            frameUrl: location.href,
            documentTimeOrigin:
              Number.isFinite(performance.timeOrigin)
                ? performance.timeOrigin
                : 0,
            mediaIndex: bestIndex,
            tag: best.tagName.toLowerCase(),
            currentSrc:
              best.currentSrc ||
              best.getAttribute("src") ||
              "",
            duration:
              Number.isFinite(best.duration) && best.duration >= 0
                ? best.duration
                : null,
            currentTime:
              Number.isFinite(best.currentTime)
                ? Math.max(0, best.currentTime)
                : 0,
            seeking: best.seeking,
            readyState: best.readyState,
            playbackState,
            playbackRate:
              Number.isFinite(best.playbackRate) &&
              best.playbackRate > 0
                ? best.playbackRate
                : 1,
            score: bestScore,
          };
        }).catch(() => null);

        return value
          ? {
              ...value,
              frameIndex,
            }
          : null;
      }),
    );

    const chosen = samples
      .filter((value): value is NonNullable<typeof value> =>
        value !== null,
      )
      .sort((a, b) => b.score - a.score)[0];
    if (!chosen) return;

    const sampledAt = Date.now();
    const documentKey = [
      page.url(),
      chosen.frameUrl,
      String(Math.round(chosen.documentTimeOrigin)),
    ].join("|");

    let state = this.mediaClockFallbackState.get(profile);
    if (
      !state ||
      state.page !== page ||
      state.documentKey !== documentKey
    ) {
      state = {
        page,
        documentKey,
        sessionId:
          "fallback-" +
          Math.round(chosen.documentTimeOrigin).toString(36) +
          "-" +
          String(++this.mediaClockFallbackSessionSeq),
        epoch: 0,
        lastPlayerIdentity: "",
        lastMediaIdentity: "",
        lastSeeking: false,
        lastSourcePlayheadPts: null,
        lastSampledAt: 0,
        lastPlaybackState: "",
        lastPlaybackRate: 1,
      };
      this.mediaClockFallbackState.set(profile, state);
    }

    const playerIdentity = (
      state.sessionId +
      ":frame-" +
      String(chosen.frameIndex) +
      ":media-" +
      String(chosen.mediaIndex)
    ).slice(0, 240);
    const duration =
      chosen.duration === null
        ? "unknown"
        : chosen.duration.toFixed(3);
    const mediaIdentity = [
      page.url(),
      chosen.frameUrl,
      chosen.tag,
      chosen.currentSrc,
      duration,
    ].join("|").slice(0, 1_200);
    const sourcePlayheadPts = chosen.currentTime;
    let transition: string | null = null;

    const identityChanged =
      playerIdentity !== state.lastPlayerIdentity ||
      mediaIdentity !== state.lastMediaIdentity;
    if (identityChanged) {
      state.epoch += 1;
      transition = state.lastMediaIdentity
        ? "fallback-media-identity-change"
        : "fallback-media-session-start";
    } else if (chosen.seeking && !state.lastSeeking) {
      state.epoch += 1;
      transition = "fallback-seek-start";
    } else if (
      state.lastSourcePlayheadPts !== null &&
      state.lastSampledAt > 0 &&
      state.lastPlaybackState === "playing" &&
      chosen.playbackState === "playing" &&
      !chosen.seeking &&
      !state.lastSeeking
    ) {
      const elapsedSeconds =
        Math.max(0, sampledAt - state.lastSampledAt) / 1000;
      const expectedAdvance =
        elapsedSeconds * state.lastPlaybackRate;
      const actualAdvance =
        sourcePlayheadPts - state.lastSourcePlayheadPts;
      if (
        Math.abs(actualAdvance) > 1 &&
        Math.abs(actualAdvance - expectedAdvance) > 1.5
      ) {
        state.epoch += 1;
        transition = "fallback-timeline-discontinuity";
      }
    }
    if (state.epoch < 1) state.epoch = 1;

    this.liveMediaClock.set(profile, {
      sessionId: state.sessionId,
      playerIdentity,
      mediaIdentity,
      epoch: state.epoch,
      sourcePlayheadPts,
      framePts: sourcePlayheadPts,
      ptsSource: "html-media-currentTime",
      ptsQuality: "playhead-estimate",
      ptsSampleAgeMs: null,
      playbackState: chosen.playbackState,
      playbackRate: chosen.playbackRate,
      readyState: chosen.readyState,
      sampledAt,
      transition,
    });

    state.lastPlayerIdentity = playerIdentity;
    state.lastMediaIdentity = mediaIdentity;
    state.lastSeeking = chosen.seeking;
    state.lastSourcePlayheadPts = sourcePlayheadPts;
    state.lastSampledAt = sampledAt;
    state.lastPlaybackState = chosen.playbackState;
    state.lastPlaybackRate = chosen.playbackRate;
  }

  async stopLiveScreencast(profile: string): Promise<void> {
    const normalized = normalizeProfile(profile);
    const current = this.liveScreencasts.get(normalized);
    if (!current) return;
    this.liveScreencasts.delete(normalized);
    this.mediaClockFallbackBusy.delete(normalized);
    this.mediaClockFallbackLastAttemptAt.delete(normalized);
    current.session.off("Page.screencastFrame", current.listener);

    // A stalled Chrome screencast must never wedge the worker command loop.
    // Best-effort teardown is bounded; a fresh CDP session can be created
    // immediately after this returns.
    await Promise.race([
      current.session.send("Page.stopScreencast").catch(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, 650)),
    ]);
    await Promise.race([
      current.session.detach().catch(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, 650)),
    ]);
  }

  async startLiveAudio(
    profile: string,
    onChunk: (chunk: LiveAudioChunk) => void | Promise<void>,
  ): Promise<{
    profile: string;
    supported: boolean;
    videoCount: number;
    audioTracks: number;
    sampleRate: number;
    state: string;
  }> {
    const normalized = normalizeProfile(profile);
    const page = await this.page(normalized);
    const active = this.active.get(normalized);
    if (!active) throw new Error("Browser profile is not active.");

    let audioFrame = page.mainFrame();
    let totalVideoCount = 0;
    let bestFrameScore = -1;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      totalVideoCount = 0;
      bestFrameScore = -1;

      for (const frame of page.frames()) {
        const media = await frame.evaluate(() => {
          const media = Array.from(
            document.querySelectorAll<HTMLMediaElement>("video, audio"),
          );
          let score = -1;
          for (const element of media) {
            const rect = element.getBoundingClientRect();
            const area = Math.max(0, rect.width) * Math.max(0, rect.height);
            const candidate =
              (element.paused ? 0 : 1_000_000_000) +
              (element.readyState >= 2 ? 1_000_000 : 0) +
              area;
            score = Math.max(score, candidate);
          }
          return {
            videoCount: document.querySelectorAll("video").length,
            mediaCount: media.length,
            score,
          };
        }).catch(() => null);

        if (!media) continue;
        totalVideoCount += media.videoCount;
        if (media.score > bestFrameScore) {
          bestFrameScore = media.score;
          audioFrame = frame;
        }
      }

      if (totalVideoCount > 0) break;
      await page.waitForTimeout(250);
    }

    this.liveAudioCaptures.set(normalized, {
      page,
      onChunk,
      sequence: 0,
      startedAt: Date.now(),
      lastChunkAt: 0,
    });

    if (!active.audioBindingInstalled) {
      await active.context.exposeBinding(
        "__tongpingAudioChunk",
        async ({ page: sourcePage }, payload: unknown) => {
          const current = this.liveAudioCaptures.get(normalized);
          if (
            !current ||
            (current.capturePage ?? current.page) !== sourcePage
          ) return;
          if (!payload || typeof payload !== "object") return;

          const data = payload as Record<string, unknown>;
          const base64 =
            typeof data.base64 === "string" ? data.base64 : "";
          const sampleRate = Number(data.sampleRate);
          const channels = Number(data.channels);
          const frames = Number(data.frames);
          const mediaTime = Number(data.mediaTime);

          if (
            base64.length === 0 ||
            base64.length > 64_000 ||
            !Number.isFinite(sampleRate) ||
            sampleRate < 8_000 ||
            sampleRate > 96_000 ||
            channels !== 1 ||
            !Number.isFinite(frames) ||
            frames < 1 ||
            frames > 16_384 ||
            !Number.isFinite(mediaTime) ||
            mediaTime < 0
          ) {
            return;
          }

          let buffer: Buffer;
          try {
            buffer = Buffer.from(base64, "base64");
          } catch {
            return;
          }
          if (buffer.length !== Math.round(frames) * 2) return;

          current.sequence += 1;
          const capturedAt = Date.now();
          current.lastChunkAt = capturedAt;
          // Tab-output capture runs in a helper page that cannot see the
          // video, so its "mediaTime" is only the AudioContext uptime. Stamp
          // those chunks with the on-screen video's clock instead.
          let chunkMediaTime = mediaTime;
          if (current.capturePage) {
            this.ensureAudioSourceClock(normalized);
            const clock = this.audioSourceClock.get(normalized);
            if (clock && capturedAt - clock.at < 10_000) {
              chunkMediaTime = clock.paused
                ? clock.pts
                : clock.pts + ((capturedAt - clock.at) / 1000) * clock.rate;
            }
          }
          await Promise.resolve(current.onChunk({
            buffer,
            sampleRate: Math.round(sampleRate),
            channels: 1,
            frames: Math.round(frames),
            sequence: current.sequence,
            capturedAt,
            mediaTime: Math.max(0, chunkMediaTime),
          })).catch(() => {});
        },
      );
      active.audioBindingInstalled = true;
    }

    // tsx/esbuild may preserve its __name helper inside nested functions
    // passed to page.evaluate(). Install a tiny page-global shim first so
    // the serialized callback has no unresolved compiler helper.
    await page.addInitScript({
      content:
        'globalThis.__name = globalThis.__name || ((target, value) => target);',
    }).catch(() => {});
    await page.evaluate(
      'globalThis.__name = globalThis.__name || ((target, value) => target);',
    ).catch(() => {});

    const tabOutput = await this.startTabOutputAudio(
      normalized,
      page,
      totalVideoCount,
    ).catch(() => null);
    if (tabOutput) return tabOutput;

    const currentCapture = this.liveAudioCaptures.get(normalized);
    if (currentCapture) {
      currentCapture.frame = audioFrame;
      currentCapture.mode = "media-element";
    }

    const result = await audioFrame.evaluate(async () => {
      const root = window as typeof window & {
        __tongpingAudioController?: {
          stop: () => Promise<void> | void;
        };
        __tongpingAudioChunk?: (payload: {
          base64: string;
          sampleRate: number;
          channels: number;
          frames: number;
          mediaTime: number;
        }) => Promise<void>;
      };

      if (root.__tongpingAudioController) {
        await root.__tongpingAudioController.stop();
      }

      const targetRate = 24_000;
      let stopped = false;
      let currentMedia: HTMLMediaElement | null = null;
      let audioContext: AudioContext | null = null;
      let source: MediaStreamAudioSourceNode | null = null;
      let processor: ScriptProcessorNode | null = null;
      let silentGain: GainNode | null = null;
      let capturedStream: MediaStream | null = null;
      let monitor: number | null = null;
      let lastTrackCount = 0;

      const cleanupGraph = async () => {
        if (processor) {
          processor.onaudioprocess = null;
          try { processor.disconnect(); } catch {}
        }
        if (source) {
          try { source.disconnect(); } catch {}
        }
        if (silentGain) {
          try { silentGain.disconnect(); } catch {}
        }
        if (capturedStream) {
          for (const track of capturedStream.getTracks()) {
            try { track.stop(); } catch {}
          }
        }
        if (audioContext) {
          try { await audioContext.close(); } catch {}
        }
        processor = null;
        source = null;
        silentGain = null;
        capturedStream = null;
        audioContext = null;
        currentMedia = null;
        lastTrackCount = 0;
      };

      const visibleArea = (media: HTMLMediaElement) => {
        const rect = media.getBoundingClientRect();
        const left = Math.max(0, rect.left);
        const top = Math.max(0, rect.top);
        const right = Math.min(window.innerWidth, rect.right);
        const bottom = Math.min(window.innerHeight, rect.bottom);
        return Math.max(0, right - left) * Math.max(0, bottom - top);
      };

      const chooseMedia = () => {
        const media = Array.from(
          document.querySelectorAll<HTMLMediaElement>("video, audio"),
        );
        media.sort((a, b) => {
          const aScore =
            (a.paused ? 0 : 1_000_000_000) +
            (a.readyState >= 2 ? 1_000_000 : 0) +
            visibleArea(a);
          const bScore =
            (b.paused ? 0 : 1_000_000_000) +
            (b.readyState >= 2 ? 1_000_000 : 0) +
            visibleArea(b);
          return bScore - aScore;
        });
        return (
          media.find((element) => !element.paused && element.readyState >= 2) ??
          media.find((element) => visibleArea(element) > 2_000) ??
          media[0] ??
          null
        );
      };

      const bytesToBase64 = (bytes: Uint8Array) => {
        let binary = "";
        const chunk = 0x4000;
        for (let offset = 0; offset < bytes.length; offset += chunk) {
          binary += String.fromCharCode(
            ...bytes.subarray(offset, Math.min(offset + chunk, bytes.length)),
          );
        }
        return btoa(binary);
      };

      const attach = async (media: HTMLMediaElement) => {
        await cleanupGraph();
        if (stopped) return;

        const capture =
          (media as HTMLMediaElement & {
            captureStream?: () => MediaStream;
            mozCaptureStream?: () => MediaStream;
          }).captureStream ??
          (media as HTMLMediaElement & {
            mozCaptureStream?: () => MediaStream;
          }).mozCaptureStream;

        if (typeof capture !== "function") return;

        let stream: MediaStream;
        try {
          stream = capture.call(media);
        } catch {
          return;
        }

        const tracks = stream.getAudioTracks();
        lastTrackCount = tracks.length;
        if (tracks.length === 0) {
          for (const track of stream.getTracks()) {
            try { track.stop(); } catch {}
          }
          return;
        }

        const AudioContextCtor =
          window.AudioContext ??
          (window as typeof window & {
            webkitAudioContext?: typeof AudioContext;
          }).webkitAudioContext;
        if (!AudioContextCtor) return;

        const ctx = new AudioContextCtor({
          latencyHint: "interactive",
        });
        await ctx.resume().catch(() => {});

        const audioOnly = new MediaStream(tracks);
        const src = ctx.createMediaStreamSource(audioOnly);
        const proc = ctx.createScriptProcessor(4096, 2, 1);
        const gain = ctx.createGain();
        gain.gain.value = 0;

        proc.onaudioprocess = (event) => {
          if (stopped || typeof root.__tongpingAudioChunk !== "function") return;
          const input = event.inputBuffer;
          const length = input.length;
          const channels = Math.max(1, input.numberOfChannels);
          const ratio = Math.max(1, ctx.sampleRate / targetRate);
          const outFrames = Math.max(1, Math.floor(length / ratio));
          const bytes = new Uint8Array(outFrames * 2);
          const view = new DataView(bytes.buffer);

          for (let i = 0; i < outFrames; i += 1) {
            const index = Math.min(
              length - 1,
              Math.floor(i * ratio),
            );
            let sample = 0;
            for (let ch = 0; ch < channels; ch += 1) {
              sample += input.getChannelData(ch)[index] ?? 0;
            }
            sample /= channels;
            sample = Math.max(-1, Math.min(1, sample));
            const pcm = sample < 0
              ? Math.round(sample * 32768)
              : Math.round(sample * 32767);
            view.setInt16(i * 2, pcm, true);
          }

          void root.__tongpingAudioChunk({
            base64: bytesToBase64(bytes),
            sampleRate: targetRate,
            channels: 1,
            frames: outFrames,
            mediaTime:
              currentMedia && Number.isFinite(currentMedia.currentTime)
                ? Math.max(0, currentMedia.currentTime)
                : 0,
          }).catch(() => {});
        };

        src.connect(proc);
        proc.connect(gain);
        gain.connect(ctx.destination);

        currentMedia = media;
        audioContext = ctx;
        source = src;
        processor = proc;
        silentGain = gain;
        capturedStream = stream;
      };

      const tick = async () => {
        if (stopped) return;
        const next = chooseMedia();
        if (next && next !== currentMedia) {
          await attach(next);
        } else if (!next && currentMedia) {
          await cleanupGraph();
        } else if (
          next &&
          currentMedia === next &&
          capturedStream &&
          capturedStream.getAudioTracks().every((track) => track.readyState === "ended")
        ) {
          await attach(next);
        }
      };

      root.__tongpingAudioController = {
        stop: async () => {
          stopped = true;
          if (monitor !== null) window.clearInterval(monitor);
          monitor = null;
          await cleanupGraph();
          delete root.__tongpingAudioController;
        },
      };

      await tick();
      monitor = window.setInterval(() => {
        void tick();
      }, 700);

      const mediaPrototype =
        HTMLMediaElement.prototype as HTMLMediaElement & {
          captureStream?: () => MediaStream;
          mozCaptureStream?: () => MediaStream;
        };
      const finalContext = audioContext as AudioContext | null;

      return {
        supported:
          typeof mediaPrototype.captureStream === "function" ||
          typeof mediaPrototype.mozCaptureStream === "function",
        videoCount: document.querySelectorAll("video").length,
        audioTracks: lastTrackCount,
        sampleRate: finalContext ? finalContext.sampleRate : 0,
        state: finalContext ? finalContext.state : "unattached",
      };
    });

    return {
      profile: normalized,
      ...result,
      videoCount: totalVideoCount,
    };
  }

  private async startTabOutputAudio(
    profile: string,
    page: Page,
    videoCount: number,
  ): Promise<{
    profile: string;
    supported: boolean;
    videoCount: number;
    audioTracks: number;
    sampleRate: number;
    state: string;
    captureMode: "tab-output";
  } | null> {
    if (page.url().startsWith("about:")) return null;

    const captureTitle = "TongPing Audio Source";
    const buttonId = "__tongping_tab_audio_capture";
    const originalTitle = await page.title().catch(() => "");
    const helperOrigin = (
      process.env.TONGPING_CLOUD_URL ??
      `http://127.0.0.1:${process.env.TONGPING_PORT?.trim() || "45921"}`
    ).replace(/\/+$/, "");
    const helperPage = await page.context().newPage();
    this.audioHelperPages.add(helperPage);

    let keepHelper = false;
    try {
      await helperPage.goto(helperOrigin + "/capture-helper", {
        waitUntil: "domcontentloaded",
        timeout: 10_000,
      });
      await helperPage.addInitScript({
        content:
          'globalThis.__name = globalThis.__name || ((target, value) => target);',
      }).catch(() => {});
      await helperPage.evaluate(
        'globalThis.__name = globalThis.__name || ((target, value) => target);',
      ).catch(() => {});

      await page.evaluate(
        ({ captureTitle }) => {
          document.title = captureTitle;
        },
        { captureTitle },
      );

      const prepared = await helperPage.evaluate(
        ({ buttonId }) => {
          const root = window as typeof window & {
            __tongpingAudioController?: {
              stop: () => Promise<void> | void;
            };
            __tongpingAudioChunk?: (payload: {
              base64: string;
              sampleRate: number;
              channels: number;
              frames: number;
              mediaTime: number;
            }) => Promise<void>;
            __tongpingTabCaptureState?: {
              status: "idle" | "starting" | "ready" | "error";
              error: string;
              audioTracks: number;
              sampleRate: number;
              state: string;
            };
          };

          if (
            !window.isSecureContext ||
            !navigator.mediaDevices ||
            typeof navigator.mediaDevices.getDisplayMedia !== "function"
          ) {
            return false;
          }

          root.__tongpingTabCaptureState = {
            status: "idle",
            error: "",
            audioTracks: 0,
            sampleRate: 0,
            state: "unattached",
          };

          const button = document.createElement("button");
          button.id = buttonId;
          button.type = "button";
          Object.assign(button.style, {
            position: "fixed",
            left: "8px",
            top: "8px",
            width: "8px",
            height: "8px",
            opacity: "0.001",
            padding: "0",
            margin: "0",
            border: "0",
          });

          button.addEventListener("click", async () => {
            const state = root.__tongpingTabCaptureState;
            if (!state || state.status === "starting" || state.status === "ready") {
              return;
            }

            state.status = "starting";
            let stream: MediaStream | null = null;
            let ctx: AudioContext | null = null;
            let source: MediaStreamAudioSourceNode | null = null;
            let processor: ScriptProcessorNode | null = null;
            let silentGain: GainNode | null = null;

            const cleanup = async () => {
              if (processor) {
                processor.onaudioprocess = null;
                try { processor.disconnect(); } catch {}
              }
              if (source) {
                try { source.disconnect(); } catch {}
              }
              if (silentGain) {
                try { silentGain.disconnect(); } catch {}
              }
              if (stream) {
                for (const track of stream.getTracks()) {
                  try { track.stop(); } catch {}
                }
              }
              if (ctx) {
                try { await ctx.close(); } catch {}
              }
            };

            try {
              stream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: {
                  suppressLocalAudioPlayback: false,
                  restrictOwnAudio: false,
                } as MediaTrackConstraints,
                preferCurrentTab: false,
                selfBrowserSurface: "exclude",
                surfaceSwitching: "exclude",
                systemAudio: "include",
              } as DisplayMediaStreamOptions);

              const tracks = stream.getAudioTracks();
              state.audioTracks = tracks.length;
              if (tracks.length === 0) {
                await cleanup();
                throw new Error("Tab capture returned no audio track.");
              }

              const AudioContextCtor =
                window.AudioContext ??
                (window as typeof window & {
                  webkitAudioContext?: typeof AudioContext;
                }).webkitAudioContext;
              if (!AudioContextCtor) {
                await cleanup();
                throw new Error("AudioContext is unavailable.");
              }

              ctx = new AudioContextCtor({ latencyHint: "interactive" });
              await ctx.resume().catch(() => {});
              source = ctx.createMediaStreamSource(new MediaStream(tracks));
              processor = ctx.createScriptProcessor(4096, 2, 1);
              silentGain = ctx.createGain();
              silentGain.gain.value = 0;

              const targetRate = 24_000;
              const bytesToBase64 = (bytes: Uint8Array) => {
                let binary = "";
                const chunk = 0x4000;
                for (let offset = 0; offset < bytes.length; offset += chunk) {
                  binary += String.fromCharCode(
                    ...bytes.subarray(offset, Math.min(offset + chunk, bytes.length)),
                  );
                }
                return btoa(binary);
              };

              processor.onaudioprocess = (event) => {
                if (typeof root.__tongpingAudioChunk !== "function" || !ctx) return;
                const input = event.inputBuffer;
                const length = input.length;
                const channels = Math.max(1, input.numberOfChannels);
                const ratio = Math.max(1, ctx.sampleRate / targetRate);
                const outFrames = Math.max(1, Math.floor(length / ratio));
                const bytes = new Uint8Array(outFrames * 2);
                const view = new DataView(bytes.buffer);

                for (let i = 0; i < outFrames; i += 1) {
                  const index = Math.min(length - 1, Math.floor(i * ratio));
                  let sample = 0;
                  for (let ch = 0; ch < channels; ch += 1) {
                    sample += input.getChannelData(ch)[index] ?? 0;
                  }
                  sample /= channels;
                  sample = Math.max(-1, Math.min(1, sample));
                  const pcm = sample < 0
                    ? Math.round(sample * 32768)
                    : Math.round(sample * 32767);
                  view.setInt16(i * 2, pcm, true);
                }

                void root.__tongpingAudioChunk({
                  base64: bytesToBase64(bytes),
                  sampleRate: targetRate,
                  channels: 1,
                  frames: outFrames,
                  mediaTime: Math.max(0, ctx.currentTime),
                }).catch(() => {});
              };

              source.connect(processor);
              processor.connect(silentGain);
              silentGain.connect(ctx.destination);

              root.__tongpingAudioController = {
                stop: async () => {
                  await cleanup();
                  delete root.__tongpingAudioController;
                  delete root.__tongpingTabCaptureState;
                },
              };

              state.sampleRate = ctx.sampleRate;
              state.state = ctx.state;
              state.status = "ready";
            } catch (error) {
              await cleanup();
              state.error =
                error instanceof Error ? error.message : String(error);
              state.status = "error";
            }
          }, { once: true });

          document.body.appendChild(button);
          return true;
        },
        { buttonId },
      );

      if (!prepared) return null;

      await helperPage.locator("#" + buttonId).click({
        force: true,
        timeout: 5_000,
      });

      await helperPage.waitForFunction(
        () => {
          const state = (window as typeof window & {
            __tongpingTabCaptureState?: { status?: string };
          }).__tongpingTabCaptureState;
          return state?.status === "ready" || state?.status === "error";
        },
        undefined,
        { timeout: 10_000 },
      );

      const state = await helperPage.evaluate(() => {
        const value = (window as typeof window & {
          __tongpingTabCaptureState?: {
            status: string;
            error: string;
            audioTracks: number;
            sampleRate: number;
            state: string;
          };
        }).__tongpingTabCaptureState;
        return value ?? null;
      });

      if (!state || state.status !== "ready" || state.audioTracks < 1) {
        return null;
      }

      const current = this.liveAudioCaptures.get(profile);
      if (current) {
        current.capturePage = helperPage;
        current.mode = "tab-output";
      }
      keepHelper = true;

      return {
        profile,
        supported: true,
        videoCount,
        audioTracks: state.audioTracks,
        sampleRate: state.sampleRate,
        state: state.state,
        captureMode: "tab-output",
      };
    } finally {
      await page.evaluate(
        ({ originalTitle }) => {
          if (document.title === "TongPing Audio Source") {
            document.title = originalTitle;
          }
        },
        { originalTitle },
      ).catch(() => {});

      if (!keepHelper && !helperPage.isClosed()) {
        this.audioHelperPages.delete(helperPage);
        await helperPage.close().catch(() => {});
      }
    }
  }

  async liveAudioControllerActive(profile: string): Promise<boolean> {
    const normalized = normalizeProfile(profile);
    const current = this.liveAudioCaptures.get(normalized);
    if (!current) return false;

    const freshnessAnchor =
      current.lastChunkAt > 0 ? current.lastChunkAt : current.startedAt;
    if (Date.now() - freshnessAnchor > 3_000) {
      return false;
    }

    const target =
      current.capturePage?.mainFrame() ??
      current.frame ??
      current.page.mainFrame();
    if (!target || target.isDetached()) return false;

    return target.evaluate(() => {
      const root = window as typeof window & {
        __tongpingAudioController?: unknown;
      };
      return Boolean(root.__tongpingAudioController);
    }).catch(() => false);
  }

  async stopLiveAudio(profile: string): Promise<void> {
    const normalized = normalizeProfile(profile);
    const current = this.liveAudioCaptures.get(normalized);
    this.liveAudioCaptures.delete(normalized);
    const target =
      current?.capturePage?.mainFrame() ??
      current?.frame ??
      current?.page.mainFrame();
    if (!target || target.isDetached()) {
      if (current?.capturePage && !current.capturePage.isClosed()) {
        this.audioHelperPages.delete(current.capturePage);
        await Promise.race([
          current.capturePage.close({ runBeforeUnload: false }).catch(() => {}),
          new Promise<void>((resolve) => setTimeout(resolve, 1200)),
        ]);
      }
      return;
    }

    // Audio capture owns a separate getDisplayMedia helper. A wedged helper
    // must not pin the worker command lane or survive beside companion HLS.
    await Promise.race([
      target.evaluate(async () => {
        const root = window as typeof window & {
          __tongpingAudioController?: {
            stop: () => Promise<void> | void;
          };
        };
        if (root.__tongpingAudioController) {
          await root.__tongpingAudioController.stop();
        }
      }).catch(() => {}),
      new Promise<void>((resolve) => setTimeout(resolve, 900)),
    ]);
    if (current?.capturePage && !current.capturePage.isClosed()) {
      this.audioHelperPages.delete(current.capturePage);
      await Promise.race([
        current.capturePage.close({ runBeforeUnload: false }).catch(() => {}),
        new Promise<void>((resolve) => setTimeout(resolve, 1200)),
      ]);
    }
  }


  async startLiveMedia(
    profile: string,
    onEvent: (event: LiveMediaEvent) => void | Promise<void>,
    options: {
      includeAudio?: boolean;
      chunkMs?: number;
      videoBitsPerSecond?: number;
      audioBitsPerSecond?: number;
      keepSourcePlaying?: boolean;
      /**
       * Record H.264 in a WebM/Matroska container (720p, 2 s key frames) so the
       * server can copy it into HLS instead of re-encoding. Falls back to VP8.
       * (Chrome's MP4 muxer output decodes as mosaic in ffmpeg; Matroska is clean.)
       */
      preferH264?: boolean;
    } = {},
  ): Promise<{
    profile: string;
    supported: boolean;
    attached: boolean;
    reason?: string;
    mimeType: string;
    bitrate: number;
    chunkMs: number;
    captureMode: "tab-output-webm";
  }> {
    const normalized = normalizeProfile(profile);
    const includeAudio = options.includeAudio === true;
    const keepSourcePlaying = options.keepSourcePlaying === true;
    const preferH264 = options.preferH264 === true;
    const chunkMs = Math.max(
      250,
      Math.min(2_000, Math.round(options.chunkMs ?? 250)),
    );
    const videoBitsPerSecond = Math.max(
      112_000,
      Math.min(
        2_000_000,
        Math.round(options.videoBitsPerSecond ?? 112_000),
      ),
    );
    const audioBitsPerSecond = Math.max(
      32_000,
      Math.min(
        192_000,
        Math.round(options.audioBitsPerSecond ?? 64_000),
      ),
    );
    const page = await this.page(normalized);
    const active = this.active.get(normalized);
    if (!active) throw new Error("Browser profile is not active.");

    if (keepSourcePlaying) {
      await this.ensureNameShim(page);
      await page.evaluate(() => {
        const root = window as typeof window & {
          __tongpingCompanionKeepalive?: number;
          __tongpingCompanionHold?: boolean;
        };
        if (root.__tongpingCompanionKeepalive !== undefined) {
          clearInterval(root.__tongpingCompanionKeepalive);
          delete root.__tongpingCompanionKeepalive;
        }
        delete root.__tongpingCompanionHold;

        const isDouyin =
          location.hostname === "douyin.com" ||
          location.hostname.endsWith(".douyin.com");
        if (!isDouyin) return;

        const chooseVideo = (): HTMLVideoElement | null => {
          const videos = Array.from(
            document.querySelectorAll<HTMLVideoElement>("video"),
          );
          if (videos.length === 0) return null;
          const visibleArea = (video: HTMLVideoElement) => {
            const rect = video.getBoundingClientRect();
            const left = Math.max(0, rect.left);
            const top = Math.max(0, rect.top);
            const right = Math.min(window.innerWidth, rect.right);
            const bottom = Math.min(window.innerHeight, rect.bottom);
            return Math.max(0, right - left) * Math.max(0, bottom - top);
          };
          videos.sort((a, b) => visibleArea(b) - visibleArea(a));
          return videos[0] ?? null;
        };

        const resumeIfIdlePaused = () => {
          // The viewer paused companion playback: keep the source paused too.
          if (root.__tongpingCompanionHold) return;
          const video = chooseVideo();
          if (
            !video ||
            video.ended ||
            !video.paused ||
            video.readyState < 2
          ) {
            return;
          }
          void video.play().catch(() => {});
        };

        resumeIfIdlePaused();
        root.__tongpingCompanionKeepalive = window.setInterval(
          resumeIfIdlePaused,
          3_000,
        );
      }).catch(() => {});
    }

    await page.evaluate(() => {
      const videos = Array.from(
        document.querySelectorAll<HTMLVideoElement>("video"),
      );
      if (videos.length === 0) return;
      const area = (video: HTMLVideoElement) => {
        const rect = video.getBoundingClientRect();
        return Math.max(0, rect.width) * Math.max(0, rect.height);
      };
      const score = (video: HTMLVideoElement) => {
        const src = String(video.currentSrc || video.src || "");
        const sourceReady =
          src.startsWith("blob:") ||
          src.startsWith("http://") ||
          src.startsWith("https://");
        return (
          (video.paused ? 0 : 1_000_000_000) +
          (video.readyState >= 1 ? 1_000_000 : 0) +
          (sourceReady ? 100_000 : 0) +
          area(video)
        );
      };
      videos.sort((a, b) => score(b) - score(a));
      const chosen = videos[0];
      if (!chosen) return;
      const rect = chosen.getBoundingClientRect();
      const visible =
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.left < window.innerWidth &&
        rect.top < window.innerHeight;
      if (!visible && rect.width > 0 && rect.height > 0) {
        try {
          chosen.scrollIntoView({
            block: "center",
            inline: "center",
            behavior: "instant",
          });
        } catch {
          chosen.scrollIntoView({ block: "center", inline: "center" });
        }
      }
    }).catch(() => {});
    await new Promise<void>((resolve) => setTimeout(resolve, 120));

    // Look in every frame: many players (embeds, archive.org, iframes) are
    // not in the top document, and a player that has not started yet has no
    // src/readyState. Prefer a visible loaded video; otherwise any <video>
    // is enough, since the capture records the whole tab anyway.
    const probeVideos = async (): Promise<"playable" | "present" | "none"> => {
      let present = false;
      for (const frame of page.frames()) {
        const found = await frame.evaluate(() => {
          const videos = Array.from(document.querySelectorAll("video"));
          if (videos.length === 0) return "none";
          for (const video of videos) {
            const rect = video.getBoundingClientRect();
            const visible =
              rect.width > 0 &&
              rect.height > 0 &&
              rect.bottom > 0 &&
              rect.right > 0 &&
              rect.left < window.innerWidth &&
              rect.top < window.innerHeight;
            const source = video.currentSrc || video.getAttribute("src") || "";
            if (
              visible &&
              (
                video.readyState >= 1 ||
                source.startsWith("blob:") ||
                source.startsWith("http://") ||
                source.startsWith("https://")
              )
            ) {
              return "playable";
            }
          }
          return "present";
        }).catch(() => "none");
        if (found === "playable") return "playable";
        if (found === "present") present = true;
      }
      return present ? "present" : "none";
    };
    let videoState: "playable" | "present" | "none" = "none";
    for (let attempt = 0; attempt < 6; attempt += 1) {
      videoState = await probeVideos();
      if (videoState === "playable") break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const hasVideo = videoState !== "none";
    if (!hasVideo) {
      return {
        profile: normalized,
        supported: true,
        attached: false,
        reason: "no-video",
        mimeType: "",
        bitrate: videoBitsPerSecond + (includeAudio ? audioBitsPerSecond : 0),
        chunkMs,
        captureMode: "tab-output-webm",
      };
    }

    await this.stopLiveMedia(normalized);

    const captureTitle = "TongPing Audio Source";
    const originalTitle = await page.title().catch(() => "");
    const helperOrigin = (
      process.env.TONGPING_CLOUD_URL ??
      `http://127.0.0.1:${process.env.TONGPING_PORT?.trim() || "45921"}`
    ).replace(/[/]+$/, "");
    // A stop that timed out can leave an old helper tab still sharing this
    // page (two "sharing this tab" bars, two recorders). Close every media
    // capture helper before opening the new one; audio helpers are kept.
    for (const stale of page.context().pages()) {
      if (
        stale.isClosed() ||
        !isCaptureHelperPage(stale) ||
        this.audioHelperPages.has(stale)
      ) {
        continue;
      }
      this.mediaHelperPages.delete(stale);
      await Promise.race([
        stale.evaluate(async () => {
          const root = window as typeof window & {
            __tongpingMediaController?: { stop: () => Promise<void> | void };
          };
          if (root.__tongpingMediaController) await root.__tongpingMediaController.stop();
        }).catch(() => {}),
        new Promise<void>((resolve) => setTimeout(resolve, 600)),
      ]);
      await Promise.race([
        stale.close({ runBeforeUnload: false }).catch(() => {}),
        new Promise<void>((resolve) => setTimeout(resolve, 1_500)),
      ]);
    }
    const helperPage = await page.context().newPage();
    this.mediaHelperPages.add(helperPage);
    const streamId =
      "media-" +
      Date.now().toString(36) +
      "-" +
      Math.random().toString(36).slice(2, 10);

    const current: LiveMediaCapture = {
      page,
      capturePage: helperPage,
      onEvent,
      sequence: 0,
      streamId,
    };
    this.liveMediaCaptures.set(normalized, current);

    if (!active.mediaBindingInstalled) {
      await active.context.exposeBinding(
        "__tongpingMediaEvent",
        async ({ page: sourcePage }, payload: unknown) => {
          const capture = this.liveMediaCaptures.get(normalized);
          if (!capture || capture.capturePage !== sourcePage) return;
          if (!payload || typeof payload !== "object") return;
          const data = payload as Record<string, unknown>;
          const type =
            data.type === "start" ||
            data.type === "segment" ||
            data.type === "end"
              ? data.type
              : "";
          if (!type) return;
          const mimeType =
            typeof data.mimeType === "string"
              ? data.mimeType.slice(0, 160)
              : "";
          const payloadStreamId =
            typeof data.streamId === "string"
              ? data.streamId.slice(0, 160)
              : "";
          if (payloadStreamId !== capture.streamId) return;

          if (type === "segment") {
            const base64 =
              typeof data.base64 === "string" ? data.base64 : "";
            if (!base64 || base64.length > 4_000_000) return;
            let buffer: Buffer;
            try {
              buffer = Buffer.from(base64, "base64");
            } catch {
              return;
            }
            if (buffer.length <= 0 || buffer.length > 2_000_000) return;
            capture.sequence += 1;
            await Promise.resolve(capture.onEvent({
              type,
              streamId: capture.streamId,
              mimeType,
              sequence: capture.sequence,
              capturedAt: Date.now(),
              buffer,
            })).catch(() => {});
            return;
          }

          await Promise.resolve(capture.onEvent({
            type,
            streamId: capture.streamId,
            mimeType,
            sequence: capture.sequence,
            capturedAt: Date.now(),
          })).catch(() => {});
        },
      );
      active.mediaBindingInstalled = true;
    }

    if (!active.asrBindingInstalled) {
      await active.context.exposeBinding(
        "__tongpingAsrAudio",
        async ({ page: sourcePage }, payload: unknown) => {
          const capture = this.liveMediaCaptures.get(normalized);
          if (!capture || capture.capturePage !== sourcePage) return;
          if (!payload || typeof payload !== "object") return;
          const data = payload as Record<string, unknown>;
          if (data.streamId !== capture.streamId || typeof data.base64 !== "string") return;
          const capturedAt = Number(data.capturedAt);
          if (!Number.isFinite(capturedAt) || data.base64.length > 300_000) return;
          let pcm: Buffer;
          try { pcm = Buffer.from(data.base64, "base64"); } catch { return; }
          if (pcm.length === 0) return;
          this.pushAsrAudio(normalized, pcm, capturedAt);
        },
      );
      active.asrBindingInstalled = true;
    }

    let keepHelper = false;
    try {
      await helperPage.goto(helperOrigin + "/capture-helper", {
        waitUntil: "domcontentloaded",
        timeout: 10_000,
      });
      await helperPage.addInitScript({
        content:
          'globalThis.__name = globalThis.__name || ((target, value) => target);',
      }).catch(() => {});
      await helperPage.evaluate(
        'globalThis.__name = globalThis.__name || ((target, value) => target);',
      ).catch(() => {});

      await page.evaluate(
        ({ captureTitle }) => {
          document.title = captureTitle;
        },
        { captureTitle },
      );

      const prepared = await helperPage.evaluate(
        ({ streamId, includeAudio, chunkMs, videoBitsPerSecond, audioBitsPerSecond, preferH264 }) => {
          const root = window as typeof window & {
            __tongpingMediaController?: {
              stop: () => Promise<void> | void;
              setPaused?: (hold: boolean) => string;
            };
            __tongpingMediaEvent?: (payload: {
              type: "start" | "segment" | "end";
              streamId: string;
              mimeType: string;
              base64?: string;
            }) => Promise<void>;
            __tongpingAsrAudio?: (payload: {
              streamId: string;
              base64: string;
              capturedAt: number;
              sampleRate: number;
            }) => Promise<void>;
            __tongpingMediaCaptureState?: {
              status: "idle" | "starting" | "ready" | "error";
              error: string;
              mimeType: string;
            };
          };

          if (
            !window.isSecureContext ||
            !navigator.mediaDevices ||
            typeof navigator.mediaDevices.getDisplayMedia !== "function" ||
            typeof MediaRecorder === "undefined"
          ) {
            return false;
          }

          root.__tongpingMediaCaptureState = {
            status: "idle",
            error: "",
            mimeType: "",
          };

          const button = document.createElement("button");
          button.id = "__tongping_tab_media_capture";
          button.type = "button";
          Object.assign(button.style, {
            position: "fixed",
            left: "8px",
            top: "8px",
            width: "8px",
            height: "8px",
            opacity: "0.001",
            padding: "0",
            margin: "0",
            border: "0",
          });

          button.addEventListener("click", async () => {
            const state = root.__tongpingMediaCaptureState;
            if (
              !state ||
              state.status === "starting" ||
              state.status === "ready"
            ) {
              return;
            }
            state.status = "starting";

            let stream: MediaStream | null = null;
            let recorder: MediaRecorder | null = null;
            let requestTimer: number | null = null;
            let stopped = false;
            let mimeType = "";
            let lastDataAt = Date.now();
            let lastRescueAt = 0;
            let mediaEventChain: Promise<void> = Promise.resolve();
            let asrContext: AudioContext | null = null;

            const cleanup = async () => {
              stopped = true;
              if (asrContext) {
                try { void asrContext.close(); } catch {}
                asrContext = null;
              }
              if (requestTimer !== null) {
                clearInterval(requestTimer);
                requestTimer = null;
              }
              if (recorder && recorder.state !== "inactive") {
                try { recorder.stop(); } catch {}
              }
              if (stream) {
                for (const track of stream.getTracks()) {
                  try { track.stop(); } catch {}
                }
              }
              await mediaEventChain.catch(() => {});
              if (typeof root.__tongpingMediaEvent === "function") {
                await root.__tongpingMediaEvent({
                  type: "end",
                  streamId,
                  mimeType,
                }).catch(() => {});
              }
            };

            try {
              stream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                  frameRate: { ideal: 20, max: 20 },
                },
                audio: includeAudio,
                preferCurrentTab: false,
                selfBrowserSurface: "exclude",
                surfaceSwitching: "exclude",
              } as DisplayMediaStreamOptions);

              const tracks = stream.getVideoTracks();
              // H.264 is copied as-is into HLS, so try to cap it at 720p here.
              // Never as a getDisplayMedia constraint: with the Windows session
              // locked that request fails outright ("Could not start video
              // source"); a refused resize just records at the tab's own size.
              if (preferH264 && tracks[0]) {
                await tracks[0]
                  .applyConstraints({ width: { max: 1280 }, height: { max: 720 }, frameRate: { ideal: 20, max: 20 } })
                  .catch(() => {});
              }
              const audioTracks = stream.getAudioTracks();
              if (tracks.length === 0) {
                await cleanup();
                throw new Error("Tab capture returned no video track.");
              }

              if (includeAudio && audioTracks.length === 0) {
                await cleanup();
                throw new Error("Tab capture returned no audio track.");
              }

              const h264 = preferH264
                ? includeAudio
                  ? ["video/webm;codecs=h264,opus"]
                  : ["video/webm;codecs=h264"]
                : [];
              const candidates = includeAudio
                ? [
                    ...h264,
                    "video/webm;codecs=vp8,opus",
                    "video/webm;codecs=vp8",
                    "video/webm",
                  ]
                : [
                    ...h264,
                    "video/webm;codecs=vp8",
                    "video/webm",
                  ];
              mimeType =
                candidates.find((candidate) =>
                  MediaRecorder.isTypeSupported(candidate),
                ) ?? "";
              if (!mimeType) {
                await cleanup();
                throw new Error("WebM MediaRecorder is unavailable.");
              }

              const capturedStream = new MediaStream(
                includeAudio ? [...tracks, ...audioTracks] : tracks,
              );
              recorder = new MediaRecorder(capturedStream, {
                mimeType,
                videoBitsPerSecond,
                ...(includeAudio ? { audioBitsPerSecond } : {}),
                // HLS segments cut on key frames: one every 2 s.
                ...(mimeType.includes("h264") ? { videoKeyFrameIntervalDuration: 2000 } : {}),
              } as MediaRecorderOptions);

              // Tap the same captured audio for local speech-to-text:
              // 16 kHz mono PCM in ~1 s pieces, stamped with wall time.
              if (
                includeAudio &&
                audioTracks.length > 0 &&
                typeof root.__tongpingAsrAudio === "function"
              ) {
                try {
                  const actx = new AudioContext();
                  asrContext = actx;
                  const source = actx.createMediaStreamSource(new MediaStream(audioTracks));
                  const processor = actx.createScriptProcessor(4096, 1, 1);
                  const mute = actx.createGain();
                  mute.gain.value = 0;
                  const ratio = actx.sampleRate / 16000;
                  let pending: number[] = [];
                  let pendingAt = 0;
                  processor.onaudioprocess = (event) => {
                    if (stopped) return;
                    const input = event.inputBuffer.getChannelData(0);
                    if (pending.length === 0) {
                      pendingAt = Date.now() - Math.round((input.length / actx.sampleRate) * 1000);
                    }
                    for (let index = 0; index < input.length / ratio; index += 1) {
                      pending.push(input[Math.floor(index * ratio)] ?? 0);
                    }
                    if (pending.length < 16000) return;
                    const bytes = new Uint8Array(pending.length * 2);
                    const view = new DataView(bytes.buffer);
                    for (let index = 0; index < pending.length; index += 1) {
                      const sample = Math.max(-1, Math.min(1, pending[index]!));
                      view.setInt16(index * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
                    }
                    let binary = "";
                    for (let offset = 0; offset < bytes.length; offset += 0x4000) {
                      binary += String.fromCharCode(
                        ...bytes.subarray(offset, Math.min(offset + 0x4000, bytes.length)),
                      );
                    }
                    const capturedAt = pendingAt;
                    pending = [];
                    void root.__tongpingAsrAudio?.({
                      streamId,
                      base64: btoa(binary),
                      capturedAt,
                      sampleRate: 16000,
                    }).catch(() => {});
                  };
                  source.connect(processor);
                  processor.connect(mute);
                  mute.connect(actx.destination);
                } catch {
                  // Transcription is optional; recording goes on without it.
                }
              }

              recorder.addEventListener("dataavailable", (event) => {
                if (
                  stopped ||
                  !event.data ||
                  event.data.size <= 0 ||
                  typeof root.__tongpingMediaEvent !== "function"
                ) {
                  return;
                }
                lastDataAt = Date.now();
                const blob = event.data;
                mediaEventChain = mediaEventChain
                  .then(async () => {
                    const buffer = await blob.arrayBuffer();
                    const bytes = new Uint8Array(buffer);
                    let binary = "";
                    const chunk = 0x4000;
                    for (
                      let offset = 0;
                      offset < bytes.length;
                      offset += chunk
                    ) {
                      binary += String.fromCharCode(
                        ...bytes.subarray(
                          offset,
                          Math.min(offset + chunk, bytes.length),
                        ),
                      );
                    }
                    await root.__tongpingMediaEvent?.({
                      type: "segment",
                      streamId,
                      mimeType,
                      base64: btoa(binary),
                    });
                  })
                  .catch(() => {});
              });

              recorder.addEventListener("error", (event) => {
                const error =
                  (event as Event & { error?: Error }).error;
                state.error = error?.message ?? "MediaRecorder error";
                state.status = "error";
              });

              root.__tongpingMediaController = {
                stop: cleanup,
                // Pausing the recorder (not just the source) keeps a held
                // frame out of the buffer, so resume continues seamlessly.
                setPaused: (hold: boolean) => {
                  if (!recorder) return "none";
                  if (hold && recorder.state === "recording") {
                    recorder.pause();
                  } else if (!hold && recorder.state === "paused") {
                    recorder.resume();
                    lastDataAt = Date.now();
                  }
                  return recorder.state;
                },
              };

              state.mimeType = mimeType;
              state.status = "ready";
              if (typeof root.__tongpingMediaEvent === "function") {
                await root.__tongpingMediaEvent({
                  type: "start",
                  streamId,
                  mimeType,
                });
              }
              // MediaRecorder's timeslice is the primary chunk clock.
              // Do not also call requestData() every timeslice: Chrome can
              // enter a "recording but no more dataavailable" state under
              // sustained tab capture when both mechanisms compete.
              recorder.start(chunkMs);
              const rescueAfterMs = Math.max(3_000, chunkMs * 3);
              requestTimer = window.setInterval(() => {
                if (!recorder || recorder.state !== "recording") return;
                const now = Date.now();
                if (
                  now - lastDataAt < rescueAfterMs ||
                  now - lastRescueAt < rescueAfterMs
                ) {
                  return;
                }
                lastRescueAt = now;
                try { recorder.requestData(); } catch {}
              }, Math.max(1_000, chunkMs));
            } catch (error) {
              await cleanup();
              state.error =
                error instanceof Error ? error.message : String(error);
              state.status = "error";
            }
          }, { once: true });

          document.body.appendChild(button);
          return true;
        },
        {
          streamId,
          includeAudio,
          chunkMs,
          videoBitsPerSecond,
          audioBitsPerSecond,
          preferH264,
        },
      );

      if (!prepared) {
        return {
          profile: normalized,
          supported: false,
          attached: false,
          mimeType: "",
          bitrate: videoBitsPerSecond + (includeAudio ? audioBitsPerSecond : 0),
          chunkMs,
          captureMode: "tab-output-webm",
        };
      }

      await helperPage.bringToFront().catch(() => {});
      await helperPage.locator("#__tongping_tab_media_capture").click({
        force: true,
        timeout: 5_000,
      });

      await helperPage.waitForFunction(
        () => {
          const state = (window as typeof window & {
            __tongpingMediaCaptureState?: { status?: string };
          }).__tongpingMediaCaptureState;
          return state?.status === "ready" || state?.status === "error";
        },
        undefined,
        { timeout: 10_000 },
      );

      const state = await helperPage.evaluate(() => {
        return (window as typeof window & {
          __tongpingMediaCaptureState?: {
            status: string;
            error: string;
            mimeType: string;
          };
        }).__tongpingMediaCaptureState ?? null;
      });

      if (!state || state.status !== "ready") {
        return {
          profile: normalized,
          supported: true,
          attached: false,
          reason: "capture-" + (state?.status ?? "missing") +
            (state?.error ? ": " + String(state.error).slice(0, 160) : ""),
          mimeType: state?.mimeType ?? "",
          bitrate: videoBitsPerSecond + (includeAudio ? audioBitsPerSecond : 0),
          chunkMs,
          captureMode: "tab-output-webm",
        };
      }

      keepHelper = true;
      if (keepSourcePlaying) this.startSubtitleOcr(normalized);
      await page.bringToFront().catch(() => {});
      return {
        profile: normalized,
        supported: true,
        attached: true,
        mimeType: state.mimeType,
        bitrate: videoBitsPerSecond + (includeAudio ? audioBitsPerSecond : 0),
        chunkMs,
        captureMode: "tab-output-webm",
      };
    } finally {
      await page.evaluate(
        ({ originalTitle }) => {
          if (document.title === "TongPing Audio Source") {
            document.title = originalTitle;
          }
        },
        { originalTitle },
      ).catch(() => {});

      if (!keepHelper && !helperPage.isClosed()) {
        this.mediaHelperPages.delete(helperPage);
        await helperPage.close().catch(() => {});
        if (this.liveMediaCaptures.get(normalized) === current) {
          this.liveMediaCaptures.delete(normalized);
        }
      }
    }
  }

  async pauseLiveMedia(
    profile: string,
    paused: boolean,
  ): Promise<{ paused: boolean; recorder: string; source: string }> {
    const normalized = normalizeProfile(profile);
    const current = this.liveMediaCaptures.get(normalized);
    if (!current) throw new Error("No live media capture for this profile.");
    const withTimeout = <T>(work: Promise<T>, fallback: T): Promise<T> =>
      Promise.race([
        work.catch(() => fallback),
        new Promise<T>((resolve) => setTimeout(() => resolve(fallback), 1500)),
      ]);
    const setSource = () =>
      withTimeout(
        current.page.evaluate((hold) => {
          const root = window as typeof window & {
            __tongpingCompanionHold?: boolean;
          };
          root.__tongpingCompanionHold = hold;
          const videos = Array.from(
            document.querySelectorAll<HTMLVideoElement>("video"),
          ).filter((video) => video.readyState >= 1);
          if (videos.length === 0) return "no-video";
          for (const video of videos) {
            if (hold) {
              video.pause();
            } else if (video.paused && !video.ended) {
              const rect = video.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                void video.play().catch(() => {});
              }
            }
          }
          return hold ? "paused" : "playing";
        }, paused),
        "error",
      );
    const setRecorder = () =>
      withTimeout(
        current.capturePage.evaluate((hold) => {
          const root = window as typeof window & {
            __tongpingMediaController?: {
              setPaused?: (hold: boolean) => string;
            };
          };
          return root.__tongpingMediaController?.setPaused?.(hold) ?? "missing";
        }, paused),
        "error",
      );
    // Pause: stop the picture first, then the recorder. Resume: recorder
    // first, then the picture. Either way the held frame is never recorded.
    let source: string;
    let recorder: string;
    if (paused) {
      source = await setSource();
      recorder = await setRecorder();
    } else {
      recorder = await setRecorder();
      source = await setSource();
    }
    return { paused, recorder, source };
  }

  async stopLiveMedia(profile: string): Promise<void> {
    const normalized = normalizeProfile(profile);
    this.stopSubtitleOcr(normalized);
    this.asrStates.delete(normalized);
    const current = this.liveMediaCaptures.get(normalized);
    this.liveMediaCaptures.delete(normalized);
    if (!current) return;

    await Promise.race([
      current.page.evaluate(() => {
        const root = window as typeof window & {
          __tongpingCompanionKeepalive?: number;
          __tongpingCompanionHold?: boolean;
        };
        if (root.__tongpingCompanionKeepalive !== undefined) {
          clearInterval(root.__tongpingCompanionKeepalive);
          delete root.__tongpingCompanionKeepalive;
        }
        delete root.__tongpingCompanionHold;
      }).catch(() => {}),
      new Promise<void>((resolve) => setTimeout(resolve, 500)),
    ]);

    const helper = current.capturePage;
    if (!helper.isClosed()) {
      // MediaRecorder.stop() can hang after a transport disruption. Teardown
      // must never pin the worker command lane.
      await Promise.race([
        helper.evaluate(async () => {
          const root = window as typeof window & {
            __tongpingMediaController?: {
              stop: () => Promise<void> | void;
            };
          };
          if (root.__tongpingMediaController) {
            await root.__tongpingMediaController.stop();
          }
        }).catch(() => {}),
        new Promise<void>((resolve) => setTimeout(resolve, 900)),
      ]);
      this.mediaHelperPages.delete(helper);
      await Promise.race([
        helper.close({ runBeforeUnload: false }).catch(() => {}),
        new Promise<void>((resolve) => setTimeout(resolve, 1200)),
      ]);
    }
  }

  /**
   * A human-verification step on the profile's current page, if any. Only
   * looks at an already running profile; never launches one.
   */
  async verificationChallenge(profile: string): Promise<{ reason: string; url: string } | null> {
    const active = this.active.get(normalizeProfile(profile));
    const page = active ? this.currentPage(active) : undefined;
    if (!page) return null;
    const url = page.url();
    if (!isChallengeSite(url)) return null;
    const fromUrl = challengeFromUrl(url);
    if (fromUrl) return { reason: fromUrl, url };
    const fromDom = await page.evaluate(CHALLENGE_DOM_PROBE).catch(() => null);
    return typeof fromDom === "string" ? { reason: fromDom, url } : null;
  }

  async listProfiles(): Promise<
    Array<{ profile: string; active: boolean; pages: number; url?: string }>
  > {
    await fs.mkdir(this.config.profilesDir, { recursive: true });
    const entries = await fs.readdir(this.config.profilesDir, {
      withFileTypes: true,
    });

    const names = new Set<string>(
      entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
    );
    for (const name of this.active.keys()) names.add(name);

    return [...names]
      .sort()
      .map((profile) => {
        const active = this.active.get(profile);
        const pages =
          active?.context
            .pages()
            .filter(
              (page) =>
                !page.isClosed() &&
                !this.audioHelperPages.has(page) &&
                !this.mediaHelperPages.has(page) &&
                !isCaptureHelperPage(page),
            ) ?? [];
        return {
          profile,
          active: Boolean(active),
          pages: pages.length,
          url: pages.at(-1)?.url(),
        };
      });
  }

  async seekMedia(
    profile: string,
    targetSeconds: number,
  ): Promise<{
    profile: string;
    url: string;
    tag: string;
    requestedTime: number;
    currentTime: number;
    duration: number | null;
    paused: boolean;
    playbackRate: number;
  }> {
    const normalized = normalizeProfile(profile);
    const page = await this.page(normalized);
    await this.ensureNameShim(page);
    const requestedTime = Math.max(0, Number(targetSeconds) || 0);
    const frames = page.frames();
    const candidates: Array<{
      frameIndex: number;
      score: number;
      duration: number | null;
    }> = [];

    for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
      const frame = frames[frameIndex]!;
      const candidate = await frame.evaluate(() => {
        const media = Array.from(
          document.querySelectorAll<HTMLMediaElement>("video,audio"),
        );
        if (media.length === 0) return null;
        const visibleArea = (element: HTMLMediaElement) => {
          const rect = element.getBoundingClientRect();
          const left = Math.max(0, rect.left);
          const top = Math.max(0, rect.top);
          const right = Math.min(window.innerWidth, rect.right);
          const bottom = Math.min(window.innerHeight, rect.bottom);
          return Math.max(0, right - left) * Math.max(0, bottom - top);
        };
        // Seek the clip the viewer sees, never a preloaded off-screen one.
        const score = (element: HTMLMediaElement) =>
          (element.tagName === "VIDEO" && visibleArea(element) > 0 ? 1_000_000_000_000 : 0) +
          (element.paused ? 0 : 1_000_000_000) +
          (element.readyState >= 2 ? 1_000_000 : 0) +
          (element.tagName === "VIDEO" ? Math.min(visibleArea(element), 999_999) : 0);
        media.sort((a, b) => score(b) - score(a));
        const chosen = media[0];
        if (!chosen) return null;
        return {
          score: score(chosen),
          duration:
            Number.isFinite(chosen.duration) && chosen.duration >= 0
              ? chosen.duration
              : null,
        };
      }).catch(() => null);
      if (candidate) candidates.push({ frameIndex, ...candidate });
    }

    candidates.sort((a, b) => b.score - a.score);
    const candidate = candidates[0];
    if (!candidate) {
      throw new Error("No active HTML media element is available to seek.");
    }
    const frame = frames[candidate.frameIndex]!;
    const target =
      candidate.duration !== null
        ? Math.min(candidate.duration, requestedTime)
        : requestedTime;

    const result = await frame.evaluate(async ({ target }) => {
      const media = Array.from(
        document.querySelectorAll<HTMLMediaElement>("video,audio"),
      );
      const visibleArea = (element: HTMLMediaElement) => {
        const rect = element.getBoundingClientRect();
        const left = Math.max(0, rect.left);
        const top = Math.max(0, rect.top);
        const right = Math.min(window.innerWidth, rect.right);
        const bottom = Math.min(window.innerHeight, rect.bottom);
        return Math.max(0, right - left) * Math.max(0, bottom - top);
      };
      const score = (element: HTMLMediaElement) =>
        (element.tagName === "VIDEO" && visibleArea(element) > 0 ? 1_000_000_000_000 : 0) +
        (element.paused ? 0 : 1_000_000_000) +
        (element.readyState >= 2 ? 1_000_000 : 0) +
        (element.tagName === "VIDEO" ? Math.min(visibleArea(element), 999_999) : 0);
      media.sort((a, b) => score(b) - score(a));
      const chosen = media[0];
      if (!chosen) return null;
      const wasPaused = chosen.paused;
      try {
        chosen.currentTime = Math.max(0, target);
      } catch {
        return null;
      }
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          chosen.removeEventListener("seeked", finish);
          resolve();
        };
        chosen.addEventListener("seeked", finish, { once: true });
        setTimeout(finish, 600);
      });
      if (!wasPaused && chosen.paused) {
        void chosen.play().catch(() => {});
      }
      return {
        tag: chosen.tagName.toLowerCase(),
        currentTime:
          Number.isFinite(chosen.currentTime)
            ? Math.max(0, chosen.currentTime)
            : Math.max(0, target),
        duration:
          Number.isFinite(chosen.duration) && chosen.duration >= 0
            ? chosen.duration
            : null,
        paused: chosen.paused,
        playbackRate:
          Number.isFinite(chosen.playbackRate) && chosen.playbackRate > 0
            ? chosen.playbackRate
            : 1,
      };
    }, { target }).catch(() => null);

    if (!result) {
      throw new Error("The active media element could not be seeked.");
    }

    return {
      profile: normalized,
      url: page.url(),
      requestedTime,
      ...result,
    };
  }

  async read(
    profile: string,
    selector = "body",
    maxChars = 30_000,
    format: "text" | "html" = "text",
  ): Promise<{
    title: string;
    url: string;
    format: "text" | "html";
    text?: string;
    html?: string;
    images?: Array<{
      src: string;
      alt: string;
      width: number;
      height: number;
    }>;
    truncated: boolean;
  }> {
    const page = await this.page(profile);
    const locator = page.locator(selector).first();
    const safeMax = Math.max(1_000, Math.min(100_000, Math.round(maxChars)));

    if (format === "html") {
      const raw = await locator
        .evaluate((element) => element.outerHTML)
        .catch(() => "");
      const html = raw.replace(/\u0000/g, "");
      const images = await locator
        .locator("img")
        .evaluateAll((nodes) =>
          nodes.slice(0, 200).map((node) => {
            const image = node as HTMLImageElement;
            return {
              src: image.currentSrc || image.src || image.getAttribute("src") || "",
              alt: image.alt || "",
              width: image.naturalWidth || image.width || 0,
              height: image.naturalHeight || image.height || 0,
            };
          }).filter((item) => Boolean(item.src)),
        )
        .catch(() => [] as Array<{
          src: string;
          alt: string;
          width: number;
          height: number;
        }>);

      return {
        title: await page.title(),
        url: page.url(),
        format,
        html: html.slice(0, safeMax),
        images,
        truncated: html.length > safeMax,
      };
    }

    const raw = await locator
      .innerText({ timeout: 10_000 })
      .catch(() => "");
    const text = raw.replace(/\u0000/g, "");
    return {
      title: await page.title(),
      url: page.url(),
      format,
      text: text.slice(0, safeMax),
      truncated: text.length > safeMax,
    };
  }

  async snapshot(
    profile: string,
    maxElements = 120,
    rootSelector = "body",
    offset = 0,
    includeImages = false,
  ): Promise<{
    title: string;
    url: string;
    selector: string;
    offset: number;
    nextOffset: number | null;
    hasMore: boolean;
    elements: SnapshotElement[];
  }> {
    const page = await this.page(profile);
    const safeLimit = Math.max(1, Math.min(250, Math.round(maxElements)));
    const safeOffset = Math.max(0, Math.min(10_000, Math.round(offset)));
    const safeSelector = rootSelector.trim() || "body";

    const result = await page.evaluate(
      ({ limit, rootSelector, offset, includeImages }) => {
        const attr = "data-tongping-ref";
        document.querySelectorAll(`[${attr}]`).forEach((node) => {
          node.removeAttribute(attr);
        });

        const interactiveSelector = [
          "a[href]",
          "button",
          "input",
          "textarea",
          "select",
          "summary",
          "video",
          "[role='button']",
          "[role='link']",
          "[role='checkbox']",
          "[role='radio']",
          "[role='tab']",
          "[contenteditable='true']",
          "[data-e2e]",
          ...(includeImages ? ["img"] : []),
        ].join(",");

        const output: Array<{
          ref: string;
          tag: string;
          role: string | null;
          text: string;
          href: string | null;
          title: string | null;
          ariaLabel: string | null;
          dataE2E: string | null;
          ariaPressed: string | null;
          inputType: string | null;
          disabled: boolean;
          checked: boolean | null;
          src: string | null;
          alt: string | null;
          naturalWidth: number | null;
          naturalHeight: number | null;
          rect: { x: number; y: number; width: number; height: number } | null;
        }> = [];

        const root = document.querySelector(rootSelector);
        if (!root) {
          return { elements: output, hasMore: false };
        }

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
        let node: Node | null = walker.currentNode;
        let scanned = 0;
        let matched = 0;
        let counter = 0;
        let hasMore = false;
        const scanCap = Math.min(
          40_000,
          Math.max(
            1_200,
            (offset + limit + 1) * 40,
            root.querySelector("[data-e2e]") ? 12_000 : 0,
          ),
        );

        while (node && scanned < scanCap) {
          const element = node as HTMLElement;
          scanned += 1;

          if (element.matches?.(interactiveSelector)) {
            const rect = element.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              const style = getComputedStyle(element);
              const visible =
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                Number(style.opacity || "1") > 0;

              if (visible) {
                const matchIndex = matched;
                matched += 1;

                if (matchIndex >= offset) {
                  if (output.length >= limit) {
                    hasMore = true;
                    break;
                  }

                  counter += 1;
                  const ref = `mb-${counter}`;
                  element.setAttribute(attr, ref);

                  const input =
                    element instanceof HTMLInputElement ? element : null;
                  const image =
                    element instanceof HTMLImageElement ? element : null;
                  const childSemantic = Array.from(
                    element.querySelectorAll<HTMLElement>(
                      "[aria-label],[title],[data-e2e],svg title",
                    ),
                  )
                    .slice(0, 8)
                    .map((child) =>
                      child.getAttribute("aria-label") ||
                      child.getAttribute("title") ||
                      child.getAttribute("data-e2e") ||
                      child.textContent ||
                      "",
                    )
                    .filter(Boolean)
                    .join(" ");
                  const rawText =
                    element.getAttribute("aria-label") ||
                    element.getAttribute("title") ||
                    element.getAttribute("data-e2e") ||
                    element.getAttribute("placeholder") ||
                    image?.alt ||
                    input?.value ||
                    childSemantic ||
                    element.textContent ||
                    "";

                  output.push({
                    ref,
                    tag: element.tagName.toLowerCase(),
                    role: element.getAttribute("role"),
                    text: rawText.replace(/\s+/g, " ").trim().slice(0, 220),
                    href:
                      element instanceof HTMLAnchorElement
                        ? element.href
                        : element.getAttribute("href"),
                    title: element.getAttribute("title"),
                    ariaLabel: element.getAttribute("aria-label"),
                    dataE2E: element.getAttribute("data-e2e"),
                    ariaPressed: element.getAttribute("aria-pressed"),
                    inputType: input?.type ?? null,
                    disabled:
                      "disabled" in element
                        ? Boolean(
                            (element as HTMLButtonElement | HTMLInputElement)
                              .disabled,
                          )
                        : element.getAttribute("aria-disabled") === "true",
                    checked:
                      element instanceof HTMLInputElement &&
                      ["checkbox", "radio"].includes(element.type)
                        ? element.checked
                        : element.getAttribute("aria-checked") === null
                          ? null
                          : element.getAttribute("aria-checked") === "true",
                    src: image
                      ? image.currentSrc || image.src || image.getAttribute("src")
                      : null,
                    alt: image?.alt ?? null,
                    naturalWidth: image?.naturalWidth ?? null,
                    naturalHeight: image?.naturalHeight ?? null,
                    rect: {
                      x: Math.round(rect.x),
                      y: Math.round(rect.y),
                      width: Math.round(rect.width),
                      height: Math.round(rect.height),
                    },
                  });
                }
              }
            }
          }

          node = walker.nextNode();
        }

        return { elements: output, hasMore };
      },
      {
        limit: safeLimit,
        rootSelector: safeSelector,
        offset: safeOffset,
        includeImages,
      },
    );

    return {
      title: await page.title(),
      url: page.url(),
      selector: safeSelector,
      offset: safeOffset,
      nextOffset: result.hasMore ? safeOffset + safeLimit : null,
      hasMore: result.hasMore,
      elements: result.elements,
    };
  }


  async screenshot(
    profile: string,
    fullPage = false,
    format: "png" | "small-jpeg" = "png",
  ): Promise<{
    title: string;
    url: string;
    buffer: Buffer;
    viewport: { width: number; height: number } | null;
  }> {
    const page = await this.page(profile);
    const mediaState = await page.evaluate(() => {
      const videos = Array.from(document.querySelectorAll("video"));
      return videos.map((video, index) => {
        const wasPaused = video.paused;
        video.dataset.tongpingScreenshotIndex = String(index);
        try { video.pause(); } catch {}
        return { index, wasPaused };
      });
    }).catch(() => [] as Array<{ index: number; wasPaused: boolean }>);

    let buffer: Buffer;
    try {
      const small = !fullPage && format === "small-jpeg"
        ? await this.captureViewportSmallJpeg(page)
        : null;
      if (small) {
        buffer = small;
      } else if (!fullPage) {
        buffer = await this.captureViewportFast(page);
        if (buffer.length > SCREENSHOT_SOFT_LIMIT_BYTES) {
          // A large headed window on a HiDPI screen can exceed what an AI
          // host accepts (hosted cap 1.5 MiB). Recapture scaled down.
          buffer = (await this.captureViewportScaled(page, buffer.length)) ?? buffer;
        }
      } else {
        buffer = await page.screenshot({
          type: "png",
          fullPage: true,
          animations: "disabled",
          caret: "hide",
          timeout: 12_000,
        });
      }
    } finally {
      await page.evaluate((states) => {
        for (const state of states) {
          if (state.wasPaused) continue;
          const video = document.querySelector<HTMLVideoElement>(
            `video[data-tongping-screenshot-index="${state.index}"]`,
          );
          if (video) void video.play().catch(() => undefined);
        }
        document.querySelectorAll("video[data-tongping-screenshot-index]")
          .forEach((video) => video.removeAttribute("data-tongping-screenshot-index"));
      }, mediaState).catch(() => undefined);
    }

    return {
      title: await page.title(),
      url: page.url(),
      buffer,
      viewport: page.viewportSize(),
    };
  }

  private async captureViewportScaled(page: Page, currentBytes: number): Promise<Buffer | null> {
    let cdp: CDPSession | undefined;
    try {
      cdp = await page.context().newCDPSession(page);
      const metrics = await cdp.send("Page.getLayoutMetrics");
      const view = metrics.cssVisualViewport ?? metrics.visualViewport;
      // PNG size scales roughly with pixel count, so shrink by the square root.
      let scale = Math.max(0.25, Math.sqrt(SCREENSHOT_SOFT_LIMIT_BYTES / currentBytes) * 0.85);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const result = await cdp.send("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: false,
          clip: { x: view.pageX, y: view.pageY, width: view.clientWidth, height: view.clientHeight, scale },
        });
        const buffer = Buffer.from(result.data, "base64");
        if (buffer.length <= SCREENSHOT_SOFT_LIMIT_BYTES) return buffer;
        scale = Math.max(0.2, scale * 0.7);
      }
      return null;
    } catch {
      return null;
    } finally {
      if (cdp) void cdp.detach().catch(() => undefined);
    }
  }

  /** Viewport as a small JPEG (≤640 px wide, low quality), like a live-view frame. */
  private async captureViewportSmallJpeg(page: Page): Promise<Buffer | null> {
    let cdp: CDPSession | undefined;
    try {
      cdp = await page.context().newCDPSession(page);
      const metrics = await cdp.send("Page.getLayoutMetrics");
      const view = metrics.cssVisualViewport ?? metrics.visualViewport;
      const scale = Math.min(1, 640 / Math.max(1, view.clientWidth));
      const result = await Promise.race([
        cdp.send("Page.captureScreenshot", {
          format: "jpeg",
          quality: 30,
          captureBeyondViewport: false,
          clip: { x: view.pageX, y: view.pageY, width: view.clientWidth, height: view.clientHeight, scale },
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("CDP screenshot timed out")), 6_000)),
      ]);
      return Buffer.from(result.data, "base64");
    } catch {
      return null;
    } finally {
      if (cdp) void cdp.detach().catch(() => undefined);
    }
  }

  private async captureViewportFast(page: Page): Promise<Buffer> {
    let cdp: CDPSession | undefined;
    try {
      cdp = await Promise.race([
        page.context().newCDPSession(page),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("CDP session timed out")), 3_000),
        ),
      ]);
      const result = await Promise.race([
        cdp.send("Page.captureScreenshot", {
          format: "png",
          fromSurface: false,
          captureBeyondViewport: false,
          optimizeForSpeed: true,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("CDP screenshot timed out")), 6_000),
        ),
      ]);
      return Buffer.from(result.data, "base64");
    } catch {
      return await page.screenshot({
        type: "png",
        fullPage: false,
        animations: "disabled",
        caret: "hide",
        timeout: 7_000,
      });
    } finally {
      if (cdp) void cdp.detach().catch(() => undefined);
    }
  }

  async scroll(
    profile: string,
    deltaY: number,
  ): Promise<{
    mode: "element" | "window";
    deltaY: number;
    windowScrollY: number;
    target?: {
      tag: string;
      id: string;
      className: string;
      scrollTop: number;
      scrollHeight: number;
      clientHeight: number;
      rect: { x: number; y: number; width: number; height: number };
    };
  }> {
    const page = await this.page(profile);
    const safeDelta = Math.max(-10000, Math.min(10000, Math.round(deltaY)));
    const script = `(() => {
      const amount = ${safeDelta};
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const active = document.activeElement instanceof Element
        ? document.activeElement
        : null;
      const candidates = [];

      for (const element of Array.from(document.querySelectorAll("*"))) {
        if (!(element instanceof HTMLElement)) continue;
        const style = getComputedStyle(element);
        if (!/(auto|scroll|overlay)/.test(style.overflowY)) continue;
        if (element.scrollHeight <= element.clientHeight + 24) continue;

        const rect = element.getBoundingClientRect();
        const left = Math.max(0, rect.left);
        const top = Math.max(0, rect.top);
        const right = Math.min(viewportWidth, rect.right);
        const bottom = Math.min(viewportHeight, rect.bottom);
        const area = Math.max(0, right - left) * Math.max(0, bottom - top);
        if (area <= 0) continue;
        if (rect.width < 180 || rect.height < 140) continue;

        const containsActive = active ? element.contains(active) : false;
        const centerX = Math.min(viewportWidth - 1, Math.max(0, viewportWidth * 0.55));
        const centerY = Math.min(viewportHeight - 1, Math.max(0, viewportHeight * 0.62));
        const containsCenter =
          centerX >= rect.left && centerX <= rect.right &&
          centerY >= rect.top && centerY <= rect.bottom;
        const range = Math.max(1, element.scrollHeight - element.clientHeight);
        const remaining = amount >= 0
          ? Math.max(0, range - element.scrollTop)
          : Math.max(0, element.scrollTop);
        if (remaining <= 1) continue;

        let score = area;
        if (containsCenter) score *= 2.2;
        if (containsActive) score *= 4;
        score *= 1 + Math.min(2, range / Math.max(1, element.clientHeight));
        candidates.push({ element, score, rect });
      }

      candidates.sort((a, b) => b.score - a.score);
      const chosen = candidates[0];

      if (chosen) {
        chosen.element.scrollBy({ top: amount, left: 0, behavior: "instant" });
        const className = typeof chosen.element.className === "string"
          ? chosen.element.className.slice(0, 180)
          : "";
        return {
          mode: "element",
          deltaY: amount,
          windowScrollY: Math.round(window.scrollY),
          target: {
            tag: chosen.element.tagName.toLowerCase(),
            id: chosen.element.id.slice(0, 120),
            className,
            scrollTop: Math.round(chosen.element.scrollTop),
            scrollHeight: chosen.element.scrollHeight,
            clientHeight: chosen.element.clientHeight,
            rect: {
              x: Math.round(chosen.rect.x),
              y: Math.round(chosen.rect.y),
              width: Math.round(chosen.rect.width),
              height: Math.round(chosen.rect.height),
            },
          },
        };
      }

      window.scrollBy({ top: amount, left: 0, behavior: "instant" });
      return {
        mode: "window",
        deltaY: amount,
        windowScrollY: Math.round(window.scrollY),
      };
    })()`;

    return await page.evaluate(script) as {
      mode: "element" | "window";
      deltaY: number;
      windowScrollY: number;
      target?: {
        tag: string;
        id: string;
        className: string;
        scrollTop: number;
        scrollHeight: number;
        clientHeight: number;
        rect: { x: number; y: number; width: number; height: number };
      };
    };
  }

  async setInputFiles(
    profile: string,
    ref: string,
    files: Array<{ name: string; mimeType: string; buffer: Buffer }>,
  ): Promise<{ count: number; names: string[] }> {
    const page = await this.page(profile);
    const locator = page.locator(refSelector(ref)).first();
    await locator.waitFor({ state: "attached" });
    const type = await locator.getAttribute("type");
    if (type?.toLowerCase() !== "file") {
      throw new Error("Target is not a file input.");
    }
    await locator.setInputFiles(
      files.map((file) => ({
        name: file.name,
        mimeType: file.mimeType,
        buffer: file.buffer,
      })),
    );
    return { count: files.length, names: files.map((file) => file.name) };
  }

  async clickAt(profile: string, x: number, y: number): Promise<void> {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
      throw new Error("Click coordinates must be finite non-negative numbers.");
    }
    const page = await this.page(profile);
    await page.mouse.click(x, y);
  }

  async hoverRef(
    profile: string,
    ref: string,
  ) {
    const info = await this.targetInfo(profile, ref);
    const locator = await this.locator(profile, ref);
    await locator.hover({ timeout: 3_000 });
    return info;
  }

  async hoverAt(
    profile: string,
    x: number,
    y: number,
  ) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
      throw new Error("Hover coordinates must be finite non-negative numbers.");
    }
    const page = await this.page(profile);
    await page.mouse.move(x, y);
    return this.targetInfoAtPoint(profile, x, y);
  }

  async targetInfoAtPoint(
    profile: string,
    x: number,
    y: number,
  ): Promise<{
    text: string;
    visibleText: string;
    ariaLabel: string;
    href: string;
    role: string;
    tag: string;
    type: string;
    autocomplete: string;
    title: string;
    dataE2E: string;
    ariaPressed: string;
    hint: string;
  }> {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
      throw new Error("Coordinates must be finite non-negative numbers.");
    }
    const page = await this.page(profile);
    return page.evaluate(({ x, y }) => {
      const raw = document.elementFromPoint(x, y);
      if (!(raw instanceof Element)) {
        throw new Error("No element exists at those viewport coordinates.");
      }
      const element =
        raw.closest(
          "a[href],button,input,textarea,select,summary,[role='button'],[role='link'],[role='checkbox'],[role='radio'],[role='tab'],[contenteditable='true'],[data-e2e]",
        ) || raw;
      const input = element instanceof HTMLInputElement ? element : null;
      const semantic = element.querySelector<HTMLElement>(
        "[aria-label],[title],[data-e2e],svg title",
      );
      return {
        text: (
          element.getAttribute("aria-label") ||
          element.getAttribute("title") ||
          element.getAttribute("data-e2e") ||
          semantic?.getAttribute("aria-label") ||
          semantic?.getAttribute("title") ||
          semantic?.getAttribute("data-e2e") ||
          element.textContent ||
          ""
        )
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 300),
        visibleText: (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 300),
        ariaLabel: element.getAttribute("aria-label") ?? "",
        href:
          element instanceof HTMLAnchorElement
            ? element.href
            : element.getAttribute("href") ?? "",
        role: element.getAttribute("role") ?? "",
        tag: element.tagName.toLowerCase(),
        type: input?.type ?? "",
        autocomplete:
          input?.autocomplete ?? element.getAttribute("autocomplete") ?? "",
        title: element.getAttribute("title") ?? "",
        dataE2E: element.getAttribute("data-e2e") ?? "",
        ariaPressed: element.getAttribute("aria-pressed") ?? "",
        hint: (() => {
          const parts: string[] = [];
          let node: Element | null = element;
          for (let depth = 0; node && depth < 3; depth += 1, node = node.parentElement) {
            const className = node.getAttribute("class");
            if (className) parts.push(className);
          }
          const use = element.querySelector("use");
          const useHref = use?.getAttribute("href") || use?.getAttribute("xlink:href");
          if (useHref) parts.push(useHref);
          return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 240);
        })(),
      };
    }, { x, y });
  }

  async pointerAt(
    profile: string,
    phase: "down" | "move" | "up",
    x: number,
    y: number,
    button: "left" | "right" = "left",
    clickCount = 1,
  ): Promise<void> {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
      throw new Error("Pointer coordinates must be finite non-negative numbers.");
    }
    if (button !== "left" && button !== "right") {
      throw new Error("Pointer button must be left or right.");
    }
    const safeClickCount = Math.max(1, Math.min(2, Math.round(clickCount)));
    const page = await this.page(profile);
    await page.mouse.move(x, y);
    if (phase === "down") {
      await page.mouse.down({ button, clickCount: safeClickCount });
    }
    if (phase === "up") {
      await page.mouse.up({ button, clickCount: safeClickCount });
    }
  }

  async dragAt(
    profile: string,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    steps = 18,
  ): Promise<void> {
    for (const [name, value] of [
      ["startX", startX],
      ["startY", startY],
      ["endX", endX],
      ["endY", endY],
    ] as const) {
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(name + " must be a finite non-negative number.");
      }
    }
    const safeSteps = Math.max(2, Math.min(60, Math.round(steps)));
    const page = await this.page(profile);
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    try {
      await page.mouse.move(endX, endY, { steps: safeSteps });
    } finally {
      await page.mouse.up();
    }
  }

  async insertText(profile: string, text: string): Promise<void> {
    const page = await this.page(profile);
    await page.keyboard.insertText(text);
  }

  async pressKey(profile: string, key: string): Promise<void> {
    if (!/^[A-Za-z0-9+_-]{1,40}$/.test(key)) {
      throw new Error("Invalid key name.");
    }
    const page = await this.page(profile);
    await page.keyboard.press(key);
  }

  async targetInfo(
    profile: string,
    ref: string,
  ): Promise<{
    text: string;
    visibleText: string;
    ariaLabel: string;
    href: string;
    role: string;
    tag: string;
    type: string;
    autocomplete: string;
    title: string;
    dataE2E: string;
    ariaPressed: string;
    hint: string;
  }> {
    const page = await this.page(profile);
    const locator = page.locator(refSelector(ref)).first();
    await locator.waitFor({ state: "attached" });

    return locator.evaluate((element) => {
      const input = element instanceof HTMLInputElement ? element : null;
      return {
        text: (
          element.getAttribute("aria-label") ||
          element.getAttribute("title") ||
          element.getAttribute("data-e2e") ||
          element.querySelector<HTMLElement>(
            "[aria-label],[title],[data-e2e],svg title",
          )?.getAttribute("aria-label") ||
          element.querySelector<HTMLElement>(
            "[aria-label],[title],[data-e2e],svg title",
          )?.getAttribute("title") ||
          element.querySelector<HTMLElement>(
            "[aria-label],[title],[data-e2e],svg title",
          )?.getAttribute("data-e2e") ||
          element.textContent ||
          ""
        )
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 300),
        visibleText: (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 300),
        ariaLabel: element.getAttribute("aria-label") ?? "",
        href:
          element instanceof HTMLAnchorElement
            ? element.href
            : element.getAttribute("href") ?? "",
        role: element.getAttribute("role") ?? "",
        tag: element.tagName.toLowerCase(),
        type: input?.type ?? "",
        autocomplete:
          input?.autocomplete ?? element.getAttribute("autocomplete") ?? "",
        title: element.getAttribute("title") ?? "",
        dataE2E: element.getAttribute("data-e2e") ?? "",
        ariaPressed: element.getAttribute("aria-pressed") ?? "",
        hint: (() => {
          const parts: string[] = [];
          let node: Element | null = element;
          for (let depth = 0; node && depth < 3; depth += 1, node = node.parentElement) {
            const className = node.getAttribute("class");
            if (className) parts.push(className);
          }
          const use = element.querySelector("use");
          const useHref = use?.getAttribute("href") || use?.getAttribute("xlink:href");
          if (useHref) parts.push(useHref);
          return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 240);
        })(),
      };
    });
  }

  async locator(profile: string, ref: string) {
    const page = await this.page(profile);
    return page.locator(refSelector(ref)).first();
  }

  async associatedSubmitTarget(profile: string, ref: string): Promise<{
    text: string;
    visibleText: string;
    ariaLabel: string;
    title: string;
    dataE2E: string;
    role: string;
    tag: string;
  } | null> {
    const locator = await this.locator(profile, ref);
    return locator.evaluate((element) => {
      const form = element instanceof HTMLInputElement || element instanceof HTMLButtonElement
        ? element.form
        : element.closest("form");
      if (!form) return null;
      const submit = form.querySelector<HTMLElement>("button:not([type]),button[type='submit'],input[type='submit'],input[type='image']");
      if (!submit) return null;
      return {
        text: submit.getAttribute("value") ?? "",
        visibleText: (submit.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 300),
        ariaLabel: submit.getAttribute("aria-label") ?? "",
        title: submit.getAttribute("title") ?? "",
        dataE2E: submit.getAttribute("data-e2e") ?? "",
        role: submit.getAttribute("role") ?? "",
        tag: submit.tagName.toLowerCase(),
      };
    });
  }
}

function parseLiveFrameMediaMeta(
  payload: unknown,
): LiveFrameMediaMeta | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const data = payload as Record<string, unknown>;
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
    sampledAt <= 0
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
    transition,
  };
}

function installTongpingTabShownProbe(): void {
  const root = window as Window & {
    __tongpingTabShownInstalled?: boolean;
    __tongpingTabShown?: () => void;
  };
  if (window.top !== window || root.__tongpingTabShownInstalled) return;
  root.__tongpingTabShownInstalled = true;
  const report = () => {
    if (document.visibilityState !== "visible") return;
    try { void root.__tongpingTabShown?.(); } catch {}
  };
  document.addEventListener("visibilitychange", report);
  window.addEventListener("focus", report);
  window.addEventListener("pageshow", report);
  // A tab opened from a link can call before the automation side has
  // attached to it; say it again shortly after load.
  const settle = () => {
    report();
    setTimeout(report, 400);
    setTimeout(report, 1500);
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", settle, { once: true });
  } else {
    settle();
  }
}

function installTongpingMediaClockProbe(): void {
  const w = window as any;
  if (w.__tongpingMediaClockProbeV1) return;
  w.__tongpingMediaClockProbeV1 = true;

  const state = {
    documentId:
      "doc-" +
      Date.now().toString(36) +
      "-" +
      Math.random().toString(36).slice(2, 10),
    nextPlayerId: 1,
    playerIds: new WeakMap<HTMLMediaElement, string>(),
    epoch: 0,
    lastPlayerIdentity: "",
    lastMediaIdentity: "",
    lastSeeking: false,
    lastSourcePlayheadPts: null as number | null,
    lastSamplePerf: 0,
    lastPlaybackState: "" as string,
    lastPlaybackRate: 1,
    lastReportAt: 0,
    rvfcVideo: null as HTMLVideoElement | null,
    rvfcHandle: 0,
    rvfcGeneration: 0,
    rvfcMediaTime: null as number | null,
    rvfcWallAt: 0,
  };

  const visibleArea = (element: Element): number => {
    const rect = element.getBoundingClientRect();
    const width = Math.max(
      0,
      Math.min(rect.right, window.innerWidth) -
        Math.max(rect.left, 0),
    );
    const height = Math.max(
      0,
      Math.min(rect.bottom, window.innerHeight) -
        Math.max(rect.top, 0),
    );
    return width * height;
  };

  const activeMedia = (): HTMLMediaElement | null => {
    const media = Array.from(
      document.querySelectorAll<HTMLMediaElement>("video,audio"),
    );
    if (media.length === 0) return null;
    media.sort((a, b) => {
      const score = (element: HTMLMediaElement) =>
        (!element.paused && !element.ended ? 1_000_000_000 : 0) +
        (element.readyState >= 2 ? 1_000_000 : 0) +
        (element.tagName === "VIDEO" ? visibleArea(element) : 0);
      return score(b) - score(a);
    });
    return media[0] ?? null;
  };

  const playerIdentityFor = (media: HTMLMediaElement): string => {
    let id = state.playerIds.get(media);
    if (!id) {
      id =
        state.documentId +
        ":player-" +
        String(state.nextPlayerId++);
      state.playerIds.set(media, id);
    }
    return id;
  };

  const mediaIdentityFor = (media: HTMLMediaElement): string => {
    const duration =
      Number.isFinite(media.duration) && media.duration >= 0
        ? media.duration.toFixed(3)
        : "unknown";
    return [
      location.href,
      media.tagName.toLowerCase(),
      media.currentSrc || media.getAttribute("src") || "",
      duration,
    ]
      .join("|")
      .slice(0, 1_200);
  };

  const playbackStateFor = (
    media: HTMLMediaElement,
  ): "playing" | "paused" | "waiting" | "seeking" | "ended" => {
    if (media.seeking) return "seeking";
    if (media.ended) return "ended";
    if (media.paused) return "paused";
    if (media.readyState < 3) return "waiting";
    return "playing";
  };

  const report = (
    reason: string,
    rvfcMediaTime?: number,
  ): void => {
    const media = activeMedia();
    if (!media) return;

    const now = Date.now();
    if (reason === "rvfc" && now - state.lastReportAt < 80) {
      if (Number.isFinite(rvfcMediaTime)) {
        state.rvfcMediaTime = Number(rvfcMediaTime);
        state.rvfcWallAt = now;
      }
      return;
    }

    if (Number.isFinite(rvfcMediaTime)) {
      state.rvfcMediaTime = Number(rvfcMediaTime);
      state.rvfcWallAt = now;
    }

    const playerIdentity = playerIdentityFor(media);
    const mediaIdentity = mediaIdentityFor(media);
    const playbackState = playbackStateFor(media);
    const sourcePlayheadPts = Number.isFinite(media.currentTime)
      ? Math.max(0, media.currentTime)
      : 0;
    const playbackRate =
      Number.isFinite(media.playbackRate) && media.playbackRate > 0
        ? media.playbackRate
        : 1;
    let transition: string | null = null;

    const identityChanged =
      playerIdentity !== state.lastPlayerIdentity ||
      mediaIdentity !== state.lastMediaIdentity;
    if (identityChanged) {
      state.epoch += 1;
      transition =
        playerIdentity !== state.lastPlayerIdentity &&
        state.lastPlayerIdentity
          ? "active-player-change"
          : state.lastMediaIdentity
            ? "media-identity-change"
            : "media-session-start";
    } else if (media.seeking && !state.lastSeeking) {
      state.epoch += 1;
      transition = "seek-start";
    } else if (
      state.lastSourcePlayheadPts !== null &&
      state.lastSamplePerf > 0 &&
      state.lastPlaybackState === "playing" &&
      playbackState === "playing" &&
      !media.seeking &&
      !state.lastSeeking
    ) {
      const elapsedSeconds =
        Math.max(0, performance.now() - state.lastSamplePerf) / 1000;
      const expectedAdvance =
        elapsedSeconds * state.lastPlaybackRate;
      const actualAdvance =
        sourcePlayheadPts - state.lastSourcePlayheadPts;
      if (
        Math.abs(actualAdvance) > 1 &&
        Math.abs(actualAdvance - expectedAdvance) > 1.5
      ) {
        state.epoch += 1;
        transition = "timeline-discontinuity";
      }
    }

    if (state.epoch < 1) state.epoch = 1;

    const rvfcFresh =
      media instanceof HTMLVideoElement &&
      state.rvfcVideo === media &&
      state.rvfcMediaTime !== null &&
      now - state.rvfcWallAt <= 500;
    const framePts = rvfcFresh
      ? state.rvfcMediaTime
      : sourcePlayheadPts;
    const ptsSource = rvfcFresh
      ? "rvfc-media-time"
      : "html-media-currentTime";
    const ptsQuality = rvfcFresh
      ? "frame-timestamp"
      : "playhead-estimate";
    const ptsSampleAgeMs = rvfcFresh
      ? Math.max(0, now - state.rvfcWallAt)
      : null;

    const binding = w.__tongpingMediaClock;
    if (typeof binding === "function") {
      try {
        void Promise.resolve(
          binding({
            sessionId: state.documentId,
            playerIdentity,
            mediaIdentity,
            epoch: state.epoch,
            sourcePlayheadPts,
            framePts,
            ptsSource,
            ptsQuality,
            ptsSampleAgeMs,
            playbackState,
            playbackRate,
            readyState: media.readyState,
            sampledAt: now,
            transition,
          }),
        ).catch(() => undefined);
      } catch {}
    }

    state.lastPlayerIdentity = playerIdentity;
    state.lastMediaIdentity = mediaIdentity;
    state.lastSeeking = media.seeking;
    state.lastSourcePlayheadPts = sourcePlayheadPts;
    state.lastSamplePerf = performance.now();
    state.lastPlaybackState = playbackState;
    state.lastPlaybackRate = playbackRate;
    state.lastReportAt = now;
  };

  const attachRvfc = (): void => {
    const media = activeMedia();
    const video =
      media instanceof HTMLVideoElement ? media : null;
    if (
      video === state.rvfcVideo ||
      !video ||
      typeof video.requestVideoFrameCallback !== "function"
    ) {
      return;
    }

    if (
      state.rvfcVideo &&
      state.rvfcHandle &&
      typeof state.rvfcVideo.cancelVideoFrameCallback === "function"
    ) {
      try {
        state.rvfcVideo.cancelVideoFrameCallback(
          state.rvfcHandle,
        );
      } catch {}
    }

    state.rvfcVideo = video;
    state.rvfcMediaTime = null;
    state.rvfcWallAt = 0;
    state.rvfcGeneration += 1;
    const generation = state.rvfcGeneration;

    const next = (): void => {
      if (
        state.rvfcVideo !== video ||
        generation !== state.rvfcGeneration
      ) {
        return;
      }
      state.rvfcHandle = video.requestVideoFrameCallback(
        (_now: number, metadata: any) => {
          if (
            state.rvfcVideo !== video ||
            generation !== state.rvfcGeneration
          ) {
            return;
          }
          const mediaTime = Number(metadata?.mediaTime);
          report(
            "rvfc",
            Number.isFinite(mediaTime) ? mediaTime : undefined,
          );
          next();
        },
      );
    };
    next();
  };

  window.setInterval(() => {
    try {
      attachRvfc();
      report("heartbeat");
    } catch {}
  }, 250);

  document.addEventListener(
    "seeking",
    () => {
      try {
        report("seeking-event");
      } catch {}
    },
    true,
  );
  document.addEventListener(
    "loadedmetadata",
    () => {
      try {
        report("loadedmetadata");
      } catch {}
    },
    true,
  );
  document.addEventListener(
    "emptied",
    () => {
      try {
        report("emptied");
      } catch {}
    },
    true,
  );

  try {
    attachRvfc();
    report("install");
  } catch {}
}

export function normalizeProfile(profile: string): string {
  const trimmed = profile.trim();
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(trimmed)) {
    throw new Error(
      "Profile must be 1-64 characters using only letters, numbers, dot, underscore, or hyphen.",
    );
  }
  return trimmed;
}

function refSelector(ref: string): string {
  if (!/^mb-\d+$/.test(ref)) {
    throw new Error("Invalid element ref. Take a fresh browser_snapshot first.");
  }
  return `[data-tongping-ref="${ref}"]`;
}

function latestOpenPage(context: BrowserContext): Page | undefined {
  return context
    .pages()
    .filter(
      (page) =>
        !page.isClosed() &&
        !isCaptureHelperPage(page),
    )
    .at(-1);
}


function isCaptureHelperPage(page: Page): boolean {
  try {
    const parsed = new URL(page.url());
    return parsed.pathname === "/capture-helper";
  } catch {
    return false;
  }
}
