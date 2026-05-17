"use client";

import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts";
import type { HoldTimeBucketRow } from "@/lib/db/activity";

/**
 * Hold-time histogram with secondary line for avg P&L per bucket.
 *
 * Primary axis (left): activity count per band — bars.
 * Secondary axis (right): mean net P&L $ per band — line.
 *
 * The mean P&L axis lets the trader see if longer holds correlate with bigger
 * wins (a common "patience pays" check) or whether scalp-heavy bands are
 * carrying the book.
 */

interface Props {
  rows: HoldTimeBucketRow[];
}

function fmtUsdShort(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const sign = v < 0 ? "−" : v > 0 ? "+" : "";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${sign}$${(abs / 1000).toFixed(0)}k`;
  if (abs >= 1_000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function HoldTimeHistogram({ rows }: Props) {
  // If every bucket is empty, fall back to the editorial empty state.
  const hasData = rows.some((r) => r.count > 0);
  if (!hasData) {
    return (
      <div className="flex h-[220px] w-full items-center justify-center rounded-md border border-dashed border-border bg-inset">
        <p className="font-serif text-sm italic text-text-tertiary">
          Not enough data yet.
        </p>
      </div>
    );
  }

  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 16, right: 48, left: 12, bottom: 4 }}>
          <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="0" vertical={false} />
          <XAxis
            dataKey="bucket"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "var(--text-tertiary)", fontFamily: "var(--font-jetbrains)" }}
          />
          <YAxis
            yAxisId="count"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10, fill: "var(--text-tertiary)", fontFamily: "var(--font-jetbrains)" }}
            allowDecimals={false}
            width={32}
          />
          <YAxis
            yAxisId="avg"
            orientation="right"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10, fill: "var(--text-tertiary)", fontFamily: "var(--font-jetbrains)" }}
            tickFormatter={fmtUsdShort}
            width={48}
          />
          <ReferenceLine
            yAxisId="avg"
            y={0}
            stroke="var(--border-strong)"
            strokeWidth={1}
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
              padding: "8px 10px",
            }}
            labelStyle={{
              color: "var(--text-tertiary)",
              fontSize: 10,
              marginBottom: 4,
              textTransform: "uppercase",
              letterSpacing: "0.12em",
            }}
            formatter={(value, name) => {
              const v = Number(value);
              if (name === "count") return [`${v} activities`, "count"];
              if (name === "avgPnl") return [fmtUsdShort(v), "avg P&L"];
              return [String(value), String(name)];
            }}
          />
          <Bar
            yAxisId="count"
            dataKey="count"
            maxBarSize={48}
            radius={[2, 2, 0, 0]}
          >
            {rows.map((r, i) => (
              <Cell
                key={i}
                fill={
                  r.avgPnl >= 0
                    ? "color-mix(in srgb, var(--text-secondary) 65%, transparent)"
                    : "color-mix(in srgb, var(--accent-down) 45%, transparent)"
                }
              />
            ))}
          </Bar>
          <Line
            yAxisId="avg"
            type="monotone"
            dataKey="avgPnl"
            stroke="var(--text-primary)"
            strokeWidth={1.75}
            dot={{ r: 3, fill: "var(--text-primary)", strokeWidth: 0 }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
