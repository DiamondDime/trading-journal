/**
 * Yield-position DB helpers.
 *
 * Lives under `src/app/add/yield/` (not `src/lib/db/activity.ts`) because the
 * v5 foundation explicitly walled off the shared `activity.ts` module to
 * the four legacy types. The yield wizard owns its own insert / update /
 * read-for-edit path; the polymorphic detail page reads through the same
 * helpers below rather than the generic `getActivity()` (which returns
 * `null` for yield_position rows by design — see activity.ts:338).
 *
 * Transaction shape mirrors `createTrade` / `createSale`:
 *   1. INSERT into `public.activity`
 *   2. INSERT into `public.activity_yield_position`
 *   3. The DEFERRABLE `check_activity_subtype_exists` trigger fires at
 *      COMMIT and validates that the subtype row landed.
 *
 * All decimals stay as strings until the final SQL bind — never `number`
 * for money or qty (project convention, see CLAUDE.md).
 */
import { sql } from "@/lib/db/client";
import type { CreateYieldPositionData } from "@/lib/db/zod-schemas";
import type { ActivityId, Decimal, YieldKind, YieldKindMeta } from "@/types/canonical";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Strict `Number()` coerce — fine for derivation only; storage always
 *  round-trips through Decimal strings. */
function num(s: string | null | undefined): number {
  if (s == null || s === "") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Build the activity.name string. Trader can override via input.name; otherwise
 * we derive a deterministic "<ASSET> · <protocol> · <kind>" label so the row
 * looks self-documenting in the activity feed without further intervention.
 */
function deriveYieldName(input: CreateYieldPositionData): string {
  if (input.name) return input.name;
  return `${input.asset.toUpperCase()} · ${input.protocol} · ${input.kind}`;
}

// ============================================================================
// createYieldPosition
// ============================================================================

/**
 * Insert a new yield_position activity + matching activity_yield_position
 * row in one transaction.
 *
 * capital_deployed_usd on the supertype mirrors amount_usd_at_open on the
 * subtype so the unified feed's APR-style fallback formula has a real
 * denominator. realized_pnl_usd starts at 0 — it's bumped by reward
 * snapshots over the position's lifetime. fees_usd combines protocol +
 * gas fees (the subtype keeps them split for the review's stacked-bar
 * decomposition).
 *
 * Status default: 'open' when the trader picks "open" in the wizard,
 * 'pending' was on the table earlier but the v5 status enum constraint
 * (`chk_activity_status_by_type`) forbids pending for yield_position —
 * the trader sees the pending-style "soon" message via the wizard
 * source-step `auto` option (disabled) instead.
 */
export async function createYieldPosition(
  userId: string,
  input: CreateYieldPositionData,
): Promise<{ id: ActivityId }> {
  const openedIso = new Date(input.opened_at).toISOString();
  const closedIso = input.closed_at
    ? new Date(input.closed_at).toISOString()
    : null;
  const capitalUsd = num(input.amount_usd_at_open) || 0;
  const feesProtocol = num(input.fees_protocol_usd ?? "0");
  const feesGas = num(input.fees_gas_usd ?? "0");
  const feesUsd = feesProtocol + feesGas;

  const activityId = await sql.begin(async (tx) => {
    const [activity] = await tx<{ id: string }[]>`
      INSERT INTO public.activity (
        user_id, type, status, name,
        opened_at, closed_at,
        capital_deployed_usd, realized_pnl_usd, fees_usd, net_pnl_usd,
        regime_tags, custom_tags,
        tax_taxable, tax_jurisdiction, strategy_tag
      ) VALUES (
        ${userId}::uuid, 'yield_position',
        ${input.status ?? "open"}::activity_status,
        ${deriveYieldName(input)},
        ${openedIso}::timestamptz,
        ${closedIso},
        ${capitalUsd > 0 ? capitalUsd.toString() : null},
        '0', ${feesUsd.toString()}, ${(-feesUsd).toString()},
        ${input.regime_tags as string[]}, ${input.custom_tags as string[]},
        ${input.tax_taxable ?? false}, ${input.tax_jurisdiction ?? null},
        ${input.strategy_tag ?? null}
      )
      RETURNING id
    `;

    await tx`
      INSERT INTO public.activity_yield_position (
        activity_id, kind, protocol, venue, chain, asset,
        amount, amount_usd_at_open, expected_apy_pct, rewards_token,
        fees_protocol_usd, fees_gas_usd,
        kind_meta
      ) VALUES (
        ${activity.id}::uuid,
        ${input.kind}::yield_kind,
        ${input.protocol}, ${input.venue ?? null}, ${input.chain ?? null},
        ${input.asset.toUpperCase()},
        ${input.amount},
        ${capitalUsd > 0 ? capitalUsd.toString() : null},
        ${input.expected_apy_pct ?? null},
        ${input.rewards_token ?? null},
        ${feesProtocol.toString()}, ${feesGas.toString()},
        ${tx.json(input.kind_meta)}
      )
    `;

    return activity.id;
  });

  return { id: activityId as ActivityId };
}

// ============================================================================
// getYieldPositionForEdit — feed the wizard's edit / re-render path
// ============================================================================

export interface YieldPositionDetailRow {
  // supertype slice
  id: ActivityId;
  status: "open" | "unwinding" | "closed";
  name: string;
  openedAt: string;
  closedAt: string | null;
  capitalDeployedUsd: Decimal | null;
  realizedPnlUsd: Decimal | null;
  netPnlUsd: Decimal | null;
  feesUsd: Decimal;
  regimeTags: string[];
  customTags: string[];
  taxTaxable: boolean;
  taxJurisdiction: string | null;
  strategyTag: string | null;
  createdAt: string;
  updatedAt: string;
  // subtype slice
  kind: YieldKind;
  protocol: string;
  venue: string | null;
  chain: string | null;
  asset: string;
  amount: Decimal;
  amountUsdAtOpen: Decimal | null;
  expectedApyPct: Decimal | null;
  realizedApyPct: Decimal | null;
  rewardsToken: string | null;
  rewardsAccrued: Decimal;
  rewardsClaimed: Decimal;
  rewardsUsdValue: Decimal | null;
  feesProtocolUsd: Decimal;
  feesGasUsd: Decimal;
  kindMeta: YieldKindMeta | null;
  currentPriceUsd: Decimal | null;
  currentPriceAt: string | null;
}

/** Fetch a yield_position with its subtype joined in. Returns `null` if
 *  the row doesn't exist, isn't a yield_position, or isn't owned by the
 *  caller (no leak of existence). */
export async function getYieldPositionForEdit(
  userId: string,
  activityId: string,
): Promise<YieldPositionDetailRow | null> {
  if (!UUID_RE.test(activityId)) return null;
  const rows = await sql<YieldPositionDetailRow[]>`
    SELECT
      a.id, a.status, a.name, a.opened_at, a.closed_at,
      a.capital_deployed_usd, a.realized_pnl_usd, a.fees_usd, a.net_pnl_usd,
      a.regime_tags, a.custom_tags,
      a.tax_taxable, a.tax_jurisdiction, a.strategy_tag,
      a.created_at, a.updated_at,
      ayp.kind, ayp.protocol, ayp.venue, ayp.chain, ayp.asset,
      ayp.amount, ayp.amount_usd_at_open, ayp.expected_apy_pct, ayp.realized_apy_pct,
      ayp.rewards_token, ayp.rewards_accrued, ayp.rewards_claimed,
      ayp.rewards_usd_value, ayp.fees_protocol_usd, ayp.fees_gas_usd,
      ayp.kind_meta, ayp.current_price_usd, ayp.current_price_at
    FROM public.activity a
    JOIN public.activity_yield_position ayp ON ayp.activity_id = a.id
    WHERE a.id = ${activityId}::uuid
      AND a.user_id = ${userId}::uuid
      AND a.type = 'yield_position'
      AND a.deleted_at IS NULL
    LIMIT 1
  `;
  return rows[0] ?? null;
}

// ============================================================================
// updateYieldPosition
// ============================================================================

export interface YieldPositionPatch {
  name?: string;
  status?: "open" | "unwinding" | "closed";
  closedAt?: string | null;
  openedAt?: string;
  expectedApyPct?: number | null;
  amountUsdAtOpen?: string | null;
  feesProtocolUsd?: string;
  feesGasUsd?: string;
  rewardsToken?: string | null;
  regimeTags?: string[];
  customTags?: string[];
  strategyTag?: string | null;
  taxTaxable?: boolean;
  taxJurisdiction?: string | null;
  // Sub-kind-specific JSON payload, validated by the caller via
  // YieldKindMetaSchema. The wizard's edit flow always rewrites the meta
  // payload wholesale — kind itself is immutable post-create (changing it
  // would invalidate the discriminator).
  kindMeta?: YieldKindMeta;
}

/**
 * Update a yield_position activity + its subtype row in one transaction.
 *
 * Recomputes the supertype's `capital_deployed_usd` from amountUsdAtOpen,
 * and `fees_usd` from feesProtocolUsd + feesGasUsd, so the feed view stays
 * consistent with the subtype. realized_pnl_usd and net_pnl_usd are owned
 * by `recordRewardSnapshot` — this path leaves them alone.
 */
export async function updateYieldPosition(
  userId: string,
  activityId: string,
  patch: YieldPositionPatch,
): Promise<boolean> {
  if (!UUID_RE.test(activityId)) return false;
  return sql.begin(async (tx) => {
    // 1. Ownership check + supertype patch
    const parentPatches: Record<string, unknown> = {};
    if (patch.name !== undefined) parentPatches.name = patch.name;
    if (patch.status !== undefined) parentPatches.status = patch.status;
    if (patch.openedAt !== undefined)
      parentPatches.opened_at = new Date(patch.openedAt).toISOString();
    if (patch.closedAt !== undefined)
      parentPatches.closed_at =
        patch.closedAt === null ? null : new Date(patch.closedAt).toISOString();
    if (patch.amountUsdAtOpen !== undefined)
      parentPatches.capital_deployed_usd = patch.amountUsdAtOpen;
    if (patch.feesProtocolUsd !== undefined || patch.feesGasUsd !== undefined) {
      const p = num(patch.feesProtocolUsd ?? "0");
      const g = num(patch.feesGasUsd ?? "0");
      parentPatches.fees_usd = (p + g).toString();
    }
    if (patch.regimeTags !== undefined) parentPatches.regime_tags = patch.regimeTags;
    if (patch.customTags !== undefined) parentPatches.custom_tags = patch.customTags;
    if (patch.strategyTag !== undefined) parentPatches.strategy_tag = patch.strategyTag;
    if (patch.taxTaxable !== undefined) parentPatches.tax_taxable = patch.taxTaxable;
    if (patch.taxJurisdiction !== undefined)
      parentPatches.tax_jurisdiction = patch.taxJurisdiction;

    if (Object.keys(parentPatches).length > 0) {
      const rows = await tx`
        UPDATE public.activity
        SET ${tx(parentPatches)}
        WHERE id = ${activityId}::uuid
          AND user_id = ${userId}::uuid
          AND type = 'yield_position'
          AND deleted_at IS NULL
        RETURNING id
      `;
      if (rows.length === 0) return false;
    } else {
      const owner = await tx<{ id: string }[]>`
        SELECT id FROM public.activity
        WHERE id = ${activityId}::uuid
          AND user_id = ${userId}::uuid
          AND type = 'yield_position'
          AND deleted_at IS NULL
        LIMIT 1
      `;
      if (owner.length === 0) return false;
    }

    // 2. Subtype patch
    const subPatches: Record<string, unknown> = {};
    if (patch.expectedApyPct !== undefined)
      subPatches.expected_apy_pct = patch.expectedApyPct;
    if (patch.amountUsdAtOpen !== undefined)
      subPatches.amount_usd_at_open = patch.amountUsdAtOpen;
    if (patch.feesProtocolUsd !== undefined)
      subPatches.fees_protocol_usd = patch.feesProtocolUsd;
    if (patch.feesGasUsd !== undefined)
      subPatches.fees_gas_usd = patch.feesGasUsd;
    if (patch.rewardsToken !== undefined)
      subPatches.rewards_token = patch.rewardsToken;
    if (patch.kindMeta !== undefined)
      subPatches.kind_meta = tx.json(patch.kindMeta);

    if (Object.keys(subPatches).length > 0) {
      await tx`
        UPDATE public.activity_yield_position
        SET ${tx(subPatches)}
        WHERE activity_id = ${activityId}::uuid
      `;
    }

    return true;
  });
}

// ============================================================================
// recordRewardSnapshot
// ============================================================================

/**
 * Record a manual "I checked, the position has earned X tokens worth Y USD"
 * snapshot. Updates the subtype's rewards_accrued + rewards_usd_value and
 * recomputes the supertype's realized_pnl_usd / net_pnl_usd / view-facing
 * realized_apy_pct in one transaction.
 *
 * Why manual: the foundation auto-import path (Binance Earn / Bybit Earn /
 * Kraken Stake adapters) isn't wired in v5. Snapshots are the user's
 * lifeline until the auto-pipeline lands. The math here mirrors what the
 * worker will eventually compute server-side.
 *
 * `qty` is incremental — call site adds the delta since the last snapshot.
 * `usd` is the absolute USD value at this snapshot's timestamp (which is
 * also stamped onto current_price_at).
 */
export async function recordRewardSnapshot(
  userId: string,
  activityId: string,
  qty: string,
  usd: string,
): Promise<boolean> {
  if (!UUID_RE.test(activityId)) return false;
  const qtyN = num(qty);
  const usdN = num(usd);
  if (qtyN < 0 || usdN < 0) return false;

  return sql.begin(async (tx) => {
    // Fetch current state for ownership + APY computation
    const rows = await tx<
      {
        amountUsdAtOpen: string | null;
        rewardsAccrued: string;
        feesUsd: string;
        openedAt: string;
        status: string;
      }[]
    >`
      SELECT
        ayp.amount_usd_at_open AS "amountUsdAtOpen",
        ayp.rewards_accrued     AS "rewardsAccrued",
        a.fees_usd              AS "feesUsd",
        a.opened_at             AS "openedAt",
        a.status                AS "status"
      FROM public.activity a
      JOIN public.activity_yield_position ayp ON ayp.activity_id = a.id
      WHERE a.id = ${activityId}::uuid
        AND a.user_id = ${userId}::uuid
        AND a.type = 'yield_position'
        AND a.deleted_at IS NULL
      LIMIT 1
    `;
    if (rows.length === 0) return false;
    const r = rows[0];

    const newAccrued = num(r.rewardsAccrued) + qtyN;
    const fees = num(r.feesUsd);
    const realizedPnl = usdN - fees;
    const capital = num(r.amountUsdAtOpen);
    const daysHeld =
      (Date.now() - new Date(r.openedAt).getTime()) / 86_400_000;
    const apy =
      capital > 0 && daysHeld > 0 ? (usdN / capital) * (365 / daysHeld) * 100 : null;

    // Build the patches map dynamically so the realized_apy_pct column
    // only takes a write when we have a denominator + a meaningful window.
    // `current_price_at` is always bumped — that's the "when did the
    // trader last verify" stamp.
    const subPatches: Record<string, unknown> = {
      rewards_accrued: newAccrued.toString(),
      rewards_usd_value: usdN.toString(),
      current_price_at: new Date().toISOString(),
    };
    if (apy !== null) subPatches.realized_apy_pct = apy.toString();

    await tx`
      UPDATE public.activity_yield_position
      SET ${tx(subPatches)}
      WHERE activity_id = ${activityId}::uuid
    `;

    await tx`
      UPDATE public.activity
      SET
        realized_pnl_usd = ${realizedPnl.toString()},
        net_pnl_usd      = ${realizedPnl.toString()}
      WHERE id = ${activityId}::uuid
    `;

    return true;
  });
}
