"""Compatibility shim — re-exports the canonical Hyperliquid adapter.

The implementation lives in ``csj_worker.adapters.legacy.hyperliquid``.
Hyperliquid is NOT on ccxt, so unlike the CEX adapters this is the canonical
implementation, not a legacy fallback. The "legacy" folder is just the
implementation home.
"""

from __future__ import annotations

from csj_worker.adapters.legacy.hyperliquid import (  # noqa: F401
    HyperliquidAdapter,
    _FILLS_PAGE_CAP,
)

__all__ = ["HyperliquidAdapter", "_FILLS_PAGE_CAP"]
