/**
 * Electron-side PGlite boot + migration runner.
 *
 * Called from `main.ts` before spawning the Next.js subprocess. We boot
 * PGlite with the user-data-dir as `dataDir`, run any pending migrations
 * tracked in `public.schema_migrations`, then start the wire-protocol bridge
 * (`@electric-sql/pglite-socket`) on a loopback port. The port is exported
 * via PGLITE_PORT into the Next.js child env so `src/lib/db/client.ts` can
 * connect using postgres.js with no code changes.
 *
 * Idempotent: safe to call multiple times in the same process — only the
 * first call performs work; subsequent calls return the cached result.
 *
 * Migrations directory resolution:
 *   - app.isPackaged (asar build): migrations are bundled under
 *     `resources/app.asar/supabase/migrations` (declared in electron-builder
 *     `files`). The fs reads through the asar VFS, which is transparent.
 *   - dev / unpackaged: repo root `supabase/migrations`.
 *
 * Why CommonJS? The whole electron/src tree compiles to CJS (see tsconfig
 * `module: commonjs`). PGlite ships dual ESM/CJS so dynamic `import()` works
 * here even from CJS. We use dynamic imports to keep this file portable —
 * the PGlite deps are heavyish and we only want them resolved at runtime.
 */
import { app } from 'electron';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface DesktopDbHandle {
  port: number;
  dataDir: string;
  applied: string[];
  /** Stop the wire-protocol server and close the PGlite instance. */
  shutdown: () => Promise<void>;
}

let cached: Promise<DesktopDbHandle> | null = null;

/**
 * Boot PGlite, apply migrations, and start the wire-protocol bridge.
 * Resolves with the port for the spawned Next.js subprocess to use.
 */
export function bootDesktopDb(opts: {
  dataDir?: string;
  port?: number;
  migrationsDir?: string;
} = {}): Promise<DesktopDbHandle> {
  if (cached) return cached;
  cached = (async () => {
    const dataDir = opts.dataDir ?? join(app.getPath('userData'), 'data', 'pglite');
    const migrationsDir = opts.migrationsDir ?? resolveMigrationsDir();

    if (!existsSync(migrationsDir)) {
      throw new Error(
        `[desktop-db] migrations directory not found at ${migrationsDir}. ` +
          `Did you forget to include supabase/migrations in the electron-builder files glob?`,
      );
    }

    const port = opts.port ?? (await findFreePort());

    // Dynamic imports keep electron-builder happy: it can asar-pack the WASM
    // assets but we don't load them unless we're actually on the desktop path.
    // We deliberately re-implement the migration runner here rather than
    // import from src/lib/db/migrate-pglite.ts because the electron CJS build
    // doesn't share tsconfig paths with the Next.js side — relative imports
    // across that boundary are fragile under electron-builder's asar packing.
    const [
      { PGlite },
      { citext },
      { pgcrypto },
      { pg_trgm },
      { uuid_ossp },
      { PGLiteSocketServer },
      { splitSqlStatements },
    ] = await Promise.all([
      import('@electric-sql/pglite'),
      import('@electric-sql/pglite/contrib/citext'),
      import('@electric-sql/pglite/contrib/pgcrypto'),
      import('@electric-sql/pglite/contrib/pg_trgm'),
      import('@electric-sql/pglite/contrib/uuid_ossp'),
      import('@electric-sql/pglite-socket'),
      import('./sql-split'),
    ]);

    console.log(`[desktop-db] opening PGlite at ${dataDir}`);
    const db = await PGlite.create({
      dataDir,
      extensions: { citext, pgcrypto, pg_trgm, uuid_ossp },
    });

    console.log(`[desktop-db] running migrations from ${migrationsDir}`);
    const applied = await runPendingMigrations(db, migrationsDir, splitSqlStatements);
    if (applied.length > 0) {
      console.log(`[desktop-db] applied ${applied.length} migration(s): ${applied.join(', ')}`);
    } else {
      console.log('[desktop-db] no migrations to apply');
    }

    console.log(`[desktop-db] starting wire-protocol bridge on 127.0.0.1:${port}`);
    const server = new PGLiteSocketServer({
      db,
      host: '127.0.0.1',
      port,
    });
    await server.start();

    return {
      port,
      dataDir,
      applied,
      async shutdown() {
        try {
          await server.stop();
        } finally {
          await db.close();
        }
      },
    };
  })();
  return cached;
}

/**
 * Apply pending migrations. Records each in `public.schema_migrations`.
 * Returns the file names applied in this run.
 */
async function runPendingMigrations(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  migrationsDir: string,
  splitSqlStatements: (sql: string) => string[],
): Promise<string[]> {
  const { readdir, readFile } = await import('node:fs/promises');

  await db.query(`
    create table if not exists public.schema_migrations (
      filename   text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const appliedRows = (await db.query(
    'select filename from public.schema_migrations',
  )) as { rows: Array<{ filename: string }> };
  const alreadyApplied = new Set<string>(
    appliedRows.rows.map((r) => r.filename),
  );

  const files: string[] = (await readdir(migrationsDir))
    .filter((f: string) => f.endsWith('.sql'))
    .sort();

  const applied: string[] = [];
  for (const file of files) {
    if (alreadyApplied.has(file)) continue;
    const sql = await readFile(join(migrationsDir, file), 'utf8');
    const statements = splitSqlStatements(sql);
    for (const stmt of statements) {
      await db.query(stmt);
    }
    await db.query(
      'insert into public.schema_migrations (filename) values ($1)',
      [file],
    );
    applied.push(file);
  }
  return applied;
}

function resolveMigrationsDir(): string {
  if (app.isPackaged) {
    // electron-builder packs supabase/migrations under app.asar by default
    // when listed in the `files` glob. Reading through asar works for fs.* APIs.
    return join(process.resourcesPath, 'app.asar', 'supabase', 'migrations');
  }
  // Repo root: electron/dist/migrate.js → ../../supabase/migrations
  return resolve(__dirname, '..', '..', 'supabase', 'migrations');
}

async function findFreePort(start = 53432, end = 53532): Promise<number> {
  for (let port = start; port < end; port++) {
    const ok = await new Promise<boolean>((resolveFn) => {
      const probe = createServer();
      probe.unref();
      probe.once('error', () => resolveFn(false));
      probe.once('listening', () => probe.close(() => resolveFn(true)));
      probe.listen(port, '127.0.0.1');
    });
    if (ok) return port;
  }
  throw new Error(`No free port in [${start}, ${end}) for PGlite socket bridge.`);
}
