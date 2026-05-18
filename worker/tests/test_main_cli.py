"""Smoke tests for the worker CLI entry point (``python -m csj_worker.main``).

We exercise the argparse surface + the ``--once`` short-circuit when there
are no active connections. Tests do NOT hit a real database — they either
parse args only or stub the database calls.

Skipped (not implemented):
- A pytest fixture that boots a transient Postgres for the daemon to talk to.
  That belongs in an integration suite; for v1 we cover the SQL helpers'
  contracts indirectly via the Next.js Vitest integration tests, and the
  daemon itself is exercised manually before deploy.
"""

from __future__ import annotations

import asyncio
import os
import sys
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from csj_worker import main as worker_main


def _set_master_key() -> None:
    # Same 32-byte zero key the Vitest setup uses. Deterministic + safe in tests.
    os.environ["CREDENTIALS_MASTER_KEY"] = (
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
    )


class TestRedactUrl:
    """``_redact_url`` masks the password portion of a Postgres URL."""

    def test_redacts_password_when_user_pass_present(self) -> None:
        url = "postgresql://app:supersecret@localhost:5432/db"
        out = worker_main._redact_url(url)
        assert "supersecret" not in out
        assert out.startswith("postgresql://app:")
        # Last 4 chars survive the mask -- they're a non-secret hint.
        assert "@localhost" in out

    def test_passes_through_user_only_urls_unchanged(self) -> None:
        url = "postgresql://app@localhost:5432/db"
        assert worker_main._redact_url(url) == url

    def test_handles_url_without_at_sign(self) -> None:
        url = "weird-non-url"
        assert worker_main._redact_url(url) == url

    def test_handles_completely_malformed_input(self) -> None:
        # The function wraps everything in try/except and returns a sentinel.
        out = worker_main._redact_url("\x00\x01\x02not a url")
        assert isinstance(out, str)


class TestEnvInt:
    def test_returns_default_when_var_missing(self) -> None:
        os.environ.pop("CSJ_TEST_INT_X", None)
        assert worker_main._env_int("CSJ_TEST_INT_X", 42) == 42

    def test_returns_int_when_var_parseable(self) -> None:
        os.environ["CSJ_TEST_INT_X"] = "7"
        try:
            assert worker_main._env_int("CSJ_TEST_INT_X", 42) == 7
        finally:
            os.environ.pop("CSJ_TEST_INT_X", None)

    def test_returns_default_on_unparseable(self) -> None:
        os.environ["CSJ_TEST_INT_X"] = "not-an-int"
        try:
            assert worker_main._env_int("CSJ_TEST_INT_X", 42) == 42
        finally:
            os.environ.pop("CSJ_TEST_INT_X", None)


