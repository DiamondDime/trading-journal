"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Download,
  Filter as FilterIcon,
  LayoutGrid,
  Rows3,
  Search,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SpreadListCard, type SpreadListItem } from "./spread-list-card";
import {
  type ArchiveRow,
  type Asset,
  type SpreadStatus,
  type SpreadType,
  SPREAD_TYPE_LABELS,
  STATUS_STYLES,
  fmtCapital,
  fmtUsd,
} from "@/lib/data/archive-data";

type SortKey =
  | "serial"
  | "closed"
  | "net_pnl"
  | "capital"
  | "days"
  | "headline_num";

type ViewMode = "table" | "cards";

type OutcomeFilter = "all" | "winners" | "losers";

const TYPE_ORDER: SpreadType[] = [
  "cash_carry",
  "calendar",
  "funding",
  "cross_exchange",
  "dex_cex",
];

const ASSET_ORDER: Asset[] = ["BTC", "ETH", "SOL", "PEPE"];

const STATUS_ORDER: SpreadStatus[] = ["closed", "expired"];

function rowToListItem(r: ArchiveRow): SpreadListItem {
  return {
    serial: r.serial,
    name: r.name,
    typeLabel: `${SPREAD_TYPE_LABELS[r.type]} · ${r.venues}`,
    status: r.status,
    headline: r.headlineLabel,
    headlineUnit: r.headlineUnit,
    tone: r.tone,
    summary: `${fmtCapital(r.capital)} · ${r.daysLabel} · ${r.note}`,
    href: r.href,
  };
}

