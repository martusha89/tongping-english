import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { decodeSenseVoiceText } from "../src/voice-input.js";

test("SenseVoice emotion emoji becomes a label; neutral speech gets none", () => {
  assert.deepEqual(decodeSenseVoiceText("今天这集好好笑😊"), {
    text: "今天这集好好笑",
    emotion: "happy",
    emoji: "😊",
  });
  assert.deepEqual(decodeSenseVoiceText("我们看下一集吧"), {
    text: "我们看下一集吧",
    emotion: null,
    emoji: null,
  });
});

test("background audio events are dropped, not labelled", () => {
  const result = decodeSenseVoiceText("🎼😀他刚才说什么😮");
  assert.equal(result.text, "他刚才说什么");
  assert.equal(result.emotion, "surprised");
});

test("raw SenseVoice tags never leak into the transcript", () => {
  const result = decodeSenseVoiceText("<|zh|><|NEUTRAL|><|Speech|><|woitn|>好的");
  assert.equal(result.text, "好的");
  assert.equal(result.emotion, null);
});

test("hold-to-talk only fills the input; sending stays with the user", () => {
  const app = fs.readFileSync(new URL("../src/browser-app.ts", import.meta.url), "utf8");
  assert.match(app, /id="voiceToggle"/);
  assert.match(app, /id="holdToTalk"/);
  assert.match(app, /"browser_app_voice_transcribe"/);
  const finish = app.slice(
    app.indexOf("async function finishVoiceNote"),
    app.indexOf("async function sendToAi"),
  );
  assert.ok(finish.length > 0);
  assert.doesNotMatch(finish, /sendToAi\(|postChatUser\(/);
});

test("the shared browser card asks hosts for the microphone", () => {
  const server = fs.readFileSync(new URL("../src/mcp-server.ts", import.meta.url), "utf8");
  assert.match(server, /permissions: \{ microphone: \{\}/);
  assert.match(server, /"browser_app_voice_transcribe"/);
});

test("recording leaves the playback-only audio session, then hands it back", () => {
  const app = fs.readFileSync(new URL("../src/browser-app.ts", import.meta.url), "utf8");
  const start = app.slice(app.indexOf("async function startVoiceNote"), app.indexOf("function moveVoiceNote"));
  assert.ok(
    start.indexOf("claimRecordingAudioSession()") < start.indexOf("getUserMedia("),
    "switch to play-and-record before asking for the mic",
  );
  assert.match(app, /setAudioSessionType\("play-and-record"\)/);
  assert.match(app, /setAudioSessionType\(audioEnabled \? "playback" : "auto"\)/);
});
