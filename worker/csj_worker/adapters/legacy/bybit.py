"""Bybit exchange adapter.

Design notes
============

Categories multiplexing
-----------------------
Bybit v5's unified REST API splits instruments into three categories that must
be queried with separate ``category`` parameters:

- ``linear``  — USDT-margined perpetuals (and USDT-settled futures)
- ``inverse`` — Coin-margined perpetuals / futures (e.g. BTCUSD)
- ``spot``    — Spot trading pairs

``fetch_fills`` and ``fetch_funding_events`` each iterate all three categories
in sequence and yield pages from each in turn. Callers receive a uniform stream
of ``CanonicalFill`` / ``CanonicalFundingEvent`` pages regardless of category.

Cursor pagination
-----------------
Bybit v5 uses an opaque ``nextPageCursor`` string (base64-encoded JSON) on all
history endpoints. The adapter drives pagination with::

    cursor = None
    while True:
        params = {"cursor": cursor, ...} if cursor else {...}
        page, cursor = await _fetch_page(params)
        yield page
        if not cursor:
            break

Page size is capped at 100 (Bybit's per-endpoint max for trade history).

Permission check
----------------
``connect()`` calls ``/v5/user/query-api`` via ccxt's passthrough
``private_get_v5_user_query_api``. The ``readOnly`` field must equal ``1``
**and** the ``Wallet`` permission list must not contain ``Withdraw``.
A key that passes order reading via ``ContractTrade: [Order, Position]`` while
remaining read-only is accepted — that combination is required to read
position/order history on Bybit's unified account.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import ccxt.async_support as ccxt
import structlog

from csj_worker.adapters.base import (
    AdapterAuthError,
    AdapterError,
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

log = structlog.get_logger(__name__)

# Bybit v5 category strings
_CATEGORIES: list[str] = ["linear", "inverse", "spot"]

# Maximum records per page (Bybit hard limit)
_PAGE_SIZE = 100

# Clock-skew warn threshold in seconds
_SKEW_WARN_SECONDS = 300


def _ccxt_exception_to_adapter(exc: Exception, context: str = "") -> AdapterError:
    """Map ccxt exception hierarchy to our AdapterError hierarchy."""
    msg = f"{context}: {exc}" if context else str(exc)
    cause = exc

    if isinstance(exc, ccxt.AuthenticationError):
        return AdapterAuthError(msg, cause=cause)
    if isinstance(exc, ccxt.PermissionDenied):
        return AdapterPermissionError(msg, cause=cause)
    if isinstance(exc, ccxt.RateLimitExceeded):
        return AdapterRateLimitedError(msg, retry_after=30.0, cause=cause)
    if isinstance(exc, ccxt.NetworkError):
        return AdapterNetworkError(msg, cause=cause)
    if isinstance(exc, ccxt.ExchangeNotAvailable | ccxt.OnMaintenance):
        return AdapterExchangeDownError(msg, cause=cause)
    if isinstance(exc, ccxt.BadResponse | ccxt.BadSymbol):
        return AdapterInvalidDataError(msg, cause=cause)
    if isinstance(exc, ccxt.ExchangeError):
        # Bybit error code 10001 = rate limited
        raw = str(exc)
        if "10001" in raw:
            return AdapterRateLimitedError(msg, retry_after=30.0, cause=cause)
        return AdapterError(msg, cause=cause)
    return AdapterNetworkError(msg, cause=cause)


def _parse_ts_ms(ts_str: str | int | None) -> datetime | None:
    """Parse a millisecond-epoch string/int into an aware datetime."""
    if ts_str is None or ts_str == "":
        return None
    try:
        return datetime.fromtimestamp(int(ts_str) / 1000.0, tz=timezone.utc)
    except (ValueError, TypeError):
        return None


def _require_ts_ms(ts_str: str | int | None, field: str) -> datetime:
    result = _parse_ts_ms(ts_str)
    if result is None:
        raise AdapterInvalidDataError(f"Missing or invalid timestamp field '{field}': {ts_str!r}")
    return result


def _parse_decimal(value: str | None, field: str) -> Decimal:
    if value is None or value == "":
        raise AdapterInvalidDataError(f"Missing decimal field '{field}'")
    try:
        return Decimal(value)
    except Exception as exc:
        raise AdapterInvalidDataError(f"Cannot parse decimal '{field}': {value!r}") from exc


def _normalize_instrument(
    symbol: str,
    category: str,
) -> CanonicalInstrument:
    """Convert a Bybit symbol + category to a CanonicalInstrument.

    Bybit spot: ``BTCUSDT``         → base=BTC, quote=USDT, kind=SPOT
    Bybit linear: ``BTCUSDT``       → base=BTC, quote=USDT, kind=PERP
    Bybit inverse: ``BTCUSD``       → base=BTC, quote=USD,  kind=PERP
    Dated futures have expiry suffix: ``BTC-28JUN2024`` but ccxt normalises
    those differently; for v1 we treat any non-spot category as PERP unless
    the symbol contains an expiry pattern.
    """
    raw_symbol = symbol

    if category == "spot":
        # Spot symbols are like BTCUSDT — try to split on common quotes
        for quote in ("USDT", "USDC", "BTC", "ETH", "BNB", "USD"):
            if symbol.endswith(quote) and len(symbol) > len(quote):
                base = symbol[: -len(quote)]
                return CanonicalInstrument(
                    exchange=Exchange.BYBIT,
                    kind=InstrumentKind.SPOT,
                    base=base,
                    quote=quote,
                    raw_symbol=raw_symbol,
                )
        # Fallback: treat whole symbol as base with unknown quote
        return CanonicalInstrument(
            exchange=Exchange.BYBIT,
            kind=InstrumentKind.SPOT,
            base=symbol,
            quote="UNKNOWN",
            raw_symbol=raw_symbol,
        )

    # linear / inverse — perpetuals and dated futures
    kind = InstrumentKind.PERP

    if category == "linear":
        # BTCUSDT, ETHUSDT, etc.
        for quote in ("USDT", "USDC"):
            if symbol.endswith(quote) and len(symbol) > len(quote):
                base = symbol[: -len(quote)]
                return CanonicalInstrument(
                    exchange=Exchange.BYBIT,
                    kind=kind,
                    base=base,
                    quote=quote,
                    raw_symbol=raw_symbol,
                )

    if category == "inverse":
        # BTCUSD, ETHUSD — coin-margined
        if symbol.endswith("USD") and len(symbol) > 3:
            base = symbol[:-3]
            return CanonicalInstrument(
                exchange=Exchange.BYBIT,
                kind=kind,
                base=base,
                quote="USD",
                raw_symbol=raw_symbol,
            )

    # Generic fallback
    return CanonicalInstrument(
        exchange=Exchange.BYBIT,
        kind=kind,
        base=symbol,
        quote="UNKNOWN",
        raw_symbol=raw_symbol,
    )


def _trade_to_fill(trade: dict[str, Any], category: str) -> CanonicalFill:
    """Convert one raw Bybit v5 trade record into a CanonicalFill."""
    symbol: str = trade.get("symbol", "")
    if not symbol:
        raise AdapterInvalidDataError("Trade record missing 'symbol'")

    instrument = _normalize_instrument(symbol, category)

    side_raw = trade.get("side", "")
    try:
        side = Side.BUY if side_raw.lower() == "buy" else Side.SELL
    except AttributeError:
        raise AdapterInvalidDataError(f"Invalid side value: {side_raw!r}")

    is_maker = bool(trade.get("isMaker", False))

    qty = _parse_decimal(trade.get("execQty"), "execQty")
    price = _parse_decimal(trade.get("execPrice"), "execPrice")
    notional = _parse_decimal(trade.get("execValue"), "execValue")
    fee = abs(_parse_decimal(trade.get("execFee"), "execFee"))
    fee_rate_raw = trade.get("feeRate", "0")
    # feeSide field indicates whether fee is in base or quote currency
    fee_side = trade.get("feeSide", "")
    if fee_side == "base":
        fee_currency = instrument.base
    else:
        fee_currency = instrument.quote

    filled_at = _require_ts_ms(trade.get("execTime"), "execTime")

    external_trade_id = str(trade.get("id", ""))
    if not external_trade_id:
        raise AdapterInvalidDataError("Trade record missing 'id'")

    external_order_id = trade.get("orderId") or None

    return CanonicalFill(
        external_trade_id=external_trade_id,
        external_order_id=str(external_order_id) if external_order_id else None,
        instrument=instrument,
        side=side,
        qty=qty,
        price=price,
        notional=notional,
        fee=fee,
        fee_currency=fee_currency,
        fee_kind=FeeKind.MAKER if is_maker else FeeKind.TAKER,
        is_maker=is_maker,
        liquidity="maker" if is_maker else "taker",
        filled_at=filled_at,
        raw=dict(trade),
    )


def _funding_record_to_event(
    record: dict[str, Any],
    category: str,
) -> CanonicalFundingEvent:
    """Convert one Bybit funding settlement record into a CanonicalFundingEvent."""
    symbol: str = record.get("symbol", "")
    if not symbol:
        raise AdapterInvalidDataError("Funding record missing 'symbol'")

    instrument = _normalize_instrument(symbol, category)

    # execFee is negative when paid, positive when received
    exec_fee_raw = record.get("execFee", "0")
    exec_fee = _parse_decimal(exec_fee_raw, "execFee")
    amount = abs(exec_fee)
    direction = FundingDirection.RECEIVED if exec_fee > 0 else FundingDirection.PAID

    funding_rate = _parse_decimal(record.get("fundingRate", "0"), "fundingRate")
    position_qty = _parse_decimal(record.get("size", "0"), "size")

    occurred_at = _require_ts_ms(record.get("execTime"), "execTime")

    external_id = record.get("id") or None

    return CanonicalFundingEvent(
        instrument=instrument,
        direction=direction,
        funding_rate=funding_rate,
        position_qty=position_qty,
        amount=amount,
        amount_currency=instrument.quote,
        occurred_at=occurred_at,
        external_id=str(external_id) if external_id else None,
        raw=dict(record),
    )


def _position_record_to_canonical(pos: dict[str, Any]) -> CanonicalPosition | None:
    """Convert a Bybit position record to CanonicalPosition.

    Returns None for zero-size positions (closed but lingering in API response).
    """
    size_raw = pos.get("size", "0")
    qty = _parse_decimal(size_raw, "size")
    if qty <= 0:
        return None

    symbol: str = pos.get("symbol", "")
    if not symbol:
        raise AdapterInvalidDataError("Position record missing 'symbol'")

    category = pos.get("category", "linear")
    instrument = _normalize_instrument(symbol, category)

    side_raw = pos.get("side", "")
    if side_raw.lower() == "buy":
        position_side = PositionSide.LONG
    elif side_raw.lower() == "sell":
        position_side = PositionSide.SHORT
    else:
        raise AdapterInvalidDataError(f"Unknown position side: {side_raw!r}")

    avg_entry = _parse_decimal(pos.get("avgPrice", "0"), "avgPrice")
    mark_price_raw = pos.get("markPrice")
    mark_price = _parse_decimal(mark_price_raw, "markPrice") if mark_price_raw else None

    unrealized_pnl_raw = pos.get("unrealisedPnl")
    unrealized_pnl = (
        _parse_decimal(unrealized_pnl_raw, "unrealisedPnl") if unrealized_pnl_raw else None
    )

    leverage_raw = pos.get("leverage")
    leverage = _parse_decimal(leverage_raw, "leverage") if leverage_raw else None

    liq_price_raw = pos.get("liqPrice")
    liq_price = _parse_decimal(liq_price_raw, "liqPrice") if liq_price_raw else None

    created_time = _parse_ts_ms(pos.get("createdTime"))

    return CanonicalPosition(
        external_position_id=None,
        instrument=instrument,
        side=position_side,
        qty_open=qty,
        avg_entry_price=avg_entry,
        unrealized_pnl=unrealized_pnl,
        mark_price=mark_price,
        leverage=leverage,
        liquidation_price=liq_price,
        opened_at=created_time,
        raw=dict(pos),
    )


class BybitAdapter(ExchangeAdapter):
    """Bybit v5 adapter — spot + linear (USDT perp) + inverse (coin-margined perp).

    Uses ccxt's ``bybit`` async exchange for authentication and request
    signing. Raw v5 responses are accessed via ccxt's ``privateGetV5*``
    passthrough methods which bypass ccxt's own normalisation layer, giving us
    full access to Bybit's cursor-based pagination without adapting ccxt's
    unified pagination (which doesn't support cursors natively).
    """

    exchange = Exchange.BYBIT
    exchange_kind = ExchangeKind.CEX
    auth_mode = AuthMode.API_KEY

    capabilities = AdapterCapabilities(
        exchange=Exchange.BYBIT,
        exchange_kind=ExchangeKind.CEX,
        auth_mode=AuthMode.API_KEY,
        supports_spot=True,
        supports_perp=True,
        supports_dated_futures=False,
        supports_options=False,
        supports_funding_history=True,
        supports_open_positions=True,
        max_lookback_days=730,
        page_size=_PAGE_SIZE,
    )

    rate_limit = RateLimitPolicy(
        requests_per_second=10.0,
        burst=20,
        cooloff_seconds=30,
    )

    retry_policy = RetryPolicy()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _build_client(self, credentials: Credentials) -> ccxt.bybit:
        """Instantiate a ccxt Bybit client from credentials."""
        from csj_worker.types import ApiKeyCredentials

        if not isinstance(credentials, ApiKeyCredentials):
            raise AdapterAuthError("BybitAdapter requires ApiKeyCredentials")

        return ccxt.bybit(
            {
                "apiKey": credentials.api_key,
                "secret": credentials.api_secret,
                "enableRateLimit": False,  # we manage our own rate limiting
                "options": {
                    "defaultType": "linear",
                    "recvWindow": 5000,
                },
            }
        )

    async def _query_api_info(
        self, client: ccxt.bybit
    ) -> tuple[dict[str, Any], datetime | None]:
        """Call /v5/user/query-api and return (result_dict, server_time).

        Returns the ``result`` sub-dict and an aware datetime parsed from the
        top-level ``time`` field (millisecond epoch). server_time is None if the
        field is absent or unparseable.
        """
        try:
            response: dict[str, Any] = await client.private_get_v5_user_query_api({})
        except Exception as exc:
            raise _ccxt_exception_to_adapter(exc, "query-api") from exc
        ret_code = response.get("retCode", -1)
        if ret_code != 0:
            raise AdapterAuthError(
                f"Bybit /v5/user/query-api returned retCode={ret_code}: {response.get('retMsg')}"
            )
        result: dict[str, Any] = response.get("result", {})
        server_time = _parse_ts_ms(response.get("time"))
        return result, server_time

    @staticmethod
    def _check_permissions(api_info: dict[str, Any]) -> list[str]:
        """Validate key permissions; return list of granted permission strings.

        Raises AdapterPermissionError if:
        - ``readOnly != 1`` (key has write access)
        - ``Wallet`` permissions include ``Withdraw``
        """
        read_only = api_info.get("readOnly", 0)
        if read_only != 1:
            raise AdapterPermissionError(
                "Bybit API key is not read-only (readOnly != 1). "
                "Create a key with read-only access only."
            )

        permissions: dict[str, list[str]] = api_info.get("permissions", {})
        wallet_perms: list[str] = permissions.get("Wallet", [])
        if "Withdraw" in wallet_perms:
            raise AdapterPermissionError(
                "Bybit API key has Withdraw permission in Wallet scope. "
                "Only read-only keys are accepted."
            )

        # Flatten for reporting
        granted: list[str] = []
        for scope, perms in permissions.items():
            for perm in perms:
                granted.append(f"{scope}:{perm}")
        return granted

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def connect(self, credentials: Credentials) -> ConnectionStatusResult:
        """Validate credentials and return connection health.

        Calls /v5/user/query-api, checks readOnly flag and absence of
        Withdraw permission. Measures server time for skew detection.
        """
        client = self._build_client(credentials)
        try:
            t0 = time.time()
            api_info, server_time = await self._query_api_info(client)
            rtt = time.time() - t0

            permissions = self._check_permissions(api_info)

            if server_time is not None:
                local_now = datetime.now(tz=timezone.utc)
                skew = abs((local_now - server_time).total_seconds())
                if skew > _SKEW_WARN_SECONDS:
                    log.warning(
                        "bybit.clock_skew",
                        skew_seconds=skew,
                        threshold=_SKEW_WARN_SECONDS,
                    )

            log.info(
                "bybit.connect.ok",
                uid=api_info.get("userID"),
                rtt_ms=round(rtt * 1000),
                granted_permissions=permissions,
            )

            return ConnectionStatusResult(
                health=ConnectionHealth.OK,
                auth_mode=AuthMode.API_KEY,
                permissions=permissions,
                server_time=server_time,
            )

        except (AdapterAuthError, AdapterPermissionError, AdapterNetworkError):
            raise
        except AdapterError:
            raise
        except Exception as exc:
            raise _ccxt_exception_to_adapter(exc, "bybit.connect") from exc
        finally:
            await client.close()

    async def validate_credentials(self, credentials: Credentials) -> bool:
        """Lightweight re-check for periodic health polling.

        Does NOT mutate adapter state. Returns False on auth failure,
        raises on transport errors.
        """
        client = self._build_client(credentials)
        try:
            api_info, _server_time = await self._query_api_info(client)
            self._check_permissions(api_info)
            return True
        except AdapterAuthError:
            return False
        except AdapterPermissionError:
            return False
        except AdapterError:
            raise
        except Exception as exc:
            raise _ccxt_exception_to_adapter(exc, "bybit.validate_credentials") from exc
        finally:
            await client.close()

    # ------------------------------------------------------------------
    # Fills — paginated async generator
    # ------------------------------------------------------------------

    async def _fetch_fills_category(
        self,
        client: ccxt.bybit,
        category: str,
        since_ms: int,
        until_ms: int,
    ) -> AsyncIterator[list[CanonicalFill]]:
        """Paginate /v5/execution/list for a single category."""
        cursor: str | None = None
        page_num = 0

        while True:
            params: dict[str, Any] = {
                "category": category,
                "limit": _PAGE_SIZE,
                "startTime": since_ms,
                "endTime": until_ms,
            }
            if cursor:
                params["cursor"] = cursor

            try:
                response: dict[str, Any] = await client.private_get_v5_execution_list(params)
            except Exception as exc:
                mapped = _ccxt_exception_to_adapter(exc, f"fetch_fills/{category}")
                log.warning(
                    "bybit.fetch_fills.error",
                    category=category,
                    page=page_num,
                    error=str(mapped),
                )
                raise mapped from exc

            ret_code = response.get("retCode", -1)
            if ret_code != 0:
                raise AdapterInvalidDataError(
                    f"Bybit /v5/execution/list retCode={ret_code}: {response.get('retMsg')}"
                )

            result = response.get("result", {})
            raw_list: list[dict[str, Any]] = result.get("list", [])
            cursor = result.get("nextPageCursor") or None

            if raw_list:
                fills: list[CanonicalFill] = []
                for trade in raw_list:
                    # Bybit v5 execution list may include non-Trade types (e.g. funding)
                    if trade.get("execType") not in ("Trade", "AdlTrade", "BustTrade"):
                        continue
                    try:
                        fills.append(_trade_to_fill(trade, category))
                    except AdapterInvalidDataError as exc:
                        log.error(
                            "bybit.fetch_fills.parse_error",
                            category=category,
                            trade_id=trade.get("id"),
                            error=str(exc),
                        )
                        raise

                if fills:
                    log.debug(
                        "bybit.fetch_fills.page",
                        category=category,
                        page=page_num,
                        count=len(fills),
                        has_next=bool(cursor),
                    )
                    yield fills

            page_num += 1
            if not cursor:
                break

            # Respect rate limit between pages
            await asyncio.sleep(0.1)

    async def fetch_fills(
        self,
        credentials: Credentials,
        *,
        since: datetime,
        until: datetime,
    ) -> AsyncIterator[list[CanonicalFill]]:
        """Yield pages of fills across all three Bybit categories.

        Queries linear, inverse, and spot in sequence. Each category is fully
        exhausted before the next begins. Yields pages as they arrive.
        """
        client = self._build_client(credentials)
        since_ms = int(since.timestamp() * 1000)
        until_ms = int(until.timestamp() * 1000)

        try:
            for category in _CATEGORIES:
                async for page in self._fetch_fills_category(
                    client, category, since_ms, until_ms
                ):
                    yield page
        finally:
            await client.close()

    # ------------------------------------------------------------------
    # Funding events — paginated async generator
    # ------------------------------------------------------------------

    async def _fetch_funding_category(
        self,
        client: ccxt.bybit,
        category: str,
        since_ms: int,
        until_ms: int,
    ) -> AsyncIterator[list[CanonicalFundingEvent]]:
        """Paginate /v5/account/contract-transaction for funding settlements."""
        if category == "spot":
            # Spot has no funding
            return

        cursor: str | None = None
        page_num = 0

        while True:
            params: dict[str, Any] = {
                "accountType": "UNIFIED",
                "category": category,
                "type": "SETTLEMENT",
                "limit": _PAGE_SIZE,
                "startTime": since_ms,
                "endTime": until_ms,
            }
            if cursor:
                params["cursor"] = cursor

            try:
                response: dict[str, Any] = await client.private_get_v5_account_transaction_log(
                    params
                )
            except Exception as exc:
                mapped = _ccxt_exception_to_adapter(exc, f"fetch_funding/{category}")
                log.warning(
                    "bybit.fetch_funding.error",
                    category=category,
                    page=page_num,
                    error=str(mapped),
                )
                raise mapped from exc

            ret_code = response.get("retCode", -1)
            if ret_code != 0:
                raise AdapterInvalidDataError(
                    f"Bybit /v5/account/transaction-log retCode={ret_code}: "
                    f"{response.get('retMsg')}"
                )

            result = response.get("result", {})
            raw_list: list[dict[str, Any]] = result.get("list", [])
            cursor = result.get("nextPageCursor") or None

            if raw_list:
                events: list[CanonicalFundingEvent] = []
                for record in raw_list:
                    # Filter to SETTLEMENT type only (other transaction types exist)
                    if record.get("type") != "SETTLEMENT":
                        continue
                    try:
                        # Inject category so normalizer knows how to interpret symbol
                        record_with_cat = dict(record)
                        events.append(_funding_record_to_event(record_with_cat, category))
                    except AdapterInvalidDataError as exc:
                        log.error(
                            "bybit.fetch_funding.parse_error",
                            category=category,
                            record_id=record.get("id"),
                            error=str(exc),
                        )
                        raise

                if events:
                    log.debug(
                        "bybit.fetch_funding.page",
                        category=category,
                        page=page_num,
                        count=len(events),
                        has_next=bool(cursor),
                    )
                    yield events

            page_num += 1
            if not cursor:
                break

            await asyncio.sleep(0.1)

    async def fetch_funding_events(
        self,
        credentials: Credentials,
        *,
        since: datetime,
        until: datetime,
    ) -> AsyncIterator[list[CanonicalFundingEvent]]:
        """Yield pages of funding settlements for linear and inverse categories."""
        if not self.capabilities.supports_funding_history:
            raise AdapterUnsupportedError("BybitAdapter does not support funding history")

        client = self._build_client(credentials)
        since_ms = int(since.timestamp() * 1000)
        until_ms = int(until.timestamp() * 1000)

        try:
            for category in ("linear", "inverse"):
                async for page in self._fetch_funding_category(
                    client, category, since_ms, until_ms
                ):
                    yield page
        finally:
            await client.close()

    # ------------------------------------------------------------------
    # Open positions snapshot
    # ------------------------------------------------------------------

    # ------------------------------------------------------------------
    # Klines (public OHLCV)
    # ------------------------------------------------------------------

    async def fetch_klines(
        self,
        symbol: str,
        start_ms: int,
        end_ms: int,
        *,
        interval: str = "1m",
    ) -> list[dict[str, Any]]:
        """Fetch public OHLCV klines for a Bybit symbol in [start_ms, end_ms].

        Public endpoint — no API key required. We default to the ``linear``
        category (USDT perp) since spread/trade activity is dominated there;
        if the symbol isn't recognised on linear we fall back to spot.

        Pagination: Bybit ccxt caps OHLCV at 1000 bars per call. We page
        forward, dedupe by timestamp, and stop when we cross ``end_ms`` or
        receive an empty page.
        """
        # No credentials — ccxt accepts an empty config for public endpoints.
        linear = ccxt.bybit({"enableRateLimit": False, "options": {"defaultType": "linear"}})
        spot = ccxt.bybit({"enableRateLimit": False, "options": {"defaultType": "spot"}})

        try:
            for client in (linear, spot):
                try:
                    bars = await self._page_ohlcv(client, symbol, interval, start_ms, end_ms)
                except (ccxt.BadSymbol, ccxt.BadRequest):
                    continue
                except Exception as exc:
                    raise _ccxt_exception_to_adapter(exc, "fetch_klines") from exc

                if bars:
                    return bars

            log.warning(
                "bybit.fetch_klines.symbol_not_found",
                symbol=symbol,
                interval=interval,
            )
            return []
        finally:
            for c in (linear, spot):
                try:
                    await c.close()
                except Exception:
                    log.debug("bybit.close_klines_client_error", exc_info=True)

    @staticmethod
    async def _page_ohlcv(
        client: ccxt.bybit,
        symbol: str,
        timeframe: str,
        start_ms: int,
        end_ms: int,
    ) -> list[dict[str, Any]]:
        """Page through ccxt fetch_ohlcv. Returns canonical dict bars."""
        out: dict[int, dict[str, Any]] = {}
        cursor = start_ms
        tf_ms = (
            client.parse_timeframe(timeframe) * 1000
            if hasattr(client, "parse_timeframe")
            else 60_000
        )

        max_iterations = 200
        iters = 0
        while cursor <= end_ms and iters < max_iterations:
            iters += 1
            raw_bars: list[list[Any]] = await client.fetch_ohlcv(
                symbol, timeframe=timeframe, since=cursor, limit=1000
            )
            if not raw_bars:
                break

            advanced = False
            for ts, o, h, low, c, v in raw_bars:
                if ts > end_ms:
                    continue
                if ts not in out:
                    out[ts] = {
                        "ts_ms": int(ts),
                        "open": Decimal(str(o)),
                        "high": Decimal(str(h)),
                        "low": Decimal(str(low)),
                        "close": Decimal(str(c)),
                        "volume": Decimal(str(v)) if v is not None else Decimal("0"),
                    }
                    advanced = True

            last_ts = int(raw_bars[-1][0])
            if last_ts >= end_ms:
                break
            cursor = (last_ts + tf_ms) if not advanced else (last_ts + tf_ms)

        return sorted(out.values(), key=lambda b: b["ts_ms"])

    async def fetch_open_positions(
        self,
        credentials: Credentials,
    ) -> list[CanonicalPosition]:
        """Fetch current open positions across linear and inverse categories."""
        client = self._build_client(credentials)
        positions: list[CanonicalPosition] = []

        try:
            for category in ("linear", "inverse"):
                params: dict[str, Any] = {
                    "category": category,
                    "settleCoin": "USDT" if category == "linear" else None,
                }
                # Remove None values
                params = {k: v for k, v in params.items() if v is not None}

                try:
                    response: dict[str, Any] = await client.private_get_v5_position_list(params)
                except Exception as exc:
                    raise _ccxt_exception_to_adapter(
                        exc, f"fetch_open_positions/{category}"
                    ) from exc

                ret_code = response.get("retCode", -1)
                if ret_code != 0:
                    raise AdapterInvalidDataError(
                        f"Bybit /v5/position/list retCode={ret_code}: {response.get('retMsg')}"
                    )

                result = response.get("result", {})
                raw_list: list[dict[str, Any]] = result.get("list", [])

                for pos in raw_list:
                    pos_with_cat = dict(pos)
                    pos_with_cat["category"] = category
                    try:
                        canonical = _position_record_to_canonical(pos_with_cat)
                        if canonical is not None:
                            positions.append(canonical)
                    except AdapterInvalidDataError as exc:
                        log.error(
                            "bybit.fetch_positions.parse_error",
                            category=category,
                            symbol=pos.get("symbol"),
                            error=str(exc),
                        )
                        raise

            log.info("bybit.fetch_positions.ok", count=len(positions))
            return positions

        finally:
            await client.close()
