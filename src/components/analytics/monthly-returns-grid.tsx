"use client";

import * as React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { MonthlyPnlRow } from "@/lib/db/activity";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/resolve";

/**
 * Monthly returns grid — years on rows, months Jan-Dec across columns. One of
 * the loved-most reads in trading journals: a single glance at "which months
 * print, which ones bleed".
 *
 * Each cell color-codes by sign + intensity (color-mix at percent intensity,
 * same approach as the dashboard heatmap). Year-total column on the right.
 *
 * Math considerations (subtle):
 *   1. Years range spans `min(year)` → `max(year)` from the input. Gaps in
 *      between (e.g. 2026 with no Aug activity) render as neutral empty cells.
 *   2. Intensity is normalised per-grid: `|netPnl| / maxAbs` where maxAbs is
 *      the largest absolute value across ALL displayed months. One enormous
 *      month shouldn't blow out the visual scale for everyone else, so we
 *      apply a square-root ramp (same as the daily heatmap).
 *   3. Year totals sum every present month in that row — they don't try to
 *      match a calendar-year boundary if data is mid-year.
 *
 * Empty input renders an italic-serif placeholder, doesn't crash.
 */

interface Props {
  rows: MonthlyPnlRow[];
}

const MONTH_KEYS = [
  "analytics.charts.months.jan",
  "analytics.charts.months.feb",
  "analytics.charts.months.mar",
  "analytics.charts.months.apr",
  "analytics.charts.months.may",
  "analytics.charts.months.jun",
  "analytics.charts.months.jul",
  "analytics.charts.months.aug",
  "analytics.charts.months.sep",
  "analytics.charts.months.oct",
  "analytics.charts.months.nov",
  "analytics.charts.months.dec",
] as const;

interface YearRow {
  year: number;
  months: (MonthlyPnlRow | null)[]; // length 12
  total: number;
  monthCount: number;
}

function parseMonth(key: string): { year: number; monthIdx: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const monthIdx = Number(m[2]) - 1;
  if (monthIdx < 0 || monthIdx > 11) return null;
  return { year, monthIdx };
}

