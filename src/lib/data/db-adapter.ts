// Adapt DB row shapes (from src/lib/db/activity.ts) into the
// `Activity` discriminated-union the existing UI components consume.
//
// Why: dashboard / archive / detail components were built against the
// fixture's `Activity` shape (sp-NNN-style serials, derived labels, type
// guards by literal union). Moving to DB rows wholesale would mean
// rewriting four pages and three components. This adapter localizes the
// translation — DB columns are mapped to display-ready fields here, and
// downstream components stay untouched.
//
// Long-term: kill this layer and have the view emit display-friendly
// columns directly. For now it keeps Wave 5A focused on persistence.

import type {
  Activity,
  ActivityType,
  ActivityStatus,
  Asset,
  HeadlineKind,
  SpreadType,
} from "@/lib/data/archive-data";
import type { ActivityFeedRowDb } from "@/lib/db/activity";

// ── Asset & spread-type backfill from canonical → archive vocabulary ────────

// Canonical DB spread_type → fixture SpreadType (the archive UI vocabulary
// is shorter — db `funding_capture` → ui `funding`, etc.).
const SPREAD_TYPE_DB_TO_UI: Record<string, SpreadType> = {
  cash_carry: "cash_carry",
  funding_capture: "funding",
  cross_exchange_perp_arb: "cross_exchange",
  calendar: "calendar",
  dex_cex_arb: "dex_cex",
};

// Fixture Asset literal union — anything outside this set is dropped to
// "BTC" so the typed union is preserved at the boundary. (Asset is open in
// reality, but the typed components key off this enum.)
const ASSET_LITERALS = new Set<Asset>([
  "BTC", "ETH", "SOL", "PEPE",
  "EIGEN", "W", "ZETA", "JUP", "ARB", "PYTH",
]);

function asAsset(s: string | null | undefined): Asset {
  // primary_symbol comes in three shapes depending on activity type:
  //   spread:           "BTC"           (bare base symbol)
  //   trade:            "BTC-PERP", "ETH-USDT", "BTC-USDT-PERP"
  //   sale / airdrop:   "PYTH"          (token ticker)
  // Strip the quote / suffix so "{BASE}-..." resolves to "{BASE}" before the
  // whitelist check — otherwise SOL-PERP, ETH-USDT, BTC-PERP all collide with
  // the BTC fallback below and pollute the asset filter.
  const upper = (s ?? "").toUpperCase();
  const base = upper.includes("-") ? upper.split("-")[0] : upper;
  return ASSET_LITERALS.has(base as Asset) ? (base as Asset) : "BTC";
}

function asActivityStatus(s: string): ActivityStatus {
  // Map DB statuses → display statuses. The archive UI only knows about
  // terminal/quasi-terminal states because it's closed-only. Anything
  // else is shown as "closed" for now.
  switch (s) {
    case "closed": return "closed";
    case "expired": return "expired";
    case "claimed": return "claimed";
    case "vesting": return "vested";
    default: return "closed";
  }
}

function asHeadlineKind(kind: string, type: ActivityType): HeadlineKind {
  if (type === "sale" || type === "airdrop") return "MTM";
  // For trade + spread, kind comes from the view's headline_kind column
  // (realized_apr). Spread fixtures sometimes use BPS or BPS/D — there's
  // no per-row signal in the DB yet to distinguish those, so default to
  // APR. Wave 6 can refine this when we add a card_headline_format column.
  if (kind === "realized_apr") return "APR";
  return "APR";
}

// ── Serial generation ──────────────────────────────────────────────────────
// Fixture serials are #032, T#005 etc. — they're stable display IDs based
// on insertion order. With DB rows we synthesize a serial from the first
// 4 chars of the UUID prefixed by the type letter. Not human-friendly but
// unique and visually consistent until we add a per-user counter column.

function makeSerial(id: string, type: ActivityType): { serial: string; serialNum: number } {
  const head = id.slice(0, 4).toUpperCase();
  const letter =
    type === "trade"          ? "T"
  : type === "sale"           ? "S"
  : type === "airdrop"        ? "A"
  : type === "yield_position" ? "Y"
  : type === "option"         ? "O"
  : "";
  // Derive a numeric ordering key from the hex prefix — used only by the
  // archive's "Sort by #" column. Stable, monotonic-ish, no clashes.
  const serialNum = parseInt(head, 16);
  return {
    serial: letter ? `${letter}#${head}` : `#${head}`,
    serialNum,
  };
}

