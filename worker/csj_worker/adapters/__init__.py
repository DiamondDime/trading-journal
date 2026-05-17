"""Exchange adapters package.

Public surface
--------------
- ``ExchangeAdapter`` ABC + ``AdapterError`` hierarchy (from ``.base``).
- ``CcxtUniversalAdapter`` + ``VenueConfig`` (from ``.generic`` / ``.configs``).
- ``ADAPTER_REGISTRY`` and ``get_adapter()`` factory.

Adding a new exchange
---------------------
1. Add a ``VenueConfig`` module under ``configs/<code>.py``.
2. Add it to ``ALL_CONFIGS`` in ``configs/__init__.py``.
3. Add the code to ``ADAPTER_REGISTRY`` below.
4. Add the row to the ``exchange_catalog`` migration.

Legacy fallback
---------------
For each of the venues that has a hand-built legacy adapter (Binance,
Bybit, Hyperliquid), setting the env var
``CSJ_USE_LEGACY_ADAPTER_<EXCHANGE>=1`` returns the legacy adapter
instead of the universal one. Useful as a regression escape hatch.

Hyperliquid is NOT on ccxt — its adapter is always the legacy
hand-built one; the env var has no effect.
"""

from __future__ import annotations

import os
from typing import Any

from csj_worker.adapters.base import (
    AdapterAuthError,
    AdapterError,
    AdapterExchangeDownError,
    AdapterInvalidDataError,
    AdapterNetworkError,
    AdapterPermissionError,
    AdapterRateLimitedError,
    AdapterUnsupportedError,
    ExchangeAdapter,
)
from csj_worker.adapters.configs import ALL_CONFIGS, VenueConfig
from csj_worker.adapters.generic import CcxtUniversalAdapter

__all__ = [
    "ADAPTER_REGISTRY",
    "AdapterAuthError",
    "AdapterError",
    "AdapterExchangeDownError",
    "AdapterInvalidDataError",
    "AdapterNetworkError",
    "AdapterPermissionError",
    "AdapterRateLimitedError",
    "AdapterUnsupportedError",
    "CcxtUniversalAdapter",
    "ExchangeAdapter",
    "VenueConfig",
    "get_adapter",
]


# ---------------------------------------------------------------------------
# Adapter factory
# ---------------------------------------------------------------------------


# Build a registry mapping exchange codes to a no-arg constructor closure.
# Construction is cheap and stateless — adapters take credentials per call.
def _build_registry() -> dict[str, Any]:
    """Build the registry once at import time.

    Each entry maps an exchange code to a zero-arg callable returning a
    fresh ``ExchangeAdapter``. Closures over the VenueConfig keep this
    declaration-style without an explicit lambda zoo.
    """

    def _make_universal(cfg: VenueConfig):
        def _factory() -> ExchangeAdapter:
            return CcxtUniversalAdapter(cfg)

        return _factory

    registry: dict[str, Any] = {}
    for code, cfg in ALL_CONFIGS.items():
        registry[code] = _make_universal(cfg)

    # Hyperliquid is bespoke — not on ccxt.
    def _make_hyperliquid() -> ExchangeAdapter:
        from csj_worker.adapters.legacy.hyperliquid import HyperliquidAdapter

        return HyperliquidAdapter()

    registry["hyperliquid"] = _make_hyperliquid
    return registry


ADAPTER_REGISTRY: dict[str, Any] = _build_registry()


def _legacy_override(code: str) -> ExchangeAdapter | None:
    """Return a legacy adapter when ``CSJ_USE_LEGACY_ADAPTER_<CODE>=1``."""
    env_var = f"CSJ_USE_LEGACY_ADAPTER_{code.upper()}"
    if os.environ.get(env_var) != "1":
        return None
    if code == "binance":
        from csj_worker.adapters.legacy.binance import BinanceAdapter

        return BinanceAdapter()
    if code == "bybit":
        from csj_worker.adapters.legacy.bybit import BybitAdapter

        return BybitAdapter()
    # Hyperliquid is always-legacy; flagging it via env var is a no-op
    # (the registry already returns the legacy adapter).
    return None


def get_adapter(exchange_code: str) -> ExchangeAdapter | None:
    """Factory: return a configured adapter for the given exchange code.

    Returns ``None`` if the code is not registered (preserves the legacy
    daemon's "skip if unsupported" semantics).

    Respects ``CSJ_USE_LEGACY_ADAPTER_<CODE>=1`` env-var overrides for the
    venues where a hand-built fallback exists.
    """
    code = exchange_code.lower()
    override = _legacy_override(code)
    if override is not None:
        return override
    factory = ADAPTER_REGISTRY.get(code)
    if factory is None:
        return None
    return factory()
