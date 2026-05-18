/**
 * Option wizard DB helpers (Wave 2F).
 *
 * Three transactional writes:
 *   - createOption: inserts activity + activity_option + N activity_option_leg
 *   - updateOption: rewrites activity_option header + replaces legs (delete + reinsert)
 *   - recordOptionClose: marks all legs closed at per-leg exit premiums and lands
 *                        a status of 'closed' or 'expired' depending on close_reason
 *
 * Plus one read helper:
 *   - getOptionForEdit: returns the activity row + the option header + every leg
 *
 * Kept out of `src/lib/db/activity.ts` per the agent scope ("Do NOT touch
 * shared files"). Mirrors the transactional pattern of createSale / createTrade
 * exactly: one sql.begin() block, supertype first, subtype second, leaf rows
 * last. Deferred subtype-existence trigger validates at COMMIT.
 *
 * All amounts come in as Zod-validated decimal strings; we keep them as
 * strings through the round-trip and only coerce to f64 where the math is
 * derivation (net premium, days-held).
 */
import 'server-only';
import { sql } from '@/lib/db/client';
import type { CreateOptionData, OptionLegData } from '@/lib/db/zod-schemas';
import type {
  ActivityId,
  ActivityStatus,
  Decimal,
  Exchange,
  Iso8601,
  OptionCpKind,
  OptionSide,
  OptionSpreadStyle,
  OptionSubtypeKind,
} from '@/types/canonical';

// ============================================================================
// Row types
// ============================================================================

export interface OptionEditActivityRow {
  id: ActivityId;
  userId: string;
  status: ActivityStatus;
  name: string;
  openedAt: Iso8601 | null;
  closedAt: Iso8601 | null;
  regimeTags: string[];
  customTags: string[];
  capitalDeployedUsd: Decimal | null;
  realizedPnlUsd: Decimal | null;
  feesUsd: Decimal;
  netPnlUsd: Decimal | null;
  taxTaxable: boolean;
  taxJurisdiction: string | null;
  strategyTag: string | null;
}

export interface OptionEditHeaderRow {
  activityId: ActivityId;
  subtype: OptionSubtypeKind;
  spreadStyle: OptionSpreadStyle | null;
  underlying: string;
  exchange: Exchange;
  totalPremiumUsd: Decimal;
  netPremiumUsd: Decimal | null;
  realizedPnlUsd: Decimal | null;
  maxProfitUsd: Decimal | null;
  maxLossUsd: Decimal | null;
  breakevenLower: Decimal | null;
  breakevenUpper: Decimal | null;
  ivAtOpen: Decimal | null;
  entryThesis: string | null;
  exitPlan: string | null;
  targetPrice: Decimal | null;
  stopPrice: Decimal | null;
}

export interface OptionEditLegRow {
  id: string;
  activityId: ActivityId;
  legIndex: number;
  exchange: Exchange;
  underlying: string;
  expiry: Iso8601;
  strike: Decimal;
  optionKind: OptionCpKind;
  side: OptionSide;
  contracts: Decimal;
  premiumPerContract: Decimal;
  premiumTotalUsd: Decimal | null;
  iv: Decimal | null;
  delta: Decimal | null;
  gamma: Decimal | null;
  theta: Decimal | null;
  vega: Decimal | null;
  rho: Decimal | null;
  filledAt: Iso8601 | null;
  closedAt: Iso8601 | null;
  closePremiumPerContract: Decimal | null;
  feesUsd: Decimal;
}

export interface OptionForEdit {
  activity: OptionEditActivityRow;
  option: OptionEditHeaderRow;
  legs: OptionEditLegRow[];
}

// ============================================================================
// Helpers
// ============================================================================

/** Round-trip a decimal string through f64. Fine for derivation; storage
 *  values stay as canonical strings. */
