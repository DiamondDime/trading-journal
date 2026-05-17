"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Plug } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ImportedTradeFill } from "@/lib/data/exchange-fills-mock";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import { ExchangeChip } from "@/components/settings/exchange-logo";

interface ManualBuilderProps {
  fills: ImportedTradeFill[];
}

function fmtPrice(n: number) {
  if (n < 1) return n.toLocaleString("en-US", { maximumSignificantDigits: 4 });
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtQty(n: number) {
  if (n >= 1_000_000) return n.toExponential(2);
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (n < 1) return n.toLocaleString("en-US", { maximumSignificantDigits: 4 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function fmtUsd(n: number, signed = false) {
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const sign = signed ? (n >= 0 ? "+" : "−") : n < 0 ? "−" : "";
  return `${sign}$${abs}`;
}

/**
 * Right-pane builder. Renders a multi-select table of imported fills; the
 * sticky bottom CTA enables once ≥2 legs are checked and navigates to the
 * type-picker step with the selection encoded in `?legs=`.
 *
 * Client component because the row checkboxes need React state — every other
 * surface in this wizard is server-rendered.
 *
 * Selection is mirrored into the URL as `?selected=fill-a,fill-b`. This makes
 * the pick step survive back-navigation from /add/spread/type — when the
 * user clicks "Back" from the next step, the same checkboxes are still
 * ticked. We hydrate from the URL on mount only; subsequent edits flow one
 * way (state → URL) so the URL never overwrites in-progress changes.
 */
export function ManualBuilder({ fills }: ManualBuilderProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useT();

  // Hydrate once from the URL. Intentionally [] deps — re-reading later
  // would let URL changes clobber the user's in-progress selection.
  const initialSelected = React.useMemo(() => {
    const v = searchParams.get("selected");
    if (!v) return new Set<string>();
    const validIds = new Set(fills.map((f) => f.id));
    return new Set(v.split(",").filter((id) => id && validIds.has(id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [selected, setSelected] =
    React.useState<Set<string>>(initialSelected);

  const toggle = React.useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Mirror selection → URL. Only call router.replace when the canonical
  // query string actually differs from what's already in the URL; this
  // prevents loops and avoids overwriting matching state on mount.
  React.useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (selected.size > 0) {
      params.set("selected", [...selected].join(","));
    } else {
      params.delete("selected");
    }
    const next = params.toString();
    const current = searchParams.toString();
    if (next === current) return;
    router.replace(next ? `?${next}` : "?", { scroll: false });
    // searchParams is intentionally omitted from deps — we only re-run when
    // local selection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, router]);

  const count = selected.size;
  const canContinue = count >= 2;
  const params = new URLSearchParams();
  // Preserve insertion order for nicer URLs in the next step.
  for (const id of selected) params.append("legs", id);
  params.set("matcher", "manual");
  const continueHref = `/add/spread/type?${params.toString()}`;

  return (
    <div className="flex h-full flex-col">
      <header className="mb-3 flex items-baseline justify-between">
        <div>
          <h3 className="font-serif text-[15px] font-medium text-text">
            {t("wizard.spread.manual.heading")}
          </h3>
          <p className="mt-0.5 font-serif text-[12px] italic text-text-tertiary">
            {t("wizard.spread.manual.subheading")}
          </p>
        </div>
        <span
          aria-live="polite"
          className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary"
        >
          {t("wizard.spread.manual.selectedCount", { count })}
        </span>
      </header>

      <div className="overflow-hidden rounded-md border border-border bg-surface">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead
                scope="col"
                className="w-8 font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary"
              >
                <span className="sr-only">{t("wizard.spread.manual.col.selected")}</span>
              </TableHead>
              <TableHead
                scope="col"
                className="font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary"
              >
                {t("wizard.spread.manual.col.symbol")}
              </TableHead>
              <TableHead
                scope="col"
                className="font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary"
              >
                {t("wizard.spread.manual.col.side")}
              </TableHead>
              <TableHead
                scope="col"
                className="text-right font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary"
              >
                {t("wizard.spread.manual.col.qty")}
              </TableHead>
              <TableHead
                scope="col"
                className="text-right font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary"
              >
                {t("wizard.spread.manual.col.entryExit")}
              </TableHead>
              <TableHead
                scope="col"
                className="font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary"
              >
                {t("wizard.spread.manual.col.closed")}
              </TableHead>
              <TableHead
                scope="col"
                className="text-right font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary"
              >
                {t("wizard.spread.manual.col.pnl")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {fills.map((f) => {
              const checked = selected.has(f.id);
              const rowId = `manual-fill-${f.id}`;
              return (
                <TableRow
                  key={f.id}
                  className={cn(
                    "cursor-pointer transition-colors",
                    checked ? "bg-subtle hover:bg-subtle" : "hover:bg-subtle/60"
                  )}
                  onClick={() => toggle(f.id)}
                  aria-selected={checked}
                >
                  <TableCell className="py-2">
                    <input
                      id={rowId}
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(f.id)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={t("wizard.spread.manual.rowAria", {
                        symbol: f.symbol,
                        side: f.side,
                        exchange: f.exchange,
                      })}
                      className="h-3.5 w-3.5 rounded border-border accent-signature"
                    />
                  </TableCell>
                  <TableCell className="py-2">
                    <label
                      htmlFor={rowId}
                      className="flex cursor-pointer items-center gap-2"
                    >
                      <ExchangeChip
                        venue={f.exchange}
                        size="sm"
                        className="shrink-0"
                      />
                      <span className="flex flex-col gap-0.5">
                        <span className="font-serif text-[13px] font-medium text-text">
                          {f.symbol}
                        </span>
                        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-text-tertiary">
                          {f.exchange} · {f.instrument}
                          {f.expiry ? ` · ${f.expiry}` : ""}
                        </span>
                      </span>
                    </label>
                  </TableCell>
                  <TableCell className="py-2">
                    <span
                      className={cn(
                        "font-mono text-[10px] uppercase tracking-[0.14em]",
                        f.side === "long" ? "text-up" : "text-down"
                      )}
                    >
                      {f.side}
                    </span>
                  </TableCell>
                  <TableCell className="py-2 text-right font-mono text-[11px] tabular-nums text-text-secondary">
                    {fmtQty(f.qty)}
                  </TableCell>
                  <TableCell className="py-2 text-right">
                    <span className="font-mono text-[11px] tabular-nums text-text">
                      {fmtPrice(f.entryPrice)}
                    </span>
                    <span className="mx-1 text-text-tertiary">→</span>
                    <span className="font-mono text-[11px] tabular-nums text-text-secondary">
                      {fmtPrice(f.exitPrice)}
                    </span>
                  </TableCell>
                  <TableCell className="py-2 font-serif text-[12px] italic text-text-secondary">
                    {f.closedLabel}
                  </TableCell>
                  <TableCell className="py-2 text-right">
                    <span
                      className={cn(
                        "font-mono text-[11px] font-medium tabular-nums",
                        f.tone === "up" ? "text-up" : "text-down"
                      )}
                    >
                      {fmtUsd(f.netPnl, true)}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Sticky CTA — shown once anything is selected, becomes active at ≥2. */}
      <div
        className={cn(
          "sticky bottom-0 mt-4 rounded-md border border-border bg-surface/95 p-3 backdrop-blur transition-opacity",
          count === 0 && "opacity-0 pointer-events-none"
        )}
        aria-hidden={count === 0}
      >
        <div className="flex items-center justify-between gap-3">
          <p
            className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary"
            aria-live="polite"
          >
            {t.plural("wizard.spread.manual.legsSelected", count)}
            {count < 2 && (
              <span className="ml-2 text-text-disabled">
                {t("wizard.spread.manual.selectMore")}
              </span>
            )}
          </p>
          {canContinue ? (
            <Link
              href={continueHref}
              className="inline-flex items-center gap-2 rounded-md border border-text bg-text px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-app transition-colors hover:bg-text-secondary"
            >
              {t("wizard.spread.manual.useSelected")}
              <ArrowRight className="h-3 w-3" />
            </Link>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-md border border-border bg-subtle px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-text-disabled">
              <Plug className="h-3 w-3" />
              {t("wizard.spread.manual.needTwo")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
