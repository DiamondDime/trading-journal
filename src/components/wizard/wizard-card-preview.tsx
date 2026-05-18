import type { ActivityType, ActivityStatus } from "@/types/canonical";
import { cn } from "@/lib/utils";
import { getT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/resolve";

/**
 * Preview subtype payload — only the fields the headline + subtitle need.
 * Each property is optional so the wizard can render a card mid-form
 * (before every field is filled). Missing inputs collapse to the placeholder
 * dash and a neutral tone, matching the rest of the journal's rendering
 * rules.
 */
export interface WizardCardPreviewSubtype {
  /** Capital deployed in USD. */
  capital?: number | null;
  /** Net P&L in USD. */
  netPnl?: number | null;
  /** Days held — used to annualise APR-style headlines. */
  daysHeld?: number | null;
  /** Sub-line under the title (e.g. "Cash-and-carry · Binance + OKX"). */
  subtitle?: string | null;
  /** Asset / underlying ticker shown alongside the subtitle. */
  symbol?: string | null;
  /** Spread sub-type for the spread headline formula. */
  spreadType?:
    | "cross_exchange_perp_arb"
    | "cash_carry"
    | "calendar"
    | "funding_capture"
    | "dex_cex_arb"
    | "custom"
    | null;
  /** Trade kind — spot/perp/dated_future/option/otc/nft. */
  tradeKind?: "spot" | "perp" | "dated_future" | "option" | "otc" | "nft" | null;
  /** Sale token MTM context (multiplier for sale headline). */
  saleMultiplier?: number | null;
  /** Airdrop token MTM context. */
  airdropMultiplier?: number | null;
  /** Yield position context — realized APY % when closed, expected when open. */
  yieldApyPct?: number | null;
  /** Option realized P&L vs max profit (UI may format as $ / multiple). */
  optionRealizedPnl?: number | null;
  optionMaxProfit?: number | null;
}

export interface WizardCardPreviewProps {
  activityType: ActivityType;
  subtype: WizardCardPreviewSubtype;
  /** Headline copy — usually the user's "name" input. */
  name: string;
  /** Status badge text. Drives the dot tone too. */
  status: ActivityStatus;
  /** Optional short serial-like prefix shown next to the status badge. */
  serial?: string;
  className?: string;
}

const STATUS_DOT: Record<ActivityStatus, string> = {
  open:         "bg-up",
  winding_down: "bg-warn",
  unwinding:    "bg-warn",
  orphaned:     "bg-down",
  closed:       "bg-text-tertiary",
  expired:      "bg-text-tertiary",
  claimed:      "bg-text-tertiary",
  vesting:      "bg-text-tertiary",
  pending:      "bg-text-tertiary",
  liquidated:   "bg-down",
};

const STATUS_KEY: Record<ActivityStatus, MessageKey> = {
  open:         "status.open",
  winding_down: "status.winding_down",
  unwinding:    "status.unwinding",
  orphaned:     "status.orphaned",
  closed:       "status.closed",
  expired:      "status.expired",
  claimed:      "status.claimed",
  vesting:      "status.vesting",
  pending:      "status.pending",
  liquidated:   "status.liquidated",
};

const TYPE_BADGE_KEY: Record<ActivityType, MessageKey> = {
  spread:         "wizard.cardPreview.typeBadge.spread",
  trade:          "wizard.cardPreview.typeBadge.trade",
  sale:           "wizard.cardPreview.typeBadge.sale",
  airdrop:        "wizard.cardPreview.typeBadge.airdrop",
  yield_position: "wizard.cardPreview.typeBadge.yieldPosition",
  option:         "wizard.cardPreview.typeBadge.option",
};

/**
 * Compute the (label, unit, tone) tuple the card displays. Mirrors the
 * polymorphic formula in v_activity_feed exactly — when this returns
 * "+18.3%", the persisted card on /spreads/archive will render the same.
 */
function computeHeadline(
  type: ActivityType,
  s: WizardCardPreviewSubtype,
): { label: string; unit: string; tone: "up" | "down" | "neutral" } {
  const capital = s.capital ?? 0;
  const days = s.daysHeld ?? 0;
  const net = s.netPnl ?? 0;
  const fmtPct = (n: number) =>
    `${n >= 0 ? "+" : "−"}${Math.abs(n * 100).toFixed(1)}%`;
  const fmtUsd = (n: number) =>
    `${n >= 0 ? "+" : "−"}$${Math.abs(n).toLocaleString(undefined, {
      maximumFractionDigits: 0,
    })}`;
  const fmtMult = (n: number) =>
    `${n >= 10 ? n.toFixed(1) : n.toFixed(2)}×`;
  const tone = (n: number, neutralBoundary = 0): "up" | "down" | "neutral" =>
    n > neutralBoundary ? "up" : n < neutralBoundary ? "down" : "neutral";

  switch (type) {
    case "spread": {
      if (capital === 0 || days === 0)
        return { label: "—", unit: "APR", tone: "neutral" };
      // Same as the spread_pnl per-type formula. Most spread types reduce to
      // APR / bps / bps-per-day — we use APR here since it's the
      // common-case framing for the preview card; the archive list uses
      // per-type formatting that the wizard doesn't need to replicate.
      const apr = (net / capital) * (365 / days);
      return { label: fmtPct(apr), unit: "APR", tone: tone(apr) };
    }
    case "trade": {
      if (capital === 0 || days === 0)
        return { label: "—", unit: "APR", tone: "neutral" };
      const apr = (net / capital) * (365 / days);
      return { label: fmtPct(apr), unit: "APR", tone: tone(apr) };
    }
    case "sale": {
      const m = s.saleMultiplier ?? 0;
      if (m === 0) return { label: "—", unit: "MTM", tone: "neutral" };
      return { label: fmtMult(m), unit: "MTM", tone: tone(m, 1) };
    }
    case "airdrop": {
      const m = s.airdropMultiplier ?? 0;
      if (m === 0) return { label: "—", unit: "MTM", tone: "neutral" };
      return { label: fmtMult(m), unit: "MTM", tone: tone(m, 1) };
    }
    case "yield_position": {
      const apy = s.yieldApyPct ?? 0;
      if (apy === 0) return { label: "—", unit: "APY", tone: "neutral" };
      return {
        label: `${apy >= 0 ? "+" : "−"}${Math.abs(apy).toFixed(1)}%`,
        unit: "APY",
        tone: tone(apy),
      };
    }
    case "option": {
      const pnl = s.optionRealizedPnl ?? 0;
      const max = s.optionMaxProfit ?? 0;
      if (max > 0) {
        return {
          label: `${fmtUsd(pnl)} / ${fmtUsd(max)}`,
          unit: "P&L · MAX",
          tone: tone(pnl),
        };
      }
      if (pnl === 0) return { label: "—", unit: "P&L", tone: "neutral" };
      return { label: fmtUsd(pnl), unit: "P&L", tone: tone(pnl) };
    }
  }
}

/**
 * Card-shaped preview the wizard renders on /review. Visually identical
 * to SpreadListCard so the user sees exactly what /spreads/archive will
 * show after submit. Server component.
 */
export async function WizardCardPreview({
  activityType,
  subtype,
  name,
  status,
  serial,
  className,
}: WizardCardPreviewProps) {
  const t = await getT();
  const { label, unit, tone } = computeHeadline(activityType, subtype);
  const toneClass =
    tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-text";
  const isOrphaned = status === "orphaned";

  return (
    <div
      className={cn(
        "flex items-stretch gap-4 rounded-md border bg-surface p-4",
        isOrphaned ? "border-down/30" : "border-border",
        className,
      )}
    >
      <div className="flex flex-1 flex-col gap-2 min-w-0">
        <div className="flex items-center gap-2 text-[11px]">
          <span className="inline-flex items-center gap-1.5 text-text-tertiary">
            <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[status])} />
            <span className="uppercase tracking-[0.12em] font-medium">
              {t(STATUS_KEY[status])}
            </span>
          </span>
          {serial && (
            <>
              <span className="font-mono text-text-tertiary">·</span>
              <span className="font-mono text-text-tertiary">{serial}</span>
            </>
          )}
        </div>
        <h3 className="font-serif text-[17px] font-medium leading-tight text-text">
          {name || t("wizard.cardPreview.untitledActivity")}
        </h3>
        {(subtype.subtitle || subtype.symbol) && (
          <p className="flex items-center gap-1.5 text-[12px] text-text-tertiary truncate">
            {subtype.symbol && (
              <span className="font-mono text-text-secondary">
                {subtype.symbol}
              </span>
            )}
            {subtype.symbol && subtype.subtitle && <span>·</span>}
            <span className="truncate">{subtype.subtitle ?? ""}</span>
          </p>
        )}
      </div>

      <div className="flex flex-col items-end justify-between">
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-text-tertiary">
          {t(TYPE_BADGE_KEY[activityType])}
        </span>
        <div className="text-right">
          <p
            className={cn(
              "font-serif text-[26px] leading-none tabular-nums",
              toneClass,
            )}
          >
            {label}
          </p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
            {unit}
          </p>
        </div>
      </div>
    </div>
  );
}
