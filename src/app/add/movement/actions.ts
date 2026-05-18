"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/server";
import { createEventLog, updateEventLog } from "@/lib/db/events";
import {
  CreateEventLogBody,
  UpdateEventLogBody,
} from "@/lib/db/zod-schemas";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
 *
 * Edit mode: when `editId=<uuid>` is in the FormData, this action calls
 * updateEventLog() against the existing row instead of inserting a new
 * one. The detail page (/movement-events/<id>) populates that hidden field
 * when the user lands here via its Edit link.
 */
export async function logMovement(formData: FormData): Promise<void> {
  let eventId: string | null = null;
  let isEdit = false;
  let redirectError: string | null = null;

  // Keep the raw form payload around for the error-redirect round trip.
  const cleanedAll: Record<string, string> = Object.fromEntries(
    stripNextInternals([...formData.entries()]),
  ) as Record<string, string>;

  const editRaw = cleanedAll.editId ?? "";
  const editId = UUID_RE.test(editRaw) ? editRaw : null;
  // Don't echo editId back through error redirects as a top-level form key;
  // the review page rebuilds it from MOVEMENT_FIELDS so the original
  // cleanedAll (which already carries it) is what we want.
  const cleaned: Record<string, string> = { ...cleanedAll };
  delete cleaned.editId;

  try {
    const { id: userId } = await requireUser();
    if (editId) {
      // UpdateEventLogBody is permissive (every field optional); reuse the
      // same camelCase → snake_case mapping then drop undefined keys so the
      // updateEventLog helper's `Object.keys` check doesn't over-write.
      const partial = UpdateEventLogBody.parse(toZodInput(cleaned));
      const ok = await updateEventLog(userId, editId, partial);
      if (!ok) throw new Error("Movement event not found or not owned by you");
      eventId = editId;
      isEdit = true;
    } else {
      const input = CreateEventLogBody.parse(toZodInput(cleaned));
      const { id } = await createEventLog(userId, input);
      eventId = id;
    }
  } catch (e) {
    redirectError = e instanceof Error ? e.message : String(e);
  }

  if (eventId) {
    // Invalidate the sidebar count + the list page.
    revalidatePath("/spreads");
    revalidatePath("/movement-events");
    revalidatePath(`/movement-events/${eventId}`);
    const action = isEdit ? "edited" : "created";
    redirect(`/movement-events/${eventId}?from=wizard&action=${action}`);
  } else {
    const qs = new URLSearchParams({
      error: redirectError ?? "Unknown error logging movement",
      ...cleanedAll,
    }).toString();
    redirect(`/add/movement/review?${qs}`);
  }
}
