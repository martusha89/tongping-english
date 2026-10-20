# Install TongPing Personal Edition

> Applies to `0.4.0-personal.2`. Each step includes a success check. If it fails, stop and consult the corresponding section in [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

There are 7 steps. Completing the first 5 enables local use; step 6 enables claude.ai / ChatGPT on the web.

| Step | Task | Required? |
|---|---|---|
| 1 | Install Node.js 20+ | Yes |
| 2 | Install Chrome (or Edge) | Yes |
| 3 | Install ffmpeg | For Watch Together / voice input |
| 5b | Install local subtitles (speech recognition) | Optional: lets AI understand videos **without subtitles** |
| 4 | Download TongPing and install dependencies | Yes |
| 5 | Start and self-test | Yes |
| 6 | Set up an HTTPS tunnel (for web-based AI) | Optional |
| 7 | Connect your AI | See [CONNECT.md](CONNECT.md) |

---

## 1. Install Node.js 20 or newer

- **Windows / macOS**: visit <https://nodejs.org/en>, download the **LTS** installer, and follow its prompts.
  If downloads are slow in mainland China, use <https://npmmirror.com/mirrors/node/> (choose a `.msi` / `.pkg` from `v22.x` or `v20.x`).
- **macOS (Homebrew)**: `brew install node@22`
- **Ubuntu / Debian**: `apt install nodejs` often installs version 18, which is **too old**. Use nvm:
  ```bash
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  # Close and reopen the terminal
  nvm install 22
  ```

**Success check**: open a **new** terminal (PowerShell or Terminal on Windows) and run:

```bash
node -v
```

It should show `v20.x.x` or newer. If it shows `v18` or “not recognized as an internal or external command,” see [N1](TROUBLESHOOTING.md#n1-wrong-node-version-or-node-not-found).

## 2. Install Chrome (recommended) or Edge

Install the desktop version of Google Chrome normally. TongPing opens a **separate** Chrome window with its own data directory, leaving your everyday Chrome bookmarks and accounts alone.

- For Edge, later change `TONGPING_CHANNEL=chrome` to `TONGPING_CHANNEL=msedge` in `.env`.
- If you prefer neither, or use a Linux server, run this after installing dependencies in step 4:
  ```bash
  npx playwright install chromium          # Windows / macOS
  npx playwright install --with-deps chromium   # Linux (uses sudo to install system libraries)
  ```
  Then remove the `TONGPING_CHANNEL=chrome` line from `.env`.

## 3. Install ffmpeg

Watch Together (delayed, buffered video playback) and the card’s “Hold to talk” feature require ffmpeg. **TongPing starts without it**: browsing, chat, and live view work, but Watch Together stays at “0 seconds buffered.”

- **Windows** (choose one):
  - With winget (usually included in Windows 10/11), run `winget install Gyan.FFmpeg` in PowerShell.
  - Manually: download <https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip>, extract it somewhere such as `C:\ffmpeg`, and add `C:\ffmpeg\ffmpeg-VERSION-essentials_build\bin` to the system `Path` (search the Start menu for “Edit the system environment variables” → Environment Variables → Path → New).
- **macOS**: `brew install ffmpeg`
- **Ubuntu / Debian**: `sudo apt install -y ffmpeg`

**Success check**: **close all terminal windows and reopen one**, then run `ffmpeg -version`. The first line should show `ffmpeg version ...`.
(On Windows, existing terminals and VS Code do not see a changed Path until reopened.)

## 4. Download TongPing and install dependencies

1. On GitHub, click **Code → Download ZIP** and extract it, or use `git clone`.
2. Choose a **simple path**, such as `C:\tongping` or `~/tongping`. Paths with Chinese characters or spaces have been tested successfully, but move to an ASCII-only path first if unusual errors occur.
3. Open a terminal in this folder:
   - Windows: Shift + right-click empty space in the folder → “Open in Terminal” / “Open PowerShell window here.”
   - macOS: right-click the folder → Services → “New Terminal at Folder.”
4. Run:

```bash
npm ci
```

If your network in mainland China is slow or reports `ETIMEDOUT` / `ECONNRESET`, switch registries first:

```bash
npm config set registry https://registry.npmmirror.com
npm ci
```

**Success check**: the last line looks like `added 55 packages in 20s`, and the folder contains `node_modules`.

5. Create the configuration file:

```bash
# Windows PowerShell
copy .env.example .env
# macOS / Linux
cp .env.example .env
```

The defaults work with your local Chrome. Each setting is explained in `.env` comments; open it in a text editor to change it.

> Windows shortcut: double-click **`Start-TongPing.cmd`** in the folder to install dependencies, create `.env`, and start TongPing automatically (steps 4 and 5 above). On macOS, use `start.command` (first run `chmod +x start.command` in a terminal).

## 5. Start and self-test

```bash
npm run up
```

This output confirms startup. **Keep this window open**:

```
==============================================
 TongPing Personal Edition is running
  Local health: http://127.0.0.1:45921/health
  Local MCP:    http://127.0.0.1:45921/mcp
  ...
```

After a few seconds, `[worker] Worker paired/authorized. Starting long-poll loop...` confirms that the worker is connected too.

Open **another terminal** in the same folder and run:

```bash
npm run selftest
```

The self-test opens a separate Chrome window and checks:

```
✅ health: daemon online, worker connected
✅ MCP handshake + tool list
✅ Browsing: open a page and read its text
✅ Video: open a video page and read playback state
✅ Video: capture a frame
✅ Open TongPing card (obtain a card ticket)
✅ Video: card live view (continuous WebSocket frames)
✅ Chat: AI posts → another AI reads it
✅ Chat: human posts in card → AI reads it
All self-tests passed 🎉
```

If any check shows ❌, run `npm run doctor` and give its output and [TROUBLESHOOTING.md](TROUBLESHOOTING.md) to your AI.

> The test video is a 5-second CC0 public clip from MDN. If MDN is unreachable, supply a directly accessible `.mp4`:
> `npm run selftest -- --video https://ACCESSIBLE_ADDRESS/xxx.mp4`

**Stop TongPing**: press `Ctrl+C` in the `npm run up` window.

## 5b. Optional: install local subtitles

AI can already read subtitles provided by websites (Bilibili CC subtitles, YouTube subtitles, etc.) in Watch Together. For videos **without subtitles** (many short videos, recorded streams, and foreign-language videos), local speech recognition also lets AI read the dialogue. Recognition runs entirely on your computer; audio is not uploaded.

Requires **Python 3.9–3.14**. If needed, install 3.11 or 3.12 from <https://www.python.org/downloads/>. On Windows, **check “Add python.exe to PATH”** and reopen the terminal afterward.

```bash
npm run asr:install            # Normal access to international sites (most Claude / ChatGPT users)
npm run asr:install -- --cn    # Slow international access (Tsinghua pip mirror; models from hf-mirror.com)
```

- NVIDIA GPU: automatically installs the GPU version, downloading about 1.3 GB of runtime libraries + a 1.6 GB model (large-v3-turbo), for fast, accurate recognition.
- No NVIDIA GPU / Mac: CPU version, about 0.3 GB of runtime libraries + a 0.5 GB model (small). A tested 44-second clip took about 21 seconds to transcribe, with lower accuracy.
- Force CPU mode: `npm run asr:install -- --cpu`

**Success check**: the last line shows `✅ Subtitle service ready: model …, device cuda/cpu`. Then **restart TongPing** (`Ctrl+C`, then `npm run up`).

In Watch Together, subtitles reach AI about 10–15 seconds behind the picture (recognition runs in 8-second chunks). The first chunk may be skipped during model warm-up. To remove it: `npm run asr:install -- --uninstall`.

At this point, local Claude Code / Codex can connect → [CONNECT.md](CONNECT.md).

## 6. Optional: set up an HTTPS tunnel for claude.ai / ChatGPT web

The claude.ai and ChatGPT servers run in the cloud and cannot reach your computer’s `127.0.0.1`. An **HTTPS tunnel** forwards your local port 45921.

> ⚠️ While the tunnel is open, anyone who knows its address can reach TongPing’s login page. TongPing protects it with an **OAuth authorization password**: **set a random password at least 12 characters long**, and never publish the tunnel address.

### Option A: temporary Cloudflare tunnel (free, no registration, good for trying it)

1. Download cloudflared: <https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/> (Windows: choose `cloudflared-windows-amd64.exe`, optionally rename it `cloudflared.exe`). macOS: `brew install cloudflared`.
2. Start the tunnel **first**, in a new terminal that you keep open:
   ```bash
   cloudflared tunnel --url http://127.0.0.1:45921
   ```
   Find and copy the `https://xxxx-xxxx-xxxx.trycloudflare.com` address in the output.
3. Uncomment and fill in these settings in `.env`:
   ```ini
   TONGPING_PUBLIC_ORIGIN=https://xxxx-xxxx-xxxx.trycloudflare.com
   TONGPING_OAUTH_PASSWORD=RANDOM_STRING_AT_LEAST_12_CHARACTERS
   ```
4. Press `Ctrl+C` in the `npm run up` window, then run `npm run up` again (**changes to .env require a restart**). Startup output now includes “Public MCP URL.”
5. Run `npm run doctor`; confirm `✅ [tunnel] Public address reaches local TongPing` and `✅ [oauth]`.

Drawback: **the address changes every time cloudflared restarts**. Update `.env`, restart TongPing, and remove and re-add the connector in Claude/ChatGPT each time.

### Option B: a fixed address (recommended for ongoing use)

- **Cloudflare named tunnel**: requires a domain hosted on Cloudflare. Follow the official guide to create a tunnel and point a subdomain (such as `tongping.YOUR_DOMAIN.com`) to `http://127.0.0.1:45921`.
- **Tailscale Funnel**: free, with a fixed address such as `https://COMPUTER_NAME.xxx.ts.net`. Install Tailscale, sign in, and run `tailscale funnel 45921` (refer to Tailscale’s official documentation for details).

Set `TONGPING_PUBLIC_ORIGIN` to the fixed `https://` address, restart TongPing, and verify with `npm run doctor`.

> The free ngrok plan is not recommended: it inserts a warning page into browser requests, preventing the card view from loading.

## 7. Connect your AI

See **[CONNECT.md](CONNECT.md)**.

---

## Appendix: everything that gets created (for uninstalling)

| Location | Contents |
|---|---|
| TongPing folder | Code, `node_modules`, `.env` |
| `TONGPING_HOME` (default `~/.tongping`, or `C:\Users\YOUR_USERNAME\.tongping` on Windows) | `daemon/`: tokens, OAuth records, Watch Together buffer; `worker/`: browser profiles (**login sessions and cookies**) |
| Playwright Chromium (only if you ran `npx playwright install`) | Windows `%LOCALAPPDATA%\ms-playwright`, macOS `~/Library/Caches/ms-playwright`, Linux `~/.cache/ms-playwright` |
| Node.js / ffmpeg / cloudflared installed by you | Uninstall using their respective methods |

See [UNINSTALL.md](UNINSTALL.md) for removal instructions.
