import { ArrowUp, ArrowDown, Minus } from "lucide-react";
import { unstable_cache } from "next/cache";
import { ExchangeChip } from "@/components/settings/exchange-logo";

/**
 * Funding rates ticker — real data from Binance USD-M perp futures.
 *
 * Public endpoint `GET /fapi/v1/premiumIndex` returns the current premium index
 * for every perp Binance lists, including `lastFundingRate` (per-funding-period,
 * usually 8h) and `nextFundingTime` (ms-since-epoch). Funding pays 3x daily so
 * the annualised APR is `lastFundingRate * 3 * 365 * 100`.
 *
 * Public, no auth. Rate-limited but trivially within budget at one call per
 * 5 minutes via `unstable_cache`. On failure (network, rate-limit, schema
 * surprise) the section renders a graceful unavailability state — the rest
 * of the dashboard keeps working.
 *
 * Top-10 selection: sort by `|fundingRate|` so the ticker shows the most
 * actionable extremes (both deeply positive and deeply negative). A user
 * scanning for a funding-capture or basis trade wants the tails, not BTC's
 * ho-hum mid-band rate.
 */

const BINANCE_PREMIUM_INDEX = "https://fapi.binance.com/fapi/v1/premiumIndex";
const FUNDING_PERIODS_PER_YEAR = 3 * 365; // 8h cadence
const TOP_N = 10;
const CACHE_TTL_SECONDS = 5 * 60; // 5 min

interface BinancePremiumIndex {
  symbol: string;
  markPrice: string;
  indexPrice: string;
  estimatedSettlePrice: string;
  lastFundingRate: string;
  interestRate: string;
  nextFundingTime: number;
  time: number;
}

export interface FundingRow {
  symbol: string;
  /** Decimal funding rate per period (e.g. 0.0001 for 0.01%). */
  rate: number;
  /** Annualised, in % (e.g. 10.95 means 10.95% APR). */
  apr: number;
  nextFundingTime: number;
  fetchedAt: number;
}

/**
 * Fetch + transform once per CACHE_TTL_SECONDS. unstable_cache memoises the
 * promise across requests — every render inside the TTL gets the same array
 * without re-hitting Binance.
 */
