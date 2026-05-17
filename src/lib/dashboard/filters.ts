/**
 * Dashboard filter URL contract — shared between the page-level reader and
 * the client filter dialog.
 *
 * Filters live in URL search params so they survive reloads, can be linked,
 * and round-trip into the JSON export. Encoding is deliberately tiny:
 *   ?range=30d            — preset window
 *   ?range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD
 *   ?types=spread,trade   — comma-separated activity types
 *   ?minCap=500           — minimum capital floor
 *   ?heatmap=26w          — heatmap toggle (13/26/52 weeks)
 *
 * The page reads these as searchParams (server-side), passes the derived
 * DashboardFilters to every DB helper, and hands the dialog the current
 * state for editing.
 */

import type { ActivityType } from "@/types/canonical";
import type { DashboardFilters } from "@/lib/db/activity";

export type DateRangePreset = "7d" | "30d" | "90d" | "ytd" | "all" | "custom";
export const DATE_RANGE_PRESETS: DateRangePreset[] = [
  "7d",
  "30d",
  "90d",
  "ytd",
  "all",
];

export const ACTIVITY_TYPES: ActivityType[] = [
  "spread",
  "trade",
  "sale",
  "airdrop",
];

export const MIN_CAPITAL_PRESETS = [0, 500, 5000] as const;

export type HeatmapWindow = "13w" | "26w" | "52w";
export const HEATMAP_WINDOWS: HeatmapWindow[] = ["13w", "26w", "52w"];

export interface DashboardSearchParams {
  range: DateRangePreset;
  from?: string;  // YYYY-MM-DD (only meaningful when range === "custom")
  to?: string;    // YYYY-MM-DD
  types: ActivityType[];
  minCapital: number;
  heatmap: HeatmapWindow;
}

const TYPE_SET = new Set<ActivityType>(ACTIVITY_TYPES);

function isRangePreset(v: string): v is DateRangePreset {
  return (
    v === "7d" ||
    v === "30d" ||
    v === "90d" ||
    v === "ytd" ||
    v === "all" ||
    v === "custom"
  );
}

function isHeatmap(v: string): v is HeatmapWindow {
  return v === "13w" || v === "26w" || v === "52w";
}

/** YYYY-MM-DD validator. Tight enough — anything else returns undefined. */
function parseYmd(v: string | undefined): string | undefined {
  if (!v) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isFinite(d.getTime()) ? v : undefined;
}

function pickFirst(
  param: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(param)) return param[0];
  return param;
}

/**
 * Parse a Next.js page `searchParams` (already awaited) into the canonical
 * filter shape. Invalid / missing values fall back to defaults so the page
 * is always renderable.
 */
export function parseDashboardSearchParams(
  raw: Record<string, string | string[] | undefined>,
): DashboardSearchParams {
  const rangeRaw = pickFirst(raw.range);
  const range: DateRangePreset =
    rangeRaw && isRangePreset(rangeRaw) ? rangeRaw : "all";

  const typesRaw = pickFirst(raw.types);
  const types: ActivityType[] = typesRaw
    ? typesRaw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter((s): s is ActivityType => TYPE_SET.has(s as ActivityType))
    : [];

  const minCapitalRaw = pickFirst(raw.minCap);
  const minCapital = (() => {
    if (!minCapitalRaw) return 0;
    const n = Number(minCapitalRaw);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  })();

  const heatmapRaw = pickFirst(raw.heatmap);
  const heatmap: HeatmapWindow =
    heatmapRaw && isHeatmap(heatmapRaw) ? heatmapRaw : "13w";

  return {
    range,
    from: parseYmd(pickFirst(raw.from)),
    to: parseYmd(pickFirst(raw.to)),
    types,
    minCapital,
    heatmap,
  };
}

/**
 * Build a YYYY-MM-DD pair for the chosen date-range preset. `from`/`to` are
 * inclusive. Returns nulls when the range is "all" (no DB filter at all).
 */
function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function resolveDateRange(
  params: DashboardSearchParams,
  today: Date = new Date(),
): { from: string | null; to: string | null } {
  const { range, from, to } = params;
  if (range === "all") return { from: null, to: null };
  if (range === "custom") return { from: from ?? null, to: to ?? null };

  const days =
    range === "7d"
      ? 7
      : range === "30d"
        ? 30
        : range === "90d"
          ? 90
          : null;
  if (days) {
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1));
    return { from: ymdLocal(start), to: ymdLocal(today) };
  }
  // "ytd"
  const start = new Date(today.getFullYear(), 0, 1);
  return { from: ymdLocal(start), to: ymdLocal(today) };
}

/**
 * Project the URL-state into the DB-filter shape. Used everywhere the
 * dashboard queries data and by the export endpoint.
 */
export function buildDashboardFilters(
  params: DashboardSearchParams,
  today: Date = new Date(),
): DashboardFilters {
  const { from, to } = resolveDateRange(params, today);
  const filters: DashboardFilters = {};
  if (from) filters.closedAfter = `${from}T00:00:00`;
  if (to) filters.closedBefore = `${to}T23:59:59.999`;
  if (params.types.length > 0) filters.type = params.types;
  if (params.minCapital > 0) filters.minCapital = params.minCapital;
  return filters;
}

/** Convert canonical state → URLSearchParams. Only writes non-default keys. */
export function serializeDashboardSearchParams(
  params: DashboardSearchParams,
): URLSearchParams {
  const sp = new URLSearchParams();
  if (params.range !== "all") sp.set("range", params.range);
  if (params.range === "custom") {
    if (params.from) sp.set("from", params.from);
    if (params.to) sp.set("to", params.to);
  }
  if (params.types.length > 0) sp.set("types", params.types.join(","));
  if (params.minCapital > 0) sp.set("minCap", String(params.minCapital));
  if (params.heatmap !== "13w") sp.set("heatmap", params.heatmap);
  return sp;
}

export function heatmapWeeks(w: HeatmapWindow): number {
  return w === "52w" ? 52 : w === "26w" ? 26 : 13;
}

export function isAllDefaults(p: DashboardSearchParams): boolean {
  return (
    p.range === "all" &&
    p.types.length === 0 &&
    p.minCapital === 0 &&
    p.heatmap === "13w"
  );
}
