"""Compatibility shim — re-exports the legacy Bybit adapter.

The hand-built adapter has moved to ``csj_worker.adapters.legacy.bybit``.
Importers should prefer the universal adapter via
``csj_worker.adapters.get_adapter('bybit', ...)`` going forward; this shim
keeps existing test imports working during the migration.
"""

from __future__ import annotations

from csj_worker.adapters.legacy.bybit import BybitAdapter  # noqa: F401

__all__ = ["BybitAdapter"]
