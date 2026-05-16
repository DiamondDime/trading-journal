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
import { fmtCapital, fmtUsd } from "@/lib/data/archive-data";
import { cn } from "@/lib/utils";
import { WizardPreviewBanner } from "@/components/wizard/wizard-preview-banner";
import { requireUser } from "@/lib/auth/server";
import { getActivity } from "@/lib/db/activity";

export const dynamic = "force-dynamic";

const SPREAD_TYPE_LABELS: Record<string, string> = {
  cash_carry: "Cash-and-carry",
  funding_capture: "Funding capture",
  cross_exchange_perp_arb: "Cross-exchange",
  calendar: "Calendar",
  dex_cex_arb: "DEX-CEX",
  custom: "Custom",
};

interface DerivedLegs {
  leg1: { venue: string; instrument: string; side: "long" | "short"; symbol: string };
  leg2: { venue: string; instrument: string; side: "long" | "short"; symbol: string };
}

/**
 * For v1 manual spreads there are no real legs in the DB (no Position rows).
 * Derive a two-leg display from spread_type + exchanges + primary_base so
 * the table renders meaningfully. Real legs land when the worker pipeline
 * materializes Positions in Wave 5C/6.
 */
function deriveLegs(
  spreadType: string,
  exchanges: string[],
  primaryBase: string,
): DerivedLegs {
  const venue1 = exchanges[0] ?? "Manual";
  const venue2 = exchanges[1] ?? venue1;
  switch (spreadType) {
    case "cash_carry":
      return {
        leg1: { venue: venue1, instrument: "perp", side: "short", symbol: `${primaryBase}-PERP` },
        leg2: { venue: venue2, instrument: "spot", side: "long",  symbol: `${primaryBase}-USD`  },
      };
    case "funding_capture":
      return {
        leg1: { venue: venue1, instrument: "spot", side: "long",  symbol: `${primaryBase}-USDT` },
        leg2: { venue: venue2, instrument: "perp", side: "short", symbol: `${primaryBase}-PERP` },
      };
    case "cross_exchange_perp_arb":
      return {
        leg1: { venue: venue1, instrument: "perp", side: "long",  symbol: `${primaryBase}-PERP` },
        leg2: { venue: venue2, instrument: "perp", side: "short", symbol: `${primaryBase}-PERP` },
      };
    case "calendar":
      return {
        leg1: { venue: venue1, instrument: "future", side: "long",  symbol: `${primaryBase} (near)` },
        leg2: { venue: venue1, instrument: "future", side: "short", symbol: `${primaryBase} (far)`  },
      };
    case "dex_cex_arb":
      return {
        leg1: { venue: venue1, instrument: "spot", side: "long",  symbol: `${primaryBase}-USD`  },
        leg2: { venue: venue2, instrument: "perp", side: "short", symbol: `${primaryBase}-PERP` },
      };
    default:
      return {
        leg1: { venue: venue1, instrument: "—", side: "long",  symbol: `${primaryBase}-?` },
        leg2: { venue: venue2, instrument: "—", side: "short", symbol: `${primaryBase}-?` },
      };
  }
}

function fmtAprPct(apr: string | null): { label: string; tone: "up" | "down" } {
  if (apr === null) return { label: "—", tone: "up" };
  const n = Number(apr);
  if (!Number.isFinite(n)) return { label: "—", tone: "up" };
  const sign = n >= 0 ? "+" : "−";
  return { label: `${sign}${Math.abs(n * 100).toFixed(1)}%`, tone: n >= 0 ? "up" : "down" };
}

function fmtDaysLabel(openedIso: string | null, closedIso: string | null) {
  if (!openedIso || !closedIso) return "—";
  const ms = new Date(closedIso).getTime() - new Date(openedIso).getTime();
  const d = ms / 86_400_000;
  if (d < 1) {
    const hours = d * 24;
    if (hours < 1) return `${Math.round(hours * 60)} min`;
    return `${hours.toFixed(1)}h`;
  }
  return `${Math.round(d)}d`;
}

