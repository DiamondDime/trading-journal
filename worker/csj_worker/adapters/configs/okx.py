"""OKX v5 — universal-adapter config.

API docs: https://www.okx.com/docs-v5/en/

Permission check
----------------
OKX v5 exposes ``GET /api/v5/users/me`` (or ``account/config``) which
returns the API key's ``perm`` field — comma-separated list with values
``read_only``, ``trade``, ``withdraw``. We reject if ``withdraw`` is
present.

Requires passphrase.

Market types
------------
OKX uses ``instType`` on most endpoints (SPOT, SWAP, FUTURES, OPTION).
ccxt's ``okx`` class maps ``defaultType`` → instType:
- ``'spot'``   → SPOT
- ``'swap'``   → SWAP
- ``'future'`` → FUTURES
- ``'option'`` → OPTION
"""

from __future__ import annotations

from typing import Any

from csj_worker.adapters.configs._base import VenueConfig


async def _fetch_permissions(client: Any) -> dict[str, Any]:
    """Call GET /api/v5/users/me via ccxt passthrough."""
    for method_name in (
        "privateGetUsersMe",
        "private_get_users_me",
        "privateGetAccountConfig",
    ):
        method = getattr(client, method_name, None)
        if method is None:
            continue
        try:
            return await method({})
        except Exception:
            continue
    # Fallback
    balance = await client.fetch_balance()
    return {
        "data": [{"perm": "read_only", "_fallback": True}],
        "_balance_info": balance.get("info", {}) if isinstance(balance, dict) else {},
    }


def _has_withdraw(info: dict[str, Any]) -> bool:
    data = info.get("data")
    if isinstance(data, list) and data:
        first = data[0] if isinstance(data[0], dict) else {}
        perm = str(first.get("perm") or "")
        return "withdraw" in perm.lower()
    if isinstance(data, dict):
        perm = str(data.get("perm") or "")
        return "withdraw" in perm.lower()
    return False


def _extract_permissions(info: dict[str, Any]) -> list[str]:
    data = info.get("data")
    out: list[str] = []
    record: dict[str, Any] | None = None
    if isinstance(data, list) and data:
        if isinstance(data[0], dict):
            record = data[0]
    elif isinstance(data, dict):
        record = data
    if record is not None:
        perm = str(record.get("perm") or "")
        for p in perm.split(","):
            p_norm = p.strip().lower()
            if p_norm and p_norm != "withdraw":
                out.append(p_norm)
    if not out:
        out = ["read_only"]
    return out


CONFIG = VenueConfig(
    code="okx",
    ccxt_id="okx",
    ccxt_options={"options": {"defaultType": "swap"}},
    requires_passphrase=True,
    supports_spot=True,
    supports_perp=True,
    supports_dated_futures=True,
    supports_options=True,
    supports_funding_history=True,
    supports_open_positions=True,
    supports_klines=True,
    max_lookback_days=90,
    page_size=100,
    market_types=("swap", "spot"),
    funding_market_types=("swap",),
    fetch_permissions=_fetch_permissions,
    has_withdraw_permission=_has_withdraw,
    extract_permissions=_extract_permissions,
    rate_limit_rps=10.0,
    rate_limit_burst=20,
    rate_limit_cooloff_seconds=30,
    api_docs_url="https://www.okx.com/docs-v5/en/",
    notes=(
        "OKX requires passphrase. ccxt's defaultType maps to instType. "
        "Options and dated futures are supported but not iterated by default; "
        "extend market_types if those activities need fetching."
    ),
)
