"""Phemex — universal-adapter config.

API docs: https://phemex-docs.github.io/

Permission check
----------------
Phemex's authenticated endpoints do not expose a permission-introspection
call. Per the framework's documented policy we treat the venue as
"withdraw-unverified": probe fetchBalance for Read, surface unverified
status to the UI.

Phemex is mostly used for derivatives. ccxt's ``phemex`` class accepts
``defaultType`` = ``'swap'`` for perps.
"""

from __future__ import annotations

from typing import Any

from csj_worker.adapters.configs._base import VenueConfig


async def _fetch_permissions(client: Any) -> dict[str, Any]:
    balance = await client.fetch_balance()
    return {
        "verified_read": True,
        "withdraw_status": "unverified",
        "_raw_info": balance.get("info", {}) if isinstance(balance, dict) else {},
    }


def _has_withdraw(info: dict[str, Any]) -> bool:
    return False


def _extract_permissions(info: dict[str, Any]) -> list[str]:
    return ["read", "withdraw:unverified"]


CONFIG = VenueConfig(
    code="phemex",
    ccxt_id="phemex",
    ccxt_options={"options": {"defaultType": "swap"}},
    requires_passphrase=False,
    supports_spot=True,
    supports_perp=True,
    supports_dated_futures=False,
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
    api_docs_url="https://phemex-docs.github.io/",
    notes=(
        "Phemex has no permission-introspection endpoint. UI must display "
        "'withdraw:unverified' and require user attestation."
    ),
)
