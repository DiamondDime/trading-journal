import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardRadioCardLink } from "@/components/wizard/wizard-radio-card";
import { WizardNav } from "@/components/wizard/wizard-nav";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

/**
 * Step 1/4 — Source: auto vs manual.
 *
 * "auto" is intentionally disabled in v5. Binance Earn / Bybit Earn /
 * Kraken Stake adapters live in the worker backlog (Wave 3a) and the
 * trader sees the "soon" badge so they don't pick a path that goes
 * nowhere. The disabled card still renders to set expectations — the
 * absolute-journal principle is "every option is reachable", but disabled
 * options also have to be visible-and-labelled for that contract to hold.
 *
 * "manual" is the only live option — it forwards to /kind where the
 * trader picks one of the six yield kinds.
 */
export default async function YieldSourcePage() {
  const t = await getT();
  const STEP_LABELS = [
    t("wizard.yield.stepLabels.source"),
    t("wizard.yield.stepLabels.kind"),
    t("wizard.yield.stepLabels.fields"),
    t("wizard.yield.stepLabels.review"),
  ] as const;

  return (
    <WizardShell
      type="yield_position"
      step={1}
      totalSteps={4}
      stepLabels={STEP_LABELS}
      title={t("wizard.yield.source.title")}
      subtitle={t("wizard.yield.source.subtitle")}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Auto path — visually present, behaviourally inert. The card
            still hovers/clicks but lands on the same /kind step so the
            trader gets a meaningful path forward; the badge sets the
            expectation that auto-pull isn't wired yet. */}
        <WizardRadioCardLink
          caption={t("wizard.yield.source.autoTitle")}
          title="Connect a protocol"
          description="Soon: Binance Earn, Bybit Earn, Kraken Stake. Pre-fills protocol, wallet, amount, and expected APY. Coming once the connector pipeline lands."
          href="/add/yield/kind?source=auto"
          badge="SOON"
        />
        <WizardRadioCardLink
          caption={t("wizard.yield.source.manualTitle")}
          title={t("wizard.yield.source.manualTitle")}
          description={t("wizard.yield.source.manualDescription")}
          href="/add/yield/kind?source=manual"
          badge="MANUAL"
        />
      </div>

      <WizardNav backHref="/add/yield" />
    </WizardShell>
  );
}
