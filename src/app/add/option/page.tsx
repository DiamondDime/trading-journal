import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * /add/option redirects straight to /add/option/kind — the source step was
 * removed in v5 because manual entry is the only supported path.
 */
export default function OptionAddIndexPage() {
  redirect("/add/option/kind");
}
