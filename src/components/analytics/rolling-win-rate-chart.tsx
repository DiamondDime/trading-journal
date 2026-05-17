"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";

/**
 * Rolling win-rate line chart — sliding window of N (default 20) most-recent
 * priors. For activity #k (k ≥ 1), the y-value is the win rate of activities
 * `max(0, k - window) … k - 1` (exclusive of the current one — we report the
 * rate going INTO this activity, not after it).
 *
 * Edges (k < window): we still compute the rate, but the tooltip surfaces
 * `n/window` so the user knows how many priors fed the value.
 *
 * Why a rolling window: spotting EDGE EROSION. A static lifetime win rate
 * smooths out the bad month that's eating your edge right now.
 */

export interface RollingWinRatePoint {
  /** Sequential index, 1-based. Could be the activity serial later. */
  index: number;
  /** Display label for the x-axis — typically the close date. */
  label: string;
  /** Win rate in [0, 1]. */
  winRate: number;
  /** Number of priors that fed this rate. <= window. */
  windowSize: number;
  /** Of `windowSize`, how many were wins. */
  winners: number;
}

interface Props {
  points?: RollingWinRatePoint[];
  /** Window size used to compute the values — surfaced in the tooltip. */
  window: number;
}

function fmtPct(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(0)}%`;
}

export function RollingWinRateChart({ points = [], window }: Props) {
  if (points.length === 0) {
    return (
      <div className="flex h-[220px] w-full items-center justify-center rounded-md border border-dashed border-border bg-inset">
        <p className="font-serif text-sm italic text-text-tertiary">
          Not enough data yet.
        </p>
      </div>
    );
  }

  return (
    <div className="h-[220px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 12, right: 24, left: 12, bottom: 4 }}>
          <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="0" vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10, fill: "var(--text-tertiary)", fontFamily: "var(--font-jetbrains)" }}
            interval={Math.max(0, Math.floor(points.length / 7) - 1)}
            minTickGap={24}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10, fill: "var(--text-tertiary)", fontFamily: "var(--font-jetbrains)" }}
            tickFormatter={(v: number) => fmtPct(v)}
            width={40}
            domain={[0, 1]}
            ticks={[0, 0.25, 0.5, 0.75, 1]}
          />
          {/* 50% reference — visual anchor for break-even win rate. */}
          <ReferenceLine
            y={0.5}
            stroke="var(--border-strong)"
            strokeDasharray="3 3"
            strokeWidth={1}
            label={{
              value: "50%",
              position: "right",
              fontSize: 10,
              fill: "var(--text-tertiary)",
              fontFamily: "var(--font-jetbrains)",
            }}
          />
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
            formatter={(_value, _name, item) => {
              const p = item?.payload as RollingWinRatePoint | undefined;
              if (!p) return ["—", "win rate"];
              return [
                `${fmtPct(p.winRate)} · ${p.winners}/${p.windowSize}`,
                `win rate (window ${window})`,
              ];
            }}
          />
          <Line
            type="monotone"
            dataKey="winRate"
            stroke="var(--text-primary)"
            strokeWidth={1.75}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
