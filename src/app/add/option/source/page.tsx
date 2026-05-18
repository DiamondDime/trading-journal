import { Lock } from "lucide-react";
import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardRadioCardLink } from "@/components/wizard/wizard-radio-card";
import { WizardNav } from "@/components/wizard/wizard-nav";
import { getT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Option wizard step 1 — Source.
 *
 * In v1, auto-import is disabled and rendered as a "soon" placeholder card.
 * Manual entry is the only path forward. Step labels match the master
 * plan's 5-step flow: source → kind → legs → fields → review.
 */
export default async function OptionSourcePage() {
  const t = await getT();
  const STEP_LABELS = [
    t("wizard.option.stepLabels.source"),
    t("wizard.option.stepLabels.kind"),
    t("wizard.option.stepLabels.legs"),
    t("wizard.option.stepLabels.fields"),
    t("wizard.option.stepLabels.review"),
  ] as const;

  return (
    <WizardShell
      type="option"
      step={1}
      totalSteps={5}
      stepLabels={STEP_LABELS}
      title={t("wizard.option.source.title")}
      subtitle={t("wizard.option.source.subtitle")}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Auto-import: disabled v1 placeholder. */}
        <DisabledAutoCard
          caption={t("wizard.option.stepLabels.source")}
          title={t("wizard.option.source.autoTitle")}
          description={t("wizard.option.source.autoDescription")}
          badge="SOON · DERIBIT / BINANCE / OKX"
        />
        <WizardRadioCardLink
          caption={t("wizard.option.stepLabels.source")}
          title={t("wizard.option.source.manualTitle")}
          description={t("wizard.option.source.manualDescription")}
          href="/add/option/kind"
        />
      </div>

      <WizardNav backHref="/add" />
    </WizardShell>
  );
}

/**
 * Same visual shape as WizardRadioCardLink but rendered as a non-link
 * placeholder. Communicates that the option auto-import path isn't wired
 * yet without removing the affordance from the layout.
 */
function DisabledAutoCard({
  caption,
  title,
  description,
  badge,
}: {
  caption: string;
  title: string;
  description: string;
  badge: string;
}) {
  return (
    <div
      aria-disabled
      className={cn(
        "group flex cursor-not-allowed flex-col gap-3 rounded-md border border-dashed border-border bg-surface p-6 opacity-70",
      )}
    >
      <div className="flex items-start justify-between">
        <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-text-tertiary">
          {caption}
        </p>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-text-tertiary">
            {badge}
          </span>
          <Lock className="h-3.5 w-3.5 text-text-tertiary" />
        </div>
      </div>
      <h2 className="font-serif text-[22px] font-medium leading-tight text-text-secondary">
        {title}
      </h2>
      <p className="font-serif text-[14px] italic leading-snug text-text-tertiary">
        {description}
      </p>
    </div>
  );
}