function fmtCellAmount(v: number): string {
  if (v === 0) return "$0";
  const sign = v < 0 ? "−" : "+";
  const abs = Math.abs(v);
  if (abs >= 10_000) return `${sign}$${(abs / 1000).toFixed(0)}k`;
  if (abs >= 1_000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtTooltipAmount(v: number, intlLocale: string): string {
  const sign = v < 0 ? "−" : v > 0 ? "+" : "";
  return `${sign}$${Math.abs(v).toLocaleString(intlLocale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Same perceptual ramp as the daily heatmap — sqrt of normalized magnitude. */
const MIN_INTENSITY = 0.18;
function perceptualIntensity(abs: number, max: number): number {
  if (max <= 0 || abs <= 0) return 0;
  const raw = Math.sqrt(Math.min(1, abs / max));
  return MIN_INTENSITY + raw * (1 - MIN_INTENSITY);
}

function cellBackground(v: number | null, maxAbs: number): string {
  if (v == null) return "var(--bg-inset)"; // no activity → extra faint
  if (v === 0 || maxAbs === 0) return "var(--bg-subtle)";
  const i = perceptualIntensity(Math.abs(v), maxAbs);
  const pct = Math.round(i * 100);
  const hue = v > 0 ? "var(--accent-up)" : "var(--accent-down)";
  return `color-mix(in srgb, ${hue} ${pct}%, transparent)`;
}

function cellTextColor(v: number | null): string {
  if (v == null || v === 0) return "var(--text-tertiary)";
  // Don't tint the inner number — the cell background already encodes sign.
  // Solid foreground reads cleanly against both up-bg and down-bg tints.
  return "var(--text-primary)";
}

export function MonthlyReturnsGrid({ rows }: Props) {
  const t = useT();
  const intlLocale = t.locale === "ru" ? "ru-RU" : "en-US";
  const MONTH_LABELS = MONTH_KEYS.map((k) => t(k as MessageKey));
  // Pivot into years × months. Skip rows that don't parse (defensive).
  const { years, maxAbs } = React.useMemo(() => {
    const byYear = new Map<number, (MonthlyPnlRow | null)[]>();
    let max = 0;
    for (const r of rows) {
      const parsed = parseMonth(r.month);
      if (!parsed) continue;
      const { year, monthIdx } = parsed;
      if (!byYear.has(year)) {
        byYear.set(year, new Array(12).fill(null) as (MonthlyPnlRow | null)[]);
      }
      byYear.get(year)![monthIdx] = r;
      if (Math.abs(r.netPnl) > max) max = Math.abs(r.netPnl);
    }
    // Fill year gaps so a 2024 → 2026 range renders 2025 as an empty row.
    const sortedYears = [...byYear.keys()].sort((a, b) => a - b);
    if (sortedYears.length > 0) {
      const first = sortedYears[0];
      const last = sortedYears[sortedYears.length - 1];
      for (let y = first; y <= last; y++) {
        if (!byYear.has(y)) {
          byYear.set(y, new Array(12).fill(null) as (MonthlyPnlRow | null)[]);
        }
      }
    }
    const final = [...byYear.keys()]
      .sort((a, b) => a - b)
      .map<YearRow>((year) => {
        const months = byYear.get(year)!;
        let total = 0;
        let count = 0;
        for (const m of months) {
          if (m != null) {
            total += m.netPnl;
            count += 1;
          }
        }
        return { year, months, total, monthCount: count };
      });
    return { years: final, maxAbs: max };
  }, [rows]);

  if (years.length === 0) {
    return (
      <div className="flex h-[140px] w-full items-center justify-center rounded-md border border-dashed border-border bg-inset">
        <p className="font-serif text-sm italic text-text-tertiary">
          {t("numbers.notEnoughData")}
        </p>
      </div>
    );
  }

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full min-w-[640px] border-separate border-spacing-1">
        <thead>
          <tr>
            <th className="w-12 px-1 py-1 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
              {t("analytics.tables.year" as MessageKey)}
            </th>
            {MONTH_LABELS.map((m, i) => (
              <th
                key={i}
                className="px-1 py-1 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary"
              >
                {m}
              </th>
            ))}
            <th className="w-16 px-1 py-1 text-right font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
              {t("analytics.tables.ytd" as MessageKey)}
            </th>
          </tr>
        </thead>
        <tbody>
          {years.map((y) => (
            <tr key={y.year}>
              <td className="px-1 py-1 font-mono text-[12px] font-medium tabular-nums text-text">
                {y.year}
              </td>
              {y.months.map((m, idx) => {
                const value = m?.netPnl ?? null;
                const cellLabel = MONTH_LABELS[idx];
                return (
                  <td key={idx} className="p-0 align-middle">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          role="img"
                          aria-label={
                            m
                              ? t("analytics.charts.monthlyAriaCell" as MessageKey, {
                                  month: cellLabel,
                                  year: y.year,
                                  amount: fmtTooltipAmount(m.netPnl, intlLocale),
                                  activities: t.plural("plurals.activities", m.count),
                                })
                              : t("analytics.charts.monthlyAriaEmpty" as MessageKey, {
                                  month: cellLabel,
                                  year: y.year,
                                })
                          }
                          className="flex h-9 min-w-[44px] items-center justify-center rounded-[3px] px-1 transition-transform hover:ring-1 hover:ring-text/30"
                          style={{ background: cellBackground(value, maxAbs) }}
                        >
                          <span
                            className="font-mono text-[11px] tabular-nums"
                            style={{ color: cellTextColor(value) }}
                          >
                            {m ? fmtCellAmount(m.netPnl) : "·"}
                          </span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent
                        side="top"
                        className="font-mono text-[11px]"
                      >
                        <div className="flex flex-col gap-0.5">
                          <span className="text-text-tertiary">
                            {cellLabel} {y.year}
                          </span>
                          {m ? (
                            <>
                              <span
                                className={
                                  m.netPnl > 0
                                    ? "text-up"
                                    : m.netPnl < 0
                                    ? "text-down"
                                    : "text-text-tertiary"
                                }
                              >
                                {fmtTooltipAmount(m.netPnl, intlLocale)}
                              </span>
                              <span className="text-text-tertiary">
                                {t.plural("plurals.activities", m.count)}
                              </span>
                            </>
                          ) : (
                            <span className="text-text-tertiary">
                              {t("analytics.charts.noActivity" as MessageKey)}
                            </span>
                          )}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </td>
                );
              })}
              <td className="px-2 text-right">
                <span
                  className={
                    "font-mono text-[12px] font-medium tabular-nums " +
                    (y.total > 0
                      ? "text-up"
                      : y.total < 0
                      ? "text-down"
                      : "text-text-tertiary")
                  }
                >
                  {y.monthCount > 0 ? fmtCellAmount(y.total) : "—"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
