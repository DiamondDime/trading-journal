/**
 * ExchangeBalanceRow — per-exchange card on the `/balances` page.
 *
 * Shows: exchange logo, label, total USD, wallet-type chips, link to the
 * drill-down page. Layout mirrors the existing `SpreadListCard` aesthetic
 * (rounded surface card, hairline border, hover glow) so the page feels
 * native to the journal.
 */
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { ExchangeLogo } from "@/components/settings/exchange-logo";
import type { BalanceByExchange } from "@/types/balances";

interface Props {
  entry: BalanceByExchange;
}

function fmtUsd(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function ExchangeBalanceRow({ entry }: Props) {
  return (
    <Link
      href={`/balances/${entry.exchangeCode}`}
      className="group flex items-center justify-between gap-4 rounded-md border border-border bg-surface p-4 transition-all hover:border-border-strong hover:bg-subtle"
    >
      <div className="flex items-center gap-3 min-w-0">
        <ExchangeLogo
          code={entry.exchangeCode}
          displayName={entry.exchange}
          logoUrl={`/exchanges/${entry.exchangeCode}.svg`}
          size="md"
        />
        <div className="min-w-0">
          <p className="font-serif text-[15px] font-medium text-text">
            {entry.exchange}
          </p>
          <p className="mt-0.5 truncate font-mono text-[11px] text-text-tertiary">
            {entry.label}
          </p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
            {entry.walletCount} wallet{entry.walletCount === 1 ? "" : "s"} ·{" "}
            {entry.assetCount} asset{entry.assetCount === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      <div className="flex flex-col items-end gap-1">
        <p className="font-mono text-[18px] font-medium tabular-nums text-text">
          {fmtUsd(entry.totalUsd)}
        </p>
        <ArrowUpRight className="h-3.5 w-3.5 text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
    </Link>
  );
}
