/**
 * Unit tests for ccxt trade parsing — the contract-size correction.
 *
 * ccxt's `fetchMyTrades` reports `amount` in CONTRACTS for derivatives, not
 * base-currency units. `parseCcxtTrade` must scale `amount` by the market's
 * `contractSize` to land on base units.
 *
 * Regression guard for the MEXC live-sync bug: OPENAI/USDT:USDT has a
 * contract size of 0.001, so a raw `amount` of 948 contracts is 0.948 base
 * units — a 1000x error if left unscaled, which cascades into realized P&L.
 */
import { describe, expect, it } from 'vitest';
import type { Market as CcxtMarket, Trade as CcxtTrade } from 'ccxt';

import { contractSizeOf, parseCcxtTrade } from '../src/adapters/ccxt-generic.js';
import type { CanonicalInstrument } from '../src/types.js';

const PERP: CanonicalInstrument = {
  exchange: 'mexc',
  kind: 'perp',
  base: 'OPENAI',
  quote: 'USDT',
  expiry: null,
  rawSymbol: 'OPENAI/USDT:USDT',
};

/** Minimal ccxt unified trade. Overridable per case. */
function _trade(over: Record<string, unknown> = {}): CcxtTrade {
  return {
    id: 't1',
    timestamp: Date.UTC(2026, 4, 20, 0, 0, 0),
    side: 'buy',
    takerOrMaker: 'taker',
    amount: 948,
    price: 1377.2,
    cost: 1305.5856,
    order: 'o1',
    fee: { cost: 0.5, currency: 'USDT' },
    ...over,
  } as unknown as CcxtTrade;
}

function _market(over: Record<string, unknown> = {}): Partial<CcxtMarket> {
  return { contract: true, contractSize: 0.001, type: 'swap', ...over };
}

describe('contractSizeOf', () => {
  it('returns the declared contract size for a derivatives market', () => {
    expect(contractSizeOf(_market({ contractSize: 0.001 }))).toBe('0.001');
  });

  it('returns 1 for spot markets', () => {
    expect(contractSizeOf({ contract: false, type: 'spot' })).toBe('1');
  });

  it('returns 1 when the market is null or undefined', () => {
    expect(contractSizeOf(null)).toBe('1');
    expect(contractSizeOf(undefined)).toBe('1');
  });

  it('returns 1 when contractSize is missing on a contract market', () => {
    expect(contractSizeOf({ contract: true })).toBe('1');
  });

  it('returns 1 for a non-positive or non-finite contract size', () => {
    expect(contractSizeOf({ contract: true, contractSize: 0 })).toBe('1');
    expect(contractSizeOf({ contract: true, contractSize: -1 })).toBe('1');
    expect(contractSizeOf({ contract: true, contractSize: NaN })).toBe('1');
  });
});

describe('parseCcxtTrade — contract-size correction', () => {
  it('scales amount by contractSize for a derivatives fill', () => {
    const fill = parseCcxtTrade(_trade(), PERP, _market({ contractSize: 0.001 }));
    // 948 contracts * 0.001 = 0.948 base units — exact, no float noise.
    expect(fill.qty).toBe('0.948');
    // notional comes straight from ccxt `cost` — already contract-aware.
    expect(fill.notional).toBe('1305.5856');
  });

  it('leaves amount untouched when contractSize is 1', () => {
    const fill = parseCcxtTrade(
      _trade({ amount: 5 }),
      PERP,
      _market({ contractSize: 1 }),
    );
    expect(fill.qty).toBe('5');
  });

  it('leaves amount untouched for a spot fill', () => {
    const fill = parseCcxtTrade(
      _trade({ amount: 5 }),
      { ...PERP, kind: 'spot', rawSymbol: 'OPENAI/USDT' },
      { contract: false, type: 'spot' },
    );
    expect(fill.qty).toBe('5');
  });

  it('falls back to qty*price for notional when cost is absent', () => {
    const fill = parseCcxtTrade(
      _trade({ amount: 1000, cost: undefined, price: 2 }),
      PERP,
      _market({ contractSize: 0.001 }),
    );
    // qty = 1000 * 0.001 = 1; notional = 1 * 2 = 2
    expect(fill.qty).toBe('1');
    expect(fill.notional).toBe('2');
  });
});
