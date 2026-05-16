import { notFound } from "next/navigation";
import Link from "next/link";
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
  SPREAD_TYPE_LABELS,
  type SpreadRow,
} from "@/lib/data/archive-data";
import { cn } from "@/lib/utils";

export const dynamic = "force-static";

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Fixtures don't store leg-level rows yet — they store one comma-joined
 * `venues` string ("Bitmex + Coinbase"). Derive a two-leg shape from it.
 * When the real `spread_leg` table is wired up, this gets replaced by a DB
 * read.
 */
function deriveLegs(spread: SpreadRow): {
  leg1: { venue: string; instrument: string; side: "long" | "short"; symbol: string };
  leg2: { venue: string; instrument: string; side: "long" | "short"; symbol: string };
} {
  // Split on "+" or "/" — both appear in fixture venues (e.g. "Bitmex + Coinbase",
  // "Binance / Bybit").
  const parts = spread.venues
    .split(/\s*[+/]\s*/)
    .filter(Boolean)
    .map((s) => s.trim());
  const venue1 = parts[0] ?? "Unknown";
  const venue2 = parts[1] ?? "Unknown";

  // Map spread type → leg shape (single source of truth for derived legs).
  switch (spread.spreadType) {
    case "cash_carry":
      return {
        leg1: {
          venue: venue1,
          instrument: "perp",
          side: "short",
          symbol: `${spread.asset}-PERP`,
        },
        leg2: {
          venue: venue2,
          instrument: "spot",
          side: "long",
          symbol: `${spread.asset}-USD`,
        },
      };
    case "funding":
      return {
        leg1: {
          venue: venue1,
          instrument: "spot",
          side: "long",
          symbol: `${spread.asset}-USDT`,
        },
        leg2: {
          venue: venue2 === "Unknown" ? venue1 : venue2,
          instrument: "perp",
          side: "short",
          symbol: `${spread.asset}-PERP`,
        },
      };
    case "cross_exchange":
      return {
        leg1: {
          venue: venue1,
          instrument: "perp",
          side: "long",
          symbol: `${spread.asset}-PERP`,
        },
        leg2: {
          venue: venue2,
          instrument: "perp",
          side: "short",
          symbol: `${spread.asset}-PERP`,
        },
      };
    case "calendar":
      return {
        leg1: {
          venue: venue1,
          instrument: "future",
          side: "long",
          symbol: `${spread.asset} (near)`,
        },
        leg2: {
          venue: venue1,
          instrument: "future",
          side: "short",
          symbol: `${spread.asset} (far)`,
        },
      };
    case "dex_cex":
      return {
        leg1: {
          venue: venue1,
          instrument: "spot",
          side: "long",
          symbol: `${spread.asset}-USD`,
        },
        leg2: {
          venue: venue2,
          instrument: "perp",
          side: "short",
          symbol: `${spread.asset}-PERP`,
        },
      };
  }
}

/**
 * Pull a "↓ X% short of target" caption out of the note field when it's
 * present (e.g. "−21% vs target"). Optional — only renders if matched.
 */
function parseTargetDelta(note: string): string | null {
  const m = note.match(/[-−]\s*(\d+(?:\.\d+)?)\s*%\s*(?:vs|short of)?\s*target/i);
  if (!m) return null;
  return `↓ ${m[1]}% short of target`;
}

// ── Page ────────────────────────────────────────────────────────────────────

