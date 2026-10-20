# Changelog

## English edition (2026-10-20)

- Localized the complete browser card, Watch Together flow, group chat, camera controls, OAuth page, MCP tool text, runtime errors, launchers, diagnostics, self-test output, configuration template, documentation, issue template, and accessibility labels into English.
- Replaced the Chinese artwork wordmark with accessible English “TongPing” text and tuned the desktop/mobile layout for longer English labels.
- Preserved Chinese-website subtitle controls, risk detection, transaction protection, CAPTCHA/login-wall recognition, OCR filtering, and representative multilingual test fixtures.
- Renamed the Windows launcher to `Start-TongPing.cmd` while preserving behavior.
- Preserved the upstream `Required Notice` and PolyForm Noncommercial 1.0.0 terms.

## 0.4.0-personal.2 (2026-10-10)

### Usability
- **Follows the tab you are viewing**: switching tabs on your computer or opening a new one (for example, a Bilibili video opening in a new tab) now moves the live view, AI actions, and Watch Together recording to that tab instead of leaving them on the old page.
- **Returning to LIVE takes effect immediately**: switching from Watch Together to live view no longer waits 3 seconds or stalls behind unfinished recording uploads.
- **A subtle hint on video pages**: live view is optimized for responsive clicks; video pages gently suggest “Enter Watch Together for smoother video.”
- **Minimized windows restore automatically**: minimized Chrome windows stop rendering (white screenshots, frozen live view). They now restore automatically while someone is watching.
- **Automatic reconnection**: persistent connections send heartbeats every 15 seconds, detect half-open connections after a network outage, and reconnect. Each log line includes a timestamp.

### Sliders and login
- Slider challenges and login walls on Taobao / Tmall / Xianyu / JD.com / Bilibili / Google / YouTube automatically hand off to a regular Chrome window on your computer while you are watching. Complete the challenge there and close the entire window to reconnect automatically. The card promptly shows handoff and return status. AI is instructed never to solve sliders or CAPTCHAs itself.

### Watch Together
- More reliable recording and recovery: fewer buffering restarts during upload jitter, and quick resumption after recording restarts.
- Cleaner audio context for AI: filters speech recognition hallucinations in instrumental music (such as “Thank you.” or subtitling credits); merges audio segments into chunks of at least 1 second instead of reporting every 20 milliseconds.

### Images for AI
- Screenshots and “Show everyone” now use small JPEGs: some hosts (ChatGPT) store oversized tool results as files, leaving the model unable to see the image.
- Tool instructions clarify that the image is a separate item after the text and must be viewed before answering.
- “Show everyone” during Watch Together on iPhone no longer submits blank images (iOS cannot draw HLS video frames); it uses the server-cached frame you are watching instead.
- “Show everyone” asks AI to view the image first, post its response to group chat, then respond in its own conversation.

### License change
- Changed from MIT to **PolyForm Noncommercial 1.0.0**: personal use, learning, research, and nonprofit use are allowed; **commercial use is prohibited**.

### Other
- Non-English device names no longer cause request errors.
- Stability fixes, including card cache versioning.

## 0.4.0-personal.1 (2026-10-03)

The first public release of TongPing Personal Edition.

### Included
- Shared-browser MCP service: open / read / snapshot / click / type / scroll / screenshot / persistent logins across multiple profiles.
- TongPing card (MCP Apps): live view (WebSocket), audio, manual takeover (“Take control / Return to AI”).
- Watch Together: delayed, buffered HLS playback; subtitles and images available to AI are limited by your viewing progress to avoid spoilers.
- Group chat: one room for you and multiple AIs (claude.chat / claude.code / gpt.chat / gpt.codex …), with mute and clear controls.
- OAuth 2.1 (dynamic registration + PKCE + password), automatically distinguishing claude.ai and ChatGPT card metadata rules.
- Security: no AI typing in password fields, approval for each high-risk click, write freezes and rate budgets for Xiaohongshu/Douyin risk controls, audit logs that omit entered text.

### Added for Personal Edition
- `npm run up`: starts the daemon + local worker with one command, handling pairing tokens, Host allowlists, and data subdirectories automatically.
- `npm run selftest`: end-to-end checks (web pages, video, live view, group chat).
- `npm run doctor`: health checks + redacted diagnostic summary.
- `npm run asr:install`: one-command local subtitle installation (faster-whisper, automatic GPU/CPU selection, `--cn` for mainland China mirrors). AI can read dialogue even in videos without subtitles.
- `npm run room:watch`: keeps local Claude Code / Codex listening to group chat, waking on new messages.
- Group chat guide: `docs/GROUP-CHAT.md`.
- Automatically loads `.env` from the project root.
- `Start-TongPing.cmd` (Windows double-click launcher), `start.command` (macOS).
- Installation / connection / upgrade / uninstall / AI troubleshooting guides, originally all in Chinese.

### Fixes (relative to internal versions)
- After changing `TONGPING_PORT`, card addresses still pointed to 45921, breaking chat and video connections.
- Default paths for Watch Together buffers, speech keys, viewing history, and other data now live under `TONGPING_HOME` instead of hardcoded server paths.
- On Windows, ffmpeg wrote Watch Together HLS init segments to the launch directory (code folder), rather than the data directory. Playback could not retrieve them, and video content landed in the code folder. ffmpeg now runs inside the session directory.
- When the worker was busy or briefly disconnected, the daemon opened a fallback Chrome in another data directory, creating two sets of login sessions (a login in one was invisible in the other). Personal Edition disables this fallback by default and queues commands for the worker.
- On Node 18, Playwright exited the health check without output; it now reports “Node is too old” first. Missing Chromium system libraries on Linux are explicitly listed.

### Not included
- Multi-user hosted edition, cloud-worker pairing, and a Windows installer.

### Known limitations
- **One computer, one user only.** No account isolation, multi-user authentication, or rate limiting; do not deploy as a shared multi-user service.
- **The computer must stay on.** AI cannot connect during shutdown, sleep, or screen lock; Watch Together recording pauses while locked.
- **Web-based AI requires a tunnel.** claude.ai / ChatGPT must connect through HTTPS. Temporary Cloudflare tunnel addresses change on restart, requiring connectors to be re-added.
- **Watch Together requires ffmpeg**, with a default 30-second delay. Without ffmpeg, its buffer stays at 0 (startup and doctor report this).
- Local subtitles are optional (require Python; GPU installation downloads about 3 GB). Subtitles lag the picture by 10–15 seconds; the first chunk may be skipped, and CPU accuracy is lower.
- **Watch Together and manual takeover are untested in headless mode (`TONGPING_HEADLESS=1`).**
- **macOS is untested**; Windows 11 and Ubuntu 24.04 (WSL) were verified from scratch using the guide.
- Refer to official Claude / ChatGPT documentation for menu names and plan restrictions; interface changes may make the guide’s UI descriptions outdated.
- Website anti-abuse systems: automation may trigger risk controls on sites such as Xiaohongshu and Douyin. TongPing automatically freezes AI write actions but cannot guarantee accounts remain unaffected.

### Upgrade notes
- First release; no migration needed.
