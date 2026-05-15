/**
 * Postgres client (postgres.js). Singleton across the Node server.
 *
 * In v1 we connect as a local superuser, so RLS is bypassed naturally —
 * we filter by user_id in app code instead of relying on RLS context.
 *
 * To re-enable RLS later, replace direct queries with:
 *   sql.begin(async (tx) => {
 *     await tx.unsafe(`SET LOCAL app.current_user_id = '${userId}'`);
 *     return tx`...`;
 *   })
 */
import postgres from 'postgres';

declare global {
  var __pgSql: ReturnType<typeof postgres> | undefined;
}

const connStr =
  process.env.DATABASE_URL ??
  'postgresql://skywalqr@localhost:5432/crypto_spread_journal';

export const sql =
  globalThis.__pgSql ??
  postgres(connStr, {
    onnotice: () => {},        // silence NOTICE spam
    transform: postgres.camel, // snake_case → camelCase on read
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__pgSql = sql;
}
