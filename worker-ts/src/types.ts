/**
 * Canonical types — TS mirror of `worker/csj_worker/types.py` and
 * `src/types/canonical.ts`.
 *
 * Conventions
 * -----------
 *  - Decimals as strings (NEVER `number` for money/qty — CLAUDE.md rule).
 *    Pydantic carries `Decimal`; we carry `string`. Same on-the-wire shape.
 *  - Timestamps as JS `Date` objects in TypeScript memory; serialized as ISO-8601
 *    UTC at boundaries. ccxt gives ms-since-epoch; we convert at the adapter
 *    edge.
 *  - Enum values match Python byte-for-byte (so DB enum strings round-trip).
 *  - We use plain TypeScript types + zod schemas where runtime validation
 *    matters (DB reads, ccxt responses). Plain types are the wire shape; the
 *    zod parser is the typed boundary.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Enums (string-literal unions + matching zod schemas)
// ---------------------------------------------------------------------------

export const ExchangeValues = [
  'binance',
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
] as const;
export type Exchange = (typeof ExchangeValues)[number];
export const ExchangeSchema = z.enum(ExchangeValues);

export const ExchangeKindValues = ['cex', 'dex'] as const;
export type ExchangeKind = (typeof ExchangeKindValues)[number];

export const AuthModeValues = ['api_key', 'wallet_address'] as const;
export type AuthMode = (typeof AuthModeValues)[number];

export const ConnectionStatusValues = [
  'pending',
  'active',
  'syncing',
  'auth_failed',
  'rate_limited',
  'error',
  'disabled',
] as const;
export type ConnectionStatus = (typeof ConnectionStatusValues)[number];

export const InstrumentKindValues = [
  'spot',
  'perp',
  'dated_future',
  'option',
] as const;
export type InstrumentKind = (typeof InstrumentKindValues)[number];

export const SideValues = ['buy', 'sell'] as const;
export type Side = (typeof SideValues)[number];

export const PositionSideValues = ['long', 'short'] as const;
export type PositionSide = (typeof PositionSideValues)[number];

export const PositionStatusValues = ['open', 'closed'] as const;
export type PositionStatus = (typeof PositionStatusValues)[number];

export const FundingDirectionValues = ['received', 'paid'] as const;
export type FundingDirection = (typeof FundingDirectionValues)[number];

export const FeeKindValues = ['maker', 'taker', 'funding', 'withdrawal', 'gas'] as const;
export type FeeKind = (typeof FeeKindValues)[number];

export const ConnectionHealthValues = [
  'ok',
  'auth_failed',
  'permission',
  'unreachable',
] as const;
export type ConnectionHealth = (typeof ConnectionHealthValues)[number];

export const AdapterErrorCodeValues = [
  'auth_failed',
  'rate_limited',
  'network',
  'exchange_down',
  'invalid_data',
  'permission',
  'unsupported',
  'unknown',
] as const;
export type AdapterErrorCode = (typeof AdapterErrorCodeValues)[number];

// ---------------------------------------------------------------------------
// Decimal-as-string brand
// ---------------------------------------------------------------------------

/**
 * Money/qty values move through the worker as strings. They are produced by
 * adapters (e.g. via `Decimal(str(value))` analogue) and consumed by the DB
 * layer which lets postgres parse the NUMERIC type. We never compute on these
 * — arithmetic should happen in `decimal.js` if needed.
 */
export type Dec = string;

export const DecSchema = z.string().refine(
  (v) => {
    if (v === '') return false;
    // Allow optional sign, digits, optional fractional, optional exponent.
    return /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(v);
  },
  { message: 'Not a decimal-shaped string' },
);

// ---------------------------------------------------------------------------
// Canonical wire models
// ---------------------------------------------------------------------------

export interface CanonicalInstrument {
  exchange: Exchange;
  kind: InstrumentKind;
  base: string;
  quote: string;
  expiry?: Date | null;
  strike?: Dec | null;
  optionKind?: 'call' | 'put' | null;
  rawSymbol: string;
}

export interface CanonicalFill {
  externalTradeId: string;
  externalOrderId?: string | null;
  instrument: CanonicalInstrument;
  side: Side;
  qty: Dec;
  price: Dec;
  notional: Dec;
  fee: Dec;
  feeCurrency: string;
  feeKind: FeeKind;
  isMaker: boolean;
  liquidity?: 'maker' | 'taker' | null;
  positionSide?: PositionSide | null;
  reduceOnly?: boolean | null;
  filledAt: Date;
  raw: Record<string, unknown>;
}

export interface CanonicalFundingEvent {
  instrument: CanonicalInstrument;
  direction: FundingDirection;
  fundingRate: Dec;
  positionQty: Dec;
  amount: Dec;
  amountCurrency: string;
  occurredAt: Date;
  externalId?: string | null;
  raw: Record<string, unknown>;
}

