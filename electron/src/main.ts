/**
 * Electron main process for Journal (crypto-spread-journal).
 *
 * Architecture
 * ------------
 * - In packaged production builds, the main process spawns the Next.js
 *   standalone server (`server.js`) as a Node subprocess. The standalone
 *   bundle ships with the app (see `electron-builder.yml` `files` glob) and
 *   listens on $PORT chosen by `findFreePort` below.
 * - In `electron:dev`, the user runs `next dev` separately via `concurrently`,
 *   so this process honours `DESKTOP_DEV=1` and skips spawning anything —
 *   it just waits for whatever is on $DESKTOP_DEV_PORT (default 3000) and
 *   loads it into the BrowserWindow.
 *
 * Decision: subprocess spawn (vs Next's programmatic API).
 *   `next start` / `server.js` is the supported public surface. The
 *   programmatic API (`import next from 'next'`) is documented as unstable
 *   and breaks across minor versions, especially in Next 16. Subprocess +
 *   `output: 'standalone'` is what every production Electron-Next setup
 *   uses (e.g. Notion clones, Outline, Linear-style apps).
 *
 * DB / Worker / Auto-updater are wired by other agents; this file leaves
 * marked TODO stubs where their entry points should attach.
 */
import { app, BrowserWindow, shell, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
// Auto-update agent: helper that wires `electron-updater` + IPC channels.
// Idempotent and a no-op in dev mode.
import { attachAutoUpdater } from './auto-update';
// MCP token plumbing: idempotent loader for ~/.journal/mcp.json. Bridges the
// standalone `trading-journal-mcp` npm package to the in-app HTTP API.
import { loadOrCreateMcpToken } from './mcp-token';
// Per-install identity: stable uuid + worker-auth secret persisted to
// <userData>/journal.json. The Next.js subprocess needs both via env.
import { loadOrProvisionUser } from './user-provision';

const isDev = process.env.DESKTOP_DEV === '1' || !app.isPackaged;
const DEV_PORT = Number.parseInt(process.env.DESKTOP_DEV_PORT ?? '3000', 10);
const PORT_RANGE_START = 3500;
const PORT_RANGE_END = 3600;
const STARTUP_TIMEOUT_MS = 30_000;

// Singletons we have to clean up on exit.
let mainWindow: BrowserWindow | null = null;
let nextServer: ChildProcess | null = null;
// Worker subprocess will be owned by the worker agent. Reserved here so that
// the lifecycle in `app.on('before-quit')` already handles it.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let syncWorker: ChildProcess | null = null;

/**
 * Probe ports in [PORT_RANGE_START, PORT_RANGE_END) and return the first one
 * that accepts a `listen()` (i.e. nothing else is bound to it).
 *
 * We rely on Node's `net.createServer` instead of `getPort` to avoid an extra
 * runtime dep — the logic is 15 lines.
 */
async function findFreePort(): Promise<number> {
  for (let port = PORT_RANGE_START; port < PORT_RANGE_END; port++) {
    const ok = await new Promise<boolean>((resolveFn) => {
      const probe = createServer();
      probe.unref();
      probe.once('error', () => resolveFn(false));
      probe.once('listening', () => {
        probe.close(() => resolveFn(true));
      });
      probe.listen(port, '127.0.0.1');
    });
    if (ok) return port;
  }
  throw new Error(
    `No free port in [${PORT_RANGE_START}, ${PORT_RANGE_END}) — refusing to start.`,
  );
}

/**
 * Poll http://127.0.0.1:{port}/ until it returns any HTTP response (we don't
 * care about the status code, only that the server has bound and is answering).
 */
async function waitForServer(port: number, timeoutMs = STARTUP_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const url = `http://127.0.0.1:${port}/`;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      // Any response means the listener is up. Next.js may briefly 404 the
      // root before app router has hydrated; that's fine for us.
      if (res.status > 0) return;
    } catch {
      // ECONNREFUSED while booting — ignore and retry.
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Next.js server on :${port} did not respond within ${timeoutMs}ms`);
}

/**
 * Resolve the path to `.next/standalone/server.js`.
 *
 * In a packaged build the standalone bundle is listed in `asarUnpack`
 * (see `electron-builder.yml`) so it lives at
 *   resources/app.asar.unpacked/.next/standalone/server.js
 * — Electron transparently rewrites paths via `app.asar` to the unpacked
 * dir, but we use the explicit `.unpacked` path because the Node subprocess
 * we spawn is *not* Electron-aware and won't perform that rewrite itself.
 *
 * When running unpackaged (rare: `electron .` against a freshly-built but
 * un-bundled tree), we look relative to the repo root.
 */
function resolveStandaloneServerEntry(): string {
  if (app.isPackaged) {
    return join(
      process.resourcesPath,
      'app.asar.unpacked',
      '.next',
      'standalone',
      'server.js',
    );
  }
  return resolve(__dirname, '..', '..', '.next', 'standalone', 'server.js');
}

/**
 * Spawn the Next.js standalone server. Standalone bundles expose a plain
 * Node entry that honours $PORT and $HOSTNAME. We point its working directory
 * at the standalone root so its require()s resolve against the bundled
 * node_modules.
 */
function spawnNextServer(
  port: number,
  mcpToken: string,
  userId: string,
  workerSecret: string,
): ChildProcess {
  const serverEntry = resolveStandaloneServerEntry();
  if (!existsSync(serverEntry)) {
    throw new Error(
      `Standalone server entry not found at ${serverEntry}. ` +
        `Did you run \`pnpm build\` before \`pnpm electron:pack\`?`,
    );
  }

  const userData = app.getPath('userData');
  const pgliteDataDir = join(userData, 'data', 'pglite');
  // Migrations live inside the asar at `<resourcesPath>/supabase/migrations`.
  // The Next.js subprocess reads them from this path on first DB open.
  const migrationsDir = app.isPackaged
    ? join(process.resourcesPath, 'app.asar', 'supabase', 'migrations')
    : resolve(__dirname, '..', '..', 'supabase', 'migrations');

  const child = spawn(process.execPath, [serverEntry], {
    cwd: resolve(serverEntry, '..'),
    env: {
      ...process.env,
      // Tell the Next.js code path that it's running inside Electron so the
      // DB layer (PGlite, via src/lib/db/pglite-shim.ts) activates instead of
      // postgres.js + DATABASE_URL.
      DESKTOP_MODE: '1',
      PORT: String(port),
      HOSTNAME: '127.0.0.1',
      // PGlite lives IN-PROCESS inside the Next.js subprocess now (no TCP
      // wire bridge). These two env vars point its boot routine at the
      // user-data dir for the WASM-backed datafiles, and the asar-packed
      // migrations directory for the first-run schema apply.
      PGLITE_DATA_DIR: pgliteDataDir,
      PGLITE_MIGRATIONS_DIR: migrationsDir,
      // Shared secret with the `trading-journal-mcp` package. The Next.js
      // server uses this to authenticate requests on /api/mcp/v1/*. The
      // source of truth is ~/.journal/mcp.json; we forward it here so the
      // Next.js subprocess doesn't need its own filesystem read.
      MCP_TOKEN: mcpToken,
      // Per-install user identity. Without APP_USER_ID the Next.js side's
      // requireUser() throws NOT_AUTHENTICATED on every request. Source of
      // truth is <userData>/journal.json — see electron/src/user-provision.ts.
      APP_USER_ID: userId,
      // Shared secret with the Python sync daemon for /test-connection.
      // We always set a non-empty value so the in-process worker client
      // can authenticate; this also unblocks the local-only "exchange
      // connect" form in production even before the worker is running.
      // The daemon reads this same value from journal.json when it boots.
      WORKER_HTTP_SECRET: workerSecret,
      // Don't inherit the parent process's ELECTRON_RUN_AS_NODE flag, etc.
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', (chunk: Buffer) => {
    process.stdout.write(`[next] ${chunk.toString()}`);
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(`[next!] ${chunk.toString()}`);
  });
  child.on('exit', (code, signal) => {
    console.error(`[next] exited code=${code} signal=${signal}`);
    if (mainWindow) {
      // If the server dies after the window is open, surface it loudly.
      // We can replace this with a proper recovery dialog later.
      mainWindow.webContents.executeJavaScript(
        `console.error('Next.js server exited unexpectedly (code=${code}).')`,
      );
    }
  });
  return child;
}

