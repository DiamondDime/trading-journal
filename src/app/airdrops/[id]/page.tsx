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
import { fmtUsd } from "@/lib/data/archive-data";
import { WizardPreviewBanner } from "@/components/wizard/wizard-preview-banner";
import { requireUser } from "@/lib/auth/server";
import { getActivity } from "@/lib/db/activity";
import { getNoteForActivity } from "@/lib/db/notes";
import { DeleteButton } from "@/components/activity/delete-button";
import { NotesEditor } from "@/components/activity/notes-editor";

export const dynamic = "force-dynamic";

function fmtPrice(n: number) {
  if (n < 1) return n.toLocaleString("en-US", { maximumSignificantDigits: 4 });
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtTokens(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function fmtMultiplier(m: number) {
  if (!Number.isFinite(m) || m === 0) return "—";
  return m >= 10 ? `${m.toFixed(1)}×` : `${m.toFixed(2)}×`;
}

export default async function AirdropDetailPage({
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
  if (!activity || activity.subtype.type !== "airdrop") {
    notFound();
  }

  const a = activity.subtype.row;
  const tokens = Number(a.qtyReceived);
  const currentPrice = Number(a.currentPriceUsd ?? 0);
  const currentValue = tokens * currentPrice;
  const valueAtClaim = Number(a.valueAtReceiptUsd ?? 0);
  const multiplier = valueAtClaim > 0 ? currentValue / valueAtClaim : 1.0;
  const netPnl = Number(activity.netPnlUsd ?? 0);
  const headlineTone = multiplier >= 1 ? "text-up" : "text-down";
  const statusLabel = activity.status[0].toUpperCase() + activity.status.slice(1);
  const serial = `A#${activity.id.slice(0, 4).toUpperCase()}`;
  const claimLabel = fmtDate(a.claimDate ?? activity.openedAt);
  const daysSinceClaim = a.claimDate
    ? Math.max(0, Math.round((Date.now() - new Date(a.claimDate).getTime()) / 86_400_000))
    : 0;

  return (
    <div className="flex h-screen w-full bg-app">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <article className="mx-auto max-w-4xl px-6 py-14 md:py-20">
          <WizardPreviewBanner from={sp.from} action={sp.action} />
          <div className="flex items-center justify-between font-mono text-xs text-text-tertiary">
            <span>{serial}</span>
            <span className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-subtle px-2.5 py-0.5">
                <span className="h-1.5 w-1.5 rounded-full bg-text-tertiary" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em]">
                  {statusLabel}
                </span>
              </span>
              <span>{claimLabel}</span>
            </span>
          </div>

          <header className="mt-6">
            <div className="flex items-start justify-between gap-6">
              <h1 className="font-serif text-4xl font-medium leading-tight tracking-tight text-text md:text-5xl">
                {activity.name}
              </h1>
              <Link
                href={`/add/airdrop/fields?edit=${activity.id}`}
                aria-label="Edit airdrop"
                className="mt-2 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-text-tertiary transition-colors hover:border-border-strong hover:text-text"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Link>
            </div>
            <p className="mt-3 text-base text-text-secondary">
              {a.protocol} · {a.tokenSymbol}
            </p>
            <p className="mt-1 font-mono text-sm text-text-tertiary">
              {daysSinceClaim}d since claim
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
                realized · cost basis $0
              </p>
            </div>
          </section>

          {a.eligibilityReason && (
            <section className="mt-14">
              <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
                Thesis
              </h2>
              <div className="mt-4 space-y-4 font-serif text-lg leading-[1.65] text-text">
                <p>{a.eligibilityReason}</p>
              </div>
            </section>
          )}

          <section className="mt-14">
            <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              Claim
            </h2>

            <div className="mt-6 overflow-hidden rounded-md border border-border bg-surface">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-text-tertiary">&nbsp;</TableHead>
                    <TableHead className="text-right text-text-secondary">Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <ExecRow label="Protocol" value={a.protocol} mono />
                  <ExecRow
                    label="Tokens claimed"
                    value={`${fmtTokens(tokens)} ${a.tokenSymbol}`}
                    mono
                  />
                  <ExecRow label="Claim date" value={fmtDate(a.claimDate)} mono />
                  <ExecRow label="Value at claim" value={fmtUsd(valueAtClaim)} mono />
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
                    label="Cost basis"
                    value={<span className="text-text-tertiary">$0.00</span>}
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
                initialNoteId={note?.id ?? null}
              />
            </div>
          </section>

          <section className="mt-14">
            <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              Actions
            </h2>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Link
                href={`/add/airdrop/fields?edit=${activity.id}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary transition-colors hover:border-border-strong hover:text-text"
              >
                <Pencil className="h-3 w-3" />
                Edit
              </Link>
              <DeleteButton
                activityId={activity.id}
                activityType="airdrop"
                serial={serial}
              />
            </div>
          </section>

          <footer className="mt-20 border-t border-border pt-6 font-mono text-xs text-text-tertiary">
            <div className="flex items-center justify-between">
              <Link
                href="/spreads/archive?activity=airdrop"
                className="hover:text-text"
              >
                ← back to airdrops
              </Link>
              <span>
                airdrop {serial.toLowerCase()} · csj
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
