import { notFound } from "next/navigation";
import Link from "next/link";
import { Pencil } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { WizardPreviewBanner } from "@/components/wizard/wizard-preview-banner";
import { requireUser } from "@/lib/auth/server";
import { getNoteForActivity } from "@/lib/db/notes";
import {
  getSatisfaction,
  listScreenshotsForActivity,
  listTagsForActivity,
} from "@/lib/db/satellite";
import { NotesEditor } from "@/components/activity/notes-editor";
import { ScreenshotsSection } from "@/components/activity/screenshots-section";
import { toScreenshotItems } from "@/components/activity/screenshots-data";
import { TagEditor } from "@/components/activity/tag-editor";
import { SatisfactionToggle } from "@/components/activity/satisfaction-toggle";
import { YieldPositionCard } from "@/components/activity/yield-position-card";
import { getYieldPositionForEdit } from "@/app/add/yield/db";
import {
  snapshotRewards,
  closeYieldPosition,
  markUnwindingYieldPosition,
} from "@/app/add/yield/actions";
import { WizardSubmitButton } from "@/components/wizard/wizard-submit-button";
import { WizardInput } from "@/components/wizard/wizard-field";
import { DeleteButton } from "@/components/activity/delete-button";

export const dynamic = "force-dynamic";

function fmtUsd(n: number, signed = false): string {
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const sign = signed ? (n >= 0 ? "+" : "−") : n < 0 ? "−" : "";
  return `${sign}$${abs}`;
}

