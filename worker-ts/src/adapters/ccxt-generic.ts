/**
 * `CcxtGenericAdapter` — one adapter, N exchanges, driven by `VenueConfig`.
 *
 * TS port of `worker/csj_worker/adapters/generic.py`. Premise:
 *  - ccxt already handles HMAC/RSA/ED25519 signing, symbol normalization,
 *    response-shape normalization (fetchMyTrades → unified trade dict),
 *    pagination plumbing (fromId / cursor / after — hidden behind
 *    fetchMyTrades), and rate-limit awareness per method.
 *  - We wrap that thin: per-venue quirks ride on a `VenueConfig`.
 *  - Adding a new exchange = a 30-line config + registry entry.
 *
 * Crash consistency
 * -----------------
 *  - ccxt clients are created fresh per call and closed in `finally`.
 *  - `fetchFills` is an async generator: a caller may abort iteration
 *    early; the client `close()` still runs.
 *  - All errors thrown reach the `AdapterError` hierarchy via
 *    `mapCcxtError`.
 *
 * Concurrency
 * -----------
 *  - The adapter is stateless between calls. Two concurrent invocations
 *    against different credentials are safe.
 */
import ccxt, {
  type Exchange as CcxtClient,
  type Trade as CcxtTrade,
  type FundingHistory as CcxtFundingRecord,
  type Position as CcxtPosition,
  type Market as CcxtMarket,
} from 'ccxt';

import { log } from '../log.js';
import type {
  AdapterCapabilities,
  ApiKeyCredentials,
  AuthMode,
  CanonicalFill,
  CanonicalFundingEvent,
  CanonicalInstrument,
  CanonicalPosition,
  ConnectionStatusResult,
  Credentials,
  Dec,
  Exchange,
  ExchangeKind,
  FeeKind,
  FundingDirection,
  InstrumentKind,
  PositionSide,
  RateLimitPolicy,
  RetryPolicy,
  Side,
} from '../types.js';
import { isApiKeyCredentials } from '../types.js';
import {
  AdapterAuthError,
  AdapterError,
  AdapterExchangeDownError,
  AdapterInvalidDataError,
  AdapterNetworkError,
  AdapterPermissionError,
  AdapterRateLimitedError,
  AdapterUnsupportedError,
  type ExchangeAdapter,
  type FetchWindow,
  type Kline,
} from './base.js';
import type { VenueConfig } from './venue-config.js';

// ---------------------------------------------------------------------------
// ccxt error class registry (the package exports them as named classes).
// We use `instanceof` chains in `mapCcxtError`.
// ---------------------------------------------------------------------------

const ccxtErrors = ccxt as unknown as {
  AuthenticationError: new (...args: unknown[]) => Error;
  PermissionDenied: new (...args: unknown[]) => Error;
  RateLimitExceeded: new (...args: unknown[]) => Error;
  NetworkError: new (...args: unknown[]) => Error;
  ExchangeNotAvailable: new (...args: unknown[]) => Error;
  OnMaintenance: new (...args: unknown[]) => Error;
  BadResponse: new (...args: unknown[]) => Error;
  BadSymbol: new (...args: unknown[]) => Error;
  BadRequest: new (...args: unknown[]) => Error;
  ExchangeError: new (...args: unknown[]) => Error;
  NotSupported: new (...args: unknown[]) => Error;
};

// ---------------------------------------------------------------------------
// Helpers — coercion, timestamp parsing, error mapping
// ---------------------------------------------------------------------------

/**
 * Convert any numeric-ish value to a decimal string.
 *
 * We never carry money/qty as JS numbers — JS doubles lose precision past
 * 15-16 significant digits, which is well within crypto quantities for
 * tokens like SHIB. ccxt parses NUMERIC fields into JS numbers internally
 * (a known limitation); we accept the precision loss is bounded by what
 * ccxt already did and stringify it consistently.
 *
 * @throws {AdapterInvalidDataError} if the value cannot be coerced.
 */
function toDec(value: unknown, field: string): Dec {
  if (value === null || value === undefined) {
    throw new AdapterInvalidDataError(`Missing required numeric field: ${field}`);
  }
  const s = typeof value === 'string' ? value : String(value);
  if (s === '' || s === 'NaN' || s === 'Infinity' || s === '-Infinity') {
    throw new AdapterInvalidDataError(
      `Cannot convert ${field}=${JSON.stringify(value)} to Decimal`,
    );
  }
  // Validate shape (loose). Allow plain decimals + scientific.
  if (!/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(s)) {
    // ccxt may give us already-canonicalised strings or numbers. Try once
    // more via Number → fixed string to absorb numeric inputs.
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value.toString();
    }
    throw new AdapterInvalidDataError(
      `Cannot convert ${field}=${JSON.stringify(value)} to Decimal`,
    );
  }
  return s;
}

