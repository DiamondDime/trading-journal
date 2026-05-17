/**
 * Public OHLCV kline fetcher — TypeScript twin of the worker's per-adapter
 * `fetch_klines` (see `worker/csj_worker/adapters/{binance,bybit,hyperliquid}.py`).
 *
 * Wave 10-1 (Python worker) already owns the same logic for the MAE/MFE
 * backfill job. We duplicate it here on the Node side rather than spawning a
 * Python subprocess from a Next.js API route — kline endpoints are public,
 * cheap, and the duplication is tiny compared to the cost of cross-language
 * orchestration during a hot request.
 *
 * Symbol normalization is the load-bearing piece. The journal stores raw
 * trade symbols like "BTC-PERP", "ETH-USDC", or just "BTC" (from
 * `activity_spread.primary_base`). Each exchange's REST endpoint wants its
 * own native string:
 *
 *   - Binance      → `BTCUSDT` on fapi (USD-M perp) or api (spot)
 *   - Bybit        → `BTCUSDT` on linear (perp) or spot category
 *   - Hyperliquid  → bare base coin `BTC` (perp-only, USDC-settled)
 *
 * We always try the perp endpoint first (most journal trades are perps),
 * falling back to spot once. If neither returns bars, we yield empty.
 *
 * Out of scope for v1:
 *   - Coin-margined perps (Binance dapi / Bybit inverse) — rare in the
 *     journal; route through spot fallback or surface as empty.
 *   - Exchanges other than Binance / Bybit / Hyperliquid — return
 *     `null` (caller maps to 404 UNSUPPORTED).
 *   - Pagination beyond ~1500 bars — for short windows + 5 % padding +
 *     auto-interval (1m / 5m / 15m / 1h), one request is enough.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type KlineInterval = '1m' | '5m' | '15m' | '1h';

export interface KlineBar {
  /** Bar open time, ms epoch. */
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Set of exchange codes we know how to fetch klines for. Mirror of the
 * `worker/csj_worker/adapters` registry — keep these in sync. Any exchange
 * not in this set returns null from `fetchKlines` and the API route maps
 * that to 404 UNSUPPORTED.
 */
export const KLINE_SUPPORTED_EXCHANGES = new Set([
  'binance',
  'bybit',
  'hyperliquid',
] as const);

export type KlineSupportedExchange = 'binance' | 'bybit' | 'hyperliquid';

export function isKlineSupportedExchange(
  exchange: string,
): exchange is KlineSupportedExchange {
  return KLINE_SUPPORTED_EXCHANGES.has(exchange as KlineSupportedExchange);
}

// ---------------------------------------------------------------------------
// Interval selection — mirrors `worker/csj_worker/excursions.py::select_bucket_interval`
// ---------------------------------------------------------------------------

/**
 * Pick a candle interval based on the trade duration. Identical thresholds
 * to the Python worker so the chart's bucket boundaries always match the
 * MAE/MFE backfill bars.
 *
 *   ≤ 1 day  → 1m  (~1440 bars)
 *   ≤ 7 day  → 5m  (~2016 bars)
 *   ≤ 30 day → 15m (~2880 bars)
 *   > 30 day → 1h  (≥ 720 bars)
 */
export function selectInterval(openedAt: Date, closedAt: Date): KlineInterval {
  const ms = closedAt.getTime() - openedAt.getTime();
  const days = ms / 86_400_000;
  if (days <= 1) return '1m';
  if (days <= 7) return '5m';
  if (days <= 30) return '15m';
  return '1h';
}

// ---------------------------------------------------------------------------
// Symbol normalization — the load-bearing piece
// ---------------------------------------------------------------------------

/**
 * Extract the base coin from a raw journal symbol.
 *
 * Examples:
 *   "BTC-PERP"        → "BTC"
 *   "BTC-USDC"        → "BTC"
 *   "BTC/USDT:USDT"   → "BTC"
 *   "BTCUSDT"         → "BTC"
 *   "btc"             → "BTC"
 *   "ETH"             → "ETH"
 *
 * Strips quote/settlement suffixes (USDT, USDC, USD), the "-PERP" sentinel
 * the wizard sometimes emits, and ccxt's "/QUOTE:SETTLE" form. Whatever's
 * left is the base coin.
 */
export function extractBaseCoin(rawSymbol: string): string {
  let s = rawSymbol.toUpperCase().trim();
  if (!s) return '';

  // ccxt perp form first ("BTC/USDT:USDT") — split on slash, take the head.
  if (s.includes('/')) {
    s = s.split('/', 1)[0];
  }
  // Wizard form ("BTC-PERP", "BTC-USDC")
  if (s.includes('-')) {
    s = s.split('-', 1)[0];
  }
  // Concatenated form ("BTCUSDT", "BTCUSDC", "BTCUSD")
  for (const quote of ['USDT', 'USDC', 'USD']) {
    if (s.endsWith(quote) && s.length > quote.length) {
      return s.slice(0, -quote.length);
    }
  }
  return s;
}

