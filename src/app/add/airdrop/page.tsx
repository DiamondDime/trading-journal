import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardRadioCardLink } from "@/components/wizard/wizard-radio-card";
import { getT } from "@/lib/i18n/server";

// Reads the csj-locale cookie via getT() — server cookies make this page
// non-cacheable. force-dynamic keeps the per-request branch visible.
export const dynamic = "force-dynamic";

/**
 * Airdrop wizard intro / status-branch step.
 *
 * Two manual entry points + one wallet-paste shortcut:
 *  1. "Track without claiming yet" (status=pending) — watchlist entry
 *  2. "Log a claim" (status=claimed) — full claim flow
 *  3. "Fetch from wallet" — wallet-paste auto-import flow (v1 stub)
 *
 * Carries the chosen status through the URL so /fields renders the right
 * required-vs-optional fields without a hydration hop.
 */
export default async function AirdropIntroPage() {
  const t = await getT();

  const STEP_LABELS = [
    t("wizard.airdrop.intro.stepLabels.intent"),
    t("wizard.airdrop.intro.stepLabels.details"),
    t("wizard.airdrop.intro.stepLabels.review"),
  ] as const;

  const OPTIONS = [
    {
      caption: t("wizard.airdrop.intro.options.pending.caption"),
      title: t("wizard.airdrop.intro.options.pending.title"),
      description: t("wizard.airdrop.intro.options.pending.description"),
      href: "/add/airdrop/fields?status=pending",
      badge: t("wizard.airdrop.intro.options.pending.badge"),
    },
    {
      caption: t("wizard.airdrop.intro.options.claimed.caption"),
      title: t("wizard.airdrop.intro.options.claimed.title"),
      description: t("wizard.airdrop.intro.options.claimed.description"),
      href: "/add/airdrop/fields?status=claimed",
      badge: t("wizard.airdrop.intro.options.claimed.badge"),
    },
    {
      caption: t("wizard.airdrop.intro.options.wallet.caption"),
      title: t("wizard.airdrop.intro.options.wallet.title"),
      description: t("wizard.airdrop.intro.options.wallet.description"),
      href: "/add/airdrop/wallet",
      badge: t("wizard.airdrop.intro.options.wallet.badge"),
    },
  ];

  return (
    <WizardShell
      type="airdrop"
      step={1}
      totalSteps={3}
      stepLabels={STEP_LABELS}
      title={t("wizard.airdrop.intro.title")}
      subtitle={t("wizard.airdrop.intro.subtitle")}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {OPTIONS.map((opt) => (
          <WizardRadioCardLink key={opt.title} {...opt} />
        ))}
      </div>

      <p className="mt-12 font-serif text-sm italic text-text-tertiary">
        {t("wizard.airdrop.intro.footnote")}
      </p>
    </WizardShell>
  );
}
