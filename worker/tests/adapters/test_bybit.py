"""Tests for BybitAdapter.

Fixtures live in tests/fixtures/bybit/ and mirror real Bybit v5 API shapes.
All ccxt I/O is patched at the ccxt.async_support.bybit method level so we
never touch a real network.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from csj_worker.adapters.base import (
    AdapterAuthError,
    AdapterPermissionError,
)
from csj_worker.adapters.bybit import BybitAdapter
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
# Fixtures directory helpers
# ---------------------------------------------------------------------------

_FIXTURE_DIR = Path(__file__).parent.parent / "fixtures" / "bybit"


def _load_fixture(name: str) -> dict[str, Any]:
    return json.loads((_FIXTURE_DIR / name).read_text())


# ---------------------------------------------------------------------------
# Shared test credentials
# ---------------------------------------------------------------------------

_CREDS = ApiKeyCredentials(api_key="test_key", api_secret="test_secret")


# ---------------------------------------------------------------------------
# Helpers to build mock ccxt clients
# ---------------------------------------------------------------------------


def _make_client(
    query_api_response: dict[str, Any],
    *,
    trade_pages: list[dict[str, Any]] | None = None,
    funding_pages: list[dict[str, Any]] | None = None,
    positions_response: dict[str, Any] | None = None,
) -> MagicMock:
    """Return a mock ccxt.bybit instance with preconfigured responses."""
    client = MagicMock()

    # query-api
    client.private_get_v5_user_query_api = AsyncMock(return_value=query_api_response)

    # fills — execution list
    if trade_pages is not None:
        client.private_get_v5_execution_list = AsyncMock(side_effect=trade_pages)
    else:
        client.private_get_v5_execution_list = AsyncMock(
            return_value={"retCode": 0, "retMsg": "OK", "result": {"list": [], "nextPageCursor": ""}}
        )

    # funding — transaction log
    if funding_pages is not None:
        client.private_get_v5_account_transaction_log = AsyncMock(side_effect=funding_pages)
    else:
        client.private_get_v5_account_transaction_log = AsyncMock(
            return_value={"retCode": 0, "retMsg": "OK", "result": {"list": [], "nextPageCursor": ""}}
        )

    # positions
    if positions_response is not None:
        client.private_get_v5_position_list = AsyncMock(return_value=positions_response)
    else:
        client.private_get_v5_position_list = AsyncMock(
            return_value={"retCode": 0, "retMsg": "OK", "result": {"list": [], "nextPageCursor": ""}}
        )

    client.close = AsyncMock()
    return client


# ---------------------------------------------------------------------------
# connect() tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_connect_reports_health_ok() -> None:
    fixture = _load_fixture("query_api_readonly.json")
    client = _make_client(fixture)
    adapter = BybitAdapter()

    with patch.object(adapter, "_build_client", return_value=client):
        result = await adapter.connect(_CREDS)

    assert result.health == ConnectionHealth.OK
    assert result.server_time is not None
    # Should include at least one ContractTrade permission
    assert any("ContractTrade" in p for p in result.permissions)
    client.close.assert_called_once()


@pytest.mark.asyncio
async def test_connect_rejects_credentials_with_trade_permission() -> None:
    """Keys with Withdraw in Wallet permissions must be rejected."""
    fixture = _load_fixture("query_api_with_trade.json")
    client = _make_client(fixture)
    adapter = BybitAdapter()

    with patch.object(adapter, "_build_client", return_value=client):
        with pytest.raises(AdapterPermissionError, match="Withdraw"):
            await adapter.connect(_CREDS)

    client.close.assert_called_once()


@pytest.mark.asyncio
async def test_connect_rejects_non_readonly_key() -> None:
    """A key where readOnly != 1 must be rejected even without Withdraw."""
    fixture = _load_fixture("query_api_readonly.json")
    # Mutate: flip readOnly to 0 (write-enabled, but no Withdraw)
    fixture = json.loads(json.dumps(fixture))
    fixture["result"]["readOnly"] = 0
    fixture["result"]["permissions"]["Wallet"] = ["AccountTransfer"]  # no Withdraw

    client = _make_client(fixture)
    adapter = BybitAdapter()

    with patch.object(adapter, "_build_client", return_value=client):
        with pytest.raises(AdapterPermissionError, match="read-only"):
            await adapter.connect(_CREDS)


@pytest.mark.asyncio
async def test_connect_raises_auth_error_on_bad_signature() -> None:
    """ccxt.AuthenticationError from the exchange should surface as AdapterAuthError."""
    import ccxt.async_support as ccxt_mod

    client = MagicMock()
    client.private_get_v5_user_query_api = AsyncMock(
        side_effect=ccxt_mod.AuthenticationError("invalid signature")
    )
    client.close = AsyncMock()

    adapter = BybitAdapter()
    with patch.object(adapter, "_build_client", return_value=client):
        with pytest.raises(AdapterAuthError):
            await adapter.connect(_CREDS)


# ---------------------------------------------------------------------------
# validate_credentials() tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_validate_credentials_returns_true_for_valid_key() -> None:
    fixture = _load_fixture("query_api_readonly.json")
    client = _make_client(fixture)
    adapter = BybitAdapter()

    with patch.object(adapter, "_build_client", return_value=client):
        result = await adapter.validate_credentials(_CREDS)

    assert result is True


@pytest.mark.asyncio
async def test_validate_credentials_returns_false_on_auth_error() -> None:
    import ccxt.async_support as ccxt_mod

    client = MagicMock()
    client.private_get_v5_user_query_api = AsyncMock(
        side_effect=ccxt_mod.AuthenticationError("bad key")
    )
    client.close = AsyncMock()

    adapter = BybitAdapter()
    with patch.object(adapter, "_build_client", return_value=client):
        result = await adapter.validate_credentials(_CREDS)

    assert result is False


# ---------------------------------------------------------------------------
# fetch_fills() tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_fetch_fills_paginates_via_cursor() -> None:
    """Adapter should follow nextPageCursor until it is empty."""
    page1 = _load_fixture("my_trades_page1.json")
    page2 = _load_fixture("my_trades_page2.json")

    # Both pages are for the "linear" category. Spot and inverse return empty.
    empty_response = {
        "retCode": 0,
        "retMsg": "OK",
        "result": {"list": [], "nextPageCursor": ""},
    }

    # side_effect order: linear page1, linear page2, inverse empty, spot empty
    trade_pages = [page1, page2, empty_response, empty_response]
    client = _make_client(_load_fixture("query_api_readonly.json"), trade_pages=trade_pages)

    adapter = BybitAdapter()
    since = datetime(2026, 5, 14, 0, 0, tzinfo=timezone.utc)
    until = datetime(2026, 5, 15, 0, 0, tzinfo=timezone.utc)

    collected: list[list] = []
    with patch.object(adapter, "_build_client", return_value=client):
        async for page in adapter.fetch_fills(_CREDS, since=since, until=until):
            collected.append(page)

    # page1 has 2 fills, page2 has 1 fill
    assert len(collected) == 2
    assert len(collected[0]) == 2
    assert len(collected[1]) == 1

    fill = collected[0][0]
    assert fill.external_trade_id == "2100000000011807391"
    assert fill.side == Side.BUY
    assert fill.instrument.exchange == Exchange.BYBIT
    assert fill.instrument.kind == InstrumentKind.PERP
    assert fill.instrument.base == "BTC"
    assert fill.qty == Decimal("0.01")
    assert fill.price == Decimal("67450.10")
    assert not fill.is_maker


@pytest.mark.asyncio
async def test_fetch_fills_merges_categories() -> None:
    """Fills from linear, inverse, and spot should all appear in the output."""
    linear_fill: dict[str, Any] = {
        "symbol": "BTCUSDT",
        "id": "1001",
        "orderId": "ord1",
        "side": "Buy",
        "orderPrice": "67450.10",
        "orderQty": "0.01",
        "execPrice": "67450.10",
        "execType": "Trade",
        "execQty": "0.01",
        "execFee": "0.33725050",
        "execValue": "674.5010",
        "feeSide": "base",
        "feeRate": "0.0005",
        "execTime": "1747267200000",
        "isMaker": False,
        "leavesQty": "0",
    }
    inverse_fill: dict[str, Any] = {
        "symbol": "BTCUSD",
        "id": "2001",
        "orderId": "ord2",
        "side": "Sell",
        "orderPrice": "67500.00",
        "orderQty": "100",
        "execPrice": "67500.00",
        "execType": "Trade",
        "execQty": "100",
        "execFee": "0.00000148",
        "execValue": "0.00148148",
        "feeSide": "base",
        "feeRate": "0.0001",
        "execTime": "1747267210000",
        "isMaker": False,
        "leavesQty": "0",
    }
    spot_fill: dict[str, Any] = {
        "symbol": "ETHUSDT",
        "id": "3001",
        "orderId": "ord3",
        "side": "Buy",
        "orderPrice": "3512.80",
        "orderQty": "0.5",
        "execPrice": "3512.80",
        "execType": "Trade",
        "execQty": "0.5",
        "execFee": "0.87820000",
        "execValue": "1756.40",
        "feeSide": "base",
        "feeRate": "0.001",
        "execTime": "1747267220000",
        "isMaker": False,
        "leavesQty": "0",
    }

    def _wrap(item: dict[str, Any]) -> dict[str, Any]:
        return {"retCode": 0, "retMsg": "OK", "result": {"list": [item], "nextPageCursor": ""}}

    trade_pages = [_wrap(linear_fill), _wrap(inverse_fill), _wrap(spot_fill)]
    client = _make_client(_load_fixture("query_api_readonly.json"), trade_pages=trade_pages)

    adapter = BybitAdapter()
    since = datetime(2026, 5, 14, 0, 0, tzinfo=timezone.utc)
    until = datetime(2026, 5, 15, 0, 0, tzinfo=timezone.utc)

    fills: list = []
    with patch.object(adapter, "_build_client", return_value=client):
        async for page in adapter.fetch_fills(_CREDS, since=since, until=until):
            fills.extend(page)

    assert len(fills) == 3
    instruments = {(f.instrument.base, f.instrument.kind.value) for f in fills}
    assert ("BTC", "perp") in instruments  # linear
    assert ("ETH", "spot") in instruments  # spot
    # inverse BTC also maps to base=BTC, but quote=USD distinguishes it
    btc_fills = [f for f in fills if f.instrument.base == "BTC"]
    assert len(btc_fills) == 2
    quotes = {f.instrument.quote for f in btc_fills}
    assert "USDT" in quotes
    assert "USD" in quotes


@pytest.mark.asyncio
async def test_fetch_fills_handles_empty_result() -> None:
    """No fills from any category → zero pages yielded."""
    empty = {"retCode": 0, "retMsg": "OK", "result": {"list": [], "nextPageCursor": ""}}
    client = _make_client(
        _load_fixture("query_api_readonly.json"),
        trade_pages=[empty, empty, empty],
    )

    adapter = BybitAdapter()
    since = datetime(2026, 5, 14, 0, 0, tzinfo=timezone.utc)
    until = datetime(2026, 5, 15, 0, 0, tzinfo=timezone.utc)

    pages: list = []
    with patch.object(adapter, "_build_client", return_value=client):
        async for page in adapter.fetch_fills(_CREDS, since=since, until=until):
            pages.append(page)

    assert pages == []


# ---------------------------------------------------------------------------
# fetch_funding_events() tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_fetch_funding_events_yields_pages() -> None:
    """Funding events from the fixture should be parsed correctly."""
    fixture = _load_fixture("funding_history.json")
    # Wrap in the transaction-log envelope shape
    response = {
        "retCode": 0,
        "retMsg": "OK",
        "result": {
            "list": fixture["result"]["list"],
            "nextPageCursor": "",
        },
    }
    empty = {"retCode": 0, "retMsg": "OK", "result": {"list": [], "nextPageCursor": ""}}
    # linear returns events, inverse returns empty
    client = _make_client(
        _load_fixture("query_api_readonly.json"),
        funding_pages=[response, empty],
    )

    adapter = BybitAdapter()
    since = datetime(2026, 5, 14, 0, 0, tzinfo=timezone.utc)
    until = datetime(2026, 5, 15, 0, 0, tzinfo=timezone.utc)

    events: list = []
    with patch.object(adapter, "_build_client", return_value=client):
        async for page in adapter.fetch_funding_events(_CREDS, since=since, until=until):
            events.extend(page)

    # Fixture has 3 records: 2x BTCUSDT paid, 1x ETHUSDT received
    assert len(events) == 3

    btc_paid = [e for e in events if e.instrument.base == "BTC" and e.direction == FundingDirection.PAID]
    eth_received = [e for e in events if e.instrument.base == "ETH" and e.direction == FundingDirection.RECEIVED]

    assert len(btc_paid) == 2
    assert len(eth_received) == 1

    # Check canonical shape of first BTC event
    ev = btc_paid[0]
    assert ev.instrument.exchange == Exchange.BYBIT
    assert ev.funding_rate > Decimal("0")
    assert ev.position_qty == Decimal("0.10")
    assert ev.amount > Decimal("0")
    assert ev.occurred_at is not None
    assert ev.external_id is not None


@pytest.mark.asyncio
async def test_fetch_funding_events_multi_page_cursor() -> None:
    """Cursor should be followed until exhausted for funding events."""
    record: dict[str, Any] = {
        "id": "evt-001",
        "symbol": "BTCUSDT",
        "side": "Sell",
        "size": "0.10",
        "fundingRate": "0.00010000",
        "execFee": "-0.67450100",
        "execTime": "1747267200000",
        "type": "SETTLEMENT",
    }

    page1 = {
        "retCode": 0,
        "retMsg": "OK",
        "result": {"list": [record], "nextPageCursor": "cursor-abc"},
    }
    page2 = {
        "retCode": 0,
        "retMsg": "OK",
        "result": {"list": [dict(record, id="evt-002", execTime="1747238400000")], "nextPageCursor": ""},
    }
    empty = {"retCode": 0, "retMsg": "OK", "result": {"list": [], "nextPageCursor": ""}}
    # linear: page1 then page2; inverse: empty
    client = _make_client(
        _load_fixture("query_api_readonly.json"),
        funding_pages=[page1, page2, empty],
    )

    adapter = BybitAdapter()
    since = datetime(2026, 5, 14, 0, 0, tzinfo=timezone.utc)
    until = datetime(2026, 5, 15, 0, 0, tzinfo=timezone.utc)

    events: list = []
    with patch.object(adapter, "_build_client", return_value=client):
        async for page in adapter.fetch_funding_events(_CREDS, since=since, until=until):
            events.extend(page)

    assert len(events) == 2


# ---------------------------------------------------------------------------
# fetch_open_positions() tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_fetch_open_positions_returns_canonical_shape() -> None:
    """Positions fixture should parse into correct CanonicalPosition values."""
    fixture = _load_fixture("positions.json")
    # Positions endpoint called twice (linear + inverse)
    empty = {"retCode": 0, "retMsg": "OK", "result": {"list": [], "nextPageCursor": ""}}

    # We patch private_get_v5_position_list to return fixture for first call
    # (linear) and empty for second call (inverse)
    client = _make_client(_load_fixture("query_api_readonly.json"))
    client.private_get_v5_position_list = AsyncMock(side_effect=[fixture, empty])

    adapter = BybitAdapter()
    with patch.object(adapter, "_build_client", return_value=client):
        positions = await adapter.fetch_open_positions(_CREDS)

    assert len(positions) == 2

    btc_long = next(p for p in positions if p.instrument.base == "BTC")
    eth_short = next(p for p in positions if p.instrument.base == "ETH")

    # BTC long
    assert btc_long.side == PositionSide.LONG
    assert btc_long.qty_open == Decimal("0.01")
    assert btc_long.avg_entry_price == Decimal("67450.10")
    assert btc_long.instrument.exchange == Exchange.BYBIT
    assert btc_long.instrument.kind == InstrumentKind.PERP
    assert btc_long.leverage == Decimal("10")
    assert btc_long.mark_price == Decimal("67520.00")
    assert btc_long.unrealized_pnl == Decimal("0.6999")
    assert btc_long.liquidation_price == Decimal("61200.00")
    assert btc_long.opened_at is not None

    # ETH short
    assert eth_short.side == PositionSide.SHORT
    assert eth_short.qty_open == Decimal("1.00")
    assert eth_short.avg_entry_price == Decimal("3512.80")


@pytest.mark.asyncio
async def test_fetch_open_positions_filters_zero_size() -> None:
    """Positions with size='0' (closed) should be excluded."""
    zero_pos: dict[str, Any] = {
        "symbol": "SOLUSDT",
        "side": "Buy",
        "size": "0",
        "avgPrice": "150.00",
        "positionValue": "0",
        "leverage": "10",
        "markPrice": "151.00",
        "liqPrice": "0",
        "unrealisedPnl": "0",
        "createdTime": "1747260000000",
        "updatedTime": "1747267200000",
        "category": "linear",
    }
    response = {"retCode": 0, "retMsg": "OK", "result": {"list": [zero_pos], "nextPageCursor": ""}}
    empty = {"retCode": 0, "retMsg": "OK", "result": {"list": [], "nextPageCursor": ""}}

    client = _make_client(_load_fixture("query_api_readonly.json"))
    client.private_get_v5_position_list = AsyncMock(side_effect=[response, empty])

    adapter = BybitAdapter()
    with patch.object(adapter, "_build_client", return_value=client):
        positions = await adapter.fetch_open_positions(_CREDS)

    assert positions == []


@pytest.mark.asyncio
async def test_fetch_open_positions_closes_client_on_error() -> None:
    """ccxt error during position fetch should raise and still close the client."""
    import ccxt.async_support as ccxt_mod

    client = _make_client(_load_fixture("query_api_readonly.json"))
    client.private_get_v5_position_list = AsyncMock(
        side_effect=ccxt_mod.NetworkError("connection reset")
    )

    adapter = BybitAdapter()
    with patch.object(adapter, "_build_client", return_value=client):
        from csj_worker.adapters.base import AdapterNetworkError

        with pytest.raises(AdapterNetworkError):
            await adapter.fetch_open_positions(_CREDS)

    client.close.assert_called_once()
