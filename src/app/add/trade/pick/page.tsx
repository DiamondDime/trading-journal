import Link from "next/link";
import { redirect } from "next/navigation";
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
import { cn } from "@/lib/utils";
import { getT } from "@/lib/i18n/server";
import { ExchangeChip } from "@/components/settings/exchange-logo";
import { requireUser } from "@/lib/auth/server";
import { listOpenPositionsForUser } from "../db";

export const dynamic = "force-dynamic";

type Search = Promise<{ [key: string]: string | string[] | undefined }>;

function getStr(sp: Awaited<Search>, key: string, fallback = ""): string {
  const v = sp[key];
  if (typeof v === "string") return v;
  return fallback;
}

function fmtPrice(n: number) {
  if (!Number.isFinite(n) || n === 0) return "—";
  if (n < 1) return n.toLocaleString("en-US", { maximumSignificantDigits: 4 });
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtQty(n: number) {
  if (!Number.isFinite(n) || n === 0) return "—";
  if (n >= 1_000_000) return n.toExponential(2);
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (n < 1) return n.toLocaleString("en-US", { maximumSignificantDigits: 4 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function fmtDays(d: number): string {
  if (!Number.isFinite(d) || d <= 0) return "—";
  if (d < 1) return `${Math.round(d * 24)}h`;
  if (d < 30) return `${d.toFixed(1)}d`;
  return `${d.toFixed(0)}d`;
}

/**
 * Trade picker. Queries open positions from the user's DB filtered by trade
 * kind. Replaces the v1 mock that read from `IMPORTED_FILLS` — that table was
 * never populated by the worker, so the picker always showed the same 6
 * demo rows regardless of which exchanges the user had connected.
 *
 * Acts as a flow-router for cases where the picker doesn't apply:
 *   - source=manual           → /fields
 *   - kind in {otc, nft, option} → /fields (no exchange-fill backing)
 *
 * Re-routing happens via `redirect()` before any UI renders so the URL stays
 * clean and the back-button history doesn't include a momentary picker visit.
 */
export default async function TradePickPage(props: { searchParams: Search }) {
  const t = await getT();
  const sp = await props.searchParams;

  const source = getStr(sp, "source") === "auto" ? "auto" : "manual";
  const kind = getStr(sp, "kind", "spot");

  // Re-route the cases where the picker is structurally inapplicable.
  if (source === "manual" || kind === "otc" || kind === "nft" || kind === "option") {
    const params = new URLSearchParams({ source, kind });
    redirect(`/add/trade/fields?${params.toString()}`);
  }

  const STEP_LABELS = [
    t("wizard.trade.stepLabels.source"),
    t("wizard.trade.stepLabels.kind"),
    t("wizard.trade.stepLabels.pick"),
    t("wizard.trade.stepLabels.details"),
    t("wizard.trade.stepLabels.review"),
  ] as const;

  // Spot / perp / dated_future map directly. The DB filter takes the
  // instrument_type form ('dated_future', not 'future').
  const dbKind: "spot" | "perp" | "dated_future" =
    kind === "perp" ? "perp" : kind === "dated_future" ? "dated_future" : "spot";

  const { id: userId } = await requireUser();
  const positions = await listOpenPositionsForUser(userId, dbKind);

  return (
    <WizardShell
      type="trade"
      step={3}
      totalSteps={5}
      stepLabels={STEP_LABELS}
      title={t("wizard.trade.pick.title")}
      subtitle={t("wizard.trade.pick.subtitle")}
    >
      {positions.length === 0 ? (
        <div className="rounded-md border border-border bg-surface px-5 py-8 text-center">
          <p className="font-serif text-[14px] italic text-text-secondary">
            {t("wizard.trade.pick.emptyTitle")}
          </p>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
            {t("wizard.trade.pick.emptySubtitle")}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-border bg-surface">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
                  {t("wizard.trade.pick.columns.symbol")}
                </TableHead>
                <TableHead className="font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
                  {t("wizard.trade.pick.columns.side")}
                </TableHead>
                <TableHead className="text-right font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
                  {t("wizard.trade.pick.columns.entry")}
                </TableHead>
                <TableHead className="text-right font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
                  {t("wizard.trade.pick.columns.qty")}
                </TableHead>
                <TableHead className="text-right font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
                  {t("wizard.trade.pick.columns.held")}
                </TableHead>
                <TableHead className="text-right font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
                  {t("wizard.trade.pick.columns.capital")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {positions.map((p) => {
                const params = new URLSearchParams({
                  source,
                  kind,
                  positionId: p.positionId,
                  exchange: p.exchangeLabel,
                  symbol: p.symbol,
                  instrument: p.instrument,
                  side: p.side,
                  qty: p.qty,
                  entryPrice: p.avgEntryPrice,
                  capital: p.capital,
                  fees: p.feesPaid,
                  openedAt: p.openedAt,
                  status: "open", // picker only returns open positions
                });
                const href = `/add/trade/fields?${params.toString()}`;
                return (
                  <TableRow
                    key={p.positionId}
                    className="group cursor-pointer transition-colors hover:bg-subtle"
                  >
                    <TableCell className="p-0">
                      <Link
                        href={href}
                        className="flex items-center gap-3 px-4 py-3"
                        aria-label={t("wizard.trade.pick.rowAriaLabel", {
                          symbol: p.symbol,
                          side: p.side,
                          exchange: p.exchangeLabel,
                        })}
                      >
                        <ExchangeChip
                          venue={p.exchangeCode}
                          size="sm"
                          className="shrink-0"
                        />
                        <span className="flex flex-col gap-0.5">
                          <span className="font-serif text-[14px] font-medium text-text">
                            {p.symbol}
                          </span>
                          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
                            {p.exchangeLabel} · {p.instrument}
                          </span>
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={href} className="block">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em]",
                            p.side === "long" ? "text-up" : "text-down",
                          )}
                        >
                          {p.side}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={href}
                        className="block font-mono text-[12px] tabular-nums text-text"
                      >
                        {fmtPrice(Number(p.avgEntryPrice))}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={href}
                        className="block font-mono text-[12px] tabular-nums text-text-secondary"
                      >
                        {fmtQty(Number(p.qty))}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={href}
                        className="block font-mono text-[12px] tabular-nums text-text-secondary"
                      >
                        {fmtDays(p.daysOpen)}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={href}
                        className="flex items-center justify-end gap-1.5 font-mono text-[12px] tabular-nums text-text-secondary"
                      >
                        ${fmtPrice(Number(p.capital))}
                        <ArrowUpRight className="h-3 w-3 text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="mt-6 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
        {t("wizard.trade.pick.notFound")}{" "}
        <Link
          href={`/add/trade/fields?source=manual&kind=${encodeURIComponent(kind)}`}
          className="underline-offset-4 hover:text-text hover:underline"
        >
          {t("wizard.trade.pick.enterManually")}
        </Link>
      </p>

      <WizardNav backHref={`/add/trade/kind?source=auto&kind=${encodeURIComponent(kind)}`} />
    </WizardShell>
  );
}
