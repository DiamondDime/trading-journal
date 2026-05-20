import Link from "next/link";
import { ArrowUpRight, ArrowRightLeft, Repeat2, ArrowDown, ArrowUp, Send, Image as ImageIcon, Skull, Asterisk } from "lucide-react";
import type { MovementEventKind } from "@/types/canonical";
import { cn } from "@/lib/utils";
import { getT, getLocale } from "@/lib/i18n/server";

export interface EventCardItem {
  /** event_log row id. */
  id: string;
  kind: MovementEventKind;
  /** Headline label used on the card title. */
  title: string;
  /** Short secondary line (e.g. "binance → arbitrum"). */
  subtitle?: string | null;
  /** Asset / token symbol. Optional — losses & "other" may not carry one. */
  asset?: string | null;
  /** Quantity moved. Decimal string. */
  amount?: string | null;
  /** USD value at time of movement. Decimal string. */
  usdValue?: string | null;
  /** Network/withdrawal fee in USD. */
  feeUsd?: string | null;
  /** ISO timestamp — when the movement happened. */
  occurredAt: string;
  /** Link target. When omitted, the card renders as a static, non-navigating element. */
  href?: string;
  /** When set, renders an "AS OF" timestamp under the headline. */
  showAsOf?: boolean;
  className?: string;
}

/** Read the localized title for a movement kind via the wizard dictionary. */
function kindTitleKey(kind: MovementEventKind): "wizard.movement.kinds.bridge.title"
  | "wizard.movement.kinds.convert.title"
  | "wizard.movement.kinds.transfer.title"
  | "wizard.movement.kinds.deposit.title"
  | "wizard.movement.kinds.withdrawal.title"
  | "wizard.movement.kinds.nftTrade.title"
  | "wizard.movement.kinds.loss.title"
  | "wizard.movement.kinds.other.title" {
  switch (kind) {
    case "bridge":     return "wizard.movement.kinds.bridge.title";
    case "convert":    return "wizard.movement.kinds.convert.title";
    case "transfer":   return "wizard.movement.kinds.transfer.title";
    case "deposit":    return "wizard.movement.kinds.deposit.title";
    case "withdrawal": return "wizard.movement.kinds.withdrawal.title";
    case "nft_trade":  return "wizard.movement.kinds.nftTrade.title";
    case "loss":       return "wizard.movement.kinds.loss.title";
    case "other":      return "wizard.movement.kinds.other.title";
  }
}

const KIND_ICON: Record<MovementEventKind, React.ComponentType<{ className?: string }>> = {
  bridge:     ArrowRightLeft,
  convert:    Repeat2,
  transfer:   Send,
  deposit:    ArrowDown,
  withdrawal: ArrowUp,
  nft_trade:  ImageIcon,
  loss:       Skull,
  other:      Asterisk,
};

const KIND_TONE: Record<MovementEventKind, "up" | "down" | "neutral"> = {
  bridge:     "neutral",
  convert:    "neutral",
  transfer:   "neutral",
  deposit:    "up",
  withdrawal: "down",
  nft_trade:  "neutral",
  loss:       "down",
  other:      "neutral",
};

function fmtUsd(
  raw: string | null | undefined,
  locale: string,
  opts: { signed?: boolean } = {},
): string {
  if (raw == null) return "—";
  const n = Number(raw);
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "$0";
  const abs = Math.abs(n).toLocaleString(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  const sign = opts.signed ? (n >= 0 ? "+" : "−") : n < 0 ? "−" : "";
  return `${sign}$${abs}`;
}

function fmtQty(raw: string | null | undefined, locale: string): string {
  if (raw == null) return "—";
  const n = Number(raw);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(locale, { maximumSignificantDigits: 6 });
}

function fmtDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString(locale, {
    month: "short",
    day:   "numeric",
    year:  "numeric",
  });
}

/**
 * Movement-event card. Visually shaped like SpreadListCard so the user
 * can scan a mixed feed (although event_log lives separately, it shares
 * the editorial visual language).
 *
 * Headline = USD value. No P&L formula — these are accounting events, not
 * strategy. The tone hint comes from the *kind* (deposits up, withdrawals
 * down, losses down) rather than a signed number.
 */
export async function EventCard({ item }: { item: EventCardItem }) {
  const t = await getT();
  const locale = await getLocale();
  const intlLocale = locale === "ru" ? "ru-RU" : "en-US";
  const Icon = KIND_ICON[item.kind];
  const tone = KIND_TONE[item.kind];
  const toneClass =
    tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-text";
  const kindLabel = t(kindTitleKey(item.kind)).toLocaleUpperCase(intlLocale);

  const sharedClass = cn(
    "group flex items-stretch gap-4 rounded-md border border-border bg-surface p-4",
    item.className,
  );

  const inner = (
    <>
      <div className="flex flex-1 flex-col gap-2 min-w-0">
        <div className="flex items-center gap-2 text-[11px] text-text-tertiary">
          <span className="inline-flex items-center gap-1.5">
            <Icon className="h-3 w-3" aria-hidden />
            <span className="uppercase tracking-[0.12em] font-medium">
              {kindLabel}
            </span>
          </span>
          <span className="font-mono">·</span>
          <time className="font-mono" dateTime={item.occurredAt}>
            {fmtDate(item.occurredAt, intlLocale)}
          </time>
        </div>
        <h3 className="font-serif text-[17px] font-medium leading-tight text-text">
          {item.title}
        </h3>
        {(item.subtitle || item.asset) && (
          <p className="flex items-center gap-1.5 text-[12px] text-text-tertiary truncate">
            {item.asset && (
              <span className="font-mono text-text-secondary">{item.asset}</span>
            )}
            {item.asset && item.subtitle && <span>·</span>}
            <span className="truncate">{item.subtitle ?? ""}</span>
          </p>
        )}
        <p className="mt-1 font-mono text-[12px] text-text-secondary truncate">
          {fmtQty(item.amount, intlLocale)}
          {item.feeUsd && Number(item.feeUsd) > 0 && (
            <>
              {" · "}
              <span className="text-text-tertiary">
                {t("eventCard.feePrefix")} {fmtUsd(item.feeUsd, intlLocale)}
              </span>
            </>
          )}
        </p>
      </div>

      <div className="flex flex-col items-end justify-between">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-text-tertiary">
            {t("eventCard.tag")}
          </span>
          {item.href !== undefined && (
            <ArrowUpRight className="h-3.5 w-3.5 text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
          )}
        </div>
        <div className="text-right">
          <p className={cn("font-serif text-[26px] leading-none tabular-nums", toneClass)}>
            {fmtUsd(item.usdValue, intlLocale, { signed: tone !== "neutral" })}
          </p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
            {t("eventCard.usdValueCaption")}
          </p>
        </div>
      </div>
    </>
  );

  // When href is absent, render a static article so the card is not a dead link.
  // When href is provided (including the list's default /movement-events/<id>),
  // render as a navigable Link with hover/focus styles.
  if (item.href === undefined) {
    return (
      <article className={sharedClass}>
        {inner}
      </article>
    );
  }

  return (
    <Link
      href={item.href}
      className={cn(sharedClass, "transition-all hover:bg-subtle hover:border-border-strong")}
    >
      {inner}
    </Link>
  );
}
