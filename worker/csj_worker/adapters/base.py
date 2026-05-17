"""Exchange adapter ABC. Every venue integration MUST implement this contract.

Architecture invariants:
- Adapters are stateless w.r.t. user data; they receive Credentials per call.
- DEX vs CEX share the same ABC; differences are encoded in `capabilities` + Credentials.
- Pagination is async-iterator-of-pages — Hyperliquid can return 10K rows/call.
- Idempotency: every CanonicalFill carries stable `external_trade_id`.
- Errors raise from the AdapterError hierarchy; callers MUST NOT catch Exception blindly.
- Read-only: adapters MUST refuse credentials with withdraw/trade permission at connect time.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from datetime import datetime

from csj_worker.types import (
    AdapterCapabilities,
    AdapterErrorCode,
    AuthMode,
    CanonicalFill,
    CanonicalFundingEvent,
    CanonicalPosition,
    ConnectionStatusResult,
    Credentials,
    Exchange,
    ExchangeKind,
    RateLimitPolicy,
    RetryPolicy,
)


# ---------------------------------------------------------------------------
# Error hierarchy
# ---------------------------------------------------------------------------


class AdapterError(Exception):
    code: AdapterErrorCode = AdapterErrorCode.UNKNOWN
    retryable: bool = False
    retry_after: float | None = None

    def __init__(
        self,
        message: str,
        *,
        retry_after: float | None = None,
        cause: BaseException | None = None,
    ):
        super().__init__(message)
        self.retry_after = retry_after
        if cause is not None:
            self.__cause__ = cause


class AdapterAuthError(AdapterError):
    code = AdapterErrorCode.AUTH_FAILED
    retryable = False


class AdapterPermissionError(AdapterError):
    """Credentials valid but lack required permission, or have forbidden one (withdraw)."""

    code = AdapterErrorCode.PERMISSION
    retryable = False


class AdapterRateLimitedError(AdapterError):
    code = AdapterErrorCode.RATE_LIMITED
    retryable = True


class AdapterNetworkError(AdapterError):
    code = AdapterErrorCode.NETWORK
    retryable = True


class AdapterExchangeDownError(AdapterError):
    code = AdapterErrorCode.EXCHANGE_DOWN
    retryable = True


class AdapterInvalidDataError(AdapterError):
    """Data shape from exchange did not match expected. Bug — surface loudly."""

    code = AdapterErrorCode.INVALID_DATA
    retryable = False


class AdapterUnsupportedError(AdapterError):
    """Feature not supported by this exchange. Caller should check capabilities first."""

    code = AdapterErrorCode.UNSUPPORTED
    retryable = False


# ---------------------------------------------------------------------------
# The contract
# ---------------------------------------------------------------------------


class ExchangeAdapter(ABC):
    """Every exchange integration MUST implement this."""

    exchange: Exchange
    exchange_kind: ExchangeKind
    auth_mode: AuthMode
    capabilities: AdapterCapabilities
    rate_limit: RateLimitPolicy
    retry_policy: RetryPolicy = RetryPolicy()

    # ----- Lifecycle -----

    @abstractmethod
    async def connect(self, credentials: Credentials) -> ConnectionStatusResult:
        """Validate credentials and return connection health.

        MUST:
        - Make exactly one light authenticated request (e.g. /account, /user).
        - Capture permissions; reject if withdraw permission detected.
        - Capture server_time for skew detection (warn if drift > 5 min).

        Raises: AdapterAuthError, AdapterPermissionError, AdapterNetworkError.
        """

    @abstractmethod
    async def validate_credentials(self, credentials: Credentials) -> bool:
        """Cheap re-check used by periodic health check.

        Returns False on auth failure; raises on transport errors so caller can retry.
        Distinct from `connect`: must NOT mutate cached session state.
        """

    # ----- Data fetch — paginated async generators -----

    @abstractmethod
    def fetch_fills(
        self,
        credentials: Credentials,
        *,
        since: datetime,
        until: datetime,
    ) -> AsyncIterator[list[CanonicalFill]]:
        """Yield pages of fills in [since, until], ASC by filled_at.

        Pagination strategies vary by venue (Binance fromId, Bybit cursor,
        Hyperliquid time-windowed). Adapter handles internally; callers
        see only pages.

        Raises: AdapterRateLimitedError, AdapterAuthError, AdapterInvalidDataError,
                AdapterNetworkError.
        """

    @abstractmethod
    def fetch_funding_events(
        self,
        credentials: Credentials,
        *,
        since: datetime,
        until: datetime,
    ) -> AsyncIterator[list[CanonicalFundingEvent]]:
        """Yield pages of funding payments in [since, until], ASC by occurred_at.

        Adapters whose capabilities.supports_funding_history is False MUST
        raise AdapterUnsupportedError (defense in depth).
        """

    @abstractmethod
    async def fetch_open_positions(
        self,
        credentials: Credentials,
    ) -> list[CanonicalPosition]:
        """Snapshot of currently-open positions. Used to reconcile against
        positions derived from fills (drift detection).

        For wallet-based DEX adapters: queries venue indexer for the wallet's
        current open positions.
        """

    # ----- Public market data (kline / OHLCV) -----

    async def fetch_klines(
        self,
        symbol: str,
        start_ms: int,
        end_ms: int,
        *,
        interval: str = "1m",
    ) -> list[dict]:
        """Return klines (OHLCV bars) for ``symbol`` in [start_ms, end_ms].

        Each returned dict has the canonical shape::

            {"ts_ms": int, "open": Decimal, "high": Decimal,
             "low": Decimal, "close": Decimal, "volume": Decimal}

        ``interval`` is a ccxt-style timeframe string (``"1m"``, ``"5m"``,
        ``"15m"``, ``"1h"``...). Adapters MAY map this to their venue-native
        bucket strings internally.

        Public market data: NO credentials are required. This is used by the
        excursion-backfill worker to compute MAE/MFE over closed-trade windows
        without ever touching authenticated endpoints.

        Default impl raises ``AdapterUnsupportedError`` — adapters override
        when they can provide klines. Raises on transient errors so the caller
        can apply backoff (see ``AdapterRateLimitedError`` / ``AdapterNetworkError``).
        """
        raise AdapterUnsupportedError(
            f"Adapter for {self.exchange.value} does not implement fetch_klines"
        )
