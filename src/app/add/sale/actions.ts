"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { createSale, updateSaleActivity } from "@/lib/db/activity";
import { CreateSaleBody } from "@/lib/db/zod-schemas";

function stripNextInternals(entries: [string, FormDataEntryValue][]): [string, FormDataEntryValue][] {
  return entries.filter(([k]) => !k.startsWith("$ACTION_"));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function deriveSaleName(saleKind: string, asset: string, venue: string): string {
  const kindLabel =
    saleKind === "ido"
      ? "IDO"
      : saleKind.charAt(0).toUpperCase() + saleKind.slice(1);
  return `${asset.toUpperCase()} — ${venue} ${kindLabel}`;
}

/**
 * Mirror of activity.ts buildVestingSchedule. Encoded for the edit path so
 * the same shape lands in activity_sale.vesting_schedule jsonb.
 */
function buildVestingSchedule(
  tgePct: number,
  cliffMonths: number,
  durationMonths: number,
):
  | { kind: "all_at_tge" }
  | { kind: "tge_plus_linear"; tge_pct: number; linear_days: number }
  | { kind: "cliff_plus_linear"; cliff_days: number; linear_days: number; tge_pct?: number }
  | null {
  const cliffDays = cliffMonths * 30;
  const linearDays = durationMonths * 30;
  if (tgePct >= 100 && cliffDays === 0 && linearDays === 0) {
    return { kind: "all_at_tge" };
  }
  if (cliffDays > 0) {
    return {
      kind: "cliff_plus_linear",
      cliff_days: cliffDays,
      linear_days: linearDays,
      ...(tgePct > 0 ? { tge_pct: tgePct } : {}),
    };
  }
  return {
    kind: "tge_plus_linear",
    tge_pct: tgePct,
    linear_days: linearDays,
  };
}

/**
 * Server action for the sale wizard's final submit.
 *
 * Edit mode: when `edit=<uuid>` is in the FormData, the action dispatches
 * to updateSaleActivity. Redirect target adds `action=edited` for the
 * preview banner.
 */
export async function logSale(formData: FormData): Promise<void> {
  let activityId: string | null = null;
  let isEdit = false;
  let redirectError: string | null = null;

  const editRaw = formData.get("edit");
  const editId = typeof editRaw === "string" && UUID_RE.test(editRaw) ? editRaw : null;

  // Capture cleaned form payload BEFORE the auth call so wizard errors keep
  // the user's inputs around for the redirect-back round trip.
  const cleanedRaw: Record<string, string> = Object.fromEntries(
    stripNextInternals([...formData.entries()]).filter(([k]) => k !== "edit"),
  ) as Record<string, string>;
  try {
    const { id: userId } = await requireUser();
    const input = CreateSaleBody.parse(cleanedRaw);

    if (editId) {
      isEdit = true;
      const openedIso = new Date(input.openedAt).toISOString();
      const tgeIso = new Date(input.tgeDate).toISOString();
      const usdPaid = Number(input.usdPaid);
      const tokens = Number(input.tokensAllocated);
      const currentPrice = Number(input.currentPriceUsd);
      const currentValue = tokens * currentPrice;
      const netPnl = currentValue - usdPaid;
      const vestingSchedule = buildVestingSchedule(
        input.tgeUnlockPct,
        input.vestingCliffMonths ?? 0,
        input.vestingDurationMonths ?? 0,
      );

      const ok = await updateSaleActivity(
        userId,
        editId,
        {
          name: deriveSaleName(input.saleKind, input.asset, input.venue),
          status: input.tgeUnlockPct >= 100 ? "vesting" : "pending",
          regimeTags: input.regimeTags as string[],
          openedAt: openedIso,
          capitalDeployedUsd: usdPaid.toString(),
          realizedPnlUsd: "0",
          netPnlUsd: netPnl.toString(),
        },
        {
          tokenSymbol: input.asset.toUpperCase(),
          saleKind: input.saleKind,
          saleVenue: input.venue,
          saleDate: tgeIso,
          usdPaid: usdPaid.toString(),
          tokensAllocated: tokens.toString(),
          vestingSchedule,
          currentPriceUsd: currentPrice.toString(),
        },
      );
      if (!ok) throw new Error("Sale not found or not owned by you");
      activityId = editId;
    } else {
      const { id } = await createSale(userId, input);
      activityId = id;
    }
  } catch (e) {
    redirectError = e instanceof Error ? e.message : String(e);
  }

  if (activityId) {
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
