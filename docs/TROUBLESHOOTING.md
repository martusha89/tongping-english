# TongPing Personal Edition · AI troubleshooting handbook

> Applies to `0.4.0-personal.2`.
>
> **For users**: when something goes wrong, send your AI (Claude / ChatGPT / Codex) both:
> 1. This file or its link.
> 2. The full diagnostic summary from `npm run doctor`, plus **a few dozen log lines around the error** in the `npm run up` window.
>
> Then say: “Please troubleshoot TongPing using this handbook.”

---

## Part 0: rules for AI (read this section first)

You are helping someone troubleshoot TongPing on their own computer. They **may have no command-line experience**. Follow these rules:

1. **Get evidence before drawing conclusions.** Always start by asking the user to run `npm run doctor` and paste the diagnostic summary. Address `❌` first, from top to bottom, changing one thing at a time.
2. **Never request secrets.** Do not ask for `daemon-token`, `TONGPING_OAUTH_PASSWORD`, `TONGPING_TOKEN`, cookies, or any file contents under `TONGPING_HOME`. Doctor’s redacted summary is sufficient. If a user shares a token, explain that deleting `TONGPING_HOME/daemon/daemon-token` and restarting rotates it.
3. **Never weaken security to fix an issue.** Do not suggest setting `TONGPING_HOST` to `0.0.0.0`, forwarding router ports, removing the OAuth password, disabling the system firewall, or running as administrator. Use an HTTPS tunnel + authorization password.
4. **Restart after changing `.env`.** Have the user press `Ctrl+C` in the `npm run up` window, then run `npm run up` again. Many changes appear ineffective simply because the service was not restarted.
5. **Give complete commands and say where to run them.** Users may not distinguish PowerShell, cmd, and terminals. Assume a terminal opened in the **TongPing folder**; provide PowerShell commands for Windows.
6. **Distinguish platforms.** See Part 3, section C for claude.ai / ChatGPT differences. Do not apply one service’s fix to the other.
7. **State uncertainty** and specify what information is needed next, such as a particular `/health` field.
8. After fixing the problem, have the user run `npm run selftest` again.

---

## Part 1: system map (for AI reasoning)

```
claude.ai / ChatGPT ──HTTPS tunnel──► daemon :45921 ◄── local Claude Code / Codex (Bearer token)
                                       │  /mcp     MCP (Streamable HTTP)
                                       │  /oauth/* OAuth 2.1 + dynamic registration (enabled only with public origin + password)
                                       │  /health  status JSON (no authentication)
                                       │  /live    mobile web takeover
                                       │  /v1/app/* card ticket APIs and WebSockets (live-ws / audio-ws / media-ws)
                                       │  /v1/worker/* worker long polling (Worker token)
                                       ▼ 127.0.0.1
                                     worker ──► real Chrome (separate profile)
                                       └─ tab video/audio recording → daemon → ffmpeg → Watch Together HLS
```

| Fact | Value |
|---|---|
| Startup | `npm run up` = `scripts/start.mjs`; starts daemon and worker, with log prefixes `[daemon]` / `[worker]` |
| Default port | `45921` (`TONGPING_PORT`) |
| Data directory | `TONGPING_HOME`, default `~/.tongping`, with `daemon/` and `worker/` subdirectories |
| Daemon token | `TONGPING_HOME/daemon/daemon-token` |
| Worker token | `TONGPING_HOME/daemon/worker-auth/worker-token` (launcher passes it to worker automatically) |
| OAuth data | `TONGPING_HOME/daemon/oauth-store.json` |
| Browser profiles | `TONGPING_HOME/worker/profiles/<PROFILE_NAME>` |
| Audit log | `TONGPING_HOME/worker/audit/actions.jsonl` (excludes entered text) |
| Group chat history | `TONGPING_HOME/daemon/app-chat-room.json` |
| Configuration | Project-root `.env`; existing shell variables take precedence |
| External dependencies | Node.js ≥ 20; Chrome/Edge or Playwright Chromium; ffmpeg (Watch Together, voice input) |
| Unauthenticated probe | `GET http://127.0.0.1:45921/health` |

