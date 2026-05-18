/**
 * /balances/[exchange] — per-exchange drill-down.
 *
 * Lists every connection the user has on the given exchange code, then for
 * each connection: every wallet type and every asset inside that wallet.
 * Mostly a denormalised read of `exchange_balances` joined to
 * `exchange_connections` (see `getExchangeBalanceDetail`).
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import {
  getExchangeBalanceDetail,
  type ExchangeBalanceDetail,
} from "@/lib/db/balances";
import { ExchangeLogo } from "@/components/settings/exchange-logo";
import { walletTypeLabel } from "@/types/balances";
import type { UserId } from "@/types/canonical";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ exchange: string }>;
}

function fmtUsd(value: string | null | undefined): string {
  if (value == null) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtQty(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const dp = Math.abs(n) >= 100 ? 2 : Math.abs(n) >= 1 ? 4 : 8;
  return n.toLocaleString("en-US", { maximumFractionDigits: dp });
}

export default async function ExchangeBalancePage({ params }: PageProps) {
  const { id: userId } = await requireUser();
  const { exchange } = await params;

  const details = await getExchangeBalanceDetail(
    userId as UserId,
    exchange,
  );

  if (details.length === 0) {
    notFound();
  }

  const exchangeName = details[0].exchange;
  const totalAcrossConns = details.reduce(
    (s, d) => s + Number(d.totalUsd),
    0,
  );

  return (
    <div className="w-full">
      <header className="border-b border-border px-8 py-7 lg:px-12">
        <Link
          href="/balances"
          className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary hover:text-text"
        >
          <ArrowLeft className="h-3 w-3" />
          Balances
        </Link>
        <div className="mt-3 flex items-center gap-4">
          <ExchangeLogo
            code={exchange}
            displayName={exchangeName}
            logoUrl={`/exchanges/${exchange}.svg`}
            size="md"
          />
          <div>
            <h1 className="font-serif text-[28px] font-medium leading-none text-text">
              {exchangeName}
            </h1>
            <p className="mt-1 font-mono text-[12px] tabular-nums text-text-tertiary">
              {fmtUsd(String(totalAcrossConns))} across {details.length} sub-account
              {details.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      </header>

      <div className="space-y-6 px-8 py-8 lg:px-12">
        {details.map((d) => (
          <ConnectionCard key={d.connectionId} detail={d} />
        ))}
      </div>
    </div>
  );
}

function ConnectionCard({ detail }: { detail: ExchangeBalanceDetail }) {
  return (
    <section className="overflow-hidden rounded-md border border-border bg-surface">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <p className="font-serif text-[16px] font-medium text-text">
            {detail.label}
          </p>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
            {detail.wallets.length} wallet
            {detail.wallets.length === 1 ? "" : "s"}
          </p>
        </div>
        <p className="font-mono text-[18px] font-medium tabular-nums text-text">
          {fmtUsd(detail.totalUsd)}
        </p>
      </header>

      <div className="divide-y divide-border">
        {detail.wallets.map((w) => (
          <div key={w.walletType} className="px-6 py-5">
            <div className="mb-3 flex items-baseline justify-between">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-tertiary">
                {walletTypeLabel(w.walletType)}
              </p>
              <p className="font-mono text-[13px] tabular-nums text-text-secondary">
                {fmtUsd(w.totalUsd)}
              </p>
            </div>
            <table className="w-full border-collapse">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
                  <th className="py-1 font-medium">Asset</th>
                  <th className="py-1 font-medium text-right">Total</th>
                  <th className="py-1 font-medium text-right">Available</th>
                  <th className="py-1 font-medium text-right">Locked</th>
                  <th className="py-1 font-medium text-right">USD</th>
                </tr>
              </thead>
              <tbody>
                {w.rows.map((r) => (
                  <tr key={r.asset + (r.chain ?? "")}>
                    <td className="py-1 font-serif text-[13px] font-medium text-text">
                      {r.asset}
                      {r.chain && (
                        <span className="ml-2 rounded-sm bg-subtle px-1 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-text-tertiary">
                          {r.chain}
                        </span>
                      )}
                    </td>
                    <td className="py-1 text-right font-mono text-[12px] tabular-nums text-text-secondary">
                      {fmtQty(r.total)}
                    </td>
                    <td className="py-1 text-right font-mono text-[12px] tabular-nums text-text-tertiary">
                      {fmtQty(r.available)}
                    </td>
                    <td className="py-1 text-right font-mono text-[12px] tabular-nums text-text-tertiary">
                      {fmtQty(r.locked)}
                    </td>
                    <td className="py-1 text-right font-mono text-[12px] tabular-nums text-text">
                      {fmtUsd(r.usdValue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </section>
  );
}