function parseDec(s: string | null | undefined): number {
  if (s === null || s === undefined || s === '') return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Aggregate header metrics over the leg array. Net premium signs from the
 * long/short side; sum of |premium| is total. Max profit / max loss come from
 * the wizard if the user typed them, else null.
 */
function aggregateLegEconomics(legs: OptionLegData[]): {
  totalPremiumUsd: number;
  netPremiumUsd: number;
} {
  let total = 0;
  let net = 0;
  for (const leg of legs) {
    const premium = parseDec(leg.premium_per_contract);
    const contracts = parseDec(leg.contracts);
    const legNotional = premium * contracts;
    total += Math.abs(legNotional);
    // long pays premium (positive cost), short collects premium (negative cost)
    const sign = leg.side === 'long' ? 1 : -1;
    net += sign * legNotional;
  }
  return { totalPremiumUsd: total, netPremiumUsd: net };
}

/** Derive a readable name when the trader didn't supply one. */
function deriveOptionName(input: CreateOptionData): string {
  const styleLabel =
    input.subtype === 'option_spread' && input.spread_style
      ? input.spread_style.replace(/_/g, ' ')
      : 'single leg';
  return `${input.underlying.toUpperCase()} ${styleLabel}`;
}

/**
 * Status policy:
 *   - 'closed' once status is closed
 *   - 'expired' once every leg's expiry is in the past (worker may flip this later)
 *   - 'open' otherwise (default)
 *
 * `unwinding` is a user-set value (the wizard's status field allows it).
 */
function deriveStatus(
  requested: ActivityStatus,
  legs: OptionLegData[],
): ActivityStatus {
  if (requested === 'closed' || requested === 'unwinding') return requested;
  const now = Date.now();
  const allExpired = legs.every((l) => {
    const t = new Date(l.expiry).getTime();
    return Number.isFinite(t) && t < now;
  });
  if (allExpired) return 'expired';
  return 'open';
}

// ============================================================================
// createOption
// ============================================================================

export async function createOption(
  userId: string,
  input: CreateOptionData,
): Promise<{ id: string }> {
  const openedIso = new Date(input.opened_at).toISOString();
  const closedIso = input.closed_at
    ? new Date(input.closed_at).toISOString()
    : null;
  const { totalPremiumUsd, netPremiumUsd } = aggregateLegEconomics(input.legs);

  const status = deriveStatus(input.status, input.legs);
  const name = input.name ?? deriveOptionName(input);

  // Capital deployed = absolute net premium when the trader pays it (long
  // strategies). When net is negative (credit), capital deployed is the worst-
  // case max loss the trader typed (so the dashboard's net-pnl-on-capital
  // headline stays meaningful). max_loss_usd is positive in our schema.
  const maxLossTyped = parseDec(input.max_loss_usd ?? '0');
  const capitalDeployed =
    netPremiumUsd > 0 ? netPremiumUsd : Math.max(maxLossTyped, 0);

  // realized_pnl_usd is computed by the worker once legs close. At journal
  // time we leave it NULL; the v_activity_feed view uses ao.realized_pnl_usd
  // as the option headline value.
  const totalFeesUsd = input.legs.reduce(
    (acc, l) => acc + parseDec(l.fees_usd ?? '0'),
    0,
  );

  const activityId = await sql.begin(async (tx) => {
    // 1. activity supertype.
    const [activity] = await tx<{ id: string }[]>`
      INSERT INTO public.activity (
        user_id, type, status, name,
        opened_at, closed_at,
        capital_deployed_usd, realized_pnl_usd, fees_usd, net_pnl_usd,
        regime_tags, custom_tags,
        tax_taxable, tax_jurisdiction, strategy_tag
      ) VALUES (
        ${userId}::uuid, 'option', ${status}::activity_status,
        ${name},
        ${openedIso}::timestamptz,
        ${closedIso ? sql`${closedIso}::timestamptz` : null},
        ${capitalDeployed.toString()}, ${null},
        ${totalFeesUsd.toString()}, ${null},
        ${input.regime_tags as string[]}, ${input.custom_tags as string[]},
        ${input.tax_taxable}, ${input.tax_jurisdiction ?? null},
        ${input.strategy_tag ?? null}
      )
      RETURNING id
    `;

    // 2. activity_option header.
    await tx`
      INSERT INTO public.activity_option (
        activity_id, subtype, spread_style,
        underlying, exchange,
        total_premium_usd, net_premium_usd,
        max_profit_usd, max_loss_usd,
        breakeven_lower, breakeven_upper,
        iv_at_open,
        entry_thesis, exit_plan, target_price, stop_price
      ) VALUES (
        ${activity.id}::uuid,
        ${input.subtype}::option_subtype_kind,
        ${input.spread_style ?? null},
        ${input.underlying.toUpperCase()}, ${input.exchange},
        ${totalPremiumUsd.toString()}, ${netPremiumUsd.toString()},
        ${input.max_profit_usd ?? null},
        ${input.max_loss_usd ?? null},
        ${input.breakeven_lower ?? null},
        ${input.breakeven_upper ?? null},
        ${input.iv_at_open?.toString() ?? null},
        ${input.entry_thesis ?? null},
        ${input.exit_plan ?? null},
        ${input.target_price ?? null},
        ${input.stop_price ?? null}
      )
    `;

    // 3. legs, ordered by leg_index ascending.
    const sorted = [...input.legs].sort((a, b) => a.leg_index - b.leg_index);
    for (let i = 0; i < sorted.length; i++) {
      const leg = sorted[i];
      const expiryDate = leg.expiry; // YYYY-MM-DD
      const premiumPer = parseDec(leg.premium_per_contract);
      const contracts = parseDec(leg.contracts);
      const premiumTotal = premiumPer * contracts;
      await tx`
        INSERT INTO public.activity_option_leg (
          activity_id, leg_index,
          exchange, underlying, expiry, strike,
          option_kind, side,
          contracts, premium_per_contract, premium_total_usd,
          iv, delta, gamma, theta, vega, rho,
          filled_at, fees_usd
        ) VALUES (
          ${activity.id}::uuid, ${i},
          ${leg.exchange}, ${leg.underlying.toUpperCase()},
          ${expiryDate}::date, ${leg.strike},
          ${leg.option_kind}::option_cp, ${leg.side}::option_side,
          ${leg.contracts}, ${leg.premium_per_contract},
          ${(leg.premium_total_usd ?? premiumTotal).toString()},
          ${leg.iv?.toString() ?? null},
          ${leg.delta?.toString() ?? null},
          ${leg.gamma?.toString() ?? null},
          ${leg.theta?.toString() ?? null},
          ${leg.vega?.toString() ?? null},
          ${leg.rho?.toString() ?? null},
          ${leg.filled_at ? sql`${new Date(leg.filled_at).toISOString()}::timestamptz` : null},
          ${(leg.fees_usd ?? '0').toString()}
        )
      `;
    }

    return activity.id;
  });

  return { id: activityId };
}

// ============================================================================
// updateOption — rewrites header + replaces legs atomically
// ============================================================================

export async function updateOption(
  userId: string,
  activityId: string,
  input: CreateOptionData,
): Promise<boolean> {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(activityId)) return false;

  const openedIso = new Date(input.opened_at).toISOString();
  const closedIso = input.closed_at
    ? new Date(input.closed_at).toISOString()
    : null;
  const { totalPremiumUsd, netPremiumUsd } = aggregateLegEconomics(input.legs);
  const status = deriveStatus(input.status, input.legs);
  const name = input.name ?? deriveOptionName(input);

  const maxLossTyped = parseDec(input.max_loss_usd ?? '0');
  const capitalDeployed =
    netPremiumUsd > 0 ? netPremiumUsd : Math.max(maxLossTyped, 0);
  const totalFeesUsd = input.legs.reduce(
    (acc, l) => acc + parseDec(l.fees_usd ?? '0'),
    0,
  );

  try {
    await sql.begin(async (tx) => {
      const updated = await tx<{ id: string }[]>`
        UPDATE public.activity
        SET
          status = ${status}::activity_status,
          name = ${name},
          opened_at = ${openedIso}::timestamptz,
          closed_at = ${closedIso ? sql`${closedIso}::timestamptz` : null},
          capital_deployed_usd = ${capitalDeployed.toString()},
          fees_usd = ${totalFeesUsd.toString()},
          regime_tags = ${input.regime_tags as string[]},
          custom_tags = ${input.custom_tags as string[]},
          tax_taxable = ${input.tax_taxable},
          tax_jurisdiction = ${input.tax_jurisdiction ?? null},
          strategy_tag = ${input.strategy_tag ?? null}
        WHERE id = ${activityId}::uuid
          AND user_id = ${userId}::uuid
          AND deleted_at IS NULL
          AND type = 'option'
        RETURNING id
      `;
      if (updated.length === 0) throw new Error('not_found');

      await tx`
        UPDATE public.activity_option
        SET
          subtype = ${input.subtype}::option_subtype_kind,
          spread_style = ${input.spread_style ?? null},
          underlying = ${input.underlying.toUpperCase()},
          exchange = ${input.exchange},
          total_premium_usd = ${totalPremiumUsd.toString()},
          net_premium_usd = ${netPremiumUsd.toString()},
          max_profit_usd = ${input.max_profit_usd ?? null},
          max_loss_usd = ${input.max_loss_usd ?? null},
          breakeven_lower = ${input.breakeven_lower ?? null},
          breakeven_upper = ${input.breakeven_upper ?? null},
          iv_at_open = ${input.iv_at_open?.toString() ?? null},
          entry_thesis = ${input.entry_thesis ?? null},
          exit_plan = ${input.exit_plan ?? null},
          target_price = ${input.target_price ?? null},
          stop_price = ${input.stop_price ?? null}
        WHERE activity_id = ${activityId}::uuid
      `;

      // Replace legs wholesale — simpler than diffing and the leg_index
      // unique constraint makes per-row UPSERT clumsy when the user removed
      // a row from the middle of the array.
      await tx`
        DELETE FROM public.activity_option_leg
        WHERE activity_id = ${activityId}::uuid
      `;
      const sorted = [...input.legs].sort((a, b) => a.leg_index - b.leg_index);
      for (let i = 0; i < sorted.length; i++) {
        const leg = sorted[i];
        const premiumPer = parseDec(leg.premium_per_contract);
        const contracts = parseDec(leg.contracts);
        const premiumTotal = premiumPer * contracts;
        await tx`
          INSERT INTO public.activity_option_leg (
            activity_id, leg_index,
            exchange, underlying, expiry, strike,
            option_kind, side,
            contracts, premium_per_contract, premium_total_usd,
            iv, delta, gamma, theta, vega, rho,
            filled_at, fees_usd
          ) VALUES (
            ${activityId}::uuid, ${i},
            ${leg.exchange}, ${leg.underlying.toUpperCase()},
            ${leg.expiry}::date, ${leg.strike},
            ${leg.option_kind}::option_cp, ${leg.side}::option_side,
            ${leg.contracts}, ${leg.premium_per_contract},
            ${(leg.premium_total_usd ?? premiumTotal).toString()},
            ${leg.iv?.toString() ?? null},
            ${leg.delta?.toString() ?? null},
            ${leg.gamma?.toString() ?? null},
            ${leg.theta?.toString() ?? null},
            ${leg.vega?.toString() ?? null},
            ${leg.rho?.toString() ?? null},
            ${leg.filled_at ? sql`${new Date(leg.filled_at).toISOString()}::timestamptz` : null},
            ${(leg.fees_usd ?? '0').toString()}
          )
        `;
      }
    });
    return true;
  } catch (e) {
    if (e instanceof Error && e.message === 'not_found') return false;
    throw e;
  }
}

