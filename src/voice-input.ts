import { execFile } from "node:child_process";
import { readFile, rm, writeFile, mkdtemp } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

// Hold-to-talk for the card's composer: SenseVoice (SiliconFlow) turns a
// short voice note into text the viewer edits before sending themselves.

const SENSEVOICE_URL = "https://api.siliconflow.cn/v1/audio/transcriptions";
const SENSEVOICE_MODEL = "FunAudioLLM/SenseVoiceSmall";
const DEFAULT_KEY_FILE = path.join(process.env.TONGPING_HOME?.trim() || path.join(homedir(), ".tongping"), "siliconflow.key");
export const VOICE_NOTE_MAX_BYTES = 1_500_000;

// Neutral speech carries no emoji, so it simply yields no label.
const EMOTIONS: Record<string, string> = {
  "😊": "happy",
  "😔": "sad",
  "😡": "angry",
  "😰": "nervous",
  "🤢": "disgusted",
  "😮": "surprised",
};
// Audio events (laughter, music…) mostly come from the show playing in the
// background, not from them, so they are dropped rather than labelled.
const EVENTS = ["😀", "😭", "🎼", "👏", "🤧", "😷"];

export interface VoiceNoteResult {
  text: string;
  emotion: string | null;
  emoji: string | null;
}

export function decodeSenseVoiceText(raw: string): VoiceNoteResult {
  let text = String(raw ?? "");
  let emotion: string | null = null;
  let emoji: string | null = null;
  for (const [mark, label] of Object.entries(EMOTIONS)) {
    if (!text.includes(mark)) continue;
    if (!emotion) {
      emotion = label;
      emoji = mark;
    }
    text = text.split(mark).join("");
  }
  for (const mark of EVENTS) text = text.split(mark).join("");
  // Raw tags in case the API ever returns them unprocessed.
  text = text.replace(/<\|[^|>]*\|>/g, "");
  return { text: text.replace(/\s+/g, " ").trim(), emotion, emoji };
}

function siliconFlowKey(): string {
  const direct = process.env.TONGPING_SILICONFLOW_KEY?.trim();
  if (direct) return direct;
  const file = process.env.TONGPING_SILICONFLOW_KEY_FILE?.trim() || DEFAULT_KEY_FILE;
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  return "";
}

function extensionFor(mimeType: string): string {
  if (/mp4|m4a|aac/i.test(mimeType)) return ".m4a";
  if (/webm/i.test(mimeType)) return ".webm";
  if (/ogg/i.test(mimeType)) return ".ogg";
  if (/wav/i.test(mimeType)) return ".wav";
  if (/mpeg|mp3/i.test(mimeType)) return ".mp3";
  return ".bin";
}

async function postToSenseVoice(
  key: string,
  bytes: Buffer,
  filename: string,
  mimeType: string,
): Promise<{ ok: boolean; status: number; text: string }> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: mimeType }), filename);
  form.append("model", SENSEVOICE_MODEL);
  const response = await fetch(SENSEVOICE_URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + key },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const body = await response.text();
  if (!response.ok) return { ok: false, status: response.status, text: body.slice(0, 200) };
  try {
    return { ok: true, status: response.status, text: String(JSON.parse(body).text ?? "") };
  } catch {
    return { ok: false, status: response.status, text: "unreadable ASR reply" };
  }
}

function toMp3(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      ["-y", "-v", "error", "-i", input, "-ac", "1", "-ar", "16000", "-b:a", "48k", output],
      { timeout: 60_000 },
      (error) => (error ? reject(error) : resolve()),
    );
  });
}

export async function transcribeVoiceNote(
  bytes: Buffer,
  mimeType: string,
): Promise<VoiceNoteResult> {
  const key = siliconFlowKey();
  if (!key) throw new Error("No speech recognition key is configured");
  if (bytes.length === 0) throw new Error("No audio was recorded");
  if (bytes.length > VOICE_NOTE_MAX_BYTES) throw new Error("This voice recording is too long");

  const type = mimeType || "application/octet-stream";
  const first = await postToSenseVoice(key, bytes, "voice" + extensionFor(type), type);
  if (first.ok) return decodeSenseVoiceText(first.text);

  // iOS records AAC-in-MP4, which SenseVoice sometimes refuses; re-encode.
  const dir = await mkdtemp(path.join(tmpdir(), "tongping-voice-"));
  try {
    const input = path.join(dir, "in" + extensionFor(type));
    const output = path.join(dir, "out.mp3");
    await writeFile(input, bytes);
    await toMp3(input, output);
    const second = await postToSenseVoice(key, await readFile(output), "voice.mp3", "audio/mpeg");
    if (second.ok) return decodeSenseVoiceText(second.text);
    throw new Error("Speech recognition failed " + second.status + ": " + second.text);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Speech recognition failed")) throw error;
    throw new Error("Speech recognition failed " + first.status + ": " + first.text);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
