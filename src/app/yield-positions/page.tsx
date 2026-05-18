import { redirect } from "next/navigation";

/**
 * Index page for yield positions. The unified activity feed already filters
 * by type, so we redirect to /spreads/archive?activity=yield_position rather
 * than duplicate the listing UI. Same pattern as /airdrops, /sales, /trades.
 */
export default function YieldPositionsAliasPage() {
  redirect("/spreads/archive?activity=yield_position");
}
