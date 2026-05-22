/**
 * Positions feed table for /trades.
 *
 * Server component — every row is rendered server-side. The only interactive
 * bit is the per-row `<input type="checkbox" name="legs" value={positionId}>`
 * which the wrapping `<form action="/add/spread/type">` collects on submit.
 *
 * Column layout (kept dense to keep the feed scannable on a typical desk
 * resolution):
 *   ☐  ·  Exchange  ·  Symbol · type  ·  Side  ·  Qty  ·  Entry → Exit
 *      ·  Opened  ·  Net PnL  ·  Funding  ·  Linked
 *
 * No row links in v1 (no /trades/[id] detail page yet) — the symbol is a
 * non-link span. When the detail page lands, swap the symbol for an `<a>`
 * (or `next/link`) and wire `aria-label` on the row.
 *
 * Decimal formatters here are intentionally local — they handle string
 * decimals (per CLAUDE.md's "Decimals as strings" rule) and never round.
 */
import Link from "next/link";
import { ExchangeChip } from "@/components/settings/exchange-logo";
import { cn } from "@/lib/utils";
import { getT, getLocale } from "@/lib/i18n/server";
import { stripSettleSuffix } from "@/lib/format/instrument";
import type { TradeFeedRow } from "@/app/trades/db";

interface Props {
  rows: TradeFeedRow[];
}

// ── Formatters ────────────────────────────────────────────────────────────

function fmtQty(s: string, locale: string): string {
  const v = Number.parseFloat(s);
  if (!Number.isFinite(v)) return s;
  if (Math.abs(v) >= 1_000_000) return v.toExponential(2);
  if (Math.abs(v) >= 1000)
    return v.toLocaleString(locale, { maximumFractionDigits: 0 });
  if (Math.abs(v) < 1)
    return v.toLocaleString(locale, { maximumSignificantDigits: 4 });
  return v.toLocaleString(locale, { maximumFractionDigits: 4 });
}

