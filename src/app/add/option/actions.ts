"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/server";
import { CreateOptionBody, OptionLegBody } from "@/lib/db/zod-schemas";
import {
  createOption,
  updateOption,
  recordOptionClose,
  type OptionCloseReason,
  type OptionExitPremium,
} from "./db";
import { parseTagsFormValue } from "../_lib/review-helpers";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Match `legs[i].field` shape that <WizardLegList> emits.
const LEG_PATH_RE = /^legs\[(\d+)\]\.([a-zA-Z_]+)$/;

function stripNextInternals(
  entries: [string, FormDataEntryValue][],
): [string, FormDataEntryValue][] {
  return entries.filter(([k]) => !k.startsWith("$ACTION_"));
}

/**
 * Pull a comma-separated tag string into an array (mirrors the spread/sale
 * wizards' regimeTags pattern). Empty entries are dropped; the array is
 * capped to 20 items (the Zod schema enforces this too).
 */
function parseTagList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
}

/**
 * Walk every `legs[i].<field>` entry in the FormData, group by index, and
 * coerce each row through the OptionLegBody Zod schema so the downstream
 * CreateOptionBody.parse sees a clean array. Returns the legs ordered by
 * the leg_index that the form embedded as a hidden input.
 */
function extractLegs(form: FormData): unknown[] {
  // Bucket raw key/value pairs by leg index.
  const buckets = new Map<number, Record<string, string>>();
  for (const [k, v] of form.entries()) {
    const m = k.match(LEG_PATH_RE);
    if (!m) continue;
    const i = Number(m[1]);
    const field = m[2];
    if (typeof v !== "string") continue;
    let bucket = buckets.get(i);
    if (!bucket) {
      bucket = {};
      buckets.set(i, bucket);
    }
    bucket[field] = v;
  }
  const indices = Array.from(buckets.keys()).sort((a, b) => a - b);
  return indices.map((i) => ({
    leg_index: i,
    ...buckets.get(i)!,
  }));
}

/**
 * Server action for the option wizard's final submit. Handles both create
 * and edit modes — the `edit` hidden input rides through to land in the
 * update path when present.
 *
 * On validation failure the action redirects back to /add/option/review
 * with `?error=<msg>` plus a serialized copy of the form so the user's
 * inputs survive the round trip.
 */