// ── Date helpers ───────────────────────────────────────────────────────────
// postgres.js returns Date instances for timestamptz columns; types/canonical.ts
// declares them as Iso8601 strings. The adapter is the boundary that pivots
// between the two — every date input is normalized to an ISO string via
// toIso() before further work.

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") return v;
  return "";
}

function shortDate(input: unknown): { label: string; ymd: string } {
  const iso = toIso(input);
  const d = new Date(iso);
  return {
    label: Number.isFinite(d.getTime())
      ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : "—",
    ymd: iso.slice(0, 10),
  };
}

function daysBetween(opened: unknown, closed: unknown): {
  daysHeld: number;
  daysLabel: string;
} {
  const openedIso = toIso(opened);
  const closedIso = toIso(closed);
  if (!openedIso || !closedIso) return { daysHeld: 0, daysLabel: "—" };
  const ms = new Date(closedIso).getTime() - new Date(openedIso).getTime();
  if (!Number.isFinite(ms)) return { daysHeld: 0, daysLabel: "—" };
  const d = ms / 86_400_000;
  if (d < 1) {
    const hours = d * 24;
    if (hours < 1) return { daysHeld: d, daysLabel: `${Math.round(hours * 60)} min` };
    return { daysHeld: d, daysLabel: `${hours.toFixed(1)}h` };
  }
  return { daysHeld: d, daysLabel: `${Math.round(d)}d` };
}

// ── Headline formatting ────────────────────────────────────────────────────

function fmtHeadline(
  kind: HeadlineKind,
  num: number,
): { label: string; tone: "up" | "down" } {
  const tone: "up" | "down" = num >= (kind === "MTM" ? 1 : 0) ? "up" : "down";
  if (kind === "MTM") {
    const v = num >= 10 ? num.toFixed(1) : num.toFixed(2);
    return { label: `${v}×`, tone };
  }
  if (kind === "APR") {
    const sign = num >= 0 ? "+" : "−";
    return { label: `${sign}${Math.abs(num * 100).toFixed(1)}%`, tone };
  }
  if (kind === "BPS") {
    const sign = num >= 0 ? "+" : "−";
    return { label: `${sign}${Math.abs(num).toFixed(1)}`, tone };
  }
  if (kind === "BPS/D") {
    const sign = num >= 0 ? "+" : "−";
    return { label: `${sign}${Math.abs(num).toFixed(0)}`, tone };
  }
  return { label: String(num), tone };
}

// ── Type-specific subtype prefetch ─────────────────────────────────────────
//
// The feed view doesn't carry subtype-specific labels (variant, venues,
// exchange, protocol, sale_kind). The detail-page renderers need those, so
// callers can optionally pre-attach via `subtypeMeta`. The dashboard +
// archive don't need this — they show generic descriptions per row that
// can be built from primary_symbol + type alone.

export interface SubtypeMeta {
  spread?: {
    spreadType: string;
    variant: string | null;
    exchanges: string[];
    primaryBase: string;
  };
  trade?: {
    symbol: string;
    exchange: string;
    side: "long" | "short";
    instrumentKind: string;
  };
  sale?: {
    tokenSymbol: string;
    saleKind: string;
    saleVenue: string | null;
  };
  airdrop?: {
    tokenSymbol: string;
    protocol: string;
  };
}

// ── Main adapter ───────────────────────────────────────────────────────────

/**
 * Map a v_activity_feed row to the fixture-shaped `Activity` union the
 * existing UI components expect. Caller provides optional subtype metadata
 * for richer display fields; without it, we fall back to safe defaults.
 */