// ============================================================================
// getOptionForEdit — supertype + header + legs
// ============================================================================

export async function getOptionForEdit(
  userId: string,
  activityId: string,
): Promise<OptionForEdit | null> {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(activityId)) return null;

  const activityRows = await sql<OptionEditActivityRow[]>`
    SELECT
      id, user_id AS "userId", status, name,
      opened_at AS "openedAt", closed_at AS "closedAt",
      regime_tags AS "regimeTags", custom_tags AS "customTags",
      capital_deployed_usd AS "capitalDeployedUsd",
      realized_pnl_usd AS "realizedPnlUsd",
      fees_usd AS "feesUsd",
      net_pnl_usd AS "netPnlUsd",
      tax_taxable AS "taxTaxable",
      tax_jurisdiction AS "taxJurisdiction",
      strategy_tag AS "strategyTag"
    FROM public.activity
    WHERE id = ${activityId}::uuid
      AND user_id = ${userId}::uuid
      AND type = 'option'
      AND deleted_at IS NULL
    LIMIT 1
  `;
  if (activityRows.length === 0) return null;

  const optionRows = await sql<OptionEditHeaderRow[]>`
    SELECT
      activity_id AS "activityId",
      subtype, spread_style AS "spreadStyle",
      underlying, exchange,
      total_premium_usd AS "totalPremiumUsd",
      net_premium_usd AS "netPremiumUsd",
      realized_pnl_usd AS "realizedPnlUsd",
      max_profit_usd AS "maxProfitUsd",
      max_loss_usd AS "maxLossUsd",
      breakeven_lower AS "breakevenLower",
      breakeven_upper AS "breakevenUpper",
      iv_at_open AS "ivAtOpen",
      entry_thesis AS "entryThesis",
      exit_plan AS "exitPlan",
      target_price AS "targetPrice",
      stop_price AS "stopPrice"
    FROM public.activity_option
    WHERE activity_id = ${activityId}::uuid
    LIMIT 1
  `;
  if (optionRows.length === 0) return null;

  const legRows = await sql<OptionEditLegRow[]>`
    SELECT
      id, activity_id AS "activityId",
      leg_index AS "legIndex",
      exchange, underlying,
      expiry, strike,
      option_kind AS "optionKind", side,
      contracts,
      premium_per_contract AS "premiumPerContract",
      premium_total_usd AS "premiumTotalUsd",
      iv, delta, gamma, theta, vega, rho,
      filled_at AS "filledAt",
      closed_at AS "closedAt",
      close_premium_per_contract AS "closePremiumPerContract",
      fees_usd AS "feesUsd"
    FROM public.activity_option_leg
    WHERE activity_id = ${activityId}::uuid
    ORDER BY leg_index ASC
  `;

  return {
    activity: activityRows[0],
    option: optionRows[0],
    legs: legRows,
  };
}

