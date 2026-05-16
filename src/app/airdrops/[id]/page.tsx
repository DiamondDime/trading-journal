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
  fmtUsd,
  type AirdropRow,
} from "@/lib/data/archive-data";
import { WizardPreviewBanner } from "@/components/wizard/wizard-preview-banner";

// ── Helpers ─────────────────────────────────────────────────────────────────

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

function fmtClaimDate(closedAt: string, daysHeld: number) {
  // Claim date ≈ close date − days held. Fixtures store the close date
  // and the days held since claim; we back-derive claim time.
  const closed = new Date(closedAt);
  const claim = new Date(closed.getTime() - daysHeld * 86400_000);
  return claim.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Derive illustrative claim/MTM fields from the row's stored aggregates.
 * The row only carries the multiplier + net_pnl + asset/protocol; we
 * back-solve a self-consistent (tokens, current_price, value_at_claim)
 * triple so the detail table has real numbers. Replaced by the
 * `activity_airdrop` columns once Chunk 5+ writes land.
 */
function deriveAirdropExecution(drop: AirdropRow): {
  tokensClaimed: number;
  currentPrice: number;
  currentValue: number;
  valueAtClaim: number;
} {
  const currentPriceByAsset: Record<string, number> = {
    PYTH: 0.62,
    JUP: 1.05,
    ARB: 0.78,
    EIGEN: 3.8,
    W: 1.1,
    ZETA: 0.28,
    BTC: 64200,
    ETH: 3120,
    SOL: 178.4,
    PEPE: 0.0000142,
  };
  // For airdrops, capital is always $0 — the MTM × encodes (current /
  // claim-value). Current value = net_pnl (cost basis = $0). Claim value
  // = current_value / multiplier.
  const currentValue = drop.netPnl;
  const valueAtClaim = drop.multiplier > 0 ? currentValue / drop.multiplier : 0;
  const currentPrice = currentPriceByAsset[drop.asset] ?? 1;
  const tokensClaimed = currentPrice > 0 ? currentValue / currentPrice : 0;
  return {
    tokensClaimed,
    currentPrice,
    currentValue,
    valueAtClaim,
  };
}

// ── Page ────────────────────────────────────────────────────────────────────

export default async function AirdropDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const activity = getActivityById(id);

  if (!activity || activity.type !== "airdrop") {
    notFound();
  }

  const a = activity as AirdropRow;
  const exec = deriveAirdropExecution(a);
  const headlineTone = a.tone === "up" ? "text-up" : "text-down";

  return (
    <div className="flex h-screen w-full bg-app">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <article className="mx-auto max-w-4xl px-6 py-14 md:py-20">
          <WizardPreviewBanner from={sp.from} />
          {/* ── meta row ──────────────────────────────────────────────── */}
          <div className="flex items-center justify-between font-mono text-xs text-text-tertiary">
            <span>{a.serial}</span>
            <span className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-subtle px-2.5 py-0.5">
                <span className="h-1.5 w-1.5 rounded-full bg-text-tertiary" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em]">
                  Claimed
                </span>
              </span>
              <span>{a.closedLabel}, 2026</span>
            </span>
          </div>

          {/* ── title block ───────────────────────────────────────────── */}
          <header className="mt-6">
            <h1 className="font-serif text-4xl font-medium leading-tight tracking-tight text-text md:text-5xl">
              {a.asset} · {a.protocol} airdrop
            </h1>
            <p className="mt-3 text-base text-text-secondary">
              {a.protocol} · {a.asset}
            </p>
            <p className="mt-1 font-mono text-sm text-text-tertiary">
              {a.daysLabel} since claim
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
                  {a.headlineLabel}
                </span>
                <span className="font-serif text-2xl font-normal text-text-tertiary">
                  MTM
                </span>
              </div>
              <p className="mt-3 font-mono text-sm text-text-secondary">
                Net{" "}
                <span className={`${headlineTone} font-medium`}>
                  {fmtUsd(a.netPnl, true)}
                </span>{" "}
                realized · cost basis $0
              </p>
            </div>
          </section>

          {/* ── thesis ────────────────────────────────────────────────── */}
          <section className="mt-14">
            <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              Thesis
            </h2>
            <div className="mt-4 space-y-4 font-serif text-lg leading-[1.65] text-text">
              {a.note ? <p>{a.note}</p> : <p className="text-text-tertiary">—</p>}
            </div>
          </section>

          {/* ── claim table ──────────────────────────────────────────── */}
          {/* Fixture-derived: see deriveAirdropExecution() — real columns
              land with Chunk 5+ DB writes. */}
          <section className="mt-14">
            <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              Claim
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
                  <ExecRow label="Protocol" value={a.protocol} mono />
                  <ExecRow
                    label="Tokens claimed"
                    value={`${fmtTokens(exec.tokensClaimed)} ${a.asset}`}
                    mono
                  />
                  <ExecRow
                    label="Claim date"
                    value={fmtClaimDate(a.closedAt, a.daysHeld)}
                    mono
                  />
                  <ExecRow
                    label="Value at claim"
                    value={fmtUsd(exec.valueAtClaim)}
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
                    label="Cost basis"
                    value={
                      <span className="text-text-tertiary">$0.00</span>
                    }
                    mono
                  />
                  <ExecRow
                    label="Net P&L"
                    value={
                      <span className={`font-medium ${headlineTone}`}>
                        {fmtUsd(a.netPnl, true)}
                      </span>
                    }
                    mono
                  />
                  <ExecRow
                    label="MTM ×"
                    value={
                      <span className={`font-medium ${headlineTone}`}>
                        {a.headlineLabel}
                      </span>
                    }
                    mono
                  />
                </TableBody>
              </Table>
            </div>
          </section>

          {/* ── tags ──────────────────────────────────────────────────── */}
          {a.regimeTags.length > 0 && (
            <section className="mt-14">
              <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
                Regime tags
              </h2>
              <div className="mt-4 flex flex-wrap gap-2">
                {a.regimeTags.map((tag) => (
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
                href="/spreads/archive?activity=airdrop"
                className="hover:text-text"
              >
                ← back to airdrops
              </Link>
              <span>
                airdrop {a.serial.toLowerCase()} · csj
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
