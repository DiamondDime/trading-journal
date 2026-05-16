"""Async psycopg3 helpers for the worker daemon.

Centralises the SQL the daemon runs so ``main.py`` reads as orchestration only.
All functions take an open ``psycopg.AsyncConnection`` and assume the caller
manages transactions (commit/rollback) at a coarser granularity.

Schema references (read-only):
- ``exchange_connections`` (migration 003)
- ``fills`` (migration 004) — idempotent on (exchange_connection_id, raw_exchange_id)
- ``positions`` (migration 004) — read for matcher input
- ``spread_candidates`` (migration 006) — matcher output, ``state='pending'``

Decimal handling: psycopg3 returns NUMERIC as ``decimal.Decimal`` by default.
We pass Decimals back unchanged.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Json

from csj_worker.crypto import EncryptedField
from csj_worker.crypto import decrypt_credential as _decrypt
from csj_worker.matcher.models import MatcherPosition, ProposedLeg, SpreadProposal
from csj_worker.types import (
    ApiKeyCredentials,
    CanonicalFill,
    CanonicalInstrument,
    ConnectionStatus,
    Credentials,
    Exchange,
    ExchangeKind,
    InstrumentKind,
    PositionSide,
    PositionStatus,
    WalletCredentials,
)

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Models (DB rows projected to dataclasses)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ConnectionRow:
    """Projection of one ``exchange_connections`` row.

    Holds the encrypted credential ciphertexts; call ``decrypt_credentials``
    to materialize a ``Credentials`` instance (never store the plaintext
    on the dataclass).
    """

    id: str
    user_id: str
    exchange_code: str
    label: str
    connection_type: str  # 'api_key' | 'wallet_address'
    api_key_ciphertext: bytes | None
    api_key_nonce: bytes | None
    api_secret_ciphertext: bytes | None
    api_secret_nonce: bytes | None
    api_passphrase_ciphertext: bytes | None
    api_passphrase_nonce: bytes | None
    wallet_address_ciphertext: bytes | None
    wallet_address_nonce: bytes | None
    wallet_chain: str | None
    status: str
    last_sync_at: datetime | None
    last_sync_cursor: str | None
    last_fill_at: datetime | None


# ---------------------------------------------------------------------------
# Connection pool
# ---------------------------------------------------------------------------


async def open_async_conn(database_url: str) -> psycopg.AsyncConnection:
    """Open a single async connection. Caller owns the lifecycle."""
    return await psycopg.AsyncConnection.connect(database_url, autocommit=False)


# ---------------------------------------------------------------------------
# Connection-row helpers
# ---------------------------------------------------------------------------


_CONNECTION_SELECT = """
    select
      id::text                          as id,
      user_id::text                     as user_id,
      exchange_code,
      label,
      connection_type,
      api_key_ciphertext,
      api_key_nonce,
      api_secret_ciphertext,
      api_secret_nonce,
      api_passphrase_ciphertext,
      api_passphrase_nonce,
      wallet_address_ciphertext,
      wallet_address_nonce,
      wallet_chain,
      status::text                      as status,
      last_sync_at,
      last_sync_cursor,
      last_fill_at
    from public.exchange_connections
    where deleted_at is null
