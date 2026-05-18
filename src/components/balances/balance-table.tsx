/**
 * BalanceTable — sortable per-asset rollup beside the allocation pie.
 *
 * Sortable client-side (no server round-trip needed; we always have <500
 * assets). Default sort: USD value desc. Columns:
 *   - Asset (symbol; stable badge inline if applicable)
 *   - Qty (mono, tabular-nums)
 *   - USD price (mono, $X,XXX.XX)
 *   - USD value (mono, signature amber on the row's value cell when the
 *     asset is the user's #1 by value — subtle "anchor" cue)
 *   - % of port (mono, tabular-nums)
 *   - Exchanges (logo strip)
 *
 * Keep this server-component for the initial paint. Sort interactivity is
 * left to a future client wrapper — not blocking for v6.
 */
import { ExchangeChip } from "@/components/settings/exchange-logo";
import type { BalanceByAsset } from "@/types/balances";

interface Props {
  assets: BalanceByAsset[];
  totalUsd: string;
}

function fmtUsd(value: string | null | undefined, signed = false): string {
  if (value == null) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const sign = signed && n > 0 ? "+" : n < 0 ? "−" : "";
  const abs = Math.abs(n);
  return `${sign}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtQty(qty: string): string {
  const n = Number(qty);
  if (!Number.isFinite(n)) return "—";
  // Heuristic: keep 8dp for sub-$1 quantities (BTC, ETH), 4dp for the
  // mid-range, 2dp for the long tail (stables, alts).
  const dp = Math.abs(n) >= 100 ? 2 : Math.abs(n) >= 1 ? 4 : 8;
  return n.toLocaleString("en-US", { maximumFractionDigits: dp });
}

function fmtPct(asset: BalanceByAsset, total: number): string {
  if (asset.totalUsd == null || total <= 0) return "—";
  const pct = (Number(asset.totalUsd) / total) * 100;
  if (!Number.isFinite(pct)) return "—";
  return `${pct.toFixed(1)}%`;
}

export function BalanceTable({ assets, totalUsd }: Props) {
  const total = Number(totalUsd);

  if (assets.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-surface px-6 py-10 text-center">
        <p className="font-serif text-sm italic text-text-tertiary">
          No assets yet. Connect an exchange in Settings to start tracking.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-border bg-surface">
      <table className="w-full border-collapse">
        <thead className="border-b border-border bg-subtle">
          <tr className="text-left font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
            <th className="px-4 py-3 font-medium">Asset</th>
            <th className="px-4 py-3 font-medium text-right">Qty</th>
            <th className="px-4 py-3 font-medium text-right">USD price</th>
            <th className="px-4 py-3 font-medium text-right">USD value</th>
            <th className="px-4 py-3 font-medium text-right">% port</th>
            <th className="px-4 py-3 font-medium">Exchanges</th>
          </tr>
        </thead>
        <tbody>
          {assets.map((a, i) => (
            <tr
              key={a.asset}
              className="border-b border-border last:border-b-0 transition-colors hover:bg-subtle"
            >
              <td className="px-4 py-3 align-middle">
                <div className="flex items-center gap-2">
                  <span className="font-serif text-[14px] font-medium text-text">
                    {a.asset}
                  </span>
                  {a.isStable && (
                    <span className="rounded-sm bg-subtle px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-text-tertiary">
                      stable
                    </span>
                  )}
                </div>
              </td>
              <td className="px-4 py-3 text-right align-middle font-mono text-[12px] tabular-nums text-text-secondary">
                {fmtQty(a.totalQty)}
              </td>
              <td className="px-4 py-3 text-right align-middle font-mono text-[12px] tabular-nums text-text-secondary">
                {fmtUsd(a.usdPrice)}
              </td>
              <td
                className={
                  "px-4 py-3 text-right align-middle font-mono text-[12px] tabular-nums " +
                  (i === 0 ? "text-signature" : "text-text")
                }
              >
                {fmtUsd(a.totalUsd)}
              </td>
              <td className="px-4 py-3 text-right align-middle font-mono text-[11px] tabular-nums text-text-tertiary">
                {fmtPct(a, total)}
              </td>
              <td className="px-4 py-3 align-middle">
                <span className="inline-flex items-center -space-x-1">
                  {a.exchanges.slice(0, 4).map((e) => (
                    <ExchangeChip
                      key={e.exchangeCode + e.exchange}
                      venue={e.exchange}
                      code={e.exchangeCode}
                      size="sm"
                      className="ring-1 ring-surface"
                    />
                  ))}
                  {a.exchanges.length > 4 && (
                    <span className="ml-2 font-mono text-[10px] text-text-tertiary">
                      +{a.exchanges.length - 4}
                    </span>
                  )}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
