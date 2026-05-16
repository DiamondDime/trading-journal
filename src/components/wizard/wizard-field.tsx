import { cn } from "@/lib/utils";

export interface WizardFieldProps {
  /** Field label — rendered above the input. */
  label: string;
  /** htmlFor on the <label>. Must match the rendered input's id. */
  htmlFor: string;
  /** Optional helper text shown below the input. */
  helper?: string;
  /** Optional error text — appears in red and supersedes `helper`. */
  error?: string;
  /** True for required fields. Adds a small mono "·required" cue. */
  required?: boolean;
  /** Lays the label inline with the input. Defaults to stacked. */
  inline?: boolean;
  className?: string;
  children: React.ReactNode;
}

/**
 * Editorial labeled form field. Stacks label, input slot, and helper/error
 * text. Used for every text/number/select input in the wizard.
 */
export function WizardField({
  label,
  htmlFor,
  helper,
  error,
  required,
  inline = false,
  className,
  children,
}: WizardFieldProps) {
  return (
    <div
      className={cn(
        inline ? "flex items-center gap-4" : "flex flex-col gap-1.5",
        className
      )}
    >
      <label
        htmlFor={htmlFor}
        className={cn(
          "font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary",
          inline ? "w-32 shrink-0" : ""
        )}
      >
        {label}
        {required && (
          <span className="ml-1.5 text-text-disabled">· required</span>
        )}
      </label>
      <div className={cn(inline ? "flex-1" : "")}>{children}</div>
      {(error || helper) && (
        <p
          className={cn(
            "font-mono text-[10px]",
            inline ? "col-start-2" : "",
            error ? "text-down" : "text-text-tertiary"
          )}
        >
          {error ?? helper}
        </p>
      )}
    </div>
  );
}

/**
 * Plain text/number/datetime-local input with the editorial style applied.
 * Use directly inside <WizardField>. The wrapper supplies the id ↔ label
 * link; this just supplies the visuals.
 */
export function WizardInput(
  props: React.InputHTMLAttributes<HTMLInputElement>
) {
  const { className, ...rest } = props;
  return (
    <input
      {...rest}
      className={cn(
        "w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-[13px] text-text placeholder:text-text-disabled focus:border-border-strong focus:outline-none focus:ring-1 focus:ring-text",
        className
      )}
    />
  );
}

/** Multiline counterpart of WizardInput. */
export function WizardTextarea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement>
) {
  const { className, ...rest } = props;
  return (
    <textarea
      {...rest}
      className={cn(
        "w-full rounded-md border border-border bg-surface px-3 py-2 font-serif text-[14px] leading-relaxed text-text placeholder:text-text-disabled focus:border-border-strong focus:outline-none focus:ring-1 focus:ring-text",
        className
      )}
    />
  );
}

/** Plain HTML <select> styled to match WizardInput. */
export function WizardSelect(
  props: React.SelectHTMLAttributes<HTMLSelectElement>
) {
  const { className, ...rest } = props;
  return (
    <select
      {...rest}
      className={cn(
        "w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-[13px] text-text focus:border-border-strong focus:outline-none focus:ring-1 focus:ring-text",
        className
      )}
    />
  );
}
