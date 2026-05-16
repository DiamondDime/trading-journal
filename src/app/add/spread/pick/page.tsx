import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardNav } from "@/components/wizard/wizard-nav";
import { IMPORTED_FILLS } from "@/lib/data/exchange-fills-mock";
import {
  matchSpreads,
  SPREAD_TYPE_LABELS,
  type MatcherSuggestion,
} from "@/lib/matcher/spread-matcher";
import { cn } from "@/lib/utils";
import { ManualBuilder } from "./manual-builder";

const STEP_LABELS = ["Source", "Pick legs", "Type", "Fields", "Review"] as const;

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

  const suggestions = matchSpreads(IMPORTED_FILLS).slice(0, MAX_SUGGESTIONS);

  return (
    <WizardShell
      type="spread"
      step={2}
      totalSteps={5}
      stepLabels={STEP_LABELS}
      title="Pick the legs that make up this spread"
      subtitle="The matcher reads your imported fills and proposes likely pairings first. If nothing fits, build the spread by hand from the table on the right."
    >
      {/* ── Two-pane: suggestions (≈60%) + manual builder (≈40%) ──────────── */}
      <div className="-mx-2 md:-mx-4 lg:-mx-6">
        {/* Tab/toggle row */}
        <div className="mb-6 flex items-center justify-between px-2 md:px-4 lg:px-6">
          <div
            role="tablist"
            aria-label="Picker mode"
            className="inline-flex rounded-md border border-border bg-surface p-0.5"
          >
            <ToggleLink
              href="/add/spread/pick"
              active={!showAll}
              label="Suggested only"
            />
            <ToggleLink
              href="/add/spread/pick?show=all"
              active={showAll}
              label="Show everything"
            />
          </div>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
            {suggestions.length} suggestion{suggestions.length === 1 ? "" : "s"} ·{" "}
            {IMPORTED_FILLS.length} fills
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 px-2 md:px-4 lg:grid-cols-[3fr_2fr] lg:px-6">
          {/* ── Suggestions pane (always rendered) ─────────────────────── */}
          <section aria-label="Suggested matches" className="flex flex-col gap-3">
            <header className="flex items-baseline justify-between">
              <h2 className="font-serif text-[15px] font-medium text-text">
                Suggested matches
              </h2>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
                <Sparkles className="mr-1 inline h-3 w-3 align-[-2px] text-signature" />
                Auto-detected
              </span>
            </header>

            {suggestions.length === 0 ? (
              <EmptyState />
            ) : (
              <ul className="flex flex-col gap-3">
                {suggestions.map((s) => (
                  <SuggestionCard key={s.id} suggestion={s} />
                ))}
              </ul>
            )}

            {showAll && (
              <details className="mt-4 rounded-md border border-border bg-surface p-4 text-[12px] text-text-tertiary">
                <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary">
                  How the matcher works
                </summary>
                <p className="mt-3 font-serif text-[13px] leading-snug italic">
                  Five rules run in parallel: cash-and-carry (spot + opposite
                  derivative across venues), cross-exchange (same-instrument
                  opposite-side across venues), funding capture (spot + short
                  perp on the same venue), calendar (two futures with different
                  expiries on the same venue), and DEX-CEX (one on-chain leg +
                  one centralised). Higher score = tighter qty match + closer
                  close-time alignment.
                </p>
              </details>
            )}
          </section>

          {/* ── Manual builder pane ────────────────────────────────────── */}
          <section
            aria-label="Build a spread manually"
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

function SuggestionCard({ suggestion }: { suggestion: MatcherSuggestion }) {
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
            {SPREAD_TYPE_LABELS[suggestion.spreadType]}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
            Score{" "}
            <span className="text-text">{suggestion.score.toFixed(1)}</span>
          </span>
        </header>

        <ul className="mt-3 divide-y divide-border-subtle">
          {suggestion.legs.map((leg) => (
            <li
              key={leg.id}
              className="flex items-center justify-between gap-3 py-2"
            >
              <div className="flex flex-col leading-tight">
                <span className="font-serif text-[13px] font-medium text-text">
                  {leg.symbol}
                </span>
                <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-text-tertiary">
                  {leg.exchange} · {leg.instrument}
                  {leg.expiry ? ` · ${leg.expiry}` : ""}
                </span>
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
            Use these legs
            <ArrowRight className="h-3 w-3" />
          </Link>
        </footer>
      </article>
    </li>
  );
}

function EmptyState() {
  return (
    <div className="rounded-md border border-dashed border-border bg-surface p-8 text-center">
      <p className="font-serif text-[14px] italic text-text-tertiary">
        No likely matches found in your imported fills.
      </p>
      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
        Build the spread by hand from the table on the right.
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
