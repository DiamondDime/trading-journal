"""Hyperliquid perp DEX adapter.

Design notes
============

Why no ccxt
-----------
ccxt does not have full Hyperliquid coverage (no userFillsByTime, no userFunding, partial
userState support). Hyperliquid exposes a single POST /info endpoint with a ``type`` field
that selects the query. Direct httpx gives us exact control over the request shape and
response parsing with no ccxt version dependency.

Time-window halving algorithm
------------------------------
Hyperliquid caps userFillsByTime at 10,000 fills per call. If a response is exactly 10,000
rows the window is too large — we don't know whether there are more. The halving strategy:

    1. Request [start, end].
    2. If len(response) < 10,000 → page is complete; yield and advance start to end.
    3. If len(response) == 10,000 → halve: mid = start + (end - start) / 2.
       Request [start, mid] recursively, then [mid, end] recursively.

This is bounded: for a 30-day window the worst case is ⌈log₂(window_ms / min_ms)⌉ recursion
levels before windows are small enough that fill density < 10K. We cap minimum window at 60 s
(60,000 ms) so the recursion always terminates.

Side / direction mapping from ``dir`` field
--------------------------------------------
Hyperliquid encodes open/close × long/short in a single ``dir`` string:

    "Open Long"   → side=BUY,  position_side=LONG,  reduce_only=False
    "Close Long"  → side=SELL, position_side=LONG,  reduce_only=True
    "Open Short"  → side=SELL, position_side=SHORT, reduce_only=False
    "Close Short" → side=BUY,  position_side=SHORT, reduce_only=True

1h funding cadence vs 8h CEX
------------------------------
Hyperliquid settles funding every hour (not every 8h as on Binance/Bybit/OKX). The funding
rate returned by the API is already the per-settlement rate (not annualised). When computing
APR callers should multiply by 24 × 365 (not 3 × 365) to normalise against 8h-cadence venues.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx
import structlog

from csj_worker.adapters.base import (
    AdapterAuthError,
    AdapterExchangeDownError,
    AdapterInvalidDataError,
    AdapterNetworkError,
    AdapterRateLimitedError,
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
    WalletCredentials,
)

log = structlog.get_logger(__name__)

_API_BASE = "https://api.hyperliquid.xyz/info"
_FILLS_PAGE_CAP = 10_000
_MIN_WINDOW_MS = 60_000  # 1 minute — recursion floor


def _dt_to_ms(dt: datetime) -> int:
    """Convert datetime to milliseconds epoch, always UTC."""
    return int(dt.timestamp() * 1000)


def _ms_to_dt(ms: int) -> datetime:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc)


def _require_wallet(credentials: Credentials) -> WalletCredentials:
    if not isinstance(credentials, WalletCredentials):
        raise AdapterAuthError(
            "Hyperliquid requires WalletCredentials (wallet address), "
            "not ApiKeyCredentials. API keys are not supported on this DEX."
        )
    return credentials


def _parse_decimal(value: str | float | int, field: str) -> Decimal:
    try:
        return Decimal(str(value))
    except InvalidOperation as exc:
        raise AdapterInvalidDataError(
            f"Cannot parse Decimal from field '{field}': {value!r}"
        ) from exc


def _map_dir(
    direction: str,
) -> tuple[Side, PositionSide, bool]:
    """Return (side, position_side, reduce_only) from Hyperliquid ``dir`` field."""
    mapping: dict[str, tuple[Side, PositionSide, bool]] = {
        "Open Long": (Side.BUY, PositionSide.LONG, False),
        "Close Long": (Side.SELL, PositionSide.LONG, True),
        "Open Short": (Side.SELL, PositionSide.SHORT, False),
        "Close Short": (Side.BUY, PositionSide.SHORT, True),
    }
    try:
        return mapping[direction]
    except KeyError as exc:
        raise AdapterInvalidDataError(
            f"Unknown Hyperliquid fill direction: {direction!r}. "
            f"Expected one of {list(mapping)}"
        ) from exc


def _make_instrument(coin: str) -> CanonicalInstrument:
    return CanonicalInstrument(
        exchange=Exchange.HYPERLIQUID,
        kind=InstrumentKind.PERP,
        base=coin.upper(),
        quote="USDC",
        raw_symbol=coin,
    )


def _normalize_fill(raw: dict[str, Any]) -> CanonicalFill:
    """Map a single raw Hyperliquid fill dict to CanonicalFill."""
    try:
        coin: str = raw["coin"]
        px = _parse_decimal(raw["px"], "px")
        sz = _parse_decimal(raw["sz"], "sz")
        fee = _parse_decimal(raw["fee"], "fee")
        direction: str = raw["dir"]
        tid: int = raw["tid"]
        oid: int | None = raw.get("oid")
        ts_ms: int = raw["time"]
        is_maker: bool = not raw.get("crossed", True)  # crossed=True → taker
    except KeyError as exc:
        raise AdapterInvalidDataError(f"Missing field in fill response: {exc}") from exc

    side, position_side, reduce_only = _map_dir(direction)
    notional = sz * px
    fee_kind = FeeKind.MAKER if is_maker else FeeKind.TAKER

    return CanonicalFill(
        external_trade_id=str(tid),
        external_order_id=str(oid) if oid is not None else None,
        instrument=_make_instrument(coin),
        side=side,
        qty=sz,
        price=px,
        notional=notional,
        fee=fee,
        fee_currency="USDC",
        fee_kind=fee_kind,
        is_maker=is_maker,
        liquidity="maker" if is_maker else "taker",
        position_side=position_side,
        reduce_only=reduce_only,
        filled_at=_ms_to_dt(ts_ms),
        raw=raw,
    )


def _normalize_funding(raw: dict[str, Any]) -> CanonicalFundingEvent:
    """Map a raw Hyperliquid funding event to CanonicalFundingEvent."""
    try:
        coin: str = raw["coin"]
        usdc = _parse_decimal(raw["usdc"], "usdc")
        szi = _parse_decimal(raw["szi"], "szi")
        rate = _parse_decimal(raw["fundingRate"], "fundingRate")
        ts_ms: int = raw["time"]
    except KeyError as exc:
        raise AdapterInvalidDataError(
            f"Missing field in funding response: {exc}"
        ) from exc

    # usdc negative → paid by us (long pays longs when rate positive)
    # usdc positive → received
    direction = FundingDirection.RECEIVED if usdc >= 0 else FundingDirection.PAID

    # External ID: coin + timestamp (Hyperliquid has no dedicated funding event ID)
    external_id = f"{coin}-{ts_ms}"

    return CanonicalFundingEvent(
        instrument=_make_instrument(coin),
        direction=direction,
        funding_rate=rate,
        position_qty=abs(szi),
        amount=abs(usdc),
        amount_currency="USDC",
        occurred_at=_ms_to_dt(ts_ms),
        external_id=external_id,
        raw=raw,
    )


class HyperliquidAdapter(ExchangeAdapter):
    """Hyperliquid perp DEX adapter.

    Auth model: wallet address only — no API key, no secret. Any request
    to userState that returns without an HTTP error is considered a successful
    auth check (even an empty state means the wallet exists on-chain).
    """

    exchange = Exchange.HYPERLIQUID
    exchange_kind = ExchangeKind.DEX
    auth_mode = AuthMode.WALLET_ADDRESS

    capabilities = AdapterCapabilities(
        exchange=Exchange.HYPERLIQUID,
        exchange_kind=ExchangeKind.DEX,
        auth_mode=AuthMode.WALLET_ADDRESS,
        supports_spot=False,
        supports_perp=True,
        supports_dated_futures=False,
        supports_options=False,
        supports_funding_history=True,
        supports_open_positions=True,
        max_lookback_days=None,  # Hyperliquid keeps full history
        page_size=_FILLS_PAGE_CAP,
    )

    # ~10 req/s conservatively against 1200 req/min limit
    rate_limit = RateLimitPolicy(
        requests_per_second=10.0,
        burst=20,
        cooloff_seconds=30,
    )

    retry_policy = RetryPolicy(
        max_attempts=5,
        base_delay_ms=500,
        max_delay_ms=30_000,
        jitter=True,
    )

    def __init__(self, client: httpx.AsyncClient | None = None) -> None:
        self._client = client or httpx.AsyncClient(
            timeout=httpx.Timeout(30.0, connect=10.0),
            headers={"Content-Type": "application/json"},
        )
        self._lock = asyncio.Lock()

    async def _post(self, payload: dict[str, Any]) -> Any:
        """POST to /info endpoint. Raises adapter errors on non-200 / transport failure."""
        try:
            resp = await self._client.post(_API_BASE, json=payload)
        except httpx.TimeoutException as exc:
            raise AdapterNetworkError(
                f"Hyperliquid request timed out: {exc}", cause=exc
            ) from exc
        except httpx.RequestError as exc:
            raise AdapterNetworkError(
                f"Hyperliquid network error: {exc}", cause=exc
            ) from exc

        if resp.status_code == 429:
            retry_after: float | None = None
            ra_header = resp.headers.get("Retry-After")
            if ra_header is not None:
                try:
                    retry_after = float(ra_header)
                except ValueError:
                    pass
            raise AdapterRateLimitedError(
                "Hyperliquid rate limit exceeded (429)",
                retry_after=retry_after,
            )

        if resp.status_code >= 500:
            raise AdapterExchangeDownError(
                f"Hyperliquid returned {resp.status_code}: {resp.text[:200]}"
            )

        if resp.status_code >= 400:
            raise AdapterNetworkError(
                f"Hyperliquid returned {resp.status_code}: {resp.text[:200]}"
            )

        try:
            return resp.json()
        except Exception as exc:
            raise AdapterInvalidDataError(
                f"Hyperliquid response is not valid JSON: {resp.text[:200]}"
            ) from exc

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def connect(self, credentials: Credentials) -> ConnectionStatusResult:
        """Validate wallet address and return connection health.

        Makes a single userState call — even an empty state (no positions) means the
        wallet is valid on-chain. Rejects ApiKeyCredentials immediately.
        """
        creds = _require_wallet(credentials)

        log.info("hyperliquid.connect", address=creds.address[:8] + "…")

        try:
            await self._post({"type": "userState", "user": creds.address})
        except AdapterAuthError:
            raise
        except AdapterRateLimitedError:
            raise
        except (AdapterNetworkError, AdapterExchangeDownError) as exc:
            return ConnectionStatusResult(
                health=ConnectionHealth.UNREACHABLE,
                auth_mode=self.auth_mode,
                permissions=[],
                message=str(exc),
            )

        log.info("hyperliquid.connect.ok", address=creds.address[:8] + "…")
        return ConnectionStatusResult(
            health=ConnectionHealth.OK,
            auth_mode=self.auth_mode,
            permissions=["read"],
            server_time=datetime.now(tz=timezone.utc),
        )

    async def validate_credentials(self, credentials: Credentials) -> bool:
        """Re-check wallet validity without mutating cached state."""
        creds = _require_wallet(credentials)
        try:
            await self._post({"type": "userState", "user": creds.address})
            return True
        except AdapterAuthError:
            return False
        except (AdapterNetworkError, AdapterExchangeDownError):
            raise  # caller retries on transport errors

    # ------------------------------------------------------------------
    # Fills — time-windowed with halving fallback
    # ------------------------------------------------------------------

    async def _fetch_fills_window(
        self,
        address: str,
        start_ms: int,
        end_ms: int,
    ) -> list[dict[str, Any]]:
        """Fetch fills for [start_ms, end_ms). Halves window if cap hit."""
        if end_ms - start_ms < _MIN_WINDOW_MS:
            # Window too narrow — fetch userFills (non-windowed) as fallback
            # but bound to the narrow window by post-filtering. This avoids
            # infinite recursion on very dense trading intervals.
            log.warning(
                "hyperliquid.fills.window_too_narrow",
                start_ms=start_ms,
                end_ms=end_ms,
                min_window_ms=_MIN_WINDOW_MS,
            )
            raw: list[dict[str, Any]] = await self._post(
                {"type": "userFills", "user": address}
            )
            if not isinstance(raw, list):
                raise AdapterInvalidDataError(
                    f"userFills expected list, got {type(raw).__name__}"
                )
            return [f for f in raw if start_ms <= f["time"] < end_ms]

        payload: dict[str, Any] = {
            "type": "userFillsByTime",
            "user": address,
            "startTime": start_ms,
            "endTime": end_ms,
        }
        raw = await self._post(payload)
        if not isinstance(raw, list):
            raise AdapterInvalidDataError(
                f"userFillsByTime expected list, got {type(raw).__name__}"
            )

        if len(raw) < _FILLS_PAGE_CAP:
            return raw

        # Exactly at cap — halve and recurse
        log.info(
            "hyperliquid.fills.window_cap_hit",
            start_ms=start_ms,
            end_ms=end_ms,
            cap=_FILLS_PAGE_CAP,
        )
        mid_ms = start_ms + (end_ms - start_ms) // 2
        left = await self._fetch_fills_window(address, start_ms, mid_ms)
        right = await self._fetch_fills_window(address, mid_ms, end_ms)
        return left + right

    async def _fetch_fills_all(
        self,
        address: str,
        since_ms: int,
        until_ms: int,
    ) -> list[dict[str, Any]]:
        """Collect all fills in [since_ms, until_ms] using the halving strategy."""
        return await self._fetch_fills_window(address, since_ms, until_ms)

    def fetch_fills(
        self,
        credentials: Credentials,
        *,
        since: datetime,
        until: datetime,
    ) -> AsyncIterator[list[CanonicalFill]]:
        """Yield a single page of fills — Hyperliquid is windowed, not cursor-based.

        Returns a single page (all fills for the time range). The halving logic inside
        _fetch_fills_all handles large windows transparently.
        """
        return self._fills_generator(credentials, since, until)

    async def _fills_generator(
        self,
        credentials: Credentials,
        since: datetime,
        until: datetime,
    ) -> AsyncIterator[list[CanonicalFill]]:
        creds = _require_wallet(credentials)
        since_ms = _dt_to_ms(since)
        until_ms = _dt_to_ms(until)

        log.info(
            "hyperliquid.fetch_fills",
            address=creds.address[:8] + "…",
            since_ms=since_ms,
            until_ms=until_ms,
        )

        raw_fills = await self._fetch_fills_all(creds.address, since_ms, until_ms)

        if not raw_fills:
            return

        canonical: list[CanonicalFill] = []
        for raw in raw_fills:
            canonical.append(_normalize_fill(raw))

        # Sort ASC by filled_at (API may return DESC)
        canonical.sort(key=lambda f: f.filled_at)

        log.info(
            "hyperliquid.fetch_fills.done",
            address=creds.address[:8] + "…",
            count=len(canonical),
        )
        yield canonical

    # ------------------------------------------------------------------
    # Funding events — 1h cadence
    # ------------------------------------------------------------------

    def fetch_funding_events(
        self,
        credentials: Credentials,
        *,
        since: datetime,
        until: datetime,
    ) -> AsyncIterator[list[CanonicalFundingEvent]]:
        return self._funding_generator(credentials, since, until)

    async def _funding_generator(
        self,
        credentials: Credentials,
        since: datetime,
        until: datetime,
    ) -> AsyncIterator[list[CanonicalFundingEvent]]:
        creds = _require_wallet(credentials)
        since_ms = _dt_to_ms(since)
        until_ms = _dt_to_ms(until)

        log.info(
            "hyperliquid.fetch_funding",
            address=creds.address[:8] + "…",
            since_ms=since_ms,
            until_ms=until_ms,
        )

        raw: Any = await self._post(
            {
                "type": "userFunding",
                "user": creds.address,
                "startTime": since_ms,
                "endTime": until_ms,
            }
        )

        if not isinstance(raw, list):
            raise AdapterInvalidDataError(
                f"userFunding expected list, got {type(raw).__name__}"
            )

        events: list[CanonicalFundingEvent] = []
        for item in raw:
            # userFunding response is a list of dicts with a nested "delta" key
            # Shape: {"time": ms, "hash": "0x...", "delta": {"type": "funding", "coin": ...,
            #          "usdc": ..., "szi": ..., "fundingRate": ...}}
            delta = item.get("delta") if isinstance(item, dict) else None
            if delta is not None and isinstance(delta, dict):
                flat = {
                    "time": item["time"],
                    "coin": delta["coin"],
                    "usdc": delta["usdc"],
                    "szi": delta["szi"],
                    "fundingRate": delta["fundingRate"],
                }
            else:
                # Flat format (fixture-compatible / alternate shape)
                flat = item

            ts_ms: int = flat["time"]
            if not (since_ms <= ts_ms <= until_ms):
                continue

            events.append(_normalize_funding(flat))

        events.sort(key=lambda e: e.occurred_at)

        log.info(
            "hyperliquid.fetch_funding.done",
            address=creds.address[:8] + "…",
            count=len(events),
        )

        if events:
            yield events

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
        """Fetch Hyperliquid candles for a coin in [start_ms, end_ms].

        Hyperliquid's `/info` endpoint exposes klines via the ``candleSnapshot``
        type. The ``coin`` is the bare base symbol (e.g. ``BTC``, ``ETH``) —
        Hyperliquid is perp-only and uses USDC settlement so we don't pass a
        market suffix.

        Public endpoint — no auth needed.

        Response shape per candle::

            {"t": start_ms, "T": end_ms, "s": "BTC", "i": "1m",
             "o": "68150.0", "h": "...", "l": "...", "c": "...", "v": "..."}

        Hyperliquid caps each call to 5000 bars; we page forward in chunks
        of (end - start) ms and dedupe by `t` (bar open time).
        """
        coin = self._symbol_to_coin(symbol)
        # candleSnapshot accepts interval strings: "1m", "3m", "5m", "15m",
        # "30m", "1h", "2h", "4h", "8h", "12h", "1d", "3d", "1w", "1M".
        # We pass through directly — caller selects per duration.

        out: dict[int, dict[str, Any]] = {}
        # Hyperliquid returns at most ~5000 bars per call. To stay safely
        # under that, we chunk the request window into ≤ 4000-bar slices.
        interval_ms = self._interval_to_ms(interval)
        chunk_ms = interval_ms * 4000

        cursor = start_ms
        max_iterations = 50  # safety cap (50 * 4000 bars = 200K bars per call)
        iters = 0
        while cursor <= end_ms and iters < max_iterations:
            iters += 1
            slice_end = min(cursor + chunk_ms, end_ms)
            try:
                raw = await self._post(
                    {
                        "type": "candleSnapshot",
                        "req": {
                            "coin": coin,
                            "interval": interval,
                            "startTime": cursor,
                            "endTime": slice_end,
                        },
                    }
                )
            except AdapterNetworkError:
                raise
            except AdapterRateLimitedError:
                raise

            if not isinstance(raw, list):
                raise AdapterInvalidDataError(
                    f"candleSnapshot expected list, got {type(raw).__name__}"
                )

            if not raw:
                # No more data in this slice — advance the cursor regardless
                # so we don't loop forever on empty windows.
                cursor = slice_end + interval_ms
                if slice_end >= end_ms:
                    break
                continue

            for bar in raw:
                try:
                    ts = int(bar["t"])
                    if ts > end_ms:
                        continue
                    if ts in out:
                        continue
                    out[ts] = {
                        "ts_ms": ts,
                        "open": Decimal(str(bar["o"])),
                        "high": Decimal(str(bar["h"])),
                        "low": Decimal(str(bar["l"])),
                        "close": Decimal(str(bar["c"])),
                        "volume": Decimal(str(bar.get("v", "0"))),
                    }
                except KeyError as exc:
                    raise AdapterInvalidDataError(
                        f"Hyperliquid candle missing field {exc}: {bar!r}"
                    ) from exc

            last_ts = int(raw[-1]["t"])
            if last_ts >= end_ms:
                break
            cursor = last_ts + interval_ms

        return sorted(out.values(), key=lambda b: b["ts_ms"])

    @staticmethod
    def _symbol_to_coin(symbol: str) -> str:
        """Strip quote / settlement suffix to get the bare coin symbol.

        Accepts: "BTC", "BTC-PERP", "BTC/USDC", "BTC/USDC:USDC", "BTCUSDC".
        Returns the base coin in uppercase.
        """
        s = symbol.upper().strip()
        # ccxt perp form first (most specific)
        if "/" in s:
            s = s.split("/", 1)[0]
        # Strip a dash suffix (Hyperliquid web uses "BTC-PERP")
        if "-" in s:
            s = s.split("-", 1)[0]
        # Strip trailing USDC / USD / USDT (Bybit-style concat — defensive)
        for tail in ("USDC", "USDT", "USD"):
            if s.endswith(tail) and len(s) > len(tail):
                return s[: -len(tail)]
        return s

    @staticmethod
    def _interval_to_ms(interval: str) -> int:
        """Convert a Hyperliquid interval string to milliseconds.

        Supports the same set as candleSnapshot. Unknown intervals fall back to 1 minute.
        """
        units = {
            "1m": 60_000,
            "3m": 3 * 60_000,
            "5m": 5 * 60_000,
            "15m": 15 * 60_000,
            "30m": 30 * 60_000,
            "1h": 60 * 60_000,
            "2h": 2 * 60 * 60_000,
            "4h": 4 * 60 * 60_000,
            "8h": 8 * 60 * 60_000,
            "12h": 12 * 60 * 60_000,
            "1d": 24 * 60 * 60_000,
            "3d": 3 * 24 * 60 * 60_000,
            "1w": 7 * 24 * 60 * 60_000,
            "1M": 30 * 24 * 60 * 60_000,  # approximate (calendar month varies)
        }
        return units.get(interval, 60_000)

    # ------------------------------------------------------------------
    # Open positions
    # ------------------------------------------------------------------

    async def fetch_open_positions(
        self,
        credentials: Credentials,
    ) -> list[CanonicalPosition]:
        creds = _require_wallet(credentials)

        log.info(
            "hyperliquid.fetch_positions", address=creds.address[:8] + "…"
        )

        raw: Any = await self._post(
            {"type": "clearinghouseState", "user": creds.address}
        )

        if not isinstance(raw, dict):
            raise AdapterInvalidDataError(
                f"clearinghouseState expected dict, got {type(raw).__name__}"
            )

        asset_positions: list[Any] = raw.get("assetPositions", [])
        positions: list[CanonicalPosition] = []

        for ap in asset_positions:
            pos_raw = ap.get("position", {})
            coin: str = pos_raw["coin"]
            szi = _parse_decimal(pos_raw["szi"], "szi")

            if szi == Decimal("0"):
                continue  # skip zero-size positions

            side = PositionSide.LONG if szi > 0 else PositionSide.SHORT
            qty_open = abs(szi)

            entry_px = _parse_decimal(pos_raw["entryPx"], "entryPx")

            unrealized_pnl: Decimal | None = None
            if "unrealizedPnl" in pos_raw:
                unrealized_pnl = _parse_decimal(pos_raw["unrealizedPnl"], "unrealizedPnl")

            liq_px: Decimal | None = None
            liq_raw = pos_raw.get("liquidationPx")
            if liq_raw is not None:
                liq_px = _parse_decimal(liq_raw, "liquidationPx")

            leverage: Decimal | None = None
            lev_raw = pos_raw.get("leverage")
            if isinstance(lev_raw, dict) and "value" in lev_raw:
                leverage = Decimal(str(lev_raw["value"]))

            positions.append(
                CanonicalPosition(
                    instrument=_make_instrument(coin),
                    side=side,
                    qty_open=qty_open,
                    avg_entry_price=entry_px,
                    unrealized_pnl=unrealized_pnl,
                    leverage=leverage,
                    liquidation_price=liq_px,
                    raw=ap,
                )
            )

        log.info(
            "hyperliquid.fetch_positions.done",
            address=creds.address[:8] + "…",
            count=len(positions),
        )
        return positions
