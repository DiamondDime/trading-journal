"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { createTrade } from "@/lib/db/activity";
import { CreateTradeBody } from "@/lib/db/zod-schemas";

// Next.js's server-action machinery injects internal keys like
// `$ACTION_ID_*` into the FormData. Strip them before Zod parsing since the
// create-body schemas use `.strict()` which would otherwise 400 the request.
function stripNextInternals(entries: [string, FormDataEntryValue][]): [string, FormDataEntryValue][] {
  return entries.filter(([k]) => !k.startsWith("$ACTION_"));
}

/**
 * Server action for the trade wizard's final submit.
 *
 * Path: /add/trade/review → submits hidden form whose action targets this.
 * Validates the FormData payload via CreateTradeBody, inserts position +
 * activity + activity_trade transactionally, then redirects to the new
 * detail page. On any validation/DB failure, redirects back to /review
 * with the error URL-encoded so the page can surface it inline.
 *
 * The `?from=wizard` flag drives the "Just saved" banner on the detail page.
 */
export async function logTrade(formData: FormData): Promise<void> {
  let activityId: string | null = null;
  let redirectError: string | null = null;

  let cleanedRaw: Record<string, string> = {};
  try {
    const { id: userId } = await requireUser();
    cleanedRaw = Object.fromEntries(stripNextInternals([...formData.entries()])) as Record<string, string>;
    const input = CreateTradeBody.parse(cleanedRaw);
    const { id } = await createTrade(userId, input);
    activityId = id;
  } catch (e) {
    redirectError = e instanceof Error ? e.message : String(e);
  }

  // Redirect must live outside try/catch: `redirect()` throws an internal
  // signal that Next intercepts; if it's caught it never actually navigates.
  if (activityId) {
    redirect(`/trades/${activityId}?from=wizard`);
  } else {
    const qs = new URLSearchParams({
      error: redirectError ?? "Unknown error logging trade",
      ...cleanedRaw,
    }).toString();
    redirect(`/add/trade/review?${qs}`);
  }
}
