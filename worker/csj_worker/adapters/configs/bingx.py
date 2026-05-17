"""BingX — universal-adapter config.

API docs: https://bingx-api.github.io/docs/

Permission check
----------------
BingX does not surface key permissions through a single read-only endpoint
in the same way Binance / Bybit do. The pragmatic check:

1. Probe ``GET /openApi/spot/v1/account/balance`` (ccxt: ``fetch_balance``
   on the spot client). A 100403 / 401 response means the key lacks
   ``Read`` scope or is otherwise invalid.
2. There is no public "canWithdraw" field. We therefore mark BingX as
   "withdraw-status UNVERIFIED" — the user is responsible for creating
   a read-only key, and we surface that loudly in the connect() message.

This is the same posture MEXC takes (see ``mexc.py``). The framework
treats ``has_withdraw_permission -> False`` as "unverified" and emits a
warning rather than a hard rejection in the adapter — the user-facing UI
displays the warning so the user can rotate the key if it has withdraw
scope.
"""

from __future__ import annotations

from typing import Any

from csj_worker.adapters.configs._base import VenueConfig


async def _fetch_permissions(client: Any) -> dict[str, Any]:
    """Probe authenticated read access — no permission introspection available.

    We do a minimal fetchBalance call. Success means at least Read scope;
    we cannot determine whether Withdraw is also granted.
    """
    balance = await client.fetch_balance()
    return {
        "verified_read": True,
        # No introspection: surface this fact to the user via extract.
        "withdraw_status": "unverified",
        "_raw_info": balance.get("info", {}) if isinstance(balance, dict) else {},
    }


def _has_withdraw(info: dict[str, Any]) -> bool:
    # BingX never lets us know — assume safe (False) but expose unverified
    # in extract_permissions so the UI can prompt the user to confirm.
    return False


def _extract_permissions(info: dict[str, Any]) -> list[str]:
    return ["read", "withdraw:unverified"]


CONFIG = VenueConfig(
    code="bingx",
    ccxt_id="bingx",
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
    page_size=500,
    market_types=("swap", "spot"),
    funding_market_types=("swap",),
    fetch_permissions=_fetch_permissions,
    has_withdraw_permission=_has_withdraw,
    extract_permissions=_extract_permissions,
    rate_limit_rps=5.0,
    rate_limit_burst=10,
    rate_limit_cooloff_seconds=30,
    api_docs_url="https://bingx-api.github.io/docs/",
    notes=(
        "BingX has no permission-introspection endpoint. We probe fetchBalance "
        "to validate Read scope, but cannot detect Withdraw enablement — the "
        "user MUST create a read-only key. UI displays withdraw:unverified."
    ),
)
