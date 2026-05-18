# 2026-05-19 — Journal expansion

## Problem
User wants "a complete and absolute crypto journal that's out there on the market".
Current state already supports 7 activity types (spread / trade / sale / airdrop / yield / option / movement) with full wizards + bilingual UI. The actual gaps the user articulated:

1. `/trades` is a redirect to `/spreads/archive?activity=trade` — there is no real cross-exchange positions feed.
2. The spread-type picker exposes 5 flat options. Users think in variants: "long-short perps", "long-spot/short-future", etc. Variant lives in `/fields` step today, which is too late to inform the type choice.
3. No way to multi-select fills from connected exchanges and convert them to a spread outside the auto-matcher's narrow suggestion list.

## Decisions

### 1. `/trades` becomes the positions feed
- Source: `public.positions` (auto-materialised from `fills` by the worker) joined with `exchange_connections`.
- One row per logical position. Status: open / closed (no orphan tab in v1; orphan fills live in fills table and don't appear here).
- Filters: exchange, symbol contains, side, status, instrument type, linked-or-not. URL-driven (server-rendered).
- Multi-select via native `<form>` with `<input type="checkbox" name="legs">`. Submit posts to `/add/spread/type` (GET, query-string).
- Each row also surfaces: realized PnL, fees, funding, linked-spread chip if `spread_legs.position_id` matches.
- Empty state: "Connect an exchange to populate the feed" → `/settings/exchanges`.

### 2. `/add/spread/type` exposes 7 variant-aware options, grouped
- **Funding-based**
  - Long-short perps · same venue → `spreadType=funding, variantCanonical=same_venue`
  - Long-short perps · cross venue → `spreadType=funding, variantCanonical=cross_venue`
  - Long spot · short perp (funding) → `spreadType=cash_carry, variantCanonical=funding`
- **Basis & arbitrage**
  - Long spot · short dated future → `spreadType=cash_carry, variantCanonical=basis`
  - Cross-exchange arbitrage → `spreadType=cross_exchange`
  - DEX vs CEX → `spreadType=dex_cex`
- **Time-based**
  - Calendar (long near, short far) → `spreadType=calendar`
- Group headers are visual only. Submit goes to `/add/spread/fields` with `spreadType` and (where applicable) `variantCanonical` pre-filled.
- Existing single-radio `name="spreadType"` is preserved; the new `variantCanonical` hidden input is added so `/fields` skips the radio for these two types.
- Existing matcher pre-selection (`?spreadType=`) still works — accepts any of the 7 keys; falls back to first option when none match.

### 3. Link-as-spread bulk action on `/trades`
- When ≥2 checkboxes selected, the submit button reads "Link selected as spread" and goes to:
  `/add/spread/type?legs=pid1,pid2,...&matcher=manual_selection&source=auto_selection`
- `/add/spread/type` already accepts `legs=` and round-trips it. Treated identically to the auto path from `/add/spread/pick`.
- When exactly 1 checked: button reads "View detail" → `/trades/[id]` if id is a positions UUID. (V1: deferred — keep button disabled when only 1 selected, surface tooltip "Select at least 2 to link as a spread.")

### Out of scope tonight
- Position detail page (`/trades/positions/[id]`)
- Auto-suggest spread type from selected positions
- Global "+add" FAB (the dashboard's existing add button is enough for v1)
- New activity types (the schema already covers what the user named)
- Fills tab (positions abstraction is the right level)

## Data shapes

### `src/app/trades/db.ts` — new
```ts
export interface TradeFeedRow {
  id: string;                  // position UUID
  exchangeCode: string;
  exchangeConnectionLabel: string;
  instrument: string;
  instrumentType: 'spot' | 'perp' | 'dated_future' | 'option';
  side: 'long' | 'short';
  totalQty: string;            // decimal-as-string
  avgEntryPrice: string;
  avgExitPrice: string | null;
  openedAt: string;
  closedAt: string | null;
  status: 'open' | 'closed';
  realizedPnlQuote: string;
  totalFeesQuote: string;
  totalFundingQuote: string;
  quoteCurrency: string;
  marginMode: 'cross' | 'isolated';
  leverage: string | null;
  linkedActivityId: string | null;
  linkedActivityName: string | null;
}

export interface TradeFeedFilters {
  exchange?: string;
  symbol?: string;
  side?: 'long' | 'short';
  status?: 'open' | 'closed' | 'all';
  instrument?: 'spot' | 'perp' | 'dated_future';
  linked?: 'linked' | 'unlinked' | 'all';
}

export async function listTradeFeed(
  userId: string, filters, sort, limit, cursor,
): Promise<{ rows: TradeFeedRow[]; nextCursor: string | null; total: number }>;

export async function listFeedExchangeOptions(userId: string): Promise<{ code: string; label: string; count: number }[]>;
```

## i18n keys (EN + RU added in lockstep)

```
trades.feed.title / subtitle / empty.{title,body,cta}
trades.feed.filter.{exchange,allExchanges,status,statusOpen,statusClosed,statusAll,
  symbol,searchPlaceholder,side,sideAll,sideLong,sideShort,
  instrument,instrumentAll,instrumentSpot,instrumentPerp,instrumentDatedFuture,
  linked,linkedAll,linkedTrue,linkedFalse,apply,reset}
trades.feed.col.{exchange,symbol,side,qty,entryExit,opened,closed,netPnl,fees,funding,linked}
trades.feed.row.{linkedTo,noLink,longLabel,shortLabel,openLabel,closedLabel}
trades.feed.bulk.{select1,selectN,selectMin,linkAsSpread,clear}
trades.feed.pagination.{prev,next,countOf,countMore}
trades.feed.howTo.{summary,body}

wizard.spread.type.groups.{fundingBased,basisAndArb,timeBased}.{title,description}
wizard.spread.type.options.fundingSameVenue.{title,description}
wizard.spread.type.options.fundingCrossVenue.{title,description}
wizard.spread.type.options.cashCarryFunding.{title,description}
wizard.spread.type.options.cashCarryBasis.{title,description}
# crossExchange / dexCex / calendar already exist
```

## Verification plan
1. `pnpm typecheck` clean
2. `pnpm test:run` green
3. `pnpm build` succeeds
4. Chrome MCP visual walk: `/trades` empty state + filter bar, `/add/spread/type` group layout, both EN + RU.

## Commit cadence
1. `feat(db): listTradeFeed + listFeedExchangeOptions`
2. `feat(trades): positions feed page with filters + multi-select + link-as-spread CTA`
3. `feat(wizard): expanded spread type picker with variant-aware grouping`
4. `i18n: keys EN+RU for /trades feed + /add/spread/type variants`
5. (Aggregate verify/build) — single closing commit if needed.

Push to origin/main at the end.
