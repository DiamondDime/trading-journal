/**
 * PortfolioSidebarWidget — slim card for the sidebar.
 *
 * Renders total USD + 24h delta + last-update relative time. Owned by this
 * agent because the sidebar component itself is owned by the WD agent;
 * the WD agent will mount this widget at the right spot later.
 *
 * Design tenets:
 *   - Total in `font-mono` for tabular legibility at small sizes
 *   - Delta tone-coloured (signature on positive, down on negative)
 *   - "last updated" defaults to italic-serif "moments ago" / "5m ago"
 *
 * No external data dependency — caller fetches `/api/balances` and passes
 * the three props through. Keeps the widget portable across mount points.
 */
import Link from "next/link";
import { cn } from "@/lib/utils";

interface Props {
  /** Total portfolio USD as a string. */
  totalUsd: string;
  /** Signed 24h delta. null = no prior snapshot. */
  delta24hUsd: string | null;
  /** Pre-formatted relative time ("moments ago", "5m ago", "2h ago"). */
  updatedLabel: string;
  /** Where the chip routes to when clicked. Default: /balances. */
  href?: string;
}

function fmtUsd(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function fmtDelta(v: string | null): string {
  if (v == null) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  const abs = Math.abs(n);
  return `${sign}$${abs.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function PortfolioSidebarWidget({
  totalUsd,
  delta24hUsd,
  updatedLabel,
  href = "/balances",
}: Props) {
  const delta = delta24hUsd != null ? Number(delta24hUsd) : null;
  const deltaTone =
    delta == null
      ? "text-text-tertiary"
      : delta > 0
      ? "text-up"
      : delta < 0
      ? "text-down"
      : "text-text-tertiary";

  return (
    <Link
      href={href}
      className="block rounded-md border border-border bg-surface px-3 py-3 transition-colors hover:border-border-strong hover:bg-subtle"
    >
      <p className="font-serif text-[10px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
        Portfolio
      </p>
      <p className="mt-1 font-mono text-[18px] font-medium tabular-nums text-text">
        {fmtUsd(totalUsd)}
      </p>
      <div className="mt-1 flex items-baseline justify-between">
        <span className={cn("font-mono text-[10px] tabular-nums", deltaTone)}>
          {fmtDelta(delta24hUsd)} 24h
        </span>
        <span className="font-serif text-[10px] italic text-text-tertiary">
          {updatedLabel}
        </span>
      </div>
    </Link>
  );
}
