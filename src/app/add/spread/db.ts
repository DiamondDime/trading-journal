/**
 * Wizard-local DB helpers for the SPREAD wizard.
 *
 * Lives next to the wizard rather than in `src/lib/db/activity.ts` so the
 * v2 spread create-path (which writes 9 open-intent columns + per-leg
 * intended_price + N spread_legs rows) doesn't bleed into the shared module
 * that the trade / sale / airdrop wizards depend on.
 *
 * Three exports:
 *   - createSpreadV2 — INSERT activity + activity_spread + N spread_legs in
 *                      one transaction. Returns the new activity id.
 *   - updateSpreadV2 — UPDATE activity + activity_spread (legs are not
 *                      mutable from the wizard in v1).
 *   - getSpreadForEdit — read the joined supertype + subtype for the
 *                        /fields edit pre-fill path.
 *   - listPickerOptions — UNION of (a) `spread_candidates WHERE state='pending'`
 *                          and (b) the user's open positions, shaped for the
 *                          picker UI. Replaces the IMPORTED_FILLS mock.
 *
 * All money / quantity fields stay as strings end-to-end per CLAUDE.md's
 * "Decimals as strings" rule.
 */
import { sql } from '@/lib/db/client';
import type {
  ActivityId,
  ActivityStatus,
  Decimal,
  SpreadType,
  SpreadVariant,
} from '@/types/canonical';

// ============================================================================
// Input shapes
// ============================================================================

/** Per-leg input — collected on /pick (selection) and refined on /fields. */
export interface SpreadLegInput {
  /** Existing position UUID (from spread_candidates.proposed_legs or
   *  positions table). Required: spread_legs FK to positions(id). */
  positionId: string;
  /** Leg role label — 'long' / 'short' for v1. Free text in the schema. */
  role: 'long' | 'short' | string;
  /** Trader-intended entry price as string decimal. Optional — used for
   *  realized slippage_bps vs avg_fill_price post-trade. */
  intendedPrice?: string | null;
}

/** Per-leg input for the manual-entry path (no linked position row). */
export interface ManualSpreadLegInput {
  symbol: string;
  exchangeLabel: string;
  side: 'long' | 'short';
  qty: string | null;
  entryPrice: string | null;
  exitPrice: string | null;
  feesUsd: string | null;
  instrumentType: 'spot' | 'perp' | 'dated_future' | string;
}

/** Common open-intent payload. All optional — gated by spread type in the UI. */
export interface SpreadOpenIntent {
  targetAprAtOpen?: string | null;        // decimal, e.g. "0.178" = 17.8%
  expectedHoldingDays?: number | null;
  expectedBasisConvergenceDate?: string | null; // YYYY-MM-DD
  exitPlan?: string | null;
  borrowCostAssumedBps?: string | null;
  closeThresholdApr?: string | null;
  closeThresholdPeriods?: number | null;
  maxGasBudgetUsd?: string | null;
  slippageToleranceBps?: string | null;
}

export interface CreateSpreadInput {
  // supertype
  name: string;
  status: ActivityStatus;
  openedAt: string | null; // ISO
  closedAt: string | null; // ISO (must be null on status='open')
  capitalDeployedUsd: string | null;
  realizedPnlUsd: string | null;
  feesUsd: string;
  netPnlUsd: string | null;
  regimeTags: string[];
  customTags: string[];
  strategyTag: string | null;
  // subtype (activity_spread)
  spreadType: SpreadType;
  variant: SpreadVariant | null;
  primaryBase: string;
  origin: 'auto_matched' | 'manual' | 'auto_confirmed';
  source: 'user' | 'system';
  legCount: number;
  openIntent: SpreadOpenIntent;
  // legs (zero or more — v1 keyboard-input flow can submit without positions)
  legs: SpreadLegInput[];
  // manual-entry legs (position_id = NULL in DB — requires 20260519100000 migration)
  manualLegs?: ManualSpreadLegInput[];
}

