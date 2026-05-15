import { withAuth } from '@/lib/api/handler';
import { ok } from '@/lib/api/response';
import { sql } from '@/lib/db/client';

export const GET = withAuth(async (req, { userId }) => {
  const url = new URL(req.url);
  const state = url.searchParams.get('state') ?? 'pending';
  const minConfidence = Number(url.searchParams.get('min_confidence') ?? '0');
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '50'), 200);

  const rows = await sql`
    SELECT * FROM public.spread_candidates
    WHERE user_id = ${userId}::uuid AND state = ${state}
      AND match_confidence >= ${minConfidence}
    ORDER BY match_confidence DESC
    LIMIT ${limit}
  `;
  return ok({ items: rows });
});
