/**
 * Postgres client. Singleton across the Node server.
 *
 * ARCHITECTURE NOTES
 * ──────────────────
 * Every consumer in the codebase imports `sql` from this module. The backend
 * behind that `sql` template-tag is selected at module-load time from env:
 *
 *   DESKTOP_MODE=1   → PGlite-in-process via `pglite-shim.ts` (Electron desktop)
 *   default          → real Postgres at DATABASE_URL via `postgres.js` (web)
 *
 * The desktop path used to run PGlite + a wire-protocol bridge in the Electron
 * main process and have the Next.js subprocess connect to it over TCP via
 * postgres.js. That stack worked but the experimental wire bridge produced
 * `ECONNRESET` on every first-page query. Replaced with `pglite-shim.ts`,
 * which translates the same tagged-template surface into `db.query()` calls
 * directly. No TCP layer; queries are sub-millisecond and the protocol bug
 * surface is gone.
 *
 * Boot order for desktop builds:
 *   1. Electron main process spawns Next.js with `DESKTOP_MODE=1` and
 *      `PGLITE_DATA_DIR=<userData>/data/pglite`.
 *   2. Next.js loads this module; `sql` is exported synchronously as a lazy
 *      shim — first query triggers PGlite open + migrations.
 *   3. Subsequent queries hit the memoised PGlite instance.
 *
 * Web dev / prod path is unchanged: postgres.js → real Postgres at
 * DATABASE_URL.
 *
 * RLS NOTE: we run as the in-process PGlite superuser, so RLS is bypassed
 * naturally — every query filters by user_id in app code. To re-enable RLS
 * later, set the `app.current_user_id` session GUC inside a transaction
 * before issuing user-scoped queries.
 */
import postgres from "postgres";
import { createPGliteSql } from "./pglite-shim";

/**
 * Public type for the `sql` export. We pin to postgres.js's `Sql<{}>` shape
 * because the entire codebase is typed against that surface — the PGlite
 * shim implements a compatible subset (inventory-verified), so casting the
 * desktop branch through `unknown` is safe and keeps every downstream type
 * import unchanged.
 */
type SqlClient = ReturnType<typeof postgres>;

declare global {
  // eslint-disable-next-line no-var
  var __pgSql: SqlClient | undefined;
}

const DESKTOP_MODE = process.env.DESKTOP_MODE === "1";

/**
 * Lazy PGlite boot. Called by the shim the first time any query fires.
 * Idempotent across concurrent Server Component renders because the
 * factory's resolved promise is memoised inside the shim itself.
 */
