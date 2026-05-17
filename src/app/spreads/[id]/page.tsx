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
import { cn } from "@/lib/utils";
import { WizardPreviewBanner } from "@/components/wizard/wizard-preview-banner";
import { requireUser } from "@/lib/auth/server";
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
import { isKlineSupportedExchange } from "@/lib/exchanges/klines";
import { getT, getLocale } from "@/lib/i18n/server";
import type { TFunction } from "@/lib/i18n/resolve";

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
  manualLabel: string,
): DerivedLegs {
  const venue1 = exchanges[0] ?? manualLabel;
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

function fmtDaysLabel(
  openedIso: string | null,
  closedIso: string | null,
  t: TFunction,
) {
  if (!openedIso || !closedIso) return "—";
  const ms = new Date(closedIso).getTime() - new Date(openedIso).getTime();
  const d = ms / 86_400_000;
  if (d < 1) {
    const hours = d * 24;
    if (hours < 1) {
      return t("spreadDetail.duration.minutes", { value: Math.round(hours * 60) });
    }
    return t("spreadDetail.duration.hours", { value: hours.toFixed(1) });
  }
  return t("spreadDetail.duration.days", { value: Math.round(d) });
}

export default async function SpreadDetailPage({
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
  const intlLocale = (await getLocale()) === "ru" ? "ru-RU" : "en-US";
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
  if (!activity || activity.subtype.type !== "spread") {
    notFound();
  }
  const initialScreenshots = toScreenshotItems(screenshots);
  const moreMetrics = computeMoreMetrics(allClosed);
  const avgLossUsd = moreMetrics.avgLoss;

  const s = activity.subtype.row;
  const manualLabel = t("spreadDetail.manualVenue");
  const legs = deriveLegs(s.spreadType, s.exchanges, s.primaryBase, manualLabel);
  const apr = fmtAprPct(s.apr);
  const headlineTone = apr.tone === "up" ? "text-up" : "text-down";
  // Spread type label — pulled from the local SPREAD_TYPE_LABELS constant
  // (English-only). i18n of the 6 spread-type strings is a separate scope
  // touching the wizard, archive, dashboard, and worker mirrors.
  const typeLabel = SPREAD_TYPE_LABELS[s.spreadType] ?? s.spreadType;
  const netPnl = Number(activity.netPnlUsd ?? 0);
  const capital = Number(activity.capitalDeployedUsd ?? 0);
  const daysLabel = fmtDaysLabel(activity.openedAt, activity.closedAt, t);
  // toLocaleDateString — number/date formatting flagged. en-US fallback kept
  // for now; switching to intlLocale once the number/currency formatters in
  // archive-data are unified.
  const closedLabel = activity.closedAt
    ? new Date(activity.closedAt).toLocaleDateString(intlLocale, { month: "short", day: "numeric", year: "numeric" })
    : "—";
  const statusKey: "open" | "closed" | "pending" =
    activity.status === "open" || activity.status === "closed" || activity.status === "pending"
      ? activity.status
      : "closed";
  const statusLabel = t(`status.${statusKey}`);
  const venuesLabel = s.exchanges.length > 0 ? s.exchanges.join(" + ") : manualLabel;
  const serial = `#${activity.id.slice(0, 4).toUpperCase()}`;

  return (
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
          <span>{closedLabel}</span>
        </span>
      </div>

      <header className="mt-6">
        <div className="flex items-start justify-between gap-6">
          <h1 className="font-serif text-4xl font-medium leading-tight tracking-tight text-text md:text-5xl">
            {activity.name}
          </h1>
          <Link
            href={`/add/spread/fields?edit=${activity.id}`}
            aria-label={t("spreadDetail.editAria")}
            className="mt-2 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-text-tertiary transition-colors hover:border-border-strong hover:text-text"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Link>
        </div>
        <p className="mt-3 text-base text-text-secondary">
          {typeLabel} · {s.variant ?? "—"} · {venuesLabel}
        </p>
        <p className="mt-1 font-mono text-sm text-text-tertiary">
          {t("spreadDetail.heldSuffix", { duration: daysLabel })}
        </p>
        <div className="mt-5">
          <SatisfactionToggle
            activityId={activity.id}
            initialSatisfaction={satisfaction?.satisfaction ?? null}
            initialReason={satisfaction?.reason ?? null}
          />
        </div>
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
              {t("spreadDetail.hero.unitApr")}
            </span>
          </div>
          <p className="mt-3 font-mono text-sm text-text-secondary">
            {t("spreadDetail.hero.netPrefix")}{" "}
            <span className={`${headlineTone} font-medium`}>
              {fmtUsd(netPnl, true)}
            </span>{" "}
            {t("spreadDetail.hero.realizedSuffix", { capital: fmtCapital(capital) })}
          </p>
        </div>
      </section>

      {/* ── price action (primary-leg OHLC candles) ──────────────────────
          Wave 11. Spreads don't have a single venue price the way a trade
          does, but we surface the primary base's candles on the first
          supported leg venue so the trader still sees the underlying
          price-action context. The component fetches client-side and falls
          back gracefully when no leg is on a v1-supported exchange.

          Only mount when there's at least one supported exchange in the
          leg list. Otherwise the component would render the same empty
          state — skipping the section keeps the page tighter. */}
      {s.primaryBase && hasSupportedExchange(s.exchanges) && (
        <section className="mt-14">
          <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
            {t("spreadDetail.sections.priceAction")}
          </h2>
          <p className="mt-2 font-serif text-[12px] italic text-text-tertiary">
            {t("spreadDetail.priceActionCaption", { base: s.primaryBase })}
          </p>
          <div className="mt-4">
            <OhlcChart activityId={activity.id} />
          </div>
        </section>
      )}

      {/*
        Spreads expose `primaryBase` (the underlying base symbol the worker
        targets for kline backfill) but no single entryPrice / qty — the
        position is multi-leg. We pass "0" for entryPrice + qty which makes
        the strip degrade MFE-R/MAE-R to "—" gracefully (priceToR returns
        null when those are <= 0). Realized-R still works because it only
        needs netPnlUsd + the avgLoss baseline. When the worker eventually
        materialises spread-level MFE-R/MAE-R into excursion_row, the strip
        will surface them once we wire a spread-specific dollar conversion.
      */}
      {s.primaryBase && (
        <ExcursionMetricStrip
          activityId={activity.id}
          excursion={excursion}
          avgLossUsd={avgLossUsd}
          entryPrice="0"
          side="long"
          netPnlUsd={netPnl}
          qty="0"
        />
      )}

      {s.exitPlan && (
        <section className="mt-14">
          <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
            {t("spreadDetail.sections.thesis")}
          </h2>
          <div className="mt-4 space-y-4 font-serif text-lg leading-[1.65] text-text">
            <p>{s.exitPlan}</p>
          </div>
        </section>
      )}

      <section className="mt-14">
        <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          {t("spreadDetail.sections.decomposition")}
        </h2>
        <p className="mt-2 font-serif text-[12px] italic text-text-tertiary">
          {t("spreadDetail.decompositionCaption")}
        </p>
        <div className="mt-4 overflow-hidden rounded-md border border-border bg-surface">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead scope="col" className="text-text-tertiary">&nbsp;</TableHead>
                <TableHead scope="col" className="text-text-secondary">{t("spreadDetail.legs.leg1")}</TableHead>
                <TableHead scope="col" className="text-text-secondary">{t("spreadDetail.legs.leg2")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <LegRow label={t("fields.venue")} leg1={legs.leg1.venue} leg2={legs.leg2.venue} />
              <LegRow label={t("spreadDetail.legs.symbol")} leg1={legs.leg1.symbol} leg2={legs.leg2.symbol} mono />
              <LegRow label={t("spreadDetail.legs.instrument")} leg1={legs.leg1.instrument} leg2={legs.leg2.instrument} />
              <LegRow
                label={t("fields.side")}
                leg1={<SidePill side={legs.leg1.side} t={t} />}
                leg2={<SidePill side={legs.leg2.side} t={t} />}
              />
            </TableBody>
          </Table>
        </div>
      </section>

      {activity.regimeTags.length > 0 && (
        <section className="mt-14">
          <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
            {t("spreadDetail.sections.regimeTags")}
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
          {t("spreadDetail.sections.notes")}
        </h2>
        <p className="mt-2 font-serif text-[12px] italic text-text-tertiary">
          {t("spreadDetail.notesCaption")}
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
          {t("spreadDetail.sections.tags")}
        </h2>
        <p className="mt-2 font-serif text-[12px] italic text-text-tertiary">
          {t("spreadDetail.tagsCaption")}
        </p>
        <div className="mt-4">
          <TagEditor activityId={activity.id} initialTags={initialTags} />
        </div>
      </section>

      <section className="mt-14">
        <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          {t("spreadDetail.sections.screenshots")}
        </h2>
        <p className="mt-2 font-serif text-[12px] italic text-text-tertiary">
          {t("spreadDetail.screenshotsCaption")}
        </p>
        <div className="mt-4">
          <ScreenshotsSection
            activityId={activity.id}
            initialScreenshots={initialScreenshots}
          />
        </div>
      </section>

      <section className="mt-14">
        <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          {t("spreadDetail.sections.actions")}
        </h2>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Link
            href={`/add/spread/fields?edit=${activity.id}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary transition-colors hover:border-border-strong hover:text-text"
          >
            <Pencil className="h-3 w-3" />
            {t("spreadDetail.actions.edit")}
          </Link>
          <DeleteButton
            activityId={activity.id}
            activityType="spread"
            serial={serial}
          />
        </div>
      </section>

      <footer className="mt-20 border-t border-border pt-6 font-mono text-xs text-text-tertiary">
        <div className="flex items-center justify-between">
          <Link
            href="/spreads/archive?activity=spread"
            className="hover:text-text"
          >
            {t("spreadDetail.backLink")}
          </Link>
          <span>
            {t("spreadDetail.footerSerial", { serial: serial.toLowerCase() })}
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

/**
 * Server-side check so we can decide whether to render the chart section at
 * all. Mirrors the API route's logic: if none of the spread's exchanges are
 * in our v1 kline registry, the chart would just render its empty state —
 * skipping it keeps the page tighter and the section header consistent.
 */
function hasSupportedExchange(exchanges: string[]): boolean {
  return exchanges.some(isKlineSupportedExchange);
}

function SidePill({ side, t }: { side: "long" | "short"; t: TFunction }) {
  return (
    <span
      className={cn(
        "font-mono text-[10px] uppercase tracking-[0.16em]",
        side === "long" ? "text-up" : "text-down"
      )}
    >
      {t(`side.${side}`)}
    </span>
  );
}