export default async function SpreadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const activity = getActivityById(id);

  if (!activity || activity.type !== "spread") {
    notFound();
  }

  const s = activity as SpreadRow;
  const legs = deriveLegs(s);
  const headlineTone = s.tone === "up" ? "text-up" : "text-down";
  const targetCaption = parseTargetDelta(s.note);
  const typeLabel = SPREAD_TYPE_LABELS[s.spreadType];

  // Headline unit suffix — matches the fixture's headlineKind. APR → %, BPS → bps,
  // BPS/D → bps/day. The hero shows headlineLabel already prefixed with sign.
  const headlineUnit =
    s.headlineKind === "APR"
      ? "APR"
      : s.headlineKind === "BPS"
      ? "bps"
      : s.headlineKind === "BPS/D"
      ? "bps/day"
      : "";

  return (
    <article className="mx-auto max-w-4xl px-6 py-14 md:py-20">
          {/* ── meta row ──────────────────────────────────────────────── */}
          <div className="flex items-center justify-between font-mono text-xs text-text-tertiary">
            <span>{s.serial}</span>
            <span className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-subtle px-2.5 py-0.5">
                <span className="h-1.5 w-1.5 rounded-full bg-text-tertiary" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em]">
                  {s.status[0].toUpperCase() + s.status.slice(1)}
                </span>
              </span>
              <span>{s.closedLabel}, 2026</span>
            </span>
          </div>

          {/* ── title block ───────────────────────────────────────────── */}
          <header className="mt-6">
            <h1 className="font-serif text-4xl font-medium leading-tight tracking-tight text-text md:text-5xl">
              {s.name}
            </h1>
            <p className="mt-3 text-base text-text-secondary">
              {typeLabel} · {s.variant} · {s.venues}
            </p>
            <p className="mt-1 font-mono text-sm text-text-tertiary">
              {s.daysLabel} held
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
                  {s.headlineLabel}
                </span>
                <span className="font-serif text-2xl font-normal text-text-tertiary">
                  {headlineUnit}
                </span>
              </div>
              {targetCaption && (
                <p className="font-serif text-base italic text-text-tertiary">
                  {targetCaption}
                </p>
              )}
              <p className="mt-3 font-mono text-sm text-text-secondary">
                Net{" "}
                <span className={`${headlineTone} font-medium`}>
                  {fmtUsd(s.netPnl, true)}
                </span>{" "}
                realized on {fmtCapital(s.capital)} capital
              </p>
            </div>
          </section>

          {/* ── thesis ────────────────────────────────────────────────── */}
          <section className="mt-14">
            <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              Thesis
            </h2>
            <div className="mt-4 space-y-4 font-serif text-lg leading-[1.65] text-text">
              {s.note ? (
                <p>{s.note}</p>
              ) : (
                <p className="text-text-tertiary">—</p>
              )}
            </div>
          </section>

          {/* ── decomposition (legs) ───────────────────────────────────── */}
          <section className="mt-14">
            <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              Decomposition
            </h2>
            <p className="mt-2 font-serif text-[12px] italic text-text-tertiary">
              Two legs derived from the venues string — replaced by a DB read
              when the spread_leg table is wired up.
            </p>
            <div className="mt-4 overflow-hidden rounded-md border border-border bg-surface">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead scope="col" className="text-text-tertiary">
                      &nbsp;
                    </TableHead>
                    <TableHead scope="col" className="text-text-secondary">
                      Leg 1
                    </TableHead>
                    <TableHead scope="col" className="text-text-secondary">
                      Leg 2
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <LegRow
                    label="Venue"
                    leg1={legs.leg1.venue}
                    leg2={legs.leg2.venue}
                  />
                  <LegRow
                    label="Symbol"
                    leg1={legs.leg1.symbol}
                    leg2={legs.leg2.symbol}
                    mono
                  />
                  <LegRow
                    label="Instrument"
                    leg1={legs.leg1.instrument}
                    leg2={legs.leg2.instrument}
                  />
                  <LegRow
                    label="Side"
                    leg1={<SidePill side={legs.leg1.side} />}
                    leg2={<SidePill side={legs.leg2.side} />}
                  />
                </TableBody>
              </Table>
            </div>
          </section>

          {/* ── regime tags ───────────────────────────────────────────── */}
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
                href="/spreads/archive?activity=spread"
                className="hover:text-text"
              >
                ← back to spreads
              </Link>
              <span>
                spread {s.serial.toLowerCase()} · csj
              </span>
            </div>
      </footer>
    </article>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function LegRow({
  label,
  leg1,
  leg2,
  mono = false,
}: {
  label: string;
  leg1: React.ReactNode;
  leg2: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <TableRow>
      <TableCell className="text-text-tertiary text-sm">{label}</TableCell>
      <TableCell
        className={mono ? "font-mono tabular-nums text-text" : "text-text"}
      >
        {leg1}
      </TableCell>
      <TableCell
        className={mono ? "font-mono tabular-nums text-text" : "text-text"}
      >
        {leg2}
      </TableCell>
    </TableRow>
  );
}

function SidePill({ side }: { side: "long" | "short" }) {
  return (
    <span
      className={cn(
        "font-mono text-[10px] uppercase tracking-[0.16em]",
        side === "long" ? "text-up" : "text-down"
      )}
    >
      {side}
    </span>
  );
}
