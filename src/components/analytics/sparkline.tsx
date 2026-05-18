/**
 * Pure-SVG sparkline. No client JS, no dependency on Recharts.
 *
 * Renders a single polyline through a series of [date, value] points. The y
 * axis is auto-scaled to the data range; the x axis is sampled uniformly
 * (timestamps are used only for ordering, not for spacing — visual cadence
 * stays consistent for tables packed with rows of varying date density).
 *
 * Server-component safe: this is a stateless function component with no
 * hooks, no event handlers, and no client-side logic. Pass it `tone` to
 * pick the design-system stroke colour.
 */
import { cn } from "@/lib/utils";

export interface SparklinePoint {
  /** ISO YYYY-MM-DD; only used for `key` ordering, not for x spacing. */
  date: string;
  value: number;
}

interface SparklineProps {
  points: SparklinePoint[];
  width?: number;
  height?: number;
  tone?: "up" | "down" | "neutral";
  /** Optional class for the wrapping <svg>. */
  className?: string;
  /** Stroke width in px. Defaults to 1.25 — readable at 80px wide. */
  strokeWidth?: number;
  /** When true, draws a faint horizontal line at y=0 to anchor signed PnL. */
  showZero?: boolean;
  /** ARIA label for screen readers (the sparkline is decorative by default). */
  ariaLabel?: string;
}

export function Sparkline({
  points,
  width = 96,
  height = 28,
  tone = "neutral",
  className,
  strokeWidth = 1.25,
  showZero = true,
  ariaLabel,
}: SparklineProps) {
  // Edge case: fewer than 2 points cannot draw a line — render a centred dot
  // so the cell isn't empty (visually distinguishes "no data" from "one
  // data point" without dominating the row).
  if (points.length === 0) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={cn("overflow-visible text-text-tertiary", className)}
        aria-hidden={!ariaLabel}
        aria-label={ariaLabel}
        role={ariaLabel ? "img" : undefined}
      >
        <line
          x1={0}
          x2={width}
          y1={height / 2}
          y2={height / 2}
          stroke="currentColor"
          strokeWidth={0.5}
          strokeDasharray="2 3"
          opacity={0.4}
        />
      </svg>
    );
  }

  // y-axis domain. We widen by 2% on each end so the line never grazes the
  // top/bottom edge of the box — keeps the eye comfortable.
  const values = points.map((p) => p.value);
  const rawMin = Math.min(...values, 0);
  const rawMax = Math.max(...values, 0);
  const pad = (rawMax - rawMin) * 0.04 || 1;
  const yMin = rawMin - pad;
  const yMax = rawMax + pad;
  const yRange = yMax - yMin || 1;

  // Tone → stroke colour. We pick text-up/text-down/text-text-tertiary so
  // the sparkline lives inside the same palette as P&L numerals in the row.
  const strokeClass =
    tone === "up"
      ? "text-up"
      : tone === "down"
      ? "text-down"
      : "text-text-tertiary";

  // x spacing — uniform per point. One-point case already handled above; with
  // two points we still get a proper line segment.
  const xStep = points.length > 1 ? width / (points.length - 1) : width;

  // Build polyline points string. y axis is inverted (SVG y grows downward).
  const polyPoints = points
    .map((p, i) => {
      const x = i * xStep;
      const y = height - ((p.value - yMin) / yRange) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  // Zero line — only render if zero is inside the y range (signed P&L sparkline
  // crosses zero; APR % sparkline rarely will).
  const showZeroLine = showZero && yMin < 0 && yMax > 0;
  const zeroY = showZeroLine ? height - ((0 - yMin) / yRange) * height : 0;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("overflow-visible", strokeClass, className)}
      aria-hidden={!ariaLabel}
      aria-label={ariaLabel}
      role={ariaLabel ? "img" : undefined}
    >
      {showZeroLine && (
        <line
          x1={0}
          x2={width}
          y1={zeroY}
          y2={zeroY}
          stroke="currentColor"
          strokeWidth={0.5}
          strokeDasharray="2 3"
          opacity={0.25}
        />
      )}
      <polyline
        points={polyPoints}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
