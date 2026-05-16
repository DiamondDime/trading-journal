import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardRadioCardLink } from "@/components/wizard/wizard-radio-card";

export const dynamic = "force-static";

const OPTIONS: {
  caption: string;
  title: string;
  description: string;
  href: string;
  badge?: string;
}[] = [
  {
    caption: "Multi-leg",
    title: "Spread",
    description:
      "A multi-leg, multi-venue position — your bread and butter. Cash-and-carry, calendar, funding capture, cross-exchange, DEX-CEX.",
    href: "/add/spread/source",
    badge: "AUTO + MANUAL",
  },
  {
    caption: "Single venue",
    title: "Trade",
    description:
      "A single open-then-close position on one venue. Perp, spot, or future. The simplest journal entry.",
    href: "/add/trade/source",
    badge: "AUTO + MANUAL",
  },
  {
    caption: "Allocation",
    title: "Sale",
    description:
      "A token allocation from an IDO, launchpad, premarket, or OTC desk. Track vesting and claims over time.",
    href: "/add/sale/fields",
    badge: "MANUAL",
  },
  {
    caption: "Receipt",
    title: "Airdrop",
    description:
      "Tokens received from a retro, loyalty, or criteria-based drop. Zero cost basis, full mark-to-market.",
    href: "/add/airdrop/fields",
    badge: "MANUAL",
  },
];

export default function AddIndexPage() {
  return (
    <WizardShell
      title="What did you just do?"
      subtitle="Pick the kind of activity you want to log. Each type has its own template designed for that shape of trade."
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {OPTIONS.map((opt) => (
          <WizardRadioCardLink key={opt.title} {...opt} />
        ))}
      </div>

      <p className="mt-12 font-serif text-sm italic text-text-tertiary">
        Don&apos;t see what you traded? More types come later — staking, lending,
        LP, NFT, OTC are on the roadmap. For now, log it as the closest match
        and add a note.
      </p>
    </WizardShell>
  );
}
