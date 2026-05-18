/**
 * AllocationPie — server-rendered SVG donut showing top-N assets by USD
 * value, with the rest grouped into "Other".
 *
 * No client JS. The pie is pure math + SVG path strings rendered server-side
 * so the first paint is complete (no flash of empty chart). Each slice gets
 * a fill from a tonal-mono palette (no random color picker — the look stays
 * editorial). The user's #1 asset gets the signature amber so the eye lands
 * on the biggest holding.
 */
import type { BalanceByAsset } from "@/types/balances";

interface Props {
  assets: BalanceByAsset[];
  /** Outer diameter in px. Default 240. */
  size?: number;
  /** Top-N to render as discrete slices; remainder collapsed to "Other". */
  topN?: number;
}

// Editorial palette — five neutral grays with the signature amber leading.
// Order matters: index 0 is the biggest slice, index 4 is the smallest of
// the top-N. "Other" gets a dotted/subdued fill at the end.
const SLICE_PALETTE: string[] = [
  "var(--text-signature)",
  "var(--text-primary)",
  "var(--text-secondary)",
  "var(--text-tertiary)",
  "var(--border-strong)",
];
const OTHER_FILL = "var(--border-color)";

interface Slice {
  asset: string;
  usd: number;
  pct: number; // 0..1
  fill: string;
}

export function AllocationPie({ assets, size = 240, topN = 5 }: Props) {
  const pricedAssets = assets.filter(
    (a) => a.totalUsd != null && Number(a.totalUsd) > 0,
  );
  if (pricedAssets.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-dashed border-border bg-surface"
        style={{ width: size, height: size }}
      >
        <span className="font-serif text-xs italic text-text-tertiary">
          No allocation data
        </span>
      </div>
    );
  }

  const total = pricedAssets.reduce(
    (s, a) => s + Number(a.totalUsd ?? 0),
    0,
  );

  // Top-N + collapsed "Other"
  const top = pricedAssets.slice(0, topN);
  const rest = pricedAssets.slice(topN);
  const slices: Slice[] = top.map((a, i) => ({
    asset: a.asset,
    usd: Number(a.totalUsd ?? 0),
    pct: Number(a.totalUsd ?? 0) / total,
    fill: SLICE_PALETTE[i] ?? OTHER_FILL,
  }));
  if (rest.length > 0) {
    const restUsd = rest.reduce((s, a) => s + Number(a.totalUsd ?? 0), 0);
    slices.push({
      asset: `Other (${rest.length})`,
      usd: restUsd,
      pct: restUsd / total,
      fill: OTHER_FILL,
    });
  }

  // Donut geometry — center the SVG and pre-compute arc paths.
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size / 2 - 2;
  const innerR = size / 2 - 36; // wide rim → editorial donut, not pinwheel

  // Pre-compute cumulative end-offsets via an immutable scan — keeps the
  // React immutability linter happy without losing the donut path geometry.
  const cumulativeEnds: readonly number[] = slices.map((_, i) =>
    slices.slice(0, i + 1).reduce((sum, s) => sum + s.pct, 0),
  );
  const paths = slices.map((s, i) => {
    const start = i === 0 ? 0 : cumulativeEnds[i - 1] ?? 0;
    const end = cumulativeEnds[i] ?? start;
    return {
      asset: s.asset,
      d: ringArc(cx, cy, outerR, innerR, start, end),
      fill: s.fill,
      pct: s.pct,
    };
  });

  // Center label — biggest slice at the donut hole. Total figure goes in
  // the surrounding text on the dashboard, not here.
  const top1 = slices[0];

  return (
    <div className="flex items-center justify-center">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        role="img"
        aria-label="Portfolio allocation pie"
      >
        {paths.map((p, i) => (
          <path key={p.asset + i} d={p.d} fill={p.fill} />
        ))}
        {/* Center label */}
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-text-tertiary"
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: 11,
          }}
        >
          top holding
        </text>
        <text
          x={cx}
          y={cy + 14}
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-signature"
          style={{
            fontFamily: "var(--font-jetbrains)",
            fontSize: 18,
            fontWeight: 500,
            letterSpacing: "0.02em",
          }}
        >
          {top1.asset}
        </text>
        <text
          x={cx}
          y={cy + 34}
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-text-tertiary"
          style={{
            fontFamily: "var(--font-jetbrains)",
            fontSize: 11,
            letterSpacing: "0.04em",
          }}
        >
          {(top1.pct * 100).toFixed(1)}%
        </text>
      </svg>
    </div>
  );
}

/**
 * Build the SVG path for one donut slice. `start` and `end` are fractions
 * of the full circle (0..1). Handles the corner case where end-start is
 * very close to 1 (gives a full ring rather than glitchy near-zero gap).
 */
function ringArc(
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  start: number,
  end: number,
): string {
  // Special-case: a 100% slice would degenerate to a zero-length arc due to
  // SVG path semantics (start point == end point). Emit a full-ring path.
  if (end - start >= 0.9999) {
    return `M ${cx - outerR} ${cy} A ${outerR} ${outerR} 0 1 1 ${cx + outerR} ${cy}
            A ${outerR} ${outerR} 0 1 1 ${cx - outerR} ${cy} Z
            M ${cx - innerR} ${cy} A ${innerR} ${innerR} 0 1 0 ${cx + innerR} ${cy}
            A ${innerR} ${innerR} 0 1 0 ${cx - innerR} ${cy} Z`;
  }
  const startAngle = start * 2 * Math.PI - Math.PI / 2;
  const endAngle = end * 2 * Math.PI - Math.PI / 2;
  const outerStart = polar(cx, cy, outerR, startAngle);
  const outerEnd = polar(cx, cy, outerR, endAngle);
  const innerStart = polar(cx, cy, innerR, startAngle);
  const innerEnd = polar(cx, cy, innerR, endAngle);
  const largeArc = end - start > 0.5 ? 1 : 0;
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    "Z",
  ].join(" ");
}

function polar(
  cx: number,
  cy: number,
  r: number,
  angle: number,
): { x: number; y: number } {
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}
