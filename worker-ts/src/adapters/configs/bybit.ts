/**
 * Bybit v5 — universal-adapter config (TS port of
 * `worker/csj_worker/adapters/configs/bybit.py`).
 *
 * Permission check
 * ----------------
 * Bybit v5 exposes `GET /v5/user/query-api`, which returns the key's
 * `readOnly` flag and a per-scope `permissions` object:
 *
 *   - `readOnly === 1`  → the key cannot trade.
 *   - `permissions.Wallet` contains `"Withdraw"` → destructive; reject
 *     regardless of `readOnly` (Bybit conflates "wallet read" with
 *     withdraw enablement on some account tiers).
 *
 * ccxt exposes the call via the implicit-API passthrough
 * `privateGetV5UserQueryApi`. So — unlike MEXC — `connect()` can verify a
 * Bybit key really is read-only and reject it otherwise.
 *
 * Market types
 * ------------
 * Bybit v5 keys every request on `category` (linear / inverse / spot),
 * not `defaultType`. ccxt's `bybit` class accepts `defaultType` and maps
 * `'swap'` → linear, `'spot'` → spot. v1 iterates `('swap', 'spot')`.
 */
import { defineVenueConfig, type VenueConfig } from '../venue-config.js';

/**
 * Call `/v5/user/query-api` and return the `result` sub-object.
 *
 * Bybit envelope: `{ retCode, retMsg, result: {...}, time }`. A non-zero
 * `retCode` means the call failed — throw a generic error so the adapter's
 * `mapCcxtError` classifies it.
 */
async function fetchPermissions(
  client: unknown,
): Promise<Record<string, unknown>> {
  const c = client as {
    privateGetV5UserQueryApi: (
      params: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>;
  };
  const response = await c.privateGetV5UserQueryApi({});
  const retCode = Number(response.retCode ?? -1);
  if (retCode !== 0) {
    throw new Error(
      `Bybit /v5/user/query-api retCode=${retCode}: ${String(
        response.retMsg ?? '',
      )}`,
    );
  }
  const result = response.result;
  return result !== null && typeof result === 'object'
    ? (result as Record<string, unknown>)
    : {};
}

/** Either non-read-only OR an explicit Wallet:Withdraw scope → reject. */
function hasWithdraw(info: Record<string, unknown>): boolean {
  if (Number(info.readOnly ?? 0) !== 1) return true;
  const perms = (info.permissions ?? {}) as Record<string, unknown>;
  const wallet = perms.Wallet;
  return Array.isArray(wallet) && wallet.includes('Withdraw');
}

/** Flatten the per-scope permissions map to `"<scope>:<perm>"` strings. */
function extractPermissions(info: Record<string, unknown>): string[] {
  const out: string[] = [];
  const perms = (info.permissions ?? {}) as Record<string, unknown>;
  for (const [scope, list] of Object.entries(perms)) {
    if (!Array.isArray(list)) continue;
    for (const perm of list) {
      if (perm === 'Withdraw') continue; // surfaced only via rejection
      out.push(`${scope}:${String(perm)}`);
    }
  }
  return out;
}

export const BYBIT_CONFIG: VenueConfig = defineVenueConfig({
  code: 'bybit',
  ccxtId: 'bybit',
  ccxtOptions: { options: { defaultType: 'swap', recvWindow: 5000 } },
  requiresPassphrase: false,
  supportsSpot: true,
  supportsPerp: true,
  supportsDatedFutures: false,
  supportsOptions: true,
  supportsFundingHistory: true,
  supportsOpenPositions: true,
  supportsKlines: true,
  maxLookbackDays: 730,
  pageSize: 100,
  marketTypes: ['swap', 'spot'],
  fundingMarketTypes: ['swap'],
  fetchPermissions,
  hasWithdrawPermission: hasWithdraw,
  extractPermissions,
  rateLimitRps: 10.0,
  rateLimitBurst: 20,
  rateLimitCooloffSeconds: 30,
  apiDocsUrl: 'https://bybit-exchange.github.io/docs/v5/intro',
  notes:
    "Bybit v5 splits derivatives into 'linear' (USDT-margined perp) and " +
    "'inverse' (coin-margined). ccxt maps defaultType='swap' to linear; " +
    'v1 covers linear + spot. Inverse perps are out of scope for the TS worker.',
});
