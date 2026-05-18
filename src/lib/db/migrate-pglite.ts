/**
 * PGlite migration runner.
 *
 * Reads `supabase/migrations/*.sql` in lexical order. Records applied
 * migrations in a `schema_migrations` table so re-runs are idempotent. Each
 * file's statements are split and run individually (not via db.exec()) because
 * a) PGlite's exec wraps the script in one transaction and b) some of our
 * migrations rely on per-statement transactions for ALTER TYPE ADD VALUE.
 *
 * Used by:
 *   • client.ts bootDesktopDb() at Electron startup
 *   • electron/migrate.ts CLI wrapper for manual invocation
 */
import type { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { splitSqlStatements } from './sql-split';

const SCHEMA_MIGRATIONS_DDL = `
  create table if not exists public.schema_migrations (
    filename   text primary key,
    applied_at timestamptz not null default now()
  )
`;

function defaultMigrationsDir(): string {
  // From src/lib/db → ../../../supabase/migrations
  return resolve(__dirname, '..', '..', '..', 'supabase', 'migrations');
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/**
 * Apply pending migrations. Returns the file names applied this run.
 */
export async function runPendingMigrations(
  db: PGlite,
  migrationsDir: string = defaultMigrationsDir()
): Promise<MigrationResult> {
  await db.query(SCHEMA_MIGRATIONS_DDL);

  const applied = await db.query<{ filename: string }>(
    'select filename from public.schema_migrations'
  );
  const alreadyApplied = new Set(applied.rows.map((r) => r.filename));

  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const result: MigrationResult = { applied: [], skipped: [] };

  for (const file of files) {
    if (alreadyApplied.has(file)) {
      result.skipped.push(file);
      continue;
    }
    const sql = await readFile(join(migrationsDir, file), 'utf8');
    const statements = splitSqlStatements(sql);

    // We DO want per-statement transactions for ALTER TYPE ADD VALUE etc.,
    // but we also want the whole file to be atomic — if statement N fails,
    // statements 1..N-1 should roll back so the next run retries from clean.
    //
    // PGlite resolves this contradiction the way psql -1 does NOT: we record
    // success at the end. If a migration fails midway, schema_migrations is
    // NOT updated for that file, so the next boot will retry. The downside is
    // partial DDL may persist (e.g. half-created tables); this is acceptable
    // for a single-user desktop app and matches the existing `db:migrate`
    // shell script's semantics. To recover, drop the data dir.
    for (const stmt of statements) {
      try {
        await db.query(stmt);
      } catch (err) {
        const e = err as { message?: string; position?: string | number };
        throw new Error(
          `[migrate-pglite] migration ${file} failed: ${e.message ?? String(err)}` +
            (e.position ? ` (position ${e.position})` : '')
        );
      }
    }

    await db.query(
      'insert into public.schema_migrations (filename) values ($1)',
      [file]
    );
    result.applied.push(file);
  }

  return result;
}
