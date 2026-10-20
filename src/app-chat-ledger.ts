import fs from "node:fs";
import path from "node:path";
import { canonicalIdentity } from "./identity-alias.js";
import {
  PRIVATE_APP_CHAT_ROOM_ID,
  PRIVATE_APP_CHAT_ROOM_OWNERSHIP,
} from "./private-persistent-owner.js";

export const APP_CHAT_ROOM_ID = PRIVATE_APP_CHAT_ROOM_ID;
export const APP_CHAT_ROOM_OWNERSHIP = PRIVATE_APP_CHAT_ROOM_OWNERSHIP;

export type AppChatRole = "user" | "assistant";

export interface AppChatMessage {
  seq: number;
  id: string;
  profile: string;
  identity: string;
  role: AppChatRole;
  text: string;
  createdAt: string;
  /** How the card names this AI (the name its owner gave the AI link). */
  name?: string;
}

export interface AppChatRead {
  messages: AppChatMessage[];
  latestSeq: number;
  muted: string[];
  // Messages up to this seq were cleared by the user; cards drop them too.
  clearedThroughSeq: number;
}

const PROFILE_RE = /^[A-Za-z0-9._-]{1,64}$/;
const IDENTITY_RE = /^[a-z0-9._-]{1,40}$/;
const MAX_MESSAGES = 200;
const MAX_USER_CHARS = 6_000;
const MAX_ASSISTANT_CHARS = 16_000;

interface RoomFile {
  version: 1;
  nextSeq: number;
  messages: AppChatMessage[];
  muted: string[];
  cursors: Record<string, number>;
  clearedThroughSeq?: number;
}

// v90 group chat: one room shared by the user and every AI (Claude, ChatGPT, ...),
// whichever card or profile they come from. Each message keeps the speaker's
// identity. An AI that the user mutes cannot post until they unmute it. The
// room survives daemon restarts when a state file is configured.
export class AppChatRoom {
  private nextSeq = 1;
  private messages: AppChatMessage[] = [];
  private readonly muted = new Set<string>();
  private readonly cursors = new Map<string, number>();
  private clearedThroughSeq = 0;

  constructor(private readonly file: string | null = null) {
    this.load();
  }

  push(input: {
    profile: string;
    identity: string;
    role: AppChatRole;
    text: string;
    clientId?: string;
    name?: string;
  }): AppChatMessage {
    const profile = normalizeProfile(input.profile);
    const identity = normalizeIdentity(input.identity);
    const role = input.role;
    if (role === "assistant" && this.muted.has(identity)) {
      throw new Error(
        "The user has muted " + identity + " in the TongPing group chat. Do not post there until they unmute you; you can still answer them in your own conversation.",
      );
    }
    const maxChars = role === "assistant" ? MAX_ASSISTANT_CHARS : MAX_USER_CHARS;
    const text = String(input.text ?? "").trim().slice(0, maxChars);
    if (!text) throw new Error("Chat message must not be empty.");

    const clientId =
      typeof input.clientId === "string" &&
      /^[A-Za-z0-9._:-]{1,100}$/.test(input.clientId)
        ? input.clientId
        : "";
    if (clientId) {
      const duplicate = this.messages.find((item) => item.id === clientId);
      if (duplicate) return { ...duplicate };
    }

    const seq = this.nextSeq++;
    const message: AppChatMessage = {
      seq,
      id: clientId || "chat-" + seq,
      profile,
      identity,
      role,
      text,
      createdAt: new Date().toISOString(),
      ...(typeof input.name === "string" && input.name.trim()
        ? { name: input.name.replace(/\s+/g, " ").trim().slice(0, 24) }
        : {}),
    };
    this.messages.push(message);
    if (this.messages.length > MAX_MESSAGES) {
      this.messages.splice(0, this.messages.length - MAX_MESSAGES);
    }
    // A speaker has seen everything up to its own message.
    if (role === "assistant") this.cursors.set(identity, seq);
    this.save();
    return { ...message };
  }

  // The whole room after `after`. profile/identity are accepted for the old
  // per-lane callers but no longer partition the conversation.
  read(_profile?: string, _identity?: string, after = 0): AppChatRead {
    const safeAfter = Number.isSafeInteger(after) && after >= 0 ? after : 0;
    return {
      messages: this.messages
        .filter((item) => item.seq > safeAfter)
        .map((item) => ({ ...item })),
      latestSeq: this.messages.at(-1)?.seq ?? Math.max(safeAfter, this.clearedThroughSeq),
      muted: [...this.muted].sort(),
      clearedThroughSeq: this.clearedThroughSeq,
    };
  }

