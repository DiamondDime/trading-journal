"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Plus, X } from "lucide-react";

type Variant = "all_at_tge" | "tge_plus_linear" | "cliff_plus_linear" | "custom";

interface CustomEntry {
  id: string;
  date: string;
  pct: string;
}

export interface WizardVestingEditorProps {
  /** Hidden input name. The encoded JSON lands here on submit. */
  name: string;
  /** Default schedule — JSON-encoded shape matching VestingSchedule. */
  defaultValue?: string;
  /** Override the picker copy. */
  labels?: {
    variantLabel?: string;
    variants?: Partial<Record<Variant, string>>;
    tgePctLabel?: string;
    linearDaysLabel?: string;
    cliffDaysLabel?: string;
    customAddRow?: string;
    customDate?: string;
    customPct?: string;
    customRunningTotal?: string;
    customOver100?: string;
  };
}

/**
 * 4-variant vesting schedule editor. Picks a variant, then renders the
 * matching fields. The "custom" variant gets an add/remove row UI for
 * arbitrary (date, pct) entries — closes the v1 gap where /add/sale only
 * surfaced 3 of the 4 schema shapes.
 *
 * On submit, the editor emits one hidden input (name=<props.name>) carrying
 * a JSON-encoded VestingSchedule. The server action parses with Zod
 * (VestingScheduleSchema) so the round-trip stays type-safe.
 *
 * The custom variant runs a running-total sanity check (>100% gets a red
 * warning) but does not block submission — the user might genuinely want
 * a >100% schedule (e.g. bonus tokens). The server-side Zod allows it too.
 */
