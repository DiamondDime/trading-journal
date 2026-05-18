"use client";

import * as React from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ManualLegInput {
  /** Client-side stable key — never sent to server. */
  _id: string;
  symbol: string;
  exchange: string;
  side: "long" | "short";
  qty: string;
  entryPrice: string;
  exitPrice: string;
  feesUsd: string;
  instrumentType: "spot" | "perp" | "dated_future";
}

export interface ManualLegBuilderProps {
  /** Hidden input name for the serialised JSON blob. */
  name: string;
  /** The form id this builder belongs to. Needed when the component is
   *  rendered outside the <form> element (e.g. in a preceding <section>).
   *  Sets the `form` attribute on the hidden input so the GET submit carries
   *  the JSON blob even though the input is not a DOM child of the form. */
  formId?: string;
  /** Initial legs (for back-nav round-trip). JSON-encoded ManualLegInput[]. */
  defaultValue?: string;
  labels: {
    addLeg: string;
    removeLeg: string;
    legN: string;
    symbol: string;
    exchange: string;
    sideLong: string;
    sideShort: string;
    qty: string;
    entryPrice: string;
    exitPrice: string;
    feesUsd: string;
    instrumentSpot: string;
    instrumentPerp: string;
    instrumentDatedFuture: string;
    computedPnl: string;
    totalPnl: string;
    totalCapital: string;
    atLeastOne: string;
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function makeEmpty(): ManualLegInput {
  return {
    _id: uid(),
    symbol: "",
    exchange: "",
    side: "long",
    qty: "",
    entryPrice: "",
    exitPrice: "",
    feesUsd: "",
    instrumentType: "perp",
  };
}

function parseD(s: string): number {
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/** Realized P&L for one leg (fees already in USD). */
function legPnl(leg: ManualLegInput): number | null {
  const qty = parseD(leg.qty);
  const entry = parseD(leg.entryPrice);
  const exit = parseD(leg.exitPrice);
  const fees = parseD(leg.feesUsd);
  if (!qty || !entry || !exit) return null;
  const direction = leg.side === "long" ? 1 : -1;
  return (exit - entry) * qty * direction - fees;
}

function legCapital(leg: ManualLegInput): number {
  return Math.abs(parseD(leg.qty) * parseD(leg.entryPrice));
}

function fmtUsd(n: number): string {
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const sign = n >= 0 ? "+" : "−";
  return `${sign}$${abs}`;
}

/** Infer instrument type from symbol string. */
function inferInstrumentType(sym: string): "spot" | "perp" | "dated_future" {
  const upper = sym.toUpperCase();
  if (upper.includes("-PERP") || upper.includes("-SWAP") || upper.includes("PERP")) return "perp";
  if (upper.includes("-") && /\d{6}|\d{4}/.test(upper)) return "dated_future";
  return "spot";
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ManualLegBuilder({ name, formId, defaultValue, labels }: ManualLegBuilderProps) {
  const [legs, setLegs] = React.useState<ManualLegInput[]>(() => {
    if (defaultValue) {
      try {
        const parsed = JSON.parse(defaultValue) as ManualLegInput[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Re-assign fresh _ids in case they collided (e.g. SSR hydration).
          return parsed.map((l) => ({ ...l, _id: uid() }));
        }
      } catch {
        // fall through to default
      }
    }
    return [makeEmpty()];
  });

  const serialized = React.useMemo(
    () =>
      JSON.stringify(
        // Strip _id before serialising — server doesn't need it.
        legs.map(({ _id: _, ...rest }) => rest),
      ),
    [legs],
  );

  function updateLeg(id: string, patch: Partial<ManualLegInput>) {
    setLegs((prev) =>
      prev.map((l) => {
        if (l._id !== id) return l;
        const updated = { ...l, ...patch };
        // Auto-infer instrument type when symbol changes if user hasn't
        // explicitly overridden it.
        if (patch.symbol !== undefined) {
          updated.instrumentType = inferInstrumentType(patch.symbol);
        }
        return updated;
      }),
    );
  }

  function addLeg() {
    setLegs((prev) => [...prev, makeEmpty()]);
  }

  function removeLeg(id: string) {
    setLegs((prev) => (prev.length > 1 ? prev.filter((l) => l._id !== id) : prev));
  }

  const totalPnl = legs.reduce((acc, l) => {
    const p = legPnl(l);
    return p !== null ? acc + p : acc;
  }, 0);
  const hasSomePnl = legs.some((l) => legPnl(l) !== null);
  const totalCapital = legs.reduce((acc, l) => acc + legCapital(l), 0);

  return (
    <div className="flex flex-col gap-4">
      {/* Hidden input carrying the JSON blob. `form` attribute links it to
          the GET form even when rendered outside the <form> element. */}
      <input type="hidden" name={name} value={serialized} {...(formId ? { form: formId } : {})} />

      {legs.map((leg, idx) => {
        const pnl = legPnl(leg);
        return (
          <div
            key={leg._id}
            className="rounded-md border border-border bg-surface p-4"
          >
            {/* Leg header */}
            <div className="mb-3 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
                {labels.legN} {idx + 1}
              </span>
              {legs.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeLeg(leg._id)}
                  aria-label={`${labels.removeLeg} ${idx + 1}`}
                  className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary transition-colors hover:text-down"
                >
                  <X className="h-3 w-3" />
                  {labels.removeLeg}
                </button>
              )}
            </div>

            {/* Fields grid */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {/* Symbol */}
              <div className="flex flex-col gap-1">
                <label
                  htmlFor={`ml-sym-${leg._id}`}
                  className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary"
                >
                  {labels.symbol}
                </label>
                <input
                  id={`ml-sym-${leg._id}`}
                  type="text"
                  value={leg.symbol}
                  onChange={(e) => updateLeg(leg._id, { symbol: e.target.value })}
                  placeholder="BTC"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="characters"
                  className="rounded-md border border-border bg-app px-3 py-2 font-mono text-[12px] text-text placeholder:text-text-disabled focus:border-border-strong focus:outline-none focus:ring-1 focus:ring-text"
                />
              </div>

              {/* Exchange */}
              <div className="flex flex-col gap-1">
                <label
                  htmlFor={`ml-exch-${leg._id}`}
                  className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary"
                >
                  {labels.exchange}
                </label>
                <input
                  id={`ml-exch-${leg._id}`}
                  type="text"
                  value={leg.exchange}
                  onChange={(e) => updateLeg(leg._id, { exchange: e.target.value })}
                  placeholder="Binance"
                  autoComplete="off"
                  className="rounded-md border border-border bg-app px-3 py-2 font-mono text-[12px] text-text placeholder:text-text-disabled focus:border-border-strong focus:outline-none focus:ring-1 focus:ring-text"
                />
              </div>

              {/* Instrument type */}
              <div className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
                  Instrument
                </span>
                <div className="grid grid-cols-3 gap-1.5">
                  {(["spot", "perp", "dated_future"] as const).map((kind) => (
                    <label
                      key={kind}
                      className={cn(
                        "flex cursor-pointer items-center justify-center rounded-md border border-border bg-app px-1.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-text-secondary transition-colors hover:border-border-strong hover:text-text",
                        "has-[input:checked]:border-text has-[input:checked]:bg-subtle has-[input:checked]:text-text",
                      )}
                    >
                      <input
                        type="radio"
                        name={`ml-kind-${leg._id}`}
                        value={kind}
                        checked={leg.instrumentType === kind}
                        onChange={() => updateLeg(leg._id, { instrumentType: kind })}
                        className="sr-only"
                      />
                      {kind === "spot"
                        ? labels.instrumentSpot
                        : kind === "perp"
                          ? labels.instrumentPerp
                          : labels.instrumentDatedFuture}
                    </label>
                  ))}
                </div>
              </div>

              {/* Side */}
              <div className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
                  Side
                </span>
                <div className="grid grid-cols-2 gap-1.5">
                  {(["long", "short"] as const).map((s) => (
                    <label
                      key={s}
                      className={cn(
                        "flex cursor-pointer items-center justify-center rounded-md border border-border bg-app px-2 py-2 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors hover:border-border-strong",
                        s === "long"
                          ? "text-up has-[input:checked]:border-up/60 has-[input:checked]:bg-up/10"
                          : "text-down has-[input:checked]:border-down/60 has-[input:checked]:bg-down/10",
                      )}
                    >
                      <input
                        type="radio"
                        name={`ml-side-${leg._id}`}
                        value={s}
                        checked={leg.side === s}
                        onChange={() => updateLeg(leg._id, { side: s })}
                        className="sr-only"
                      />
                      {s === "long" ? labels.sideLong : labels.sideShort}
                    </label>
                  ))}
                </div>
              </div>

              {/* Qty */}
              <div className="flex flex-col gap-1">
                <label
                  htmlFor={`ml-qty-${leg._id}`}
                  className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary"
                >
                  {labels.qty}
                </label>
                <input
                  id={`ml-qty-${leg._id}`}
                  type="number"
                  step="any"
                  inputMode="decimal"
                  value={leg.qty}
                  onChange={(e) => updateLeg(leg._id, { qty: e.target.value })}
                  placeholder="1.0"
                  className="rounded-md border border-border bg-app px-3 py-2 font-mono text-[12px] tabular-nums text-text placeholder:text-text-disabled focus:border-border-strong focus:outline-none focus:ring-1 focus:ring-text"
                />
              </div>

              {/* Entry price */}
              <div className="flex flex-col gap-1">
                <label
                  htmlFor={`ml-entry-${leg._id}`}
                  className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary"
                >
                  {labels.entryPrice}
                </label>
                <input
                  id={`ml-entry-${leg._id}`}
                  type="number"
                  step="any"
                  inputMode="decimal"
                  value={leg.entryPrice}
                  onChange={(e) => updateLeg(leg._id, { entryPrice: e.target.value })}
                  placeholder="50000.00"
                  className="rounded-md border border-border bg-app px-3 py-2 font-mono text-[12px] tabular-nums text-text placeholder:text-text-disabled focus:border-border-strong focus:outline-none focus:ring-1 focus:ring-text"
                />
              </div>

              {/* Exit price */}
              <div className="flex flex-col gap-1">
                <label
                  htmlFor={`ml-exit-${leg._id}`}
                  className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary"
                >
                  {labels.exitPrice}
                </label>
                <input
                  id={`ml-exit-${leg._id}`}
                  type="number"
                  step="any"
                  inputMode="decimal"
                  value={leg.exitPrice}
                  onChange={(e) => updateLeg(leg._id, { exitPrice: e.target.value })}
                  placeholder="51000.00"
                  className="rounded-md border border-border bg-app px-3 py-2 font-mono text-[12px] tabular-nums text-text placeholder:text-text-disabled focus:border-border-strong focus:outline-none focus:ring-1 focus:ring-text"
                />
              </div>

              {/* Fees USD */}
              <div className="flex flex-col gap-1">
                <label
                  htmlFor={`ml-fees-${leg._id}`}
                  className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary"
                >
                  {labels.feesUsd}
                </label>
                <input
                  id={`ml-fees-${leg._id}`}
                  type="number"
                  step="any"
                  min="0"
                  inputMode="decimal"
                  value={leg.feesUsd}
                  onChange={(e) => updateLeg(leg._id, { feesUsd: e.target.value })}
                  placeholder="5.00"
                  className="rounded-md border border-border bg-app px-3 py-2 font-mono text-[12px] tabular-nums text-text placeholder:text-text-disabled focus:border-border-strong focus:outline-none focus:ring-1 focus:ring-text"
                />
              </div>

              {/* Computed P&L for this leg */}
              {pnl !== null && (
                <div className="flex flex-col justify-end gap-1">
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
                    {labels.computedPnl}
                  </span>
                  <span
                    className={cn(
                      "font-mono text-[13px] font-medium tabular-nums",
                      pnl >= 0 ? "text-up" : "text-down",
                    )}
                  >
                    {fmtUsd(pnl)}
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* Add leg button */}
      <button
        type="button"
        onClick={addLeg}
        className="inline-flex items-center gap-1.5 self-start font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary transition-colors hover:text-text"
      >
        <Plus className="h-3 w-3" />
        {labels.addLeg}
      </button>

      {/* Totals bar */}
      {(hasSomePnl || totalCapital > 0) && (
        <div className="flex flex-wrap items-center gap-6 rounded-md border border-border-subtle bg-subtle px-4 py-3">
          {totalCapital > 0 && (
            <div className="flex flex-col gap-0.5">
              <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-text-tertiary">
                {labels.totalCapital}
              </span>
              <span className="font-mono text-[12px] tabular-nums text-text">
                ${totalCapital.toLocaleString("en-US", { maximumFractionDigits: 2 })}
              </span>
            </div>
          )}
          {hasSomePnl && (
            <div className="flex flex-col gap-0.5">
              <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-text-tertiary">
                {labels.totalPnl}
              </span>
              <span
                className={cn(
                  "font-mono text-[12px] font-medium tabular-nums",
                  totalPnl >= 0 ? "text-up" : "text-down",
                )}
              >
                {fmtUsd(totalPnl)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Validation cue */}
      {legs.every((l) => !l.symbol) && (
        <p
          role="alert"
          className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary"
        >
          {labels.atLeastOne}
        </p>
      )}
    </div>
  );
}
