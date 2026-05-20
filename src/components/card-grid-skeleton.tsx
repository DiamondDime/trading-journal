/**
 * CardGridSkeleton — shimmer placeholder for card-grid views (saved views
 * page). Renders a page header area plus a 2-column card grid. Pure Tailwind
 * animate-pulse, no global CSS.
 */

interface CardGridSkeletonProps {
  /** Number of cards to show (default 4). */
  cards?: number;
}

export function CardGridSkeleton({ cards = 4 }: CardGridSkeletonProps) {
  return (
    <div className="animate-pulse px-8 py-10 lg:px-12" aria-hidden="true">
      {/* Page header */}
      <div className="mb-8 flex items-center justify-between border-b border-border pb-6">
        <div className="flex flex-col gap-2">
          <div className="h-3 w-16 rounded bg-border" />
          <div className="h-7 w-48 rounded bg-border" />
          <div className="h-4 w-64 rounded bg-border/60" />
        </div>
        {/* "New view" button placeholder */}
        <div className="h-9 w-28 rounded-md bg-border" />
      </div>

      {/* Card grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {Array.from({ length: cards }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col gap-3 rounded-lg border border-border/60 bg-surface p-5"
          >
            {/* Card header: icon + title */}
            <div className="flex items-start justify-between">
              <div className="flex flex-col gap-1.5">
                <div className="h-4 w-36 rounded bg-border" />
                <div className="h-3 w-52 rounded bg-border/60" />
              </div>
              <div className="flex gap-2">
                <div className="h-6 w-6 rounded bg-border/50" />
                <div className="h-6 w-6 rounded bg-border/50" />
              </div>
            </div>

            {/* Activity count */}
            <div className="mt-1 flex items-center gap-2">
              <div className="h-6 w-10 rounded bg-border" />
              <div className="h-3 w-24 rounded bg-border/50" />
            </div>

            {/* Footer: last viewed + open link */}
            <div className="mt-auto flex items-center justify-between pt-3 border-t border-border/40">
              <div className="h-3 w-28 rounded bg-border/40" />
              <div className="h-3 w-16 rounded bg-border/60" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
