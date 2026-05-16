import { notFound } from "next/navigation";
import Link from "next/link";
import { Sidebar } from "@/components/sidebar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getActivityById,
  fmtCapital,
  fmtUsd,
  type TradeRow,
} from "@/lib/data/archive-data";
import { WizardPreviewBanner } from "@/components/wizard/wizard-preview-banner";

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtSidePill(side: "long" | "short") {
  const cls = side === "long" ? "text-up" : "text-down";
  return (
    <span className={`font-mono text-[10px] uppercase tracking-[0.16em] ${cls}`}>
      {side}
    </span>
  );
}

function fmtPrice(n: number) {
  if (n < 1) {
    return n.toLocaleString("en-US", { maximumSignificantDigits: 4 });
  }
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Compute entry/exit prices implied by the trade's stored aggregates.
 * Fixtures don't store entry/exit directly — they store `headlineNum` (APR),
 * `capital`, `netPnl`, `daysHeld`. We derive an illustrative entry/exit pair
 * by treating capital as price × qty and infering qty per market. This is
 * intentionally rough — when DB writes land in Chunk 5, the real columns
 * (`avg_entry_price`, `avg_exit_price`, `qty`) drive this section directly.
 */
function deriveExecution(trade: TradeRow): {
  qty: string;
  entryPrice: number;
  exitPrice: number;
  fees: number;
  grossPnl: number;
} {
  // Pick a plausible per-asset price as the entry baseline.
  const basePriceByAsset: Record<string, number> = {
    BTC: 64200,
    ETH: 3120,
    SOL: 178.4,
    PEPE: 0.0000142,
    EIGEN: 3.2,
    W: 0.6,
    ZETA: 0.45,
    JUP: 0.8,
    ARB: 0.84,
    PYTH: 0.55,
  };
  const entry = basePriceByAsset[trade.asset] ?? 100;
  const qty = trade.capital / entry;
  const exit =
    trade.netPnl === 0
      ? entry
      : entry + (trade.netPnl + 12.5) * (trade.side === "short" ? -1 : 1) / qty;
  const gross = trade.netPnl + 12.5;
  return {
    qty: qty.toLocaleString("en-US", { maximumSignificantDigits: 4 }),
    entryPrice: entry,
    exitPrice: exit,
    fees: 12.5,
    grossPnl: gross,
  };
}

// ── Page ────────────────────────────────────────────────────────────────────

export default async function TradeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const activity = getActivityById(id);

  if (!activity || activity.type !== "trade") {
    notFound();
  }

  const t = activity as TradeRow;
  const exec = deriveExecution(t);
  const headlineTone = t.tone === "up" ? "text-up" : "text-down";

  return (
    <div className="flex h-screen w-full bg-app">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <article className="mx-auto max-w-4xl px-6 py-14 md:py-20">
          <WizardPreviewBanner from={sp.from} />
          {/* ── meta row ──────────────────────────────────────────────── */}
          <div className="flex items-center justify-between font-mono text-xs text-text-tertiary">
            <span>{t.serial}</span>
            <span className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-subtle px-2.5 py-0.5">
                <span className="h-1.5 w-1.5 rounded-full bg-text-tertiary" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em]">
                  Closed
                </span>
              </span>
              <span>{t.closedLabel}, 2026</span>
            </span>
          </div>

          {/* ── title block ───────────────────────────────────────────── */}
          <header className="mt-6">
            <h1 className="font-serif text-4xl font-medium leading-tight tracking-tight text-text md:text-5xl">
              {t.name}
            </h1>
            <p className="mt-3 text-base text-text-secondary">
              {t.exchange} · {t.symbol} · {t.instrument} · {t.side}
            </p>
            <p className="mt-1 font-mono text-sm text-text-tertiary">
              {t.daysLabel} held
            </p>
          </header>

          {/* ── hero block ────────────────────────────────────────────── */}
          <section className="mt-14 border-y border-border py-12">
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline gap-3">
                <span
                  className="font-serif font-normal leading-none text-signature"
                  style={{ fontSize: "clamp(56px, 9vw, 96px)" }}
                >
                  {t.headlineLabel}
                </span>
                <span className="font-serif text-2xl font-normal text-text-tertiary">
                  APR
                </span>
              </div>
              <p className="mt-3 font-mono text-sm text-text-secondary">
                Net{" "}
                <span className={`${headlineTone} font-medium`}>
                  {fmtUsd(t.netPnl, true)}
                </span>{" "}
                realized on {fmtCapital(t.capital)} capital
              </p>
            </div>
          </section>

          {/* ── thesis ────────────────────────────────────────────────── */}
          <section className="mt-14">
            <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              Thesis
            </h2>
            <div className="mt-4 space-y-4 font-serif text-lg leading-[1.65] text-text">
              {t.note ? <p>{t.note}</p> : <p className="text-text-tertiary">—</p>}
            </div>
          </section>

          {/* ── decomposition ─────────────────────────────────────────── */}
          <section className="mt-14">
            <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              Decomposition
            </h2>

            <div className="mt-6 overflow-hidden rounded-md border border-border bg-surface">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-text-tertiary">&nbsp;</TableHead>
                    <TableHead className="text-right text-text-secondary">
                      Value
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <ExecRow label="Side" value={fmtSidePill(t.side)} />
                  <ExecRow label="Quantity" value={exec.qty} mono />
                  <ExecRow
                    label="Entry price"
                    value={`$${fmtPrice(exec.entryPrice)}`}
                    mono
                  />
                  <ExecRow
                    label="Exit price"
                    value={`$${fmtPrice(exec.exitPrice)}`}
                    mono
                  />
                  <ExecRow
                    label="Gross P&L"
                    value={
                      <span className={exec.grossPnl >= 0 ? "text-up" : "text-down"}>
                        {fmtUsd(exec.grossPnl, true)}
                      </span>
                    }
                    mono
                  />
                  <ExecRow
                    label="Fees"
                    value={
                      <span className="text-text-secondary">
                        {fmtUsd(exec.fees * -1, true)}
                      </span>
                    }
                    mono
                  />
                  <ExecRow
                    label="Net P&L"
                    value={
                      <span className={`font-medium ${headlineTone}`}>
                        {fmtUsd(t.netPnl, true)}
                      </span>
                    }
                    mono
                  />
                  <ExecRow
                    label="Realized APR"
                    value={
                      <span className={`font-medium ${headlineTone}`}>
                        {t.headlineLabel}
                      </span>
                    }
                    mono
                  />
                </TableBody>
              </Table>
            </div>
          </section>

          {/* ── tags ──────────────────────────────────────────────────── */}
          {t.regimeTags.length > 0 && (
            <section className="mt-14">
              <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
                Regime tags
              </h2>
              <div className="mt-4 flex flex-wrap gap-2">
                {t.regimeTags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-md border border-border bg-surface px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* ── footer ────────────────────────────────────────────────── */}
          <footer className="mt-20 border-t border-border pt-6 font-mono text-xs text-text-tertiary">
            <div className="flex items-center justify-between">
              <Link
                href="/spreads/archive?activity=trade"
                className="hover:text-text"
              >
                ← back to trades
              </Link>
              <span>
                trade {t.serial.toLowerCase()} · csj
              </span>
            </div>
          </footer>
        </article>
      </main>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function ExecRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <TableRow>
      <TableCell className="text-text-tertiary text-sm">{label}</TableCell>
      <TableCell
        className={
          (mono ? "font-mono tabular-nums text-text" : "text-text") + " text-right"
        }
      >
        {value}
      </TableCell>
    </TableRow>
  );
}
