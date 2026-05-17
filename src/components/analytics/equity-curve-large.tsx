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
import type { EquityPoint } from "@/components/spread/equity-curve-chart";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/resolve";

/**
 * Track-record full-width equity curve — 480px tall variant of the dashboard
 * `EquityCurveChart`. Shows ATH overlay + drawdown vertical anchored at the
 * series tail. Same visual language as the dashboard so the user reads it
 * fluently.
 *
 * Why fork instead of parameterise: the dashboard's chart is intentionally
 * compact (260px, fewer ticks). Pushing height + tick density / right margin
 * config through props would muddy that surface. Two separate components
 * stay easier to read.
 */

interface Props {
  points?: EquityPoint[];
  peakUsd?: number;
  currentDrawdownUsd?: number;
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

export function EquityCurveLarge({
  points = [],
  peakUsd = 0,
  currentDrawdownUsd = 0,
  currentEquity = 0,
}: Props) {
  const t = useT();
  if (points.length === 0) {
    return (
      <div className="flex h-[480px] w-full items-center justify-center rounded-md border border-dashed border-border bg-inset">
        <p className="font-serif text-base italic text-text-tertiary">
          {t("analytics.charts.equityEmpty" as MessageKey)}
        </p>
      </div>
    );
  }

  const lastLabel = points[points.length - 1]?.label ?? "";
  const inDrawdown =
    peakUsd > 0 && currentDrawdownUsd > 0 && currentEquity < peakUsd;

  return (
    <div
      className="h-[480px] w-full"
      role="img"
      aria-label={t("analytics.charts.ariaEquity" as MessageKey)}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={points}
          margin={{ top: 24, right: 88, left: 16, bottom: 8 }}
        >
          <defs>
            <linearGradient id="equity-large-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--text-primary)" stopOpacity={0.1} />
              <stop offset="100%" stopColor="var(--text-primary)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="0" vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "var(--text-tertiary)", fontFamily: "var(--font-jetbrains)" }}
            interval={Math.max(0, Math.floor(points.length / 9) - 1)}
            minTickGap={24}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "var(--text-tertiary)", fontFamily: "var(--font-jetbrains)" }}
            tickFormatter={fmtUsdShort}
            width={60}
            domain={["auto", "auto"]}
          />
          <ReferenceLine y={0} stroke="var(--border-strong)" strokeWidth={1} />

          {peakUsd > 0 && (
            <ReferenceLine
              y={peakUsd}
              stroke="var(--text-tertiary)"
              strokeDasharray="2 3"
              strokeWidth={1}
              label={{
                value: `${t("analytics.charts.ath" as MessageKey)} ${fmtUsdShort(peakUsd)}`,
                position: "right",
                fontSize: 11,
                fill: "var(--text-tertiary)",
                fontFamily: "var(--font-jetbrains)",
              }}
            />
          )}

          {inDrawdown && (
            <ReferenceLine
              segment={[
                { x: lastLabel, y: currentEquity },
                { x: lastLabel, y: peakUsd },
              ]}
              stroke="var(--accent-down)"
              strokeDasharray="3 3"
              strokeWidth={1.5}
              label={{
                value: `−${fmtUsdShort(currentDrawdownUsd).replace("$", "$")}`,
                position: "insideTopRight",
                fontSize: 11,
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
              fontSize: 12,
              color: "var(--text-primary)",
              padding: "10px 12px",
            }}
            labelStyle={{
              color: "var(--text-tertiary)",
              fontSize: 11,
              marginBottom: 4,
              textTransform: "uppercase",
              letterSpacing: "0.12em",
            }}
            formatter={(value, _name, item) => {
              const v = Number(value);
              const sign = v >= 0 ? "+" : "−";
              const p = item?.payload as EquityPoint | undefined;
              const dd = p?.drawdownUsd ?? 0;
              const ddPrefix = t("analytics.charts.ddPrefix" as MessageKey);
              const label = `${sign}$${Math.abs(v).toLocaleString(t.locale === "ru" ? "ru-RU" : "en-US", { maximumFractionDigits: 0 })}${
                dd < 0 ? `  ·  ${ddPrefix} ${fmtUsdShort(dd)}` : ""
              }`;
              return [label, t("analytics.charts.equity" as MessageKey)];
            }}
          />
          <Area
            type="monotone"
            dataKey="equity"
            stroke="var(--text-primary)"
            strokeWidth={1.75}
            fill="url(#equity-large-fill)"
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
