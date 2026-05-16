"use server";

import { redirect } from "next/navigation";

/**
 * Stub server action for v1. Logs the payload to the server console and
 * redirects to a spread detail page so the wizard's "submit" feels complete.
 * Real persistence (insert into `activity` + `activity_spread`, link legs,
 * trigger postmortem flow) lands when the API routes go through the new
 * `activity` supertype schema.
 *
 * The redirect target reuses an existing fixture id (`sp-032` — the BTC
 * cash-and-carry funding-version) so the new dynamic detail page renders
 * real data on success. When real DB writes land, this becomes the new
 * row's UUID.
 */
export async function logSpread(formData: FormData): Promise<void> {
  const payload = Object.fromEntries(formData.entries());
  // eslint-disable-next-line no-console
  console.log("[logSpread] would persist:", payload);

  const newSpreadId = "sp-032";
  redirect(`/spreads/${newSpreadId}`);
}
