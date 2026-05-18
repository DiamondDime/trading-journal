import Link from "next/link";
import { ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import { WizardShell } from "@/components/wizard/wizard-shell";
import { cn } from "@/lib/utils";
import { getT } from "@/lib/i18n/server";
import type { TFunction } from "@/lib/i18n/resolve";
import { requireUser } from "@/lib/auth/server";
import { getPickerOptionsByPositionIds, type PickerOptionRow } from "../db";

export const dynamic = "force-dynamic";

type Search = Promise<{ [key: string]: string | string[] | undefined }>;

function getStr(sp: Awaited<Search>, key: string, fallback = ""): string {
  const v = sp[key];
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string") return v[0];
  return fallback;
}

// Manual builder uses repeated `?legs=…&legs=…`; matcher and the new
// /trades multi-select use a single comma-joined `?legs=a,b`. Normalise both.
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

/** Option in the grouped picker. Carries the matcher key + canonical variant
 *  through to /fields via the URL. variantCanonical is omitted for spread
 *  types whose DB row doesn't allow a variant. */
interface SpreadOption {
  key: string;
  spreadType: string;
  variantCanonical?: string;
}

interface SpreadGroup {
  key: string;
  options: SpreadOption[];
}

const GROUPS: readonly SpreadGroup[] = [
  {
    key: "fundingBased",
    options: [
      { key: "fundingSameVenue", spreadType: "funding", variantCanonical: "same_venue" },
      { key: "fundingCrossVenue", spreadType: "funding", variantCanonical: "cross_venue" },
      { key: "cashCarryFunding", spreadType: "cash_carry", variantCanonical: "funding" },
    ],
  },
  {
    key: "basisAndArb",
    options: [
      { key: "cashCarryBasis", spreadType: "cash_carry", variantCanonical: "basis" },
      { key: "crossExchange", spreadType: "cross_exchange" },
      { key: "dexCex", spreadType: "dex_cex" },
    ],
  },
  {
    key: "timeBased",
    options: [
      { key: "calendar", spreadType: "calendar" },
    ],
  },
];

/**
 * Infer the most likely matcher spread type + variant from the selected legs.
 *
 * Used when the user lands here from /trades multi-select WITHOUT an explicit
 * `?spreadType=` param. Rules below match the same shapes the auto-matcher
 * uses; the difference is we run them on a user-picked subset rather than
 * across the open book.
 *
 * Returns `null` when no rule fires confidently — the page renders with no
 * preselection, prompting the user to pick a group manually.
 */
function suggestFromLegs(
  legs: PickerOptionRow[],
): { spreadType: string; variantCanonical?: string } | null {
  if (legs.length < 2) return null;
  // Normalise the symbol root (e.g. "BTC-PERP" → "BTC", "ETH/USDT" → "ETH").
  const root = (s: string) => s.split(/[-/]/)[0]?.toUpperCase() ?? s.toUpperCase();
  const sameRoot = legs.every((l) => root(l.symbol) === root(legs[0].symbol));
  if (!sameRoot) return null;

  const exchanges = new Set(legs.map((l) => l.exchangeCode));
  const sides = new Set(legs.map((l) => l.side));
  const kinds = new Set(legs.map((l) => l.instrumentKind));

  const oneLong = legs.filter((l) => l.side === "long").length;
  const oneShort = legs.filter((l) => l.side === "short").length;
  const hasOppositeSides = oneLong > 0 && oneShort > 0;
  if (!hasOppositeSides) return null;

  const allPerp = kinds.size === 1 && kinds.has("perp");
  const sameVenue = exchanges.size === 1;
  const hasSpot = kinds.has("spot");
  const hasPerp = kinds.has("perp");
  const hasDatedFuture = kinds.has("dated_future");

  // 1. Long-short perps on the same exchange → same-venue funding capture.
  if (allPerp && sameVenue) {
    return { spreadType: "funding", variantCanonical: "same_venue" };
  }
  // 2. Long-short perps on different exchanges → cross-venue funding.
  if (allPerp && !sameVenue) {
    return { spreadType: "funding", variantCanonical: "cross_venue" };
  }
  // 3. Spot + perp opposite sides → cash-and-carry funding variant.
  if (hasSpot && hasPerp && !hasDatedFuture) {
    return { spreadType: "cash_carry", variantCanonical: "funding" };
  }
  // 4. Spot + dated future opposite sides → cash-and-carry basis variant.
  if (hasSpot && hasDatedFuture) {
    return { spreadType: "cash_carry", variantCanonical: "basis" };
  }
  // 5. Two dated futures (different expiries assumed, no easy expiry-compare
  //    here) on the same venue → calendar.
  if (kinds.size === 1 && hasDatedFuture && sameVenue) {
    return { spreadType: "calendar" };
  }
  // 6. Mixed kinds across venues with same symbol root → cross-exchange.
  if (!sameVenue) {
    return { spreadType: "cross_exchange" };
  }
  return null;
}

/**
 * Step 3 — Spread type picker.
 *
 * Each card is a direct Link to /add/spread/fields with spreadType and (where
 * applicable) variantCanonical baked into the href. This matches the
 * /add/page.tsx pattern and lets us expose canonical variants without
 * round-tripping through a separate form step.
 *
 * Pre-selection sources, highest priority first:
 *   - Explicit `?spreadType=` (from the matcher or back-nav from /fields)
 *   - Heuristic inferred from the legs the user picked on /trades
 *
 * The current card gets a visible "Current choice" affordance + Suggested
 * badge when the suggestion came from the heuristic.
 */
export default async function SpreadTypePage(props: { searchParams: Search }) {
  const sp = await props.searchParams;
  const t = await getT();
  const legs = parseLegsCsv(sp);
  const matcher = getStr(sp, "matcher"); // "auto" | "manual_selection" | ""
  const source = getStr(sp, "source");   // "manual" | "auto_selection" | ""
  const explicitType = getStr(sp, "spreadType");
  const explicitVariant = getStr(sp, "variantCanonical");
  const editId = getStr(sp, "edit");

  // Read the legs only when (a) we have any AND (b) the user didn't
  // explicitly pick a spread type. Skips a round-trip on the matcher path
  // and the back-nav-from-fields path.
  let suggestion: { spreadType: string; variantCanonical?: string } | null = null;
  if (legs && !explicitType) {
    const { id: userId } = await requireUser();
    const positions = await getPickerOptionsByPositionIds(
      userId,
      legs.split(","),
    );
    suggestion = suggestFromLegs(positions);
  }

  const preSelectedType = explicitType || suggestion?.spreadType || "";
  const preSelectedVariant = explicitVariant || suggestion?.variantCanonical || "";
  const isSuggested = !explicitType && suggestion != null;

  const STEP_LABELS = [
    t("wizard.spread.stepLabels.source"),
    t("wizard.spread.stepLabels.pickLegs"),
    t("wizard.spread.stepLabels.type"),
    t("wizard.spread.stepLabels.fields"),
    t("wizard.spread.stepLabels.review"),
  ] as const;

  // Back navigation honours how the user arrived:
  //   - source=manual          → manual entry path, back to /source
  //   - source=auto_selection  → came from /trades multi-select, back to /trades
  //   - legs present otherwise → came from /pick auto-matcher
  //   - default                → /source
  const backHref =
    source === "manual"
      ? "/add/spread/source"
      : source === "auto_selection"
        ? "/trades"
        : legs
          ? "/add/spread/pick"
          : "/add/spread/source";

  function hrefFor(opt: SpreadOption): string {
    const params = new URLSearchParams();
    params.set("spreadType", opt.spreadType);
    if (opt.variantCanonical) params.set("variantCanonical", opt.variantCanonical);
    if (legs) params.set("legs", legs);
    if (matcher) params.set("matcher", matcher);
    if (source) params.set("source", source);
    if (editId) params.set("edit", editId);
    return `/add/spread/fields?${params.toString()}`;
  }

  function isCurrent(opt: SpreadOption): boolean {
    if (!preSelectedType) return false;
    if (preSelectedType !== opt.spreadType) return false;
    if (preSelectedVariant) return preSelectedVariant === opt.variantCanonical;
    return !opt.variantCanonical;
  }

  return (
    <WizardShell
      type="spread"
      step={3}
      totalSteps={5}
      stepLabels={STEP_LABELS}
      title={t("wizard.spread.type.title")}
      subtitle={
        isSuggested
          ? t("wizard.spread.type.subtitleSuggested")
          : preSelectedType
            ? t("wizard.spread.type.subtitlePreSelected")
            : t("wizard.spread.type.subtitleDefault")
      }
    >
      <div className="flex flex-col gap-8">
        {GROUPS.map((group) => (
          <SpreadGroupSection
            key={group.key}
            group={group}
            hrefFor={hrefFor}
            isCurrent={isCurrent}
            isSuggested={isSuggested}
            t={t}
          />
        ))}
      </div>

      <div className="mt-10 flex items-center justify-between border-t border-border pt-6">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-text-tertiary transition-colors hover:text-text"
        >
          <ArrowLeft className="h-3 w-3" />
          {t("wizard.spread.type.back")}
        </Link>
        {preSelectedType && (
          <Link
            href={
              GROUPS.flatMap((g) => g.options).find((opt) => isCurrent(opt))
                ? hrefFor(
                    GROUPS.flatMap((g) => g.options).find((opt) => isCurrent(opt))!,
                  )
                : "#"
            }
            className="inline-flex items-center gap-2 rounded-md border border-text bg-text px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-app transition-colors hover:bg-text-secondary"
          >
            {t("wizard.spread.type.continue")}
            <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </div>
    </WizardShell>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function SpreadGroupSection({
  group,
  hrefFor,
  isCurrent,
  isSuggested,
  t,
}: {
  group: SpreadGroup;
  hrefFor: (opt: SpreadOption) => string;
  isCurrent: (opt: SpreadOption) => boolean;
  isSuggested: boolean;
  t: TFunction;
}) {
  return (
    <section>
      <header className="mb-3">
        <h3 className="font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          {t(`wizard.spread.type.groups.${group.key}.title` as Parameters<typeof t>[0])}
        </h3>
        <p className="mt-1 font-serif text-[13px] italic leading-snug text-text-tertiary">
          {t(`wizard.spread.type.groups.${group.key}.description` as Parameters<typeof t>[0])}
        </p>
      </header>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {group.options.map((opt) => (
          <li key={opt.key}>
            <SpreadOptionCard
              opt={opt}
              href={hrefFor(opt)}
              current={isCurrent(opt)}
              suggested={isSuggested && isCurrent(opt)}
              t={t}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function SpreadOptionCard({
  opt,
  href,
  current,
  suggested,
  t,
}: {
  opt: SpreadOption;
  href: string;
  current: boolean;
  suggested: boolean;
  t: TFunction;
}) {
  const titleKey = `wizard.spread.type.options.${opt.key}.title` as Parameters<typeof t>[0];
  const descKey = `wizard.spread.type.options.${opt.key}.description` as Parameters<typeof t>[0];
  return (
    <Link
      href={href}
      className={cn(
        "group flex h-full flex-col gap-2 rounded-md border bg-surface p-5 transition-all",
        "hover:border-border-strong hover:bg-subtle",
        current ? "border-text bg-subtle" : "border-border",
      )}
    >
      <h4 className="font-serif text-[15px] font-medium leading-tight text-text">
        {t(titleKey)}
      </h4>
      <p className="font-serif text-[12px] italic leading-snug text-text-secondary">
        {t(descKey)}
      </p>
      {(current || suggested) && (
        <span
          className={cn(
            "mt-auto inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.14em]",
            suggested ? "text-signature" : "text-text-secondary",
          )}
        >
          {suggested && <Sparkles className="h-3 w-3" />}
          {suggested
            ? t("wizard.spread.type.suggestedBadge")
            : t("wizard.spread.type.currentBadge")}
        </span>
      )}
    </Link>
  );
}
