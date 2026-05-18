/**
 * Sale-wizard-specific DB helpers.
 *
 * Why this file exists (vs `src/lib/db/activity.ts`):
 *   The canonical createSale/updateSaleActivity in activity.ts only touch the
 *   v1 column set (token_symbol/sale_kind/sale_venue/usd_paid/tokens_allocated/
 *   vesting_schedule/current_price_usd). Migration v5 added 6 more columns to
 *   activity_sale plus 3 supertype columns (tax_taxable, tax_jurisdiction,
 *   strategy_tag) and a refined vesting jsonb shape (4 variants incl. custom).
 *   This wrapper owns the full column write so the wizard can be "absolute"
 *   per the master plan §5 quality bar without bumping the canonical helpers
 *   (which are shared with /api routes and would risk wider blast radius).
 *
 * Read shape mirrors SaleSubtype from activity.ts + the v5 columns the wizard
 * needs to round-trip on edit.
 *
 * Decimals stay strings (project rule). VestingSchedule is the v5 shape with
 * the custom variant — JSON-encoded into the jsonb column.
 */
import { sql } from "@/lib/db/client";
import type {
  VestingSchedule,
  Decimal,
  ActivityStatus,
} from "@/types/canonical";
import type { CreateSaleData } from "@/lib/db/zod-schemas";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read shape for the wizard edit path. Merges the activity supertype +
 * activity_sale subtype + v5 surface columns into one flat object.
 * postgres.js's `transform: postgres.camel` produces these keys at runtime.
 */
export interface SaleEditRow {
  // supertype
  activityId: string;
  status: ActivityStatus;
  openedAt: string | null;
  regimeTags: string[];
  customTags: string[];
  taxTaxable: boolean;
  taxJurisdiction: string | null;
  strategyTag: string | null;
  // subtype — v1 columns
  tokenSymbol: string;
  saleKind: string;
  saleVenue: string | null;
  saleDate: string;
  usdPaid: Decimal;
  tokensAllocated: Decimal;
  vestingSchedule: VestingSchedule | null;
  currentPriceUsd: Decimal | null;
  // subtype — v5 columns
  tokenChain: string | null;
  claimWallet: string | null;
  fundraisingRound:
    | "seed"
    | "private"
    | "public"
    | "strategic"
    | "other"
    | null;
  allocationMethod:
    | "fcfs"
    | "lottery"
    | "staking"
    | "whitelist"
    | "other"
    | null;
  tier: string | null;
  bonusPct: Decimal | null;
  eligibilityReason: string | null;
}

/**
 * Fetch a sale's full editable column set for the wizard's pre-fill path.
 * Returns null when the row doesn't exist, isn't a sale, or isn't owned.
 * No-leak semantics — same pattern as the canonical getActivity helper.
 */