class TestGetAdapter:
    """Adapter registry returns the universal adapter for v1 exchanges.

    Post-Wave-12B: CEX adapters all funnel through ``CcxtUniversalAdapter``
    driven by per-venue ``VenueConfig``. Hyperliquid stays bespoke (no ccxt
    coverage). Legacy hand-built adapters are still reachable via the
    ``CSJ_USE_LEGACY_ADAPTER_<CODE>=1`` env-var escape hatch.
    """

    def test_returns_universal_adapter_for_binance(self) -> None:
        adapter = worker_main._get_adapter("binance")
        assert adapter is not None
        assert adapter.__class__.__name__ == "CcxtUniversalAdapter"
        assert adapter.config.code == "binance"

    def test_returns_universal_adapter_for_bybit(self) -> None:
        adapter = worker_main._get_adapter("bybit")
        assert adapter is not None
        assert adapter.__class__.__name__ == "CcxtUniversalAdapter"
        assert adapter.config.code == "bybit"

    def test_returns_hyperliquid_adapter(self) -> None:
        adapter = worker_main._get_adapter("hyperliquid")
        assert adapter is not None
        assert adapter.__class__.__name__ == "HyperliquidAdapter"

    def test_returns_universal_adapter_for_all_v12b_exchanges(self) -> None:
        # All 10 v1 CEX exchanges should resolve to the universal adapter.
        for code in (
            "binance",
            "bybit",
            "bingx",
            "gate",
            "mexc",
            "kucoin",
            "bitget",
            "htx",
            "okx",
            "phemex",
        ):
            adapter = worker_main._get_adapter(code)
            assert adapter is not None, code
            assert adapter.__class__.__name__ == "CcxtUniversalAdapter", code
            assert adapter.config.code == code

    def test_returns_none_for_unimplemented(self) -> None:
        assert worker_main._get_adapter("aster") is None
        assert worker_main._get_adapter("nonexistent") is None

    def test_is_case_insensitive(self) -> None:
        assert worker_main._get_adapter("BINANCE") is not None
        assert worker_main._get_adapter("Bybit") is not None

    def test_legacy_override_env_var_returns_legacy_adapter(self) -> None:
        # CSJ_USE_LEGACY_ADAPTER_BINANCE=1 returns the legacy hand-built
        # BinanceAdapter instead of CcxtUniversalAdapter.
        os.environ["CSJ_USE_LEGACY_ADAPTER_BINANCE"] = "1"
        try:
            adapter = worker_main._get_adapter("binance")
            assert adapter is not None
            assert adapter.__class__.__name__ == "BinanceAdapter"
        finally:
            os.environ.pop("CSJ_USE_LEGACY_ADAPTER_BINANCE", None)

    def test_legacy_override_env_var_for_bybit(self) -> None:
        os.environ["CSJ_USE_LEGACY_ADAPTER_BYBIT"] = "1"
        try:
            adapter = worker_main._get_adapter("bybit")
            assert adapter is not None
            assert adapter.__class__.__name__ == "BybitAdapter"
        finally:
            os.environ.pop("CSJ_USE_LEGACY_ADAPTER_BYBIT", None)


class TestArgumentParser:
    """The CLI parses --once, --lookback-days, and subcommands cleanly."""

    def test_no_args_defaults_to_daemon_mode(self) -> None:
        parser = worker_main._build_parser()
        args = parser.parse_args([])
        assert args.once is False
        assert args.cmd is None

    def test_once_flag_sets_once_true(self) -> None:
        parser = worker_main._build_parser()
        args = parser.parse_args(["--once"])
        assert args.once is True

    def test_sync_subcommand_requires_connection_id(self) -> None:
        parser = worker_main._build_parser()
        with pytest.raises(SystemExit):
            parser.parse_args(["sync"])

    def test_sync_subcommand_with_connection_id(self) -> None:
        parser = worker_main._build_parser()
        args = parser.parse_args(["sync", "--connection-id", "abc-123"])
        assert args.cmd == "sync"
        assert args.connection_id == "abc-123"

    def test_match_subcommand_parses(self) -> None:
        parser = worker_main._build_parser()
        args = parser.parse_args(["match"])
        assert args.cmd == "match"

    def test_lookback_days_override(self) -> None:
        parser = worker_main._build_parser()
        args = parser.parse_args(["--lookback-days", "90", "--once"])
        assert args.lookback_days == 90


class TestRunOnceNoConnections:
    """``--once`` exits 0 when there are no syncable connections.

    We stub the DB layer so this test doesn't need a Postgres instance.
    """

    def test_run_once_returns_empty_summary_when_no_connections(self) -> None:
        _set_master_key()
        # Mock the DB helpers so we never need a live Postgres connection.
        mock_conn = AsyncMock()

        async def _go() -> dict[str, Any]:
            with (
                patch.object(worker_main.dbx, "open_async_conn", AsyncMock(return_value=mock_conn)),
                patch.object(worker_main.dbx, "recover_orphaned_syncing", AsyncMock(return_value=0)),
                patch.object(worker_main.dbx, "list_syncable_connections", AsyncMock(return_value=[])),
                patch.object(worker_main, "run_matcher_for_all_users", AsyncMock(return_value=None)),
            ):
                return await worker_main.run_once("postgres://stub/x", 30)

        result = asyncio.run(_go())
        # Empty-cycle summary shape includes funding + position counters as
        # of W3a — the aggregator and funding-events ingestion ride on the
        # same cycle as fill ingestion.
        assert result == {
            "connections_synced": 0,
            "fills_added": 0,
            "funding_added": 0,
            "positions_inserted": 0,
        }
        mock_conn.close.assert_called_once()
