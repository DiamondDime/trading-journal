"use client";

import * as React from "react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/resolve";
import { fmtUsdShort } from "@/components/analytics/_format";

/**
 * Donut chart of categorical USD distribution (e.g. P&L by activity type or
 * capital by activity type). Center label shows the total + caption.
 *
 * Why donut over pie: the center is dead space that the eye scans first; we
 * use it for the headline total. Pure pie charts waste that real estate.
 *
 * Color rule: never use signature amber for slices — the page's single
 * amber moment lives in the headline above. Slices use neutral text-secondary
 * tones with up/down accents for "best vs worst" emphasis when applicable.
 */

export interface DonutSlice {
  /** Key for React + tooltip lookup. */
  key: string;
  /** Display label. */
  name: string;
  /** Slice value (positive). Signed values are absolute-summed for the
   *  geometry; the tooltip surfaces the signed original. */
  value: number;
  /** Tone determines fill color. */
  tone?: "up" | "down" | "neutral";
  /** Override fill if you need a specific palette slot. */
  fill?: string;
}

interface Props {
  slices: DonutSlice[];
  /** Center label heading — small uppercase, mono. */
  centerLabel: string;
  /** Center value — big mono. e.g. "$12,345". */
  centerValue: string;
  /** Optional caption under the value. */
  centerCaption?: string;
}

const NEUTRAL_PALETTE = [
  "var(--text-primary)",
  "color-mix(in srgb, var(--text-primary) 70%, transparent)",
  "var(--text-secondary)",
  "color-mix(in srgb, var(--text-secondary) 65%, transparent)",
  "var(--text-tertiary)",
  "color-mix(in srgb, var(--text-tertiary) 60%, transparent)",
];

function toneFill(tone: DonutSlice["tone"], idx: number): string {
  if (tone === "up") return "var(--accent-up)";
  if (tone === "down") return "var(--accent-down)";
  return NEUTRAL_PALETTE[idx % NEUTRAL_PALETTE.length];
}

export function PnlDonut({
  slices,
  centerLabel,
  centerValue,
  centerCaption,
}: Props) {
  const t = useT();
  const total = slices.reduce((s, x) => s + Math.abs(x.value), 0);

  if (slices.length === 0 || total === 0) {
    return (
      <div className="flex h-[280px] w-full items-center justify-center rounded-md border border-dashed border-border bg-inset">
        <p className="font-serif text-sm italic text-text-tertiary">
          {t("numbers.notEnoughData")}
        </p>
      </div>
    );
  }

  // Recharts wants positive values for slice geometry. We pass `value` as
  // abs(value) and stash the original on a separate key for the tooltip.
  const data = slices.map((s, i) => ({
    ...s,
    absValue: Math.abs(s.value),
    fill: s.fill ?? toneFill(s.tone, i),
  }));

  return (
    <div
      className="relative h-[280px] w-full"
      role="img"
      aria-label={`${t("analytics.charts.ariaPnlDonut" as MessageKey)} · ${centerLabel}`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="absValue"
            nameKey="name"
            innerRadius="58%"
            outerRadius="86%"
            paddingAngle={1.5}
            stroke="var(--bg-surface)"
            strokeWidth={2}
            isAnimationActive={false}
          >
            {data.map((d) => (
              <Cell key={d.key} fill={d.fill} />
            ))}
          </Pie>
          <Tooltip
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
              const p = item?.payload as (DonutSlice & { absValue: number }) | undefined;
              if (!p) return ["—", ""];
              const pct = total > 0 ? (Math.abs(p.value) / total) * 100 : 0;
              return [`${fmtUsdShort(p.value)} · ${pct.toFixed(1)}%`, p.name];
            }}
          />
        </PieChart>
      </ResponsiveContainer>

      {/* Center label — absolutely positioned inside the donut hole. */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
          {centerLabel}
        </span>
        <span className="mt-1 font-mono text-[22px] font-medium tabular-nums leading-none text-text">
          {centerValue}
        </span>
        {centerCaption && (
          <span className="mt-1 font-serif text-[11px] italic text-text-tertiary">
            {centerCaption}
          </span>
        )}
      </div>
    </div>
  );
}
