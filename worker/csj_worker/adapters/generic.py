"""``CcxtUniversalAdapter`` — one adapter, N exchanges, driven by ``VenueConfig``.

Architectural premise
=====================
ccxt already handles, per exchange:
- HMAC / RSA / ED25519 request signing
- Symbol-format normalisation (``BTC/USDT`` ↔ ``BTCUSDT`` etc)
- Response-shape normalisation (``fetchMyTrades`` → list of dicts with
  standard keys: ``id``, ``symbol``, ``side``, ``amount``, ``price``,
  ``cost``, ``timestamp``, ``fee``, ``info``).
- Pagination plumbing (``fromId`` for Binance, ``cursor`` for Bybit,
  ``after`` for OKX — all hidden behind ``fetchMyTrades``).
- Rate-limit awareness via per-method weights.

We wrap that thin: per-venue quirks ride on a ``VenueConfig`` dataclass.
Adding a new exchange becomes "write a 30-line config module + register
in the dict".

What this adapter does NOT try to do
-------------------------------------
- It does not implement venue-specific pagination strategies that go
  beyond ``ccxt.fetchMyTrades(since=…, limit=…)`` with the venue's
  natural cursor advancing through the ``since`` field. For most v1
  workflows (90-day lookback, ~10K fills) this is sufficient.
- It does not fetch dated-future OR option fills unless the VenueConfig
  declares ``supports_dated_futures`` / ``supports_options`` AND adds
  the relevant market type to ``market_types``.
- It does not back-fill the legacy adapters' more aggressive fromId-style
  pagination. If a venue's response density requires it, flip
  ``CSJ_USE_LEGACY_ADAPTER_<X>=1`` and use the hand-built adapter.

Security invariants
-------------------
- Credentials are passed *only* into ccxt client constructors. They never
  reach our log statements (the ``mask_secret`` helper enforces this).
- ``connect()`` MUST call the per-venue permissions check and reject
  withdraw-enabled keys. For venues where the check cannot be performed
  reliably (BingX, MEXC, Phemex), we surface ``withdraw:unverified`` in
  the permissions list and emit a structured log warning. The UI is
  responsible for forcing user attestation in that case.

Crash consistency
-----------------
- ccxt clients are created fresh per call; we close them in ``finally``.
- ``fetch_fills`` is an async generator: a partial iteration is allowed
  to stop early without leaking ccxt session state.
- Errors map onto the ``AdapterError`` hierarchy via ``_map_ccxt_error``.

Concurrency
-----------
- The adapter is *stateless* between method calls. Two coroutines may
  drive the same adapter against different credentials simultaneously.
- Within a single ``fetch_fills`` generator we serialise per-symbol
  fetches; ccxt's own connection pool handles parallelism inside.
"""

from __future__ import annotations

import asyncio
import re
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

import ccxt.async_support as ccxt_async
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
from csj_worker.adapters.configs._base import VenueConfig
from csj_worker.logging_config import mask_secret
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
# Helpers — Decimal coercion, timestamp parsing, error mapping
# ---------------------------------------------------------------------------


def _to_decimal(value: Any, field: str) -> Decimal:
    """Convert any numeric-ish value to Decimal.

    Raises AdapterInvalidDataError on missing/unparseable input so callers
    can surface "ccxt returned a value we cannot parse" loudly.
    """
    if value is None:
        raise AdapterInvalidDataError(f"Missing required numeric field: {field}")
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise AdapterInvalidDataError(
            f"Cannot convert {field!r}={value!r} to Decimal"
        ) from exc


def _ms_to_dt(ms: int | float | str | None, *, field: str) -> datetime:
    """Convert millisecond epoch to aware UTC datetime."""
    if ms is None:
        raise AdapterInvalidDataError(f"Missing timestamp field: {field}")
    try:
        return datetime.fromtimestamp(int(float(ms)) / 1000.0, tz=timezone.utc)
    except (ValueError, TypeError, OSError) as exc:
        raise AdapterInvalidDataError(
            f"Cannot parse timestamp {field!r}={ms!r}"
        ) from exc


def _parse_retry_after(msg: str) -> float | None:
    """Pull a Retry-After value from a rate-limit error message."""
    m = re.search(r"retry.after[:\s]+(\d+)", msg, re.IGNORECASE)
    if m:
        return float(m.group(1))
    return None


