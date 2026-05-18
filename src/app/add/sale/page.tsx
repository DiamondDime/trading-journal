import { redirect } from "next/navigation";

// Read searchParams per-request (edit flag flows through), so static prerender
// has nothing to cache. Master plan §0 calls out that every wizard step that
// reads searchParams must opt out of static rendering.
export const dynamic = "force-dynamic";

type Search = Promise<{ [key: string]: string | string[] | undefined }>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * /add/sale entry point. Routes to the right starting step:
 *   - new sale  → /add/sale/kind (step 1: sub-kind picker)
 *   - edit sale → /add/sale/fields?edit=<uuid> (skip kind picker; it's
 *     already known and the wizard's pre-fill path loads it from the row)
 *
 * Keeps the URL the user lands on (/add/sale) stable while the underlying
 * step layout grew from 2 steps (fields → review) to 3 (kind → fields →
 * review) in v5.
 */
export default async function SaleEntryPage(props: { searchParams: Search }) {
  const sp = await props.searchParams;
  const edit = sp.edit;
  const editId =
    typeof edit === "string" && UUID_RE.test(edit) ? edit : null;
  if (editId) {
    redirect(`/add/sale/fields?edit=${editId}`);
  }
  redirect("/add/sale/kind");
}