function createMainWindow(targetUrl: string): BrowserWindow {
  const win = new BrowserWindow({
    title: 'Journal',
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#000000',
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // Allow loading http://localhost without warnings in dev.
      // We never load remote URLs in this window.
      webSecurity: true,
    },
  });

  win.once('ready-to-show', () => win.show());

  // External links open in the user's browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  void win.loadURL(targetUrl);
  return win;
}

function registerIpcHandlers(): void {
  ipcMain.handle('app:getVersion', (_event: IpcMainInvokeEvent) => app.getVersion());
  ipcMain.handle('app:openExternal', async (_event: IpcMainInvokeEvent, url: string) => {
    if (typeof url !== 'string') throw new Error('openExternal: url must be a string');
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      throw new Error('openExternal: only http(s) URLs allowed');
    }
    await shell.openExternal(url);
    return true;
  });
}

async function boot(): Promise<void> {
  registerIpcHandlers();

  // Provision the MCP auth token BEFORE the Next.js subprocess spawns. We pass
  // it forward as MCP_TOKEN in the spawn env so /api/mcp/v1/* (handled by a
  // separate agent) can authenticate the `trading-journal-mcp` npm bridge.
  //
  // Source of truth is ~/.journal/mcp.json — the /settings/mcp page reads the
  // same file at request time, so dev mode (where there's no child spawn)
  // still works without us threading the value through process env.
  const mcp = await loadOrCreateMcpToken();
  console.log(
    `[mcp] token ${mcp.generated ? 'generated new token' : 'loaded from ~/.journal/mcp.json'}`,
  );

  // Provision (or load) the per-install user id + worker secret. Persists to
  // <userData>/journal.json. The id is stable across launches; the secret is
  // generated once and reused so the worker daemon and Next.js subprocess
  // share the same value.
  //
  // PGlite itself is now opened LAZILY inside the Next.js subprocess on first
  // query (see `src/lib/db/client.ts::bootPGlite`). Main no longer touches
  // the WASM database, which is what removes the wire-protocol bridge and
  // its protocol-mismatch class of bugs entirely.
  const userData = app.getPath('userData');
  const provisioned = await loadOrProvisionUser(userData);
  // SAFETY: log the id (debugging aid) but NEVER the workerSecret value.
  console.log(
    `[main] user provisioned ${provisioned.userId}` +
      (provisioned.generated ? ' (fresh install)' : ' (existing)'),
  );

  let targetPort: number;
  if (isDev) {
    // electron:dev runs `next dev` separately; just point at it.
    targetPort = DEV_PORT;
    console.log(`[main] dev mode — expecting Next.js on :${targetPort}`);
    await waitForServer(targetPort).catch((err) => {
      console.error('[main] dev server not reachable:', err);
      throw err;
    });
  } else {
    targetPort = await findFreePort();
    console.log(`[main] spawning Next.js standalone on :${targetPort}`);
    nextServer = spawnNextServer(
      targetPort,
      mcp.token,
      provisioned.userId,
      provisioned.workerSecret,
    );
    await waitForServer(targetPort);
  }

  mainWindow = createMainWindow(`http://127.0.0.1:${targetPort}`);

  // -------------------------------------------------------------------------
  // Auto-update agent — attach AFTER the window exists so renderer IPC works.
  // No-op in dev (`app.isPackaged === false`). Idempotent.
  // -------------------------------------------------------------------------
  attachAutoUpdater(mainWindow);

  // TODO(worker): when the sync worker is ported, spawn it here using the
  //   same env (DESKTOP_MODE=1, PGLITE_DATA_DIR=...) so it shares the DB.
}

