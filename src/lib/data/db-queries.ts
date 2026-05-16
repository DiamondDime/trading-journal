// Higher-level page-facing query helpers. Combine the feed read with
// per-subtype metadata fetches so detail/list pages can render the
// fixture-shaped Activity object via db-adapter.feedRowsToActivities.

import { sql } from "@/lib/db/client";
import { listActivities, type ActivityFeedRowDb } from "@/lib/db/activity";
import type { SubtypeMeta } from "./db-adapter";

/**
 * Fetch subtype metadata for a list of activity ids, grouped by type.
 * One SELECT per type — runs in parallel. Returns a map keyed by activity id.
 *
 * Inputs: ids partitioned by type so each query only hits its subtype table.
 */
export async function fetchSubtypeMetaForIds(
  userId: string,
  rows: ActivityFeedRowDb[],
): Promise<Map<string, SubtypeMeta>> {
  const spreadIds: string[] = [];
  const tradeIds: string[] = [];
  const saleIds: string[] = [];
  const airdropIds: string[] = [];
  for (const r of rows) {
    if (r.userId !== userId) continue;
    switch (r.type) {
      case "spread": spreadIds.push(r.id); break;
      case "trade": tradeIds.push(r.id); break;
      case "sale": saleIds.push(r.id); break;
      case "airdrop": airdropIds.push(r.id); break;
    }
  }

  const [spreads, trades, sales, airdrops] = await Promise.all([
    spreadIds.length > 0
      ? sql<{ activityId: string; spreadType: string; variant: string | null; exchanges: string[]; primaryBase: string }[]>`
          SELECT activity_id, spread_type, variant, exchanges, primary_base
          FROM public.activity_spread
          WHERE activity_id = ANY(${spreadIds}::uuid[])
        `
      : Promise.resolve([] as { activityId: string; spreadType: string; variant: string | null; exchanges: string[]; primaryBase: string }[]),
    tradeIds.length > 0
      ? sql<{ activityId: string; symbol: string; exchange: string; side: "long" | "short"; instrumentKind: string }[]>`
          SELECT activity_id, symbol, exchange, side, instrument_kind
          FROM public.activity_trade
          WHERE activity_id = ANY(${tradeIds}::uuid[])
        `
      : Promise.resolve([] as { activityId: string; symbol: string; exchange: string; side: "long" | "short"; instrumentKind: string }[]),
    saleIds.length > 0
      ? sql<{ activityId: string; tokenSymbol: string; saleKind: string; saleVenue: string | null }[]>`
          SELECT activity_id, token_symbol, sale_kind, sale_venue
          FROM public.activity_sale
          WHERE activity_id = ANY(${saleIds}::uuid[])
        `
      : Promise.resolve([] as { activityId: string; tokenSymbol: string; saleKind: string; saleVenue: string | null }[]),
    airdropIds.length > 0
      ? sql<{ activityId: string; tokenSymbol: string; protocol: string }[]>`
          SELECT activity_id, token_symbol, protocol
          FROM public.activity_airdrop
          WHERE activity_id = ANY(${airdropIds}::uuid[])
        `
      : Promise.resolve([] as { activityId: string; tokenSymbol: string; protocol: string }[]),
  ]);

  const out = new Map<string, SubtypeMeta>();
  for (const s of spreads) {
    out.set(s.activityId, {
      ...out.get(s.activityId),
      spread: {
        spreadType: s.spreadType,
        variant: s.variant,
        exchanges: s.exchanges ?? [],
        primaryBase: s.primaryBase,
      },
    });
  }
  for (const t of trades) {
    out.set(t.activityId, {
      ...out.get(t.activityId),
      trade: {
        symbol: t.symbol,
        exchange: t.exchange,
        side: t.side,
        instrumentKind: t.instrumentKind,
      },
    });
  }
  for (const s of sales) {
    out.set(s.activityId, {
      ...out.get(s.activityId),
      sale: {
        tokenSymbol: s.tokenSymbol,
        saleKind: s.saleKind,
        saleVenue: s.saleVenue,
      },
    });
  }
  for (const a of airdrops) {
    out.set(a.activityId, {
      ...out.get(a.activityId),
      airdrop: {
        tokenSymbol: a.tokenSymbol,
        protocol: a.protocol,
      },
    });
  }
  return out;
}

/**
 * One-stop list helper used by the dashboard + archive: read feed rows
 * (with filters) and join in subtype metadata for the page.
 */
export async function listActivitiesWithMeta(
  userId: string,
  filters: Parameters<typeof listActivities>[1],
): Promise<{ rows: ActivityFeedRowDb[]; meta: Map<string, SubtypeMeta> }> {
  const rows = await listActivities(userId, filters);
  const meta = await fetchSubtypeMetaForIds(userId, rows);
  return { rows, meta };
}
