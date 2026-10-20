# Other AIs (Kimi, custom frontends, etc.): guidance

> **TongPing Personal Edition is built for official Claude clients (claude.ai / Claude App / Claude Code) and official ChatGPT clients (ChatGPT / Codex), and tested only with them.**
> This page offers ideas for experimentation. **Whether another client works, and how well, depends on how much of MCP it supports.** First check client support when troubleshooting.

---

## TongPing’s three layers

| Layer | What it provides | Client requirements | Without support |
|---|---|---|---|
| ① Tools | 50 MCP tools: open/read/click/type, screenshots, video progress and subtitles, send/read group chat… | **MCP Streamable HTTP** (remote MCP), with Bearer token or OAuth 2.1 authentication | Use stdio (below), with reduced functionality |
| ② Card | Interactive live view, group chat, Watch Together, camera (MCP Apps, `ui://` resources) | **MCP Apps** (supported by Claude and ChatGPT; most third-party clients do not support it yet) | No card; use `/live` for the view and manual control |
| ③ Group chat | A shared room for you and multiple AIs | Layer ① is enough to **post and read messages** | You can type only in a card; use a Claude/ChatGPT card if this client has none |

**Any client that supports remote MCP and whose model can call tools can browse, view screenshots, read subtitles, and post to group chat.** The card is optional.

## Connection methods

### A. Remote MCP + custom headers (most common)

- Address: `http://127.0.0.1:45921/mcp` (when the client and TongPing run on the same computer).
- Header: `Authorization: Bearer <TOKEN_FROM_TONGPING_HOME/daemon/daemon-token>`
- Transport: Streamable HTTP (not legacy SSE).

Many desktop clients (AI workbenches, IDE plugins) use this setup, just like Claude Code / Codex in [CONNECT.md](CONNECT.md).

### B. Cloud clients (web-based AI platforms)

As with claude.ai / ChatGPT, use the HTTPS tunnel in [INSTALL.md step 6](INSTALL.md#6-optional-set-up-an-https-tunnel-for-claudeai--chatgpt-web) and set the connector URL to `https://YOUR_TUNNEL_ADDRESS/mcp`.

- With **OAuth (dynamic client registration + PKCE)** support, TongPing’s authorization page opens; enter your password.
- If the platform accepts only a fixed token, you can supply the daemon token, but that gives the platform full control of your browser. **Strongly discouraged** unless you trust it completely.

### C. Stdio-only clients (local commands)

```json
{
  "command": "npm",
  "args": ["run", "mcp", "--prefix", "/FULL/PATH/TO/TONGPING"],
  "env": {
    "TONGPING_DAEMON_URL": "http://127.0.0.1:45921",
    "TONGPING_HOME": "/YOUR/HOME/DIRECTORY/.tongping/daemon",
    "TONGPING_CLIENT_NAME": "kimi"
  }
}
```

Limitation: group chat in the stdio process and in the daemon are **different rooms**. Other participants cannot see messages posted this way. Use this mode only for AI browsing.

## What to tell the model after connecting

TongPing provides connection instructions about identities, chat etiquette, and looking at the screen before answering. Some clients do not pass MCP server instructions to the model; add this to the system prompt if needed:

```
You are connected to the TongPing shared browser.
- Your group chat identity is kimi.chat (choose your own name.entry using only lowercase letters, digits, . _ -). Pass this identity to every browser_app_chat_push / browser_app_room_read call.
- Do not speak for other AIs. Answer the user; reply to other AIs only when addressed, and avoid back-and-forth reply chains.
- When the user's request concerns the screen, call browser_screenshot before answering.
- For CAPTCHAs, login, or payments, ask the user to click “Take control” in the card or /live page. Do not attempt them yourself.
- If a tool reports site_risk_*, stop and tell the user. Do not retry.
```

## Known differences and pitfalls

| Symptom | Cause / action |
|---|---|
| Tools truncated or called incorrectly | TongPing has 50 tools. Some clients limit tool counts or models struggle to call them. Enable only common tools: `browser_open`, `browser_read`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_screenshot`, `browser_media_context`, `browser_app_chat_push`, `browser_app_room_read` |
| No card | Client lacks MCP Apps support. `/live` is only a manual remote; it does **not** contain group chat or Watch Together. Use the standalone local room below when a trusted desktop bridge is available. |
| Appears as `gpt.chat` | Model omitted `identity`; the server used its default. Use the prompt above to require it on every call |
| Card metadata has `openai/*` keys after OAuth | TongPing recognizes only claude.ai as a Claude host; all others follow ChatGPT rules. Usually does not affect tool use |
| Screenshots exceed context limits | Prefer `browser_read` / `browser_snapshot` (text), and request screenshots only when needed |

## Standalone local room

TongPing can host its real MCP App card in a normal local browser without exposing the daemon token to that browser. A trusted local launcher exchanges the daemon credential for a one-use launch code; the browser receives a short-lived, HttpOnly, loopback-only session.

On the Hearthside integration, ask the agent:

```text
Open the TongPing room.
```

The agent's local room tool opens the full card (live screen, group chat, Watch Together, and takeover) and attaches its chat composer to the current Hearthside conversation. The page never stores the daemon token in its URL, DOM, cookies readable by JavaScript, `localStorage`, or `sessionStorage`.

Opening `/app` directly without a trusted launcher shows instructions rather than asking you to paste the daemon token.

## Building your own frontend (rendering cards yourself)

The card is a standard MCP Apps page (`ui://` resource; see `src/browser-app.ts`) that communicates with the conversation through the `@modelcontextprotocol/ext-apps` host bridge:

- `sendMessage` sends your group chat input into the conversation and asks the model to reply with `browser_app_chat_push`.
- `updateModelContext` tells the model what you are viewing.
- Live video, audio, and Watch Together use WebSocket / HLS URLs inside the card (signed links supplied by the `browser_app` tool result).

Implementing this host protocol lets a custom frontend embed the card. The built-in standalone local room is the reference local implementation. `/live` remains a compatibility remote for view and manual control only.
