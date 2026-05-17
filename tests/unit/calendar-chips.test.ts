/**
 * Unit tests for the calendar chip adapter.
 * Bucketing + totals are simple but used in the rendering hot path; lock them.
 */
import { describe, expect, it } from "vitest";
import type { ActivityByDateRow } from "../../src/lib/db/activity";
import type { ActivityId, ActivityType } from "../../src/types/canonical";
import {
  bucketChipsByDate,
  rowToChip,
  totalForMonth,
  totalPnlByDate,
} from "../../src/lib/calendar/chips";

function mkRow(over: Partial<ActivityByDateRow> = {}): ActivityByDateRow {
  return {
    id: ("aabbccdd-1111-2222-3333-444455556666") as ActivityId,
    type: ("spread" as ActivityType),
    name: "BTC cash-and-carry",
    closedDate: "2026-05-15",
    closedAt: "2026-05-15T10:00:00.000Z",
    netPnl: 123.45,
    ...over,
  };
}

describe("rowToChip", () => {
  it("maps spread → letter S, '#XXXX' serial (no prefix letter)", () => {
    const chip = rowToChip(mkRow({ type: "spread" as ActivityType }));
    expect(chip.letter).toBe("S");
    expect(chip.serial).toBe("#AABB");
  });

  it("maps trade → 'T#XXXX'", () => {
    const chip = rowToChip(mkRow({ type: "trade" as ActivityType, netPnl: -50 }));
    expect(chip.letter).toBe("T");
    expect(chip.serial).toBe("T#AABB");
    expect(chip.tone).toBe("down");
  });

  it("maps sale → 'Sa#XXXX'", () => {
    const chip = rowToChip(mkRow({ type: "sale" as ActivityType, netPnl: 0 }));
    expect(chip.letter).toBe("Sa");
    expect(chip.serial).toBe("Sa#AABB");
    expect(chip.tone).toBe("neutral");
  });

  it("maps airdrop → 'A#XXXX'", () => {
    const chip = rowToChip(mkRow({ type: "airdrop" as ActivityType }));
    expect(chip.letter).toBe("A");
    expect(chip.serial).toBe("A#AABB");
  });

  it("builds an href using the type's canonical detail route", () => {
    expect(rowToChip(mkRow({ type: "trade" as ActivityType })).href).toBe(
      "/trades/aabbccdd-1111-2222-3333-444455556666",
    );
  });
});

describe("bucketChipsByDate", () => {
  it("groups rows by closedDate, preserving order", () => {
    const a = mkRow({
      id: "aaaa1111-1111-1111-1111-111111111111" as ActivityId,
      closedDate: "2026-05-15",
    });
    const b = mkRow({
      id: "bbbb2222-2222-2222-2222-222222222222" as ActivityId,
      closedDate: "2026-05-15",
    });
    const c = mkRow({
      id: "cccc3333-3333-3333-3333-333333333333" as ActivityId,
      closedDate: "2026-05-16",
    });
    const m = bucketChipsByDate([a, b, c]);
    expect(m.size).toBe(2);
    expect(m.get("2026-05-15")?.map((x) => x.id)).toEqual([
      "aaaa1111-1111-1111-1111-111111111111",
      "bbbb2222-2222-2222-2222-222222222222",
    ]);
    expect(m.get("2026-05-16")?.[0]?.id).toBe(
      "cccc3333-3333-3333-3333-333333333333",
    );
  });
});

describe("totalPnlByDate", () => {
  it("sums signed P&L per date", () => {
    const rows: ActivityByDateRow[] = [
      mkRow({ closedDate: "2026-05-15", netPnl: 100 }),
      mkRow({ closedDate: "2026-05-15", netPnl: -30 }),
      mkRow({ closedDate: "2026-05-16", netPnl: 200 }),
    ];
    const m = totalPnlByDate(rows);
    expect(m.get("2026-05-15")).toBeCloseTo(70);
    expect(m.get("2026-05-16")).toBeCloseTo(200);
  });
});

describe("totalForMonth", () => {
  it("counts only rows inside the monthStart/monthEnd window", () => {
    const rows: ActivityByDateRow[] = [
      mkRow({ closedDate: "2026-04-30", netPnl: 99 }),    // out
      mkRow({ closedDate: "2026-05-01", netPnl: 100 }),   // in
      mkRow({ closedDate: "2026-05-15", netPnl: -30 }),   // in
      mkRow({ closedDate: "2026-05-31", netPnl: 50 }),    // in
      mkRow({ closedDate: "2026-06-01", netPnl: 999 }),   // out
    ];
    const summary = totalForMonth(rows, "2026-05-01", "2026-05-31");
    expect(summary.total).toBeCloseTo(120);
    expect(summary.count).toBe(3);
  });
});
