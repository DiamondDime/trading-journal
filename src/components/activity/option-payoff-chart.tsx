import { cn } from "@/lib/utils";

export interface PayoffChartLegInput {
  /** call / put. */
  optionKind: "call" | "put";
  /** long / short. */
  side: "long" | "short";
  /** Strike price (USD per underlying unit). */
  strike: number;
  /** Number of contracts. */
  contracts: number;
  /** Premium per contract (USD). Positive value; the side enum carries sign. */
  premiumPerContract: number;
  /** Standard CEX options are usually 1 underlying per contract (Deribit BTC
   *  options are 1 BTC; Binance ETH options are 1 ETH). The chart caller may
   *  override per leg if needed. */
  contractSize?: number;
}

export interface OptionPayoffChartProps {
  /** Legs to compose into a payoff curve. Order doesn't matter — the chart
   *  superposes each leg's payoff at every sampled underlying price. */
  legs: PayoffChartLegInput[];
  /** Optional explicit X range. When omitted, the chart picks ±35% around the
   *  median strike. */
  underlyingRange?: { min: number; max: number };
  /** Width / height in CSS pixels (the SVG uses viewBox so it scales). */
  width?: number;
  height?: number;
  /** Number of samples across the X range. 81 = 1% steps when range is ±40%
   *  of the median strike. */
  samples?: number;
  /** Style hint for the renderer. "compact" trims padding & label sizes for
   *  the /review hero panel; "full" is the bigger version for /options/[id]. */
  variant?: "compact" | "full";
  className?: string;
}

interface PayoffSample {
  /** Underlying price. */
  x: number;
  /** Net payoff at that price. Negative = loss to trader. */
  y: number;
}

/**
 * Compute the payoff at one underlying price across every leg.
 *
 * For a CALL: intrinsic = max(0, S - K) * contracts * size; long pays
 * premium so payoff = intrinsic - premium; short collects premium so
 * payoff = premium - intrinsic.
 * For a PUT: intrinsic = max(0, K - S) * contracts * size; same sign logic.
 */
function payoffAtPrice(legs: PayoffChartLegInput[], price: number): number {
  let total = 0;
  for (const leg of legs) {
    const size = leg.contractSize ?? 1;
    const intrinsic =
      leg.optionKind === "call"
        ? Math.max(0, price - leg.strike)
        : Math.max(0, leg.strike - price);
    const intrinsicTotal = intrinsic * leg.contracts * size;
    const premiumTotal = leg.premiumPerContract * leg.contracts * size;
    const legPayoff =
      leg.side === "long" ? intrinsicTotal - premiumTotal : premiumTotal - intrinsicTotal;
    total += legPayoff;
  }
  return total;
}

/**
 * Pure server-rendered SVG payoff diagram. No client JS. Inputs are the
 * leg array; we compute payoff at each price sample and stroke a single
 * polyline. Vertical guides at every strike, a horizontal axis at zero,
 * and a shaded fill for the gain/loss zones.
 *
 * The chart trusts upstream Zod validation — every numeric here is a
 * finite number; the caller must coerce decimal strings before passing in.
 */