export interface CanonicalPosition {
  externalPositionId?: string | null;
  instrument: CanonicalInstrument;
  side: PositionSide;
  qtyOpen: Dec;
  avgEntryPrice: Dec;
  unrealizedPnl?: Dec | null;
  markPrice?: Dec | null;
  leverage?: Dec | null;
  liquidationPrice?: Dec | null;
  openedAt?: Date | null;
  raw: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export interface ApiKeyCredentials {
  mode: 'api_key';
  apiKey: string;
  apiSecret: string;
  passphrase?: string | null;
}

export interface WalletCredentials {
  mode: 'wallet_address';
  address: string;
  chain?: string | null;
}

export type Credentials = ApiKeyCredentials | WalletCredentials;

export function isApiKeyCredentials(c: Credentials): c is ApiKeyCredentials {
  return c.mode === 'api_key';
}

// ---------------------------------------------------------------------------
// Adapter contract metadata
// ---------------------------------------------------------------------------

export interface AdapterCapabilities {
  exchange: Exchange;
  exchangeKind: ExchangeKind;
  authMode: AuthMode;
  supportsSpot: boolean;
  supportsPerp: boolean;
  supportsDatedFutures: boolean;
  supportsOptions: boolean;
  supportsFundingHistory: boolean;
  supportsOpenPositions: boolean;
  maxLookbackDays?: number | null;
  pageSize: number;
}

export interface RateLimitPolicy {
  requestsPerSecond: number;
  burst: number;
  cooloffSeconds: number;
}

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: boolean;
  retryOn: AdapterErrorCode[];
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 250,
  maxDelayMs: 30_000,
  jitter: true,
  retryOn: ['rate_limited', 'network', 'exchange_down', 'unknown'],
};

export interface ConnectionStatusResult {
  health: ConnectionHealth;
  authMode: AuthMode;
  permissions: string[];
  message?: string | null;
  serverTime?: Date | null;
}

// ---------------------------------------------------------------------------
// Zod schemas for runtime validation at DB / exchange boundaries
// ---------------------------------------------------------------------------

export const CanonicalInstrumentSchema = z.object({
  exchange: ExchangeSchema,
  kind: z.enum(InstrumentKindValues),
  base: z.string(),
  quote: z.string(),
  expiry: z.date().nullable().optional(),
  strike: DecSchema.nullable().optional(),
  optionKind: z.enum(['call', 'put']).nullable().optional(),
  rawSymbol: z.string(),
});

export const CanonicalFillSchema = z.object({
  externalTradeId: z.string().min(1),
  externalOrderId: z.string().nullable().optional(),
  instrument: CanonicalInstrumentSchema,
  side: z.enum(SideValues),
  qty: DecSchema,
  price: DecSchema,
  notional: DecSchema,
  fee: DecSchema,
  feeCurrency: z.string(),
  feeKind: z.enum(FeeKindValues),
  isMaker: z.boolean(),
  liquidity: z.enum(['maker', 'taker']).nullable().optional(),
  positionSide: z.enum(PositionSideValues).nullable().optional(),
  reduceOnly: z.boolean().nullable().optional(),
  filledAt: z.date(),
  raw: z.record(z.string(), z.unknown()),
});

export const CanonicalFundingEventSchema = z.object({
  instrument: CanonicalInstrumentSchema,
  direction: z.enum(FundingDirectionValues),
  fundingRate: DecSchema,
  positionQty: DecSchema,
  amount: DecSchema,
  amountCurrency: z.string(),
  occurredAt: z.date(),
  externalId: z.string().nullable().optional(),
  raw: z.record(z.string(), z.unknown()),
});

export const CanonicalPositionSchema = z.object({
  externalPositionId: z.string().nullable().optional(),
  instrument: CanonicalInstrumentSchema,
  side: z.enum(PositionSideValues),
  qtyOpen: DecSchema,
  avgEntryPrice: DecSchema,
  unrealizedPnl: DecSchema.nullable().optional(),
  markPrice: DecSchema.nullable().optional(),
  leverage: DecSchema.nullable().optional(),
  liquidationPrice: DecSchema.nullable().optional(),
  openedAt: z.date().nullable().optional(),
  raw: z.record(z.string(), z.unknown()),
});

// ---------------------------------------------------------------------------
// DB row schema (exchange_connections) — for runtime parsing of `postgres.js`
// query results. postgres.js gives us camelCase keys via `postgres.camel`.
// ---------------------------------------------------------------------------

/**
 * `exchange_connections` row, post-postgres.js camelCase transform.
 *
 * The bytea fields arrive as Node `Buffer` instances (which are `Uint8Array`
 * subclasses backed by `ArrayBufferLike`). We carry them as `Buffer | null`
 * so we don't have to fight `Uint8Array<ArrayBuffer>` vs
 * `Uint8Array<ArrayBufferLike>` variance in TS strict mode.
 */
export interface ConnectionRow {
  id: string;
  userId: string;
  exchangeCode: string;
  label: string;
  connectionType: AuthMode;
  apiKeyCiphertext: Buffer | null;
  apiKeyNonce: Buffer | null;
  apiSecretCiphertext: Buffer | null;
  apiSecretNonce: Buffer | null;
  apiPassphraseCiphertext: Buffer | null;
  apiPassphraseNonce: Buffer | null;
  walletAddressCiphertext: Buffer | null;
  walletAddressNonce: Buffer | null;
  walletChain: string | null;
  status: ConnectionStatus;
  lastSyncAt: Date | null;
  lastSyncCursor: string | null;
  lastFillAt: Date | null;
}
