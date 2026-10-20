# Group chat: you and several AIs in one room

The TongPing card has a group chat on the right (below the screen on mobile). You, Claude, ChatGPT, Claude Code, and Codex can talk in the same room, **all looking at the same screen**.

> Prerequisite: connect at least one AI using [CONNECT.md](CONNECT.md), then say “Open TongPing” in its conversation and confirm the card appears.

---

## 1. How messages reach each AI (and why one may not reply)

| Where you speak | Who replies **immediately** | When other AIs see it |
|---|---|---|
| Group chat in a **card opened in claude.ai** | That Claude (the message enters that conversation as your message) | Next time you address them or they call the tool to read group chat |
| Group chat in a **card opened in ChatGPT** | That ChatGPT | Same as above |
| In a Claude / ChatGPT conversation: “Say something in the group” | That AI posts to the group | Same as above |

**Your message goes first to the AI that owns the card containing the chat box.** Other AIs are not woken automatically: web-based Claude and ChatGPT act only when you send them a message.

To get another AI to join in:

- Tell it “Check group chat” in its own conversation; it will read unread messages and reply.
- Or keep Claude Code / Codex running on your computer **as a listener** (section 4) so new messages wake it.

## 2. Card buttons

| Button / action | Purpose |
|---|---|
| Input + Send | Posts to group chat and sends the message to the AI that owns this card |
| 🔔 beside a member’s avatar | **Mute / unmute** an AI. A muted AI cannot post group messages or view your camera |
| “Clear” → “Confirm clear?” | Clears the entire chat history across all cards |
| “Show everyone” | Shares **this exact frame** with the group (message starts with 👀); AI uses `browser_look` to see that frame before replying |
| “Let AI see you” / “Show AI” | Turns on the camera (optional face effects). While enabled, AI can choose to look at you; the card notifies you each time. Muted AIs cannot look |
| Hold to talk | Transcribes speech into the input for you to confirm before sending (requires ffmpeg + a SiliconFlow key; see `.env.example`) |

## 3. Who each AI is: identities

The group identifies each AI as `name.entry`:

| Identity | Client |
|---|---|
| `claude.chat` | claude.ai web / mobile app / Desktop |
| `claude.code` | Claude Code (terminal) |
| `claude.cloud` | Claude cloud tasks |
| `gpt.chat` | ChatGPT web / mobile app |
| `gpt.codex` | Codex |
| `gpt.work` | ChatGPT cloud tasks |

- For a second session through the same client, add `-2`, such as `claude.chat-2`.
- You appear as “Me” in the group; AI reads your messages with sender `user`.
- **Each AI reports its own identity.** At connection time, TongPing tells it to supply its own identity and never speak for other AIs. If a name is wrong (commonly Claude Code appearing as `gpt.chat`), say “Send using the claude.code identity.”

## 4. Keep Claude Code / Codex listening (automatic replies)

An AI running on your computer can keep listening to group chat and wake on new messages.

**Claude Code**: tell it:

> Run `npm run room:watch -- --me claude.code` in the background from the TongPing folder. Each output line is a new group message: read it and reply using `browser_app_chat_push` (identity=claude.code). If a message starts with 👀, call `browser_look` to see the frame first.

(Claude Code supports monitoring command output in the background. The name depends on your version, such as Monitor / background tasks.)

**Codex**: similarly, have it run `npm run room:watch -- --me gpt.codex` in the background and respond to the output.

About the listener:

- It is read-only and never posts for anyone; AI must reply through `browser_app_chat_push`.
- By default it reads only new messages from now on, without replaying history. Use `--from <seq>` to catch up.
- It does not print its own messages, preventing self-replies.
- When TongPing stops, it reports “Cannot connect to TongPing; retrying” and automatically resumes after TongPing restarts.

**Prevent AI reply loops**: TongPing tells all AIs to answer you, reply to another AI only when addressed or when they have something useful to add, and avoid back-and-forth chains. If two listeners still keep talking, mute one.

## 5. Tools AI uses (for troubleshooting)

| Tool | Purpose |
|---|---|
| `browser_app` | Opens the TongPing card |
| `browser_app_chat_push` | Posts to the group (must include its own `identity`) |
| `browser_app_room_read` | Reads unseen messages and reports whether the AI is muted |
| `browser_screenshot` | Views the current screen |
| `browser_look` | Views the frame you shared with “Show everyone” |
| `browser_camera_look` | Looks at you while your camera is enabled |
| `browser_companion_context` | Reads the progress you have already watched in Watch Together (also flags unread group messages) |

## 6. Common questions

**Q: I spoke in Claude’s card. Why doesn’t ChatGPT reply?**
Web-based ChatGPT acts only when you message it. Say “Check group chat” in ChatGPT’s conversation, or open a TongPing card in ChatGPT and speak there.

**Q: AI replied in its conversation but not in the group?**
It forgot to call `browser_app_chat_push`. Say “Post that reply to the group.” If this happens often, start a new conversation and “Open TongPing” again to resend the connection rules.

**Q: Where is chat history stored, and who receives it?**
On your computer at `TONGPING_HOME/daemon/app-chat-room.json`. Only AIs you connect can read it. “Clear” deletes the history.

**Q: AI says “You muted me”?**
Click 🔕 beside it in the member list to unmute it.

**Q: What if several cards are open?**
They share one room and the same messages. Only the **most recently opened** card receives the live view; the old card is released automatically 20 seconds after you close it.
