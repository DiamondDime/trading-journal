/**
 * Adapter registry smoke tests.
 *
 * Goal: catch wiring regressions (the Binance config not exported, the
 * generic adapter not constructible without credentials, etc.) without
 * hitting the network.
 */
import { describe, expect, it } from 'vitest';
import { getAdapter, isRealAdapter } from '../src/adapters/index.js';
import {
  AdapterAuthError,
  AdapterUnsupportedError,
} from '../src/adapters/base.js';

describe('adapter registry', () => {
  it('returns a real adapter for binance', () => {
    const a = getAdapter('binance');
    expect(a).not.toBeNull();
    expect(a?.exchange).toBe('binance');
    expect(a?.exchangeKind).toBe('cex');
    expect(a?.authMode).toBe('api_key');
    expect(a?.capabilities.supportsPerp).toBe(true);
    expect(a?.capabilities.supportsSpot).toBe(true);
  });

  it('isRealAdapter reports binance', () => {
    expect(isRealAdapter('binance')).toBe(true);
    expect(isRealAdapter('BINANCE')).toBe(true);
    expect(isRealAdapter('bybit')).toBe(false);
  });

  it('throws AdapterUnsupportedError for not-yet-ported venues', () => {
    expect(() => getAdapter('bybit')).toThrow(AdapterUnsupportedError);
    expect(() => getAdapter('hyperliquid')).toThrow(AdapterUnsupportedError);
  });

  it('returns null for unknown exchange codes', () => {
    expect(getAdapter('not-a-real-exchange')).toBeNull();
  });

  it('rejects non-api_key credentials at fetchFills', () => {
    const a = getAdapter('binance');
    expect(a).not.toBeNull();
    expect(() => {
      // Wallet creds against a CEX adapter.
      const iter = a!.fetchFills(
        { mode: 'wallet_address', address: '0xdeadbeef', chain: 'eth' },
        { since: new Date(), until: new Date() },
      );
      // Touch the iterator to trigger the throw.
      void iter;
    }).toThrow(AdapterAuthError);
  });
});
