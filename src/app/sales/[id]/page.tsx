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
  type SaleRow,
} from "@/lib/data/archive-data";

export const dynamic = "force-static";

// ── Helpers ─────────────────────────────────────────────────────────────────

const SALE_KIND_LABELS: Record<string, string> = {
  ido: "IDO",
  launchpad: "Launchpad",
  premarket: "Premarket",
  otc: "OTC",
};

function fmtPrice(n: number) {
  if (n < 1) {
    return n.toLocaleString("en-US", { maximumSignificantDigits: 4 });
  }
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtTokens(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function fmtMtmDate(closedAt: string) {
  const d = new Date(closedAt);
  if (!Number.isFinite(d.getTime())) return closedAt;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Compute illustrative allocation/vesting fields from the stored aggregates.
 * Fixtures only carry headline-level data (capital = usd_paid, multiplier,
 * net_pnl, days_held). We derive a plausible price + token count + a
 * synthetic TGE/vesting schedule so the detail page has real numbers to
 * render. Marked clearly here — once Chunk 5 wires DB writes, the real
 * columns (`tokens_allocated`, `tge_unlock_pct`, `vesting_cliff_months`,
 * etc.) replace this guesswork.
 */
function deriveSaleExecution(sale: SaleRow): {
  usdPaid: number;
  tokensAllocated: number;
  currentPrice: number;
  currentValue: number;
  tgeUnlockPct: number;
  vestingCliffMonths: number;
  vestingDurationMonths: number;
  tgeDate: string;
} {
  // Pick a plausible per-asset current price. Mirrors the asset table in
  // the trade detail page so per-asset visuals stay coherent.
  const currentPriceByAsset: Record<string, number> = {
    EIGEN: 3.8,
    W: 1.1,
    ZETA: 0.28,
    PYTH: 0.62,
    JUP: 1.05,
    ARB: 0.78,
    BTC: 64200,
    ETH: 3120,
    SOL: 178.4,
    PEPE: 0.0000142,
  };
  const usdPaid = sale.capital;
  const currentValue = usdPaid * sale.multiplier;
  const currentPrice = currentPriceByAsset[sale.asset] ?? 1;
  // tokens = current_value / current_price — derives a self-consistent
  // pair (tokens × price = current_value, MTM × matches).
  const tokensAllocated = currentValue / currentPrice;

  // Vesting schedule: rough heuristic per sale kind. Real values come
  // from the DB once Chunk 5+ writes are in.
  const tgeUnlockPct =
    sale.saleKind === "premarket"
      ? 100
      : sale.saleKind === "otc"
      ? 25
      : sale.saleKind === "launchpad"
      ? 100
      : 20; // ido default
  const vestingCliffMonths =
    sale.saleKind === "premarket" || sale.saleKind === "launchpad"
      ? 0
      : 6;
  const vestingDurationMonths =
    sale.saleKind === "premarket" || sale.saleKind === "launchpad"
      ? 0
      : 18;

  // TGE date — back-derive from the close date and the days held.
  // Roughly: opened ≈ closed − daysHeld.
  const closed = new Date(sale.closedAt);
  const opened = new Date(closed.getTime() - sale.daysHeld * 86400_000);
  const tgeDate = opened.toISOString().slice(0, 10);

  return {
    usdPaid,
    tokensAllocated,
    currentPrice,
    currentValue,
    tgeUnlockPct,
    vestingCliffMonths,
    vestingDurationMonths,
    tgeDate,
  };
}

// ── Page ────────────────────────────────────────────────────────────────────

export default async function SaleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const activity = getActivityById(id);

  if (!activity || activity.type !== "sale") {
    notFound();
  }

  const s = activity as SaleRow;
  const exec = deriveSaleExecution(s);
  const headlineTone = s.tone === "up" ? "text-up" : "text-down";
  const saleKindLabel = SALE_KIND_LABELS[s.saleKind] ?? s.saleKind;

  return (
    <div className="flex h-screen w-full bg-app">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <article className="mx-auto max-w-4xl px-6 py-14 md:py-20">
          {/* ── meta row ──────────────────────────────────────────────── */}
          <div className="flex items-center justify-between font-mono text-xs text-text-tertiary">
            <span>{s.serial}</span>
            <span className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-subtle px-2.5 py-0.5">
                <span className="h-1.5 w-1.5 rounded-full bg-text-tertiary" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em]">
                  Vested
                </span>
              </span>
              <span>{s.closedLabel}, 2026</span>
            </span>
          </div>

          {/* ── title block ───────────────────────────────────────────── */}
          <header className="mt-6">
            <h1 className="font-serif text-4xl font-medium leading-tight tracking-tight text-text md:text-5xl">
              {s.asset} — {s.venue} {saleKindLabel}
            </h1>
            <p className="mt-3 text-base text-text-secondary">
              {saleKindLabel} · {s.venue} · {s.asset}
            </p>
            <p className="mt-1 font-mono text-sm text-text-tertiary">
              {s.daysLabel} from purchase to MTM
            </p>
          </header>

          {/* ── hero block ────────────────────────────────────────────── */}
          <section className="mt-14 border-y border-border py-12">
            <div className="flex flex-col gap-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
                Mark-to-market
              </p>
              <div className="flex items-baseline gap-3">
                <span
                  className="font-serif font-normal leading-none text-signature"
                  style={{ fontSize: "clamp(56px, 9vw, 96px)" }}
                >
                  {s.headlineLabel}
                </span>
                <span className="font-serif text-2xl font-normal text-text-tertiary">
                  MTM
                </span>
              </div>
              <p className="mt-3 font-mono text-sm text-text-secondary">
                Net{" "}
                <span className={`${headlineTone} font-medium`}>
                  {fmtUsd(s.netPnl, true)}
                </span>{" "}
                realized on {fmtCapital(s.capital)} paid
              </p>
            </div>
          </section>

          {/* ── thesis ────────────────────────────────────────────────── */}
          <section className="mt-14">
            <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              Thesis
            </h2>
            <div className="mt-4 space-y-4 font-serif text-lg leading-[1.65] text-text">
              {s.note ? <p>{s.note}</p> : <p className="text-text-tertiary">—</p>}
            </div>
          </section>

          {/* ── allocation table ──────────────────────────────────────── */}
          {/* Fixture-derived: see deriveSaleExecution() — real columns land
              with Chunk 5+ DB writes. */}
          <section className="mt-14">
            <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              Allocation
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
                  <ExecRow label="USD paid" value={fmtUsd(exec.usdPaid)} mono />
                  <ExecRow
                    label="Tokens allocated"
                    value={`${fmtTokens(exec.tokensAllocated)} ${s.asset}`}
                    mono
                  />
                  <ExecRow
                    label="TGE date"
                    value={fmtMtmDate(exec.tgeDate)}
                    mono
                  />
                  <ExecRow
                    label="TGE unlock %"
                    value={`${exec.tgeUnlockPct}%`}
                    mono
                  />
                  <ExecRow
                    label="Vesting cliff"
                    value={
                      exec.vestingCliffMonths > 0
                        ? `${exec.vestingCliffMonths}mo`
                        : "none"
                    }
                    mono
                  />
                  <ExecRow
                    label="Vesting duration"
                    value={
                      exec.vestingDurationMonths > 0
                        ? `${exec.vestingDurationMonths}mo`
                        : "none"
                    }
                    mono
                  />
                  <ExecRow
                    label="Current price"
                    value={`$${fmtPrice(exec.currentPrice)}`}
                    mono
                  />
                  <ExecRow
                    label="Current value"
                    value={fmtUsd(exec.currentValue)}
                    mono
                  />
                  <ExecRow
                    label="Net P&L"
                    value={
                      <span className={`font-medium ${headlineTone}`}>
                        {fmtUsd(s.netPnl, true)}
                      </span>
                    }
                    mono
                  />
                  <ExecRow
                    label="MTM ×"
                    value={
                      <span className={`font-medium ${headlineTone}`}>
                        {s.headlineLabel}
                      </span>
                    }
                    mono
                  />
                </TableBody>
              </Table>
            </div>
          </section>

          {/* ── tags ──────────────────────────────────────────────────── */}
          {s.regimeTags.length > 0 && (
            <section className="mt-14">
              <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
                Regime tags
              </h2>
              <div className="mt-4 flex flex-wrap gap-2">
                {s.regimeTags.map((tag) => (
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
                href="/spreads/archive?activity=sale"
                className="hover:text-text"
              >
                ← back to sales
              </Link>
              <span>
                sale {s.serial.toLowerCase()} · csj
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
