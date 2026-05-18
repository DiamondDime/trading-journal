/**
 * GET /api/balances/snapshot?range=24h|7d|30d|90d|all
 *   → portfolio history time series for the dashboard's line chart.
 *
 * The `range` query is validated server-side; anything else 400s. The chart
 * component on the page passes `range` as a hash-routed tab state so the URL
 * stays clean.
 */
import { withAuth } from "@/lib/api/handler";
import { ok, errors } from "@/lib/api/response";
import { getSnapshotSeries } from "@/lib/db/balances";
import { SnapshotRangeQuerySchema } from "@/lib/db/zod-schemas";
import type { UserId } from "@/types/canonical";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (req, { userId }) => {
  const url = new URL(req.url);
  const parse = SnapshotRangeQuerySchema.safeParse(
    Object.fromEntries(url.searchParams.entries()),
  );
  if (!parse.success) {
    return errors.badRequest("VALIDATION", "Invalid range", parse.error.issues);
  }
  const series = await getSnapshotSeries(
    userId as UserId,
    parse.data.range,
  );
  return ok(series);
});
