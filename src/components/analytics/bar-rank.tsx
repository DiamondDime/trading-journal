"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { useT } from "@/lib/i18n/client";

/**
 * Horizontal bar chart for ranked dollar values (e.g. P&L by asset, P&L by
 * regime tag). Negative bars extend left, positives right — diverging
 * around a zero centerline. Up/down tone on each bar based on sign.
 *
 * Why horizontal: more legible for ranked lists (10-20 entries) where the
 * categorical axis would otherwise force tiny x-tick text.
 */

export interface BarRankPoint {
  /** Display label — Y-axis tick. */
  label: string;
  /** Signed value — drives both bar length and color. */
  value: number;
  /** Secondary label surfaced in the tooltip (e.g. "12 activities"). */
  meta?: string;
}

interface Props {
  rows: BarRankPoint[];
  /** Height per bar in px. Total chart height = rows.length × this + ~32px. */
  rowHeight?: number;
  /** Show value labels at the bar end. Default true. */
  showValueLabels?: boolean;
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

export function BarRank({ rows, rowHeight = 26, showValueLabels = true }: Props) {
  const t = useT();
  if (rows.length === 0) {
    return (
      <div className="flex h-[160px] w-full items-center justify-center rounded-md border border-dashed border-border bg-inset">
        <p className="font-serif text-sm italic text-text-tertiary">
          {t("numbers.notEnoughData")}
        </p>
      </div>
    );
  }

  const height = rows.length * rowHeight + 32;
  // Domain symmetric around zero so positive + negative scale to the same
  // pixel-per-dollar — the visual comparison is honest.
  const maxAbs = rows.reduce((m, r) => Math.max(m, Math.abs(r.value)), 0);
  const domain = maxAbs > 0 ? [-maxAbs * 1.1, maxAbs * 1.1] : [-1, 1];

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          layout="vertical"
          data={rows}
          margin={{ top: 4, right: 64, left: 4, bottom: 4 }}
          barCategoryGap={4}
        >
          <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="0" horizontal={false} />
          <XAxis
            type="number"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10, fill: "var(--text-tertiary)", fontFamily: "var(--font-jetbrains)" }}
            tickFormatter={fmtUsdShort}
            domain={domain}
          />
          <YAxis
            type="category"
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "var(--text-secondary)", fontFamily: "var(--font-jetbrains)" }}
            width={92}
          />
          <ReferenceLine x={0} stroke="var(--border-strong)" strokeWidth={1} />
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
            formatter={(value, _name, item) => {
              const p = item?.payload as BarRankPoint | undefined;
              const v = Number(value);
              const tone = v >= 0 ? "" : "−";
              const usd = `${tone || (v >= 0 ? "+" : "")}$${Math.abs(v).toLocaleString("en-US", {
                maximumFractionDigits: 0,
              })}`;
              const meta = p?.meta ? ` · ${p.meta}` : "";
              return [`${usd}${meta}`, ""];
            }}
            labelFormatter={(label) => String(label)}
          />
          <Bar
            dataKey="value"
            isAnimationActive={false}
            radius={[0, 2, 2, 0]}
            label={
              showValueLabels
                ? {
                    position: "right",
                    // Recharts' LabelFormatter signature is (label) => ReactNode
                    // where `label` is the raw RenderableText (string|number|undefined).
                    // We coerce to number defensively — anything non-numeric collapses
                    // to "—" rather than the unhelpful "+$NaN".
                    formatter: (label) => {
                      const n = typeof label === "number" ? label : Number(label);
                      return Number.isFinite(n) ? fmtUsdShort(n) : "—";
                    },
                    fill: "var(--text-secondary)",
                    fontSize: 10,
                    fontFamily: "var(--font-jetbrains)",
                  }
                : false
            }
          >
            {rows.map((r, i) => (
              <Cell
                key={i}
                fill={
                  r.value >= 0
                    ? "color-mix(in srgb, var(--accent-up) 65%, transparent)"
                    : "color-mix(in srgb, var(--accent-down) 65%, transparent)"
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