function fmtPct(n: number, signed = true): string {
  const abs = Math.abs(n).toFixed(2);
  const sign = signed ? (n >= 0 ? "+" : "−") : "";
  return `${sign}${abs}%`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtAmount(s: string): string {
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return n.toLocaleString("en-US", { maximumSignificantDigits: 6 });
}

/**
 * Yield position detail page.
 *
 * Server component. Reads through `getYieldPositionForEdit` (not the
 * generic `getActivity`, which returns null for yield_position in v5 —
 * see comment in lib/db/activity.ts:338). Renders the editorial palette
 * shared with /airdrops/[id] / /sales/[id]:
 *   1. Header with status + serial + edit link
 *   2. Hero APY callout (YieldPositionCard)
 *   3. Position summary table
 *   4. Kind-specific data card (per the JSON kind_meta payload)
 *   5. Rewards-snapshot history (placeholder until v6 ships the worker
 *      cycle table)
 *   6. Satellite — screenshots / satisfaction / tags / notes
 *   7. Action bar: snapshot rewards, mark unwinding, close position, edit
 */
export default async function YieldPositionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; action?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { id: userId } = await requireUser();

  const row = await getYieldPositionForEdit(userId, id);
  if (!row) notFound();

  const [note, screenshots, initialTags, satisfaction] = await Promise.all([
    getNoteForActivity(userId, id),
    listScreenshotsForActivity(userId, id),
    listTagsForActivity(userId, id),
    getSatisfaction(userId, id),
  ]);

  const initialScreenshots = toScreenshotItems(screenshots);

  const capital = Number(row.amountUsdAtOpen ?? 0);
  const rewardsUsd = Number(row.rewardsUsdValue ?? 0);
  const expectedApy = row.expectedApyPct ? Number(row.expectedApyPct) : null;
  const realizedApy = row.realizedApyPct ? Number(row.realizedApyPct) : null;
  const feesProtocol = Number(row.feesProtocolUsd ?? 0);
  const feesGas = Number(row.feesGasUsd ?? 0);
  const totalFees = feesProtocol + feesGas;
  const realizedPnl = Number(row.realizedPnlUsd ?? 0);
  const netPnl = Number(row.netPnlUsd ?? 0);
  const serial = `Y#${row.id.slice(0, 4).toUpperCase()}`;
  const daysHeld = (() => {
    const start = new Date(row.openedAt).getTime();
    // Date.now is pure-at-request-time inside this async Server Component.
    // eslint-disable-next-line react-hooks/purity
    const end = row.closedAt ? new Date(row.closedAt).getTime() : Date.now();
    if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
    return Math.max(0, Math.floor((end - start) / 86_400_000));
  })();

  return (
    <article className="mx-auto max-w-4xl px-6 py-14 md:py-20">
          <WizardPreviewBanner from={sp.from} action={sp.action} />

          {/* ── Header ──────────────────────────────────────────────────── */}
          <div className="flex items-center justify-between font-mono text-xs text-text-tertiary">
            <span>{serial}</span>
            <span className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-subtle px-2.5 py-0.5">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    row.status === "open"
                      ? "bg-up"
                      : row.status === "unwinding"
                        ? "bg-warn"
                        : "bg-text-tertiary"
                  }`}
                />
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em]">
                  {row.status}
                </span>
              </span>
              <span>{fmtDate(row.openedAt)}</span>
            </span>
          </div>

          <header className="mt-6">
            <div className="flex items-start justify-between gap-6">
              <h1 className="font-serif text-4xl font-medium leading-tight tracking-tight text-text md:text-5xl">
                {row.name}
              </h1>
              <Link
                href={`/add/yield/fields?edit=${row.id}`}
                aria-label="Edit yield position"
                className="mt-2 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-text-tertiary transition-colors hover:border-border-strong hover:text-text"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Link>
            </div>
            <p className="mt-3 text-base text-text-secondary">
              {row.asset.toUpperCase()} · {row.protocol} · {row.kind}
              {row.chain && <> · {row.chain}</>}
            </p>
            <p className="mt-1 font-mono text-sm text-text-tertiary">
              {daysHeld} day{daysHeld === 1 ? "" : "s"} held
              {row.closedAt && <> · closed {fmtDate(row.closedAt)}</>}
            </p>
            <div className="mt-5">
              <SatisfactionToggle
                activityId={row.id}
                initialSatisfaction={satisfaction?.satisfaction ?? null}
                initialReason={satisfaction?.reason ?? null}
              />
            </div>
          </header>

          {/* ── Hero card ──────────────────────────────────────────────── */}
          <section className="mt-14">
            <YieldPositionCard
              name={row.name}
              status={row.status}
              serial={serial}
              openedAt={row.openedAt}
              closedAt={row.closedAt}
              kind={row.kind}
              protocol={row.protocol}
              asset={row.asset}
              capitalUsd={capital > 0 ? capital : null}
              rewardsUsd={rewardsUsd > 0 ? rewardsUsd : null}
              expectedApyPct={expectedApy}
              realizedApyPct={realizedApy}
            />
          </section>

          {/* ── Position summary ───────────────────────────────────────── */}
          <section className="mt-14">
            <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              Position summary
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
                  <ExecRow label="Protocol" value={row.protocol} mono />
                  {row.venue && <ExecRow label="Venue" value={row.venue} mono />}
                  {row.chain && <ExecRow label="Chain" value={row.chain} mono />}
                  <ExecRow
                    label="Asset deployed"
                    value={`${fmtAmount(row.amount)} ${row.asset.toUpperCase()}`}
                    mono
                  />
                  <ExecRow
                    label="Capital (USD)"
                    value={capital > 0 ? fmtUsd(capital) : "—"}
                    mono
                  />
                  <ExecRow
                    label="Expected APY"
                    value={expectedApy !== null ? fmtPct(expectedApy, false) : "—"}
                    mono
                  />
                  {realizedApy !== null && (
                    <ExecRow
                      label="Realized APY"
                      value={
                        <span
                          className={
                            realizedApy >= 0
                              ? "text-up font-medium"
                              : "text-down font-medium"
                          }
                        >
                          {fmtPct(realizedApy, true)}
                        </span>
                      }
                      mono
                    />
                  )}
                  {row.rewardsToken && (
                    <ExecRow
                      label="Reward token"
                      value={row.rewardsToken.toUpperCase()}
                      mono
                    />
                  )}
                  <ExecRow
                    label="Rewards (USD)"
                    value={rewardsUsd > 0 ? fmtUsd(rewardsUsd) : "—"}
                    mono
                  />
                  <ExecRow
                    label="Protocol fees"
                    value={fmtUsd(feesProtocol)}
                    mono
                  />
                  <ExecRow label="Gas fees" value={fmtUsd(feesGas)} mono />
                  <ExecRow label="Total fees" value={fmtUsd(totalFees)} mono />
                  <ExecRow
                    label="Realized P&L"
                    value={
                      <span
                        className={
                          realizedPnl >= 0
                            ? "text-up font-medium"
                            : "text-down font-medium"
                        }
                      >
                        {fmtUsd(realizedPnl, true)}
                      </span>
                    }
                    mono
                  />
                  <ExecRow
                    label="Net P&L"
                    value={
                      <span
                        className={
                          netPnl >= 0
                            ? "text-up font-medium"
                            : "text-down font-medium"
                        }
                      >
                        {fmtUsd(netPnl, true)}
                      </span>
                    }
                    mono
                  />
                </TableBody>
              </Table>
            </div>
          </section>

          {/* ── Kind-specific card ─────────────────────────────────────── */}
          {row.kindMeta && <KindMetaCard meta={row.kindMeta} kind={row.kind} />}

          {/* ── Rewards snapshot history (manual log) ──────────────────── */}
          <section className="mt-14">
            <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              Rewards snapshots
            </h2>
            <p className="mt-2 font-serif text-[12px] italic text-text-tertiary">
              v5 stores the latest snapshot; per-snapshot history lands when the
              worker cycle table ships in v6.
            </p>
            <div className="mt-4 overflow-hidden rounded-md border border-border bg-surface">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-text-tertiary">Field</TableHead>
                    <TableHead className="text-right text-text-secondary">
                      Value
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <ExecRow
                    label="Rewards accrued"
                    value={`${fmtAmount(row.rewardsAccrued)} ${
                      (row.rewardsToken ?? row.asset).toUpperCase()
                    }`}
                    mono
                  />
                  <ExecRow
                    label="Rewards claimed"
                    value={`${fmtAmount(row.rewardsClaimed)} ${
                      (row.rewardsToken ?? row.asset).toUpperCase()
                    }`}
                    mono
                  />
                  <ExecRow
                    label="Snapshot USD"
                    value={rewardsUsd > 0 ? fmtUsd(rewardsUsd) : "—"}
                    mono
                  />
                  <ExecRow
                    label="Snapshot taken at"
                    value={fmtDate(row.currentPriceAt)}
                    mono
                  />
                </TableBody>
              </Table>
            </div>

            {/* Inline form to snapshot new rewards. Server action recomputes
                rewards_usd_value + realized_pnl in one transaction. */}
            <form action={snapshotRewards} className="mt-4 flex flex-col gap-3 rounded-md border border-border-subtle bg-subtle/30 p-4 md:flex-row md:items-end">
              <input type="hidden" name="activityId" value={row.id} />
              <div className="flex-1">
                <label
                  htmlFor="snapshot-qty"
                  className="block font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary"
                >
                  Reward qty earned since last snapshot
                </label>
                <WizardInput
                  id="snapshot-qty"
                  name="qty"
                  type="number"
                  step="any"
                  min="0"
                  inputMode="decimal"
                  defaultValue="0"
                  className="mt-1.5"
                />
              </div>
              <div className="flex-1">
                <label
                  htmlFor="snapshot-usd"
                  className="block font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary"
                >
                  Total reward value (USD)
                </label>
                <WizardInput
                  id="snapshot-usd"
                  name="usd"
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  defaultValue={rewardsUsd > 0 ? rewardsUsd.toString() : "0"}
                  className="mt-1.5"
                />
              </div>
              <WizardSubmitButton>Snapshot rewards</WizardSubmitButton>
            </form>
          </section>

          {/* ── Tags ───────────────────────────────────────────────────── */}
          {row.regimeTags.length > 0 && (
            <section className="mt-14">
              <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
                Regime tags
              </h2>
              <div className="mt-4 flex flex-wrap gap-2">
                {row.regimeTags.map((tag) => (
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

          {/* ── Notes ──────────────────────────────────────────────────── */}
          <section className="mt-14">
            <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              Notes
            </h2>
            <p className="mt-2 font-serif text-[12px] italic text-text-tertiary">
              Capture what you learned from this position. Edit anytime.
            </p>
            <div className="mt-4">
              <NotesEditor
                activityId={row.id}
                initialBody={note?.body ?? ""}
                initialVersion={note?.updatedAt ?? null}
                initialNoteId={note?.id ?? null}
              />
            </div>
          </section>

          {/* ── Custom tags ────────────────────────────────────────────── */}
          <section className="mt-14">
            <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              Custom tags
            </h2>
            <p className="mt-2 font-serif text-[12px] italic text-text-tertiary">
              Free-form tags for grouping in saved views.
            </p>
            <div className="mt-4">
              <TagEditor activityId={row.id} initialTags={initialTags} />
            </div>
          </section>

          {/* ── Screenshots ────────────────────────────────────────────── */}
          <section className="mt-14">
            <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              Screenshots
            </h2>
            <p className="mt-2 font-serif text-[12px] italic text-text-tertiary">
              Drop a screenshot of the position, validator dashboard, or rewards.
            </p>
            <div className="mt-4">
              <ScreenshotsSection
                activityId={row.id}
                initialScreenshots={initialScreenshots}
              />
            </div>
          </section>

          {/* ── Actions ────────────────────────────────────────────────── */}
          <section className="mt-14">
            <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              Actions
            </h2>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Link
                href={`/add/yield/fields?edit=${row.id}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary transition-colors hover:border-border-strong hover:text-text"
              >
                <Pencil className="h-3 w-3" />
                Edit
              </Link>
              {row.status === "open" && (
                <form action={markUnwindingYieldPosition} className="inline">
                  <input type="hidden" name="activityId" value={row.id} />
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary transition-colors hover:border-warn hover:text-warn"
                  >
                    Mark unwinding
                  </button>
                </form>
              )}
              {row.status !== "closed" && (
                <form action={closeYieldPosition} className="inline">
                  <input type="hidden" name="activityId" value={row.id} />
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary transition-colors hover:border-border-strong hover:text-text"
                  >
                    Close position
                  </button>
                </form>
              )}
              <DeleteButton
                activityId={row.id}
                activityType="yield_position"
                serial={serial}
              />
            </div>
          </section>

          <footer className="mt-20 border-t border-border pt-6 font-mono text-xs text-text-tertiary">
            <div className="flex items-center justify-between">
              <Link
                href="/spreads/archive?activity=yield_position"
                className="hover:text-text"
              >
                ← Back to yield positions
              </Link>
              <span>{serial.toLowerCase()}</span>
            </div>
          </footer>
    </article>
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

/**
 * Render the kind_meta JSON payload as a typed exec table. Each `kind` has
 * its own row vocabulary — extracted into a discriminated switch so a
 * stake row never accidentally renders the mining hashrate field.
 */
function KindMetaCard({
  meta,
  kind,
}: {
  meta: NonNullable<
    Awaited<ReturnType<typeof getYieldPositionForEdit>>
  >["kindMeta"];
  kind: string;
}) {
  if (!meta) return null;
  const heading = `${kind.charAt(0).toUpperCase()}${kind.slice(1)} details`;
  return (
    <section className="mt-14">
      <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
        {heading}
      </h2>
      <div className="mt-6 overflow-hidden rounded-md border border-border bg-surface">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-text-tertiary">Field</TableHead>
              <TableHead className="text-right text-text-secondary">
                Value
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {meta.kind === "stake" && (
              <>
                {meta.validatorAddress && (
                  <ExecRow
                    label="Validator address"
                    value={meta.validatorAddress}
                    mono
                  />
                )}
                {meta.operator && (
                  <ExecRow label="Operator" value={meta.operator} mono />
                )}
              </>
            )}
            {meta.kind === "lend" && (
              <>
                <ExecRow label="Rate kind" value={meta.rateKind} mono />
                {meta.ltv != null && (
                  <ExecRow label="LTV" value={`${meta.ltv}%`} mono />
                )}
              </>
            )}
            {meta.kind === "farm" && (
              <>
                <ExecRow
                  label="Pair A"
                  value={`${fmtAmount(meta.amountA)} ${meta.pairA.toUpperCase()}`}
                  mono
                />
                <ExecRow
                  label="Pair B"
                  value={`${fmtAmount(meta.amountB)} ${meta.pairB.toUpperCase()}`}
                  mono
                />
                {meta.poolFeeTier && (
                  <ExecRow label="Pool fee" value={meta.poolFeeTier} mono />
                )}
                <ExecRow
                  label="Reward token"
                  value={meta.rewardToken.toUpperCase()}
                  mono
                />
              </>
            )}
            {meta.kind === "lp" && (
              <>
                <ExecRow
                  label="Pair A"
                  value={`${fmtAmount(meta.amountA)} ${meta.pairA.toUpperCase()}`}
                  mono
                />
                <ExecRow
                  label="Pair B"
                  value={`${fmtAmount(meta.amountB)} ${meta.pairB.toUpperCase()}`}
                  mono
                />
                <ExecRow label="Pool fee tier" value={meta.poolFeeTier} mono />
                <ExecRow
                  label="Concentrated?"
                  value={meta.concentrated ? "Yes (v3)" : "No (v2)"}
                  mono
                />
                {meta.rangeLower && (
                  <ExecRow
                    label="Range lower"
                    value={fmtAmount(meta.rangeLower)}
                    mono
                  />
                )}
                {meta.rangeUpper && (
                  <ExecRow
                    label="Range upper"
                    value={fmtAmount(meta.rangeUpper)}
                    mono
                  />
                )}
              </>
            )}
            {meta.kind === "validator" && (
              <>
                <ExecRow
                  label="Validator address"
                  value={meta.validatorAddress}
                  mono
                />
                <ExecRow
                  label="Commission"
                  value={`${meta.commissionPct}%`}
                  mono
                />
              </>
            )}
            {meta.kind === "mining" && (
              <>
                <ExecRow
                  label="Hashrate"
                  value={`${meta.hashrateThs} TH/s`}
                  mono
                />
                <ExecRow
                  label="Electricity"
                  value={`$${meta.electricityCostUsdKwh}/kWh`}
                  mono
                />
                <ExecRow label="Pool" value={meta.pool} mono />
                <ExecRow
                  label="Expected revenue / day"
                  value={fmtUsd(meta.expectedDailyRevenueUsd)}
                  mono
                />
              </>
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
