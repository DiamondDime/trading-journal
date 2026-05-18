import * as React from "react";
import { cn } from "@/lib/utils";

export interface WizardRadioRowOption {
  /** Form value. */
  value: string;
  /** Headline label — same row as the radio dot. */
  title: string;
  /** Sub-line / description under the title. Optional. */
  description?: string;
  /** Optional icon slot — usually a Lucide icon at h-3.5 w-3.5. */
  icon?: React.ReactNode;
  /** Optional accent tone for the selected state (matches up/down). */
  tone?: "up" | "down" | "neutral";
  /** When true, the option renders disabled. */
  disabled?: boolean;
}

export interface WizardRadioRowProps {
  /** name= of the underlying radio inputs. */
  name: string;
  /** Pre-selected value (server side; the wizard has no local state). */
  defaultValue?: string;
  /** When true, requires a selection before the form can submit. */
  required?: boolean;
  /** Visible group label (renders as the fieldset legend). */
  legend?: string;
  /** Small mono cue, e.g. "· required". Rendered next to the legend. */
  requiredCue?: string;
  /** Choices to render. Order is the visual order. */
  options: WizardRadioRowOption[];
  /**
   * Visual layout. "row" = compact horizontal pill row (current Trade flow).
   * "grid" = 2-up grid that wraps on small screens (Sale-kind picker).
   * "cards" = vertical stack of full-card options with description. Default
   * is auto-picked from the option count + presence of descriptions.
   */
  variant?: "row" | "grid" | "cards";
}

/**
 * Editorial radio row. Same Tailwind treatment as the inline RadioRow /
 * RadioGrid patterns scattered through the wizard step pages. Extracted to
 * one component so all wizards share visual parity and the new flows
 * (yield_position, option) don't drift.
 *
 * Selection state is driven by the `:has()` variant against the hidden
 * radio input — works with browser-native form submission, no client JS.
 */
export function WizardRadioRow({
  name,
  defaultValue,
  required,
  legend,
  requiredCue,
  options,
  variant,
}: WizardRadioRowProps) {
  const id = `radio-${name}`;
  // Auto-pick the visual layout: "cards" when there are descriptions
  // (yield-kind picker, option-style picker), "grid" for 4-item flat lists
  // (sale-kind picker), "row" for 2-3 pill options (trade instrument/side).
  const hasDescriptions = options.some((o) => Boolean(o.description));
  const chosenVariant: NonNullable<WizardRadioRowProps["variant"]> =
    variant ?? (hasDescriptions ? "cards" : options.length > 3 ? "grid" : "row");

  return (
    <fieldset className="flex flex-col gap-1.5">
      {legend && (
        <legend
          id={id}
          className="mb-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary"
        >
          {legend}
          {requiredCue && (
            <span className="ml-1.5 text-text-disabled">{requiredCue}</span>
          )}
        </legend>
      )}
      <div
        role="radiogroup"
        aria-labelledby={legend ? id : undefined}
        className={cn(
          chosenVariant === "row" && "grid grid-cols-3 gap-2",
          chosenVariant === "grid" && "grid grid-cols-2 gap-2 md:grid-cols-4",
          chosenVariant === "cards" &&
            "flex flex-col gap-2 md:grid md:grid-cols-2",
        )}
      >
        {options.map((opt) => (
          <label
            key={opt.value}
            className={cn(
              "group relative cursor-pointer rounded-md border transition-colors",
              chosenVariant === "row" &&
                "flex items-center justify-center gap-1.5 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em]",
              chosenVariant === "grid" &&
                "flex items-center justify-center gap-1.5 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em]",
              chosenVariant === "cards" &&
                "flex flex-col gap-1.5 p-4",
              "border-border bg-surface text-text-secondary",
              "hover:border-border-strong hover:text-text",
              "has-[input:checked]:border-text has-[input:checked]:bg-subtle has-[input:checked]:text-text",
              opt.tone === "up" &&
                "has-[input:checked]:border-up has-[input:checked]:bg-up/10 has-[input:checked]:text-up",
              opt.tone === "down" &&
                "has-[input:checked]:border-down has-[input:checked]:bg-down/10 has-[input:checked]:text-down",
              opt.disabled && "pointer-events-none opacity-50",
            )}
          >
            <input
              type="radio"
              name={name}
              value={opt.value}
              defaultChecked={defaultValue === opt.value}
              required={required}
              disabled={opt.disabled}
              className="sr-only"
            />
            {chosenVariant === "cards" ? (
              <>
                <span className="flex items-center gap-2">
                  {opt.icon}
                  <span className="font-serif text-[14px] font-medium leading-tight text-text">
                    {opt.title}
                  </span>
                </span>
                {opt.description && (
                  <span className="font-serif text-[12px] italic leading-snug text-text-tertiary">
                    {opt.description}
                  </span>
                )}
              </>
            ) : (
              <>
                {opt.icon}
                <span>{opt.title}</span>
              </>
            )}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