/** Per-leg patch shape used by update + edit-mode pre-fill. */
export interface UpdateSpreadInput {
  // supertype patches
  name?: string;
  status?: ActivityStatus;
  openedAt?: string | null;
  closedAt?: string | null;
  capitalDeployedUsd?: string | null;
  realizedPnlUsd?: string | null;
  feesUsd?: string;
  netPnlUsd?: string | null;
  regimeTags?: string[];
  customTags?: string[];
  strategyTag?: string | null;
  // subtype patches
  spreadType?: SpreadType;
  variant?: SpreadVariant | null;
  primaryBase?: string;
  legCount?: number;
  openIntent?: SpreadOpenIntent;
}

/** Read-back shape for the edit pre-fill path. */
export interface SpreadEditView {
  activityId: ActivityId;
  // supertype
  name: string;
  status: ActivityStatus;
  openedAt: string | null;
  closedAt: string | null;
  capitalDeployedUsd: Decimal | null;
  realizedPnlUsd: Decimal | null;
  feesUsd: Decimal;
  netPnlUsd: Decimal | null;
  regimeTags: string[];
  customTags: string[];
  strategyTag: string | null;
  // subtype
  spreadType: SpreadType;
  variant: SpreadVariant | null;
  primaryBase: string;
  legCount: number;
  // open-intent
  targetAprAtOpen: Decimal | null;
  expectedHoldingDays: number | null;
  expectedBasisConvergenceDate: string | null;
  exitPlan: string | null;
  borrowCostAssumedBps: Decimal | null;
  closeThresholdApr: Decimal | null;
  closeThresholdPeriods: number | null;
  maxGasBudgetUsd: Decimal | null;
  slippageToleranceBps: Decimal | null;
  // legs (read-only view of what's already wired)
  legs: SpreadLegReadRow[];
}

export interface SpreadLegReadRow {
  legIndex: number;
  positionId: string;
  role: string;
  intendedPrice: Decimal | null;
  // position context (for the legs table)
  instrument: string;
  exchangeCode: string;
  side: 'long' | 'short';
  qty: Decimal;
  avgEntryPrice: Decimal;
  avgExitPrice: Decimal | null;
}

/** Row shape consumed by the picker — one option per candidate or position. */
export interface PickerOptionRow {
  /** Stable id for selection. Format: `cand:<uuid>` or `pos:<uuid>` so we
   *  can disambiguate downstream. */
  id: string;
  /** What we actually round-trip into spread_legs.position_id. */
  positionId: string;
  source: 'candidate' | 'position';
  /** Display label — e.g. "BTC-PERP". */
  symbol: string;
  instrumentKind: 'spot' | 'perp' | 'dated_future' | 'option' | string;
  exchangeCode: string;
  side: 'long' | 'short';
  qty: Decimal;
  avgEntryPrice: Decimal;
  avgExitPrice: Decimal | null;
  openedAt: string;
  closedAt: string | null;
  status: 'open' | 'closed';
  /** Only set on rows derived from spread_candidates — surfaces the matcher's
   *  confidence so the picker can rank. */
  matchConfidence?: number | null;
  /** Candidate's suggested spread type — drives the type-step pre-select. */
  suggestedType?: string | null;
}

// ============================================================================
// Helpers
// ============================================================================

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validate variant is allowed for the chosen spread type. Mirrors
 *  chk_spread_variant in the DB so the wizard fails fast before the
 *  transaction. */
export function isValidVariantForType(
  spreadType: string,
  variant: string | null | undefined,
): boolean {
  if (variant === null || variant === undefined || variant === '') return true;
  if (spreadType === 'cash_carry')
    return variant === 'funding' || variant === 'basis';
  if (spreadType === 'funding_capture')
    return variant === 'same_venue' || variant === 'cross_venue';
  return false;
}

/** Date/status invariant mirroring chk_activity_dates. */
function validateDates(
  openedAt: string | null,
  closedAt: string | null,
  status: ActivityStatus,
): string | null {
  if (closedAt && openedAt && new Date(closedAt) < new Date(openedAt)) {
    return 'closed_at must be on or after opened_at';
  }
  if (status === 'closed' && (!openedAt || !closedAt)) {
    return 'closed status requires both opened_at and closed_at';
  }
  if (
    (status === 'open' || status === 'winding_down') &&
    closedAt !== null
  ) {
    return `status ${status} cannot have a closed_at`;
  }
  return null;
}

