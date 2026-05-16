/**
 * Picker-only layout override.
 *
 * The default `/add` layout caps content at `max-w-3xl` (~768px) — perfect
 * for the form-shaped wizard steps but too narrow for the two-pane picker.
 * Rather than thread a width prop through the shell, this nested layout
 * widens the column just for the pick step. Other Spread wizard steps
 * (source / type / fields / review) keep the narrow column.
 *
 * Technique: the parent layout centers its child in a 768px column. We use
 * a left:50% / translate-x trick to break out of that column on lg+ screens
 * back to a 1200px viewport-relative width. On smaller screens we fall back
 * to the parent column (a stacked single-column layout reads fine there).
 *
 * Important: this is a *plain* layout — it does NOT re-render the wizard
 * top-bar (that lives in `/add/layout.tsx` and wraps this one).
 */
export default function SpreadPickerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="lg:relative lg:left-1/2 lg:right-1/2 lg:w-[min(1200px,calc(100vw-3rem))] lg:-translate-x-1/2">
      {children}
    </div>
  );
}
