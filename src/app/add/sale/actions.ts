"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { createSale } from "@/lib/db/activity";
import { CreateSaleBody } from "@/lib/db/zod-schemas";

function stripNextInternals(entries: [string, FormDataEntryValue][]): [string, FormDataEntryValue][] {
  return entries.filter(([k]) => !k.startsWith("$ACTION_"));
}

/**
 * Server action for the sale wizard's final submit.
 *
 * Path: /add/sale/review → submits hidden form whose action targets this.
 * Validates the FormData payload via CreateSaleBody, inserts activity +
 * activity_sale (with vesting_schedule jsonb built from cliff + linear inputs),
 * then redirects to /sales/<new-uuid>?from=wizard.
 */
export async function logSale(formData: FormData): Promise<void> {
  let activityId: string | null = null;
  let redirectError: string | null = null;

  let cleanedRaw: Record<string, string> = {};
  try {
    const { id: userId } = await requireUser();
    cleanedRaw = Object.fromEntries(stripNextInternals([...formData.entries()])) as Record<string, string>;
    const input = CreateSaleBody.parse(cleanedRaw);
    const { id } = await createSale(userId, input);
    activityId = id;
  } catch (e) {
    redirectError = e instanceof Error ? e.message : String(e);
  }

  if (activityId) {
    redirect(`/sales/${activityId}?from=wizard`);
  } else {
    const qs = new URLSearchParams({
      error: redirectError ?? "Unknown error logging sale",
      ...cleanedRaw,
    }).toString();
    redirect(`/add/sale/review?${qs}`);
  }
}
