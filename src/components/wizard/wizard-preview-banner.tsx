// Renders the small "Just saved" banner on a detail page when the user has
// just landed there from a wizard submit. The actions append `?from=wizard`
// to the redirect so we can tell.
//
// Post-Wave 5A: DB writes are real, so the banner's job is to acknowledge a
// successful save and prompt the user to edit / add notes from here. Same
// warn-toned visual treatment so it stays a "transient nav signal" rather
// than persistent UI chrome.
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
        Just saved
      </span>
      {" — "}
      <span className="font-serif italic">
        this is your new record. Edit or add notes from here.
      </span>
    </aside>
  );
}
