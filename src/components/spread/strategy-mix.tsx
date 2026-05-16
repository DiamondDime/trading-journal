import { TrendingUp, TrendingDown } from "lucide-react";

const STRATEGIES: {
  name: string;
  short: string;
  count: number;
  active: number;
  net: number;
  metricLabel: string;
  metricValue: string;
  tone: "up" | "down";
  width: number; // weight bar % 0-100
}[] = [
  {
    name: "Cash-and-carry",
    short: "cash",
    count: 8,
    active: 2,
    net: 3212,
    metricLabel: "avg APR",
    metricValue: "11.2%",
    tone: "up",
    width: 92,
  },
  {
    name: "Calendar",
    short: "cal",
    count: 3,
    active: 0,
    net: 1528,
    metricLabel: "avg bps/d",
    metricValue: "+5.0",
    tone: "up",
    width: 44,
  },
  {
    name: "Funding capture",
    short: "fund",
    count: 7,
    active: 1,
    net: 396,
    metricLabel: "avg APR",
    metricValue: "11.5%",
    tone: "up",
    width: 12,
  },
  {
    name: "Cross-exchange",
    short: "cross",
    count: 5,
    active: 1,
    net: 84,
    metricLabel: "avg captured",
    metricValue: "+5.2 bps",
    tone: "up",
    width: 3,
  },
  {
    name: "DEX-CEX",
    short: "dex",
    count: 1,
    active: 0,
    net: -50,
    metricLabel: "avg captured",
    metricValue: "−59 bps",
    tone: "down",
    width: 2,
  },
];

export function StrategyMix() {
  return (
    <div className="rounded-md border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <h3 className="font-serif text-[12px] font-semibold uppercase tracking-[0.16em] text-text">
          Strategy mix · YTD
        </h3>
        <span className="font-mono text-[10px] text-text-tertiary">
          24 spreads · 4 active · 16 archived
        </span>
      </div>

      <div className="grid grid-cols-2 divide-x divide-border-subtle md:grid-cols-5">
        {STRATEGIES.map((s) => (
          <div
            key={s.short}
            className="flex flex-col gap-2 px-5 py-4 transition-colors hover:bg-subtle border-b md:border-b-0 border-border-subtle"
          >
            <div className="flex items-baseline justify-between">
              <p className="font-serif text-[12px] font-medium text-text">
                {s.name}
              </p>
              <span className="font-mono text-[10px] text-text-tertiary">
                {s.count}
              </span>
            </div>

            <div className="flex items-baseline gap-2">
              <span
                className={`font-mono text-[20px] font-medium tabular-nums leading-none ${
                  s.tone === "up" ? "text-up" : "text-down"
                }`}
              >
                {s.net >= 0 ? "+" : "−"}${Math.abs(s.net).toLocaleString()}
              </span>
              {s.tone === "up" ? (
                <TrendingUp className="h-3 w-3 text-up" strokeWidth={2.5} />
              ) : (
                <TrendingDown className="h-3 w-3 text-down" strokeWidth={2.5} />
              )}
            </div>

            {/* contribution bar */}
            <div className="h-1 w-full rounded-sm bg-subtle">
              <div
                className={`h-full rounded-sm ${
                  s.tone === "up" ? "bg-up" : "bg-down"
                }`}
                style={{ width: `${s.width}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-[10px]">
              <span className="font-mono uppercase tracking-[0.14em] text-text-tertiary">
                {s.metricLabel}
              </span>
              <span className="font-mono tabular-nums text-text-secondary">
                {s.metricValue}
              </span>
            </div>
            <div className="font-mono text-[10px] text-text-tertiary">
              {s.active} active · {s.count - s.active} archived
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
