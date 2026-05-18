import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * /add/trade lands on /add/trade/source — the canonical entry to the
 * trade wizard. Kept as a thin redirect so direct hits, breadcrumbs, and
 * stale bookmarks resolve cleanly (and to match the pattern other activity
 * wizards already follow).
 */
export default function TradeAddIndexPage() {
  redirect("/add/trade/source");
}
