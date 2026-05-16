"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

// 73 days of basis (bps). Mean-reverting around -3 to +5 bps, with a brief
// dislocation around day 40 (-22 bps) before returning.
const basisByDay = [
  2, 4, 3, 1, -2, -1, 2, 3, 1, -1,
  2, 4, 3, 5, 3, 1, 0, -2, -3, -1,
  1, 2, 4, 3, 2, 0, -1, -3, -2, -1,
  2, 1, 3, 2, -2, -5, -8, -12, -16, -22,
  -19, -14, -10, -7, -4, -2, 0, 1, 3, 2,
  1, 3, 2, 0, -1, -2, 0, 1, 2, 1,
  -1, 0, 2, 1, 0, -1, 1, 2, 0, -1,
  0, 1, -1,
].map((bps, i) => ({
  day: i + 1,
  date: new Date(2026, 0, 14 + i).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  }),
  bps,
}));

export function BasisLineChart() {
  return (
    <div className="h-[200px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={basisByDay}
          margin={{ top: 8, right: 8, left: 8, bottom: 4 }}
        >
          <defs>
            <linearGradient id="basis-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--accent-info)" stopOpacity={0.15} />
              <stop offset="95%" stopColor="var(--accent-info)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            stroke="var(--border-subtle)"
            strokeDasharray="0"
            vertical={false}
          />
          <XAxis
            dataKey="day"
            tickLine={false}
            axisLine={false}
            tick={{
              fontSize: 10,
              fill: "var(--text-tertiary)",
              fontFamily: "var(--font-jetbrains)",
            }}
            interval={9}
            tickFormatter={(d) => `d${d}`}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{
              fontSize: 10,
              fill: "var(--text-tertiary)",
              fontFamily: "var(--font-jetbrains)",
            }}
            tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}`}
            width={36}
          />
          <ReferenceLine
            y={0}
            stroke="var(--border-strong)"
            strokeWidth={1}
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
              padding: "6px 10px",
            }}
            formatter={(value) => {
              const v = Number(value);
              return [`${v > 0 ? "+" : ""}${v} bps`, "basis"];
            }}
            labelFormatter={(label, payload) =>
              payload?.[0]?.payload?.date ?? `day ${label}`
            }
          />
          <Area
            type="monotone"
            dataKey="bps"
            stroke="var(--accent-info)"
            strokeWidth={1.5}
            fill="url(#basis-fill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
