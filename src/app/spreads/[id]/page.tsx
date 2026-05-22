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
import { SetReminderButton } from "@/components/reminders/set-reminder-button";
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
import {
  ExchangeChip,
  ExchangeVenuesChips,
} from "@/components/settings/exchange-logo";
import {
  getSpreadLegs,
  getSpreadFundingPnl,
  type SpreadLegRow,
  type FundingRollup,
} from "./db";
import { stripSettleSuffix } from "@/lib/format/instrument";

export const dynamic = "force-dynamic";

const SPREAD_TYPE_KEY: Record<string, string> = {
  cash_carry: "spreadDetail.spreadType.cash_carry",
  funding_capture: "spreadDetail.spreadType.funding_capture",
  cross_exchange_perp_arb: "spreadDetail.spreadType.cross_exchange_perp_arb",
  calendar: "spreadDetail.spreadType.calendar",
  dex_cex_arb: "spreadDetail.spreadType.dex_cex_arb",
  custom: "spreadDetail.spreadType.custom",
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
    realLegs,
  ] = await Promise.all([
    getActivity(userId, id),
    getNoteForActivity(userId, id),
    listScreenshotsForActivity(userId, id),
    getExcursionForActivity(userId, id),
    listTagsForActivity(userId, id),
    getSatisfaction(userId, id),
    getAllClosedActivities(userId),
    getSpreadLegs(userId, id),
  ]);
  if (!activity || activity.subtype.type !== "spread") {
    notFound();
  }

  // Funding roll-up depends on the leg set (it needs each leg's position_id),
  // so it runs after getSpreadLegs resolves. Pure manual spreads have no
  // position-linked legs → getSpreadFundingPnl returns null and the page
  // shows nothing rather than a fabricated zero.
  const fundingPositionIds = realLegs
    .map((leg) => leg.positionId)
    .filter((pid): pid is string => pid !== null);
  const funding = await getSpreadFundingPnl(userId, fundingPositionIds);
  const initialScreenshots = toScreenshotItems(screenshots);
  const moreMetrics = computeMoreMetrics(allClosed);
  const avgLossUsd = moreMetrics.avgLoss;

  const s = activity.subtype.row;
  const manualLabel = t("spreadDetail.manualVenue");
  // Real legs come from the spread_legs table (position-linked + manual).
  // deriveLegs() is a FALLBACK only — used when a spread has zero spread_legs
  // rows (legacy data created before the leg-writing wizard). This keeps the
  // decomposition table populated for old spreads with no regression.
  const useRealLegs = realLegs.length > 0;
  const derivedLegs = deriveLegs(
    s.spreadType,
    s.exchanges,
    s.primaryBase,
    manualLabel,
  );
  const apr = fmtAprPct(s.apr);
  const headlineTone = apr.tone === "up" ? "text-up" : "text-down";
  // Spread type label — resolved through the dict so the detail page reads
  // in the user's locale. Falls back to the raw enum if a new type lands
  // before the dict catches up.
  const typeKey = SPREAD_TYPE_KEY[s.spreadType];
  const typeLabel = typeKey
    ? t(typeKey as Parameters<typeof t>[0])
    : s.spreadType;
  const netPnl = Number(activity.netPnlUsd ?? 0);
  const capital = Number(activity.capitalDeployedUsd ?? 0);
  const daysLabel = fmtDaysLabel(activity.openedAt, activity.closedAt, t);
  // toLocaleDateString — number/date formatting flagged. en-US fallback kept
  // for now; switching to intlLocale once the number/currency formatters in
  // archive-data are unified.
  const closedLabel = activity.closedAt
    ? new Date(activity.closedAt).toLocaleDateString(intlLocale, { month: "short", day: "numeric", year: "numeric" })
    : "—";
  // Status uses the top-level status.* dict which has all 9 ActivityStatus
  // values. Previously narrowed to open|closed|pending and collapsed all
  // other valid spread statuses (winding_down, orphaned, expired, liquidated)
  // to "closed", masking the real state in the badge.
  const statusLabel = t(`status.${activity.status}`);
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
        <p className="mt-3 flex flex-wrap items-center gap-2 text-base text-text-secondary">
          <span>{typeLabel} · {s.variant ?? "—"} · {venuesLabel}</span>
          {s.exchanges.length > 0 && (
            <ExchangeVenuesChips venues={s.exchanges.join(" + ")} size="sm" />
          )}
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
              {fmtUsd(netPnl, true, 2, intlLocale)}
            </span>{" "}
            {t("spreadDetail.hero.realizedSuffix", { capital: fmtCapital(capital, intlLocale) })}
          </p>
          {/* Funding P&L — aggregated from funding_events across the spread's
              position-linked legs. Rendered only when the spread has at least
              one position-linked leg (funding === null for pure manual
              spreads); we never fabricate a zero. */}
          {funding !== null && <FundingLine funding={funding} t={t} intlLocale={intlLocale} />}
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
          {useRealLegs
            ? t("spreadDetail.decompositionRealCaption")
            : t("spreadDetail.decompositionCaption")}
        </p>
        <div className="mt-4 overflow-x-auto rounded-md border border-border bg-surface">
          {useRealLegs ? (
            <RealLegsTable legs={realLegs} manualLabel={manualLabel} t={t} intlLocale={intlLocale} />
          ) : (
            <DerivedLegsTable legs={derivedLegs} t={t} />
          )}
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
          <SetReminderButton
            activityId={activity.id}
            activityName={activity.name}
          />
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