async function bootPGlite() {
  const dataDir = process.env.PGLITE_DATA_DIR;
  if (!dataDir) {
    throw new Error(
      "[db/client] DESKTOP_MODE=1 but PGLITE_DATA_DIR is unset. " +
        "The Electron main process must pass this to the Next.js subprocess.",
    );
  }

  // Dynamic imports keep the web build free of WASM weight — these modules
  // never resolve when DESKTOP_MODE is unset.
  const [
    { PGlite },
    { citext },
    { pgcrypto },
    { pg_trgm },
    { uuid_ossp },
    { runPendingMigrations, listPendingMigrations },
    { backupPgliteDataDir },
    fsMod,
  ] = await Promise.all([
    import("@electric-sql/pglite"),
    import("@electric-sql/pglite/contrib/citext"),
    import("@electric-sql/pglite/contrib/pgcrypto"),
    import("@electric-sql/pglite/contrib/pg_trgm"),
    import("@electric-sql/pglite/contrib/uuid_ossp"),
    import("./migrate-pglite"),
    import("./backup-pglite"),
    import("node:fs"),
  ]);

  // PGlite needs the parent dir to exist before its first open. On a fresh
  // install the parent (`<userData>/data/`) hasn't been created yet — Electron
  // creates `<userData>` itself, but anything under it is on us.
  fsMod.mkdirSync(dataDir, { recursive: true });

  const createOptions = {
    dataDir,
    extensions: { citext, pgcrypto, pg_trgm, uuid_ossp },
  };
  console.log(`[db] opening PGlite at ${dataDir}`);
  let db = await PGlite.create(createOptions);

  // Migrations live in `<resourcesPath>/supabase/migrations` inside the asar.
  // The Electron main process passes PGLITE_MIGRATIONS_DIR pointing there.
  // For non-packaged dev runs (rare; usually you'd use postgres.js instead),
  // fall back to the repo path.
  const migrationsDir =
    process.env.PGLITE_MIGRATIONS_DIR ??
    `${process.cwd().replace(/\/\.next\/standalone.*$/, "")}/supabase/migrations`;
  console.log(`[db] PGlite open, applying migrations from ${migrationsDir}`);

  // Pre-migration snapshot. A migration can fail midway and leave the schema
  // half-applied; before taking that risk on a database that already holds
  // the user's journal, copy the data directory so they can roll back. The
  // copy runs while PGlite is closed so the snapshot is consistent on disk.
  // Skipped on a fresh install (appliedCount 0 — no user data to protect).
  // Best effort: a failed snapshot logs and boot continues.
  const { pending, appliedCount } = await listPendingMigrations(
    db,
    migrationsDir,
  );
  if (pending.length > 0 && appliedCount > 0) {
    console.log(
      `[db] ${pending.length} migration(s) pending — snapshotting data dir`,
    );
    await db.close();
    try {
      const snapshot = backupPgliteDataDir(dataDir, fsMod);
      if (snapshot) console.log(`[db] pre-migration backup → ${snapshot}`);
    } catch (err) {
      console.error(
        `[db] pre-migration backup failed (continuing): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    db = await PGlite.create(createOptions);
  }

  const { applied, skipped } = await runPendingMigrations(db, migrationsDir);
  console.log(
    `[db] migrations done — ${applied.length} applied, ${skipped.length} skipped`,
  );

  // Provision the local single-user identity once per fresh DB. The Electron
  // main process writes `journal.json` (file-only, no DB write) and forwards
  // `APP_USER_ID` to us via env. We mirror it into `auth.users` +
  // `public.profiles` here so every downstream `requireUser()` resolves and
  // foreign keys check out. Idempotent — repeat launches are a no-op.
  const userId = process.env.APP_USER_ID;
  if (userId) {
    const email = "local@journal.app";
    await db.query(
      `INSERT INTO public.allowlist (email, role, notes)
         VALUES ($1, 'admin', 'electron desktop install')
         ON CONFLICT (email) DO NOTHING`,
      [email],
    );
    await db.query(
      `INSERT INTO auth.users (id, email)
         VALUES ($1::uuid, $2)
         ON CONFLICT (id) DO NOTHING`,
      [userId, email],
    );
    await db.query(
      `INSERT INTO public.profiles (id, email, display_name, timezone, base_currency)
         VALUES ($1::uuid, $2, NULL, 'Etc/UTC', 'USD')
         ON CONFLICT (id) DO NOTHING`,
      [userId, email],
    );
    console.log(`[db] profile row ensured for ${userId}`);
  }

  return db;
}

/**
 * Real-Postgres path (web). Unchanged from prior versions.
 */
function buildPgClient(): ReturnType<typeof postgres> {
  const connStr =
    process.env.DATABASE_URL ??
    `postgresql://${process.env.USER ?? "postgres"}@localhost:5432/crypto_spread_journal`;
  return postgres(connStr, {
    onnotice: () => {}, // silence NOTICE spam
    transform: postgres.camel, // snake_case → camelCase on read
  });
}

export const sql: SqlClient =
  globalThis.__pgSql ??
  (DESKTOP_MODE
    ? (createPGliteSql(bootPGlite) as unknown as SqlClient)
    : buildPgClient());

// Memoise across module reloads. In dev this is for HMR; in production
// (Next.js standalone) it's because RSC + route-handler module graphs can
// each load `client.ts` once, and without the global cache we'd open PGlite
// twice — wasting 30+MB and tempting lock contention. The connection state
// is process-global by nature; pinning it to globalThis is the cheapest
// way to enforce one instance.
globalThis.__pgSql = sql;
