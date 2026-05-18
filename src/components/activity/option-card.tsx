import Link from "next/link";
import { cn } from "@/lib/utils";
import type { ActivityStatus } from "@/types/canonical";
import { getT, getLocale } from "@/lib/i18n/server";

export interface OptionCardProps {
  /** Activity supertype id — drives the detail href. */
  id: string;
  /** Display name (usually "BTC vertical" or trader-supplied). */
  name: string;
  /** Activity status — drives the status dot tone. */
  status: ActivityStatus;
  /** Net premium in USD. Positive = trader paid premium (debit); negative
   *  = trader received premium (credit). */
  netPremiumUsd: number | null;
  /** Realized P&L in USD when the position has closed. */
  realizedPnlUsd: number | null;
  /** Underlying ticker (e.g. "BTC"). Shown as the symbol caption. */
  underlying: string;
  /** Subtype kind — drives the secondary line. */
  subtype: "single_leg" | "option_spread";
  /** Spread style label when subtype = option_spread. */
  spreadStyle?: string | null;
  /** Number of legs. */
  legCount: number;
  /** Soonest leg expiry (date). Drives the "DTE" badge. */
  earliestExpiry: string | null;
  /** Optional short serial (e.g. "OP#A1B2"). */
  serial?: string;
  className?: string;
}

const STATUS_DOT: Record<ActivityStatus, string> = {
  open: "bg-up",
  winding_down: "bg-warn",
  unwinding: "bg-warn",
  orphaned: "bg-down",
  closed: "bg-text-tertiary",
  expired: "bg-text-tertiary",
  claimed: "bg-text-tertiary",
  vesting: "bg-text-tertiary",
  pending: "bg-text-tertiary",
  liquidated: "bg-down",
};

function statusKey(s: ActivityStatus): `status.${ActivityStatus}` {
  return `status.${s}` as const;
}

function fmtUsd(n: number, intlLocale: string, signed = true): string {
  const abs = Math.abs(n).toLocaleString(intlLocale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const sign = signed ? (n >= 0 ? "+" : "−") : n < 0 ? "−" : "";
  return `${sign}$${abs}`;
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const target = new Date(iso).getTime();
  if (!Number.isFinite(target)) return null;
  const diff = Math.ceil((target - Date.now()) / 86_400_000);
  return diff;
}

/**
 * Archive list card for option activities. Visually parallel to the spread
 * list card so /spreads/archive renders a coherent grid across types.
 *
 * Hero metric: net premium (signed) when open; realized P&L (signed) once
 * the position has closed. DTE rendered as a small mono badge — negative
 * values render as "expired".
 *
 * Pure server component, no JS. Links to /options/[id].
 */
export async function OptionCard({
  id,
  name,
  status,
  netPremiumUsd,
  realizedPnlUsd,
  underlying,
  subtype,
  spreadStyle,
  legCount,
  earliestExpiry,
  serial,
  className,
}: OptionCardProps) {
  const t = await getT();
  const locale = await getLocale();
  const intlLocale = locale === "ru" ? "ru-RU" : "en-US";
  const isClosed = status === "closed" || status === "expired";
  const heroValue = isClosed
    ? realizedPnlUsd
    : netPremiumUsd ?? realizedPnlUsd;
  const heroLabel = isClosed
    ? t("optionCard.heroPnl")
    : t("optionCard.heroNetPremium");
  const dte = daysUntil(earliestExpiry);

  const heroTone =
    heroValue === null
      ? "text-text"
      : heroValue > 0
      ? "text-up"
      : heroValue < 0
      ? "text-down"
      : "text-text";

  // Subtitle: "Vertical · 4 legs" / "Single leg" — mirrors v_activity_feed.card_subtitle.
  const subtitle =
    subtype === "option_spread" && spreadStyle
      ? `${spreadStyle.replace(/_/g, " ")} · ${t.plural("optionCard.legsCount", legCount)}`
      : t("optionCard.singleLeg");

  return (
    <Link
      href={`/options/${id}`}
      className={cn(
        "group flex items-stretch gap-4 rounded-md border border-border bg-surface p-4 transition-colors",
        "hover:border-border-strong hover:bg-subtle",
        status === "orphaned" && "border-down/30",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2 text-[11px]">
          <span className="inline-flex items-center gap-1.5 text-text-tertiary">
            <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[status])} />
            <span className="font-medium uppercase tracking-[0.12em]">
              {t(statusKey(status))}
            </span>
          </span>
          {serial && (
            <>
              <span className="font-mono text-text-tertiary">·</span>
              <span className="font-mono text-text-tertiary">{serial}</span>
            </>
          )}
          {dte !== null && !isClosed && (
            <>
              <span className="font-mono text-text-tertiary">·</span>
              <span
                className={cn(
                  "font-mono uppercase tracking-[0.12em]",
                  dte < 0 ? "text-text-tertiary" : dte <= 7 ? "text-warn" : "text-text-tertiary",
                )}
              >
                {dte < 0
                  ? t("optionCard.expired")
                  : t("optionCard.dte", { dte })}
              </span>
            </>
          )}
        </div>
        <h3 className="truncate font-serif text-[17px] font-medium leading-tight text-text">
          {name}
        </h3>
        <p className="flex items-center gap-1.5 truncate text-[12px] text-text-tertiary">
          <span className="font-mono text-text-secondary">{underlying}</span>
          <span>·</span>
          <span className="truncate">{subtitle}</span>
        </p>
      </div>

      <div className="flex flex-col items-end justify-between">
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-text-tertiary">
          {t("optionCard.kindBadge")}
        </span>
        <div className="text-right">
          <p
            className={cn(
              "font-serif text-[24px] leading-none tabular-nums",
              heroTone,
            )}
          >
            {heroValue === null ? "—" : fmtUsd(heroValue, intlLocale)}
          </p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
            {heroLabel}
          </p>
        </div>
      </div>
    </Link>
  );
}
