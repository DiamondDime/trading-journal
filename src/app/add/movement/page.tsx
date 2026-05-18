import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * /add/movement lands on /add/movement/kind — matches the redirect pattern
 * the other activity wizards already follow so direct hits and stale
 * bookmarks resolve cleanly instead of 404'ing.
 */
export default function MovementAddIndexPage() {
  redirect("/add/movement/kind");
}
