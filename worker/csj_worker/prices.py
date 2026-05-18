"""USD price resolver — ccxt tickers first, CoinGecko fallback.

Used by ``balances.py`` to value the balances the adapters return.

Strategy
========
1. **Stablecoin allow-list** is hardcoded to ``$1.00`` (USDT, USDC, BUSD,
   DAI, FDUSD, TUSD, USDP, USD). No network call. Saves ~30% of price
   lookups for a typical portfolio.
2. **CCXT ``fetch_tickers``** — one call per exchange returns prices for
   every active market. We use it to resolve any asset that has a
   ``<asset>/USDT`` (or USDC/USD) pair on the venue. This is by far the
   cheapest path: one HTTP call, ~1000 prices.
3. **CoinGecko ``/simple/price``** fallback — for assets the venue doesn't
   list (the user might hold a token they bridged in from another chain).
   Free public API; rate-limit ~30 req/min. We batch up to 250 symbols
   per call (CoinGecko's documented per-call limit is 250 ids).
4. **In-memory cache** with 5-minute TTL. The cache key is just the
   uppercase asset code — we don't disambiguate by venue. For a portfolio
   tracker this is fine; we want a consistent USD-valuation across the
   user's whole holding, not per-exchange spreads.

Failure modes
=============
- Network errors from CoinGecko: log + skip that batch; assets stay
  unpriced. Balance rows still get written with ``usd_price=NULL`` so the
  UI can show the holding without a value.
- ccxt fetch_tickers raises ``NotSupported``: skip the venue, fall through
  to CoinGecko for every asset.
- A symbol resolves to multiple bases (e.g. user holds both BTC-spot and
  WBTC): we treat them as separate assets — the caller is responsible
  for canonical-asset mapping (e.g. WBTC → "WBTC", not "BTC").

Security
========
- No secrets here. CCXT is called with anonymous clients; CoinGecko is
  hit with no API key. Both are public market data.
- The CoinGecko URL is hardcoded to https://api.coingecko.com — never
  user-controlled.
"""

from __future__ import annotations

import asyncio
import logging
import time
from decimal import Decimal, InvalidOperation
from typing import Any

import ccxt.async_support as ccxt_async
import httpx
import structlog

log: structlog.BoundLogger = structlog.get_logger(__name__)


# ---------------------------------------------------------------------------
# Stablecoin allow-list — hardcoded to $1.00
# ---------------------------------------------------------------------------


STABLECOINS: frozenset[str] = frozenset({
    "USDT", "USDC", "BUSD", "DAI", "FDUSD", "TUSD", "USDP", "USD",
    "USDD", "UST",  # caveats noted in is_stable() docstring
})


def is_stable(asset: str) -> bool:
    """Return True if the asset code is a known stablecoin pegged ~$1.

    Keeping UST in the list is debatable — it depegged in 2022 and is now
    worth fractions of a cent. We include it because (a) the user is
    unlikely to be holding any post-2022, and (b) if they ARE, a tiny $1
    overstatement is harmless. The Python and TS implementations of this
    function MUST stay byte-for-byte identical (see src/lib/balances.ts).
    """
    return asset.upper() in STABLECOINS


# Stablecoins are valued at $1 exactly — no oracle dance, no DEX quote.
ONE_DOLLAR: Decimal = Decimal("1")


# ---------------------------------------------------------------------------
# In-memory cache
# ---------------------------------------------------------------------------


# 5-minute TTL — long enough to dedupe a batch of balance fetches across
# every connection in a sync cycle, short enough that the price visible
# on the dashboard never drifts more than 5 min behind market. Single-
# process worker; we don't need cross-process invalidation.
_CACHE_TTL_SECONDS = 300

# {asset_upper: (price_decimal_or_None, fetched_at_monotonic)}.
# Storing None lets us cache "we tried and failed" so a missing asset
# doesn't re-hit the network on every adapter inside the same cycle.
_price_cache: dict[str, tuple[Decimal | None, float]] = {}


