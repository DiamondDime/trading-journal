"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Bookmark,
  Download,
  Filter as FilterIcon,
  LayoutGrid,
  Rows3,
  Search,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useT, useLocale } from "@/lib/i18n/client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SpreadListCard, type SpreadListItem } from "./spread-list-card";
import { ExchangeVenuesChips } from "@/components/settings/exchange-logo";
import {
  type Activity,
  type ActivityType,
  type ActivityStatus,
  type Asset,
  type SpreadType,
  type SpreadRow,
  ACTIVITY_TYPE_LABELS,
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

const ACTIVITY_TYPE_ORDER: ActivityType[] = [
  "spread",
  "trade",
  "sale",
  "airdrop",
  "yield_position",
  "option",
];

const TYPE_ORDER: SpreadType[] = [
  "cash_carry",
  "calendar",
  "funding",
  "cross_exchange",
  "dex_cex",
];

// Asset chip order is no longer a fixed list — `Asset` is `string`, so the
// archive supports every ticker the user has actually traded. The filter
// chips are derived at render time from `assetCounts`, sorted by count desc
// then alpha asc for a stable display.

const STATUS_ORDER: ActivityStatus[] = ["closed", "expired", "claimed", "vested"];

function describeActivity(a: Activity, retroDropLabel: string): string {
  switch (a.type) {
    case "spread":
      return `${SPREAD_TYPE_LABELS[a.spreadType]} · ${a.venues}`;
    case "trade":
      return `${a.exchange} · ${a.instrument} · ${a.side}`;
    case "sale":
      return `${a.saleKind.toUpperCase()} · ${a.venue}`;
    case "airdrop":
      return `${a.protocol} · ${retroDropLabel}`;
  }
}

// Pull a venue string per row so the card can render exchange logos
// beside the type label. Spreads carry "venues" already; trades give us
// their single exchange. Sale/airdrop venues aren't tradable exchanges
// (launchpad, OTC desk, protocol) so they get no chip.
function venueOf(r: Activity): string | undefined {
  if (r.type === "spread") return r.venues;
  if (r.type === "trade") return r.exchange;
  return undefined;
}

function rowToListItem(
  r: Activity,
  retroDropLabel: string,
  statusLabel: string,
  activityBadgeLabel: string,
): SpreadListItem {
  return {
    serial: r.serial,
    name: r.name,
    typeLabel: describeActivity(r, retroDropLabel),
    status: r.status,
    statusLabel,
    activityBadgeLabel,
    headline: r.headlineLabel,
    headlineUnit: r.headlineKind,
    tone: r.tone,
    summary:
      r.type === "airdrop"
        ? `${r.daysLabel} · ${r.note}`
        : `${fmtCapital(r.capital)} · ${r.daysLabel} · ${r.note}`,
    href: r.href,
    activityType: r.type,
    venues: venueOf(r),
  };
}

function toggleSetValue<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

// ── URL <-> state codec ────────────────────────────────────────────────────
// Single source of truth for archive filter URL params. `decodeFromUrl`
// rehydrates the initial state when the page mounts (so direct links and
// browser back/forward work). `buildUrlQuery` is the inverse — it produces a
// canonical query string that mirrors current state, with keys omitted when
// the value matches the default ("clean URLs" when nothing is filtered).

type DecodedState = {
  activity: Set<ActivityType>;
  type: Set<SpreadType>;
  asset: Set<Asset>;
  status: Set<ActivityStatus>;
  outcome: OutcomeFilter;
  /** Single strategy tag (matches Activity.strategyTag exactly). Empty = no filter. */
  strategy: string;
  sort: { key: SortKey; dir: "asc" | "desc" };
  q: string;
};

const VALID_SORT_KEYS: SortKey[] = [
  "serial",
  "closed",
  "net_pnl",
  "capital",
  "days",
  "headline_num",
];

function decodeFromUrl(sp: { get(key: string): string | null }): DecodedState {
  const parseSet = <T extends string>(
    key: string,
    valid: readonly T[]
  ): Set<T> => {
    const v = sp.get(key);
    if (!v) return new Set();
    return new Set(
      v.split(",").filter((x): x is T => valid.includes(x as T))
    );
  };

  const outcomeRaw = sp.get("outcome");
  const outcome: OutcomeFilter =
    outcomeRaw === "winners" || outcomeRaw === "losers" ? outcomeRaw : "all";

  // sort is encoded as "key:dir" (e.g. "net_pnl:asc"). Default is serial:desc.
  const sortRaw = sp.get("sort") ?? "";
  const [sortKeyRaw, sortDirRaw] = sortRaw.split(":");
  const sortKey: SortKey = VALID_SORT_KEYS.includes(sortKeyRaw as SortKey)
    ? (sortKeyRaw as SortKey)
    : "serial";
  const sortDir: "asc" | "desc" = sortDirRaw === "asc" ? "asc" : "desc";

  return {
    activity: parseSet("activity", ACTIVITY_TYPE_ORDER),
    type: parseSet("type", TYPE_ORDER),
    // `Asset` is an open string — the URL param can hold any ticker the user
    // has traded. Split on commas, trim, drop empties; no whitelist check.
    asset: new Set(
      (sp.get("asset") ?? "")
        .split(",")
        .map((x) => x.trim())
        .filter((x) => x.length > 0),
    ),
    status: parseSet("status", STATUS_ORDER),
    outcome,
    strategy: sp.get("strategy") ?? "",
    sort: { key: sortKey, dir: sortDir },
    q: sp.get("q") ?? "",
  };
}

function buildUrlQuery(state: DecodedState): string {
  const params = new URLSearchParams();
  const writeSet = (key: string, set: Set<string>) => {
    if (set.size > 0) params.set(key, [...set].join(","));
  };
  writeSet("activity", state.activity);
  writeSet("type", state.type);
  writeSet("asset", state.asset);
  writeSet("status", state.status);
  if (state.outcome !== "all") params.set("outcome", state.outcome);
  if (state.strategy) params.set("strategy", state.strategy);
  if (state.sort.key !== "serial" || state.sort.dir !== "desc") {
    params.set("sort", `${state.sort.key}:${state.sort.dir}`);
  }
  if (state.q) params.set("q", state.q);
  return params.toString();
}

function rowAsset(a: Activity): Asset | null {
  if (a.type === "spread" || a.type === "trade" || a.type === "sale" || a.type === "airdrop") {
    // Filter out empty strings — db-adapter.asAsset() can emit "" when the
    // upstream symbol is null/undefined, and we don't want that surfacing as
    // a blank filter chip.
    return a.asset || null;
  }
  return null;
}

function rowSearchHaystack(a: Activity, retroDropLabel: string): string {
  const parts: string[] = [a.name, a.serial, describeActivity(a, retroDropLabel), a.note];
  if (a.type === "spread") parts.push(a.variant, a.venues);
  if (a.type === "trade") parts.push(a.symbol, a.exchange);
  if (a.type === "sale") parts.push(a.venue, a.saleKind);
  if (a.type === "airdrop") parts.push(a.protocol);
  return parts.join(" ").toLowerCase();
}

export function ArchiveBrowser({ data }: { data: Activity[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useT();
  const locale = useLocale();
  const retroDropLabel = t("spreadsList.retroDrop");

  // Earliest closed activity → "since" date for the footer. Empty dataset
  // falls back to the localized "today" label so we never render a hardcoded
  // date placeholder in the chrome.
  const sinceLabel = React.useMemo(() => {
    if (data.length === 0) return t("spreadsList.sinceToday");
    let earliest: string | null = null;
    for (const r of data) {
      if (!r.closedAt) continue;
      if (earliest === null || r.closedAt < earliest) earliest = r.closedAt;
    }
    if (!earliest) return t("spreadsList.sinceToday");
    // closedAt is a YYYY-MM-DD string in archive-data display rows.
    const d = new Date(`${earliest.slice(0, 10)}T00:00:00`);
    if (!Number.isFinite(d.getTime())) return t("spreadsList.sinceToday");
    const intlLocale = locale === "ru" ? "ru-RU" : "en-US";
    return d.toLocaleDateString(intlLocale, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }, [data, locale, t]);

  // Initial state is decoded from URL search params on mount only. Once
  // mounted, chip toggles drive `router.replace` (see effect below) — we
  // never re-derive state from the URL after that point, so navigating
  // back/forward to the page does not clobber in-progress edits.
  const initialState = React.useMemo(
    () => decodeFromUrl(searchParams),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [activityFilters, setActivityFilters] =
    React.useState<Set<ActivityType>>(initialState.activity);
  const [spreadTypeFilters, setSpreadTypeFilters] =
    React.useState<Set<SpreadType>>(initialState.type);
  const [assetFilters, setAssetFilters] = React.useState<Set<Asset>>(
    initialState.asset
  );
  const [statusFilters, setStatusFilters] = React.useState<Set<ActivityStatus>>(
    initialState.status
  );
  const [outcome, setOutcome] = React.useState<OutcomeFilter>(
    initialState.outcome
  );
  const [strategyFilter, setStrategyFilter] = React.useState(initialState.strategy);
  const [search, setSearch] = React.useState(initialState.q);
  const [sort, setSort] = React.useState<{ key: SortKey; dir: "asc" | "desc" }>(
    initialState.sort
  );
  const [view, setView] = React.useState<ViewMode>("table");

  // Sync filter state → URL. Builds the canonical query string from current
  // state and only calls router.replace if it differs from the URL the
  // browser currently shows — this prevents both an infinite re-render loop
  // and clobbering the URL on the very first render when the page was
  // loaded with query params (state was decoded from those params, so the
  // rebuilt query matches and we no-op).
  React.useEffect(() => {
    const next = buildUrlQuery({
      activity: activityFilters,
      type: spreadTypeFilters,
      asset: assetFilters,
      status: statusFilters,
      outcome,
      strategy: strategyFilter,
      sort,
      q: search,
    });
    const current = searchParams.toString();
    if (next === current) return;
    router.replace(next ? `?${next}` : "?", { scroll: false });
    // We intentionally do not depend on `searchParams` here — router.replace
    // updates it and we only care about state-driven changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activityFilters,
    spreadTypeFilters,
    assetFilters,
    statusFilters,
    outcome,
    strategyFilter,
    sort,
    search,
    router,
  ]);

  const clearAll = () => {
    setActivityFilters(new Set());
    setSpreadTypeFilters(new Set());
    setAssetFilters(new Set());
    setStatusFilters(new Set());
    setOutcome("all");
    setStrategyFilter("");
    setSearch("");
  };

  // Spread-subtype chips only apply when Spread is the (or only) active
  // activity scope — they're meaningless for Trades / Sales / Airdrops.
  const spreadSubtypeApplicable =
    activityFilters.size === 0 || activityFilters.has("spread");

  const filtered = React.useMemo(() => {
    let rows = data;
    if (activityFilters.size > 0)
      rows = rows.filter((r) => activityFilters.has(r.type));
    if (spreadSubtypeApplicable && spreadTypeFilters.size > 0) {
      rows = rows.filter(
        (r) => r.type !== "spread" || spreadTypeFilters.has(r.spreadType)
      );
    }
    if (assetFilters.size > 0) {
      rows = rows.filter((r) => {
        const a = rowAsset(r);
        return a !== null && assetFilters.has(a);
      });
    }
    if (statusFilters.size > 0)
      rows = rows.filter((r) => statusFilters.has(r.status));
    if (outcome === "winners") rows = rows.filter((r) => r.netPnl > 0);
    if (outcome === "losers") rows = rows.filter((r) => r.netPnl < 0);
    if (strategyFilter) {
      // Exact match against activity.strategy_tag. Sidebar generates these
      // links from a count rollup, so any tag we surface there is guaranteed
      // to exist on at least one activity in the dataset.
      rows = rows.filter((r) => r.strategyTag === strategyFilter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) => rowSearchHaystack(r, retroDropLabel).includes(q));
    }
    return rows;
  }, [data, activityFilters, spreadTypeFilters, spreadSubtypeApplicable, assetFilters, statusFilters, outcome, strategyFilter, search, retroDropLabel]);

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
    return { count: sorted.length, net, winners, losers, winRate, cap, avgPerTrade };
  }, [sorted]);

  const activityCounts = React.useMemo(() => {
    const counts = new Map<ActivityType, number>();
    data.forEach((r) => counts.set(r.type, (counts.get(r.type) ?? 0) + 1));
    return counts;
  }, [data]);

  const spreadSubtypeCounts = React.useMemo(() => {
    const counts = new Map<SpreadType, number>();
    data.forEach((r) => {
      if (r.type === "spread") {
        const s = (r as SpreadRow).spreadType;
        counts.set(s, (counts.get(s) ?? 0) + 1);
      }
    });
    return counts;
  }, [data]);

  const assetCounts = React.useMemo(() => {
    const counts = new Map<Asset, number>();
    data.forEach((r) => {
      const a = rowAsset(r);
      if (a) counts.set(a, (counts.get(a) ?? 0) + 1);
    });
    return counts;
  }, [data]);

  const statusCounts = React.useMemo(() => {
    const counts = new Map<ActivityStatus, number>();
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
    activityFilters.size > 0 ||
    spreadTypeFilters.size > 0 ||
    assetFilters.size > 0 ||
    statusFilters.size > 0 ||
    outcome !== "all" ||
    strategyFilter.length > 0 ||
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
            {t("archive.title")}
          </h1>
          <p className="mt-2 font-serif text-sm italic text-text-tertiary">
            {t("archive.summary", {
              count: data.length,
              spread: activityCounts.get("spread") ?? 0,
              trade: activityCounts.get("trade") ?? 0,
              sale: activityCounts.get("sale") ?? 0,
              airdrop: activityCounts.get("airdrop") ?? 0,
              yieldPosition: activityCounts.get("yield_position") ?? 0,
              option: activityCounts.get("option") ?? 0,
            })}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 focus-within:border-border-strong">
            <Search className="h-3.5 w-3.5 text-text-tertiary" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("archive.searchPlaceholder")}
              aria-label={t("archive.searchAria")}
              type="search"
              className="w-56 bg-transparent text-[12px] text-text placeholder:text-text-tertiary focus:outline-none"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                aria-label={t("archive.clearSearch")}
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
              <Rows3 className="h-3 w-3" /> {t("archive.view.table")}
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
              <LayoutGrid className="h-3 w-3" /> {t("archive.view.cards")}
            </button>
          </div>

          <button className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary hover:bg-subtle">
            <Download className="h-3 w-3" /> {t("archive.exportCsv")}
          </button>
        </div>
      </header>

      {/* ── filter rail ─────────────────────────────────────────────────── */}
      <section className="border-b border-border bg-surface/60 px-8 py-4 lg:px-12">
        <div className="flex flex-col gap-3">
          <FilterRow
            label={t("archive.filters.activity")}
            chips={ACTIVITY_TYPE_ORDER.filter(
              (tt) => (activityCounts.get(tt) ?? 0) > 0
            ).map((tt) => ({
              key: tt,
              label: ACTIVITY_TYPE_LABELS[tt],
              count: activityCounts.get(tt) ?? 0,
              active: activityFilters.has(tt),
              onClick: () =>
                setActivityFilters((s) => toggleSetValue(s, tt)),
            }))}
          />
          {spreadSubtypeApplicable && (
            <FilterRow
              label={t("archive.filters.type")}
              chips={TYPE_ORDER.map((tt) => ({
                key: tt,
                label: SPREAD_TYPE_LABELS[tt],
                count: spreadSubtypeCounts.get(tt) ?? 0,
                active: spreadTypeFilters.has(tt),
                onClick: () =>
                  setSpreadTypeFilters((s) => toggleSetValue(s, tt)),
              })).filter((c) => c.count > 0)}
            />
          )}
          <FilterRow
            label={t("archive.filters.asset")}
            chips={[...assetCounts.entries()]
              .sort(
                (a, b) =>
                  b[1] - a[1] || a[0].localeCompare(b[0]),
              )
              .map(([a, count]) => ({
                key: a,
                label: a,
                count,
                active: assetFilters.has(a),
                onClick: () =>
                  setAssetFilters((s) => toggleSetValue(s, a)),
              }))}
          />
          <FilterRow
            label={t("archive.filters.status")}
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
              {t("archive.filters.outcome")}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <FilterChip
                label={t("archive.outcomeWinners", { n: outcomeCounts.winners })}
                active={outcome === "winners"}
                tone="up"
                onClick={() =>
                  setOutcome(outcome === "winners" ? "all" : "winners")
                }
              />
              <FilterChip
                label={t("archive.outcomeLosers", { n: outcomeCounts.losers })}
                active={outcome === "losers"}
                tone="down"
                onClick={() =>
                  setOutcome(outcome === "losers" ? "all" : "losers")
                }
              />
              {strategyFilter && (
                <button
                  type="button"
                  onClick={() => setStrategyFilter("")}
                  className="inline-flex items-center gap-1.5 rounded-md border border-signature/40 bg-signature/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-signature hover:bg-signature/15"
                  aria-label={`Clear strategy filter ${strategyFilter}`}
                >
                  <span className="text-text-tertiary">strategy:</span>
                  <span className="normal-case tracking-normal text-text">{strategyFilter}</span>
                  <X className="h-3 w-3" />
                </button>
              )}
              {filtersActive && (
                <button
                  onClick={clearAll}
                  className="ml-2 flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary hover:text-text"
                >
                  <X className="h-3 w-3" />
                  {t("archive.filters.reset")}
                </button>
              )}
              {/* "Save this view" — hands the current archive URL to /views
                  via the prefillFrom query, which opens the create dialog
                  with the URL pre-filled. */}
              <SaveThisViewLink
                queryString={buildUrlQuery({
                  activity: activityFilters,
                  type: spreadTypeFilters,
                  asset: assetFilters,
                  status: statusFilters,
                  outcome,
                  strategy: strategyFilter,
                  sort,
                  q: search,
                })}
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── stats bar ───────────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 divide-x divide-border-subtle border-b border-border bg-app md:grid-cols-5">
        <StatCell
          label={t("archive.stats.results")}
          value={`${stats.count}`}
          sub={t("archive.stats.ofActivities", { count: data.length })}
        />
        <StatCell
          label={t("archive.stats.netPnl")}
          value={fmtUsd(stats.net, true)}
          tone={stats.net >= 0 ? "up" : "down"}
        />
        <StatCell
          label={t("archive.stats.winRate")}
          value={`${stats.winRate.toFixed(1)}%`}
          sub={t("archive.stats.winLoss", { w: stats.winners, l: stats.losers })}
        />
        <StatCell label={t("archive.stats.capital")} value={fmtCapital(stats.cap)} />
        <StatCell
          label={t("archive.stats.avgPerActivity")}
          value={fmtUsd(stats.avgPerTrade, true)}
          tone={stats.avgPerTrade >= 0 ? "up" : "down"}
        />
      </section>

      {/* ── content ─────────────────────────────────────────────────────── */}
      <section className="px-8 py-8 lg:px-12">
        {sorted.length === 0 ? (
          <EmptyState onClear={clearAll} />
        ) : view === "table" ? (
          <ArchiveTable
            rows={sorted}
            sort={sort}
            onSort={handleSort}
            retroDropLabel={retroDropLabel}
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {sorted.map((r) => (
              <SpreadListCard
                key={r.id}
                item={rowToListItem(
                  r,
                  retroDropLabel,
                  t(`status.${r.status}` as const),
                  t(`spreadListCard.activityBadge.${r.type}` as const),
                )}
              />
            ))}
          </div>
        )}

        {sorted.length > 0 && (
          <p className="mt-6 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
            {t("archive.showing", { n: sorted.length, total: data.length })}
          </p>
        )}

        <footer className="mt-12 flex items-center justify-between border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
          <Link href="/spreads" className="hover:text-text">
            {t("archive.backToBook", { name: t("dashboard.title") })}
          </Link>
          <span>{t("archive.footer", { since: sinceLabel })}</span>
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
  const t = useT();
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border bg-surface py-20 text-center">
      <FilterIcon className="h-6 w-6 text-text-tertiary" />
      <p className="font-serif text-base italic text-text-secondary">
        {t("archive.empty")}
      </p>
      <button
        onClick={onClear}
        className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary underline-offset-4 hover:text-text hover:underline"
      >
        {t("archive.emptyReset")}
      </button>
    </div>
  );
}

function ArchiveTable({
  rows,
  sort,
  onSort,
  retroDropLabel,
}: {
  rows: Activity[];
  sort: { key: SortKey; dir: "asc" | "desc" };
  onSort: (key: SortKey) => void;
  retroDropLabel: string;
}) {
  const t = useT();
  return (
    <div className="overflow-hidden rounded-md border border-border bg-surface">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <SortableHeader k="serial" sort={sort} onSort={onSort}>
              {t("archive.headers.hash")}
            </SortableHeader>
            <TableHead className="font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
              {t("archive.headers.activity")}
            </TableHead>
            <TableHead className="font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
              {t("archive.headers.status")}
            </TableHead>
            <SortableHeader k="capital" sort={sort} onSort={onSort} align="right">
              {t("archive.headers.capital")}
            </SortableHeader>
            <SortableHeader k="days" sort={sort} onSort={onSort} align="right">
              {t("archive.headers.held")}
            </SortableHeader>
            <SortableHeader k="closed" sort={sort} onSort={onSort}>
              {t("archive.headers.closed")}
            </SortableHeader>
            <SortableHeader
              k="headline_num"
              sort={sort}
              onSort={onSort}
              align="right"
            >
              {t("archive.headers.headline")}
            </SortableHeader>
            <SortableHeader k="net_pnl" sort={sort} onSort={onSort} align="right">
              {t("archive.headers.pnl")}
            </SortableHeader>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <ArchiveTableRow
              key={r.id}
              row={r}
              retroDropLabel={retroDropLabel}
            />
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
  // aria-sort communicates current sort to screen readers. "none" on inactive
  // columns is mandatory per WAI-ARIA so AT distinguishes "sortable but not
  // currently sorted" from "not sortable at all".
  const ariaSort: "ascending" | "descending" | "none" = active
    ? sort.dir === "asc"
      ? "ascending"
      : "descending"
    : "none";
  return (
    <TableHead
      aria-sort={ariaSort}
      className={align === "right" ? "text-right" : "text-left"}
    >
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

function ArchiveTableRow({
  row,
  retroDropLabel,
}: {
  row: Activity;
  retroDropLabel: string;
}) {
  const router = useRouter();
  const status = STATUS_STYLES[row.status];
  const toneClass = row.tone === "up" ? "text-up" : "text-down";
  const subtitle = describeActivity(row, retroDropLabel);
  const venues = venueOf(row);

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
          <span className="flex items-center gap-1.5 font-mono text-[10px] text-text-tertiary">
            <span className="mr-0.5 text-text-tertiary/70">{row.type.toUpperCase()}</span>
            {venues && <ExchangeVenuesChips venues={venues} size="sm" />}
            <span>· {subtitle}</span>
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
        {row.capital > 0 ? fmtCapital(row.capital) : "—"}
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
            {row.headlineKind}
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

/**
 * Small Link that hands the current archive URL (encoded as the canonical
 * `?...` query) to /views via the prefillFrom param. The /views page reads
 * that param on mount and opens the create dialog with the URL pre-filled.
 *
 * Built as a Link (not a button) so the user gets standard ctrl/cmd-click
 * "open in new tab" behaviour for free.
 */
function SaveThisViewLink({ queryString }: { queryString: string }) {
  const t = useT();
  const label = t("archive.saveView");
  const href = queryString
    ? `/views?prefillFrom=${encodeURIComponent(`/spreads/archive?${queryString}`)}`
    : `/views?prefillFrom=${encodeURIComponent("/spreads/archive")}`;
  return (
    <Link
      href={href}
      className="ml-2 flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary hover:text-text"
      aria-label={label}
    >
      <Bookmark className="h-3 w-3" />
      {label}
    </Link>
  );
}
