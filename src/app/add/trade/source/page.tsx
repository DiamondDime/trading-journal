import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardRadioCardLink } from "@/components/wizard/wizard-radio-card";
import { WizardNav } from "@/components/wizard/wizard-nav";
import { getT } from "@/lib/i18n/server";

// Force-dynamic on every step that reads searchParams (or that lives below a
// query-driven step). Without this, Next.js 16's default static prerender will
// freeze stale URL-state into the page.
export const dynamic = "force-dynamic";

/**
 * Step 1 of the 5-step trade wizard: pick source.
 *   1. Source (this step)
 *   2. Kind         — spot / perp / dated_future / option / otc / nft
 *   3. Pick fill    — auto branch only; manual/otc/nft skip straight to 4
 *   4. Details
 *   5. Review
 *
 * Both source options funnel through /kind. The auto branch then proceeds to
 * /pick to select from real open positions; manual / otc / nft skip /pick.
 */
export default async function TradeSourcePage() {
  const t = await getT();
  const STEP_LABELS = [
    t("wizard.trade.stepLabels.source"),
    t("wizard.trade.stepLabels.kind"),
    t("wizard.trade.stepLabels.pick"),
    t("wizard.trade.stepLabels.details"),
    t("wizard.trade.stepLabels.review"),
  ] as const;

  return (
    <WizardShell
      type="trade"
      step={1}
      totalSteps={5}
      stepLabels={STEP_LABELS}
      title={t("wizard.trade.source.title")}
      subtitle={t("wizard.trade.source.subtitle")}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <WizardRadioCardLink
          caption={t("wizard.trade.source.auto.caption")}
          title={t("wizard.trade.source.auto.title")}
          description={t("wizard.trade.source.auto.description")}
          href="/add/trade/kind?source=auto"
        />
        <WizardRadioCardLink
          caption={t("wizard.trade.source.manual.caption")}
          title={t("wizard.trade.source.manual.title")}
          description={t("wizard.trade.source.manual.description")}
          href="/add/trade/kind?source=manual"
        />
      </div>

      <WizardNav backHref="/add" />
    </WizardShell>
  );
}
