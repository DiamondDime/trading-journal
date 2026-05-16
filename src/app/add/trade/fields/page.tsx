import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { WizardShell } from "@/components/wizard/wizard-shell";
import {
  WizardField,
  WizardInput,
  WizardSelect,
  WizardTextarea,
} from "@/components/wizard/wizard-field";
import { cn } from "@/lib/utils";

// Stepper label set: the label at index 2 ("Details") is shown regardless of
// path. When the user took the Manual branch, this page is step 3 of 4 but
// effectively skips step 2 ("Pick"); the labelling is slightly off in that
// case but the step counter still reads "Step 3 of 4" — acceptable for v1.
const STEP_LABELS = ["Source", "Pick", "Details", "Review"] as const;

const EXCHANGES = ["Binance", "Bybit", "Hyperliquid", "Coinbase", "OKX", "Other"] as const;
const INSTRUMENTS = ["perp", "spot", "future"] as const;
const SIDES = ["long", "short"] as const;

// Reading searchParams. The pick step encodes pre-fills into the URL; manual
// entry arrives with an empty bag. We always render the same form.
type Search = Promise<{ [key: string]: string | string[] | undefined }>;

function getStr(
  sp: Awaited<Search>,
  key: string,
  fallback = ""
): string {
  const v = sp[key];
  if (typeof v === "string") return v;
  return fallback;
}

/**
 * Trade details step. Uses a native GET form whose action is the review
 * page — submitting the form just appends every named input value to the
 * URL. Server-component-friendly, no client JS needed for happy path.
 */
