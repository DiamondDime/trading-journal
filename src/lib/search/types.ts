/**
 * Client-safe search result type + href mapper. No DB imports — usable from
 * both server components (DB-backed searches) and client components (the
 * ⌘K palette).
 *
 * The DB helper at `src/lib/db/search.ts` re-exports these so server callers
 * keep their existing import paths working.
 */
import type {
  ActivityId,
  ActivityStatus,
  ActivityType,
  Decimal,
  HeadlineFormat,
  HeadlineKind,
  Iso8601,
} from '@/types/canonical';

export interface SearchResultItem {
  id: ActivityId;
  type: ActivityType;
  /** Alias of `type` — convenience for clients grouping by activity kind. */
  kind: ActivityType;
  /** activity.name */
  title: string;
  /** card_subtitle from the view (e.g. "cash_carry", "Binance · perp"). */
  subtitle: string | null;
  status: ActivityStatus;
  /** primary_symbol from the view (BTC, ETH, ticker, …). */
  primarySymbol: string | null;
  openedAt: Iso8601 | null;
  headlineValue: Decimal | null;
  headlineFormat: HeadlineFormat;
  headlineKind: HeadlineKind;
  /** 1=name/symbol/title, 2=card/strategy, 3=tag, 4=note. */
  matchRank: 1 | 2 | 3 | 4;
}

export function searchHrefFor(type: ActivityType, id: ActivityId): string {
  switch (type) {
    case 'spread':         return `/spreads/${id}`;
    case 'trade':          return `/trades/${id}`;
    case 'sale':           return `/sales/${id}`;
    case 'airdrop':        return `/airdrops/${id}`;
    case 'yield_position': return `/yield-positions/${id}`;
    case 'option':         return `/options/${id}`;
  }
}
