"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/server";
import {
  CreateSaleBody,
  VestingScheduleSchema,
} from "@/lib/db/zod-schemas";
import {
  createSaleFull,
  updateSaleFull,
  type SaleExtendedInput,
} from "./db";
import type { VestingSchedule } from "@/types/canonical";

/**
 * Server action for the sale wizard's final submit.
 *
 * v5 differences vs v1:
 *   - the kind picker is its own step (/add/sale/kind) — the body still
 *     carries saleKind as a hidden input
 *   - vesting schedule arrives as a JSON-encoded discriminated union from
 *     the WizardVestingEditor (4 variants incl. custom)
 *   - additional columns: tokenChain, claimWallet, fundraisingRound,
 *     allocationMethod, tier, bonusPct, strategyTag, taxTaxable,
 *     taxJurisdiction, eligibilityReason
 *   - status is derived from {tgeUnlockPct, tgeDate, vesting duration} —
 *     see deriveSaleStatus in db.ts
 *
 * The action delegates create / update to db.ts (createSaleFull /
 * updateSaleFull) so the full v5 column set is written atomically.
 */

// Next.js's server-action machinery injects internal keys like
// `$ACTION_ID_*` into the FormData. Strip them before Zod parsing since the
// create-body schemas use `.strict()` which would otherwise 400 the request.
function stripNextInternals(
  entries: [string, FormDataEntryValue][],
): [string, FormDataEntryValue][] {
  return entries.filter(([k]) => !k.startsWith("$ACTION_"));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Subset of valid fundraising_round values for the constraint check. */
const FUNDRAISING_ROUNDS = [
  "seed",
  "private",
  "public",
  "strategic",
  "other",
] as const;
type FundraisingRound = (typeof FUNDRAISING_ROUNDS)[number];

const ALLOCATION_METHODS = [
  "fcfs",
  "lottery",
  "staking",
  "whitelist",
  "other",
] as const;
type AllocationMethod = (typeof ALLOCATION_METHODS)[number];

/**
 * Parse the vesting JSON payload from the WizardVestingEditor. Returns null
 * when the field is missing or invalid — the schedule column is nullable on
 * the schema side, so a missing variant translates to "no schedule recorded".
 */
function parseVestingSchedule(raw: string | undefined): VestingSchedule | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return VestingScheduleSchema.parse(parsed);
  } catch {
    return null;
  }
}

/**
 * Derive the v5 SaleExtendedInput shape from raw FormData. Keeps the action
 * thin: schema-side fields run through CreateSaleBody, supertype / round /
 * vesting fields run through this helper.
 */
function buildExtendedInput(
  raw: Record<string, string>,
): SaleExtendedInput {
  const round = raw.fundraisingRound as FundraisingRound | "" | undefined;
  const alloc = raw.allocationMethod as AllocationMethod | "" | undefined;
  return {
    saleDateIso: raw.saleDate || null,
    vestingSchedule: parseVestingSchedule(raw.vestingScheduleJson),
    tokenChain: raw.tokenChain || null,
    claimWallet: raw.claimWallet || null,
    fundraisingRound:
      round && FUNDRAISING_ROUNDS.includes(round as FundraisingRound)
        ? (round as FundraisingRound)
        : null,
    allocationMethod:
      alloc && ALLOCATION_METHODS.includes(alloc as AllocationMethod)
        ? (alloc as AllocationMethod)
        : null,
    tier: raw.tier || null,
    bonusPct:
      raw.bonusPct && Number.isFinite(Number(raw.bonusPct))
        ? raw.bonusPct
        : null,
    strategyTag: raw.strategyTag || null,
    taxTaxable: raw.taxTaxable === "on",
    taxJurisdiction: raw.taxJurisdiction || null,
  };
}

export async function logSale(formData: FormData): Promise<void> {
  let activityId: string | null = null;
  let isEdit = false;
  let redirectError: string | null = null;

  const editRaw = formData.get("edit");
  const editId =
    typeof editRaw === "string" && UUID_RE.test(editRaw) ? editRaw : null;

  // Capture cleaned form payload BEFORE the auth call so wizard errors keep
  // the user's inputs around for the redirect-back round trip. Same pattern
  // as /add/trade/actions.ts — auth errors should never blank the form.
  const cleanedRaw: Record<string, string> = Object.fromEntries(
    stripNextInternals([...formData.entries()]).filter(
      ([k]) => k !== "edit",
    ),
  ) as Record<string, string>;

  try {
    const { id: userId } = await requireUser();

    // CreateSaleBody is .strict() — fields it doesn't know about (the v5
    // extras + the vesting JSON blob + the tax flags) would 400 unless we
    // remove them before parsing. Pull them out into `extras` first.
    const extras = buildExtendedInput(cleanedRaw);
    const bodyOnly: Record<string, string> = { ...cleanedRaw };
    [
      "tokenChain",
      "claimWallet",
      "saleDate",
      "fundraisingRound",
      "allocationMethod",
      "tier",
      "bonusPct",
      "vestingScheduleJson",
      "strategyTag",
      "taxTaxable",
      "taxJurisdiction",
      "eligibilityReason",
    ].forEach((k) => delete bodyOnly[k]);

    const input = CreateSaleBody.parse(bodyOnly);

    if (editId) {
      isEdit = true;
      const ok = await updateSaleFull(userId, editId, input, extras);
      if (!ok) throw new Error("Sale not found or not owned by you");
      activityId = editId;
    } else {
      const { id } = await createSaleFull(userId, input, extras);
      activityId = id;
    }
  } catch (e) {
    redirectError = e instanceof Error ? e.message : String(e);
  }

  if (activityId) {
    // Invalidate dashboard + archive: see /add/trade/actions.ts for the
    // order rule (revalidatePath runs before redirect because redirect
    // throws).
    revalidatePath("/spreads");
    revalidatePath("/spreads/archive");
    const qs = isEdit ? "from=wizard&action=edited" : "from=wizard";
    redirect(`/sales/${activityId}?${qs}`);
  } else {
    const qs = new URLSearchParams({
      error: redirectError ?? "Unknown error logging sale",
      ...cleanedRaw,
      ...(editId ? { edit: editId } : {}),
    }).toString();
    redirect(`/add/sale/review?${qs}`);
  }
}
