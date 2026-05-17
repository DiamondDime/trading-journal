"use client";

import Link from "next/link";
import { Pencil } from "lucide-react";
import { useT } from "@/lib/i18n/client";

export interface WizardSummaryRowProps {
  /** Label shown on the left (mono, uppercase). */
  label: string;
  /** Value shown on the right — mono for numbers, serif for prose. */
  value: React.ReactNode;
  /**
   * If set, renders a small "Edit" link next to the value, pointing back to
   * the step that produced this field. The whole row is also linkable for
   * easier mousing.
   */
  editHref?: string;
  /** Tone of the value. Defaults to neutral text. */
  tone?: "up" | "down" | "signature" | "neutral";
  /** Use mono for the value. Defaults to true for numeric callsites. */
  mono?: boolean;
}

/**
 * One row in a review summary. Left label, right value, optional edit link.
 * Composed by the review step to lay out every entered field.
 */
export function WizardSummaryRow({
  label,
  value,
  editHref,
  tone = "neutral",
  mono = true,
}: WizardSummaryRowProps) {
  const t = useT();
  const toneClass =
    tone === "up"
      ? "text-up"
      : tone === "down"
      ? "text-down"
      : tone === "signature"
      ? "text-signature"
      : "text-text";

  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border-subtle py-3 last:border-b-0">
      <span className="w-44 shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
        {label}
      </span>
      <div className="flex flex-1 items-baseline justify-end gap-3 text-right">
        <span
          className={
            (mono
              ? "font-mono tabular-nums text-[13px]"
              : "font-serif text-[14px]") + " " + toneClass
          }
        >
          {value}
        </span>
        {editHref && (
          <Link
            href={editHref}
            className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.16em] text-text-tertiary transition-colors hover:text-text"
          >
            <Pencil className="h-2.5 w-2.5" />
            {t("common.edit")}
          </Link>
        )}
      </div>
    </div>
  );
}
