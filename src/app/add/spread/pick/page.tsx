import Link from "next/link";
import { Sparkles } from "lucide-react";
import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardNav } from "@/components/wizard/wizard-nav";
import { cn } from "@/lib/utils";
import { getT } from "@/lib/i18n/server";
import { requireUser } from "@/lib/auth/server";
import { listPickerOptions, type PickerOptionRow } from "../db";
import { ManualBuilder } from "./manual-builder";
import { SuggestionList, type SuggestionGroup } from "./suggestion-list";

export const dynamic = "force-dynamic";

// Max suggestions to surface on the page. Keeps the panel scannable; the
// production matcher will rank with calibrated confidence and we'll widen this
// once we trust the score.
const MAX_SUGGESTIONS = 6;

type Search = Promise<{ [key: string]: string | string[] | undefined }>;

/**
 * Group candidate legs back into their parent spread_candidates row. Each row
 * carries an id of the form `cand:<candidateId>:<positionId>` — splitting on
 * `:` lets us re-aggregate.
 */
function groupCandidates(rows: PickerOptionRow[]): SuggestionGroup[] {
  const map = new Map<string, SuggestionGroup>();
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

            <SuggestionList suggestions={suggestions} />

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
