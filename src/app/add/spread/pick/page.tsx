import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardNav } from "@/components/wizard/wizard-nav";
import { cn } from "@/lib/utils";
import { getT } from "@/lib/i18n/server";
import type { TFunction } from "@/lib/i18n/resolve";
import { requireUser } from "@/lib/auth/server";
import { listPickerOptions, type PickerOptionRow } from "../db";
import { ManualBuilder } from "./manual-builder";
import { ExchangeChip } from "@/components/settings/exchange-logo";

export const dynamic = "force-dynamic";

// Max suggestions to surface on the page. Keeps the panel scannable; the
// production matcher will rank with calibrated confidence and we'll widen this
// once we trust the score.
const MAX_SUGGESTIONS = 6;

type Search = Promise<{ [key: string]: string | string[] | undefined }>;

interface CandidateGroup {
  candidateId: string;
  suggestedType: string;
  confidence: number;
  legs: PickerOptionRow[];
}

/**
 * Group candidate legs back into their parent spread_candidates row. Each row
 * carries an id of the form `cand:<candidateId>:<positionId>` — splitting on
 * `:` lets us re-aggregate.
 */
function groupCandidates(rows: PickerOptionRow[]): CandidateGroup[] {
  const map = new Map<string, CandidateGroup>();
  for (const r of rows) {
    if (r.source !== "candidate") continue;
    const parts = r.id.split(":");
    if (parts.length < 3) continue;
    const candidateId = parts[1];
    const existing = map.get(candidateId);
    if (existing) {
      existing.legs.push(r);
    } else {
      map.set(candidateId, {
        candidateId,
        suggestedType: r.suggestedType ?? "custom",
        confidence: r.matchConfidence ?? 0,
        legs: [r],
      });
    }
  }
  return [...map.values()]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_SUGGESTIONS);
}

function fmtPrice(n: string | number) {
  const v = typeof n === "string" ? Number.parseFloat(n) : n;
  if (!Number.isFinite(v)) return String(n);
  if (v < 1) return v.toLocaleString("en-US", { maximumSignificantDigits: 4 });
  return v.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtQty(n: string | number) {
  const v = typeof n === "string" ? Number.parseFloat(n) : n;
  if (!Number.isFinite(v)) return String(n);
  if (v >= 1_000_000) return v.toExponential(2);
  if (v >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (v < 1) return v.toLocaleString("en-US", { maximumSignificantDigits: 4 });
  return v.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function closedLabel(closedAt: string | null, status: string): string {
  if (status === "open") return "open";
  if (!closedAt) return "—";
  const d = new Date(closedAt);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default async function SpreadPickPage(props: { searchParams: Search }) {
  const sp = await props.searchParams;
  const showAll = typeof sp.show === "string" && sp.show === "all";
  const t = await getT();

  const { id: userId } = await requireUser();
  const { candidateLegs, openPositions } = await listPickerOptions(userId);
  const suggestions = groupCandidates(candidateLegs);
  const totalRows = candidateLegs.length + openPositions.length;

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
            {t.plural("wizard.spread.pick.fillsCount", totalRows)}
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
                  <SuggestionCard key={s.candidateId} suggestion={s} t={t} />
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
            <ManualBuilder rows={openPositions} />
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
  suggestion: CandidateGroup;
  t: TFunction;
}) {
  const legIds = suggestion.legs.map((l) => l.positionId).join(",");
  // Map DB spread_type → matcher key the wizard URL expects.
  const DB_TO_MATCHER: Record<string, string> = {
    cash_carry: "cash_carry",
    funding_capture: "funding",
    cross_exchange_perp_arb: "cross_exchange",
    calendar: "calendar",
    dex_cex_arb: "dex_cex",
  };
  const matcherKey = DB_TO_MATCHER[suggestion.suggestedType] ?? "cash_carry";
  const params = new URLSearchParams({
    legs: legIds,
    spreadType: matcherKey,
    matcher: "auto",
  });
  const href = `/add/spread/type?${params.toString()}`;
  return (
    <li>
      <article className="group rounded-md border border-border bg-surface p-4 transition-colors hover:border-border-strong">
        <header className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-subtle px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary">
            {localizedSpreadTypeLabel(matcherKey, t)}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
            {t("wizard.spread.pick.score")}{" "}
            <span className="text-text">{suggestion.confidence.toFixed(2)}</span>
          </span>
        </header>

        <ul className="mt-3 divide-y divide-border-subtle">
          {suggestion.legs.map((leg) => (
            <li
              key={leg.positionId}
              className="flex items-center justify-between gap-3 py-2"
            >
              <div className="flex items-center gap-2 leading-tight">
                <ExchangeChip
                  venue={leg.exchangeCode}
                  size="sm"
                  className="shrink-0"
                />
                <div className="flex flex-col">
                  <span className="font-serif text-[13px] font-medium text-text">
                    {leg.symbol}
                  </span>
                  <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-text-tertiary">
                    {leg.exchangeCode} · {leg.instrumentKind}
                  </span>
                </div>
              </div>
              <div className="flex items-baseline gap-3">
                <span
                  className={cn(
                    "font-mono text-[10px] uppercase tracking-[0.14em]",
                    leg.side === "long" ? "text-up" : "text-down",
                  )}
                >
                  {leg.side}
                </span>
                <span className="font-mono text-[11px] tabular-nums text-text-secondary">
                  {fmtQty(leg.qty)}
                </span>
                <span className="font-mono text-[11px] tabular-nums text-text">
                  {fmtPrice(leg.avgEntryPrice)}
                </span>
                {leg.avgExitPrice && (
                  <>
                    <span className="text-text-tertiary">→</span>
                    <span className="font-mono text-[11px] tabular-nums text-text-secondary">
                      {fmtPrice(leg.avgExitPrice)}
                    </span>
                  </>
                )}
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
                  {closedLabel(leg.closedAt, leg.status)}
                </span>
              </div>
            </li>
          ))}
        </ul>

        <footer className="mt-3 flex items-end justify-between gap-3">
          <p className="max-w-[42ch] font-serif text-[12px] italic leading-snug text-text-tertiary">
            {t("wizard.spread.pick.matcherRationale", {
              confidence: (suggestion.confidence * 100).toFixed(0),
            })}
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

/** Localised label for a matcher spread type. */
function localizedSpreadTypeLabel(spreadType: string, t: TFunction): string {
  if (
    spreadType === "cash_carry" ||
    spreadType === "funding" ||
    spreadType === "cross_exchange" ||
    spreadType === "calendar" ||
    spreadType === "dex_cex"
  ) {
    return t(`wizard.shell.spreadTypeLabels.${spreadType}` as const);
  }
  return spreadType;
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
        active ? "bg-subtle text-text" : "text-text-tertiary hover:text-text",
      )}
    >
      {label}
    </Link>
  );
}