export async function logOption(formData: FormData): Promise<void> {
  let activityId: string | null = null;
  let isEdit = false;
  let redirectError: string | null = null;

  const editRaw = formData.get("edit");
  const editId =
    typeof editRaw === "string" && UUID_RE.test(editRaw) ? editRaw : null;

  // Capture cleaned scalar fields BEFORE auth so the redirect-back path can
  // restore the user's inputs.
  const scalarEntries = stripNextInternals([...formData.entries()]).filter(
    ([k]) =>
      !k.startsWith("legs[") &&
      k !== "edit" &&
      k !== "regime_tags" &&
      k !== "custom_tags" &&
      k !== "tags",
  );
  const cleanedRaw: Record<string, string> = {};
  for (const [k, v] of scalarEntries) {
    if (typeof v === "string") cleanedRaw[k] = v;
  }

  try {
    const { id: userId } = await requireUser();

    // Validate each leg independently first — keeps Zod error messages
    // pointing at the leg the user actually filled out.
    const rawLegs = extractLegs(formData);
    const parsedLegs = rawLegs.map((l, i) => {
      try {
        return OptionLegBody.parse(l);
      } catch (err) {
        const msg =
          err instanceof Error
            ? `Leg ${i + 1}: ${err.message}`
            : `Leg ${i + 1}: invalid`;
        throw new Error(msg);
      }
    });

    const regimeTags = parseTagList(formData.get("regime_tags")?.toString());
    const customTags = parseTagList(formData.get("custom_tags")?.toString());
    // Free-form tags from the review step's WizardTagInput (JSON array).
    const tags = parseTagsFormValue(formData.get("tags"));

    const body = {
      ...cleanedRaw,
      regime_tags: regimeTags,
      custom_tags: customTags,
      legs: parsedLegs,
    };

    // `expected_holding_days` and `target_iv_change_bps` are wizard-only
    // intent inputs — no column exists on `activity_option` yet, so the
    // strict-mode Zod schema rejects them. Strip before parse; they still
    // survive the URL round-trip via `cleanedRaw` if a different validation
    // failure bounces the user back to /review with their inputs intact.
    const {
      expected_holding_days: _ehd,
      target_iv_change_bps: _ticb,
      ...bodyForParse
    } = body as Record<string, unknown>;
    void _ehd;
    void _ticb;
    const input = CreateOptionBody.parse(bodyForParse);

    if (editId) {
      isEdit = true;
      const ok = await updateOption(userId, editId, input, tags);
      if (!ok) throw new Error("Option not found or not owned by you");
      activityId = editId;
    } else {
      const { id } = await createOption(userId, input, tags);
      activityId = id;
    }
  } catch (e) {
    redirectError = e instanceof Error ? e.message : String(e);
  }

  if (activityId) {
    revalidatePath("/spreads");
    revalidatePath("/spreads/archive");
    revalidatePath("/options");
    revalidatePath(`/options/${activityId}`);
    const qs = isEdit ? "from=wizard&action=edited" : "from=wizard";
    redirect(`/options/${activityId}?${qs}`);
  } else {
    // Preserve the scalar inputs + leg fields in the URL so /review re-mounts
    // with the same values populated. Leg fields use square brackets in their
    // names — URLSearchParams encodes them transparently.
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(cleanedRaw)) {
      params.set(k, v);
    }
    for (const [k, v] of formData.entries()) {
      if (typeof v !== "string") continue;
      if (k.startsWith("legs[")) params.append(k, v);
      if (k === "regime_tags" || k === "custom_tags" || k === "tags") {
        params.set(k, v);
      }
    }
    params.set("error", redirectError ?? "Unknown error logging option");
    if (editId) params.set("edit", editId);
    redirect(`/add/option/review?${params.toString()}`);
  }
}

/**
 * Server action for the detail page's "Close position" form. Collects
 * per-leg exit premiums from the form and the close_reason radio choice,
 * then records the close via recordOptionClose.
 */
export async function closeOptionPosition(formData: FormData): Promise<void> {
  const idRaw = formData.get("activity_id");
  const activityId =
    typeof idRaw === "string" && UUID_RE.test(idRaw) ? idRaw : null;
  const reasonRaw = formData.get("close_reason");
  const allowedReasons: readonly OptionCloseReason[] = [
    "expired_worthless",
    "closed_early",
    "assigned",
    "exercised",
  ];
  const closeReason: OptionCloseReason =
    typeof reasonRaw === "string" &&
    (allowedReasons as readonly string[]).includes(reasonRaw)
      ? (reasonRaw as OptionCloseReason)
      : "closed_early";

  if (!activityId) {
    redirect("/options");
  }

  const { id: userId } = await requireUser();

  // Exit premiums arrive as `exit_premium[<legIndex>]` keys.
  const exitPremiums: OptionExitPremium[] = [];
  for (const [k, v] of formData.entries()) {
    const m = k.match(/^exit_premium\[(\d+)\]$/);
    if (!m) continue;
    if (typeof v !== "string") continue;
    exitPremiums.push({
      legIndex: Number(m[1]),
      closePremiumPerContract: v,
    });
  }

  const ok = await recordOptionClose(userId, activityId, exitPremiums, closeReason);
  if (!ok) {
    redirect(`/options/${activityId}?error=close_failed`);
  }
  revalidatePath("/spreads");
  revalidatePath("/spreads/archive");
  revalidatePath("/options");
  revalidatePath(`/options/${activityId}`);
  redirect(`/options/${activityId}?action=closed`);
}
