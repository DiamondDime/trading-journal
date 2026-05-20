"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import { ExchangeChip } from "@/components/settings/exchange-logo";

// ── Prop shapes ──────────────────────────────────────────────────────────────

/** Mirrors `PickerOptionRow` from `../db.ts` — kept local so the server
 *  module does not carry a `"use client"` re-export. */
export interface SuggestionLeg {
  id: string;
  positionId: string;
  symbol: string;
  instrumentKind: string;
  exchangeCode: string;
  side: "long" | "short";
  qty: string;
  avgEntryPrice: string;
  avgExitPrice: string | null;
  openedAt: string;
  closedAt: string | null;
  status: "open" | "closed";
  matchConfidence?: number | null;
  suggestedType?: string | null;
}

export interface SuggestionGroup {
  candidateId: string;
  suggestedType: string;
  confidence: number;
  legs: SuggestionLeg[];
}

interface SuggestionListProps {
  suggestions: SuggestionGroup[];
}

// ── Formatting helpers (mirrors page.tsx — kept local so this module stays
//    self-contained and page.tsx doesn't have to import from a client file) ──

function fmtPrice(n: string | number) {
  const v = typeof n === "string" ? Number.parseFloat(n) : n;
  if (!Number.isFinite(v)) return String(n);
  if (v < 1) return v.toLocaleString("en-US", { maximumSignificantDigits: 4 });
  return v.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtQty(n: string | number) {
  const v = typeof n === "string" ? Number.parseFloat(n) : n;
  if (!Number.isFinite(v)) return String(n);
  if (v >= 1_000_000) return v.toExponential(2);
  if (v >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (v < 1) return v.toLocaleString("en-US", { maximumSignificantDigits: 4 });
  return v.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function closedLabel(closedAt: string | null, status: string): string {
  if (status === "open") return "open";
  if (!closedAt) return "—";
  const d = new Date(closedAt);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Renders the auto-detected suggestion cards with dismiss buttons.
 * Dismissed candidates are hidden immediately (optimistic) via local state;
 * the reject call to /api/spreads/candidates/[id]/reject fires in the
 * background and is rolled back if the server rejects it.
 */
export function SuggestionList({ suggestions }: SuggestionListProps) {
  const t = useT();
  const [dismissed, setDismissed] = React.useState<ReadonlySet<string>>(
    new Set(),
  );
  const [pending, setPending] = React.useState<ReadonlySet<string>>(new Set());

  const visible = suggestions.filter((s) => !dismissed.has(s.candidateId));

  async function handleDismiss(candidateId: string) {
    // Optimistic: hide the card immediately.
    setDismissed((prev) => new Set([...prev, candidateId]));
    setPending((prev) => new Set([...prev, candidateId]));

    try {
      const res = await fetch(
        `/api/spreads/candidates/${candidateId}/reject`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      if (!res.ok) {
        // Server didn't record the rejection — roll the card back into view.
        setDismissed((prev) => {
          const next = new Set(prev);
          next.delete(candidateId);
          return next;
        });
      }
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(candidateId);
        return next;
      });
    }
  }

  if (visible.length === 0) {
    return <EmptyState />;
  }

  return (
    <ul className="flex flex-col gap-3">
      {visible.map((s) => (
        <SuggestionCard
          key={s.candidateId}
          suggestion={s}
          isDismissing={pending.has(s.candidateId)}
          onDismiss={() => handleDismiss(s.candidateId)}
          t={t}
        />
      ))}
    </ul>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────────

const DB_TO_MATCHER: Record<string, string> = {
  cash_carry: "cash_carry",
  funding_capture: "funding",
  cross_exchange_perp_arb: "cross_exchange",
  calendar: "calendar",
  dex_cex_arb: "dex_cex",
};

type TFunction = ReturnType<typeof useT>;

function localizedSpreadTypeLabel(spreadType: string, t: TFunction): string {
  if (
    spreadType === "cash_carry" ||
    spreadType === "funding" ||
    spreadType === "cross_exchange" ||
    spreadType === "calendar" ||
    spreadType === "dex_cex"
  ) {
    return t(`wizard.shell.spreadTypeLabels.${spreadType}` as const);
  }
  return spreadType;
}

function SuggestionCard({
  suggestion,
  isDismissing,
  onDismiss,
  t,
}: {
  suggestion: SuggestionGroup;
  isDismissing: boolean;
  onDismiss: () => void;
  t: TFunction;
}) {
  const legIds = suggestion.legs.map((l) => l.positionId).join(",");
  const matcherKey = DB_TO_MATCHER[suggestion.suggestedType] ?? "cash_carry";
  const params = new URLSearchParams({
    legs: legIds,
    spreadType: matcherKey,
    matcher: "auto",
  });
  const href = `/add/spread/type?${params.toString()}`;

  return (
    <li>
      <article className="group rounded-md border border-border bg-surface p-4 transition-colors hover:border-border-strong">
        <header className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-subtle px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary">
            {localizedSpreadTypeLabel(matcherKey, t)}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
            {t("wizard.spread.pick.score")}{" "}
            <span className="text-text">{suggestion.confidence.toFixed(2)}</span>
          </span>
        </header>

        <ul className="mt-3 divide-y divide-border-subtle">
          {suggestion.legs.map((leg) => (
            <li
              key={leg.positionId}
              className="flex items-center justify-between gap-3 py-2"
            >
              <div className="flex items-center gap-2 leading-tight">
                <ExchangeChip
                  venue={leg.exchangeCode}
                  size="sm"
                  className="shrink-0"
                />
                <div className="flex flex-col">
                  <span className="font-serif text-[13px] font-medium text-text">
                    {leg.symbol}
                  </span>
                  <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-text-tertiary">
                    {leg.exchangeCode} · {leg.instrumentKind}
                  </span>
                </div>
              </div>
              <div className="flex items-baseline gap-3">
                <span
                  className={cn(
                    "font-mono text-[10px] uppercase tracking-[0.14em]",
                    leg.side === "long" ? "text-up" : "text-down",
                  )}
                >
                  {leg.side}
                </span>
                <span className="font-mono text-[11px] tabular-nums text-text-secondary">
                  {fmtQty(leg.qty)}
                </span>
                <span className="font-mono text-[11px] tabular-nums text-text">
                  {fmtPrice(leg.avgEntryPrice)}
                </span>
                {leg.avgExitPrice && (
                  <>
                    <span className="text-text-tertiary">→</span>
                    <span className="font-mono text-[11px] tabular-nums text-text-secondary">
                      {fmtPrice(leg.avgExitPrice)}
                    </span>
                  </>
                )}
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
                  {closedLabel(leg.closedAt, leg.status)}
                </span>
              </div>
            </li>
          ))}
        </ul>

        <footer className="mt-3 flex items-end justify-between gap-3">
          <p className="max-w-[42ch] font-serif text-[12px] italic leading-snug text-text-tertiary">
            {t("wizard.spread.pick.matcherRationale", {
              confidence: (suggestion.confidence * 100).toFixed(0),
            })}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onDismiss}
              disabled={isDismissing}
              aria-label={t("wizard.spread.pick.dismissAriaLabel")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary transition-colors",
                "hover:border-border-strong hover:text-text",
                "disabled:cursor-not-allowed disabled:opacity-40",
              )}
            >
              <X className="h-3 w-3" aria-hidden="true" />
              {t("wizard.spread.pick.dismiss")}
            </button>
            <Link
              href={href}
              className="inline-flex items-center gap-2 rounded-md border border-text bg-text px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-app transition-colors hover:bg-text-secondary"
            >
              {t("wizard.spread.pick.useThese")}
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </footer>
      </article>
    </li>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  const t = useT();
  return (
    <div className="rounded-md border border-dashed border-border bg-surface p-8 text-center">
      <p className="font-serif text-[14px] italic text-text-tertiary">
        {t("wizard.spread.pick.empty.heading")}
      </p>
      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
        {t("wizard.spread.pick.empty.body")}
      </p>
    </div>
  );
}
