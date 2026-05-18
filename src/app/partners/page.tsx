/**
 * /partners — referral marketing page.
 *
 * Editorial, server-rendered persuasion surface. Wraps the same catalog the
 * Settings rail uses, but builds a dedicated grid + savings-calculator +
 * disclosure stack tuned for a single visit (not for ambient reference like
 * the rail in Settings).
 *
 * Amber rule: the page burns its one signature accent on the **annual
 * savings number in the calculator**. The hero counter, honesty card,
 * partner cards, and CTAs all stay neutral. Don't drift the amber upstairs
 * without first removing it from the calculator — two amber moments per
 * page is the rule we're explicitly trying to avoid.
 *
 * Empty-state behaviour: if no exchanges in the overlay have a
 * `referralUrl`, the page renders the hero + an editorial placeholder
 * card. The calculator is hidden — its denominator depends on the same
 * referral-eligible set, so showing "$0/year" would be misleading.
 */
import { getT, getLocale } from "@/lib/i18n/server";
import {
  listExchangeCatalog,
  getPartnerCatalog,
} from "@/lib/db/exchanges";
import { PartnerCard } from "@/components/partners/partner-card";

// Catalog reads are fast (single SELECT, <5ms locally) but referral copy can
// move between releases; force-dynamic keeps the page honest after the
// OVERLAY map changes without us having to remember to bump a revalidate
// stamp.
export const dynamic = "force-dynamic";

export default async function PartnersPage() {
  const t = await getT();
  const locale = await getLocale();
  const intlLocale = locale === "ru" ? "ru-RU" : "en-US";

  const catalog = await listExchangeCatalog();
  const partners = getPartnerCatalog(catalog);

  const count = partners.length;
  const counterCopy = t.plural("partners.counterPlural", count);

  return (
    <div className="w-full">
      {/* ── hero strip ──────────────────────────────────────────────────── */}
      <header className="flex flex-col gap-4 border-b border-border px-8 py-7 md:flex-row md:items-end md:justify-between lg:px-12">
        <div className="max-w-2xl">
          <h1 className="font-serif text-[40px] font-medium leading-none tracking-tight text-text">
            {t("partners.title")}
          </h1>
          <p className="mt-3 font-serif text-sm italic leading-relaxed text-text-tertiary">
            {t("partners.subtitle")}
          </p>
        </div>
        <div className="text-right">
          <p className="font-serif text-[44px] font-medium leading-none tracking-tight tabular-nums text-text">
            {count.toLocaleString(intlLocale)}
          </p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
            {counterCopy}
          </p>
        </div>
      </header>

      <div className="px-8 py-8 lg:px-12">
        {/* ── honesty card ──────────────────────────────────────────────── */}
        <section
          aria-labelledby="partners-honesty-heading"
          className="mb-10 overflow-hidden rounded-md border border-border bg-surface"
        >
          <div className="border-l-2 border-border-strong px-6 py-5">
            <h2
              id="partners-honesty-heading"
              className="font-serif text-[15px] font-semibold uppercase tracking-[0.16em] text-text"
            >
              {t("partners.honestyTitle")}
            </h2>
            <p className="mt-3 font-serif text-[15px] italic leading-relaxed text-text-secondary">
              {t("partners.honestyBody")}
            </p>
          </div>
        </section>

        {/* ── partner grid ──────────────────────────────────────────────── */}
        {partners.length > 0 ? (
          <section
            aria-label={t("partners.title")}
            className="mb-12 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3"
          >
            {partners.map((exchange) => (
              <PartnerCard key={exchange.code} exchange={exchange} t={t} />
            ))}
          </section>
        ) : (
          <section className="mb-12 rounded-md border border-dashed border-border bg-surface px-6 py-12 text-center">
            <p className="font-serif text-base italic text-text-secondary">
              {t("partners.empty")}
            </p>
          </section>
        )}

        {/* ── persuasion callout ────────────────────────────────────────── */}
        {/* Mirrors the honesty card chrome so the page reads as two matched */}
        {/* callouts bracketing the partner grid: trust (top) → social proof */}
        {/* (bottom). One paragraph, no numbers we can't defend. The "thousands */}
        {/* a year" claim is bracketed by "typical volumes" and "some desks per */}
        {/* month" — directional, not a fabricated population stat. */}
        {partners.length > 0 && (
          <section
            aria-labelledby="partners-persuasion-heading"
            className="mb-8 overflow-hidden rounded-md border border-border bg-surface"
          >
            <div className="border-l-2 border-border-strong px-6 py-5">
              <h2
                id="partners-persuasion-heading"
                className="font-serif text-[15px] font-semibold uppercase tracking-[0.16em] text-text"
              >
                {t("partners.persuasionTitle")}
              </h2>
              <p className="mt-3 font-serif text-[15px] italic leading-relaxed text-text-secondary">
                {t("partners.persuasionBody")}
              </p>
            </div>
          </section>
        )}

        {/* ── disclosure footer ─────────────────────────────────────────── */}
        <footer className="mt-8 border-t border-border-subtle pt-5">
          <p className="font-serif text-[12px] italic leading-snug text-text-tertiary">
            {t("partners.disclosure")}
          </p>
        </footer>
      </div>
    </div>
  );
}