"""


def _row_to_connection(row: dict[str, Any]) -> ConnectionRow:
    return ConnectionRow(
        id=row["id"],
        user_id=row["user_id"],
        exchange_code=row["exchange_code"],
        label=row["label"],
        connection_type=row["connection_type"],
        api_key_ciphertext=bytes(row["api_key_ciphertext"]) if row["api_key_ciphertext"] else None,
        api_key_nonce=bytes(row["api_key_nonce"]) if row["api_key_nonce"] else None,
        api_secret_ciphertext=bytes(row["api_secret_ciphertext"]) if row["api_secret_ciphertext"] else None,
        api_secret_nonce=bytes(row["api_secret_nonce"]) if row["api_secret_nonce"] else None,
        api_passphrase_ciphertext=bytes(row["api_passphrase_ciphertext"]) if row["api_passphrase_ciphertext"] else None,
        api_passphrase_nonce=bytes(row["api_passphrase_nonce"]) if row["api_passphrase_nonce"] else None,
        wallet_address_ciphertext=bytes(row["wallet_address_ciphertext"]) if row["wallet_address_ciphertext"] else None,
        wallet_address_nonce=bytes(row["wallet_address_nonce"]) if row["wallet_address_nonce"] else None,
        wallet_chain=row["wallet_chain"],
        status=row["status"],
        last_sync_at=row["last_sync_at"],
        last_sync_cursor=row["last_sync_cursor"],
        last_fill_at=row["last_fill_at"],
    )


async def recover_orphaned_syncing(
    conn: psycopg.AsyncConnection,
) -> int:
    """Reset connections stuck in ``syncing`` back to ``active``.

    Called at daemon startup. A connection lands in ``syncing`` when this
    worker began a sync; on a normal completion we transition out. If the
    worker crashed (or the process was killed mid-sync), a row can stay in
    ``syncing`` indefinitely and block re-sync. v1 assumption: a single
    worker instance per database; if you run multiples, build a heartbeat.
    """
    async with conn.cursor() as cur:
        await cur.execute(
            "update public.exchange_connections"
            "    set status='active', status_message='recovered from orphaned syncing state'"
            "  where status='syncing' and deleted_at is null"
        )
        return cur.rowcount or 0


async def list_syncable_connections(
    conn: psycopg.AsyncConnection,
) -> list[ConnectionRow]:
    """Return connections that should be considered for sync.

    Includes ``active`` and ``rate_limited`` (re-attempted on the next cycle).
    Excludes ``pending`` (not yet authenticated), ``auth_failed``, ``error``,
    ``disabled``, ``syncing`` (another worker is on it).
    """
    sql = _CONNECTION_SELECT + " and status::text in ('active', 'rate_limited') order by last_sync_at nulls first"
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(sql)
        rows = await cur.fetchall()
    return [_row_to_connection(r) for r in rows]


async def get_connection(
    conn: psycopg.AsyncConnection,
    connection_id: str,
) -> ConnectionRow | None:
    sql = _CONNECTION_SELECT + " and id::text = %s"
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(sql, (connection_id,))
        row = await cur.fetchone()
    return _row_to_connection(row) if row else None


async def mark_connection_syncing(
    conn: psycopg.AsyncConnection,
    connection_id: str,
) -> None:
    """Mark a connection as currently syncing. Caller commits."""
    async with conn.cursor() as cur:
        await cur.execute(
            "update public.exchange_connections set status='syncing', status_message=null"
            " where id::text = %s",
            (connection_id,),
        )


async def mark_connection_synced(
    conn: psycopg.AsyncConnection,
    connection_id: str,
    *,
    fills_added: int,
    last_fill_at: datetime | None,
) -> None:
    """Mark a successful sync: bump watermark + counters, reset status to active."""
    async with conn.cursor() as cur:
        await cur.execute(
            """
            update public.exchange_connections
               set status='active',
                   status_message=null,
                   last_sync_at=now(),
                   last_fill_at=coalesce(%s, last_fill_at),
                   fills_synced=fills_synced + %s
             where id::text = %s
            """,
            (last_fill_at, fills_added, connection_id),
        )


async def mark_connection_error(
    conn: psycopg.AsyncConnection,
    connection_id: str,
    *,
    status: ConnectionStatus,
    message: str,
) -> None:
    """Set an error state on a connection. ``message`` MUST NOT contain credentials."""
    # Truncate to avoid pathological log/DB growth; secrets should already be masked
    # upstream — this is belt-and-braces.
    safe_msg = (message or "")[:1000]
    async with conn.cursor() as cur:
        await cur.execute(
            """
            update public.exchange_connections
               set status=%s::connection_status,
                   status_message=%s
             where id::text = %s
            """,
            (status.value, safe_msg, connection_id),
        )


# ---------------------------------------------------------------------------
# Credentials decryption
# ---------------------------------------------------------------------------


def decrypt_connection_credentials(row: ConnectionRow) -> Credentials | None:
    """Materialize a Credentials object from the connection row's ciphertexts.

    Returns None if the row is missing the required encrypted fields (e.g. a
    ``pending`` row not yet populated). Plaintext lives only as a temporary
    return value — never log this.
    """
    if row.connection_type == "api_key":
        if not (
            row.api_key_ciphertext
            and row.api_key_nonce
            and row.api_secret_ciphertext
            and row.api_secret_nonce
        ):
            return None
        api_key = _decrypt(
            EncryptedField(ciphertext=row.api_key_ciphertext, nonce=row.api_key_nonce)
        )
        api_secret = _decrypt(
            EncryptedField(
                ciphertext=row.api_secret_ciphertext, nonce=row.api_secret_nonce
            )
        )
        passphrase = None
        if row.api_passphrase_ciphertext and row.api_passphrase_nonce:
            passphrase = _decrypt(
                EncryptedField(
                    ciphertext=row.api_passphrase_ciphertext,
                    nonce=row.api_passphrase_nonce,
                )
            )
        return ApiKeyCredentials(
            api_key=api_key, api_secret=api_secret, passphrase=passphrase
        )

    if row.connection_type == "wallet_address":
        if not (row.wallet_address_ciphertext and row.wallet_address_nonce):
            return None
        address = _decrypt(
            EncryptedField(
                ciphertext=row.wallet_address_ciphertext,
                nonce=row.wallet_address_nonce,
            )
        )
        return WalletCredentials(address=address, chain=row.wallet_chain)

    return None


# ---------------------------------------------------------------------------
# Fill persistence
# ---------------------------------------------------------------------------


async def insert_fills(
    conn: psycopg.AsyncConnection,
    *,
    user_id: str,
    exchange_connection_id: str,
    fills: list[CanonicalFill],
) -> int:
    """Insert a page of fills idempotently. Returns the count actually inserted.

    Uses ``ON CONFLICT (exchange_connection_id, raw_exchange_id) DO NOTHING``
    so replays of the same page are no-ops. Caller commits the transaction.
    """
    if not fills:
        return 0

    rows: list[tuple[Any, ...]] = []
    for f in fills:
        rows.append(
            (
                user_id,
                exchange_connection_id,
                f.external_trade_id,
                f.instrument.raw_symbol,
                f.instrument.kind.value,
                f.side.value,
                f.position_side.value if f.position_side is not None else None,
                f.reduce_only,
                f.qty,
                f.price,
                f.notional,
                f.fee,
                f.fee_currency,
                f.fee_kind.value,
                f.is_maker,
                f.liquidity,  # 'maker' | 'taker' | None
                f.external_order_id,
                Json({}),  # trade_metadata: nothing structured yet
                Json(f.raw),  # raw_payload
                f.filled_at,
            )
        )

    sql = """
        insert into public.fills (
            user_id,
            exchange_connection_id,
            raw_exchange_id,
            instrument,
            instrument_type,
            side,
            position_side,
            reduce_only,
            qty,
            price,
            notional,
            fee,
            fee_currency,
            fee_kind,
            is_maker,
            liquidity_role,
            order_id,
            trade_metadata,
            raw_payload,
            executed_at
        ) values (
            %s, %s, %s, %s, %s::instrument_type, %s::fill_side, %s::position_side,
            %s, %s, %s, %s, %s, %s, %s::fee_kind, %s, %s, %s, %s, %s, %s
        )
        on conflict (exchange_connection_id, raw_exchange_id) do nothing
    """

    inserted = 0
    async with conn.cursor() as cur:
        for params in rows:
            await cur.execute(sql, params)
            inserted += cur.rowcount or 0
    return inserted


# ---------------------------------------------------------------------------
# Matcher I/O
# ---------------------------------------------------------------------------


async def load_matcher_positions(
    conn: psycopg.AsyncConnection,
    *,
    user_id: str | None = None,
) -> list[MatcherPosition]:
    """Load open positions joined to connection metadata, mapped to MatcherPosition.

    The matcher needs exchange + exchange_kind + instrument context. Positions
    are only meaningful when joined to the connection that produced them.

    Filters: ``deleted_at is null``. If ``user_id`` is provided, scope to that
    user; otherwise return all (multi-tenant-ready).
    """
    sql = """
        select
            p.id::text                   as position_id,
            p.user_id::text              as user_id,
            p.exchange_connection_id::text as connection_id,
            p.instrument,
            p.instrument_type::text      as instrument_type,
            p.side::text                 as side,
            p.total_qty,
            p.avg_entry_price,
            p.opened_at,
            p.closed_at,
            p.status::text               as status,
            p.total_funding_quote,
            ec.exchange_code,
            ec.exchange_code in (
                select code from public.exchange_catalog where venue_type='dex'
            )                            as is_dex
        from public.positions p
        join public.exchange_connections ec on ec.id = p.exchange_connection_id
        where p.deleted_at is null
          and p.status = 'open'
    """
    params: tuple[Any, ...] = ()
    if user_id is not None:
        sql += " and p.user_id::text = %s"
        params = (user_id,)

    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(sql, params)
        rows = await cur.fetchall()

    out: list[MatcherPosition] = []
    for r in rows:
        try:
            exchange = Exchange(r["exchange_code"])
        except ValueError:
            log.warning(
                "matcher.load.unknown_exchange",
                extra={"exchange_code": r["exchange_code"], "position_id": r["position_id"]},
            )
            continue
        try:
            kind = InstrumentKind(r["instrument_type"])
        except ValueError:
            log.warning(
                "matcher.load.unknown_instrument_kind",
                extra={"kind": r["instrument_type"], "position_id": r["position_id"]},
            )
            continue

        # Re-parse base/quote out of the raw instrument string. Best-effort.
        base, quote = _split_instrument(r["instrument"])
        instrument = CanonicalInstrument(
            exchange=exchange,
            kind=kind,
            base=base,
            quote=quote,
            raw_symbol=r["instrument"],
        )

        opened_at: datetime = r["opened_at"]
        closed_at: datetime | None = r["closed_at"]
        hold_seconds = 0
        if closed_at is not None:
            hold_seconds = int((closed_at - opened_at).total_seconds())
        else:
            hold_seconds = int((datetime.now(tz=timezone.utc) - opened_at).total_seconds())

        out.append(
            MatcherPosition(
                position_id=r["position_id"],
                user_id=r["user_id"],
                connection_id=r["connection_id"],
                exchange=exchange,
                exchange_kind=ExchangeKind.DEX if r["is_dex"] else ExchangeKind.CEX,
                instrument=instrument,
                side=PositionSide(r["side"]),
                qty_total=Decimal(r["total_qty"]),
                avg_entry_price=Decimal(r["avg_entry_price"]),
                opened_at=opened_at,
                closed_at=closed_at,
                status=PositionStatus(r["status"]),
                funding_pnl_quote=Decimal(r["total_funding_quote"] or 0),
                hold_duration_seconds=hold_seconds,
            )
        )

    return out


def _split_instrument(raw: str) -> tuple[str, str]:
    """Best-effort split of a raw instrument string into base/quote.

    Recognises ``BTC/USDT`` (slash) and ``BTC/USDT:USDT`` (ccxt perp) and
    ``BTCUSDT`` (Bybit-style concat). Falls back to (raw, "UNKNOWN").
    """
    s = raw.split(":")[0]  # strip ccxt settlement suffix
    if "/" in s:
        base, _, quote = s.partition("/")
        return base.upper(), quote.upper()
    for q in ("USDT", "USDC", "USD", "BTC", "ETH", "BNB"):
        if s.endswith(q) and len(s) > len(q):
            return s[: -len(q)].upper(), q.upper()
    return s.upper(), "UNKNOWN"


async def existing_pending_candidate_position_sets(
    conn: psycopg.AsyncConnection,
    user_id: str,
) -> list[frozenset[str]]:
    """Return the set of position-id sets already represented by a pending
    candidate for this user. Used to dedupe before inserting new candidates.

    The candidate stores ``proposed_legs`` as a JSONB array of objects, each
    of which has a ``position_ids`` array. We unfold and frozenset for set
    equality.
    """
    sql = """
        select proposed_legs
          from public.spread_candidates
         where user_id::text = %s
           and state = 'pending'
    """
    async with conn.cursor() as cur:
        await cur.execute(sql, (user_id,))
        rows = await cur.fetchall()

    sets: list[frozenset[str]] = []
    for (legs_json,) in rows:
        # psycopg returns jsonb as the parsed Python object already (dict/list).
        if not isinstance(legs_json, list):
            continue
        pids: list[str] = []
        for leg in legs_json:
            if isinstance(leg, dict):
                ids = leg.get("position_ids") or []
                if isinstance(ids, list):
                    pids.extend(str(x) for x in ids)
        if pids:
            sets.append(frozenset(pids))
    return sets


async def insert_spread_candidate(
    conn: psycopg.AsyncConnection,
    proposal: SpreadProposal,
) -> bool:
    """Insert one matcher proposal as a pending candidate. Returns True on insert.

    Caller commits.
    """
    proposed_legs_json = [
        _proposed_leg_to_json(leg) for leg in proposal.proposed_legs
    ]
    sql = """
        insert into public.spread_candidates (
            user_id,
            suggested_type,
            state,
            match_confidence,
            match_reasons,
            proposed_legs,
            primary_base,
            earliest_fill_at
        ) values (
            %s, %s, 'pending'::candidate_state, %s, %s, %s, %s, %s
        )
        returning id
    """
    async with conn.cursor() as cur:
        await cur.execute(
            sql,
            (
                proposal.user_id,
                proposal.suggested_type.value,
                proposal.match_confidence,
                proposal.match_reasons,
                Json(proposed_legs_json),
                proposal.primary_base,
                proposal.earliest_fill_at,
            ),
        )
        row = await cur.fetchone()
    return row is not None


def _proposed_leg_to_json(leg: ProposedLeg) -> dict[str, Any]:
    return {
        "connection_id": leg.connection_id,
        "instrument": {
            "exchange": leg.instrument.exchange.value,
            "kind": leg.instrument.kind.value,
            "base": leg.instrument.base,
            "quote": leg.instrument.quote,
            "raw_symbol": leg.instrument.raw_symbol,
            "expiry": leg.instrument.expiry.isoformat() if leg.instrument.expiry else None,
        },
        "side": leg.side.value,
        "position_ids": leg.position_ids,
        "qty_total": str(leg.qty_total),
        "avg_entry_price": str(leg.avg_entry_price),
        "opened_at": leg.opened_at.isoformat(),
    }
