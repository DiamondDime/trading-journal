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
import { fmtCapital, fmtUsd } from "@/lib/data/archive-data";
import { WizardPreviewBanner } from "@/components/wizard/wizard-preview-banner";
import { requireUser } from "@/lib/auth/server";
import { getT, getLocale } from "@/lib/i18n/server";
import { getActivity, getAllClosedActivities } from "@/lib/db/activity";
import { getNoteForActivity } from "@/lib/db/notes";
import {
  getExcursionForActivity,
  getSatisfaction,
  listScreenshotsForActivity,
  listTagsForActivity,
} from "@/lib/db/satellite";
import { computeMoreMetrics } from "@/lib/analytics";
import { DeleteButton } from "@/components/activity/delete-button";
import { NotesEditor } from "@/components/activity/notes-editor";
import { ScreenshotsSection } from "@/components/activity/screenshots-section";
import { toScreenshotItems } from "@/components/activity/screenshots-data";
import { TagEditor } from "@/components/activity/tag-editor";
import { SatisfactionToggle } from "@/components/activity/satisfaction-toggle";
import { ExcursionMetricStrip } from "@/components/activity/excursion-metric-strip";
import { OhlcChart } from "@/components/activity/ohlc-chart";
import { ExchangeChip } from "@/components/settings/exchange-logo";

export const dynamic = "force-dynamic";

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtSidePill(side: "long" | "short", label: string) {
  const cls = side === "long" ? "text-up" : "text-down";
  return (
    <span className={`font-mono text-[10px] uppercase tracking-[0.16em] ${cls}`}>
      {label}
    </span>
  );
}

