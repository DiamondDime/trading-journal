"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/server";
import { createTrade, updateTradeActivity } from "@/lib/db/activity";
import { CreateTradeBody } from "@/lib/db/zod-schemas";

// Next.js's server-action machinery injects internal keys like
// `$ACTION_ID_*` into the FormData. Strip them before Zod parsing since the
// create-body schemas use `.strict()` which would otherwise 400 the request.
function stripNextInternals(entries: [string, FormDataEntryValue][]): [string, FormDataEntryValue][] {
  return entries.filter(([k]) => !k.startsWith("$ACTION_"));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mirror of activity.ts mapExchangeLabelToCode. Kept in sync by hand. */
function mapExchangeLabelToCode(label: string): string {
  const map: Record<string, string> = {
    Binance: "binance",
    Bybit: "bybit",
    Hyperliquid: "hyperliquid",
    Coinbase: "kraken",
    OKX: "okx",
    Other: "binance",
  };
  return map[label] ?? "binance";
}

function deriveTradeName(symbol: string, side: string, instrument: string): string {
  const base = symbol.split(/[-/_]/)[0] || symbol;
  return `${base} ${side} · ${instrument}`;
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
 * Edit mode: when `edit=<uuid>` is in the FormData, the action dispatches
 * to updateTradeActivity instead of createTrade. The redirect target is
 * `/trades/<id>?from=wizard&action=edited` which the preview banner
 * picks up.
 */
export async function logTrade(formData: FormData): Promise<void> {
  let activityId: string | null = null;
  let isEdit = false;
  let redirectError: string | null = null;

  // Pull `edit` out separately so CreateTradeBody (which is .strict()) doesn't
  // see it. The body schema validates the field payload, not the edit flag.
  const editRaw = formData.get("edit");
  const editId = typeof editRaw === "string" && UUID_RE.test(editRaw) ? editRaw : null;

  // Capture the cleaned FormData payload BEFORE the auth call so that an
  // auth error (or any other unexpected throw) still has the form fields
  // available to round-trip via the redirect query string. Without this,
  // a failure in requireUser() would surface the wizard back at /review
  // with all inputs blanked out.
  const cleanedRaw: Record<string, string> = Object.fromEntries(
    stripNextInternals([...formData.entries()]).filter(([k]) => k !== "edit"),
  ) as Record<string, string>;
  try {
    const { id: userId } = await requireUser();
    const input = CreateTradeBody.parse(cleanedRaw);

    if (editId) {
      isEdit = true;
      // Recompute the same derived aggregates createTrade does, so the parent
      // activity row stays consistent with the subtype row.
      const opened = new Date(input.openedAt).toISOString();
      const closed = new Date(input.closedAt).toISOString();
      const qty = Number(input.qty);
      const entry = Number(input.entryPrice);
      const exit = Number(input.exitPrice);
      const capital = Number(input.capital);
      const fees = Number(input.fees ?? "0");
      const dir = input.side === "short" ? -1 : 1;
      const gross = qty * (exit - entry) * dir;
      const net = gross - fees;
      const daysHeld = (new Date(closed).getTime() - new Date(opened).getTime()) / 86_400_000;
      const realizedApr =
        capital > 0 && daysHeld > 0 ? (net / capital) * (365 / daysHeld) : null;
      const exchangeCode = mapExchangeLabelToCode(input.exchange);
      const instrumentKind = input.instrument === "future" ? "dated_future" : input.instrument;

      const ok = await updateTradeActivity(
        userId,
        editId,
        {
          name: deriveTradeName(input.symbol, input.side, input.instrument),
          regimeTags: input.regimeTags as string[],
          openedAt: opened,
          closedAt: closed,
          capitalDeployedUsd: capital.toString(),
          realizedPnlUsd: gross.toString(),
          feesUsd: fees.toString(),
          netPnlUsd: net.toString(),
        },
        {
          symbol: input.symbol,
          exchange: exchangeCode,
          instrumentKind,
          side: input.side,
          entryThesis: input.note || null,
          qty: qty.toString(),
          avgEntryPrice: entry.toString(),
          avgExitPrice: exit.toString(),
          realizedApr: realizedApr !== null ? realizedApr.toString() : null,
        },
      );
      if (!ok) throw new Error("Trade not found or not owned by you");
      activityId = editId;
    } else {
      const { id } = await createTrade(userId, input);
      activityId = id;
    }
  } catch (e) {
    redirectError = e instanceof Error ? e.message : String(e);
  }

  // Redirect must live outside try/catch: `redirect()` throws an internal
  // signal that Next intercepts; if it's caught it never actually navigates.
  if (activityId) {
    // Invalidate the dashboard + archive's cached render so the new/edited
    // activity shows up immediately on next navigation. revalidatePath must
    // run BEFORE redirect() — redirect throws, so any call after it dies.
    revalidatePath("/spreads");
    revalidatePath("/spreads/archive");
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
