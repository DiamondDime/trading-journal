import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActivityStatus, YieldKind } from "@/types/canonical";

export interface YieldPositionCardProps {
  /** Title — usually activity.name. */
  name: string;
  /** Status badge. Drives the dot tone. */
  status: Extract<ActivityStatus, "open" | "unwinding" | "closed">;
  /** Short activity serial (e.g. "Y#1A2B"). */
  serial?: string;
  /** Activity opened-at date — used for lockup countdown. */
  openedAt: string;
  /** Activity closed-at date — drives realized-window math when present. */
  closedAt?: string | null;
  /** Yield kind (drives the icon + subtitle vocabulary). */
  kind: YieldKind;
  /** Protocol / venue label (e.g. "Lido", "Aave"). */
  protocol: string;
  /** Asset ticker (e.g. "ETH"). */
  asset: string;
  /** Capital deployed in USD. */
  capitalUsd: number | null;
  /** Cumulative reward value in USD as of the latest snapshot. */
  rewardsUsd: number | null;
  /** Expected APY % the trader committed to at open. */
  expectedApyPct: number | null;
  /** Realized APY %, when known. Falls back to a live computation when null. */
  realizedApyPct: number | null;
  /** Optional days-of-lockup at open — when within the window, the card
   *  surfaces a countdown. */
  lockupDays?: number | null;
  /** Extra class for the wrapper. */
  className?: string;
}

const STATUS_DOT: Record<
  Extract<ActivityStatus, "open" | "unwinding" | "closed">,
  string
> = {
  open: "bg-up",
  unwinding: "bg-warn",
  closed: "bg-text-tertiary",
};

const STATUS_LABEL: Record<
  Extract<ActivityStatus, "open" | "unwinding" | "closed">,
  string
> = {
  open: "Open",
  unwinding: "Unwinding",
  closed: "Closed",
};

function fmtPct(n: number, signed = true): string {
  const abs = Math.abs(n).toFixed(2);
  const sign = signed ? (n >= 0 ? "+" : "−") : "";
  return `${sign}${abs}%`;
}

function fmtUsd(n: number): string {
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function daysSince(iso: string): number {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

/**
 * Compute realized APY from rewards / capital / days when the DB hasn't
 * stamped one yet. Mirrors the formula the worker uses for
 * `realized_apy_pct` and the v_activity_feed view's headline.
 */
function computeLiveApy(
  rewardsUsd: number | null,
  capitalUsd: number | null,
  openedAt: string,
  closedAt: string | null | undefined,
): number | null {
  if (!rewardsUsd || !capitalUsd || capitalUsd <= 0) return null;
  const end = closedAt ? new Date(closedAt).getTime() : Date.now();
  const start = new Date(openedAt).getTime();
  const days = Math.max(1, (end - start) / 86_400_000);
  return (rewardsUsd / capitalUsd) * (365 / days) * 100;
}

/**
 * Hero card for a yield position. Mirrors the editorial palette used by
 * spread / trade cards on /spreads/archive: serif-numeric hero, mono
 * caption, status dot, subtitle line. The hero number is *realized* APY
 * when the position is closed (or has snapshot data), with the *expected*
 * APY appearing inline as a comparison.
 *
 * Lockup countdown surfaces only when the trader stamped a lockupDays
 * value at open and the window is still active.
 */
export function YieldPositionCard({
  name,
  status,
  serial,
  openedAt,
  closedAt,
  kind,
  protocol,
  asset,
  capitalUsd,
  rewardsUsd,
  expectedApyPct,
  realizedApyPct,
  lockupDays,
  className,
}: YieldPositionCardProps) {
  const liveApy = realizedApyPct ?? computeLiveApy(rewardsUsd, capitalUsd, openedAt, closedAt);
  const hasRealized = liveApy !== null;
  const headlineApy = hasRealized ? liveApy : expectedApyPct;
  const headlineLabel = hasRealized ? "Realized APY" : "Expected APY";
  const headlineTone =
    headlineApy === null
      ? "text-text"
      : headlineApy > 0
        ? "text-up"
        : "text-down";

  const lockupRemaining =
    lockupDays && lockupDays > 0
      ? Math.max(0, lockupDays - daysSince(openedAt))
      : 0;

  const ratio =
    expectedApyPct && expectedApyPct > 0 && liveApy !== null
      ? liveApy / expectedApyPct
      : null;

  return (
    <div
      className={cn(
        "flex flex-col gap-5 rounded-md border border-border bg-surface p-6",
        className,
      )}
    >
      {/* ── Header: status, serial, lockup ─────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 text-[11px]">
        <span className="inline-flex items-center gap-1.5 text-text-tertiary">
          <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[status])} />
          <span className="font-mono uppercase tracking-[0.16em]">
            {STATUS_LABEL[status]}
          </span>
        </span>
        <div className="flex items-center gap-3 font-mono text-text-tertiary">
          {lockupRemaining > 0 && (
            <span
              className="inline-flex items-center gap-1.5"
              title="Lockup remaining"
            >
              <Lock className="h-2.5 w-2.5" />
              <span className="text-[10px] uppercase tracking-[0.12em]">
                {lockupRemaining}d lockup
              </span>
            </span>
          )}
          {serial && <span>{serial}</span>}
        </div>
      </div>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <h2 className="font-serif text-[20px] font-medium leading-tight text-text">
          {name}
        </h2>
        <p className="font-mono text-[12px] text-text-tertiary">
          {asset.toUpperCase()} · {protocol} · {kind}
        </p>
      </div>

      <div className="flex flex-col gap-2 border-t border-border-subtle pt-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
          {headlineLabel}
        </p>
        <div className="flex items-baseline gap-3">
          <span
            className={cn(
              "font-serif font-normal leading-none tabular-nums",
              headlineTone,
            )}
            style={{ fontSize: "clamp(40px, 5.5vw, 60px)" }}
          >
            {headlineApy !== null ? fmtPct(headlineApy, true) : "—"}
          </span>
          <span className="font-serif text-lg font-normal text-text-tertiary">
            APY
          </span>
        </div>

        {ratio !== null && (
          <p className="font-mono text-[11px] text-text-secondary">
            {hasRealized ? "Realized" : "Live"}: {fmtPct(liveApy ?? 0, false)}
            {" · "}
            Expected: {fmtPct(expectedApyPct ?? 0, false)}
            {" · "}
            <span
              className={
                ratio >= 1 ? "text-up font-medium" : "text-down font-medium"
              }
            >
              ratio {ratio.toFixed(2)}×
            </span>
          </p>
        )}

        <p className="mt-1 font-mono text-[11px] text-text-tertiary">
          Capital: {capitalUsd ? fmtUsd(capitalUsd) : "—"}
          {rewardsUsd != null && (
            <>
              {" · "}
              Rewards: <span className="text-up">{fmtUsd(rewardsUsd)}</span>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