function toggleSetValue<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export function ArchiveBrowser({ data }: { data: ArchiveRow[] }) {
  const searchParams = useSearchParams();

  // Seed filters from URL params so saved-view links work.
  const initialTypes = React.useMemo(() => {
    const t = searchParams.get("type");
    if (!t) return new Set<SpreadType>();
    return new Set(
      t.split(",").filter((x): x is SpreadType =>
        TYPE_ORDER.includes(x as SpreadType)
      )
    );
  }, [searchParams]);

  const initialOutcome = React.useMemo<OutcomeFilter>(() => {
    const o = searchParams.get("outcome");
    if (o === "winners" || o === "losers") return o;
    return "all";
  }, [searchParams]);

  const [typeFilters, setTypeFilters] =
    React.useState<Set<SpreadType>>(initialTypes);
  const [assetFilters, setAssetFilters] = React.useState<Set<Asset>>(
    new Set()
  );
  const [statusFilters, setStatusFilters] = React.useState<Set<SpreadStatus>>(
    new Set()
  );
  const [outcome, setOutcome] =
    React.useState<OutcomeFilter>(initialOutcome);
  const [search, setSearch] = React.useState("");
  const [sort, setSort] = React.useState<{ key: SortKey; dir: "asc" | "desc" }>(
    { key: "serial", dir: "desc" }
  );
  const [view, setView] = React.useState<ViewMode>("table");

  const clearAll = () => {
    setTypeFilters(new Set());
    setAssetFilters(new Set());
    setStatusFilters(new Set());
    setOutcome("all");
    setSearch("");
  };

  const filtered = React.useMemo(() => {
    let rows = data;
    if (typeFilters.size > 0)
      rows = rows.filter((r) => typeFilters.has(r.type));
    if (assetFilters.size > 0)
      rows = rows.filter((r) => assetFilters.has(r.asset));
    if (statusFilters.size > 0)
      rows = rows.filter((r) => statusFilters.has(r.status));
    if (outcome === "winners") rows = rows.filter((r) => r.netPnl > 0);
    if (outcome === "losers") rows = rows.filter((r) => r.netPnl < 0);
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.serial.toLowerCase().includes(q) ||
          r.venues.toLowerCase().includes(q) ||
          SPREAD_TYPE_LABELS[r.type].toLowerCase().includes(q) ||
          r.variant.toLowerCase().includes(q) ||
          r.note.toLowerCase().includes(q)
      );
    }
    return rows;
  }, [data, typeFilters, assetFilters, statusFilters, outcome, search]);

  const sorted = React.useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sort.key) {
        case "serial":
          return (a.serialNum - b.serialNum) * dir;
        case "closed":
          return a.closedAt.localeCompare(b.closedAt) * dir;
        case "net_pnl":
          return (a.netPnl - b.netPnl) * dir;
        case "capital":
          return (a.capital - b.capital) * dir;
        case "days":
          return (a.daysHeld - b.daysHeld) * dir;
        case "headline_num":
          return (a.headlineNum - b.headlineNum) * dir;
      }
    });
  }, [filtered, sort]);

  const stats = React.useMemo(() => {
    const net = sorted.reduce((s, r) => s + r.netPnl, 0);
    const winners = sorted.filter((r) => r.netPnl > 0).length;
    const losers = sorted.filter((r) => r.netPnl < 0).length;
    const winRate = sorted.length ? (winners / sorted.length) * 100 : 0;
    const cap = sorted.reduce((s, r) => s + r.capital, 0);
    const avgPerTrade = sorted.length ? net / sorted.length : 0;
    return {
      count: sorted.length,
      net,
      winners,
      losers,
      winRate,
      cap,
      avgPerTrade,
    };
  }, [sorted]);

  // Totals across the WHOLE dataset for filter-chip counts.
  const typeCounts = React.useMemo(() => {
    const counts = new Map<SpreadType, number>();
    data.forEach((r) => counts.set(r.type, (counts.get(r.type) ?? 0) + 1));
    return counts;
  }, [data]);

  const assetCounts = React.useMemo(() => {
    const counts = new Map<Asset, number>();
    data.forEach((r) => counts.set(r.asset, (counts.get(r.asset) ?? 0) + 1));
    return counts;
  }, [data]);

  const statusCounts = React.useMemo(() => {
    const counts = new Map<SpreadStatus, number>();
    data.forEach((r) =>
      counts.set(r.status, (counts.get(r.status) ?? 0) + 1)
    );
    return counts;
  }, [data]);

  const outcomeCounts = React.useMemo(
    () => ({
      winners: data.filter((r) => r.netPnl > 0).length,
      losers: data.filter((r) => r.netPnl < 0).length,
    }),
    [data]
  );

  const filtersActive =
    typeFilters.size > 0 ||
    assetFilters.size > 0 ||
    statusFilters.size > 0 ||
    outcome !== "all" ||
    search.length > 0;

  const handleSort = (key: SortKey) => {
    if (sort.key === key) {
      setSort({ key, dir: sort.dir === "asc" ? "desc" : "asc" });
    } else {
      setSort({ key, dir: "desc" });
    }
  };

  return (
    <div className="w-full">
      {/* ── hero strip ──────────────────────────────────────────────────── */}
      <header className="flex flex-col gap-4 border-b border-border px-8 py-7 md:flex-row md:items-end md:justify-between lg:px-12">
        <div>
          <h1 className="font-serif text-[40px] font-medium leading-none tracking-tight text-text">
            The archive
          </h1>
          <p className="mt-2 font-serif text-sm italic text-text-tertiary">
            {data.length} spreads · Jan 12 → May 14, 2026 · every trade ever
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 focus-within:border-border-strong">
            <Search className="h-3.5 w-3.5 text-text-tertiary" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search trade, venue, note…"
              className="w-56 bg-transparent text-[12px] text-text placeholder:text-text-tertiary focus:outline-none"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                aria-label="Clear search"
                className="text-text-tertiary hover:text-text"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          <div className="flex items-center rounded-md border border-border bg-surface">
            <button
              onClick={() => setView("table")}
              aria-pressed={view === "table"}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors",
                view === "table"
                  ? "bg-subtle text-text"
                  : "text-text-secondary hover:text-text"
              )}
            >
              <Rows3 className="h-3 w-3" /> Table
            </button>
            <div className="h-4 w-px bg-border" />
            <button
              onClick={() => setView("cards")}
              aria-pressed={view === "cards"}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors",
                view === "cards"
                  ? "bg-subtle text-text"
                  : "text-text-secondary hover:text-text"
              )}
            >
              <LayoutGrid className="h-3 w-3" /> Cards
            </button>
          </div>

          <button className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary hover:bg-subtle">
            <Download className="h-3 w-3" /> Export CSV
          </button>
        </div>
      </header>

      {/* ── filter rail ─────────────────────────────────────────────────── */}
      <section className="border-b border-border bg-surface/60 px-8 py-4 lg:px-12">
        <div className="flex flex-col gap-3">
          <FilterRow
            label="Type"
            chips={TYPE_ORDER.map((t) => ({
              key: t,
              label: SPREAD_TYPE_LABELS[t],
              count: typeCounts.get(t) ?? 0,
              active: typeFilters.has(t),
              onClick: () =>
                setTypeFilters((s) => toggleSetValue(s, t)),
            })).filter((c) => c.count > 0)}
          />
          <FilterRow
            label="Asset"
            chips={ASSET_ORDER.filter(
              (a) => (assetCounts.get(a) ?? 0) > 0
            ).map((a) => ({
              key: a,
              label: a,
              count: assetCounts.get(a) ?? 0,
              active: assetFilters.has(a),
              onClick: () =>
                setAssetFilters((s) => toggleSetValue(s, a)),
            }))}
          />
          <FilterRow
            label="Status"
            chips={STATUS_ORDER.filter(
              (s) => (statusCounts.get(s) ?? 0) > 0
            ).map((s) => ({
              key: s,
              label: STATUS_STYLES[s].label,
              count: statusCounts.get(s) ?? 0,
              active: statusFilters.has(s),
              onClick: () =>
                setStatusFilters((set) => toggleSetValue(set, s)),
            }))}
          />
          <div className="flex items-baseline gap-3">
            <span className="w-16 shrink-0 font-serif text-[10px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              Outcome
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <FilterChip
                label={`Winners · ${outcomeCounts.winners}`}
                active={outcome === "winners"}
                tone="up"
                onClick={() =>
                  setOutcome(outcome === "winners" ? "all" : "winners")
                }
              />
              <FilterChip
                label={`Losers · ${outcomeCounts.losers}`}
                active={outcome === "losers"}
                tone="down"
                onClick={() =>
                  setOutcome(outcome === "losers" ? "all" : "losers")
                }
              />
              {filtersActive && (
                <button
                  onClick={clearAll}
                  className="ml-2 flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary hover:text-text"
                >
                  <X className="h-3 w-3" />
                  Reset
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── stats bar ───────────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 divide-x divide-border-subtle border-b border-border bg-app md:grid-cols-5">
        <StatCell
          label="Results"
          value={`${stats.count}`}
          sub={`of ${data.length} spreads`}
        />
        <StatCell
          label="Net P&L"
          value={fmtUsd(stats.net, true)}
          tone={stats.net >= 0 ? "up" : "down"}
        />
        <StatCell
          label="Win rate"
          value={`${stats.winRate.toFixed(1)}%`}
          sub={`${stats.winners} W · ${stats.losers} L`}
        />
        <StatCell label="Capital used" value={fmtCapital(stats.cap)} />
        <StatCell
          label="Avg / trade"
          value={fmtUsd(stats.avgPerTrade, true)}
          tone={stats.avgPerTrade >= 0 ? "up" : "down"}
        />
      </section>

      {/* ── content ─────────────────────────────────────────────────────── */}
      <section className="px-8 py-8 lg:px-12">
        {sorted.length === 0 ? (
          <EmptyState onClear={clearAll} />
        ) : view === "table" ? (
          <ArchiveTable rows={sorted} sort={sort} onSort={handleSort} />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {sorted.map((r) => (
              <SpreadListCard key={r.serial} item={rowToListItem(r)} />
            ))}
          </div>
        )}

        {sorted.length > 0 && (
          <p className="mt-6 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
            Showing {sorted.length} of {data.length}
          </p>
        )}

        <footer className="mt-12 flex items-center justify-between border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
          <Link href="/spreads" className="hover:text-text">
            ← back to The book
          </Link>
          <span>spread journal · v0.1 · since Jan 12, 2026</span>
        </footer>
      </section>
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function FilterRow({
  label,
  chips,
}: {
  label: string;
  chips: {
    key: string;
    label: string;
    count: number;
    active: boolean;
    onClick: () => void;
  }[];
}) {
  if (chips.length === 0) return null;
  return (
    <div className="flex items-baseline gap-3">
      <span className="w-16 shrink-0 font-serif text-[10px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {chips.map((c) => (
          <FilterChip
            key={c.key}
            label={`${c.label} · ${c.count}`}
            active={c.active}
            onClick={c.onClick}
          />
        ))}
      </div>
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
  tone,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  tone?: "up" | "down";
}) {
  const activeClass =
    tone === "up"
      ? "border-up bg-up/10 text-up"
      : tone === "down"
      ? "border-down bg-down/10 text-down"
      : "border-text bg-text/[0.08] text-text";

  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors",
        active
          ? activeClass
          : "border-border bg-surface text-text-secondary hover:border-border-strong hover:text-text"
      )}
    >
      {label}
    </button>
  );
}

