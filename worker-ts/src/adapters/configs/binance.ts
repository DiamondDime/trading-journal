/**
 * Binance — universal-adapter config (TS port).
 *
 * Permission check
 * ----------------
 * Binance's spot REST API returns the canWithdraw / canTrade / canDeposit
 * flags directly in the `GET /api/v3/account` response (which ccxt's
 * `fetchBalance()` on the spot sub-client wraps). We probe that and reject
 * the key if `canWithdraw` is true.
 *
 * Market types
 * ------------
 * - `spot` — SPOT pairs
 * - `swap` — USD-M perpetuals
 * - `future` — coin-margined perps + dated coin-margined futures (not in v1)
 *
 * v1 iterates `('swap', 'spot')` — covers the vast majority of spread / arb
 * flow without coin-M.
 */
import { defineVenueConfig, type VenueConfig } from '../venue-config.js';

async function fetchPermissions(client: unknown): Promise<Record<string, unknown>> {
  const balance = (await (client as { fetchBalance: () => Promise<unknown> }).fetchBalance()) as
    | { info?: Record<string, unknown> }
    | undefined;
  return balance && typeof balance === 'object' && balance.info ? balance.info : {};
}

function hasWithdraw(info: Record<string, unknown>): boolean {
  return Boolean(info.canWithdraw);
}

function extractPermissions(info: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (info.canTrade) out.push('canTrade');
  if (info.canDeposit) out.push('canDeposit');
  // canWithdraw is intentionally excluded — it triggers rejection.
  return out;
}

export const BINANCE_CONFIG: VenueConfig = defineVenueConfig({
  code: 'binance',
  ccxtId: 'binance',
  ccxtOptions: { options: { defaultType: 'spot' } },
  requiresPassphrase: false,
  supportsSpot: true,
  supportsPerp: true,
  supportsDatedFutures: true,
  supportsOptions: false,
  supportsFundingHistory: true,
  supportsOpenPositions: true,
  supportsKlines: true,
  maxLookbackDays: 90,
  pageSize: 1000,
  marketTypes: ['swap', 'spot'],
  fundingMarketTypes: ['swap'],
  fetchPermissions,
  hasWithdrawPermission: hasWithdraw,
  extractPermissions,
  rateLimitRps: 10.0,
  rateLimitBurst: 20,
  rateLimitCooloffSeconds: 60,
  apiDocsUrl: 'https://developers.binance.com/docs/',
  notes:
    "ccxt uses 'binance' for spot, 'binanceusdm' for USD-M futures and " +
    "'binancecoinm' for coin-margined. The generic adapter switches " +
    'defaultType per market_types iteration — same ccxt class, different options.',
});
