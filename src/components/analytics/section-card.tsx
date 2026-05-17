/**
 * Editorial section card — bordered, serif heading row, optional caption.
 * Used as the wrapper for every analytics chart / table so the page chrome
 * stays consistent across the three routes.
 *
 * Server component (no client hooks) — safe to compose inside any tree.
 */

interface SectionCardProps {
  title: string;
  caption?: string;
  /** Right-aligned meta text in mono. */
  meta?: React.ReactNode;
  /** Padding on the body. Set `padless` for charts that own their padding. */
  padless?: boolean;
  children: React.ReactNode;
}

export function SectionCard({
  title,
  caption,
  meta,
  padless = false,
  children,
}: SectionCardProps) {
  return (
    <section className="rounded-md border border-border bg-surface">
      <header className="flex flex-col gap-1 border-b border-border px-6 py-4 md:flex-row md:items-baseline md:justify-between">
        <div>
          <h3 className="font-serif text-[13px] font-semibold uppercase tracking-[0.16em] text-text">
            {title}
          </h3>
          {caption && (
            <p className="mt-1 font-serif text-[12px] italic leading-snug text-text-tertiary">
              {caption}
            </p>
          )}
        </div>
        {meta && (
          <span className="font-mono text-[11px] tabular-nums text-text-tertiary">
            {meta}
          </span>
        )}
      </header>
      <div className={padless ? "" : "p-6"}>{children}</div>
    </section>
  );
}
