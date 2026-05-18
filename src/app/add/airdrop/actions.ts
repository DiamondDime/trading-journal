"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/server";
import { CreateAirdropBody } from "@/lib/db/zod-schemas";
import { createAirdropV5, updateAirdropV5, type AirdropExtras } from "./db";

function stripNextInternals(entries: [string, FormDataEntryValue][]): [string, FormDataEntryValue][] {
  return entries.filter(([k]) => !k.startsWith("$ACTION_"));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fields the wizard sends but `CreateAirdropBody` doesn't recognise (strict
 * schema). We strip them from the payload before zod parses, then handle
 * them separately as `AirdropExtras`. The shared zod schema stays
 * untouched — this preserves Wave-1's contract.
 */
const EXTRAS_KEYS = new Set([
  "edit",
  "validation",
  "error",
  "eligibilityConfidence",
  "customTags",
  "strategyTag",
  "taxTaxable",
  "taxJurisdiction",
]);

function extractExtras(raw: Record<string, string>): AirdropExtras {
  const confidence = raw.eligibilityConfidence ?? "";
  return {
    strategyTag: raw.strategyTag?.trim() ? raw.strategyTag.trim() : null,
    taxTaxable: raw.taxTaxable === "1" || raw.taxTaxable === "on" || raw.taxTaxable === "true",
    taxJurisdiction: raw.taxJurisdiction?.trim() ? raw.taxJurisdiction.trim() : null,
    customTagsRaw: raw.customTags ?? "",
    eligibilityConfidence:
      confidence === "snapshot_listed" ||
      confidence === "expected_unconfirmed" ||
      confidence === "claimed_confirmed"
        ? confidence
        : null,
  };
}

/**
 * Server action for the airdrop wizard's final submit.
 *
 * Status branches:
 *   - status=pending → activity.status='pending', closed_at null, no income
 *     event recorded. The wizard tells the trader they're tracking the drop
 *     pre-claim.
 *   - status=claimed → activity.status='claimed', realized = value_at_claim,
 *     net_pnl = current_value − gas_cost.
 *
 * Edit mode (`edit=<uuid>`): dispatches to updateAirdropV5; redirect picks
 * up `action=edited` so the detail page shows the "Just saved" banner.
 */
export async function logAirdrop(formData: FormData): Promise<void> {
  let activityId: string | null = null;
  let isEdit = false;
  let redirectError: string | null = null;

  const editRaw = formData.get("edit");
  const editId = typeof editRaw === "string" && UUID_RE.test(editRaw) ? editRaw : null;

  const allEntries = stripNextInternals([...formData.entries()]);
  const rawAll: Record<string, string> = Object.fromEntries(allEntries) as Record<string, string>;

  // Split the payload: zod-recognised keys go to the schema; everything else
  // becomes AirdropExtras for the wizard-local helpers to consume.
  const zodPayload: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawAll)) {
    if (!EXTRAS_KEYS.has(k)) zodPayload[k] = v;
  }
  // Legacy alias: the form's `note` textarea is the eligibility free-text
  // for v5. Map it onto `eligibilityReason` before zod parse so existing
  // edit-paths keep working with both names.
  if (zodPayload.note && !zodPayload.eligibilityReason) {
    zodPayload.eligibilityReason = zodPayload.note;
  }
  delete zodPayload.note;

  const extras = extractExtras(rawAll);

  try {
    const { id: userId } = await requireUser();
    const input = CreateAirdropBody.parse(zodPayload);

    if (editId) {
      isEdit = true;
      const ok = await updateAirdropV5(userId, editId, input, extras);
      if (!ok) throw new Error("Airdrop not found or not owned by you");
      activityId = editId;
    } else {
      const { id } = await createAirdropV5(userId, input, extras);
      activityId = id;
    }
  } catch (e) {
    redirectError = e instanceof Error ? e.message : String(e);
  }

  if (activityId) {
    // revalidate dashboard + archive — must run before redirect (redirect
    // throws and short-circuits the rest of the action).
    revalidatePath("/spreads");
    revalidatePath("/spreads/archive");
    revalidatePath("/airdrops");
    const qs = isEdit ? "from=wizard&action=edited" : "from=wizard";
    redirect(`/airdrops/${activityId}?${qs}`);
  } else {
    // Preserve user input on the round trip back to /review so they don't
    // re-type everything after a validation failure.
    const preserve: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawAll)) {
      if (k === "edit") continue;
      preserve[k] = v;
    }
    const qs = new URLSearchParams({
      error: redirectError ?? "Unknown error logging airdrop",
      ...preserve,
      ...(editId ? { edit: editId } : {}),
    }).toString();
    redirect(`/add/airdrop/review?${qs}`);
  }
}
