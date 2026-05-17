"""HTX (formerly Huobi) — universal-adapter config.

API docs: https://www.htx.com/en-us/opend/newApiPages/

Permission check
----------------
HTX exposes ``GET /v2/user/api-key`` which returns the API key's
``permission`` array (values: ``readOnly``, ``trade``, ``withdraw``).

Also requires an ``account_id`` lookup before most private endpoints —
ccxt handles that internally on demand, so we don't need to thread it
through the config.
"""

from __future__ import annotations

from typing import Any

from csj_worker.adapters.configs._base import VenueConfig


async def _fetch_permissions(client: Any) -> dict[str, Any]:
    """Call /v2/user/api-key via ccxt passthrough."""
    for method_name in (
        "v2PrivateGetUserApiKey",
        "spotV2PrivateGetUserApiKey",
        "private_get_v2_user_api_key",
    ):
        method = getattr(client, method_name, None)
        if method is None:
            continue
        try:
            return await method({})
        except Exception:
            continue
    # Fallback: probe fetchBalance and mark withdraw unverified.
    balance = await client.fetch_balance()
    return {
        "data": [{"permission": "readOnly", "_fallback": True}],
        "_balance_info": balance.get("info", {}) if isinstance(balance, dict) else {},
    }


def _has_withdraw(info: dict[str, Any]) -> bool:
    data = info.get("data")
    if isinstance(data, list) and data:
        first = data[0] if isinstance(data[0], dict) else {}
        permission = str(first.get("permission") or "")
        return "withdraw" in permission.lower()
    if isinstance(data, dict):
        permission = str(data.get("permission") or "")
        return "withdraw" in permission.lower()
    return False


def _extract_permissions(info: dict[str, Any]) -> list[str]:
    data = info.get("data")
    out: list[str] = ["read"]
    record: dict[str, Any] | None = None
    if isinstance(data, list) and data:
        if isinstance(data[0], dict):
            record = data[0]
    elif isinstance(data, dict):
        record = data
    if record is not None:
        permission = str(record.get("permission") or "")
        for p in permission.split(","):
            p_norm = p.strip().lower()
            if p_norm and p_norm != "withdraw":
                out.append(p_norm)
    return out


CONFIG = VenueConfig(
    code="htx",
    ccxt_id="htx",
    ccxt_options={"options": {"defaultType": "swap"}},
    requires_passphrase=False,
    supports_spot=True,
    supports_perp=True,
    supports_dated_futures=True,
    supports_options=False,
    supports_funding_history=True,
    supports_open_positions=True,
    supports_klines=True,
    max_lookback_days=90,
    page_size=200,
    market_types=("swap", "spot"),
    funding_market_types=("swap",),
    fetch_permissions=_fetch_permissions,
    has_withdraw_permission=_has_withdraw,
    extract_permissions=_extract_permissions,
    rate_limit_rps=5.0,
    rate_limit_burst=10,
    rate_limit_cooloff_seconds=30,
    api_docs_url="https://www.htx.com/en-us/opend/newApiPages/",
    notes=(
        "HTX = old Huobi. ccxt 4.4+ uses 'htx' as the class name (Huobi alias "
        "still works but is deprecated). ccxt resolves account_id internally."
    ),
)
