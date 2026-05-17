import { redirect } from "next/navigation";

/**
 * The /analytics root route redirects to /analytics/track-record — the
 * canonical first page in the suite. This keeps the sub-nav highlight from
 * ambiguity (no "All" tab) and matches how /spreads currently fronts the
 * default analytics view.
 */
export default function AnalyticsIndex(): never {
  redirect("/analytics/track-record");
}
