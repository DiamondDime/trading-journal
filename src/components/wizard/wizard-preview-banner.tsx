// Renders the small "Preview" banner on a detail page when the user just
// landed there from a wizard submit (the actions append `?from=wizard` so we
// can tell). Tells the user their activity isn't persisted yet — DB writes
// land in Phase 5 — and that the page below is the closest matching
// fixture record.
//
// Render policy: only show when the `from` searchParam equals `"wizard"`.
// Render nothing otherwise so deep-links to detail pages stay clean.

export function WizardPreviewBanner({ from }: { from?: string }) {
  if (from !== "wizard") return null;
  return (
    <aside
      className="mx-auto mb-6 max-w-4xl rounded-md border border-warn/30 bg-warn/5 px-4 py-2.5 text-[12px] text-warn"
      role="status"
    >
      <span className="font-semibold uppercase tracking-[0.14em] text-[10px]">
        Preview
      </span>
      {" — "}
      <span className="font-serif italic">
        Your activity isn&apos;t persisted yet — DB writes land in Phase 5.
        This is the closest matching fixture record.
      </span>
    </aside>
  );
}
