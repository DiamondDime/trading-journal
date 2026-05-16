"use server";

import { redirect } from "next/navigation";

/**
 * Stub server action for v1. Logs the payload to the server console and
 * redirects to the freshly-created sale's detail page. Real persistence
 * lives in Chunk 5+ when API routes go through `activity_sale`.
 *
 * The redirect target uses the placeholder id `sa-003` (the most recent
 * fixture sale) so the detail page renders meaningfully. When the real
 * DB write lands, this becomes the new row's UUID.
 */
export async function logSale(formData: FormData): Promise<void> {
  const payload = Object.fromEntries(formData.entries());
  // eslint-disable-next-line no-console
  console.log("[logSale] would persist:", payload);

  // Fixtures have ids sa-001..sa-003. Reuse the most recent one so the
  // detail page renders real data on success. When persistence is wired,
  // this becomes the new row's UUID.
  const newSaleId = "sa-003";
  redirect(`/sales/${newSaleId}`);
}
