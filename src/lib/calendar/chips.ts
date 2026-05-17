/**
 * Calendar cell chip — display shape for an activity that closed on a given
 * day. Each chip carries enough to render a one-line badge + summary string,
 * plus the deep-link href for the activity detail page.
 *
 * Shape kept deliberately flat: the server resolves it once, the client
 * doesn't need to know about DB rows, subtype meta, or URL conventions.
 */
import type {
  ActivityByDateRow,
} from "@/lib/db/activity";

export interface CalendarChip {
  /** Stable React key. */
  id: string;
  /** Single- or two-letter type badge ("S", "T", "Sa", "A"). */
  letter: string;
  /** Compact serial like "T#A3F0" — same shape as the archive's makeSerial. */
  serial: string;
  /** Full activity name — used for tooltip lines. */
  name: string;
  /** Signed USD P&L for tooltip / sorting. */
  netPnl: number;
  /** "/spreads/{id}" / "/trades/{id}" / etc. */
  href: string;
  /** Up/down tone for chip color. */
  tone: "up" | "down" | "neutral";
}

const TYPE_LETTERS = {
  spread: "S",
  trade: "T",
  sale: "Sa",
  airdrop: "A",
} as const;

const TYPE_HREF_PREFIX = {
  spread: "/spreads/",
  trade: "/trades/",
  sale: "/sales/",
  airdrop: "/airdrops/",
} as const;

/**
 * Map a row from getActivitiesByDateRange to a chip. The serial mirrors the
 * archive adapter's UUID-prefix synthesis so a single activity reads the same
 * everywhere ("T#A3F0" on the dashboard, archive, calendar).
 */
export function rowToChip(r: ActivityByDateRow): CalendarChip {
  const head = r.id.slice(0, 4).toUpperCase();
  const letter = TYPE_LETTERS[r.type];
  // For spreads we keep the plain "#XXXX" form (no letter prefix) to match the
  // existing archive serial convention. Trades/sales/airdrops get the letter.
  const serial = r.type === "spread" ? `#${head}` : `${letter}#${head}`;
  const tone: CalendarChip["tone"] =
    r.netPnl > 0 ? "up" : r.netPnl < 0 ? "down" : "neutral";
  return {
    id: r.id,
    letter,
    serial,
    name: r.name,
    netPnl: r.netPnl,
    href: `${TYPE_HREF_PREFIX[r.type]}${r.id}`,
    tone,
  };
}

/**
 * Bucket all chips by YYYY-MM-DD. Result is a Map keyed by date with chips
 * preserved in close-time order (already sorted by the DB query).
 */
export function bucketChipsByDate(
  rows: ActivityByDateRow[],
): Map<string, CalendarChip[]> {
  const byDate = new Map<string, CalendarChip[]>();
  for (const r of rows) {
    const chip = rowToChip(r);
    const bucket = byDate.get(r.closedDate);
    if (bucket) {
      bucket.push(chip);
    } else {
      byDate.set(r.closedDate, [chip]);
    }
  }
  return byDate;
}

/**
 * Reduce all rows down to one signed total per day. Used for the per-cell
 * "+$X.XX" subtitle and for the page-level month total in the header.
 */
export function totalPnlByDate(
  rows: ActivityByDateRow[],
): Map<string, number> {
  const byDate = new Map<string, number>();
  for (const r of rows) {
    byDate.set(r.closedDate, (byDate.get(r.closedDate) ?? 0) + r.netPnl);
  }
  return byDate;
}

/**
 * Sum P&L for the rows that fall inside the focused month (inclusive of
 * month-start/end). Out-of-month days from the prev/next month don't count
 * toward the page header total.
 */
export function totalForMonth(
  rows: ActivityByDateRow[],
  monthStart: string,
  monthEnd: string,
): { total: number; count: number } {
  let total = 0;
  let count = 0;
  for (const r of rows) {
    if (r.closedDate >= monthStart && r.closedDate <= monthEnd) {
      total += r.netPnl;
      count += 1;
    }
  }
  return { total, count };
}
