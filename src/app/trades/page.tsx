/**
 * /trades — cross-exchange positions feed.
 *
 * Server-rendered listing of every position the user holds (or has held)
 * across every connected exchange. Filter state lives in the URL; multi-
 * select submits straight to /add/spread/type so the user can promote
 * ticked rows into a spread without leaving the keyboard.
 *
 * Rendering strategy:
 *   - Server Component. Reads `searchParams`, calls `listTradeFeed` +
 *     `listFeedExchangeOptions`, renders the table + filter bar + pagination.
 *   - The selection bar is the only client island — it watches for `change`
 *     events on the wrapping form to count ticked rows and toggles the
 *     submit-disabled state.
 *   - `dynamic = "force-dynamic"` because we read the locale cookie via
 *     `getT()` AND the response varies per request based on query string.
 */
import Link from "next/link";
import { ChevronLeft, ChevronRight, Plug, ArrowRight } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { getConnectedExchangeCount } from "@/lib/db/activity";
import {
  listTradeFeed,
  listFeedExchangeOptions,
  type TradeFeedFilters,
  type TradeFeedSort,
} from "./db";
import { FeedFilterBar } from "@/components/trades/feed-filter-bar";
import { FeedTable } from "@/components/trades/feed-table";
import { FeedSelectionBar } from "@/components/trades/feed-selection-bar";

export const dynamic = "force-dynamic";

type Search = Promise<{ [key: string]: string | string[] | undefined }>;

const PAGE_LIMIT = 25;

// ── searchParam parsing ────────────────────────────────────────────────────

function getStr(
  sp: Record<string, string | string[] | undefined>,
  key: string,
): string {
  const v = sp[key];
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string") return v[0];
  return "";
}

function parseSort(raw: string): TradeFeedSort {
  switch (raw) {
    case "opened_asc":
    case "pnl_desc":
    case "pnl_asc":
    case "opened_desc":
      return raw;
    default:
      return "opened_desc";
  }
}

function parseSide(raw: string): TradeFeedFilters["side"] {
  return raw === "long" || raw === "short" ? raw : undefined;
}

function parseStatus(raw: string): TradeFeedFilters["status"] {
  if (raw === "open" || raw === "closed" || raw === "all") return raw;
  return undefined;
}

function parseInstrument(raw: string): TradeFeedFilters["instrument"] {
  if (raw === "spot" || raw === "perp" || raw === "dated_future") return raw;
  return undefined;
}

function parseLinked(raw: string): TradeFeedFilters["linked"] {
  if (raw === "linked" || raw === "unlinked" || raw === "all") return raw;
  return undefined;
}

function buildQueryString(
  base: Record<string, string>,
  overrides: Record<string, string | null>,
): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(base)) {
    if (v && v !== "all") sp.set(k, v);
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null) sp.delete(k);
    else if (v && v !== "all") sp.set(k, v);
    else sp.delete(k);
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

// ── Page ───────────────────────────────────────────────────────────────────

