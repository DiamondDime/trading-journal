/**
 * Pure unit tests for the calendar month-grid math.
 *
 * Why these exist: month-grid generation has a few sharp edges (the
 * Monday-shift table, the 5-vs-6-row decision, year wraps in addMonths)
 * and the page-level behavior depends on this being exactly right.
 */
import { describe, expect, it } from "vitest";
import {
  addMonths,
  buildMonthGrid,
  fmtYearMonth,
  parseYearMonth,
} from "../../src/lib/calendar/month-grid";

describe("buildMonthGrid — focused month boundary handling", () => {
  it("returns 5 rows for May 2026 (1st = Friday, 31 days)", () => {
    // May 1 2026 = Friday (dow=5). Monday-shift = 4 → grid starts April 27 Mon.
    // 31 days from May 1 → May 31 = Sunday. End-shift = 0. Grid ends May 31.
    // 35 days / 7 = 5 rows.
    const today = new Date(2026, 4, 17); // arbitrary "today" inside the month
    const grid = buildMonthGrid(2026, 4, today);
    expect(grid.rows).toBe(5);
    expect(grid.gridStart).toBe("2026-04-27");
    expect(grid.gridEnd).toBe("2026-05-31");
    expect(grid.cells).toHaveLength(35);
    expect(grid.monthStart).toBe("2026-05-01");
    expect(grid.monthEnd).toBe("2026-05-31");
  });

  it("returns 6 rows when a 31-day month starts on a Friday and bleeds into next month", () => {
    // October 2026: Oct 1 = Thu (dow=4). Shift = 3 → Sep 28 Mon.
    // 31 days from Oct 1 → Oct 31 = Sat. End-shift = 1 → grid ends Nov 1 Sun.
    // 35 days. That's 5 rows.
    //
    // For a true 6-row case: Jan 2026.
    // Jan 1 2026 = Thursday → shift = 3 → grid starts Dec 29 2025 Mon.
    // Jan 31 = Saturday → end-shift = 1 → grid ends Feb 1 2026 Sun.
    // 35 days = 5 rows. Hmm.
    //
    // True 6-row month: must start on Friday/Saturday AND have 30+ days, OR
    // start on Sunday AND have 31 days. May 2026 (Fri + 31): already shown
    // above is 5 rows. The discrepancy is because Monday-first weeks shift
    // the calculation. Let's find a known 6-row: October 2027.
    // Oct 1 2027 = Friday. Shift = 4 → Sep 27 Mon. 31 days → Oct 31 = Sunday.
    // End-shift = 0. 4 + 31 = 35 days = 5 rows. Still 5.
    //
    // Try August 2026: Aug 1 = Sat. Shift = 5 → Jul 27 Mon. Aug 31 = Mon.
    // End-shift = 6 → ends Sep 6 Sun. 5 + 31 + 6 = 42 = 6 rows. ✓
    const today = new Date(2026, 7, 15);
    const grid = buildMonthGrid(2026, 7, today); // August 2026
    expect(grid.rows).toBe(6);
    expect(grid.gridStart).toBe("2026-07-27");
    expect(grid.gridEnd).toBe("2026-09-06");
    expect(grid.cells).toHaveLength(42);
  });

  it("marks today's cell with isToday=true", () => {
    const today = new Date(2026, 4, 17); // May 17 2026
    const grid = buildMonthGrid(2026, 4, today);
    const todayCell = grid.cells.find((c) => c.ymd === "2026-05-17");
    expect(todayCell?.isToday).toBe(true);
    // Sibling cells should not be marked.
    expect(grid.cells.filter((c) => c.isToday)).toHaveLength(1);
  });

  it("marks out-of-month cells with inMonth=false", () => {
    const today = new Date(2026, 4, 17);
    const grid = buildMonthGrid(2026, 4, today);
    const aprilCells = grid.cells.filter((c) => c.ymd.startsWith("2026-04"));
    const mayCells = grid.cells.filter((c) => c.ymd.startsWith("2026-05"));
    aprilCells.forEach((c) => expect(c.inMonth).toBe(false));
    mayCells.forEach((c) => expect(c.inMonth).toBe(true));
  });

  it("handles a month that starts on Monday (no leading spill)", () => {
    // June 2026: Jun 1 = Mon. Shift = 0 → grid starts Jun 1.
    // Jun 30 = Tue. End-shift = 5 → grid ends Jul 5 Sun.
    // 30 + 5 = 35 days = 5 rows.
    const today = new Date(2026, 5, 1);
    const grid = buildMonthGrid(2026, 5, today);
    expect(grid.gridStart).toBe("2026-06-01");
    expect(grid.gridEnd).toBe("2026-07-05");
    expect(grid.cells[0].ymd).toBe("2026-06-01");
    expect(grid.cells[0].inMonth).toBe(true);
  });

  it("handles a month that ends on Sunday (no trailing spill)", () => {
    // May 2026: May 31 = Sunday. End-shift = 0. Last cell IS May 31.
    const today = new Date(2026, 4, 1);
    const grid = buildMonthGrid(2026, 4, today);
    expect(grid.cells[grid.cells.length - 1].ymd).toBe("2026-05-31");
    expect(grid.cells[grid.cells.length - 1].inMonth).toBe(true);
  });
});

describe("addMonths — wrap behavior", () => {
  it("steps forward across a year boundary", () => {
    expect(addMonths(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
  });

  it("steps backward across a year boundary", () => {
    expect(addMonths(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
  });

  it("handles multi-month jumps", () => {
    expect(addMonths(2026, 5, 7)).toEqual({ year: 2027, month: 0 });
    expect(addMonths(2026, 2, -5)).toEqual({ year: 2025, month: 9 });
  });
});

describe("parseYearMonth / fmtYearMonth — URL round-trips", () => {
  it("parses YYYY-MM strings", () => {
    expect(parseYearMonth("2026-05")).toEqual({ year: 2026, month: 4 });
    expect(parseYearMonth("2026-12")).toEqual({ year: 2026, month: 11 });
    expect(parseYearMonth("2026-1")).toEqual({ year: 2026, month: 0 });
  });

  it("rejects malformed strings", () => {
    expect(parseYearMonth("")).toBeNull();
    expect(parseYearMonth(undefined)).toBeNull();
    expect(parseYearMonth("2026")).toBeNull();
    expect(parseYearMonth("2026-13")).toBeNull();
    expect(parseYearMonth("2026-0")).toBeNull();
    expect(parseYearMonth("abc-def")).toBeNull();
    expect(parseYearMonth("999-05")).toBeNull(); // year too small
  });

  it("formats back to canonical YYYY-MM with zero-padded month", () => {
    expect(fmtYearMonth(2026, 0)).toBe("2026-01");
    expect(fmtYearMonth(2026, 4)).toBe("2026-05");
    expect(fmtYearMonth(2026, 11)).toBe("2026-12");
  });

  it("round-trips through parse → format", () => {
    const samples = ["2024-01", "2026-05", "2030-12"];
    for (const ym of samples) {
      const parsed = parseYearMonth(ym);
      expect(parsed).not.toBeNull();
      expect(fmtYearMonth(parsed!.year, parsed!.month)).toBe(ym);
    }
  });
});
