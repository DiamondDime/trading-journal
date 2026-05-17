import type { Metadata } from "next";
import { CalendarView } from "@/components/calendar/calendar-view";
import { requireUser } from "@/lib/auth/server";
import {
  buildMonthGrid,
  fmtYearMonth,
  parseYearMonth,
} from "@/lib/calendar/month-grid";
import {
  bucketChipsByDate,
  totalForMonth,
  totalPnlByDate,
} from "@/lib/calendar/chips";
import {
  getActivitiesByDateRange,
  getTotals,
} from "@/lib/db/activity";
import { getT } from "@/lib/i18n/server";

/**
 * Full-page month-view calendar.
 *
 * URL contract:
 *   ?ym=YYYY-MM   — focused month. Defaults to the server's "now".
 *
 * Data flow:
 *   1. Parse `ym` → year/month, fall back to today.
 *   2. Build the calendar grid (Monday-first, 5/6 rows × 7 cols).
 *   3. Fetch `getActivitiesByDateRange` for the grid window (not just the
 *      focused month — out-of-month days still need to render chips so the
 *      user sees activity that spills into the visible cells).
 *   4. Bucket rows into chips-by-date and totals-by-date Maps for O(1)
 *      lookup in the cell renderer.
 *   5. Hand everything to <CalendarView>, which owns navigation + click.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: `${t("calendar.title")} · ${t("app.name")}`,
    description: t("calendar.subtitle"),
  };
}

interface CalendarPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CalendarPage({ searchParams }: CalendarPageProps) {
  const { id: userId } = await requireUser();
  const rawSearchParams = await searchParams;

  // 1. Resolve focused month from ?ym=YYYY-MM, fall back to today.
  const ymRaw = pickFirst(rawSearchParams.ym);
  const parsed = parseYearMonth(ymRaw);
  const today = new Date();
  const year = parsed?.year ?? today.getFullYear();
  const month = parsed?.month ?? today.getMonth();

  // 2. Build the visible grid window.
  const grid = buildMonthGrid(year, month, today);

  // 3. Fetch the activities that fall inside the grid window. Cross-month
  //    spillover days from the previous / next month are still part of the
  //    visible grid; they render dimmed but we want their chips available
  //    (the user might recall "I closed something the Monday of the last
  //    week of April" and the calendar should reflect that even when
  //    focused on May).
  //
  //    `getTotals` gives us the first-close anchor for the empty-state
  //    banner — single cheap aggregate read.
  const [activitiesInWindow, totals] = await Promise.all([
    getActivitiesByDateRange(userId, grid.gridStart, grid.gridEnd),
    getTotals(userId),
  ]);

  // 4. Bucket into the two Maps the view needs.
  const chipsByDate = bucketChipsByDate(activitiesInWindow);
  const totalsByDate = totalPnlByDate(activitiesInWindow);

  // Header total — only the focused month's days count (out-of-month cells
  // don't add to the month total, by design).
  const monthSummary = totalForMonth(
    activitiesInWindow,
    grid.monthStart,
    grid.monthEnd,
  );

  // Year-picker options — bound the picker to a sensible range around the
  // user's first activity (oldest) and one year past today.
  const yearOptions = buildYearOptions(totals.firstClose, today);
  const todayYm = fmtYearMonth(today.getFullYear(), today.getMonth());

  return (
    <CalendarView
      grid={grid}
      chipsByDate={chipsByDate}
      totalsByDate={totalsByDate}
      yearOptions={yearOptions}
      todayYm={todayYm}
      monthSummary={monthSummary}
    />
  );
}

function pickFirst(
  param: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(param)) return param[0];
  return param;
}

/**
 * Year-picker options. Lower bound: the year of the user's first close (or 5
 * years back if no activity yet). Upper bound: one year past today.
 */
function buildYearOptions(
  firstClose: string | null,
  today: Date,
): number[] {
  const lower = firstClose
    ? new Date(firstClose).getFullYear()
    : today.getFullYear() - 5;
  const upper = today.getFullYear() + 1;
  const out: number[] = [];
  for (let y = upper; y >= lower; y--) out.push(y);
  return out;
}