export default async function SpreadDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { id: userId } = await requireUser();
  const activity = await getActivity(userId, id);
  if (!activity || activity.subtype.type !== "spread") {
    notFound();
  }

  const s = activity.subtype.row;
  const legs = deriveLegs(s.spreadType, s.exchanges, s.primaryBase);
  const apr = fmtAprPct(s.apr);
  const headlineTone = apr.tone === "up" ? "text-up" : "text-down";
  const typeLabel = SPREAD_TYPE_LABELS[s.spreadType] ?? s.spreadType;
  const netPnl = Number(activity.netPnlUsd ?? 0);
  const capital = Number(activity.capitalDeployedUsd ?? 0);
  const daysLabel = fmtDaysLabel(activity.openedAt, activity.closedAt);
  const closedLabel = activity.closedAt
    ? new Date(activity.closedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "—";
  const statusLabel = activity.status[0].toUpperCase() + activity.status.slice(1);
  const venuesLabel = s.exchanges.length > 0 ? s.exchanges.join(" + ") : "Manual";
  const serial = `#${activity.id.slice(0, 4).toUpperCase()}`;

  return (
    <article className="mx-auto max-w-4xl px-6 py-14 md:py-20">
      <WizardPreviewBanner from={sp.from} />
      <div className="flex items-center justify-between font-mono text-xs text-text-tertiary">
        <span>{serial}</span>
        <span className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-subtle px-2.5 py-0.5">
            <span className="h-1.5 w-1.5 rounded-full bg-text-tertiary" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em]">
              {statusLabel}
            </span>
          </span>
          <span>{closedLabel}</span>
        </span>
      </div>

      <header className="mt-6">
        <h1 className="font-serif text-4xl font-medium leading-tight tracking-tight text-text md:text-5xl">
          {activity.name}
        </h1>
        <p className="mt-3 text-base text-text-secondary">
          {typeLabel} · {s.variant ?? "—"} · {venuesLabel}
        </p>
        <p className="mt-1 font-mono text-sm text-text-tertiary">
          {daysLabel} held
        </p>
      </header>

      <section className="mt-14 border-y border-border py-12">
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline gap-3">
            <span
              className="font-serif font-normal leading-none text-signature"
              style={{ fontSize: "clamp(56px, 9vw, 96px)" }}
            >
              {apr.label}
            </span>
            <span className="font-serif text-2xl font-normal text-text-tertiary">
              APR
            </span>
          </div>
          <p className="mt-3 font-mono text-sm text-text-secondary">
            Net{" "}
            <span className={`${headlineTone} font-medium`}>
              {fmtUsd(netPnl, true)}
            </span>{" "}
            realized on {fmtCapital(capital)} capital
          </p>
        </div>
      </section>

      {s.exitPlan && (
        <section className="mt-14">
          <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
            Thesis
          </h2>
          <div className="mt-4 space-y-4 font-serif text-lg leading-[1.65] text-text">
            <p>{s.exitPlan}</p>
          </div>
        </section>
      )}

      <section className="mt-14">
        <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          Decomposition
        </h2>
        <p className="mt-2 font-serif text-[12px] italic text-text-tertiary">
          Two legs derived from spread type + venues — replaced by spread_legs JOIN
          when the worker pipeline materializes real positions.
        </p>
        <div className="mt-4 overflow-hidden rounded-md border border-border bg-surface">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead scope="col" className="text-text-tertiary">&nbsp;</TableHead>
                <TableHead scope="col" className="text-text-secondary">Leg 1</TableHead>
                <TableHead scope="col" className="text-text-secondary">Leg 2</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <LegRow label="Venue" leg1={legs.leg1.venue} leg2={legs.leg2.venue} />
              <LegRow label="Symbol" leg1={legs.leg1.symbol} leg2={legs.leg2.symbol} mono />
              <LegRow label="Instrument" leg1={legs.leg1.instrument} leg2={legs.leg2.instrument} />
              <LegRow
                label="Side"
                leg1={<SidePill side={legs.leg1.side} />}
                leg2={<SidePill side={legs.leg2.side} />}
              />
            </TableBody>
          </Table>
        </div>
      </section>

      {activity.regimeTags.length > 0 && (
        <section className="mt-14">
          <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
            Regime tags
          </h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {activity.regimeTags.map((tag) => (
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

      <footer className="mt-20 border-t border-border pt-6 font-mono text-xs text-text-tertiary">
        <div className="flex items-center justify-between">
          <Link
            href="/spreads/archive?activity=spread"
            className="hover:text-text"
          >
            ← back to spreads
          </Link>
          <span>
            spread {serial.toLowerCase()} · csj
          </span>
        </div>
      </footer>
    </article>
  );
}

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
      <TableCell className={mono ? "font-mono tabular-nums text-text" : "text-text"}>
        {leg1}
      </TableCell>
      <TableCell className={mono ? "font-mono tabular-nums text-text" : "text-text"}>
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