// ── real-legs rendering ──────────────────────────────────────────────────────

const EM_DASH = "—";

/**
 * Format a string-decimal money value for the legs table. Falls back to an
 * em-dash for null/blank/non-numeric input so an open leg's missing exit
 * price (or a manual leg with no fees entered) reads cleanly.
 */
function fmtLegUsd(value: string | null, locale = "en-US"): string {
  if (value === null || value.trim() === "") return EM_DASH;
  const n = Number(value);
  return Number.isFinite(n) ? fmtUsd(n, false, 2, locale) : EM_DASH;
}

/**
 * Format a string-decimal quantity for the legs table. Quantities are not
 * USD so they render as plain grouped numbers; trailing zeros from the
 * numeric(38,18) column are trimmed. Em-dash for null/blank/non-numeric.
 */
function fmtLegQty(value: string | null, locale = "en-US"): string {
  if (value === null || value.trim() === "") return EM_DASH;
  const n = Number(value);
  if (!Number.isFinite(n)) return EM_DASH;
  return n.toLocaleString(locale, { maximumFractionDigits: 8 });
}

/** Side pill that tolerates a null side (manual legs may omit it). */
function LegSidePill({
  side,
  t,
}: {
  side: "long" | "short" | null;
  t: TFunction;
}) {
  if (side === null) {
    return <span className="text-text-tertiary">{EM_DASH}</span>;
  }
  return <SidePill side={side} t={t} />;
}

/**
 * One attribute row in a transposed legs table. The header column holds the
 * attribute label; each remaining cell is one leg's value for that attribute.
 */
function AttrRow({
  label,
  cells,
  mono = false,
}: {
  label: string;
  cells: React.ReactNode[];
  mono?: boolean;
}) {
  return (
    <TableRow>
      <TableCell className="text-text-tertiary text-sm">{label}</TableCell>
      {cells.map((cell, i) => (
        <TableCell
          key={`${label}-${i}`}
          className={
            mono ? "font-mono tabular-nums text-text" : "text-text"
          }
        >
          {cell}
        </TableCell>
      ))}
    </TableRow>
  );
}

/**
 * Decomposition table built from the REAL spread_legs rows. Transposed —
 * one column per leg, one row per attribute — so it stays readable as the
 * leg count grows. Position-linked and manual legs render identically because
 * the data layer already normalized them.
 */
