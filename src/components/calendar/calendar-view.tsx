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

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DOW_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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

function fmtSignedUsd(v: number): string {
  if (v === 0) return "$0.00";
  const sign = v > 0 ? "+" : "−";
  return `${sign}$${Math.abs(v).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtTooltipDate(ymd: string): string {
  // Construct local-time Date from YYYY-MM-DD parts (no `new Date(string)`).
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
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
  const [pickerOpen, setPickerOpen] = React.useState(false);

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
          month={grid.month}
        />

        <CalendarPageTotal
          monthLabel={`${MONTH_NAMES[grid.month]} ${grid.year}`}
          totals={monthSummary}
        />
      </header>

      {/* ── navigation row ──────────────────────────────────────────────── */}
      <section className="flex flex-wrap items-center gap-2 border-b border-border bg-surface/60 px-8 py-3 lg:px-12">
        <Link
          href={`/calendar?ym=${fmtYearMonth(prev.year, prev.month)}`}
          aria-label={`Go to ${MONTH_NAMES[prev.month]} ${prev.year}`}
          className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary hover:bg-subtle hover:text-text"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Previous month
        </Link>

        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Pick a month"
              className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-text hover:bg-subtle"
            >
              {MONTH_NAMES[grid.month]} {grid.year}
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
              onPick={(y, m) => {
                setPickerOpen(false);
                router.push(`/calendar?ym=${fmtYearMonth(y, m)}`);
              }}
            />
          </PopoverContent>
        </Popover>

        <Link
          href={`/calendar?ym=${fmtYearMonth(next.year, next.month)}`}
          aria-label={`Go to ${MONTH_NAMES[next.month]} ${next.year}`}
          className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary hover:bg-subtle hover:text-text"
        >
          Next month
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>

        <Link
          href="/calendar"
          aria-label="Reset to today's month"
          className={cn(
            "ml-1 rounded-md border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors",
            isCurrentMonth
              ? "border-border-strong bg-subtle text-text"
              : "border-border bg-surface text-text-secondary hover:bg-subtle hover:text-text",
          )}
        >
          Today
        </Link>
      </section>

      {/* ── grid ────────────────────────────────────────────────────────── */}
      <section className="px-8 py-8 lg:px-12">
        {/* DOW header row */}
        <div className="grid grid-cols-7 gap-2 pb-2">
          {DOW_HEADERS.map((d, i) => (
            <span
              key={d}
              className={cn(
                "px-1 font-serif text-[10px] font-semibold uppercase tracking-[0.18em] text-text-tertiary",
                i >= 5 ? "text-text-tertiary/70" : "",
              )}
            >
              {d}
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
            />
          ))}
        </div>

        <footer className="mt-12 flex items-center justify-between border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
          <Link href="/spreads" className="hover:text-text">
            ← back to The book
          </Link>
          <span>crypto journal · v0.1</span>
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
  month,
}: {
  year: number;
  month: number;
}) {
  return (
    <div>
      <h1 className="font-serif text-[40px] font-medium leading-none tracking-tight text-text">
        Calendar
      </h1>
      <p className="mt-2 font-serif text-sm italic text-text-tertiary">
        {MONTH_NAMES[month]} {year} · activities by day. Click any day to drill into the archive.
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
  // The page's amber moment lives here — but only when the total is positive,
  // per the design-system rule that the signature amber accompanies wins.
  const isPositive = totals.total > 0;
  return (
    <div className="flex flex-col items-end">
      <p className="font-serif text-[10px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
        {monthLabel} total
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
        {fmtSignedUsd(totals.total)}
      </p>
      <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
        {totals.count === 0
          ? "no activity"
          : `${totals.count} ${totals.count === 1 ? "activity" : "activities"} closed`}
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
  onPick,
}: {
  year: number;
  month: number;
  yearOptions: number[];
  onPick: (y: number, m: number) => void;
}) {
  const [pickedYear, setPickedYear] = React.useState(year);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Link
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPickedYear(pickedYear - 1);
          }}
          aria-label="Previous year"
          className="rounded-md border border-border bg-surface px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary hover:bg-subtle hover:text-text"
        >
          <ChevronLeft className="inline h-3 w-3" />
        </Link>
        <select
          value={pickedYear}
          onChange={(e) => setPickedYear(Number(e.target.value))}
          aria-label="Year"
          className="flex-1 rounded-md border border-border bg-surface px-2 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-text focus:outline-none focus:border-border-strong"
        >
          {yearOptions.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <Link
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPickedYear(pickedYear + 1);
          }}
          aria-label="Next year"
          className="rounded-md border border-border bg-surface px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary hover:bg-subtle hover:text-text"
        >
          <ChevronRight className="inline h-3 w-3" />
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {MONTH_NAMES.map((name, i) => {
          const isFocused = pickedYear === year && i === month;
          return (
            <button
              key={name}
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
}

function CalendarCell({ cell, chips, total }: CalendarCellProps) {
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
            {fmtSignedUsd(total)}
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
              +{overflow} more
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
            aria-label={`${fmtTooltipDate(cell.ymd)} · ${chips.length} ${chips.length === 1 ? "activity" : "activities"}`}
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
          />
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Link
      href={href}
      aria-label={`${fmtTooltipDate(cell.ymd)} · no activity`}
      className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-text rounded-md"
    >
      {inner}
    </Link>
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
}: {
  ymd: string;
  chips: CalendarChip[];
  total: number;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-text-tertiary">{fmtTooltipDate(ymd)}</span>
      <span
        className={
          total > 0 ? "text-up" : total < 0 ? "text-down" : "text-text-tertiary"
        }
      >
        {fmtSignedUsd(total)} · {chips.length} {chips.length === 1 ? "activity" : "activities"}
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
            {chip.serial} · {chip.name} · {fmtSignedUsd(chip.netPnl)}
          </span>
        ))}
        {chips.length > 6 && (
          <span className="text-text-tertiary">+{chips.length - 6} more</span>
        )}
      </div>
    </div>
  );
}
