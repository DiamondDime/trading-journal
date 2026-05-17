"""Legacy hand-built adapters.

These adapters predate the universal `CcxtUniversalAdapter` framework. They
are battle-tested but verbose (~700 LOC each). The new framework collapses
similar venues into a single adapter driven by per-venue `VenueConfig`.

Migration policy
----------------
- For each venue, the universal adapter is the default.
- Set ``CSJ_USE_LEGACY_ADAPTER_<EXCHANGE>=1`` to fall back to the legacy
  implementation (useful if a venue-specific quirk regresses).
- Hyperliquid is not on ccxt — its legacy adapter is the *canonical* impl,
  not a fallback. It is re-exported from this package without a generic
  replacement.

Adding a new exchange should NOT add code here; add a `VenueConfig` in
``csj_worker.adapters.configs`` instead.
"""

from __future__ import annotations

from csj_worker.adapters.legacy.binance import BinanceAdapter
from csj_worker.adapters.legacy.bybit import BybitAdapter
from csj_worker.adapters.legacy.hyperliquid import HyperliquidAdapter

__all__ = ["BinanceAdapter", "BybitAdapter", "HyperliquidAdapter"]
