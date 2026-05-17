import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtUsd } from "@/lib/data/archive-data";
import type { RegimeAggRow } from "@/lib/db/activity";

/**
 * Best / worst regime callout card. Two of these are rendered on the regime
 * page — one tinted up, one down. They DON'T use signature amber (the page's
 * single amber moment is the headline above).
 */

interface Props {
  title: string;
  regime: RegimeAggRow | null;
  tone: "up" | "down";
}

export function RegimeCallout({ title, regime, tone }: Props) {
  const toneClass = tone === "up" ? "text-up" : "text-down";
  const Icon = tone === "up" ? TrendingUp : TrendingDown;

  if (!regime) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-dashed border-border bg-inset p-5">
        <p className="font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          {title}
        </p>
        <p className="font-serif text-sm italic text-text-tertiary">
          Not enough data yet.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-5">
      <div className="flex items-baseline justify-between">
        <p className="font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          {title}
        </p>
        <Icon className={cn("h-3.5 w-3.5", toneClass)} strokeWidth={2.5} />
      </div>
      <p className="font-serif text-[24px] font-medium leading-tight text-text">
        {regime.regime}
      </p>
      <div className="grid grid-cols-3 gap-3 border-t border-border-subtle pt-3">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-text-tertiary">
            Win rate
          </span>
          <span className="font-mono text-[15px] font-medium tabular-nums text-text">
            {(regime.winRate * 100).toFixed(0)}%
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-text-tertiary">
            Avg P&L
          </span>
          <span className={cn("font-mono text-[15px] font-medium tabular-nums", toneClass)}>
            {fmtUsd(regime.avgPnl, true)}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-text-tertiary">
            Total
          </span>
          <span className={cn("font-mono text-[15px] font-medium tabular-nums", toneClass)}>
            {fmtUsd(regime.netPnl, true)}
          </span>
        </div>
      </div>
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
        {regime.count} {regime.count === 1 ? "activity" : "activities"}
      </p>
    </div>
  );
}