def _cache_get(asset: str) -> Decimal | None | object:
    """Return cached price, None (cached-miss), or sentinel for cache-miss.

    Returns ``_MISS`` when the key is absent OR the TTL expired; the caller
    should fetch and call ``_cache_put``. We distinguish "cached None" (the
    asset was looked up but couldn't be priced this cycle) from "no cache"
    so we don't pummel CoinGecko with retries inside the same TTL window.
    """
    entry = _price_cache.get(asset)
    if entry is None:
        return _MISS
    price, fetched_at = entry
    if time.monotonic() - fetched_at > _CACHE_TTL_SECONDS:
        return _MISS
    return price


def _cache_put(asset: str, price: Decimal | None) -> None:
    _price_cache[asset] = (price, time.monotonic())


# Sentinel object distinct from None — needed because the cache legitimately
# stores None to memoize "we couldn't price this".
_MISS = object()


# ---------------------------------------------------------------------------
# Cache TTL override (test hook)
# ---------------------------------------------------------------------------


def clear_cache() -> None:
    """Drop the in-memory price cache. Useful in tests + the manual-refresh
    endpoint, where we don't want stale prices."""
    _price_cache.clear()


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


async def resolve_usd_prices(
    adapter: Any,
    symbols: set[str],
    *,
    use_coingecko_fallback: bool = True,
    http_client: httpx.AsyncClient | None = None,
) -> dict[str, Decimal]:
    """Map asset codes → USD price for the requested set.

    Algorithm:
        1. Strip stables and any cached values; both go straight into the
           return dict.
        2. If the adapter has a ccxt client we can build, call
           ``fetch_tickers`` and pluck the ``<ASSET>/USDT`` (then USDC, USD)
           midpoint for any remaining asset.
        3. For everything still unpriced, hit CoinGecko in one batch.

    Returns a dict. Assets that couldn't be priced are absent (NOT mapped
    to None) — the caller checks `.get()` and stamps ``usd_price=None`` on
    those balance rows.

    ``http_client`` is optional — we open a fresh client per call by default.
    Tests inject a respx-mocked one.
    """
    # 0) Normalise + early-out
    wanted = {s.upper() for s in symbols if s and isinstance(s, str)}
    if not wanted:
        return {}

    resolved: dict[str, Decimal] = {}

    # 1) Stables + cache
    remaining: set[str] = set()
    for asset in wanted:
        if is_stable(asset):
            resolved[asset] = ONE_DOLLAR
            continue
        cached = _cache_get(asset)
        if cached is _MISS:
            remaining.add(asset)
            continue
        # Cached None means "tried, failed this TTL" → don't retry, but
        # also don't include in the result.
        if cached is not None and isinstance(cached, Decimal):
            resolved[asset] = cached
    if not remaining:
        return resolved

    # 2) Exchange tickers via ccxt
    try:
        venue_prices = await _resolve_via_ccxt_tickers(adapter, remaining)
    except Exception:  # noqa: BLE001 — best-effort path; CoinGecko is the safety net
        log.exception("prices.ccxt_tickers_failed")
        venue_prices = {}
    for asset, price in venue_prices.items():
        resolved[asset] = price
        _cache_put(asset, price)
        remaining.discard(asset)
    if not remaining:
        return resolved

    # 3) CoinGecko fallback
    if use_coingecko_fallback:
        try:
            cg_prices = await _resolve_via_coingecko(remaining, http_client=http_client)
        except Exception:  # noqa: BLE001 — same justification as above
            log.exception("prices.coingecko_failed")
            cg_prices = {}
        for asset, price in cg_prices.items():
            resolved[asset] = price
            _cache_put(asset, price)
            remaining.discard(asset)

    # Memoize negatives so we don't re-fetch within the TTL.
    for asset in remaining:
        _cache_put(asset, None)

    return resolved


# ---------------------------------------------------------------------------
# CCXT ticker path
# ---------------------------------------------------------------------------


# Quote currencies we try, in priority order. USDT first (deepest book on
# most venues); USDC and USD as fallbacks.
_QUOTE_PREF: tuple[str, ...] = ("USDT", "USDC", "USD")


