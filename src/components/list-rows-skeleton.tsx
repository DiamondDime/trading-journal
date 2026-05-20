/**
 * ListRowsSkeleton — shimmer placeholder for table-style feeds (archive,
 * notes). Renders a toolbar-shaped strip plus N rows that mimic the column
 * layout of the real list. Pure Tailwind animate-pulse, no global CSS.
 */

interface ListRowsSkeletonProps {
  /** Number of shimmer rows to show (default 8). */
  rows?: number;
  /** Show a 3-column layout (archive) vs 2-column (notes). Default: "archive". */
  variant?: "archive" | "notes";
}

export function ListRowsSkeleton({
  rows = 8,
  variant = "archive",
}: ListRowsSkeletonProps) {
  return (
    <div className="animate-pulse px-8 py-8 lg:px-12" aria-hidden="true">
      {/* Toolbar strip: search bar + filter chips */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="h-8 w-52 rounded-md bg-border" />
        <div className="h-7 w-20 rounded-full bg-border" />
        <div className="h-7 w-24 rounded-full bg-border" />
        <div className="h-7 w-16 rounded-full bg-border" />
        <div className="ml-auto h-7 w-28 rounded-md bg-border" />
      </div>

      {/* Column header row */}
      <div
        className={`mb-2 flex items-center gap-4 px-3 ${
          variant === "archive" ? "grid grid-cols-5" : "grid grid-cols-3"
        }`}
      >
        {variant === "archive" ? (
          <>
            <div className="h-3 w-14 rounded bg-border" />
            <div className="h-3 w-20 rounded bg-border" />
            <div className="h-3 w-16 rounded bg-border" />
            <div className="h-3 w-14 rounded bg-border" />
            <div className="h-3 w-12 rounded bg-border" />
          </>
        ) : (
          <>
            <div className="col-span-2 h-3 w-24 rounded bg-border" />
            <div className="h-3 w-16 rounded bg-border" />
          </>
        )}
      </div>

      {/* Data rows */}
      <div className="flex flex-col divide-y divide-border/40">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className={`flex items-center gap-4 py-3.5 px-3 ${
              variant === "archive" ? "grid grid-cols-5" : "grid grid-cols-3"
            }`}
          >
            {variant === "archive" ? (
              <>
                {/* Type badge + asset */}
                <div className="flex items-center gap-2">
                  <div className="h-5 w-12 rounded bg-border" />
                  <div className="h-4 w-16 rounded bg-border/60" />
                </div>
                {/* Date */}
                <div className="h-4 w-24 rounded bg-border/60" />
                {/* Net P&L */}
                <div
                  className={`h-4 rounded bg-border/60 ${i % 3 === 0 ? "w-20" : "w-16"}`}
                />
                {/* Capital */}
                <div className="h-4 w-20 rounded bg-border/60" />
                {/* Days */}
                <div className="h-4 w-10 rounded bg-border/60" />
              </>
            ) : (
              <>
                {/* Title + excerpt */}
                <div className="col-span-2 flex flex-col gap-1.5">
                  <div className="h-4 w-3/4 rounded bg-border" />
                  <div className="h-3 w-full rounded bg-border/50" />
                </div>
                {/* Tags + date */}
                <div className="flex flex-col items-end gap-1.5">
                  <div className="h-3 w-20 rounded bg-border/60" />
                  <div className="h-3 w-14 rounded bg-border/40" />
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
