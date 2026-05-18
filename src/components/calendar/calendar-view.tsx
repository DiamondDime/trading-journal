"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useT, useLocale } from "@/lib/i18n/client";
import type { MonthGrid } from "@/lib/calendar/month-grid";
import { fmtYearMonth, addMonths } from "@/lib/calendar/month-grid";
import type { CalendarChip } from "@/lib/calendar/chips";

/**
 * Full-page calendar view. Renders the month grid + navigation controls.
 *
 * Server hands us the resolved grid + bucketed chip data. The client owns:
 *   • Navigation buttons (prev / next / today) — push to ?ym=YYYY-MM
 *   • Month + year picker popover — same destination, just discoverable
 *   • Click handlers on cells → /spreads/archive deep-link (date filter
 *     params noted as follow-up since the archive doesn't yet honor them).
 */

const MONTH_KEYS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
] as const;

const DOW_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

interface CalendarViewProps {
  /** Pre-built month grid (cells + boundaries + row count). */
  grid: MonthGrid;
  /** Chips per YYYY-MM-DD — empty Map if there's no activity. */
  chipsByDate: Map<string, CalendarChip[]>;
  /** Per-day signed P&L total — empty Map if there's no activity. */
  totalsByDate: Map<string, number>;
  /** Year extents for the year-picker popover. */
  yearOptions: number[];
  /** Today's YYYY-MM in the same encoding as URL `ym` — used by the Today button. */
  todayYm: string;
  /** Canonical sum + activity count for the focused month, pre-computed by the page. */
  monthSummary: { total: number; count: number };
}

const MAX_CHIPS_VISIBLE = 3;

