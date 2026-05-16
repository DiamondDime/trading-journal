"use server";

import { redirect } from "next/navigation";

/**
 * Stub server action for v1. Logs the payload to the server console and
 * redirects to the freshly-created airdrop's detail page. Real persistence
 * lives in Chunk 5+ when API routes go through `activity_airdrop`.
 *
 * The redirect target uses the placeholder id `ad-003` (the most recent
 * fixture airdrop) so the detail page renders meaningfully. When the real
 * DB write lands, this becomes the new row's UUID.
 */
export async function logAirdrop(formData: FormData): Promise<void> {
  const payload = Object.fromEntries(formData.entries());
  // eslint-disable-next-line no-console
  console.log("[logAirdrop] would persist:", payload);

  const newAirdropId = "ad-003";
  redirect(`/airdrops/${newAirdropId}?from=wizard`);
}
