import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

type Status = "open" | "winding_down" | "orphaned" | "closed" | "expired" | "claimed" | "vested";

export type ActivityType = "spread" | "trade" | "sale" | "airdrop";

export type SpreadListItem = {
  serial: string;
  name: string;
  typeLabel: string;
  status: Status;
  headline: string;
  headlineUnit: string;
  tone: "up" | "down" | "neutral";
  summary: string;
  href: string;
  activityType?: ActivityType;   // when set, renders a tiny mono badge on the card
};

const STATUS_STYLES: Record<Status, { dot: string; label: string }> = {
  open:         { dot: "bg-up",         label: "Open" },
  winding_down: { dot: "bg-warn",       label: "Winding down" },
  orphaned:     { dot: "bg-down",       label: "Orphaned" },
  closed:       { dot: "bg-text-tertiary", label: "Closed" },
  expired:      { dot: "bg-text-tertiary", label: "Expired" },
  claimed:      { dot: "bg-text-tertiary", label: "Claimed" },
  vested:       { dot: "bg-text-tertiary", label: "Vested" },
};

const ACTIVITY_BADGE_LABEL: Record<ActivityType, string> = {
  spread: "SPREAD",
  trade: "TRADE",
  sale: "SALE",
  airdrop: "AIRDROP",
};

export function SpreadListCard({ item }: { item: SpreadListItem }) {
  const status = STATUS_STYLES[item.status];
  const isOrphaned = item.status === "orphaned";
  const toneClass =
    item.tone === "up"
      ? "text-up"
      : item.tone === "down"
      ? "text-down"
      : "text-text";

  return (
    <Link
      href={item.href}
      className={
        "group flex items-stretch gap-4 rounded-md border bg-surface p-4 transition-all hover:bg-subtle hover:border-border-strong " +
        (isOrphaned ? "border-down/30" : "border-border")
      }
    >
      <div className="flex flex-1 flex-col gap-2 min-w-0">
        <div className="flex items-center gap-2 text-[11px]">
          <span className="inline-flex items-center gap-1.5 text-text-tertiary">
            <span className={"h-1.5 w-1.5 rounded-full " + status.dot} />
            <span className="uppercase tracking-[0.12em] font-medium">{status.label}</span>
          </span>
          <span className="font-mono text-text-tertiary">·</span>
          <span className="font-mono text-text-tertiary">{item.serial}</span>
        </div>
        <h3 className="font-serif text-[17px] font-medium leading-tight text-text">
          {item.name}
        </h3>
        <p className="text-[12px] text-text-tertiary">{item.typeLabel}</p>
        <p className="mt-1 font-mono text-[12px] text-text-secondary truncate">
          {item.summary}
        </p>
      </div>

      <div className="flex flex-col items-end justify-between">
        <div className="flex items-center gap-1.5">
          {item.activityType && (
            <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-text-tertiary">
              {ACTIVITY_BADGE_LABEL[item.activityType]}
            </span>
          )}
          <ArrowUpRight className="h-3.5 w-3.5 text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
        <div className="text-right">
          <p className={"font-serif text-[26px] leading-none tabular-nums " + toneClass}>
            {item.headline}
          </p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
            {item.headlineUnit}
          </p>
        </div>
      </div>
    </Link>
  );
}
