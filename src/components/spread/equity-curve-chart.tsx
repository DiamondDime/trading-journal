"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { ARCHIVE_DATA, type Activity, type ActivityType } from "@/lib/data/archive-data";

const WEEK_BUCKETS: { label: string; iso: string }[] = [
  { label: "Jan 8",  iso: "2026-01-08" },
  { label: "Jan 15", iso: "2026-01-15" },
  { label: "Jan 22", iso: "2026-01-22" },
  { label: "Jan 29", iso: "2026-01-29" },
  { label: "Feb 5",  iso: "2026-02-05" },
  { label: "Feb 12", iso: "2026-02-12" },
  { label: "Feb 19", iso: "2026-02-19" },
  { label: "Feb 26", iso: "2026-02-26" },
  { label: "Mar 5",  iso: "2026-03-05" },
  { label: "Mar 12", iso: "2026-03-12" },
  { label: "Mar 19", iso: "2026-03-19" },
  { label: "Mar 26", iso: "2026-03-26" },
  { label: "Apr 2",  iso: "2026-04-02" },
  { label: "Apr 9",  iso: "2026-04-09" },
  { label: "Apr 16", iso: "2026-04-16" },
  { label: "Apr 23", iso: "2026-04-23" },
  { label: "Apr 30", iso: "2026-04-30" },
  { label: "May 7",  iso: "2026-05-07" },
  { label: "May 14", iso: "2026-05-14" },
  { label: "May 16", iso: "2026-05-16" },
];

const SERIES: { key: ActivityType; label: string; color: string }[] = [
  { key: "spread",  label: "Spread",  color: "var(--accent-signature)" },
  { key: "trade",   label: "Trade",   color: "var(--accent-info)" },
  { key: "sale",    label: "Sale",    color: "var(--accent-brand)" },
  { key: "airdrop", label: "Airdrop", color: "var(--accent-up)" },
];

type Point = { week: string } & Record<ActivityType, number>;

// Cumulative realized PnL per activity-type up through each week boundary.
const DATA: Point[] = WEEK_BUCKETS.map(({ label, iso }) => {
  const point: Point = {
    week: label,
    spread: 0,
    trade: 0,
    sale: 0,
    airdrop: 0,
  };
  ARCHIVE_DATA.forEach((a: Activity) => {
    if (a.closedAt <= iso) {
      // Sales/airdrops cumulate hundreds of thousands and would dwarf
      // the spread/trade signal. Damp them to a comparable scale for
      // the visual; tooltip still shows the real number through formatter.
      const damp = a.type === "sale" || a.type === "airdrop" ? 0.05 : 1;
      point[a.type] += a.netPnl * damp;
    }
  });
  return point;
});

export function EquityCurveChart() {
  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={DATA}
          margin={{ top: 12, right: 12, left: 12, bottom: 4 }}
        >
          <defs>
            {SERIES.map((s) => (
              <linearGradient key={s.key} id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor={s.color} stopOpacity={0.5} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0.05} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid
            stroke="var(--border-subtle)"
            strokeDasharray="0"
            vertical={false}
          />
          <XAxis
            dataKey="week"
            tickLine={false}
            axisLine={false}
            tick={{
              fontSize: 10,
              fill: "var(--text-tertiary)",
              fontFamily: "var(--font-jetbrains)",
            }}
            interval={2}
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
            width={48}
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
              padding: "10px 12px",
            }}
            labelStyle={{
              color: "var(--text-tertiary)",
              fontSize: 10,
              marginBottom: 6,
              textTransform: "uppercase",
              letterSpacing: "0.12em",
            }}
            formatter={(value, name) => {
              const v = Number(value);
              const sign = v >= 0 ? "+" : "−";
              const series = SERIES.find((s) => s.key === name);
              return [
                `${sign}$${Math.abs(v).toFixed(0)}`,
                series?.label ?? String(name),
              ];
            }}
          />
          <Legend
            verticalAlign="top"
            align="right"
            iconType="square"
            iconSize={8}
            wrapperStyle={{
              fontFamily: "var(--font-inter)",
              fontSize: 11,
              color: "var(--text-secondary)",
              paddingBottom: 12,
            }}
            formatter={(value) =>
              SERIES.find((s) => s.key === value)?.label ?? value
            }
          />
          {SERIES.map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              stackId="1"
              stroke={s.color}
              strokeWidth={1.5}
              fill={`url(#fill-${s.key})`}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
