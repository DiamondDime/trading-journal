/**
 * POST /api/exchanges/sync-all
 *
 * Iterate every connected (non-manual, non-deleted) exchange for the current
 * user and enqueue a sync job for each. Returns the per-connection result
 * so the client can surface the count in a toast.
 *
 * Idempotent-ish: connections that already have a queued/running job are
 * skipped rather than spammed with a duplicate. The worker picks the job
 * up asynchronously — this endpoint just gates the queue.
 *
 * Note: the manual-entry sentinel connection (`label = '_manual_entry'`)
 * never syncs. It exists only to satisfy the FK from activity_trade →
 * positions → exchange_connections, so we explicitly skip it here.
 */
import { withAuth } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { sql } from "@/lib/db/client";

const MANUAL_CONN_LABEL = "_manual_entry";

export const POST = withAuth(async (_req, { userId }) => {
  const connections = await sql<{ id: string; exchangeCode: string }[]>`
    SELECT id, exchange_code
    FROM public.exchange_connections
    WHERE user_id = ${userId}::uuid
      AND deleted_at IS NULL
      AND label != ${MANUAL_CONN_LABEL}
      AND status != 'disabled'::connection_status
  `;

  if (connections.length === 0) {
    return ok(
      {
        queued: 0,
        skipped: 0,
        total: 0,
        details: [],
      },
      { status: 200 },
    );
  }

  // Per-connection: skip if there's already an in-flight job.
  const details: Array<{
    connectionId: string;
    exchangeCode: string;
    queued: boolean;
    reason?: string;
    syncJobId?: string;
  }> = [];

  for (const c of connections) {
    const active = await sql<{ id: string }[]>`
      SELECT id FROM public.sync_jobs
      WHERE exchange_connection_id = ${c.id}::uuid AND user_id = ${userId}::uuid
        AND state IN ('queued', 'running')
      LIMIT 1
    `;
    if (active[0]) {
      details.push({
        connectionId: c.id,
        exchangeCode: c.exchangeCode,
        queued: false,
        reason: "SYNC_IN_FLIGHT",
        syncJobId: active[0].id,
      });
      continue;
    }
    const [job] = await sql<{ id: string }[]>`
      INSERT INTO public.sync_jobs (user_id, exchange_connection_id, state)
      VALUES (${userId}::uuid, ${c.id}::uuid, 'queued')
      RETURNING id
    `;
    details.push({
      connectionId: c.id,
      exchangeCode: c.exchangeCode,
      queued: true,
      syncJobId: job.id,
    });
  }

  const queued = details.filter((d) => d.queued).length;
  const skipped = details.length - queued;

  return ok(
    {
      queued,
      skipped,
      total: details.length,
      details,
    },
    { status: 202 },
  );
});
