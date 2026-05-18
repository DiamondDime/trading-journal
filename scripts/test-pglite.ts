/**
 * PGlite migration compatibility harness.
 *
 * Spins up an in-memory PGlite instance with the contrib extensions our
 * migrations need, then runs every file in `supabase/migrations/` in lexical
 * order. Reports the first failure with file + (best-effort) line and exits
 * non-zero. Exits 0 on full success.
 *
 * Why statement-by-statement instead of `db.exec()`?
 *   `db.exec(sql)` runs the whole script inside one transaction. Migration
 *   `20260516000000_v1_spread_vocabulary.sql` does `ALTER TYPE ... ADD VALUE`
 *   then immediately uses the new value in a CHECK constraint — Postgres
 *   requires the ALTER TYPE to be committed first (errcode 55P04). Our
 *   project's `db:migrate` script runs `psql -f` which gives each statement
 *   its own transaction. To match that semantic we split the script on
 *   top-level semicolons (respecting dollar-quoted bodies) and call
 *   `db.query()` for each — `query()` does NOT wrap in a transaction.
 *
 *   pnpm tsx scripts/test-pglite.ts
 */
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { splitSqlStatements } from '../src/lib/db/sql-split';

const MIGRATIONS_DIR = resolve(__dirname, '..', 'supabase', 'migrations');

interface MigrationError {
  file: string;
  message: string;
  position?: string;
  hint?: string;
  detail?: string;
  approxLine?: number;
}

/**
 * postgres returns 1-based byte positions in `position`. Convert to line:col
 * using the original source. Best-effort — useful for psql-style hints.
 */
function approximateLineFromPosition(sql: string, position?: number): number | undefined {
  if (!position || position < 1) return undefined;
  let line = 1;
  for (let i = 0; i < Math.min(position - 1, sql.length); i++) {
    if (sql.charCodeAt(i) === 10) line++;
  }
  return line;
}

async function main(): Promise<number> {
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.error(`[pglite-test] no migrations found in ${MIGRATIONS_DIR}`);
    return 1;
  }

  console.log(`[pglite-test] starting PGlite (in-memory)`);
  const db = await PGlite.create({
    extensions: { citext, pgcrypto, pg_trgm, uuid_ossp },
  });

  console.log(`[pglite-test] running ${files.length} migrations`);
  const errors: MigrationError[] = [];

  for (const file of files) {
    const path = join(MIGRATIONS_DIR, file);
    const sql = await readFile(path, 'utf8');
    const statements = splitSqlStatements(sql);
    try {
      // query() runs a single statement without wrapping it in a transaction.
      // psql -f gives each top-level statement its own implicit transaction,
      // which is what our migrations expect (ALTER TYPE ADD VALUE etc.).
      for (const stmt of statements) {
        await db.query(stmt);
      }
      console.log(`  OK   ${file}  (${statements.length} stmts)`);
    } catch (err) {
      // PGlite errors carry `position` (byte offset) and other libpq-style fields
      const e = err as {
        message?: string;
        position?: string | number;
        hint?: string;
        detail?: string;
        code?: string;
      };
      const posNum = typeof e.position === 'string' ? parseInt(e.position, 10) : e.position;
      const approxLine = approximateLineFromPosition(sql, posNum);
      errors.push({
        file,
        message: e.message ?? String(err),
        position: e.position?.toString(),
        hint: e.hint,
        detail: e.detail,
        approxLine,
      });
      console.error(`  FAIL ${file}`);
      console.error(`       message: ${e.message}`);
      if (e.code) console.error(`       code:    ${e.code}`);
      if (approxLine) console.error(`       line:    ${approxLine} (approx)`);
      if (e.detail) console.error(`       detail:  ${e.detail}`);
      if (e.hint) console.error(`       hint:    ${e.hint}`);
      // Stop on first failure — schema is now half-built, later migrations would
      // cascade-fail and the noise hides the root cause.
      break;
    }
  }

  await db.close();

  if (errors.length === 0) {
    console.log(`[pglite-test] all ${files.length} migrations applied cleanly`);
    return 0;
  }
  console.error(`[pglite-test] ${errors.length} migration(s) failed`);
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[pglite-test] unexpected failure');
    console.error(err);
    process.exit(1);
  });
