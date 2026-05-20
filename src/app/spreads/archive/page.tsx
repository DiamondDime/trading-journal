import { Suspense } from "react";
import { ArchiveBrowser } from "@/components/spread/archive-browser";
import { requireUser } from "@/lib/auth/server";
import { listActivitiesWithMeta } from "@/lib/data/db-queries";
import { feedRowsToActivities } from "@/lib/data/db-adapter";
import { ListRowsSkeleton } from "@/components/list-rows-skeleton";

// Server component: fetch every non-deleted activity, plus subtype meta,
// and hand a fixture-shaped Activity[] to the client ArchiveBrowser.
//
// 200 is the wide upper bound — for a single-user journal this is fine.
// The chip-filtering / search / sort happens client-side on the full set.
export const dynamic = "force-dynamic";

export default async function ArchivePage() {
  const { id: userId } = await requireUser();
  const { rows, meta } = await listActivitiesWithMeta(userId, {
    sortField: "closed_at",
    sortDir: "desc",
    limit: 200,
  });
  const data = feedRowsToActivities(rows, meta);

  return (
    <Suspense fallback={<ListRowsSkeleton variant="archive" />}>
      <ArchiveBrowser data={data} />
    </Suspense>
  );
}
