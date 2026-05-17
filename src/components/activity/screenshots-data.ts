/**
 * Server-side shim that adapts the satellite ScreenshotRow into the client-
 * facing ScreenshotItem shape used by <ScreenshotsSection>.
 *
 * Kept separate from the client component so the satellite types (which pull
 * in postgres.js + branded ActivityId) never leak into the client bundle.
 */
import type { ScreenshotRow } from '@/lib/db/satellite';
import type { ScreenshotItem } from '@/components/activity/screenshots-section';

export function toScreenshotItems(
  rows: readonly ScreenshotRow[],
): ScreenshotItem[] {
  return rows.map((r) => ({
    id: r.id,
    side: r.side,
    storageKey: r.storageKey,
    originalWidth: r.originalWidth,
    originalHeight: r.originalHeight,
    caption: r.caption,
    annotationState: r.annotationState ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}
