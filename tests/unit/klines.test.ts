/**
 * Unit tests for `src/lib/exchanges/klines.ts`.
 *
 * Focus is the symbol-normalization and interval-selection logic — the parts
 * that, if they regress, make every chart on the detail page render empty
 * silently. The network layer (fetchKlines proper) is intentionally not
 * unit-tested here; an integration test would need real exchange endpoints
 * or a heavy mock, both out of scope for v1.
 */
import { describe, expect, it } from 'vitest';
import {
  binanceCandidates,
  bybitCandidates,
  extractBaseCoin,
  hyperliquidCoin,
  isKlineSupportedExchange,
  selectInterval,
} from '@/lib/exchanges/klines';

describe('extractBaseCoin', () => {
  // The journal stores raw symbols in several shapes — we need to land on
  // the bare base coin regardless of how the user / seed / matcher wrote it.
  it.each<[string, string]>([
    ['BTC-PERP', 'BTC'],
    ['BTC-USDC', 'BTC'],
    ['BTC-USDT', 'BTC'],
    ['BTC-USD', 'BTC'],
    ['BTC/USDT:USDT', 'BTC'],
    ['BTC/USD:BTC', 'BTC'],
    ['BTCUSDT', 'BTC'],
    ['BTCUSDC', 'BTC'],
    ['BTCUSD', 'BTC'],
    ['ETH', 'ETH'],
    ['btc', 'BTC'],
    ['  eth-perp  ', 'ETH'],
    // Mixed-case stays canonical
    ['SoLUSDT', 'SOL'],
    // Empty input is empty out — never throw
    ['', ''],
  ])('extractBaseCoin(%j) → %j', (input, expected) => {
    expect(extractBaseCoin(input)).toBe(expected);
  });

  it('does not strip a trailing 3-char string that isn\'t USD/USDT/USDC', () => {
    // PEPE doesn't end in a quote → returns PEPE
    expect(extractBaseCoin('PEPE')).toBe('PEPE');
    // 1000PEPE is a legitimate base coin on some venues — passthrough
    expect(extractBaseCoin('1000PEPE')).toBe('1000PEPE');
  });
});

describe('binanceCandidates', () => {
  it('returns the usdm perp form first, then spot, both BTCUSDT', () => {
    const cands = binanceCandidates('BTC-PERP');
    expect(cands).toEqual([
      { market: 'usdm', symbol: 'BTCUSDT' },
      { market: 'spot', symbol: 'BTCUSDT' },
    ]);
  });

  it('handles ETH-USDC by collapsing to ETHUSDT (USDT perps are the common case)', () => {
    expect(binanceCandidates('ETH-USDC')).toEqual([
      { market: 'usdm', symbol: 'ETHUSDT' },
      { market: 'spot', symbol: 'ETHUSDT' },
    ]);
  });

  it('returns empty for an unparseable symbol', () => {
    expect(binanceCandidates('')).toEqual([]);
  });
});

describe('bybitCandidates', () => {
  it('returns linear-then-spot, both BTCUSDT', () => {
    const cands = bybitCandidates('BTC-PERP');
    expect(cands).toEqual([
      { market: 'linear', symbol: 'BTCUSDT' },
      { market: 'spot', symbol: 'BTCUSDT' },
    ]);
  });
});

describe('hyperliquidCoin', () => {
  it('strips perp suffix to the bare coin', () => {
    expect(hyperliquidCoin('BTC-PERP')).toBe('BTC');
  });
  it('passes through a bare coin', () => {
    expect(hyperliquidCoin('SOL')).toBe('SOL');
  });
  it('strips ccxt form', () => {
    expect(hyperliquidCoin('BTC/USDC:USDC')).toBe('BTC');
  });
});

describe('isKlineSupportedExchange', () => {
  // The v1 kline registry is binance/bybit/hyperliquid — everything else
  // 404s with UNSUPPORTED. Type-narrowing test ensures the predicate is the
  // single source of truth for "do we know how to fetch this venue?".
  it('accepts the three v1 venues', () => {
    expect(isKlineSupportedExchange('binance')).toBe(true);
    expect(isKlineSupportedExchange('bybit')).toBe(true);
    expect(isKlineSupportedExchange('hyperliquid')).toBe(true);
  });
  it('rejects everything else (deribit, okx, manual sentinels, casing)', () => {
    expect(isKlineSupportedExchange('deribit')).toBe(false);
    expect(isKlineSupportedExchange('okx')).toBe(false);
    expect(isKlineSupportedExchange('kraken')).toBe(false);
    // Case-sensitive on purpose — exchange catalog codes are lower-snake.
    expect(isKlineSupportedExchange('Binance')).toBe(false);
    expect(isKlineSupportedExchange('')).toBe(false);
  });
});

describe('selectInterval', () => {
  // Thresholds mirror worker/csj_worker/excursions.py exactly so the
  // chart's bar boundaries match the MAE/MFE backfill bars.
  const t0 = new Date('2026-01-01T00:00:00Z');

  function plus(days: number): Date {
    return new Date(t0.getTime() + days * 86_400_000);
  }

  it('≤ 1 day → 1m', () => {
    expect(selectInterval(t0, plus(0.5))).toBe('1m');
    expect(selectInterval(t0, plus(1))).toBe('1m');
  });
  it('≤ 7 days → 5m', () => {
    expect(selectInterval(t0, plus(2))).toBe('5m');
    expect(selectInterval(t0, plus(7))).toBe('5m');
  });
  it('≤ 30 days → 15m', () => {
    expect(selectInterval(t0, plus(8))).toBe('15m');
    expect(selectInterval(t0, plus(30))).toBe('15m');
  });
  it('> 30 days → 1h', () => {
    expect(selectInterval(t0, plus(31))).toBe('1h');
    expect(selectInterval(t0, plus(180))).toBe('1h');
  });
});