function fmtPrice(n: number, intlLocale: string) {
  if (n < 1) {
    return n.toLocaleString(intlLocale, { maximumSignificantDigits: 4 });
  }
  return n.toLocaleString(intlLocale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtDaysLabel(
  openedIso: string | null,
  closedIso: string | null,
  units: { min: string; hour: string; day: string },
) {
  if (!openedIso || !closedIso) return "—";
  const ms = new Date(closedIso).getTime() - new Date(openedIso).getTime();
  const d = ms / 86_400_000;
  if (d < 1) {
    const hours = d * 24;
    if (hours < 1) return `${Math.round(hours * 60)} ${units.min}`;
    return `${hours.toFixed(1)}${units.hour}`;
  }
  return `${Math.round(d)}${units.day}`;
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

  const t = await getT();
  const intlLocale = (await getLocale()) === "ru" ? "ru-RU" : "en-US";
  const { id: userId } = await requireUser();
  // Fetch everything needed for the page in parallel — supertype + note +
  // screenshots + satellite tables + the closed-feed needed for the R-unit
  // baseline (computeMoreMetrics.avgLoss).
  const [
    activity,
    note,
    screenshots,
    excursion,
    initialTags,
    satisfaction,
    allClosed,
  ] = await Promise.all([
    getActivity(userId, id),
    getNoteForActivity(userId, id),
    listScreenshotsForActivity(userId, id),
    getExcursionForActivity(userId, id),
    listTagsForActivity(userId, id),
    getSatisfaction(userId, id),
    getAllClosedActivities(userId),
  ]);
  if (!activity || activity.subtype.type !== "trade") {
    notFound();
  }
  const initialScreenshots = toScreenshotItems(screenshots);
  // avgLoss across the book is the R-unit baseline. The metrics module
  // returns a positive number (sum of |losses| / lossCount); see
  // computeMoreMetrics for the convention.
  const moreMetrics = computeMoreMetrics(allClosed);
  const avgLossUsd = moreMetrics.avgLoss;

  const trade = activity.subtype.row;
  const apr = fmtAprPct(trade.realizedApr);
  const headlineTone = apr.tone === "up" ? "text-up" : "text-down";
  const netPnl = Number(activity.netPnlUsd ?? 0);
  const capital = Number(activity.capitalDeployedUsd ?? 0);
  const qty = Number(trade.qty);
  const entry = Number(trade.avgEntryPrice);
  // exit is null for open trades. Keep it as null so we can render "—" in
  // the decomposition rather than misleadingly mirroring the entry price.
  const exit = trade.avgExitPrice !== null ? Number(trade.avgExitPrice) : null;
  const fees = Number(activity.feesUsd);
  const gross = netPnl + fees;
  const daysLabel = fmtDaysLabel(activity.openedAt, activity.closedAt, {
    min: t("tradeDetail.units.min"),
    hour: t("tradeDetail.units.hour"),
    day: t("tradeDetail.units.day"),
  });
  const closedLabel = activity.closedAt
    ? new Date(activity.closedAt).toLocaleDateString(intlLocale, { month: "short", day: "numeric", year: "numeric" })
    : "—";
  // Status uses the top-level status.* dict which covers all 9 ActivityStatus
  // values. Trades can legitimately end as `liquidated`, which was previously
  // collapsed to "pending" by the narrow ternary below.
  const statusLabel = t(`status.${activity.status}`);
  const sideLabel =
    trade.side === "long" ? t("side.long") : t("side.short");
  const serial = `T#${activity.id.slice(0, 4).toUpperCase()}`;

  return (
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
                aria-label={t("tradeDetail.editAria")}
                className="mt-2 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-text-tertiary transition-colors hover:border-border-strong hover:text-text"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Link>
            </div>
            <p className="mt-3 flex flex-wrap items-center gap-2 text-base text-text-secondary">
              <ExchangeChip venue={trade.exchange} size="sm" />
              <span>{trade.exchange} · {trade.symbol} · {trade.instrumentKind} · {sideLabel}</span>
            </p>
            <p className="mt-1 font-mono text-sm text-text-tertiary">
              {t("tradeDetail.heldSuffix", { days: daysLabel })}
            </p>
            {/* Satisfaction pill row — under the title, optimistic flip on
                click. The 3rd state ("—") clears the visible rating but the
                row in activity_satisfaction stays for v1 (see component). */}
            <div className="mt-5">
              <SatisfactionToggle
                activityId={activity.id}
                initialSatisfaction={satisfaction?.satisfaction ?? null}
                initialReason={satisfaction?.reason ?? null}
              />
            </div>
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
                  {t("tradeDetail.aprBadge")}
                </span>
              </div>
              <p className="mt-3 font-mono text-sm text-text-secondary">
                {t("tradeDetail.hero.netPrefix")}{" "}
                <span className={`${headlineTone} font-medium`}>
                  {fmtUsd(netPnl, true)}
                </span>{" "}
                {t("tradeDetail.hero.onCapital", { capital: fmtCapital(capital) })}
              </p>
            </div>
          </section>

          {/* ── price action (OHLC candles + entry/exit/MAE/MFE markers) ─
              Wave 11. Client-side fetch from /api/activities/<id>/klines so
              the page SSR isn't blocked by a slow exchange call. Falls back
              to an italic-serif empty-state when the symbol+exchange isn't
              in the v1 kline registry. */}
          <section className="mt-14">
            <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              {t("tradeDetail.priceAction.title")}
            </h2>
            <p className="mt-2 font-serif text-[12px] italic text-text-tertiary">
              {t("tradeDetail.priceAction.caption")}
            </p>
            <div className="mt-4">
              <OhlcChart activityId={activity.id} />
            </div>
          </section>

          {/* ── MFE-R / MAE-R / Realized-R ────────────────────────────── */}
          <ExcursionMetricStrip
            activityId={activity.id}
            excursion={excursion}
            avgLossUsd={avgLossUsd}
            entryPrice={trade.avgEntryPrice}
            side={trade.side}
            netPnlUsd={netPnl}
            qty={trade.qty}
          />

          {/* ── thesis ────────────────────────────────────────────────── */}
          <section className="mt-14">
            <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              {t("tradeDetail.thesis.title")}
            </h2>
            <div className="mt-4 space-y-4 font-serif text-lg leading-[1.65] text-text">
              {trade.entryThesis ? <p>{trade.entryThesis}</p> : <p className="text-text-tertiary">—</p>}
            </div>
          </section>

          {/* ── decomposition ─────────────────────────────────────────── */}
          <section className="mt-14">
            <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              {t("tradeDetail.decomposition.title")}
            </h2>

            <div className="mt-6 overflow-hidden rounded-md border border-border bg-surface">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-text-tertiary">&nbsp;</TableHead>
                    <TableHead className="text-right text-text-secondary">
                      {t("tradeDetail.decomposition.valueHeader")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <ExecRow label={t("fields.side")} value={fmtSidePill(trade.side, sideLabel)} />
                  <ExecRow
                    label={t("fields.quantity")}
                    value={qty.toLocaleString(intlLocale, { maximumSignificantDigits: 6 })}
                    mono
                  />
                  <ExecRow label={t("tradeDetail.rows.entryPrice")} value={`$${fmtPrice(entry, intlLocale)}`} mono />
                  <ExecRow
                    label={t("tradeDetail.rows.exitPrice")}
                    value={exit !== null ? `$${fmtPrice(exit, intlLocale)}` : "—"}
                    mono
                  />
                  <ExecRow
                    label={t("tradeDetail.rows.grossPnl")}
                    value={
                      <span className={gross >= 0 ? "text-up" : "text-down"}>
                        {fmtUsd(gross, true)}
                      </span>
                    }
                    mono
                  />
                  <ExecRow
                    label={t("tradeDetail.rows.fees")}
                    value={
                      <span className="text-text-secondary">
                        {fmtUsd(fees * -1, true)}
                      </span>
                    }
                    mono
                  />
                  <ExecRow
                    label={t("tradeDetail.rows.netPnl")}
                    value={
                      <span className={`font-medium ${headlineTone}`}>
                        {fmtUsd(netPnl, true)}
                      </span>
                    }
                    mono
                  />
                  <ExecRow
                    label={t("tradeDetail.rows.realizedApr")}
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
                {t("tradeDetail.regimeTags.title")}
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
              {t("tradeDetail.notes.title")}
            </h2>
            <p className="mt-2 font-serif text-[12px] italic text-text-tertiary">
              {t("tradeDetail.notes.caption")}
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

          {/* ── free-form tags ────────────────────────────────────────── */}
          <section className="mt-14">
            <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              {t("tradeDetail.tags.title")}
            </h2>
            <p className="mt-2 font-serif text-[12px] italic text-text-tertiary">
              {t("tradeDetail.tags.caption")}
            </p>
            <div className="mt-4">
              <TagEditor activityId={activity.id} initialTags={initialTags} />
            </div>
          </section>

          {/* ── screenshots ───────────────────────────────────────────── */}
          <section className="mt-14">
            <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              {t("tradeDetail.screenshots.title")}
            </h2>
            <p className="mt-2 font-serif text-[12px] italic text-text-tertiary">
              {t("tradeDetail.screenshots.caption")}
            </p>
            <div className="mt-4">
              <ScreenshotsSection
                activityId={activity.id}
                initialScreenshots={initialScreenshots}
              />
            </div>
          </section>

          {/* ── actions ───────────────────────────────────────────────── */}
          <section className="mt-14">
            <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              {t("tradeDetail.actions.title")}
            </h2>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Link
                href={`/add/trade/fields?edit=${activity.id}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary transition-colors hover:border-border-strong hover:text-text"
              >
                <Pencil className="h-3 w-3" />
                {t("common.edit")}
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
                {t("tradeDetail.footer.back")}
              </Link>
              <span>
                {t("tradeDetail.footer.serial", { serial: serial.toLowerCase() })}
              </span>
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
