/**
 * Adapter registry smoke tests.
 *
 * Goal: catch wiring regressions (a config not exported, the generic
 * adapter not constructible without credentials, a venue still stubbed)
 * without hitting the network.
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

  it('returns a real adapter for bybit', () => {
    const a = getAdapter('bybit');
    expect(a).not.toBeNull();
    expect(a?.exchange).toBe('bybit');
    expect(a?.exchangeKind).toBe('cex');
    expect(a?.authMode).toBe('api_key');
    expect(a?.capabilities.supportsPerp).toBe(true);
    expect(a?.capabilities.supportsSpot).toBe(true);
    expect(a?.capabilities.supportsFundingHistory).toBe(true);
  });

  it('returns a real adapter for mexc', () => {
    const a = getAdapter('mexc');
    expect(a).not.toBeNull();
    expect(a?.exchange).toBe('mexc');
    expect(a?.exchangeKind).toBe('cex');
    expect(a?.authMode).toBe('api_key');
    expect(a?.capabilities.supportsPerp).toBe(true);
    expect(a?.capabilities.supportsSpot).toBe(true);
  });

  it('is case-insensitive on the exchange code', () => {
    expect(getAdapter('BYBIT')?.exchange).toBe('bybit');
    expect(getAdapter('Mexc')?.exchange).toBe('mexc');
  });

  it('isRealAdapter reports ported venues, not stubs', () => {
    expect(isRealAdapter('binance')).toBe(true);
    expect(isRealAdapter('BINANCE')).toBe(true);
    expect(isRealAdapter('bybit')).toBe(true);
    expect(isRealAdapter('mexc')).toBe(true);
    expect(isRealAdapter('okx')).toBe(false);
  });

  it('throws AdapterUnsupportedError for not-yet-ported venues', () => {
    expect(() => getAdapter('okx')).toThrow(AdapterUnsupportedError);
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
