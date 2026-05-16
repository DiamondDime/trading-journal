/**
 * GET /api/activities — polymorphic list across all activity types.
 *
 * Query string params (all optional, comma-separated where multi-valued):
 *   type=spread,trade,sale,airdrop
 *   status=open,closed,…
 *   spread_type=cash_carry,…   (only meaningful when type includes 'spread')
 *   sale_kind=ido,launchpad,…   (only meaningful when type includes 'sale')
 *   asset=BTC,ETH,…             (matches v_activity_feed.primary_symbol)
 *   opened_after=<iso>
 *   opened_before=<iso>
 *   search=<text>
 *   sort_field=closed_at|opened_at|realized_pnl_usd|net_pnl_usd|capital_deployed_usd|created_at
 *   sort_dir=asc|desc
 *   limit=1..200
 *
 * Returns { data: { items: ActivityFeedRow[], next_cursor: null } }.
 * (Cursor pagination is stubbed for v1; limit-based reads suffice for a
 * single-user app with <1k activities.)
 */
import { withAuth } from '@/lib/api/handler';
import { ok } from '@/lib/api/response';
import { listActivities } from '@/lib/db/activity';
import { ListActivitiesQuery } from '@/lib/db/zod-schemas';

export const GET = withAuth(async (req, { userId }) => {
  const url = new URL(req.url);
  const q = ListActivitiesQuery.parse(Object.fromEntries(url.searchParams));

  const splitCsv = (s?: string) =>
    s ? s.split(',').map((p) => p.trim()).filter(Boolean) : undefined;

  const items = await listActivities(userId, {
    type: splitCsv(q.type) as ('spread' | 'trade' | 'sale' | 'airdrop')[] | undefined,
    status: splitCsv(q.status) as Parameters<typeof listActivities>[1]['status'],
    spreadType: splitCsv(q.spread_type),
    saleKind: splitCsv(q.sale_kind),
    asset: splitCsv(q.asset),
    openedAfter: q.opened_after,
    openedBefore: q.opened_before,
    search: q.search,
    limit: q.limit,
    sortField: q.sort_field,
    sortDir: q.sort_dir,
  });

  return ok({ items, next_cursor: null });
});
