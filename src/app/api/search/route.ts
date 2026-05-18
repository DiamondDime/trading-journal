/**
 * GET /api/search — global activity search.
 *
 * Query string params:
 *   q       — search text (required, trimmed; empty → empty result set)
 *   limit   — 1..50, defaults to 20
 *
 * Returns `{ data: { items: SearchResultItem[], total: number } }`.
 *
 * `total` mirrors `items.length` in v1 (we LIMIT inside the SQL — there is
 * no separate COUNT pass). When v2 introduces pagination, `total` will
 * decouple from the page size.
 */
import { withAuth } from '@/lib/api/handler';
import { ok } from '@/lib/api/response';
import { searchActivities, SEARCH_MAX_LIMIT } from '@/lib/db/search';

export const GET = withAuth(async (req, { userId }) => {
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').slice(0, 200);
  const limitParam = url.searchParams.get('limit');
  const requested = limitParam ? Number.parseInt(limitParam, 10) : 20;
  const limit = Number.isFinite(requested)
    ? Math.min(Math.max(1, requested), SEARCH_MAX_LIMIT)
    : 20;

  const items = await searchActivities(userId, q, limit);
  return ok({ items, total: items.length });
});
