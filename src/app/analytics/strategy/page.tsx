import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { getT, getLocale } from "@/lib/i18n/server";
import {
  listStrategyRollup,
  type StrategySortField,
  type SortDir,
  type StrategyRollupRow,
} from "@/lib/db/strategy-rollup";
import { Sparkline } from "@/components/analytics/sparkline";
import { fmtUsd } from "@/lib/data/archive-data";
import { cn } from "@/lib/utils";

/**
 * Strategy attribution rollup — P&L by trader-tagged strategy name.
 *
 * Pulls v_activity_feed grouped by `activity.strategy_tag` (a v5 column).
 * Untagged activities collapse into a residual "Untagged" bucket the user
 * can drill into. Headers are sortable via ?sortBy=&sortDir= URL params so
 * each click round-trips through the server and the page re-renders with
 * the new ordering — no client state, no stale data.
 *
 * Each row links to /spreads/archive?strategy=<tag> so the user can pivot
 * from "this strategy is bleeding" to the underlying activities in one
 * click. (Archive filter chip support for ?strategy= is a follow-up — for
 * now the link parameter is read by archive's URL-decoder for any chip
 * already present in the URL.)
 */
export const dynamic = "force-dynamic";

const VALID_SORT_FIELDS: readonly StrategySortField[] = [
  "strategy",
  "activityCount",
  "capital",
  "netPnl",
  "realizedApr",
  "daysActive",
  "winRate",
] as const;

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function StrategyRollupPage({ searchParams }: PageProps) {
  const { id: userId } = await requireUser();
  const t = await getT();
  const locale = await getLocale();
  const intlLocale = locale === "ru" ? "ru-RU" : "en-US";

  const raw = await searchParams;
  const sortBy = parseSortField(getStr(raw.sortBy));
  const sortDir: SortDir = getStr(raw.sortDir) === "asc" ? "asc" : "desc";

  const rows = await listStrategyRollup(userId, { sortBy, sortDir });

  // Page-level empty state — surface a friendly callout when no row carries
  // a strategy_tag (or there are zero activities at all). The schema only
  // started capturing the tag in v5, so this state is the default for
  // pre-migration data sets.
  const allUntagged =
    rows.length === 0 || (rows.length === 1 && rows[0].isUntagged);

  // Totals across all rows — gives the hero number for context. The math is
  // intentionally simple sums; no double-counting because each activity lives
  // in exactly one bucket.
  const totalActivities = rows.reduce((s, r) => s + r.activityCount, 0);
  const totalCapital = rows.reduce(
    (s, r) => s + r.totalCapitalDeployedUsd,
    0,
  );
  const totalNet = rows.reduce((s, r) => s + r.netPnlUsd, 0);

  return (
    <div className="px-8 py-10 lg:px-12">
      <header className="flex flex-col gap-2 border-b border-border pb-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-tertiary">
          {t("analytics.strategy.eyebrow")}
        </p>
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="font-serif text-[36px] font-medium leading-none tracking-tight text-text">
              {t("analytics.strategy.title")}
            </h1>
            <p className="mt-2 font-serif text-sm italic text-text-tertiary">
              {t("analytics.strategy.subtitle")}
            </p>
          </div>
          <dl className="flex flex-wrap items-end gap-x-8 gap-y-2">
            <HeroStat
              label={t("analytics.strategy.hero.strategies")}
              value={`${rows.filter((r) => !r.isUntagged).length}`}
            />
            <HeroStat
              label={t("analytics.strategy.hero.activities")}
              value={`${totalActivities}`}
            />
            <HeroStat
              label={t("analytics.strategy.hero.netPnl")}
              value={fmtUsd(totalNet, true)}
              tone={totalNet >= 0 ? "up" : "down"}
            />
          </dl>
        </div>
      </header>

      <div className="mt-8">
        {allUntagged ? (
          <StrategyEmptyState
            untaggedRow={rows[0]}
            totalCapital={totalCapital}
            intlLocale={intlLocale}
          />
        ) : (
          <RollupTable
            rows={rows}
            sortBy={sortBy}
            sortDir={sortDir}
            intlLocale={intlLocale}
          />
        )}
      </div>
    </div>
  );
}

// ── Hero stat ──────────────────────────────────────────────────────────────