function fmtPrice(s: string | null, locale: string): string {
  if (s == null) return "—";
  const v = Number.parseFloat(s);
  if (!Number.isFinite(v)) return s;
  if (Math.abs(v) < 1)
    return v.toLocaleString(locale, { maximumSignificantDigits: 4 });
  return v.toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtSignedAmount(s: string, quote: string, locale: string): string {
  const v = Number.parseFloat(s);
  if (!Number.isFinite(v)) return s;
  const sign = v < 0 ? "−" : v > 0 ? "+" : "";
  const abs = Math.abs(v).toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}${abs} ${quote}`;
}

function fmtDate(iso: string | null, intlLocale: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString(intlLocale, {
    month: "short",
    day: "numeric",
    year: "2-digit",
  });
}

// ── Component ─────────────────────────────────────────────────────────────

export async function FeedTable({ rows }: Props) {
  const t = await getT();
  const locale = await getLocale();
  const intlLocale = locale === "ru" ? "ru-RU" : "en-US";

  return (
    <>
      {/* Hidden inputs read by /add/spread/type on submit. The matcher key
          tells the wizard the legs came from the user picking rows by hand
          rather than the auto-matcher; `source` distinguishes the entry path
          for analytics. */}
      <input type="hidden" name="matcher" value="manual_selection" />
      <input type="hidden" name="source" value="auto_selection" />

      <div className="w-full overflow-x-auto">
        <table className="w-full caption-bottom border-collapse text-sm">
          <thead className="border-b border-border bg-subtle/50">
            <tr>
              <th
                scope="col"
                className="w-10 px-3 py-2.5 text-left align-middle"
              >
                <span className="sr-only">
                  {t("trades.feed.col.selectAll")}
                </span>
              </th>
              <th scope="col" className={HEAD_CLASS}>
                {t("trades.feed.col.exchange")}
              </th>
              <th scope="col" className={HEAD_CLASS}>
                {t("trades.feed.col.symbol")}
              </th>
              <th scope="col" className={HEAD_CLASS}>
                {t("trades.feed.col.side")}
              </th>
              <th scope="col" className={cn(HEAD_CLASS, "text-right")}>
                {t("trades.feed.col.qty")}
              </th>
              <th scope="col" className={cn(HEAD_CLASS, "text-right")}>
                {t("trades.feed.col.entryExit")}
              </th>
              <th scope="col" className={HEAD_CLASS}>
                {t("trades.feed.col.opened")}
              </th>
              <th scope="col" className={cn(HEAD_CLASS, "text-right")}>
                {t("trades.feed.col.netPnl")}
              </th>
              <th scope="col" className={cn(HEAD_CLASS, "text-right")}>
                {t("trades.feed.col.funding")}
              </th>
              <th scope="col" className={HEAD_CLASS}>
                {t("trades.feed.col.linked")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const pnlStr = row.netPnlQuote;
              const pnlNum = Number.parseFloat(pnlStr) || 0;
              const fundingNum = Number.parseFloat(row.totalFundingQuote) || 0;
              const sideTone =
                row.side === "long" ? "text-up" : "text-down";

              return (
                <tr
                  key={row.id}
                  className="border-b border-border-subtle transition-colors hover:bg-subtle/40"
                >
                  <td className="w-10 px-3 py-2.5 align-middle">
                    <input
                      type="checkbox"
                      name="legs"
                      value={row.id}
                      aria-label={t("trades.feed.bulk.selectOneAria", {
                        symbol: stripSettleSuffix(row.instrument),
                      })}
                      className="h-4 w-4 cursor-pointer accent-text"
                    />
                  </td>
                  <td className={CELL_CLASS}>
                    <span className="inline-flex items-center gap-2">
                      <ExchangeChip
                        venue={row.exchangeCode}
                        size="sm"
                        displayName={row.exchangeConnectionLabel}
                      />
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
                        {row.exchangeConnectionLabel}
                      </span>
                    </span>
                  </td>
                  <td className={CELL_CLASS}>
                    <span className="flex flex-col leading-tight">
                      <span className="font-serif text-[13px] font-medium text-text">
                        {stripSettleSuffix(row.instrument)}
                      </span>
                      <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-text-tertiary">
                        {t(`instrumentKind.${row.instrumentType}`)}
                      </span>
                    </span>
                  </td>
                  <td className={CELL_CLASS}>
                    <span
                      className={cn(
                        "font-mono text-[10px] uppercase tracking-[0.16em]",
                        sideTone,
                      )}
                    >
                      {t(`side.${row.side}`)}
                    </span>
                  </td>
                  <td className={cn(CELL_CLASS, "text-right")}>
                    <span className="font-mono text-[12px] tabular-nums text-text">
                      {fmtQty(row.totalQty, intlLocale)}
                    </span>
                  </td>
                  <td className={cn(CELL_CLASS, "text-right")}>
                    <span className="font-mono text-[12px] tabular-nums text-text">
                      {fmtPrice(row.avgEntryPrice, intlLocale)}
                      {row.avgExitPrice && (
                        <>
                          <span className="mx-1 text-text-tertiary">→</span>
                          <span className="text-text-secondary">
                            {fmtPrice(row.avgExitPrice, intlLocale)}
                          </span>
                        </>
                      )}
                    </span>
                  </td>
                  <td className={CELL_CLASS}>
                    <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
                      {fmtDate(row.openedAt, intlLocale)}
                    </span>
                    {row.closedAt && (
                      <span className="block font-mono text-[9px] uppercase tracking-[0.14em] text-text-tertiary">
                        {t("trades.feed.row.closedAt")}{" "}
                        {fmtDate(row.closedAt, intlLocale)}
                      </span>
                    )}
                  </td>
                  <td className={cn(CELL_CLASS, "text-right")}>
                    <span
                      className={cn(
                        "font-mono text-[12px] font-medium tabular-nums",
                        pnlNum > 0 ? "text-up" : pnlNum < 0 ? "text-down" : "text-text",
                      )}
                    >
                      {fmtSignedAmount(pnlStr, row.quoteCurrency, intlLocale)}
                    </span>
                  </td>
                  <td className={cn(CELL_CLASS, "text-right")}>
                    <span
                      className={cn(
                        "font-mono text-[11px] tabular-nums",
                        fundingNum > 0
                          ? "text-up"
                          : fundingNum < 0
                            ? "text-down"
                            : "text-text-secondary",
                      )}
                    >
                      {fmtSignedAmount(row.totalFundingQuote, row.quoteCurrency, intlLocale)}
                    </span>
                  </td>
                  <td className={CELL_CLASS}>
                    {row.linkedActivityId && row.linkedActivityName ? (
                      <Link
                        href={`/spreads/${row.linkedActivityId}`}
                        className="inline-flex max-w-[14rem] items-center gap-1.5 rounded-full border border-border bg-subtle px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary transition-colors hover:border-border-strong hover:text-text"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-signature" />
                        <span className="truncate">
                          {t("trades.feed.row.linkedTo", {
                            name: row.linkedActivityName,
                          })}
                        </span>
                      </Link>
                    ) : (
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
                        {t("trades.feed.row.noLink")}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

const HEAD_CLASS =
  "px-3 py-2.5 text-left align-middle font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-text-tertiary";
const CELL_CLASS = "px-3 py-2.5 align-middle";
