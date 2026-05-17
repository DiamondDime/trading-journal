"""Per-venue ``VenueConfig`` instances consumed by ``CcxtUniversalAdapter``.

Adding a new exchange
---------------------
1. Create ``configs/<code>.py`` (one module per venue, kept short).
2. Define a module-level constant ``CONFIG = VenueConfig(...)``.
3. Register ``CONFIG`` in ``ADAPTER_REGISTRY`` (see ``adapters/__init__.py``).
4. Add a row in the ``exchange_catalog`` migration.
5. Add a smoke test in ``tests/adapters/configs/test_<code>.py``.

The framework deliberately limits per-venue code to a single ~30-LOC module.
Anything larger should be questioned: ccxt almost certainly already covers it.
"""

from __future__ import annotations

from csj_worker.adapters.configs._base import VenueConfig
from csj_worker.adapters.configs.binance import CONFIG as BINANCE_CONFIG
from csj_worker.adapters.configs.bingx import CONFIG as BINGX_CONFIG
from csj_worker.adapters.configs.bitget import CONFIG as BITGET_CONFIG
from csj_worker.adapters.configs.bybit import CONFIG as BYBIT_CONFIG
from csj_worker.adapters.configs.gate import CONFIG as GATE_CONFIG
from csj_worker.adapters.configs.htx import CONFIG as HTX_CONFIG
from csj_worker.adapters.configs.kucoin import CONFIG as KUCOIN_CONFIG
from csj_worker.adapters.configs.mexc import CONFIG as MEXC_CONFIG
from csj_worker.adapters.configs.okx import CONFIG as OKX_CONFIG
from csj_worker.adapters.configs.phemex import CONFIG as PHEMEX_CONFIG

ALL_CONFIGS: dict[str, VenueConfig] = {
    "binance": BINANCE_CONFIG,
    "bingx": BINGX_CONFIG,
    "bitget": BITGET_CONFIG,
    "bybit": BYBIT_CONFIG,
    "gate": GATE_CONFIG,
    "htx": HTX_CONFIG,
    "kucoin": KUCOIN_CONFIG,
    "mexc": MEXC_CONFIG,
    "okx": OKX_CONFIG,
    "phemex": PHEMEX_CONFIG,
}

__all__ = [
    "ALL_CONFIGS",
    "BINANCE_CONFIG",
    "BINGX_CONFIG",
    "BITGET_CONFIG",
    "BYBIT_CONFIG",
    "GATE_CONFIG",
    "HTX_CONFIG",
    "KUCOIN_CONFIG",
    "MEXC_CONFIG",
    "OKX_CONFIG",
    "PHEMEX_CONFIG",
    "VenueConfig",
]
