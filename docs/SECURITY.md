# Security

TongPing lets AI operate a **real browser signed into your accounts**. These are its security boundaries and the precautions you must take yourself.

## Where your data lives

| Data | Location | Does it leave your computer? |
|---|---|---|
| Website login sessions, cookies | `TONGPING_HOME/worker/profiles/` | No |
| Daemon and worker tokens | `TONGPING_HOME/daemon/` | No (unless you copy them elsewhere) |
| OAuth authorizations | `TONGPING_HOME/daemon/oauth-store.json` | No |
| Group chat history | `TONGPING_HOME/daemon/app-chat-room.json` (use “Clear” in the card to erase it) | Only sent to AIs you connect |
| Page content, screenshots, screen views | Sent to the requesting AI only when it calls a tool | Sent to the AI provider you connect |
| Audit log | `TONGPING_HOME/worker/audit/actions.jsonl` | No; records action types, **not text entered** |

TongPing itself does not connect to third-party servers. The only exceptions are features you choose to configure: HTTPS tunnels (traffic passes through the tunnel provider), “Hold to talk” in the card (audio goes to SiliconFlow), camera effects (face-model scripts load from jsDelivr / Google), and local subtitles (a one-time model download from HuggingFace or a mirror during installation; recognition itself stays local and audio is not uploaded).

## Protections TongPing provides

- **Local listening only**: binds to `127.0.0.1` by default, inaccessible from the LAN or internet.
- **Authentication**: `/mcp` requires a daemon or OAuth token. OAuth login requires your configured password; 10 failed attempts within 10 minutes trigger a lockout.
- **Host / Origin validation**: accepts only allowlisted domains to prevent DNS rebinding attacks.
- **Password fields**: AI cannot type into password inputs.
- **High-risk clicks**: purchases, payments, transfers, account deletion, and similar actions require approval for each click. Approval is single-use and bound to a specific element.
- **Human takeover**: while you use “Take control,” AI clicks, typing, and navigation are locked.
- **Website anti-abuse protection**: risk-control / CAPTCHA pages on sites such as Xiaohongshu and Douyin automatically stop AI write actions on that site; action rates also have budgets.
- **Standalone local room**: `/app` is loopback-only and starts only through an authenticated one-use launch. Its short-lived session is held in an HttpOnly, SameSite=Strict cookie; state-changing calls also require exact-origin CSRF proof. The daemon token is never placed in the page, URL, JavaScript-readable storage, or card iframe. Card tool calls pass through a closed allowlist and are bound to the launched identity and profile.

## Precautions you must take

1. **Never share `TONGPING_HOME` or tokens**, even for troubleshooting. Anyone with the daemon token can fully control this browser and all accounts signed into it.
2. **Use a long, random, unique OAuth password.** Opening a tunnel makes the login page publicly reachable.
3. **Do not set `TONGPING_HOST` to `0.0.0.0` or forward router ports.** Use HTTPS tunnels for remote access.
4. **Do not publish your tunnel address** in screenshots, posts, or group chats.
5. **Connect only AI clients you trust.** Every connected AI can see page content.
6. **Choose accounts carefully.** Avoid signing into high-value accounts such as online banking or your primary email in TongPing’s browser.
7. Follow website terms of service. Users bear the consequences of automation, including account bans.

## If you suspect a leak

1. Stop TongPing immediately and close the tunnel.
2. Delete `TONGPING_HOME/daemon/daemon-token` (rotates the daemon token) and `TONGPING_HOME/daemon/oauth-store.json` (revokes all OAuth authorizations).
3. Change `TONGPING_OAUTH_PASSWORD` in `.env`.
4. Restart TongPing and reconfigure each AI client.
5. For affected website accounts, sign out in TongPing’s browser or delete the corresponding profile folder under `TONGPING_HOME/worker/profiles/`; change passwords on those websites and sign out all devices.