app.whenReady().then(() => {
  boot().catch((err) => {
    console.error('[main] boot failed:', err);
    app.exit(1);
  });

  app.on('activate', () => {
    // macOS: re-create the window when the dock icon is clicked and no
    // windows are open.
    if (BrowserWindow.getAllWindows().length === 0) {
      // Just open a new window pointing at the same server.
      // We assume the server is still alive; if not, user can quit and relaunch.
      const port = nextServer ? null : DEV_PORT;
      // In production, we don't know the spawned port here without state —
      // but mainWindow's URL has it. Fall back to recreating from origin.
      const lastUrl = mainWindow?.webContents.getURL();
      const url = lastUrl && lastUrl.startsWith('http')
        ? new URL(lastUrl).origin
        : `http://127.0.0.1:${port ?? DEV_PORT}`;
      mainWindow = createMainWindow(url);
    }
  });
});

app.on('window-all-closed', () => {
  // macOS apps typically stay running until the user explicitly quits.
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (nextServer && !nextServer.killed) {
    nextServer.kill('SIGTERM');
    nextServer = null;
  }
  if (syncWorker && !syncWorker.killed) {
    syncWorker.kill('SIGTERM');
    syncWorker = null;
  }
  // PGlite lives in the Next.js subprocess now — SIGTERM above closes it
  // implicitly when the subprocess exits. PGlite's file format is crash-safe
  // (it is, in the end, Postgres), so we don't need an explicit flush.
});

// Block creation of additional renderer-process windows from web content.
// External URLs are already handled in setWindowOpenHandler.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    const allowed = `http://127.0.0.1:`;
    if (!url.startsWith(allowed)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
});
