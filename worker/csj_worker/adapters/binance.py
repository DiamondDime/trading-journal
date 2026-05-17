"""Compatibility shim — re-exports the legacy Binance adapter.

The hand-built adapter has moved to ``csj_worker.adapters.legacy.binance``.
Importers should prefer the universal adapter via
``csj_worker.adapters.get_adapter('binance', ...)`` going forward; this shim
keeps existing test imports working during the migration.
"""

from __future__ import annotations

from csj_worker.adapters.legacy.binance import (  # noqa: F401
    BinanceAdapter,
    _build_clients,
    _map_ccxt_error,
    _normalize_symbol,
    _parse_fill,
    _parse_funding_event,
    _parse_position,
    _parse_retry_after,
    _to_decimal,
)

__all__ = ["BinanceAdapter", "_build_clients"]
