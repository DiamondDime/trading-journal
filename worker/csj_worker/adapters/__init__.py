"""Exchange adapters. Every supported exchange has an `ExchangeAdapter` impl here."""

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

__all__ = [
    "AdapterAuthError",
    "AdapterError",
    "AdapterExchangeDownError",
    "AdapterInvalidDataError",
    "AdapterNetworkError",
    "AdapterPermissionError",
    "AdapterRateLimitedError",
    "AdapterUnsupportedError",
    "ExchangeAdapter",
]
