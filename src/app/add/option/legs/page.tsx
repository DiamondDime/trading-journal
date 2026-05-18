import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardLegList } from "@/components/wizard/wizard-leg-list";
import { WizardNav } from "@/components/wizard/wizard-nav";
import { WizardValidationSummary } from "@/components/wizard/wizard-validation-summary";
import { getT } from "@/lib/i18n/server";
import { requireUser } from "@/lib/auth/server";
import { getOptionForEdit } from "../db";
import type { OptionLegInput } from "@/lib/db/zod-schemas";

export const dynamic = "force-dynamic";

type Search = Promise<{ [key: string]: string | string[] | undefined }>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getStr(sp: Awaited<Search>, key: string, fallback = ""): string {
  const v = sp[key];
  if (typeof v === "string") return v;
  return fallback;
}

function isoToDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Parse the `legs[i].<field>` searchParams that arrive on back-nav from
 * /fields or /review. Each entry can be a string (single value) or
 * string[] (when the field appears in multiple legs, Next 16 may collect
 * duplicates) — we index by leg position and surface the bucket back to
 * WizardLegList as `defaults`.
 */
function extractLegDefaults(
  sp: Awaited<Search>,
): Partial<OptionLegInput>[] {
  const buckets = new Map<number, Record<string, string>>();
  const PATH_RE = /^legs\[(\d+)\]\.(.+)$/;
  for (const [k, v] of Object.entries(sp)) {
    const m = k.match(PATH_RE);
    if (!m) continue;
    const i = Number(m[1]);
    const field = m[2];
    const value =
      Array.isArray(v) ? v[0] : typeof v === "string" ? v : undefined;
    if (value === undefined) continue;
    let bucket = buckets.get(i);
    if (!bucket) {
      bucket = {};
      buckets.set(i, bucket);
    }
    bucket[field] = value;
  }
  const indices = Array.from(buckets.keys()).sort((a, b) => a - b);
  return indices.map((i) => buckets.get(i)!);
}

/**
 * Option wizard step 3 — Legs.
 *
 * Single-leg subtype renders one leg form (hideHeader on the WizardLegList).
 * Option_spread renders an N-row table with add/remove. The starting count
 * is 2 for spreads, 1 for single_leg — clamped at the WizardLegList layer.
 *
 * The form GET-submits to /add/option/fields so every typed value rides
 * forward as searchParams.
 */
export default async function OptionLegsPage(props: { searchParams: Search }) {
  const t = await getT();
  const STEP_LABELS = [
    t("wizard.option.stepLabels.source"),
    t("wizard.option.stepLabels.kind"),
    t("wizard.option.stepLabels.legs"),
    t("wizard.option.stepLabels.fields"),
    t("wizard.option.stepLabels.review"),
  ] as const;

  const sp = await props.searchParams;
  const subtype = getStr(sp, "subtype", "single_leg");
  const editId = getStr(sp, "edit");

  // Hydrate defaults from /review back-nav.
  let legDefaults: Partial<OptionLegInput>[] = extractLegDefaults(sp);

  // Edit mode: load legs from DB if the form params don't already carry them.
  let editLoaded = false;
  if (editId && UUID_RE.test(editId) && legDefaults.length === 0) {
    const { id: userId } = await requireUser();
    const loaded = await getOptionForEdit(userId, editId);
    if (loaded) {
      // The canonical Exchange type is wider than the option Zod ExchangeCode
      // (Exchange includes 'htx'; ExchangeCode doesn't). Cast through unknown
      // since the wizard's UI only displays the venue text and the form re-
      // emits whatever the user typed.
      legDefaults = loaded.legs.map(
        (l): Partial<OptionLegInput> => ({
          leg_index: l.legIndex,
          exchange: l.exchange as OptionLegInput["exchange"],
          underlying: l.underlying,
          expiry: isoToDate(l.expiry),
          strike: l.strike,
          option_kind: l.optionKind,
          side: l.side,
          contracts: l.contracts,
          premium_per_contract: l.premiumPerContract,
          iv: l.iv ?? undefined,
          delta: l.delta ?? undefined,
          gamma: l.gamma ?? undefined,
          theta: l.theta ?? undefined,
          vega: l.vega ?? undefined,
          rho: l.rho ?? undefined,
        }),
      );
      editLoaded = true;
    }
  }

  // Count drives WizardLegList. legs= query param wins on add/remove clicks.
  const rawCount = Number(getStr(sp, "legs", ""));
  const count = Number.isFinite(rawCount) && rawCount > 0
    ? rawCount
    : Math.max(legDefaults.length, subtype === "option_spread" ? 2 : 1);

  // single_leg locks to 1. option_spread enforces 2-8 (clamping inside the
  // WizardLegList component handles the bounds).
  const finalCount = subtype === "single_leg" ? 1 : count;

  // Build the searchParam round-trip set preserved on add/remove of legs.
  const preserveParams: Record<string, string | undefined> = {
    subtype,
    ...(editId ? { edit: editId } : {}),
  };

  // Compose a serverside warning when subtype is set to option_spread with
  // count=1 (impossible) — shouldn't happen via the radio path but guards
  // against direct URL hits.
  const issues =
    subtype === "option_spread" && finalCount < 2
      ? [{ message: t("wizard.option.legs.minSpreadLegs"), field: "subtype" }]
      : [];

  return (
    <WizardShell
      type="option"
      step={3}
      totalSteps={5}
      stepLabels={STEP_LABELS}
      title={
        subtype === "option_spread"
          ? t("wizard.option.legs.titleSpread")
          : t("wizard.option.legs.titleSingle")
      }
      subtitle={
        editLoaded
          ? t("wizard.option.legs.subtitleEdit")
          : t("wizard.option.legs.subtitle")
      }
    >
      <WizardValidationSummary errors={issues} />
      <form
        id="option-legs-form"
        action="/add/option/fields"
        method="get"
        className="flex flex-col gap-7"
      >
        {editId && <input type="hidden" name="edit" value={editId} />}
        <input type="hidden" name="subtype" value={subtype} />

        <WizardLegList
          count={finalCount}
          defaults={legDefaults}
          baseHref="/add/option/legs"
          preserveParams={preserveParams}
          hideHeader={subtype === "single_leg"}
        />

        <WizardNav
          backHref={`/add/option/kind?subtype=${subtype}${editId ? `&edit=${editId}` : ""}`}
          continueFormId="option-legs-form"
        />
      </form>
    </WizardShell>
  );
}
