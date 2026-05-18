/**
 * `VenueConfig` — per-exchange config consumed by `CcxtGenericAdapter`.
 *
 * Mirror of `worker/csj_worker/adapters/configs/_base.py`. Adding a new
 * exchange = one config module + one registry entry; the universal adapter
 * handles the heavy lifting via ccxt.
 *
 * `VenueConfig` instances are intentionally frozen (`Object.freeze`) so a
 * test that mutates a shared config can't leak into another test.
 */
import type { Exchange as ExchangeCode } from '../types.js';

/** Opaque dict shape returned by a venue's permissions endpoint. */
export type PermissionInfo = Record<string, unknown>;

/** Coroutine: ccxt client → opaque permissions dict. */
export type PermissionFetcher = (client: unknown) => Promise<PermissionInfo>;

/** Pure function: permissions dict → does this key have withdraw scope? */
export type WithdrawCheck = (perms: PermissionInfo) => boolean;

/** Pure function: permissions dict → list of granted permission strings. */
export type PermissionExtractor = (perms: PermissionInfo) => string[];

/**
 * Per-venue config. Mirror of Python `VenueConfig`.
 */
export interface VenueConfig {
  /** Canonical exchange code (matches `exchange_catalog.code`). */
  readonly code: ExchangeCode;

  /** ccxt module attribute name. Usually equals `code`. */
  readonly ccxtId: string;

  /** Passed verbatim to the ccxt constructor (after credentials are merged). */
  readonly ccxtOptions: Record<string, unknown>;

  /** Whether a third secret (passphrase) is required for auth. */
  readonly requiresPassphrase: boolean;

  // Capability flags
  readonly supportsSpot: boolean;
  readonly supportsPerp: boolean;
  readonly supportsDatedFutures: boolean;
  readonly supportsOptions: boolean;
  readonly supportsFundingHistory: boolean;
  readonly supportsOpenPositions: boolean;
  readonly supportsKlines: boolean;
  readonly supportsFetchMyTrades: boolean;

  readonly maxLookbackDays: number;
  readonly pageSize: number;

  /** ccxt market types to iterate when fetching fills. */
  readonly marketTypes: readonly string[];

  /** Optional override for funding-history market types. */
  readonly fundingMarketTypes: readonly string[] | null;

  // Permission check
  readonly fetchPermissions: PermissionFetcher | null;
  readonly hasWithdrawPermission: WithdrawCheck;
  readonly extractPermissions: PermissionExtractor;

  // Rate limiting
  readonly rateLimitRps: number;
  readonly rateLimitBurst: number;
  readonly rateLimitCooloffSeconds: number;

  readonly apiDocsUrl: string;
  readonly notes: string;
}

export interface VenueConfigInput {
  code: ExchangeCode;
  ccxtId?: string;
  ccxtOptions?: Record<string, unknown>;
  requiresPassphrase?: boolean;
  supportsSpot?: boolean;
  supportsPerp?: boolean;
  supportsDatedFutures?: boolean;
  supportsOptions?: boolean;
  supportsFundingHistory?: boolean;
  supportsOpenPositions?: boolean;
  supportsKlines?: boolean;
  supportsFetchMyTrades?: boolean;
  maxLookbackDays?: number;
  pageSize?: number;
  marketTypes?: readonly string[];
  fundingMarketTypes?: readonly string[] | null;
  fetchPermissions?: PermissionFetcher | null;
  hasWithdrawPermission?: WithdrawCheck;
  extractPermissions?: PermissionExtractor;
  rateLimitRps?: number;
  rateLimitBurst?: number;
  rateLimitCooloffSeconds?: number;
  apiDocsUrl?: string;
  notes?: string;
}

export function defineVenueConfig(input: VenueConfigInput): VenueConfig {
  const cfg: VenueConfig = {
    code: input.code,
    ccxtId: input.ccxtId ?? input.code,
    ccxtOptions: input.ccxtOptions ?? {},
    requiresPassphrase: input.requiresPassphrase ?? false,
    supportsSpot: input.supportsSpot ?? true,
    supportsPerp: input.supportsPerp ?? true,
    supportsDatedFutures: input.supportsDatedFutures ?? false,
    supportsOptions: input.supportsOptions ?? false,
    supportsFundingHistory: input.supportsFundingHistory ?? true,
    supportsOpenPositions: input.supportsOpenPositions ?? true,
    supportsKlines: input.supportsKlines ?? true,
    supportsFetchMyTrades: input.supportsFetchMyTrades ?? true,
    maxLookbackDays: input.maxLookbackDays ?? 90,
    pageSize: input.pageSize ?? 200,
    marketTypes: Object.freeze(
      input.marketTypes ? [...input.marketTypes] : ['swap'],
    ),
    fundingMarketTypes: input.fundingMarketTypes
      ? Object.freeze([...input.fundingMarketTypes])
      : null,
    fetchPermissions: input.fetchPermissions ?? null,
    hasWithdrawPermission: input.hasWithdrawPermission ?? (() => false),
    extractPermissions: input.extractPermissions ?? (() => []),
    rateLimitRps: input.rateLimitRps ?? 5.0,
    rateLimitBurst: input.rateLimitBurst ?? 10,
    rateLimitCooloffSeconds: input.rateLimitCooloffSeconds ?? 30,
    apiDocsUrl: input.apiDocsUrl ?? '',
    notes: input.notes ?? '',
  };
  return Object.freeze(cfg);
}