const getFundingRates = unstable_cache(
  async (): Promise<{ rows: FundingRow[]; fetchedAt: number } | null> => {
    try {
      const res = await fetch(BINANCE_PREMIUM_INDEX, {
        // Cache-busting headers are unnecessary — unstable_cache owns the TTL.
        // AbortSignal.timeout guards against an upstream stall taking down our
        // render: 4s is comfortably above Binance's normal p99 (~200ms) but
        // short enough that a degraded API doesn't tank the dashboard.
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as BinancePremiumIndex[];
      if (!Array.isArray(data)) return null;

      const fetchedAt = Date.now();
      const usdtPerps = data.filter(
        (r) =>
          typeof r.symbol === "string" &&
          r.symbol.endsWith("USDT") &&
          // Filter out any zero/sentinel rates that occasionally show up for
          // newly-listed or paused contracts — they'd dominate the top-10.
          r.lastFundingRate &&
          Number.isFinite(Number(r.lastFundingRate)),
      );

      const rows: FundingRow[] = usdtPerps.map((r) => {
        const rate = Number(r.lastFundingRate);
        return {
          symbol: r.symbol,
          rate,
          apr: rate * FUNDING_PERIODS_PER_YEAR * 100,
          nextFundingTime: r.nextFundingTime,
          fetchedAt,
        };
      });

      rows.sort((a, b) => Math.abs(b.rate) - Math.abs(a.rate));
      return { rows: rows.slice(0, TOP_N), fetchedAt };
    } catch {
      // Network / abort / JSON parse — any failure falls through to the
      // graceful degradation render path. Don't log: this runs every render
      // and a sustained outage would flood server logs.
      return null;
    }
  },
  ["funding-rates-binance-usdm-top10"],
  { revalidate: CACHE_TTL_SECONDS, tags: ["funding-rates"] },
);

function TrendIcon({ rate }: { rate: number }) {
  // Hot threshold: >0.05% per 8h ≈ 55% APR. Anything above that earns the
  // signature amber to draw the eye — those are the rates worth a trade.
  const hot = Math.abs(rate) > 0.0005;
  if (rate > 0) {
    return (
      <ArrowUp
        className={`h-3 w-3 ${hot ? "text-signature" : "text-up"}`}
        strokeWidth={2.5}
      />
    );
  }
  if (rate < 0) {
    return <ArrowDown className="h-3 w-3 text-down" strokeWidth={2.5} />;
  }
  return <Minus className="h-3 w-3 text-text-tertiary" strokeWidth={2.5} />;
}

/**
 * Format the countdown to next funding. Binance pays at fixed 00/08/16 UTC
 * so the window is always under 8h. Render as "in 2h 34m" / "in 4m" / "now"
 * — terse, mono-friendly, no seconds noise.
 */
function fmtCountdown(nextFundingTime: number, now: number): string {
  const deltaMs = nextFundingTime - now;
  if (deltaMs <= 0) return "now";
  const totalMinutes = Math.floor(deltaMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `in ${minutes}m`;
  return `in ${hours}h ${minutes}m`;
}

function fmtFetchedAgo(fetchedAt: number, now: number): string {
  const ageSec = Math.max(0, Math.floor((now - fetchedAt) / 1000));
  if (ageSec < 60) return `${ageSec}s ago`;
  const min = Math.floor(ageSec / 60);
  return `${min}m ago`;
}

export async function FundingTicker() {
  const data = await getFundingRates();
  const now = Date.now();

  if (!data) {
    // Graceful degradation — the rest of the dashboard renders fine.
    return (
      <div className="h-full rounded-md border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <ExchangeChip venue="Binance" size="sm" />
            <span className="relative flex h-2 w-2">
              <span className="relative inline-flex h-2 w-2 rounded-full bg-text-tertiary" />
            </span>
            <h3 className="font-serif text-[12px] font-semibold uppercase tracking-[0.16em] text-text">
              Funding rates · live
            </h3>
          </div>
        </div>
        <div className="flex h-[260px] items-center justify-center px-6">
          <p className="font-serif text-sm italic text-text-tertiary">
            Funding rates unavailable. Retrying in 5 minutes.
          </p>
        </div>
      </div>
    );
  }

  const { rows, fetchedAt } = data;

  return (
    <div className="h-full rounded-md border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <ExchangeChip venue="Binance" size="sm" />
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-up opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-up" />
          </span>
          <h3 className="font-serif text-[12px] font-semibold uppercase tracking-[0.16em] text-text">
            Funding rates · live
          </h3>
        </div>
        <span className="font-mono text-[10px] text-text-tertiary">
          updated {fmtFetchedAgo(fetchedAt, now)}
        </span>
      </div>

      <div className="overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border-subtle text-text-tertiary">
              <th className="px-4 py-1.5 text-left font-mono text-[9px] font-medium uppercase tracking-[0.14em]">
                Symbol
              </th>
              <th className="px-2 py-1.5 text-right font-mono text-[9px] font-medium uppercase tracking-[0.14em]">
                8h
              </th>
              <th className="px-2 py-1.5 text-right font-mono text-[9px] font-medium uppercase tracking-[0.14em]">
                APR
              </th>
              <th className="px-2 py-1.5 text-right font-mono text-[9px] font-medium uppercase tracking-[0.14em]">
                Next
              </th>
              <th className="px-3 py-1.5 text-center font-mono text-[9px] font-medium uppercase tracking-[0.14em]">
                Δ
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const ratePct = r.rate * 100; // express as % per 8h
              // Hot = absolute APR > ~55%, i.e. funding > 5bps / 8h. Surfaces
              // amber on the column the trader is actually scanning.
              const hot = Math.abs(r.apr) > 55;
              return (
                <tr
                  key={r.symbol}
                  className="border-b border-border-subtle last:border-b-0 hover:bg-subtle transition-colors"
                >
                  <td className="px-4 py-1.5 font-mono text-[12px] text-text">
                    {r.symbol.replace(/USDT$/, "")}
                    <span className="text-text-tertiary">·USDT</span>
                  </td>
                  <td
                    className={`px-2 py-1.5 text-right font-mono text-[11px] tabular-nums ${
                      ratePct >= 0 ? "text-text" : "text-down"
                    }`}
                  >
                    {ratePct >= 0 ? "+" : "−"}
                    {Math.abs(ratePct).toFixed(4)}%
                  </td>
                  <td
                    className={`px-2 py-1.5 text-right font-mono text-[11px] font-medium tabular-nums ${
                      r.apr >= 0
                        ? hot
                          ? "text-signature"
                          : "text-up"
                        : "text-down"
                    }`}
                  >
                    {r.apr >= 0 ? "+" : "−"}
                    {Math.abs(r.apr).toFixed(1)}%
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-[10px] tabular-nums text-text-tertiary">
                    {fmtCountdown(r.nextFundingTime, now)}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex justify-center">
                      <TrendIcon rate={r.rate} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="border-t border-border px-4 py-2 font-serif text-[10px] italic text-text-tertiary">
        Source: Binance USD-M perps · refreshed every 5 min
      </div>
    </div>
  );
}
