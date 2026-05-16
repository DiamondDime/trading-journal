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
import { fmtCapital, fmtUsd } from "@/lib/data/archive-data";
import { WizardPreviewBanner } from "@/components/wizard/wizard-preview-banner";
import { requireUser } from "@/lib/auth/server";
import { getActivity } from "@/lib/db/activity";

export const dynamic = "force-dynamic";

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

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtMultiplier(m: number) {
  if (!Number.isFinite(m)) return "—";
  return m >= 10 ? `${m.toFixed(1)}×` : `${m.toFixed(2)}×`;
}

function vestingDescription(schedule: Record<string, unknown> | null): {
  tgePct: number; cliffMonths: number; durationMonths: number;
} {
  if (!schedule) return { tgePct: 0, cliffMonths: 0, durationMonths: 0 };
  const kind = String(schedule.kind ?? "");
  if (kind === "all_at_tge") return { tgePct: 100, cliffMonths: 0, durationMonths: 0 };
  if (kind === "tge_plus_linear") {
    return {
      tgePct: Number(schedule.tge_pct ?? 0),
      cliffMonths: 0,
      durationMonths: Math.round(Number(schedule.linear_days ?? 0) / 30),
    };
  }
  if (kind === "cliff_plus_linear") {
    return {
      tgePct: Number(schedule.tge_pct ?? 0),
      cliffMonths: Math.round(Number(schedule.cliff_days ?? 0) / 30),
      durationMonths: Math.round(Number(schedule.linear_days ?? 0) / 30),
    };
  }
  return { tgePct: 0, cliffMonths: 0, durationMonths: 0 };
}

export default async function SaleDetailPage({
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
  if (!activity || activity.subtype.type !== "sale") {
    notFound();
  }

  const s = activity.subtype.row;
  const usdPaid = Number(s.usdPaid);
  const tokens = Number(s.tokensAllocated);
  const currentPrice = Number(s.currentPriceUsd ?? 0);
  const currentValue = tokens * currentPrice;
  const multiplier = usdPaid > 0 ? currentValue / usdPaid : 0;
  const netPnl = Number(activity.netPnlUsd ?? 0);
  const headlineTone = multiplier >= 1 ? "text-up" : "text-down";
  const saleKindLabel = SALE_KIND_LABELS[s.saleKind] ?? s.saleKind;
  const { tgePct, cliffMonths, durationMonths } = vestingDescription(s.vestingSchedule);
  const statusLabel = activity.status[0].toUpperCase() + activity.status.slice(1);
  const serial = `S#${activity.id.slice(0, 4).toUpperCase()}`;
  const daysHeldMs =
    activity.openedAt && activity.closedAt
      ? new Date(activity.closedAt).getTime() - new Date(activity.openedAt).getTime()
      : Date.now() - new Date(activity.openedAt ?? activity.createdAt).getTime();
  const daysLabel =
    daysHeldMs < 86_400_000
      ? `${Math.round(daysHeldMs / 3_600_000)}h`
      : `${Math.round(daysHeldMs / 86_400_000)}d`;
  const closedLabel = activity.closedAt ? fmtDate(activity.closedAt) : "—";

  return (
    <div className="flex h-screen w-full bg-app">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
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
              {saleKindLabel} · {s.saleVenue ?? "—"} · {s.tokenSymbol}
            </p>
            <p className="mt-1 font-mono text-sm text-text-tertiary">
              {daysLabel} from purchase to MTM
            </p>
          </header>

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
                  {fmtMultiplier(multiplier)}
                </span>
                <span className="font-serif text-2xl font-normal text-text-tertiary">
                  MTM
                </span>
              </div>
              <p className="mt-3 font-mono text-sm text-text-secondary">
                Net{" "}
                <span className={`${headlineTone} font-medium`}>
                  {fmtUsd(netPnl, true)}
                </span>{" "}
                realized on {fmtCapital(usdPaid)} paid
              </p>
            </div>
          </section>

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
                  <ExecRow label="USD paid" value={fmtUsd(usdPaid)} mono />
                  <ExecRow
                    label="Tokens allocated"
                    value={`${fmtTokens(tokens)} ${s.tokenSymbol}`}
                    mono
                  />
                  <ExecRow label="TGE date" value={fmtDate(s.saleDate)} mono />
                  <ExecRow label="TGE unlock %" value={`${tgePct}%`} mono />
                  <ExecRow
                    label="Vesting cliff"
                    value={cliffMonths > 0 ? `${cliffMonths}mo` : "none"}
                    mono
                  />
                  <ExecRow
                    label="Vesting duration"
                    value={durationMonths > 0 ? `${durationMonths}mo` : "none"}
                    mono
                  />
                  <ExecRow
                    label="Current price"
                    value={currentPrice > 0 ? `$${fmtPrice(currentPrice)}` : "—"}
                    mono
                  />
                  <ExecRow
                    label="Current value"
                    value={currentValue > 0 ? fmtUsd(currentValue) : "—"}
                    mono
                  />
                  <ExecRow
                    label="Net P&L"
                    value={
                      <span className={`font-medium ${headlineTone}`}>
                        {fmtUsd(netPnl, true)}
                      </span>
                    }
                    mono
                  />
                  <ExecRow
                    label="MTM ×"
                    value={
                      <span className={`font-medium ${headlineTone}`}>
                        {fmtMultiplier(multiplier)}
                      </span>
                    }
                    mono
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
                href="/spreads/archive?activity=sale"
                className="hover:text-text"
              >
                ← back to sales
              </Link>
              <span>
                sale {serial.toLowerCase()} · csj
              </span>
            </div>
          </footer>
        </article>
      </main>
    </div>
  );
}

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
