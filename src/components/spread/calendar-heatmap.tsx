"use client";

import * as React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useT, useLocale } from "@/lib/i18n/client";

/**
 * Dashboard heatmap of daily realized net P&L over the last 13 / 26 / 52 weeks.
 *
 * Layout (Wave 13A):
 *   The whole thing is a single CSS Grid with N+1 columns (1 day-of-week label
 *   column + N week columns) and 8 rows (1 month-label row + 7 day rows).
 *   Each cell uses `aspect-ratio: 1` so they stay square as the parent stretches
 *   horizontally — this is what makes the heatmap "fill" the container rather
 *   than collapsing to a 247px island when the parent card is much wider.
 *
 *   • 13w / 26w  → grid-template-columns: <label> repeat(N, minmax(0, 1fr))
 *                  Cells become ~35-55px on a typical desktop card. No scroll.
 *   • 52w        → fixed cell pitch (~14px) with horizontal overflow scroll.
 *                  Cells would be ~5px at 1fr on most viewports — unreadable.
 *
 * Visual encoding (unchanged from 12A):
 *   • Positive day → shades of var(--up), intensity from |pnl| / maxAbs in
 *     the visible window. Negative day → shades of var(--down). Zero day with
 *     activity → very faint up/down (floor intensity). No-activity day →
 *     neutral subtle. Pre-history days (before user's firstActivityDate) →
 *     extra-faint neutral so it's clear there was no journal then.
 *   • Intensity uses a square-root ramp so small wins/losses are still visible
 *     when a single huge outlier would otherwise dominate a linear scale.
 *   • Today's cell gets a 1px solid border in the text color so the user can
 *     orient on "now".
 *
 * TZ note: dates here are expected to come from the server as YYYY-MM-DD strings
 * already bucketed in the server's local TZ (see getDailyPnl in activity.ts).
 * The grid alignment uses Date constructed in local time so they line up.
 */

// Sun..Sat keys (Date.getDay maps 0..6 = Sun..Sat). Tooltip shows full short
// weekday via Intl, so the column labels stay tiny single-letter glyphs from
// calendar.weekdaysShort.
const DAY_LABEL_KEYS = [
  "calendar.weekdaysShort.sun",
  "calendar.weekdaysShort.mon",
  "calendar.weekdaysShort.tue",
  "calendar.weekdaysShort.wed",
  "calendar.weekdaysShort.thu",
  "calendar.weekdaysShort.fri",
  "calendar.weekdaysShort.sat",
] as const;
// Default window — the page can widen this via the `weeks` prop. 13w stays the
// dashboard default because it fits cleanly in the side-by-side grid; 26w/52w
// expand the column count for users that want a longer rear-view mirror.
const DEFAULT_WEEKS = 13;

/**
 * Above this many weeks we abandon the responsive 1fr layout and fall back to
 * a fixed-pitch grid with horizontal scroll. 1fr cells would be ~5-8px at 52w
 * on a typical card — too small to read intensity from.
 */
const SCROLL_WEEKS_THRESHOLD = 27;

/** Fixed-pitch values used only in scroll mode (52w). Tuned for legibility. */
const SCROLL_CELL_SIZE = 14; // px
const SCROLL_CELL_GAP = 2;   // px

/** Gap (px) between cells in responsive (fill) mode. */
const FILL_CELL_GAP = 3;

/** Floor intensity so any non-zero day stays visible. */
const MIN_INTENSITY = 0.18;

/** Perceptual ramp: sqrt of normalized magnitude. */
function perceptualIntensity(absPnl: number, maxAbs: number): number {
  if (maxAbs <= 0 || absPnl <= 0) return 0;
  const raw = Math.sqrt(Math.min(1, absPnl / maxAbs));
  return MIN_INTENSITY + raw * (1 - MIN_INTENSITY);
}

export interface DailyCell {
  /** YYYY-MM-DD */
  date: string;
  netPnl: number;
  count: number;
}

