import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * /add/option lands on /add/option/source — the canonical entry to the
 * option wizard. Kept as a thin redirect so direct hits, breadcrumbs, and
 * stale bookmarks resolve cleanly.
 */
export default function OptionAddIndexPage() {
  redirect("/add/option/source");
}