def _map_ccxt_error(exc: Exception, *, venue: str = "") -> AdapterError:
    """Convert ccxt exceptions into the AdapterError hierarchy.

    Generic, venue-agnostic mapping. Subclasses or per-venue configs may
    override; for v1 this covers all 10 target venues.
    """
    msg = f"{venue}: {exc}" if venue else str(exc)
    if isinstance(exc, ccxt_async.AuthenticationError):
        return AdapterAuthError(msg, cause=exc)
    if isinstance(exc, ccxt_async.PermissionDenied):
        return AdapterPermissionError(msg, cause=exc)
    if isinstance(exc, ccxt_async.RateLimitExceeded):
        return AdapterRateLimitedError(
            msg, retry_after=_parse_retry_after(msg), cause=exc
        )
    if isinstance(exc, ccxt_async.NetworkError):
        return AdapterNetworkError(msg, cause=exc)
    if isinstance(exc, ccxt_async.ExchangeNotAvailable | ccxt_async.OnMaintenance):
        return AdapterExchangeDownError(msg, cause=exc)
    if isinstance(exc, ccxt_async.BadResponse | ccxt_async.BadSymbol):
        return AdapterInvalidDataError(msg, cause=exc)
    if isinstance(exc, ccxt_async.ExchangeError):
        return AdapterNetworkError(msg, cause=exc)
    # Unknown — default to network so the retry policy can have a go.
    return AdapterNetworkError(msg, cause=exc)


# ---------------------------------------------------------------------------
# Symbol normalisation — derives our CanonicalInstrument from ccxt market info
# ---------------------------------------------------------------------------

# ccxt market.type → our InstrumentKind
_CCXT_KIND_MAP: dict[str, InstrumentKind] = {
    "spot": InstrumentKind.SPOT,
    "swap": InstrumentKind.PERP,
    "future": InstrumentKind.DATED_FUTURE,
    "option": InstrumentKind.OPTION,
    "delivery": InstrumentKind.DATED_FUTURE,
    "futures": InstrumentKind.DATED_FUTURE,
}


def _normalize_instrument(
    ccxt_symbol: str,
    market_info: dict[str, Any],
    exchange_enum: Exchange,
) -> CanonicalInstrument:
    """Convert ccxt market descriptor → CanonicalInstrument.

    ccxt unified market dict keys we use:
        ``type``    — 'spot' | 'swap' | 'future' | 'option' | 'delivery'
        ``base``    — base currency code
        ``quote``   — quote currency code
        ``expiry``  — ms epoch for dated futures (None for perp/spot)
        ``settle``  — settlement currency (USDT, BTC, …)
    """
    mtype = market_info.get("type") or "spot"
    kind = _CCXT_KIND_MAP.get(mtype, InstrumentKind.SPOT)

    base = str(market_info.get("base") or "").upper()
    quote = str(market_info.get("quote") or "").upper()

    expiry: datetime | None = None
    if kind == InstrumentKind.DATED_FUTURE:
        expiry_ms = market_info.get("expiry")
        if expiry_ms:
            try:
                expiry = _ms_to_dt(expiry_ms, field="market.expiry")
            except AdapterInvalidDataError:
                expiry = None

    return CanonicalInstrument(
        exchange=exchange_enum,
        kind=kind,
        base=base or "UNKNOWN",
        quote=quote or "UNKNOWN",
        expiry=expiry,
        raw_symbol=ccxt_symbol,
    )


# ---------------------------------------------------------------------------
# ccxt fill → CanonicalFill
# ---------------------------------------------------------------------------


def _parse_ccxt_trade(
    trade: dict[str, Any],
    instrument: CanonicalInstrument,
) -> CanonicalFill:
    """Convert one ccxt unified trade dict → CanonicalFill.

    ccxt unified trade keys:
        ``id``           — exchange trade id (str)
        ``order``        — exchange order id (str | None)
        ``timestamp``    — ms epoch (int)
        ``symbol``       — ccxt symbol
        ``side``         — 'buy' | 'sell'
        ``takerOrMaker`` — 'taker' | 'maker' | None
        ``price``        — float
        ``amount``       — float (qty)
        ``cost``         — float (price * amount, sometimes pre-normalised)
        ``fee``          — {'cost': float, 'currency': str} | None
        ``info``         — raw venue-specific dict
    """
    trade_id = trade.get("id")
    if trade_id is None:
        raise AdapterInvalidDataError("Trade record missing 'id'")

    timestamp = trade.get("timestamp")
    filled_at = _ms_to_dt(timestamp, field="timestamp")

    side_raw = str(trade.get("side") or "").lower()
    side = Side.BUY if side_raw == "buy" else Side.SELL

    is_maker = trade.get("takerOrMaker") == "maker"
    fee_kind = FeeKind.MAKER if is_maker else FeeKind.TAKER

    qty = _to_decimal(trade.get("amount"), "amount")
    price = _to_decimal(trade.get("price"), "price")
    cost_raw = trade.get("cost")
    notional = (
        _to_decimal(cost_raw, "cost")
        if cost_raw is not None
        else qty * price
    )

    fee_info = trade.get("fee") or {}
    fee_cost_raw = fee_info.get("cost") if isinstance(fee_info, dict) else None
    fee_cost = (
        abs(_to_decimal(fee_cost_raw, "fee.cost"))
        if fee_cost_raw is not None
        else Decimal("0")
    )
    fee_currency = (
        str(fee_info.get("currency"))
        if isinstance(fee_info, dict) and fee_info.get("currency")
        else instrument.quote
    )

    order_id = trade.get("order")
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
        raw=trade,
    )


