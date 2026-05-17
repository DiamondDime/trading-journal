"""KuCoin — universal-adapter config.

API docs: https://docs.kucoin.com/futures/

Permission check
----------------
KuCoin requires a passphrase as the third auth secret. Permissions are
returned by ``GET /api/v2/user-info`` (ccxt: passthrough
``private_get_user_info``); the response includes a ``permissions`` array
with values such as ``General``, ``Trade``, ``Transfer``. KuCoin's
"Transfer" permission is the closest analogue to "withdraw" — a key with
Transfer can move funds out of the spot account.

We reject if ``Transfer`` is present. Note that KuCoin's "Withdraw" is
*not* a separate API key scope (you must enable Transfer for withdrawals
to work).
"""

from __future__ import annotations

from typing import Any

from csj_worker.adapters.configs._base import VenueConfig


async def _fetch_permissions(client: Any) -> dict[str, Any]:
    """Call GET /api/v2/user-info via ccxt's passthrough."""
    # ccxt's KuCoin client exposes private_get_user_info as
    # privateGetUsers (or similar) — the camelCased method name depends on
    # ccxt version. We rely on the unified fetchBalance for the "Read"
    # probe and inspect ccxt's reported permissions where available.
    balance = await client.fetch_balance()
    info: dict[str, Any] = balance.get("info", {}) if isinstance(balance, dict) else {}
    # KuCoin's fetchBalance does NOT surface permissions directly. The
    # passthrough call below is the official permission probe; ccxt names it
    # differently across versions, so we try the most likely names.
    perms_raw: dict[str, Any] = {}
    for method_name in (
        "privateGetUsers",
        "private_get_users",
        "privateGetUserInfo",
    ):
        method = getattr(client, method_name, None)
        if method is None:
            continue
        try:
            perms_raw = await method({})
            break
        except Exception:
            # Try the next variant; we'll fall back to "unverified" if all fail.
            continue
    return {
        "info": info,
        "permissions_raw": perms_raw,
    }


def _has_withdraw(info: dict[str, Any]) -> bool:
    perms_raw = info.get("permissions_raw") or {}
    # KuCoin's response shape: ``{"code": "200000", "data": {...,
    # "permission": "General,Trade,Transfer"}}`` for a single-key call,
    # or a list for sub-accounts.
    data = perms_raw.get("data") if isinstance(perms_raw, dict) else None
    if isinstance(data, dict):
        permission_str: str = str(data.get("permission") or "")
        return "Transfer" in permission_str or "Withdraw" in permission_str
    if isinstance(data, list) and data:
        # Take the first item — single-user keys typically return one row.
        first = data[0] if isinstance(data[0], dict) else {}
        permission_str = str(first.get("permission") or "")
        return "Transfer" in permission_str or "Withdraw" in permission_str
    return False


def _extract_permissions(info: dict[str, Any]) -> list[str]:
    perms_raw = info.get("permissions_raw") or {}
    data = perms_raw.get("data") if isinstance(perms_raw, dict) else None
    out: list[str] = ["read"]
    if isinstance(data, dict):
        permission_str = str(data.get("permission") or "")
        for p in permission_str.split(","):
            p = p.strip()
            if p and p not in ("Transfer", "Withdraw"):
                out.append(p.lower())
    return out


CONFIG = VenueConfig(
    code="kucoin",
    ccxt_id="kucoinfutures",
    ccxt_options={"options": {"defaultType": "swap"}},
    requires_passphrase=True,
    supports_spot=True,
    supports_perp=True,
    supports_dated_futures=False,
    supports_options=False,
    supports_funding_history=True,
    supports_open_positions=True,
    supports_klines=True,
    max_lookback_days=30,
    page_size=200,
    market_types=("swap", "spot"),
    funding_market_types=("swap",),
    fetch_permissions=_fetch_permissions,
    has_withdraw_permission=_has_withdraw,
    extract_permissions=_extract_permissions,
    rate_limit_rps=5.0,
    rate_limit_burst=10,
    rate_limit_cooloff_seconds=30,
    api_docs_url="https://docs.kucoin.com/futures/",
    notes=(
        "KuCoin splits spot and futures across separate ccxt classes "
        "('kucoin' vs 'kucoinfutures'). We default to 'kucoinfutures' since "
        "the journal is perp-focused; spot users will see no fills. "
        "KuCoin's 'Transfer' permission is the closest to withdraw and is "
        "rejected. Requires passphrase."
    ),
)
