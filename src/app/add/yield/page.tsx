import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardRadioCardLink } from "@/components/wizard/wizard-radio-card";
import { WizardNav } from "@/components/wizard/wizard-nav";
import { getT } from "@/lib/i18n/server";

// getT() reads the `csj-locale` cookie which is per-request; in addition this
// page's contents depend on no searchParams/cookies but Next 16's static
// optimizer can still hoist it — `force-dynamic` keeps the rendering pipeline
// consistent with the rest of the wizard for the audit clarity.
export const dynamic = "force-dynamic";

/**
 * Yield wizard landing / explainer.
 *
 * The other wizards branch at /source (auto vs manual); yield additionally
 * gets a one-screen explainer above the source picker because the kind
 * vocabulary (stake / lend / farm / lp / validator / mining) is broader
 * than the trader has seen elsewhere in the journal. The explainer copy
 * sets expectations about which kinds support live yield import (none, in
 * v5) before the trader commits to filling out a form.
 *
 * No form state — purely navigational. Two link cards: continue to the
 * source picker, or return to the add chooser.
 */
export default async function YieldLandingPage() {
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
      title={t("wizard.yield.title")}
      subtitle="Stake, lend, farm, LP, validator, mining. Track principal, expected and realized APY, reward claims, and lockup windows in one place."
    >
      {/* ── Quick explainer of the six kinds ─────────────────────────────── */}
      <section className="rounded-md border border-border bg-surface p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
          What this wizard covers
        </p>
        <ul className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <KindExplainer
            term="Staking"
            detail="Single-asset network bond. ETH, SOL, ATOM."
          />
          <KindExplainer
            term="Lending"
            detail="Money-market deposit. Variable or fixed rate."
          />
          <KindExplainer
            term="Yield farming"
            detail="Two-token pair earning protocol rewards."
          />
          <KindExplainer
            term="Liquidity provision"
            detail="AMM pool earning swap fees. Concentrated or full-range."
          />
          <KindExplainer
            term="Validator"
            detail="Your own node. Commission, uptime, delegations."
          />
          <KindExplainer
            term="Mining"
            detail="PoW position. Hashrate, electricity, pool revenue."
          />
        </ul>
      </section>

      {/* ── Entry points ─────────────────────────────────────────────────── */}
      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
        <WizardRadioCardLink
          caption="Start"
          title="Pick a yield kind"
          description="Continue to the source-picker, then the kind list. Manual entry works for any protocol — CEX Earn, validators, miners, anything on-chain."
          href="/add/yield/source"
          badge="MANUAL"
        />
        <WizardRadioCardLink
          caption="Back"
          title="Change activity type"
          description="Wrong choice? Return to the activity chooser and pick spread, trade, sale, airdrop, or option instead."
          href="/add"
        />
      </div>

      <WizardNav backHref="/add" />
    </WizardShell>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function KindExplainer({ term, detail }: { term: string; detail: string }) {
  return (
    <li className="flex items-baseline gap-2.5">
      <span className="font-serif text-[14px] font-medium leading-tight text-text">
        {term}
      </span>
      <span className="font-serif text-[13px] italic leading-snug text-text-tertiary">
        — {detail}
      </span>
    </li>
  );
}
