# Upgrade TongPing Personal Edition

> Current version: `0.4.0-personal.2`. Find your running version on the first line of `npm run doctor`, or in `version` at `http://127.0.0.1:45921/health`.

**Upgrading preserves login sessions.** Code lives in the TongPing folder; login sessions, tokens, and chat live separately in `TONGPING_HOME` (default `~/.tongping`). As long as you neither delete that directory nor change its path, websites remain signed in and Claude / ChatGPT connectors do not need to be re-added.

## Method 1: ZIP downloads (recommended; easy rollback)

1. Press `Ctrl+C` in the `npm run up` window to stop TongPing.
2. Download the new ZIP and extract it into a **new folder**, such as `C:\tongping-0.4.1`. **Keep the old folder** for rollback.
3. Copy **`.env`** from the old folder to the new one.
4. Open a terminal in the new folder:
   ```bash
   npm ci
   ```
5. Read the new version’s “Upgrade notes” in `CHANGELOG.md` for added or changed `.env` settings (marked in the new `.env.example`).
6. Start and check:
   ```bash
   npm run up
   # In another terminal
   npm run doctor     # First line should show the new version; no ❌
   npm run selftest   # All checks should pass
   ```
7. Start a **new conversation** in Claude / ChatGPT and say “Open TongPing” (cards in old conversations contain the old page and may be incompatible).
8. If you installed local subtitles, run `npm run asr:install` once in the new folder, adding your original `--cn` / `--cpu` flags, to update the subtitle server script. Existing runtime libraries and models will not be downloaded again.
9. Once everything works, delete the old folder.

**Rollback**: stop the new version and run `npm run up` in the old folder (both use the same data directory). If the new CHANGELOG says the data format changed and rollback is unsupported, back up `TONGPING_HOME` before rolling back.

## Method 2: git clone users

```bash
# After stopping TongPing
git pull
npm ci
npm run up
npm run doctor
```

If local code changes cause `git pull` conflicts, use `git stash` first or switch to method 1.

## Common issues after upgrading

| Symptom | Action |
|---|---|
| Doctor says “Running version is OLD; code version is NEW” | The old instance is still running. Press `Ctrl+C` in its window, then run `npm run up` in the new folder |
| `npm ci` reports a lockfile mismatch | Old files were mixed into the new folder. Extract a clean copy |
| Card errors / no picture | Start a new conversation and “Open TongPing” again |
| Port in use | The old version did not fully stop; see [TROUBLESHOOTING P1](TROUBLESHOOTING.md#p1-port-in-use) |

## Backups (optional; recommended before major upgrades)

Stop TongPing and copy the entire `TONGPING_HOME` folder. It contains login sessions and tokens: **never send the backup to anyone or share it publicly through cloud storage**.
