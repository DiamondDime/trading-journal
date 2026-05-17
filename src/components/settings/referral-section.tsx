/**
 * Recommended-exchanges rail.
 *
 * Editorial, single-card layout. One row per catalog entry that has a
 * `referralUrl` set. Each row is a 1-line magazine entry: logo · serif name
 * + italic-serif blurb · mono "Get started →" anchor.
 *
 * Honest-disclosure copy lives at the bottom of the card so users see the
 * referral relationship before they click anything.
 *
 * If no catalog entries have referral URLs yet (the v1 default — we don't
 * fake partnerships), the section renders a small editorial placeholder
 * explaining the slot will fill in once the user backfills the catalog.
 * That keeps the page from showing an awkward empty card.
 */
import { ArrowUpRight } from "lucide-react";

import type { CatalogExchange } from "@/lib/db/exchanges";
import { ExchangeLogo } from "@/components/settings/exchange-logo";
import { getT } from "@/lib/i18n/server";
import type { TFunction } from "@/lib/i18n/resolve";

interface Props {
  /** Catalog entries with `referralUrl != null`. Pass already-filtered list. */
  referrals: CatalogExchange[];
}

export async function ReferralSection({ referrals }: Props) {
  const t = await getT();
  return (
    <section
      aria-labelledby="recommended-exchanges-heading"
      className="space-y-4"
    >
      {/* ─── Section header ──────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3
            id="recommended-exchanges-heading"
            className="font-serif text-[18px] font-medium leading-tight text-text"
          >
            {t("settings.exchanges.referralSection.title")}
          </h3>
          <p className="mt-1 font-serif text-[13px] italic text-text-secondary">
            {t("settings.exchanges.referralSection.subtitle")}
          </p>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
          {referrals.length === 0
            ? t("settings.exchanges.referralSection.noPartners")
            : t.plural("settings.exchanges.referralSection.partnerCount", referrals.length)}
        </span>
      </div>

      {/* ─── Card (rows + disclosure) ────────────────────────────────── */}
      <div className="overflow-hidden rounded-md border border-border bg-surface">
        {referrals.length === 0 ? <EmptyReferralRow t={t} /> : null}

        {referrals.map((ex) => (
          <ReferralRow key={ex.code} exchange={ex} t={t} />
        ))}

        <div className="border-t border-border-subtle bg-inset px-5 py-3">
          <p className="font-serif text-[11.5px] italic leading-snug text-text-tertiary">
            {t("settings.exchanges.referralSection.disclosure")}
          </p>
        </div>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------- One row */

function ReferralRow({
  exchange,
  t,
}: {
  exchange: CatalogExchange;
  t: TFunction;
}) {
  // Defensive: caller is supposed to pre-filter, but a stale callsite shouldn't
  // be able to render a row that points nowhere. If the URL is null, drop out.
  if (!exchange.referralUrl) return null;

  return (
    <a
      href={exchange.referralUrl}
      target="_blank"
      rel="noopener noreferrer sponsored"
      className="group flex items-center gap-4 border-b border-border-subtle px-5 py-3 transition-colors last:border-b-0 hover:bg-subtle/60 focus:outline-none focus-visible:bg-subtle focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-text"
    >
      <ExchangeLogo
        code={exchange.code}
        displayName={exchange.displayName}
        logoUrl={exchange.logoUrl}
        size="sm"
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-serif text-[15px] font-medium leading-none text-text">
            {exchange.displayName}
          </span>
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-text-tertiary">
            {exchange.kind}
          </span>
        </div>
        {exchange.referralBlurb && (
          <p className="mt-0.5 truncate font-serif text-[12px] italic text-text-secondary">
            {exchange.referralBlurb}
          </p>
        )}
      </div>

      <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary transition-colors group-hover:text-text">
        {t("settings.exchanges.referralSection.cta")}
        <ArrowUpRight className="h-3 w-3" />
      </span>
    </a>
  );
}

/* ---------------------------------------------------- Empty row */

function EmptyReferralRow({ t }: { t: TFunction }) {
  return (
    <div className="border-b border-border-subtle px-5 py-5">
      <p className="font-serif text-[13px] italic leading-snug text-text-secondary">
        {t("settings.exchanges.referralSection.emptyBody")}
      </p>
    </div>
  );
}
