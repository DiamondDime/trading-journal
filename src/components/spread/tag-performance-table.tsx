import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtUsd } from "@/lib/data/archive-data";
import type { TagAggregation } from "@/lib/db/satellite";

interface TagPerformanceTableProps {
  /** Server-fetched aggregations, already sorted by count desc, tag asc. */
  rows: readonly TagAggregation[];
  /** Cap how many tags are shown in the table. The total count is shown
   *  separately so the trader knows there's more behind a "…N more" hint. */
  topN?: number;
}

/**
 * "Performance by tag" table — dashboard section.
 *
 * Layout (in serif/mono dialect of the rest of the dashboard):
 *
 *   Tag (serif) | Count (mono) | Avg P&L (mono signed) | Profit factor (mono) | Win rate (mono %)
 *
 * Empty state is handled by the caller — when `rows` is empty, the parent
 * keeps the existing "tag your trades" placeholder. This table is only
 * rendered when there's data to show.
 */
export function TagPerformanceTable({
  rows,
  topN = 10,
}: TagPerformanceTableProps) {
  const visible = rows.slice(0, topN);
  const overflow = Math.max(0, rows.length - visible.length);

  return (
    <div className="overflow-hidden rounded-md border border-border bg-surface">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead scope="col" className="text-text-tertiary">
              Tag
            </TableHead>
            <TableHead
              scope="col"
              className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary"
            >
              Count
            </TableHead>
            <TableHead
              scope="col"
              className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary"
            >
              Avg P&amp;L
            </TableHead>
            <TableHead
              scope="col"
              className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary"
            >
              Profit factor
            </TableHead>
            <TableHead
              scope="col"
              className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary"
            >
              Win rate
            </TableHead>
            <TableHead
              scope="col"
              className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary"
            >
              Total
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((r) => {
            const avgTone =
              r.avgPnl > 0 ? "text-up" : r.avgPnl < 0 ? "text-down" : "text-text";
            const totalTone =
              r.totalPnl > 0
                ? "text-up"
                : r.totalPnl < 0
                  ? "text-down"
                  : "text-text";
            return (
              <TableRow key={r.tag} className="hover:bg-inset/40">
                <TableCell className="font-serif text-[14px] text-text">
                  {r.tag}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums text-text-secondary">
                  {r.count}
                </TableCell>
                <TableCell
                  className={`text-right font-mono tabular-nums ${avgTone}`}
                >
                  {fmtUsd(r.avgPnl, true)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums text-text-secondary">
                  {r.profitFactor == null
                    ? "—"
                    : r.profitFactor.toFixed(2)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums text-text-secondary">
                  {(r.winRate * 100).toFixed(0)}%
                </TableCell>
                <TableCell
                  className={`text-right font-mono tabular-nums ${totalTone}`}
                >
                  {fmtUsd(r.totalPnl, true)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {overflow > 0 && (
        <div className="border-t border-border bg-inset px-4 py-2 text-right font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
          …{overflow} more {overflow === 1 ? "tag" : "tags"} not shown
        </div>
      )}
    </div>
  );
}