function fmtSignedUsd(v: number, locale: "en" | "ru"): string {
  const intl = locale === "ru" ? "ru-RU" : "en-US";
  const abs = Math.abs(v).toLocaleString(intl, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (v === 0) return locale === "ru" ? `${abs} $` : `$${abs}`;
  const sign = v > 0 ? "+" : "−";
  return locale === "ru" ? `${sign}${abs} $` : `${sign}$${abs}`;
}

function fmtTooltipDate(ymd: string, locale: "en" | "ru"): string {
  // Construct local-time Date from YYYY-MM-DD parts (no `new Date(string)`).
  const [y, m, d] = ymd.split("-").map(Number);
  const intl = locale === "ru" ? "ru-RU" : "en-US";
  return new Date(y, m - 1, d).toLocaleDateString(intl, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function CalendarView({
  grid,
  chipsByDate,
  totalsByDate,
  yearOptions,
  todayYm,
  monthSummary,
}: CalendarViewProps) {
  const router = useRouter();
  const t = useT();
  const locale = useLocale();
  const [pickerOpen, setPickerOpen] = React.useState(false);

  const monthName = (m: number) => t(`calendar.months.${MONTH_KEYS[m]}` as Parameters<typeof t>[0]);

  const prev = addMonths(grid.year, grid.month, -1);
  const next = addMonths(grid.year, grid.month, 1);

  const focusedYm = fmtYearMonth(grid.year, grid.month);
  const isCurrentMonth = focusedYm === todayYm;

  // Cells layout: 7 columns × {rows} rows. Each cell has a fixed aspect ratio
  // so the grid stays consistently sized regardless of how many chips a cell
  // shows. 4/3 lets the chips breathe without making rows feel cavernous.
  return (
    <div className="w-full">
      {/* ── page header ─────────────────────────────────────────────────── */}
      <header className="flex flex-col gap-4 border-b border-border px-8 py-7 md:flex-row md:items-end md:justify-between lg:px-12">
        <CalendarPageHeader
          year={grid.year}
          monthName={monthName(grid.month)}
        />

        <CalendarPageTotal
          monthLabel={`${monthName(grid.month)} ${grid.year}`}
          totals={monthSummary}
        />
      </header>

      {/* ── navigation row ──────────────────────────────────────────────── */}
      <section className="flex flex-wrap items-center gap-2 border-b border-border bg-surface/60 px-8 py-3 lg:px-12">
        <Link
          href={`/calendar?ym=${fmtYearMonth(prev.year, prev.month)}`}
          aria-label={t("calendar.goToMonth", { month: monthName(prev.month), year: prev.year })}
          className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary hover:bg-subtle hover:text-text"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          {t("calendar.prevMonth")}
        </Link>

        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={t("calendar.pickMonth")}
              className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-text hover:bg-subtle"
            >
              {monthName(grid.month)} {grid.year}
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="center"
            className="w-72 p-3"
            sideOffset={6}
          >
            <MonthYearPicker
              year={grid.year}
              month={grid.month}
              yearOptions={yearOptions}
              monthName={monthName}
              labels={{
                prevYear: t("calendar.prevYear"),
                nextYear: t("calendar.nextYear"),
                year: t("calendar.pickYear"),
              }}
              onPick={(y, m) => {
                setPickerOpen(false);
                router.push(`/calendar?ym=${fmtYearMonth(y, m)}`);
              }}
            />
          </PopoverContent>
        </Popover>

        <Link
          href={`/calendar?ym=${fmtYearMonth(next.year, next.month)}`}
          aria-label={t("calendar.goToMonth", { month: monthName(next.month), year: next.year })}
          className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary hover:bg-subtle hover:text-text"
        >
          {t("calendar.nextMonth")}
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>

        <Link
          href="/calendar"
          aria-label={t("calendar.todayLabel")}
          className={cn(
            "ml-1 rounded-md border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors",
            isCurrentMonth
              ? "border-border-strong bg-subtle text-text"
              : "border-border bg-surface text-text-secondary hover:bg-subtle hover:text-text",
          )}
        >
          {t("calendar.today")}
        </Link>
      </section>

      {/* ── grid ────────────────────────────────────────────────────────── */}
      <section className="px-8 py-8 lg:px-12">
        {/* DOW header row */}
        <div className="grid grid-cols-7 gap-2 pb-2">
          {DOW_KEYS.map((k, i) => (
            <span
              key={k}
              className={cn(
                "px-1 font-serif text-[10px] font-semibold uppercase tracking-[0.18em] text-text-tertiary",
                i >= 5 ? "text-text-tertiary/70" : "",
              )}
            >
              {t(`calendar.weekdays.${k}` as Parameters<typeof t>[0])}
            </span>
          ))}
        </div>

        {/* Cells */}
        <div className="grid grid-cols-7 gap-2">
          {grid.cells.map((c) => (
            <CalendarCell
              key={c.ymd}
              cell={{
                ymd: c.ymd,
                day: c.day,
                inMonth: c.inMonth,
                isToday: c.isToday,
              }}
              chips={chipsByDate.get(c.ymd) ?? []}
              total={totalsByDate.get(c.ymd) ?? 0}
              locale={locale}
            />
          ))}
        </div>

        <footer className="mt-12 flex items-center justify-between border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
          <Link href="/spreads" className="hover:text-text">
            {t("calendar.backToBook")}
          </Link>
          <span>{t("calendar.footer")}</span>
        </footer>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page header
// ---------------------------------------------------------------------------

function CalendarPageHeader({
  year,
  monthName,
}: {
  year: number;
  monthName: string;
}) {
  const t = useT();
  return (
    <div>
      <h1 className="font-serif text-[40px] font-medium leading-none tracking-tight text-text">
        {t("calendar.pageHeading")}
      </h1>
      <p className="mt-2 font-serif text-sm italic text-text-tertiary">
        {t("calendar.pageSubtitle", { month: monthName, year })}
      </p>
    </div>
  );
}

function CalendarPageTotal({
  monthLabel,
  totals,
}: {
  monthLabel: string;
  totals: { total: number; count: number };
}) {
  const t = useT();
  const locale = useLocale();
  const isPositive = totals.total > 0;
  return (
    <div className="flex flex-col items-end">
      <p className="font-serif text-[10px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
        {t("calendar.monthTotal", { month: monthLabel })}
      </p>
      <p
        className={cn(
          "mt-1 font-mono text-[28px] font-medium tabular-nums leading-none",
          totals.count === 0
            ? "text-text-secondary"
            : isPositive
              ? "text-signature"
              : totals.total < 0
                ? "text-down"
                : "text-text",
        )}
      >
        {fmtSignedUsd(totals.total, locale)}
      </p>
      <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
        {totals.count === 0
          ? t("calendar.noActivity")
          : t.plural("plurals.activities", totals.count)}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Month / year picker
// ---------------------------------------------------------------------------

function MonthYearPicker({
  year,
  month,
  yearOptions,
  monthName,
  labels,
  onPick,
}: {
  year: number;
  month: number;
  yearOptions: number[];
  monthName: (m: number) => string;
  labels: { prevYear: string; nextYear: string; year: string };
  onPick: (y: number, m: number) => void;
}) {
  const [pickedYear, setPickedYear] = React.useState(year);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setPickedYear(pickedYear - 1)}
          aria-label={labels.prevYear}
          className="rounded-md border border-border bg-surface px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary hover:bg-subtle hover:text-text"
        >
          <ChevronLeft className="inline h-3 w-3" />
        </button>
        <select
          value={pickedYear}
          onChange={(e) => setPickedYear(Number(e.target.value))}
          aria-label={labels.year}
          className="flex-1 rounded-md border border-border bg-surface px-2 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-text focus:outline-none focus:border-border-strong"
        >
          {yearOptions.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setPickedYear(pickedYear + 1)}
          aria-label={labels.nextYear}
          className="rounded-md border border-border bg-surface px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary hover:bg-subtle hover:text-text"
        >
          <ChevronRight className="inline h-3 w-3" />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {Array.from({ length: 12 }, (_, i) => {
          const name = monthName(i);
          const isFocused = pickedYear === year && i === month;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onPick(pickedYear, i)}
              className={cn(
                "rounded-md border px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors",
                isFocused
                  ? "border-text bg-text/[0.08] text-text"
                  : "border-border bg-surface text-text-secondary hover:border-border-strong hover:text-text",
              )}
            >
              {name.slice(0, 3)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Calendar cell
// ---------------------------------------------------------------------------

interface CalendarCellProps {
  cell: {
    ymd: string;
    day: number;
    inMonth: boolean;
    isToday: boolean;
  };
  chips: CalendarChip[];
  total: number;
  locale: "en" | "ru";
}

function CalendarCell({ cell, chips, total, locale }: CalendarCellProps) {
  const t = useT();
  const totalTone =
    total > 0 ? "text-up" : total < 0 ? "text-down" : "text-text-tertiary";
  const hasActivity = chips.length > 0;

  // Date-range deep-link into the archive. Archive doesn't honor `from`/`to`
  // today (Wave 12D follow-up); the params are emitted anyway so the link
  // upgrades cleanly when filtering lands. Until then we strip them so the
  // navigation lands on the unfiltered archive rather than 404-ing.
  const href = `/spreads/archive`;

  const visible = chips.slice(0, MAX_CHIPS_VISIBLE);
  const overflow = Math.max(0, chips.length - MAX_CHIPS_VISIBLE);

  // Note on accessibility: the cell is a Link so keyboard nav and screen
  // readers get the standard "drill into day" affordance for free. The
  // tooltip exposes the chip detail without making click required.
  const inner = (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-md border bg-surface p-2.5 transition-colors",
        cell.inMonth
          ? "border-border hover:border-border-strong hover:bg-subtle"
          : "border-border-subtle bg-inset hover:bg-subtle",
        cell.isToday && "ring-1 ring-text ring-inset",
      )}
      style={{ aspectRatio: "4 / 3", minHeight: "92px" }}
    >
      {/* Top row: day number + total */}
      <div className="flex items-baseline justify-between gap-1">
        <span
          className={cn(
            "font-mono text-[12px] tabular-nums",
            cell.inMonth ? "text-text" : "text-text-tertiary/60",
            cell.isToday && "font-semibold",
          )}
        >
          {cell.day}
        </span>
        {hasActivity && cell.inMonth && (
          <span
            className={cn(
              "font-mono text-[10px] tabular-nums",
              totalTone,
            )}
          >
            {fmtSignedUsd(total, locale)}
          </span>
        )}
      </div>

      {/* Chips */}
      {hasActivity && cell.inMonth && (
        <div className="flex flex-col gap-1">
          {visible.map((chip) => (
            <ChipTag key={chip.id} chip={chip} />
          ))}
          {overflow > 0 && (
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-text-tertiary">
              {t("calendar.moreOverflow", { count: overflow })}
            </span>
          )}
        </div>
      )}
    </div>
  );

  // Wrap in tooltip only when there's something to show — empty cells get
  // a lighter affordance, no tooltip noise.
  if (hasActivity) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href={href}
            aria-label={`${fmtTooltipDate(cell.ymd, locale)} · ${t.plural("plurals.activities", chips.length)}`}
            className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-text rounded-md"
          >
            {inner}
          </Link>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs font-mono text-[11px]">
          <CellTooltipBody
            ymd={cell.ymd}
            chips={chips}
            total={total}
            locale={locale}
          />
        </TooltipContent>
      </Tooltip>
    );
  }

  // Empty cells render as a non-interactive <div>. Wrapping them in <Link>
  // earlier had the cell pretending to drill into the archive even though
  // there was nothing to drill into; clicking a blank day silently dumped
  // the user on the unfiltered archive. Lighter affordance, less surprise.
  return (
    <div
      role="presentation"
      aria-label={t("calendar.ariaCellEmpty", { date: fmtTooltipDate(cell.ymd, locale) })}
      className="block rounded-md"
    >
      {inner}
    </div>
  );
}

function ChipTag({ chip }: { chip: CalendarChip }) {
  const toneClass =
    chip.tone === "up"
      ? "border-up/40 bg-up/10 text-up"
      : chip.tone === "down"
        ? "border-down/40 bg-down/10 text-down"
        : "border-border bg-subtle text-text-secondary";
  return (
    <span
      className={cn(
        "inline-flex w-full items-center gap-1.5 truncate rounded-sm border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.10em]",
        toneClass,
      )}
    >
      <span className="font-semibold">{chip.letter}</span>
      <span className="truncate">{chip.serial}</span>
    </span>
  );
}

function CellTooltipBody({
  ymd,
  chips,
  total,
  locale,
}: {
  ymd: string;
  chips: CalendarChip[];
  total: number;
  locale: "en" | "ru";
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-1">
      <span className="text-text-tertiary">{fmtTooltipDate(ymd, locale)}</span>
      <span
        className={
          total > 0 ? "text-up" : total < 0 ? "text-down" : "text-text-tertiary"
        }
      >
        {fmtSignedUsd(total, locale)} · {t.plural("plurals.activities", chips.length)}
      </span>
      <div className="mt-1 flex flex-col gap-0.5">
        {chips.slice(0, 6).map((chip) => (
          <span
            key={chip.id}
            className={cn(
              "truncate",
              chip.tone === "up"
                ? "text-up"
                : chip.tone === "down"
                  ? "text-down"
                  : "text-text-tertiary",
            )}
          >
            {chip.serial} · {chip.name} · {fmtSignedUsd(chip.netPnl, locale)}
          </span>
        ))}
        {chips.length > 6 && (
          <span className="text-text-tertiary">{t("calendar.moreOverflow", { count: chips.length - 6 })}</span>
        )}
      </div>
    </div>
  );
}