export default async function TradesFeedPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  const sp = await searchParams;
  const t = await getT();
  const { id: userId } = await requireUser();

  const rawExchange = getStr(sp, "exchange");
  const rawSymbol = getStr(sp, "symbol");
  const rawSide = getStr(sp, "side");
  const rawStatus = getStr(sp, "status");
  const rawInstrument = getStr(sp, "instrument");
  const rawLinked = getStr(sp, "linked");
  const rawSort = getStr(sp, "sort");
  const cursor = getStr(sp, "cursor") || null;
  const page = Math.max(1, Number.parseInt(getStr(sp, "page") || "1", 10) || 1);

  const filters: TradeFeedFilters = {
    exchange: rawExchange || undefined,
    symbol: rawSymbol || undefined,
    side: parseSide(rawSide),
    status: parseStatus(rawStatus),
    instrument: parseInstrument(rawInstrument),
    linked: parseLinked(rawLinked),
  };
  const sort = parseSort(rawSort);

  // Parallel reads — independent of each other.
  const [{ rows, nextCursor, total }, exchangeOptions, connectionCount] =
    await Promise.all([
      listTradeFeed(userId, filters, sort, PAGE_LIMIT, cursor),
      listFeedExchangeOptions(userId),
      getConnectedExchangeCount(userId),
    ]);

  const start = total === 0 ? 0 : (page - 1) * PAGE_LIMIT + 1;
  const end = Math.min(start + rows.length - 1, total);

  // Pagination links — preserve every filter + the active sort.
  const baseParams: Record<string, string> = {
    ...(rawExchange ? { exchange: rawExchange } : {}),
    ...(rawSymbol ? { symbol: rawSymbol } : {}),
    ...(rawSide ? { side: rawSide } : {}),
    ...(rawStatus ? { status: rawStatus } : {}),
    ...(rawInstrument ? { instrument: rawInstrument } : {}),
    ...(rawLinked ? { linked: rawLinked } : {}),
    ...(rawSort ? { sort: rawSort } : {}),
  };

  const nextHref = nextCursor
    ? `/trades${buildQueryString(baseParams, {
        cursor: nextCursor,
        page: String(page + 1),
      })}`
    : null;

  // Prev pagination uses the browser history when cursor pagination is active
  // (the cursor for page N-1 is not derivable from page N alone). We surface
  // a back link to /trades for the "back to page 1" case which is the most
  // common interaction; the browser back button covers deeper history.
  const prevHref =
    page > 1
      ? page === 2
        ? `/trades${buildQueryString(baseParams, {
            cursor: null,
            page: null,
          })}`
        : null
      : null;

  // Active filter snapshot for the bar — empty strings rather than undefined
  // so the form's `defaultValue` controls the select correctly.
  const activeFilters = {
    exchange: rawExchange,
    symbol: rawSymbol,
    side: rawSide,
    status: rawStatus,
    instrument: rawInstrument,
    linked: rawLinked,
    sort: rawSort || "opened_desc",
  };

  // Empty state branches:
  //   - 0 connections + 0 rows → "Connect an exchange" CTA (no positions can
  //     possibly exist).
  //   - ≥1 connection + 0 rows → "Synced but no positions yet" copy.
  // We render filter-aware empty states only when filters are active; with no
  // filters, an empty result for ≥1 connection is the "still syncing" case.
  const noFiltersActive =
    !rawExchange &&
    !rawSymbol &&
    !rawSide &&
    (!rawStatus || rawStatus === "all") &&
    !rawInstrument &&
    (!rawLinked || rawLinked === "all");
  const showEmpty = rows.length === 0 && noFiltersActive;

  return (
    <div className="w-full">
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <header className="flex flex-col gap-2 border-b border-border px-8 py-7 lg:px-12">
        <h1 className="font-serif text-[40px] font-medium leading-none tracking-tight text-text">
          {t("trades.feed.title")}
        </h1>
        <p className="font-serif text-sm italic text-text-tertiary">
          {t("trades.feed.subtitle")}
        </p>
      </header>

      <div className="px-8 py-6 lg:px-12">
        {showEmpty ? (
          <EmptyState hasConnections={connectionCount > 0} />
        ) : (
          <form action="/add/spread/type" method="get" className="contents">
            {/* The filter bar is rendered above the data, in its own GET
                form — see FeedFilterBar. Both forms can coexist as siblings
                because checkboxes are inside this submission form only. */}
            <FeedFilterBar
              active={activeFilters}
              exchangeOptions={exchangeOptions}
            />

            <div className="rounded-md border border-border bg-surface">
              {rows.length === 0 ? (
                <FilteredEmpty />
              ) : (
                <FeedTable rows={rows} />
              )}

              {/* Pagination row */}
              <div className="flex items-center justify-between border-t border-border px-4 py-3">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
                  {rows.length > 0
                    ? t("trades.feed.pagination.countOf", {
                        start,
                        end,
                        total,
                      })
                    : ""}
                </span>
                <div className="flex items-center gap-1">
                  {prevHref ? (
                    <Link
                      href={prevHref}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary transition-colors hover:bg-subtle"
                    >
                      <ChevronLeft className="h-3 w-3" />
                      {t("trades.feed.pagination.prev")}
                    </Link>
                  ) : (
                    <span
                      aria-disabled
                      className="inline-flex cursor-not-allowed items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary opacity-50"
                    >
                      <ChevronLeft className="h-3 w-3" />
                      {t("trades.feed.pagination.prev")}
                    </span>
                  )}
                  {nextHref ? (
                    <Link
                      href={nextHref}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary transition-colors hover:bg-subtle"
                    >
                      {t("trades.feed.pagination.next")}
                      <ChevronRight className="h-3 w-3" />
                    </Link>
                  ) : (
                    <span
                      aria-disabled
                      className="inline-flex cursor-not-allowed items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary opacity-50"
                    >
                      {t("trades.feed.pagination.next")}
                      <ChevronRight className="h-3 w-3" />
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* How-it-works footnote — collapsed by default. */}
            <details className="mt-6 rounded-md border border-border bg-surface p-4 text-[12px] text-text-tertiary">
              <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary">
                {t("trades.feed.howTo.summary")}
              </summary>
              <p className="mt-3 font-serif text-[13px] leading-snug italic">
                {t("trades.feed.howTo.body")}
              </p>
            </details>

            {/* Sticky multi-select action bar (client island). */}
            <FeedSelectionBar />
          </form>
        )}
      </div>
    </div>
  );
}

// ── Empty states ──────────────────────────────────────────────────────────

async function EmptyState({ hasConnections }: { hasConnections: boolean }) {
  const t = await getT();
  if (!hasConnections) {
    return (
      <div className="rounded-md border border-dashed border-border bg-surface p-12 text-center">
        <Plug
          className="mx-auto mb-4 h-6 w-6 text-text-tertiary"
          aria-hidden
        />
        <h2 className="font-serif text-[18px] font-medium text-text">
          {t("trades.feed.empty.noConnections.title")}
        </h2>
        <p className="mx-auto mt-2 max-w-[48ch] font-serif text-[13px] italic leading-snug text-text-tertiary">
          {t("trades.feed.empty.noConnections.body")}
        </p>
        <Link
          href="/settings/exchanges"
          className="mt-5 inline-flex items-center gap-2 rounded-md border border-text bg-text px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-app transition-colors hover:bg-text-secondary"
        >
          {t("trades.feed.empty.noConnections.cta")}
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-dashed border-border bg-surface p-12 text-center">
      <h2 className="font-serif text-[18px] font-medium text-text">
        {t("trades.feed.empty.noPositions.title")}
      </h2>
      <p className="mx-auto mt-2 max-w-[48ch] font-serif text-[13px] italic leading-snug text-text-tertiary">
        {t("trades.feed.empty.noPositions.body")}
      </p>
    </div>
  );
}

async function FilteredEmpty() {
  const t = await getT();
  return (
    <div className="px-6 py-12 text-center">
      <p className="font-serif text-[14px] italic text-text-tertiary">
        {t("trades.feed.empty.noPositions.title")}
      </p>
      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
        {t("trades.feed.filter.reset")}{" "}
        <Link
          href="/trades"
          className="underline-offset-2 hover:underline"
        >
          /trades
        </Link>
      </p>
    </div>
  );
}
