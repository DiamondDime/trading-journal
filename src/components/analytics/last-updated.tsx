/**
 * "Last updated" mono caption rendered in the bottom-right of every analytics
 * page. Since the pages are `dynamic = 'force-dynamic'` and recompute on
 * every request, the timestamp is `now()` formatted in the server's local TZ.
 *
 * Server component — value is captured at render time.
 */
function fmtNow(): string {
  const d = new Date();
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function LastUpdatedFooter() {
  return (
    <footer className="mt-10 flex items-center justify-between border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
      <span>crypto journal · analytics</span>
      <span>Last updated · {fmtNow()}</span>
    </footer>
  );
}
