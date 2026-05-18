/**
 * /balances — portfolio dashboard.
 *
 * Top-to-bottom layout per the master plan:
 *   1. PortfolioHero (total + stable/volatile/24h)
 *   2. PortfolioHistoryChart (range tabs as URL state)
 *   3. AllocationPie + BalanceTable (assets desc)
 *   4. Per-exchange cards grid
 *   5. Drift banner (when any non-stable asset's drift > 0.5%)
 *
 * `force-dynamic` because balance state changes every sync — the page must
 * never serve a prerender.
 */
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import {
  getBalancesResponse,
  getSnapshotSeries,
} from "@/lib/db/balances";
import type { UserId } from "@/types/canonical";
import type { DriftHint } from "@/types/balances";
import { PortfolioHero } from "@/components/balances/portfolio-hero";
import { PortfolioHistoryChart } from "@/components/balances/portfolio-history-chart";
import { AllocationPie } from "@/components/balances/allocation-pie";
import { BalanceTable } from "@/components/balances/balance-table";
import { ExchangeBalanceRow } from "@/components/balances/exchange-balance-row";
import { RefreshButton } from "@/components/balances/refresh-button";
import { getT, getLocale } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

/**
 * Locale-aware relative-time. Falls back to short Intl format past one
 * minute so RU users see "5 мин назад" instead of "5m ago".
 */
function fmtRelativeI18n(
  iso: string | null,
  intlLocale: string,
  t: Awaited<ReturnType<typeof getT>>,
): string {
  if (iso == null) return t("balances.relative.noSnapshot");
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return t("balances.relative.momentsAgo");
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return t("balances.relative.momentsAgo");
  const rtf = new Intl.RelativeTimeFormat(intlLocale, { numeric: "auto", style: "short" });
  if (mins < 60) return rtf.format(-mins, "minute");
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return rtf.format(-hrs, "hour");
  const days = Math.floor(hrs / 24);
  return rtf.format(-days, "day");
}

interface PageProps {
  searchParams: Promise<{ range?: string | string[] }>;
}

function pickRange(
  v: string | string[] | undefined,
): "24h" | "7d" | "30d" | "90d" | "all" {
  const raw = Array.isArray(v) ? v[0] : v;
  if (raw === "24h" || raw === "7d" || raw === "90d" || raw === "all") return raw;
  return "30d";
}

