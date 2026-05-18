import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * /add/yield redirects straight to /add/yield/kind — the source step was
 * removed in v5 because manual entry is the only supported path.
 */
export default function YieldAddIndexPage() {
  redirect("/add/yield/kind");
}
