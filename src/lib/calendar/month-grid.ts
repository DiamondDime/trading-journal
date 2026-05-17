/**
 * Pure month-grid math for the full-page Calendar view.
 *
 * Conventions:
 *   • Monday-first week (fintech convention — the work week leads, weekends trail).
 *   • Grid spans whole calendar months: starts on the Monday of the week
 *     containing the 1st, ends on the Sunday of the week containing the last day.
 *   • Resulting grid is always 5 or 6 rows × 7 columns.
 *
 * All dates are LOCAL — the page constructs from year/month integers and the
 * helpers stay in local time. Server-side this means whatever timezone the
 * Next.js runtime is in (typically the host TZ). v1 is single-user so a single
 * server-TZ is fine; v2 will need a per-user timezone parameter.
 */

export interface MonthGrid {
  /** Year of the focused month (e.g., 2026). */
  year: number;
  /** 0-indexed month of the focused month (Jan = 0). */
  month: number;
  /** Inclusive YYYY-MM-DD start of the grid (Monday). */
  gridStart: string;
  /** Inclusive YYYY-MM-DD end of the grid (Sunday). */
  gridEnd: string;
  /** Inclusive YYYY-MM-DD start of the focused month (always day-1). */
  monthStart: string;
  /** Inclusive YYYY-MM-DD end of the focused month (last day of month). */
  monthEnd: string;
  /** 35 or 42 cells, in calendar reading order, top-left → bottom-right. */
  cells: MonthGridCell[];
  /** 5 or 6 — derived from the number of rows needed for this month. */
  rows: number;
}

export interface MonthGridCell {
  /** YYYY-MM-DD — stable cell key. */
  ymd: string;
  /** Day-of-month integer (1..31). */
  day: number;
  /** True when this cell falls inside the focused month. */
  inMonth: boolean;
  /** True for the actual local-time "today". */
  isToday: boolean;
}

// ---------------------------------------------------------------------------
// Date helpers — local-time round-tripping without `new Date(string)`.
// ---------------------------------------------------------------------------

export function fmtYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

/**
 * Days remaining from `d` back to the Monday of `d`'s week.
 * Sunday(0) → 6, Monday(1) → 0, Saturday(6) → 5.
 */
function mondayShift(d: Date): number {
  return (d.getDay() + 6) % 7;
}

/**
 * Build the month grid for a given year + 0-indexed month.
 *
 * Today comparison takes a Date so tests can pin it deterministically;
 * production callers can pass `new Date()`.
 */
export function buildMonthGrid(
  year: number,
  month: number,
  today: Date = new Date(),
): MonthGrid {
  const monthStartDate = new Date(year, month, 1);
  // JavaScript Date math: day 0 of (month+1) === last day of `month`.
  const monthEndDate = new Date(year, month + 1, 0);

  // Step 1: back-fill from the 1st to the Monday that starts that week.
  const startShift = mondayShift(monthStartDate);
  const gridStartDate = addDays(monthStartDate, -startShift);

  // Step 2: forward-fill from the last day to the Sunday that ends that week.
  // Sunday-shift: Sunday(0) → 0, Monday(1) → 6, Saturday(6) → 1.
  const endDow = monthEndDate.getDay();
  const endShift = endDow === 0 ? 0 : 7 - endDow;
  const gridEndDate = addDays(monthEndDate, endShift);

  // Total cell count is (gridEnd - gridStart + 1) days; rows = total / 7.
  const totalDays =
    Math.round(
      (gridEndDate.getTime() - gridStartDate.getTime()) / 86_400_000,
    ) + 1;
  const rows = totalDays / 7;

  const todayYmd = fmtYmd(today);
  const cells: MonthGridCell[] = [];
  for (let i = 0; i < totalDays; i++) {
    const date = addDays(gridStartDate, i);
    const ymd = fmtYmd(date);
    cells.push({
      ymd,
      day: date.getDate(),
      inMonth: date.getMonth() === month && date.getFullYear() === year,
      isToday: ymd === todayYmd,
    });
  }

  return {
    year,
    month,
    gridStart: fmtYmd(gridStartDate),
    gridEnd: fmtYmd(gridEndDate),
    monthStart: fmtYmd(monthStartDate),
    monthEnd: fmtYmd(monthEndDate),
    cells,
    rows,
  };
}

/**
 * Parse a `?ym=YYYY-MM` search param into `{year, month}`. Returns null when
 * the input is missing or malformed — callers should fall back to "now".
 */
export function parseYearMonth(
  raw: string | undefined,
): { year: number; month: number } | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{4})-(\d{1,2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1; // 0-indexed
  if (year < 1900 || year > 2100) return null;
  if (month < 0 || month > 11) return null;
  return { year, month };
}

/**
 * Encode `{year, month}` back to `YYYY-MM`. Used to build navigation links
 * that preserve the URL contract.
 */
export function fmtYearMonth(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

/**
 * Step a year/month by `delta` months. Handles negative deltas + year wraps.
 */
export function addMonths(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  // Normalize via a Date — JS handles the wrap correctly when day is fixed at 1.
  const d = new Date(year, month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}