// ============================================================================
// createSpreadV2
// ============================================================================

/**
 * Insert a complete spread (supertype + subtype + N legs) in a single
 * transaction. Returns the new activity id.
 *
 * The DEFERRABLE activity_subtype_check trigger fires at COMMIT; both the
 * activity row and the activity_spread row land before that point so the
 * invariant is satisfied.
 *
 * Leg inserts gate on `legs.length > 0`. Manual flows that don't tie back to
 * real positions can pass `legs: []` — the row will read like the v1
 * shorthand "spread without leg breakdown" path until the worker materialises
 * positions and the user re-runs the matcher.
 */
export async function createSpreadV2(
  userId: string,
  input: CreateSpreadInput,
): Promise<{ id: string }> {
  // Pre-DB validation (cheap fail-fast before opening a transaction)
  const dateErr = validateDates(input.openedAt, input.closedAt, input.status);
  if (dateErr) throw new Error(dateErr);
  if (!isValidVariantForType(input.spreadType, input.variant)) {
    throw new Error(
      `variant "${input.variant}" is not valid for spread_type "${input.spreadType}"`,
    );
  }
  if (!input.name.trim()) throw new Error('Spread name is required');

  const activityId = await sql.begin(async (tx) => {
    const [activity] = await tx<{ id: string }[]>`
      INSERT INTO public.activity (
        user_id, type, status, name,
        opened_at, closed_at,
        capital_deployed_usd, realized_pnl_usd, fees_usd, net_pnl_usd,
        regime_tags, custom_tags, strategy_tag
      ) VALUES (
        ${userId}::uuid, 'spread', ${input.status}::activity_status,
        ${input.name},
        ${input.openedAt}::timestamptz, ${input.closedAt}::timestamptz,
        ${input.capitalDeployedUsd},
        ${input.realizedPnlUsd},
        ${input.feesUsd},
        ${input.netPnlUsd},
        ${input.regimeTags}::text[], ${input.customTags}::text[],
        ${input.strategyTag}
      )
      RETURNING id
    `;

    await tx`
      INSERT INTO public.activity_spread (
        activity_id, spread_type, variant, origin, source,
        primary_base, leg_count,
        target_apr_at_open, expected_holding_days,
        expected_basis_convergence_date, exit_plan,
        borrow_cost_assumed_bps,
        close_threshold_apr, close_threshold_periods,
        max_gas_budget_usd, slippage_tolerance_bps
      ) VALUES (
        ${activity.id}::uuid, ${input.spreadType}, ${input.variant},
        ${input.origin}, ${input.source},
        ${input.primaryBase}, ${input.legCount},
        ${input.openIntent.targetAprAtOpen ?? null},
        ${input.openIntent.expectedHoldingDays ?? null},
        ${input.openIntent.expectedBasisConvergenceDate ?? null}::date,
        ${input.openIntent.exitPlan ?? null},
        ${input.openIntent.borrowCostAssumedBps ?? null},
        ${input.openIntent.closeThresholdApr ?? null},
        ${input.openIntent.closeThresholdPeriods ?? null},
        ${input.openIntent.maxGasBudgetUsd ?? null},
        ${input.openIntent.slippageToleranceBps ?? null}
      )
    `;

    // Per-leg rows — position-linked path.
    // spread_legs.position_id FK to positions(id). Only lands when wizard
    // passes real position UUIDs (auto / picker path).
    for (let i = 0; i < input.legs.length; i++) {
      const leg = input.legs[i];
      if (!UUID_RE.test(leg.positionId)) continue;
      await tx`
        INSERT INTO public.spread_legs (
          activity_id, user_id, position_id, role, leg_index,
          intended_price, intended_price_set_at
        ) VALUES (
          ${activity.id}::uuid, ${userId}::uuid,
          ${leg.positionId}::uuid, ${leg.role}, ${i},
          ${leg.intendedPrice ?? null},
          ${leg.intendedPrice ? sql`now()` : null}
        )
      `;
    }

    // Manual-entry legs — no linked position row.
    // Requires migration 20260519100000 (position_id nullable + manual columns).
    for (let i = 0; i < (input.manualLegs?.length ?? 0); i++) {
      const leg = input.manualLegs![i];
      if (!leg.symbol?.trim()) continue; // skip incomplete rows
      await tx`
        INSERT INTO public.spread_legs (
          activity_id, user_id, leg_index, role,
          symbol, exchange_label, side, qty,
          entry_price, exit_price, fees_usd, instrument_type
        ) VALUES (
          ${activity.id}::uuid, ${userId}::uuid, ${i},
          ${leg.side},
          ${leg.symbol.trim()},
          ${leg.exchangeLabel?.trim() ?? null},
          ${leg.side},
          ${leg.qty ? Number(leg.qty) : null},
          ${leg.entryPrice ? Number(leg.entryPrice) : null},
          ${leg.exitPrice ? Number(leg.exitPrice) : null},
          ${leg.feesUsd ? Number(leg.feesUsd) : null},
          ${leg.instrumentType ?? null}
        )
      `;
    }

    return activity.id;
  });

  return { id: activityId };
}

