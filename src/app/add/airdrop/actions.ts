"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { createAirdrop } from "@/lib/db/activity";
import { CreateAirdropBody } from "@/lib/db/zod-schemas";

function stripNextInternals(entries: [string, FormDataEntryValue][]): [string, FormDataEntryValue][] {
  return entries.filter(([k]) => !k.startsWith("$ACTION_"));
}

/**
 * Server action for the airdrop wizard's final submit.
 *
 * Cost basis is always $0 for airdrops; net_pnl_usd captures the current
 * MTM value, realized_pnl_usd captures the income value at claim. The
 * row's redirect target is /airdrops/<new-uuid>?from=wizard.
 */
export async function logAirdrop(formData: FormData): Promise<void> {
  let activityId: string | null = null;
  let redirectError: string | null = null;

  let cleanedRaw: Record<string, string> = {};
  try {
    const { id: userId } = await requireUser();
    cleanedRaw = Object.fromEntries(stripNextInternals([...formData.entries()])) as Record<string, string>;
    const input = CreateAirdropBody.parse(cleanedRaw);
    const { id } = await createAirdrop(userId, input);
    activityId = id;
  } catch (e) {
    redirectError = e instanceof Error ? e.message : String(e);
  }

  if (activityId) {
    redirect(`/airdrops/${activityId}?from=wizard`);
  } else {
    const qs = new URLSearchParams({
      error: redirectError ?? "Unknown error logging airdrop",
      ...cleanedRaw,
    }).toString();
    redirect(`/add/airdrop/review?${qs}`);
  }
}