export function WizardVestingEditor({
  name,
  defaultValue,
  labels = {},
}: WizardVestingEditorProps) {
  const initial = parseInitial(defaultValue);
  const [variant, setVariant] = React.useState<Variant>(initial.variant);
  // Per-variant inputs. We keep them separated so switching variants
  // doesn't lose fields the user already typed.
  const [tgePct, setTgePct] = React.useState(initial.tgePct);
  const [linearDays, setLinearDays] = React.useState(initial.linearDays);
  const [cliffDays, setCliffDays] = React.useState(initial.cliffDays);
  const [entries, setEntries] = React.useState<CustomEntry[]>(initial.entries);

  // Build the JSON payload for the hidden input. Re-derives on every render.
  const payload = React.useMemo(() => {
    switch (variant) {
      case "all_at_tge":
        return JSON.stringify({ kind: "all_at_tge" });
      case "tge_plus_linear":
        return JSON.stringify({
          kind: "tge_plus_linear",
          tge_pct: Number(tgePct || "0"),
          linear_days: Number(linearDays || "0"),
        });
      case "cliff_plus_linear":
        return JSON.stringify({
          kind: "cliff_plus_linear",
          cliff_days: Number(cliffDays || "0"),
          linear_days: Number(linearDays || "0"),
          ...(tgePct ? { tge_pct: Number(tgePct) } : {}),
        });
      case "custom":
        return JSON.stringify({
          kind: "custom",
          entries: entries
            .filter((e) => e.date && e.pct)
            .map((e) => ({
              date: new Date(e.date).toISOString(),
              pct: Number(e.pct),
            })),
        });
    }
  }, [variant, tgePct, linearDays, cliffDays, entries]);

  const customTotal = entries.reduce(
    (s, e) => s + (Number.isFinite(Number(e.pct)) ? Number(e.pct) : 0),
    0,
  );
  const variantLabels = {
    all_at_tge:         labels.variants?.all_at_tge         ?? "All at TGE",
    tge_plus_linear:    labels.variants?.tge_plus_linear    ?? "TGE + linear",
    cliff_plus_linear:  labels.variants?.cliff_plus_linear  ?? "Cliff + linear",
    custom:             labels.variants?.custom             ?? "Custom",
  };

  return (
    <fieldset className="flex flex-col gap-3">
      {/* Hidden submission. value carries the JSON-encoded VestingSchedule. */}
      <input type="hidden" name={name} value={payload} />

      <legend className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
        {labels.variantLabel ?? "Schedule"}
      </legend>

      {/* Variant picker as 4 pills. */}
      <div role="radiogroup" className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {(Object.keys(variantLabels) as Variant[]).map((v) => (
          <label
            key={v}
            className={cn(
              "flex cursor-pointer items-center justify-center rounded-md border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
              "border-border bg-surface text-text-secondary hover:border-border-strong hover:text-text",
              variant === v && "border-text bg-subtle text-text",
            )}
          >
            <input
              type="radio"
              name={`${name}__variant`}
              value={v}
              checked={variant === v}
              onChange={() => setVariant(v)}
              className="sr-only"
            />
            {variantLabels[v]}
          </label>
        ))}
      </div>

      {/* Per-variant inputs. */}
      {variant === "tge_plus_linear" && (
        <div className="grid grid-cols-2 gap-3">
          <NumberInput
            label={labels.tgePctLabel ?? "TGE %"}
            value={tgePct}
            onChange={setTgePct}
            min={0}
            max={100}
            placeholder="20"
          />
          <NumberInput
            label={labels.linearDaysLabel ?? "Linear days"}
            value={linearDays}
            onChange={setLinearDays}
            min={0}
            placeholder="365"
          />
        </div>
      )}
      {variant === "cliff_plus_linear" && (
        <div className="grid grid-cols-3 gap-3">
          <NumberInput
            label={labels.tgePctLabel ?? "TGE %"}
            value={tgePct}
            onChange={setTgePct}
            min={0}
            max={100}
            placeholder="0"
          />
          <NumberInput
            label={labels.cliffDaysLabel ?? "Cliff days"}
            value={cliffDays}
            onChange={setCliffDays}
            min={0}
            placeholder="90"
          />
          <NumberInput
            label={labels.linearDaysLabel ?? "Linear days"}
            value={linearDays}
            onChange={setLinearDays}
            min={0}
            placeholder="365"
          />
        </div>
      )}
      {variant === "custom" && (
        <div className="flex flex-col gap-2">
          {entries.map((e, i) => (
            <div key={e.id} className="flex items-center gap-2">
              <input
                type="date"
                value={e.date}
                onChange={(ev) =>
                  setEntries((prev) =>
                    prev.map((p, j) =>
                      j === i ? { ...p, date: ev.currentTarget.value } : p,
                    ),
                  )
                }
                className="flex-1 rounded-md border border-border bg-surface px-3 py-2 font-mono text-[13px] text-text"
                placeholder={labels.customDate ?? "Unlock date"}
              />
              <input
                type="number"
                value={e.pct}
                onChange={(ev) =>
                  setEntries((prev) =>
                    prev.map((p, j) =>
                      j === i ? { ...p, pct: ev.currentTarget.value } : p,
                    ),
                  )
                }
                step={0.01}
                min={0}
                className="w-24 rounded-md border border-border bg-surface px-3 py-2 font-mono text-[13px] text-text"
                placeholder={labels.customPct ?? "%"}
              />
              <button
                type="button"
                onClick={() =>
                  setEntries((prev) => prev.filter((_, j) => j !== i))
                }
                aria-label="Remove row"
                className="rounded-md border border-border bg-surface p-2 text-text-tertiary hover:border-border-strong hover:text-text"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setEntries((prev) => [
                ...prev,
                { id: crypto.randomUUID(), date: "", pct: "" },
              ])
            }
            className="inline-flex items-center gap-1.5 self-start rounded-md border border-dashed border-border-strong px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary hover:bg-subtle hover:text-text"
          >
            <Plus className="h-3 w-3" />
            {labels.customAddRow ?? "Add row"}
          </button>
          <p
            className={cn(
              "font-mono text-[10px]",
              customTotal > 100 ? "text-down" : "text-text-tertiary",
            )}
          >
            {labels.customRunningTotal ?? "Running total"}: {customTotal.toFixed(2)}%
            {customTotal > 100 && (
              <span className="ml-2">
                {labels.customOver100 ?? "(over 100% — verify before submit)"}
              </span>
            )}
          </p>
        </div>
      )}
    </fieldset>
  );
}

function parseInitial(raw?: string): {
  variant: Variant;
  tgePct: string;
  linearDays: string;
  cliffDays: string;
  entries: CustomEntry[];
} {
  const empty = {
    variant: "all_at_tge" as Variant,
    tgePct: "",
    linearDays: "",
    cliffDays: "",
    entries: [] as CustomEntry[],
  };
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw) as
      | { kind: "all_at_tge" }
      | { kind: "tge_plus_linear"; tge_pct: number; linear_days: number }
      | {
          kind: "cliff_plus_linear";
          cliff_days: number;
          linear_days: number;
          tge_pct?: number;
        }
      | {
          kind: "custom";
          entries: Array<{ date: string; pct: number }>;
        };
    switch (parsed.kind) {
      case "all_at_tge":
        return { ...empty, variant: "all_at_tge" };
      case "tge_plus_linear":
        return {
          variant: "tge_plus_linear",
          tgePct: String(parsed.tge_pct),
          linearDays: String(parsed.linear_days),
          cliffDays: "",
          entries: [],
        };
      case "cliff_plus_linear":
        return {
          variant: "cliff_plus_linear",
          tgePct: parsed.tge_pct != null ? String(parsed.tge_pct) : "",
          linearDays: String(parsed.linear_days),
          cliffDays: String(parsed.cliff_days),
          entries: [],
        };
      case "custom":
        return {
          variant: "custom",
          tgePct: "",
          linearDays: "",
          cliffDays: "",
          entries: parsed.entries.map((e) => ({
            id: crypto.randomUUID(),
            date: e.date.slice(0, 10),
            pct: String(e.pct),
          })),
        };
    }
  } catch {
    return empty;
  }
}

interface NumberInputProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  min?: number;
  max?: number;
  placeholder?: string;
}

function NumberInput({ label, value, onChange, min, max, placeholder }: NumberInputProps) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
        {label}
      </span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        min={min}
        max={max}
        step="any"
        placeholder={placeholder}
        className="w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-[13px] text-text"
      />
    </div>
  );
}
