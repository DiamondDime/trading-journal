/**
 * PartnerCard — one editorial card per referral-eligible exchange on /partners.
 *
 * Layout (vertical, single column):
 *   1. Header row: logo · display name · CEX/DEX chip
 *   2. Italic-serif blurb (the marketing one-liner from the OVERLAY)
 *   3. Rebate visual: 5-segment dot row + "Up to N% fee rebate" caption.
 *      The segmented row is restrained — no animation, no glow, no fill — and
 *      neutrally inherits text color. The amber moment lives upstairs in the
 *      hero counter, not here.
 *   4. Perks list — 2-3 rows, each prefixed with a small ◇ glyph
 *   5. Welcome bonus row — small mono row with a ✦ glyph, only if set
 *   6. CTA at the bottom — inverted bg-text/text-app button
 *
 * The whole card is a `<div>` (not the anchor) because the CTA is the only
 * place we want to capture a click. Making the entire card clickable steals
 * keyboard focus from the bonus/perk rows and makes it harder for screen
 * readers to dictate the structure.
 *
 * `referralUrl` is opened with `rel="noopener noreferrer sponsored"` per the
 * page-level disclosure contract. We don't pre-fetch the destination — it's
 * an external host and prefetching would leak the user's IP early.
 */
import { ArrowUpRight } from "lucide-react";

import type { CatalogExchange } from "@/lib/db/exchanges";
import { ExchangeLogo } from "@/components/settings/exchange-logo";
import { cn } from "@/lib/utils";
import type { TFunction } from "@/lib/i18n/resolve";

type MessageKey = Parameters<TFunction>[0];

interface Props {
  exchange: CatalogExchange;
  t: TFunction;
}

export function PartnerCard({ exchange, t }: Props) {
  if (!exchange.referralUrl) return null;

  const kindLabel =
    exchange.kind === "cex" ? t("partners.kindCex") : t("partners.kindDex");

  // Resolve the welcome bonus copy. If it begins with `partners.bonus.` we
  // look it up via the dictionary; otherwise we treat the OVERLAY value as
  // verbatim copy (escape hatch for future per-exchange one-offs).
  const bonus = resolveBonus(exchange.welcomeBonus, t);

  return (
    <article
      className="flex flex-col overflow-hidden rounded-md border border-border bg-surface transition-colors hover:border-border-strong"
      aria-labelledby={`partner-${exchange.code}-name`}
    >
      {/* ── header ─────────────────────────────────────────────────────── */}
      <header className="flex items-center gap-3 border-b border-border-subtle px-5 py-4">
        <ExchangeLogo
          code={exchange.code}
          displayName={exchange.displayName}
          logoUrl={exchange.logoUrl}
          size="md"
        />
        <div className="min-w-0 flex-1">
          <h3
            id={`partner-${exchange.code}-name`}
            className="font-serif text-[18px] font-medium leading-none text-text"
          >
            {exchange.displayName}
          </h3>
          {exchange.referralBlurb && (
            <p className="mt-1.5 truncate font-serif text-[12.5px] italic leading-snug text-text-secondary">
              {exchange.referralBlurb}
            </p>
          )}
        </div>
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-text-tertiary">
          {kindLabel}
        </span>
      </header>

      {/* ── body ───────────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col gap-4 px-5 py-4">
        {/* Rebate bar */}
        {exchange.rebatePct != null && (
          <RebateBar pct={exchange.rebatePct} caption={t("partners.upTo", { pct: exchange.rebatePct })} />
        )}

        {/* Perks */}
        {exchange.perks.length > 0 && (
          <ul className="space-y-1.5">
            {exchange.perks.map((perkKey) => (
              <li
                key={perkKey}
                className="flex items-start gap-2 font-serif text-[13px] leading-snug text-text-secondary"
              >
                <span
                  aria-hidden
                  className="mt-[5px] text-[9px] text-text-tertiary"
                >
                  ◇
                </span>
                <span>{t(perkKey as MessageKey)}</span>
              </li>
            ))}
          </ul>
        )}

        {/* Welcome bonus */}
        {bonus && (
          <p className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-text-tertiary">
            <span aria-hidden className="text-[10px] text-text-secondary">
              ✦
            </span>
            {bonus}
          </p>
        )}
      </div>

      {/* ── CTA ────────────────────────────────────────────────────────── */}
      <a
        href={exchange.referralUrl}
        target="_blank"
        rel="noopener noreferrer sponsored"
        className={cn(
          "group flex items-center justify-between gap-2 border-t border-border bg-text px-5 py-3 text-app transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-text",
        )}
      >
        <span className="font-mono text-[11px] uppercase tracking-[0.16em]">
          {t("partners.signupCta", { exchange: exchange.displayName })}
        </span>
        <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:-translate-y-px group-hover:translate-x-px" />
      </a>
    </article>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */

/**
 * Rebate visualisation. 5 segments, ceil(pct / 10) filled, clamped to [0, 5].
 * Chosen over a continuous progress bar because the dot row reads as
 * "tier 3 of 5" at a glance — quick comparison across cards — whereas a
 * percentage bar at, say, 20%-vs-30% width looks like rounding noise.
 *
 * The filled segments use `bg-text` rather than `bg-signature` so we hold
 * to the "one amber moment per page" rule (the hero counter takes that
 * slot upstairs).
 */
function RebateBar({ pct, caption }: { pct: number; caption: string }) {
  const filled = Math.max(0, Math.min(5, Math.ceil(pct / 10)));
  return (
    <div className="space-y-1.5">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
        {caption}
      </p>
      <div
        className="flex items-center gap-1"
        role="img"
        aria-label={caption}
      >
        {Array.from({ length: 5 }, (_, i) => (
          <span
            key={i}
            className={cn(
              "h-1.5 flex-1 rounded-sm",
              i < filled ? "bg-text" : "bg-subtle",
            )}
          />
        ))}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */

function resolveBonus(welcomeBonus: string | null, t: TFunction): string | null {
  if (!welcomeBonus) return null;
  if (welcomeBonus.startsWith("partners.bonus.")) {
    return t(welcomeBonus as MessageKey);
  }
  return welcomeBonus;
}
