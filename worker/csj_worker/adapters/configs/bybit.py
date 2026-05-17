"""Bybit v5 — universal-adapter config.

API docs: https://bybit-exchange.github.io/docs/v5/intro

Permission check
----------------
Bybit v5 exposes ``GET /v5/user/query-api`` which returns the key's
``readOnly`` flag and a per-scope permissions object. The relevant fields:

- ``readOnly == 1`` → key cannot trade.
- ``permissions.Wallet`` includes ``"Withdraw"`` → destructive permission;
  reject regardless of readOnly because Bybit conflates "wallet read" with
  withdraw enablement on some account tiers.

ccxt exposes the call via the passthrough ``private_get_v5_user_query_api``.

Market types
------------
Bybit v5 uses ``category`` (linear / inverse / spot) on every request,
not ``defaultType``. ccxt's ``bybit`` class accepts ``defaultType`` and
maps it: ``'swap'`` → linear, ``'spot'`` → spot.
"""

from __future__ import annotations

from typing import Any

from csj_worker.adapters.configs._base import VenueConfig


async def _fetch_permissions(client: Any) -> dict[str, Any]:
    """Call /v5/user/query-api and return the result sub-dict.

    Bybit envelope: ``{retCode, retMsg, result: {...}, time}``.
    Non-zero retCode means failed call; raise so the framework maps to
    AdapterAuthError.
    """
    response: dict[str, Any] = await client.private_get_v5_user_query_api({})
    ret_code = response.get("retCode", -1)
    if ret_code != 0:
        # ccxt's ExchangeError import — we deliberately raise a generic
        # exception here; the adapter's outer error mapper classifies it.
        raise RuntimeError(
            f"Bybit /v5/user/query-api retCode={ret_code}: {response.get('retMsg')}"
        )
    return response.get("result", {}) or {}


def _has_withdraw(info: dict[str, Any]) -> bool:
    # Either non-read-only OR explicit Withdraw scope → reject.
    if info.get("readOnly", 0) != 1:
        return True
    permissions: dict[str, Any] = info.get("permissions", {}) or {}
    wallet_perms = permissions.get("Wallet", []) or []
    return "Withdraw" in wallet_perms


def _extract_permissions(info: dict[str, Any]) -> list[str]:
    out: list[str] = []
    permissions: dict[str, Any] = info.get("permissions", {}) or {}
    for scope, perms in permissions.items():
        for perm in perms or []:
            if perm == "Withdraw":  # surfaced only via rejection
                continue
            out.append(f"{scope}:{perm}")
    return out


CONFIG = VenueConfig(
    code="bybit",
    ccxt_id="bybit",
    ccxt_options={"options": {"defaultType": "swap", "recvWindow": 5000}},
    requires_passphrase=False,
    supports_spot=True,
    supports_perp=True,
    supports_dated_futures=False,
    supports_options=True,
    supports_funding_history=True,
    supports_open_positions=True,
    supports_klines=True,
    max_lookback_days=730,
    page_size=100,
    market_types=("swap", "spot"),
    funding_market_types=("swap",),
    fetch_permissions=_fetch_permissions,
    has_withdraw_permission=_has_withdraw,
    extract_permissions=_extract_permissions,
    rate_limit_rps=10.0,
    rate_limit_burst=20,
    rate_limit_cooloff_seconds=30,
    api_docs_url="https://bybit-exchange.github.io/docs/v5/intro",
    notes=(
        "Bybit splits derivatives into 'linear' (USDT perp) and 'inverse' "
        "(coin-margined). ccxt maps defaultType='swap' to linear. For inverse, "
        "flip CSJ_USE_LEGACY_ADAPTER_BYBIT=1 (legacy adapter iterates both)."
    ),
)