export function OptionPayoffChart({
  legs,
  underlyingRange,
  width = 540,
  height = 220,
  samples = 81,
  variant = "compact",
  className,
  ariaLabel,
}: OptionPayoffChartProps & { ariaLabel?: string }) {
  // Empty / invalid input: render a stable placeholder so the layout doesn't
  // jump while the user fills out the wizard.
  if (legs.length === 0 || legs.some((l) => !Number.isFinite(l.strike))) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-md border border-border bg-surface text-text-tertiary",
          variant === "compact" ? "h-[160px]" : "h-[240px]",
          className,
        )}
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.16em]">
          Add legs to see payoff
        </span>
      </div>
    );
  }

  // Pick a sensible range when the caller doesn't supply one. Median strike
  // ± 35% covers most defined-risk structures comfortably; iron condors with
  // wider wings clamp at the wing strikes anyway.
  const sortedStrikes = [...legs.map((l) => l.strike)].sort((a, b) => a - b);
  const medianStrike =
    sortedStrikes[Math.floor(sortedStrikes.length / 2)] ?? 1;
  const minStrike = sortedStrikes[0]!;
  const maxStrike = sortedStrikes[sortedStrikes.length - 1]!;
  const baseMin =
    underlyingRange?.min ??
    Math.min(minStrike * 0.65, medianStrike * 0.65);
  const baseMax =
    underlyingRange?.max ??
    Math.max(maxStrike * 1.35, medianStrike * 1.35);

  // Sample payoff across the range.
  const series: PayoffSample[] = [];
  const step = (baseMax - baseMin) / Math.max(1, samples - 1);
  for (let i = 0; i < samples; i++) {
    const x = baseMin + i * step;
    series.push({ x, y: payoffAtPrice(legs, x) });
  }

  const yValues = series.map((s) => s.y);
  const yMaxRaw = Math.max(...yValues);
  const yMinRaw = Math.min(...yValues);
  // Pad the y axis a little so the curve doesn't kiss the edges.
  const yAbs = Math.max(Math.abs(yMaxRaw), Math.abs(yMinRaw), 1);
  const yMax = yAbs * 1.15;
  const yMin = -yAbs * 1.15;

  // SVG coordinates. We use 0..width for X, 0..height for Y (SVG flips Y).
  const pad = variant === "compact" ? 16 : 24;
  const xScale = (px: number) =>
    pad + ((px - baseMin) / (baseMax - baseMin)) * (width - 2 * pad);
  const yScale = (py: number) =>
    height - pad - ((py - yMin) / (yMax - yMin)) * (height - 2 * pad);

  const zeroY = yScale(0);
  const polyline = series
    .map((s) => `${xScale(s.x).toFixed(2)},${yScale(s.y).toFixed(2)}`)
    .join(" ");

  // Shaded fills: split the polyline into gain (≥ 0) and loss (< 0) sub-paths
  // that close back to the zero line.
  const gainPath: string[] = [];
  const lossPath: string[] = [];
  let lastSign: "gain" | "loss" | null = null;
  let openX: number | null = null;
  for (let i = 0; i < series.length; i++) {
    const s = series[i];
    const sign: "gain" | "loss" = s.y >= 0 ? "gain" : "loss";
    if (sign !== lastSign) {
      if (lastSign !== null && openX !== null) {
        // Close the previous polygon.
        const targetX =
          // interpolate the zero crossing between previous and current
          series[i - 1].y === series[i].y
            ? xScale(s.x)
            : xScale(
                series[i - 1].x +
                  ((0 - series[i - 1].y) / (series[i].y - series[i - 1].y)) *
                    (series[i].x - series[i - 1].x),
              );
        const path = lastSign === "gain" ? gainPath : lossPath;
        path.push(`${targetX.toFixed(2)},${zeroY.toFixed(2)} ${openX.toFixed(2)},${zeroY.toFixed(2)} Z`);
      }
      openX = xScale(s.x);
      const path = sign === "gain" ? gainPath : lossPath;
      path.push(`M ${openX.toFixed(2)},${zeroY.toFixed(2)} L ${xScale(s.x).toFixed(2)},${yScale(s.y).toFixed(2)}`);
      lastSign = sign;
    } else {
      const path = sign === "gain" ? gainPath : lossPath;
      path.push(`L ${xScale(s.x).toFixed(2)},${yScale(s.y).toFixed(2)}`);
    }
  }
  // Close final polygon.
  if (lastSign !== null && openX !== null) {
    const path = lastSign === "gain" ? gainPath : lossPath;
    path.push(
      `L ${xScale(series[series.length - 1].x).toFixed(2)},${zeroY.toFixed(2)} Z`,
    );
  }

  // Strike guides — vertical dashed lines, one per unique strike.
  const uniqueStrikes = Array.from(new Set(legs.map((l) => l.strike))).sort(
    (a, b) => a - b,
  );

  const fmtY = (y: number) => {
    const abs = Math.abs(y);
    if (abs >= 1000) return `${y < 0 ? "−" : ""}$${Math.round(abs / 1000)}k`;
    return `${y < 0 ? "−" : ""}$${Math.round(abs)}`;
  };
  const fmtX = (x: number) => {
    if (x >= 1000) return `${Math.round(x / 1000)}k`;
    return String(Math.round(x));
  };

  // The polyline tone is set by whichever zone has more area — visually
  // simpler than coloring the line by sign, and matches the up/down palette.
  const gainArea = series
    .filter((s) => s.y > 0)
    .reduce((acc, s) => acc + s.y, 0);
  const lossArea = series
    .filter((s) => s.y < 0)
    .reduce((acc, s) => acc + Math.abs(s.y), 0);
  const lineToneClass = gainArea >= lossArea ? "stroke-up" : "stroke-down";

  return (
    <div className={cn("relative w-full", className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="block h-full w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={ariaLabel ?? "Option payoff at expiration"}
      >
        {/* Loss zone fill. */}
        <path
          d={lossPath.join(" ")}
          className="fill-down/15 stroke-none"
        />
        {/* Gain zone fill. */}
        <path
          d={gainPath.join(" ")}
          className="fill-up/15 stroke-none"
        />
        {/* Strike guides. */}
        {uniqueStrikes.map((k) => {
          const x = xScale(k);
          return (
            <line
              key={`strike-${k}`}
              x1={x}
              x2={x}
              y1={pad}
              y2={height - pad}
              className="stroke-border-strong"
              strokeWidth={1}
              strokeDasharray="2 3"
              opacity={0.6}
            />
          );
        })}
        {/* Zero axis. */}
        <line
          x1={pad}
          x2={width - pad}
          y1={zeroY}
          y2={zeroY}
          className="stroke-border-strong"
          strokeWidth={1}
        />
        {/* Payoff line. */}
        <polyline
          points={polyline}
          fill="none"
          strokeWidth={1.75}
          strokeLinejoin="round"
          strokeLinecap="round"
          className={lineToneClass}
        />
        {/* Strike labels above the chart. */}
        {variant === "full" &&
          uniqueStrikes.map((k) => {
            const x = xScale(k);
            return (
              <text
                key={`strike-label-${k}`}
                x={x}
                y={pad - 4}
                textAnchor="middle"
                className="fill-text-tertiary font-mono"
                fontSize={9}
              >
                {fmtX(k)}
              </text>
            );
          })}
        {/* Y-axis bounds (only on full variant). */}
        {variant === "full" && (
          <>
            <text
              x={pad + 4}
              y={yScale(yMax) + 10}
              className="fill-text-tertiary font-mono"
              fontSize={9}
            >
              {fmtY(yMax)}
            </text>
            <text
              x={pad + 4}
              y={yScale(yMin) - 4}
              className="fill-text-tertiary font-mono"
              fontSize={9}
            >
              {fmtY(yMin)}
            </text>
          </>
        )}
      </svg>
    </div>
  );
}

/**
 * Pure utility: compute analytic header metrics from a leg array. Used by
 * the wizard /review step + the option detail page to derive max profit /
 * max loss / breakevens when the trader didn't type them in.
 *
 * Returns null on each field when the calculation is indeterminate (e.g.
 * naked short call has unbounded loss → maxLoss = null).
 */
export function deriveOptionMetrics(legs: PayoffChartLegInput[]): {
  netPremiumUsd: number;
  maxProfitUsd: number | null;
  maxLossUsd: number | null;
  breakevens: number[];
} {
  if (legs.length === 0) {
    return {
      netPremiumUsd: 0,
      maxProfitUsd: null,
      maxLossUsd: null,
      breakevens: [],
    };
  }

  // Net premium: long pays, short collects.
  let netPremium = 0;
  for (const leg of legs) {
    const size = leg.contractSize ?? 1;
    const total = leg.premiumPerContract * leg.contracts * size;
    netPremium += leg.side === "long" ? total : -total;
  }

  // Sample a wider range to detect open-ended payoff (naked shorts).
  const strikes = legs.map((l) => l.strike);
  const minK = Math.min(...strikes);
  const maxK = Math.max(...strikes);
  const span = Math.max(maxK - minK, maxK);

  // Slopes at the extremes — if non-zero, the payoff is unbounded in that
  // direction → that side's max is null.
  const farLeft = -span * 10;
  const farRight = maxK + span * 10;
  const leftSlope =
    payoffAtPrice(legs, farLeft + 1) - payoffAtPrice(legs, farLeft);
  const rightSlope =
    payoffAtPrice(legs, farRight + 1) - payoffAtPrice(legs, farRight);

  // Sample finely between the strikes (and ±50% beyond) to find extrema.
  const sampleMin = Math.max(0, minK - span * 0.5);
  const sampleMax = maxK + span * 0.5;
  const N = 401;
  let maxY = -Infinity;
  let minY = Infinity;
  const samples: PayoffSample[] = [];
  for (let i = 0; i < N; i++) {
    const x = sampleMin + ((sampleMax - sampleMin) * i) / (N - 1);
    const y = payoffAtPrice(legs, x);
    samples.push({ x, y });
    if (y > maxY) maxY = y;
    if (y < minY) minY = y;
  }

  // Find zero crossings → breakevens.
  const breakevens: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (
      (a.y >= 0 && b.y < 0) ||
      (a.y <= 0 && b.y > 0) ||
      (a.y < 0 && b.y >= 0)
    ) {
      // Linear interpolate the crossing.
      const t = a.y === b.y ? 0 : (0 - a.y) / (b.y - a.y);
      breakevens.push(a.x + t * (b.x - a.x));
    }
  }

  // Open-ended on either side → null for that bound.
  const maxProfitUsd =
    leftSlope < -0.01 || rightSlope > 0.01 ? null : maxY;
  const maxLossUsd =
    leftSlope > 0.01 || rightSlope < -0.01 ? null : minY;

  return {
    netPremiumUsd: netPremium,
    maxProfitUsd,
    // Storage is signed; the schema uses signed decimals. Return absolute
    // for max loss so the headline reads as a positive "max loss" figure.
    maxLossUsd: maxLossUsd === null ? null : maxLossUsd,
    breakevens,
  };
}
