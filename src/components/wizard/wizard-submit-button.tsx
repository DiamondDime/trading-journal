"use client";

import { ArrowRight, Loader2 } from "lucide-react";
import { useFormStatus } from "react-dom";
import { cn } from "@/lib/utils";

export interface WizardSubmitButtonProps {
  /** Button label. Use the wizard's "Log <type>" / "Save changes" copy. */
  children: React.ReactNode;
  /** Optional form id when the button lives outside its <form> element. */
  formId?: string;
  /** Extra Tailwind classes. */
  className?: string;
  /** When true, renders the disabled state regardless of form status. */
  disabledOverride?: boolean;
  /** Hide the trailing arrow icon (used by destructive submits). */
  hideArrow?: boolean;
}

/**
 * Wizard final-step submit button. Uses React DOM's `useFormStatus` to
 * disable itself + show a spinner the instant the surrounding <form>
 * starts submitting. Eliminates the double-submit bug that fires when
 * /review re-mounts mid-redirect and the user mashes the button twice.
 *
 * Drop-in replacement for the inline <button type="submit"> used in
 * every wizard's review/page.tsx — the parent simply moves the formId
 * onto this component.
 */
export function WizardSubmitButton({
  children,
  formId,
  className,
  disabledOverride = false,
  hideArrow = false,
}: WizardSubmitButtonProps) {
  const { pending } = useFormStatus();
  const disabled = pending || disabledOverride;
  return (
    <button
      type="submit"
      form={formId}
      disabled={disabled}
      aria-busy={pending || undefined}
      className={cn(
        "inline-flex items-center gap-2 rounded-md border px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] transition-colors",
        disabled
          ? "border-border bg-subtle text-text-disabled cursor-not-allowed"
          : "border-text bg-text text-app hover:bg-text-secondary",
        className,
      )}
    >
      {pending ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : null}
      <span>{children}</span>
      {!hideArrow && !pending && <ArrowRight className="h-3 w-3" />}
    </button>
  );
}
