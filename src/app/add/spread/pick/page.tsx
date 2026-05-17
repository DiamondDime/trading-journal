import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardNav } from "@/components/wizard/wizard-nav";
import { IMPORTED_FILLS } from "@/lib/data/exchange-fills-mock";
import {
  matchSpreads,
  type MatcherSpreadType,
  type MatcherSuggestion,
} from "@/lib/matcher/spread-matcher";
import { cn } from "@/lib/utils";
import { getT } from "@/lib/i18n/server";
import type { TFunction } from "@/lib/i18n/resolve";
import { ManualBuilder } from "./manual-builder";
import { ExchangeChip } from "@/components/settings/exchange-logo";

// Max suggestions to surface on the page. Keeps the panel scannable; the
// production matcher will rank with calibrated confidence and we'll widen this
// once we trust the score.
const MAX_SUGGESTIONS = 6;

type Search = Promise<{ [key: string]: string | string[] | undefined }>;

function fmtPrice(n: number) {
  if (n < 1) return n.toLocaleString("en-US", { maximumSignificantDigits: 4 });
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtQty(n: number) {
  if (n >= 1_000_000) return n.toExponential(2);
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (n < 1) return n.toLocaleString("en-US", { maximumSignificantDigits: 4 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

export default async function SpreadPickPage(props: { searchParams: Search }) {
  const sp = await props.searchParams;
  const showAll =
    typeof sp.show === "string" && sp.show === "all" ? true : false;
  const t = await getT();

  const suggestions = matchSpreads(IMPORTED_FILLS).slice(0, MAX_SUGGESTIONS);

  const stepLabels: readonly string[] = [
    t("wizard.spread.stepLabels.source"),
    t("wizard.spread.stepLabels.pickLegs"),
    t("wizard.spread.stepLabels.type"),
    t("wizard.spread.stepLabels.fields"),
    t("wizard.spread.stepLabels.review"),
  ];

  return (
    <WizardShell
      type="spread"
      step={2}
      totalSteps={5}
      stepLabels={stepLabels}
      title={t("wizard.spread.pick.title")}
      subtitle={t("wizard.spread.pick.subtitle")}
    >
      {/* ── Two-pane: suggestions (≈60%) + manual builder (≈40%) ──────────── */}
      <div className="-mx-2 md:-mx-4 lg:-mx-6">
        {/* Tab/toggle row */}
        <div className="mb-6 flex items-center justify-between px-2 md:px-4 lg:px-6">
          <div
            role="tablist"
            aria-label={t("wizard.spread.pick.toggleAria")}
            className="inline-flex rounded-md border border-border bg-surface p-0.5"
          >
            <ToggleLink
              href="/add/spread/pick"
              active={!showAll}
              label={t("wizard.spread.pick.toggleSuggested")}
            />
            <ToggleLink
              href="/add/spread/pick?show=all"
              active={showAll}
              label={t("wizard.spread.pick.toggleAll")}
            />
          </div>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
            {t.plural("wizard.spread.pick.suggestionsCount", suggestions.length)}{" "}
            ·{" "}
            {t.plural("wizard.spread.pick.fillsCount", IMPORTED_FILLS.length)}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 px-2 md:px-4 lg:grid-cols-[3fr_2fr] lg:px-6">
          {/* ── Suggestions pane (always rendered) ─────────────────────── */}
          <section
            aria-label={t("wizard.spread.pick.suggestionsAria")}
            className="flex flex-col gap-3"
          >
            <header className="flex items-baseline justify-between">
              <h2 className="font-serif text-[15px] font-medium text-text">
                {t("wizard.spread.pick.suggestionsHeading")}
              </h2>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
                <Sparkles className="mr-1 inline h-3 w-3 align-[-2px] text-signature" />
                {t("wizard.spread.pick.autoDetected")}
              </span>
            </header>

            {suggestions.length === 0 ? (
              <EmptyState t={t} />
            ) : (
              <ul className="flex flex-col gap-3">
                {suggestions.map((s) => (
                  <SuggestionCard key={s.id} suggestion={s} t={t} />
                ))}
              </ul>
            )}

            {showAll && (
              <details className="mt-4 rounded-md border border-border bg-surface p-4 text-[12px] text-text-tertiary">
                <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary">
                  {t("wizard.spread.pick.howItWorks.summary")}
                </summary>
                <p className="mt-3 font-serif text-[13px] leading-snug italic">
                  {t("wizard.spread.pick.howItWorks.body")}
                </p>
              </details>
            )}
          </section>

          {/* ── Manual builder pane ────────────────────────────────────── */}
          <section
            aria-label={t("wizard.spread.pick.manualAria")}
            className="flex flex-col"
          >
            <ManualBuilder fills={IMPORTED_FILLS} />
          </section>
        </div>
      </div>

      <WizardNav backHref="/add/spread/source" />
    </WizardShell>
  );
}

// ── Local helpers ────────────────────────────────────────────────────────────

function SuggestionCard({
  suggestion,
  t,
}: {
  suggestion: MatcherSuggestion;
  t: TFunction;
}) {
  const legIds = suggestion.legs.map((l) => l.id).join(",");
  const params = new URLSearchParams({
    legs: legIds,
    spreadType: suggestion.spreadType,
    matcher: "auto",
  });
  const href = `/add/spread/type?${params.toString()}`;
  return (
    <li>
      <article className="group rounded-md border border-border bg-surface p-4 transition-colors hover:border-border-strong">
        <header className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-subtle px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary">
            {localizedSpreadTypeLabel(suggestion.spreadType, t)}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
            {t("wizard.spread.pick.score")}{" "}
            <span className="text-text">{suggestion.score.toFixed(1)}</span>
          </span>
        </header>

        <ul className="mt-3 divide-y divide-border-subtle">
          {suggestion.legs.map((leg) => (
            <li
              key={leg.id}
              className="flex items-center justify-between gap-3 py-2"
            >
              <div className="flex items-center gap-2 leading-tight">
                <ExchangeChip
                  venue={leg.exchange}
                  size="sm"
                  className="shrink-0"
                />
                <div className="flex flex-col">
                  <span className="font-serif text-[13px] font-medium text-text">
                    {leg.symbol}
                  </span>
                  <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-text-tertiary">
                    {leg.exchange} · {leg.instrument}
                    {leg.expiry ? ` · ${leg.expiry}` : ""}
                  </span>
                </div>
              </div>
              <div className="flex items-baseline gap-3">
                <span
                  className={cn(
                    "font-mono text-[10px] uppercase tracking-[0.14em]",
                    leg.side === "long" ? "text-up" : "text-down"
                  )}
                >
                  {leg.side}
                </span>
                <span className="font-mono text-[11px] tabular-nums text-text-secondary">
                  {fmtQty(leg.qty)}
                </span>
                <span className="font-mono text-[11px] tabular-nums text-text">
                  {fmtPrice(leg.entryPrice)}
                </span>
                <span className="text-text-tertiary">→</span>
                <span className="font-mono text-[11px] tabular-nums text-text-secondary">
                  {fmtPrice(leg.exitPrice)}
                </span>
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
                  {leg.closedLabel}
                </span>
              </div>
            </li>
          ))}
        </ul>

        <footer className="mt-3 flex items-end justify-between gap-3">
          <p className="max-w-[42ch] font-serif text-[12px] italic leading-snug text-text-tertiary">
            {suggestion.rationale}
          </p>
          <Link
            href={href}
            className="inline-flex shrink-0 items-center gap-2 rounded-md border border-text bg-text px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-app transition-colors hover:bg-text-secondary"
          >
            {t("wizard.spread.pick.useThese")}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </footer>
      </article>
    </li>
  );
}

/** Localised label for a matcher spread type. Mirrors the helper in /fields. */
function localizedSpreadTypeLabel(
  spreadType: MatcherSpreadType,
  t: TFunction,
): string {
  return t(`wizard.shell.spreadTypeLabels.${spreadType}` as const);
}

function EmptyState({ t }: { t: TFunction }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-surface p-8 text-center">
      <p className="font-serif text-[14px] italic text-text-tertiary">
        {t("wizard.spread.pick.empty.heading")}
      </p>
      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
        {t("wizard.spread.pick.empty.body")}
      </p>
    </div>
  );
}

function ToggleLink({
  href,
  active,
  label,
}: {
  href: string;
  active: boolean;
  label: string;
}) {
  return (
    <Link
      role="tab"
      aria-selected={active}
      href={href}
      className={cn(
        "rounded px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors",
        active
          ? "bg-subtle text-text"
          : "text-text-tertiary hover:text-text"
      )}
    >
      {label}
    </Link>
  );
}
