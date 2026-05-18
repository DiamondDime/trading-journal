/**
 * Postgres client (postgres.js). Singleton across the Node server.
 *
 * ARCHITECTURE NOTES
 * ──────────────────
 * This module exports a single `sql` template-tag bound to postgres.js so that
 * every consumer in the codebase keeps working unchanged when we switch
 * backends. The backend is selected at module-load time from env:
 *
 *   DESKTOP_MODE=1   → PGlite-in-process (Electron desktop)
 *   default          → real Postgres at DATABASE_URL  (web dev/prod)
 *
 * Why Option A (PGlite-socket) instead of writing our own template-tag adapter
 * over PGlite.query()?
 *
 *   postgres.js exposes a broad API the codebase actively uses:
 *     • `sql.begin(async (tx) => ...)` transactions (seed.ts, spreads/actions)
 *     • Tagged template + dynamic identifiers `sql${ident}`
 *     • `transform: postgres.camel` (snake_case → camelCase on every column)
 *     • Type generics `sql<Row[]>\`...\``
 *     • bytea / numeric / jsonb / array decoders that match real Postgres
 *
 *   Reimplementing all of that as a thin shim over PGlite.query() is roughly
 *   500 lines and a permanent maintenance liability. @electric-sql/pglite-socket
 *   ships a server that speaks real Postgres wire protocol over a TCP port —
 *   postgres.js connects to it transparently and the entire API surface (incl.
 *   sql.begin, transform: camel, type generics, identifier embedding) works
 *   unchanged. The only cost is one localhost roundtrip per query, which is
 *   negligible against the WASM Postgres engine itself.
 *
 * Boot order for desktop builds:
 *   1. Electron main process calls `bootDesktopDb()` once at startup.
 *      That opens the PGlite file-backed db, runs pending migrations, and
 *      starts the wire-protocol server on `PGLITE_PORT` (default 53432).
 *   2. The Next.js server inside Electron then loads this module; `sql` is
 *      constructed with `DATABASE_URL` pointing at the local server.
 *   3. The first query lazy-opens a postgres.js connection.
 *
 * Web dev / prod path is unchanged: postgres.js connects to whatever
 * DATABASE_URL points at.
 *
 * RLS NOTE (carried over from v1): we connect as a local superuser, so RLS is
 * bypassed naturally — we filter by user_id in app code. To re-enable RLS
 * later, replace direct queries with:
 *   sql.begin(async (tx) => {
 *     await tx.unsafe(`SET LOCAL app.current_user_id = '${userId}'`);
 *     return tx`...`;
 *   })
 */
import postgres from 'postgres';

declare global {
  var __pgSql: ReturnType<typeof postgres> | undefined;
  var __desktopBootPromise: Promise<void> | undefined;
}

const DESKTOP_MODE = process.env.DESKTOP_MODE === '1';
const DESKTOP_PORT = Number.parseInt(process.env.PGLITE_PORT ?? '53432', 10);
const DESKTOP_HOST = process.env.PGLITE_HOST ?? '127.0.0.1';

const connStr = DESKTOP_MODE
  ? `postgresql://postgres:postgres@${DESKTOP_HOST}:${DESKTOP_PORT}/postgres`
  : (process.env.DATABASE_URL ??
     `postgresql://${process.env.USER ?? 'postgres'}@localhost:5432/crypto_spread_journal`);

export const sql =
  globalThis.__pgSql ??
  postgres(connStr, {
    onnotice: () => {},        // silence NOTICE spam
    transform: postgres.camel, // snake_case → camelCase on read
    // PGlite-socket implements simple + extended query protocols but does not
    // pipeline prepared statements the way real Postgres does. Disable
    // statement caching when talking to it so postgres.js falls back to
    // simple-query mode reliably. Negligible perf hit; the database is local.
    prepare: !DESKTOP_MODE,
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__pgSql = sql;
}

/**
 * Desktop-only: boot PGlite + start the wire-protocol bridge that `sql` above
 * connects to. Idempotent — safe to call from multiple Electron init paths.
 *
 * Returns when the server is accepting connections. Migrations are run by
 * `electron/migrate.ts` separately so that this module can stay free of fs
 * concerns (and so the migration runner is exercisable from CLI).
 *
 * This is a dynamic import so the desktop deps don't blow up the web build's
 * bundle size or pull WASM into edge runtimes.
 */
export async function bootDesktopDb(opts: {
  dataDir?: string;
  port?: number;
  host?: string;
  applyMigrations?: boolean;
  migrationsDir?: string;
} = {}): Promise<void> {
  if (!DESKTOP_MODE) {
    throw new Error(
      'bootDesktopDb() called but DESKTOP_MODE!=1. Set DESKTOP_MODE=1 before importing the db client in Electron.'
    );
  }
  if (globalThis.__desktopBootPromise) {
    return globalThis.__desktopBootPromise;
  }
  globalThis.__desktopBootPromise = (async () => {
    const [
      { PGlite },
      { citext },
      { pgcrypto },
      { pg_trgm },
      { uuid_ossp },
      { PGLiteSocketServer },
    ] = await Promise.all([
      import('@electric-sql/pglite'),
      import('@electric-sql/pglite/contrib/citext'),
      import('@electric-sql/pglite/contrib/pgcrypto'),
      import('@electric-sql/pglite/contrib/pg_trgm'),
      import('@electric-sql/pglite/contrib/uuid_ossp'),
      import('@electric-sql/pglite-socket'),
    ]);

    const dataDir = opts.dataDir ?? process.env.PGLITE_DATA_DIR;
    const db = await PGlite.create({
      dataDir,
      extensions: { citext, pgcrypto, pg_trgm, uuid_ossp },
    });

    if (opts.applyMigrations !== false) {
      const { runPendingMigrations } = await import('./migrate-pglite');
      await runPendingMigrations(db, opts.migrationsDir);
    }

    const server = new PGLiteSocketServer({
      db,
      host: opts.host ?? DESKTOP_HOST,
      port: opts.port ?? DESKTOP_PORT,
    });
    await server.start();
  })();
  return globalThis.__desktopBootPromise;
}
