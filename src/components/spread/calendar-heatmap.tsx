"use client";

import * as React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Dashboard heatmap of daily realized net P&L over the last 13 weeks (91 days).
 *
 * Visual encoding:
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
 * Implementation: color-mix(in srgb, var(--up) <pct>%, transparent) renders
 * the intensity tier cleanly. All modern Chromium / Firefox / Safari (since
 * 16.4) support it. No JS color math required.
 *
 * TZ note: dates here are expected to come from the server as YYYY-MM-DD strings
 * already bucketed in the server's local TZ (see getDailyPnl in activity.ts).
 * The grid alignment uses Date constructed in local time so they line up.
 */

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
// Default window — the page can widen this via the `weeks` prop. 13w stays the
// dashboard default because it fits cleanly in the side-by-side grid; 26w/52w
// expand the column count for users that want a longer rear-view mirror.
const DEFAULT_WEEKS = 13;
const CELL_SIZE = 16; // px — Wave 12A: bumped from 12 for legibility
const CELL_GAP = 3;   // px — Wave 12A: bumped from 2 to match new cell size
const COL_PITCH = CELL_SIZE + CELL_GAP; // 19px

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

function fmtTooltipDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function fmtAmount(v: number): string {
  if (v === 0) return "no realized P&L";
  const sign = v > 0 ? "+" : "−"; // minus sign
  return `${sign}$${Math.abs(v).toLocaleString("en-US", {
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
  const { cells, weeks, monthMarkers } = React.useMemo(() => {
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
          label: d.toLocaleDateString("en-US", { month: "short" }),
          weekIdx: w,
        });
        lastMonth = d.getMonth();
      }
    }

    return { cells: out, weeks: wks, monthMarkers: markers };
  }, [byDate, endDate, firstActivityDate, weeksCount, totalDays]);

  // maxAbs over the visible window — drives the intensity scale and the legend.
  const maxAbs = React.useMemo(() => {
    let m = 0;
    for (const c of cells) {
      const a = Math.abs(c.netPnl);
      if (a > m) m = a;
    }
    return m;
  }, [cells]);

  // Grid width — used by the inner wrapper so the row of columns has an
  // intrinsic size and the parent's overflow-x-auto knows what to scroll past.
  const gridWidth = weeksCount * COL_PITCH;

  return (
    <div className="flex flex-col gap-2">
      {/* month labels + grid share a horizontal scroll container so wider
          windows (26w/52w) pan together. Day-of-week column stays pinned. */}
      <div className="flex gap-2">
        {/* day-of-week labels (pinned column) */}
        <div className="flex flex-col pt-4" style={{ gap: `${CELL_GAP}px` }}>
          {DAY_LABELS.map((d, i) => (
            <span
              key={i}
              className={cn(
                "w-3 text-center font-mono text-[10px] text-text-tertiary",
                i % 2 === 1 ? "opacity-100" : "opacity-0",
              )}
              style={{ height: `${CELL_SIZE}px`, lineHeight: `${CELL_SIZE}px` }}
            >
              {d}
            </span>
          ))}
        </div>

        {/* scrollable region — month labels + cells share the pan */}
        <div className="min-w-0 flex-1 overflow-x-auto">
          <div style={{ width: `${gridWidth}px`, minWidth: `${gridWidth}px` }}>
            {/* month labels row */}
            <div className="relative h-4">
              {monthMarkers.map((m) => (
                <span
                  key={`${m.label}-${m.weekIdx}`}
                  className="absolute font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary"
                  style={{ left: `calc(${m.weekIdx} * ${COL_PITCH}px + 1px)` }}
                >
                  {m.label}
                </span>
              ))}
            </div>

            {/* grid */}
            <div className="flex" style={{ gap: `${CELL_GAP}px` }}>
              {weeks.map((week, w) => (
                <div
                  key={w}
                  className="flex flex-col"
                  style={{ gap: `${CELL_GAP}px` }}
                >
                  {week.map((c) => (
                    <Tooltip key={c.ymd}>
                      <TooltipTrigger asChild>
                        <div
                          role="img"
                          aria-label={cellAriaLabel(c)}
                          className={cn(
                            "rounded-[2px] transition-transform hover:scale-125 hover:ring-1 hover:ring-text/40",
                          )}
                          style={{
                            width: `${CELL_SIZE}px`,
                            height: `${CELL_SIZE}px`,
                            background: cellBackground(c, maxAbs),
                            boxShadow: c.isToday
                              ? "inset 0 0 0 1px var(--text-primary)"
                              : undefined,
                          }}
                        />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="font-mono text-[11px]">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-text-tertiary">
                            {fmtTooltipDate(c.date)}
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
                            {fmtAmount(c.netPnl)}
                          </span>
                          <span className="text-text-tertiary">
                            {c.count === 0
                              ? c.preHistory
                                ? "before first activity"
                                : "no activity"
                              : `${c.count} ${c.count === 1 ? "activity" : "activities"}`}
                          </span>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Legend strip — -$max → 0 → +$max in 6 tiers. */}
      <Legend maxAbs={maxAbs} />
    </div>
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

function cellAriaLabel(c: BuiltCell): string {
  if (c.count === 0) {
    return `${fmtTooltipDate(c.date)}: no activity`;
  }
  return `${fmtTooltipDate(c.date)}: ${fmtAmount(c.netPnl)} across ${c.count} ${
    c.count === 1 ? "activity" : "activities"
  }`;
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
  // 6 tiers: -max, -2/3*max, -1/3*max, 0/neutral, +1/3*max, +2/3*max, +max.
  // That's 7 — we'll show 7 cells but the user spec says ~6. Use 7 for symmetry:
  // [-max, -mid, -low, 0, +low, +mid, +max]. It still reads "6 tiers" minus the
  // zero. 7 is the perceptually-uniform count for diverging scales.
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

function Legend({ maxAbs }: { maxAbs: number }) {
  const tiers = React.useMemo(() => buildLegendTiers(maxAbs), [maxAbs]);
  const noData = maxAbs === 0;

  return (
    <div className="mt-3 flex flex-col gap-1 pl-7">
      <div className="flex items-center gap-[3px]">
        {tiers.map((t, i) => (
          <div
            key={i}
            className="flex flex-col items-center"
            style={{ width: `${CELL_SIZE * 2.6}px` }}
          >
            <span
              className="rounded-[2px]"
              style={{
                width: `${CELL_SIZE}px`,
                height: `${CELL_SIZE}px`,
                background: t.bg,
              }}
            />
            <span className="mt-1 font-mono text-[9px] tabular-nums text-text-tertiary">
              {noData ? (i === 3 ? "$0" : "") : fmtLegendUsd(t.value)}
            </span>
          </div>
        ))}
      </div>
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
        Per-day realized P&L
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
