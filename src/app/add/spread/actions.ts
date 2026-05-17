"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db/client";
import { requireUser } from "@/lib/auth/server";
import { updateSpreadActivity } from "@/lib/db/activity";

function stripNextInternals(entries: [string, FormDataEntryValue][]): [string, FormDataEntryValue][] {
  return entries.filter(([k]) => !k.startsWith("$ACTION_"));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MATCHER_TO_DB_TYPE: Record<string, string> = {
  cash_carry: "cash_carry",
  funding: "funding_capture",
  cross_exchange: "cross_exchange_perp_arb",
  calendar: "calendar",
  dex_cex: "dex_cex_arb",
};

// chk_spread_variant only permits variant on cash_carry (funding|basis) and
// funding_capture (same_venue|cross_venue). Map the wizard's display variant
// string into one of those canonical values, or NULL when the spread type
// doesn't take a variant.
function mapVariantToCanonical(dbSpreadType: string, raw: string): string | null {
  const v = raw.toLowerCase();
  if (dbSpreadType === "cash_carry") {
    if (v.includes("basis")) return "basis";
    if (v.includes("funding") || v === "") return "funding";
    return "funding";
  }
  if (dbSpreadType === "funding_capture") {
    if (v.includes("cross")) return "cross_venue";
    return "same_venue";
  }
  return null;
}

/**
 * Server action for the spread wizard's final submit.
 *
 * Spread legs in v1 require real Position rows (the activity_spread schema
 * is built around the fill-matcher pipeline). The wizard operates on
 * exchange-fill MOCK ids, so we can't insert legs without materializing
 * positions first. This action takes the pragmatic path:
 *
 *   - Insert activity (supertype) with the wizard's manual numbers
 *   - Insert activity_spread (subtype) with spread-type metadata
 *   - SKIP spread_legs — legs become first-class once the worker pipeline
 *     materializes real Positions (Wave 5C / Wave 6).
 *
 * The DEFERRABLE activity_subtype_check trigger still fires at COMMIT,
 * which is satisfied by the activity_spread row. The detail page renders
 * the supertype + subtype fields directly; legs section will fill in when
 * real positions exist.
 *
 * Edit mode: when `edit=<uuid>` is in the FormData, the action dispatches
 * to updateSpreadActivity. Redirect adds `action=edited`.
 */
export async function logSpread(formData: FormData): Promise<void> {
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
    const raw = cleanedRaw;

    const name = (raw.name ?? "").trim();
    const rawVariant = (raw.variant ?? "").trim();
    const spreadTypeMatcher = (raw.spreadType ?? "").trim();
    const dbSpreadType = MATCHER_TO_DB_TYPE[spreadTypeMatcher] ?? "custom";
    const variant = mapVariantToCanonical(dbSpreadType, rawVariant);
    const capital = parseDecOrNull(raw.capital);
    const netPnl = parseDecOrNull(raw.netPnl);
    const openedAt = raw.openedAt ? new Date(raw.openedAt).toISOString() : null;
    const closedAt = raw.closedAt ? new Date(raw.closedAt).toISOString() : null;
    const regimeTags = (raw.regimeTags ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const thesis = (raw.thesis ?? "").trim() || null;

    // Derive primary_base from name's first space-separated token (e.g.
    // "BTC cash-and-carry · Binance + Coinbase" → "BTC"). Falls back to "—".
    const primaryBase = (name.split(/[\s·-]/)[0] || "—").toUpperCase();

    if (!name) throw new Error("Spread name is required");
    if (closedAt && openedAt && new Date(closedAt) < new Date(openedAt)) {
      throw new Error("closed_at must be >= opened_at");
    }

    if (editId) {
      isEdit = true;
      const ok = await updateSpreadActivity(
        userId,
        editId,
        {
          name,
          regimeTags,
          openedAt,
          closedAt,
          capitalDeployedUsd: capital,
          realizedPnlUsd: netPnl,
          netPnlUsd: netPnl,
        },
        {
          spreadType: dbSpreadType,
          variant,
          primaryBase,
          exitPlan: thesis,
        },
      );
      if (!ok) throw new Error("Spread not found or not owned by you");
      activityId = editId;
    } else {
      activityId = await sql.begin(async (tx) => {
        const [activity] = await tx<{ id: string }[]>`
          INSERT INTO public.activity (
            user_id, type, status, name,
            opened_at, closed_at,
            capital_deployed_usd, realized_pnl_usd, fees_usd, net_pnl_usd,
            regime_tags, custom_tags
          ) VALUES (
            ${userId}::uuid, 'spread', 'closed',
            ${name},
            ${openedAt}::timestamptz, ${closedAt}::timestamptz,
            ${capital ?? null}, ${netPnl ?? null}, '0', ${netPnl ?? null},
            ${regimeTags}::text[], ${[] as string[]}::text[]
          )
          RETURNING id
        `;

        await tx`
          INSERT INTO public.activity_spread (
            activity_id, spread_type, variant, origin, source,
            primary_base, leg_count,
            exit_plan
          ) VALUES (
            ${activity.id}::uuid, ${dbSpreadType}, ${variant || null},
            'manual', 'user',
            ${primaryBase}, 0,
            ${thesis}
          )
        `;

        return activity.id;
      });
    }
  } catch (e) {
    redirectError = e instanceof Error ? e.message : String(e);
  }

  if (activityId) {
    // Invalidate dashboard + archive: see trade/actions.ts for the order rule
    // (revalidatePath runs before redirect because redirect throws).
    revalidatePath("/spreads");
    revalidatePath("/spreads/archive");
    const qs = isEdit ? "from=wizard&action=edited" : "from=wizard";
    redirect(`/spreads/${activityId}?${qs}`);
  } else {
    const qs = new URLSearchParams({
      error: redirectError ?? "Unknown error logging spread",
      ...cleanedRaw,
      ...(editId ? { edit: editId } : {}),
    }).toString();
    redirect(`/add/spread/review?${qs}`);
  }
}

// Money / qty fields are kept as strings end-to-end (see CLAUDE.md
// "Decimals as strings"). Validate the shape via regex; only return null on a
// missing or syntactically invalid value. Coercing through Number() would
// drop precision on large numerics (e.g. token qty in scientific range).
const DECIMAL_RE = /^-?\d+(\.\d+)?$/;
function parseDecOrNull(s: string | undefined): string | null {
  if (!s) return null;
  const trimmed = s.trim();
  if (!DECIMAL_RE.test(trimmed)) return null;
  return trimmed;
}