export default async function TradeFieldsPage(props: {
  searchParams: Search;
}) {
  const sp = await props.searchParams;

  const defaults = {
    exchange: getStr(sp, "exchange", "Binance"),
    symbol: getStr(sp, "symbol"),
    instrument: getStr(sp, "instrument", "perp"),
    side: getStr(sp, "side", "long"),
    capital: getStr(sp, "capital"),
    entryPrice: getStr(sp, "entryPrice"),
    exitPrice: getStr(sp, "exitPrice"),
    qty: getStr(sp, "qty"),
    fees: getStr(sp, "fees"),
    openedAt: getStr(sp, "openedAt"),
    closedAt: getStr(sp, "closedAt"),
    note: getStr(sp, "note"),
    regimeTags: getStr(sp, "regimeTags"),
    source: getStr(sp, "source"),
  };

  // Back goes to the right place depending on how the user arrived. If
  // `source=<fill-id>` is in the URL, they came from the picker; otherwise
  // they came from the manual branch of the source step.
  const backHref = defaults.source
    ? "/add/trade/pick"
    : "/add/trade/source";

  return (
    <WizardShell
      type="trade"
      step={3}
      totalSteps={4}
      stepLabels={STEP_LABELS}
      title="Trade details"
      subtitle={
        defaults.source
          ? "Pre-filled from your exchange fill. Edit anything that doesn't look right."
          : "Type in what happened. You can always edit this later from the trade detail page."
      }
    >
      <form
        id="trade-fields-form"
        action="/add/trade/review"
        method="get"
        className="flex flex-col gap-7"
      >
        {/* Pass-through fields so navigating back from review preserves
            the trade's source attribution. */}
        {defaults.source && (
          <input type="hidden" name="source" value={defaults.source} />
        )}

        {/* ── Venue + symbol ─────────────────────────────────────────── */}
        <SectionLabel>Venue</SectionLabel>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField label="Exchange" htmlFor="exchange" required>
            <WizardSelect
              id="exchange"
              name="exchange"
              defaultValue={defaults.exchange}
              required
            >
              {EXCHANGES.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </WizardSelect>
          </WizardField>
          <WizardField
            label="Symbol"
            htmlFor="symbol"
            helper="e.g. BTC-PERP, ETH-USD, SOL-PERP"
            required
          >
            <WizardInput
              id="symbol"
              name="symbol"
              defaultValue={defaults.symbol}
              placeholder="BTC-PERP"
              required
              autoComplete="off"
            />
          </WizardField>
        </div>

        {/* ── Instrument + side ──────────────────────────────────────── */}
        <SectionLabel>Shape</SectionLabel>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <RadioRow
            legend="Instrument"
            name="instrument"
            options={INSTRUMENTS.map((i) => ({ value: i, label: i }))}
            defaultValue={defaults.instrument}
          />
          <RadioRow
            legend="Side"
            name="side"
            options={SIDES.map((s) => ({
              value: s,
              label: s,
              tone: s === "long" ? "up" : "down",
            }))}
            defaultValue={defaults.side}
          />
        </div>

        {/* ── Numbers ────────────────────────────────────────────────── */}
        <SectionLabel>Numbers</SectionLabel>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField
            label="Capital deployed"
            htmlFor="capital"
            helper="USD"
            required
          >
            <WizardInput
              id="capital"
              name="capital"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.capital}
              placeholder="24800.00"
              required
            />
          </WizardField>
          <WizardField label="Quantity" htmlFor="qty" helper="Position size in base units" required>
            <WizardInput
              id="qty"
              name="qty"
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.qty}
              placeholder="0.50"
              required
            />
          </WizardField>
          <WizardField label="Entry price" htmlFor="entryPrice" helper="USD" required>
            <WizardInput
              id="entryPrice"
              name="entryPrice"
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.entryPrice}
              placeholder="64200.00"
              required
            />
          </WizardField>
          <WizardField label="Exit price" htmlFor="exitPrice" helper="USD" required>
            <WizardInput
              id="exitPrice"
              name="exitPrice"
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.exitPrice}
              placeholder="66380.00"
              required
            />
          </WizardField>
          <WizardField
            label="Fees"
            htmlFor="fees"
            helper="Total USD round-trip fees"
          >
            <WizardInput
              id="fees"
              name="fees"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.fees}
              placeholder="12.50"
            />
          </WizardField>
        </div>

        {/* ── Timing ─────────────────────────────────────────────────── */}
        <SectionLabel>Timing</SectionLabel>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField label="Opened at" htmlFor="openedAt" required>
            <WizardInput
              id="openedAt"
              name="openedAt"
              type="datetime-local"
              defaultValue={defaults.openedAt}
              required
            />
          </WizardField>
          <WizardField label="Closed at" htmlFor="closedAt" required>
            <WizardInput
              id="closedAt"
              name="closedAt"
              type="datetime-local"
              defaultValue={defaults.closedAt}
              required
            />
          </WizardField>
        </div>

        {/* ── Note + tags ────────────────────────────────────────────── */}
        <SectionLabel>Thesis &amp; tags</SectionLabel>
        <WizardField
          label="Note"
          htmlFor="note"
          helper="What was the thesis? What's worth remembering next time? Markdown welcome."
        >
          <WizardTextarea
            id="note"
            name="note"
            rows={4}
            defaultValue={defaults.note}
            placeholder="ETF inflow continuation. Stop under HTF support…"
          />
        </WizardField>
        <WizardField
          label="Regime tags"
          htmlFor="regimeTags"
          helper="Comma-separated. e.g. risk-on, funding-positive, short-squeeze"
        >
          <WizardInput
            id="regimeTags"
            name="regimeTags"
            defaultValue={defaults.regimeTags}
            placeholder="risk-on, funding-positive"
            autoComplete="off"
          />
        </WizardField>

        {/* ── Nav ────────────────────────────────────────────────────── */}
        <div className="mt-6 flex items-center justify-between border-t border-border pt-6">
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

function RadioRow({
  legend,
  name,
  options,
  defaultValue,
}: {
  legend: string;
  name: string;
  options: { value: string; label: string; tone?: "up" | "down" }[];
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
        className="grid grid-cols-3 gap-2"
      >
        {options.map((opt) => (
          <label
            key={opt.value}
            className={cn(
              "flex cursor-pointer items-center justify-center rounded-md border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
              "border-border bg-surface text-text-secondary hover:border-border-strong hover:text-text",
              "has-[input:checked]:border-text has-[input:checked]:bg-subtle has-[input:checked]:text-text",
              opt.tone === "up" &&
                "has-[input:checked]:border-up has-[input:checked]:bg-up/10 has-[input:checked]:text-up",
              opt.tone === "down" &&
                "has-[input:checked]:border-down has-[input:checked]:bg-down/10 has-[input:checked]:text-down"
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
