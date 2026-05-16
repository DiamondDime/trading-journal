"""Canonical types — Python mirror of src/types/canonical.ts.

Keep these byte-identical with TS counterparts. Values are Decimal where money
or quantities are involved (NEVER float). Pydantic v2.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Annotated, Any, Literal

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


# ---------------------------------------------------------------------------
# v2 — Activity supertype + per-type subtypes
# (mirrors supabase/migrations/20260516120000_v2_activity_supertype.sql)
# ---------------------------------------------------------------------------


class ActivityType(str, Enum):
    """Top-level discriminator for a journaled activity.

    Joins to exactly one of activity_spread / activity_trade / activity_sale /
    activity_airdrop based on this value.
    """

    SPREAD = "spread"
    TRADE = "trade"
    SALE = "sale"
    AIRDROP = "airdrop"


class ActivityStatus(str, Enum):
    """Shared lifecycle states across all activity types.

    Each activity type uses a subset (see chk_activity_status_by_type in the
    migration). The DB enforces the valid (type, status) pairs.
    """

    PENDING = "pending"              # sale: paid pre-TGE; airdrop: eligible not claimed
    OPEN = "open"                    # trade: active; spread: legs open
    WINDING_DOWN = "winding_down"    # spread: some legs closed
    ORPHANED = "orphaned"            # spread: one leg open with no hedge
    VESTING = "vesting"              # sale: some claimed, more to vest
    CLAIMED = "claimed"              # airdrop: tokens received
    LIQUIDATED = "liquidated"        # trade: position liquidated
    EXPIRED = "expired"              # spread: dated future settled
    CLOSED = "closed"                # terminal: fully done


class SaleKind(str, Enum):
    """Kind of token sale event captured by an activity_sale row."""

    IDO = "ido"
    LAUNCHPAD = "launchpad"
    PREMARKET = "premarket"
    OTC = "otc"


class HeadlineKind(str, Enum):
    """Discriminator for v_activity_feed.headline_value.

    Drives activity-agnostic card rendering: realized_apr is a fraction
    (e.g. 0.25 = 25% APR); mtm_multiplier is a ratio (e.g. 2.0 = 2x).
    """

    REALIZED_APR = "realized_apr"
    MTM_MULTIPLIER = "mtm_multiplier"


# --- Vesting schedule (discriminated union) --------------------------------


class _VestingBase(CanonicalBase):
    """Base for all vesting-schedule variants. Discriminated on `kind`."""


class AllAtTge(_VestingBase):
    """Vesting: 100% unlocked at TGE (no cliff, no linear)."""

    kind: Literal["all_at_tge"] = "all_at_tge"


class TgePlusLinear(_VestingBase):
    """Vesting: `tge_pct` unlocked at TGE, remainder linear over `linear_days`."""

    kind: Literal["tge_plus_linear"] = "tge_plus_linear"
    tge_pct: float
    linear_days: int


class CliffPlusLinear(_VestingBase):
    """Vesting: nothing for `cliff_days`, then linear over `linear_days`.

    `tge_pct` optionally unlocks a slice at TGE before the cliff begins.
    """

    kind: Literal["cliff_plus_linear"] = "cliff_plus_linear"
    cliff_days: int
    linear_days: int
    tge_pct: float | None = None


class CustomVestingEntry(CanonicalBase):
    """One step of a hand-crafted vesting schedule: a date and a fraction."""

    date: datetime
    pct: Decimal


class CustomVesting(_VestingBase):
    """Vesting: an explicit list of (date, pct) unlock steps."""

    kind: Literal["custom"] = "custom"
    entries: list[CustomVestingEntry]


VestingSchedule = Annotated[
    AllAtTge | TgePlusLinear | CliffPlusLinear | CustomVesting,
    Field(discriminator="kind"),
]


class ClaimEvent(CanonicalBase):
    """A single token-claim event recorded against an activity_sale."""

    date: datetime
    qty: Decimal
    tx_hash: str | None = None


# --- Supertype --------------------------------------------------------------


class Activity(CanonicalBase):
    """Supertype row from `public.activity`.

    Holds the shared fields (type, status, lifecycle dates, denormalized PnL
    aggregates, tags). Joins 1:1 with exactly one subtype table based on
    `type`.
    """

    id: str
    user_id: str
    type: ActivityType
    status: ActivityStatus
    name: str
    opened_at: datetime | None = None
    closed_at: datetime | None = None
    capital_deployed_usd: Decimal | None = None
    realized_pnl_usd: Decimal | None = None
    unrealized_pnl_usd: Decimal | None = None
    fees_usd: Decimal = Decimal("0")
    net_pnl_usd: Decimal | None = None
    regime_tags: list[str] = Field(default_factory=list)
    custom_tags: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None = None


# --- Subtypes ---------------------------------------------------------------


class ActivitySpread(CanonicalBase):
    """Spread-specific columns from `public.activity_spread`.

    Subtype-only fields; the shared columns (status, name, opened_at, PnL,
    tags, etc.) live on the `Activity` row referenced by `activity_id`.
    """

    activity_id: str
    spread_type: SpreadType
    variant: SpreadVariant | None = None
    origin: Literal["auto_matched", "manual", "auto_confirmed"]
    primary_base: str
    match_confidence: Decimal | None = None
    funding_pnl_quote: Decimal = Decimal("0")
    apr: Decimal | None = None
    exchanges: list[Exchange] = Field(default_factory=list)
    leg_count: int = 0
    hold_duration_ms: int | None = None
    source: Literal["user", "system"] = "user"
    system_proposal_metadata: dict[str, Any] | None = None
    target_apr_at_open: Decimal | None = None
    expected_holding_days: int | None = None
    expected_basis_convergence_date: datetime | None = None
    exit_plan: str | None = None
    borrow_cost_assumed_bps: Decimal | None = None
    close_threshold_apr: Decimal | None = None
    close_threshold_periods: int | None = None
    max_gas_budget_usd: Decimal | None = None
    slippage_tolerance_bps: Decimal | None = None


class ActivityTrade(CanonicalBase):
    """Trade-specific columns from `public.activity_trade`.

    A journaled Position: pick an existing Position and promote it to a Trade
    with entry thesis, exit plan, target/stop prices, and realized APR.
    """

    activity_id: str
    position_id: str
    symbol: str
    exchange: Exchange
    instrument_kind: InstrumentKind
    side: PositionSide
    entry_thesis: str | None = None
    exit_plan: str | None = None
    target_price: Decimal | None = None
    stop_price: Decimal | None = None
    qty: Decimal
    avg_entry_price: Decimal
    avg_exit_price: Decimal | None = None
    realized_apr: Decimal | None = None


class ActivitySale(CanonicalBase):
    """Sale-specific columns from `public.activity_sale`.

    IDO / launchpad / premarket / OTC token sale. `effective_price_usd` is a
    DB-generated column. `vesting_schedule` and `claim_events` are JSONB with
    app-layer validation (see VestingSchedule, ClaimEvent).
    """

    activity_id: str
    token_symbol: str
    token_name: str | None = None
    token_chain: str | None = None
    sale_kind: SaleKind
    sale_venue: str | None = None
    sale_date: datetime
    usd_paid: Decimal
    tokens_allocated: Decimal
    effective_price_usd: Decimal | None = None
    vesting_schedule: VestingSchedule | None = None
    claim_events: list[ClaimEvent] = Field(default_factory=list)
    total_claimed: Decimal = Decimal("0")
    remaining_locked: Decimal | None = None
    current_price_usd: Decimal | None = None
    current_price_at: datetime | None = None


class ActivityAirdrop(CanonicalBase):
    """Airdrop-specific columns from `public.activity_airdrop`.

    Tokens received from a protocol. `current_price_usd` / `current_price_at`
    are updated by the price-tracker so the MTM multiplier on the feed stays
    fresh.
    """

    activity_id: str
    token_symbol: str
    token_name: str | None = None
    token_chain: str | None = None
    protocol: str
    snapshot_date: datetime | None = None
    eligibility_reason: str | None = None
    qty_received: Decimal
    claim_date: datetime | None = None
    claim_tx_hash: str | None = None
    value_at_receipt_usd: Decimal | None = None
    current_price_usd: Decimal | None = None
    current_price_at: datetime | None = None


# --- Feed view -------------------------------------------------------------


class ActivityFeedRow(CanonicalBase):
    """One row from `public.v_activity_feed`.

    Polymorphic cross-activity feed: shared activity columns plus a per-type
    `headline_value` (interpreted via `headline_kind`) and a `primary_symbol`
    hint pulled from whichever subtype matches `type`.
    """

    id: str
    user_id: str
    type: ActivityType
    status: ActivityStatus
    name: str
    opened_at: datetime | None = None
    closed_at: datetime | None = None
    capital_deployed_usd: Decimal | None = None
    realized_pnl_usd: Decimal | None = None
    unrealized_pnl_usd: Decimal | None = None
    fees_usd: Decimal
    net_pnl_usd: Decimal | None = None
    regime_tags: list[str] = Field(default_factory=list)
    custom_tags: list[str] = Field(default_factory=list)
    headline_value: Decimal | None = None
    headline_kind: HeadlineKind
    primary_symbol: str | None = None
    created_at: datetime
    updated_at: datetime
