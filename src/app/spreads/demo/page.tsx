import { FundingBarsChart } from "@/components/spread/funding-bars-chart";
import { BasisLineChart } from "@/components/spread/basis-line-chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-static";

// Editorial spread-detail page rendered from the BTC cash-carry funding-version
// fixture in docs/design-fixtures.json (spread_detail_example).
// Pure demo — no DB, no auth. The hero of the product, rendered.
export default function SpreadDemoPage() {
  return (
    <article className="mx-auto max-w-4xl px-6 py-14 md:py-20">
        {/* ── meta row ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between font-mono text-xs text-text-tertiary">
          <span>#032</span>
          <span className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-subtle px-2.5 py-0.5">
              <span className="h-1.5 w-1.5 rounded-full bg-text-tertiary" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em]">
                Closed
              </span>
            </span>
            <span>Mar 28, 2026</span>
          </span>
        </div>

        {/* ── title block ───────────────────────────────────────────────────── */}
        <header className="mt-6">
          <h1 className="font-serif text-4xl font-medium leading-tight tracking-tight text-text md:text-5xl">
            BTC cash-and-carry
          </h1>
          <p className="mt-3 text-base text-text-secondary">
            Funding capture · Bitmex perp short + Coinbase spot long
          </p>
          <p className="mt-1 font-mono text-sm text-text-tertiary">
            73 days held · Jan 14 → Mar 28, 2026
          </p>
        </header>

        {/* ── hero block ────────────────────────────────────────────────────── */}
        <section className="mt-14 border-y border-border py-12">
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline gap-3">
              <span
                className="font-serif font-normal leading-none text-signature"
                style={{ fontSize: "clamp(56px, 9vw, 96px)" }}
              >
                +14.0%
              </span>
              <span className="font-serif text-2xl font-normal text-text-tertiary">
                APR
              </span>
            </div>
            <p className="font-serif text-base italic text-text-tertiary">
              ↓ 21% short of target (17.8%)
            </p>
            <p className="mt-3 font-mono text-sm text-text-secondary">
              Net <span className="text-up font-medium">+$1,314.40</span>{" "}
              realized on $47,300.00 capital
            </p>
          </div>
        </section>

        {/* ── thesis ────────────────────────────────────────────────────────── */}
        <section className="mt-14">
          <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
            Thesis
          </h2>
          <div className="mt-4 space-y-4 font-serif text-lg leading-[1.65] text-text">
            <p>
              Opened into the BTC ETF-inflow narrative at 17.8% annualized
              funding. Capital allocated: 3% of book. Exit criteria — funding
              flips negative for three consecutive periods <em>or</em>{" "}
              liquidation buffer on the short perp drops below 25%.
            </p>
          </div>
        </section>

        {/* ── decomposition ─────────────────────────────────────────────────── */}
        <section className="mt-14">
          <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
            Decomposition
          </h2>

          <div className="mt-6 space-y-3">
            <DecompRow label="Funding received" value={1389.40} max={1389.40} positive />
            <DecompRow label="Basis P&L" value={-43.00} max={1389.40} />
            <DecompRow label="Fees" value={-32.00} max={1389.40} />
            <div className="ml-44 border-t border-border-strong" />
            <DecompRow label="Net" value={1314.40} max={1389.40} positive bold />
          </div>
        </section>

        {/* ── execution ─────────────────────────────────────────────────────── */}
        <section className="mt-14">
          <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
            Execution
          </h2>

          <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
            <figure className="rounded-md border border-border bg-surface p-5">
              <figcaption className="mb-3 flex items-center justify-between">
                <span className="text-xs font-medium text-text-secondary">
                  Daily funding received
                </span>
                <span className="font-mono text-xs text-text-tertiary">
                  $19.03 / day · 219 settlements
                </span>
              </figcaption>
              <FundingBarsChart />
            </figure>

            <figure className="rounded-md border border-border bg-surface p-5">
              <figcaption className="mb-3 flex items-center justify-between">
                <span className="text-xs font-medium text-text-secondary">
                  Basis spread over time
                </span>
                <span className="font-mono text-xs text-text-tertiary">
                  bps · close = 0
                </span>
              </figcaption>
              <BasisLineChart />
            </figure>
          </div>
        </section>

        {/* ── legs ──────────────────────────────────────────────────────────── */}
        <section className="mt-14">
          <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
            Legs
          </h2>

          <div className="mt-6 overflow-hidden rounded-md border border-border bg-surface">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-text-tertiary">&nbsp;</TableHead>
                  <TableHead className="text-text-secondary">
                    Long spot
                  </TableHead>
                  <TableHead className="text-text-secondary">
                    Short perp
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <LegRow label="Instrument" spot="BTC · Coinbase" perp="BTC-PERP · Bitmex" />
                <LegRow label="Qty" spot="1.000 BTC" perp="1.000" mono />
                <LegRow label="Entry (intended)" spot="$47,300.00" perp="$47,320.00" mono />
                <LegRow label="Entry (filled)" spot="$47,300.00" perp="$47,324.00" mono />
                <LegRow label="Slippage" spot="0 bps" perp="0.84 bps" mono />
                <LegRow label="Time to fill" spot="4 s" perp="6 s" mono />
                <LegRow label="Exit" spot="$50,140.00" perp="$50,161.00" mono />
                <LegRow
                  label="Realized P&L"
                  spot={<span className="text-up">+$2,840.00</span>}
                  perp={<span className="text-down">−$2,883.00</span>}
                  mono
                />
                <LegRow
                  label="Funding"
                  spot={<span className="text-text-tertiary">—</span>}
                  perp={<span className="text-up">+$1,389.40</span>}
                  mono
                />
              </TableBody>
            </Table>
          </div>
        </section>

        {/* ── postmortem ────────────────────────────────────────────────────── */}
        <section className="mt-14">
          <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
            Postmortem
          </h2>

          <blockquote className="mt-6 border-l-2 border-signature pl-6">
            <p className="font-serif text-xl italic leading-[1.6] text-text">
              &ldquo;Funding dropped below 10% APR for four consecutive periods.
              Net 14% realized — slightly below target, but the late exit cost
              three-to-four percentage points. Next time: trigger at 12%, not
              10%.&rdquo;
            </p>
            <footer className="mt-4 font-mono text-xs uppercase tracking-[0.14em] text-text-tertiary">
              Andrew · Mar 28, 00:30
            </footer>
          </blockquote>

          <div className="mt-10 grid grid-cols-1 gap-6 border-t border-border pt-8 md:grid-cols-3">
            <Verdict
              question="Was the thesis right?"
              symbol="✓"
              tone="up"
              answer="Largely — regime correctly identified."
            />
            <Verdict
              question="Was execution clean?"
              symbol="✓"
              tone="up"
              answer="Yes — worst slippage 0.84 bps."
            />
            <Verdict
              question="Would you do it again?"
              symbol="↗"
              tone="signature"
              answer="Yes, with a tighter close threshold (12%, not 10%)."
            />
          </div>
        </section>

        {/* ── footer ────────────────────────────────────────────────────────── */}
        <footer className="mt-20 border-t border-border pt-6 font-mono text-xs text-text-tertiary">
          <div className="flex items-center justify-between">
            <span>Logged 2026-03-28 00:35 UTC</span>
            <span>spread #032 · csj</span>
          </div>
        </footer>
      </article>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function DecompRow({
  label,
  value,
  max,
  positive = false,
  bold = false,
}: {
  label: string;
  value: number;
  max: number;
  positive?: boolean;
  bold?: boolean;
}) {
  const widthPct = (Math.abs(value) / max) * 100;
  const isPos = value >= 0;
  const sign = isPos ? "+" : "−";
  const abs = Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return (
    <div className="flex items-center gap-4">
      <div className={`w-44 shrink-0 ${bold ? "font-medium text-text" : "text-text-secondary"} text-sm`}>
        {label}
      </div>
      <div className="flex-1">
        <div className="h-2 w-full rounded-sm bg-subtle">
          <div
            className={`h-full rounded-sm ${positive ? "bg-up" : "bg-down"} ${bold ? "opacity-100" : "opacity-90"}`}
            style={{ width: `${widthPct}%` }}
          />
        </div>
      </div>
      <div
        className={`w-28 text-right font-mono tabular-nums ${
          bold ? "font-medium text-text" : isPos ? "text-up" : "text-down"
        }`}
      >
        {sign}${abs}
      </div>
    </div>
  );
}

function LegRow({
  label,
  spot,
  perp,
  mono = false,
}: {
  label: string;
  spot: React.ReactNode;
  perp: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <TableRow>
      <TableCell className="text-text-tertiary text-sm">{label}</TableCell>
      <TableCell className={mono ? "font-mono tabular-nums text-text" : "text-text"}>
        {spot}
      </TableCell>
      <TableCell className={mono ? "font-mono tabular-nums text-text" : "text-text"}>
        {perp}
      </TableCell>
    </TableRow>
  );
}

function Verdict({
  question,
  symbol,
  tone,
  answer,
}: {
  question: string;
  symbol: string;
  tone: "up" | "down" | "signature";
  answer: string;
}) {
  const toneClass =
    tone === "up"
      ? "text-up"
      : tone === "down"
      ? "text-down"
      : "text-signature";
  return (
    <div>
      <p className="font-serif text-xs font-semibold uppercase tracking-[0.14em] text-text-tertiary">
        {question}
      </p>
      <p className="mt-3 flex items-start gap-2 text-sm text-text">
        <span className={`mt-[2px] text-base font-mono ${toneClass}`}>
          {symbol}
        </span>
        <span className="font-serif italic leading-snug">{answer}</span>
      </p>
    </div>
  );
}
