/**
 * Typed DB helpers for the Activity supertype + four subtype tables.
 *
 * Wraps `sql` from postgres.js with a thin layer that:
 *   1. owns the canonical row shapes returned to API / page layer
 *   2. handles polymorphic detail reads (one query per subtype kind)
 *   3. encapsulates the transactional insert pattern (activity + subtype)
 *
 * NOTE: postgres.js is configured with `transform: postgres.camel`, so all
 * snake_case columns come back as camelCase keys.
 *
 * All read queries filter by `user_id` to keep the v1 single-user-as-RLS
 * substitute working (RLS is bypassed by the local superuser).
 *
 * createSpread lives on /api/spreads/route.ts — it requires a multi-step
 * position-resolution flow that hasn't been generalised. The helpers here
 * cover the three "manual" subtypes (trade, sale, airdrop) plus list/detail
 * read paths that are polymorphic across all four.
 */
import { sql } from '@/lib/db/client';
import type {
  CreateTradeData,
  CreateSaleData,
  CreateAirdropData,
} from '@/lib/db/zod-schemas';
import type {
  ActivityId,
  ActivityType,
  ActivityStatus,
  Decimal,
  HeadlineKind,
} from '@/types/canonical';

// ============================================================================
// Filter types & sort vocabulary
// ============================================================================

export type ListSortField =
  | 'closed_at'
  | 'opened_at'
  | 'realized_pnl_usd'
  | 'net_pnl_usd'
  | 'capital_deployed_usd'
  | 'created_at';

export type ListSortDir = 'asc' | 'desc';

export interface ListActivitiesFilters {
  type?: ActivityType[];
  status?: ActivityStatus[];
  /** Sub-discriminator for spread rows. Joined against activity_spread. */
  spreadType?: string[];
  /** Sub-discriminator for sale rows. Joined against activity_sale. */
  saleKind?: string[];
  /** primary_symbol filter — works across spread (primary_base), trade (symbol's base), sale/airdrop (token_symbol). */
  asset?: string[];
  openedAfter?: string;
  openedBefore?: string;
  /** ILIKE match against activity.name. */
  search?: string;
  limit?: number;
  cursor?: string | null;
  sortField?: ListSortField;
  sortDir?: ListSortDir;
}

// ============================================================================
// Row types returned by helpers
// ============================================================================

/**
 * Row shape from `v_activity_feed`. postgres.js's `transform: postgres.camel`
 * option returns camelCased keys at runtime, so this type is the camelCase
 * twin of canonical.ts's snake_case ActivityFeedRow. Single source of truth
 * for what DB readers see.
 */
