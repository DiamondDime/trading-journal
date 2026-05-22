/**
 * PortfolioHistoryChart — server-rendered SVG line chart of total USD over
 * the selected range. Designed to match the dashboard's equity-curve
 * aesthetic but without Recharts (no client JS — keeps the page fully
 * static-renderable when the range tabs are URL-driven).
 *
 * Range tabs (`24h / 7d / 30d / 90d / all`) are rendered as plain links —
 * each one navigates to `/balances?range=X`. The page reads the query,
 * passes the range to `getSnapshotSeries`, and re-renders. No client
 * state, no hydration.
 *
 * Empty / single-point states render a dashed placeholder so the section
 * never collapses to nothing.
 */
import Link from "next/link";
import type { SnapshotPoint } from "@/types/balances";
import { getT, getLocale } from "@/lib/i18n/server";

interface Props {
  points: SnapshotPoint[];
  /** Selected range tab — drives the active style + the chart's x-axis. */
  range: "24h" | "7d" | "30d" | "90d" | "all";
  /** Optional callback URL — defaults to `/balances?range=...`. */
  baseHref?: string;
  width?: number;
  height?: number;
}

const RANGES = [
  { key: "24h", labelKey: "balances.history.ranges.h24" },
  { key: "7d",  labelKey: "balances.history.ranges.d7" },
  { key: "30d", labelKey: "balances.history.ranges.d30" },
  { key: "90d", labelKey: "balances.history.ranges.d90" },
  { key: "all", labelKey: "balances.history.ranges.all" },
] as const;

// Unsigned compact USD formatter. Portfolio value is an absolute amount, not
// a signed delta — it must NOT carry a leading "+" the way the P&L formatter
// in analytics/_format.ts does. Kept deliberately separate; do not merge.
function fmtUsdShort(v: number): string {
  const sign = v < 0 ? "−" : "";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${sign}$${(abs / 1_000).toFixed(0)}k`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

export async function PortfolioHistoryChart({
  points,
  range,
  baseHref = "/balances",
  width = 1000,
  height = 280,
}: Props) {
  const t = await getT();
  const locale = await getLocale();
  const intlLocale = locale === "ru" ? "ru-RU" : "en-US";
  const padding = { top: 16, right: 56, bottom: 22, left: 12 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  return (
    <div className="rounded-md border border-border bg-surface p-6">
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <h3 className="font-serif text-[12px] font-semibold uppercase tracking-[0.16em] text-text">
            {t("balances.history.title")}
          </h3>
          <p className="mt-1 font-serif text-[12px] italic text-text-tertiary">
            {t("balances.history.caption")}
          </p>
        </div>
        <nav className="flex items-center gap-1" aria-label={t("balances.history.rangeNavAria")}>
          {RANGES.map((r) => {
            const active = r.key === range;
            return (
              <Link
                key={r.key}
                href={`${baseHref}?range=${r.key}`}
                className={
                  "rounded-sm px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] transition-colors " +
                  (active
                    ? "bg-subtle text-text"
                    : "text-text-tertiary hover:text-text")
                }
              >
                {t(r.labelKey)}
              </Link>
            );
          })}
        </nav>
      </div>

      {points.length < 2 ? (
        <div className="flex h-[260px] w-full items-center justify-center rounded-md border border-dashed border-border">
          <p className="font-serif text-sm italic text-text-tertiary">
            {points.length === 0
              ? t("balances.history.emptyZero")
              : t("balances.history.emptyOne")}
          </p>
        </div>
      ) : (
        <ChartSvg
          points={points}
          width={width}
          height={height}
          inner={{ w: innerW, h: innerH, pad: padding }}
          fmtUsdShort={fmtUsdShort}
          intlLocale={intlLocale}
          ariaLabel={t("balances.history.svgAriaLabel")}
        />
      )}
    </div>
  );
}

function ChartSvg({
  points,
  width,
  height,
  inner,
  fmtUsdShort,
  intlLocale,
  ariaLabel,
}: {
  points: SnapshotPoint[];
  width: number;
  height: number;
  inner: {
    w: number;
    h: number;
    pad: { top: number; right: number; bottom: number; left: number };
  };
  fmtUsdShort: (v: number) => string;
  intlLocale: string;
  ariaLabel: string;
}) {
  const values = points.map((p) => Number(p.totalUsd));
  const ts = points.map((p) => new Date(p.snapshotAt).getTime());
  const min = Math.min(...values);
  const max = Math.max(...values);
  // Pad the y-range by 5% so the line never glues to the chart's top/bottom.
  const yPad = (max - min) * 0.05 || max * 0.05 || 1;
  const yLo = min - yPad;
  const yHi = max + yPad;
  const tLo = ts[0];
  const tHi = ts[ts.length - 1] || tLo + 1;

  const xPx = (t: number) =>
    inner.pad.left +
    ((t - tLo) / (tHi - tLo || 1)) * inner.w;
  const yPx = (v: number) =>
    inner.pad.top +
    inner.h -
    ((v - yLo) / (yHi - yLo || 1)) * inner.h;

  // Build the line path.
  const linePath = points
    .map((p, i) => {
      const x = xPx(ts[i]);
      const y = yPx(Number(p.totalUsd));
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  // Build the area path (line + close along the baseline).
  const baselineY = inner.pad.top + inner.h;
  const areaPath =
    linePath +
    ` L ${xPx(ts[ts.length - 1]).toFixed(2)} ${baselineY.toFixed(2)} ` +
    `L ${xPx(ts[0]).toFixed(2)} ${baselineY.toFixed(2)} Z`;

  // Y-axis ticks — 3 labels (min, mid, max).
  const yTicks = [yLo, (yLo + yHi) / 2, yHi];

  // X-axis ticks — first / middle / last point dates.
  const xTickIdxs = [
    0,
    Math.floor(points.length / 2),
    points.length - 1,
  ];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel}
    >
      <defs>
        <linearGradient id="balance-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--text-primary)" stopOpacity={0.08} />
          <stop offset="100%" stopColor="var(--text-primary)" stopOpacity={0} />
        </linearGradient>
      </defs>

      {/* Y-axis ticks + labels */}
      {yTicks.map((v, i) => (
        <g key={`y-${i}`}>
          <line
            x1={inner.pad.left}
            x2={width - inner.pad.right}
            y1={yPx(v)}
            y2={yPx(v)}
            stroke="var(--border-subtle)"
            strokeDasharray={i === 1 ? "0" : "2 4"}
          />
          <text
            x={width - inner.pad.right + 6}
            y={yPx(v) + 3}
            className="fill-text-tertiary"
            style={{
              fontFamily: "var(--font-jetbrains)",
              fontSize: 10,
            }}
          >
            {fmtUsdShort(v)}
          </text>
        </g>
      ))}

      {/* X-axis tick labels */}
      {xTickIdxs.map((i) => {
        if (!points[i]) return null;
        const x = xPx(ts[i]);
        return (
          <text
            key={`x-${i}`}
            x={x}
            y={height - 4}
            textAnchor="middle"
            className="fill-text-tertiary"
            style={{ fontFamily: "var(--font-jetbrains)", fontSize: 10 }}
          >
            {new Date(points[i].snapshotAt).toLocaleDateString(intlLocale, {
              month: "short",
              day: "numeric",
            })}
          </text>
        );
      })}

      <path d={areaPath} fill="url(#balance-area)" />
      <path
        d={linePath}
        fill="none"
        stroke="var(--text-primary)"
        strokeWidth={1.5}
      />
    </svg>
  );
}