# ---------------------------------------------------------------------------
# ccxt funding-record → CanonicalFundingEvent
# ---------------------------------------------------------------------------


def _parse_ccxt_funding(
    record: dict[str, Any],
    markets: dict[str, dict[str, Any]],
    exchange_enum: Exchange,
) -> CanonicalFundingEvent:
    """Convert one ccxt unified funding dict → CanonicalFundingEvent.

    ccxt unified funding-history shape (per docs.ccxt.com):
        {
            'id':        ...,
            'symbol':    'BTC/USDT:USDT',
            'code':      'USDT',
            'timestamp': 1715760000000,
            'amount':    -0.12,
            'info':      {...raw...},
        }
    """
    symbol = str(record.get("symbol") or "")
    market_info = markets.get(symbol) or {
        "type": "swap",
        "base": symbol.split("/")[0] if "/" in symbol else "UNKNOWN",
        "quote": symbol.split("/")[1].split(":")[0]
        if "/" in symbol and ":" in symbol
        else "USDT",
    }
    instrument = _normalize_instrument(symbol, market_info, exchange_enum)

    timestamp = record.get("timestamp")
    occurred_at = _ms_to_dt(timestamp, field="timestamp")

    amount_raw = _to_decimal(record.get("amount", 0), "amount")
    direction = (
        FundingDirection.RECEIVED if amount_raw >= 0 else FundingDirection.PAID
    )
    amount = abs(amount_raw)

    info = record.get("info") or {}
    # ccxt does NOT expose funding_rate / position_qty in the unified shape.
    # We pluck from raw info if present (many venues include these as
    # 'fundingRate' / 'positionAmt' / similar). Default to 0 if unknown.
    funding_rate = _to_decimal_safe(info.get("fundingRate"), default=Decimal("0"))
    position_qty = _to_decimal_safe(info.get("positionAmt"), default=Decimal("0"))

    return CanonicalFundingEvent(
        instrument=instrument,
        direction=direction,
        funding_rate=funding_rate,
        position_qty=abs(position_qty),
        amount=amount,
        amount_currency=str(record.get("code") or instrument.quote),
        occurred_at=occurred_at,
        external_id=str(record.get("id")) if record.get("id") is not None else None,
        raw=record,
    )


def _to_decimal_safe(value: Any, *, default: Decimal) -> Decimal:
    """Best-effort decimal coercion; returns default on any failure.

    Use ONLY for optional fields where missing data is expected (e.g.
    funding_rate when ccxt doesn't surface it). Never use for required
    numerics — those should raise via ``_to_decimal``.
    """
    if value is None or value == "":
        return default
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return default


# ---------------------------------------------------------------------------
# ccxt position → CanonicalPosition
# ---------------------------------------------------------------------------


def _parse_ccxt_position(
    raw: dict[str, Any],
    markets: dict[str, dict[str, Any]],
    exchange_enum: Exchange,
) -> CanonicalPosition | None:
    """Convert ccxt unified position dict → CanonicalPosition.

    Returns None for zero-size positions (most venues return rows for
    every symbol the user ever touched, not only open positions).
    """
    qty_raw = raw.get("contracts")
    if qty_raw is None:
        qty_raw = raw.get("amount")
    if qty_raw is None:
        info = raw.get("info") or {}
        qty_raw = info.get("positionAmt") or info.get("size") or 0
    qty = _to_decimal_safe(qty_raw, default=Decimal("0"))
    if qty == 0:
        return None

    symbol = str(raw.get("symbol") or "")
    market_info = markets.get(symbol) or {
        "type": "swap",
        "base": symbol.split("/")[0] if "/" in symbol else "UNKNOWN",
        "quote": symbol.split("/")[1].split(":")[0]
        if "/" in symbol and ":" in symbol
        else "USDT",
    }
    instrument = _normalize_instrument(symbol, market_info, exchange_enum)

    side_raw = str(raw.get("side") or "long").lower()
    side = PositionSide.LONG if side_raw in ("long", "buy") else PositionSide.SHORT

    entry_price = _to_decimal_safe(raw.get("entryPrice"), default=Decimal("0"))

    return CanonicalPosition(
        external_position_id=None,
        instrument=instrument,
        side=side,
        qty_open=abs(qty),
        avg_entry_price=entry_price,
        unrealized_pnl=_to_decimal_safe(raw.get("unrealizedPnl"), default=Decimal("0"))
        if raw.get("unrealizedPnl") is not None
        else None,
        mark_price=_to_decimal_safe(raw.get("markPrice"), default=Decimal("0"))
        if raw.get("markPrice") is not None
        else None,
        leverage=_to_decimal_safe(raw.get("leverage"), default=Decimal("0"))
        if raw.get("leverage") is not None
        else None,
        liquidation_price=_to_decimal_safe(
            raw.get("liquidationPrice"), default=Decimal("0")
        )
        if raw.get("liquidationPrice") is not None
        else None,
        raw=raw,
    )