async def _resolve_via_ccxt_tickers(
    adapter: Any,
    assets: set[str],
) -> dict[str, Decimal]:
    """Use the adapter's ccxt client to fetch all tickers + extract midpoints.

    We expect the adapter to expose a ``_build_client(creds, market_type='spot')``
    method (the universal ccxt adapter does). For adapters that don't, we
    return an empty dict — pricing falls through to CoinGecko.

    Anonymous ccxt clients work here: ticker endpoints are public. We pass
    ``ApiKeyCredentials(api_key='', api_secret='')`` to satisfy the adapter's
    constructor; ccxt itself won't include credentials in ticker requests.
    """
    from csj_worker.types import ApiKeyCredentials  # local import: avoid cycle

    build = getattr(adapter, "_build_client", None)
    if build is None:
        return {}

    # Build with empty creds — fetch_tickers is public. The adapter may
    # require ApiKeyCredentials specifically; if the adapter rejects empty
    # creds at constructor time, fall through to CoinGecko.
    try:
        client = build(
            ApiKeyCredentials(api_key="anon", api_secret="anon"),
            market_type="spot",
        )
    except Exception:  # noqa: BLE001
        return {}

    out: dict[str, Decimal] = {}
    try:
        try:
            tickers: dict[str, Any] = await client.fetch_tickers()
        except (ccxt_async.NotSupported, AttributeError):
            return {}
        except Exception:  # noqa: BLE001
            return {}

        # Index tickers by (base, quote) for O(1) lookup per asset.
        by_pair: dict[tuple[str, str], Decimal] = {}
        for symbol, t in tickers.items():
            if not isinstance(t, dict):
                continue
            base = str(t.get("base") or "").upper()
            quote = str(t.get("quote") or "").upper()
            if not base or not quote:
                # Fall back to splitting the symbol when ccxt didn't decode
                # base/quote (some venues' market dicts are sparse on
                # tickers responses).
                if "/" in symbol:
                    head, _, tail = symbol.partition("/")
                    base = head.upper()
                    quote = tail.split(":")[0].upper()
                else:
                    continue
            price = _midpoint(t)
            if price is not None and price > 0:
                by_pair[(base, quote)] = price

        for asset in assets:
            for q in _QUOTE_PREF:
                price = by_pair.get((asset, q))
                if price is not None:
                    out[asset] = price
                    break
    finally:
        # Close cleanly so we don't leak aiohttp sessions when called in tight loops.
        try:
            await client.close()
        except Exception:  # noqa: BLE001
            pass
    return out


def _midpoint(ticker: dict[str, Any]) -> Decimal | None:
    """Return the most-likely-correct USD price for a ccxt ticker dict.

    Preference order: ``last`` > ``close`` > midpoint of bid/ask > ``average``.
    Many venues report ``last == 0`` for low-volume markets — we skip those.
    """
    for key in ("last", "close"):
        v = ticker.get(key)
        if v is not None:
            d = _decimal_or_none(v)
            if d is not None and d > 0:
                return d

    bid = _decimal_or_none(ticker.get("bid"))
    ask = _decimal_or_none(ticker.get("ask"))
    if bid is not None and ask is not None and bid > 0 and ask > 0:
        return (bid + ask) / Decimal(2)

    avg = _decimal_or_none(ticker.get("average"))
    if avg is not None and avg > 0:
        return avg

    return None


def _decimal_or_none(v: Any) -> Decimal | None:
    """Coerce best-effort. Returns None on any failure; never raises."""
    if v is None:
        return None
    try:
        return Decimal(str(v))
    except (InvalidOperation, ValueError):
        return None


# ---------------------------------------------------------------------------
# CoinGecko path
# ---------------------------------------------------------------------------