/** Best-effort decimal coercion; returns the default on any failure. */
function toDecSafe(value: unknown, fallback: Dec): Dec {
  if (value === null || value === undefined || value === '') return fallback;
  try {
    return toDec(value, '');
  } catch {
    return fallback;
  }
}

function decAbs(d: Dec): Dec {
  return d.startsWith('-') ? d.slice(1) : d;
}

function decNeg(d: Dec): boolean {
  return d.startsWith('-');
}

function decMul(a: Dec, b: Dec): Dec {
  // Best-effort multiplication for the `notional` fallback when ccxt
  // doesn't surface `cost`. We use JS Number arithmetic — the result is
  // serialized as a string. The downstream DB stores NUMERIC, so the
  // precision loss is bounded by JS number precision (15-16 sig figs).
  // ccxt usually provides `cost` directly, so this path is rare.
  const x = Number(a);
  const y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new AdapterInvalidDataError(`Cannot multiply ${a} * ${b}`);
  }
  return (x * y).toString();
}

function msToDate(ms: unknown, field: string): Date {
  if (ms === null || ms === undefined) {
    throw new AdapterInvalidDataError(`Missing timestamp field: ${field}`);
  }
  const n = typeof ms === 'number' ? ms : Number(ms);
  if (!Number.isFinite(n)) {
    throw new AdapterInvalidDataError(`Cannot parse timestamp ${field}=${ms}`);
  }
  return new Date(n);
}

function parseRetryAfter(msg: string): number | null {
  const m = msg.match(/retry.after[:\s]+(\d+)/i);
  return m && m[1] ? Number(m[1]) : null;
}

/**
 * Convert ccxt exceptions to the `AdapterError` hierarchy.
 *
 * Generic, venue-agnostic mapping. Per-venue configs may override; for
 * v1 this covers all the target venues we care about.
 */
function mapCcxtError(err: unknown, venue = ''): AdapterError {
  const errObj = err instanceof Error ? err : new Error(String(err));
  const msg = venue ? `${venue}: ${errObj.message}` : errObj.message;
  const opts = { cause: errObj };

  if (err instanceof ccxtErrors.AuthenticationError) return new AdapterAuthError(msg, opts);
  if (err instanceof ccxtErrors.PermissionDenied) return new AdapterPermissionError(msg, opts);
  if (err instanceof ccxtErrors.RateLimitExceeded) {
    return new AdapterRateLimitedError(msg, {
      ...opts,
      retryAfter: parseRetryAfter(msg) ?? undefined,
    });
  }
  if (err instanceof ccxtErrors.NetworkError) return new AdapterNetworkError(msg, opts);
  if (
    err instanceof ccxtErrors.ExchangeNotAvailable ||
    err instanceof ccxtErrors.OnMaintenance
  ) {
    return new AdapterExchangeDownError(msg, opts);
  }
  if (err instanceof ccxtErrors.BadResponse || err instanceof ccxtErrors.BadSymbol) {
    return new AdapterInvalidDataError(msg, opts);
  }
  if (err instanceof ccxtErrors.ExchangeError) return new AdapterNetworkError(msg, opts);
  // Default to network so the retry policy gets a chance.
  return new AdapterNetworkError(msg, opts);
}

// ---------------------------------------------------------------------------
// Symbol normalization — ccxt market info → CanonicalInstrument
// ---------------------------------------------------------------------------

const CCXT_KIND_MAP: Record<string, InstrumentKind> = {
  spot: 'spot',
  swap: 'perp',
  future: 'dated_future',
  futures: 'dated_future',
  delivery: 'dated_future',
  option: 'option',
};

const MARKET_TYPE_EQUIVALENTS: Record<string, Set<string>> = {
  swap: new Set(['swap']),
  future: new Set(['future', 'delivery', 'futures']),
  spot: new Set(['spot']),
  option: new Set(['option']),
};

