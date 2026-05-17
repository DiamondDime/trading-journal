"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

/**
 * R-multiple histogram. 1R = the average loss size (passed in by the
 * caller); a +1R win cancels out one average loss, so the y-axis count
 * of bins ≥ +1R is a quick "how many wins paid back a loser?" read.
 *
 * Bins are pre-computed server-side. Positive bins render in the neutral
 * text color, negative bins in the down accent (60% opacity for visual
 * weight balance — the page's editorial palette burns its single amber
 * moment elsewhere).
 */

export interface RBarPoint {
  /** Lower edge of the bin, e.g. -0.5 means the [-0.5R, 0R) bucket. */
  rangeLow: number;
  /** Upper edge (exclusive). */
  rangeHigh: number;
  count: number;
  /** Label like "+0.5R" used as the categorical x-tick. */
  label: string;
}

interface Props {
  bins?: RBarPoint[];
}

/**
 * Tick label format: centre of the bin in R units. Negative gets minus,
 * positive gets plus, zero gets bare "0R".
 */
function rTick(value: string): string {
  return value;
}

export function RDistributionChart({ bins = [] }: Props) {
  if (bins.length === 0) {
    return (
      <div className="flex h-[200px] w-full items-center justify-center rounded-md border border-dashed border-border bg-surface">
        <p className="font-serif text-sm italic text-text-tertiary">
          R-distribution will appear once activities are logged.
        </p>
      </div>
    );
  }

  return (
    <div className="h-[200px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={bins}
          margin={{ top: 12, right: 12, left: 12, bottom: 4 }}
          barCategoryGap={2}
        >
          <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="0" vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10, fill: "var(--text-tertiary)", fontFamily: "var(--font-jetbrains)" }}
            tickFormatter={rTick}
            interval={0}
            minTickGap={4}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10, fill: "var(--text-tertiary)", fontFamily: "var(--font-jetbrains)" }}
            allowDecimals={false}
            width={28}
          />
          {/* 0R divider — visual anchor for win/loss split. */}
          <ReferenceLine x="0R" stroke="var(--border-strong)" strokeWidth={1} ifOverflow="discard" />
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
            labelStyle={{
              color: "var(--text-tertiary)",
              fontSize: 10,
              marginBottom: 2,
              textTransform: "uppercase",
              letterSpacing: "0.12em",
            }}
            formatter={(value, _name, item) => {
              const v = Number(value);
              const p = item?.payload as RBarPoint | undefined;
              const range = p
                ? `${p.rangeLow.toFixed(1)}R → ${p.rangeHigh.toFixed(1)}R`
                : "";
              return [`${v} activities · ${range}`, "count"];
            }}
            labelFormatter={(label) => String(label)}
          />
          <Bar dataKey="count" maxBarSize={36} radius={[2, 2, 0, 0]}>
            {bins.map((b, i) => {
              // Sign-by-bin-centre: anything strictly below 0 is "down" red,
              // ≥ 0 is the neutral text color. Mixed bins (rangeLow < 0,
              // rangeHigh > 0) lean by the centre.
              const centre = (b.rangeLow + b.rangeHigh) / 2;
              const fill =
                centre < 0
                  ? "color-mix(in srgb, var(--accent-down) 60%, transparent)"
                  : "var(--text-secondary)";
              return <Cell key={i} fill={fill} />;
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
