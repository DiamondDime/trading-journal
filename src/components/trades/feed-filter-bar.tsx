/**
 * Inline filter bar for the /trades positions feed.
 *
 * Rendered as a Server Component since the entire filter state lives in the
 * URL — the form is a plain `method="get"` POST-to-self that the page parses
 * back out of `searchParams` on the next render. No client JS needed.
 *
 * Design rationale:
 *   - Native `<select>` and `<input>` keep the bar accessible by default
 *     (keyboard, screen reader, paste, browser autofill all work) and ship
 *     zero JS for the most common interaction. The dashboard's dialog-style
 *     filter is overkill for a flat row feed.
 *   - The form's hidden `sort` input preserves the active sort across filter
 *     changes — we deliberately drop `cursor` on submit so a filter change
 *     always lands on page 1. The page passes the cursor through on Prev/Next
 *     via its own pagination links instead.
 *   - The Reset link is a plain `<Link>` rather than a button so it round-
 *     trips through the URL without any client handler.
 */
import Link from "next/link";
import { Search } from "lucide-react";
import { getT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import type { FeedExchangeOption } from "@/app/trades/db";

interface ActiveFilters {
  exchange: string;
  symbol: string;
  side: string;
  status: string;
  instrument: string;
  linked: string;
  sort: string;
}

interface Props {
  active: ActiveFilters;
  exchangeOptions: FeedExchangeOption[];
}

const LABEL_CLASS =
  "flex min-w-0 flex-col gap-1";
const LABEL_TEXT =
  "font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-text-tertiary";
const FIELD_CLASS =
  "rounded-md border border-border bg-surface px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-text focus:border-text focus:outline-none";

export async function FeedFilterBar({ active, exchangeOptions }: Props) {
  const t = await getT();

  // The reset link drops every query param. Sort defaults are derived in the
  // page; here we just navigate to the bare /trades route.
  const showReset =
    active.exchange !== "" ||
    active.symbol !== "" ||
    active.side !== "" ||
    (active.status !== "" && active.status !== "all") ||
    active.instrument !== "" ||
    (active.linked !== "" && active.linked !== "all");

  return (
    <form
      method="get"
      action="/trades"
      className="flex flex-wrap items-end gap-3 border-b border-border bg-surface px-4 py-4"
      aria-label={t("trades.feed.filter.apply")}
    >
      {/* Preserve sort across filter submits — cursor is intentionally
          dropped so a filter change resets to page 1. */}
      <input type="hidden" name="sort" value={active.sort || "opened_desc"} />

      <label className={LABEL_CLASS}>
        <span className={LABEL_TEXT}>{t("trades.feed.filter.exchange")}</span>
        <select
          name="exchange"
          defaultValue={active.exchange}
          className={cn(FIELD_CLASS, "min-w-[10rem]")}
        >
          <option value="">{t("trades.feed.filter.allExchanges")}</option>
          {exchangeOptions.map((opt) => (
            <option key={opt.code} value={opt.code}>
              {opt.label} ({opt.count})
            </option>
          ))}
        </select>
      </label>

      <label className={LABEL_CLASS}>
        <span className={LABEL_TEXT}>{t("trades.feed.filter.status")}</span>
        <select
          name="status"
          defaultValue={active.status || "all"}
          className={cn(FIELD_CLASS, "min-w-[7rem]")}
        >
          <option value="all">{t("trades.feed.filter.statusAll")}</option>
          <option value="open">{t("trades.feed.filter.statusOpen")}</option>
          <option value="closed">{t("trades.feed.filter.statusClosed")}</option>
        </select>
      </label>

      <label className={LABEL_CLASS}>
        <span className={LABEL_TEXT}>{t("trades.feed.filter.side")}</span>
        <select
          name="side"
          defaultValue={active.side}
          className={cn(FIELD_CLASS, "min-w-[6rem]")}
        >
          <option value="">{t("trades.feed.filter.sideAll")}</option>
          <option value="long">{t("trades.feed.filter.sideLong")}</option>
          <option value="short">{t("trades.feed.filter.sideShort")}</option>
        </select>
      </label>

      <label className={LABEL_CLASS}>
        <span className={LABEL_TEXT}>{t("trades.feed.filter.instrument")}</span>
        <select
          name="instrument"
          defaultValue={active.instrument}
          className={cn(FIELD_CLASS, "min-w-[8rem]")}
        >
          <option value="">{t("trades.feed.filter.instrumentAll")}</option>
          <option value="spot">{t("trades.feed.filter.instrumentSpot")}</option>
          <option value="perp">{t("trades.feed.filter.instrumentPerp")}</option>
          <option value="dated_future">
            {t("trades.feed.filter.instrumentDatedFuture")}
          </option>
        </select>
      </label>

      <label className={LABEL_CLASS}>
        <span className={LABEL_TEXT}>{t("trades.feed.filter.linked")}</span>
        <select
          name="linked"
          defaultValue={active.linked || "all"}
          className={cn(FIELD_CLASS, "min-w-[8rem]")}
        >
          <option value="all">{t("trades.feed.filter.linkedAll")}</option>
          <option value="linked">{t("trades.feed.filter.linkedTrue")}</option>
          <option value="unlinked">{t("trades.feed.filter.linkedFalse")}</option>
        </select>
      </label>

      <label className={cn(LABEL_CLASS, "flex-1 min-w-[12rem]")}>
        <span className={LABEL_TEXT}>{t("trades.feed.filter.symbol")}</span>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-text-tertiary"
            aria-hidden
          />
          <input
            type="search"
            name="symbol"
            defaultValue={active.symbol}
            placeholder={t("trades.feed.filter.searchPlaceholder")}
            className={cn(FIELD_CLASS, "w-full pl-8 normal-case tracking-normal")}
          />
        </div>
      </label>

      <div className="flex items-end gap-2">
        <button
          type="submit"
          className="rounded-md border border-text bg-text px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-app transition-colors hover:bg-text-secondary"
        >
          {t("trades.feed.filter.apply")}
        </button>
        {showReset && (
          <Link
            href="/trades"
            className="rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary transition-colors hover:bg-subtle"
          >
            {t("trades.feed.filter.reset")}
          </Link>
        )}
      </div>
    </form>
  );
}