/**
 * Per-exchange symbol candidates: ordered list of strings to try against
 * that exchange's REST API. We try the perp form first, then the spot form.
 *
 * Each entry is `{ market, symbol }` — `market` tells the fetch dispatcher
 * which sub-endpoint to hit.
 *
 * Binance perp lives on `fapi.binance.com`; spot on `api.binance.com`.
 * Bybit uses categories on its v5 unified API.
 * Hyperliquid is perp-only, one endpoint.
 */
export type BinanceMarket = 'usdm' | 'spot';
export type BybitMarket = 'linear' | 'spot';

export interface BinanceCandidate {
  market: BinanceMarket;
  symbol: string;
}
export interface BybitCandidate {
  market: BybitMarket;
  symbol: string;
}

export function binanceCandidates(rawSymbol: string): BinanceCandidate[] {
  const base = extractBaseCoin(rawSymbol);
  if (!base) return [];
  // USDT-margined perp dominates retail; USDC perp is rare on Binance.
  // Spot ticker has the same string as the USDT perp.
  return [
    { market: 'usdm', symbol: `${base}USDT` },
    { market: 'spot', symbol: `${base}USDT` },
  ];
}

export function bybitCandidates(rawSymbol: string): BybitCandidate[] {
  const base = extractBaseCoin(rawSymbol);
  if (!base) return [];
  return [
    { market: 'linear', symbol: `${base}USDT` },
    { market: 'spot', symbol: `${base}USDT` },
  ];
}

export function hyperliquidCoin(rawSymbol: string): string {
  return extractBaseCoin(rawSymbol);
}

// ---------------------------------------------------------------------------
// Interval mapping per exchange (each venue uses slightly different strings)
// ---------------------------------------------------------------------------

const BINANCE_INTERVAL: Record<KlineInterval, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '1h': '1h',
};

const BYBIT_INTERVAL: Record<KlineInterval, string> = {
  // Bybit v5 uses minute-string for sub-hour, "60" for 1h, "D" for 1d.
  '1m': '1',
  '5m': '5',
  '15m': '15',
  '1h': '60',
};

const HYPERLIQUID_INTERVAL: Record<KlineInterval, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '1h': '1h',
};

// ---------------------------------------------------------------------------
// Fetch dispatcher
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 8_000;

/**
 * Top-level fetcher used by the API route. Dispatches by exchange code and
 * tries each candidate symbol in order until one returns non-empty bars.
 *
 * Returns:
 *   - non-empty bar array on success
 *   - empty array when every candidate came back empty (symbol mismatch /
 *     delisted / inverse coin-margined pair we don't try)
 *   - null when the exchange is unsupported (caller maps to 404 UNSUPPORTED)
 *
 * Network or 5xx errors propagate — the caller is responsible for logging /
 * a 502 status.
 */
