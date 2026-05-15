"""Tests for BinanceAdapter.

Strategy: patch ccxt sub-client factory so every ccxt coroutine call is an
AsyncMock backed by fixture JSON.  This avoids real HTTP while exercising all
our parsing, pagination, and error-mapping code.
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from csj_worker.adapters.base import (
    AdapterAuthError,
    AdapterPermissionError,
    AdapterRateLimitedError,
)
from csj_worker.adapters.binance import BinanceAdapter, _build_clients
from csj_worker.types import (
    ApiKeyCredentials,
    ConnectionHealth,
    Exchange,
    FundingDirection,
    InstrumentKind,
    PositionSide,
    Side,
)

# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------

FIXTURES_DIR = Path(__file__).parent.parent / "fixtures" / "binance"


def _load(name: str) -> Any:
    return json.loads((FIXTURES_DIR / name).read_text())


def _creds(api_key: str = "testkey", secret: str = "testsecret") -> ApiKeyCredentials:
    return ApiKeyCredentials(api_key=api_key, api_secret=secret)


def _since() -> datetime:
    return datetime(2024, 5, 15, 0, 0, 0, tzinfo=timezone.utc)


def _until() -> datetime:
    return datetime(2024, 5, 16, 0, 0, 0, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# ccxt-to-canonical fixture converters
#
# The adapter uses ccxt's parsed representation, NOT the raw Binance JSON.
# ccxt normalises field names (e.g. "id", "side", "amount", "price", "cost",
# "timestamp", "takerOrMaker", "fee").  We build ccxt-shaped dicts from our
# Binance-shaped fixtures so tests remain realistic.
# ---------------------------------------------------------------------------


def _binance_trade_to_ccxt(raw: dict[str, Any], symbol: str = "BTC/USDT") -> dict[str, Any]:
    """Convert a Binance REST trade object to the ccxt normalised shape."""
    is_maker: bool = raw["isMaker"]
    return {
        "id": str(raw["id"]),
        "order": str(raw["orderId"]),
        "datetime": None,
        "timestamp": raw["time"],
        "symbol": symbol,
        "type": None,
        "side": "buy" if raw["isBuyer"] else "sell",
        "takerOrMaker": "maker" if is_maker else "taker",
        "price": float(raw["price"]),
        "amount": float(raw["qty"]),
        "cost": float(raw["quoteQty"]),
        "fee": {
            "cost": float(raw["commission"]),
            "currency": raw["commissionAsset"],
        },
        "fees": [],
        "info": raw,
    }


def _binance_funding_to_ccxt(raw: dict[str, Any], symbol: str = "BTC/USDT:USDT") -> dict[str, Any]:
    """Convert a Binance income record to the ccxt normalised funding shape."""
    amount = float(raw["income"])
    return {
        "id": raw["tranId"],
        "symbol": symbol,
        "code": raw["asset"],
        "timestamp": raw["time"],
        "datetime": None,
        "amount": amount,
        "info": {
            "symbol": raw["symbol"],
            "incomeType": raw["incomeType"],
            "income": raw["income"],
            "asset": raw["asset"],
            "info": raw.get("info", ""),
            "time": raw["time"],
            "tranId": raw["tranId"],
            "tradeId": raw.get("tradeId", ""),
            "fundingRate": "0.00010000",
            "positionAmt": "0.001",
        },
    }


def _binance_position_to_ccxt(raw: dict[str, Any]) -> dict[str, Any]:
    """Convert a Binance positionRisk record to a ccxt position shape."""
    amt = float(raw["positionAmt"])
    side_str = raw.get("positionSide", "BOTH").upper()
    if side_str == "LONG" or (side_str == "BOTH" and amt > 0):
        side = "long"
    elif side_str == "SHORT" or (side_str == "BOTH" and amt < 0):
        side = "short"
    else:
        side = "long"

    symbol_ccxt = raw["symbol"].replace("USDT", "/USDT:USDT")
    return {
        "id": None,
        "symbol": symbol_ccxt,
        "timestamp": raw.get("updateTime"),
        "datetime": None,
        "initialMargin": None,
        "initialMarginPercentage": None,
        "maintenanceMargin": None,
        "maintenanceMarginPercentage": None,
        "entryPrice": float(raw["entryPrice"]) if raw["entryPrice"] else 0.0,
        "notional": float(raw["notional"]) if raw["notional"] else 0.0,
        "leverage": float(raw["leverage"]),
        "unrealizedPnl": float(raw["unRealizedProfit"]),
        "contracts": abs(amt),
        "contractSize": 1.0,
        "marginRatio": None,
        "liquidationPrice": float(raw["liquidationPrice"]) if raw["liquidationPrice"] else None,
        "markPrice": float(raw["markPrice"]),
        "collateral": None,
        "marginMode": raw["marginType"],
        "side": side,
        "percentage": None,
        "info": raw,
    }


# ---------------------------------------------------------------------------
# Shared mock builder
# ---------------------------------------------------------------------------


def _make_mock_client(
    *,
    account_info: dict[str, Any] | None = None,
    trades: list[dict[str, Any]] | None = None,
    funding: list[dict[str, Any]] | None = None,
    positions: list[dict[str, Any]] | None = None,
    markets: dict[str, Any] | None = None,
    raise_on: type[Exception] | None = None,
) -> MagicMock:
    """Build a MagicMock that behaves like a ccxt async client."""
    client = MagicMock()

    # load_markets is a coroutine that sets client.markets
    _markets = markets or {
        "BTC/USDT": {
            "symbol": "BTC/USDT",
            "base": "BTC",
            "quote": "USDT",
            "type": "spot",
            "active": True,
        }
    }

    async def _load_markets() -> dict[str, Any]:
        client.markets = _markets
        return _markets

    client.load_markets = _load_markets
    client.markets = _markets

    if raise_on is not None:
        client.fetch_balance = AsyncMock(side_effect=raise_on("mocked error"))
        client.fetch_my_trades = AsyncMock(side_effect=raise_on("mocked error"))
    else:
        _balance_payload: dict[str, Any] = {
            "info": account_info or {},
            "USDT": {"free": 1000.0, "used": 0.0, "total": 1000.0},
        }
        client.fetch_balance = AsyncMock(return_value=_balance_payload)
        client.fetch_my_trades = AsyncMock(return_value=trades or [])
        client.fetch_income_history = AsyncMock(return_value=funding or [])
        client.fetch_positions = AsyncMock(return_value=positions or [])

    client.close = AsyncMock()
    return client


# ---------------------------------------------------------------------------
# Tests: connect()
# ---------------------------------------------------------------------------


class TestConnect:
    @pytest.mark.asyncio
    async def test_connect_reports_health_ok_with_valid_creds(self) -> None:
        account = _load("account_read_only.json")
        usdm_balance = {"info": {"updateTime": int(time.time() * 1000)}, "USDT": {}}
        spot_balance = {"info": account, "USDT": {}}

        spot_client = _make_mock_client(account_info=account)
        spot_client.fetch_balance = AsyncMock(return_value=spot_balance)

        usdm_client = _make_mock_client()
        usdm_client.fetch_balance = AsyncMock(return_value=usdm_balance)

        coinm_client = _make_mock_client()

        with patch(
            "csj_worker.adapters.binance._build_clients",
            return_value={"spot": spot_client, "usdm": usdm_client, "coinm": coinm_client},
        ):
            adapter = BinanceAdapter()
            result = await adapter.connect(_creds())

        assert result.health == ConnectionHealth.OK
        assert "canTrade" in result.permissions

    @pytest.mark.asyncio
    async def test_connect_rejects_credentials_with_withdraw_permission(self) -> None:
        account = _load("account_with_withdraw.json")
        spot_balance = {"info": account, "USDT": {}}
        usdm_balance = {"info": {}, "USDT": {}}

        spot_client = _make_mock_client(account_info=account)
        spot_client.fetch_balance = AsyncMock(return_value=spot_balance)

        usdm_client = _make_mock_client()
        usdm_client.fetch_balance = AsyncMock(return_value=usdm_balance)

        coinm_client = _make_mock_client()

        with patch(
            "csj_worker.adapters.binance._build_clients",
            return_value={"spot": spot_client, "usdm": usdm_client, "coinm": coinm_client},
        ):
            adapter = BinanceAdapter()
            result = await adapter.connect(_creds())

        assert result.health == ConnectionHealth.PERMISSION
        assert "canWithdraw" in result.permissions

    @pytest.mark.asyncio
    async def test_connect_raises_auth_error_on_invalid_signature(self) -> None:
        import ccxt.async_support as ccxt_async

        spot_client = _make_mock_client()
        spot_client.fetch_balance = AsyncMock(
            side_effect=ccxt_async.AuthenticationError("Invalid API key/secret")
        )
        usdm_client = _make_mock_client()
        usdm_client.fetch_balance = AsyncMock(
            side_effect=ccxt_async.AuthenticationError("Invalid API key/secret")
        )
        coinm_client = _make_mock_client()

        with patch(
            "csj_worker.adapters.binance._build_clients",
            return_value={"spot": spot_client, "usdm": usdm_client, "coinm": coinm_client},
        ):
            adapter = BinanceAdapter()
            result = await adapter.connect(_creds(api_key="bad", secret="bad"))

        assert result.health == ConnectionHealth.AUTH_FAILED


# ---------------------------------------------------------------------------
# Tests: fetch_fills()
# ---------------------------------------------------------------------------


class TestFetchFills:
    def _spot_markets(self) -> dict[str, Any]:
        return {
            "BTC/USDT": {
                "symbol": "BTC/USDT",
                "base": "BTC",
                "quote": "USDT",
                "type": "spot",
                "active": True,
            }
        }

    def _perp_markets(self) -> dict[str, Any]:
        return {
            "BTC/USDT:USDT": {
                "symbol": "BTC/USDT:USDT",
                "base": "BTC",
                "quote": "USDT",
                "type": "swap",
                "active": True,
            }
        }

    @pytest.mark.asyncio
    async def test_fetch_fills_paginates_via_from_id(self) -> None:
        """Two pages of spot trades: first page full (1000 items), second short."""
        raw_page1 = _load("my_trades_page1.json")
        raw_page2 = _load("my_trades_page2.json")

        # Build 1000-item first page by repeating fixtures (pagination trigger)
        ccxt_page1 = [_binance_trade_to_ccxt(t) for t in raw_page1] * 100  # 1000 items
        ccxt_page2 = [_binance_trade_to_ccxt(t) for t in raw_page2]  # 5 items

        # spot returns two pages then empty
        call_counter = {"n": 0}

        async def _my_trades(symbol: str, since: int | None = None, **kw: Any) -> list[Any]:
            call_counter["n"] += 1
            if call_counter["n"] == 1:
                return ccxt_page1
            if call_counter["n"] == 2:
                return ccxt_page2
            return []

        spot_client = _make_mock_client(markets=self._spot_markets())
        spot_client.fetch_my_trades = _my_trades

        usdm_client = _make_mock_client(markets=self._perp_markets())
        usdm_client.fetch_my_trades = AsyncMock(return_value=[])

        coinm_client = _make_mock_client(markets={})
        coinm_client.fetch_my_trades = AsyncMock(return_value=[])

        with patch(
            "csj_worker.adapters.binance._build_clients",
            return_value={"spot": spot_client, "usdm": usdm_client, "coinm": coinm_client},
        ):
            adapter = BinanceAdapter()
            gen = adapter.fetch_fills(_creds(), since=_since(), until=_until())
            pages: list[list[Any]] = []
            async for page in gen:
                pages.append(page)

        assert len(pages) == 2
        assert len(pages[0]) == 1000
        assert len(pages[1]) == 5

    @pytest.mark.asyncio
    async def test_fetch_fills_handles_empty_result(self) -> None:
        """When exchange returns nothing, generator yields nothing."""
        spot_client = _make_mock_client(markets=self._spot_markets())
        spot_client.fetch_my_trades = AsyncMock(return_value=[])

        usdm_client = _make_mock_client(markets={})
        usdm_client.fetch_my_trades = AsyncMock(return_value=[])

        coinm_client = _make_mock_client(markets={})
        coinm_client.fetch_my_trades = AsyncMock(return_value=[])

        with patch(
            "csj_worker.adapters.binance._build_clients",
            return_value={"spot": spot_client, "usdm": usdm_client, "coinm": coinm_client},
        ):
            adapter = BinanceAdapter()
            gen = adapter.fetch_fills(_creds(), since=_since(), until=_until())
            pages: list[Any] = []
            async for page in gen:
                pages.append(page)

        assert pages == []

    def _spot_markets(self) -> dict[str, Any]:
        return {
            "BTC/USDT": {
                "symbol": "BTC/USDT",
                "base": "BTC",
                "quote": "USDT",
                "type": "spot",
                "active": True,
            }
        }

    @pytest.mark.asyncio
    async def test_fetch_fills_normalizes_symbols_correctly(self) -> None:
        """Spot symbol → InstrumentKind.SPOT, perp → InstrumentKind.PERP."""
        spot_markets = {
            "BTC/USDT": {
                "symbol": "BTC/USDT",
                "base": "BTC",
                "quote": "USDT",
                "type": "spot",
                "active": True,
            }
        }
        perp_markets = {
            "BTC/USDT:USDT": {
                "symbol": "BTC/USDT:USDT",
                "base": "BTC",
                "quote": "USDT",
                "type": "swap",
                "active": True,
            }
        }

        raw_spot = [_load("my_trades_page1.json")[0]]
        raw_perp = [_load("my_trades_page1.json")[0]]

        ccxt_spot = [_binance_trade_to_ccxt(raw_spot[0], symbol="BTC/USDT")]
        ccxt_perp = [_binance_trade_to_ccxt(raw_perp[0], symbol="BTC/USDT:USDT")]

        spot_client = _make_mock_client(markets=spot_markets)
        spot_client.fetch_my_trades = AsyncMock(return_value=ccxt_spot)

        usdm_client = _make_mock_client(markets=perp_markets)
        usdm_client.fetch_my_trades = AsyncMock(return_value=ccxt_perp)

        coinm_client = _make_mock_client(markets={})
        coinm_client.fetch_my_trades = AsyncMock(return_value=[])

        with patch(
            "csj_worker.adapters.binance._build_clients",
            return_value={"spot": spot_client, "usdm": usdm_client, "coinm": coinm_client},
        ):
            adapter = BinanceAdapter()
            gen = adapter.fetch_fills(_creds(), since=_since(), until=_until())
            pages = [page async for page in gen]

        assert len(pages) == 2
        spot_fill = pages[0][0]
        perp_fill = pages[1][0]

        assert spot_fill.instrument.kind == InstrumentKind.SPOT
        assert spot_fill.instrument.base == "BTC"
        assert spot_fill.instrument.quote == "USDT"
        assert spot_fill.instrument.exchange == Exchange.BINANCE

        assert perp_fill.instrument.kind == InstrumentKind.PERP
        assert perp_fill.instrument.base == "BTC"
        assert perp_fill.instrument.raw_symbol == "BTC/USDT:USDT"


# ---------------------------------------------------------------------------
# Tests: fetch_funding_events()
# ---------------------------------------------------------------------------


class TestFetchFundingEvents:
    def _perp_markets(self) -> dict[str, Any]:
        return {
            "BTC/USDT:USDT": {
                "symbol": "BTC/USDT:USDT",
                "base": "BTC",
                "quote": "USDT",
                "type": "swap",
                "active": True,
            },
            "ETH/USDT:USDT": {
                "symbol": "ETH/USDT:USDT",
                "base": "ETH",
                "quote": "USDT",
                "type": "swap",
                "active": True,
            },
        }

    @pytest.mark.asyncio
    async def test_fetch_funding_events_yields_pages(self) -> None:
        raw_events = _load("funding_history_page1.json")
        # Map raw symbol to ccxt perp symbol
        symbol_map = {
            "BTCUSDT": "BTC/USDT:USDT",
            "ETHUSDT": "ETH/USDT:USDT",
            "SOLUSDT": "SOL/USDT:USDT",
        }
        ccxt_events = [
            _binance_funding_to_ccxt(e, symbol=symbol_map.get(e["symbol"], e["symbol"]))
            for e in raw_events
        ]

        usdm_client = _make_mock_client(markets=self._perp_markets())
        usdm_client.fetch_income_history = AsyncMock(
            side_effect=[ccxt_events, []]  # first call returns data, second signals end
        )

        coinm_client = _make_mock_client(markets={})
        coinm_client.fetch_income_history = AsyncMock(return_value=[])

        spot_client = _make_mock_client()

        with patch(
            "csj_worker.adapters.binance._build_clients",
            return_value={"spot": spot_client, "usdm": usdm_client, "coinm": coinm_client},
        ):
            adapter = BinanceAdapter()
            gen = adapter.fetch_funding_events(_creds(), since=_since(), until=_until())
            pages = [page async for page in gen]

        assert len(pages) == 1
        assert len(pages[0]) == 5

        btc_event = next(e for e in pages[0] if e.instrument.base == "BTC")
        # First BTC entry: income is negative → PAID
        assert btc_event.direction == FundingDirection.PAID
        assert btc_event.amount > Decimal(0)
        assert btc_event.instrument.kind == InstrumentKind.PERP


# ---------------------------------------------------------------------------
# Tests: fetch_open_positions()
# ---------------------------------------------------------------------------


class TestFetchOpenPositions:
    @pytest.mark.asyncio
    async def test_fetch_open_positions_returns_canonical_shape(self) -> None:
        raw_positions = _load("position_risk.json")
        perp_markets = {
            "BTC/USDT:USDT": {
                "symbol": "BTC/USDT:USDT",
                "base": "BTC",
                "quote": "USDT",
                "type": "swap",
                "active": True,
            },
            "ETH/USDT:USDT": {
                "symbol": "ETH/USDT:USDT",
                "base": "ETH",
                "quote": "USDT",
                "type": "swap",
                "active": True,
            },
        }
        ccxt_positions = [_binance_position_to_ccxt(p) for p in raw_positions]

        usdm_client = _make_mock_client(markets=perp_markets)
        usdm_client.fetch_positions = AsyncMock(return_value=ccxt_positions)

        coinm_client = _make_mock_client(markets={})
        coinm_client.fetch_positions = AsyncMock(return_value=[])

        spot_client = _make_mock_client()

        with patch(
            "csj_worker.adapters.binance._build_clients",
            return_value={"spot": spot_client, "usdm": usdm_client, "coinm": coinm_client},
        ):
            adapter = BinanceAdapter()
            positions = await adapter.fetch_open_positions(_creds())

        # Only non-zero positions should be returned (SOL has positionAmt=0)
        assert len(positions) == 2

        btc_pos = next(p for p in positions if p.instrument.base == "BTC")
        eth_pos = next(p for p in positions if p.instrument.base == "ETH")

        assert btc_pos.side == PositionSide.LONG
        assert btc_pos.qty_open == Decimal("0.001")
        assert btc_pos.leverage == Decimal("10")

        assert eth_pos.side == PositionSide.SHORT
        assert eth_pos.qty_open == Decimal("0.5")
        assert eth_pos.unrealized_pnl == Decimal("10.0")


# ---------------------------------------------------------------------------
# Tests: error mapping
# ---------------------------------------------------------------------------


class TestErrorMapping:
    @pytest.mark.asyncio
    async def test_rate_limit_error_is_retryable(self) -> None:
        """AdapterRateLimitedError must have retryable=True."""
        import ccxt.async_support as ccxt_async

        spot_client = _make_mock_client()
        spot_client.fetch_balance = AsyncMock(
            side_effect=ccxt_async.RateLimitExceeded("Too Many Requests retry after 5")
        )
        usdm_client = _make_mock_client()
        usdm_client.fetch_balance = AsyncMock(
            side_effect=ccxt_async.RateLimitExceeded("Too Many Requests retry after 5")
        )
        coinm_client = _make_mock_client()

        with patch(
            "csj_worker.adapters.binance._build_clients",
            return_value={"spot": spot_client, "usdm": usdm_client, "coinm": coinm_client},
        ):
            adapter = BinanceAdapter()
            result = await adapter.connect(_creds())

        # connect() maps RateLimitExceeded → UNREACHABLE (retryable network issue)
        # It does NOT raise; it returns a health result with UNREACHABLE
        assert result.health == ConnectionHealth.UNREACHABLE

    @pytest.mark.asyncio
    async def test_auth_error_is_not_retryable(self) -> None:
        """AdapterAuthError.retryable must be False."""
        from csj_worker.adapters.base import AdapterAuthError

        err = AdapterAuthError("bad key")
        assert err.retryable is False

    @pytest.mark.asyncio
    async def test_rate_limit_error_carries_retry_after(self) -> None:
        """AdapterRateLimitedError should propagate retry_after seconds."""
        err = AdapterRateLimitedError("rate limited", retry_after=30.0)
        assert err.retryable is True
        assert err.retry_after == 30.0

    @pytest.mark.asyncio
    async def test_fetch_fills_propagates_rate_limit_after_backoff(self) -> None:
        """Rate limit during fetch_fills triggers sleep then retry."""
        import ccxt.async_support as ccxt_async

        raw_page = [_load("my_trades_page2.json")[0]]
        ccxt_trade = [_binance_trade_to_ccxt(raw_page[0])]

        call_n = {"n": 0}

        async def _my_trades(symbol: str, since: int | None = None, **kw: Any) -> list[Any]:
            call_n["n"] += 1
            if call_n["n"] == 1:
                raise ccxt_async.RateLimitExceeded("rate limited")
            return ccxt_trade

        spot_client = _make_mock_client(
            markets={
                "BTC/USDT": {
                    "symbol": "BTC/USDT",
                    "base": "BTC",
                    "quote": "USDT",
                    "type": "spot",
                    "active": True,
                }
            }
        )
        spot_client.fetch_my_trades = _my_trades

        usdm_client = _make_mock_client(markets={})
        usdm_client.fetch_my_trades = AsyncMock(return_value=[])

        coinm_client = _make_mock_client(markets={})
        coinm_client.fetch_my_trades = AsyncMock(return_value=[])

        sleep_calls: list[float] = []

        async def _mock_sleep(delay: float) -> None:
            sleep_calls.append(delay)

        with patch(
            "csj_worker.adapters.binance._build_clients",
            return_value={"spot": spot_client, "usdm": usdm_client, "coinm": coinm_client},
        ), patch("csj_worker.adapters.binance.asyncio.sleep", side_effect=_mock_sleep):
            adapter = BinanceAdapter()
            gen = adapter.fetch_fills(_creds(), since=_since(), until=_until())
            pages = [page async for page in gen]

        # Should have slept once and then succeeded
        assert len(sleep_calls) == 1
        assert len(pages) == 1
        assert call_n["n"] == 2
