import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * /add/spread lands on /add/spread/source — the canonical entry to the
 * spread wizard. Kept as a thin redirect so direct hits, breadcrumbs, and
 * stale bookmarks resolve cleanly (and to match the pattern other activity
 * wizards already follow).
 */
export default function SpreadAddIndexPage() {
  redirect("/add/spread/source");
}