// ============================================================================
// recordOptionClose — close out a position with per-leg exit premiums
// ============================================================================

export type OptionCloseReason =
  | 'expired_worthless'
  | 'closed_early'
  | 'assigned'
  | 'exercised';

export interface OptionExitPremium {
  legIndex: number;
  /** Per-contract exit premium. Empty/missing = no exit premium (e.g. expired
   *  worthless). */
  closePremiumPerContract?: string;
}

export async function recordOptionClose(
  userId: string,
  activityId: string,
  exitPremiums: OptionExitPremium[],
  closeReason: OptionCloseReason,
): Promise<boolean> {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(activityId)) return false;

  // Status policy:
  //   expired_worthless / exercised → 'expired'
  //   closed_early / assigned       → 'closed'
  const finalStatus: ActivityStatus =
    closeReason === 'expired_worthless' || closeReason === 'exercised'
      ? 'expired'
      : 'closed';
  const nowIso = new Date().toISOString();

  try {
    await sql.begin(async (tx) => {
      // Ownership check first.
      const owner = await tx<{ id: string }[]>`
        SELECT id FROM public.activity
        WHERE id = ${activityId}::uuid
          AND user_id = ${userId}::uuid
          AND type = 'option'
          AND deleted_at IS NULL
        LIMIT 1
      `;
      if (owner.length === 0) throw new Error('not_found');

      // Load legs for the realized-pnl calculation.
      const legs = await tx<{
        legIndex: number;
        side: OptionSide;
        contracts: Decimal;
        premiumPerContract: Decimal;
        feesUsd: Decimal;
      }[]>`
        SELECT
          leg_index AS "legIndex", side,
          contracts,
          premium_per_contract AS "premiumPerContract",
          fees_usd AS "feesUsd"
        FROM public.activity_option_leg
        WHERE activity_id = ${activityId}::uuid
        ORDER BY leg_index ASC
      `;

      // Build a quick lookup from the user-provided exit premiums.
      const exitMap = new Map<number, string | undefined>();
      for (const ep of exitPremiums) {
        exitMap.set(ep.legIndex, ep.closePremiumPerContract);
      }

      let realizedNetUsd = 0;
      for (const leg of legs) {
        const openPer = parseDec(leg.premiumPerContract);
        const contracts = parseDec(leg.contracts);
        const exitPer = parseDec(exitMap.get(leg.legIndex) ?? '0');
        // long: pays open, receives exit → exit - open
        // short: collects open, pays exit → open - exit
        const sign = leg.side === 'long' ? 1 : -1;
        realizedNetUsd += sign * (exitPer - openPer) * contracts;

        await tx`
          UPDATE public.activity_option_leg
          SET
            closed_at = ${nowIso}::timestamptz,
            close_premium_per_contract = ${
              exitMap.get(leg.legIndex) ?? '0'
            }
          WHERE activity_id = ${activityId}::uuid
            AND leg_index = ${leg.legIndex}
        `;
      }

      const totalFeesUsd = legs.reduce(
        (acc, l) => acc + parseDec(l.feesUsd),
        0,
      );
      const realizedNetAfterFees = realizedNetUsd - totalFeesUsd;

      await tx`
        UPDATE public.activity_option
        SET realized_pnl_usd = ${realizedNetAfterFees.toString()}
        WHERE activity_id = ${activityId}::uuid
      `;
      await tx`
        UPDATE public.activity
        SET
          status = ${finalStatus}::activity_status,
          closed_at = ${nowIso}::timestamptz,
          realized_pnl_usd = ${realizedNetAfterFees.toString()},
          net_pnl_usd = ${realizedNetAfterFees.toString()}
        WHERE id = ${activityId}::uuid
      `;
    });
    return true;
  } catch (e) {
    if (e instanceof Error && e.message === 'not_found') return false;
    throw e;
  }
}
