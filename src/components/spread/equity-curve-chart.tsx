"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";

/**
 * Equity curve: running sum of net P&L by close date, plus an overlay for
 * the all-time high (dotted horizontal at the right edge) and a dashed
 * vertical from current equity up to ATH when in drawdown.
 *
 * Data is pre-computed server-side and passed through `points`. Each point
 * is one calendar day with activity; gaps between dates are linearly
 * connected by the AreaChart (smooth visual continuity).
 *
 * Design rules:
 *   • Stroke uses var(--text), not signature amber — the page already burns
 *     its single amber moment on the Net P&L hero KPI.
 *   • Area fill is a barely-there 4% wash that still reads in both themes.
 *   • Tooltip surfaces the date, equity, and current drawdown in mono.
 */

export interface EquityPoint {
  /** Date-only key (YYYY-MM-DD). */
  date: string;
  /** Human label for x-axis (e.g. "May 7"). */
  label: string;
  /** Running cumulative net P&L USD at this point. */
  equity: number;
  /** Running peak so far (max equity at or before this point). */
  peak: number;
  /** equity − peak (≤ 0 always). */
  drawdownUsd: number;
}

interface Props {
  points?: EquityPoint[];
  /** Peak USD for the ATH reference line. Server passes this. */
  peakUsd?: number;
  /** Current drawdown in USD (peak − currentEquity). >0 → render the vertical. */
  currentDrawdownUsd?: number;
  /** Current equity at the latest point. */
  currentEquity?: number;
}

function fmtUsdShort(v: number): string {
  const sign = v < 0 ? "−" : "";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${sign}$${(abs / 1000).toFixed(0)}k`;
  if (abs >= 1_000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function EquityCurveChart({
  points = [],
  peakUsd = 0,
  currentDrawdownUsd = 0,
  currentEquity = 0,
}: Props) {
  // Empty-state: no activities yet. Show a flat dotted baseline so the
  // section keeps its shape rather than collapsing to nothing.
  if (points.length === 0) {
    return (
      <div className="flex h-[260px] w-full items-center justify-center rounded-md border border-dashed border-border bg-surface">
        <p className="font-serif text-sm italic text-text-tertiary">
          Equity curve will appear once activities are logged.
        </p>
      </div>
    );
  }

  // Final x-coordinate — anchors the ATH label + drawdown vertical.
  const lastLabel = points[points.length - 1]?.label ?? "";
  const inDrawdown =
    peakUsd > 0 && currentDrawdownUsd > 0 && currentEquity < peakUsd;

  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={points}
          margin={{ top: 16, right: 64, left: 12, bottom: 4 }}
        >
          <defs>
            <linearGradient id="equity-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--text-primary)" stopOpacity={0.08} />
              <stop offset="100%" stopColor="var(--text-primary)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="0" vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10, fill: "var(--text-tertiary)", fontFamily: "var(--font-jetbrains)" }}
            // ~6 ticks across the width regardless of sample size.
            interval={Math.max(0, Math.floor(points.length / 6) - 1)}
            minTickGap={20}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10, fill: "var(--text-tertiary)", fontFamily: "var(--font-jetbrains)" }}
            tickFormatter={fmtUsdShort}
            width={48}
            domain={["auto", "auto"]}
          />
          {/* Zero baseline — visual anchor for break-even. */}
          <ReferenceLine y={0} stroke="var(--border-strong)" strokeWidth={1} />

          {/* ATH dotted horizontal at the right edge. Only render when there's
              a positive peak to draw — all-loss series leave this off. */}
          {peakUsd > 0 && (
            <ReferenceLine
              y={peakUsd}
              stroke="var(--text-tertiary)"
              strokeDasharray="2 3"
              strokeWidth={1}
              label={{
                value: `ATH ${fmtUsdShort(peakUsd)}`,
                position: "right",
                fontSize: 10,
                fill: "var(--text-tertiary)",
                fontFamily: "var(--font-jetbrains)",
              }}
            />
          )}

          {/* Drawdown vertical: from current equity up to peak, anchored at
              the last x. Only when we're actually below ATH. */}
          {inDrawdown && (
            <ReferenceLine
              segment={[
                { x: lastLabel, y: currentEquity },
                { x: lastLabel, y: peakUsd },
              ]}
              stroke="var(--accent-down)"
              strokeDasharray="3 3"
              strokeWidth={1.25}
              label={{
                value: `−${fmtUsdShort(currentDrawdownUsd).replace("$", "$")}`,
                position: "insideTopRight",
                fontSize: 10,
                fill: "var(--accent-down)",
                fontFamily: "var(--font-jetbrains)",
              }}
            />
          )}

          <Tooltip
            cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
            contentStyle={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-color)",
              borderRadius: 6,
              fontFamily: "var(--font-jetbrains)",
              fontSize: 11,
              color: "var(--text-primary)",
              padding: "8px 10px",
            }}
            labelStyle={{
              color: "var(--text-tertiary)",
              fontSize: 10,
              marginBottom: 4,
              textTransform: "uppercase",
              letterSpacing: "0.12em",
            }}
            formatter={(value, name, item) => {
              const v = Number(value);
              const sign = v >= 0 ? "+" : "−";
              const p = item?.payload as EquityPoint | undefined;
              const dd = p?.drawdownUsd ?? 0;
              const label = `${sign}$${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}${
                dd < 0 ? `  ·  dd ${fmtUsdShort(dd)}` : ""
              }`;
              return [label, "equity"];
            }}
          />
          <Area
            type="monotone"
            dataKey="equity"
            stroke="var(--text-primary)"
            strokeWidth={1.5}
            fill="url(#equity-fill)"
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
