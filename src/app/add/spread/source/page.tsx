import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardRadioCardLink } from "@/components/wizard/wizard-radio-card";
import { WizardNav } from "@/components/wizard/wizard-nav";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

// Spread wizard is 5 steps:
//   Source → Pick (or skip on manual) → Type → Fields → Review
// Labels are shared by every step.

export default async function SpreadSourcePage() {
  const t = await getT();
  const STEP_LABELS = [
    t("wizard.spread.stepLabels.source"),
    t("wizard.spread.stepLabels.pickLegs"),
    t("wizard.spread.stepLabels.type"),
    t("wizard.spread.stepLabels.fields"),
    t("wizard.spread.stepLabels.review"),
  ] as const;

  return (
    <WizardShell
      type="spread"
      step={1}
      totalSteps={5}
      stepLabels={STEP_LABELS}
      title={t("wizard.spread.source.title")}
      subtitle={t("wizard.spread.source.subtitle")}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <WizardRadioCardLink
          caption={t("wizard.spread.source.autoCaption")}
          title={t("wizard.spread.source.autoTitle")}
          description={t("wizard.spread.source.autoDescription")}
          href="/add/spread/pick"
          badge={t("wizard.spread.source.autoBadge")}
        />
        <WizardRadioCardLink
          caption={t("wizard.spread.source.manualCaption")}
          title={t("wizard.spread.source.manualTitle")}
          description={t("wizard.spread.source.manualDescription")}
          href="/add/spread/type"
        />
      </div>

      <WizardNav backHref="/add" />
    </WizardShell>
  );
}
