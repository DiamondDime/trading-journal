"""``VenueConfig`` — the per-exchange config consumed by ``CcxtUniversalAdapter``.

A VenueConfig captures everything that varies between exchanges:

- ``code`` — our canonical exchange code (matches ``exchange_catalog.code``).
- ``ccxt_id`` — the ccxt module attribute name (``ccxt.async_support[ccxt_id]``).
  In nearly every case this equals ``code``; the exception is ``htx`` which
  ccxt still aliases as ``huobi`` in some versions (we use ``htx`` directly,
  since ccxt 4.4+ exposes it).
- ``ccxt_options`` — passed verbatim to the ccxt constructor (e.g.
  ``{'defaultType': 'swap'}`` for venues whose default sub-API is spot).
- ``requires_passphrase`` — KuCoin, OKX, Bitget require a third secret.
- ``supports_*`` capability flags — drive ``AdapterCapabilities`` plus an
  early UNSUPPORTED short-circuit in the adapter methods.
- ``market_types`` — list of ccxt ``defaultType`` values to iterate over
  when fetching fills (e.g. ``['spot', 'swap', 'future']``). The adapter
  rebuilds the ccxt client per market type (cheap; no network) and merges
  results.
- ``has_withdraw_permission`` — callable that takes the venue-specific
  account / api-info response dict and returns True if the key has
  destructive permissions. Each venue exposes this differently; the
  callable encapsulates the lookup.
- ``permission_check`` — coroutine that calls the venue's read-only
  api-info endpoint, returns a dict the ``has_withdraw_permission`` and
  ``extract_permissions`` callables can consume. None means "use the
  default fetchBalance shape" (works for Binance only).

Crash safety: VenueConfig is **frozen** — mutating it after construction
raises. This prevents accidental cross-test contamination.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

# Type aliases for clarity.
PermissionFetcher = Callable[[Any], Awaitable[dict[str, Any]]]
"""Callable that takes the ccxt client and returns a dict with permission info.

The returned dict is opaque to the framework — it's passed verbatim to
``has_withdraw_permission`` and ``extract_permissions`` callables which know
the per-venue shape.
"""

WithdrawCheck = Callable[[dict[str, Any]], bool]
"""Pure function: dict from fetch_permissions -> True if withdraw permission present."""

PermissionExtractor = Callable[[dict[str, Any]], list[str]]
"""Pure function: dict from fetch_permissions -> list of granted permission strings.

Used only for reporting in ``ConnectionStatusResult.permissions``.
"""


@dataclass(frozen=True)
class VenueConfig:
    """Per-exchange config consumed by ``CcxtUniversalAdapter``.

    The framework treats this dataclass as immutable. Construct one per
    supported venue in ``csj_worker.adapters.configs.<venue>`` and register
    it in ``ADAPTER_REGISTRY``.
    """

    code: str
    """Canonical exchange code — must match ``exchange_catalog.code``."""

    ccxt_id: str
    """ccxt attribute name (``ccxt.async_support[ccxt_id]``). Usually == code."""

    ccxt_options: dict[str, Any] = field(default_factory=dict)
    """Passed verbatim to the ccxt constructor.

    Common keys:
        ``defaultType``       — ``'spot'`` / ``'swap'`` / ``'future'``.
        ``enableRateLimit``   — we set False ourselves; do not override.
        ``options``           — nested venue-specific opts.
    """

    requires_passphrase: bool = False
    """KuCoin, OKX, Bitget. The adapter validates presence at connect()."""

    # ---- Capability flags ---------------------------------------------------
    supports_spot: bool = True
    supports_perp: bool = True
    supports_dated_futures: bool = False
    supports_options: bool = False
    supports_funding_history: bool = True
    supports_open_positions: bool = True
    supports_klines: bool = True
    supports_fetch_my_trades: bool = True

    max_lookback_days: int = 90
    """Most venues enforce a 90-day or 180-day window on private trade history."""

    page_size: int = 200
    """Suggested per-request page size. ccxt's per-venue minimum still applies."""

    # ---- Market-type iteration ---------------------------------------------
    market_types: tuple[str, ...] = ("swap",)
    """ccxt market types to iterate when fetching fills.

    Each value drives a fresh ccxt client with ``defaultType=<value>``. The
    adapter calls ``fetchMyTrades(symbol)`` per active market in each client.
    Default is ``('swap',)`` — derivatives-only — which matches the journal's
    primary use case (spread / perp arb).

    Override with ``('swap', 'spot')`` for venues where spot fills matter,
    or ``('swap', 'spot', 'future')`` for venues with separate dated-futures.
    """

    # ---- Permission check ---------------------------------------------------
    fetch_permissions: PermissionFetcher | None = None
    """Coroutine that returns a dict with permission info.

    Receives the ccxt client (with credentials already wired). Returns an
    opaque dict consumed by ``has_withdraw_permission`` /
    ``extract_permissions``. None means the adapter falls back to a generic
    fetchBalance probe + structural check (works for Binance and a few
    others that surface ``canWithdraw`` in fetchBalance.info).
    """

    has_withdraw_permission: WithdrawCheck = lambda perms: False  # noqa: E731
    """Return True if the permissions dict indicates withdraw access.

    The default returns False, which the adapter treats as "withdraw status
    unknown — accept with WARNING". Override per venue.
    """

    extract_permissions: PermissionExtractor = lambda perms: []  # noqa: E731
    """Return a list of permission strings for ConnectionStatusResult.

    Stringly-typed (e.g. ``['canTrade', 'canDeposit']``). Default is empty.
    """

    # ---- Rate limiting ------------------------------------------------------
    rate_limit_rps: float = 5.0
    rate_limit_burst: int = 10
    rate_limit_cooloff_seconds: int = 30

    # ---- Funding-history quirks --------------------------------------------
    funding_market_types: tuple[str, ...] | None = None
    """ccxt market types to use for funding history (default = market_types).

    Some venues split funding history across linear/inverse with different
    endpoints; this lets us skip spot iteration.
    """

    # ---- Reference URLs (informational, not used by the adapter) -----------
    api_docs_url: str = ""
    """URL to the venue's official API docs (for traceability)."""

    notes: str = ""
    """Free-form notes — quirks, limitations, or unsupported features."""
