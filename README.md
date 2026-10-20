# TongPing · Personal Edition

> **English edition.** This fork localizes the original [TongPing Personal Edition](https://github.com/lizhima44-max/tongping-personal) for English-speaking users while retaining Chinese-site safety detection and media compatibility. The original attribution and PolyForm Noncommercial license are preserved.

**Let your AI see the same screen as you.** TongPing opens a real Chrome browser on your own computer and makes it available to Claude, ChatGPT, Claude Code, and Codex through MCP:

- **Browse the web**: AI can open, read, click, type, and scroll. Login sessions stay in a browser profile on your computer.
- **Watch videos**: The card shows a live view. Watch Together plays buffered video with a delay, so AI can only see what you have already watched (no spoilers). Optional local speech recognition lets AI read dialogue from videos without subtitles.
- **Chat**: The card includes a group chat where you and multiple AIs, such as Claude and ChatGPT, share a room.
- **Take control**: For CAPTCHAs, QR-code logins, or payments, click “Take control” to operate the browser yourself. AI cannot act during this time. Click “Return to AI” when finished.

Personal Edition means **one computer, one user**. All data stays on your computer; there is no third-party server.

**Designed and tested primarily for official Claude clients (claude.ai / Claude App / Claude Code) and official ChatGPT clients (ChatGPT / Codex).** For Kimi, custom frontends, or other AIs, see [OTHER-CLIENTS.md](docs/OTHER-CLIENTS.md) for guidance, without compatibility guarantees.

| | |
|---|---|
| Version | `0.4.0-personal.2` (see [CHANGELOG](CHANGELOG.md)) |
| Systems | Windows 11 and Linux (Ubuntu 24.04), tested from scratch; Windows 10 / macOS theoretically supported, untested |
| Requirements | Node.js 20+, Chrome or Edge (or Playwright Chromium), ffmpeg (for Watch Together); optional Python 3.9–3.14 (local subtitles) |

## Architecture in 30 seconds

```
 claude.ai / ChatGPT ──HTTPS tunnel──┐
 Claude Code / Codex ──local───────┐ │
                                 ▼ ▼
                     ┌──────── daemon (port 45921) ────────┐
                     │ MCP service · card · chat · OAuth   │
                     └───────────────┬─────────────────────┘
                                     │ local 127.0.0.1
                     ┌───────────────▼─────────────────────┐
                     │ worker: drives Chrome, records A/V  │
                     └─────────────────────────────────────┘
```

`npm run up` starts both the daemon and worker with one command.

## Quick start

See **[docs/INSTALL.md](docs/INSTALL.md)** for the full illustrated walkthrough. If you are comfortable with a terminal:

```bash
# 1. Prepare: Node.js 20+, Chrome, ffmpeg
# 2. Install
npm ci
cp .env.example .env          # Windows: copy .env.example .env
# 3. Start (keep the window open)
npm run up
# 4. In another terminal, run the self-test: browsing / video / chat should all pass
npm run selftest
```

Then follow [docs/CONNECT.md](docs/CONNECT.md) to connect TongPing to your AI.

## Documentation

| Document | Contents |
|---|---|
| [INSTALL.md](docs/INSTALL.md) | Installation (Windows / macOS / Linux), with a success check for each step |
| [CONNECT.md](docs/CONNECT.md) | Connect claude.ai, ChatGPT, Claude Code, and Codex; **differences between Claude and ChatGPT** |
| [OTHER-CLIENTS.md](docs/OTHER-CLIENTS.md) | Guidance for Kimi, custom frontends, and other AIs (not officially supported) |
| [GROUP-CHAT.md](docs/GROUP-CHAT.md) | **Using group chat**: who replies, buttons, identities, and automatic replies from Claude Code |
| [UPGRADE.md](docs/UPGRADE.md) | Upgrade while keeping login sessions |
| [UNINSTALL.md](docs/UNINSTALL.md) | Remove TongPing and its data completely |
| [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | **AI troubleshooting handbook** and common issues. Give it to your AI with the output of `npm run doctor` |
| [SECURITY.md](docs/SECURITY.md) | Security boundaries: what AI cannot do and where your data lives |

## Having trouble?

```bash
npm run doctor
```

This checks each component and prints a **redacted** diagnostic summary. Send the summary and `docs/TROUBLESHOOTING.md` to your AI (Claude or ChatGPT) and ask it to follow the handbook.

## Commands

| Command | Purpose |
|---|---|
| `npm run up` | Start TongPing (daemon + worker); Ctrl+C stops it |
| `npm run selftest` | End-to-end self-test: web pages, video, live view, group chat |
| `npm run doctor` | Health checks and diagnostic summary (read-only; changes nothing) |
| `npm run asr:install` | Install local subtitles (speech recognition). For networks in mainland China, add `-- --cn` |
| `npm run room:watch -- --me claude.code` | Let a local AI monitor group chat (see GROUP-CHAT.md) |
| `npm run check` | Type checking and unit tests (for developers) |

## Usage notes

- TongPing operates **your own** browser and accounts. Follow each website’s terms of service. Frequent automated actions may trigger anti-abuse systems; users bear the consequences.
- By default, it listens only on `127.0.0.1`. Do not expose the port directly to the internet. For web-based AI clients, use an HTTPS tunnel and set an authorization password (see CONNECT.md).
- `TONGPING_HOME` (default `~/.tongping`) contains login sessions and tokens. **Do not upload it or send it to anyone**, even when troubleshooting.

## License

[PolyForm Noncommercial 1.0.0](LICENSE): **commercial use is prohibited**.

- Allowed: personal use, learning, research, hobby projects, use by schools, charities, and nonprofit organizations; modifying for your own use or sharing under the same terms.
- Not allowed: any commercial use, including selling it, charging for services using it, or using it in commercial products or company operations.
- When redistributing or sharing, include the license and its opening `Required Notice` line.

Contact the author first if you need a commercial license.
