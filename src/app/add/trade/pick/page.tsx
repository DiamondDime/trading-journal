import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardNav } from "@/components/wizard/wizard-nav";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { IMPORTED_FILLS } from "@/lib/data/exchange-fills-mock";
import { cn } from "@/lib/utils";

export const dynamic = "force-static";

const STEP_LABELS = ["Source", "Details", "Review"] as const;

function fmtUsd(n: number, signed = false) {
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const sign = signed ? (n >= 0 ? "+" : "−") : n < 0 ? "−" : "";
  return `${sign}$${abs}`;
}

function fmtPrice(n: number) {
  if (n < 1) {
    // Up to 8 significant digits for sub-dollar prices (PEPE etc.)
    return n.toLocaleString("en-US", { maximumSignificantDigits: 4 });
  }
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

export default function TradePickPage() {
  return (
    <WizardShell
      type="trade"
      step={1}
      totalSteps={3}
      stepLabels={STEP_LABELS}
      title="Pick a trade from your exchange history"
      subtitle="These are the recent fills synced from your connected exchanges. Click one to pre-fill the form."
    >
      <div className="overflow-hidden rounded-md border border-border bg-surface">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
                Symbol
              </TableHead>
              <TableHead className="font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
                Side
              </TableHead>
              <TableHead className="text-right font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
                Entry → Exit
              </TableHead>
              <TableHead className="text-right font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
                Qty
              </TableHead>
              <TableHead className="text-right font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
                Held
              </TableHead>
              <TableHead className="font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
                Closed
              </TableHead>
              <TableHead className="text-right font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
                P&amp;L
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {IMPORTED_FILLS.map((f) => {
              const params = new URLSearchParams({
                exchange: f.exchange,
                symbol: f.symbol,
                instrument: f.instrument,
                side: f.side,
                qty: String(f.qty),
                entryPrice: String(f.entryPrice),
                exitPrice: String(f.exitPrice),
                capital: String(f.capital),
                fees: String(f.fees),
                openedAt: f.openedAt,
                closedAt: f.closedAt,
                source: f.id,
              });
              const href = `/add/trade/fields?${params.toString()}`;
              return (
                <TableRow
                  key={f.id}
                  className="group cursor-pointer transition-colors hover:bg-subtle"
                >
                  <TableCell className="p-0">
                    <Link
                      href={href}
                      className="flex flex-col gap-0.5 px-4 py-3"
                      aria-label={`Pick ${f.symbol} ${f.side} on ${f.exchange}`}
                    >
                      <span className="font-serif text-[14px] font-medium text-text">
                        {f.symbol}
                      </span>
                      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
                        {f.exchange} · {f.instrument}
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link href={href} className="block">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em]",
                          f.side === "long" ? "text-up" : "text-down"
                        )}
                      >
                        {f.side}
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={href} className="block">
                      <span className="font-mono text-[12px] tabular-nums text-text">
                        {fmtPrice(f.entryPrice)}
                      </span>
                      <span className="mx-1 text-text-tertiary">→</span>
                      <span className="font-mono text-[12px] tabular-nums text-text-secondary">
                        {fmtPrice(f.exitPrice)}
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={href} className="block font-mono text-[12px] tabular-nums text-text-secondary">
                      {fmtQty(f.qty)}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={href} className="block font-mono text-[12px] tabular-nums text-text-secondary">
                      {f.daysLabel}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link href={href} className="block font-serif text-[12px] italic text-text-secondary">
                      {f.closedLabel}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={href} className="flex items-center justify-end gap-1.5">
                      <span
                        className={cn(
                          "font-mono text-[12px] font-medium tabular-nums",
                          f.tone === "up" ? "text-up" : "text-down"
                        )}
                      >
                        {fmtUsd(f.netPnl, true)}
                      </span>
                      <ArrowUpRight className="h-3 w-3 text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
                    </Link>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <p className="mt-6 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
        Couldn&apos;t find it?{" "}
        <Link
          href="/add/trade/fields"
          className="underline-offset-4 hover:text-text hover:underline"
        >
          → Enter manually
        </Link>
      </p>

      <WizardNav backHref="/add/trade/source" />
    </WizardShell>
  );
}
