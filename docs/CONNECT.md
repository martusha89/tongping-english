# Connect TongPing to your AI

Prerequisites: `npm run up` is running and every `npm run selftest` check passes.

| Your client | Connection | Tunnel needed? | Authentication |
|---|---|---|---|
| Claude Code (terminal) | Local HTTP | No | Daemon token |
| Codex CLI / Codex App | Local HTTP | No | Daemon token |
| claude.ai web / Claude mobile app / Claude Desktop | Public HTTPS | **Yes** | OAuth authorization password |
| ChatGPT web / mobile app | Public HTTPS | **Yes** | OAuth authorization password |

> One TongPing instance can connect to **multiple AIs at once**, sharing the same browser and group chat room.
>
> This project is tested only with the four official client categories above. For other AIs (Kimi, desktop clients, custom frontends), see [OTHER-CLIENTS.md](OTHER-CLIENTS.md).

---

## Get the daemon token first (local clients)

The token file is `TONGPING_HOME/daemon/daemon-token`, by default:

- Windows: `C:\Users\YOUR_USERNAME\.tongping\daemon\daemon-token`
- macOS / Linux: `~/.tongping/daemon/daemon-token`

Open it in a text editor. The single line of text is the token. `npm run up` also prints the file’s path at startup.

> The token is the key to full control of this browser. **Do not send it to anyone, paste it into chat, or commit it to git.** If you suspect a leak, delete this file and restart TongPing to generate a new one (then update the token in all local clients).

---

## Claude Code

```bash
claude mcp add --transport http tongping http://127.0.0.1:45921/mcp --header "Authorization: Bearer YOUR_TOKEN_HERE"
```

- To use it in every project, add `-s user`: `claude mcp add -s user --transport http tongping ...`
- **Success check**: `claude mcp list` shows `tongping: http://127.0.0.1:45921/mcp (HTTP) - ✔ Connected`.
- Tell Claude Code: “Use TongPing to open https://example.com and read it to me.”
- Claude Code’s group chat identity is `claude.code`. The server reminds AI to supply its identity. If it appears as `gpt.chat`, say “Send using the claude.code identity.”

## Codex

```bash
# Put the token in an environment variable first (Windows PowerShell: use setx, then reopen the terminal)
setx TONGPING_TOKEN "YOUR_TOKEN_HERE"          # Windows
export TONGPING_TOKEN="YOUR_TOKEN_HERE"        # macOS / Linux; consider adding this to ~/.zshrc or ~/.bashrc

codex mcp add tongping --url http://127.0.0.1:45921/mcp --bearer-token-env-var TONGPING_TOKEN
```

- **Success check**: `codex mcp list` shows `tongping` with Status `enabled` and Auth `Bearer token`; then ask Codex to call `browser_profiles`.
- Its group chat identity is `gpt.codex`.

---

## claude.ai (web / mobile app / Desktop)

First complete [INSTALL.md step 6](INSTALL.md#6-optional-set-up-an-https-tunnel-for-claudeai--chatgpt-web): `.env` must contain `TONGPING_PUBLIC_ORIGIN` and `TONGPING_OAUTH_PASSWORD`, and `npm run doctor` must show `✅ [tunnel]`.

1. Open claude.ai → profile picture at bottom left → **Settings → Connectors → Add custom connector**.
   (Check Anthropic’s official pages for current names and plan requirements; the interface may change.)
2. Choose a name, such as “TongPing”; enter **`https://YOUR_TUNNEL_ADDRESS/mcp`** as the URL (including `/mcp`).
3. Adding it opens TongPing’s authorization page. Enter `TONGPING_OAUTH_PASSWORD`.
4. Start a new conversation. Check that “TongPing” is enabled in the input’s tools / connectors menu, then say **“Open TongPing.”**
5. A TongPing card with a screen view and group chat confirms success.

Claude Desktop and the Claude mobile app share the same account’s connectors. Once added on the web, they sync automatically; no separate setup is needed.

## ChatGPT (web / mobile app)

Complete the tunnel setup first here too.

1. ChatGPT → **Settings → Apps & Connectors → Advanced → enable Developer mode**.
   (Check OpenAI’s official instructions for plan requirements and the current location.)
2. Return to “Apps & Connectors” → **Create**:
   - MCP server URL: **`https://YOUR_TUNNEL_ADDRESS/mcp`**
   - Authentication: **OAuth**
   - Check the confirmation such as “I trust this app.”
3. TongPing’s authorization page opens. Enter `TONGPING_OAUTH_PASSWORD`.
4. Start a new conversation. Select TongPing under **“+” → Developer mode / More** in the input area, then say “Open TongPing.”

---

## Differences between Claude and ChatGPT (read this first when troubleshooting)

TongPing serves both through **the same URL**, but their card rules (MCP Apps / Apps SDK) differ. During OAuth login, TongPing identifies the client by its callback URL and supplies different card metadata:

| Item | claude.ai | ChatGPT |
|---|---|---|
| Identification | OAuth callback is on `claude.ai` | Anything else (treated as ChatGPT by default) |
| Card metadata | **Must not** include `domain` or any `openai/*` keys, or all cards report *Failed to load this connector* | Requires `openai/outputTemplate` |
| Default chat identity | `claude.chat` | `gpt.chat` |
| Tool result size | Oversized results crash the card loader; TongPing keeps results small | More permissive |
| Card mounting | One iframe per card | May mount multiple iframes (web + mobile); TongPing allows up to 6 concurrent viewers |
| Card “Refresh” | Works normally | Some versions show frequent host calls as *Load failed*; TongPing reduces call frequency in live mode |
| Fullscreen | Works normally | The input floats over the card’s bottom edge; TongPing reserves a safe area automatically |

These differences mean:

1. **Complete OAuth login separately for each service.** Do not reuse addresses/tokens obtained through Claude in ChatGPT, or vice versa.
2. **Changing the tunnel address means removing and re-adding the connector in both services.** Updating only one leaves the other returning 401.
3. **Local clients (Claude Code / Codex) use the daemon token, not OAuth.** The server treats them as “not claude.ai”; this does not affect them because terminals do not render cards.
4. Each AI must supply its own `identity` (`claude.chat` / `claude.code` / `gpt.chat` / `gpt.codex` …) in group chat. For a second session through the same client, use a `-2` suffix, such as `claude.chat-2`. AI must not speak for other AIs.

## Things to say to your AI

| You say | AI does |
|---|---|
| Open TongPing | Opens the TongPing card (screen + group chat) |
| Use TongPing to open Bilibili / a URL | Opens it in the shared browser |
| What does this page say? | Reads the current page’s text |
| Look at the screen | Takes a screenshot to see the current view |
| Let’s watch this video together | Opens the video; you click “Enter Watch Together” in the card |
| Check group chat | Reads messages it has not seen yet |

For group chat, who replies, and automatic replies from Claude Code, see **[GROUP-CHAT.md](GROUP-CHAT.md)**.

For CAPTCHAs / QR-code login / payments: click **“Take control”** in the card, complete the action yourself, then click **“Return to AI.”**