// ============================================================================
// updateSpreadV2
// ============================================================================

/**
 * Patch a spread's supertype + subtype rows. Legs are not touched by the
 * wizard's edit flow — the user can change them only via the picker re-entry
 * path (which deletes the activity and recreates it).
 */
export async function updateSpreadV2(
  userId: string,
  activityId: string,
  patch: UpdateSpreadInput,
): Promise<boolean> {
  if (!UUID_RE.test(activityId)) return false;
  if (
    patch.spreadType !== undefined &&
    patch.variant !== undefined &&
    !isValidVariantForType(patch.spreadType, patch.variant)
  ) {
    throw new Error(
      `variant "${patch.variant}" is not valid for spread_type "${patch.spreadType}"`,
    );
  }
  if (
    patch.openedAt !== undefined &&
    patch.closedAt !== undefined &&
    patch.status !== undefined
  ) {
    const dateErr = validateDates(patch.openedAt, patch.closedAt, patch.status);
    if (dateErr) throw new Error(dateErr);
  }

  return sql.begin(async (tx) => {
    // 1. Supertype patch (and ownership gate)
    const parentPatches: Record<string, unknown> = {};
    if (patch.name !== undefined) parentPatches.name = patch.name;
    if (patch.status !== undefined) parentPatches.status = patch.status;
    if (patch.openedAt !== undefined) parentPatches.opened_at = patch.openedAt;
    if (patch.closedAt !== undefined) parentPatches.closed_at = patch.closedAt;
    if (patch.capitalDeployedUsd !== undefined)
      parentPatches.capital_deployed_usd = patch.capitalDeployedUsd;
    if (patch.realizedPnlUsd !== undefined)
      parentPatches.realized_pnl_usd = patch.realizedPnlUsd;
    if (patch.feesUsd !== undefined) parentPatches.fees_usd = patch.feesUsd;
    if (patch.netPnlUsd !== undefined) parentPatches.net_pnl_usd = patch.netPnlUsd;
    if (patch.regimeTags !== undefined) parentPatches.regime_tags = patch.regimeTags;
    if (patch.customTags !== undefined) parentPatches.custom_tags = patch.customTags;
    if (patch.strategyTag !== undefined)
      parentPatches.strategy_tag = patch.strategyTag;

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

    // 2. Subtype patch
    const subPatches: Record<string, unknown> = {};
    if (patch.spreadType !== undefined) subPatches.spread_type = patch.spreadType;
    if (patch.variant !== undefined) subPatches.variant = patch.variant;
    if (patch.primaryBase !== undefined) subPatches.primary_base = patch.primaryBase;
    if (patch.legCount !== undefined) subPatches.leg_count = patch.legCount;
    if (patch.openIntent !== undefined) {
      const oi = patch.openIntent;
      if (oi.targetAprAtOpen !== undefined)
        subPatches.target_apr_at_open = oi.targetAprAtOpen;
      if (oi.expectedHoldingDays !== undefined)
        subPatches.expected_holding_days = oi.expectedHoldingDays;
      if (oi.expectedBasisConvergenceDate !== undefined)
        subPatches.expected_basis_convergence_date = oi.expectedBasisConvergenceDate;
      if (oi.exitPlan !== undefined) subPatches.exit_plan = oi.exitPlan;
      if (oi.borrowCostAssumedBps !== undefined)
        subPatches.borrow_cost_assumed_bps = oi.borrowCostAssumedBps;
      if (oi.closeThresholdApr !== undefined)
        subPatches.close_threshold_apr = oi.closeThresholdApr;
      if (oi.closeThresholdPeriods !== undefined)
        subPatches.close_threshold_periods = oi.closeThresholdPeriods;
      if (oi.maxGasBudgetUsd !== undefined)
        subPatches.max_gas_budget_usd = oi.maxGasBudgetUsd;
      if (oi.slippageToleranceBps !== undefined)
        subPatches.slippage_tolerance_bps = oi.slippageToleranceBps;
    }

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

// ============================================================================
// getSpreadForEdit
// ============================================================================

/** Read the joined supertype + subtype + legs for the /fields edit pre-fill. */
export async function getSpreadForEdit(
  userId: string,
  activityId: string,
): Promise<SpreadEditView | null> {
  if (!UUID_RE.test(activityId)) return null;

  const rows = await sql<
    {
      activityId: string;
      name: string;
      status: ActivityStatus;
      openedAt: string | null;
      closedAt: string | null;
      capitalDeployedUsd: string | null;
      realizedPnlUsd: string | null;
      feesUsd: string;
      netPnlUsd: string | null;
      regimeTags: string[];
      customTags: string[];
      strategyTag: string | null;
      spreadType: SpreadType;
      variant: SpreadVariant | null;
      primaryBase: string;
      legCount: number;
      targetAprAtOpen: string | null;
      expectedHoldingDays: number | null;
      expectedBasisConvergenceDate: string | null;
      exitPlan: string | null;
      borrowCostAssumedBps: string | null;
      closeThresholdApr: string | null;
      closeThresholdPeriods: number | null;
      maxGasBudgetUsd: string | null;
      slippageToleranceBps: string | null;
    }[]
  >`
    SELECT
      a.id                                   AS activity_id,
      a.name,
      a.status,
      a.opened_at,
      a.closed_at,
      a.capital_deployed_usd,
      a.realized_pnl_usd,
      a.fees_usd,
      a.net_pnl_usd,
      a.regime_tags,
      a.custom_tags,
      a.strategy_tag,
      s.spread_type,
      s.variant,
      s.primary_base,
      s.leg_count,
      s.target_apr_at_open,
      s.expected_holding_days,
      s.expected_basis_convergence_date,
      s.exit_plan,
      s.borrow_cost_assumed_bps,
      s.close_threshold_apr,
      s.close_threshold_periods,
      s.max_gas_budget_usd,
      s.slippage_tolerance_bps
    FROM public.activity a
    JOIN public.activity_spread s ON s.activity_id = a.id
    WHERE a.id = ${activityId}::uuid
      AND a.user_id = ${userId}::uuid
      AND a.deleted_at IS NULL
      AND a.type = 'spread'
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const r = rows[0];

  const legs = await sql<SpreadLegReadRow[]>`
    SELECT
      sl.leg_index,
      sl.position_id,
      sl.role,
      sl.intended_price,
      p.instrument,
      p.exchange_connection_id::text AS exchange_code, -- placeholder; UI maps via /api/exchanges
      p.side,
      p.total_qty       AS qty,
      p.avg_entry_price,
      p.avg_exit_price
    FROM public.spread_legs sl
    JOIN public.positions p ON p.id = sl.position_id
    WHERE sl.activity_id = ${activityId}::uuid
    ORDER BY sl.leg_index ASC
  `;

  return {
    activityId: r.activityId as ActivityId,
    name: r.name,
    status: r.status,
    openedAt: r.openedAt,
    closedAt: r.closedAt,
    capitalDeployedUsd: r.capitalDeployedUsd,
    realizedPnlUsd: r.realizedPnlUsd,
    feesUsd: r.feesUsd,
    netPnlUsd: r.netPnlUsd,
    regimeTags: r.regimeTags,
    customTags: r.customTags,
    strategyTag: r.strategyTag,
    spreadType: r.spreadType,
    variant: r.variant,
    primaryBase: r.primaryBase,
    legCount: r.legCount,
    targetAprAtOpen: r.targetAprAtOpen,
    expectedHoldingDays: r.expectedHoldingDays,
    expectedBasisConvergenceDate: r.expectedBasisConvergenceDate,
    exitPlan: r.exitPlan,
    borrowCostAssumedBps: r.borrowCostAssumedBps,
    closeThresholdApr: r.closeThresholdApr,
    closeThresholdPeriods: r.closeThresholdPeriods,
    maxGasBudgetUsd: r.maxGasBudgetUsd,
    slippageToleranceBps: r.slippageToleranceBps,
    legs,
  };
}

// ============================================================================
// listPickerOptions
// ============================================================================

/**
 * Build the picker's row list — union of (a) pending spread_candidates +
 * (b) open positions not yet pinned to any spread. The picker UI flattens
 * candidates into per-position rows the user can tick.
 *
 * `spread_candidates.proposed_legs` is JSONB with shape
 *   `{ legs: [{ position_ids: string[], side: 'long'|'short', role: string }] }`
 * — we explode it client-side rather than relying on a SQL function to keep
 * the picker path independent of the matcher's storage format.
 */
export async function listPickerOptions(
  userId: string,
): Promise<{
  candidateLegs: PickerOptionRow[];
  openPositions: PickerOptionRow[];
}> {
  // (a) Pending candidates with proposed_legs JSON to fan out into rows.
  const candidates = await sql<
    {
      id: string;
      matchConfidence: number;
      suggestedType: string;
      proposedLegs: { legs?: Array<{ position_ids?: string[]; side?: string; role?: string }> };
    }[]
  >`
    SELECT id, match_confidence, suggested_type, proposed_legs
    FROM public.spread_candidates
    WHERE user_id = ${userId}::uuid
      AND state = 'pending'
    ORDER BY match_confidence DESC
    LIMIT 50
  `;

  // Collect every position_id referenced by candidates so we can join in
  // one round-trip rather than N.
  const candidatePositionIds = new Set<string>();
  for (const c of candidates) {
    for (const leg of c.proposedLegs?.legs ?? []) {
      for (const pid of leg.position_ids ?? []) candidatePositionIds.add(pid);
    }
  }

  // (b) Open positions not already claimed by any spread.
  const positions = await sql<
    {
      id: string;
      instrument: string;
      instrumentType: string;
      side: 'long' | 'short';
      totalQty: string;
      avgEntryPrice: string;
      avgExitPrice: string | null;
      openedAt: string;
      closedAt: string | null;
      status: 'open' | 'closed';
      exchangeCode: string;
    }[]
  >`
    SELECT
      p.id,
      p.instrument,
      p.instrument_type,
      p.side,
      p.total_qty,
      p.avg_entry_price,
      p.avg_exit_price,
      p.opened_at,
      p.closed_at,
      p.status,
      ec.exchange_code
    FROM public.positions p
    JOIN public.exchange_connections ec ON ec.id = p.exchange_connection_id
    WHERE p.user_id = ${userId}::uuid
      AND p.deleted_at IS NULL
      AND p.status = 'open'
      AND NOT EXISTS (
        SELECT 1 FROM public.spread_legs sl
        WHERE sl.position_id = p.id
      )
    ORDER BY p.opened_at DESC
    LIMIT 100
  `;

  // Look up the candidate positions in a single round-trip (only fires if
  // there are candidates at all).
  const candidatePosRows = candidatePositionIds.size > 0
    ? await sql<
        {
          id: string;
          instrument: string;
          instrumentType: string;
          side: 'long' | 'short';
          totalQty: string;
          avgEntryPrice: string;
          avgExitPrice: string | null;
          openedAt: string;
          closedAt: string | null;
          status: 'open' | 'closed';
          exchangeCode: string;
        }[]
      >`
        SELECT
          p.id,
          p.instrument,
          p.instrument_type,
          p.side,
          p.total_qty,
          p.avg_entry_price,
          p.avg_exit_price,
          p.opened_at,
          p.closed_at,
          p.status,
          ec.exchange_code
        FROM public.positions p
        JOIN public.exchange_connections ec ON ec.id = p.exchange_connection_id
        WHERE p.id = ANY(${[...candidatePositionIds]}::uuid[])
          AND p.user_id = ${userId}::uuid
          AND p.deleted_at IS NULL
      `
    : [];

  const posById = new Map(candidatePosRows.map((p) => [p.id, p]));

  const candidateLegs: PickerOptionRow[] = [];
  for (const c of candidates) {
    for (const leg of c.proposedLegs?.legs ?? []) {
      for (const pid of leg.position_ids ?? []) {
        const p = posById.get(pid);
        if (!p) continue;
        candidateLegs.push({
          id: `cand:${c.id}:${pid}`,
          positionId: pid,
          source: 'candidate',
          symbol: p.instrument,
          instrumentKind: p.instrumentType,
          exchangeCode: p.exchangeCode,
          side: p.side,
          qty: p.totalQty,
          avgEntryPrice: p.avgEntryPrice,
          avgExitPrice: p.avgExitPrice,
          openedAt: p.openedAt,
          closedAt: p.closedAt,
          status: p.status,
          matchConfidence: c.matchConfidence,
          suggestedType: c.suggestedType,
        });
      }
    }
  }

  const openPositions: PickerOptionRow[] = positions.map((p) => ({
    id: `pos:${p.id}`,
    positionId: p.id,
    source: 'position',
    symbol: p.instrument,
    instrumentKind: p.instrumentType,
    exchangeCode: p.exchangeCode,
    side: p.side,
    qty: p.totalQty,
    avgEntryPrice: p.avgEntryPrice,
    avgExitPrice: p.avgExitPrice,
    openedAt: p.openedAt,
    closedAt: p.closedAt,
    status: p.status,
  }));

  return { candidateLegs, openPositions };
}

/** Fetch a single PickerOptionRow by `positionId`. Used by /fields + /review
 *  to render the leg table from the URL-encoded selection. */
export async function getPickerOptionsByPositionIds(
  userId: string,
  positionIds: string[],
): Promise<PickerOptionRow[]> {
  const valid = positionIds.filter((id) => UUID_RE.test(id));
  if (valid.length === 0) return [];

  const rows = await sql<
    {
      id: string;
      instrument: string;
      instrumentType: string;
      side: 'long' | 'short';
      totalQty: string;
      avgEntryPrice: string;
      avgExitPrice: string | null;
      openedAt: string;
      closedAt: string | null;
      status: 'open' | 'closed';
      exchangeCode: string;
    }[]
  >`
    SELECT
      p.id,
      p.instrument,
      p.instrument_type,
      p.side,
      p.total_qty,
      p.avg_entry_price,
      p.avg_exit_price,
      p.opened_at,
      p.closed_at,
      p.status,
      ec.exchange_code
    FROM public.positions p
    JOIN public.exchange_connections ec ON ec.id = p.exchange_connection_id
    WHERE p.id = ANY(${valid}::uuid[])
      AND p.user_id = ${userId}::uuid
      AND p.deleted_at IS NULL
  `;
  return rows.map((p) => ({
    id: `pos:${p.id}`,
    positionId: p.id,
    source: 'position' as const,
    symbol: p.instrument,
    instrumentKind: p.instrumentType,
    exchangeCode: p.exchangeCode,
    side: p.side,
    qty: p.totalQty,
    avgEntryPrice: p.avgEntryPrice,
    avgExitPrice: p.avgExitPrice,
    openedAt: p.openedAt,
    closedAt: p.closedAt,
    status: p.status,
  }));
}

/** Autocomplete source for the strategy-tag field. Returns the distinct
 *  strategy_tag values the user has previously typed, most recent first. */
export async function getStrategyTagSuggestions(
  userId: string,
  limit = 20,
): Promise<string[]> {
  const rows = await sql<{ strategyTag: string }[]>`
    SELECT DISTINCT ON (strategy_tag) strategy_tag
    FROM public.activity
    WHERE user_id = ${userId}::uuid
      AND deleted_at IS NULL
      AND strategy_tag IS NOT NULL
      AND strategy_tag <> ''
    ORDER BY strategy_tag, created_at DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => r.strategyTag);
}
