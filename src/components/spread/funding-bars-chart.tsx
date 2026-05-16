"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

// 73 days of daily-aggregated funding (sum of ~3 settlements/day).
// Realistic decay: started ~17.8% APR, dropped to ~9% APR by the end.
// Deterministic — no Math.random — avoids hydration mismatch.
const fundingByDay = [
  23.1, 22.4, 24.0, 21.8, 23.6, 25.1, 22.9, 24.3, 23.1, 22.6,
  21.9, 23.4, 22.8, 24.1, 21.4, 22.7, 23.0, 21.6, 22.2, 21.1,
  20.7, 21.8, 20.3, 21.5, 20.1, 19.7, 20.8, 19.4, 20.0, 18.9,
  19.5, 18.3, 19.2, 17.9, 18.7, 17.5, 18.4, 17.1, 17.8, 16.6,
  17.5, 16.2, 16.9, 15.8, 16.4, 15.3, 16.1, 14.8, 15.7, 14.3,
  15.0, 13.7, 14.5, 13.2, 14.0, 12.8, 13.6, 12.3, 13.1, 11.8,
  12.5, 11.4, 12.1, 10.9, 11.6, 10.4, 11.2, 10.0, 10.7, 9.5,
  10.3, 8.9, 9.2,
].map((amount, i) => ({
  day: i + 1,
  date: new Date(2026, 0, 14 + i).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  }),
  amount,
}));

const closeThreshold = 12.94; // ~10% APR / 365 * 47300 ≈ $12.94/day

export function FundingBarsChart() {
  return (
    <div className="h-[200px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={fundingByDay}
          margin={{ top: 8, right: 8, left: 8, bottom: 4 }}
        >
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
            tickFormatter={(v) => `$${v}`}
            width={36}
          />
          <ReferenceLine
            y={closeThreshold}
            stroke="var(--accent-signature)"
            strokeDasharray="3 4"
            strokeWidth={1}
            label={{
              value: "close threshold",
              position: "right",
              fontSize: 9,
              fill: "var(--accent-signature)",
              fontFamily: "var(--font-jetbrains)",
            }}
          />
          <Tooltip
            cursor={{ fill: "var(--bg-subtle)" }}
            contentStyle={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-color)",
              borderRadius: 6,
              fontFamily: "var(--font-jetbrains)",
              fontSize: 11,
              color: "var(--text-primary)",
              padding: "6px 10px",
            }}
            formatter={(value) => [`$${Number(value).toFixed(2)}`, "funding"]}
            labelFormatter={(label, payload) =>
              payload?.[0]?.payload?.date ?? `day ${label}`
            }
          />
          <Bar
            dataKey="amount"
            fill="var(--accent-up)"
            radius={[2, 2, 0, 0]}
            maxBarSize={9}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