export async function fetchKlines(
  exchange: string,
  rawSymbol: string,
  startMs: number,
  endMs: number,
  interval: KlineInterval,
): Promise<KlineBar[] | null> {
  if (!isKlineSupportedExchange(exchange)) return null;
  // Sanity-check the window — if start ≥ end, swap (bad seed data shouldn't
  // hang an HTTP call forever).
  const safeStart = Math.min(startMs, endMs);
  const safeEnd = Math.max(startMs, endMs);

  switch (exchange) {
    case 'binance':
      return fetchBinance(rawSymbol, safeStart, safeEnd, interval);
    case 'bybit':
      return fetchBybit(rawSymbol, safeStart, safeEnd, interval);
    case 'hyperliquid':
      return fetchHyperliquid(rawSymbol, safeStart, safeEnd, interval);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Binance
// ---------------------------------------------------------------------------

const BINANCE_HOSTS: Record<BinanceMarket, string> = {
  usdm: 'https://fapi.binance.com/fapi/v1/klines',
  spot: 'https://api.binance.com/api/v3/klines',
};

async function fetchBinance(
  rawSymbol: string,
  startMs: number,
  endMs: number,
  interval: KlineInterval,
): Promise<KlineBar[]> {
  const candidates = binanceCandidates(rawSymbol);
  for (const candidate of candidates) {
    const url = new URL(BINANCE_HOSTS[candidate.market]);
    url.searchParams.set('symbol', candidate.symbol);
    url.searchParams.set('interval', BINANCE_INTERVAL[interval]);
    url.searchParams.set('startTime', String(startMs));
    url.searchParams.set('endTime', String(endMs));
    url.searchParams.set('limit', '1500');

    const bars = await safeFetchJson<unknown[]>(url.toString());
    if (!bars || !Array.isArray(bars) || bars.length === 0) continue;
    return parseBinanceBars(bars);
  }
  return [];
}

/**
 * Binance kline row format (array, not object):
 *   [ openTime, open, high, low, close, volume, closeTime, ... ]
 * with numeric fields as strings.
 */
function parseBinanceBars(raw: unknown[]): KlineBar[] {
  const out: KlineBar[] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const bar = parseBarTuple(row[0], row[1], row[2], row[3], row[4], row[5]);
    if (bar) out.push(bar);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Bybit
// ---------------------------------------------------------------------------

const BYBIT_HOST = 'https://api.bybit.com/v5/market/kline';

async function fetchBybit(
  rawSymbol: string,
  startMs: number,
  endMs: number,
  interval: KlineInterval,
): Promise<KlineBar[]> {
  const candidates = bybitCandidates(rawSymbol);
  for (const candidate of candidates) {
    const url = new URL(BYBIT_HOST);
    url.searchParams.set('category', candidate.market);
    url.searchParams.set('symbol', candidate.symbol);
    url.searchParams.set('interval', BYBIT_INTERVAL[interval]);
    url.searchParams.set('start', String(startMs));
    url.searchParams.set('end', String(endMs));
    url.searchParams.set('limit', '1000');

    const json = await safeFetchJson<BybitKlineResponse>(url.toString());
    if (!json || json.retCode !== 0) continue;
    const list = json.result?.list;
    if (!Array.isArray(list) || list.length === 0) continue;
    return parseBybitBars(list);
  }
  return [];
}

interface BybitKlineResponse {
  retCode: number;
  retMsg?: string;
  result?: {
    list?: unknown[][];
    category?: string;
    symbol?: string;
  };
}

/**
 * Bybit v5 kline rows: [ start, open, high, low, close, volume, turnover ],
 * all as strings. Bybit returns rows DESCENDING (newest first) — we sort
 * ascending after parsing so the chart library doesn't choke.
 */
function parseBybitBars(raw: unknown[][]): KlineBar[] {
  const out: KlineBar[] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const bar = parseBarTuple(row[0], row[1], row[2], row[3], row[4], row[5]);
    if (bar) out.push(bar);
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

// ---------------------------------------------------------------------------
// Hyperliquid
// ---------------------------------------------------------------------------

const HYPERLIQUID_HOST = 'https://api.hyperliquid.xyz/info';

async function fetchHyperliquid(
  rawSymbol: string,
  startMs: number,
  endMs: number,
  interval: KlineInterval,
): Promise<KlineBar[]> {
  const coin = hyperliquidCoin(rawSymbol);
  if (!coin) return [];
  const body = {
    type: 'candleSnapshot',
    req: {
      coin,
      interval: HYPERLIQUID_INTERVAL[interval],
      startTime: startMs,
      endTime: endMs,
    },
  };
  const raw = await safePostJson<unknown[]>(HYPERLIQUID_HOST, body);
  if (!raw || !Array.isArray(raw)) return [];
  return parseHyperliquidBars(raw);
}

/**
 * Hyperliquid candle: { t, T, s, i, o, h, l, c, v } where t is open ts (ms)
 * and o/h/l/c/v are strings.
 */
function parseHyperliquidBars(raw: unknown[]): KlineBar[] {
  const out: KlineBar[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const obj = row as {
      t?: unknown;
      o?: unknown;
      h?: unknown;
      l?: unknown;
      c?: unknown;
      v?: unknown;
    };
    const bar = parseBarTuple(obj.t, obj.o, obj.h, obj.l, obj.c, obj.v);
    if (bar) out.push(bar);
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

// ---------------------------------------------------------------------------
// Shared parsing helper — coerce mixed-type kline tuples into a clean shape
// ---------------------------------------------------------------------------

function parseBarTuple(
  ts: unknown,
  open: unknown,
  high: unknown,
  low: unknown,
  close: unknown,
  volume: unknown,
): KlineBar | null {
  const tsN = numLike(ts);
  const o = numLike(open);
  const h = numLike(high);
  const l = numLike(low);
  const c = numLike(close);
  const v = numLike(volume) ?? 0;
  if (
    tsN === null ||
    o === null ||
    h === null ||
    l === null ||
    c === null ||
    !Number.isFinite(tsN) ||
    !Number.isFinite(o) ||
    !Number.isFinite(h) ||
    !Number.isFinite(l) ||
    !Number.isFinite(c)
  ) {
    return null;
  }
  return { ts: tsN, open: o, high: h, low: l, close: c, volume: v };
}

function numLike(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === 'bigint') return Number(v);
  return null;
}

// ---------------------------------------------------------------------------
// Network helpers
// ---------------------------------------------------------------------------

async function safeFetchJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      // Public klines never need credentials; explicitly mark to keep CF/edges happy.
      headers: { Accept: 'application/json' },
      // Next.js 16: `cache: 'no-store'` skips the framework cache. Wrap the
      // caller in `unstable_cache` so the framework caches the wider response.
      cache: 'no-store',
    });
    if (!res.ok) {
      // 400 on Binance means symbol mismatch — return null so the dispatcher
      // tries the next candidate. 4xx anywhere else is also "no data".
      if (res.status >= 400 && res.status < 500) return null;
      throw new Error(`kline fetch ${url}: HTTP ${res.status}`);
    }
    const json = (await res.json()) as T;
    return json;
  } finally {
    clearTimeout(timer);
  }
}

async function safePostJson<T>(url: string, body: unknown): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    if (!res.ok) {
      if (res.status >= 400 && res.status < 500) return null;
      throw new Error(`kline POST ${url}: HTTP ${res.status}`);
    }
    const json = (await res.json()) as T;
    return json;
  } finally {
    clearTimeout(timer);
  }
}
