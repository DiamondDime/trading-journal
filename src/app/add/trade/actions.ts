"use server";

import { redirect } from "next/navigation";

/**
 * Stub server action for v1. Logs the payload to the server console and
 * redirects to the freshly-created trade's detail page. Real persistence
 * lives in Chunk 5+ when API routes go through `activity_trade`.
 *
 * The redirect target uses the placeholder id `tr-005` (the most recent
 * fixture trade) so the detail page renders meaningfully. When the real
 * DB write lands, this becomes the new row's UUID.
 */
export async function logTrade(formData: FormData): Promise<void> {
  // Server-side trace so dev can see the payload until DB writes land.
  const payload = Object.fromEntries(formData.entries());
  // eslint-disable-next-line no-console
  console.log("[logTrade] would persist:", payload);

  // Fixtures have ids tr-001..tr-005. Reuse the most recent one so the
  // detail page renders real data on success. When persistence is wired,
  // this becomes the new row's UUID.
  const newTradeId = "tr-005";
  redirect(`/trades/${newTradeId}`);
}
