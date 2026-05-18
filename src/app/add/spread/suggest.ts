/**
 * Wizard-local heuristic that infers a spread type + variant from a user-
 * picked subset of positions.
 *
 * Used by `/add/spread/type` when the user lands with `?legs=...` from
 * `/trades` multi-select. The auto-matcher (worker side) runs much richer
 * logic; this is the lightweight, deterministic cousin meant to surface a
 * sensible default so the user can confirm-and-continue rather than read
 * every card.
 *
 * Pure function — no I/O. Easy to unit test.
 */
export interface SuggestLeg {
  symbol: string;
  exchangeCode: string;
  instrumentKind: string;
  side: 'long' | 'short';
}

export interface SpreadSuggestion {
  spreadType: string;
  variantCanonical?: string;
}

/**
 * Normalise a symbol down to its root asset for grouping. Examples:
 *   "BTC-PERP"     → "BTC"
 *   "ETH/USDT"     → "ETH"
 *   "BTC-26DEC25"  → "BTC"
 */
function symbolRoot(symbol: string): string {
  const parts = symbol.split(/[-/]/);
  return (parts[0] ?? symbol).toUpperCase();
}

export function suggestFromLegs(legs: SuggestLeg[]): SpreadSuggestion | null {
  if (legs.length < 2) return null;

  // Require all legs to share the same underlying asset root. The wizard
  // shouldn't auto-suggest a "BTC + ETH" spread shape since those rarely
  // hedge each other.
  const root0 = symbolRoot(legs[0].symbol);
  const sameRoot = legs.every((l) => symbolRoot(l.symbol) === root0);
  if (!sameRoot) return null;

  // Need both directions represented for any spread shape to make sense.
  const hasLong = legs.some((l) => l.side === 'long');
  const hasShort = legs.some((l) => l.side === 'short');
  if (!hasLong || !hasShort) return null;

  const exchanges = new Set(legs.map((l) => l.exchangeCode));
  const kinds = new Set(legs.map((l) => l.instrumentKind));
  const sameVenue = exchanges.size === 1;
  const allPerp = kinds.size === 1 && kinds.has('perp');
  const hasSpot = kinds.has('spot');
  const hasPerp = kinds.has('perp');
  const hasDatedFuture = kinds.has('dated_future');

  // Rule order matters: more specific patterns win. We fan out the
  // funding-based shapes first since they're the most common spread
  // structure on the platform.
  if (allPerp && sameVenue) {
    return { spreadType: 'funding', variantCanonical: 'same_venue' };
  }
  if (allPerp && !sameVenue) {
    return { spreadType: 'funding', variantCanonical: 'cross_venue' };
  }
  if (hasSpot && hasPerp && !hasDatedFuture) {
    return { spreadType: 'cash_carry', variantCanonical: 'funding' };
  }
  if (hasSpot && hasDatedFuture) {
    return { spreadType: 'cash_carry', variantCanonical: 'basis' };
  }
  if (kinds.size === 1 && hasDatedFuture && sameVenue) {
    return { spreadType: 'calendar' };
  }
  if (!sameVenue) {
    return { spreadType: 'cross_exchange' };
  }
  return null;
}
