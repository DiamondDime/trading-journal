"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/server";
import { createEventLog } from "@/lib/db/events";
import { CreateEventLogBody } from "@/lib/db/zod-schemas";

function stripNextInternals(
  entries: [string, FormDataEntryValue][],
): [string, FormDataEntryValue][] {
  return entries.filter(([k]) => !k.startsWith("$ACTION_"));
}

/**
 * Inputs use the wizard's camelCase shape; the zod body uses snake_case
 * (it's the wire shape for the public POST /api/events as well). Maps and
 * strips empty-strings before parsing so trailing empties don't trip
 * uuid / numeric refinements.
 */
function toZodInput(form: Record<string, string>): Record<string, unknown> {
  const get = (k: string) => {
    const v = form[k];
    return v && v.trim().length > 0 ? v.trim() : undefined;
  };

  // datetime-local emits "YYYY-MM-DDTHH:mm". Convert to ISO with seconds.
  const occurredRaw = get("occurredAt");
  const occurred = occurredRaw
    ? new Date(occurredRaw).toISOString()
    : undefined;

  return {
    kind:                get("kind"),
    occurred_at:         occurred,
    asset:               get("asset")?.toUpperCase(),
    amount:              get("amount"),
    usd_value:           get("usdValue"),
    from_venue:          get("fromVenue"),
    to_venue:            get("toVenue"),
    tx_hash:             get("txHash"),
    chain:               get("chain"),
    fee_usd:             get("feeUsd"),
    description:         get("description"),
    related_activity_id: get("relatedActivityId"),
  };
}

/**
 * Server action for the movement wizard's final submit. event_log is a
 * standalone table (NOT in activity supertype) so this skips the
 * activity-creation transaction altogether.
 */
export async function logMovement(formData: FormData): Promise<void> {
  let eventId: string | null = null;
  let redirectError: string | null = null;

  // Keep the raw form payload around for the error-redirect round trip.
  const cleaned: Record<string, string> = Object.fromEntries(
    stripNextInternals([...formData.entries()]),
  ) as Record<string, string>;

  try {
    const { id: userId } = await requireUser();
    const input = CreateEventLogBody.parse(toZodInput(cleaned));
    const { id } = await createEventLog(userId, input);
    eventId = id;
  } catch (e) {
    redirectError = e instanceof Error ? e.message : String(e);
  }

  if (eventId) {
    // Invalidate the sidebar count + the list page.
    revalidatePath("/spreads");
    revalidatePath("/movement-events");
    redirect(`/movement-events/${eventId}?from=wizard`);
  } else {
    const qs = new URLSearchParams({
      error: redirectError ?? "Unknown error logging movement",
      ...cleaned,
    }).toString();
    redirect(`/add/movement/review?${qs}`);
  }
}