function StatCell({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "up" | "down";
}) {
  const toneClass =
    tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-text";
  return (
    <div className="px-8 py-3 lg:px-12">
      <p className="font-serif text-[10px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 font-mono text-[18px] font-medium tabular-nums leading-none",
          toneClass
        )}
      >
        {value}
      </p>
      {sub && (
        <p className="mt-1 font-mono text-[10px] text-text-tertiary">{sub}</p>
      )}
    </div>
  );
}

function EmptyState({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border bg-surface py-20 text-center">
      <FilterIcon className="h-6 w-6 text-text-tertiary" />
      <p className="font-serif text-base italic text-text-secondary">
        Nothing matches these filters.
      </p>
      <button
        onClick={onClear}
        className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary underline-offset-4 hover:text-text hover:underline"
      >
        Reset and start over
      </button>
    </div>
  );
}

function ArchiveTable({
  rows,
  sort,
  onSort,
}: {
  rows: ArchiveRow[];
  sort: { key: SortKey; dir: "asc" | "desc" };
  onSort: (key: SortKey) => void;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-border bg-surface">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <SortableHeader k="serial" sort={sort} onSort={onSort}>
              #
            </SortableHeader>
            <TableHead className="font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
              Trade
            </TableHead>
            <TableHead className="font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
              Status
            </TableHead>
            <SortableHeader k="capital" sort={sort} onSort={onSort} align="right">
              Capital
            </SortableHeader>
            <SortableHeader k="days" sort={sort} onSort={onSort} align="right">
              Held
            </SortableHeader>
            <SortableHeader k="closed" sort={sort} onSort={onSort}>
              Closed
            </SortableHeader>
            <SortableHeader
              k="headline_num"
              sort={sort}
              onSort={onSort}
              align="right"
            >
              Headline
            </SortableHeader>
            <SortableHeader k="net_pnl" sort={sort} onSort={onSort} align="right">
              Net P&L
            </SortableHeader>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <ArchiveTableRow key={r.serial} row={r} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function SortableHeader({
  k,
  sort,
  onSort,
  children,
  align = "left",
}: {
  k: SortKey;
  sort: { key: SortKey; dir: "asc" | "desc" };
  onSort: (key: SortKey) => void;
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  const active = sort.key === k;
  return (
    <TableHead className={align === "right" ? "text-right" : "text-left"}>
      <button
        onClick={() => onSort(k)}
        className={cn(
          "inline-flex items-center gap-1 font-serif text-[10px] font-semibold uppercase tracking-[0.16em] transition-colors",
          active ? "text-text" : "text-text-tertiary hover:text-text"
        )}
      >
        {children}
        {active ? (
          sort.dir === "desc" ? (
            <ArrowDown className="h-3 w-3" />
          ) : (
            <ArrowUp className="h-3 w-3" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </TableHead>
  );
}

function ArchiveTableRow({ row }: { row: ArchiveRow }) {
  const router = useRouter();
  const status = STATUS_STYLES[row.status];
  const toneClass = row.tone === "up" ? "text-up" : "text-down";

  return (
    <TableRow
      onClick={() => router.push(row.href)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          router.push(row.href);
        }
      }}
      tabIndex={0}
      role="link"
      className="cursor-pointer transition-colors hover:bg-subtle focus:bg-subtle focus:outline-none"
    >
      <TableCell className="font-mono text-[12px] text-text-tertiary">
        {row.serial}
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-0.5">
          <Link
            href={row.href}
            onClick={(e) => e.stopPropagation()}
            className="font-serif text-[14px] font-medium leading-tight text-text hover:underline"
          >
            {row.name}
          </Link>
          <span className="font-mono text-[10px] text-text-tertiary">
            {SPREAD_TYPE_LABELS[row.type]} · {row.variant} · {row.venues}
          </span>
        </div>
      </TableCell>
      <TableCell>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-text-tertiary">
          <span className={cn("h-1.5 w-1.5 rounded-full", status.dot)} />
          <span className="font-mono uppercase tracking-[0.12em]">
            {status.label}
          </span>
        </span>
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums text-[12px] text-text">
        {fmtCapital(row.capital)}
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums text-[12px] text-text-secondary">
        {row.daysLabel}
      </TableCell>
      <TableCell className="font-serif text-[12px] italic text-text-secondary">
        {row.closedLabel}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex flex-col items-end leading-none">
          <span className={cn("font-serif text-[15px] tabular-nums", toneClass)}>
            {row.headlineLabel}
          </span>
          <span className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-text-tertiary">
            {row.headlineUnit}
          </span>
        </div>
      </TableCell>
      <TableCell
        className={cn(
          "text-right font-mono tabular-nums text-[13px] font-medium",
          toneClass
        )}
      >
        {fmtUsd(row.netPnl, true)}
      </TableCell>
    </TableRow>
  );
}
