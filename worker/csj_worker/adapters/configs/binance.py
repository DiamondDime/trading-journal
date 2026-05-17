"""Binance — universal-adapter config.

API docs: https://developers.binance.com/docs/

Permission check
----------------
Binance's spot REST API returns the canWithdraw / canTrade / canDeposit
flags directly in the ``GET /api/v3/account`` response (ccxt:
``fetch_balance()`` on the spot sub-client). We probe that and reject the
key if ``canWithdraw`` is true.

Market types
------------
Three sub-APIs masquerade as one venue:
- ``spot``   — SPOT pairs (BTC/USDT etc).
- ``swap``   — USD-M perpetuals (USDT-margined, default for our journal).
- ``future`` — coin-margined perps + dated coin-margined futures.

For v1 we iterate ``('swap', 'spot')`` — covers the vast majority of
spread / arb activity. Coin-M is rarely used; users that need it can flip
to the legacy adapter via ``CSJ_USE_LEGACY_ADAPTER_BINANCE=1``.
"""

from __future__ import annotations

from typing import Any

from csj_worker.adapters.configs._base import VenueConfig


async def _fetch_permissions(client: Any) -> dict[str, Any]:
    """Probe the spot account for canWithdraw flag.

    ccxt's ``fetch_balance()`` on the spot client wraps GET /api/v3/account
    and surfaces the account-level flags in ``response['info']``.
    """
    balance = await client.fetch_balance()
    info: dict[str, Any] = balance.get("info", {}) if isinstance(balance, dict) else {}
    return info


def _has_withdraw(info: dict[str, Any]) -> bool:
    return bool(info.get("canWithdraw", False))


def _extract_permissions(info: dict[str, Any]) -> list[str]:
    perms: list[str] = []
    if info.get("canTrade"):
        perms.append("canTrade")
    if info.get("canDeposit"):
        perms.append("canDeposit")
    # canWithdraw is intentionally excluded — its presence triggers rejection,
    # not a "granted permission" report.
    return perms


CONFIG = VenueConfig(
    code="binance",
    ccxt_id="binance",
    ccxt_options={"options": {"defaultType": "spot"}},
    requires_passphrase=False,
    supports_spot=True,
    supports_perp=True,
    supports_dated_futures=True,
    supports_options=False,
    supports_funding_history=True,
    supports_open_positions=True,
    supports_klines=True,
    max_lookback_days=90,
    page_size=1000,
    market_types=("swap", "spot"),
    funding_market_types=("swap",),
    fetch_permissions=_fetch_permissions,
    has_withdraw_permission=_has_withdraw,
    extract_permissions=_extract_permissions,
    rate_limit_rps=10.0,
    rate_limit_burst=20,
    rate_limit_cooloff_seconds=60,
    api_docs_url="https://developers.binance.com/docs/",
    notes=(
        "ccxt uses 'binance' for spot, 'binanceusdm' for USD-M futures and "
        "'binancecoinm' for coin-margined. The universal adapter switches "
        "defaultType per market_types iteration — same ccxt class, different "
        "options. For full coin-M support flip CSJ_USE_LEGACY_ADAPTER_BINANCE=1."
    ),
)
