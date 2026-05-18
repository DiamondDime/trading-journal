/**
 * PortfolioHero — top of the `/balances` page.
 *
 * Mirrors the dashboard's "hero KPI" treatment: serif/mono blend, signature
 * amber on positive 24h delta, neutral when flat, down-tone red when
 * negative. The three smaller numbers underneath (stable / volatile /
 * 24h Δ) sit on a single line in `font-mono tabular-nums` so they read
 * as data.
 *
 * Server-only component (no `"use client"`). All math + formatting comes
 * from the page that mounts it — this is just the typography surface.
 */
import { cn } from "@/lib/utils";
import { heroFontSize } from "@/components/spread/kpi-card";

interface Props {
  totalUsd: string;
  stableUsd: string;
  volatileUsd: string;
  delta24hUsd: string | null;
  /** Either an ISO string or a pre-formatted "5 minutes ago" label. */
  snapshotLabel?: string;
}

function fmtUsd(value: string, signed = false): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const sign = signed && n > 0 ? "+" : n < 0 ? "−" : "";
  const abs = Math.abs(n);
  return `${sign}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function PortfolioHero({
  totalUsd,
  stableUsd,
  volatileUsd,
  delta24hUsd,
  snapshotLabel,
}: Props) {
  const total = Number(totalUsd);
  const delta = delta24hUsd != null ? Number(delta24hUsd) : null;

  const valueStr = fmtUsd(totalUsd);
  // Tone the hero only when the delta is meaningful. Zero balance gets
  // the neutral "—" treatment — no false signal.
  const heroTone =
    total <= 0 || delta == null
      ? "text-text"
      : delta > 0
      ? "text-signature"
      : delta < 0
      ? "text-down"
      : "text-text";

  const deltaTone =
    delta == null
      ? "text-text-tertiary"
      : delta > 0
      ? "text-up"
      : delta < 0
      ? "text-down"
      : "text-text-tertiary";

  return (
    <section className="rounded-md border border-border bg-surface px-6 py-6 lg:px-8 lg:py-7">
      <div className="flex flex-col gap-1">
        <p className="font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          Total portfolio
        </p>
        <p
          className={cn(
            "mt-2 font-mono font-medium tabular-nums leading-none tracking-tight",
            heroTone,
          )}
          style={{ fontSize: heroFontSize(valueStr) }}
        >
          {valueStr}
        </p>

        <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <span className="font-mono text-[11px] text-text-tertiary">
            <span className="uppercase tracking-[0.16em]">Stable</span>{" "}
            <span className="text-text-secondary">{fmtUsd(stableUsd)}</span>
          </span>
          <span className="font-mono text-[11px] text-text-tertiary">
            <span className="uppercase tracking-[0.16em]">Volatile</span>{" "}
            <span className="text-text-secondary">{fmtUsd(volatileUsd)}</span>
          </span>
          <span className={cn("font-mono text-[11px]", deltaTone)}>
            <span className="uppercase tracking-[0.16em] text-text-tertiary">
              24h
            </span>{" "}
            <span className="tabular-nums">
              {delta != null ? fmtUsd(delta24hUsd as string, true) : "—"}
            </span>
          </span>
          {snapshotLabel && (
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
              · {snapshotLabel}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
