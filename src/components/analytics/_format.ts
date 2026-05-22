/**
 * Shared formatting utilities for analytics chart components.
 * Keep this file free of React imports — it is imported by both client and
 * server components.
 */

/**
 * Compact signed USD formatter for chart axis ticks and tooltips.
 * Returns "—" for non-finite input. Uses Unicode minus (−) for negative sign.
 *
 * Sign conventions:
 *   positive →  "+$12.3k"
 *   negative →  "−$12.3k"
 *   zero     →  "$0"
 */
export function fmtUsdShort(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const sign = v < 0 ? "−" : v > 0 ? "+" : "";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${sign}$${(abs / 1000).toFixed(0)}k`;
  if (abs >= 1_000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}
