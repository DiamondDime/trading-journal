import { TrendingDown, TrendingUp } from "lucide-react";
import {
  type Activity,
  type ActivityType,
  type SpreadRow,
  type SpreadType,
} from "@/lib/data/archive-data";
import { getT, getLocale } from "@/lib/i18n/server";

type Slice = {
  key: string;
  name: string;
  count: number;
  net: number;
  capital: number;
  width: number;
};

const ACTIVITY_TYPE_ORDER: ActivityType[] = [
  "spread",
  "trade",
  "sale",
  "airdrop",
  "yield_position",
  "option",
];

const SPREAD_SUBTYPE_ORDER: SpreadType[] = [
  "cash_carry",
  "calendar",
  "funding",
  "cross_exchange",
  "dex_cex",
];

function activityTypeKey(
  t: ActivityType,
):
  | "dashboard.activityMix.types.spread"
  | "dashboard.activityMix.types.trade"
  | "dashboard.activityMix.types.sale"
  | "dashboard.activityMix.types.airdrop"
  | "dashboard.activityMix.types.yield_position"
  | "dashboard.activityMix.types.option" {
  switch (t) {
    case "spread": return "dashboard.activityMix.types.spread";
    case "trade": return "dashboard.activityMix.types.trade";
    case "sale": return "dashboard.activityMix.types.sale";
    case "airdrop": return "dashboard.activityMix.types.airdrop";
    case "yield_position": return "dashboard.activityMix.types.yield_position";
    case "option": return "dashboard.activityMix.types.option";
  }
}

function spreadTypeKey(
  t: SpreadType,
):
  | "dashboard.activityMix.spreadTypes.cash_carry"
  | "dashboard.activityMix.spreadTypes.calendar"
  | "dashboard.activityMix.spreadTypes.funding"
  | "dashboard.activityMix.spreadTypes.cross_exchange"
  | "dashboard.activityMix.spreadTypes.dex_cex" {
  switch (t) {
    case "cash_carry": return "dashboard.activityMix.spreadTypes.cash_carry";
    case "calendar": return "dashboard.activityMix.spreadTypes.calendar";
    case "funding": return "dashboard.activityMix.spreadTypes.funding";
    case "cross_exchange": return "dashboard.activityMix.spreadTypes.cross_exchange";
    case "dex_cex": return "dashboard.activityMix.spreadTypes.dex_cex";
  }
}

function buildActivitySlices(
  data: Activity[],
  nameOf: (t: ActivityType) => string,
): Slice[] {
  const slices: Slice[] = ACTIVITY_TYPE_ORDER.map((t) => {
    const rows = data.filter((r) => r.type === t);
    const net = rows.reduce((s, r) => s + r.netPnl, 0);
    const capital = rows.reduce((s, r) => s + r.capital, 0);
    return {
      key: t,
      name: nameOf(t),
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

function buildSpreadSubtypeSlices(
  data: Activity[],
  nameOf: (t: SpreadType) => string,
): Slice[] {
  const spreads = data.filter((r): r is SpreadRow => r.type === "spread");
  const slices: Slice[] = SPREAD_SUBTYPE_ORDER.map((t) => {
    const rows = spreads.filter((s) => s.spreadType === t);
    const net = rows.reduce((sum, r) => sum + r.netPnl, 0);
    const capital = rows.reduce((sum, r) => sum + r.capital, 0);
    return {
      key: t,
      name: nameOf(t),
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

function fmtSignedUsd(value: number, intlLocale: string): string {
  const sign = value >= 0 ? "+" : "−";
  return `${sign}$${Math.abs(value).toLocaleString(intlLocale, {
    maximumFractionDigits: 0,
  })}`;
}

/**
 * Receive the page's full activity dataset as a prop so the dashboard can
 * pass the result of its DB query (post-Wave 5A) without this component
 * needing to know about the data source. With no data, renders empty
 * slices so the layout stays intact.
 */
export async function ActivityMix({ data = [] }: { data?: Activity[] }) {
  const t = await getT();
  const locale = await getLocale();
  const intlLocale = locale === "ru" ? "ru-RU" : "en-US";
  const capitalLabel = t("dashboard.activityMix.capital");

  const activitySlices = buildActivitySlices(data, (a) => t(activityTypeKey(a)));
  const spreadSlices = buildSpreadSubtypeSlices(data, (s) => t(spreadTypeKey(s)));
  const total = data.length;
  const totalNet = activitySlices.reduce((s, a) => s + a.net, 0);
  const spreadTotal = spreadSlices.reduce((n, s) => n + s.count, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="font-serif text-[12px] font-semibold uppercase tracking-[0.16em] text-text">
            {t("dashboard.activityMix.title")}
          </h3>
          <span className="font-mono text-[10px] text-text-tertiary">
            {t.plural("dashboard.activityMix.summary", total, {
              net: fmtSignedUsd(totalNet, intlLocale),
            })}
          </span>
        </div>

        <div className="grid grid-cols-2 divide-x divide-border-subtle md:grid-cols-4">
          {activitySlices.map((s) => (
            <SliceCell
              key={s.key}
              slice={s}
              intlLocale={intlLocale}
              capitalLabel={capitalLabel}
            />
          ))}
        </div>
      </div>

      <div className="rounded-md border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="font-serif text-[12px] font-semibold uppercase tracking-[0.16em] text-text">
            {t("dashboard.activityMix.spreadSubtypes")}
          </h3>
          <span className="font-mono text-[10px] text-text-tertiary">
            {t.plural("dashboard.activityMix.subtypeCount", spreadTotal)}
          </span>
        </div>

        <div className="grid grid-cols-2 divide-x divide-border-subtle md:grid-cols-5">
          {spreadSlices.map((s) => (
            <SliceCell
              key={s.key}
              slice={s}
              intlLocale={intlLocale}
              capitalLabel={capitalLabel}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function SliceCell({
  slice,
  intlLocale,
  capitalLabel,
}: {
  slice: Slice;
  intlLocale: string;
  capitalLabel: string;
}) {
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
          {fmtSignedUsd(slice.net, intlLocale)}
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
          {capitalLabel}
        </span>
        <span className="font-mono tabular-nums text-text-secondary">
          {slice.capital > 0
            ? `$${slice.capital.toLocaleString(intlLocale, { maximumFractionDigits: 0 })}`
            : "—"}
        </span>
      </div>
    </div>
  );
}