export default async function BalancesPage({ searchParams }: PageProps) {
  const { id: userId } = await requireUser();
  const t = await getT();
  const locale = await getLocale();
  const intlLocale = locale === "ru" ? "ru-RU" : "en-US";
  const raw = await searchParams;
  const range = pickRange(raw.range);

  const [balances, series] = await Promise.all([
    getBalancesResponse(userId as UserId),
    getSnapshotSeries(userId as UserId, range),
  ]);

  const hasAnything = Number(balances.totalUsd) > 0;
  const updatedLabel = fmtRelativeI18n(balances.snapshotAt, intlLocale, t);

  return (
    <div className="w-full">
      <header className="flex flex-col gap-3 border-b border-border px-8 py-7 md:flex-row md:items-end md:justify-between lg:px-12">
        <div>
          <h1 className="font-serif text-[40px] font-medium leading-none tracking-tight text-text">
            {t("balances.pageTitle")}
          </h1>
          <p className="mt-2 font-serif text-sm italic text-text-tertiary">
            {t("balances.pageSubtitle")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
            {t("balances.updatedAgo", { label: updatedLabel })}
          </span>
          <RefreshButton />
        </div>
      </header>

      <div className="space-y-8 px-8 py-8 lg:px-12">
        {/* Drift banner — surfaced when journal fills math conflicts with reported balances. */}
        {balances.drift.length > 0 && (
          <DriftBanner drift={balances.drift} t={t} />
        )}

        {!hasAnything ? (
          <EmptyState t={t} />
        ) : (
          <>
            <PortfolioHero
              totalUsd={balances.totalUsd}
              stableUsd={balances.stableUsd}
              volatileUsd={balances.volatileUsd}
              delta24hUsd={balances.delta24hUsd}
              snapshotLabel={t("balances.updatedAgo", { label: updatedLabel })}
            />

            <PortfolioHistoryChart points={series.points} range={range} />

            <section className="grid grid-cols-1 gap-6 xl:grid-cols-[280px_1fr]">
              <div className="rounded-md border border-border bg-surface p-6 flex flex-col items-center">
                <h3 className="self-start font-serif text-[12px] font-semibold uppercase tracking-[0.16em] text-text">
                  {t("balances.allocation.title")}
                </h3>
                <div className="mt-4">
                  <AllocationPie assets={balances.byAsset} />
                </div>
              </div>
              <div>
                <div className="mb-3 flex items-baseline justify-between">
                  <h3 className="font-serif text-[12px] font-semibold uppercase tracking-[0.16em] text-text">
                    {t("balances.byAsset.title")}
                  </h3>
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
                    {t("balances.byAsset.countLabel", { n: balances.byAsset.length })}
                  </span>
                </div>
                <BalanceTable
                  assets={balances.byAsset}
                  totalUsd={balances.totalUsd}
                />
              </div>
            </section>

            <section>
              <div className="mb-3 flex items-baseline justify-between">
                <h3 className="font-serif text-[12px] font-semibold uppercase tracking-[0.16em] text-text">
                  {t("balances.byExchange.title")}
                </h3>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
                  {balances.byExchange.length === 1
                    ? t("balances.byExchange.countLabelOne", { n: 1 })
                    : t("balances.byExchange.countLabel", { n: balances.byExchange.length })}
                </span>
              </div>
              {balances.byExchange.length > 0 ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {balances.byExchange.map((e) => (
                    <ExchangeBalanceRow key={e.connectionId} entry={e} />
                  ))}
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-border bg-surface py-10 text-center">
                  <p className="font-serif text-sm italic text-text-tertiary">
                    {t("balances.byExchange.empty")}
                  </p>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Soft-amber banner shown when at least one non-stable asset's reported
 * balance disagrees with the journal's fills math by more than 0.5%.
 * Helps the user spot an unexpected transfer-in or a missed sync gap
 * before it becomes a tax-reconciliation headache.
 *
 * CTAs:
 *   - "Investigate" → /settings/exchanges (existing, for re-syncing keys)
 *   - "Log as movement" → /add/movement/fields pre-filled with the headliner
 *     asset + absolute drift qty + kind=transfer. URL params are the wizard's
 *     normal pre-fill path (same shape the review→edit link uses).
 */
function DriftBanner({
  drift,
  t,
}: {
  drift: DriftHint[];
  t: Awaited<ReturnType<typeof getT>>;
}) {
  const headliner = drift[0];
  const more = drift.length - 1;

  // Drift qty is signed (reported - expected). The movement wizard takes a
  // signed `amount`, but the user's mental model when clicking from a drift
  // hint is "this much is unaccounted for" — so pre-fill the absolute value
  // and let them flip the sign on the form if needed.
  const absDriftQty = Math.abs(Number(headliner.driftQty));
  const logMovementHref =
    `/add/movement/fields?kind=transfer` +
    `&asset=${encodeURIComponent(headliner.asset)}` +
    `&amount=${Number.isFinite(absDriftQty) ? absDriftQty : ""}` +
    `&prefill=drift`;

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border border-l-4 border-l-signature bg-surface px-5 py-4 md:flex-row md:items-center md:justify-between">
      <div className="flex-1">
        <p className="font-serif text-[13px] font-semibold text-text">
          {t("balances.drift.title")}
        </p>
        <p className="mt-1 font-mono text-[12px] tabular-nums text-text-secondary">
          {t("balances.drift.assetLine", {
            asset: fmtBase(headliner.asset),
            expected: fmtQtyHint(headliner.expectedQty, headliner.asset),
            reported: fmtQtyHint(headliner.reportedQty, headliner.asset),
            pct: (headliner.driftPct * 100).toFixed(1),
          })}
        </p>
        {more > 0 && (
          <p className="mt-1 font-serif text-[11px] italic text-text-tertiary">
            {more === 1
              ? t("balances.drift.moreSuffixOne", { n: more })
              : t("balances.drift.moreSuffix", { n: more })}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-2 self-start sm:flex-row sm:items-center md:self-auto">
        <Link
          href={logMovementHref}
          className="inline-flex items-center gap-2 rounded-md border border-text bg-text px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-app transition-opacity hover:opacity-90"
        >
          {t("balances.drift.logMovementCta")}
          <ArrowRight className="h-3 w-3" />
        </Link>
        <Link
          href="/settings/exchanges"
          className="inline-flex items-center gap-2 rounded-md border border-border bg-app px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-text hover:border-border-strong"
        >
          {t("balances.drift.cta")}
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

function fmtBase(asset: string): string {
  return asset.toUpperCase();
}

function fmtQtyHint(qty: string, asset: string): string {
  const n = Number(qty);
  if (!Number.isFinite(n)) return "—";
  const dp = Math.abs(n) >= 100 ? 2 : Math.abs(n) >= 1 ? 4 : 6;
  return `${n.toLocaleString("en-US", { maximumFractionDigits: dp })} ${asset}`;
}

function EmptyState({ t }: { t: Awaited<ReturnType<typeof getT>> }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-surface px-6 py-16 text-center">
      <h2 className="font-serif text-[24px] font-medium leading-none text-text">
        {t("balances.empty.title")}
      </h2>
      <p className="mx-auto mt-3 max-w-md font-serif text-sm italic text-text-tertiary">
        {t("balances.empty.body")}
      </p>
      <Link
        href="/settings/exchanges"
        className="mt-6 inline-flex items-center gap-2 rounded-md bg-text px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-app transition-opacity hover:opacity-90"
      >
        {t("balances.empty.cta")}
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

