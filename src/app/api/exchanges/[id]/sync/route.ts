/**
 * POST /api/exchanges/:id/sync — enqueue a sync job for the worker to pick up.
 * GET  /api/exchanges/:id/sync — current + recent sync jobs
 */
import { withAuth } from '@/lib/api/handler';
import { ok, errors } from '@/lib/api/response';
import { sql } from '@/lib/db/client';

export const POST = withAuth(async (_req, { params, userId }) => {
  const { id } = await params;

  const active = await sql<{ id: string }[]>`
    SELECT id FROM public.sync_jobs
    WHERE exchange_connection_id = ${id}::uuid AND user_id = ${userId}::uuid
      AND state IN ('queued','running')
    LIMIT 1
  `;
  if (active[0]) {
    return errors.conflict('SYNC_IN_FLIGHT', 'A sync is already running for this connection', {
      sync_job_id: active[0].id,
    });
  }

  const rows = await sql<{ id: string; state: string; createdAt: string }[]>`
    INSERT INTO public.sync_jobs (user_id, exchange_connection_id, state)
    VALUES (${userId}::uuid, ${id}::uuid, 'queued')
    RETURNING id, state, created_at
  `;
  return ok({ sync_job_id: rows[0].id }, { status: 202 });
});

export const GET = withAuth(async (_req, { params, userId }) => {
  const { id } = await params;

  const [current, recent] = await Promise.all([
    sql`
      SELECT * FROM public.sync_jobs
      WHERE exchange_connection_id = ${id}::uuid AND user_id = ${userId}::uuid
        AND state IN ('queued','running')
      ORDER BY created_at DESC LIMIT 1
    `,
    sql`
      SELECT * FROM public.sync_jobs
      WHERE exchange_connection_id = ${id}::uuid AND user_id = ${userId}::uuid
      ORDER BY created_at DESC LIMIT 10
    `,
  ]);

  return ok({ current_job: current[0] ?? null, recent_jobs: recent });
});
