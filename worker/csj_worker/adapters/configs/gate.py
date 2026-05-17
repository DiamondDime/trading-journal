"""Gate.io v4 — universal-adapter config.

API docs: https://www.gate.com/docs/developers/apiv4/

Permission check
----------------
Gate v4 does NOT have a single endpoint that returns API key permissions.
However ``GET /api/v4/account/detail`` returns user metadata; and a
withdraw-permission probe is achievable via ``GET /api/v4/wallet/withdraw_status``
which requires ``WALLET:Withdraw`` and returns 401 otherwise.

Pragmatic two-step:
1. Probe ``fetch_balance`` for Read.
2. Attempt ``private_get_wallet_withdraw_status({})`` — a 200 response
   (or ccxt error code 4000 with "key permission") indicates the key has
   withdraw scope; reject.

To avoid extra round-trips on every connect we wrap both in
``_fetch_permissions`` and let the framework's withdraw_check evaluate.
"""

from __future__ import annotations

from typing import Any

from csj_worker.adapters.configs._base import VenueConfig


async def _fetch_permissions(client: Any) -> dict[str, Any]:
    """Probe Read access + attempt a withdraw-scope probe.

    Strategy:
    - fetch_balance → confirms Read.
    - private_get_wallet_withdraw_status → 200 if Withdraw enabled, else
      ccxt raises PermissionDenied / AuthenticationError which we catch
      and interpret as 'no withdraw'.
    """
    balance = await client.fetch_balance()
    has_withdraw_scope: bool = False
    try:
        # ccxt method names are camelCased internally for raw endpoints.
        # This is the private_get for /api/v4/wallet/withdraw_status.
        await client.privateWalletGetWithdrawStatus({})
        has_withdraw_scope = True
    except Exception:
        # Any error → assume no withdraw scope. Includes legitimate
        # "no withdraw permission" responses AND transient network errors;
        # we prefer false-negatives (accept the key) here since the user
        # also independently confirms via the UI before saving.
        has_withdraw_scope = False
    return {
        "has_withdraw_scope": has_withdraw_scope,
        "_raw_info": balance.get("info", {}) if isinstance(balance, dict) else {},
    }


def _has_withdraw(info: dict[str, Any]) -> bool:
    return bool(info.get("has_withdraw_scope", False))


def _extract_permissions(info: dict[str, Any]) -> list[str]:
    out: list[str] = ["read"]
    if info.get("has_withdraw_scope"):
        # We don't return this normally (key would be rejected), but include
        # for completeness if the check fires after rejection.
        out.append("withdraw")
    return out


CONFIG = VenueConfig(
    code="gate",
    ccxt_id="gate",
    ccxt_options={"options": {"defaultType": "swap"}},
    requires_passphrase=False,
    supports_spot=True,
    supports_perp=True,
    supports_dated_futures=True,
    supports_options=False,
    supports_funding_history=True,
    supports_open_positions=True,
    supports_klines=True,
    max_lookback_days=180,
    page_size=1000,
    market_types=("swap", "spot"),
    funding_market_types=("swap",),
    fetch_permissions=_fetch_permissions,
    has_withdraw_permission=_has_withdraw,
    extract_permissions=_extract_permissions,
    rate_limit_rps=5.0,
    rate_limit_burst=10,
    rate_limit_cooloff_seconds=30,
    api_docs_url="https://www.gate.com/docs/developers/apiv4/",
    notes=(
        "Gate v4 has no permissions endpoint; we probe the withdraw_status "
        "endpoint as a side-channel test. False-negatives possible on "
        "transient errors — UI prompt should still ask user to confirm key is "
        "read-only."
    ),
)
