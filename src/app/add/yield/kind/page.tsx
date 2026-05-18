import Link from "next/link";
import { ArrowLeft, ArrowRight, Lock, Banknote, Sprout, Droplets, Server, Cpu } from "lucide-react";
import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardRadioRow } from "@/components/wizard/wizard-radio-row";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

type Search = Promise<{ [k: string]: string | string[] | undefined }>;

function getStr(sp: Awaited<Search>, key: string, fallback = ""): string {
  const v = sp[key];
  return typeof v === "string" ? v : fallback;
}

/**
 * Step 2/4 — Kind picker.
 *
 * Six radio cards (stake / lend / farm / lp / validator / mining) backed
 * by `WizardRadioRow` so the visual treatment matches the rest of the
 * journal's pickers. The chosen value is forwarded to /fields as a query
 * param; /fields then branches its UI off of `kind`.
 *
 * No client JS: the form action is a GET to /fields, so the radio
 * selection round-trips through the URL like every other wizard step.
 */
export default async function YieldKindPage(props: { searchParams: Search }) {
  const t = await getT();
  const sp = await props.searchParams;
  const source = getStr(sp, "source", "manual");
  const defaultKind = getStr(sp, "kind", "stake");

  const STEP_LABELS = [
    t("wizard.yield.stepLabels.source"),
    t("wizard.yield.stepLabels.kind"),
    t("wizard.yield.stepLabels.fields"),
    t("wizard.yield.stepLabels.review"),
  ] as const;

  return (
    <WizardShell
      type="yield_position"
      step={2}
      totalSteps={4}
      stepLabels={STEP_LABELS}
      title="What kind of yield?"
      subtitle="Each kind unlocks the right fields on the next step. Pick the one that matches your position — you can edit later."
    >
      <form
        id="yield-kind-form"
        action="/add/yield/fields"
        method="get"
        className="flex flex-col gap-7"
      >
        <input type="hidden" name="source" value={source} />

        <WizardRadioRow
          name="kind"
          defaultValue={defaultKind}
          required
          variant="cards"
          legend="Yield kind"
          requiredCue="· required"
          options={[
            {
              value: "stake",
              title: t("wizard.yield.kinds.stake.title"),
              description: t("wizard.yield.kinds.stake.description"),
              icon: <Lock className="h-3.5 w-3.5 text-text-tertiary" />,
            },
            {
              value: "lend",
              title: t("wizard.yield.kinds.lend.title"),
              description: t("wizard.yield.kinds.lend.description"),
              icon: <Banknote className="h-3.5 w-3.5 text-text-tertiary" />,
            },
            {
              value: "farm",
              title: t("wizard.yield.kinds.farm.title"),
              description: t("wizard.yield.kinds.farm.description"),
              icon: <Sprout className="h-3.5 w-3.5 text-text-tertiary" />,
            },
            {
              value: "lp",
              title: t("wizard.yield.kinds.lp.title"),
              description: t("wizard.yield.kinds.lp.description"),
              icon: <Droplets className="h-3.5 w-3.5 text-text-tertiary" />,
            },
            {
              value: "validator",
              title: t("wizard.yield.kinds.validator.title"),
              description: t("wizard.yield.kinds.validator.description"),
              icon: <Server className="h-3.5 w-3.5 text-text-tertiary" />,
            },
            {
              value: "mining",
              title: t("wizard.yield.kinds.mining.title"),
              description: t("wizard.yield.kinds.mining.description"),
              icon: <Cpu className="h-3.5 w-3.5 text-text-tertiary" />,
            },
          ]}
        />

        <div className="mt-6 flex items-center justify-between border-t border-border pt-6">
          <Link
            href="/add/yield/source"
            className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-text-tertiary transition-colors hover:text-text"
          >
            <ArrowLeft className="h-3 w-3" />
            Back
          </Link>
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-md border border-text bg-text px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-app transition-colors hover:bg-text-secondary"
          >
            Continue
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </form>
    </WizardShell>
  );
}
