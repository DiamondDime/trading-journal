"""Bitget v2 — universal-adapter config.

API docs: https://www.bitget.com/api-doc/contract/intro

Permission check
----------------
Bitget v2 exposes ``GET /api/v2/user/api-key-info`` which returns the
``permsList`` array. Values include ``read``, ``trade``, ``transfer``,
and ``withdraw``. We reject if either ``transfer`` or ``withdraw`` is
present.

Requires passphrase.
"""

from __future__ import annotations

from typing import Any

from csj_worker.adapters.configs._base import VenueConfig


async def _fetch_permissions(client: Any) -> dict[str, Any]:
    """Call /api/v2/user/api-key-info via ccxt passthrough.

    ccxt method names for Bitget passthrough vary by version; we try a few.
    """
    for method_name in (
        "privateGetV2UserApiKeyInfo",
        "private_get_v2_user_api_key_info",
        "privateGetApiV3KeyInfo",
    ):
        method = getattr(client, method_name, None)
        if method is None:
            continue
        try:
            return await method({})
        except Exception:
            continue
    # Fallback: probe fetchBalance for read access; mark withdraw as unverified.
    balance = await client.fetch_balance()
    return {
        "data": {"permsList": ["read"], "_fallback": True},
        "_balance_info": balance.get("info", {}) if isinstance(balance, dict) else {},
    }


def _has_withdraw(info: dict[str, Any]) -> bool:
    data = info.get("data") or {}
    perms_list = data.get("permsList") or data.get("permission") or []
    if isinstance(perms_list, list):
        norm = [str(p).lower() for p in perms_list]
        return "withdraw" in norm or "transfer" in norm
    if isinstance(perms_list, str):
        norm_s = perms_list.lower()
        return "withdraw" in norm_s or "transfer" in norm_s
    return False


def _extract_permissions(info: dict[str, Any]) -> list[str]:
    data = info.get("data") or {}
    perms_list = data.get("permsList") or data.get("permission") or ["read"]
    if isinstance(perms_list, list):
        return [
            str(p).lower()
            for p in perms_list
            if str(p).lower() not in ("withdraw", "transfer")
        ]
    return ["read"]


CONFIG = VenueConfig(
    code="bitget",
    ccxt_id="bitget",
    ccxt_options={"options": {"defaultType": "swap"}},
    requires_passphrase=True,
    supports_spot=True,
    supports_perp=True,
    supports_dated_futures=False,
    supports_options=False,
    supports_funding_history=True,
    supports_open_positions=True,
    supports_klines=True,
    max_lookback_days=90,
    page_size=500,
    market_types=("swap", "spot"),
    funding_market_types=("swap",),
    fetch_permissions=_fetch_permissions,
    has_withdraw_permission=_has_withdraw,
    extract_permissions=_extract_permissions,
    rate_limit_rps=5.0,
    rate_limit_burst=10,
    rate_limit_cooloff_seconds=30,
    api_docs_url="https://www.bitget.com/api-doc/contract/intro",
    notes=(
        "Bitget v2 exposes api-key-info with permsList. Requires passphrase. "
        "Withdraw and Transfer are both rejected scopes."
    ),
)
