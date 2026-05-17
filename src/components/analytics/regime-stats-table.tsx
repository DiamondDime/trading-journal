"use client";

import * as React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowUpDown } from "lucide-react";
import { fmtUsd } from "@/lib/data/archive-data";
import type { RegimeAggRow } from "@/lib/db/activity";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/resolve";

/**
 * Sortable per-regime stats table. Click a header to sort by that column;
 * click again to flip direction. Default sort is `count desc` (matches the
 * DB ordering).
 *
 * Why client-side sort: regime sets are usually < 20 distinct values for a
 * single user, so a memo-sort on the client is fine and avoids a round-trip
 * for every column toggle.
 */

type SortKey =
  | "regime"
  | "count"
  | "netPnl"
  | "avgPnl"
  | "winRate"
  | "profitFactor"
  | "sqn";

type SortDir = "asc" | "desc";

interface Props {
  rows: RegimeAggRow[];
}

interface SortState {
  key: SortKey;
  dir: SortDir;
}

function compareNullableNumber(
  a: number | null | undefined,
  b: number | null | undefined,
  dir: SortDir,
): number {
  // Nulls go to the bottom regardless of direction — common convention for
  // sortable financial tables.
  const an = a == null || !Number.isFinite(a);
  const bn = b == null || !Number.isFinite(b);
  if (an && bn) return 0;
  if (an) return 1;
  if (bn) return -1;
  return dir === "asc" ? (a as number) - (b as number) : (b as number) - (a as number);
}

function compareString(a: string, b: string, dir: SortDir): number {
  return dir === "asc" ? a.localeCompare(b) : b.localeCompare(a);
}

export function RegimeStatsTable({ rows }: Props) {
  const t = useT();
  const [sort, setSort] = React.useState<SortState>({ key: "count", dir: "desc" });

  const sorted = React.useMemo(() => {
    const list = [...rows];
    list.sort((a, b) => {
      switch (sort.key) {
        case "regime": return compareString(a.regime, b.regime, sort.dir);
        case "count": return compareNullableNumber(a.count, b.count, sort.dir);
        case "netPnl": return compareNullableNumber(a.netPnl, b.netPnl, sort.dir);
        case "avgPnl": return compareNullableNumber(a.avgPnl, b.avgPnl, sort.dir);
        case "winRate": return compareNullableNumber(a.winRate, b.winRate, sort.dir);
        case "profitFactor":
          return compareNullableNumber(a.profitFactor, b.profitFactor, sort.dir);
        case "sqn": return compareNullableNumber(a.sqn, b.sqn, sort.dir);
        default: return 0;
      }
    });
    return list;
  }, [rows, sort]);

  if (rows.length === 0) {
    return (
      <div className="flex h-[160px] w-full items-center justify-center rounded-md border border-dashed border-border bg-inset">
        <p className="font-serif text-sm italic text-text-tertiary">
          {t("numbers.notEnoughData")}
        </p>
      </div>
    );
  }

  function toggle(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
  }

  return (
    <div className="overflow-hidden rounded-md border border-border bg-surface">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <SortableHead label={t("analytics.tables.regime" as MessageKey)} onClick={() => toggle("regime")} active={sort.key === "regime"} dir={sort.dir} align="left" />
            <SortableHead label={t("analytics.tables.count" as MessageKey)} onClick={() => toggle("count")} active={sort.key === "count"} dir={sort.dir} />
            <SortableHead label={t("analytics.tables.totalPnl" as MessageKey)} onClick={() => toggle("netPnl")} active={sort.key === "netPnl"} dir={sort.dir} />
            <SortableHead label={t("analytics.tables.avgPnl" as MessageKey)} onClick={() => toggle("avgPnl")} active={sort.key === "avgPnl"} dir={sort.dir} />
            <SortableHead label={t("analytics.tables.winRate" as MessageKey)} onClick={() => toggle("winRate")} active={sort.key === "winRate"} dir={sort.dir} />
            <SortableHead label={t("analytics.tables.profitFactor" as MessageKey)} onClick={() => toggle("profitFactor")} active={sort.key === "profitFactor"} dir={sort.dir} />
            <SortableHead label={t("analytics.tables.sqn" as MessageKey)} onClick={() => toggle("sqn")} active={sort.key === "sqn"} dir={sort.dir} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((r) => {
            const totalTone =
              r.netPnl > 0 ? "text-up" : r.netPnl < 0 ? "text-down" : "text-text";
            const avgTone =
              r.avgPnl > 0 ? "text-up" : r.avgPnl < 0 ? "text-down" : "text-text";
            return (
              <TableRow key={r.regime} className="hover:bg-inset/40">
                <TableCell className="font-serif text-[13px] text-text">
                  {r.regime}
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
                <TableCell className="text-right font-mono text-[11px] tabular-nums text-text-secondary">
                  {(r.winRate * 100).toFixed(0)}%
                </TableCell>
                <TableCell className="text-right font-mono text-[11px] tabular-nums text-text-secondary">
                  {r.profitFactor == null ? "—" : r.profitFactor.toFixed(2)}
                </TableCell>
                <TableCell className="text-right font-mono text-[11px] tabular-nums text-text-secondary">
                  {r.sqn == null ? "—" : r.sqn.toFixed(2)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function SortableHead({
  label,
  onClick,
  active,
  dir,
  align = "right",
}: {
  label: string;
  onClick: () => void;
  active: boolean;
  dir: SortDir;
  align?: "left" | "right";
}) {
  return (
    <TableHead
      className={
        "font-mono text-[10px] uppercase tracking-[0.14em] " +
        (align === "right" ? "text-right" : "text-left") +
        " " +
        (active ? "text-text" : "text-text-tertiary")
      }
    >
      <button
        type="button"
        onClick={onClick}
        className={
          "inline-flex items-center gap-1 transition-colors hover:text-text " +
          (active ? "text-text" : "")
        }
      >
        {label}
        <ArrowUpDown
          className={
            "h-3 w-3 " +
            (active
              ? dir === "asc"
                ? "rotate-180 text-text"
                : "text-text"
              : "text-text-tertiary/60")
          }
        />
      </button>
    </TableHead>
  );
}