export interface CalendarHeatmapProps {
  /** Pre-aggregated per-day rows from getDailyPnl(). Missing dates render neutral. */
  days: DailyCell[];
  /** YYYY-MM-DD — the rightmost (most recent) date in the grid, inclusive. */
  endDate: string;
  /**
   * YYYY-MM-DD — the user's first-ever activity date. Cells before this are
   * shaded extra-faint to signal "no journal yet" vs "no activity that day".
   */
  firstActivityDate?: string | null;
  /** Number of weeks rendered. Defaults to 13. Page passes 26 / 52 for the
   *  wider toggles. */
  weeks?: number;
}

// ---------------------------------------------------------------------------
// Date helpers — local-time YYYY-MM-DD round-tripping.
// We intentionally avoid `new Date(string)` to dodge timezone surprises.
// ---------------------------------------------------------------------------

function parseLocalDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function fmtLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function fmtTooltipDate(d: Date, intlLocale: string): string {
  return d.toLocaleDateString(intlLocale, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function fmtAmount(
  v: number,
  intlLocale: string,
  noPnlLabel: string,
): string {
  if (v === 0) return noPnlLabel;
  const sign = v > 0 ? "+" : "−"; // minus sign
  return `${sign}$${Math.abs(v).toLocaleString(intlLocale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface BuiltCell {
  date: Date;
  ymd: string;
  netPnl: number;
  count: number;
  /** True when this day is before the user's first-ever activity. */
  preHistory: boolean;
  /** True for today's date (local). */
  isToday: boolean;
}

export function CalendarHeatmap({
  days,
  endDate,
  firstActivityDate,
  weeks: weeksProp = DEFAULT_WEEKS,
}: CalendarHeatmapProps) {
  const t = useT();
  const locale = useLocale();
  const intlLocale = locale === "ru" ? "ru-RU" : "en-US";
  // Clamp to a sane range — 52w is the longest the page exposes, but a caller
  // could pass anything; very large windows would blow out the grid layout.
  const weeksCount = Math.max(1, Math.min(104, Math.floor(weeksProp)));
  const totalDays = weeksCount * 7;

  // Build a Map from YYYY-MM-DD → row for O(1) lookup.
  const byDate = React.useMemo(() => {
    const m = new Map<string, DailyCell>();
    for (const d of days) m.set(d.date, d);
    return m;
  }, [days]);

  // Build the N-cell window ending on endDate, then back-fill to the Sunday
  // that starts the leftmost week. Cells are laid out column-major (week, day).
  const { weeks, monthMarkers } = React.useMemo(() => {
    const end = parseLocalDate(endDate);
    // End-of-window: align to the END of the current week (Saturday) so the
    // bottom-right cell is the most-recent Saturday — keeps the grid stable
    // when the user lands on the page mid-week. Today is rendered with a
    // border within the grid wherever it falls.
    const endDow = end.getDay(); // 0 = Sun .. 6 = Sat
    const lastCell = addDays(end, 6 - endDow); // upcoming Saturday
    const firstCell = addDays(lastCell, -(totalDays - 1));
    const firstActivity = firstActivityDate ? parseLocalDate(firstActivityDate) : null;
    const todayYmd = fmtLocalDate(new Date());

    const out: BuiltCell[] = [];
    for (let i = 0; i < totalDays; i++) {
      const date = addDays(firstCell, i);
      const ymd = fmtLocalDate(date);
      const row = byDate.get(ymd);
      out.push({
        date,
        ymd,
        netPnl: row?.netPnl ?? 0,
        count: row?.count ?? 0,
        preHistory: firstActivity ? date < firstActivity : false,
        isToday: ymd === todayYmd,
      });
    }

    // Reshape into [week][dayOfWeek]
    const wks: BuiltCell[][] = [];
    for (let w = 0; w < weeksCount; w++) {
      wks.push(out.slice(w * 7, w * 7 + 7));
    }

    // Month labels — first column of each new month within the visible range.
    const markers: { label: string; weekIdx: number }[] = [];
    let lastMonth = -1;
    for (let w = 0; w < weeksCount; w++) {
      const d = wks[w][0].date;
      if (d.getMonth() !== lastMonth) {
        markers.push({
          label: d.toLocaleDateString(intlLocale, { month: "short" }),
          weekIdx: w,
        });
        lastMonth = d.getMonth();
      }
    }

    return { weeks: wks, monthMarkers: markers };
  }, [byDate, endDate, firstActivityDate, weeksCount, totalDays, intlLocale]);

  // maxAbs over the visible window — drives the intensity scale and the legend.
  const maxAbs = React.useMemo(() => {
    let m = 0;
    for (const wk of weeks) {
      for (const c of wk) {
        const a = Math.abs(c.netPnl);
        if (a > m) m = a;
      }
    }
    return m;
  }, [weeks]);

  // Layout mode — 1fr fill below the threshold, fixed pitch + scroll at/above.
  const isScrollMode = weeksCount >= SCROLL_WEEKS_THRESHOLD;

  const noPnlLabel = t("dashboard.heatmap.noRealizedPnl");
  const dayLabels = DAY_LABEL_KEYS.map((k) => t(k));
  const labels: HeatmapLabels = {
    t,
    intlLocale,
    noPnlLabel,
    dayLabels,
  };

  return (
    <div className="flex flex-col gap-2">
      {isScrollMode ? (
        <ScrollGrid
          weeks={weeks}
          weeksCount={weeksCount}
          monthMarkers={monthMarkers}
          maxAbs={maxAbs}
          labels={labels}
        />
      ) : (
        <FillGrid
          weeks={weeks}
          weeksCount={weeksCount}
          monthMarkers={monthMarkers}
          maxAbs={maxAbs}
          labels={labels}
        />
      )}

      <Legend maxAbs={maxAbs} legendLabel={t("dashboard.heatmap.legend")} />
    </div>
  );
}

interface HeatmapLabels {
  t: ReturnType<typeof useT>;
  intlLocale: string;
  noPnlLabel: string;
  dayLabels: string[];
}

// ---------------------------------------------------------------------------
// Fill mode — single CSS Grid with all rows + columns in one grid context so
// labels align with cells automatically. Cells use aspect-ratio:1 to stay
// square while their width tracks the container's free space.
// ---------------------------------------------------------------------------

interface GridProps {
  weeks: BuiltCell[][];
  weeksCount: number;
  monthMarkers: { label: string; weekIdx: number }[];
  maxAbs: number;
  labels: HeatmapLabels;
}

function FillGrid({ weeks, weeksCount, monthMarkers, maxAbs, labels }: GridProps) {
  // Grid: col 1 = day-of-week label column (auto), cols 2..N+1 = weeks (1fr each).
  // Rows: row 1 = month-labels row (auto), rows 2..8 = day-of-week rows.
  //
  // Day-of-week labels sit in col 1, rows 2-8. Month labels span their column
  // in row 1. Cells fill cols 2..N+1, rows 2..8. Because everything lives in
  // the same grid, labels align with cell centers without manual offset math.
  const gridTemplateColumns = `auto repeat(${weeksCount}, minmax(0, 1fr))`;

  return (
    <div
      className="grid w-full"
      style={{
        gridTemplateColumns,
        columnGap: `${FILL_CELL_GAP}px`,
        rowGap: `${FILL_CELL_GAP}px`,
      }}
    >
      {/* Month-labels row — one span per marker, anchored to the week column it
          belongs to. Empty cells in row 1 simply collapse. */}
      <span
        aria-hidden
        style={{ gridColumn: 1, gridRow: 1 }}
        className="h-3"
      />
      {monthMarkers.map((m) => (
        <span
          key={`${m.label}-${m.weekIdx}`}
          style={{ gridColumn: m.weekIdx + 2, gridRow: 1 }}
          className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary leading-none"
        >
          {m.label}
        </span>
      ))}

      {/* Day-of-week labels — col 1, rows 2..8. Hide alternate rows so M/W/F
          read cleanly without cluttering the column. */}
      {labels.dayLabels.map((d, i) => (
        <span
          key={`dow-${i}`}
          style={{ gridColumn: 1, gridRow: i + 2 }}
          className={cn(
            "flex items-center justify-end pr-1.5 font-mono text-[10px] text-text-tertiary",
            i % 2 === 1 ? "opacity-100" : "opacity-0",
          )}
        >
          {d}
        </span>
      ))}

      {/* Cells — one tile per week-day pair. We render column-major so the
          spread shape matches the existing data layout (weeks across, days down). */}
      {weeks.map((week, w) =>
        week.map((c, d) => (
          <Tooltip key={c.ymd}>
            <TooltipTrigger asChild>
              <div
                role="img"
                aria-label={cellAriaLabel(c, labels)}
                style={{
                  gridColumn: w + 2,
                  gridRow: d + 2,
                  aspectRatio: "1 / 1",
                  background: cellBackground(c, maxAbs),
                  boxShadow: c.isToday
                    ? "inset 0 0 0 1px var(--text-primary)"
                    : undefined,
                }}
                className="rounded-[2px] transition-transform hover:scale-110 hover:ring-1 hover:ring-text/40"
              />
            </TooltipTrigger>
            <CellTooltip cell={c} labels={labels} />
          </Tooltip>
        )),
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scroll mode — used at 52w. Same grid concept but cell columns are fixed-px
// rather than 1fr, and the whole thing lives inside an overflow-x-auto wrapper.
// ---------------------------------------------------------------------------

function ScrollGrid({ weeks, weeksCount, monthMarkers, maxAbs, labels }: GridProps) {
  const gridTemplateColumns = `auto repeat(${weeksCount}, ${SCROLL_CELL_SIZE}px)`;

  return (
    <div className="overflow-x-auto">
      <div
        className="grid"
        style={{
          gridTemplateColumns,
          columnGap: `${SCROLL_CELL_GAP}px`,
          rowGap: `${SCROLL_CELL_GAP}px`,
        }}
      >
        <span
          aria-hidden
          style={{ gridColumn: 1, gridRow: 1 }}
          className="h-3"
        />
        {monthMarkers.map((m) => (
          <span
            key={`${m.label}-${m.weekIdx}`}
            style={{ gridColumn: m.weekIdx + 2, gridRow: 1 }}
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary leading-none"
          >
            {m.label}
          </span>
        ))}

        {labels.dayLabels.map((d, i) => (
          <span
            key={`dow-${i}`}
            style={{
              gridColumn: 1,
              gridRow: i + 2,
              height: `${SCROLL_CELL_SIZE}px`,
              lineHeight: `${SCROLL_CELL_SIZE}px`,
            }}
            className={cn(
              "pr-1.5 text-right font-mono text-[10px] text-text-tertiary",
              i % 2 === 1 ? "opacity-100" : "opacity-0",
            )}
          >
            {d}
          </span>
        ))}

        {weeks.map((week, w) =>
          week.map((c, d) => (
            <Tooltip key={c.ymd}>
              <TooltipTrigger asChild>
                <div
                  role="img"
                  aria-label={cellAriaLabel(c, labels)}
                  style={{
                    gridColumn: w + 2,
                    gridRow: d + 2,
                    width: `${SCROLL_CELL_SIZE}px`,
                    height: `${SCROLL_CELL_SIZE}px`,
                    background: cellBackground(c, maxAbs),
                    boxShadow: c.isToday
                      ? "inset 0 0 0 1px var(--text-primary)"
                      : undefined,
                  }}
                  className="rounded-[2px] transition-transform hover:scale-125 hover:ring-1 hover:ring-text/40"
                />
              </TooltipTrigger>
              <CellTooltip cell={c} labels={labels} />
            </Tooltip>
          )),
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tooltip content — extracted so the two grids share one body.
// ---------------------------------------------------------------------------

function CellTooltip({ cell: c, labels }: { cell: BuiltCell; labels: HeatmapLabels }) {
  return (
    <TooltipContent side="top" className="font-mono text-[11px]">
      <div className="flex flex-col gap-0.5">
        <span className="text-text-tertiary">
          {fmtTooltipDate(c.date, labels.intlLocale)}
        </span>
        <span
          className={
            c.netPnl > 0
              ? "text-up"
              : c.netPnl < 0
                ? "text-down"
                : "text-text-tertiary"
          }
        >
          {fmtAmount(c.netPnl, labels.intlLocale, labels.noPnlLabel)}
        </span>
        <span className="text-text-tertiary">
          {c.count === 0
            ? c.preHistory
              ? labels.t("dashboard.heatmap.beforeFirstActivity")
              : labels.t("dashboard.heatmap.noActivity")
            : labels.t.plural("dashboard.heatmap.tooltipActivities", c.count)}
        </span>
      </div>
    </TooltipContent>
  );
}

// ---------------------------------------------------------------------------
// Cell color logic
// ---------------------------------------------------------------------------

function cellBackground(c: BuiltCell, maxAbs: number): string {
  if (c.preHistory && c.count === 0) {
    // Extra-faint neutral so users see "no journal yet" vs "no activity".
    return "color-mix(in srgb, var(--text-tertiary) 6%, transparent)";
  }
  if (c.netPnl === 0 || maxAbs === 0) {
    // No realized P&L this day — neutral subtle gray.
    return "var(--bg-subtle)";
  }
  const i = perceptualIntensity(Math.abs(c.netPnl), maxAbs);
  const pct = Math.round(i * 100);
  const hue = c.netPnl > 0 ? "var(--accent-up)" : "var(--accent-down)";
  return `color-mix(in srgb, ${hue} ${pct}%, transparent)`;
}

function cellAriaLabel(c: BuiltCell, labels: HeatmapLabels): string {
  const dateStr = fmtTooltipDate(c.date, labels.intlLocale);
  if (c.count === 0) {
    return labels.t("dashboard.heatmap.ariaCellEmpty", { date: dateStr });
  }
  return labels.t.plural(
    "dashboard.heatmap.ariaCellWithActivity",
    c.count,
    {
      date: dateStr,
      pnl: fmtAmount(c.netPnl, labels.intlLocale, labels.noPnlLabel),
    },
  );
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

function fmtLegendUsd(v: number): string {
  if (v === 0) return "$0";
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : "+";
  if (abs >= 10_000) return `${sign}$${(abs / 1000).toFixed(0)}k`;
  if (abs >= 1_000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

interface LegendTier {
  value: number;
  bg: string;
}

function buildLegendTiers(maxAbs: number): LegendTier[] {
  // 7 stops across [-max, 0, +max] for symmetric diverging legend.
  const tiers: LegendTier[] = [];
  const stops = [-1, -2 / 3, -1 / 3, 0, 1 / 3, 2 / 3, 1];
  for (const s of stops) {
    const v = s * maxAbs;
    if (s === 0 || maxAbs === 0) {
      tiers.push({ value: 0, bg: "var(--bg-subtle)" });
      continue;
    }
    const i = perceptualIntensity(Math.abs(v), maxAbs);
    const pct = Math.round(i * 100);
    const hue = s > 0 ? "var(--accent-up)" : "var(--accent-down)";
    tiers.push({ value: v, bg: `color-mix(in srgb, ${hue} ${pct}%, transparent)` });
  }
  return tiers;
}

function Legend({ maxAbs, legendLabel }: { maxAbs: number; legendLabel: string }) {
  const tiers = React.useMemo(() => buildLegendTiers(maxAbs), [maxAbs]);
  const noData = maxAbs === 0;

  return (
    <div className="mt-3 flex flex-col gap-1">
      <div className="flex items-center gap-[3px]">
        {tiers.map((t, i) => (
          <div
            key={i}
            className="flex flex-col items-center gap-1"
            style={{ minWidth: "42px" }}
          >
            <span
              className="rounded-[2px]"
              style={{
                width: "14px",
                height: "14px",
                background: t.bg,
              }}
            />
            <span className="font-mono text-[9px] tabular-nums text-text-tertiary">
              {noData ? (i === 3 ? "$0" : "") : fmtLegendUsd(t.value)}
            </span>
          </div>
        ))}
      </div>
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
        {legendLabel}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Local cn helper — avoids the shadcn cn import-chain when this file is rendered
// inside a server-component tree.
// ---------------------------------------------------------------------------

function cn(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}