function HeroStat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "up" | "down" | "neutral";
}) {
  return (
    <div className="flex flex-col items-end">
      <dt className="font-mono text-[9px] uppercase tracking-[0.18em] text-text-tertiary">
        {label}
      </dt>
      <dd
        className={cn(
          "font-serif text-[22px] tabular-nums leading-none",
          tone === "up"
            ? "text-up"
            : tone === "down"
            ? "text-down"
            : "text-text",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

// ── Rollup table ───────────────────────────────────────────────────────────

interface TableProps {
  rows: StrategyRollupRow[];
  sortBy: StrategySortField;
  sortDir: SortDir;
  intlLocale: string;
}

function RollupTable({ rows, sortBy, sortDir, intlLocale }: TableProps) {
  return (
    <div className="rounded-md border border-border bg-surface overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse">
          <thead>
            <tr className="border-b border-border bg-subtle">
              <SortableHeader
                field="strategy"
                sortBy={sortBy}
                sortDir={sortDir}
                align="left"
              />
              <SortableHeader
                field="activityCount"
                sortBy={sortBy}
                sortDir={sortDir}
                align="right"
              />
              <SortableHeader
                field="capital"
                sortBy={sortBy}
                sortDir={sortDir}
                align="right"
              />
              <SortableHeader
                field="netPnl"
                sortBy={sortBy}
                sortDir={sortDir}
                align="right"
              />
              <SortableHeader
                field="realizedApr"
                sortBy={sortBy}
                sortDir={sortDir}
                align="right"
              />
              <SortableHeader
                field="daysActive"
                sortBy={sortBy}
                sortDir={sortDir}
                align="right"
              />
              <SortableHeader
                field="winRate"
                sortBy={sortBy}
                sortDir={sortDir}
                align="right"
              />
              <th className="px-4 py-3 text-right font-mono text-[10px] uppercase tracking-[0.16em] font-medium text-text-tertiary">
                <SparklineHeader />
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <RollupRow key={row.strategy} row={row} intlLocale={intlLocale} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// SparklineHeader — async wrapper so we can grab `t` without prop-drilling.
async function SparklineHeader() {
  const t = await getT();
  return <span>{t("analytics.strategy.columns.sparkline")}</span>;
}

interface SortableHeaderProps {
  field: StrategySortField;
  sortBy: StrategySortField;
  sortDir: SortDir;
  align: "left" | "right";
}

async function SortableHeader({
  field,
  sortBy,
  sortDir,
  align,
}: SortableHeaderProps) {
  const t = await getT();
  const isActive = sortBy === field;
  const nextDir: SortDir = isActive && sortDir === "desc" ? "asc" : "desc";
  // String columns boot ascending; numeric columns boot descending. Feels
  // more intuitive — "biggest first" for money, "A first" for names.
  const defaultDir: SortDir = field === "strategy" ? "asc" : "desc";
  const targetDir = isActive ? nextDir : defaultDir;
  const params = new URLSearchParams();
  params.set("sortBy", field);
  params.set("sortDir", targetDir);

  const label = t(
    `analytics.strategy.columns.${columnLabelKey(field)}` as const,
  );
  return (
    <th
      scope="col"
      className={cn(
        "px-4 py-3 font-mono text-[10px] uppercase tracking-[0.16em] font-medium text-text-tertiary",
        align === "right" ? "text-right" : "text-left",
      )}
      aria-sort={
        isActive ? (sortDir === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <Link
        href={`?${params.toString()}`}
        scroll={false}
        className={cn(
          "inline-flex items-center gap-1 transition-colors hover:text-text",
          isActive && "text-text",
          align === "right" && "flex-row-reverse",
        )}
      >
        <span>{label}</span>
        {isActive ? (
          sortDir === "asc" ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : (
          <span className="inline-block h-3 w-3" aria-hidden />
        )}
      </Link>
    </th>
  );
}

function columnLabelKey(
  f: StrategySortField,
):
  | "strategy"
  | "activities"
  | "capital"
  | "netPnl"
  | "apr"
  | "daysActive"
  | "winRate" {
  switch (f) {
    case "strategy":
      return "strategy";
    case "activityCount":
      return "activities";
    case "capital":
      return "capital";
    case "netPnl":
      return "netPnl";
    case "realizedApr":
      return "apr";
    case "daysActive":
      return "daysActive";
    case "winRate":
      return "winRate";
  }
}

// ── Single rollup row ──────────────────────────────────────────────────────

interface RowProps {
  row: StrategyRollupRow;
  intlLocale: string;
}

async function RollupRow({ row, intlLocale }: RowProps) {
  const t = await getT();
  const tone =
    row.netPnlUsd > 0 ? "up" : row.netPnlUsd < 0 ? "down" : "neutral";
  const toneClass =
    tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-text";

  const aprDisplay =
    row.realizedApr == null
      ? "—"
      : `${(row.realizedApr * 100).toFixed(1)}%`;
  const aprTone =
    row.realizedApr == null
      ? "neutral"
      : row.realizedApr > 0
      ? "up"
      : row.realizedApr < 0
      ? "down"
      : "neutral";
  const aprToneClass =
    aprTone === "up"
      ? "text-up"
      : aprTone === "down"
      ? "text-down"
      : "text-text";

  const displayName = row.isUntagged
    ? t("analytics.strategy.untaggedLabel")
    : row.strategy;
  const href = row.isUntagged
    ? `/spreads/archive`
    : `/spreads/archive?strategy=${encodeURIComponent(row.strategy)}`;

  return (
    <tr className="border-b border-border last:border-b-0 transition-colors hover:bg-subtle">
      <td className="px-4 py-3">
        <Link
          href={href}
          className="group inline-flex flex-col gap-0.5 text-text"
          aria-label={t("analytics.strategy.rowLinkAria", {
            strategy: displayName,
          })}
        >
          <span
            className={cn(
              "font-serif text-[15px] leading-none",
              row.isUntagged && "italic text-text-tertiary",
            )}
          >
            {displayName}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary group-hover:underline underline-offset-4">
            {t("analytics.strategy.viewActivities")}
          </span>
        </Link>
      </td>
      <td className="px-4 py-3 text-right font-mono text-[13px] tabular-nums text-text">
        {row.activityCount}
      </td>
      <td className="px-4 py-3 text-right font-mono text-[13px] tabular-nums text-text-secondary">
        {fmtCapitalUsd(row.totalCapitalDeployedUsd)}
      </td>
      <td
        className={cn(
          "px-4 py-3 text-right font-mono text-[13px] tabular-nums",
          toneClass,
        )}
      >
        {fmtUsd(row.netPnlUsd, true)}
      </td>
      <td
        className={cn(
          "px-4 py-3 text-right font-mono text-[13px] tabular-nums",
          aprToneClass,
        )}
      >
        {aprDisplay}
      </td>
      <td className="px-4 py-3 text-right font-mono text-[13px] tabular-nums text-text-secondary">
        {Math.round(row.daysActive)}
      </td>
      <td className="px-4 py-3 text-right font-mono text-[13px] tabular-nums text-text">
        {(row.winRate * 100).toFixed(0)}%
      </td>
      <td className="px-4 py-3 text-right">
        <div className="inline-flex">
          <Sparkline
            points={row.sparkline.map((p) => ({
              date: p.date,
              value: p.cumulativeNetPnl,
            }))}
            tone={tone}
            width={96}
            height={28}
            ariaLabel={t("analytics.strategy.sparklineAria", {
              strategy: displayName,
              locale: intlLocale,
            })}
          />
        </div>
      </td>
    </tr>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────

interface EmptyProps {
  untaggedRow: StrategyRollupRow | undefined;
  totalCapital: number;
  intlLocale: string;
}

async function StrategyEmptyState({ untaggedRow, totalCapital }: EmptyProps) {
  const t = await getT();
  const hasActivities = untaggedRow && untaggedRow.activityCount > 0;
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-md border border-dashed border-border bg-surface px-8 py-16 text-center">
      <p className="font-serif text-[18px] italic leading-snug text-text">
        {t("analytics.strategy.empty.headline")}
      </p>
      <p className="max-w-xl font-serif text-[14px] italic leading-snug text-text-tertiary">
        {hasActivities
          ? t("analytics.strategy.empty.bodyWithActivities", {
              count: untaggedRow!.activityCount,
              capital: fmtCapitalUsd(totalCapital),
            })
          : t("analytics.strategy.empty.bodyNoActivities")}
      </p>
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-tertiary">
        {t("analytics.strategy.empty.hint")}
      </p>
      <Link
        href="/add"
        className="font-mono text-[11px] uppercase tracking-[0.16em] text-text underline-offset-4 hover:underline"
      >
        {t("analytics.strategy.empty.cta")}
      </Link>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getStr(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

function parseSortField(v: string | undefined): StrategySortField {
  if (!v) return "netPnl";
  return (VALID_SORT_FIELDS as readonly string[]).includes(v)
    ? (v as StrategySortField)
    : "netPnl";
}

function fmtCapitalUsd(n: number): string {
  if (n === 0) return "$0";
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}
