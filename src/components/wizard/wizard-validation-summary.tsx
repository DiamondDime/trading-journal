import { cn } from "@/lib/utils";

export interface WizardValidationIssue {
  /** Form field path (e.g. "claimDate", "legs.0.strike"). Used as the React key
   *  and surfaced as a small mono prefix when present. */
  field?: string;
  /** Human-readable message. Trim/format before passing in. */
  message: string;
}

export interface WizardValidationSummaryProps {
  /** Issues to display. Empty array renders nothing. */
  errors: WizardValidationIssue[];
  /** Visual tone — error (default red) or warning (amber). */
  tone?: "error" | "warning";
  /** Override the heading copy. Defaults to "Fix these before continuing". */
  title?: string;
  /** Extra Tailwind classes. */
  className?: string;
}

/**
 * Inline form-level validation surface. Shown above the form fields when a
 * server-side parse fails — the wizard redirects back with the issue list
 * encoded in the URL and the step page renders this above the inputs.
 *
 * Server component. Issues are static at render time; no JS state.
 */
export function WizardValidationSummary({
  errors,
  tone = "error",
  title,
  className,
}: WizardValidationSummaryProps) {
  if (errors.length === 0) return null;
  const toneClasses =
    tone === "warning"
      ? "border-warn/40 bg-warn/5 text-warn"
      : "border-down/40 bg-down/5 text-down";

  return (
    <section
      role="alert"
      aria-live="polite"
      className={cn(
        "rounded-md border px-4 py-3 font-mono text-[11px]",
        toneClasses,
        className,
      )}
    >
      <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.16em]">
        {title ?? "Fix these before continuing"}
      </p>
      <ul className="flex flex-col gap-1">
        {errors.map((e, i) => (
          <li
            key={`${e.field ?? "form"}-${i}`}
            className="flex items-start gap-2"
          >
            <span aria-hidden className="mt-1 inline-block h-1 w-1 shrink-0 rounded-full bg-current opacity-60" />
            <span>
              {e.field && (
                <span className="opacity-70">{e.field}: </span>
              )}
              {e.message}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