Key `/health` fields:

| Field | Meaning |
|---|---|
| `version` | Running version; should match `package.json` |
| `oauth` | `true` = OAuth enabled (public origin and password set) |
| `worker.connected` / `workerBuild` | Worker connection status and protocol version (`v84` in this release) |
| `liveWs.appRejectedTicket` / `appRejectedCard` | Live card view rejected: expired ticket / a newer card is active |
| `mediaWs.segmentsDroppedNoViewer` | Worker is recording, but no card is in Watch Together |
| `delayedCompanion.active` / `recentExits` | Watch Together ffmpeg session count / recent exits (only `exitCode≠0` is abnormal) |
| `companionCommand.lastError` | Most recent error starting Watch Together recording |

---

## Part 2: symptom index

| Symptom | See |
|---|---|
| `node` not recognized / `v18.x` | [N1](#n1-wrong-node-version-or-node-not-found) |
| PowerShell: `npm.ps1` cannot load because running scripts is disabled | [N2](#n2-powershell-blocks-npmps1) |
| `npm ci` hangs, `ETIMEDOUT`, `ECONNRESET`, `ERR_SOCKET_TIMEOUT` | [N3](#n3-npm-ci-network-failure) |
| `npm ci` reports `EUSAGE` / `package-lock.json` mismatch | [N4](#n4-npm-ci-lockfile-error) |
| `EADDRINUSE` / port occupied by another program | [P1](#p1-port-in-use) |
| `daemon lock already exists` | [P2](#p2-daemon-lock-already-exists) |
| `Executable doesn't exist` / `Chromium distribution 'chrome' is not found` | [B1](#b1-browser-not-found) |
| `ProcessSingleton` / `user data directory is already in use` / browser closes immediately | [B2](#b2-browser-profile-in-use) |
| Linux: `Host system is missing dependencies` / `libnss3.so` | [B3](#b3-missing-linux-system-libraries) |
| `local worker did not answer in time` / `launchPersistentContext: Timeout 180000ms exceeded` | [B4](#b4-browser-startup-timeout) |
| `[worker] ... HTTP 401: Unauthorized worker` | [W1](#w1-worker-401-unauthorized-worker) |
| Doctor: `Worker is not connected to daemon` | [W2](#w2-worker-not-connected) |
| Browsing self-test fails / times out | [S1](#s1-browsing-self-test-fails) |
| Video self-test playback time does not advance | [S2](#s2-video-self-test-does-not-advance) |
| Live-view self-test receives zero or few frames | [S3](#s3-zero-live-view-frames) |
| Watch Together stays at 0 seconds buffered / preparing | [F1](#f1-watch-together-buffer-stays-at-0-seconds) |
| Watch Together stutters or repeatedly restarts | [F2](#f2-watch-together-stutters-or-repeats) |
| “Hold to talk” does nothing | [F3](#f3-hold-to-talk-unavailable) |
| AI cannot read dialogue in unsubtitled videos / `npm run asr:install` fails | [F4](#f4-local-subtitles-speech-recognition) |
| Other AIs do not reply / reply absent from group / wrong identity | [GROUP-CHAT.md section 6](GROUP-CHAT.md#6-common-questions) and [C4](#c4-wrong-group-chat-identity) |
| Doctor: public address unreachable | [T1](#t1-public-address-unreachable) |
| Public URL returns `403` / `Invalid Host` | [T2](#t2-403--invalid-host) |
| Worked yesterday, disconnected today (temporary tunnel) | [T3](#t3-temporary-tunnel-address-changed) |
| Authorization: wrong password / too many attempts | [O1](#o1-wrong-authorization-password--too-many-attempts) |
| Claude/ChatGPT connector cannot be added / persistent 401 | [O2](#o2-cannot-add-connector-or-persistent-401) |
| claude.ai: `Failed to load this connector` / blank card | [C1](#c1-claudeai-card-fails-to-load) |
| ChatGPT: card `Load failed` / missing tools | [C2](#c2-chatgpt-card-or-tool-issues) |
| Card black / frozen / stuck connecting | [C3](#c3-card-black-or-frozen) |
| Wrong group identity (Claude appears as gpt.chat, etc.) | [C4](#c4-wrong-group-chat-identity) |
| AI says “You muted me” / cannot post | [C5](#c5-ai-muted) |
| `... are stopped for this profile` / `site_risk_human_required` / `site_risk_cooldown` | [R1](#r1-website-risk-control-freeze) |
| `High-risk click blocked` / approval required | [R2](#r2-high-risk-clicks-blocked-payments-deletion-etc) |
| `Profile ... is under human takeover` | [R3](#r3-ai-reports-human-takeover) |
| AI actions slow / timing out | [X1](#x1-slow-actions-or-timeouts) |
| Watch Together stops after screen lock | [X2](#x2-watch-together-stops-on-screen-lock) |

---

## Part 3: solutions

### N Installation

#### N1 Wrong Node version or node not found
- Symptom: `node -v` is not found or shows `v18.x`; launcher says `Node.js 20 or newer is required`.
- Follow [INSTALL.md step 1](INSTALL.md#1-install-nodejs-20-or-newer) to install LTS. **Close and reopen all terminals** afterward.
- Linux: `apt install nodejs` often installs 18; use nvm or NodeSource.
- **`npm ci` can succeed on Node 18**, which does not mean TongPing works. `npm run up` then requires Node.js 20, and Playwright reports `Playwright requires Node.js 20 or higher`. Trust `node -v` and the first line of `npm run doctor`.
- New Node installed but old version still shown: an old Node comes first in PATH. Run `where.exe node` on Windows or `which -a node` on macOS/Linux; inspect the first result and uninstall the old version.

#### N2 PowerShell blocks npm.ps1
- Symptom: cannot load `C:\Program Files\nodejs\npm.ps1` because running scripts is disabled on this system.
- Choose one:
  - Allow scripts for the current user only: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, then enter `Y`.
  - Keep policy unchanged: replace `npm` with `npm.cmd`, such as `npm.cmd ci` or `npm.cmd run up`.
  - Double-click `Start-TongPing.cmd` (uses cmd and is unaffected).

#### N3 npm ci network failure
- Run `npm config set registry https://registry.npmmirror.com`, then retry `npm ci`.
- Corporate network/proxy: use `npm config set proxy http://PROXY_ADDRESS:PORT` and `https-proxy`.
- After an interrupted installation, delete `node_modules` and run `npm ci` again.

#### N4 npm ci lockfile error
- Symptom: `npm ci can only install packages when your package.json and package-lock.json are in sync`.
- Cause: edited `package.json` or files mixed in from another copy.
- Download the complete release again. Do not bypass with `npm install` (it changes the lockfile and breaks version consistency for troubleshooting).

### P Ports and processes

#### P1 Port in use
- Symptom: `EADDRINUSE` or doctor says `Port 45921 is occupied by another program, not TongPing`.
- First check for **an old TongPing instance**: if `http://127.0.0.1:45921/health` loads and `service` is `tongping`, it is running; find that window and press `Ctrl+C`.
- Identify the process: Windows `netstat -ano | findstr :45921`; the last column is the PID, which you can find in Task Manager → Details. macOS/Linux: `lsof -i :45921`.
- Or change `.env` to `TONGPING_PORT=46921` and restart. **Also update** the address in local clients (Claude Code / Codex) and the port in the tunnel command.

#### P2 daemon lock already exists
- Symptom: `tongping daemon lock already exists at ... Stop the existing daemon before starting another one.`
- Cause: another daemon is using the same `TONGPING_HOME`.
- Close the other TongPing window. If you have confirmed none is running (no relevant node process in Task Manager), delete `TONGPING_HOME/daemon/daemon.lock` and restart.

### B Browser

#### B1 Browser not found
- Symptom: `Chromium distribution 'chrome' is not found` (`TONGPING_CHANNEL=chrome` set but Chrome not installed), or `Executable doesn't exist at ...ms-playwright...` (no channel set and no Playwright Chromium installed).
- Choose one:
  - Install Chrome and keep `TONGPING_CHANNEL=chrome` (use `msedge` for Edge).
  - Run `npx playwright install chromium` in the TongPing folder and remove the `TONGPING_CHANNEL` line from `.env`.
- If Playwright Chromium downloads are slow in mainland China, prefer local Chrome.

#### B2 Browser profile in use
- Symptom: `ProcessSingleton`, `user data directory is already in use`, or TongPing’s Chrome closes immediately.
- Cause: two browser processes opened the same profile directory, often because Chrome was manually opened on `TONGPING_HOME/worker/profiles/...` or a crash left Chrome running.
- Stop TongPing → end `chrome.exe` processes whose command lines contain `.tongping` in Task Manager → restart TongPing.
- Do not manually start daemon and worker with the same `TONGPING_HOME` root. Use `npm run up`, which separates `daemon/` and `worker/` automatically.

#### B3 Missing Linux system libraries
- Run `npx playwright install-deps chromium` (requires sudo) or `npx playwright install --with-deps chromium`.
- Without a desktop environment, set `TONGPING_HEADLESS=1`. Watch Together recording and manual login takeover are **untested** in headless mode.

#### B4 Browser startup timeout
- Symptom: `browser_open` reports `TongPing local worker did not answer in time`; worker logs show `launchPersistentContext: Timeout 180000ms exceeded`, possibly followed by `worker result HTTP 409`.
- Meaning: Chrome started but never became controllable.
- Try in order:
  1. Retry once (`npm run selftest` already retries automatically once).
  2. End leftover `chrome.exe` processes with `.tongping` in their command lines (see [B2](#b2-browser-profile-in-use)), then restart TongPing.
  3. Antivirus / corporate security software may block program-controlled Chrome. Allowlist the TongPing folder and `TONGPING_HOME`, then retry.
  4. Compare with Playwright Chromium ([B1](#b1-browser-not-found), second option). If that works, the issue is with local Chrome.
  5. Technical note: if `USERPROFILE` was changed for testing, its directory must contain `AppData\Local` and `AppData\Roaming`, or Windows Chrome hangs at startup.
- `HTTP 409` itself is harmless: the daemon discarded a result arriving after the timeout.

### W Worker

#### W1 worker 401 Unauthorized worker
- Symptom: repeated `[worker] worker loop: worker poll HTTP 401: {"ok":false,"error":"Unauthorized worker"}`.
- Cause: daemon and worker were started manually instead of using `npm run up`, leaving private single-user pairing switches missing or tokens mismatched.
- Stop all TongPing processes and start only with `npm run up`. The launcher sets `TONGPING_REMOTE_WORKER=1`, `TONGPING_DEPLOYMENT_MODE=private-single-user`, and `TONGPING_PAIRING_AUTHORITY=private-single-user`, and passes `daemon/worker-auth/worker-token` to the worker.

#### W2 Worker not connected
- Read `[worker]` lines in the `npm run up` window. Most often [B1](#b1-browser-not-found) / [B2](#b2-browser-profile-in-use).
- When the worker exits, the launcher stops all of TongPing and prints `[worker] Exited (code=...)`. Scroll up to the first error.

### S Self-test

#### S1 Browsing self-test fails
- The default page is `https://example.com/`. If it cannot open, this computer cannot reach that site (network/proxy issue); it is not a TongPing issue.
- Use an accessible URL: `npm run selftest -- --page https://www.baidu.com/` (then the check only verifies that content was read).

#### S2 Video self-test does not advance
- The default is MDN’s 5-second CC0 clip. If unreachable, use a direct mp4 link: `npm run selftest -- --video https://ACCESSIBLE_ADDRESS/xxx.mp4`.
- If it opens but `paused=true`, Chrome’s autoplay policy blocked playback. TongPing attempts a play click; if unsuccessful, click play manually in its Chrome window and rerun.

#### S3 Zero live-view frames
- Check `health.workerBuild`: must be `v84` (versions below `v19` do not provide live view). A mismatch means daemon and worker use different code; reinstall per [UPGRADE.md](UPGRADE.md).
- Very low frame rates are normal for a static page. The self-test uses video and should receive ≥5 frames / 6 seconds.
- Locking the computer or minimizing TongPing’s Chrome can stop Chrome rendering.

### F Watch Together / ffmpeg / speech

#### F1 Watch Together buffer stays at 0 seconds
- **Most common cause: ffmpeg missing or PATH not updated.** There may be no error; the buffer simply stays at 0.
- Check for `⚠️ [ffmpeg]` in `npm run doctor` and “Note: ffmpeg was not found” at startup.
- Install per [INSTALL.md step 3](INSTALL.md#3-install-ffmpeg), **close and reopen all terminals**, then run `npm run up`.
- If ffmpeg is installed, inspect `/health` fields `companionCommand.lastError` and `delayedCompanion.recentExits[].stderrTail`.
- Watch Together defaults to a 30-second playback delay so AI cannot spoil unseen subtitles/images. “Preparing” during the first half-minute is normal.

#### F2 Watch Together stutters or repeats
- Insufficient upload bandwidth or CPU: TongPing automatically lowers quality to a safe preset. Close resource-heavy programs.
- Frequent `exitCode≠0` in `recentExits`: send `stderrTail` to AI.
- Continuously increasing `mediaWs.streamStarts`: recording is repeatedly restarting, usually because of screen lock ([X2](#x2-watch-together-stops-on-screen-lock)) or replacement of the page’s video (new episode, advertisement).

#### F3 Hold to talk unavailable
- Requires ffmpeg + a SiliconFlow key: set `TONGPING_SILICONFLOW_KEY=...` in `.env` or store the key in `TONGPING_HOME/daemon/siliconflow.key`.
- The host (Claude/ChatGPT app) may deny microphone access to the card; TongPing cannot fix that.

#### F4 Local subtitles (speech recognition)
- Not installed: website subtitles remain readable; AI cannot read dialogue in unsubtitled videos. See [INSTALL.md 5b](INSTALL.md#5b-optional-install-local-subtitles).
- `Python 3.9–3.14 was not found`: install Python 3.11/3.12 (check Add to PATH on Windows), then reopen the terminal. Some programs bundle minimal Python without venv; the installer skips those automatically.
- Slow/failed pip download: add `--cn`.
- `Model failed to load` mentioning huggingface / Connection / timed out: if huggingface.co is unreachable in mainland China, use `npm run asr:install -- --cn` (writes `HF_ENDPOINT=https://hf-mirror.com` to `.env`).
- `open() got an unexpected keyword argument 'metadata_errors'`: PyAV is too new. The installer pins `av<19`; if installed manually, rerun `npm run asr:install`.
- `cuda unavailable, using cpu`: driver too old or GPU not NVIDIA; automatically falls back to slower CPU mode. Update the driver and reinstall.
- Installed but no dialogue: ① **restart TongPing** after installation; ② recognition runs only in **Watch Together**; ③ existing subtitle tracks take priority; ④ nearly silent audio chunks are skipped; ⑤ a 10–15-second subtitle delay is normal.
- Location: `TONGPING_HOME/asr` (virtual environment + `asr_server.py`); models cached at `~/.cache/huggingface`. Uninstall: `npm run asr:install -- --uninstall`.

### T Tunnel

#### T1 Public address unreachable
- Is the tunnel window still open? Closing cloudflared closes the tunnel.
- Does its target port match `TONGPING_PORT` (default `http://127.0.0.1:45921`)?
- Does `TONGPING_PUBLIC_ORIGIN` in `.env` **exactly match** the current tunnel address (`https://`, no path, no trailing slash)?
- Open `https://YOUR_ADDRESS/health` on a phone using cellular data. JSON confirms the tunnel works.

#### T2 403 / Invalid Host
- Cause: request Host is not allowlisted. `npm run up` automatically adds the `TONGPING_PUBLIC_ORIGIN` domain.
- **Manually setting** `TONGPING_ALLOWED_HOSTS` / `TONGPING_ALLOWED_ORIGINS` in `.env` disables automatic addition. Remove those lines or add the tunnel domain yourself (keep `localhost,127.0.0.1,[::1]`).

#### T3 Temporary tunnel address changed
- `trycloudflare.com` addresses change every time cloudflared starts.
- Update `TONGPING_PUBLIC_ORIGIN` in `.env` → restart TongPing → **remove the old connectors in both Claude and ChatGPT, re-add using the new address, and re-enter the password**.
- For ongoing use, switch to a fixed address ([INSTALL.md option B](INSTALL.md#option-b-a-fixed-address-recommended-for-ongoing-use)).

### O OAuth authorization

#### O1 Wrong authorization password / too many attempts
- The password is `TONGPING_OAUTH_PASSWORD` in `.env` (without quotes). Restart TongPing after changing it.
- Ten failed attempts from the same source within 10 minutes trigger a lockout saying “Too many attempts; try again later.” Wait 10 minutes or restart TongPing.

#### O2 Cannot add connector or persistent 401
- Doctor’s `health.oauth` must be `true`. If `false`, `.env` lacks the public origin or password, or TongPing was not restarted.
- Connector URLs must end in **`/mcp`**: `https://YOUR_ADDRESS/mcp`.
- Changing the tunnel address or port, deleting `TONGPING_HOME`, or deleting `oauth-store.json` invalidates old authorizations. Remove and re-add connectors.
- Local Claude Code / Codex 401: incorrect or regenerated daemon token (after deleting `daemon-token`). Copy the token again and update configuration ([CONNECT.md](CONNECT.md)).

### C Cards and chat (Claude / ChatGPT differences)

#### C1 claude.ai card fails to load
- claude.ai metadata **must not** include `domain` or any `openai/*` keys, or **all** cards report `Failed to load this connector`. TongPing removes them automatically after identifying claude.ai by the OAuth callback.
- claude.ai must therefore connect through **its own** OAuth flow (add connector in claude.ai settings and enter the password). Do not connect it by other methods such as manually supplying a token.
- Do not set `TONGPING_UI_DOMAIN` unless you know ChatGPT needs it. It has no effect on claude.ai (removed automatically), but complicates troubleshooting.
- Card appears but is blank: ensure the connector is enabled in this conversation; start a new conversation and say “Open TongPing.” If on mobile, try the web version first.

#### C2 ChatGPT card or tool issues
- No tools at all: Developer mode is off, or TongPing was not selected in this conversation’s “+” menu.
- Occasional `Load failed` while the picture still moves: some ChatGPT hosts misreport background refresh calls as failures; ignore it. If the picture also freezes, see [C3](#c3-card-black-or-frozen).
- The same card may be open on web and mobile simultaneously; up to 6 concurrent viewers are allowed.

#### C3 Card black or frozen
- Increasing `liveWs.appRejectedTicket` in `/health`: expired card ticket (card left idle too long). Ask AI to “Open TongPing” again, or click Refresh in the card.
- Increasing `liveWs.appRejectedCard`: **only the newest card** can view the live feed; old cards are rejected. They release automatically 20 seconds after closing.
- `worker.connected=false`: see [W2](#w2-worker-not-connected).
- A local network change (Wi-Fi switch, proxy toggle) may break a temporary tunnel; see [T1](#t1-public-address-unreachable).

#### C4 Wrong group chat identity
- Each AI supplies its own identity on tool calls: `claude.chat` (claude.ai), `claude.code` (Claude Code), `gpt.chat` (ChatGPT), `gpt.codex` (Codex). Add `-2` for a second session through the same client.
- Without an identity, claude.ai defaults to `claude.chat`; all others default to `gpt.chat`. **Claude Code appears as gpt.chat if it forgets its identity**. Say “Send using the claude.code identity.”
- AI sees human messages from the card with sender `user`.

#### C5 AI muted
- AIs can be muted in the card. A muted AI’s `browser_app_chat_push` call fails. Unmute it in the card’s group member list.

### R Security policies (protections, not faults)

#### R1 Website risk-control freeze
- `site_risk_human_required` / `... are stopped for this profile`: TongPing detected a CAPTCHA, risk-control page, or login requirement on sites such as Xiaohongshu or Douyin and **stopped AI write actions** (clicking, typing, etc.) there to reduce account-ban risk.
- Click “Take control,” complete verification/login yourself, and click “Return to AI” once the page is normal. The freeze lifts automatically (it is in memory only; restarting also clears it).
- `site_risk_cooldown`: AI exceeded the site’s action-rate budget (shared by all AIs). Wait for the indicated time. **Do not bypass it**; it protects your account.

#### R2 High-risk clicks blocked (payments, deletion, etc.)
- Symptom: `Blocked high-risk click target` / `Use browser_request_click_approval`.
- Intentional: purchases, payments, transfers, account deletion, etc. require **approval for each click**. AI requests approval; you approve or reject in `/live` or the card. Each approval is single-use; a changed page requires a new request.

#### R3 AI reports human takeover
- `Profile ... is under human takeover`: someone clicked “Take control” and has not returned it. Click “Return to AI.”

### X Other

#### X1 Slow actions or timeouts
- Typical actions take hundreds of milliseconds to a few seconds. claude.ai/ChatGPT through a tunnel is slower.
- Sleep, high CPU load, and many open profiles slow things down. Ask AI to call `browser_close_profile` for profiles no longer needed.

#### X2 Watch Together stops on screen lock
- Chrome cannot keep recording tabs while Windows is locked. The card reports that the computer appears locked. Recording resumes automatically after unlocking. For long viewing sessions, adjust power settings to prevent automatic lock/sleep.

---

## Part 4: frequently asked questions

**Q: Will TongPing affect my everyday Chrome?**
No. It launches a separate Chrome window with its own data directory. Your usual bookmarks, passwords, and extensions are unaffected.

**Q: Are accounts signed into TongPing safe?**
Login sessions stay in `TONGPING_HOME/worker/profiles` on your computer. AI typing in password fields is rejected; use “Take control” to sign in yourself. Never share `TONGPING_HOME`.

**Q: Can several AIs use it together?**
Yes. Claude, ChatGPT, Claude Code, and Codex can share the browser and group chat simultaneously. Actions from different AIs on the same profile are queued and executed in order.

**Q: Can I use multiple accounts?**
Use different profile names, for example: “Open Xiaohongshu using profile xiaohongshu2.” Each profile has separate cookies.

**Q: Does it work while my computer is off?**
No. Personal Edition runs on your computer. Shutdown, sleep, or closing TongPing’s window disconnects AI.

**Q: Why must claude.ai and ChatGPT log in separately?**
Their card format requirements differ. TongPing identifies the client during authorization and supplies the appropriate format (see [CONNECT.md](CONNECT.md#differences-between-claude-and-chatgpt-read-this-first-when-troubleshooting)).

**Q: Can I deploy it to a cloud server for others?**
Personal Edition is designed and tested only for one person on their own computer. Shared use needs account isolation, authentication, and rate limits, outside this release’s scope.

**Q: How do I find my version?**
The first line of `npm run doctor`, or `version` at `http://127.0.0.1:45921/health`.

---

## Part 5: still stuck

Prepare these before asking for help (**check that no tokens, passwords, or cookies are included**):

1. The complete diagnostic summary from `npm run doctor`.
2. About 50 log lines around the error in the `npm run up` window.
3. What you did, expected, and actually observed.
4. Your AI client (claude.ai / ChatGPT / Claude Code / Codex) and operating system.
