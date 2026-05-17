/**
 * /views — CRUD over the user's saved archive bookmarks.
 *
 * Each saved view is a named pointer to an archive URL like
 *   /spreads/archive?activity=trade&outcome=winners
 *
 * Server component: fetches the list + the live activity counts for each
 * view, then hands a client component the rows + a "prefillFrom" URL passed
 * in the query string (from the archive's "Save this view" link).
 *
 * The "activities count" for each view is computed lazily on render with a
 * cap at 200 — see countActivitiesForView in src/lib/db/saved-views.ts. For
 * a single-user journal with O(10) saved views and O(1k) total activities,
 * this is well under 30 ms end-to-end.
 */
import { Suspense } from "react";
import { requireUser } from "@/lib/auth/server";
import {
  listSavedViews,
  countActivitiesForView,
  type SavedViewRow,
} from "@/lib/db/saved-views";
import { ViewsBrowser } from "@/components/views/views-browser";

export const dynamic = "force-dynamic";

interface ViewsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export interface ViewWithCount extends SavedViewRow {
  activitiesCount: number;
  activitiesCountCapped: boolean;
}

export default async function ViewsPage({ searchParams }: ViewsPageProps) {
  const { id: userId } = await requireUser();
  const sp = await searchParams;
  const prefillFrom =
    typeof sp.prefillFrom === "string" ? sp.prefillFrom : undefined;

  const views = await listSavedViews(userId);

  // Fan out the per-view count queries. The cap is internal; LIMIT 201 keeps
  // each call O(<1ms) for typical journals.
  const counts = await Promise.all(
    views.map((v) =>
      v.queryString
        ? countActivitiesForView(userId, { queryString: v.queryString })
        : Promise.resolve({ count: 0, capped: false }),
    ),
  );

  const enriched: ViewWithCount[] = views.map((v, i) => ({
    ...v,
    activitiesCount: counts[i].count,
    activitiesCountCapped: counts[i].capped,
  }));

  return (
    <Suspense fallback={null}>
      <ViewsBrowser initialViews={enriched} prefillFrom={prefillFrom} />
    </Suspense>
  );
}
