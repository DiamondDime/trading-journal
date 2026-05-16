import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardRadioCardLink } from "@/components/wizard/wizard-radio-card";
import { WizardNav } from "@/components/wizard/wizard-nav";

export const dynamic = "force-static";

// Spread wizard is 5 steps:
//   Source → Pick (or skip on manual) → Type → Fields → Review
// Labels are shared by every step.
const STEP_LABELS = ["Source", "Pick legs", "Type", "Fields", "Review"] as const;

export default function SpreadSourcePage() {
  return (
    <WizardShell
      type="spread"
      step={1}
      totalSteps={5}
      stepLabels={STEP_LABELS}
      title="Where are this spread's legs from?"
      subtitle="A spread is two or more positions paired together. Pick them out of your imported exchange fills, or build the legs manually."
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <WizardRadioCardLink
          caption="Auto"
          title="From connected exchanges"
          description="Browse your imported fills. The matcher will suggest likely pairings (cash-and-carry, cross-exchange, calendar) first."
          href="/add/spread/pick"
          badge="MATCHER"
        />
        <WizardRadioCardLink
          caption="Manual"
          title="Manual entry"
          description="Skip the picker. You'll pick the spread type, then enter every leg by hand. Good for venues we don't support yet."
          href="/add/spread/type"
        />
      </div>

      <WizardNav backHref="/add" />
    </WizardShell>
  );
}
