/**
 * GET /api/balances — current per-asset / per-exchange balances + deltas.
 *
 * Powers the dashboard hero, allocation pie, asset table, and exchange cards
 * on `/balances`. Everything is computed in one round-trip through
 * `getBalancesResponse` so the page doesn't have to fan out N queries.
 *
 * Cache: `force-dynamic`. Balances move; the dashboard should never serve
 * a stale prerender. (Next 16 will static-render unless we opt out — see
 * the master plan's "force-dynamic everywhere" item.)
 */
import { withAuth } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { getBalancesResponse } from "@/lib/db/balances";
import type { UserId } from "@/types/canonical";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (_req, { userId }) => {
  const data = await getBalancesResponse(userId as UserId);
  return ok(data);
});
