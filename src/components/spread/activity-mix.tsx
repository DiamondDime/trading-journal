import { TrendingDown, TrendingUp } from "lucide-react";
import {
  ACTIVITY_TYPE_LABELS,
  ARCHIVE_DATA,
  SPREAD_TYPE_LABELS,
  type ActivityType,
  type SpreadRow,
  type SpreadType,
} from "@/lib/data/archive-data";

type Slice = {
  key: string;
  name: string;
  count: number;
  net: number;
  capital: number;
  width: number;
};

const ACTIVITY_TYPE_ORDER: ActivityType[] = ["spread", "trade", "sale", "airdrop"];

const SPREAD_SUBTYPE_ORDER: SpreadType[] = [
  "cash_carry",
  "calendar",
  "funding",
  "cross_exchange",
  "dex_cex",
];

function buildActivitySlices(): Slice[] {
  const slices: Slice[] = ACTIVITY_TYPE_ORDER.map((t) => {
    const rows = ARCHIVE_DATA.filter((r) => r.type === t);
    const net = rows.reduce((s, r) => s + r.netPnl, 0);
    const capital = rows.reduce((s, r) => s + r.capital, 0);
    return {
      key: t,
      name: ACTIVITY_TYPE_LABELS[t],
      count: rows.length,
      net,
      capital,
      width: 0,
    };
  });
  const maxAbs = slices.reduce((m, s) => Math.max(m, Math.abs(s.net)), 1);
  return slices.map((s) => ({
    ...s,
    width: Math.max(2, Math.round((Math.abs(s.net) / maxAbs) * 100)),
  }));
}

function buildSpreadSubtypeSlices(): Slice[] {
  const spreads = ARCHIVE_DATA.filter((r): r is SpreadRow => r.type === "spread");
  const slices: Slice[] = SPREAD_SUBTYPE_ORDER.map((t) => {
    const rows = spreads.filter((s) => s.spreadType === t);
    const net = rows.reduce((sum, r) => sum + r.netPnl, 0);
    const capital = rows.reduce((sum, r) => sum + r.capital, 0);
    return {
      key: t,
      name: SPREAD_TYPE_LABELS[t],
      count: rows.length,
      net,
      capital,
      width: 0,
    };
  });
  const maxAbs = slices.reduce((m, s) => Math.max(m, Math.abs(s.net)), 1);
  return slices
    .filter((s) => s.count > 0)
    .map((s) => ({
      ...s,
      width: Math.max(2, Math.round((Math.abs(s.net) / maxAbs) * 100)),
    }));
}

export function ActivityMix() {
  const activitySlices = buildActivitySlices();
  const spreadSlices = buildSpreadSubtypeSlices();
  const total = ARCHIVE_DATA.length;
  const totalNet = activitySlices.reduce((s, a) => s + a.net, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="font-serif text-[12px] font-semibold uppercase tracking-[0.16em] text-text">
            Activity mix · YTD
          </h3>
          <span className="font-mono text-[10px] text-text-tertiary">
            {total} activities · net {totalNet >= 0 ? "+" : "−"}${Math.abs(totalNet).toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </span>
        </div>

        <div className="grid grid-cols-2 divide-x divide-border-subtle md:grid-cols-4">
          {activitySlices.map((s) => (
            <SliceCell key={s.key} slice={s} />
          ))}
        </div>
      </div>

      <div className="rounded-md border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="font-serif text-[12px] font-semibold uppercase tracking-[0.16em] text-text">
            Spread subtypes
          </h3>
          <span className="font-mono text-[10px] text-text-tertiary">
            {spreadSlices.reduce((n, s) => n + s.count, 0)} spreads
          </span>
        </div>

        <div className="grid grid-cols-2 divide-x divide-border-subtle md:grid-cols-5">
          {spreadSlices.map((s) => (
            <SliceCell key={s.key} slice={s} />
          ))}
        </div>
      </div>
    </div>
  );
}

function SliceCell({ slice }: { slice: Slice }) {
  const tone: "up" | "down" = slice.net >= 0 ? "up" : "down";
  return (
    <div className="flex flex-col gap-2 px-5 py-4 transition-colors hover:bg-subtle border-b md:border-b-0 border-border-subtle">
      <div className="flex items-baseline justify-between">
        <p className="font-serif text-[12px] font-medium text-text">
          {slice.name}
        </p>
        <span className="font-mono text-[10px] text-text-tertiary">
          {slice.count}
        </span>
      </div>

      <div className="flex items-baseline gap-2">
        <span
          className={`font-mono text-[20px] font-medium tabular-nums leading-none ${
            tone === "up" ? "text-up" : "text-down"
          }`}
        >
          {slice.net >= 0 ? "+" : "−"}${Math.abs(slice.net).toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </span>
        {tone === "up" ? (
          <TrendingUp className="h-3 w-3 text-up" strokeWidth={2.5} />
        ) : (
          <TrendingDown className="h-3 w-3 text-down" strokeWidth={2.5} />
        )}
      </div>

      <div className="h-1 w-full rounded-sm bg-subtle">
        <div
          className={`h-full rounded-sm ${
            tone === "up" ? "bg-up" : "bg-down"
          }`}
          style={{ width: `${slice.width}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-[10px]">
        <span className="font-mono uppercase tracking-[0.14em] text-text-tertiary">
          capital
        </span>
        <span className="font-mono tabular-nums text-text-secondary">
          {slice.capital > 0
            ? `$${slice.capital.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
            : "—"}
        </span>
      </div>
    </div>
  );
}
