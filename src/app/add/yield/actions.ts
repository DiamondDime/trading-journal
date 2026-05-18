"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/server";
import { CreateYieldPositionBody } from "@/lib/db/zod-schemas";
import type { CreateYieldPositionData } from "@/lib/db/zod-schemas";
import type { YieldKindMeta } from "@/types/canonical";
import {
  createYieldPosition,
  updateYieldPosition,
  recordRewardSnapshot,
} from "./db";

// ─── Form-internal helpers ──────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function stripNextInternals(
  entries: [string, FormDataEntryValue][],
): [string, FormDataEntryValue][] {
  return entries.filter(([k]) => !k.startsWith("$ACTION_"));
}

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

function strOpt(v: FormDataEntryValue | null): string | undefined {
  const s = str(v);
  return s === "" ? undefined : s;
}

function num(v: FormDataEntryValue | null): number | undefined {
  const s = str(v);
  if (s === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function parseTags(v: FormDataEntryValue | null): string[] {
  const s = str(v);
  if (!s) return [];
  return s
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, 20);
}

/**
 * Build the discriminated `kind_meta` JSON payload from the flat FormData
 * the wizard's `/fields` step emits. Each kind has a distinct shape — the
 * helper extracts only the fields relevant to that kind so a stray hidden
 * input from a previous step can't sneak through.
 *
 * Validation lives on `YieldKindMetaSchema` (Zod discriminated union); we
 * just shape the object here and let Zod accept-or-reject inside the main
 * `CreateYieldPositionBody.parse` call.
 */
function buildKindMeta(fd: FormData): YieldKindMeta | undefined {
  const kind = str(fd.get("kind"));
  switch (kind) {
    case "stake":
      return {
        kind: "stake",
        validatorAddress: strOpt(fd.get("validatorAddress")),
        operator: strOpt(fd.get("operator")),
      };
    case "lend": {
      const rk = str(fd.get("rateKind"));
      if (rk !== "variable" && rk !== "fixed") return undefined;
      return {
        kind: "lend",
        rateKind: rk,
        ltv: num(fd.get("ltv")),
      };
    }
    case "farm":
      return {
        kind: "farm",
        pairA: str(fd.get("pairA")),
        pairB: str(fd.get("pairB")),
        amountA: str(fd.get("amountA")),
        amountB: str(fd.get("amountB")),
        poolFeeTier: strOpt(fd.get("poolFeeTier")),
        rewardToken: str(fd.get("rewardToken")),
      };
    case "lp":
      return {
        kind: "lp",
        pairA: str(fd.get("pairA")),
        pairB: str(fd.get("pairB")),
        amountA: str(fd.get("amountA")),
        amountB: str(fd.get("amountB")),
        poolFeeTier: str(fd.get("poolFeeTier")),
        rangeLower: strOpt(fd.get("rangeLower")),
        rangeUpper: strOpt(fd.get("rangeUpper")),
        concentrated: str(fd.get("concentrated")) === "true",
      };
    case "validator":
      return {
        kind: "validator",
        validatorAddress: str(fd.get("validatorAddress")),
        commissionPct: num(fd.get("commissionPct")) ?? 0,
      };
    case "mining":
      return {
        kind: "mining",
        hashrateThs: num(fd.get("hashrateThs")) ?? 0,
        electricityCostUsdKwh: num(fd.get("electricityCostUsdKwh")) ?? 0,
        pool: str(fd.get("pool")),
        expectedDailyRevenueUsd: num(fd.get("expectedDailyRevenueUsd")) ?? 0,
      };
    default:
      return undefined;
  }
}

/**
 * Shape the flat FormData into the discriminated `CreateYieldPositionBody`
 * input. Validation happens on the Zod schema; this just unpacks the
 * key/value pairs.
 */
function buildCreateInput(fd: FormData): Record<string, unknown> {
  return {
    kind: str(fd.get("kind")),
    protocol: str(fd.get("protocol")),
    venue: strOpt(fd.get("venue")),
    chain: strOpt(fd.get("chain")),
    asset: str(fd.get("asset")),
    amount: str(fd.get("amount")),
    amount_usd_at_open: strOpt(fd.get("amountUsdAtOpen")),
    expected_apy_pct: num(fd.get("expectedApyPct")),
    rewards_token: strOpt(fd.get("rewardsToken")),
    fees_protocol_usd: strOpt(fd.get("feesProtocolUsd")) ?? "0",
    fees_gas_usd: strOpt(fd.get("feesGasUsd")) ?? "0",
    // status: trader's hand-pick on the review step (defaults to 'open').
    status: strOpt(fd.get("status")) ?? "open",
    opened_at: str(fd.get("openedAt")),
    closed_at: strOpt(fd.get("closedAt")),
    name: strOpt(fd.get("name")),
    regime_tags: parseTags(fd.get("regimeTags")),
    custom_tags: parseTags(fd.get("customTags")),
    strategy_tag: strOpt(fd.get("strategyTag")),
    tax_taxable: str(fd.get("taxTaxable")) === "true",
    tax_jurisdiction: strOpt(fd.get("taxJurisdiction")),
    kind_meta: buildKindMeta(fd),
  };
}

// ─── Public actions ─────────────────────────────────────────────────────────

/**
 * Server action for the yield wizard's final submit. Inserts a brand-new
 * yield_position activity + subtype row, then redirects to its detail page.
 *
 * Edit mode is keyed by a hidden `edit=<uuid>` input on the review step;
 * the action splits to `updateYieldPosition` and routes back to the detail
 * page with `action=edited`.
 *
 * Error path: redirect back to /add/yield/review with the original form
 * payload + an `error=<message>` URL param. The review page surfaces the
 * banner so the trader can fix and resubmit without retyping every field.
 */
export async function logYieldPosition(formData: FormData): Promise<void> {
  let activityId: string | null = null;
  let isEdit = false;
  let redirectError: string | null = null;

  const editId = (() => {
    const raw = formData.get("edit");
    return typeof raw === "string" && UUID_RE.test(raw) ? raw : null;
  })();

  // Snapshot the form payload BEFORE any auth/db work so the error redirect
  // below can rehydrate the wizard with what the trader entered.
  const cleanedRaw: Record<string, string> = Object.fromEntries(
    stripNextInternals([...formData.entries()]).filter(([k]) => k !== "edit"),
  ) as Record<string, string>;

  try {
    const { id: userId } = await requireUser();
    const shaped = buildCreateInput(formData);
    const input: CreateYieldPositionData = CreateYieldPositionBody.parse(shaped);

    if (editId) {
      isEdit = true;
      const ok = await updateYieldPosition(userId, editId, {
        name: input.name,
        status: input.status,
        closedAt: input.closed_at ?? null,
        openedAt: input.opened_at,
        expectedApyPct: input.expected_apy_pct ?? null,
        amountUsdAtOpen: input.amount_usd_at_open ?? null,
        feesProtocolUsd: input.fees_protocol_usd,
        feesGasUsd: input.fees_gas_usd,
        rewardsToken: input.rewards_token ?? null,
        regimeTags: input.regime_tags as string[],
        customTags: input.custom_tags as string[],
        strategyTag: input.strategy_tag ?? null,
        taxTaxable: input.tax_taxable,
        taxJurisdiction: input.tax_jurisdiction ?? null,
        kindMeta: input.kind_meta,
      });
      if (!ok) throw new Error("Yield position not found or not owned by you");
      activityId = editId;
    } else {
      const { id } = await createYieldPosition(userId, input);
      activityId = id;
    }
  } catch (e) {
    redirectError = e instanceof Error ? e.message : String(e);
  }

  if (activityId) {
    revalidatePath("/spreads");
    revalidatePath("/spreads/archive");
    revalidatePath("/yield-positions");
    const qs = isEdit ? "from=wizard&action=edited" : "from=wizard";
    redirect(`/yield-positions/${activityId}?${qs}`);
  } else {
    const qs = new URLSearchParams({
      error: redirectError ?? "Unknown error logging yield position",
      ...cleanedRaw,
      ...(editId ? { edit: editId } : {}),
    }).toString();
    redirect(`/add/yield/review?${qs}`);
  }
}

/**
 * Server action for the detail page's "Snapshot rewards" form. The trader
 * provides the incremental qty earned + the absolute USD value at the
 * snapshot's timestamp. Math + persistence live in `recordRewardSnapshot`.
 */
export async function snapshotRewards(formData: FormData): Promise<void> {
  const { id: userId } = await requireUser();
  const id = str(formData.get("activityId"));
  const qty = str(formData.get("qty"));
  const usd = str(formData.get("usd"));
  if (!UUID_RE.test(id)) return;
  await recordRewardSnapshot(userId, id, qty || "0", usd || "0");
  revalidatePath(`/yield-positions/${id}`);
  revalidatePath("/yield-positions");
  revalidatePath("/spreads/archive");
}

/**
 * Server action for the detail page's "Close position" button. Flips
 * status → 'closed' and stamps closed_at = now(). The trader can re-open
 * via the wizard's edit path if they made a mistake.
 */
export async function closeYieldPosition(formData: FormData): Promise<void> {
  const { id: userId } = await requireUser();
  const id = str(formData.get("activityId"));
  if (!UUID_RE.test(id)) return;
  await updateYieldPosition(userId, id, {
    status: "closed",
    closedAt: new Date().toISOString(),
  });
  revalidatePath(`/yield-positions/${id}`);
  revalidatePath("/yield-positions");
  revalidatePath("/spreads/archive");
}

/**
 * Server action for the detail page's "Mark unwinding" button. Used for
 * the in-between state where the trader has started withdrawing (e.g.
 * Lido unstaking cooldown) but the position isn't fully closed yet.
 */
export async function markUnwindingYieldPosition(
  formData: FormData,
): Promise<void> {
  const { id: userId } = await requireUser();
  const id = str(formData.get("activityId"));
  if (!UUID_RE.test(id)) return;
  await updateYieldPosition(userId, id, { status: "unwinding" });
  revalidatePath(`/yield-positions/${id}`);
  revalidatePath("/yield-positions");
  revalidatePath("/spreads/archive");
}