  // What `identity` has not seen yet: messages from the user and the other AIs
  // since its cursor. Reading advances the cursor.
  unread(identity: string, limit = 40): AppChatRead & { cursor: number } {
    const who = normalizeIdentity(identity);
    const cursor = this.cursors.get(who) ?? 0;
    const pending = this.messages.filter(
      (item) => item.seq > cursor && !(item.role === "assistant" && item.identity === who),
    );
    const latestSeq = this.messages.at(-1)?.seq ?? cursor;
    this.cursors.set(who, latestSeq);
    this.save();
    return {
      messages: pending.slice(-Math.max(1, limit)).map((item) => ({ ...item })),
      latestSeq,
      muted: [...this.muted].sort(),
      clearedThroughSeq: this.clearedThroughSeq,
      cursor,
    };
  }

  // Unread count without moving the cursor (for context summaries).
  peekUnread(identity: string): AppChatMessage[] {
    const who = normalizeIdentity(identity);
    const cursor = this.cursors.get(who) ?? 0;
    return this.messages
      .filter((item) => item.seq > cursor && !(item.role === "assistant" && item.identity === who))
      .map((item) => ({ ...item }));
  }

  setMuted(identity: string, muted: boolean): string[] {
    const who = normalizeIdentity(identity);
    if (muted) this.muted.add(who);
    else this.muted.delete(who);
    this.save();
    return [...this.muted].sort();
  }

  isMuted(identity: string): boolean {
    return this.muted.has(normalizeIdentity(identity));
  }

  // The user's "Clear" action: drop every message but keep seq numbers moving forward,
  // so cards and room watchers polling with after=N still see new messages.
  // Mutes and read cursors stay.
  clearMessages(): number {
    this.clearedThroughSeq = this.nextSeq - 1;
    this.messages = [];
    this.save();
    return this.clearedThroughSeq;
  }

  clear(): void {
    this.messages = [];
    this.nextSeq = 1;
    this.clearedThroughSeq = 0;
    this.muted.clear();
    this.cursors.clear();
    this.save();
  }

  private load(): void {
    if (!this.file) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8")) as RoomFile;
      if (parsed.version !== 1 || !Array.isArray(parsed.messages)) return;
      // Older rooms used bare names (claude, gpt, claude-opus); fold them into
      // name.entry so history, mutes and cursors match today's speakers.
      this.messages = parsed.messages.slice(-MAX_MESSAGES).map((item) =>
        typeof item.identity === "string"
          ? { ...item, identity: canonicalIdentity(item.identity) }
          : item,
      );
      this.nextSeq = Math.max(
        Number(parsed.nextSeq) || 1,
        (this.messages.at(-1)?.seq ?? 0) + 1,
      );
      for (const who of parsed.muted ?? []) {
        if (IDENTITY_RE.test(who)) this.muted.add(canonicalIdentity(who));
      }
      if (Number.isSafeInteger(parsed.clearedThroughSeq) && (parsed.clearedThroughSeq ?? 0) > 0) {
        this.clearedThroughSeq = parsed.clearedThroughSeq ?? 0;
      }
      for (const [who, seq] of Object.entries(parsed.cursors ?? {})) {
        if (IDENTITY_RE.test(who) && Number.isSafeInteger(seq)) {
          const id = canonicalIdentity(who);
          this.cursors.set(id, Math.max(this.cursors.get(id) ?? 0, seq));
        }
      }
    } catch {}
  }

  private save(): void {
    if (!this.file) return;
    const data: RoomFile = {
      version: 1,
      nextSeq: this.nextSeq,
      messages: this.messages,
      muted: [...this.muted],
      cursors: Object.fromEntries(this.cursors),
      clearedThroughSeq: this.clearedThroughSeq,
    };
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, this.file);
    } catch {}
  }
}

// Persist only inside the real daemon (it sets TONGPING_HOME); tests
// and ad-hoc imports stay in memory.
const roomFile = process.env.TONGPING_HOME?.trim()
  ? path.join(process.env.TONGPING_HOME.trim(), "app-chat-room.json")
  : null;

export const appChatLedger = new AppChatRoom(roomFile);

function normalizeProfile(value: string): string {
  const text = String(value ?? "").trim();
  if (!PROFILE_RE.test(text)) {
    throw new Error("Invalid chat profile.");
  }
  return text;
}

function normalizeIdentity(value: string): string {
  const text = String(value ?? "").trim().toLowerCase();
  if (!IDENTITY_RE.test(text)) {
    throw new Error("Invalid chat identity.");
  }
  return canonicalIdentity(text);
}