function normalizeInstrument(
  ccxtSymbol: string,
  marketInfo: Partial<CcxtMarket> | null | undefined,
  exchange: Exchange,
): CanonicalInstrument {
  const info = marketInfo ?? {};
  const mtype = typeof info.type === 'string' ? info.type : 'spot';
  const kind: InstrumentKind = CCXT_KIND_MAP[mtype] ?? 'spot';

  const base = String(info.base ?? '').toUpperCase() || 'UNKNOWN';
  const quote = String(info.quote ?? '').toUpperCase() || 'UNKNOWN';

  let expiry: Date | null = null;
  if (kind === 'dated_future' && info.expiry) {
    try {
      expiry = msToDate(info.expiry, 'market.expiry');
    } catch {
      expiry = null;
    }
  }

  return {
    exchange,
    kind,
    base,
    quote,
    expiry,
    rawSymbol: ccxtSymbol,
  };
}

// ---------------------------------------------------------------------------
// ccxt unified trade → CanonicalFill
// ---------------------------------------------------------------------------

function parseCcxtTrade(
  trade: CcxtTrade,
  instrument: CanonicalInstrument,
): CanonicalFill {
  const id = trade.id;
  if (id === null || id === undefined) {
    throw new AdapterInvalidDataError("Trade record missing 'id'");
  }
  const filledAt = msToDate(trade.timestamp, 'timestamp');

  const sideRaw = String(trade.side ?? '').toLowerCase();
  const side: Side = sideRaw === 'buy' ? 'buy' : 'sell';

  const isMaker = trade.takerOrMaker === 'maker';
  const feeKind: FeeKind = isMaker ? 'maker' : 'taker';

  const qty = toDec(trade.amount, 'amount');
  const price = toDec(trade.price, 'price');
  const notional = trade.cost !== undefined && trade.cost !== null
    ? toDec(trade.cost, 'cost')
    : decMul(qty, price);

  const feeInfo = (trade.fee ?? null) as { cost?: unknown; currency?: unknown } | null;
  const feeCostRaw = feeInfo && typeof feeInfo === 'object' ? feeInfo.cost : null;
  const feeCost: Dec =
    feeCostRaw !== undefined && feeCostRaw !== null
      ? decAbs(toDec(feeCostRaw, 'fee.cost'))
      : '0';
  const feeCurrency =
    feeInfo && typeof feeInfo === 'object' && typeof feeInfo.currency === 'string'
      ? feeInfo.currency
      : instrument.quote;

  const orderId = trade.order ?? null;

  return {
    externalTradeId: String(id),
    externalOrderId: orderId !== null && orderId !== undefined ? String(orderId) : null,
    instrument,
    side,
    qty,
    price,
    notional,
    fee: feeCost,
    feeCurrency,
    feeKind,
    isMaker,
    liquidity: isMaker ? 'maker' : 'taker',
    filledAt,
    raw: trade as unknown as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// ccxt funding record → CanonicalFundingEvent
// ---------------------------------------------------------------------------

function parseCcxtFunding(
  record: CcxtFundingRecord,
  markets: Record<string, CcxtMarket>,
  exchange: Exchange,
): CanonicalFundingEvent {
  const symbol = String(record.symbol ?? '');
  const marketInfo = markets[symbol] ?? null;
  const instrument = normalizeInstrument(symbol, marketInfo, exchange);

  const occurredAt = msToDate(record.timestamp, 'timestamp');
  const amountRaw = toDec(record.amount ?? 0, 'amount');
  const direction: FundingDirection = decNeg(amountRaw) ? 'paid' : 'received';
  const amount = decAbs(amountRaw);

  // ccxt does not surface fundingRate / positionQty in the unified shape.
  // Try to pluck from `info` (many venues include them as fundingRate /
  // positionAmt). Default to '0' when unknown.
  const info = (record.info ?? {}) as Record<string, unknown>;
  const fundingRate = toDecSafe(info.fundingRate, '0');
  const positionQty = toDecSafe(info.positionAmt, '0');

  return {
    instrument,
    direction,
    fundingRate,
    positionQty: decAbs(positionQty),
    amount,
    amountCurrency: String(record.code ?? instrument.quote),
    occurredAt,
    externalId:
      record.id !== undefined && record.id !== null ? String(record.id) : null,
    raw: record as unknown as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// ccxt position → CanonicalPosition
// ---------------------------------------------------------------------------

function parseCcxtPosition(
  raw: CcxtPosition,
  markets: Record<string, CcxtMarket>,
  exchange: Exchange,
): CanonicalPosition | null {
  let qtyRaw: unknown = raw.contracts;
  if (qtyRaw === null || qtyRaw === undefined) {
    qtyRaw = (raw as { amount?: unknown }).amount;
  }
  if (qtyRaw === null || qtyRaw === undefined) {
    const info = (raw.info ?? {}) as Record<string, unknown>;
    qtyRaw = info.positionAmt ?? info.size ?? 0;
  }
  const qty = toDecSafe(qtyRaw, '0');
  if (qty === '0' || qty === '0.0' || qty === '-0') return null;

  const symbol = String(raw.symbol ?? '');
  const marketInfo = markets[symbol] ?? null;
  const instrument = normalizeInstrument(symbol, marketInfo, exchange);

  const sideRaw = String(raw.side ?? 'long').toLowerCase();
  const side: PositionSide =
    sideRaw === 'long' || sideRaw === 'buy' ? 'long' : 'short';

  const entryPrice = toDecSafe(raw.entryPrice, '0');

  return {
    externalPositionId: null,
    instrument,
    side,
    qtyOpen: decAbs(qty),
    avgEntryPrice: entryPrice,
    unrealizedPnl: raw.unrealizedPnl !== null && raw.unrealizedPnl !== undefined
      ? toDecSafe(raw.unrealizedPnl, '0')
      : null,
    markPrice: raw.markPrice !== null && raw.markPrice !== undefined
      ? toDecSafe(raw.markPrice, '0')
      : null,
    leverage: raw.leverage !== null && raw.leverage !== undefined
      ? toDecSafe(raw.leverage, '0')
      : null,
    liquidationPrice:
      raw.liquidationPrice !== null && raw.liquidationPrice !== undefined
        ? toDecSafe(raw.liquidationPrice, '0')
        : null,
    raw: raw as unknown as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

const ccxtAny = ccxt as unknown as Record<string, new (opts: unknown) => CcxtClient>;

export class CcxtGenericAdapter implements ExchangeAdapter {
  readonly exchange: Exchange;
  readonly exchangeKind: ExchangeKind = 'cex';
  readonly authMode: AuthMode = 'api_key';
  readonly capabilities: AdapterCapabilities;
  readonly rateLimit: RateLimitPolicy;
  readonly retryPolicy: RetryPolicy;

  constructor(readonly config: VenueConfig) {
    this.exchange = config.code;
    this.capabilities = {
      exchange: config.code,
      exchangeKind: 'cex',
      authMode: 'api_key',
      supportsSpot: config.supportsSpot,
      supportsPerp: config.supportsPerp,
      supportsDatedFutures: config.supportsDatedFutures,
      supportsOptions: config.supportsOptions,
      supportsFundingHistory: config.supportsFundingHistory,
      supportsOpenPositions: config.supportsOpenPositions,
      maxLookbackDays: config.maxLookbackDays,
      pageSize: config.pageSize,
    };
    this.rateLimit = {
      requestsPerSecond: config.rateLimitRps,
      burst: config.rateLimitBurst,
      cooloffSeconds: config.rateLimitCooloffSeconds,
    };
    this.retryPolicy = {
      maxAttempts: 5,
      baseDelayMs: 500,
      maxDelayMs: 30_000,
      jitter: true,
      retryOn: ['rate_limited', 'network', 'exchange_down'],
    };
  }

  // ------------------------------------------------------------------
  // ccxt client construction
  // ------------------------------------------------------------------

  private buildClient(
    creds: ApiKeyCredentials,
    marketType?: string,
  ): CcxtClient {
    const Cls = ccxtAny[this.config.ccxtId];
    if (!Cls) {
      throw new AdapterUnsupportedError(
        `ccxt has no exchange '${this.config.ccxtId}' (requested for venue ${this.config.code})`,
      );
    }

    // Merge: credentials + base ccxt_options + per-call market_type override.
    const cfgOpts: Record<string, unknown> = { ...this.config.ccxtOptions };
    if (marketType) {
      const nested = { ...(cfgOpts.options as Record<string, unknown> | undefined ?? {}) };
      nested.defaultType = marketType;
      cfgOpts.options = nested;
    }

    const opts: Record<string, unknown> = {
      apiKey: creds.apiKey,
      secret: creds.apiSecret,
      // ccxt's own rate-limit pacing — we manage our own.
      enableRateLimit: false,
    };
    if (this.config.requiresPassphrase) {
      if (!creds.passphrase) {
        throw new AdapterAuthError(`${this.config.code} requires a passphrase`);
      }
      opts.password = creds.passphrase;
    }
    for (const [k, v] of Object.entries(cfgOpts)) opts[k] = v;
    return new Cls(opts);
  }

  private static async closeSafely(client: CcxtClient | null): Promise<void> {
    if (!client) return;
    try {
      // ccxt's TS types are imprecise; close() exists on every venue.
      await (client as unknown as { close?: () => Promise<void> }).close?.();
    } catch (err) {
      log.debug({ err: (err as Error).message }, 'ccxt.close_error');
    }
  }

  // ------------------------------------------------------------------
  // Lifecycle: connect / validateCredentials
  // ------------------------------------------------------------------

  async connect(credentials: Credentials): Promise<ConnectionStatusResult> {
    if (!isApiKeyCredentials(credentials)) {
      throw new AdapterAuthError(`${this.config.code} requires ApiKeyCredentials`);
    }

    log.info(
      {
        venue: this.config.code,
        passphrase_required: this.config.requiresPassphrase,
      },
      'connect.start',
    );

    let client: CcxtClient | null = null;
    try {
      client = this.buildClient(credentials);

      let permInfo: Record<string, unknown> = {};
      if (this.config.fetchPermissions) {
        permInfo = await this.config.fetchPermissions(client);
      } else {
        // Default probe: fetchBalance, structural check on `info` only.
        const balance = (await client.fetchBalance()) as unknown as {
          info?: Record<string, unknown>;
        };
        permInfo = balance.info ?? {};
      }

      // Reject withdraw-capable keys.
      if (this.config.hasWithdrawPermission(permInfo)) {
        log.warn({ venue: this.config.code }, 'connect.rejected_withdraw_key');
        return {
          health: 'permission',
          authMode: 'api_key',
          permissions: ['canWithdraw'],
          message: `API key for ${this.config.code} has withdraw permission. Create a read-only key and re-connect.`,
        };
      }

      const permissions = this.config.extractPermissions(permInfo);
      if (permissions.some((p) => p.endsWith(':unverified'))) {
        log.warn({ venue: this.config.code }, 'connect.withdraw_unverified');
      }

      return {
        health: 'ok',
        authMode: 'api_key',
        permissions,
        message: null,
        serverTime: null,
      };
    } catch (err) {
      if (err instanceof AdapterError) {
        if (err instanceof AdapterAuthError || err instanceof AdapterPermissionError) {
          return {
            health: 'auth_failed',
            authMode: 'api_key',
            permissions: [],
            message: err.message,
          };
        }
        if (
          err instanceof AdapterNetworkError ||
          err instanceof AdapterExchangeDownError ||
          err instanceof AdapterRateLimitedError
        ) {
          return {
            health: 'unreachable',
            authMode: 'api_key',
            permissions: [],
            message: err.message,
          };
        }
        throw err;
      }
      const mapped = mapCcxtError(err, this.config.code);
      if (mapped instanceof AdapterAuthError || mapped instanceof AdapterPermissionError) {
        return {
          health: 'auth_failed',
          authMode: 'api_key',
          permissions: [],
          message: mapped.message,
        };
      }
      if (
        mapped instanceof AdapterNetworkError ||
        mapped instanceof AdapterExchangeDownError ||
        mapped instanceof AdapterRateLimitedError
      ) {
        return {
          health: 'unreachable',
          authMode: 'api_key',
          permissions: [],
          message: mapped.message,
        };
      }
      throw mapped;
    } finally {
      await CcxtGenericAdapter.closeSafely(client);
    }
  }

  async validateCredentials(credentials: Credentials): Promise<boolean> {
    if (!isApiKeyCredentials(credentials)) return false;
    let client: CcxtClient | null = null;
    try {
      client = this.buildClient(credentials);
      await client.fetchBalance();
      return true;
    } catch (err) {
      if (err instanceof ccxtErrors.AuthenticationError) return false;
      throw mapCcxtError(err, this.config.code);
    } finally {
      await CcxtGenericAdapter.closeSafely(client);
    }
  }

  // ------------------------------------------------------------------
  // fetchFills
  // ------------------------------------------------------------------

  fetchFills(
    credentials: Credentials,
    window: FetchWindow,
  ): AsyncIterable<CanonicalFill[]> {
    if (!isApiKeyCredentials(credentials)) {
      throw new AdapterAuthError(
        `${this.config.code} requires ApiKeyCredentials`,
      );
    }
    return this.fillGenerator(credentials, window);
  }

  private async *fillGenerator(
    creds: ApiKeyCredentials,
    window: FetchWindow,
  ): AsyncIterable<CanonicalFill[]> {
    const sinceMs = window.since.getTime();
    const untilMs = window.until.getTime();
    const pageSize = this.config.pageSize;

    for (const marketType of this.config.marketTypes) {
      let client: CcxtClient | null = null;
      try {
        client = this.buildClient(creds, marketType);

        try {
          await client.loadMarkets();
        } catch (err) {
          log.warn(
            { venue: this.config.code, marketType, err: (err as Error).name },
            'load_markets.failed',
          );
          throw mapCcxtError(err, this.config.code);
        }

        const markets = (client.markets ?? {}) as Record<string, CcxtMarket>;
        if (Object.keys(markets).length === 0) {
          log.info({ venue: this.config.code, marketType }, 'markets.empty');
          continue;
        }

        let requestCount = 0;
        for (const [symbol, marketInfo] of Object.entries(markets)) {
          // ccxt types `Market` as `MarketInterface | undefined`; skip empty
          // slots and narrow to a non-null view for the loop body.
          const market = marketInfo;
          if (!market) continue;
          if (market.active === false) continue;

          // Only fetch markets whose type matches the current iteration.
          const mType = typeof market.type === 'string' ? market.type : null;
          if (mType && mType !== marketType) {
            const equiv = MARKET_TYPE_EQUIVALENTS[marketType] ?? new Set([marketType]);
            if (!equiv.has(mType)) continue;
          }

          const instrument = normalizeInstrument(symbol, market, this.exchange);

          let cursorMs = sinceMs;
          const seenIds = new Set<string>();
          // eslint-disable-next-line no-constant-condition
          while (true) {
            let rawTrades: CcxtTrade[];
            try {
              rawTrades = (await client.fetchMyTrades(
                symbol,
                cursorMs,
                pageSize,
              )) as CcxtTrade[];
            } catch (err) {
              const mapped = mapCcxtError(err, this.config.code);
              if (mapped instanceof AdapterRateLimitedError) {
                const backoff =
                  (mapped.retryAfter ?? this.config.rateLimitCooloffSeconds) *
                  1000;
                log.warn(
                  {
                    venue: this.config.code,
                    marketType,
                    symbol,
                    backoffMs: backoff,
                  },
                  'fetch_fills.rate_limited',
                );
                await sleep(backoff);
                continue;
              }
              if (mapped instanceof AdapterInvalidDataError) {
                log.debug(
                  { venue: this.config.code, marketType, symbol },
                  'fetch_fills.invalid_data_skip_symbol',
                );
                break;
              }
              throw mapped;
            }

            requestCount += 1;
            log.info(
              {
                venue: this.config.code,
                marketType,
                symbol,
                count: rawTrades.length,
                cursorMs,
                totalRequests: requestCount,
              },
              'fetch_fills.page',
            );

            if (rawTrades.length === 0) break;

            // Filter to [since, until]. Some venues return trades older than
            // `since` when paginating via cursor.
            const inWindow: CcxtTrade[] = [];
            for (const t of rawTrades) {
              const ts = Number(t.timestamp ?? 0);
              if (ts < sinceMs || ts > untilMs) continue;
              const id = t.id !== undefined && t.id !== null ? String(t.id) : null;
              if (id === null) continue;
              if (seenIds.has(id)) continue;
              seenIds.add(id);
              inWindow.push(t);
            }

            if (inWindow.length > 0) {
              const fills = inWindow.map((t) => parseCcxtTrade(t, instrument));
              yield fills;
            }

            // Pagination termination
            const lastTs = rawTrades.reduce(
              (acc, t) => Math.max(acc, Number(t.timestamp ?? 0)),
              0,
            );
            if (lastTs <= cursorMs || rawTrades.length < pageSize) break;
            cursorMs = lastTs + 1;
            if (cursorMs > untilMs) break;
          }
        }

        log.info(
          {
            venue: this.config.code,
            marketType,
            totalRequests: requestCount,
          },
          'fetch_fills.market_complete',
        );
      } finally {
        await CcxtGenericAdapter.closeSafely(client);
      }
    }
  }

  // ------------------------------------------------------------------
  // fetchFundingEvents
  // ------------------------------------------------------------------

  fetchFundingEvents(
    credentials: Credentials,
    window: FetchWindow,
  ): AsyncIterable<CanonicalFundingEvent[]> {
    if (!this.config.supportsFundingHistory) {
      throw new AdapterUnsupportedError(
        `${this.config.code} does not support funding history`,
      );
    }
    if (!isApiKeyCredentials(credentials)) {
      throw new AdapterAuthError(
        `${this.config.code} requires ApiKeyCredentials`,
      );
    }
    return this.fundingGenerator(credentials, window);
  }

  private async *fundingGenerator(
    creds: ApiKeyCredentials,
    window: FetchWindow,
  ): AsyncIterable<CanonicalFundingEvent[]> {
    const sinceMs = window.since.getTime();
    const untilMs = window.until.getTime();
    const pageSize = this.config.pageSize;
    const marketTypes = this.config.fundingMarketTypes ?? this.config.marketTypes;

    for (const marketType of marketTypes) {
      let client: CcxtClient | null = null;
      try {
        client = this.buildClient(creds, marketType);

        try {
          await client.loadMarkets();
        } catch (err) {
          throw mapCcxtError(err, this.config.code);
        }
        const markets = (client.markets ?? {}) as Record<string, CcxtMarket>;

        let cursorMs = sinceMs;
        let requestCount = 0;
        while (cursorMs <= untilMs) {
          let rawRecords: CcxtFundingRecord[];
          try {
            const anyClient = client as unknown as {
              fetchFundingHistory?: (
                symbol: string | undefined,
                since: number | undefined,
                limit: number | undefined,
              ) => Promise<CcxtFundingRecord[]>;
            };
            if (!anyClient.fetchFundingHistory) {
              throw new AdapterUnsupportedError(
                `${this.config.code} ccxt client does not support fetchFundingHistory`,
              );
            }
            rawRecords = await anyClient.fetchFundingHistory(
              undefined,
              cursorMs,
              pageSize,
            );
          } catch (err) {
            if (err instanceof AdapterUnsupportedError) throw err;
            if (err instanceof ccxtErrors.NotSupported) {
              throw new AdapterUnsupportedError(
                `${this.config.code} ccxt client does not support fetchFundingHistory`,
                { cause: err },
              );
            }
            const mapped = mapCcxtError(err, this.config.code);
            if (mapped instanceof AdapterRateLimitedError) {
              const backoff =
                (mapped.retryAfter ?? this.config.rateLimitCooloffSeconds) *
                1000;
              log.warn(
                { venue: this.config.code, marketType, backoffMs: backoff },
                'fetch_funding.rate_limited',
              );
              await sleep(backoff);
              continue;
            }
            throw mapped;
          }

          requestCount += 1;
          log.info(
            {
              venue: this.config.code,
              marketType,
              count: rawRecords.length,
              cursorMs,
              totalRequests: requestCount,
            },
            'fetch_funding.page',
          );
          if (rawRecords.length === 0) break;

          const inWindow = rawRecords.filter((r) => {
            const ts = Number(r.timestamp ?? 0);
            return ts >= sinceMs && ts <= untilMs;
          });
          if (inWindow.length > 0) {
            yield inWindow.map((r) => parseCcxtFunding(r, markets, this.exchange));
          }

          const lastTs = rawRecords.reduce(
            (acc, r) => Math.max(acc, Number(r.timestamp ?? 0)),
            0,
          );
          if (lastTs <= cursorMs || rawRecords.length < pageSize) break;
          cursorMs = lastTs + 1;
        }
      } finally {
        await CcxtGenericAdapter.closeSafely(client);
      }
    }
  }

  // ------------------------------------------------------------------
  // fetchOpenPositions
  // ------------------------------------------------------------------

  async fetchOpenPositions(credentials: Credentials): Promise<CanonicalPosition[]> {
    if (!this.config.supportsOpenPositions) {
      throw new AdapterUnsupportedError(
        `${this.config.code} does not support open positions`,
      );
    }
    if (!isApiKeyCredentials(credentials)) {
      throw new AdapterAuthError(
        `${this.config.code} requires ApiKeyCredentials`,
      );
    }

    const derivTypes = this.config.marketTypes.filter((mt) =>
      ['swap', 'future', 'delivery', 'futures', 'option'].includes(mt),
    );
    if (derivTypes.length === 0) return [];

    const out: CanonicalPosition[] = [];
    for (const marketType of derivTypes) {
      let client: CcxtClient | null = null;
      try {
        client = this.buildClient(credentials, marketType);

        try {
          await client.loadMarkets();
        } catch (err) {
          throw mapCcxtError(err, this.config.code);
        }

        let rawPositions: CcxtPosition[];
        try {
          const anyClient = client as unknown as {
            fetchPositions?: () => Promise<CcxtPosition[]>;
          };
          if (!anyClient.fetchPositions) {
            log.warn(
              { venue: this.config.code, marketType },
              'fetch_positions.unsupported',
            );
            continue;
          }
          rawPositions = await anyClient.fetchPositions();
        } catch (err) {
          if (err instanceof ccxtErrors.NotSupported) {
            log.warn(
              { venue: this.config.code, marketType },
              'fetch_positions.unsupported',
            );
            continue;
          }
          throw mapCcxtError(err, this.config.code);
        }

        const markets = (client.markets ?? {}) as Record<string, CcxtMarket>;
        for (const raw of rawPositions) {
          const parsed = parseCcxtPosition(raw, markets, this.exchange);
          if (parsed) out.push(parsed);
        }

        log.info(
          {
            venue: this.config.code,
            marketType,
            rawCount: rawPositions.length,
            openCount: out.length,
          },
          'fetch_positions',
        );
      } finally {
        await CcxtGenericAdapter.closeSafely(client);
      }
    }

    return out;
  }

  // ------------------------------------------------------------------
  // fetchKlines (public, no auth)
  // ------------------------------------------------------------------

  async fetchKlines(
    symbol: string,
    startMs: number,
    endMs: number,
    interval = '1m',
  ): Promise<Kline[]> {
    if (!this.config.supportsKlines) {
      throw new AdapterUnsupportedError(
        `${this.config.code} does not support klines`,
      );
    }

    for (const marketType of this.config.marketTypes) {
      const Cls = ccxtAny[this.config.ccxtId];
      if (!Cls) {
        throw new AdapterUnsupportedError(
          `ccxt has no exchange ${this.config.ccxtId}`,
        );
      }
      const cfgOpts: Record<string, unknown> = { ...this.config.ccxtOptions };
      const nested = { ...(cfgOpts.options as Record<string, unknown> | undefined ?? {}) };
      nested.defaultType = marketType;
      cfgOpts.options = nested;
      (cfgOpts as { enableRateLimit?: boolean }).enableRateLimit = false;

      const client = new Cls(cfgOpts);
      try {
        let bars: Kline[];
        try {
          bars = await this.pageOhlcv(client, symbol, interval, startMs, endMs);
        } catch (err) {
          if (
            err instanceof ccxtErrors.BadSymbol ||
            err instanceof ccxtErrors.BadRequest
          ) {
            continue;
          }
          throw mapCcxtError(err, this.config.code);
        }
        if (bars.length > 0) return bars;
      } finally {
        await CcxtGenericAdapter.closeSafely(client);
      }
    }

    log.warn(
      { venue: this.config.code, symbol, interval },
      'fetch_klines.symbol_not_found',
    );
    return [];
  }

  private async pageOhlcv(
    client: CcxtClient,
    symbol: string,
    timeframe: string,
    startMs: number,
    endMs: number,
  ): Promise<Kline[]> {
    const out = new Map<number, Kline>();
    let cursor = startMs;
    const anyClient = client as unknown as {
      parseTimeframe?: (tf: string) => number;
      fetchOHLCV: (
        symbol: string,
        timeframe: string,
        since?: number,
        limit?: number,
      ) => Promise<Array<[number, number, number, number, number, number]>>;
    };
    const tfMs = anyClient.parseTimeframe
      ? anyClient.parseTimeframe(timeframe) * 1000
      : 60_000;

    const maxIterations = 500;
    let iters = 0;
    while (cursor <= endMs && iters < maxIterations) {
      iters += 1;
      const rawBars = await anyClient.fetchOHLCV(symbol, timeframe, cursor, 1000);
      if (rawBars.length === 0) break;

      let advanced = false;
      for (const row of rawBars) {
        const ts = Number(row[0]);
        if (ts > endMs) continue;
        if (!out.has(ts)) {
          out.set(ts, {
            tsMs: ts,
            open: String(row[1]),
            high: String(row[2]),
            low: String(row[3]),
            close: String(row[4]),
            volume: row[5] !== null && row[5] !== undefined ? String(row[5]) : '0',
          });
          advanced = true;
        }
      }

      const lastTs = Number(rawBars[rawBars.length - 1]?.[0] ?? 0);
      if (lastTs >= endMs || !advanced) {
        cursor = lastTs + tfMs;
        if (!advanced) break;
      } else {
        cursor = lastTs + tfMs;
      }
    }

    return [...out.values()].sort((a, b) => a.tsMs - b.tsMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
