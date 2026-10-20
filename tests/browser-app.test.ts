import assert from "node:assert/strict";
import test from "node:test";
import {
  browserAppPublicOrigin,
  browserAppUiDomain,
  renderBrowserApp,
} from "../src/browser-app.js";
import { LocalGateway } from "../src/gateway.js";

test("browser app uses official MCP Apps bridge without daemon credentials", () => {
  const html = renderBrowserApp("https://browser.example");
  assert.match(
    html,
    /https:\/\/browser\.example\/assets\/mcp-app-v2\.js/,
  );
  assert.match(html, /new App\(/);
  assert.match(html, /app\.callServerTool/);
  assert.match(html, /app\.sendMessage/);
  assert.match(html, /requestDisplayMode/);
  assert.match(html, /browser_app_refresh/);
  assert.match(html, /postPointer/);
  assert.match(html, /state\.controlUrl/);
  assert.match(html, /sendLiveCommand/);
  assert.match(html, /type: "takeover"/);
  assert.match(html, /type: "pointer"/);
  assert.doesNotMatch(html, /fetch\(state\.controlUrl/);
  assert.match(html, /trackpad/);
  assert.match(html, /id="leftMouse"/);
  assert.match(html, /id="rightMouse"/);
  assert.match(html, /Move · Click · Double-click/);
  assert.match(html, /clickRemote/);
  assert.match(html, /isDouble \? 2 : 1/);
  assert.match(html, /contextMenuOpen/);
  assert.match(html, /Context menu open/);
  assert.match(html, /key\("Escape"\)/);
  assert.match(html, /browser_app_history/);
  assert.match(html, /browser_app_reload/);
  assert.match(html, /browser_app_context_info/);
  assert.match(html, /id="back"/);
  assert.match(html, /id="forward"/);
  assert.match(html, /Copy link address/);
  assert.match(html, /safe-area-inset-top/);
  assert.match(html, /shell\.fullscreen/);
  assert.match(html, /grid-template-areas/);
  assert.match(html, /snapshot instead of an empty/);
  assert.match(
    html,
    /requestAnimationFrame\(\(\) => \{\s*refreshImage\(\);\s*scheduleLiveFrameResync\(\);\s*\}\)/,
  );
  assert.match(html, /Refreshing page/);
  assert.match(html, /Refreshed ·/);
  assert.match(html, /pendingRemoteMove/);
  assert.match(html, /pumpRemoteMove/);
  assert.match(html, /applyState\(data\);\s*refreshImage\(\)/); // explicit visual refresh
  assert.match(html, /resync_frame/);
  assert.match(html, /scheduleLiveFrameResync/);
  assert.match(html, /queueLivePacket/);
  assert.match(html, /pendingLivePacket/);
  assert.match(html, /liveNewestCapturedAt/);
  assert.match(html, /capturedAt <= liveNewestCapturedAt/);
  assert.match(html, /createImageBitmap/);
  assert.match(html, /liveCanvas/);
  assert.match(html, /drawImage/);
  assert.match(html, /Newest-frame-wins/);
  assert.match(html, /frame_ready/);
  assert.match(html, /grantNextLiveFrame/);
  assert.doesNotMatch(html, /frame\.decode/);
  assert.doesNotMatch(html, /bytesToBase64/);
  assert.doesNotMatch(html, /id="hold"/);
  assert.doesNotMatch(html, /id="release"/);
  assert.doesNotMatch(html, /nudgeRemote/);
  assert.match(html, /--remote-aspect/);
  assert.match(html, /data:image\/svg\+xml/);
  assert.match(html, /Math\.hypot/);
  assert.match(html, /const gain = Math\.max\(3\.2/);
  assert.doesNotMatch(html, /100vh - 176px/);
  assert.match(html, /aspect-ratio:var\(--remote-aspect,16 \/ 9\)/);
  assert.match(html, /pointer-events:none/);
  assert.doesNotMatch(html, /TONGPING_TOKEN/);
  assert.doesNotMatch(html, /Authorization:\s*"Bearer/);
  assert.doesNotMatch(html, /fetch\(state\.inputUrl/);
  assert.match(html, /state\.liveUrl/);
  assert.match(html, /new WebSocket\(withCardStamp\(state\.liveUrl\)\)/);
  assert.match(html, /binaryType = "arraybuffer"/);
  assert.match(html, /new Uint8Array\(buffer, 20\)/);
  assert.match(html, /new Blob\(\[jpeg\], \{ type: "image\/jpeg" \}\)/);
  assert.match(html, /FileReader/);
  assert.match(html, /scheduleLiveReconnect/);
  assert.match(html, /frame\.dataset\.mode = "live"/);
  assert.match(html, /persistent bidirectional WebSocket/);
});

test("browser app public origin and UI domain are independently configurable", () => {
  const oldOrigin = process.env.TONGPING_PUBLIC_ORIGIN;
  const oldDomain = process.env.TONGPING_UI_DOMAIN;
  try {
    process.env.TONGPING_PUBLIC_ORIGIN =
      "https://browser.example/";
    process.env.TONGPING_UI_DOMAIN =
      "https://browser-ui.example";
    assert.equal(
      browserAppPublicOrigin(),
      "https://browser.example",
    );
    assert.equal(
      browserAppUiDomain(),
      "https://browser-ui.example",
    );
  } finally {
    if (oldOrigin === undefined) {
      delete process.env.TONGPING_PUBLIC_ORIGIN;
    } else {
      process.env.TONGPING_PUBLIC_ORIGIN = oldOrigin;
    }
    if (oldDomain === undefined) {
      delete process.env.TONGPING_UI_DOMAIN;
    } else {
      process.env.TONGPING_UI_DOMAIN = oldDomain;
    }
  }
});

test("shared gateway preserves profile while overriding audit identity", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const human: Array<Record<string, unknown>> = [];
  const fakeService = {
    call: async (value: Record<string, unknown>) => {
      calls.push(value);
      return { ok: true, result: {} };
    },
    humanType: async (
      profile: string,
      text: string,
      owner: string,
    ) => {
      human.push({ profile, chars: text.length, owner });
      return { profile, chars: text.length };
    },
    humanDrag: async (
      profile: string,
      startX: number,
      startY: number,
      endX: number,
      endY: number,
      steps: number,
      owner: string,
    ) => {
      human.push({
        profile,
        startX,
        startY,
        endX,
        endY,
        steps,
        owner,
      });
      return { profile };
    },
  };

  const gateway = new LocalGateway(
    fakeService as never,
    "streamable-http",
  );

  await gateway.call(
    "browser_open",
    { profile: "xiaohongshu" },
    "claude",
  );
  await gateway.human(
    "human_type",
    {
      profile: "xiaohongshu",
      text: "typed-by-human",
    },
    "gpt",
  );

  await gateway.human(
    "human_drag",
    {
      profile: "xiaohongshu",
      startX: 10,
      startY: 20,
      endX: 160,
      endY: 20,
      steps: 20,
    },
    "claude",
  );

  assert.equal(calls[0]?.client, "claude");
  assert.deepEqual(human[0], {
    profile: "xiaohongshu",
    chars: 14,
    owner: "gpt",
  });
  assert.deepEqual(human[1], {
    profile: "xiaohongshu",
    startX: 10,
    startY: 20,
    endX: 160,
    endY: 20,
    steps: 20,
    owner: "claude",
  });
});

test("a local-login handoff is noticed fast and live comes back on its own", () => {
  const html = renderBrowserApp("https://browser.example");
  // Handed off: poll state every few seconds, not once a minute.
  assert.match(
    html,
    /state\.externalLogin && state\.externalLogin\.active\) \{\s*stateTimer = setInterval\(\(\) => \{ void refreshFrame\(\); \}, 2500\);/,
  );
  // Live frames stopping triggers a state check.
  assert.match(html, /frameTimer = setInterval\(checkLiveStall, 2000\)/);
  assert.match(html, /lastLivePacketAt = Date\.now\(\);/);
  // Taken back: reopen live without waiting for a button press.
  assert.match(
    html,
    /if \(wasExternalLogin !== isExternalLogin\) \{[\s\S]{0,200}liveFailed = false;[\s\S]{0,200}refreshImage\(\);\s*scheduleLiveFrameResync\(\);[\s\S]{0,40}startPolling\(\);/,
  );
  assert.match(html, /close the entire Chrome window \(not just the tab\)/);
});

test("LIVE nudges once toward Watch Together on a video page", () => {
  const html = renderBrowserApp("https://browser.example");
  const start = html.indexOf("const VIDEO_PAGE_PATTERNS = [");
  const end = html.indexOf("];", start) + 2;
  // eslint-disable-next-line no-new-func
  const patterns = new Function(html.slice(start, end) + " return VIDEO_PAGE_PATTERNS;")() as RegExp[];
  const matches = (url: string) => patterns.some((pattern) => pattern.test(url));
  assert.equal(matches("https://www.bilibili.com/video/BV1HLpc6hEPN"), true);
  assert.equal(matches("https://www.douyin.com/jingxuan?modal_id=7690176435612437801"), true);
  assert.equal(matches("https://www.youtube.com/watch?v=abc"), true);
  assert.equal(matches("https://www.bilibili.com/"), false);
  assert.equal(matches("https://www.goofish.com/"), false);
  assert.match(html, /use “Watch Together” for smoother video/);
  assert.match(html, /id="liveHint"/);
});