function RealLegsTable({
  legs,
  manualLabel,
  t,
  intlLocale,
}: {
  legs: SpreadLegRow[];
  manualLabel: string;
  t: TFunction;
  intlLocale: string;
}) {
  const legHeader = (leg: SpreadLegRow, i: number): string =>
    leg.role && leg.role.trim() !== ""
      ? leg.role
      : t("spreadDetail.legs.legN", { i: i + 1 });

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead scope="col" className="text-text-tertiary">
            &nbsp;
          </TableHead>
          {legs.map((leg, i) => (
            <TableHead
              key={leg.id}
              scope="col"
              className="text-text-secondary capitalize"
            >
              {legHeader(leg, i)}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        <AttrRow
          label={t("fields.venue")}
          cells={legs.map((leg) => {
            const venue = leg.venue ?? manualLabel;
            return (
              <span key={leg.id} className="inline-flex items-center gap-2">
                <ExchangeChip venue={venue} size="sm" />
                <span>{venue}</span>
              </span>
            );
          })}
        />
        <AttrRow
          label={t("spreadDetail.legs.symbol")}
          mono
          cells={legs.map((leg) => leg.symbol ? stripSettleSuffix(leg.symbol) : EM_DASH)}
        />
        <AttrRow
          label={t("spreadDetail.legs.instrument")}
          cells={legs.map((leg) =>
            leg.instrumentType
              ? t(`instrumentKind.${leg.instrumentType}` as Parameters<typeof t>[0]) || leg.instrumentType
              : EM_DASH
          )}
        />
        <AttrRow
          label={t("fields.side")}
          cells={legs.map((leg) => (
            <LegSidePill key={leg.id} side={leg.side} t={t} />
          ))}
        />
        <AttrRow
          label={t("spreadDetail.legs.qty")}
          mono
          cells={legs.map((leg) => fmtLegQty(leg.qty, intlLocale))}
        />
        <AttrRow
          label={t("spreadDetail.legs.entryPrice")}
          mono
          cells={legs.map((leg) => fmtLegUsd(leg.entryPrice, intlLocale))}
        />
        <AttrRow
          label={t("spreadDetail.legs.exitPrice")}
          mono
          cells={legs.map((leg) => fmtLegUsd(leg.exitPrice, intlLocale))}
        />
        <AttrRow
          label={t("spreadDetail.legs.fees")}
          mono
          cells={legs.map((leg) => fmtLegUsd(leg.feesUsd, intlLocale))}
        />
      </TableBody>
    </Table>
  );
}

/**
 * Fallback decomposition table — renders the synthetic two-leg display from
 * deriveLegs(). Only reached for legacy spreads that have zero spread_legs
 * rows. New spreads always hit RealLegsTable.
 */
function DerivedLegsTable({
  legs,
  t,
}: {
  legs: DerivedLegs;
  t: TFunction;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead scope="col" className="text-text-tertiary">
            &nbsp;
          </TableHead>
          <TableHead scope="col" className="text-text-secondary">
            {t("spreadDetail.legs.leg1")}
          </TableHead>
          <TableHead scope="col" className="text-text-secondary">
            {t("spreadDetail.legs.leg2")}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <LegRow
          label={t("fields.venue")}
          leg1={
            <span className="inline-flex items-center gap-2">
              <ExchangeChip venue={legs.leg1.venue} size="sm" />
              <span>{legs.leg1.venue}</span>
            </span>
          }
          leg2={
            <span className="inline-flex items-center gap-2">
              <ExchangeChip venue={legs.leg2.venue} size="sm" />
              <span>{legs.leg2.venue}</span>
            </span>
          }
        />
        <LegRow
          label={t("spreadDetail.legs.symbol")}
          leg1={legs.leg1.symbol}
          leg2={legs.leg2.symbol}
          mono
        />
        <LegRow
          label={t("spreadDetail.legs.instrument")}
          leg1={legs.leg1.instrument}
          leg2={legs.leg2.instrument}
        />
        <LegRow
          label={t("fields.side")}
          leg1={<SidePill side={legs.leg1.side} t={t} />}
          leg2={<SidePill side={legs.leg2.side} t={t} />}
        />
      </TableBody>
    </Table>
  );
}

/**
 * Funding P&L line shown under the hero net figure. Surfaces the net signed
 * funding (green when received, red when paid) plus a received/paid split
 * caption. Rendered by the page only when funding data exists — this
 * component never has to handle the "no funding" case.
 */
function FundingLine({
  funding,
  t,
  intlLocale,
}: {
  funding: FundingRollup;
  t: TFunction;
  intlLocale: string;
}) {
  const net = Number(funding.netUsd);
  const safeNet = Number.isFinite(net) ? net : 0;
  const tone = safeNet >= 0 ? "text-up" : "text-down";
  const received = Number(funding.receivedUsd);
  const paid = Number(funding.paidUsd);
  return (
    <p className="mt-1 font-mono text-sm text-text-secondary">
      {t("spreadDetail.funding.label")}{" "}
      <span className={`${tone} font-medium`}>
        {fmtUsd(safeNet, true, 2, intlLocale)}
      </span>
      {funding.eventCount > 0 && (
        <span className="text-text-tertiary">
          {"  ·  "}
          {t("spreadDetail.funding.received")}{" "}
          {fmtUsd(Number.isFinite(received) ? received : 0, false, 2, intlLocale)}
          {"  ·  "}
          {t("spreadDetail.funding.paid")}{" "}
          {fmtUsd(Number.isFinite(paid) ? paid : 0, false, 2, intlLocale)}
        </span>
      )}
    </p>
  );
}
