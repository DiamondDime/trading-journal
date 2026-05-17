/**
 * GET /api/activities/export?format=json[&range=…&types=…&minCap=…]
 *
 * Returns the user's activities as a JSON download, scoped by the same
 * dashboard filters the page understands. The user clicks "Export" on the
 * dashboard; the link points here with the current URL search params
 * forwarded — so a 30-day-spreads-only view exports exactly those rows.
 *
 * Format is `application/json` with a `Content-Disposition: attachment`
 * header so the browser saves rather than renders.
 *
 * CSV is intentionally out of scope for v1. The data model has nested
 * fields (regime tags, vesting schedules) that don't flatten cleanly into
 * a single CSV row; JSON is honest about the shape.
 */
import { withAuth } from "@/lib/api/handler";
import { errors } from "@/lib/api/response";
import { NextResponse } from "next/server";
import { listActivities } from "@/lib/db/activity";
import {
  parseDashboardSearchParams,
  buildDashboardFilters,
} from "@/lib/dashboard/filters";

// Local YYYY-MM-DD used in the download filename.
function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export const GET = withAuth(async (req, { userId }) => {
  const url = new URL(req.url);
  const format = url.searchParams.get("format") ?? "json";
  if (format !== "json") {
    return errors.badRequest(
      "UNSUPPORTED_FORMAT",
      "Only format=json is supported in v1",
    );
  }

  // Mirror the dashboard search-param contract so the link can be
  // copy-pasted from the URL bar without translation.
  const raw: Record<string, string | string[] | undefined> = {};
  url.searchParams.forEach((value, key) => {
    raw[key] = value;
  });
  const params = parseDashboardSearchParams(raw);
  const filters = buildDashboardFilters(params);

  // Reuse listActivities's filter surface — it's the canonical reader.
  // `limit: 50_000` is a safety belt for catastrophe; single-user v1 won't
  // approach this number, but a runaway export shouldn't OOM the server.
  const rows = await listActivities(userId, {
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.closedAfter ? { openedAfter: filters.closedAfter } : {}),
    ...(filters.closedBefore ? { openedBefore: filters.closedBefore } : {}),
    limit: 50_000,
    sortField: "closed_at",
    sortDir: "desc",
  });

  // minCapital is applied here in app-space rather than at the SQL layer
  // because listActivities's filter surface doesn't expose it and we don't
  // want to leak that helper's signature into the API contract.
  const filtered =
    filters.minCapital && filters.minCapital > 0
      ? rows.filter((r) => {
          const cap = Number(r.capitalDeployedUsd ?? 0);
          return cap >= (filters.minCapital ?? 0);
        })
      : rows;

  const payload = {
    exportedAt: new Date().toISOString(),
    filters: {
      range: params.range,
      ...(params.from ? { from: params.from } : {}),
      ...(params.to ? { to: params.to } : {}),
      ...(params.types.length > 0 ? { types: params.types } : {}),
      ...(params.minCapital > 0 ? { minCapital: params.minCapital } : {}),
    },
    count: filtered.length,
    activities: filtered.map((r) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      name: r.name,
      openedAt: r.openedAt,
      closedAt: r.closedAt,
      capitalDeployedUsd: r.capitalDeployedUsd,
      realizedPnlUsd: r.realizedPnlUsd,
      unrealizedPnlUsd: r.unrealizedPnlUsd,
      feesUsd: r.feesUsd,
      netPnlUsd: r.netPnlUsd,
      regimeTags: r.regimeTags,
      customTags: r.customTags,
      headlineValue: r.headlineValue,
      headlineKind: r.headlineKind,
      primarySymbol: r.primarySymbol,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
  };

  const filename = `crypto-journal-export-${ymdLocal(new Date())}.json`;
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
});
