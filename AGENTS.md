# Instructions for AI assistants (Claude Code / Codex / other agents)

You are in the TongPing Personal Edition repository. Users usually need help **installing, troubleshooting, or upgrading TongPing**, and may not know how to program.

## Read first

| User task | Read |
|---|---|
| Install | `docs/INSTALL.md`; guide the user step by step, using each “Success check” |
| Connect Claude / ChatGPT / Claude Code / Codex | `docs/CONNECT.md` |
| Troubleshoot | `docs/TROUBLESHOOTING.md` — **read the rules in Part 0 first** |
| Upgrade / uninstall | `docs/UPGRADE.md` / `docs/UNINSTALL.md` |

## Required troubleshooting steps

1. Run `npm run doctor` (read-only) and address ❌ / ⚠️ using `docs/TROUBLESHOOTING.md`.
2. Check whether TongPing is running: `GET http://127.0.0.1:45921/health` (use `TONGPING_PORT` from `.env` for the port).
3. After fixing the issue, verify with `npm run selftest`.

## Hard boundaries

- Do not read, print, or transmit any file contents under `TONGPING_HOME` (default `~/.tongping`), especially `daemon/daemon-token`, `daemon/oauth-store.json`, or `worker/profiles/`. If a token is needed, tell the user its file location so they can copy it themselves.
- Do not suggest setting `TONGPING_HOST` to `0.0.0.0`, forwarding ports, or removing the OAuth password.
- Do not modify `package-lock.json`; reinstall dependencies with `npm ci`.
- Do not change code under `src/` unless requested. Diagnose configuration and environment issues using the handbook first.

## Developers

- `npm run check`: type checking + unit tests.
- Entry points: `scripts/start.mjs` (launcher), `src/daemon.ts` (MCP / cards / OAuth), `src/worker-client.ts` (browser driver), `src/mcp-server.ts` (tool definitions).
