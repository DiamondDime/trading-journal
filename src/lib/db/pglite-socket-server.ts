/**
 * Side-channel: expose the in-process PGlite instance via a UNIX socket so
 * external Node subprocesses (the sync worker) can connect via postgres.js
 * against the SAME PGlite database the Next.js server is using.
 *
 * Boot order in the desktop build:
 *   1. Electron main spawns the Next.js subprocess with PGLITE_SOCKET_DIR set
 *      to <userData>/data/socket.
 *   2. `src/instrumentation.ts` calls `startPgliteSocketServer()` after the
 *      PGlite instance is open.
 *   3. The socket file lands at <PGLITE_SOCKET_DIR>/.s.PGSQL.5432 — libpq's
 *      conventional name, which postgres.js follows when host=<directory>.
 *   4. Electron main then spawns the worker subprocess with DESKTOP_MODE=1 +
 *      DESKTOP_SOCKET_PATH=<the socket file>; the worker connects via
 *      postgres.js to that socket.
 *
 * Concurrency note: pglite-socket 0.1.5 serializes ALL queries through one
 * QueryQueueManager — PGlite is single-writer, so this is correct. Clients
 * MUST keep their postgres.js pool at `max: 1`; multiple sockets per client
 * trigger EPIPE in 0.1.5 (verified by scripts/spike-pglite-socket.mjs).
 *
 * Lifecycle: the server runs for the life of the Next.js subprocess. Process
 * exit cleans up the socket file via Node's net.Server teardown.
 */
import type { PGlite } from "@electric-sql/pglite";
import { mkdirSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";

/** libpq convention: socket file is `.s.PGSQL.<port>` inside the host dir. */
export const PGLITE_SOCKET_PORT = 5432;
export const PGLITE_SOCKET_FILENAME = `.s.PGSQL.${PGLITE_SOCKET_PORT}`;

let _serverPromise: Promise<unknown> | null = null;

/**
 * Resolve the absolute path to the socket file from `PGLITE_SOCKET_DIR`.
 * Returns null when the env var is unset (webapp mode, or desktop build that
 * disabled the worker bridge).
 */
export function resolveSocketPath(): string | null {
  const dir = process.env.PGLITE_SOCKET_DIR;
  if (!dir) return null;
  return join(dir, PGLITE_SOCKET_FILENAME);
}

/**
 * Start the pglite-socket server bound to the provided PGlite instance.
 * Idempotent: subsequent calls return the existing server promise.
 *
 * Returns null when PGLITE_SOCKET_DIR is unset (no-op in webapp mode).
 */
export async function startPgliteSocketServer(db: PGlite): Promise<unknown | null> {
  const dir = process.env.PGLITE_SOCKET_DIR;
  if (!dir) return null;
  if (_serverPromise) return _serverPromise;

  _serverPromise = (async () => {
    // Dynamic import so the webapp build never resolves pglite-socket.
    const { PGLiteSocketServer } = await import("@electric-sql/pglite-socket");

    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, PGLITE_SOCKET_FILENAME);
    // Stale socket from a prior process: unlink so bind() succeeds.
    if (existsSync(path)) {
      try {
        unlinkSync(path);
      } catch {
        // If unlink fails, bind() will surface the real error below.
      }
    }

    const server = new PGLiteSocketServer({ db, path });
    await server.start();
    console.log(`[pglite-socket] listening at ${path}`);
    return server;
  })();

  return _serverPromise;
}
