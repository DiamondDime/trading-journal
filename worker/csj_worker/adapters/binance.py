"""Binance exchange adapter.

Design notes
============

Why ccxt?
---------
ccxt handles Binance's HMAC-SHA256 request signing, server-time synchronisation,
response parsing, and the quirks between the three sub-APIs (spot, USD-M futures,
coin-margined futures).  We wrap it with our own pagination/error-mapping so the
rest of the worker only deals with canonical types.

Three sub-clients
-----------------
Binance exposes three independent HTTP APIs under one brand:

| ccxt exchange id  | Market               | Instruments           |
|-------------------|----------------------|-----------------------|
| ``binance``       | Spot / margin        | SPOT (BTC/USDT …)     |
| ``binanceusdm``   | USD-M futures        | USDT-margined perps   |
| ``binancecoinm``  | Coin-M futures       | Coin-margined perps   |

``connect()`` opens all three; ``fetch_fills()`` multiplexes queries across them
and yields pages from each sub-client in sequence (spot first, then USD-M, then
coin-M).  The callers' streaming pipeline does not need to know about the split.

Pagination cursor strategy
--------------------------
Binance trade-history endpoints are paginated by a numeric trade ID (``fromId``
parameter) rather than by time or an opaque cursor.

Algorithm:
1. On the first request pass ``startTime`` / ``endTime`` as epoch-milliseconds to
   bound the window; Binance returns the earliest N trades in that window.
2. Record ``last_id = max(trade["id"] for trade in page)``.
3. On subsequent requests pass ``fromId = last_id + 1``.  Do NOT also pass
   ``startTime`` — Binance ignores ``startTime`` when ``fromId`` is present.
4. Stop when the response is empty or every trade's timestamp exceeds ``until``.

Funding history uses a similar approach via ``startTime`` / ``endTime`` and
``incomeType=FUNDING_FEE``, paged by ``limit`` (max 1000) until response < limit.

Permission check
----------------
``connect()`` calls ``fetch_balance({'type': 'future'})`` on the USD-M sub-client
(the lightest authenticated call that exercises the key across futures perms).
ccxt surfaces Binance's account info in the ``info`` dict; we check ``canWithdraw``
and reject the credentials immediately if it is truthy.

Rate-limit budget
-----------------
Binance USD-M: 2400 request-weight / minute.  Private trade-history endpoints
consume 5–20 weight units each.  We cap at 10 req/s (600 req/min), leaving 75 %+
headroom.  On HTTP 429 / ccxt ``RateLimitExceeded`` we wait ``retry_after`` seconds
(Binance always includes ``Retry-After``); on -1003 (ban) we back off 60 s minimum.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

import ccxt.async_support as ccxt_async
import structlog

from csj_worker.adapters.base import (
    AdapterAuthError,
    AdapterExchangeDownError,
    AdapterInvalidDataError,
    AdapterNetworkError,
    AdapterPermissionError,
    AdapterRateLimitedError,
    AdapterUnsupportedError,
    ExchangeAdapter,
)
from csj_worker.types import (
    AdapterCapabilities,
    AdapterErrorCode,
    ApiKeyCredentials,
    AuthMode,
    CanonicalFill,
    CanonicalFundingEvent,
    CanonicalInstrument,
    CanonicalPosition,
    ConnectionHealth,
    ConnectionStatusResult,
    Credentials,
    Exchange,
    ExchangeKind,
    FeeKind,
    FundingDirection,
    InstrumentKind,
    PositionSide,
    RateLimitPolicy,
    RetryPolicy,
    Side,
)

log: structlog.BoundLogger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_PAGE_SIZE = 1000  # Binance max trades per request
_MAX_FUNDING_PAGE = 1000  # Binance max funding records per request
_RATE_LIMIT: RateLimitPolicy = RateLimitPolicy(
    requests_per_second=10.0,
    burst=20,
    cooloff_seconds=60,
)
_MIN_BAN_BACKOFF_SECONDS = 60.0
_SERVER_TIME_SKEW_WARN_SECONDS = 300  # 5 min


# ---------------------------------------------------------------------------
# Helper: build sub-clients
# ---------------------------------------------------------------------------


def _build_clients(creds: ApiKeyCredentials) -> dict[str, ccxt_async.Exchange]:
    """Return the three ccxt sub-clients keyed by market type."""
    common: dict[str, Any] = {
        "apiKey": creds.api_key,
        "secret": creds.api_secret,
        "enableRateLimit": False,  # we handle rate limiting ourselves
        "options": {"defaultType": "spot"},
    }
    spot = ccxt_async.binance({**common, "options": {"defaultType": "spot"}})
    usdm = ccxt_async.binanceusdm({**common, "options": {"defaultType": "future"}})
    coinm = ccxt_async.binancecoinm({**common, "options": {"defaultType": "delivery"}})
    return {"spot": spot, "usdm": usdm, "coinm": coinm}


# ---------------------------------------------------------------------------
# Error mapping
# ---------------------------------------------------------------------------


def _map_ccxt_error(exc: Exception) -> Exception:
    """Convert ccxt exceptions into our adapter error hierarchy."""
    if isinstance(exc, ccxt_async.AuthenticationError):
        return AdapterAuthError(str(exc), cause=exc)
    if isinstance(exc, ccxt_async.PermissionDenied):
        return AdapterPermissionError(str(exc), cause=exc)
    if isinstance(exc, ccxt_async.RateLimitExceeded):
        # Try to extract Retry-After from the message.
        retry_after = _parse_retry_after(str(exc))
        return AdapterRateLimitedError(str(exc), retry_after=retry_after, cause=exc)
    if isinstance(exc, ccxt_async.NetworkError):
        return AdapterNetworkError(str(exc), cause=exc)
    if isinstance(exc, ccxt_async.ExchangeNotAvailable):
        return AdapterExchangeDownError(str(exc), cause=exc)
    if isinstance(exc, ccxt_async.ExchangeError):
        # Surface unclassified exchange errors as network-retryable if they look
        # transient; otherwise let them bubble as-is for callers.
        msg = str(exc)
        if "-1003" in msg:  # IP banned
            return AdapterRateLimitedError(
                f"Binance IP ban (-1003): {msg}",
                retry_after=_MIN_BAN_BACKOFF_SECONDS,
                cause=exc,
            )
        if "-1021" in msg:  # Timestamp out of range
            return AdapterAuthError(
                f"Binance timestamp error (-1021) — check system clock: {msg}",
                cause=exc,
            )
        return AdapterNetworkError(f"Unclassified exchange error: {msg}", cause=exc)
    return exc  # Unknown — let propagate


def _parse_retry_after(msg: str) -> float | None:
    """Attempt to extract a seconds value from a rate-limit error message."""
    import re

    m = re.search(r"retry.after[:\s]+(\d+)", msg, re.IGNORECASE)
    if m:
        return float(m.group(1))
    return None


# ---------------------------------------------------------------------------
# Symbol normalization
# ---------------------------------------------------------------------------

_CCXT_SYMBOL_KIND: dict[str, InstrumentKind] = {
    "spot": InstrumentKind.SPOT,
    "swap": InstrumentKind.PERP,
    "future": InstrumentKind.DATED_FUTURE,
}


def _normalize_symbol(
    ccxt_symbol: str,
    market_info: dict[str, Any],
    exchange: Exchange,
) -> CanonicalInstrument:
    """Convert ccxt market descriptor to CanonicalInstrument.

    ccxt symbol examples:
        'BTC/USDT'          → spot BTC/USDT
        'BTC/USDT:USDT'     → USDT-margined perp
        'BTC/USD:BTC'       → coin-margined perp (BTC-settled)
    """
    mtype: str = market_info.get("type", "spot")
    kind = _CCXT_SYMBOL_KIND.get(mtype, InstrumentKind.SPOT)

    base: str = market_info.get("base", "")
    quote: str = market_info.get("quote", "")

    expiry: datetime | None = None
    if kind == InstrumentKind.DATED_FUTURE:
        expiry_ts = market_info.get("expiry")
        if expiry_ts is not None:
            expiry = datetime.fromtimestamp(expiry_ts / 1000.0, tz=timezone.utc)

    return CanonicalInstrument(
        exchange=exchange,
        kind=kind,
        base=base.upper(),
        quote=quote.upper(),
        expiry=expiry,
        raw_symbol=ccxt_symbol,
    )


# ---------------------------------------------------------------------------
# Decimal helper
# ---------------------------------------------------------------------------


def _to_decimal(value: Any, field: str) -> Decimal:
    """Convert any numeric-ish value to Decimal; raise AdapterInvalidDataError on failure."""
    if value is None:
        raise AdapterInvalidDataError(f"Missing required numeric field: {field}")
    try:
        return Decimal(str(value))
    except InvalidOperation as exc:
        raise AdapterInvalidDataError(
            f"Cannot convert {field!r}={value!r} to Decimal"
        ) from exc


# ---------------------------------------------------------------------------
# Fill parsing
# ---------------------------------------------------------------------------


def _parse_fill(
    raw: dict[str, Any],
    instrument: CanonicalInstrument,
) -> CanonicalFill:
    """Parse a single ccxt trade dict into a CanonicalFill."""
    trade_id = raw.get("id")
    if trade_id is None:
        raise AdapterInvalidDataError("Trade missing 'id' field")

    order_id = raw.get("order")
    side_str = raw.get("side", "")
    side = Side.BUY if side_str == "buy" else Side.SELL

    is_maker: bool = bool(raw.get("takerOrMaker") == "maker")
    fee_kind = FeeKind.MAKER if is_maker else FeeKind.TAKER

    fee_info: dict[str, Any] = raw.get("fee") or {}
    fee_cost = _to_decimal(fee_info.get("cost", "0"), "fee.cost")
    fee_currency = str(fee_info.get("currency") or "USDT")

    ts = raw.get("timestamp")
    if ts is None:
        raise AdapterInvalidDataError("Trade missing 'timestamp' field")
    filled_at = datetime.fromtimestamp(ts / 1000.0, tz=timezone.utc)

    qty = _to_decimal(raw.get("amount"), "amount")
    price = _to_decimal(raw.get("price"), "price")
    notional = _to_decimal(raw.get("cost") or (qty * price), "cost")

    return CanonicalFill(
        external_trade_id=str(trade_id),
        external_order_id=str(order_id) if order_id is not None else None,
        instrument=instrument,
        side=side,
        qty=qty,
        price=price,
        notional=notional,
        fee=fee_cost,
        fee_currency=fee_currency,
        fee_kind=fee_kind,
        is_maker=is_maker,
        liquidity="maker" if is_maker else "taker",
        filled_at=filled_at,
        raw=raw,
    )


# ---------------------------------------------------------------------------
# Funding event parsing
# ---------------------------------------------------------------------------


def _parse_funding_event(
    raw: dict[str, Any],
    exchange: Exchange,
    markets: dict[str, Any],
) -> CanonicalFundingEvent:
    """Parse a single ccxt funding income dict into CanonicalFundingEvent.

    ccxt funding record shape (from fetch_income_history / fetch_funding_history):
        {
            "symbol":  "BTC/USDT:USDT",
            "code":    "USDT",
            "timestamp": 1715760000000,
            "amount":  -0.12345678,
            "info":    {...raw binance dict...},
        }
    """
    symbol: str = raw.get("symbol", "")
    market_info: dict[str, Any] = markets.get(symbol, {})

    # Fallback: build a minimal market_info from the symbol string
    if not market_info:
        parts = symbol.replace(":USDT", "").replace(":BTC", "").split("/")
        base = parts[0] if parts else "UNKNOWN"
        quote = parts[1] if len(parts) > 1 else "USDT"
        market_info = {"base": base, "quote": quote, "type": "swap"}

    instrument = _normalize_symbol(symbol, market_info, exchange)

    ts = raw.get("timestamp")
    if ts is None:
        raise AdapterInvalidDataError("Funding event missing 'timestamp'")
    occurred_at = datetime.fromtimestamp(ts / 1000.0, tz=timezone.utc)

    amount_raw = _to_decimal(raw.get("amount", 0), "amount")
    direction = FundingDirection.RECEIVED if amount_raw >= Decimal(0) else FundingDirection.PAID
    amount = abs(amount_raw)

    # ccxt doesn't expose funding rate or position qty in the income record —
    # those are in the raw Binance dict under raw["info"].
    info: dict[str, Any] = raw.get("info") or {}
    funding_rate_raw = info.get("fundingRate", "0") or "0"
    position_qty_raw = info.get("positionAmt", "0") or "0"

    funding_rate = _to_decimal(funding_rate_raw, "fundingRate")
    position_qty = abs(_to_decimal(position_qty_raw, "positionAmt"))

    external_id = str(info.get("tranId", "")) or None

    return CanonicalFundingEvent(
        instrument=instrument,
        direction=direction,
        funding_rate=funding_rate,
        position_qty=position_qty,
        amount=amount,
        amount_currency=str(raw.get("code") or "USDT"),
        occurred_at=occurred_at,
        external_id=external_id,
        raw=raw,
    )


# ---------------------------------------------------------------------------
# Position parsing
# ---------------------------------------------------------------------------


def _parse_position(
    raw: dict[str, Any],
    exchange: Exchange,
    markets: dict[str, Any],
) -> CanonicalPosition | None:
    """Parse a ccxt position dict into CanonicalPosition.

    Returns None for zero-size positions (Binance always returns all symbols).
    """
    qty_raw: Any = raw.get("contracts") or raw.get("info", {}).get("positionAmt", "0")
    qty = _to_decimal(qty_raw, "contracts")
    if qty == Decimal(0):
        return None

    symbol: str = raw.get("symbol", "")
    market_info: dict[str, Any] = markets.get(symbol, {})
    if not market_info:
        parts = symbol.replace(":USDT", "").replace(":BTC", "").split("/")
        base = parts[0] if parts else "UNKNOWN"
        quote = parts[1] if len(parts) > 1 else "USDT"
        market_info = {"base": base, "quote": quote, "type": "swap"}

    instrument = _normalize_symbol(symbol, market_info, exchange)

    side_str: str = str(raw.get("side") or "long").lower()
    side = PositionSide.LONG if side_str in ("long", "buy") else PositionSide.SHORT

    entry_price = _to_decimal(raw.get("entryPrice") or 0, "entryPrice")
    unrealized_pnl_raw = raw.get("unrealizedPnl")
    mark_price_raw = raw.get("markPrice")
    leverage_raw = raw.get("leverage")
    liq_price_raw = raw.get("liquidationPrice")

    return CanonicalPosition(
        external_position_id=None,
        instrument=instrument,
        side=side,
        qty_open=abs(qty),
        avg_entry_price=entry_price,
        unrealized_pnl=_to_decimal(unrealized_pnl_raw, "unrealizedPnl")
        if unrealized_pnl_raw is not None
        else None,
        mark_price=_to_decimal(mark_price_raw, "markPrice")
        if mark_price_raw is not None
        else None,
        leverage=_to_decimal(leverage_raw, "leverage") if leverage_raw is not None else None,
        liquidation_price=_to_decimal(liq_price_raw, "liquidationPrice")
        if liq_price_raw is not None
        else None,
        raw=raw,
    )


# ---------------------------------------------------------------------------
# Main adapter class
# ---------------------------------------------------------------------------


class BinanceAdapter(ExchangeAdapter):
    """Binance exchange adapter — spot, USD-M perp, coin-M perp.

    Stateless: every public method receives ``Credentials`` and builds ephemeral
    ccxt sub-clients.  The adapter object itself holds no session state.
    """

    exchange: Exchange = Exchange.BINANCE
    exchange_kind: ExchangeKind = ExchangeKind.CEX
    auth_mode: AuthMode = AuthMode.API_KEY
    capabilities: AdapterCapabilities = AdapterCapabilities(
        exchange=Exchange.BINANCE,
        exchange_kind=ExchangeKind.CEX,
        auth_mode=AuthMode.API_KEY,
        supports_spot=True,
        supports_perp=True,
        supports_dated_futures=True,
        supports_options=False,
        supports_funding_history=True,
        supports_open_positions=True,
        max_lookback_days=90,  # Binance enforces 90-day window on most private endpoints
        page_size=_PAGE_SIZE,
    )
    rate_limit: RateLimitPolicy = _RATE_LIMIT
    retry_policy: RetryPolicy = RetryPolicy(
        max_attempts=6,
        base_delay_ms=500,
        max_delay_ms=60_000,
        jitter=True,
        retry_on=[
            AdapterErrorCode.RATE_LIMITED,
            AdapterErrorCode.NETWORK,
            AdapterErrorCode.EXCHANGE_DOWN,
        ],
    )

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def connect(self, credentials: Credentials) -> ConnectionStatusResult:  # noqa: PLR0912
        """Validate credentials.  Rejects any key with ``canWithdraw=true``."""
        if not isinstance(credentials, ApiKeyCredentials):
            raise AdapterAuthError("Binance requires ApiKeyCredentials")

        clients = _build_clients(credentials)
        spot_client = clients["spot"]
        usdm_client = clients["usdm"]

        server_time: datetime | None = None
        permissions: list[str] = []

        try:
            # Single authenticated call: fetch USD-M balance (light, exercises futures perms)
            balance_raw: dict[str, Any] = await usdm_client.fetch_balance(
                {"type": "future"}
            )

            # Extract permissions from ccxt's parsed info dict
            info: dict[str, Any] = balance_raw.get("info", {})

            # Binance futures account info wraps the account under "assets" etc.
            # The raw spot account is the one with canWithdraw; on USD-M futures
            # ccxt returns the futures account — also query spot for permission flags.
            spot_balance: dict[str, Any] = await spot_client.fetch_balance()
            spot_info: dict[str, Any] = spot_balance.get("info", {})

            can_withdraw: bool = bool(spot_info.get("canWithdraw", False))
            can_trade: bool = bool(spot_info.get("canTrade", True))
            can_deposit: bool = bool(spot_info.get("canDeposit", True))

            if can_withdraw:
                return ConnectionStatusResult(
                    health=ConnectionHealth.PERMISSION,
                    auth_mode=AuthMode.API_KEY,
                    permissions=["canWithdraw"],
                    message=(
                        "API key has withdraw permission. "
                        "Create a read-only key and re-connect."
                    ),
                    server_time=None,
                )

            if can_trade:
                permissions.append("canTrade")
            if can_deposit:
                permissions.append("canDeposit")

            # Server time for skew check
            st_ms: int | None = info.get("updateTime") or spot_info.get("updateTime")
            if st_ms is not None:
                server_time = datetime.fromtimestamp(st_ms / 1000.0, tz=timezone.utc)
                now = datetime.now(tz=timezone.utc)
                skew_s = abs((server_time - now).total_seconds())
                if skew_s > _SERVER_TIME_SKEW_WARN_SECONDS:
                    log.warning(
                        "binance.server_time_skew",
                        skew_seconds=skew_s,
                        server_time=server_time.isoformat(),
                    )

            log.info(
                "binance.connect.ok",
                permissions=permissions,
            )

            return ConnectionStatusResult(
                health=ConnectionHealth.OK,
                auth_mode=AuthMode.API_KEY,
                permissions=permissions,
                message=None,
                server_time=server_time,
            )

        except (AdapterAuthError, AdapterPermissionError):
            raise
        except Exception as exc:
            mapped = _map_ccxt_error(exc)
            if isinstance(mapped, (AdapterAuthError, AdapterPermissionError)):
                return ConnectionStatusResult(
                    health=ConnectionHealth.AUTH_FAILED,
                    auth_mode=AuthMode.API_KEY,
                    permissions=[],
                    message=str(mapped),
                )
            if isinstance(
                mapped,
                (AdapterNetworkError, AdapterExchangeDownError, AdapterRateLimitedError),
            ):
                return ConnectionStatusResult(
                    health=ConnectionHealth.UNREACHABLE,
                    auth_mode=AuthMode.API_KEY,
                    permissions=[],
                    message=str(mapped),
                )
            raise mapped from exc
        finally:
            await _close_clients(clients)

    async def validate_credentials(self, credentials: Credentials) -> bool:
        """Lightweight credential re-check — does not mutate any cached state."""
        if not isinstance(credentials, ApiKeyCredentials):
            return False
        clients = _build_clients(credentials)
        try:
            await clients["spot"].fetch_balance()
            return True
        except ccxt_async.AuthenticationError:
            return False
        except Exception as exc:
            raise _map_ccxt_error(exc) from exc
        finally:
            await _close_clients(clients)

    # ------------------------------------------------------------------
    # Fills — paginated across all three sub-clients
    # ------------------------------------------------------------------

    def fetch_fills(
        self,
        credentials: Credentials,
        *,
        since: datetime,
        until: datetime,
    ) -> AsyncIterator[list[CanonicalFill]]:
        """Return an async generator yielding pages of fills across spot + perps."""
        if not isinstance(credentials, ApiKeyCredentials):
            raise AdapterAuthError("Binance requires ApiKeyCredentials")
        return self._fill_generator(credentials, since=since, until=until)

    async def _fill_generator(
        self,
        credentials: ApiKeyCredentials,
        *,
        since: datetime,
        until: datetime,
    ) -> AsyncIterator[list[CanonicalFill]]:
        clients = _build_clients(credentials)
        try:
            since_ms = int(since.timestamp() * 1000)
            until_ms = int(until.timestamp() * 1000)

            sub_clients: list[tuple[str, ccxt_async.Exchange, Exchange]] = [
                ("spot", clients["spot"], Exchange.BINANCE),
                ("usdm", clients["usdm"], Exchange.BINANCE),
                ("coinm", clients["coinm"], Exchange.BINANCE),
            ]

            for market_name, client, exchange_enum in sub_clients:
                await client.load_markets()
                markets: dict[str, Any] = client.markets
                request_count = 0

                for symbol, market_info in markets.items():
                    # Skip non-active and non-relevant market types
                    if not market_info.get("active", True):
                        continue
                    mtype = market_info.get("type", "")
                    if market_name == "spot" and mtype not in ("spot",):
                        continue
                    if market_name in ("usdm", "coinm") and mtype not in ("swap", "future"):
                        continue

                    from_id: int | None = None
                    while True:
                        params: dict[str, Any] = {
                            "limit": _PAGE_SIZE,
                        }
                        if from_id is not None:
                            params["fromId"] = from_id
                        else:
                            params["startTime"] = since_ms
                            params["endTime"] = until_ms

                        try:
                            raw_trades: list[dict[str, Any]] = (
                                await client.fetch_my_trades(symbol, params=params)
                            )
                        except Exception as exc:
                            mapped = _map_ccxt_error(exc)
                            if isinstance(mapped, AdapterRateLimitedError):
                                backoff = mapped.retry_after or _rate_limit_backoff(request_count)
                                log.warning(
                                    "binance.rate_limited",
                                    market=market_name,
                                    symbol=symbol,
                                    backoff_seconds=backoff,
                                )
                                await asyncio.sleep(backoff)
                                continue
                            raise mapped from exc

                        request_count += 1
                        log.info(
                            "binance.fetch_fills.page",
                            market=market_name,
                            symbol=symbol,
                            count=len(raw_trades),
                            from_id=from_id,
                            total_requests=request_count,
                        )

                        if not raw_trades:
                            break

                        # Filter any trades outside [since, until] when paginating
                        # by fromId (no time filter applies in that mode).
                        if from_id is not None:
                            raw_trades = [
                                t
                                for t in raw_trades
                                if t.get("timestamp", 0) <= until_ms
                            ]

                        fills: list[CanonicalFill] = []
                        for t in raw_trades:
                            instrument = _normalize_symbol(symbol, market_info, exchange_enum)
                            fills.append(_parse_fill(t, instrument))

                        if fills:
                            yield fills

                        # Advance cursor
                        last_id: int = max(int(t["id"]) for t in raw_trades)
                        last_ts: int = max(int(t.get("timestamp", 0)) for t in raw_trades)

                        if len(raw_trades) < _PAGE_SIZE or last_ts >= until_ms:
                            break

                        from_id = last_id + 1

                log.info(
                    "binance.fetch_fills.market_complete",
                    market=market_name,
                    total_requests=request_count,
                )

        finally:
            await _close_clients(clients)

    # ------------------------------------------------------------------
    # Funding events
    # ------------------------------------------------------------------

    def fetch_funding_events(
        self,
        credentials: Credentials,
        *,
        since: datetime,
        until: datetime,
    ) -> AsyncIterator[list[CanonicalFundingEvent]]:
        """Return an async generator yielding pages of funding payments from USD-M + coin-M."""
        if not isinstance(credentials, ApiKeyCredentials):
            raise AdapterAuthError("Binance requires ApiKeyCredentials")
        return self._funding_generator(credentials, since=since, until=until)

    async def _funding_generator(
        self,
        credentials: ApiKeyCredentials,
        *,
        since: datetime,
        until: datetime,
    ) -> AsyncIterator[list[CanonicalFundingEvent]]:
        clients = _build_clients(credentials)
        try:
            since_ms = int(since.timestamp() * 1000)
            until_ms = int(until.timestamp() * 1000)

            perp_clients: list[tuple[str, ccxt_async.Exchange]] = [
                ("usdm", clients["usdm"]),
                ("coinm", clients["coinm"]),
            ]

            for market_name, client in perp_clients:
                await client.load_markets()
                markets: dict[str, Any] = client.markets
                request_count = 0

                # Fetch income history for FUNDING_FEE across all symbols.
                # ccxt's fetch_funding_history does symbol-by-symbol; Binance also
                # supports a symbol-less endpoint that returns all at once — use that.
                cursor_ms: int = since_ms

                while True:
                    params: dict[str, Any] = {
                        "incomeType": "FUNDING_FEE",
                        "startTime": cursor_ms,
                        "endTime": until_ms,
                        "limit": _MAX_FUNDING_PAGE,
                    }
                    try:
                        raw_events: list[dict[str, Any]] = (
                            await client.fetch_income_history(params=params)
                        )
                    except AttributeError:
                        # Some ccxt versions expose this as fetch_funding_history
                        try:
                            raw_events = await client.fetch_funding_history(params=params)
                        except Exception as exc:
                            raise AdapterUnsupportedError(
                                f"ccxt {market_name} client missing funding history method"
                            ) from exc
                    except Exception as exc:
                        mapped = _map_ccxt_error(exc)
                        if isinstance(mapped, AdapterRateLimitedError):
                            backoff = mapped.retry_after or _rate_limit_backoff(request_count)
                            log.warning(
                                "binance.funding.rate_limited",
                                market=market_name,
                                backoff_seconds=backoff,
                            )
                            await asyncio.sleep(backoff)
                            continue
                        raise mapped from exc

                    request_count += 1
                    log.info(
                        "binance.fetch_funding.page",
                        market=market_name,
                        count=len(raw_events),
                        cursor_ms=cursor_ms,
                        total_requests=request_count,
                    )

                    if not raw_events:
                        break

                    events: list[CanonicalFundingEvent] = []
                    for ev in raw_events:
                        events.append(_parse_funding_event(ev, Exchange.BINANCE, markets))

                    if events:
                        yield events

                    if len(raw_events) < _MAX_FUNDING_PAGE:
                        break

                    # Advance cursor to 1 ms after the last event
                    last_ts = max(int(ev.get("timestamp", 0)) for ev in raw_events)
                    cursor_ms = last_ts + 1

                log.info(
                    "binance.fetch_funding.market_complete",
                    market=market_name,
                    total_requests=request_count,
                )

        finally:
            await _close_clients(clients)

    # ------------------------------------------------------------------
    # Open positions
    # ------------------------------------------------------------------

    async def fetch_open_positions(
        self,
        credentials: Credentials,
    ) -> list[CanonicalPosition]:
        """Snapshot of open positions on USD-M + coin-M perps."""
        if not isinstance(credentials, ApiKeyCredentials):
            raise AdapterAuthError("Binance requires ApiKeyCredentials")

        clients = _build_clients(credentials)
        try:
            positions: list[CanonicalPosition] = []

            for market_name, client in [("usdm", clients["usdm"]), ("coinm", clients["coinm"])]:
                try:
                    await client.load_markets()
                    markets: dict[str, Any] = client.markets
                    raw_positions: list[dict[str, Any]] = await client.fetch_positions()
                except Exception as exc:
                    raise _map_ccxt_error(exc) from exc

                log.info(
                    "binance.fetch_positions",
                    market=market_name,
                    raw_count=len(raw_positions),
                )

                for raw in raw_positions:
                    pos = _parse_position(raw, Exchange.BINANCE, markets)
                    if pos is not None:
                        positions.append(pos)

            return positions

        finally:
            await _close_clients(clients)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _close_clients(clients: dict[str, ccxt_async.Exchange]) -> None:
    """Close all sub-client sessions without raising."""
    for name, client in clients.items():
        try:
            await client.close()
        except Exception:
            log.debug("binance.close_client_error", client=name, exc_info=True)


def _rate_limit_backoff(request_count: int) -> float:
    """Exponential backoff starting at 1 s, capped at 60 s."""
    return float(min(2 ** min(request_count, 6), _MIN_BAN_BACKOFF_SECONDS))
