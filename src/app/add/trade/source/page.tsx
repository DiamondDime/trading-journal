import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardRadioCardLink } from "@/components/wizard/wizard-radio-card";
import { WizardNav } from "@/components/wizard/wizard-nav";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function TradeSourcePage() {
  const t = await getT();
  const STEP_LABELS = [
    t("wizard.trade.stepLabels.source"),
    t("wizard.trade.stepLabels.pick"),
    t("wizard.trade.stepLabels.details"),
    t("wizard.trade.stepLabels.review"),
  ] as const;

  return (
    <WizardShell
      type="trade"
      step={1}
      totalSteps={4}
      stepLabels={STEP_LABELS}
      title={t("wizard.trade.source.title")}
      subtitle={t("wizard.trade.source.subtitle")}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <WizardRadioCardLink
          caption={t("wizard.trade.source.auto.caption")}
          title={t("wizard.trade.source.auto.title")}
          description={t("wizard.trade.source.auto.description")}
          href="/add/trade/pick"
        />
        <WizardRadioCardLink
          caption={t("wizard.trade.source.manual.caption")}
          title={t("wizard.trade.source.manual.title")}
          description={t("wizard.trade.source.manual.description")}
          href="/add/trade/fields"
        />
      </div>

      <WizardNav backHref="/add" />
    </WizardShell>
  );
}
