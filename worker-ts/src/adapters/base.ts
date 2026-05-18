/**
 * Exchange-adapter contract — TS port of `worker/csj_worker/adapters/base.py`.
 *
 * Invariants
 * ----------
 *  - Adapters are stateless w.r.t. user data. Credentials are passed per call.
 *  - Pagination is an async-iterator of pages — venues like Hyperliquid can
 *    return ~10K rows per call.
 *  - Errors throw from the AdapterError hierarchy; callers MUST NOT catch the
 *    base `Error` class without re-checking via `instanceof`.
 *  - Read-only: adapters reject credentials with withdraw scope at `connect()`.
 */
import type {
  AdapterCapabilities,
  AdapterErrorCode,
  AuthMode,
  CanonicalFill,
  CanonicalFundingEvent,
  CanonicalPosition,
  ConnectionStatusResult,
  Credentials,
  Exchange,
  ExchangeKind,
  RateLimitPolicy,
  RetryPolicy,
} from '../types.js';

// ---------------------------------------------------------------------------
// Error hierarchy — mirrors the Python module byte-for-byte on codes.
// ---------------------------------------------------------------------------

export interface AdapterErrorOptions {
  retryAfter?: number;
  cause?: unknown;
}

export class AdapterError extends Error {
  readonly code: AdapterErrorCode = 'unknown';
  readonly retryable: boolean = false;
  readonly retryAfter: number | null;

  constructor(message: string, opts: AdapterErrorOptions = {}) {
    super(message);
    this.name = new.target.name;
    this.retryAfter = opts.retryAfter ?? null;
    if (opts.cause !== undefined) {
      // Node supports ES2022 Error cause.
      (this as { cause?: unknown }).cause = opts.cause;
    }
  }
}

export class AdapterAuthError extends AdapterError {
  override readonly code: AdapterErrorCode = 'auth_failed';
  override readonly retryable = false;
}

export class AdapterPermissionError extends AdapterError {
  override readonly code: AdapterErrorCode = 'permission';
  override readonly retryable = false;
}

export class AdapterRateLimitedError extends AdapterError {
  override readonly code: AdapterErrorCode = 'rate_limited';
  override readonly retryable = true;
}

export class AdapterNetworkError extends AdapterError {
  override readonly code: AdapterErrorCode = 'network';
  override readonly retryable = true;
}

export class AdapterExchangeDownError extends AdapterError {
  override readonly code: AdapterErrorCode = 'exchange_down';
  override readonly retryable = true;
}

export class AdapterInvalidDataError extends AdapterError {
  override readonly code: AdapterErrorCode = 'invalid_data';
  override readonly retryable = false;
}

export class AdapterUnsupportedError extends AdapterError {
  override readonly code: AdapterErrorCode = 'unsupported';
  override readonly retryable = false;
}

// ---------------------------------------------------------------------------
// Kline shape used by future excursion backfill
// ---------------------------------------------------------------------------

export interface Kline {
  tsMs: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

export interface FetchWindow {
  since: Date;
  until: Date;
}

export interface ExchangeAdapter {
  readonly exchange: Exchange;
  readonly exchangeKind: ExchangeKind;
  readonly authMode: AuthMode;
  readonly capabilities: AdapterCapabilities;
  readonly rateLimit: RateLimitPolicy;
  readonly retryPolicy: RetryPolicy;

  /**
   * Validate credentials + return health/permissions. MUST perform exactly
   * one light authenticated request and reject withdraw-capable keys.
   *
   * @throws {AdapterAuthError | AdapterPermissionError | AdapterNetworkError}
   */
  connect(credentials: Credentials): Promise<ConnectionStatusResult>;

  /**
   * Cheap re-check used by periodic health monitor. MUST NOT mutate cached
   * state. Returns `false` on auth failure; throws on transport errors so
   * the caller can apply backoff.
   */
  validateCredentials(credentials: Credentials): Promise<boolean>;

  /**
   * Yield pages of fills ascending by `filledAt` within `[since, until]`.
   * Pagination strategy is adapter-internal (Binance fromId, OKX cursor,
   * Hyperliquid time-windowed, …). Callers see only pages.
   *
   * @throws {AdapterRateLimitedError | AdapterAuthError | AdapterInvalidDataError | AdapterNetworkError}
   */
  fetchFills(
    credentials: Credentials,
    window: FetchWindow,
  ): AsyncIterable<CanonicalFill[]>;

  /**
   * Yield pages of funding payments. Adapters whose
   * `capabilities.supportsFundingHistory` is false MUST throw
   * `AdapterUnsupportedError` (defense in depth).
   */
  fetchFundingEvents(
    credentials: Credentials,
    window: FetchWindow,
  ): AsyncIterable<CanonicalFundingEvent[]>;

  /** Snapshot of currently-open positions. */
  fetchOpenPositions(credentials: Credentials): Promise<CanonicalPosition[]>;

  /**
   * Public OHLCV — no credentials required. Default impl in the base
   * adapter throws `AdapterUnsupportedError`; override per venue.
   */
  fetchKlines(
    symbol: string,
    startMs: number,
    endMs: number,
    interval?: string,
  ): Promise<Kline[]>;
}
