/**
 * MEXC — universal-adapter config (TS port of
 * `worker/csj_worker/adapters/configs/mexc.py`).
 *
 * Permission check
 * ----------------
 * MEXC exposes NO API-key-permission endpoint — withdraw scope cannot be
 * introspected without attempting a (destructive) withdraw. So, unlike
 * Bybit, `connect()` cannot reject a withdraw-capable MEXC key; it only
 * probes Read access via `fetchBalance` and surfaces `withdraw:unverified`
 * so the UI can require the user to attest the key is read-only.
 *
 * This is conservative-by-disclosure: the framework never silently passes
 * a destructive key, but it also cannot block one. The hard safety
 * guarantee is structural — `CcxtGenericAdapter` only ever calls read
 * methods (fetchMyTrades / fetchBalance / fetchFundingHistory /
 * fetchPositions / fetchOHLCV); it contains no trade or withdraw call.
 *
 * Market types
 * ------------
 * MEXC's ccxt class uses `defaultType` ('swap' | 'spot'). v1 iterates
 * `('swap', 'spot')`.
 */
import { defineVenueConfig, type VenueConfig } from '../venue-config.js';

/**
 * Probe Read access. A successful `fetchBalance` proves the key is valid
 * and can read — withdraw scope stays `unverified` (not introspectable).
 */
async function fetchPermissions(
  client: unknown,
): Promise<Record<string, unknown>> {
  const balance = (await (
    client as { fetchBalance: () => Promise<unknown> }
  ).fetchBalance()) as { info?: Record<string, unknown> } | undefined;
  const rawInfo =
    balance && typeof balance === 'object' && balance.info ? balance.info : {};
  return { verifiedRead: true, withdrawStatus: 'unverified', rawInfo };
}

/**
 * MEXC withdraw scope is not introspectable, so never auto-reject — the UI
 * enforces attestation via the `withdraw:unverified` permission string.
 */
function hasWithdraw(_info: Record<string, unknown>): boolean {
  return false;
}

function extractPermissions(_info: Record<string, unknown>): string[] {
  return ['read', 'withdraw:unverified'];
}

export const MEXC_CONFIG: VenueConfig = defineVenueConfig({
  code: 'mexc',
  ccxtId: 'mexc',
  ccxtOptions: { options: { defaultType: 'swap' } },
  requiresPassphrase: false,
  supportsSpot: true,
  supportsPerp: true,
  supportsDatedFutures: false,
  supportsOptions: false,
  supportsFundingHistory: true,
  supportsOpenPositions: true,
  supportsKlines: true,
  maxLookbackDays: 30,
  pageSize: 1000,
  marketTypes: ['swap', 'spot'],
  fundingMarketTypes: ['swap'],
  fetchPermissions,
  hasWithdrawPermission: hasWithdraw,
  extractPermissions,
  rateLimitRps: 5.0,
  rateLimitBurst: 10,
  rateLimitCooloffSeconds: 30,
  apiDocsUrl: 'https://mexcdevelop.github.io/apidocs/',
  notes:
    'MEXC has no permissions endpoint. The framework cannot verify ' +
    'withdraw status — the user must create a read-only key, and the UI ' +
    "displays 'withdraw:unverified' to enforce attestation.",
});