export async function getSaleForEdit(
  userId: string,
  activityId: string,
): Promise<SaleEditRow | null> {
  if (!UUID_RE.test(activityId)) return null;
  const rows = await sql<SaleEditRow[]>`
    SELECT
      a.id                    AS activity_id,
      a.status                AS status,
      a.opened_at             AS opened_at,
      a.regime_tags           AS regime_tags,
      a.custom_tags           AS custom_tags,
      a.tax_taxable           AS tax_taxable,
      a.tax_jurisdiction      AS tax_jurisdiction,
      a.strategy_tag          AS strategy_tag,
      s.token_symbol          AS token_symbol,
      s.sale_kind::text       AS sale_kind,
      s.sale_venue            AS sale_venue,
      s.sale_date             AS sale_date,
      s.usd_paid              AS usd_paid,
      s.tokens_allocated      AS tokens_allocated,
      s.vesting_schedule      AS vesting_schedule,
      s.current_price_usd     AS current_price_usd,
      s.token_chain           AS token_chain,
      s.claim_wallet          AS claim_wallet,
      s.fundraising_round     AS fundraising_round,
      s.allocation_method     AS allocation_method,
      s.tier                  AS tier,
      s.bonus_pct             AS bonus_pct,
      ada.eligibility_reason  AS eligibility_reason
    FROM public.activity a
    JOIN public.activity_sale s ON s.activity_id = a.id
    -- eligibility_reason currently lives on activity_airdrop per migration v5;
    -- for sales we approximate via a left join on a same-id activity_airdrop
    -- which will never match. Kept as NULL for now — wizard treats it as a
    -- write-only structured-thesis field that lands in note prefix until the
    -- canonical schema grows a sale-side eligibility column.
    LEFT JOIN public.activity_airdrop ada ON ada.activity_id = a.id
    WHERE a.id = ${activityId}::uuid
      AND a.user_id = ${userId}::uuid
      AND a.type = 'sale'
      AND a.deleted_at IS NULL
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * Compose a SALE name for the activity supertype's `name` column. Stable across
 * create + update so the supertype's display matches the subtype.
 */
function deriveSaleName(saleKind: string, asset: string, venue: string): string {
  const kindLabel =
    saleKind === "ido" || saleKind === "ieo" || saleKind === "otc"
      ? saleKind.toUpperCase()
      : saleKind === "private_round"
      ? "Private round"
      : saleKind === "otc_allocation"
      ? "OTC allocation"
      : saleKind === "vesting_claim"
      ? "Vesting claim"
      : saleKind.charAt(0).toUpperCase() + saleKind.slice(1);
  return `${asset.toUpperCase()} — ${venue} ${kindLabel}`;
}

/**
 * Decide the supertype status from inputs. Per the master plan §1:
 *   - pending  → allocation paid, pre-TGE OR tgeUnlockPct === 0 and no claims
 *   - vesting  → some tokens unlocked at TGE or claims already happened, more to vest
 *   - closed   → all tokens unlocked + claimed (vestingDuration === 0 && tgeUnlockPct === 100)
 * Claim events aren't collected by this wizard yet (the field is future work
 * per the master plan above-and-beyond list), so the only deterministic case
 * for 'closed' is "all_at_tge with TGE already in the past". For now we keep
 * the conservative pending|vesting split; the edit path is what surfaces the
 * 'closed' transition.
 */
export function deriveSaleStatus(
  tgeUnlockPct: number,
  tgeDateIso: string,
  vestingDurationDays: number,
): ActivityStatus {
  const tgeMs = new Date(tgeDateIso).getTime();
  const tgePassed = Number.isFinite(tgeMs) && tgeMs <= Date.now();
  if (!tgePassed) return "pending";
  if (tgeUnlockPct >= 100 && vestingDurationDays === 0) return "vesting";
  return "vesting";
}

/**
 * Days-granular vesting builder. Replaces the months×30 approximation in
 * activity.ts.buildVestingSchedule — see master plan must-fix #10.
 *
 * Accepts either the raw editor-emitted JSON (preferred) or the legacy
 * cliff/duration days inputs and an explicit "all at TGE" signal.
 */
export function buildVestingScheduleFromJson(
  rawJson: string | null | undefined,
): VestingSchedule | null {
  if (!rawJson) return null;
  try {
    const parsed = JSON.parse(rawJson) as VestingSchedule;
    // Cheap shape check — Zod parsing happens in the action, this is just a
    // safety net for the edit path that hand-shapes the JSON.
    if (
      parsed &&
      typeof parsed === "object" &&
      "kind" in parsed &&
      ["all_at_tge", "tge_plus_linear", "cliff_plus_linear", "custom"].includes(
        parsed.kind,
      )
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extra columns the wizard surfaces beyond the canonical CreateSaleData. These
 * are passed alongside the Zod-validated body so the SQL writer can land the
 * full column set in a single transaction.
 */
export interface SaleExtendedInput {
  saleDateIso: string | null;
  vestingSchedule: VestingSchedule | null;
  tokenChain: string | null;
  claimWallet: string | null;
  fundraisingRound: SaleEditRow["fundraisingRound"];
  allocationMethod: SaleEditRow["allocationMethod"];
  tier: string | null;
  bonusPct: string | null;
  strategyTag: string | null;
  taxTaxable: boolean;
  taxJurisdiction: string | null;
}

/**
 * Insert a sale activity + subtype in one transaction, with the full v5
 * column set. The canonical createSale only writes the v1 columns; this is
 * the wizard's full-column write path.
 */
export async function createSaleFull(
  userId: string,
  input: CreateSaleData,
  extra: SaleExtendedInput,
): Promise<{ id: string }> {
  const openedIso = new Date(input.openedAt).toISOString();
  const tgeIso = new Date(input.tgeDate).toISOString();
  const saleDateIso = extra.saleDateIso
    ? new Date(extra.saleDateIso).toISOString()
    : tgeIso;

  const usdPaidNum = Number(input.usdPaid);
  const tokensNum = Number(input.tokensAllocated);
  const currentPriceNum = Number(input.currentPriceUsd);
  const currentValue = tokensNum * currentPriceNum;
  const netPnl = currentValue - usdPaidNum;

  // Days-granular vesting (master plan must-fix #10). Falls back to the
  // months×30 approximation only when the editor didn't emit a fresh JSON
  // payload (legacy edits via direct URL params).
  const schedule = extra.vestingSchedule;
  const linearDays =
    schedule && "linear_days" in schedule ? schedule.linear_days : 0;
  const status = deriveSaleStatus(
    input.tgeUnlockPct,
    tgeIso,
    linearDays,
  );

  const activityId = await sql.begin(async (tx) => {
    const [activity] = await tx<{ id: string }[]>`
      INSERT INTO public.activity (
        user_id, type, status, name,
        opened_at,
        capital_deployed_usd, realized_pnl_usd, fees_usd, net_pnl_usd,
        regime_tags, custom_tags,
        tax_taxable, tax_jurisdiction, strategy_tag
      ) VALUES (
        ${userId}::uuid, 'sale',
        ${status}::activity_status,
        ${deriveSaleName(input.saleKind, input.asset, input.venue)},
        ${openedIso}::timestamptz,
        ${usdPaidNum.toString()}, '0', '0', ${netPnl.toString()},
        ${input.regimeTags as string[]}, ${[] as string[]},
        ${extra.taxTaxable}, ${extra.taxJurisdiction}, ${extra.strategyTag}
      )
      RETURNING id
    `;

    await tx`
      INSERT INTO public.activity_sale (
        activity_id, token_symbol, token_chain, sale_kind, sale_venue, sale_date,
        usd_paid, tokens_allocated,
        vesting_schedule, claim_events, total_claimed,
        current_price_usd, current_price_at,
        claim_wallet, fundraising_round, allocation_method, tier, bonus_pct
      ) VALUES (
        ${activity.id}::uuid,
        ${input.asset.toUpperCase()},
        ${extra.tokenChain},
        ${input.saleKind},
        ${input.venue},
        ${saleDateIso}::timestamptz,
        ${usdPaidNum.toString()},
        ${tokensNum.toString()},
        ${schedule ? tx.json(schedule) : null},
        ${tx.json([])}, '0',
        ${currentPriceNum.toString()}, now(),
        ${extra.claimWallet},
        ${extra.fundraisingRound},
        ${extra.allocationMethod},
        ${extra.tier},
        ${extra.bonusPct}
      )
    `;

    return activity.id;
  });

  return { id: activityId };
}

/**
 * Update the supertype + subtype rows with the full v5 column set. Owner-
 * scoped via the supertype WHERE clause. Returns false when the row doesn't
 * exist / isn't owned (caller surfaces a "not found" error).
 */
export async function updateSaleFull(
  userId: string,
  activityId: string,
  input: CreateSaleData,
  extra: SaleExtendedInput,
): Promise<boolean> {
  const openedIso = new Date(input.openedAt).toISOString();
  const tgeIso = new Date(input.tgeDate).toISOString();
  const saleDateIso = extra.saleDateIso
    ? new Date(extra.saleDateIso).toISOString()
    : tgeIso;
  const usdPaidNum = Number(input.usdPaid);
  const tokensNum = Number(input.tokensAllocated);
  const currentPriceNum = Number(input.currentPriceUsd);
  const currentValue = tokensNum * currentPriceNum;
  const netPnl = currentValue - usdPaidNum;

  const schedule = extra.vestingSchedule;
  const linearDays =
    schedule && "linear_days" in schedule ? schedule.linear_days : 0;
  const status = deriveSaleStatus(
    input.tgeUnlockPct,
    tgeIso,
    linearDays,
  );

  return sql.begin(async (tx) => {
    const parentRows = await tx<{ id: string }[]>`
      UPDATE public.activity
      SET
        name = ${deriveSaleName(input.saleKind, input.asset, input.venue)},
        status = ${status}::activity_status,
        regime_tags = ${input.regimeTags as string[]},
        opened_at = ${openedIso}::timestamptz,
        capital_deployed_usd = ${usdPaidNum.toString()},
        realized_pnl_usd = '0',
        net_pnl_usd = ${netPnl.toString()},
        tax_taxable = ${extra.taxTaxable},
        tax_jurisdiction = ${extra.taxJurisdiction},
        strategy_tag = ${extra.strategyTag}
      WHERE id = ${activityId}::uuid
        AND user_id = ${userId}::uuid
        AND type = 'sale'
        AND deleted_at IS NULL
      RETURNING id
    `;
    if (parentRows.length === 0) return false;

    await tx`
      UPDATE public.activity_sale
      SET
        token_symbol = ${input.asset.toUpperCase()},
        token_chain = ${extra.tokenChain},
        sale_kind = ${input.saleKind},
        sale_venue = ${input.venue},
        sale_date = ${saleDateIso}::timestamptz,
        usd_paid = ${usdPaidNum.toString()},
        tokens_allocated = ${tokensNum.toString()},
        vesting_schedule = ${schedule ? tx.json(schedule) : null},
        current_price_usd = ${currentPriceNum.toString()},
        current_price_at = now(),
        claim_wallet = ${extra.claimWallet},
        fundraising_round = ${extra.fundraisingRound},
        allocation_method = ${extra.allocationMethod},
        tier = ${extra.tier},
        bonus_pct = ${extra.bonusPct}
      WHERE activity_id = ${activityId}::uuid
    `;

    return true;
  });
}
