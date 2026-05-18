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
import { ExchangeLogo, exchangeLogoUrl } from "@/components/settings/exchange-logo";
import type { WalletType } from "@/types/balances";
import type { UserId } from "@/types/canonical";
import { getT, getLocale } from "@/lib/i18n/server";

/**
 * Snake-case wallet types ↔ camelCase i18n keys. The dict couldn't have
 * snake-case keys (TS literal-types complain about underscores in some
 * lookups), so we bridge here.
 */
function walletTypeKey(
  wt: WalletType,
):
  | "balances.walletTypes.spot"
  | "balances.walletTypes.margin"
  | "balances.walletTypes.crossMargin"
  | "balances.walletTypes.isolatedMargin"
  | "balances.walletTypes.futures"
  | "balances.walletTypes.earn"
  | "balances.walletTypes.funding" {
  switch (wt) {
    case "cross_margin":    return "balances.walletTypes.crossMargin";
    case "isolated_margin": return "balances.walletTypes.isolatedMargin";
    case "spot":            return "balances.walletTypes.spot";
    case "margin":          return "balances.walletTypes.margin";
    case "futures":         return "balances.walletTypes.futures";
    case "earn":            return "balances.walletTypes.earn";
    case "funding":         return "balances.walletTypes.funding";
  }
}

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ exchange: string }>;
}

function fmtUsd(value: string | null | undefined, locale: string): string {
  if (value == null) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `$${n.toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtQty(value: string, locale: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const dp = Math.abs(n) >= 100 ? 2 : Math.abs(n) >= 1 ? 4 : 8;
  return n.toLocaleString(locale, { maximumFractionDigits: dp });
}

export default async function ExchangeBalancePage({ params }: PageProps) {
  const { id: userId } = await requireUser();
  const { exchange } = await params;
  const t = await getT();
  const locale = await getLocale();
  const intlLocale = locale === "ru" ? "ru-RU" : "en-US";

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
          {t("balances.drilldown.backToList")}
        </Link>
        <div className="mt-3 flex items-center gap-4">
          <ExchangeLogo
            code={exchange}
            displayName={exchangeName}
            logoUrl={exchangeLogoUrl(exchange)}
            size="md"
          />
          <div>
            <h1 className="font-serif text-[28px] font-medium leading-none text-text">
              {exchangeName}
            </h1>
            <p className="mt-1 font-mono text-[12px] tabular-nums text-text-tertiary">
              {details.length === 1
                ? t("balances.drilldown.totalSubAccountsOne", {
                    total: fmtUsd(String(totalAcrossConns), intlLocale),
                    n: details.length,
                  })
                : t("balances.drilldown.totalSubAccounts", {
                    total: fmtUsd(String(totalAcrossConns), intlLocale),
                    n: details.length,
                  })}
            </p>
          </div>
        </div>
      </header>

      <div className="space-y-6 px-8 py-8 lg:px-12">
        {details.map((d) => (
          <ConnectionCard key={d.connectionId} detail={d} t={t} intlLocale={intlLocale} />
        ))}
      </div>
    </div>
  );
}

function ConnectionCard({
  detail,
  t,
  intlLocale,
}: {
  detail: ExchangeBalanceDetail;
  t: Awaited<ReturnType<typeof getT>>;
  intlLocale: string;
}) {
  return (
    <section className="overflow-hidden rounded-md border border-border bg-surface">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <p className="font-serif text-[16px] font-medium text-text">
            {detail.label}
          </p>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
            {detail.wallets.length === 1
              ? t("balances.drilldown.walletLabelOne", { n: detail.wallets.length })
              : t("balances.drilldown.walletLabel", { n: detail.wallets.length })}
          </p>
        </div>
        <p className="font-mono text-[18px] font-medium tabular-nums text-text">
          {fmtUsd(detail.totalUsd, intlLocale)}
        </p>
      </header>

      <div className="divide-y divide-border">
        {detail.wallets.map((w) => (
          <div key={w.walletType} className="px-6 py-5">
            <div className="mb-3 flex items-baseline justify-between">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-tertiary">
                {t(walletTypeKey(w.walletType))}
              </p>
              <p className="font-mono text-[13px] tabular-nums text-text-secondary">
                {fmtUsd(w.totalUsd, intlLocale)}
              </p>
            </div>
            <table className="w-full border-collapse">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
                  <th className="py-1 font-medium">{t("balances.drilldown.columns.asset")}</th>
                  <th className="py-1 font-medium text-right">{t("balances.drilldown.columns.total")}</th>
                  <th className="py-1 font-medium text-right">{t("balances.drilldown.columns.available")}</th>
                  <th className="py-1 font-medium text-right">{t("balances.drilldown.columns.locked")}</th>
                  <th className="py-1 font-medium text-right">{t("balances.drilldown.columns.usd")}</th>
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
                      {fmtQty(r.total, intlLocale)}
                    </td>
                    <td className="py-1 text-right font-mono text-[12px] tabular-nums text-text-tertiary">
                      {fmtQty(r.available, intlLocale)}
                    </td>
                    <td className="py-1 text-right font-mono text-[12px] tabular-nums text-text-tertiary">
                      {fmtQty(r.locked, intlLocale)}
                    </td>
                    <td className="py-1 text-right font-mono text-[12px] tabular-nums text-text">
                      {fmtUsd(r.usdValue, intlLocale)}
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
