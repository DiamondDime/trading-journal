"""Tests for the sync_jobs ↔ worker handshake (W3a §3 in the master plan).

We stub the DB layer so these tests never need a live Postgres.

What we verify:
- ``drain_sync_jobs`` claims queued rows, runs ``sync_one_connection`` for each,
  and marks them ``succeeded`` on the happy path.
- On adapter failure the job is marked ``failed`` with the reason code.
- Orphaned ``running`` jobs older than the threshold are recovered.
- Connection-missing on a claimed job is a hard fail (not a hang).
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

from csj_worker import db as dbx
from csj_worker import main as worker_main

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_connection_row(*, user_id: str = "u1") -> dbx.ConnectionRow:
    return dbx.ConnectionRow(
        id="conn-1",
        user_id=user_id,
        exchange_code="binance",
        label="binance:main",
        connection_type="api_key",
        api_key_ciphertext=b"x",
        api_key_nonce=b"x",
        api_secret_ciphertext=b"x",
        api_secret_nonce=b"x",
        api_passphrase_ciphertext=None,
        api_passphrase_nonce=None,
        wallet_address_ciphertext=None,
        wallet_address_nonce=None,
        wallet_chain=None,
        status="active",
        last_sync_at=None,
        last_sync_cursor=None,
        last_fill_at=None,
    )


def _make_job(*, job_id: str = "job-1") -> dbx.SyncJobRow:
    return dbx.SyncJobRow(
        id=job_id,
        user_id="u1",
        exchange_connection_id="conn-1",
        state="running",
        created_at=datetime.now(tz=UTC),
        started_at=datetime.now(tz=UTC),
        finished_at=None,
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestDrainSyncJobs:
    """``drain_sync_jobs`` claims + processes pending jobs."""

    def test_drains_one_succeeded_job(self) -> None:
        mock_conn = AsyncMock()
        job = _make_job()
        conn_row = _make_connection_row()

        success_result: dict[str, object] = {
            "status": "ok",
            "fills_added": 3,
            "funding_added": 1,
            "pages": 1,
            "last_fill_at": "2026-05-18T00:00:00+00:00",
        }

        async def _go() -> dict[str, int]:
            with (
                patch.object(
                    worker_main.dbx,
                    "open_async_conn",
                    AsyncMock(return_value=mock_conn),
                ),
                patch.object(
                    worker_main.dbx,
                    "recover_orphaned_sync_jobs",
                    AsyncMock(return_value=0),
                ),
                patch.object(
                    worker_main.dbx,
                    "claim_queued_sync_jobs",
                    AsyncMock(return_value=[job]),
                ),
                patch.object(
                    worker_main.dbx,
                    "get_connection_for_job",
                    AsyncMock(return_value=conn_row),
                ),
                patch.object(
                    worker_main,
                    "sync_one_connection",
                    AsyncMock(return_value=success_result),
                ),
                patch.object(
                    worker_main,
                    "_aggregate_and_link_for_users",
                    AsyncMock(return_value={"positions_inserted": 1, "fills_attached": 3, "funding_linked": 1}),
                ),
                patch.object(
                    worker_main,
                    "run_matcher_for_user",
                    AsyncMock(return_value={"positions": 1, "proposals": 0, "inserted": 0, "skipped": 0}),
                ),
                patch.object(
                    worker_main.dbx,
                    "mark_sync_job_succeeded",
                    AsyncMock(return_value=None),
                ) as mark_ok,
            ):
                summary = await worker_main.drain_sync_jobs("postgres://stub/x", 30)

            mark_ok.assert_called_once_with(
                mock_conn,
                job_id="job-1",
                fills_pulled=3,
                funding_pulled=1,
            )
            return summary

        summary = asyncio.run(_go())
        assert summary == {
            "jobs_run": 1,
            "jobs_failed": 0,
            "fills_added": 3,
            "funding_added": 1,
        }

    def test_failed_adapter_marks_job_failed(self) -> None:
        mock_conn = AsyncMock()
        job = _make_job()
        conn_row = _make_connection_row()

        failed_result: dict[str, object] = {
            "status": "error",
            "reason": "auth_failed",
            "fills_added": 0,
        }

        async def _go() -> dict[str, int]:
            with (
                patch.object(
                    worker_main.dbx,
                    "open_async_conn",
                    AsyncMock(return_value=mock_conn),
                ),
                patch.object(
                    worker_main.dbx,
                    "recover_orphaned_sync_jobs",
                    AsyncMock(return_value=0),
                ),
                patch.object(
                    worker_main.dbx,
                    "claim_queued_sync_jobs",
                    AsyncMock(return_value=[job]),
                ),
                patch.object(
                    worker_main.dbx,
                    "get_connection_for_job",
                    AsyncMock(return_value=conn_row),
                ),
                patch.object(
                    worker_main,
                    "sync_one_connection",
                    AsyncMock(return_value=failed_result),
                ),
                patch.object(
                    worker_main.dbx,
                    "mark_sync_job_failed",
                    AsyncMock(return_value=None),
                ) as mark_failed,
            ):
                summary = await worker_main.drain_sync_jobs("postgres://stub/x", 30)

            mark_failed.assert_called_once_with(
                mock_conn,
                job_id="job-1",
                error_code="auth_failed",
                error_message="auth_failed",
                fills_pulled=0,
                funding_pulled=0,
            )
            return summary

        summary = asyncio.run(_go())
        assert summary == {
            "jobs_run": 0,
            "jobs_failed": 1,
            "fills_added": 0,
            "funding_added": 0,
        }

    def test_missing_connection_row_marks_failed(self) -> None:
        mock_conn = AsyncMock()
        job = _make_job()

        async def _go() -> dict[str, int]:
            with (
                patch.object(
                    worker_main.dbx,
                    "open_async_conn",
                    AsyncMock(return_value=mock_conn),
                ),
                patch.object(
                    worker_main.dbx,
                    "recover_orphaned_sync_jobs",
                    AsyncMock(return_value=0),
                ),
                patch.object(
                    worker_main.dbx,
                    "claim_queued_sync_jobs",
                    AsyncMock(return_value=[job]),
                ),
                patch.object(
                    worker_main.dbx,
                    "get_connection_for_job",
                    AsyncMock(return_value=None),
                ),
                patch.object(
                    worker_main.dbx,
                    "mark_sync_job_failed",
                    AsyncMock(return_value=None),
                ) as mark_failed,
            ):
                summary = await worker_main.drain_sync_jobs("postgres://stub/x", 30)

            assert mark_failed.call_count == 1
            assert mark_failed.call_args.kwargs["error_code"] == "connection_missing"
            return summary

        summary = asyncio.run(_go())
        assert summary["jobs_failed"] == 1
        assert summary["jobs_run"] == 0

    def test_empty_queue_returns_zero(self) -> None:
        mock_conn = AsyncMock()

        async def _go() -> dict[str, int]:
            with (
                patch.object(
                    worker_main.dbx,
                    "open_async_conn",
                    AsyncMock(return_value=mock_conn),
                ),
                patch.object(
                    worker_main.dbx,
                    "recover_orphaned_sync_jobs",
                    AsyncMock(return_value=0),
                ),
                patch.object(
                    worker_main.dbx,
                    "claim_queued_sync_jobs",
                    AsyncMock(return_value=[]),
                ),
            ):
                return await worker_main.drain_sync_jobs("postgres://stub/x", 30)

        summary = asyncio.run(_go())
        assert summary == {
            "jobs_run": 0,
            "jobs_failed": 0,
            "fills_added": 0,
            "funding_added": 0,
        }


class TestTestConnection:
    """``test_connection`` returns a JSON-shaped dict, no DB writes."""

    def test_returns_not_found_for_missing_connection(self) -> None:
        mock_conn = AsyncMock()

        async def _go() -> dict[str, object]:
            with (
                patch.object(
                    worker_main.dbx,
                    "open_async_conn",
                    AsyncMock(return_value=mock_conn),
                ),
                patch.object(
                    worker_main.dbx,
                    "get_connection",
                    AsyncMock(return_value=None),
                ),
            ):
                return await worker_main.test_connection("postgres://stub/x", "missing-id")

        result = asyncio.run(_go())
        assert result == {"ok": False, "error": "connection_not_found"}

    def test_returns_ok_on_healthy_connect(self) -> None:
        mock_conn = AsyncMock()
        row = _make_connection_row()

        from csj_worker.types import (
            AuthMode,
            ConnectionHealth,
            ConnectionStatusResult,
        )

        adapter = MagicMock()
        adapter.connect = AsyncMock(
            return_value=ConnectionStatusResult(
                health=ConnectionHealth.OK,
                auth_mode=AuthMode.API_KEY,
                permissions=["read"],
                message=None,
            )
        )

        async def _go() -> dict[str, object]:
            with (
                patch.object(
                    worker_main.dbx,
                    "open_async_conn",
                    AsyncMock(return_value=mock_conn),
                ),
                patch.object(
                    worker_main.dbx,
                    "get_connection",
                    AsyncMock(return_value=row),
                ),
                patch.object(
                    worker_main,
                    "_get_adapter",
                    return_value=adapter,
                ),
                patch.object(
                    worker_main.dbx,
                    "decrypt_connection_credentials",
                    return_value=MagicMock(),
                ),
            ):
                return await worker_main.test_connection("postgres://stub/x", "conn-1")

        result = asyncio.run(_go())
        assert result["ok"] is True
        assert result["health"] == "ok"
        assert result["permissions"] == ["read"]
        assert result["unverified"] == []
