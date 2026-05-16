import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { WizardShell } from "@/components/wizard/wizard-shell";
import {
  WizardField,
  WizardInput,
  WizardTextarea,
} from "@/components/wizard/wizard-field";
import { cn } from "@/lib/utils";

const STEP_LABELS = ["Details", "Review"] as const;

const SALE_KINDS = [
  { value: "ido", label: "IDO" },
  { value: "launchpad", label: "Launchpad" },
  { value: "premarket", label: "Premarket" },
  { value: "otc", label: "OTC" },
] as const;

type Search = Promise<{ [key: string]: string | string[] | undefined }>;

function getStr(sp: Awaited<Search>, key: string, fallback = ""): string {
  const v = sp[key];
  if (typeof v === "string") return v;
  return fallback;
}

/**
 * Sale details — the only data-entry step for Sale activities. Token
 * allocations don't appear in exchange trade history, so there's no
 * exchange-fills picker; the wizard collapses to Fields → Review.
 *
 * Native GET form with action="/add/sale/review" — every named input
 * becomes a search-param on the next route. No client JS for the happy
 * path.
 */
export default async function SaleFieldsPage(props: {
  searchParams: Search;
}) {
  const sp = await props.searchParams;

  const defaults = {
    saleKind: getStr(sp, "saleKind", "ido"),
    venue: getStr(sp, "venue"),
    asset: getStr(sp, "asset"),
    usdPaid: getStr(sp, "usdPaid"),
    tokensAllocated: getStr(sp, "tokensAllocated"),
    tgeDate: getStr(sp, "tgeDate"),
    tgeUnlockPct: getStr(sp, "tgeUnlockPct"),
    vestingCliffMonths: getStr(sp, "vestingCliffMonths"),
    vestingDurationMonths: getStr(sp, "vestingDurationMonths"),
    currentPriceUsd: getStr(sp, "currentPriceUsd"),
    openedAt: getStr(sp, "openedAt"),
    note: getStr(sp, "note"),
    regimeTags: getStr(sp, "regimeTags"),
  };

  return (
    <WizardShell
      type="sale"
      step={1}
      totalSteps={2}
      stepLabels={STEP_LABELS}
      title="Sale details"
      subtitle="Token allocations from launchpads, IDOs, premarkets, and OTC desks. Capture the schedule once — vesting math comes off these numbers."
    >
      <form
        id="sale-fields-form"
        action="/add/sale/review"
        method="get"
        className="flex flex-col gap-7"
      >
        {/* ── Kind ───────────────────────────────────────────────────── */}
        <SectionLabel>Kind</SectionLabel>
        <RadioGrid
          legend="Sale kind"
          name="saleKind"
          options={SALE_KINDS.map((k) => ({ value: k.value, label: k.label }))}
          defaultValue={defaults.saleKind}
        />

        {/* ── Venue + token ─────────────────────────────────────────── */}
        <SectionLabel>Venue &amp; token</SectionLabel>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField
            label="Venue"
            htmlFor="venue"
            helper="Launchpad, IDO platform, OTC desk"
            required
          >
            <WizardInput
              id="venue"
              name="venue"
              defaultValue={defaults.venue}
              placeholder="Binance Launchpad"
              required
              autoComplete="off"
            />
          </WizardField>
          <WizardField
            label="Token symbol"
            htmlFor="asset"
            helper="Ticker, uppercase"
            required
          >
            <WizardInput
              id="asset"
              name="asset"
              defaultValue={defaults.asset}
              placeholder="EIGEN"
              required
              autoComplete="off"
              style={{ textTransform: "uppercase" }}
            />
          </WizardField>
        </div>

        {/* ── Allocation ───────────────────────────────────────────── */}
        <SectionLabel>Allocation</SectionLabel>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField
            label="USD paid"
            htmlFor="usdPaid"
            helper="What you wired in for the allocation"
            required
          >
            <WizardInput
              id="usdPaid"
              name="usdPaid"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.usdPaid}
              placeholder="2000.00"
              required
            />
          </WizardField>
          <WizardField
            label="Tokens allocated"
            htmlFor="tokensAllocated"
            helper="Total tokens at the bonded price"
            required
          >
            <WizardInput
              id="tokensAllocated"
              name="tokensAllocated"
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.tokensAllocated}
              placeholder="1000"
              required
            />
          </WizardField>
        </div>

        {/* ── Vesting schedule ──────────────────────────────────────── */}
        <SectionLabel>Vesting schedule</SectionLabel>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField label="TGE date" htmlFor="tgeDate" required>
            <WizardInput
              id="tgeDate"
              name="tgeDate"
              type="date"
              defaultValue={defaults.tgeDate}
              required
            />
          </WizardField>
          <WizardField
            label="TGE unlock %"
            htmlFor="tgeUnlockPct"
            helper="% of allocation unlocked at TGE; remainder vests"
            required
          >
            <WizardInput
              id="tgeUnlockPct"
              name="tgeUnlockPct"
              type="number"
              step="1"
              min="0"
              max="100"
              inputMode="numeric"
              defaultValue={defaults.tgeUnlockPct}
              placeholder="20"
              required
            />
          </WizardField>
          <WizardField
            label="Vesting cliff"
            htmlFor="vestingCliffMonths"
            helper="Months. 0 if no cliff"
          >
            <WizardInput
              id="vestingCliffMonths"
              name="vestingCliffMonths"
              type="number"
              step="1"
              min="0"
              inputMode="numeric"
              defaultValue={defaults.vestingCliffMonths}
              placeholder="6"
            />
          </WizardField>
          <WizardField
            label="Vesting duration"
            htmlFor="vestingDurationMonths"
            helper="Months. 0 if fully unlocked at TGE"
          >
            <WizardInput
              id="vestingDurationMonths"
              name="vestingDurationMonths"
              type="number"
              step="1"
              min="0"
              inputMode="numeric"
              defaultValue={defaults.vestingDurationMonths}
              placeholder="18"
            />
          </WizardField>
        </div>

        {/* ── Mark-to-market ────────────────────────────────────────── */}
        <SectionLabel>Mark-to-market</SectionLabel>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField
            label="Current price"
            htmlFor="currentPriceUsd"
            helper="USD per token, for MTM calc"
            required
          >
            <WizardInput
              id="currentPriceUsd"
              name="currentPriceUsd"
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.currentPriceUsd}
              placeholder="8.40"
              required
            />
          </WizardField>
          <WizardField label="Opened at" htmlFor="openedAt" helper="When you paid" required>
            <WizardInput
              id="openedAt"
              name="openedAt"
              type="datetime-local"
              defaultValue={defaults.openedAt}
              required
            />
          </WizardField>
        </div>

        {/* ── Thesis + tags ─────────────────────────────────────────── */}
        <SectionLabel>Thesis &amp; tags</SectionLabel>
        <WizardField
          label="Note"
          htmlFor="note"
          helper="Why this allocation? What's the narrative? Markdown welcome."
        >
          <WizardTextarea
            id="note"
            name="note"
            rows={4}
            defaultValue={defaults.note}
            placeholder="Restaking narrative entry. TGE pop, hold to first cliff…"
          />
        </WizardField>
        <WizardField
          label="Regime tags"
          htmlFor="regimeTags"
          helper="Comma-separated. e.g. restaking-narrative, l2-narrative"
        >
          <WizardInput
            id="regimeTags"
            name="regimeTags"
            defaultValue={defaults.regimeTags}
            placeholder="restaking-narrative"
            autoComplete="off"
          />
        </WizardField>

        {/* ── Nav ────────────────────────────────────────────────────── */}
        <div className="mt-6 flex items-center justify-between border-t border-border pt-6">
          <Link
            href="/add"
            className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-text-tertiary transition-colors hover:text-text"
          >
            <ArrowLeft className="h-3 w-3" />
            Back
          </Link>
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-md border border-text bg-text px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-app transition-colors hover:bg-text-secondary"
          >
            Review
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </form>
    </WizardShell>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="border-b border-border-subtle pb-2 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
      {children}
    </h2>
  );
}

/**
 * Radio grid for the sale-kind picker. Same pattern as the Trade flow's
 * RadioRow but with a 4-up grid that wraps on small screens.
 */
function RadioGrid({
  legend,
  name,
  options,
  defaultValue,
}: {
  legend: string;
  name: string;
  options: { value: string; label: string }[];
  defaultValue: string;
}) {
  const id = `radio-${name}`;
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend
        id={id}
        className="mb-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary"
      >
        {legend}
        <span className="ml-1.5 text-text-disabled">· required</span>
      </legend>
      <div
        role="radiogroup"
        aria-labelledby={id}
        className="grid grid-cols-2 gap-2 md:grid-cols-4"
      >
        {options.map((opt) => (
          <label
            key={opt.value}
            className={cn(
              "flex cursor-pointer items-center justify-center rounded-md border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
              "border-border bg-surface text-text-secondary hover:border-border-strong hover:text-text",
              "has-[input:checked]:border-text has-[input:checked]:bg-subtle has-[input:checked]:text-text"
            )}
          >
            <input
              type="radio"
              name={name}
              value={opt.value}
              defaultChecked={defaultValue === opt.value}
              required
              className="sr-only"
            />
            {opt.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
