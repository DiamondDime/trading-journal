import Link from "next/link";
import { ArrowUpRight, BellOff } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { getT, getLocale } from "@/lib/i18n/server";
import {
  listWatchlistItems,
  type WatchlistCategory,
  type WatchlistRow,
} from "@/lib/db/watchlist";
import { fmtUsd } from "@/lib/data/archive-data";
import { cn } from "@/lib/utils";

/**
 * Watchlist — "what should I be paying attention to?".
 *
 * Surfaces every non-terminal activity that's waiting on an external event:
 *
 *   1. Airdrops pending (claim window open / awaiting protocol announcement)
 *   2. Sales vesting (pre-TGE or partially-vested)
 *   3. Options open (sorted by nearest expiry)
 *   4. Spreads winding down (one leg closed, awaiting basis convergence)
 *
 * Each category is its own sub-section so the visual hierarchy maps onto
 * the trader's mental model — "things to claim", "things to babysit",
 * "things to close". Within a section rows are sorted by urgency
 * (smallest days-until-deadline first; null deadlines last).
 *
 * Force-dynamic — the page must reflect new activities the instant a wizard
 * submit lands. No caching tradeoffs to make here.
 */
export const dynamic = "force-dynamic";

const CATEGORY_ORDER: WatchlistCategory[] = [
  "airdrop_pending",
  "sale_pre_tge",
  "option_expiring",
  "spread_winding_down",
  "yield_pending",
];

interface SectionDescriptor {
  category: WatchlistCategory;
  title: string;
  caption: string;
  deadlineLabel: string;
}

export default async function WatchlistPage() {
  const { id: userId } = await requireUser();
  const t = await getT();
  const locale = await getLocale();
  const intlLocale = locale === "ru" ? "ru-RU" : "en-US";

  const rows = await listWatchlistItems(userId);

  // Bucket by category in a single pass so the four sub-sections render
  // independently. CATEGORY_ORDER drives the visual order; categories with
  // zero rows still render as empty sub-sections so the trader can confirm
  // "yes I checked, there are no pending airdrops" at a glance.
  const sections: Map<WatchlistCategory, WatchlistRow[]> = new Map();
  for (const cat of CATEGORY_ORDER) sections.set(cat, []);
  for (const r of rows) sections.get(r.category)?.push(r);

  const descriptors: SectionDescriptor[] = [
    {
      category: "airdrop_pending",
      title: t("watchlist.sections.airdropsPending.title"),
      caption: t("watchlist.sections.airdropsPending.caption"),
      deadlineLabel: t("watchlist.deadlineLabels.claimWindow"),
    },
    {
      category: "sale_pre_tge",
      title: t("watchlist.sections.salesVesting.title"),
      caption: t("watchlist.sections.salesVesting.caption"),
      deadlineLabel: t("watchlist.deadlineLabels.nextUnlock"),
    },
    {
      category: "option_expiring",
      title: t("watchlist.sections.optionsExpiring.title"),
      caption: t("watchlist.sections.optionsExpiring.caption"),
      deadlineLabel: t("watchlist.deadlineLabels.expiry"),
    },
    {
      category: "spread_winding_down",
      title: t("watchlist.sections.spreadsWinding.title"),
      caption: t("watchlist.sections.spreadsWinding.caption"),
      deadlineLabel: t("watchlist.deadlineLabels.convergence"),
    },
    {
      category: "yield_pending",
      title: t("watchlist.sections.yieldsPending.title"),
      caption: t("watchlist.sections.yieldsPending.caption"),
      deadlineLabel: t("watchlist.deadlineLabels.entry"),
    },
  ];

  const totalRows = rows.length;

  return (
    <div className="w-full">
      <header className="flex flex-col gap-4 border-b border-border px-8 py-7 md:flex-row md:items-end md:justify-between lg:px-12">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-tertiary">
            {t("watchlist.eyebrow")}
          </p>
          <h1 className="mt-2 font-serif text-[40px] font-medium leading-none tracking-tight text-text">
            {t("watchlist.title")}
          </h1>
          <p className="mt-2 font-serif text-sm italic text-text-tertiary">
            {totalRows === 0
              ? t("watchlist.subtitleEmpty")
              : t.plural("watchlist.subtitleCount", totalRows, { count: totalRows })}
          </p>
        </div>
      </header>

      <div className="flex flex-col gap-8 px-8 py-8 lg:px-12">
        {descriptors.map((d) => {
          const items = sections.get(d.category) ?? [];
          return (
            <WatchlistSection
              key={d.category}
              descriptor={d}
              items={items}
              intlLocale={intlLocale}
              emptyCopy={t(`watchlist.empty.${categoryEmptyKey(d.category)}` as const)}
              statusLabels={{
                pending: t("status.pending"),
                vesting: t("status.vesting"),
                open: t("status.open"),
                winding_down: t("status.winding_down"),
              }}
              countdownT={{
                today: t("watchlist.countdown.today"),
                tomorrow: t("watchlist.countdown.tomorrow"),
                overdue: t("watchlist.countdown.overdue"),
                openEnded: t("watchlist.countdown.openEnded"),
              }}
              remindLabel={t("watchlist.remind.label")}
              remindTooltip={t("watchlist.remind.tooltip")}
            />
          );
        })}

        {totalRows === 0 && <PageEmptyState />}
      </div>
    </div>
  );
}

