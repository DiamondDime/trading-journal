/**
 * Unit tests for the demo spread matcher (src/lib/matcher/spread-matcher.ts).
 *
 * Strategy: build small targeted fixtures rather than relying on the global
 * IMPORTED_FILLS list — keeps each rule's pass/fail isolated and stable when
 * the mock dataset evolves.
 *
 * We also assert against the live `IMPORTED_FILLS` fixture once, to lock in
 * the "all 5 rules fire" promise the picker relies on.
 */
import { describe, it, expect } from 'vitest';
import { matchSpreads } from '@/lib/matcher/spread-matcher';
import { IMPORTED_FILLS, type ImportedTradeFill } from '@/lib/data/exchange-fills-mock';

// Compact fixture builder — only the fields the matcher inspects.
function fill(overrides: Partial<ImportedTradeFill>): ImportedTradeFill {
  return {
    id: 'f-x',
    exchange: 'Binance',
    venueKind: 'cex',
    asset: 'BTC',
    symbol: 'BTC-PERP',
    instrument: 'perp',
    side: 'long',
    qty: 1,
    entryPrice: 60000,
    exitPrice: 62000,
    capital: 60000,
    fees: 10,
    netPnl: 1990,
    openedAt: '2026-05-01T10:00',
    closedAt: '2026-05-02T10:00',
    daysHeld: 1,
    daysLabel: '1d',
    closedLabel: 'May 2',
    tone: 'up',
    ...overrides,
  };
}

describe('matchSpreads — IMPORTED_FILLS fixture', () => {
  // The picker relies on every rule firing at least once on demo data. This
  // single sanity test guards against silent regressions in the rules.
  it('detects at least one suggestion of each spread type from the global fixture', () => {
    const results = matchSpreads(IMPORTED_FILLS);
    const seen = new Set(results.map((r) => r.spreadType));
    // 5 rules in the matcher; cash_carry can be subsumed by DEX-CEX precedence
    // on the SOL pair, so we accept 4 minimum — but the BTC cash-and-carry
    // pair (Binance + Coinbase, both CEX) MUST surface.
    expect(seen.has('cash_carry')).toBe(true);
    expect(seen.has('cross_exchange')).toBe(true);
    expect(seen.has('funding')).toBe(true);
    expect(seen.has('calendar')).toBe(true);
    expect(seen.has('dex_cex')).toBe(true);
  });

  it('returns suggestions sorted by score descending', () => {
    const results = matchSpreads(IMPORTED_FILLS);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });
});

describe('matchSpreads — DEX-CEX precedence (Wave 4 FIX-1)', () => {
  // A SOL spot-long on a CEX paired with a SOL perp-short on a DEX is BOTH a
  // cash-and-carry shape AND a DEX-CEX shape. FIX-1 made cash_carry skip this
  // pair so we only show the DEX-CEX suggestion.
  it('returns dex_cex (not cash_carry) when one leg is DEX and the other is CEX', () => {
    const fills: ImportedTradeFill[] = [
      fill({
        id: 'cb-spot',
        exchange: 'Coinbase',
        venueKind: 'cex',
        asset: 'SOL',
        symbol: 'SOL-USD',
        instrument: 'spot',
        side: 'long',
        qty: 40,
        closedAt: '2026-04-30T22:00',
      }),
      fill({
        id: 'hl-perp',
        exchange: 'Hyperliquid',
        venueKind: 'dex',
        asset: 'SOL',
        symbol: 'SOL-PERP',
        instrument: 'perp',
        side: 'short',
        qty: 40,
        closedAt: '2026-04-30T22:00',
      }),
    ];
    const results = matchSpreads(fills);
    const types = new Set(results.map((r) => r.spreadType));
    expect(types.has('dex_cex')).toBe(true);
    expect(types.has('cash_carry')).toBe(false);
  });
});

describe('matchSpreads — dedup keeps highest score per leg set', () => {
  // A cross-exchange suggestion and an opposite-side same-asset DEX-CEX
  // suggestion both target the same leg set on certain fixtures. The dedup
  // pass keeps the higher-scoring one.
  it('does not return duplicate suggestions for the same leg-id set', () => {
    const results = matchSpreads(IMPORTED_FILLS);
    const keys = results.map((r) =>
      r.legs
        .map((l) => l.id)
        .sort()
        .join('+'),
    );
    const unique = new Set(keys);
    expect(keys.length).toBe(unique.size);
  });
});

describe('matchSpreads — degenerate inputs', () => {
  it('returns an empty array for empty input', () => {
    expect(matchSpreads([])).toEqual([]);
  });

  it('returns an empty array for single-fill input', () => {
    expect(matchSpreads([fill({})])).toEqual([]);
  });

  it('does not match fills with mismatched assets', () => {
    const fills = [
      fill({ id: 'a', asset: 'BTC', side: 'long', exchange: 'Binance' }),
      fill({ id: 'b', asset: 'ETH', side: 'short', exchange: 'Bybit' }),
    ];
    expect(matchSpreads(fills)).toEqual([]);
  });
});

describe('matchSpreads — cross-exchange rule', () => {
  it('matches same-asset perp-long + perp-short on different CEX venues within 4h', () => {
    const fills = [
      fill({
        id: 'bn-l',
        exchange: 'Binance',
        venueKind: 'cex',
        side: 'long',
        closedAt: '2026-05-01T12:00',
      }),
      fill({
        id: 'by-s',
        exchange: 'Bybit',
        venueKind: 'cex',
        side: 'short',
        closedAt: '2026-05-01T12:30',
      }),
    ];
    const results = matchSpreads(fills);
    expect(results.length).toBe(1);
    expect(results[0].spreadType).toBe('cross_exchange');
  });

  it('rejects same-side pairs', () => {
    const fills = [
      fill({ id: 'bn-l', exchange: 'Binance', side: 'long' }),
      fill({ id: 'by-l', exchange: 'Bybit', side: 'long' }),
    ];
    const results = matchSpreads(fills);
    expect(results.find((r) => r.spreadType === 'cross_exchange')).toBeUndefined();
  });

  it('rejects pairs with close-times > 4h apart', () => {
    const fills = [
      fill({ id: 'a', exchange: 'Binance', side: 'long', closedAt: '2026-05-01T00:00' }),
      fill({ id: 'b', exchange: 'Bybit', side: 'short', closedAt: '2026-05-01T10:00' }),
    ];
    const results = matchSpreads(fills);
    expect(results.find((r) => r.spreadType === 'cross_exchange')).toBeUndefined();
  });
});