export function feedRowToActivity(
  row: ActivityFeedRowDb,
  meta?: SubtypeMeta,
): Activity {
  const { serial, serialNum } = makeSerial(row.id, row.type);
  const closedRef = row.closedAt ?? row.openedAt ?? row.createdAt;
  const { label: closedLabel, ymd: closedAt } = shortDate(closedRef);
  const { daysHeld, daysLabel } = daysBetween(row.openedAt, row.closedAt);

  const capital = Number(row.capitalDeployedUsd ?? 0);
  const netPnl = Number(row.netPnlUsd ?? 0);
  const headlineNum = Number(row.headlineValue ?? 0);
  const headlineKind = asHeadlineKind(row.headlineKind, row.type);
  const { label: headlineLabel, tone } = fmtHeadline(headlineKind, headlineNum);

  const asset = asAsset(row.primarySymbol);
  const status = asActivityStatus(row.status);
  const note = ""; // Notes table not yet wired into the feed — Wave 6.

  const base = {
    id: row.id,
    type: row.type,
    serial,
    serialNum,
    name: row.name,
    status,
    capital,
    daysHeld,
    daysLabel,
    closedAt,
    closedLabel,
    netPnl,
    headlineKind,
    headlineNum,
    headlineLabel,
    tone,
    regimeTags: row.regimeTags,
    strategyTag: row.strategyTag,
    note,
    href: hrefFor(row.id, row.type),
  } as const;

  switch (row.type) {
    case "spread": {
      const m = meta?.spread;
      const uiSpreadType: SpreadType = m
        ? SPREAD_TYPE_DB_TO_UI[m.spreadType] ?? "cash_carry"
        : "cash_carry";
      return {
        ...base,
        type: "spread",
        spreadType: uiSpreadType,
        variant: m?.variant ?? "",
        asset,
        venues: m?.exchanges.join(" + ") ?? "Manual",
      };
    }
    case "trade": {
      const m = meta?.trade;
      return {
        ...base,
        type: "trade",
        symbol: m?.symbol ?? row.primarySymbol ?? "",
        exchange: m?.exchange ?? "—",
        side: m?.side ?? "long",
        instrument: (m?.instrumentKind === "dated_future" ? "future" : (m?.instrumentKind ?? "perp")) as "perp" | "spot" | "future",
        asset,
      };
    }
    case "sale": {
      const m = meta?.sale;
      const usdPaid = capital > 0 ? capital : 1;
      const multiplier = headlineNum > 0 ? headlineNum : (usdPaid + netPnl) / usdPaid;
      return {
        ...base,
        type: "sale",
        asset,
        saleKind: ((m?.saleKind ?? "ido") as "ido" | "launchpad" | "premarket" | "otc"),
        venue: m?.saleVenue ?? "—",
        multiplier,
      };
    }
    case "airdrop": {
      const m = meta?.airdrop;
      const valueAtClaim = Number(row.realizedPnlUsd ?? 0) || 1;
      const multiplier = headlineNum > 0 ? headlineNum : Math.abs(netPnl) / valueAtClaim;
      return {
        ...base,
        type: "airdrop",
        asset,
        protocol: m?.protocol ?? "—",
        multiplier,
      };
    }
    case "yield_position":
    case "option": {
      // v5: yield_position + option detail pages render off their own
      // canonical interfaces, not the legacy archive-row union. The list
      // pages call dedicated adapters; the polymorphic fallback used by
      // /spreads/archive is intentionally not supported for these new
      // types (cast back to a Trade-shaped row so the list at least renders
      // a card with the right name + headline).
      return {
        ...base,
        type: "trade",
        symbol: row.primarySymbol ?? "",
        exchange: "—",
        side: "long",
        instrument: "spot",
        asset,
      };
    }
  }
}

function hrefFor(id: string, type: ActivityType): string {
  switch (type) {
    case "trade":          return `/trades/${id}`;
    case "spread":         return `/spreads/${id}`;
    case "sale":           return `/sales/${id}`;
    case "airdrop":        return `/airdrops/${id}`;
    case "yield_position": return `/yield-positions/${id}`;
    case "option":         return `/options/${id}`;
  }
}

/**
 * Bulk-map a list of feed rows + per-id subtype metadata into Activities.
 * The subtype meta map can be built with one extra SELECT per active type
 * (see fetchListSubtypeMeta in src/lib/data/db-queries.ts).
 */
export function feedRowsToActivities(
  rows: ActivityFeedRowDb[],
  metaById: Map<string, SubtypeMeta> = new Map(),
): Activity[] {
  return rows.map((r) => feedRowToActivity(r, metaById.get(r.id)));
}
