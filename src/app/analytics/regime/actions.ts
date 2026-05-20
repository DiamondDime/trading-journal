"use server";

import { requireUser } from "@/lib/auth/server";
import {
  listUntaggedActivitiesForRegime,
  applyRegimeTagBulk,
  type UntaggedActivityRow,
} from "@/lib/db/activity";
import { revalidatePath } from "next/cache";

/** Fetch all activities that have no regime tag for the current user. */
export async function fetchUntaggedActivities(): Promise<UntaggedActivityRow[]> {
  const { id: userId } = await requireUser();
  return listUntaggedActivitiesForRegime(userId);
}

interface ApplyBulkTagResult {
  ok: boolean;
  updated: number;
  error?: string;
}

/**
 * Apply a regime tag to the given activity IDs. The tag is merged into the
 * existing regime_tags array (union — does not wipe other tags).
 * Revalidates the regime page so the server-rendered count updates.
 */
export async function applyBulkRegimeTag(
  activityIds: readonly string[],
  tag: string,
): Promise<ApplyBulkTagResult> {
  if (!tag.trim()) {
    return { ok: false, updated: 0, error: "Tag is required" };
  }
  if (tag.trim().length > 60) {
    return { ok: false, updated: 0, error: "Tag must be 60 characters or fewer" };
  }
  if (activityIds.length === 0) {
    return { ok: false, updated: 0, error: "No activities selected" };
  }

  try {
    const { id: userId } = await requireUser();
    const updated = await applyRegimeTagBulk(userId, activityIds, tag.trim());
    revalidatePath("/analytics/regime");
    return { ok: true, updated };
  } catch (e) {
    return {
      ok: false,
      updated: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
