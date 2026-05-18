"""Tests for the new ``db.py`` helpers (W3a §2 + §3).

We don't have a live Postgres in unit tests; the helpers are exercised
against an ``AsyncMock`` cursor whose ``execute`` recordings we inspect.
This catches:
- SQL shape changes that would break the on-prod schema
- Parameter ordering bugs (e.g. swapping user_id and connection_id)
- ON CONFLICT clauses being silently removed

End-to-end behaviour (real inserts that survive triggers) is covered by
the worker's integration suite — out of scope for this file.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock

from csj_worker import db as dbx
from csj_worker.types import (
    CanonicalFundingEvent,
    CanonicalInstrument,
    Exchange,
    FundingDirection,
    InstrumentKind,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_funding_event(
    *,
    direction: FundingDirection = FundingDirection.RECEIVED,
    amount: str = "10",
    external_id: str | None = "fe-1",
) -> CanonicalFundingEvent:
    return CanonicalFundingEvent(
        instrument=CanonicalInstrument(
            exchange=Exchange.BINANCE,
            kind=InstrumentKind.PERP,
            base="BTC",
            quote="USDT",
            raw_symbol="BTC/USDT:USDT",
        ),
        direction=direction,
        funding_rate=Decimal("0.0001"),
        position_qty=Decimal("1"),
        amount=Decimal(amount),
        amount_currency="USDT",
        occurred_at=datetime(2026, 5, 18, 12, 0, 0, tzinfo=UTC),
        external_id=external_id,
        raw={"source": "test"},
    )


def _mock_async_cursor(rowcount: int = 1) -> MagicMock:
    """Build a MagicMock that mimics psycopg's async cursor + ctx-manager."""
    cur = MagicMock()
    cur.execute = AsyncMock(return_value=None)
    cur.rowcount = rowcount

    async def _aenter() -> MagicMock:
        return cur

    async def _aexit(*args: object) -> None:
        return None

    cur.__aenter__ = AsyncMock(side_effect=_aenter)
    cur.__aexit__ = AsyncMock(side_effect=_aexit)
    return cur


def _mock_async_conn(cur: MagicMock) -> MagicMock:
    conn = MagicMock()
    conn.cursor = MagicMock(return_value=cur)
    return conn


# ---------------------------------------------------------------------------
# insert_funding_events
# ---------------------------------------------------------------------------


class TestInsertFundingEvents:
    def test_signs_amount_by_direction(self) -> None:
        cur = _mock_async_cursor(rowcount=1)
        conn = _mock_async_conn(cur)
        event = _make_funding_event(direction=FundingDirection.PAID, amount="5")

        inserted = asyncio.run(
            dbx.insert_funding_events(
                conn,
                user_id="u",
                exchange_connection_id="c",
                events=[event],
            )
        )

        assert inserted == 1
        assert cur.execute.call_count == 1
        sql, params = cur.execute.call_args.args
        assert "insert into public.funding_events" in sql
        assert "on conflict" in sql
        # Signed amount: PAID → negative.
        assert params[4] == -Decimal("5")
        # External id passes through.
        assert params[2] == "fe-1"

    def test_synthesizes_external_id_when_missing(self) -> None:
        cur = _mock_async_cursor(rowcount=1)
        conn = _mock_async_conn(cur)
        event = _make_funding_event(external_id=None)

        asyncio.run(
            dbx.insert_funding_events(
                conn,
                user_id="u",
                exchange_connection_id="c",
                events=[event],
            )
        )

        _sql, params = cur.execute.call_args.args
        # Synthesized id: '<raw_symbol>-<ms_epoch>'
        ms_epoch = int(event.occurred_at.timestamp() * 1000)
        assert params[2] == f"{event.instrument.raw_symbol}-{ms_epoch}"

    def test_empty_list_short_circuits(self) -> None:
        cur = _mock_async_cursor()
        conn = _mock_async_conn(cur)

        inserted = asyncio.run(
            dbx.insert_funding_events(
                conn,
                user_id="u",
                exchange_connection_id="c",
                events=[],
            )
        )

        assert inserted == 0
        # No SQL emitted on empty input.
        assert cur.execute.call_count == 0


# ---------------------------------------------------------------------------
# claim_queued_sync_jobs / mark_*
# ---------------------------------------------------------------------------


class TestSyncJobsHelpers:
    def test_mark_sync_job_succeeded_emits_update(self) -> None:
        cur = _mock_async_cursor()
        conn = _mock_async_conn(cur)

        asyncio.run(
            dbx.mark_sync_job_succeeded(
                conn,
                job_id="job-1",
                fills_pulled=7,
                funding_pulled=2,
            )
        )

        assert cur.execute.call_count == 1
        sql, params = cur.execute.call_args.args
        assert "update public.sync_jobs" in sql
        assert "succeeded" in sql
        assert params == (7, 2, "job-1")

    def test_mark_sync_job_failed_truncates_message(self) -> None:
        cur = _mock_async_cursor()
        conn = _mock_async_conn(cur)

        long_msg = "x" * 2000

        asyncio.run(
            dbx.mark_sync_job_failed(
                conn,
                job_id="job-1",
                error_code="auth_failed",
                error_message=long_msg,
            )
        )

        _sql, params = cur.execute.call_args.args
        # Truncated to 1KB.
        assert isinstance(params[1], str)
        assert len(params[1]) == 1000
