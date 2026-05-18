import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardRadioRow } from "@/components/wizard/wizard-radio-row";
import { WizardNav } from "@/components/wizard/wizard-nav";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

type Search = Promise<{ [key: string]: string | string[] | undefined }>;

function getStr(sp: Awaited<Search>, key: string, fallback = ""): string {
  const v = sp[key];
  if (typeof v === "string") return v;
  return fallback;
}

/**
 * Option wizard step 2 — Kind.
 *
 * Single-leg vs option_spread. The form POSTs to /add/option/legs via a GET
 * submission so the subtype rides through searchParams. /legs renders the
 * leg list with N = 1 (single_leg) or N = 2 (option_spread starting count).
 */
export default async function OptionKindPage(props: { searchParams: Search }) {
  const t = await getT();
  const STEP_LABELS = [
    t("wizard.option.stepLabels.kind"),
    t("wizard.option.stepLabels.legs"),
    t("wizard.option.stepLabels.fields"),
    t("wizard.option.stepLabels.review"),
  ] as const;

  const sp = await props.searchParams;
  const subtype = getStr(sp, "subtype", "single_leg");
  const editId = getStr(sp, "edit");

  return (
    <WizardShell
      type="option"
      step={1}
      totalSteps={4}
      stepLabels={STEP_LABELS}
      title={t("wizard.option.kind.title")}
      subtitle={t("wizard.option.kind.subtitle")}
    >
      <form
        id="option-kind-form"
        action="/add/option/legs"
        method="get"
        className="flex flex-col gap-7"
      >
        {editId && <input type="hidden" name="edit" value={editId} />}
        <WizardRadioRow
          name="subtype"
          legend={t("wizard.option.kind.legend")}
          requiredCue={t("wizard.option.required")}
          required
          defaultValue={subtype}
          variant="cards"
          options={[
            {
              value: "single_leg",
              title: t("wizard.option.kinds.singleLeg.title"),
              description: t("wizard.option.kinds.singleLeg.description"),
            },
            {
              value: "option_spread",
              title: t("wizard.option.kinds.optionSpread.title"),
              description: t("wizard.option.kinds.optionSpread.description"),
            },
          ]}
        />
        <WizardNav
          backHref="/add"
          continueFormId="option-kind-form"
        />
      </form>
    </WizardShell>
  );
}
