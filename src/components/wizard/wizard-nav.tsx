"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";

export interface WizardNavProps {
  /** Optional href for the Back link. Omit on the first step. */
  backHref?: string;
  /**
   * Either a destination href (renders an <a>) or a form name for the
   * Continue button (renders a <button type="submit">). At least one is
   * required.
   */
  continueHref?: string;
  /**
   * The form id that the Continue button submits, when continueHref is not
   * set. If provided alongside a form="<id>" on a parent <form>, this lets
   * the bottom-fixed nav live outside the form element.
   */
  continueFormId?: string;
  /** Disables the Continue button (only meaningful when it's a <button>). */
  disabled?: boolean;
  /** Custom label for the Continue button. Defaults to the i18n "Continue". */
  continueLabel?: string;
}

/**
 * Wizard bottom nav. Back returns to a known href (browser back is also
 * always available). Continue either navigates (when continueHref is set)
 * or submits a form (when continueFormId is set).
 *
 * Client component only to keep the disabled state reactive without
 * touching server state.
 */
export function WizardNav({
  backHref,
  continueHref,
  continueFormId,
  disabled = false,
  continueLabel,
}: WizardNavProps) {
  const t = useT();
  const continueText = continueLabel ?? t("wizard.shell.continue");
  return (
    <div className="mt-12 flex items-center justify-between border-t border-border pt-6">
      {backHref ? (
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-text-tertiary transition-colors hover:text-text"
        >
          <ArrowLeft className="h-3 w-3" />
          {t("wizard.shell.back")}
        </Link>
      ) : (
        <span />
      )}

      {continueHref ? (
        <Link
          href={disabled ? "#" : continueHref}
          aria-disabled={disabled || undefined}
          tabIndex={disabled ? -1 : 0}
          className={cn(
            "inline-flex items-center gap-2 rounded-md border px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] transition-colors",
            disabled
              ? "pointer-events-none border-border bg-subtle text-text-disabled"
              : "border-text bg-text text-app hover:bg-text-secondary"
          )}
        >
          {continueText}
          <ArrowRight className="h-3 w-3" />
        </Link>
      ) : continueFormId ? (
        <button
          type="submit"
          form={continueFormId}
          disabled={disabled}
          className={cn(
            "inline-flex items-center gap-2 rounded-md border px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] transition-colors",
            disabled
              ? "border-border bg-subtle text-text-disabled"
              : "border-text bg-text text-app hover:bg-text-secondary"
          )}
        >
          {continueText}
          <ArrowRight className="h-3 w-3" />
        </button>
      ) : (
        // No continuation target — caller relies on the in-page options (radio
        // cards, link rows) to advance. Render only a Back link.
        <span />
      )}
    </div>
  );
}