export interface ActivityFeedRowDb {
  id: ActivityId;
  userId: string;
  type: ActivityType;
  status: ActivityStatus;
  name: string;
  openedAt: string | null;
  closedAt: string | null;
  capitalDeployedUsd: Decimal | null;
  realizedPnlUsd: Decimal | null;
  unrealizedPnlUsd: Decimal | null;
  feesUsd: Decimal;
  netPnlUsd: Decimal | null;
  regimeTags: string[];
  customTags: string[];
  headlineValue: Decimal | null;
  headlineKind: HeadlineKind;
  primarySymbol: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Generic detail row — supertype + subtype merged. The shape depends on the
 * activity's type field; type-narrowing helpers below give caller-friendly
 * type-safe accessors.
 */
export interface ActivityDetailRow {
  // supertype (activity)
  id: ActivityId;
  userId: string;
  type: ActivityType;
  status: ActivityStatus;
  name: string;
  openedAt: string | null;
  closedAt: string | null;
  capitalDeployedUsd: Decimal | null;
  realizedPnlUsd: Decimal | null;
  unrealizedPnlUsd: Decimal | null;
  feesUsd: Decimal;
  netPnlUsd: Decimal | null;
  regimeTags: string[];
  customTags: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  // subtype — discriminated by `type`
  subtype:
    | { type: 'spread'; row: SpreadSubtype }
    | { type: 'trade'; row: TradeSubtype }
    | { type: 'sale'; row: SaleSubtype }
    | { type: 'airdrop'; row: AirdropSubtype };
}

export interface SpreadSubtype {
  activityId: ActivityId;
  spreadType: string;
  variant: string | null;
  origin: string;
  primaryBase: string;
  matchConfidence: number | null;
  fundingPnlQuote: Decimal;
  apr: Decimal | null;
  exchanges: string[];
  legCount: number;
  holdDurationMs: number | null;
  source: 'user' | 'system';
  systemProposalMetadata: Record<string, unknown> | null;
  targetAprAtOpen: Decimal | null;
  expectedHoldingDays: number | null;
  expectedBasisConvergenceDate: string | null;
  exitPlan: string | null;
  borrowCostAssumedBps: Decimal | null;
  closeThresholdApr: Decimal | null;
  closeThresholdPeriods: number | null;
  maxGasBudgetUsd: Decimal | null;
  slippageToleranceBps: Decimal | null;
}

export interface TradeSubtype {
  activityId: ActivityId;
  positionId: string;
  symbol: string;
  exchange: string;
  instrumentKind: string;
  side: 'long' | 'short';
  entryThesis: string | null;
  exitPlan: string | null;
  targetPrice: Decimal | null;
  stopPrice: Decimal | null;
  qty: Decimal;
  avgEntryPrice: Decimal;
  avgExitPrice: Decimal | null;
  realizedApr: Decimal | null;
}

export interface SaleSubtype {
  activityId: ActivityId;
  tokenSymbol: string;
  tokenName: string | null;
  tokenChain: string | null;
  saleKind: string;
  saleVenue: string | null;
  saleDate: string;
  usdPaid: Decimal;
  tokensAllocated: Decimal;
  effectivePriceUsd: Decimal | null;
  vestingSchedule: Record<string, unknown> | null;
  claimEvents: Array<Record<string, unknown>>;
  totalClaimed: Decimal;
  remainingLocked: Decimal | null;
  currentPriceUsd: Decimal | null;
  currentPriceAt: string | null;
}

export interface AirdropSubtype {
  activityId: ActivityId;
  tokenSymbol: string;
  tokenName: string | null;
  tokenChain: string | null;
  protocol: string;
  snapshotDate: string | null;
  eligibilityReason: string | null;
  qtyReceived: Decimal;
  claimDate: string | null;
  claimTxHash: string | null;
  valueAtReceiptUsd: Decimal | null;
  currentPriceUsd: Decimal | null;
  currentPriceAt: string | null;
}

// ============================================================================
// listActivities — polymorphic feed read
// ============================================================================

/**
 * Read v_activity_feed with filters. The view already does the cross-subtype
 * join + polymorphic headline_value/headline_kind/primary_symbol — we just
 * narrow it.
 *
 * Spread-type and sale-kind filters require an extra JOIN since the view
 * doesn't expose those sub-discriminators directly.
 */
export async function listActivities(
  userId: string,
  filters: ListActivitiesFilters,
): Promise<ActivityFeedRowDb[]> {
  const {
    type, status, spreadType, saleKind, asset,
    openedAfter, openedBefore, search,
    limit = 50,
    sortField = 'closed_at',
    sortDir = 'desc',
  } = filters;

  // Joins are conditional — we only join the subtype tables when the caller
  // narrows by that subtype. Keeps the common case (just `type`) cheap.
  const joinSpread = spreadType && spreadType.length > 0;
  const joinSale = saleKind && saleKind.length > 0;

  const rows = await sql<ActivityFeedRowDb[]>`
    SELECT f.*
    FROM public.v_activity_feed f
    ${joinSpread ? sql`LEFT JOIN public.activity_spread asp ON asp.activity_id = f.id` : sql``}
    ${joinSale   ? sql`LEFT JOIN public.activity_sale    asa ON asa.activity_id = f.id` : sql``}
    WHERE f.user_id = ${userId}::uuid
      ${type   && type.length   > 0 ? sql`AND f.type::text   = ANY(${type}::text[])`   : sql``}
      ${status && status.length > 0 ? sql`AND f.status::text = ANY(${status}::text[])` : sql``}
      ${joinSpread ? sql`AND asp.spread_type = ANY(${spreadType}::text[])`             : sql``}
      ${joinSale   ? sql`AND asa.sale_kind   = ANY(${saleKind}::text[])`               : sql``}
      ${asset  && asset.length  > 0 ? sql`AND f.primary_symbol = ANY(${asset}::text[])`: sql``}
      ${openedAfter  ? sql`AND f.opened_at >= ${openedAfter}::timestamptz`             : sql``}
      ${openedBefore ? sql`AND f.opened_at <= ${openedBefore}::timestamptz`            : sql``}
      ${search       ? sql`AND f.name ILIKE ${'%' + search + '%'}`                     : sql``}
    ORDER BY ${sql('f.' + sortField)} ${sortDir === 'asc' ? sql`ASC` : sql`DESC`} NULLS LAST
    LIMIT ${limit}
  `;
  return rows;
}

// ============================================================================
// getActivity — polymorphic detail read
// ============================================================================

/**
 * Fetch one activity with its subtype joined in. Returns `null` if not found
 * or not owned by the user (no leak of existence to other users).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getActivity(
  userId: string,
  activityId: string,
): Promise<ActivityDetailRow | null> {
  // Old fixture IDs (tr-005, sa-001, …) and any other non-UUID input route
  // to 404 cleanly rather than tripping Postgres' uuid parser.
  if (!UUID_RE.test(activityId)) return null;

  const supertype = await sql<{
    id: string;
    userId: string;
    type: ActivityType;
    status: ActivityStatus;
    name: string;
    openedAt: string | null;
    closedAt: string | null;
    capitalDeployedUsd: string | null;
    realizedPnlUsd: string | null;
    unrealizedPnlUsd: string | null;
    feesUsd: string;
    netPnlUsd: string | null;
    regimeTags: string[];
    customTags: string[];
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
  }[]>`
    SELECT *
    FROM public.activity
    WHERE id = ${activityId}::uuid
      AND user_id = ${userId}::uuid
      AND deleted_at IS NULL
    LIMIT 1
  `;
  if (!supertype[0]) return null;
  const a = supertype[0];

  let subtype: ActivityDetailRow['subtype'];
  switch (a.type) {
    case 'spread': {
      const rows = await sql<SpreadSubtype[]>`
        SELECT * FROM public.activity_spread WHERE activity_id = ${activityId}::uuid LIMIT 1
      `;
      if (!rows[0]) return null;
      subtype = { type: 'spread', row: rows[0] };
      break;
    }
    case 'trade': {
      const rows = await sql<TradeSubtype[]>`
        SELECT * FROM public.activity_trade WHERE activity_id = ${activityId}::uuid LIMIT 1
      `;
      if (!rows[0]) return null;
      subtype = { type: 'trade', row: rows[0] };
      break;
    }
    case 'sale': {
      const rows = await sql<SaleSubtype[]>`
        SELECT * FROM public.activity_sale WHERE activity_id = ${activityId}::uuid LIMIT 1
      `;
      if (!rows[0]) return null;
      subtype = { type: 'sale', row: rows[0] };
      break;
    }
    case 'airdrop': {
      const rows = await sql<AirdropSubtype[]>`
        SELECT * FROM public.activity_airdrop WHERE activity_id = ${activityId}::uuid LIMIT 1
      `;
      if (!rows[0]) return null;
      subtype = { type: 'airdrop', row: rows[0] };
      break;
    }
    case 'yield_position':
    case 'option': {
      // v5: yield_position + option detail loads land in Wave 2e/2f via their
      // own dedicated routes (/yield-positions/[id] + /options/[id]). The
      // generic getActivityDetail() stops here and returns null so the older
      // /spreads/[id] route doesn't try to render an incompatible subtype.
      return null;
    }
  }

  return {
    id: a.id as ActivityId,
    userId: a.userId,
    type: a.type,
    status: a.status,
    name: a.name,
    openedAt: a.openedAt,
    closedAt: a.closedAt,
    capitalDeployedUsd: a.capitalDeployedUsd,
    realizedPnlUsd: a.realizedPnlUsd,
    unrealizedPnlUsd: a.unrealizedPnlUsd,
    feesUsd: a.feesUsd,
    netPnlUsd: a.netPnlUsd,
    regimeTags: a.regimeTags,
    customTags: a.customTags,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    deletedAt: a.deletedAt,
    subtype,
  };
}

// ============================================================================
// Manual exchange connection sentinel
//
// activity_trade.position_id is a NOT NULL FK to public.positions, which in
// turn has a NOT NULL FK to public.exchange_connections. Manual entry has no
// real exchange link, so we provision one "Manual" connection per user the
// first time they log a manual trade. exchange_code uses 'binance' as a
// placeholder — the row is read-only sentinel data and never gets synced.
// ============================================================================

const MANUAL_CONN_LABEL = '_manual_entry';

async function ensureManualConnection(userId: string): Promise<string> {
  const existing = await sql<{ id: string }[]>`
    SELECT id FROM public.exchange_connections
    WHERE user_id = ${userId}::uuid
      AND label = ${MANUAL_CONN_LABEL}
      AND deleted_at IS NULL
    LIMIT 1
  `;
  if (existing[0]) return existing[0].id;

  // The chk_api_or_wallet check constraint allows status='pending' with no
  // credentials — we ride that exemption since the sentinel never authenticates.
  const [created] = await sql<{ id: string }[]>`
    INSERT INTO public.exchange_connections (
      user_id, exchange_code, label, connection_type, status, status_message
    ) VALUES (
      ${userId}::uuid, 'binance', ${MANUAL_CONN_LABEL}, 'api_key',
      'pending', 'sentinel for manual journal entries — never synced'
    )
    RETURNING id
  `;
  return created.id;
}

// ============================================================================
// createTrade
// ============================================================================

/**
 * Insert a manually-entered trade activity.
 *
 * Two rows go into the DB:
 *   1. public.positions — required by activity_trade.position_id (the FK
 *      enforces that every journaled trade ties back to a Position). For
 *      manual entries the Position is a thin shell capturing entry/exit
 *      prices, qty, and the realized PnL.
 *   2. public.activity + public.activity_trade — the journal entry proper.
 *
 * Inserted in a single transaction; the activity_subtype_check DEFERRABLE
 * constraint validates at COMMIT.
 */
export async function createTrade(
  userId: string,
  input: CreateTradeData,
): Promise<{ id: string }> {
  const opened = new Date(input.openedAt).toISOString();
  const closed = new Date(input.closedAt).toISOString();
  const qty = parseDec(input.qty);
  const entry = parseDec(input.entryPrice);
  const exit = parseDec(input.exitPrice);
  const capital = parseDec(input.capital);
  const fees = parseDec(input.fees ?? '0');
  // Signed PnL — long: (exit-entry)*qty, short: (entry-exit)*qty
  const dir = input.side === 'short' ? -1 : 1;
  const gross = qty * (exit - entry) * dir;
  const net = gross - fees;
  const daysHeld =
    (new Date(closed).getTime() - new Date(opened).getTime()) / 86_400_000;
  const realizedApr =
    capital > 0 && daysHeld > 0
      ? (net / capital) * (365 / daysHeld)
      : null;

  // Map UI exchange label → exchange_catalog code. The CHECK constraint on
  // activity_trade.exchange points at exchange_catalog(code) which is lower-snake.
  const exchangeCode = mapExchangeLabelToCode(input.exchange);
  const instrumentKind = input.instrument === 'future' ? 'dated_future' : input.instrument;

  const connectionId = await ensureManualConnection(userId);

  const activityId = await sql.begin(async (tx) => {
    // 1. Position shell — captures the trade as a closed position.
    const [position] = await tx<{ id: string }[]>`
      INSERT INTO public.positions (
        user_id, exchange_connection_id,
        instrument, instrument_type, side, margin_mode,
        total_qty, qty_open, avg_entry_price, avg_exit_price,
        opened_at, closed_at, status,
        realized_pnl_quote, total_fees_quote, quote_currency
      ) VALUES (
        ${userId}::uuid, ${connectionId}::uuid,
        ${input.symbol}, ${instrumentKind}::instrument_type, ${input.side},
        ${input.instrument === 'spot' ? 'spot' : 'cross'}::margin_mode,
        ${qty.toString()}, '0', ${entry.toString()}, ${exit.toString()},
        ${opened}::timestamptz, ${closed}::timestamptz, 'closed',
        ${gross.toString()}, ${fees.toString()}, 'USD'
      )
      RETURNING id
    `;

    // 2. Activity supertype.
    const [activity] = await tx<{ id: string }[]>`
      INSERT INTO public.activity (
        user_id, type, status, name,
        opened_at, closed_at,
        capital_deployed_usd, realized_pnl_usd, fees_usd, net_pnl_usd,
        regime_tags, custom_tags
      ) VALUES (
        ${userId}::uuid, 'trade', 'closed',
        ${deriveTradeName(input)},
        ${opened}::timestamptz, ${closed}::timestamptz,
        ${capital.toString()}, ${gross.toString()}, ${fees.toString()}, ${net.toString()},
        ${input.regimeTags as string[]}, ${[] as string[]}
      )
      RETURNING id
    `;

    // 3. Subtype row.
    await tx`
      INSERT INTO public.activity_trade (
        activity_id, position_id, symbol, exchange, instrument_kind, side,
        entry_thesis, qty, avg_entry_price, avg_exit_price, realized_apr
      ) VALUES (
        ${activity.id}::uuid, ${position.id}::uuid, ${input.symbol},
        ${exchangeCode}, ${instrumentKind}::instrument_type, ${input.side},
        ${input.note || null},
        ${qty.toString()}, ${entry.toString()}, ${exit.toString()},
        ${realizedApr !== null ? realizedApr.toString() : null}
      )
    `;

    return activity.id;
  });

  return { id: activityId };
}

// ============================================================================
// createSale
// ============================================================================

export async function createSale(
  userId: string,
  input: CreateSaleData,
): Promise<{ id: string }> {
  const openedIso = new Date(input.openedAt).toISOString();
  const tgeIso = new Date(input.tgeDate).toISOString();
  const usdPaid = parseDec(input.usdPaid);
  const tokens = parseDec(input.tokensAllocated);
  const currentPrice = parseDec(input.currentPriceUsd);
  // Net PnL at this moment = (tokens * current_price) - usd_paid. Stored as
  // realized_pnl_usd so the dashboard's net-PnL aggregate is accurate.
  const currentValue = tokens * currentPrice;
  const netPnl = currentValue - usdPaid;

  // Build the vesting_schedule JSON. tge_unlock_pct 100 + no cliff → all_at_tge.
  // Otherwise tge_plus_linear or cliff_plus_linear depending on cliff months.
  const linearDays = (input.vestingDurationMonths ?? 0) * 30;
  const cliffDays = (input.vestingCliffMonths ?? 0) * 30;
  const vestingSchedule = buildVestingSchedule(
    input.tgeUnlockPct,
    cliffDays,
    linearDays,
  );

  const activityId = await sql.begin(async (tx) => {
    const [activity] = await tx<{ id: string }[]>`
      INSERT INTO public.activity (
        user_id, type, status, name,
        opened_at,
        capital_deployed_usd, realized_pnl_usd, fees_usd, net_pnl_usd,
        regime_tags, custom_tags
      ) VALUES (
        ${userId}::uuid, 'sale',
        ${input.tgeUnlockPct >= 100 ? 'vesting' : 'pending'}::activity_status,
        ${deriveSaleName(input)},
        ${openedIso}::timestamptz,
        ${usdPaid.toString()}, '0', '0', ${netPnl.toString()},
        ${input.regimeTags as string[]}, ${[] as string[]}
      )
      RETURNING id
    `;

    await tx`
      INSERT INTO public.activity_sale (
        activity_id, token_symbol, sale_kind, sale_venue, sale_date,
        usd_paid, tokens_allocated,
        vesting_schedule, claim_events, total_claimed,
        current_price_usd, current_price_at
      ) VALUES (
        ${activity.id}::uuid, ${input.asset.toUpperCase()}, ${input.saleKind},
        ${input.venue}, ${tgeIso}::timestamptz,
        ${usdPaid.toString()}, ${tokens.toString()},
        ${vestingSchedule ? tx.json(vestingSchedule) : null},
        ${tx.json([])}, '0',
        ${currentPrice.toString()}, now()
      )
    `;

    return activity.id;
  });

  return { id: activityId };
}

// ============================================================================
// createAirdrop
// ============================================================================

export async function createAirdrop(
  userId: string,
  input: CreateAirdropData,
): Promise<{ id: string }> {
  // v5: with the pending-watchlist branch the wizard can pass a body without
  // claim_date / tokens / value_at_claim / current_price. The full claim flow
  // (status='claimed') still requires them — superRefine in
  // CreateAirdropBody enforces that. Here we coerce missing values to '0' /
  // openedAt-ish for the supertype's NOT NULL columns; the W2D wizard will
  // emit a pending-shaped POST that lands the row in status='pending'.
  const claimIso = input.claimDate
    ? new Date(input.claimDate).toISOString()
    : new Date().toISOString();
  const tokens = parseDec(input.tokensClaimed ?? '0');
  const valueAtClaim = parseDec(input.usdValueAtClaim ?? '0');
  const currentPrice = parseDec(input.currentPriceUsd ?? '0');
  const currentValue = tokens * currentPrice;
  // Cost basis = $0 by definition. realized_pnl_usd = value_at_claim
  // (the income event); net_pnl_usd = current_value (the MTM today).
  const realized = valueAtClaim;
  const netPnl = currentValue;

  const activityId = await sql.begin(async (tx) => {
    const [activity] = await tx<{ id: string }[]>`
      INSERT INTO public.activity (
        user_id, type, status, name,
        opened_at, closed_at,
        capital_deployed_usd, realized_pnl_usd, fees_usd, net_pnl_usd,
        regime_tags, custom_tags
      ) VALUES (
        ${userId}::uuid, 'airdrop', 'claimed',
        ${deriveAirdropName(input)},
        ${claimIso}::timestamptz, ${claimIso}::timestamptz,
        '0', ${realized.toString()}, '0', ${netPnl.toString()},
        ${input.regimeTags as string[]}, ${[] as string[]}
      )
      RETURNING id
    `;

    await tx`
      INSERT INTO public.activity_airdrop (
        activity_id, token_symbol, protocol,
        qty_received, claim_date,
        value_at_receipt_usd, current_price_usd, current_price_at,
        eligibility_reason
      ) VALUES (
        ${activity.id}::uuid, ${input.asset.toUpperCase()}, ${input.protocol},
        ${tokens.toString()}, ${claimIso}::timestamptz,
        ${valueAtClaim.toString()}, ${currentPrice.toString()}, now(),
        ${input.note || null}
      )
    `;

    return activity.id;
  });

  return { id: activityId };
}

// ============================================================================
// updateActivity / deleteActivity (common-field edits + soft-delete)
// ============================================================================

export interface ActivityPatch {
  name?: string;
  status?: ActivityStatus;
  regimeTags?: string[];
  customTags?: string[];
  // Aggregates — wizard recomputes these on edit and pushes them back. Optional
  // because the common-field PATCH path (name/tags) shouldn't need to specify.
  openedAt?: string | null;
  closedAt?: string | null;
  capitalDeployedUsd?: string | null;
  realizedPnlUsd?: string | null;
  feesUsd?: string;
  netPnlUsd?: string | null;
}

export async function updateActivity(
  userId: string,
  activityId: string,
  patch: ActivityPatch,
): Promise<boolean> {
  if (!UUID_RE.test(activityId)) return false;
  const patches: Record<string, unknown> = {};
  if (patch.name !== undefined) patches.name = patch.name;
  if (patch.status !== undefined) patches.status = patch.status;
  if (patch.regimeTags !== undefined) patches.regime_tags = patch.regimeTags;
  if (patch.customTags !== undefined) patches.custom_tags = patch.customTags;
  if (patch.openedAt !== undefined) patches.opened_at = patch.openedAt;
  if (patch.closedAt !== undefined) patches.closed_at = patch.closedAt;
  if (patch.capitalDeployedUsd !== undefined) patches.capital_deployed_usd = patch.capitalDeployedUsd;
  if (patch.realizedPnlUsd !== undefined) patches.realized_pnl_usd = patch.realizedPnlUsd;
  if (patch.feesUsd !== undefined) patches.fees_usd = patch.feesUsd;
  if (patch.netPnlUsd !== undefined) patches.net_pnl_usd = patch.netPnlUsd;
  if (Object.keys(patches).length === 0) return true;

  const rows = await sql`
    UPDATE public.activity
    SET ${sql(patches)}
    WHERE id = ${activityId}::uuid
      AND user_id = ${userId}::uuid
      AND deleted_at IS NULL
    RETURNING id
  `;
  return rows.length > 0;
}

// ----------------------------------------------------------------------------
// Subtype-specific updates
//
// Each wizard edit path needs to push subtype-specific fields back to the
// matching activity_<type> row. These helpers narrow the SQL to the columns
// each type actually owns; the wizard always rewrites everything (no partial
// patches), so the patches are required-rather-than-optional in practice.
//
// All four go through sql.begin() with the supertype update so the supertype
// + subtype edits land atomically. If the user changed something that affects
// derived aggregates (qty/entry/exit on a trade, tokens/price on a sale), the
// wizard's action helper recomputes net_pnl_usd / realized_pnl_usd / fees and
// passes those through `updateActivity`.
// ----------------------------------------------------------------------------

/** Update an activity + its activity_trade row. */
export async function updateTradeActivity(
  userId: string,
  activityId: string,
  parentPatch: ActivityPatch,
  tradePatch: {
    symbol?: string;
    exchange?: string;
    instrumentKind?: string;
    side?: 'long' | 'short';
    entryThesis?: string | null;
    qty?: string;
    avgEntryPrice?: string;
    avgExitPrice?: string;
    realizedApr?: string | null;
  },
): Promise<boolean> {
  return sql.begin(async (tx) => {
    // 1. Supertype update + ownership check
    const parentPatches: Record<string, unknown> = {};
    if (parentPatch.name !== undefined) parentPatches.name = parentPatch.name;
    if (parentPatch.status !== undefined) parentPatches.status = parentPatch.status;
    if (parentPatch.regimeTags !== undefined) parentPatches.regime_tags = parentPatch.regimeTags;
    if (parentPatch.customTags !== undefined) parentPatches.custom_tags = parentPatch.customTags;
    if (parentPatch.openedAt !== undefined) parentPatches.opened_at = parentPatch.openedAt;
    if (parentPatch.closedAt !== undefined) parentPatches.closed_at = parentPatch.closedAt;
    if (parentPatch.capitalDeployedUsd !== undefined) parentPatches.capital_deployed_usd = parentPatch.capitalDeployedUsd;
    if (parentPatch.realizedPnlUsd !== undefined) parentPatches.realized_pnl_usd = parentPatch.realizedPnlUsd;
    if (parentPatch.feesUsd !== undefined) parentPatches.fees_usd = parentPatch.feesUsd;
    if (parentPatch.netPnlUsd !== undefined) parentPatches.net_pnl_usd = parentPatch.netPnlUsd;

    if (Object.keys(parentPatches).length > 0) {
      const parentRows = await tx`
        UPDATE public.activity
        SET ${tx(parentPatches)}
        WHERE id = ${activityId}::uuid
          AND user_id = ${userId}::uuid
          AND deleted_at IS NULL
        RETURNING id
      `;
      if (parentRows.length === 0) return false;
    } else {
      // Still need to verify ownership before touching subtype
      const ownerRows = await tx<{ id: string }[]>`
        SELECT id FROM public.activity
        WHERE id = ${activityId}::uuid
          AND user_id = ${userId}::uuid
          AND deleted_at IS NULL
        LIMIT 1
      `;
      if (ownerRows.length === 0) return false;
    }

    // 2. Subtype update
    const subPatches: Record<string, unknown> = {};
    if (tradePatch.symbol !== undefined) subPatches.symbol = tradePatch.symbol;
    if (tradePatch.exchange !== undefined) subPatches.exchange = tradePatch.exchange;
    if (tradePatch.instrumentKind !== undefined) subPatches.instrument_kind = tradePatch.instrumentKind;
    if (tradePatch.side !== undefined) subPatches.side = tradePatch.side;
    if (tradePatch.entryThesis !== undefined) subPatches.entry_thesis = tradePatch.entryThesis;
    if (tradePatch.qty !== undefined) subPatches.qty = tradePatch.qty;
    if (tradePatch.avgEntryPrice !== undefined) subPatches.avg_entry_price = tradePatch.avgEntryPrice;
    if (tradePatch.avgExitPrice !== undefined) subPatches.avg_exit_price = tradePatch.avgExitPrice;
    if (tradePatch.realizedApr !== undefined) subPatches.realized_apr = tradePatch.realizedApr;

    if (Object.keys(subPatches).length > 0) {
      await tx`
        UPDATE public.activity_trade
        SET ${tx(subPatches)}
        WHERE activity_id = ${activityId}::uuid
      `;
    }

    return true;
  });
}

/**
 * JSONB shape for activity_sale.vesting_schedule. Mirrors the four kinds
 * createSale's buildVestingSchedule emits — keeps the update path strictly
 * compatible with what's already in the column.
 */
export type SaleVestingScheduleJson =
  | { kind: 'all_at_tge' }
  | { kind: 'tge_plus_linear'; tge_pct: number; linear_days: number }
  | { kind: 'cliff_plus_linear'; cliff_days: number; linear_days: number; tge_pct?: number };

/** Update an activity + its activity_sale row. */
export async function updateSaleActivity(
  userId: string,
  activityId: string,
  parentPatch: ActivityPatch,
  salePatch: {
    tokenSymbol?: string;
    saleKind?: string;
    saleVenue?: string | null;
    saleDate?: string;
    usdPaid?: string;
    tokensAllocated?: string;
    vestingSchedule?: SaleVestingScheduleJson | null;
    currentPriceUsd?: string | null;
  },
): Promise<boolean> {
  return sql.begin(async (tx) => {
    const parentPatches: Record<string, unknown> = {};
    if (parentPatch.name !== undefined) parentPatches.name = parentPatch.name;
    if (parentPatch.status !== undefined) parentPatches.status = parentPatch.status;
    if (parentPatch.regimeTags !== undefined) parentPatches.regime_tags = parentPatch.regimeTags;
    if (parentPatch.customTags !== undefined) parentPatches.custom_tags = parentPatch.customTags;
    if (parentPatch.openedAt !== undefined) parentPatches.opened_at = parentPatch.openedAt;
    if (parentPatch.closedAt !== undefined) parentPatches.closed_at = parentPatch.closedAt;
    if (parentPatch.capitalDeployedUsd !== undefined) parentPatches.capital_deployed_usd = parentPatch.capitalDeployedUsd;
    if (parentPatch.realizedPnlUsd !== undefined) parentPatches.realized_pnl_usd = parentPatch.realizedPnlUsd;
    if (parentPatch.feesUsd !== undefined) parentPatches.fees_usd = parentPatch.feesUsd;
    if (parentPatch.netPnlUsd !== undefined) parentPatches.net_pnl_usd = parentPatch.netPnlUsd;

    if (Object.keys(parentPatches).length > 0) {
      const parentRows = await tx`
        UPDATE public.activity
        SET ${tx(parentPatches)}
        WHERE id = ${activityId}::uuid
          AND user_id = ${userId}::uuid
          AND deleted_at IS NULL
        RETURNING id
      `;
      if (parentRows.length === 0) return false;
    } else {
      const ownerRows = await tx<{ id: string }[]>`
        SELECT id FROM public.activity
        WHERE id = ${activityId}::uuid
          AND user_id = ${userId}::uuid
          AND deleted_at IS NULL
        LIMIT 1
      `;
      if (ownerRows.length === 0) return false;
    }

    const subPatches: Record<string, unknown> = {};
    if (salePatch.tokenSymbol !== undefined) subPatches.token_symbol = salePatch.tokenSymbol;
    if (salePatch.saleKind !== undefined) subPatches.sale_kind = salePatch.saleKind;
    if (salePatch.saleVenue !== undefined) subPatches.sale_venue = salePatch.saleVenue;
    if (salePatch.saleDate !== undefined) subPatches.sale_date = salePatch.saleDate;
    if (salePatch.usdPaid !== undefined) subPatches.usd_paid = salePatch.usdPaid;
    if (salePatch.tokensAllocated !== undefined) subPatches.tokens_allocated = salePatch.tokensAllocated;
    if (salePatch.vestingSchedule !== undefined) {
      subPatches.vesting_schedule = salePatch.vestingSchedule === null ? null : tx.json(salePatch.vestingSchedule);
    }
    if (salePatch.currentPriceUsd !== undefined) {
      subPatches.current_price_usd = salePatch.currentPriceUsd;
      // ISO string instead of raw `now()` — postgres.js's object-spread for
      // UPDATE can't take SQL fragments as values. Same effective timestamp.
      subPatches.current_price_at = new Date().toISOString();
    }

    if (Object.keys(subPatches).length > 0) {
      await tx`
        UPDATE public.activity_sale
        SET ${tx(subPatches)}
        WHERE activity_id = ${activityId}::uuid
      `;
    }

    return true;
  });
}

/** Update an activity + its activity_airdrop row. */
export async function updateAirdropActivity(
  userId: string,
  activityId: string,
  parentPatch: ActivityPatch,
  airdropPatch: {
    tokenSymbol?: string;
    protocol?: string;
    qtyReceived?: string;
    claimDate?: string | null;
    valueAtReceiptUsd?: string | null;
    currentPriceUsd?: string | null;
    eligibilityReason?: string | null;
  },
): Promise<boolean> {
  return sql.begin(async (tx) => {
    const parentPatches: Record<string, unknown> = {};
    if (parentPatch.name !== undefined) parentPatches.name = parentPatch.name;
    if (parentPatch.status !== undefined) parentPatches.status = parentPatch.status;
    if (parentPatch.regimeTags !== undefined) parentPatches.regime_tags = parentPatch.regimeTags;
    if (parentPatch.customTags !== undefined) parentPatches.custom_tags = parentPatch.customTags;
    if (parentPatch.openedAt !== undefined) parentPatches.opened_at = parentPatch.openedAt;
    if (parentPatch.closedAt !== undefined) parentPatches.closed_at = parentPatch.closedAt;
    if (parentPatch.capitalDeployedUsd !== undefined) parentPatches.capital_deployed_usd = parentPatch.capitalDeployedUsd;
    if (parentPatch.realizedPnlUsd !== undefined) parentPatches.realized_pnl_usd = parentPatch.realizedPnlUsd;
    if (parentPatch.netPnlUsd !== undefined) parentPatches.net_pnl_usd = parentPatch.netPnlUsd;

    if (Object.keys(parentPatches).length > 0) {
      const parentRows = await tx`
        UPDATE public.activity
        SET ${tx(parentPatches)}
        WHERE id = ${activityId}::uuid
          AND user_id = ${userId}::uuid
          AND deleted_at IS NULL
        RETURNING id
      `;
      if (parentRows.length === 0) return false;
    } else {
      const ownerRows = await tx<{ id: string }[]>`
        SELECT id FROM public.activity
        WHERE id = ${activityId}::uuid
          AND user_id = ${userId}::uuid
          AND deleted_at IS NULL
        LIMIT 1
      `;
      if (ownerRows.length === 0) return false;
    }

    const subPatches: Record<string, unknown> = {};
    if (airdropPatch.tokenSymbol !== undefined) subPatches.token_symbol = airdropPatch.tokenSymbol;
    if (airdropPatch.protocol !== undefined) subPatches.protocol = airdropPatch.protocol;
    if (airdropPatch.qtyReceived !== undefined) subPatches.qty_received = airdropPatch.qtyReceived;
    if (airdropPatch.claimDate !== undefined) subPatches.claim_date = airdropPatch.claimDate;
    if (airdropPatch.valueAtReceiptUsd !== undefined) subPatches.value_at_receipt_usd = airdropPatch.valueAtReceiptUsd;
    if (airdropPatch.currentPriceUsd !== undefined) {
      subPatches.current_price_usd = airdropPatch.currentPriceUsd;
      subPatches.current_price_at = new Date().toISOString();
    }
    if (airdropPatch.eligibilityReason !== undefined) subPatches.eligibility_reason = airdropPatch.eligibilityReason;

    if (Object.keys(subPatches).length > 0) {
      await tx`
        UPDATE public.activity_airdrop
        SET ${tx(subPatches)}
        WHERE activity_id = ${activityId}::uuid
      `;
    }

    return true;
  });
}

/** Update an activity + its activity_spread row. */
export async function updateSpreadActivity(
  userId: string,
  activityId: string,
  parentPatch: ActivityPatch,
  spreadPatch: {
    spreadType?: string;
    variant?: string | null;
    primaryBase?: string;
    exitPlan?: string | null;
    targetAprAtOpen?: string | null;
  },
): Promise<boolean> {
  return sql.begin(async (tx) => {
    const parentPatches: Record<string, unknown> = {};
    if (parentPatch.name !== undefined) parentPatches.name = parentPatch.name;
    if (parentPatch.status !== undefined) parentPatches.status = parentPatch.status;
    if (parentPatch.regimeTags !== undefined) parentPatches.regime_tags = parentPatch.regimeTags;
    if (parentPatch.customTags !== undefined) parentPatches.custom_tags = parentPatch.customTags;
    if (parentPatch.openedAt !== undefined) parentPatches.opened_at = parentPatch.openedAt;
    if (parentPatch.closedAt !== undefined) parentPatches.closed_at = parentPatch.closedAt;
    if (parentPatch.capitalDeployedUsd !== undefined) parentPatches.capital_deployed_usd = parentPatch.capitalDeployedUsd;
    if (parentPatch.realizedPnlUsd !== undefined) parentPatches.realized_pnl_usd = parentPatch.realizedPnlUsd;
    if (parentPatch.netPnlUsd !== undefined) parentPatches.net_pnl_usd = parentPatch.netPnlUsd;

    if (Object.keys(parentPatches).length > 0) {
      const parentRows = await tx`
        UPDATE public.activity
        SET ${tx(parentPatches)}
        WHERE id = ${activityId}::uuid
          AND user_id = ${userId}::uuid
          AND deleted_at IS NULL
        RETURNING id
      `;
      if (parentRows.length === 0) return false;
    } else {
      const ownerRows = await tx<{ id: string }[]>`
        SELECT id FROM public.activity
        WHERE id = ${activityId}::uuid
          AND user_id = ${userId}::uuid
          AND deleted_at IS NULL
        LIMIT 1
      `;
      if (ownerRows.length === 0) return false;
    }

    const subPatches: Record<string, unknown> = {};
    if (spreadPatch.spreadType !== undefined) subPatches.spread_type = spreadPatch.spreadType;
    if (spreadPatch.variant !== undefined) subPatches.variant = spreadPatch.variant;
    if (spreadPatch.primaryBase !== undefined) subPatches.primary_base = spreadPatch.primaryBase;
    if (spreadPatch.exitPlan !== undefined) subPatches.exit_plan = spreadPatch.exitPlan;
    if (spreadPatch.targetAprAtOpen !== undefined) subPatches.target_apr_at_open = spreadPatch.targetAprAtOpen;

    if (Object.keys(subPatches).length > 0) {
      await tx`
        UPDATE public.activity_spread
        SET ${tx(subPatches)}
        WHERE activity_id = ${activityId}::uuid
      `;
    }

    return true;
  });
}

/**
 * Soft-delete by setting deleted_at. RLS-style ownership check enforced via
 * the WHERE clause; returns false if the row wasn't found (or wasn't owned).
 */
export async function deleteActivity(
  userId: string,
  activityId: string,
): Promise<boolean> {
  if (!UUID_RE.test(activityId)) return false;
  const rows = await sql`
    UPDATE public.activity
    SET deleted_at = now()
    WHERE id = ${activityId}::uuid
      AND user_id = ${userId}::uuid
      AND deleted_at IS NULL
    RETURNING id
  `;
  return rows.length > 0;
}

// ============================================================================
// Dashboard aggregations
// ============================================================================

export interface ActivityTotals {
  count: number;
  net: number;
  winners: number;
  losers: number;
  winRate: number;
  capital: number;
  weightedReturnPct: number;
  best: ActivityFeedRowDb | null;
  worst: ActivityFeedRowDb | null;
  firstClose: string | null;
  lastClose: string | null;
}

/**
 * Filter set applied uniformly across every dashboard aggregation. All fields
 * optional: the page passes whatever the URL search-params decoded to.
 *
 * Why one shared shape:
 *  - The /spreads/page.tsx render fans out to seven concurrent reads. If each
 *    helper grew its own filter signature the wiring would drift fast.
 *  - The /api/activities/export route uses the same shape so a filtered
 *    dashboard view round-trips into a filtered export with no glue code.
 */
export interface DashboardFilters {
  /** ISO-prefix YYYY-MM-DD or full ISO. Inclusive. */
  closedAfter?: string;
  /** ISO-prefix YYYY-MM-DD or full ISO. Inclusive. */
  closedBefore?: string;
  type?: ActivityType[];
  /** Min capital_deployed_usd in USD (after coalesce(.,0)). Activities below
   *  this are filtered out — useful for hiding zero-cost airdrops or
   *  ignore-able test entries. */
  minCapital?: number;
}

/**
 * Compute dashboard KPIs from v_activity_feed. Single SELECT per metric
 * keeps the page render under ~10ms even with 1000s of activities.
 */
export async function getTotals(
  userId: string,
  filters: DashboardFilters = {},
): Promise<ActivityTotals> {
  const { closedAfter, closedBefore, type, minCapital } = filters;
  const [agg] = await sql<
    {
      count: string;
      net: string | null;
      winners: string;
      losers: string;
      capital: string | null;
      paidCapital: string | null;
      paidNet: string | null;
      firstClose: string | null;
      lastClose: string | null;
    }[]
  >`
    SELECT
      count(*)::text                              AS count,
      sum(net_pnl_usd)::text                      AS net,
      sum(case when net_pnl_usd > 0 then 1 else 0 end)::text AS winners,
      sum(case when net_pnl_usd < 0 then 1 else 0 end)::text AS losers,
      sum(coalesce(capital_deployed_usd, 0))::text AS capital,
      sum(case when coalesce(capital_deployed_usd, 0) > 0 then capital_deployed_usd else 0 end)::text AS paid_capital,
      sum(case when coalesce(capital_deployed_usd, 0) > 0 then net_pnl_usd else 0 end)::text AS paid_net,
      min(closed_at)::text                        AS first_close,
      max(closed_at)::text                        AS last_close
    FROM public.v_activity_feed
    WHERE user_id = ${userId}::uuid
      ${closedAfter  ? sql`AND closed_at >= ${closedAfter}::timestamptz`  : sql``}
      ${closedBefore ? sql`AND closed_at <= ${closedBefore}::timestamptz` : sql``}
      ${type && type.length > 0 ? sql`AND type::text = ANY(${type}::text[])` : sql``}
      ${minCapital && minCapital > 0
        ? sql`AND coalesce(capital_deployed_usd, 0) >= ${minCapital}`
        : sql``}
  `;

  // Best / worst via two cheap top-1 selects rather than a window function.
  const [best, worst] = await Promise.all([
    sql<ActivityFeedRowDb[]>`
      SELECT * FROM public.v_activity_feed
      WHERE user_id = ${userId}::uuid
        ${closedAfter  ? sql`AND closed_at >= ${closedAfter}::timestamptz`  : sql``}
        ${closedBefore ? sql`AND closed_at <= ${closedBefore}::timestamptz` : sql``}
        ${type && type.length > 0 ? sql`AND type::text = ANY(${type}::text[])` : sql``}
        ${minCapital && minCapital > 0
          ? sql`AND coalesce(capital_deployed_usd, 0) >= ${minCapital}`
          : sql``}
      ORDER BY net_pnl_usd DESC NULLS LAST
      LIMIT 1
    `,
    sql<ActivityFeedRowDb[]>`
      SELECT * FROM public.v_activity_feed
      WHERE user_id = ${userId}::uuid
        ${closedAfter  ? sql`AND closed_at >= ${closedAfter}::timestamptz`  : sql``}
        ${closedBefore ? sql`AND closed_at <= ${closedBefore}::timestamptz` : sql``}
        ${type && type.length > 0 ? sql`AND type::text = ANY(${type}::text[])` : sql``}
        ${minCapital && minCapital > 0
          ? sql`AND coalesce(capital_deployed_usd, 0) >= ${minCapital}`
          : sql``}
      ORDER BY net_pnl_usd ASC NULLS LAST
      LIMIT 1
    `,
  ]);

  const count = Number(agg?.count ?? 0);
  const net = Number(agg?.net ?? 0);
  const winners = Number(agg?.winners ?? 0);
  const losers = Number(agg?.losers ?? 0);
  const capital = Number(agg?.capital ?? 0);
  const paidCapital = Number(agg?.paidCapital ?? 0);
  const paidNet = Number(agg?.paidNet ?? 0);

  return {
    count,
    net,
    winners,
    losers,
    winRate: count > 0 ? (winners / count) * 100 : 0,
    capital,
    weightedReturnPct: paidCapital > 0 ? (paidNet / paidCapital) * 100 : 0,
    best: best[0] ?? null,
    worst: worst[0] ?? null,
    firstClose: agg?.firstClose ?? null,
    lastClose: agg?.lastClose ?? null,
  };
}

/**
 * Count of real (non-sentinel) exchange connections for the dashboard's
 * "N exchanges connected" badge. Excludes the soft-deleted rows and the
 * '_manual_entry' sentinel that activity.ts maintains for manual journal
 * entries (those don't represent a sync-capable connection).
 */
const MANUAL_CONN_LABEL_FOR_COUNT = '_manual_entry';

export async function getConnectedExchangeCount(
  userId: string,
): Promise<number> {
  const [row] = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count
    FROM public.exchange_connections
    WHERE user_id = ${userId}::uuid
      AND deleted_at IS NULL
      AND label != ${MANUAL_CONN_LABEL_FOR_COUNT}
  `;
  return Number(row?.count ?? 0);
}

export type ActivityTypeCounts = Record<ActivityType, number>;

export async function getActivityTypeCounts(
  userId: string,
  filters: DashboardFilters = {},
): Promise<ActivityTypeCounts> {
  const { closedAfter, closedBefore, type, minCapital } = filters;
  const rows = await sql<{ type: ActivityType; count: string }[]>`
    SELECT type, count(*)::text AS count
    FROM public.v_activity_feed
    WHERE user_id = ${userId}::uuid
      ${closedAfter  ? sql`AND closed_at >= ${closedAfter}::timestamptz`  : sql``}
      ${closedBefore ? sql`AND closed_at <= ${closedBefore}::timestamptz` : sql``}
      ${type && type.length > 0 ? sql`AND type::text = ANY(${type}::text[])` : sql``}
      ${minCapital && minCapital > 0
        ? sql`AND coalesce(capital_deployed_usd, 0) >= ${minCapital}`
        : sql``}
    GROUP BY type
  `;
  const counts: ActivityTypeCounts = {
    spread: 0, trade: 0, sale: 0, airdrop: 0, yield_position: 0, option: 0,
  };
  for (const r of rows) counts[r.type] = Number(r.count);
  return counts;
}

/**
 * Net PnL by activity type — drives /spreads activity-mix card.
 */
export async function getActivityTypeNetPnl(
  userId: string,
): Promise<ActivityTypeCounts> {
  const rows = await sql<{ type: ActivityType; net: string | null }[]>`
    SELECT type, sum(net_pnl_usd)::text AS net
    FROM public.v_activity_feed
    WHERE user_id = ${userId}::uuid
    GROUP BY type
  `;
  const net: ActivityTypeCounts = {
    spread: 0, trade: 0, sale: 0, airdrop: 0, yield_position: 0, option: 0,
  };
  for (const r of rows) net[r.type] = Number(r.net ?? 0);
  return net;
}

/**
 * Per-activity-type aggregations — count, net P&L, winners, losers, capital.
 * Wider than the simpler getActivityTypeCounts / getActivityTypeNetPnl pair;
 * this is what the /analytics/activity-mix table consumes to populate its
 * per-type breakdown row including win rate.
 */
export interface ActivityTypeAggRow {
  count: number;
  netPnl: number;
  winners: number;
  losers: number;
  capital: number;
}

export type ActivityTypeAggregations = Record<ActivityType, ActivityTypeAggRow>;

export async function getActivityTypeAggregations(
  userId: string,
): Promise<ActivityTypeAggregations> {
  const rows = await sql<{
    type: ActivityType;
    count: string;
    netPnl: string | null;
    winners: string;
    losers: string;
    capital: string | null;
  }[]>`
    SELECT
      type,
      count(*)::text                                          AS count,
      sum(net_pnl_usd)::text                                  AS net_pnl,
      sum(case when net_pnl_usd > 0 then 1 else 0 end)::text  AS winners,
      sum(case when net_pnl_usd < 0 then 1 else 0 end)::text  AS losers,
      sum(coalesce(capital_deployed_usd, 0))::text            AS capital
    FROM public.v_activity_feed
    WHERE user_id = ${userId}::uuid
    GROUP BY type
  `;
  const out: ActivityTypeAggregations = {
    spread:         { count: 0, netPnl: 0, winners: 0, losers: 0, capital: 0 },
    trade:          { count: 0, netPnl: 0, winners: 0, losers: 0, capital: 0 },
    sale:           { count: 0, netPnl: 0, winners: 0, losers: 0, capital: 0 },
    airdrop:        { count: 0, netPnl: 0, winners: 0, losers: 0, capital: 0 },
    yield_position: { count: 0, netPnl: 0, winners: 0, losers: 0, capital: 0 },
    option:         { count: 0, netPnl: 0, winners: 0, losers: 0, capital: 0 },
  };
  for (const r of rows) {
    out[r.type] = {
      count: Number(r.count ?? 0),
      netPnl: Number(r.netPnl ?? 0),
      winners: Number(r.winners ?? 0),
      losers: Number(r.losers ?? 0),
      capital: Number(r.capital ?? 0),
    };
  }
  return out;
}

/**
 * Top N most-recently-closed activities (or opened, if no close date) —
 * dashboard "Recent closes" grid.
 */
export async function getRecentCloses(
  userId: string,
  limit: number,
  filters: DashboardFilters = {},
): Promise<ActivityFeedRowDb[]> {
  const { closedAfter, closedBefore, type, minCapital } = filters;
  return sql<ActivityFeedRowDb[]>`
    SELECT * FROM public.v_activity_feed
    WHERE user_id = ${userId}::uuid
      ${closedAfter  ? sql`AND closed_at >= ${closedAfter}::timestamptz`  : sql``}
      ${closedBefore ? sql`AND closed_at <= ${closedBefore}::timestamptz` : sql``}
      ${type && type.length > 0 ? sql`AND type::text = ANY(${type}::text[])` : sql``}
      ${minCapital && minCapital > 0
        ? sql`AND coalesce(capital_deployed_usd, 0) >= ${minCapital}`
        : sql``}
    ORDER BY coalesce(closed_at, opened_at) DESC NULLS LAST
    LIMIT ${limit}
  `;
}

/**
 * Every terminal-state activity for the user, oldest → newest. Feeds the
 * dashboard analytics block (equity curve, drawdown, R-distribution,
 * Sharpe). Closed-only because the math is over realised P&L.
 *
 * `vesting` is included because partially-vested sales already carry their
 * mark-to-market on the supertype row, so they belong in the equity walk.
 * Limit 5000 is a safety belt — single-digit-ms read in practice.
 */
export async function getAllClosedActivities(
  userId: string,
  filters: DashboardFilters = {},
): Promise<ActivityFeedRowDb[]> {
  // Map dashboard filters → listActivities filters. The supertype filter set
  // is a superset of the dashboard one, so this is a straight projection.
  // Note: listActivities filters on `opened_at` for date range; for the
  // dashboard's "closed in range" semantics we'd want closed_at, but for the
  // analytics block we don't actually need a closed_at filter — the equity
  // walk / R-distribution naturally handles any chronological window we pass
  // through. Using opened_at is a reasonable v1 approximation.
  return listActivities(userId, {
    status: ['closed', 'expired', 'claimed', 'vesting'] as ActivityStatus[],
    limit: 5000,
    sortField: 'closed_at',
    sortDir: 'asc',
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.closedAfter ? { openedAfter: filters.closedAfter } : {}),
    ...(filters.closedBefore ? { openedBefore: filters.closedBefore } : {}),
  });
}

/**
 * Daily aggregated net P&L for the dashboard calendar heatmap.
 *
 * Buckets by `closed_at::date` in the **server's local timezone**. v1 is
 * single-user and the server / app run in the same TZ, so this is fine.
 * v2 will need a `?tz=` param to bucket in the user's wall-clock day.
 *
 * Days with zero activity are NOT returned — the caller (heatmap renderer)
 * fills in the missing dates and treats them as no-activity neutrals.
 *
 * @param startDate YYYY-MM-DD inclusive
 * @param endDate   YYYY-MM-DD inclusive
 */
export interface DailyPnlRow {
  date: string;     // YYYY-MM-DD
  netPnl: number;
  count: number;
}

/**
 * Per-activity rows for the full-page calendar view. One row per closed
 * activity inside the date range. Bucketed by `closed_at::date` in the
 * server's local timezone (same convention as getDailyPnl).
 *
 * Only includes activities with a non-null closed_at — open positions
 * don't belong on a calendar of finalized P&L.
 *
 * `serial` is unset here — the page synthesizes a display serial via the
 * same makeSerial(id, type) helper used by the archive adapter. Keeping
 * the SQL minimal keeps this query cheap.
 *
 * @param startDate YYYY-MM-DD inclusive
 * @param endDate   YYYY-MM-DD inclusive
 */
export interface ActivityByDateRow {
  id: ActivityId;
  type: ActivityType;
  name: string;
  /** YYYY-MM-DD — bucket key for the calendar grid. */
  closedDate: string;
  /** Original close timestamp (ISO) — used for tooltip ordering. */
  closedAt: string;
  netPnl: number;
}

export async function getActivitiesByDateRange(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<ActivityByDateRow[]> {
  const rows = await sql<
    {
      id: string;
      type: ActivityType;
      name: string;
      closedDate: string;
      closedAt: string;
      netPnl: string | null;
    }[]
  >`
    SELECT
      id,
      type,
      name,
      to_char(closed_at::date, 'YYYY-MM-DD') AS closed_date,
      closed_at::text                        AS closed_at,
      net_pnl_usd::text                      AS net_pnl
    FROM public.v_activity_feed
    WHERE user_id = ${userId}::uuid
      AND closed_at IS NOT NULL
      AND closed_at::date BETWEEN ${startDate}::date AND ${endDate}::date
    ORDER BY closed_at ASC
  `;
  return rows.map((r) => ({
    id: r.id as ActivityId,
    type: r.type,
    name: r.name,
    closedDate: r.closedDate,
    closedAt: r.closedAt,
    netPnl: Number(r.netPnl ?? 0),
  }));
}

export async function getDailyPnl(
  userId: string,
  startDate: string,
  endDate: string,
  filters: Omit<DashboardFilters, 'closedAfter' | 'closedBefore'> = {},
): Promise<DailyPnlRow[]> {
  const { type, minCapital } = filters;
  const rows = await sql<
    { date: string; netPnl: string | null; count: string }[]
  >`
    SELECT
      to_char(closed_at::date, 'YYYY-MM-DD') AS date,
      sum(net_pnl_usd)::text                 AS net_pnl,
      count(*)::text                         AS count
    FROM public.v_activity_feed
    WHERE user_id = ${userId}::uuid
      AND closed_at IS NOT NULL
      AND closed_at::date BETWEEN ${startDate}::date AND ${endDate}::date
      ${type && type.length > 0 ? sql`AND type::text = ANY(${type}::text[])` : sql``}
      ${minCapital && minCapital > 0
        ? sql`AND coalesce(capital_deployed_usd, 0) >= ${minCapital}`
        : sql``}
    GROUP BY closed_at::date
    ORDER BY closed_at::date ASC
  `;
  return rows.map((r) => ({
    date: r.date,
    netPnl: Number(r.netPnl ?? 0),
    count: Number(r.count ?? 0),
  }));
}

// ============================================================================
// Wave 13B — Analytics-page aggregations
// ============================================================================

/**
 * Monthly P&L aggregations for the track-record calendar grid. Buckets in the
 * server's local TZ (same convention as `getDailyPnl`) and returns YYYY-MM
 * keys so the renderer can pivot without parsing dates again.
 *
 * Months with no activity are NOT returned — the renderer fills empty cells.
 * We return the count too so the UI can distinguish "zero P&L because no
 * trades" from "zero P&L because trades cancelled out".
 */
export interface MonthlyPnlRow {
  /** YYYY-MM key. */
  month: string;
  netPnl: number;
  count: number;
}

export async function getMonthlyPnl(userId: string): Promise<MonthlyPnlRow[]> {
  const rows = await sql<
    { month: string; netPnl: string | null; count: string }[]
  >`
    SELECT
      to_char(date_trunc('month', closed_at), 'YYYY-MM') AS month,
      sum(net_pnl_usd)::text                             AS net_pnl,
      count(*)::text                                     AS count
    FROM public.v_activity_feed
    WHERE user_id = ${userId}::uuid
      AND closed_at IS NOT NULL
    GROUP BY date_trunc('month', closed_at)
    ORDER BY date_trunc('month', closed_at) ASC
  `;
  return rows.map((r) => ({
    month: r.month,
    netPnl: Number(r.netPnl ?? 0),
    count: Number(r.count ?? 0),
  }));
}

/**
 * P&L by primary asset (BTC, ETH, SOL, …). `primary_symbol` on the feed is
 * already the cleaned base for spreads/sales/airdrops, but trades may store
 * pair strings like "BTC-PERP" / "ETH-USDT". We strip the suffix at the SQL
 * boundary so trades and spreads aggregate together cleanly.
 *
 * Excludes activities without a primary_symbol from the result set.
 */
export interface AssetAggRow {
  asset: string;
  count: number;
  netPnl: number;
  capital: number;
  winners: number;
  losers: number;
  /** winners / (winners + losers). 0 when neither. */
  winRate: number;
}

export async function getAssetAggregations(
  userId: string,
): Promise<AssetAggRow[]> {
  const rows = await sql<{
    asset: string;
    count: string;
    netPnl: string | null;
    capital: string | null;
    winners: string;
    losers: string;
  }[]>`
    SELECT
      split_part(primary_symbol, '-', 1)         AS asset,
      count(*)::text                             AS count,
      sum(net_pnl_usd)::text                     AS net_pnl,
      sum(coalesce(capital_deployed_usd, 0))::text AS capital,
      sum(case when net_pnl_usd > 0 then 1 else 0 end)::text AS winners,
      sum(case when net_pnl_usd < 0 then 1 else 0 end)::text AS losers
    FROM public.v_activity_feed
    WHERE user_id = ${userId}::uuid
      AND primary_symbol IS NOT NULL
      AND primary_symbol <> ''
    GROUP BY split_part(primary_symbol, '-', 1)
    ORDER BY sum(abs(coalesce(net_pnl_usd, 0))) DESC NULLS LAST
  `;
  return rows.map((r) => {
    const winners = Number(r.winners ?? 0);
    const losers = Number(r.losers ?? 0);
    const scoring = winners + losers;
    return {
      asset: r.asset,
      count: Number(r.count ?? 0),
      netPnl: Number(r.netPnl ?? 0),
      capital: Number(r.capital ?? 0),
      winners,
      losers,
      winRate: scoring > 0 ? winners / scoring : 0,
    };
  });
}

/**
 * Per-spread_type aggregations from `activity_spread` joined to the supertype.
 * Lets the activity-mix page break spreads into cash_carry / funding /
 * cross_exchange / dex_cex / calendar with full performance metrics.
 */
export interface SpreadSubtypeAggRow {
  spreadType: string;
  count: number;
  netPnl: number;
  capital: number;
  winners: number;
  losers: number;
  /** Fraction in [0, 1]. 0 when scoring=0. */
  winRate: number;
  avgPnl: number;
}

export async function getSpreadSubtypeAggregations(
  userId: string,
): Promise<SpreadSubtypeAggRow[]> {
  const rows = await sql<{
    spreadType: string;
    count: string;
    netPnl: string | null;
    capital: string | null;
    winners: string;
    losers: string;
  }[]>`
    SELECT
      asp.spread_type                                          AS spread_type,
      count(*)::text                                           AS count,
      sum(a.net_pnl_usd)::text                                 AS net_pnl,
      sum(coalesce(a.capital_deployed_usd, 0))::text           AS capital,
      sum(case when a.net_pnl_usd > 0 then 1 else 0 end)::text AS winners,
      sum(case when a.net_pnl_usd < 0 then 1 else 0 end)::text AS losers
    FROM public.activity_spread asp
    JOIN public.activity a ON a.id = asp.activity_id
    WHERE a.user_id = ${userId}::uuid
      AND a.deleted_at IS NULL
    GROUP BY asp.spread_type
    ORDER BY count(*) DESC, asp.spread_type ASC
  `;
  return rows.map((r) => {
    const count = Number(r.count ?? 0);
    const winners = Number(r.winners ?? 0);
    const losers = Number(r.losers ?? 0);
    const scoring = winners + losers;
    const netPnl = Number(r.netPnl ?? 0);
    return {
      spreadType: r.spreadType,
      count,
      netPnl,
      capital: Number(r.capital ?? 0),
      winners,
      losers,
      winRate: scoring > 0 ? winners / scoring : 0,
      avgPnl: count > 0 ? netPnl / count : 0,
    };
  });
}

/**
 * Hold-time histogram. We bucket the (closed_at − opened_at) interval into
 * five canonical bands: 0-1d / 1-7d / 1-4w / 1-3m / 3m+. Each band returns
 * count + sum(net_pnl) so the renderer can show both bars and the secondary
 * "avg P&L per band" axis.
 *
 * Bands done in SQL via a CASE expression — keeps the bucket boundaries in
 * one place and avoids a second round-trip.
 */
export interface HoldTimeBucketRow {
  bucket: '0-1d' | '1-7d' | '1-4w' | '1-3m' | '3m+';
  /** Ordering hint so the UI doesn't have to know the canonical sort. */
  bucketIndex: number;
  count: number;
  netPnl: number;
  avgPnl: number;
}

const HOLD_BUCKET_ORDER: HoldTimeBucketRow['bucket'][] = [
  '0-1d',
  '1-7d',
  '1-4w',
  '1-3m',
  '3m+',
];

export async function getHoldTimeBuckets(
  userId: string,
): Promise<HoldTimeBucketRow[]> {
  const rows = await sql<{
    bucket: HoldTimeBucketRow['bucket'];
    count: string;
    netPnl: string | null;
  }[]>`
    SELECT
      CASE
        WHEN extract(epoch from (closed_at - opened_at)) <= 86400          THEN '0-1d'
        WHEN extract(epoch from (closed_at - opened_at)) <= 604800         THEN '1-7d'
        WHEN extract(epoch from (closed_at - opened_at)) <= 2419200        THEN '1-4w'
        WHEN extract(epoch from (closed_at - opened_at)) <= 7776000        THEN '1-3m'
        ELSE '3m+'
      END                                       AS bucket,
      count(*)::text                            AS count,
      sum(net_pnl_usd)::text                    AS net_pnl
    FROM public.v_activity_feed
    WHERE user_id = ${userId}::uuid
      AND closed_at IS NOT NULL
      AND opened_at IS NOT NULL
      AND closed_at >= opened_at
    GROUP BY bucket
  `;
  // Fill missing buckets so the bar chart always renders all five bands.
  const byBucket = new Map<HoldTimeBucketRow['bucket'], { count: number; netPnl: number }>();
  for (const r of rows) {
    byBucket.set(r.bucket, {
      count: Number(r.count ?? 0),
      netPnl: Number(r.netPnl ?? 0),
    });
  }
  return HOLD_BUCKET_ORDER.map((bucket, bucketIndex) => {
    const v = byBucket.get(bucket) ?? { count: 0, netPnl: 0 };
    return {
      bucket,
      bucketIndex,
      count: v.count,
      netPnl: v.netPnl,
      avgPnl: v.count > 0 ? v.netPnl / v.count : 0,
    };
  });
}

/**
 * Per-regime aggregations via UNNEST(regime_tags). An activity tagged
 * `['funding-positive', 'risk-on']` contributes to two rows. Same caveat
 * as `getTagAggregations` — overlap is expected and intentional.
 *
 * Wave 13B regime page is the primary consumer; the SQL shape mirrors
 * getTagAggregations so the analytics table can be cross-rendered.
 *
 * Returns rows ordered by count DESC then regime ASC for stable display.
 */
export interface RegimeAggRow {
  regime: string;
  count: number;
  netPnl: number;
  winners: number;
  losers: number;
  /** Fraction in [0, 1]. Winners / (winners + losers). 0 when neither. */
  winRate: number;
  avgPnl: number;
  /** Gross wins / |gross losses|. null when there are no losses. */
  profitFactor: number | null;
  /** Van Tharp SQN: avg / population stddev * sqrt(N). null when stddev=0 or N<2. */
  sqn: number | null;
}

export async function getRegimeAggregations(
  userId: string,
): Promise<RegimeAggRow[]> {
  const rows = await sql<{
    regime: string;
    count: string;
    winCount: string;
    lossCount: string;
    pnlCount: string;
    grossWins: string | null;
    grossLosses: string | null;
    totalPnl: string | null;
    pnlVariance: string | null;
  }[]>`
    WITH exploded AS (
      SELECT
        unnest(regime_tags)::text AS regime,
        net_pnl_usd
      FROM public.v_activity_feed
      WHERE user_id = ${userId}::uuid
        AND regime_tags IS NOT NULL
        AND array_length(regime_tags, 1) > 0
    )
    SELECT
      e.regime                                                  AS regime,
      count(*)::text                                            AS count,
      count(*) FILTER (
        WHERE e.net_pnl_usd IS NOT NULL AND e.net_pnl_usd > 0
      )::text                                                   AS win_count,
      count(*) FILTER (
        WHERE e.net_pnl_usd IS NOT NULL AND e.net_pnl_usd < 0
      )::text                                                   AS loss_count,
      count(*) FILTER (WHERE e.net_pnl_usd IS NOT NULL)::text   AS pnl_count,
      sum(e.net_pnl_usd) FILTER (WHERE e.net_pnl_usd > 0)::text AS gross_wins,
      sum(abs(e.net_pnl_usd)) FILTER (
        WHERE e.net_pnl_usd < 0
      )::text                                                   AS gross_losses,
      sum(e.net_pnl_usd) FILTER (
        WHERE e.net_pnl_usd IS NOT NULL
      )::text                                                   AS total_pnl,
      -- Population variance for Van Tharp's SQN convention.
      var_pop(e.net_pnl_usd) FILTER (
        WHERE e.net_pnl_usd IS NOT NULL
      )::text                                                   AS pnl_variance
    FROM exploded e
    GROUP BY e.regime
    ORDER BY count(*) DESC, e.regime ASC
  `;
  return rows.map((r) => {
    const count = Number(r.count);
    const pnlCount = Number(r.pnlCount);
    const winners = Number(r.winCount);
    const losers = Number(r.lossCount);
    const scoring = winners + losers;
    const grossWins = r.grossWins == null ? 0 : Number(r.grossWins);
    const grossLosses = r.grossLosses == null ? 0 : Number(r.grossLosses);
    const totalPnl = r.totalPnl == null ? 0 : Number(r.totalPnl);
    const variance = r.pnlVariance == null ? 0 : Number(r.pnlVariance);
    const stddev = Math.sqrt(Math.max(0, variance));
    const avgPnl = pnlCount > 0 ? totalPnl / pnlCount : 0;
    return {
      regime: r.regime,
      count,
      netPnl: totalPnl,
      winners,
      losers,
      winRate: scoring > 0 ? winners / scoring : 0,
      avgPnl,
      profitFactor: losers > 0 ? grossWins / grossLosses : null,
      sqn: pnlCount >= 2 && stddev > 0 ? (avgPnl / stddev) * Math.sqrt(pnlCount) : null,
    };
  });
}

/**
 * Count of activities the user has logged that carry no regime tag at all.
 * Surfaces on the regime page as a "bulk-tag these N activities" prompt.
 *
 * "No regime tag" means `regime_tags IS NULL OR cardinality(regime_tags) = 0`.
 * Closed status is NOT a filter — open spreads with no regime info are still
 * worth highlighting.
 */
export async function getUntaggedRegimeCount(userId: string): Promise<number> {
  const [row] = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count
    FROM public.v_activity_feed
    WHERE user_id = ${userId}::uuid
      AND (regime_tags IS NULL OR cardinality(regime_tags) = 0)
  `;
  return Number(row?.count ?? 0);
}

/**
 * Capital deployed by activity type — drives the activity-mix capital
 * allocation donut. Distinct from `getActivityTypeNetPnl` because capital
 * != P&L (airdrops have 0 capital, sales / spreads carry meaningful
 * principal).
 */
export async function getCapitalByActivityType(
  userId: string,
): Promise<ActivityTypeCounts> {
  const rows = await sql<{ type: ActivityType; capital: string | null }[]>`
    SELECT type, sum(coalesce(capital_deployed_usd, 0))::text AS capital
    FROM public.v_activity_feed
    WHERE user_id = ${userId}::uuid
    GROUP BY type
  `;
  const out: ActivityTypeCounts = {
    spread: 0, trade: 0, sale: 0, airdrop: 0, yield_position: 0, option: 0,
  };
  for (const r of rows) out[r.type] = Number(r.capital ?? 0);
  return out;
}

// ============================================================================
// Helpers
// ============================================================================

/** Numeric helper that round-trips through f64 — fine for derivation, not
 *  for storage. Storage values come back to/from Postgres as Decimal strings. */
function parseDec(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** Maps the wizard's display label (Title-cased) → exchange_catalog code. */
function mapExchangeLabelToCode(label: string): string {
  const map: Record<string, string> = {
    Binance: 'binance',
    Bybit: 'bybit',
    Hyperliquid: 'hyperliquid',
    Coinbase: 'kraken',  // Coinbase not in catalog; pick a CEX placeholder.
    OKX: 'okx',
    Other: 'binance',
  };
  return map[label] ?? 'binance';
}

function deriveTradeName(input: CreateTradeData): string {
  // "BTC long · perp" → matches /add/trade/fields' WizardField placeholder.
  const base = input.symbol.split(/[-/_]/)[0] || input.symbol;
  return `${base} ${input.side} · ${input.instrument}`;
}

function deriveSaleName(input: CreateSaleData): string {
  const kindLabel =
    input.saleKind === 'ido'
      ? 'IDO'
      : input.saleKind.charAt(0).toUpperCase() + input.saleKind.slice(1);
  return `${input.asset.toUpperCase()} — ${input.venue} ${kindLabel}`;
}

function deriveAirdropName(input: CreateAirdropData): string {
  return `${input.asset.toUpperCase()} · ${input.protocol} airdrop`;
}

/**
 * Compose a VestingSchedule jsonb shape per the canonical type.
 * Returns null when no schedule (TGE 100% with no cliff/duration → all_at_tge,
 * which we encode explicitly).
 */
function buildVestingSchedule(
  tgePct: number,
  cliffDays: number,
  linearDays: number,
):
  | { kind: 'all_at_tge' }
  | { kind: 'tge_plus_linear'; tge_pct: number; linear_days: number }
  | { kind: 'cliff_plus_linear'; cliff_days: number; linear_days: number; tge_pct?: number }
  | null {
  if (tgePct >= 100 && cliffDays === 0 && linearDays === 0) {
    return { kind: 'all_at_tge' };
  }
  if (cliffDays > 0) {
    return {
      kind: 'cliff_plus_linear',
      cliff_days: cliffDays,
      linear_days: linearDays,
      ...(tgePct > 0 ? { tge_pct: tgePct } : {}),
    };
  }
  return {
    kind: 'tge_plus_linear',
    tge_pct: tgePct,
    linear_days: linearDays,
  };
}
