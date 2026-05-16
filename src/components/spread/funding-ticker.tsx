import { ArrowUp, ArrowDown, Minus } from "lucide-react";

type Trend = "up" | "down" | "flat";

const RATES: {
  asset: string;
  venue: string;
  rate: number;        // per-8h, in %
  apr: number;         // %
  trend: Trend;
  hot?: boolean;       // unusually high — highlight
}[] = [
  { asset: "SOL",  venue: "Bybit",     rate:  0.024, apr:  26.3, trend: "up",   hot: true },
  { asset: "SOL",  venue: "Binance",   rate:  0.022, apr:  24.1, trend: "up" },
  { asset: "SOL",  venue: "OKX",       rate:  0.019, apr:  20.8, trend: "flat" },
  { asset: "ETH",  venue: "Binance",   rate:  0.018, apr:  19.7, trend: "up" },
  { asset: "ETH",  venue: "Bybit",     rate:  0.016, apr:  17.5, trend: "flat" },
  { asset: "BTC",  venue: "Bybit",     rate:  0.014, apr:  15.3, trend: "up" },
  { asset: "BTC",  venue: "Binance",   rate:  0.012, apr:  13.1, trend: "up" },
  { asset: "BTC",  venue: "OKX",       rate:  0.011, apr:  12.0, trend: "flat" },
  { asset: "ARB",  venue: "Bybit",     rate:  0.008, apr:   8.8, trend: "flat" },
  { asset: "PEPE", venue: "OKX perp",  rate: -0.008, apr:  -8.8, trend: "down" },
];

function TrendIcon({ trend, hot }: { trend: Trend; hot?: boolean }) {
  if (trend === "up") {
    return (
      <ArrowUp
        className={`h-3 w-3 ${hot ? "text-signature" : "text-up"}`}
        strokeWidth={2.5}
      />
    );
  }
  if (trend === "down") {
    return <ArrowDown className="h-3 w-3 text-down" strokeWidth={2.5} />;
  }
  return <Minus className="h-3 w-3 text-text-tertiary" strokeWidth={2.5} />;
}

export function FundingTicker() {
  return (
    <div className="h-full rounded-md border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-up opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-up" />
          </span>
          <h3 className="font-serif text-[12px] font-semibold uppercase tracking-[0.16em] text-text">
            Funding rates · live
          </h3>
        </div>
        <span className="font-mono text-[10px] text-text-tertiary">
          updated 12s ago
        </span>
      </div>

      <div className="overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border-subtle text-text-tertiary">
              <th className="px-4 py-1.5 text-left font-mono text-[9px] font-medium uppercase tracking-[0.14em]">
                Asset
              </th>
              <th className="px-2 py-1.5 text-left font-mono text-[9px] font-medium uppercase tracking-[0.14em]">
                Venue
              </th>
              <th className="px-2 py-1.5 text-right font-mono text-[9px] font-medium uppercase tracking-[0.14em]">
                8h
              </th>
              <th className="px-2 py-1.5 text-right font-mono text-[9px] font-medium uppercase tracking-[0.14em]">
                APR
              </th>
              <th className="px-4 py-1.5 text-center font-mono text-[9px] font-medium uppercase tracking-[0.14em]">
                Δ
              </th>
            </tr>
          </thead>
          <tbody>
            {RATES.map((r) => (
              <tr
                key={`${r.asset}-${r.venue}`}
                className="border-b border-border-subtle last:border-b-0 hover:bg-subtle transition-colors"
              >
                <td className="px-4 py-1.5 font-mono text-[12px] text-text">
                  {r.asset}
                </td>
                <td className="px-2 py-1.5 text-[11px] text-text-secondary">
                  {r.venue}
                </td>
                <td
                  className={`px-2 py-1.5 text-right font-mono text-[11px] tabular-nums ${
                    r.rate >= 0 ? "text-text" : "text-down"
                  }`}
                >
                  {r.rate >= 0 ? "+" : "−"}
                  {Math.abs(r.rate).toFixed(3)}%
                </td>
                <td
                  className={`px-2 py-1.5 text-right font-mono text-[11px] font-medium tabular-nums ${
                    r.apr >= 0 ? (r.hot ? "text-signature" : "text-up") : "text-down"
                  }`}
                >
                  {r.apr >= 0 ? "+" : "−"}
                  {Math.abs(r.apr).toFixed(1)}%
                </td>
                <td className="px-4 py-1.5">
                  <div className="flex justify-center">
                    <TrendIcon trend={r.trend} hot={r.hot} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-t border-border px-4 py-2 font-mono text-[10px] text-text-tertiary">
        Sorted by APR · open a spread →
      </div>
    </div>
  );
}
