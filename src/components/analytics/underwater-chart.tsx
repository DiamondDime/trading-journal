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
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/resolve";

/**
 * Underwater drawdown chart — for each closing event, plots
 * `(equity − peak) / peak × 100` (drawdown %, always ≤ 0).
 *
 * Standard quant practice: zero is on top, the curve dips down into negative
 * territory whenever equity is below the running high-water mark, and
 * recovers to zero each time a new ATH prints.
 *
 * Down-tone color, no signature amber — the page's one amber moment is
 * upstream in the headline.
 */

export interface UnderwaterPoint {
  date: string;
  label: string;
  /** Drawdown %, ≤ 0. */
  ddPct: number;
  /** Drawdown USD, ≤ 0. Surfaced in the tooltip. */
  ddUsd: number;
}

interface Props {
  points?: UnderwaterPoint[];
}

function fmtPct(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v * 100).toFixed(1)}%`;
}

function fmtUsdShort(v: number): string {
  const sign = v < 0 ? "−" : v > 0 ? "+" : "";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${sign}$${(abs / 1000).toFixed(0)}k`;
  if (abs >= 1_000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function UnderwaterChart({ points = [] }: Props) {
  const t = useT();
  if (points.length === 0) {
    return (
      <div className="flex h-[200px] w-full items-center justify-center rounded-md border border-dashed border-border bg-inset">
        <p className="font-serif text-sm italic text-text-tertiary">
          {t("numbers.notEnoughData")}
        </p>
      </div>
    );
  }

  return (
    <div className="h-[200px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 12, right: 24, left: 12, bottom: 4 }}>
          <defs>
            <linearGradient id="underwater-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent-down)" stopOpacity={0.45} />
              <stop offset="100%" stopColor="var(--accent-down)" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="0" vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10, fill: "var(--text-tertiary)", fontFamily: "var(--font-jetbrains)" }}
            interval={Math.max(0, Math.floor(points.length / 7) - 1)}
            minTickGap={20}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10, fill: "var(--text-tertiary)", fontFamily: "var(--font-jetbrains)" }}
            tickFormatter={(v: number) => fmtPct(v)}
            width={48}
            // Domain anchored at 0 on top; auto-scales the lower bound.
            domain={["auto", 0]}
          />
          <ReferenceLine y={0} stroke="var(--border-strong)" strokeWidth={1} />
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
            formatter={(value, _name, item) => {
              const p = item?.payload as UnderwaterPoint | undefined;
              const pct = Number(value);
              const ddUsd = p?.ddUsd ?? 0;
              return [
                `${fmtPct(pct)}  ·  ${fmtUsdShort(ddUsd)}`,
                t("analytics.charts.drawdown" as MessageKey),
              ];
            }}
          />
          <Area
            type="monotone"
            dataKey="ddPct"
            stroke="var(--accent-down)"
            strokeWidth={1.5}
            fill="url(#underwater-fill)"
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
