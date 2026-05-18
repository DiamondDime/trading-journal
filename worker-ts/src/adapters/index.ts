/**
 * Adapter registry + factory. TS mirror of
 * `worker/csj_worker/adapters/__init__.py`.
 *
 * Adding a new exchange
 * ---------------------
 *  1. Drop a `VenueConfig` module in `./configs/<code>.ts`.
 *  2. Register it in `ALL_CONFIGS` below.
 *  3. Add the catalog row in `supabase/migrations/...exchange_catalog...`.
 *
 * For now we only ship a real Binance adapter end-to-end. The rest are
 * stubs that throw `AdapterUnsupportedError('not yet ported')` so the
 * daemon skips them gracefully.
 */
import { CcxtGenericAdapter } from './ccxt-generic.js';
import { BINANCE_CONFIG } from './configs/binance.js';
import type { ExchangeAdapter } from './base.js';
import { AdapterUnsupportedError } from './base.js';
import type { Exchange } from '../types.js';
import type { VenueConfig } from './venue-config.js';

const ALL_CONFIGS: Partial<Record<Exchange, VenueConfig>> = {
  binance: BINANCE_CONFIG,
  // bybit / okx / bitget / kucoin / phemex / mexc / bingx / htx / gate:
  // TODO — port from worker/csj_worker/adapters/configs/.
};

/** Codes for which we have a real config wired up. */
const REAL_ADAPTERS = new Set(Object.keys(ALL_CONFIGS));

/**
 * Adapters not yet ported. The factory throws if asked to construct one,
 * letting the daemon log + skip the connection.
 */
const STUB_ADAPTERS: Exchange[] = [
  'bybit',
  'hyperliquid',
  'okx',
  'deribit',
  'okx_dex',
  'aster',
  'phemex',
  'bitget',
  'mexc',
  'kucoin',
  'kraken',
  'gate',
  'bingx',
  'htx',
];

/**
 * Return a configured adapter for the given exchange code, or `null` when
 * not registered. Mirrors the Python "skip if unsupported" semantics.
 */
export function getAdapter(exchangeCode: string): ExchangeAdapter | null {
  const code = exchangeCode.toLowerCase() as Exchange;
  const cfg = ALL_CONFIGS[code];
  if (cfg) return new CcxtGenericAdapter(cfg);
  if (STUB_ADAPTERS.includes(code)) {
    throw new AdapterUnsupportedError(
      `Adapter for ${code} is not yet ported to TypeScript`,
    );
  }
  return null;
}

export function isRealAdapter(exchangeCode: string): boolean {
  return REAL_ADAPTERS.has(exchangeCode.toLowerCase());
}

export { CcxtGenericAdapter };
export * from './base.js';
