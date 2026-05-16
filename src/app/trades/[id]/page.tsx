import { notFound } from "next/navigation";
import Link from "next/link";
import { Pencil } from "lucide-react";
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
import { getNoteForActivity } from "@/lib/db/notes";
import { DeleteButton } from "@/components/activity/delete-button";
import { NotesEditor } from "@/components/activity/notes-editor";

export const dynamic = "force-dynamic";

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

function fmtAprPct(realizedApr: string | null): { label: string; tone: "up" | "down" } {
  if (realizedApr === null) return { label: "—", tone: "up" };
  const n = Number(realizedApr);
  if (!Number.isFinite(n)) return { label: "—", tone: "up" };
  const sign = n >= 0 ? "+" : "−";
  return { label: `${sign}${Math.abs(n * 100).toFixed(1)}%`, tone: n >= 0 ? "up" : "down" };
}

// ── Page ────────────────────────────────────────────────────────────────────

export default async function TradeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; action?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const { id: userId } = await requireUser();
  const [activity, note] = await Promise.all([
    getActivity(userId, id),
    getNoteForActivity(userId, id),
  ]);
  if (!activity || activity.subtype.type !== "trade") {
    notFound();
  }

  const t = activity.subtype.row;
  const apr = fmtAprPct(t.realizedApr);
  const headlineTone = apr.tone === "up" ? "text-up" : "text-down";
  const netPnl = Number(activity.netPnlUsd ?? 0);
  const capital = Number(activity.capitalDeployedUsd ?? 0);
  const qty = Number(t.qty);
  const entry = Number(t.avgEntryPrice);
  const exit = t.avgExitPrice !== null ? Number(t.avgExitPrice) : entry;
  const fees = Number(activity.feesUsd);
  const gross = netPnl + fees;
  const daysLabel = fmtDaysLabel(activity.openedAt, activity.closedAt);
  const closedLabel = activity.closedAt
    ? new Date(activity.closedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "—";
  const statusLabel = activity.status.charAt(0).toUpperCase() + activity.status.slice(1);
  const serial = `T#${activity.id.slice(0, 4).toUpperCase()}`;

  return (
    <div className="flex h-screen w-full bg-app">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <article className="mx-auto max-w-4xl px-6 py-14 md:py-20">
          <WizardPreviewBanner from={sp.from} action={sp.action} />
          {/* ── meta row ──────────────────────────────────────────────── */}
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

          {/* ── title block ───────────────────────────────────────────── */}
          <header className="mt-6">
            <div className="flex items-start justify-between gap-6">
              <h1 className="font-serif text-4xl font-medium leading-tight tracking-tight text-text md:text-5xl">
                {activity.name}
              </h1>
              <Link
                href={`/add/trade/fields?edit=${activity.id}`}
                aria-label="Edit trade"
                className="mt-2 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-text-tertiary transition-colors hover:border-border-strong hover:text-text"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Link>
            </div>
            <p className="mt-3 text-base text-text-secondary">
              {t.exchange} · {t.symbol} · {t.instrumentKind} · {t.side}
            </p>
            <p className="mt-1 font-mono text-sm text-text-tertiary">
              {daysLabel} held
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

          {/* ── thesis ────────────────────────────────────────────────── */}
          <section className="mt-14">
            <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              Thesis
            </h2>
            <div className="mt-4 space-y-4 font-serif text-lg leading-[1.65] text-text">
              {t.entryThesis ? <p>{t.entryThesis}</p> : <p className="text-text-tertiary">—</p>}
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
                  <ExecRow label="Quantity" value={qty.toLocaleString("en-US", { maximumSignificantDigits: 6 })} mono />
                  <ExecRow label="Entry price" value={`$${fmtPrice(entry)}`} mono />
                  <ExecRow label="Exit price" value={`$${fmtPrice(exit)}`} mono />
                  <ExecRow
                    label="Gross P&L"
                    value={
                      <span className={gross >= 0 ? "text-up" : "text-down"}>
                        {fmtUsd(gross, true)}
                      </span>
                    }
                    mono
                  />
                  <ExecRow
                    label="Fees"
                    value={
                      <span className="text-text-secondary">
                        {fmtUsd(fees * -1, true)}
                      </span>
                    }
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
                    label="Realized APR"
                    value={
                      <span className={`font-medium ${headlineTone}`}>
                        {apr.label}
                      </span>
                    }
                    mono
                  />
                </TableBody>
              </Table>
            </div>
          </section>

          {/* ── tags ──────────────────────────────────────────────────── */}
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

          {/* ── notes editor ──────────────────────────────────────────── */}
          <section className="mt-14">
            <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              Notes
            </h2>
            <p className="mt-2 font-serif text-[12px] italic text-text-tertiary">
              Your postmortem
            </p>
            <div className="mt-4">
              <NotesEditor
                activityId={activity.id}
                initialBody={note?.body ?? ""}
                initialVersion={note?.updatedAt ?? null}
              />
            </div>
          </section>

          {/* ── actions ───────────────────────────────────────────────── */}
          <section className="mt-14">
            <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              Actions
            </h2>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Link
                href={`/add/trade/fields?edit=${activity.id}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary transition-colors hover:border-border-strong hover:text-text"
              >
                <Pencil className="h-3 w-3" />
                Edit
              </Link>
              <DeleteButton
                activityId={activity.id}
                activityType="trade"
                serial={serial}
              />
            </div>
          </section>

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
                trade {serial.toLowerCase()} · csj
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
