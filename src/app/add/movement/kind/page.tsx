import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardRadioRow } from "@/components/wizard/wizard-radio-row";
import { getT } from "@/lib/i18n/server";

// Step pages that read searchParams must be dynamic, otherwise Next 16
// statically prerenders them and the back-nav state is lost.
export const dynamic = "force-dynamic";

type Search = Promise<{ [key: string]: string | string[] | undefined }>;

function getStr(sp: Awaited<Search>, key: string, fallback = ""): string {
  const v = sp[key];
  if (typeof v === "string") return v;
  return fallback;
}

/**
 * Movement wizard step 1 — pick the event kind. The eight kinds match
 * `movement_event_kind` exactly. Each kind drives the subset of fields
 * the next step asks for (e.g. `transfer` shows from/to; `loss` hides
 * destination).
 */
export default async function MovementKindPage(props: { searchParams: Search }) {
  const t = await getT();
  const sp = await props.searchParams;
  const STEP_LABELS = [
    t("wizard.movement.stepLabels.kind"),
    t("wizard.movement.stepLabels.fields"),
    t("wizard.movement.stepLabels.review"),
  ] as const;

  const defaultKind = getStr(sp, "kind");

  // i18n keys for each kind. Keep this aligned with movement_event_kind.
  const KINDS = [
    { value: "bridge",     i18n: "bridge" },
    { value: "convert",    i18n: "convert" },
    { value: "transfer",   i18n: "transfer" },
    { value: "deposit",    i18n: "deposit" },
    { value: "withdrawal", i18n: "withdrawal" },
    { value: "nft_trade",  i18n: "nftTrade" },
    { value: "loss",       i18n: "loss" },
    { value: "other",      i18n: "other" },
  ] as const;

  return (
    <WizardShell
      type="movement"
      step={1}
      totalSteps={3}
      stepLabels={STEP_LABELS}
      title={t("wizard.movement.kind.title")}
      subtitle={t("wizard.movement.kind.subtitle")}
    >
      <form
        id="movement-kind-form"
        action="/add/movement/fields"
        method="get"
        className="flex flex-col gap-7"
      >
        <WizardRadioRow
          name="kind"
          defaultValue={defaultKind}
          required
          legend={t("wizard.movement.kind.legend")}
          requiredCue={t("wizard.movement.kind.requiredCue")}
          variant="cards"
          options={KINDS.map((k) => ({
            value:       k.value,
            title:       t(`wizard.movement.kinds.${k.i18n}.title` as const),
            description: t(`wizard.movement.kinds.${k.i18n}.description` as const),
          }))}
        />

        <div className="mt-2 flex items-center justify-between border-t border-border pt-6">
          <Link
            href="/add"
            className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-text-tertiary transition-colors hover:text-text"
          >
            <ArrowLeft className="h-3 w-3" />
            {t("common.back")}
          </Link>
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-md border border-text bg-text px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-app transition-colors hover:bg-text-secondary"
          >
            {t("common.next")}
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </form>
    </WizardShell>
  );
}
