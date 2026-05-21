"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/server";
import { CreateTradeBody } from "@/lib/db/zod-schemas";
import {
  createTradeFromWizard,
  updateTradeFromWizard,
  type ExtendedTradeInput,
} from "./db";

// Next.js's server-action machinery injects internal keys like `$ACTION_ID_*`
// into the FormData. Strip them before Zod parsing since CreateTradeBody is
// strict and would 400 the request otherwise.
function stripNextInternals(
  entries: [string, FormDataEntryValue][],
): [string, FormDataEntryValue][] {
  return entries.filter(([k]) => !k.startsWith("$ACTION_"));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Fields the wizard collects beyond what CreateTradeBody validates. These
// flow straight into createTradeFromWizard / updateTradeFromWizard as
// pass-through — the action layer doesn't need to re-validate them.
const PASSTHROUGH_KEYS = [
  "tradeStatus",
  "entryThesis",
  "exitNote",
  "counterparty",
  "settlementDate",
  "escrowMethod",
  "premiumOrDiscountBps",
  "collection",
  "tokenId",
  "marketplace",
  "royaltyPct",
  "strategyTag",
  "positionId",
] as const;

/**
 * Carve out the keys that aren't part of CreateTradeBody so the body parse
 * doesn't trip on `.strict()`. We feed them straight through to the DB layer
 * via ExtendedTradeInput. The action layer's only job for these is shape
 * normalization (booleans, trimmed strings, presence).
 */
function partitionExtras(
  raw: Record<string, string>,
): {
  body: Record<string, string>;
  extras: Pick<ExtendedTradeInput, (typeof PASSTHROUGH_KEYS)[number]> & {
    tradeStatus?: "open" | "closed" | "liquidated";
    positionId?: string;
  };
} {
  const body: Record<string, string> = {};
  const extras = {} as Pick<ExtendedTradeInput, (typeof PASSTHROUGH_KEYS)[number]> & {
    tradeStatus?: "open" | "closed" | "liquidated";
    positionId?: string;
  };

  for (const [k, vRaw] of Object.entries(raw)) {
    const v = vRaw.trim();
    if (k === "status") {
      // Status comes in as `status` from the form but the DB layer reads
      // `tradeStatus`. Map and validate against the allowed values.
      if (v === "open" || v === "closed" || v === "liquidated") {
        extras.tradeStatus = v;
      } else if (v) {
        // Unknown status — let the DB layer reject through a CHECK violation
        // rather than silently defaulting. Surface a clean error below.
        throw new Error(
          `Unknown trade status "${v}". Allowed: open / closed / liquidated.`,
        );
      }
      continue;
    }
    if (k === "positionId") {
      if (v && UUID_RE.test(v)) extras.positionId = v;
      continue;
    }
    if ((PASSTHROUGH_KEYS as readonly string[]).includes(k)) {
      if (v) (extras as Record<string, string>)[k] = v;
      continue;
    }
    // Strip optional v5 fields that are blank — Zod's `.optional()` doesn't
    // accept `""`, only `undefined`. Empty strings show up because the wizard
    // emits every named input regardless of whether the user touched it.
    if (
      [
        "leverage",
        "marginMode",
        "targetPrice",
        "stopPrice",
        "exitPlan",
        "feesEntry",
        "feesExit",
        "fundingPaidUsd",
        "fundingReceivedUsd",
        "borrowCostUsd",
        "fees",
        "note",
      ].includes(k)
    ) {
      if (v) body[k] = v;
      continue;
    }
    body[k] = v;
  }
  return { body, extras };
}

/**
 * Server action for the trade wizard's final submit. Validates the FormData,
 * dispatches to create- or update-from-wizard, and redirects to the new
 * detail page. On any validation/DB failure, redirects back to /review with
 * the error URL-encoded so the page can surface it inline.
 *
 * Edit mode: when `edit=<uuid>` is in the FormData, dispatches to
 * updateTradeFromWizard. The redirect target is
 * `/trades/<id>?from=wizard&action=edited` which the preview banner picks up.
 */
export async function logTrade(formData: FormData): Promise<void> {
  let activityId: string | null = null;
  let isEdit = false;
  let redirectError: string | null = null;

  const editRaw = formData.get("edit");
  const editId =
    typeof editRaw === "string" && UUID_RE.test(editRaw) ? editRaw : null;

  // Capture cleaned payload BEFORE auth so an unexpected throw still rides
  // through the redirect query string with all inputs intact.
  const cleanedRaw: Record<string, string> = Object.fromEntries(
    stripNextInternals([...formData.entries()]).filter(([k]) => k !== "edit"),
  ) as Record<string, string>;

  try {
    const { id: userId } = await requireUser();
    const { body, extras } = partitionExtras(cleanedRaw);

    const input = CreateTradeBody.parse(body);
    const extended: ExtendedTradeInput = { ...input, ...extras };

    if (editId) {
      isEdit = true;
      const ok = await updateTradeFromWizard(userId, editId, extended);
      if (!ok) throw new Error("Trade not found or not owned by you");
      activityId = editId;
    } else {
      const { id } = await createTradeFromWizard(userId, extended);
      activityId = id;
    }
  } catch (e) {
    redirectError = e instanceof Error ? e.message : String(e);
  }

  // redirect() throws an internal signal Next intercepts — must live outside
  // the try/catch or it never actually navigates.
  if (activityId) {
    // Invalidate the unified-feed pages so the new/edited trade shows up
    // immediately on next navigation. revalidatePath must run BEFORE redirect.
    revalidatePath("/spreads");
    revalidatePath("/spreads/archive");
    revalidatePath("/trades");
    const qs = isEdit ? "from=wizard&action=edited" : "from=wizard";
    redirect(`/trades/${activityId}?${qs}`);
  } else {
    const qs = new URLSearchParams({
      error: redirectError ?? "Unknown error logging trade",
      ...cleanedRaw,
      ...(editId ? { edit: editId } : {}),
    }).toString();
    redirect(`/add/trade/review?${qs}`);
  }
}
