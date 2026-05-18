import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { WizardShell } from "@/components/wizard/wizard-shell";
import { cn } from "@/lib/utils";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

type Search = Promise<{ [key: string]: string | string[] | undefined }>;

function getStr(sp: Awaited<Search>, key: string, fallback = ""): string {
  const v = sp[key];
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string") return v[0];
  return fallback;
}

// Manual builder uses repeated `?legs=…&legs=…`; matcher uses a single
// `?legs=a,b`. Normalise both to a comma-joined string for downstream steps.
function parseLegsCsv(sp: Awaited<Search>): string {
  const v = sp.legs;
  const raw =
    typeof v === "string"
      ? [v]
      : Array.isArray(v)
        ? v.filter((x): x is string => typeof x === "string")
        : [];
  const ids = raw
    .flatMap((s) => s.split(","))
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(ids)].join(",");
}

interface TypeOption {
  value: string;
  title: string;
  description: string;
}

/**
 * Step 3 — Spread type picker.
 *
 * Pre-selects via `?spreadType=` when arriving from a matcher suggestion. The
 * form submits to /fields, which is where every leg gets named and the
 * spread metadata is filled in.
 */
export default async function SpreadTypePage(props: { searchParams: Search }) {
  const sp = await props.searchParams;
  const t = await getT();
  const legs = parseLegsCsv(sp);
  const matcher = getStr(sp, "matcher"); // "auto" | "manual" | ""
  const source = getStr(sp, "source");   // "manual" when coming from manual path
  const preSelected = getStr(sp, "spreadType");
  const editId = getStr(sp, "edit");

  const STEP_LABELS = [
    t("wizard.spread.stepLabels.source"),
    t("wizard.spread.stepLabels.pickLegs"),
    t("wizard.spread.stepLabels.type"),
    t("wizard.spread.stepLabels.fields"),
    t("wizard.spread.stepLabels.review"),
  ] as const;

  const SPREAD_TYPES: readonly TypeOption[] = [
    {
      value: "cash_carry",
      title: t("wizard.spread.type.options.cashCarry.title"),
      description: t("wizard.spread.type.options.cashCarry.description"),
    },
    {
      value: "funding",
      title: t("wizard.spread.type.options.funding.title"),
      description: t("wizard.spread.type.options.funding.description"),
    },
    {
      value: "cross_exchange",
      title: t("wizard.spread.type.options.crossExchange.title"),
      description: t("wizard.spread.type.options.crossExchange.description"),
    },
    {
      value: "calendar",
      title: t("wizard.spread.type.options.calendar.title"),
      description: t("wizard.spread.type.options.calendar.description"),
    },
    {
      value: "dex_cex",
      title: t("wizard.spread.type.options.dexCex.title"),
      description: t("wizard.spread.type.options.dexCex.description"),
    },
  ];

  // Back goes back to the picker (auto path), or the source step (manual path).
  const backHref =
    source === "manual" ? "/add/spread/source" : legs ? "/add/spread/pick" : "/add/spread/source";

  return (
    <WizardShell
      type="spread"
      step={3}
      totalSteps={5}
      stepLabels={STEP_LABELS}
      title={t("wizard.spread.type.title")}
      subtitle={
        preSelected
          ? t("wizard.spread.type.subtitlePreSelected")
          : t("wizard.spread.type.subtitleDefault")
      }
    >
      <form
        id="spread-type-form"
        action="/add/spread/fields"
        method="get"
        className="flex flex-col gap-7"
      >
        {/* Pass-through state from the picker / source step. */}
        {legs && <input type="hidden" name="legs" value={legs} />}
        {matcher && <input type="hidden" name="matcher" value={matcher} />}
        {source && <input type="hidden" name="source" value={source} />}
        {editId && <input type="hidden" name="edit" value={editId} />}

        <fieldset className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <legend className="sr-only">{t("wizard.spread.type.legend")}</legend>
          {SPREAD_TYPES.map((opt) => (
            <label
              key={opt.value}
              className={cn(
                "group flex cursor-pointer flex-col gap-2 rounded-md border border-border bg-surface p-5 transition-all",
                "hover:border-border-strong hover:bg-subtle",
                "has-[input:checked]:border-text has-[input:checked]:bg-subtle",
              )}
            >
              <input
                type="radio"
                name="spreadType"
                value={opt.value}
                defaultChecked={preSelected === opt.value}
                required
                className="sr-only"
              />
              <h3 className="font-serif text-[16px] font-medium leading-tight text-text">
                {opt.title}
              </h3>
              <p className="font-serif text-[13px] italic leading-snug text-text-secondary">
                {opt.description}
              </p>
            </label>
          ))}
        </fieldset>

        <div className="flex items-center justify-between border-t border-border pt-6">
          <Link
            href={backHref}
            className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-text-tertiary transition-colors hover:text-text"
          >
            <ArrowLeft className="h-3 w-3" />
            {t("wizard.spread.type.back")}
          </Link>
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-md border border-text bg-text px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-app transition-colors hover:bg-text-secondary"
          >
            {t("wizard.spread.type.continue")}
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </form>
    </WizardShell>
  );
}
