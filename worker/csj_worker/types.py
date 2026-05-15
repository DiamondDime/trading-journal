"""Canonical types — Python mirror of src/types/canonical.ts.

Keep these byte-identical with TS counterparts. Values are Decimal where money
or quantities are involved (NEVER float). Pydantic v2.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Enums (values match TS canonical enums byte-for-byte)
# ---------------------------------------------------------------------------


class Exchange(str, Enum):
    BINANCE = "binance"
    BYBIT = "bybit"
    HYPERLIQUID = "hyperliquid"
    OKX = "okx"
    DERIBIT = "deribit"
    OKX_DEX = "okx_dex"
    ASTER = "aster"
    PHEMEX = "phemex"
    BITGET = "bitget"
    MEXC = "mexc"
    KUCOIN = "kucoin"
    KRAKEN = "kraken"
    GATE = "gate"
    BINGX = "bingx"


class ExchangeKind(str, Enum):
    CEX = "cex"
    DEX = "dex"


class AuthMode(str, Enum):
    API_KEY = "api_key"
    WALLET_ADDRESS = "wallet_address"


class ConnectionStatus(str, Enum):
    PENDING = "pending"
    ACTIVE = "active"
    SYNCING = "syncing"
    AUTH_FAILED = "auth_failed"
    RATE_LIMITED = "rate_limited"
    ERROR = "error"
    DISABLED = "disabled"


class InstrumentKind(str, Enum):
    SPOT = "spot"
    PERP = "perp"
    DATED_FUTURE = "dated_future"
    OPTION = "option"


class Side(str, Enum):
    BUY = "buy"
    SELL = "sell"


class PositionSide(str, Enum):
    LONG = "long"
    SHORT = "short"


class PositionStatus(str, Enum):
    OPEN = "open"
    CLOSED = "closed"


class FundingDirection(str, Enum):
    RECEIVED = "received"
    PAID = "paid"


class FeeKind(str, Enum):
    MAKER = "maker"
    TAKER = "taker"
    FUNDING = "funding"
    WITHDRAWAL = "withdrawal"
    GAS = "gas"


class SpreadType(str, Enum):
    CROSS_EXCHANGE_PERP_ARB = "cross_exchange_perp_arb"
    CASH_CARRY = "cash_carry"
    CALENDAR = "calendar"
    FUNDING_CAPTURE = "funding_capture"
    DEX_CEX_ARB = "dex_cex_arb"
    CUSTOM = "custom"


class SpreadStatus(str, Enum):
    CANDIDATE = "candidate"        # matcher proposal, not yet accepted
    REJECTED = "rejected"          # candidate dismissed
    OPEN = "open"                  # all legs filled, position active
    WINDING_DOWN = "winding_down"  # some legs closed, intentional exit in progress
    ORPHANED = "orphaned"          # one leg open with no remaining hedge (UNINTENDED)
    EXPIRED = "expired"            # dated-future settlement reached before manual close
    CLOSED = "closed"              # all legs fully closed


class SpreadVariant(str, Enum):
    # cash_carry
    CASH_CARRY_FUNDING = "funding"        # short leg is a perp
    CASH_CARRY_BASIS = "basis"            # short leg is a dated future
    # funding_capture
    FUNDING_CAPTURE_SAME_VENUE = "same_venue"
    FUNDING_CAPTURE_CROSS_VENUE = "cross_venue"


class CardHeadlineMetric(str, Enum):
    BPS_CAPTURED = "bps_captured"
    REALIZED_APR = "realized_apr"
    BPS_PER_DAY = "bps_per_day"
    NET_PNL_QUOTE = "net_pnl_quote"


class CardHeadlineFormat(str, Enum):
    BPS = "bps"
    APR_PCT = "apr_pct"
    BPS_PER_DAY = "bps_per_day"
    USD = "usd"


class CandidateState(str, Enum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    EXPIRED = "expired"


class AdapterErrorCode(str, Enum):
    AUTH_FAILED = "auth_failed"
    RATE_LIMITED = "rate_limited"
    NETWORK = "network"
    EXCHANGE_DOWN = "exchange_down"
    INVALID_DATA = "invalid_data"
    PERMISSION = "permission"
    UNSUPPORTED = "unsupported"
    UNKNOWN = "unknown"


class ConnectionHealth(str, Enum):
    OK = "ok"
    AUTH_FAILED = "auth_failed"
    PERMISSION = "permission"
    UNREACHABLE = "unreachable"


# ---------------------------------------------------------------------------
# Canonical wire models
# ---------------------------------------------------------------------------


class CanonicalBase(BaseModel):
    model_config = ConfigDict(
        arbitrary_types_allowed=False,
        str_strip_whitespace=True,
        extra="forbid",
    )


class CanonicalInstrument(CanonicalBase):
    exchange: Exchange
    kind: InstrumentKind
    base: str
    quote: str
    expiry: datetime | None = None
    strike: Decimal | None = None
    option_kind: Literal["call", "put"] | None = None
    raw_symbol: str


class CanonicalFill(CanonicalBase):
    external_trade_id: str
    external_order_id: str | None = None
    instrument: CanonicalInstrument
    side: Side
    qty: Decimal
    price: Decimal
    notional: Decimal
    fee: Decimal
    fee_currency: str
    fee_kind: FeeKind = FeeKind.TAKER
    is_maker: bool = False
    liquidity: Literal["maker", "taker"] | None = None
    position_side: PositionSide | None = None
    reduce_only: bool | None = None
    filled_at: datetime
    raw: dict[str, Any] = Field(default_factory=dict)


class CanonicalFundingEvent(CanonicalBase):
    instrument: CanonicalInstrument
    direction: FundingDirection
    funding_rate: Decimal
    position_qty: Decimal
    amount: Decimal
    amount_currency: str
    occurred_at: datetime
    external_id: str | None = None
    raw: dict[str, Any] = Field(default_factory=dict)


class CanonicalPosition(CanonicalBase):
    """Open-position snapshot. Closed positions are reconstructed from fills."""

    external_position_id: str | None = None
    instrument: CanonicalInstrument
    side: PositionSide
    qty_open: Decimal
    avg_entry_price: Decimal
    unrealized_pnl: Decimal | None = None
    mark_price: Decimal | None = None
    leverage: Decimal | None = None
    liquidation_price: Decimal | None = None
    opened_at: datetime | None = None
    raw: dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Credentials
# ---------------------------------------------------------------------------


class ApiKeyCredentials(CanonicalBase):
    """CEX credentials. Loaded from Supabase Vault — never logged, never serialized."""

    api_key: str
    api_secret: str
    passphrase: str | None = None


class WalletCredentials(CanonicalBase):
    """DEX credentials — public address only."""

    address: str
    chain: str | None = None


Credentials = ApiKeyCredentials | WalletCredentials


class ConnectionStatusResult(CanonicalBase):
    health: ConnectionHealth
    auth_mode: AuthMode
    permissions: list[str] = Field(default_factory=list)
    message: str | None = None
    server_time: datetime | None = None


class AdapterCapabilities(CanonicalBase):
    exchange: Exchange
    exchange_kind: ExchangeKind
    auth_mode: AuthMode
    supports_spot: bool
    supports_perp: bool
    supports_dated_futures: bool
    supports_options: bool
    supports_funding_history: bool
    supports_open_positions: bool
    max_lookback_days: int | None = None
    page_size: int = 100


class RateLimitPolicy(CanonicalBase):
    requests_per_second: float
    burst: int
    cooloff_seconds: int = 30


class RetryPolicy(CanonicalBase):
    max_attempts: int = 5
    base_delay_ms: int = 250
    max_delay_ms: int = 30_000
    jitter: bool = True
    retry_on: list[AdapterErrorCode] = Field(
        default_factory=lambda: [
            AdapterErrorCode.RATE_LIMITED,
            AdapterErrorCode.NETWORK,
            AdapterErrorCode.EXCHANGE_DOWN,
            AdapterErrorCode.UNKNOWN,
        ]
    )