# ---------------------------------------------------------------------------
# The universal adapter
# ---------------------------------------------------------------------------


class CcxtUniversalAdapter(ExchangeAdapter):
    """One adapter class, N exchanges. Per-venue behaviour rides on
    ``VenueConfig`` injected at construction.

    The constructor is intentionally credential-free: credentials are
    passed per call via the ``ExchangeAdapter`` contract. This matches
    the existing daemon's calling convention and keeps the adapter
    stateless / horizontally scalable.

    Capabilities and rate-limit fields are filled in dynamically from
    the VenueConfig so the ABC's static class-attrs still resolve.
    """

    def __init__(self, config: VenueConfig) -> None:
        self.config = config

        # ABC requires these as class-level attrs — but each instance
        # needs venue-specific values. We set them on the instance,
        # which Python's MRO resolves before falling back to the class.
        self.exchange = Exchange(config.code)  # raises if unknown
        self.exchange_kind = ExchangeKind.CEX
        self.auth_mode = AuthMode.API_KEY
        self.capabilities = AdapterCapabilities(
            exchange=Exchange(config.code),
            exchange_kind=ExchangeKind.CEX,
            auth_mode=AuthMode.API_KEY,
            supports_spot=config.supports_spot,
            supports_perp=config.supports_perp,
            supports_dated_futures=config.supports_dated_futures,
            supports_options=config.supports_options,
            supports_funding_history=config.supports_funding_history,
            supports_open_positions=config.supports_open_positions,
            max_lookback_days=config.max_lookback_days,
            page_size=config.page_size,
        )
        self.rate_limit = RateLimitPolicy(
            requests_per_second=config.rate_limit_rps,
            burst=config.rate_limit_burst,
            cooloff_seconds=config.rate_limit_cooloff_seconds,
        )
        self.retry_policy = RetryPolicy(
            max_attempts=5,
            base_delay_ms=500,
            max_delay_ms=30_000,
            jitter=True,
            retry_on=[
                AdapterErrorCode.RATE_LIMITED,
                AdapterErrorCode.NETWORK,
                AdapterErrorCode.EXCHANGE_DOWN,
            ],
        )

    # ------------------------------------------------------------------
    # ccxt client construction
    # ------------------------------------------------------------------

    def _build_client(
        self,
        creds: ApiKeyCredentials,
        *,
        market_type: str | None = None,
    ) -> Any:
        """Construct a ccxt async client wired with credentials.

        ``market_type`` overrides ``defaultType`` when provided; otherwise
        the config's default applies.
        """
        cls = getattr(ccxt_async, self.config.ccxt_id, None)
        if cls is None:
            raise AdapterUnsupportedError(
                f"ccxt has no async exchange '{self.config.ccxt_id}' "
                f"(requested for venue {self.config.code!r})"
            )

        # Build constructor opts: credentials + base ccxt_options + override.
        opts: dict[str, Any] = {
            "apiKey": creds.api_key,
            "secret": creds.api_secret,
            "enableRateLimit": False,  # we manage our own pacing
        }
        if self.config.requires_passphrase:
            if not creds.passphrase:
                raise AdapterAuthError(
                    f"{self.config.code} requires a passphrase"
                )
            opts["password"] = creds.passphrase
        # Deep-merge ccxt_options. options.defaultType is the most common
        # override; we let market_type win when set.
        cfg_opts = dict(self.config.ccxt_options or {})
        if market_type is not None:
            nested = dict(cfg_opts.get("options") or {})
            nested["defaultType"] = market_type
            cfg_opts["options"] = nested
        for k, v in cfg_opts.items():
            opts[k] = v
        return cls(opts)

    @staticmethod
    async def _close_safely(client: Any) -> None:
        try:
            await client.close()
        except Exception:  # noqa: BLE001 — defensive close; we don't care why
            log.debug("ccxt.close_error", exc_info=True)

    # ------------------------------------------------------------------
    # Lifecycle: connect / validate_credentials
    # ------------------------------------------------------------------

    async def connect(self, credentials: Credentials) -> ConnectionStatusResult:
        """Validate creds + reject withdraw permission.

        Surfaces:
        - ``ConnectionHealth.OK``         — passed permission check.
        - ``ConnectionHealth.PERMISSION`` — key has withdraw scope.
        - ``ConnectionHealth.AUTH_FAILED``— invalid signature/key.
        - ``ConnectionHealth.UNREACHABLE``— network / venue down.

        For "unverified" venues (BingX / MEXC / Phemex) the result is OK
        but the permissions list contains ``"withdraw:unverified"`` and
        a warning is logged. UI must enforce attestation.
        """
        if not isinstance(credentials, ApiKeyCredentials):
            raise AdapterAuthError(
                f"{self.config.code} requires ApiKeyCredentials"
            )

        log.info(
            f"{self.config.code}.connect.start",
            api_key_suffix=mask_secret(credentials.api_key),
            passphrase_required=self.config.requires_passphrase,
        )

        client = self._build_client(credentials)
        try:
            # Use the venue's fetch_permissions if defined; else assume
            # fetchBalance is enough to validate read access (Binance-style).
            fetcher = self.config.fetch_permissions
            if fetcher is None:
                balance = await client.fetch_balance()
                perm_info: dict[str, Any] = (
                    balance.get("info", {}) if isinstance(balance, dict) else {}
                )
            else:
                perm_info = await fetcher(client)

            # Withdraw rejection
            if self.config.has_withdraw_permission(perm_info):
                log.warning(
                    f"{self.config.code}.connect.rejected_withdraw_key",
                    api_key_suffix=mask_secret(credentials.api_key),
                )
                return ConnectionStatusResult(
                    health=ConnectionHealth.PERMISSION,
                    auth_mode=AuthMode.API_KEY,
                    permissions=["canWithdraw"],
                    message=(
                        f"API key for {self.config.code} has withdraw "
                        "permission. Create a read-only key and re-connect."
                    ),
                )

            permissions = self.config.extract_permissions(perm_info)

            # If the venue uses 'withdraw:unverified', emit a warning log so
            # the operator notices.
            if any(p.endswith(":unverified") for p in permissions):
                log.warning(
                    f"{self.config.code}.connect.withdraw_unverified",
                    api_key_suffix=mask_secret(credentials.api_key),
                )

            return ConnectionStatusResult(
                health=ConnectionHealth.OK,
                auth_mode=AuthMode.API_KEY,
                permissions=permissions,
                message=None,
                server_time=None,
            )

        except AdapterError:
            raise
        except Exception as exc:  # noqa: BLE001 — we map then re-raise
            mapped = _map_ccxt_error(exc, venue=self.config.code)
            if isinstance(mapped, AdapterAuthError | AdapterPermissionError):
                return ConnectionStatusResult(
                    health=ConnectionHealth.AUTH_FAILED,
                    auth_mode=AuthMode.API_KEY,
                    permissions=[],
                    message=str(mapped),
                )
            if isinstance(
                mapped,
                AdapterNetworkError | AdapterExchangeDownError | AdapterRateLimitedError,
            ):
                return ConnectionStatusResult(
                    health=ConnectionHealth.UNREACHABLE,
                    auth_mode=AuthMode.API_KEY,
                    permissions=[],
                    message=str(mapped),
                )
            raise mapped from exc
        finally:
            await self._close_safely(client)

    async def validate_credentials(self, credentials: Credentials) -> bool:
        """Cheap re-check used by periodic health monitor.

        Distinct from ``connect``: must NOT mutate cached state. We probe
        a balance fetch and return True on success, False on auth failure.
        Transport errors are re-raised so callers can decide retry policy.
        """
        if not isinstance(credentials, ApiKeyCredentials):
            return False
        client = self._build_client(credentials)
        try:
            await client.fetch_balance()
            return True
        except ccxt_async.AuthenticationError:
            return False
        except Exception as exc:
            raise _map_ccxt_error(exc, venue=self.config.code) from exc
        finally:
            await self._close_safely(client)

    # ------------------------------------------------------------------
    # fetch_fills — paginated across each market type
    # ------------------------------------------------------------------

    def fetch_fills(
        self,
        credentials: Credentials,
        *,
        since: datetime,
        until: datetime,
    ) -> AsyncIterator[list[CanonicalFill]]:
        """Async generator yielding pages of CanonicalFills.

        Iteration order:
            for market_type in config.market_types:
                build ccxt client with defaultType=market_type
                load markets
                for each active market:
                    paginate via fetchMyTrades(since=…) advancing the
                    since cursor by 1 ms past the last trade
                close client

        We rely on ccxt's per-venue ``fetchMyTrades`` implementation for
        the right cursor strategy (fromId on Binance, after on OKX,
        cursor on Bybit). The unified `since` argument is the lowest
        common denominator that works on all of them.

        Yields empty pages will be filtered out before the daemon sees them.
        """
        if not isinstance(credentials, ApiKeyCredentials):
            raise AdapterAuthError(
                f"{self.config.code} requires ApiKeyCredentials"
            )
        return self._fill_generator(credentials, since=since, until=until)

    async def _fill_generator(
        self,
        creds: ApiKeyCredentials,
        *,
        since: datetime,
        until: datetime,
    ) -> AsyncIterator[list[CanonicalFill]]:
        since_ms = int(since.timestamp() * 1000)
        until_ms = int(until.timestamp() * 1000)
        page_size = self.config.page_size

        for market_type in self.config.market_types:
            client = self._build_client(creds, market_type=market_type)
            try:
                try:
                    await client.load_markets()
                except Exception as exc:
                    log.warning(
                        f"{self.config.code}.load_markets.failed",
                        market_type=market_type,
                        err=type(exc).__name__,
                    )
                    raise _map_ccxt_error(exc, venue=self.config.code) from exc

                markets: dict[str, dict[str, Any]] = client.markets or {}
                if not markets:
                    log.info(
                        f"{self.config.code}.markets.empty",
                        market_type=market_type,
                    )
                    continue

                request_count = 0
                for symbol, market_info in markets.items():
                    if not market_info.get("active", True):
                        continue
                    # Only fetch markets whose type matches the current
                    # iteration. ccxt sets market.type per row regardless of
                    # the client's defaultType, so this filter is meaningful.
                    m_type = market_info.get("type")
                    if m_type and m_type != market_type:
                        # Tolerate some equivalents: 'future'/'delivery'/'futures'
                        equivalents = {
                            "swap": {"swap"},
                            "future": {"future", "delivery", "futures"},
                            "spot": {"spot"},
                            "option": {"option"},
                        }
                        if m_type not in equivalents.get(market_type, {market_type}):
                            continue

                    instrument = _normalize_instrument(
                        symbol, market_info, self.exchange
                    )

                    cursor_ms: int = since_ms
                    seen_ids: set[str] = set()  # dedupe across pages
                    while True:
                        try:
                            raw_trades: list[dict[str, Any]] = (
                                await client.fetch_my_trades(
                                    symbol, since=cursor_ms, limit=page_size
                                )
                            )
                        except Exception as exc:
                            mapped = _map_ccxt_error(exc, venue=self.config.code)
                            if isinstance(mapped, AdapterRateLimitedError):
                                backoff = (
                                    mapped.retry_after
                                    or self.config.rate_limit_cooloff_seconds
                                )
                                log.warning(
                                    f"{self.config.code}.fetch_fills.rate_limited",
                                    market_type=market_type,
                                    symbol=symbol,
                                    backoff_seconds=backoff,
                                )
                                await asyncio.sleep(backoff)
                                continue
                            # AdapterUnsupportedError isn't currently raised by ccxt
                            # but some venues 4xx on unsupported pairs — treat as
                            # "skip this symbol".
                            if isinstance(mapped, AdapterInvalidDataError):
                                log.debug(
                                    f"{self.config.code}.fetch_fills.invalid_data",
                                    market_type=market_type,
                                    symbol=symbol,
                                    err=str(mapped)[:200],
                                )
                                break
                            raise mapped from exc

                        request_count += 1
                        log.info(
                            f"{self.config.code}.fetch_fills.page",
                            market_type=market_type,
                            symbol=symbol,
                            count=len(raw_trades),
                            cursor_ms=cursor_ms,
                            total_requests=request_count,
                        )

                        if not raw_trades:
                            break

                        # Filter to [since, until] (ccxt sometimes returns
                        # trades older than `since` for cursor-based venues).
                        in_window = [
                            t
                            for t in raw_trades
                            if since_ms <= int(t.get("timestamp", 0)) <= until_ms
                            and str(t.get("id")) not in seen_ids
                        ]
                        for t in in_window:
                            seen_ids.add(str(t.get("id")))

                        if in_window:
                            fills = [
                                _parse_ccxt_trade(t, instrument) for t in in_window
                            ]
                            yield fills

                        # Pagination termination
                        last_ts = max(
                            int(t.get("timestamp") or 0) for t in raw_trades
                        )
                        if last_ts <= cursor_ms or len(raw_trades) < page_size:
                            break
                        cursor_ms = last_ts + 1
                        if cursor_ms > until_ms:
                            break

                log.info(
                    f"{self.config.code}.fetch_fills.market_complete",
                    market_type=market_type,
                    total_requests=request_count,
                )

            finally:
                await self._close_safely(client)

    # ------------------------------------------------------------------
    # fetch_funding_events
    # ------------------------------------------------------------------

    def fetch_funding_events(
        self,
        credentials: Credentials,
        *,
        since: datetime,
        until: datetime,
    ) -> AsyncIterator[list[CanonicalFundingEvent]]:
        """Async generator yielding pages of CanonicalFundingEvent.

        Uses ccxt's unified ``fetch_funding_history(since=…, limit=…)``.
        Iterates over ``config.funding_market_types`` (defaults to
        ``market_types``).
        """
        if not self.config.supports_funding_history:
            raise AdapterUnsupportedError(
                f"{self.config.code} does not support funding history"
            )
        if not isinstance(credentials, ApiKeyCredentials):
            raise AdapterAuthError(
                f"{self.config.code} requires ApiKeyCredentials"
            )
        return self._funding_generator(credentials, since=since, until=until)

    async def _funding_generator(
        self,
        creds: ApiKeyCredentials,
        *,
        since: datetime,
        until: datetime,
    ) -> AsyncIterator[list[CanonicalFundingEvent]]:
        since_ms = int(since.timestamp() * 1000)
        until_ms = int(until.timestamp() * 1000)
        page_size = self.config.page_size

        market_types = self.config.funding_market_types or self.config.market_types

        for market_type in market_types:
            client = self._build_client(creds, market_type=market_type)
            try:
                try:
                    await client.load_markets()
                except Exception as exc:
                    raise _map_ccxt_error(exc, venue=self.config.code) from exc
                markets: dict[str, dict[str, Any]] = client.markets or {}

                cursor_ms = since_ms
                request_count = 0
                while cursor_ms <= until_ms:
                    try:
                        raw_records: list[dict[str, Any]] = (
                            await client.fetch_funding_history(
                                symbol=None, since=cursor_ms, limit=page_size
                            )
                        )
                    except (
                        ccxt_async.NotSupported,
                        AttributeError,
                    ) as exc:
                        raise AdapterUnsupportedError(
                            f"{self.config.code} ccxt client does not support "
                            f"fetch_funding_history"
                        ) from exc
                    except Exception as exc:
                        mapped = _map_ccxt_error(exc, venue=self.config.code)
                        if isinstance(mapped, AdapterRateLimitedError):
                            backoff = (
                                mapped.retry_after
                                or self.config.rate_limit_cooloff_seconds
                            )
                            log.warning(
                                f"{self.config.code}.fetch_funding.rate_limited",
                                market_type=market_type,
                                backoff_seconds=backoff,
                            )
                            await asyncio.sleep(backoff)
                            continue
                        raise mapped from exc

                    request_count += 1
                    log.info(
                        f"{self.config.code}.fetch_funding.page",
                        market_type=market_type,
                        count=len(raw_records),
                        cursor_ms=cursor_ms,
                        total_requests=request_count,
                    )

                    if not raw_records:
                        break

                    in_window = [
                        r
                        for r in raw_records
                        if since_ms <= int(r.get("timestamp", 0)) <= until_ms
                    ]
                    if in_window:
                        events = [
                            _parse_ccxt_funding(r, markets, self.exchange)
                            for r in in_window
                        ]
                        yield events

                    last_ts = max(int(r.get("timestamp") or 0) for r in raw_records)
                    if last_ts <= cursor_ms or len(raw_records) < page_size:
                        break
                    cursor_ms = last_ts + 1

            finally:
                await self._close_safely(client)

    # ------------------------------------------------------------------
    # fetch_open_positions
    # ------------------------------------------------------------------

    async def fetch_open_positions(
        self,
        credentials: Credentials,
    ) -> list[CanonicalPosition]:
        """Return snapshot of open positions across configured market types."""
        if not self.config.supports_open_positions:
            raise AdapterUnsupportedError(
                f"{self.config.code} does not support open positions"
            )
        if not isinstance(credentials, ApiKeyCredentials):
            raise AdapterAuthError(
                f"{self.config.code} requires ApiKeyCredentials"
            )

        out: list[CanonicalPosition] = []
        # Only iterate derivative market types for positions; spot has no
        # concept of open positions.
        deriv_types = [
            mt for mt in self.config.market_types if mt in {"swap", "future", "delivery", "futures", "option"}
        ]
        if not deriv_types:
            return out

        for market_type in deriv_types:
            client = self._build_client(credentials, market_type=market_type)
            try:
                try:
                    await client.load_markets()
                    raw_positions: list[dict[str, Any]] = (
                        await client.fetch_positions()
                    )
                except (ccxt_async.NotSupported, AttributeError):
                    log.warning(
                        f"{self.config.code}.fetch_positions.unsupported",
                        market_type=market_type,
                    )
                    continue
                except Exception as exc:
                    raise _map_ccxt_error(exc, venue=self.config.code) from exc

                markets = client.markets or {}
                for raw in raw_positions:
                    pos = _parse_ccxt_position(raw, markets, self.exchange)
                    if pos is not None:
                        out.append(pos)

                log.info(
                    f"{self.config.code}.fetch_positions",
                    market_type=market_type,
                    raw_count=len(raw_positions),
                    open_count=len(out),
                )
            finally:
                await self._close_safely(client)

        return out

    # ------------------------------------------------------------------
    # fetch_klines (public, no auth)
    # ------------------------------------------------------------------

    async def fetch_klines(
        self,
        symbol: str,
        start_ms: int,
        end_ms: int,
        *,
        interval: str = "1m",
    ) -> list[dict[str, Any]]:
        """Fetch public OHLCV in [start_ms, end_ms].

        Iterates ``config.market_types`` until one returns bars. Reuses
        the same per-venue page-and-merge logic as the legacy adapter.
        """
        if not self.config.supports_klines:
            raise AdapterUnsupportedError(
                f"{self.config.code} does not support klines"
            )

        for market_type in self.config.market_types:
            cls = getattr(ccxt_async, self.config.ccxt_id, None)
            if cls is None:
                raise AdapterUnsupportedError(
                    f"ccxt has no async exchange {self.config.ccxt_id!r}"
                )
            cfg_opts = dict(self.config.ccxt_options or {})
            nested = dict(cfg_opts.get("options") or {})
            nested["defaultType"] = market_type
            cfg_opts["options"] = nested
            cfg_opts["enableRateLimit"] = False
            client = cls(cfg_opts)

            try:
                try:
                    bars = await self._page_ohlcv(
                        client, symbol, interval, start_ms, end_ms
                    )
                except (ccxt_async.BadSymbol, ccxt_async.BadRequest):
                    continue
                except Exception as exc:
                    raise _map_ccxt_error(exc, venue=self.config.code) from exc

                if bars:
                    return bars
            finally:
                await self._close_safely(client)

        log.warning(
            f"{self.config.code}.fetch_klines.symbol_not_found",
            symbol=symbol,
            interval=interval,
        )
        return []

    @staticmethod
    async def _page_ohlcv(
        client: Any,
        symbol: str,
        timeframe: str,
        start_ms: int,
        end_ms: int,
    ) -> list[dict[str, Any]]:
        """Page ccxt fetch_ohlcv until we cover [start_ms, end_ms]."""
        out: dict[int, dict[str, Any]] = {}
        cursor = start_ms
        tf_ms = (
            client.parse_timeframe(timeframe) * 1000
            if hasattr(client, "parse_timeframe")
            else 60_000
        )

        max_iterations = 500
        iters = 0
        while cursor <= end_ms and iters < max_iterations:
            iters += 1
            raw_bars: list[list[Any]] = await client.fetch_ohlcv(
                symbol, timeframe=timeframe, since=cursor, limit=1000
            )
            if not raw_bars:
                break

            advanced = False
            for row in raw_bars:
                ts = int(row[0])
                if ts > end_ms:
                    continue
                if ts not in out:
                    out[ts] = {
                        "ts_ms": ts,
                        "open": Decimal(str(row[1])),
                        "high": Decimal(str(row[2])),
                        "low": Decimal(str(row[3])),
                        "close": Decimal(str(row[4])),
                        "volume": (
                            Decimal(str(row[5])) if row[5] is not None else Decimal("0")
                        ),
                    }
                    advanced = True

            last_ts = int(raw_bars[-1][0])
            if last_ts >= end_ms or not advanced:
                cursor = last_ts + tf_ms
                if not advanced:
                    break
            else:
                cursor = last_ts + tf_ms

        return sorted(out.values(), key=lambda b: int(b["ts_ms"]))
