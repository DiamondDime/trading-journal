import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * /options redirects to the unified activity archive filtered to option
 * activities. Single source of truth for list views is /spreads/archive;
 * this entry exists so deep links / nav from the sidebar resolve naturally.
 */
export default function OptionsIndexPage() {
  redirect("/spreads/archive?activity=option");
}
