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
import { getT, getLocale } from "@/lib/i18n/server";
import type { Locale } from "@/lib/i18n/types";
import type { TFunction } from "@/lib/i18n/resolve";
import type { YieldKind } from "@/types/canonical";

export const dynamic = "force-dynamic";

function intlLocale(locale: Locale): string {
  return locale === "ru" ? "ru-RU" : "en-US";
}

function fmtUsd(n: number, locale: Locale, signed = false): string {
  const abs = Math.abs(n).toLocaleString(intlLocale(locale), {
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

function fmtDate(iso: string | null | undefined, locale: Locale): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString(intlLocale(locale), {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtAmount(s: string, locale: Locale): string {
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return n.toLocaleString(intlLocale(locale), { maximumSignificantDigits: 6 });
}

const YIELD_KIND_LITERALS = ["stake", "lend", "farm", "lp", "validator", "mining"] as const;

function isYieldKindLiteral(s: string): s is YieldKind {
  return (YIELD_KIND_LITERALS as readonly string[]).includes(s);
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
  const t = await getT();
  const locale = await getLocale();

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
                  {t(`status.${row.status}` as const)}
                </span>
              </span>
              <span>{fmtDate(row.openedAt, locale)}</span>
            </span>
          </div>

          <header className="mt-6">
            <div className="flex items-start justify-between gap-6">
              <h1 className="font-serif text-4xl font-medium leading-tight tracking-tight text-text md:text-5xl">
                {row.name}
              </h1>
              <Link
                href={`/add/yield/fields?edit=${row.id}`}
                aria-label={t("yieldPositions.detail.editAria")}
                className="mt-2 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-text-tertiary transition-colors hover:border-border-strong hover:text-text"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Link>
            </div>
            <p className="mt-3 text-base text-text-secondary">
              {row.asset.toUpperCase()} · {row.protocol} ·{" "}
              {isYieldKindLiteral(row.kind)
                ? t(`yieldKind.${row.kind}` as const)
                : row.kind}
              {row.chain && <> · {row.chain}</>}
            </p>
            <p className="mt-1 font-mono text-sm text-text-tertiary">
              {t.plural("yieldPositions.detail.daysHeld", daysHeld, {
                count: daysHeld,
              })}
              {row.closedAt && (
                <>
                  {" · "}
                  {t("yieldPositions.detail.closedSuffix", {
                    date: fmtDate(row.closedAt, locale),
                  })}
                </>
              )}
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
              {t("yieldPositions.detail.sections.summary")}
            </h2>
            <div className="mt-6 overflow-hidden rounded-md border border-border bg-surface">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-text-tertiary">&nbsp;</TableHead>
                    <TableHead className="text-right text-text-secondary">
                      {t("yieldPositions.detail.columns.value")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <ExecRow
                    label={t("yieldPositions.detail.rows.protocol")}
                    value={row.protocol}
                    mono
                  />
                  {row.venue && (
                    <ExecRow
                      label={t("yieldPositions.detail.rows.venue")}
                      value={row.venue}
                      mono
                    />
                  )}
                  {row.chain && (
                    <ExecRow
                      label={t("yieldPositions.detail.rows.chain")}
                      value={row.chain}
                      mono
                    />
                  )}
                  <ExecRow
                    label={t("yieldPositions.detail.rows.assetDeployed")}
                    value={`${fmtAmount(row.amount, locale)} ${row.asset.toUpperCase()}`}
                    mono
                  />
                  <ExecRow
                    label={t("yieldPositions.detail.rows.capitalUsd")}
                    value={capital > 0 ? fmtUsd(capital, locale) : "—"}
                    mono
                  />
                  <ExecRow
                    label={t("yieldPositions.detail.rows.expectedApy")}
                    value={expectedApy !== null ? fmtPct(expectedApy, false) : "—"}
                    mono
                  />
                  {realizedApy !== null && (
                    <ExecRow
                      label={t("yieldPositions.detail.rows.realizedApy")}
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
                      label={t("yieldPositions.detail.rows.rewardToken")}
                      value={row.rewardsToken.toUpperCase()}
                      mono
                    />
                  )}
                  <ExecRow
                    label={t("yieldPositions.detail.rows.rewardsUsd")}
                    value={rewardsUsd > 0 ? fmtUsd(rewardsUsd, locale) : "—"}
                    mono
                  />
                  <ExecRow
                    label={t("yieldPositions.detail.rows.protocolFees")}
                    value={fmtUsd(feesProtocol, locale)}
                    mono
                  />
                  <ExecRow
                    label={t("yieldPositions.detail.rows.gasFees")}
                    value={fmtUsd(feesGas, locale)}
                    mono
                  />
                  <ExecRow
                    label={t("yieldPositions.detail.rows.totalFees")}
                    value={fmtUsd(totalFees, locale)}
                    mono
                  />
                  <ExecRow
                    label={t("yieldPositions.detail.rows.realizedPnl")}
                    value={
                      <span
                        className={
                          realizedPnl >= 0
                            ? "text-up font-medium"
                            : "text-down font-medium"
                        }
                      >
                        {fmtUsd(realizedPnl, locale, true)}
                      </span>
                    }
                    mono
                  />
                  <ExecRow
                    label={t("yieldPositions.detail.rows.netPnl")}
                    value={
                      <span
                        className={
                          netPnl >= 0
                            ? "text-up font-medium"
                            : "text-down font-medium"
                        }
                      >
                        {fmtUsd(netPnl, locale, true)}
                      </span>
                    }
                    mono
                  />
                </TableBody>
              </Table>
            </div>
          </section>

          {/* ── Kind-specific card ─────────────────────────────────────── */}
          {row.kindMeta && (
            <KindMetaCard meta={row.kindMeta} kind={row.kind} t={t} locale={locale} />
          )}

          {/* ── Rewards snapshot history (manual log) ──────────────────── */}
          <section className="mt-14">
            <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              {t("yieldPositions.detail.sections.rewardsSnapshots")}
            </h2>
            <p className="mt-2 font-serif text-[12px] italic text-text-tertiary">
              {t("yieldPositions.detail.hints.rewardsSnapshots")}
            </p>
            <div className="mt-4 overflow-hidden rounded-md border border-border bg-surface">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-text-tertiary">
                      {t("yieldPositions.detail.columns.field")}
                    </TableHead>
                    <TableHead className="text-right text-text-secondary">
                      {t("yieldPositions.detail.columns.value")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <ExecRow
                    label={t("yieldPositions.detail.rows.rewardsAccrued")}
                    value={`${fmtAmount(row.rewardsAccrued, locale)} ${
                      (row.rewardsToken ?? row.asset).toUpperCase()
                    }`}
                    mono
                  />
                  <ExecRow
                    label={t("yieldPositions.detail.rows.rewardsClaimed")}
                    value={`${fmtAmount(row.rewardsClaimed, locale)} ${
                      (row.rewardsToken ?? row.asset).toUpperCase()
                    }`}
                    mono
                  />
                  <ExecRow
                    label={t("yieldPositions.detail.rows.snapshotUsd")}
                    value={rewardsUsd > 0 ? fmtUsd(rewardsUsd, locale) : "—"}
                    mono
                  />
                  <ExecRow
                    label={t("yieldPositions.detail.rows.snapshotTakenAt")}
                    value={fmtDate(row.currentPriceAt, locale)}
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
                  {t("yieldPositions.detail.snapshotForm.qtyLabel")}
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
                  {t("yieldPositions.detail.snapshotForm.usdLabel")}
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
              <WizardSubmitButton>
                {t("yieldPositions.detail.snapshotForm.submit")}
              </WizardSubmitButton>
            </form>
          </section>

          {/* ── Tags ───────────────────────────────────────────────────── */}
          {row.regimeTags.length > 0 && (
            <section className="mt-14">
              <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
                {t("yieldPositions.detail.sections.regimeTags")}
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
              {t("yieldPositions.detail.sections.notes")}
            </h2>
            <p className="mt-2 font-serif text-[12px] italic text-text-tertiary">
              {t("yieldPositions.detail.hints.notes")}
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
              {t("yieldPositions.detail.sections.customTags")}
            </h2>
            <p className="mt-2 font-serif text-[12px] italic text-text-tertiary">
              {t("yieldPositions.detail.hints.customTags")}
            </p>
            <div className="mt-4">
              <TagEditor activityId={row.id} initialTags={initialTags} />
            </div>
          </section>

          {/* ── Screenshots ────────────────────────────────────────────── */}
          <section className="mt-14">
            <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              {t("yieldPositions.detail.sections.screenshots")}
            </h2>
            <p className="mt-2 font-serif text-[12px] italic text-text-tertiary">
              {t("yieldPositions.detail.hints.screenshots")}
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
              {t("yieldPositions.detail.sections.actions")}
            </h2>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Link
                href={`/add/yield/fields?edit=${row.id}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary transition-colors hover:border-border-strong hover:text-text"
              >
                <Pencil className="h-3 w-3" />
                {t("yieldPositions.detail.actions.edit")}
              </Link>
              {row.status === "open" && (
                <form action={markUnwindingYieldPosition} className="inline">
                  <input type="hidden" name="activityId" value={row.id} />
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary transition-colors hover:border-warn hover:text-warn"
                  >
                    {t("yieldPositions.detail.actions.markUnwinding")}
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
                    {t("yieldPositions.detail.actions.closePosition")}
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
                {t("yieldPositions.detail.footer.back")}
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
  t,
  locale,
}: {
  meta: NonNullable<
    Awaited<ReturnType<typeof getYieldPositionForEdit>>
  >["kindMeta"];
  kind: string;
  t: TFunction;
  locale: Locale;
}) {
  if (!meta) return null;
  const kindLabel = isYieldKindLiteral(kind)
    ? t(`yieldKind.${kind}` as const)
    : kind;
  const heading = t("yieldPositions.detail.kindDetailsHeading", {
    kind: kindLabel,
  });
  return (
    <section className="mt-14">
      <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
        {heading}
      </h2>
      <div className="mt-6 overflow-hidden rounded-md border border-border bg-surface">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-text-tertiary">
                {t("yieldPositions.detail.columns.field")}
              </TableHead>
              <TableHead className="text-right text-text-secondary">
                {t("yieldPositions.detail.columns.value")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {meta.kind === "stake" && (
              <>
                {meta.validatorAddress && (
                  <ExecRow
                    label={t("yieldPositions.detail.rows.validatorAddress")}
                    value={meta.validatorAddress}
                    mono
                  />
                )}
                {meta.operator && (
                  <ExecRow
                    label={t("yieldPositions.detail.rows.operator")}
                    value={meta.operator}
                    mono
                  />
                )}
              </>
            )}
            {meta.kind === "lend" && (
              <>
                <ExecRow
                  label={t("yieldPositions.detail.rows.rateKind")}
                  value={
                    meta.rateKind === "fixed"
                      ? t("wizard.yield.fields.rateKind.fixed")
                      : meta.rateKind === "variable"
                        ? t("wizard.yield.fields.rateKind.variable")
                        : meta.rateKind
                  }
                  mono
                />
                {meta.ltv != null && (
                  <ExecRow
                    label={t("yieldPositions.detail.rows.ltv")}
                    value={`${meta.ltv}%`}
                    mono
                  />
                )}
              </>
            )}
            {meta.kind === "farm" && (
              <>
                <ExecRow
                  label={t("yieldPositions.detail.rows.pairA")}
                  value={`${fmtAmount(meta.amountA, locale)} ${meta.pairA.toUpperCase()}`}
                  mono
                />
                <ExecRow
                  label={t("yieldPositions.detail.rows.pairB")}
                  value={`${fmtAmount(meta.amountB, locale)} ${meta.pairB.toUpperCase()}`}
                  mono
                />
                {meta.poolFeeTier && (
                  <ExecRow
                    label={t("yieldPositions.detail.rows.poolFee")}
                    value={meta.poolFeeTier}
                    mono
                  />
                )}
                <ExecRow
                  label={t("yieldPositions.detail.rows.rewardToken")}
                  value={meta.rewardToken.toUpperCase()}
                  mono
                />
              </>
            )}
            {meta.kind === "lp" && (
              <>
                <ExecRow
                  label={t("yieldPositions.detail.rows.pairA")}
                  value={`${fmtAmount(meta.amountA, locale)} ${meta.pairA.toUpperCase()}`}
                  mono
                />
                <ExecRow
                  label={t("yieldPositions.detail.rows.pairB")}
                  value={`${fmtAmount(meta.amountB, locale)} ${meta.pairB.toUpperCase()}`}
                  mono
                />
                <ExecRow
                  label={t("yieldPositions.detail.rows.poolFeeTier")}
                  value={meta.poolFeeTier}
                  mono
                />
                <ExecRow
                  label={t("yieldPositions.detail.rows.concentrated")}
                  value={
                    meta.concentrated
                      ? t("yieldPositions.detail.rows.concentratedYes")
                      : t("yieldPositions.detail.rows.concentratedNo")
                  }
                  mono
                />
                {meta.rangeLower && (
                  <ExecRow
                    label={t("yieldPositions.detail.rows.rangeLower")}
                    value={fmtAmount(meta.rangeLower, locale)}
                    mono
                  />
                )}
                {meta.rangeUpper && (
                  <ExecRow
                    label={t("yieldPositions.detail.rows.rangeUpper")}
                    value={fmtAmount(meta.rangeUpper, locale)}
                    mono
                  />
                )}
              </>
            )}
            {meta.kind === "validator" && (
              <>
                <ExecRow
                  label={t("yieldPositions.detail.rows.validatorAddress")}
                  value={meta.validatorAddress}
                  mono
                />
                <ExecRow
                  label={t("yieldPositions.detail.rows.commission")}
                  value={`${meta.commissionPct}%`}
                  mono
                />
              </>
            )}
            {meta.kind === "mining" && (
              <>
                <ExecRow
                  label={t("yieldPositions.detail.rows.hashrate")}
                  value={`${meta.hashrateThs} TH/s`}
                  mono
                />
                <ExecRow
                  label={t("yieldPositions.detail.rows.electricity")}
                  value={`$${meta.electricityCostUsdKwh}/kWh`}
                  mono
                />
                <ExecRow
                  label={t("yieldPositions.detail.rows.pool")}
                  value={meta.pool}
                  mono
                />
                <ExecRow
                  label={t("yieldPositions.detail.rows.expectedRevenuePerDay")}
                  value={fmtUsd(meta.expectedDailyRevenueUsd, locale)}
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
