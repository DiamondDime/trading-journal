import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardRadioCardLink } from "@/components/wizard/wizard-radio-card";
import { WizardNav } from "@/components/wizard/wizard-nav";

export const dynamic = "force-static";

const STEP_LABELS = ["Source", "Pick", "Details", "Review"] as const;

export default function TradeSourcePage() {
  return (
    <WizardShell
      type="trade"
      step={1}
      totalSteps={4}
      stepLabels={STEP_LABELS}
      title="Where's this trade from?"
      subtitle="Pick how you want to populate the form. Either path lands you on the same fields, just with more or less prefilled for you."
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <WizardRadioCardLink
          caption="Auto"
          title="From a connected exchange"
          description="Pick from your imported fills. Pre-fills exchange, symbol, side, entry, exit, qty, fees, and dates."
          href="/add/trade/pick"
        />
        <WizardRadioCardLink
          caption="Manual"
          title="Manual entry"
          description="Type in the details yourself. Use this for trades from exchanges we don't support yet, or anything that isn't in your synced fills."
          href="/add/trade/fields"
        />
      </div>

      <WizardNav backHref="/add" />
    </WizardShell>
  );
}
