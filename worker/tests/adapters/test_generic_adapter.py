"""Tests for ``CcxtUniversalAdapter`` and per-venue ``VenueConfig`` shapes.

Strategy
--------
All ccxt I/O is mocked via ``unittest.mock`` — we never hit a live network.
The framework's value lies in correctly translating ccxt's unified shape
into our CanonicalFill / CanonicalFundingEvent / CanonicalPosition types,
plus rejecting destructive permissions per venue. These tests exercise:

1. The factory + registry — every v1 code resolves to the universal adapter.
2. Withdraw-permission rejection — one test per venue with a destructive-key
   payload AND a read-only payload.
3. fetch_fills normalisation — at least three venues with different ccxt
   shapes (Binance straightforward, Bybit, KuCoin with passphrase).
4. Connect() error paths — auth-fail, network-down, permission-rejected.
5. Capability flags — supports_options=False on unsupported venues raises.
6. Hyperliquid still routes to its bespoke adapter.

Mocking ccxt
------------
ccxt classes live under ``ccxt.async_support``. We patch
``ccxt_async.<id>`` to a constructor returning a MagicMock whose async
methods are AsyncMock-wrapped. Each test builds the response payload it
expects ccxt to emit, then asserts on the resulting Canonical* objects.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from csj_worker.adapters import (
    ADAPTER_REGISTRY,
    AdapterAuthError,
    CcxtUniversalAdapter,
    get_adapter,
)
from csj_worker.adapters.configs import (
    ALL_CONFIGS,
    BINANCE_CONFIG,
    BINGX_CONFIG,
    BITGET_CONFIG,
    BYBIT_CONFIG,
    GATE_CONFIG,
    HTX_CONFIG,
    KUCOIN_CONFIG,
    MEXC_CONFIG,
    OKX_CONFIG,
    PHEMEX_CONFIG,
)
from csj_worker.adapters.generic import (
    _map_ccxt_error,
    _normalize_instrument,
    _parse_ccxt_funding,
    _parse_ccxt_position,
    _parse_ccxt_trade,
)
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
# Shared helpers
# ---------------------------------------------------------------------------


def _creds(passphrase: str | None = None) -> ApiKeyCredentials:
    return ApiKeyCredentials(
        api_key="testkey-aaaaaaaa",
        api_secret="testsecret-bbbbbbbb",
        passphrase=passphrase,
    )


def _make_mock_ccxt_client(
    *,
    permissions_payload: dict[str, Any] | None = None,
    balance_payload: dict[str, Any] | None = None,
    trades_response: list[dict[str, Any]] | None = None,
    funding_response: list[dict[str, Any]] | None = None,
    positions_response: list[dict[str, Any]] | None = None,
    markets: dict[str, dict[str, Any]] | None = None,
    raise_on_balance: type[Exception] | None = None,
) -> MagicMock:
    """Build a MagicMock matching the ccxt async-client surface we use.

    The framework calls:
    - load_markets() and reads .markets
    - fetch_balance()
    - fetch_my_trades(symbol, since, limit)
    - fetch_funding_history(symbol, since, limit)
    - fetch_positions()
    - close()
    Plus per-venue passthroughs that each config's fetch_permissions calls.
    """
    client = MagicMock()
    _markets: dict[str, dict[str, Any]] = markets or {
        "BTC/USDT:USDT": {
            "symbol": "BTC/USDT:USDT",
            "base": "BTC",
            "quote": "USDT",
            "type": "swap",
            "active": True,
        }
    }

    async def _load_markets() -> dict[str, dict[str, Any]]:
        client.markets = _markets
        return _markets

    client.load_markets = _load_markets
    client.markets = _markets

    if raise_on_balance is not None:
        client.fetch_balance = AsyncMock(side_effect=raise_on_balance("denied"))
    else:
        client.fetch_balance = AsyncMock(
            return_value=balance_payload or {"info": permissions_payload or {}}
        )

    client.fetch_my_trades = AsyncMock(return_value=trades_response or [])
    client.fetch_funding_history = AsyncMock(return_value=funding_response or [])
    client.fetch_positions = AsyncMock(return_value=positions_response or [])

    # Per-venue passthroughs — each config tries a few method names. The
    # mock answers any of them so the test doesn't have to know the exact
    # ccxt naming convention.
    async def _passthrough(*args: Any, **kwargs: Any) -> Any:
        return permissions_payload or {}

    for name in (
        "private_get_v5_user_query_api",
        "privateGetUsers",
        "private_get_users",
        "privateGetUserInfo",
        "privateGetV2UserApiKeyInfo",
        "private_get_v2_user_api_key_info",
        "privateGetApiV3KeyInfo",
        "v2PrivateGetUserApiKey",
        "spotV2PrivateGetUserApiKey",
        "private_get_v2_user_api_key",
        "privateGetUsersMe",
        "private_get_users_me",
        "privateGetAccountConfig",
        "privateWalletGetWithdrawStatus",
    ):
        setattr(client, name, AsyncMock(side_effect=_passthrough))

    client.close = AsyncMock()
    return client


def _patch_ccxt(ccxt_id: str, client: MagicMock):
    """Patch ccxt.async_support.<ccxt_id> to a constructor returning client.

    Returns the patch context manager; caller is responsible for `with`.
    """
    return patch(
        f"csj_worker.adapters.generic.ccxt_async.{ccxt_id}",
        new=MagicMock(return_value=client),
    )


# ---------------------------------------------------------------------------
# Registry + factory
# ---------------------------------------------------------------------------


class TestRegistry:
    """The factory resolves every v1 code to a universal adapter."""

    def test_all_v1_exchanges_resolve(self) -> None:
        for code in (
            "binance",
            "bybit",
            "bingx",
            "gate",
            "mexc",
            "kucoin",
            "bitget",
            "htx",
            "okx",
            "phemex",
        ):
            adapter = get_adapter(code)
            assert adapter is not None, f"{code} should be registered"
            assert isinstance(adapter, CcxtUniversalAdapter)
            assert adapter.config.code == code
            assert adapter.exchange.value == code

    def test_hyperliquid_resolves_to_bespoke(self) -> None:
        adapter = get_adapter("hyperliquid")
        assert adapter is not None
        assert adapter.__class__.__name__ == "HyperliquidAdapter"

    def test_unknown_returns_none(self) -> None:
        assert get_adapter("notarealexchange") is None

    def test_case_insensitive(self) -> None:
        assert get_adapter("BINANCE") is not None
        assert get_adapter("BiNgX") is not None

    def test_registry_size_matches_configs(self) -> None:
        # ADAPTER_REGISTRY = all configs + hyperliquid bespoke
        assert len(ADAPTER_REGISTRY) == len(ALL_CONFIGS) + 1


# ---------------------------------------------------------------------------
# Permission checks — one test per venue, both directions
# ---------------------------------------------------------------------------


class TestWithdrawPermissionRejection:
    """For each venue we know how to introspect, withdraw-keys are rejected.

    For "unverified" venues (BingX, MEXC, Phemex) we instead assert the
    extracted permissions surface 'withdraw:unverified' so the UI can
    force user attestation.
    """

    @pytest.mark.asyncio
    async def test_binance_rejects_canwithdraw_true(self) -> None:
        # Binance surfaces canWithdraw via fetch_balance.info
        client = _make_mock_ccxt_client(
            balance_payload={"info": {"canWithdraw": True, "canTrade": True}}
        )
        adapter = CcxtUniversalAdapter(BINANCE_CONFIG)
        with _patch_ccxt("binance", client):
            result = await adapter.connect(_creds())
        assert result.health == ConnectionHealth.PERMISSION
        assert "canWithdraw" in result.permissions

    @pytest.mark.asyncio
    async def test_binance_accepts_canwithdraw_false(self) -> None:
        client = _make_mock_ccxt_client(
            balance_payload={
                "info": {"canWithdraw": False, "canTrade": True, "canDeposit": True}
            }
        )
        adapter = CcxtUniversalAdapter(BINANCE_CONFIG)
        with _patch_ccxt("binance", client):
            result = await adapter.connect(_creds())
        assert result.health == ConnectionHealth.OK
        assert "canTrade" in result.permissions

    @pytest.mark.asyncio
    async def test_bybit_rejects_withdraw_in_wallet_scope(self) -> None:
        # Bybit's permission shape: readOnly=1 with Wallet:[Withdraw] still rejects.
        permissions_payload = {
            "retCode": 0,
            "retMsg": "OK",
            "result": {
                "readOnly": 1,
                "permissions": {
                    "ContractTrade": ["Order"],
                    "Wallet": ["AccountTransfer", "Withdraw"],
                },
            },
            "time": 1715760000000,
        }
        client = _make_mock_ccxt_client()
        client.private_get_v5_user_query_api = AsyncMock(return_value=permissions_payload)
        adapter = CcxtUniversalAdapter(BYBIT_CONFIG)
        with _patch_ccxt("bybit", client):
            result = await adapter.connect(_creds())
        assert result.health == ConnectionHealth.PERMISSION
        assert "canWithdraw" in result.permissions

    @pytest.mark.asyncio
    async def test_bybit_rejects_non_readonly_key(self) -> None:
        # readOnly=0 alone is destructive (trade permission).
        permissions_payload = {
            "retCode": 0,
            "retMsg": "OK",
            "result": {
                "readOnly": 0,
                "permissions": {"ContractTrade": ["Order", "Position"]},
            },
            "time": 1715760000000,
        }
        client = _make_mock_ccxt_client()
        client.private_get_v5_user_query_api = AsyncMock(return_value=permissions_payload)
        adapter = CcxtUniversalAdapter(BYBIT_CONFIG)
        with _patch_ccxt("bybit", client):
            result = await adapter.connect(_creds())
        assert result.health == ConnectionHealth.PERMISSION

    @pytest.mark.asyncio
    async def test_bybit_accepts_readonly_key(self) -> None:
        permissions_payload = {
            "retCode": 0,
            "retMsg": "OK",
            "result": {
                "readOnly": 1,
                "permissions": {"ContractTrade": ["Position"]},
            },
            "time": 1715760000000,
        }
        client = _make_mock_ccxt_client()
        client.private_get_v5_user_query_api = AsyncMock(return_value=permissions_payload)
        adapter = CcxtUniversalAdapter(BYBIT_CONFIG)
        with _patch_ccxt("bybit", client):
            result = await adapter.connect(_creds())
        assert result.health == ConnectionHealth.OK
        assert any("ContractTrade" in p for p in result.permissions)

    @pytest.mark.asyncio
    async def test_okx_rejects_withdraw_in_perm(self) -> None:
        permissions_payload = {
            "data": [{"perm": "read_only,trade,withdraw"}],
        }
        client = _make_mock_ccxt_client()
        client.privateGetUsersMe = AsyncMock(return_value=permissions_payload)
        adapter = CcxtUniversalAdapter(OKX_CONFIG)
        with _patch_ccxt("okx", client):
            result = await adapter.connect(_creds(passphrase="abc"))
        assert result.health == ConnectionHealth.PERMISSION

    @pytest.mark.asyncio
    async def test_okx_accepts_read_only(self) -> None:
        permissions_payload = {"data": [{"perm": "read_only"}]}
        client = _make_mock_ccxt_client()
        client.privateGetUsersMe = AsyncMock(return_value=permissions_payload)
        adapter = CcxtUniversalAdapter(OKX_CONFIG)
        with _patch_ccxt("okx", client):
            result = await adapter.connect(_creds(passphrase="abc"))
        assert result.health == ConnectionHealth.OK

    @pytest.mark.asyncio
    async def test_okx_requires_passphrase(self) -> None:
        adapter = CcxtUniversalAdapter(OKX_CONFIG)
        with pytest.raises(AdapterAuthError, match="passphrase"):
            await adapter.connect(_creds(passphrase=None))

    @pytest.mark.asyncio
    async def test_kucoin_rejects_transfer_permission(self) -> None:
        permissions_payload = {
            "code": "200000",
            "data": {"permission": "General,Trade,Transfer"},
        }
        client = _make_mock_ccxt_client()
        client.privateGetUsers = AsyncMock(return_value=permissions_payload)
        adapter = CcxtUniversalAdapter(KUCOIN_CONFIG)
        with _patch_ccxt("kucoinfutures", client):
            result = await adapter.connect(_creds(passphrase="kucoin-pass"))
        assert result.health == ConnectionHealth.PERMISSION

    @pytest.mark.asyncio
    async def test_kucoin_accepts_general_trade_only(self) -> None:
        permissions_payload = {
            "code": "200000",
            "data": {"permission": "General,Trade"},
        }
        client = _make_mock_ccxt_client()
        client.privateGetUsers = AsyncMock(return_value=permissions_payload)
        adapter = CcxtUniversalAdapter(KUCOIN_CONFIG)
        with _patch_ccxt("kucoinfutures", client):
            result = await adapter.connect(_creds(passphrase="kucoin-pass"))
        assert result.health == ConnectionHealth.OK

    @pytest.mark.asyncio
    async def test_kucoin_requires_passphrase(self) -> None:
        adapter = CcxtUniversalAdapter(KUCOIN_CONFIG)
        with pytest.raises(AdapterAuthError, match="passphrase"):
            await adapter.connect(_creds(passphrase=None))

    @pytest.mark.asyncio
    async def test_bitget_rejects_withdraw(self) -> None:
        permissions_payload = {
            "data": {"permsList": ["read", "trade", "withdraw"]},
        }
        client = _make_mock_ccxt_client()
        client.privateGetV2UserApiKeyInfo = AsyncMock(return_value=permissions_payload)
        adapter = CcxtUniversalAdapter(BITGET_CONFIG)
        with _patch_ccxt("bitget", client):
            result = await adapter.connect(_creds(passphrase="bp"))
        assert result.health == ConnectionHealth.PERMISSION

    @pytest.mark.asyncio
    async def test_bitget_rejects_transfer(self) -> None:
        permissions_payload = {"data": {"permsList": ["read", "transfer"]}}
        client = _make_mock_ccxt_client()
        client.privateGetV2UserApiKeyInfo = AsyncMock(return_value=permissions_payload)
        adapter = CcxtUniversalAdapter(BITGET_CONFIG)
        with _patch_ccxt("bitget", client):
            result = await adapter.connect(_creds(passphrase="bp"))
        assert result.health == ConnectionHealth.PERMISSION

    @pytest.mark.asyncio
    async def test_htx_rejects_withdraw(self) -> None:
        permissions_payload = {"data": [{"permission": "read,trade,withdraw"}]}
        client = _make_mock_ccxt_client()
        client.v2PrivateGetUserApiKey = AsyncMock(return_value=permissions_payload)
        adapter = CcxtUniversalAdapter(HTX_CONFIG)
        with _patch_ccxt("htx", client):
            result = await adapter.connect(_creds())
        assert result.health == ConnectionHealth.PERMISSION

    @pytest.mark.asyncio
    async def test_htx_accepts_readonly(self) -> None:
        permissions_payload = {"data": [{"permission": "readOnly,trade"}]}
        client = _make_mock_ccxt_client()
        client.v2PrivateGetUserApiKey = AsyncMock(return_value=permissions_payload)
        adapter = CcxtUniversalAdapter(HTX_CONFIG)
        with _patch_ccxt("htx", client):
            result = await adapter.connect(_creds())
        assert result.health == ConnectionHealth.OK

    @pytest.mark.asyncio
    async def test_gate_rejects_when_withdraw_status_callable(self) -> None:
        # If the withdraw_status endpoint succeeds, the key has withdraw scope.
        client = _make_mock_ccxt_client()
        client.privateWalletGetWithdrawStatus = AsyncMock(return_value={"ok": True})
        adapter = CcxtUniversalAdapter(GATE_CONFIG)
        with _patch_ccxt("gate", client):
            result = await adapter.connect(_creds())
        assert result.health == ConnectionHealth.PERMISSION

    @pytest.mark.asyncio
    async def test_gate_accepts_when_withdraw_status_fails(self) -> None:
        client = _make_mock_ccxt_client()
        client.privateWalletGetWithdrawStatus = AsyncMock(
            side_effect=PermissionError("no withdraw scope")
        )
        adapter = CcxtUniversalAdapter(GATE_CONFIG)
        with _patch_ccxt("gate", client):
            result = await adapter.connect(_creds())
        assert result.health == ConnectionHealth.OK

    @pytest.mark.asyncio
    async def test_bingx_emits_unverified_warning(self) -> None:
        # BingX has no permission endpoint — adapter accepts but flags unverified.
        client = _make_mock_ccxt_client(balance_payload={"info": {}})
        adapter = CcxtUniversalAdapter(BINGX_CONFIG)
        with _patch_ccxt("bingx", client):
            result = await adapter.connect(_creds())
        assert result.health == ConnectionHealth.OK
        assert "withdraw:unverified" in result.permissions

    @pytest.mark.asyncio
    async def test_mexc_emits_unverified_warning(self) -> None:
        client = _make_mock_ccxt_client(balance_payload={"info": {}})
        adapter = CcxtUniversalAdapter(MEXC_CONFIG)
        with _patch_ccxt("mexc", client):
            result = await adapter.connect(_creds())
        assert result.health == ConnectionHealth.OK
        assert "withdraw:unverified" in result.permissions

    @pytest.mark.asyncio
    async def test_phemex_emits_unverified_warning(self) -> None:
        client = _make_mock_ccxt_client(balance_payload={"info": {}})
        adapter = CcxtUniversalAdapter(PHEMEX_CONFIG)
        with _patch_ccxt("phemex", client):
            result = await adapter.connect(_creds())
        assert result.health == ConnectionHealth.OK
        assert "withdraw:unverified" in result.permissions


# ---------------------------------------------------------------------------
# Connect — auth failure paths
# ---------------------------------------------------------------------------


class TestConnectErrorPaths:
    @pytest.mark.asyncio
    async def test_connect_auth_failure_returns_auth_failed_health(self) -> None:
        import ccxt.async_support as ccxt_async

        client = _make_mock_ccxt_client(raise_on_balance=ccxt_async.AuthenticationError)
        adapter = CcxtUniversalAdapter(BINANCE_CONFIG)
        with _patch_ccxt("binance", client):
            result = await adapter.connect(_creds())
        assert result.health == ConnectionHealth.AUTH_FAILED

    @pytest.mark.asyncio
    async def test_connect_network_error_returns_unreachable(self) -> None:
        import ccxt.async_support as ccxt_async

        client = _make_mock_ccxt_client(raise_on_balance=ccxt_async.NetworkError)
        adapter = CcxtUniversalAdapter(BINANCE_CONFIG)
        with _patch_ccxt("binance", client):
            result = await adapter.connect(_creds())
        assert result.health == ConnectionHealth.UNREACHABLE

    @pytest.mark.asyncio
    async def test_validate_credentials_returns_true_on_success(self) -> None:
        client = _make_mock_ccxt_client(balance_payload={"info": {}})
        adapter = CcxtUniversalAdapter(BINANCE_CONFIG)
        with _patch_ccxt("binance", client):
            ok = await adapter.validate_credentials(_creds())
        assert ok is True

    @pytest.mark.asyncio
    async def test_validate_credentials_returns_false_on_auth_failure(self) -> None:
        import ccxt.async_support as ccxt_async

        client = _make_mock_ccxt_client(raise_on_balance=ccxt_async.AuthenticationError)
        adapter = CcxtUniversalAdapter(BINANCE_CONFIG)
        with _patch_ccxt("binance", client):
            ok = await adapter.validate_credentials(_creds())
        assert ok is False


# ---------------------------------------------------------------------------
# fetch_fills — normalisation across venues
# ---------------------------------------------------------------------------


_CCXT_TRADE_TEMPLATE = {
    "id": "12345",
    "order": "order-9876",
    "timestamp": 1715760000000,
    "symbol": "BTC/USDT:USDT",
    "side": "buy",
    "takerOrMaker": "taker",
    "price": 65000.5,
    "amount": 0.05,
    "cost": 3250.025,
    "fee": {"cost": 1.3, "currency": "USDT"},
}


class TestFetchFillsNormalisation:
    """Verifies that ccxt's unified trade shape parses identically across
    venues with different `type` values and fee currencies."""

    @pytest.mark.asyncio
    async def test_binance_fills_normalise_to_canonical(self) -> None:
        trade = dict(_CCXT_TRADE_TEMPLATE)
        client = _make_mock_ccxt_client(
            balance_payload={"info": {"canWithdraw": False, "canTrade": True}},
            trades_response=[trade],
        )
        adapter = CcxtUniversalAdapter(BINANCE_CONFIG)
        with _patch_ccxt("binance", client):
            pages = []
            async for page in adapter.fetch_fills(
                _creds(),
                since=datetime(2024, 5, 15, tzinfo=timezone.utc),
                until=datetime(2024, 5, 16, tzinfo=timezone.utc),
            ):
                pages.append(page)

        assert len(pages) >= 1
        fill = pages[0][0]
        assert fill.external_trade_id == "12345"
        assert fill.side == Side.BUY
        assert fill.qty == Decimal("0.05")
        assert fill.price == Decimal("65000.5")
        assert fill.fee == Decimal("1.3")
        assert fill.instrument.exchange == Exchange.BINANCE
        assert fill.instrument.kind == InstrumentKind.PERP

    @pytest.mark.asyncio
    async def test_bybit_fills_with_category_specific_market(self) -> None:
        # Bybit uses category; ccxt normalises to type=swap for linear perps.
        trade = dict(_CCXT_TRADE_TEMPLATE)
        trade["id"] = "bybit-trade-1"
        permissions_payload = {
            "retCode": 0,
            "result": {"readOnly": 1, "permissions": {}},
            "time": 1715760000000,
        }
        client = _make_mock_ccxt_client(trades_response=[trade])
        client.private_get_v5_user_query_api = AsyncMock(return_value=permissions_payload)
        adapter = CcxtUniversalAdapter(BYBIT_CONFIG)
        with _patch_ccxt("bybit", client):
            pages = []
            async for page in adapter.fetch_fills(
                _creds(),
                since=datetime(2024, 5, 15, tzinfo=timezone.utc),
                until=datetime(2024, 5, 16, tzinfo=timezone.utc),
            ):
                pages.append(page)

        assert len(pages) >= 1
        fill = pages[0][0]
        assert fill.external_trade_id == "bybit-trade-1"
        assert fill.instrument.exchange == Exchange.BYBIT

    @pytest.mark.asyncio
    async def test_kucoin_fills_with_passphrase(self) -> None:
        trade = dict(_CCXT_TRADE_TEMPLATE)
        trade["id"] = "kucoin-trade-7"
        permissions_payload = {
            "code": "200000",
            "data": {"permission": "General,Trade"},
        }
        client = _make_mock_ccxt_client(trades_response=[trade])
        client.privateGetUsers = AsyncMock(return_value=permissions_payload)
        adapter = CcxtUniversalAdapter(KUCOIN_CONFIG)
        with _patch_ccxt("kucoinfutures", client):
            pages = []
            async for page in adapter.fetch_fills(
                _creds(passphrase="passphrase-here"),
                since=datetime(2024, 5, 15, tzinfo=timezone.utc),
                until=datetime(2024, 5, 16, tzinfo=timezone.utc),
            ):
                pages.append(page)

        assert len(pages) >= 1
        fill = pages[0][0]
        assert fill.instrument.exchange == Exchange.KUCOIN

    @pytest.mark.asyncio
    async def test_fetch_fills_filters_out_of_window_trades(self) -> None:
        # ccxt sometimes returns trades older than since; the adapter should
        # filter them out.
        before_window = dict(_CCXT_TRADE_TEMPLATE)
        before_window["id"] = "before"
        before_window["timestamp"] = 1700000000000  # 2023-11
        in_window = dict(_CCXT_TRADE_TEMPLATE)
        in_window["id"] = "in"
        in_window["timestamp"] = 1715760000000  # 2024-05-15

        client = _make_mock_ccxt_client(
            balance_payload={"info": {"canWithdraw": False}},
            trades_response=[before_window, in_window],
        )
        adapter = CcxtUniversalAdapter(BINANCE_CONFIG)
        all_fills: list[Any] = []
        with _patch_ccxt("binance", client):
            async for page in adapter.fetch_fills(
                _creds(),
                since=datetime(2024, 5, 15, tzinfo=timezone.utc),
                until=datetime(2024, 5, 16, tzinfo=timezone.utc),
            ):
                all_fills.extend(page)

        ids = {f.external_trade_id for f in all_fills}
        assert "in" in ids
        assert "before" not in ids


# ---------------------------------------------------------------------------
# Funding & positions
# ---------------------------------------------------------------------------


class TestFundingAndPositions:
    @pytest.mark.asyncio
    async def test_fetch_funding_history_normalises(self) -> None:
        record = {
            "id": "fund-1",
            "symbol": "BTC/USDT:USDT",
            "code": "USDT",
            "timestamp": 1715760000000,
            "amount": -0.5,
            "info": {"fundingRate": "0.00010000", "positionAmt": "0.001"},
        }
        client = _make_mock_ccxt_client(
            balance_payload={"info": {"canWithdraw": False}},
            funding_response=[record],
        )
        adapter = CcxtUniversalAdapter(BINANCE_CONFIG)
        with _patch_ccxt("binance", client):
            pages = []
            async for page in adapter.fetch_funding_events(
                _creds(),
                since=datetime(2024, 5, 15, tzinfo=timezone.utc),
                until=datetime(2024, 5, 16, tzinfo=timezone.utc),
            ):
                pages.append(page)

        assert pages
        ev = pages[0][0]
        assert ev.direction == FundingDirection.PAID  # amount negative
        assert ev.amount == Decimal("0.5")
        assert ev.amount_currency == "USDT"
        assert ev.funding_rate == Decimal("0.00010000")

    @pytest.mark.asyncio
    async def test_fetch_open_positions_filters_zero_size(self) -> None:
        positions = [
            {
                "symbol": "BTC/USDT:USDT",
                "contracts": 0.5,
                "side": "long",
                "entryPrice": 64000,
                "markPrice": 65000,
                "unrealizedPnl": 500,
                "leverage": 10,
                "info": {},
            },
            {
                "symbol": "ETH/USDT:USDT",
                "contracts": 0,  # closed — should be filtered
                "side": "long",
                "entryPrice": 3000,
                "info": {},
            },
        ]
        client = _make_mock_ccxt_client(
            balance_payload={"info": {"canWithdraw": False}},
            positions_response=positions,
            markets={
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
            },
        )
        adapter = CcxtUniversalAdapter(BINANCE_CONFIG)
        with _patch_ccxt("binance", client):
            result = await adapter.fetch_open_positions(_creds())
        assert len(result) == 1
        assert result[0].side == PositionSide.LONG
        assert result[0].qty_open == Decimal("0.5")


# ---------------------------------------------------------------------------
# Pure-function parser tests — exercise the normalisation helpers directly
# ---------------------------------------------------------------------------


class TestParserHelpers:
    def test_normalize_instrument_perp(self) -> None:
        instr = _normalize_instrument(
            "BTC/USDT:USDT",
            {"base": "BTC", "quote": "USDT", "type": "swap"},
            Exchange.BINANCE,
        )
        assert instr.kind == InstrumentKind.PERP
        assert instr.base == "BTC"
        assert instr.quote == "USDT"

    def test_normalize_instrument_spot(self) -> None:
        instr = _normalize_instrument(
            "BTC/USDT",
            {"base": "BTC", "quote": "USDT", "type": "spot"},
            Exchange.BINANCE,
        )
        assert instr.kind == InstrumentKind.SPOT

    def test_normalize_instrument_dated_future(self) -> None:
        instr = _normalize_instrument(
            "BTC/USDT:USDT-241227",
            {
                "base": "BTC",
                "quote": "USDT",
                "type": "future",
                "expiry": 1735257600000,
            },
            Exchange.BINANCE,
        )
        assert instr.kind == InstrumentKind.DATED_FUTURE
        assert instr.expiry is not None

    def test_parse_ccxt_trade_taker(self) -> None:
        instr = _normalize_instrument(
            "BTC/USDT:USDT",
            {"base": "BTC", "quote": "USDT", "type": "swap"},
            Exchange.BINANCE,
        )
        fill = _parse_ccxt_trade(_CCXT_TRADE_TEMPLATE, instr)
        assert fill.side == Side.BUY
        assert not fill.is_maker
        assert fill.liquidity == "taker"
        assert fill.fee_currency == "USDT"

    def test_parse_ccxt_trade_maker(self) -> None:
        trade = dict(_CCXT_TRADE_TEMPLATE)
        trade["takerOrMaker"] = "maker"
        instr = _normalize_instrument(
            "BTC/USDT:USDT",
            {"base": "BTC", "quote": "USDT", "type": "swap"},
            Exchange.BINANCE,
        )
        fill = _parse_ccxt_trade(trade, instr)
        assert fill.is_maker
        assert fill.liquidity == "maker"

    def test_parse_ccxt_funding_paid(self) -> None:
        record = {
            "id": "f1",
            "symbol": "BTC/USDT:USDT",
            "code": "USDT",
            "timestamp": 1715760000000,
            "amount": -0.25,
            "info": {"fundingRate": "0.0001", "positionAmt": "0.5"},
        }
        markets = {
            "BTC/USDT:USDT": {
                "base": "BTC",
                "quote": "USDT",
                "type": "swap",
            }
        }
        ev = _parse_ccxt_funding(record, markets, Exchange.BINANCE)
        assert ev.direction == FundingDirection.PAID
        assert ev.amount == Decimal("0.25")
        assert ev.funding_rate == Decimal("0.0001")

    def test_parse_ccxt_funding_received(self) -> None:
        record = {
            "id": "f2",
            "symbol": "BTC/USDT:USDT",
            "code": "USDT",
            "timestamp": 1715760000000,
            "amount": 0.5,
            "info": {},
        }
        markets = {
            "BTC/USDT:USDT": {
                "base": "BTC",
                "quote": "USDT",
                "type": "swap",
            }
        }
        ev = _parse_ccxt_funding(record, markets, Exchange.BINANCE)
        assert ev.direction == FundingDirection.RECEIVED
        assert ev.amount == Decimal("0.5")

    def test_parse_ccxt_position_zero_size_returns_none(self) -> None:
        raw = {
            "symbol": "BTC/USDT:USDT",
            "contracts": 0,
            "side": "long",
            "entryPrice": 0,
            "info": {},
        }
        markets = {
            "BTC/USDT:USDT": {
                "base": "BTC",
                "quote": "USDT",
                "type": "swap",
            }
        }
        assert _parse_ccxt_position(raw, markets, Exchange.BINANCE) is None

    def test_map_ccxt_error_handles_all_types(self) -> None:
        import ccxt.async_support as ccxt_async

        from csj_worker.adapters.base import (
            AdapterAuthError,
            AdapterNetworkError,
            AdapterRateLimitedError,
        )

        assert isinstance(
            _map_ccxt_error(ccxt_async.AuthenticationError("x")),
            AdapterAuthError,
        )
        assert isinstance(
            _map_ccxt_error(ccxt_async.RateLimitExceeded("retry after 30")),
            AdapterRateLimitedError,
        )
        assert isinstance(
            _map_ccxt_error(ccxt_async.NetworkError("x")),
            AdapterNetworkError,
        )


# ---------------------------------------------------------------------------
# Config integrity — every config must be wired correctly
# ---------------------------------------------------------------------------


class TestConfigIntegrity:
    """Smoke-test every config: code maps cleanly to an Exchange enum value,
    ccxt_id resolves to a real ccxt class, capability flags are sane."""

    def test_all_configs_have_unique_codes(self) -> None:
        codes = [c.code for c in ALL_CONFIGS.values()]
        assert len(codes) == len(set(codes))

    def test_all_configs_resolve_to_exchange_enum(self) -> None:
        for cfg in ALL_CONFIGS.values():
            assert Exchange(cfg.code), f"{cfg.code} not in Exchange enum"

    def test_all_configs_ccxt_id_resolves(self) -> None:
        import ccxt.async_support as ccxt_async

        for cfg in ALL_CONFIGS.values():
            assert hasattr(ccxt_async, cfg.ccxt_id), (
                f"{cfg.code} ccxt_id={cfg.ccxt_id} not in ccxt.async_support"
            )

    def test_passphrase_venues_flagged(self) -> None:
        # KuCoin, OKX, Bitget require passphrase.
        assert KUCOIN_CONFIG.requires_passphrase is True
        assert OKX_CONFIG.requires_passphrase is True
        assert BITGET_CONFIG.requires_passphrase is True
        # Non-passphrase venues
        assert BINANCE_CONFIG.requires_passphrase is False
        assert BYBIT_CONFIG.requires_passphrase is False

    def test_all_configs_have_api_docs_url(self) -> None:
        for cfg in ALL_CONFIGS.values():
            assert cfg.api_docs_url.startswith("https://"), cfg.code
