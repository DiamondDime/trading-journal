import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { WizardShell } from "@/components/wizard/wizard-shell";
import { cn } from "@/lib/utils";

const STEP_LABELS = ["Source", "Pick legs", "Type", "Fields", "Review"] as const;

type Search = Promise<{ [key: string]: string | string[] | undefined }>;

function getStr(
  sp: Awaited<Search>,
  key: string,
  fallback = ""
): string {
  const v = sp[key];
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string") return v[0];
  return fallback;
}

// Manual builder uses repeated `?legs=…&legs=…`; matcher uses a single
// `?legs=a,b`. Normalise both to a comma-joined string for downstream steps.
function parseLegsCsv(sp: Awaited<Search>): string {
  const v = sp.legs;
  const raw = typeof v === "string"
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

const SPREAD_TYPES: readonly TypeOption[] = [
  {
    value: "cash_carry",
    title: "Cash-and-carry",
    description:
      "Long spot + short derivative on the same asset. Captures basis or funding while staying market-neutral.",
  },
  {
    value: "funding",
    title: "Funding capture",
    description:
      "Spot leg + short perp on the same venue. Pure funding yield with no basis drift.",
  },
  {
    value: "cross_exchange",
    title: "Cross-exchange",
    description:
      "Same instrument, opposite sides on two venues. Captures price dislocations between exchanges.",
  },
  {
    value: "calendar",
    title: "Calendar",
    description:
      "Two futures with different expiries on the same venue. Trade the term structure.",
  },
  {
    value: "dex_cex",
    title: "DEX-CEX",
    description:
      "One on-chain leg, one centralised. Captures liquidity-fragmentation premia at the cost of gas + slippage.",
  },
];

/**
 * Step 3 — Spread type picker.
 *
 * Pre-selects via `?spreadType=` when arriving from a matcher suggestion. The
 * form submits to /fields, which is where every leg gets named and the
 * spread metadata is filled in.
 */
export default async function SpreadTypePage(props: { searchParams: Search }) {
  const sp = await props.searchParams;
  const legs = parseLegsCsv(sp);
  const matcher = getStr(sp, "matcher"); // "auto" | "manual" | ""
  const preSelected = getStr(sp, "spreadType");

  // Back goes back to the picker if we have legs, otherwise to the source step.
  const backHref = legs ? "/add/spread/pick" : "/add/spread/source";

  return (
    <WizardShell
      type="spread"
      step={3}
      totalSteps={5}
      stepLabels={STEP_LABELS}
      title="What kind of spread is this?"
      subtitle={
        preSelected
          ? "Pre-selected from the matcher's suggestion. Switch it if the auto-detection is off."
          : "Pick the spread shape that best describes the legs you selected. The fields step adapts to your choice."
      }
    >
      <form
        id="spread-type-form"
        action="/add/spread/fields"
        method="get"
        className="flex flex-col gap-7"
      >
        {/* Pass-through state from the picker. */}
        {legs && <input type="hidden" name="legs" value={legs} />}
        {matcher && <input type="hidden" name="matcher" value={matcher} />}

        <fieldset className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <legend className="sr-only">Spread type</legend>
          {SPREAD_TYPES.map((opt) => (
            <label
              key={opt.value}
              className={cn(
                "group flex cursor-pointer flex-col gap-2 rounded-md border border-border bg-surface p-5 transition-all",
                "hover:border-border-strong hover:bg-subtle",
                "has-[input:checked]:border-text has-[input:checked]:bg-subtle"
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
