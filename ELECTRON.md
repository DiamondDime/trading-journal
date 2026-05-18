# Electron desktop port

The desktop app is the recommended way to run Journal for a single user. It bundles everything — UI server, database, ingestion worker — into a single signed `.dmg`. No external Postgres, no Python runtime, no terminal required.

## High-level architecture

```
+---------------------------------------------------------------+
|                    Electron main process                      |
|                                                               |
|   - Owns the BrowserWindow                                    |
|   - Spawns and supervises 2 child processes                   |
|   - Manages PGlite lifecycle (start, migrate, shutdown)       |
|   - Talks to electron-updater for auto-updates                |
|   - Owns the OS keychain entry for CREDENTIALS_MASTER_KEY     |
|                                                               |
|        +------------+                +--------------------+   |
|        | PGlite     |  <-- IPC --->  | Next.js subprocess |   |
|        | (in-proc)  |   (DATABASE_   | (next start)       |   |
|        |            |    URL)        |                    |   |
|        +-----^------+                +---------^----------+   |
|              |                                 |              |
|              |                                 |              |
|              +-------------+   +---------------+              |
|                            |   |                              |
|                    +-------v---v--------+                     |
|                    | Node worker subproc|                     |
|                    | (worker-ts)        |                     |
|                    +--------------------+                     |
|                                                               |
+---------------------------------------------------------------+
                              |
                              v
                  +-------------------------+
                  |   Exchange REST APIs    |
                  | (Binance, Bybit, ...)   |
                  +-------------------------+
```

The main process is the orchestrator. The renderer (`BrowserWindow`) loads `http://localhost:<port>` against the Next.js subprocess. The Next.js subprocess and the worker subprocess both reach PGlite through a shared connection string the main process publishes.

## Why PGlite

The webapp talks to Postgres 16 over `postgres://`. The desktop app keeps the same data model and the same SQL by running [PGlite](https://github.com/electric-sql/pglite) — a WebAssembly build of Postgres — in the main process. The Next.js subprocess and the worker subprocess connect to it as if it were a remote Postgres.

Benefits:
- No external Postgres install for users.
- Same migrations as the webapp (`supabase/migrations/*.sql` apply unmodified).
- Data lives in a single directory on disk, easy to back up and restore.
- Bundle size stays small — no separate Postgres binary per platform.

The trade-off: PGlite is single-writer. That's fine here because only the worker subprocess writes, and only the Next.js subprocess reads on the UI path; concurrent writes funnel through the same connection.

## Why a Node worker port

The webapp's ingestion worker is Python 3.12 + ccxt-python. Shipping a Python runtime inside a `.dmg` bloats the bundle and complicates code signing. The desktop port re-implements the worker against [ccxt-js](https://github.com/ccxt/ccxt) in TypeScript (`worker-ts/`).

This keeps the bundle Node-only, which means:
- One language runtime to package and sign.
- The worker can be spawned as a child process from Electron with no extra prerequisites.
- The same `postgres.js` driver the webapp uses.

The Python worker remains the reference implementation for the webapp flavor and for development. The TypeScript port mirrors its canonical types, encryption layer, and adapter contracts byte-for-byte.

## Develop

Concurrent Next.js dev server + Electron shell, both pointed at PGlite:

```bash
$ pnpm install
$ pnpm electron:dev
```

This runs `next dev` and `electron .` in parallel. Hot reload works for the renderer; restart the command for main-process changes.

To iterate on the worker only:

```bash
$ pnpm worker-ts:dev
```

## Build a .dmg

Production build + electron-builder pack:

```bash
$ pnpm electron:build
```

Output lands in `electron/build/`. For a dev-pack (unsigned, no installer, faster):

```bash
$ pnpm electron:pack
```

Release the artefact via the GitHub Releases workflow at `.github/workflows/release-desktop.yml`.

## Build a Windows .exe

The Windows target is an [NSIS](https://nsis.sourceforge.io/) installer, x64 only. Cross-compiling NSIS from macOS is unreliable; build on a Windows host (or let GitHub Actions do it — see the `build-win` job in the release workflow).

```bash
$ pnpm electron:build:win   # on a Windows host
```

To build both Mac and Windows in one shot (only works on a machine that can produce both, i.e. CI):

```bash
$ pnpm electron:build:all
```

Output lands in `dist-electron/Journal-<version>-win-x64.exe`.

### Windows install

The installer is **unsigned**. We don't ship with an EV/OV code-signing certificate, so:

1. Download `Journal-<version>-win-x64.exe` from the [Releases page](https://github.com/DiamondDime/trading-journal/releases).
2. Double-click the installer. Windows SmartScreen will warn: *"Windows protected your PC"*. This is expected for unsigned installers.
3. Click **More info** → **Run anyway**.
4. The installer is per-user (no UAC prompt) and lets you change the install directory. Default location: `%LOCALAPPDATA%\Programs\Journal\`.

After install, the app launches from the desktop shortcut or Start menu (search for "Journal").

### Where Windows user data lives

| Path | What |
|---|---|
| `%APPDATA%\Journal\pglite\` | PGlite database files |
| `%APPDATA%\Journal\uploads\` | Screenshot attachments |
| `%APPDATA%\Journal\logs\` | Rotating JSON-lines logs |
| Windows Credential Manager: `Journal: master-key` | `CREDENTIALS_MASTER_KEY` |

To reset the app on Windows: quit it, delete `%APPDATA%\Journal\`, and remove the Credential Manager entry. Next launch re-provisions a fresh DB.

## Auto-update

The app uses [electron-updater](https://www.electron.build/auto-update) against GitHub Releases. On launch (and on a configurable interval), the main process checks the latest release for a newer `.dmg`, downloads it in the background, and applies it on next relaunch. Update channels: `latest` (stable) and `beta` (prerelease).

Update signing uses the same Developer ID certificate as the bundle; users get a Gatekeeper-clean install with no quarantine prompt.

## Where user data lives

| Path | What |
|---|---|
| `~/Library/Application Support/Journal/pglite/` | PGlite database files |
| `~/Library/Application Support/Journal/uploads/` | Screenshot attachments |
| `~/Library/Application Support/Journal/logs/` | Rotating JSON-lines logs from worker + main |
| OS keychain entry `Journal: master-key` | `CREDENTIALS_MASTER_KEY` (32 random bytes, generated on first launch) |

To reset the app: quit it, remove `~/Library/Application Support/Journal/`, and delete the keychain entry. The next launch provisions a fresh database with the demo activities seed.

To migrate from the webapp: dump your Postgres, point a one-shot `psql` at PGlite via the published `DATABASE_URL`, and restore. A guided import command is planned for v1.
