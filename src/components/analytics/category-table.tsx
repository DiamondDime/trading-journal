import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtUsd } from "@/lib/data/archive-data";
import { getT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/resolve";

/**
 * Generic activity-breakdown table. Used by both the activity-mix
 * "P&L by activity type" view (rows = type label) and the spread-subtype /
 * asset views. Caller supplies the row shape via the `rows` prop.
 *
 * Server component — no client behavior.
 */

export interface CategoryRow {
  /** Display label — left column. */
  label: string;
  /** Optional secondary descriptor under the label (e.g. "5 spreads"). */
  sublabel?: string;
  count: number;
  netPnl: number;
  /** Mean P&L per activity. */
  avgPnl: number;
  /** Win rate 0-1. */
  winRate: number;
  /** % share of book (e.g. of total P&L magnitude or total capital). 0-100. */
  share: number;
  /** Optional capital column. When omitted, we hide the column. */
  capital?: number;
}

interface Props {
  rows: CategoryRow[];
  /** Show the capital column. Defaults to true if any row has capital. */
  showCapital?: boolean;
  /** Show the win-rate column. Defaults to true when at least one row has
   *  a non-zero rate — when every row is zero, we hide it to keep the table
   *  from advertising a metric we can't fill. */
  showWinRate?: boolean;
}

export async function CategoryTable({ rows, showCapital, showWinRate }: Props) {
  const t = await getT();
  const hasCapital =
    showCapital ?? rows.some((r) => r.capital != null);
  const hasWinRate =
    showWinRate ?? rows.some((r) => r.winRate > 0);

  if (rows.length === 0) {
    return (
      <div className="flex h-[140px] w-full items-center justify-center rounded-md border border-dashed border-border bg-inset">
        <p className="font-serif text-sm italic text-text-tertiary">
          {t("numbers.notEnoughData")}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-border bg-surface">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
              {t("analytics.tables.category" as MessageKey)}
            </TableHead>
            <TableHead className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
              {t("analytics.tables.count" as MessageKey)}
            </TableHead>
            <TableHead className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
              {t("analytics.tables.totalPnl" as MessageKey)}
            </TableHead>
            <TableHead className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
              {t("analytics.tables.avgPnl" as MessageKey)}
            </TableHead>
            {hasWinRate && (
              <TableHead className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
                {t("analytics.tables.winRate" as MessageKey)}
              </TableHead>
            )}
            {hasCapital && (
              <TableHead className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
                {t("analytics.tables.capital" as MessageKey)}
              </TableHead>
            )}
            <TableHead className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
              {t("analytics.tables.share" as MessageKey)}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const totalTone =
              r.netPnl > 0 ? "text-up" : r.netPnl < 0 ? "text-down" : "text-text";
            const avgTone =
              r.avgPnl > 0 ? "text-up" : r.avgPnl < 0 ? "text-down" : "text-text";
            return (
              <TableRow key={r.label} className="hover:bg-inset/40">
                <TableCell className="font-serif text-[14px] text-text">
                  <div className="flex flex-col leading-tight">
                    <span>{r.label}</span>
                    {r.sublabel && (
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
                        {r.sublabel}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono text-[11px] tabular-nums text-text-secondary">
                  {r.count}
                </TableCell>
                <TableCell className={"text-right font-mono text-[12px] tabular-nums " + totalTone}>
                  {fmtUsd(r.netPnl, true)}
                </TableCell>
                <TableCell className={"text-right font-mono text-[11px] tabular-nums " + avgTone}>
                  {fmtUsd(r.avgPnl, true)}
                </TableCell>
                {hasWinRate && (
                  <TableCell className="text-right font-mono text-[11px] tabular-nums text-text-secondary">
                    {(r.winRate * 100).toFixed(0)}%
                  </TableCell>
                )}
                {hasCapital && (
                  <TableCell className="text-right font-mono text-[11px] tabular-nums text-text-secondary">
                    {r.capital != null && r.capital > 0
                      ? `$${r.capital.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
                      : "—"}
                  </TableCell>
                )}
                <TableCell className="text-right font-mono text-[11px] tabular-nums text-text-secondary">
                  {r.share.toFixed(1)}%
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