function categoryEmptyKey(
  category: WatchlistCategory,
):
  | "airdropsPending"
  | "salesVesting"
  | "optionsExpiring"
  | "spreadsWinding"
  | "yieldsPending" {
  switch (category) {
    case "airdrop_pending":
      return "airdropsPending";
    case "sale_pre_tge":
      return "salesVesting";
    case "option_expiring":
      return "optionsExpiring";
    case "spread_winding_down":
      return "spreadsWinding";
    case "yield_pending":
      return "yieldsPending";
  }
}

// ── Section ────────────────────────────────────────────────────────────────

interface SectionProps {
  descriptor: SectionDescriptor;
  items: WatchlistRow[];
  intlLocale: string;
  emptyCopy: string;
  statusLabels: Record<"pending" | "vesting" | "open" | "winding_down", string>;
  countdownT: {
    today: string;
    tomorrow: string;
    overdue: string;
    openEnded: string;
  };
  remindLabel: string;
  remindTooltip: string;
}

function WatchlistSection({
  descriptor,
  items,
  intlLocale,
  emptyCopy,
  statusLabels,
  countdownT,
  remindLabel,
  remindTooltip,
}: SectionProps) {
  return (
    <section
      className="rounded-md border border-border bg-surface"
      aria-labelledby={`watchlist-${descriptor.category}-title`}
    >
      <header className="flex flex-col gap-1 border-b border-border px-6 py-4 md:flex-row md:items-baseline md:justify-between">
        <div>
          <h2
            id={`watchlist-${descriptor.category}-title`}
            className="font-serif text-[13px] font-semibold uppercase tracking-[0.16em] text-text"
          >
            {descriptor.title}
          </h2>
          <p className="mt-1 font-serif text-[12px] italic leading-snug text-text-tertiary">
            {descriptor.caption}
          </p>
        </div>
        <span className="font-mono text-[11px] tabular-nums text-text-tertiary">
          {items.length}
        </span>
      </header>

      {items.length === 0 ? (
        <div className="px-6 py-10 text-center">
          <p className="font-serif text-[14px] italic text-text-tertiary">
            {emptyCopy}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((row) => (
            <WatchlistRowItem
              key={row.id}
              row={row}
              deadlineLabel={descriptor.deadlineLabel}
              intlLocale={intlLocale}
              statusLabels={statusLabels}
              countdownT={countdownT}
              remindLabel={remindLabel}
              remindTooltip={remindTooltip}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Row ────────────────────────────────────────────────────────────────────

interface RowItemProps {
  row: WatchlistRow;
  deadlineLabel: string;
  intlLocale: string;
  statusLabels: SectionProps["statusLabels"];
  countdownT: SectionProps["countdownT"];
  remindLabel: string;
  remindTooltip: string;
}

function WatchlistRowItem({
  row,
  deadlineLabel,
  intlLocale,
  statusLabels,
  countdownT,
  remindLabel,
  remindTooltip,
}: RowItemProps) {
  const status = row.status as keyof typeof statusLabels;
  const statusLabel = statusLabels[status] ?? row.status;
  const statusDot = STATUS_DOT[row.status] ?? "bg-text-tertiary";

  const tone =
    row.netPnlUsd == null
      ? "neutral"
      : Number(row.netPnlUsd) > 0
      ? "up"
      : Number(row.netPnlUsd) < 0
      ? "down"
      : "neutral";
  const toneClass =
    tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-text";

  const countdown = formatCountdown(row.daysUntilDeadline, countdownT);
  const countdownTone =
    row.daysUntilDeadline == null
      ? "text-text-tertiary"
      : row.daysUntilDeadline < 0
      ? "text-down"
      : row.daysUntilDeadline <= 3
      ? "text-warn"
      : "text-text-secondary";

  const deadlineDisplay = row.deadline
    ? new Date(`${row.deadline}T00:00:00`).toLocaleDateString(intlLocale, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";

  return (
    <li>
      <div className="group flex items-stretch gap-4 px-6 py-4 transition-colors hover:bg-subtle">
        <Link
          href={row.href}
          className="flex flex-1 items-stretch gap-4 min-w-0"
        >
          <div className="flex flex-1 flex-col gap-1.5 min-w-0">
            <div className="flex items-center gap-2 text-[11px]">
              <span className="inline-flex items-center gap-1.5 text-text-tertiary">
                <span className={cn("h-1.5 w-1.5 rounded-full", statusDot)} />
                <span className="font-medium uppercase tracking-[0.12em]">
                  {statusLabel}
                </span>
              </span>
              {row.primarySymbol && (
                <>
                  <span className="font-mono text-text-tertiary">·</span>
                  <span className="font-mono text-text-secondary tabular-nums">
                    {row.primarySymbol}
                  </span>
                </>
              )}
              {row.strategyTag && (
                <>
                  <span className="font-mono text-text-tertiary">·</span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
                    {row.strategyTag}
                  </span>
                </>
              )}
            </div>
            <h3 className="font-serif text-[17px] font-medium leading-tight text-text truncate">
              {row.name}
            </h3>
            {row.cardSubtitle && (
              <p className="font-mono text-[11px] uppercase tracking-[0.10em] text-text-tertiary truncate">
                {row.cardSubtitle}
              </p>
            )}
          </div>

          <div className="flex flex-col items-end justify-between gap-1 shrink-0">
            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-text-tertiary">
              {deadlineLabel}
            </p>
            <p className="font-mono text-[12px] tabular-nums text-text">
              {deadlineDisplay}
            </p>
            <p
              className={cn(
                "font-mono text-[11px] uppercase tracking-[0.12em] tabular-nums",
                countdownTone,
              )}
            >
              {countdown}
            </p>
          </div>

          <div className="flex flex-col items-end justify-between gap-1 shrink-0 w-[112px]">
            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-text-tertiary">
              {row.netPnlUsd != null ? "P&L" : ""}
            </p>
            <p
              className={cn(
                "font-serif text-[22px] leading-none tabular-nums",
                toneClass,
              )}
            >
              {row.netPnlUsd != null ? fmtUsd(Number(row.netPnlUsd), true) : "—"}
            </p>
            <ArrowUpRight className="h-3.5 w-3.5 text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
        </Link>

        {/* "Set reminder" affordance — UI stub, disabled until the v3 reminder
            system lands. Lives outside the parent <Link> so the disabled
            button does not look like a navigable target. */}
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            disabled
            title={remindTooltip}
            aria-label={remindTooltip}
            className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-app px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary opacity-60 cursor-not-allowed"
          >
            <BellOff className="h-3 w-3" />
            <span>{remindLabel}</span>
          </button>
        </div>
      </div>
    </li>
  );
}

// ── Status dot mapping ─────────────────────────────────────────────────────

// Matches the conventions in spread-list-card.tsx: pending/winding_down stay
// warm (warn), open is green, vesting tertiary. Kept local rather than
// imported so a future tweak to the spread card doesn't quietly shift the
// watchlist's status palette.
const STATUS_DOT: Record<string, string> = {
  pending: "bg-warn",
  vesting: "bg-info",
  open: "bg-up",
  winding_down: "bg-warn",
  orphaned: "bg-down",
  closed: "bg-text-tertiary",
  expired: "bg-text-tertiary",
  claimed: "bg-text-tertiary",
};

// ── Countdown formatter ────────────────────────────────────────────────────

function formatCountdown(
  days: number | null,
  t: SectionProps["countdownT"],
): string {
  if (days == null) return t.openEnded;
  if (days < 0) return `${t.overdue} · ${Math.abs(days)}d`;
  if (days === 0) return t.today;
  if (days === 1) return t.tomorrow;
  return `${days}d`;
}

// ── Page-level empty state ─────────────────────────────────────────────────

async function PageEmptyState() {
  const t = await getT();
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-md border border-dashed border-border bg-surface px-8 py-16 text-center">
      <p className="font-serif text-[18px] italic leading-snug text-text">
        {t("watchlist.empty.headline")}
      </p>
      <p className="max-w-xl font-serif text-[14px] italic leading-snug text-text-tertiary">
        {t("watchlist.empty.body")}
      </p>
      <Link
        href="/add"
        className="font-mono text-[11px] uppercase tracking-[0.16em] text-text underline-offset-4 hover:underline"
      >
        {t("watchlist.empty.cta")}
      </Link>
    </div>
  );
}
