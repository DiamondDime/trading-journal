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

// 26 weeks of cumulative realized P&L per spread type.
// Sums roughly match the YTD net of ~$4,051.
const DATA = [
  { week: "Jan 8",  cash_carry: 0,    funding_capture: 0,   calendar: 0,   cross_exchange: 0,    dex_cex: 0   },
  { week: "Jan 15", cash_carry: 0,    funding_capture: 0,   calendar: 0,   cross_exchange: 14,   dex_cex: 0   },
  { week: "Jan 22", cash_carry: 71,   funding_capture: 0,   calendar: 0,   cross_exchange: 28,   dex_cex: 0   },
  { week: "Jan 29", cash_carry: 142,  funding_capture: 0,   calendar: 0,   cross_exchange: 41,   dex_cex: 0   },
  { week: "Feb 5",  cash_carry: 218,  funding_capture: 38,  calendar: 0,   cross_exchange: 55,   dex_cex: 0   },
  { week: "Feb 12", cash_carry: 308,  funding_capture: 82,  calendar: 41,  cross_exchange: 64,   dex_cex: 0   },
  { week: "Feb 19", cash_carry: 401,  funding_capture: 138, calendar: 112, cross_exchange: 71,   dex_cex: 0   },
  { week: "Feb 26", cash_carry: 488,  funding_capture: 181, calendar: 188, cross_exchange: 78,   dex_cex: 14  },
  { week: "Mar 5",  cash_carry: 561,  funding_capture: 181, calendar: 274, cross_exchange: 84,   dex_cex: 14  },
  { week: "Mar 12", cash_carry: 644,  funding_capture: 181, calendar: 388, cross_exchange: 91,   dex_cex: 14  },
  { week: "Mar 19", cash_carry: 738,  funding_capture: 181, calendar: 512, cross_exchange: 98,   dex_cex: 14  },
  { week: "Mar 26", cash_carry: 1314, funding_capture: 181, calendar: 1528, cross_exchange: 102, dex_cex: 14  },
  { week: "Apr 2",  cash_carry: 1314, funding_capture: 181, calendar: 1528, cross_exchange: 108, dex_cex: 14  },
  { week: "Apr 9",  cash_carry: 1314, funding_capture: 181, calendar: 1528, cross_exchange: 112, dex_cex: -36 },
  { week: "Apr 16", cash_carry: 1382, funding_capture: 181, calendar: 1528, cross_exchange: 118, dex_cex: -50 },
  { week: "Apr 23", cash_carry: 1471, funding_capture: 181, calendar: 1528, cross_exchange: 124, dex_cex: -50 },
  { week: "Apr 30", cash_carry: 1574, funding_capture: 181, calendar: 1528, cross_exchange: 128, dex_cex: -50 },
  { week: "May 7",  cash_carry: 1689, funding_capture: 211, calendar: 1528, cross_exchange: 132, dex_cex: -50 },
  { week: "May 14", cash_carry: 1842, funding_capture: 244, calendar: 1528, cross_exchange: 138, dex_cex: -50 },
  { week: "May 16", cash_carry: 1898, funding_capture: 261, calendar: 1528, cross_exchange: 142, dex_cex: -50 },
];

const SERIES = [
  { key: "cash_carry",      label: "Cash-and-carry",  color: "var(--accent-signature)" },
  { key: "calendar",        label: "Calendar",         color: "var(--accent-info)" },
  { key: "funding_capture", label: "Funding capture",  color: "var(--accent-brand)" },
  { key: "cross_exchange",  label: "Cross-exchange",   color: "var(--accent-up)" },
  { key: "dex_cex",         label: "DEX-CEX",          color: "var(--accent-warn)" },
] as const;

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
