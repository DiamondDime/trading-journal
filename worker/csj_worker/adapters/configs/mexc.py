"""MEXC — universal-adapter config.

API docs: https://mexcdevelop.github.io/apidocs/

Permission check
----------------
MEXC does not expose API key permissions on any read endpoint. The only
way to determine withdraw status is to *attempt* a withdraw — which is
destructive UX. Per the framework's documented policy (see
``adapters/configs/_base.py``) we treat MEXC as "withdraw-unverified" and
surface that to the UI so the user can confirm their key is read-only.

This is intentionally conservative: we never silently pass a destructive
key, but we cannot block one either. The UI MUST show the unverified
status and require user attestation.
"""

from __future__ import annotations

from typing import Any

from csj_worker.adapters.configs._base import VenueConfig


async def _fetch_permissions(client: Any) -> dict[str, Any]:
    """Probe Read access — withdraw scope is not introspectable."""
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
    code="mexc",
    ccxt_id="mexc",
    ccxt_options={"options": {"defaultType": "swap"}},
    requires_passphrase=False,
    supports_spot=True,
    supports_perp=True,
    supports_dated_futures=False,
    supports_options=False,
    supports_funding_history=True,
    supports_open_positions=True,
    supports_klines=True,
    max_lookback_days=30,
    page_size=1000,
    market_types=("swap", "spot"),
    funding_market_types=("swap",),
    fetch_permissions=_fetch_permissions,
    has_withdraw_permission=_has_withdraw,
    extract_permissions=_extract_permissions,
    rate_limit_rps=5.0,
    rate_limit_burst=10,
    rate_limit_cooloff_seconds=30,
    api_docs_url="https://mexcdevelop.github.io/apidocs/",
    notes=(
        "MEXC has no permissions endpoint. The framework cannot verify "
        "withdraw status — the user must create a read-only key and the UI "
        "displays 'withdraw:unverified' to enforce attestation."
    ),
)