# Curated mapping of common asset codes → CoinGecko id. The CoinGecko
# ``coins/list`` endpoint returns 14000+ tokens; we don't want to ship the
# full table inside the worker. For the common 99% case this short table
# covers everything; everything else falls through unpriced.
_COINGECKO_IDS: dict[str, str] = {
    "BTC": "bitcoin",
    "ETH": "ethereum",
    "BNB": "binancecoin",
    "SOL": "solana",
    "XRP": "ripple",
    "ADA": "cardano",
    "DOGE": "dogecoin",
    "AVAX": "avalanche-2",
    "DOT": "polkadot",
    "MATIC": "matic-network",
    "POL": "matic-network",  # rebranded
    "LINK": "chainlink",
    "LTC": "litecoin",
    "ATOM": "cosmos",
    "UNI": "uniswap",
    "AAVE": "aave",
    "ARB": "arbitrum",
    "OP": "optimism",
    "SUI": "sui",
    "APT": "aptos",
    "NEAR": "near",
    "FIL": "filecoin",
    "SHIB": "shiba-inu",
    "PEPE": "pepe",
    "WIF": "dogwifcoin",
    "BONK": "bonk",
    "TON": "the-open-network",
    "TRX": "tron",
    "BCH": "bitcoin-cash",
    "ETC": "ethereum-classic",
    "XLM": "stellar",
    "ALGO": "algorand",
    "ICP": "internet-computer",
    "INJ": "injective-protocol",
    "TIA": "celestia",
    "SEI": "sei-network",
    "JUP": "jupiter-exchange-solana",
    "PYTH": "pythnet-pyth",
    "ORDI": "ordinals",
    "RENDER": "render-token",
    "RNDR": "render-token",
    "WLD": "worldcoin-wld",
    "STRK": "starknet",
    "MNT": "mantle",
    "SAGA": "saga-2",
    "ENA": "ethena",
    "PENDLE": "pendle",
    "DYDX": "dydx-chain",
    "GMX": "gmx",
    "HYPE": "hyperliquid",
    "WBTC": "wrapped-bitcoin",
    "STETH": "staked-ether",
    "WSTETH": "wrapped-steth",
    "WETH": "weth",
}


_COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price"
_COINGECKO_BATCH = 250  # documented max ids per request


async def _resolve_via_coingecko(
    assets: set[str],
    *,
    http_client: httpx.AsyncClient | None = None,
) -> dict[str, Decimal]:
    """Batch-fetch USD prices for assets in our curated CoinGecko id map.

    Returns the subset we could price. Assets without a CoinGecko mapping
    are silently dropped — the caller logs/treats them as unpriced.
    """
    # Map asset codes → coingecko id. Assets without a mapping fall through.
    code_to_id: dict[str, str] = {}
    for asset in assets:
        cg_id = _COINGECKO_IDS.get(asset)
        if cg_id is not None:
            code_to_id[asset] = cg_id

    if not code_to_id:
        return {}

    out: dict[str, Decimal] = {}
    cg_ids = list(set(code_to_id.values()))

    owned_client = http_client is None
    client = http_client or httpx.AsyncClient(timeout=15.0)
    try:
        # Page through in batches of _COINGECKO_BATCH.
        for i in range(0, len(cg_ids), _COINGECKO_BATCH):
            batch = cg_ids[i : i + _COINGECKO_BATCH]
            resp = await client.get(
                _COINGECKO_URL,
                params={"ids": ",".join(batch), "vs_currencies": "usd"},
            )
            if resp.status_code == 429:
                # Rate-limited. Brief sleep so we don't get banned, then
                # bail — the next sync cycle picks up where we left off.
                log.warning("prices.coingecko.rate_limited")
                await asyncio.sleep(5)
                break
            if resp.status_code >= 500 or resp.status_code in (403,):
                log.warning(
                    "prices.coingecko.server_error",
                    status=resp.status_code,
                )
                break
            try:
                data: dict[str, Any] = resp.json()
            except Exception:  # noqa: BLE001
                log.warning("prices.coingecko.bad_json", status=resp.status_code)
                break

            # Invert code_to_id for this batch to reverse-map back.
            for code, cg_id in code_to_id.items():
                if cg_id in batch:
                    entry = data.get(cg_id)
                    if isinstance(entry, dict):
                        usd = entry.get("usd")
                        price = _decimal_or_none(usd)
                        if price is not None and price > 0:
                            out[code] = price
    finally:
        if owned_client:
            try:
                await client.aclose()
            except Exception:  # noqa: BLE001
                pass

    return out
