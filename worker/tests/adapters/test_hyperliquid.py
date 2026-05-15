"""Tests for HyperliquidAdapter.

All network calls are intercepted by respx. JSON fixtures are loaded from
worker/tests/fixtures/hyperliquid/. No real HTTP traffic is made.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from decimal import Decimal
from pathlib import Path
from typing import Any

import httpx
import pytest
import respx

from csj_worker.adapters.base import (
    AdapterAuthError,
    AdapterRateLimitedError,
)
from csj_worker.adapters.hyperliquid import HyperliquidAdapter, _FILLS_PAGE_CAP
from csj_worker.types import (
    ApiKeyCredentials,
    CanonicalFill,
    CanonicalFundingEvent,
    CanonicalPosition,
    ConnectionHealth,
    FundingDirection,
    PositionSide,
    Side,
    WalletCredentials,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_FIXTURES_DIR = Path(__file__).parent.parent / "fixtures" / "hyperliquid"
_API_URL = "https://api.hyperliquid.xyz/info"
_WALLET = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
_SINCE = 1715770000
_UNTIL = 1715870000


def _load(name: str) -> Any:
    return json.loads((_FIXTURES_DIR / name).read_text())


def _wallet_creds() -> WalletCredentials:
    return WalletCredentials(address=_WALLET)


def _api_key_creds() -> ApiKeyCredentials:
    return ApiKeyCredentials(api_key="key", api_secret="secret")


async def _drain_fills(gen: AsyncIterator[list[CanonicalFill]]) -> list[CanonicalFill]:
    pages: list[CanonicalFill] = []
    async for page in gen:
        pages.extend(page)
    return pages


async def _drain_funding(
    gen: AsyncIterator[list[CanonicalFundingEvent]],
) -> list[CanonicalFundingEvent]:
    events: list[CanonicalFundingEvent] = []
    async for page in gen:
        events.extend(page)
    return events


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def adapter() -> HyperliquidAdapter:
    # Use a real httpx.AsyncClient — respx will intercept at transport level.
    client = httpx.AsyncClient(
        timeout=httpx.Timeout(5.0),
        headers={"Content-Type": "application/json"},
    )
    return HyperliquidAdapter(client=client)


@pytest.fixture
def since() -> Any:
    from datetime import datetime, timezone

    return datetime.fromtimestamp(_SINCE, tz=timezone.utc)


@pytest.fixture
def until() -> Any:
    from datetime import datetime, timezone

    return datetime.fromtimestamp(_UNTIL, tz=timezone.utc)


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_connect_rejects_api_key_credentials(adapter: HyperliquidAdapter) -> None:
    """connect() must raise AdapterAuthError immediately if given ApiKeyCredentials."""
    with pytest.raises(AdapterAuthError, match="WalletCredentials"):
        await adapter.connect(_api_key_creds())


@pytest.mark.asyncio
@respx.mock
async def test_connect_succeeds_with_wallet_credentials(
    adapter: HyperliquidAdapter,
) -> None:
    """connect() returns health=OK when userState responds 200."""
    respx.post(_API_URL).mock(
        return_value=httpx.Response(200, json=_load("user_state.json"))
    )
    result = await adapter.connect(_wallet_creds())
    assert result.health == ConnectionHealth.OK
    assert result.auth_mode.value == "wallet_address"
    assert "read" in result.permissions


@pytest.mark.asyncio
@respx.mock
async def test_connect_reports_health_ok(adapter: HyperliquidAdapter) -> None:
    """connect() reports health OK and sets server_time."""
    respx.post(_API_URL).mock(
        return_value=httpx.Response(200, json=_load("user_state.json"))
    )
    result = await adapter.connect(_wallet_creds())
    assert result.health == ConnectionHealth.OK
    assert result.server_time is not None


# ---------------------------------------------------------------------------
# Fills — normalization
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@respx.mock
async def test_fetch_fills_normalizes_open_long_to_buy_long(
    adapter: HyperliquidAdapter,
    since: Any,
    until: Any,
) -> None:
    """'Open Long' dir maps to side=BUY, position_side=LONG, reduce_only=False."""
    # Build a single Open Long fill
    fill_data = [
        {
            "coin": "BTC",
            "px": "68150.0",
            "sz": "0.001",
            "side": "B",
            "time": _SINCE * 1000 + 5000,
            "startPosition": "0.0",
            "dir": "Open Long",
            "closedPnl": "0.0",
            "hash": "0x" + "a" * 64,
            "oid": 900001,
            "crossed": True,
            "fee": "0.068150",
            "tid": 1000001,
            "liquidationMarkPx": None,
        }
    ]
    respx.post(_API_URL).mock(return_value=httpx.Response(200, json=fill_data))

    fills = await _drain_fills(adapter.fetch_fills(_wallet_creds(), since=since, until=until))
    assert len(fills) == 1
    f = fills[0]
    assert f.side == Side.BUY
    assert f.position_side == PositionSide.LONG
    assert f.reduce_only is False
    assert f.instrument.base == "BTC"
    assert f.instrument.quote == "USDC"
    assert f.qty == Decimal("0.001")
    assert f.price == Decimal("68150.0")
    assert f.notional == Decimal("0.001") * Decimal("68150.0")
    assert f.fee == Decimal("0.068150")
    assert f.fee_currency == "USDC"
    assert f.external_trade_id == "1000001"


@pytest.mark.asyncio
@respx.mock
async def test_fetch_fills_normalizes_close_short_to_buy_long(
    adapter: HyperliquidAdapter,
    since: Any,
    until: Any,
) -> None:
    """'Close Short' dir maps to side=BUY, position_side=SHORT, reduce_only=True."""
    fill_data = [
        {
            "coin": "ETH",
            "px": "3050.0",
            "sz": "0.1",
            "side": "B",
            "time": _SINCE * 1000 + 10000,
            "startPosition": "-0.1",
            "dir": "Close Short",
            "closedPnl": "5.05",
            "hash": "0x" + "b" * 64,
            "oid": 900005,
            "crossed": True,
            "fee": "0.305000",
            "tid": 1000005,
            "liquidationMarkPx": None,
        }
    ]
    respx.post(_API_URL).mock(return_value=httpx.Response(200, json=fill_data))

    fills = await _drain_fills(adapter.fetch_fills(_wallet_creds(), since=since, until=until))
    assert len(fills) == 1
    f = fills[0]
    assert f.side == Side.BUY
    assert f.position_side == PositionSide.SHORT
    assert f.reduce_only is True


@pytest.mark.asyncio
@respx.mock
async def test_fetch_fills_halves_window_when_capacity_exceeded(
    adapter: HyperliquidAdapter,
    since: Any,
    until: Any,
) -> None:
    """When response has exactly 10K fills, adapter halves the window and recurses."""
    capacity_data: list[Any] = _load("user_fills_capacity_exceeded.json")
    assert len(capacity_data) == _FILLS_PAGE_CAP

    # First call (full window) → 10K (triggers halve)
    # Second call (left half) → empty
    # Third call (right half) → empty
    call_count = 0

    def side_effect(request: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        body = json.loads(request.content)
        if body.get("type") == "userFillsByTime":
            start = body.get("startTime", 0)
            end = body.get("endTime", 0)
            mid = start + (end - start) // 2
            # Return full capacity only for the initial full-window call
            if call_count == 1:
                return httpx.Response(200, json=capacity_data)
            # Subsequent halved calls return a small subset
            half = [f for f in capacity_data if start <= f["time"] < end][:5]
            return httpx.Response(200, json=half)
        return httpx.Response(200, json=[])

    respx.post(_API_URL).mock(side_effect=side_effect)

    fills = await _drain_fills(adapter.fetch_fills(_wallet_creds(), since=since, until=until))
    # Should have called at least twice (halved at least once)
    assert call_count >= 2
    # All fills returned should be CanonicalFill instances
    assert all(isinstance(f, CanonicalFill) for f in fills)


# ---------------------------------------------------------------------------
# Funding
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@respx.mock
async def test_fetch_funding_events_uses_hourly_cadence(
    adapter: HyperliquidAdapter,
    since: Any,
    until: Any,
) -> None:
    """Funding events from fixture have 1h spacing (not 8h like CEX)."""
    funding_data = _load("user_funding.json")
    respx.post(_API_URL).mock(return_value=httpx.Response(200, json=funding_data))

    events = await _drain_funding(
        adapter.fetch_funding_events(_wallet_creds(), since=since, until=until)
    )
    assert len(events) == len(funding_data)

    # Verify 1h spacing between consecutive BTC events
    btc_events = [e for e in events if e.instrument.base == "BTC"]
    assert len(btc_events) >= 2
    for i in range(1, len(btc_events)):
        delta_seconds = (
            btc_events[i].occurred_at - btc_events[i - 1].occurred_at
        ).total_seconds()
        assert delta_seconds == pytest.approx(3600, abs=1), (
            f"Expected 1h between funding events, got {delta_seconds}s"
        )

    # Verify direction and amount parsing
    for event in events:
        assert event.amount > 0
        assert event.amount_currency == "USDC"
        assert event.direction in (FundingDirection.RECEIVED, FundingDirection.PAID)
        assert isinstance(event.funding_rate, Decimal)
        assert event.external_id is not None


# ---------------------------------------------------------------------------
# Open positions
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@respx.mock
async def test_fetch_open_positions_returns_canonical_shape(
    adapter: HyperliquidAdapter,
) -> None:
    """fetch_open_positions maps clearinghouseState to CanonicalPosition list."""
    state_data = _load("clearinghouse_state.json")
    respx.post(_API_URL).mock(return_value=httpx.Response(200, json=state_data))

    positions = await adapter.fetch_open_positions(_wallet_creds())

    # Fixture has 3 non-zero positions: BTC (long), ETH (short), HYPE (long)
    assert len(positions) == 3

    btc_pos = next(p for p in positions if p.instrument.base == "BTC")
    assert btc_pos.side == PositionSide.LONG
    assert btc_pos.qty_open == Decimal("0.002")
    assert btc_pos.avg_entry_price == Decimal("68150.0")
    assert btc_pos.unrealized_pnl == Decimal("0.70")
    assert btc_pos.leverage == Decimal("10")
    assert btc_pos.liquidation_price == Decimal("61200.0")

    eth_pos = next(p for p in positions if p.instrument.base == "ETH")
    assert eth_pos.side == PositionSide.SHORT
    assert eth_pos.qty_open == Decimal("0.1")

    for pos in positions:
        assert isinstance(pos, CanonicalPosition)
        assert pos.instrument.exchange.value == "hyperliquid"
        assert pos.instrument.quote == "USDC"


# ---------------------------------------------------------------------------
# Error handling
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@respx.mock
async def test_rate_limit_429_is_retryable(adapter: HyperliquidAdapter) -> None:
    """HTTP 429 raises AdapterRateLimitedError which has retryable=True."""
    respx.post(_API_URL).mock(
        return_value=httpx.Response(429, headers={"Retry-After": "5"}, text="Too Many Requests")
    )

    with pytest.raises(AdapterRateLimitedError) as exc_info:
        await adapter.connect(_wallet_creds())

    err = exc_info.value
    assert err.retryable is True
    assert err.retry_after == pytest.approx(5.0)
