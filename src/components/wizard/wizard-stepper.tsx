import { cn } from "@/lib/utils";

export interface WizardStepperProps {
  /** 1-indexed current step. */
  current: number;
  /** Total step count. */
  total: number;
  /** Short label per step (e.g. "Source", "Details", "Review"). */
  labels: readonly string[];
}

/**
 * Editorial step indicator. Numeral inside a hollow border for upcoming
 * steps, filled neutral surface for past, signature for current.
 * Renders `aria-current="step"` on the active dot for AT consumers.
 */
export function WizardStepper({ current, total, labels }: WizardStepperProps) {
  return (
    <ol
      className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary"
      aria-label="Wizard progress"
    >
      {labels.slice(0, total).map((label, idx) => {
        const stepNum = idx + 1;
        const isCurrent = stepNum === current;
        const isPast = stepNum < current;
        return (
          <li
            key={label}
            aria-current={isCurrent ? "step" : undefined}
            className="flex items-center gap-2"
          >
            <span
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded-full border text-[10px] tabular-nums leading-none",
                isCurrent &&
                  "border-signature bg-signature text-white",
                isPast && "border-text-tertiary bg-subtle text-text-secondary",
                !isCurrent && !isPast && "border-border text-text-tertiary"
              )}
            >
              {stepNum}
            </span>
            <span
              className={cn(
                isCurrent ? "text-text" : "text-text-tertiary",
                "text-[10px]"
              )}
            >
              {label}
            </span>
            {stepNum < total && (
              <span aria-hidden="true" className="ml-1 h-px w-6 bg-border" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
