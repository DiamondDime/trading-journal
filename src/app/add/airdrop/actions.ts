"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { createAirdrop, updateAirdropActivity } from "@/lib/db/activity";
import { CreateAirdropBody } from "@/lib/db/zod-schemas";

function stripNextInternals(entries: [string, FormDataEntryValue][]): [string, FormDataEntryValue][] {
  return entries.filter(([k]) => !k.startsWith("$ACTION_"));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function deriveAirdropName(asset: string, protocol: string): string {
  return `${asset.toUpperCase()} · ${protocol} airdrop`;
}

/**
 * Server action for the airdrop wizard's final submit.
 *
 * Cost basis is always $0 for airdrops; net_pnl_usd captures the current
 * MTM value, realized_pnl_usd captures the income value at claim. The
 * row's redirect target is /airdrops/<new-uuid>?from=wizard.
 *
 * Edit mode: when `edit=<uuid>` is in the FormData, the action dispatches
 * to updateAirdropActivity. Redirect adds `action=edited`.
 */
export async function logAirdrop(formData: FormData): Promise<void> {
  let activityId: string | null = null;
  let isEdit = false;
  let redirectError: string | null = null;

  const editRaw = formData.get("edit");
  const editId = typeof editRaw === "string" && UUID_RE.test(editRaw) ? editRaw : null;

  let cleanedRaw: Record<string, string> = {};
  try {
    const { id: userId } = await requireUser();
    cleanedRaw = Object.fromEntries(
      stripNextInternals([...formData.entries()]).filter(([k]) => k !== "edit"),
    ) as Record<string, string>;
    const input = CreateAirdropBody.parse(cleanedRaw);

    if (editId) {
      isEdit = true;
      const claimIso = new Date(input.claimDate).toISOString();
      const tokens = Number(input.tokensClaimed);
      const valueAtClaim = Number(input.usdValueAtClaim);
      const currentPrice = Number(input.currentPriceUsd);
      const currentValue = tokens * currentPrice;
      const realized = valueAtClaim;
      const netPnl = currentValue;

      const ok = await updateAirdropActivity(
        userId,
        editId,
        {
          name: deriveAirdropName(input.asset, input.protocol),
          regimeTags: input.regimeTags as string[],
          openedAt: claimIso,
          closedAt: claimIso,
          realizedPnlUsd: realized.toString(),
          netPnlUsd: netPnl.toString(),
        },
        {
          tokenSymbol: input.asset.toUpperCase(),
          protocol: input.protocol,
          qtyReceived: tokens.toString(),
          claimDate: claimIso,
          valueAtReceiptUsd: valueAtClaim.toString(),
          currentPriceUsd: currentPrice.toString(),
          eligibilityReason: input.note || null,
        },
      );
      if (!ok) throw new Error("Airdrop not found or not owned by you");
      activityId = editId;
    } else {
      const { id } = await createAirdrop(userId, input);
      activityId = id;
    }
  } catch (e) {
    redirectError = e instanceof Error ? e.message : String(e);
  }

  if (activityId) {
    const qs = isEdit ? "from=wizard&action=edited" : "from=wizard";
    redirect(`/airdrops/${activityId}?${qs}`);
  } else {
    const qs = new URLSearchParams({
      error: redirectError ?? "Unknown error logging airdrop",
      ...cleanedRaw,
      ...(editId ? { edit: editId } : {}),
    }).toString();
    redirect(`/add/airdrop/review?${qs}`);
  }
}
