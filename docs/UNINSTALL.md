# Uninstall TongPing Personal Edition

Follow these steps in order to remove everything TongPing leaves on your computer. If you only want to stop using it temporarily, step 1 is enough.

## 1. Stop TongPing

- Press `Ctrl+C` in the `npm run up` (or `Start-TongPing.cmd`) window, or close the window.
- Confirm it stopped: `http://127.0.0.1:45921/health` should **not load** in a browser.
  - If it still loads: Windows → Task Manager → Details → end the `node.exe` whose command line contains `tongping`; macOS/Linux: run `pkill -f tongping`.
- Close cloudflared or other tunnel windows too.

## 2. Disconnect AI clients

| Client | Action |
|---|---|
| claude.ai | Settings → Connectors → TongPing → Remove/Disconnect |
| ChatGPT | Settings → Apps & Connectors → TongPing → Remove |
| Claude Code | `claude mcp remove tongping` (add `-s user` if you used it when adding) |
| Codex | `codex mcp remove tongping` |

## 3. Remove the environment variable (only if set for Codex per CONNECT.md)

- Windows PowerShell: `[Environment]::SetEnvironmentVariable("TONGPING_TOKEN", $null, "User")`, then reopen the terminal.
- macOS / Linux: remove the `export TONGPING_TOKEN=...` line from `~/.zshrc` or `~/.bashrc`.

## 4. Delete the data directory (login sessions, tokens, chat history)

> ⚠️ After deletion, you must sign into every website again and re-add all connectors. Make a copy first if you want to keep the data.

| System | Default location |
|---|---|
| Windows | `C:\Users\YOUR_USERNAME\.tongping` |
| macOS / Linux | `~/.tongping` |

If you set `TONGPING_HOME` in `.env`, delete that directory instead.

```powershell
# Windows PowerShell
Remove-Item -Recurse -Force "$env:USERPROFILE\.tongping"
```
```bash
# macOS / Linux
rm -rf ~/.tongping
```

“File in use” means TongPing or its Chrome is still running; return to step 1.

## 5. Delete the TongPing folder

Delete the entire extracted/cloned folder, including `node_modules` and `.env`.

If you see “Folder in use” / “Another program is using this file,” **close every terminal and VS Code window open in that folder** (a terminal’s current directory also keeps it in use), then delete it.

Local subtitles, if installed, live in `TONGPING_HOME/asr` and are removed with the data directory. Downloaded speech recognition models live in folders containing `faster-whisper` under `~/.cache/huggingface/hub` (Windows: `C:\Users\YOUR_USERNAME\.cache\huggingface\hub`). Delete those if no other program uses them to free 0.5–1.6 GB.

## 6. Optional: remove Playwright’s Chromium

This exists only if you ran `npx playwright install chromium`. **Do not delete it** if other projects use Playwright.

| System | Location |
|---|---|
| Windows | `%LOCALAPPDATA%\ms-playwright` |
| macOS | `~/Library/Caches/ms-playwright` |
| Linux | `~/.cache/ms-playwright` |

## 7. Optional: uninstall software installed for TongPing

If you installed Node.js, ffmpeg, or cloudflared solely for TongPing, uninstall them normally (Windows Settings → Apps; `winget uninstall Gyan.FFmpeg`; `brew uninstall ffmpeg cloudflared`, etc.). Other software may depend on Node.js; keep it if unsure.

## Confirm complete removal

- `http://127.0.0.1:45921/health` does not load.
- `~/.tongping` (or your configured `TONGPING_HOME`) does not exist.
- `claude mcp list` / `codex mcp list` no longer lists `tongping`.
- TongPing is absent from claude.ai / ChatGPT connector lists.
