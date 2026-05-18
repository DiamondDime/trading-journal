"""Unit tests for ``csj_worker.balances`` and ``csj_worker.prices``.

Same pattern as ``test_db_helpers``: no live Postgres, exercise the SQL
through AsyncMock cursors and assert call shapes + parameter ordering.
For pure helpers (drift math, stable detection, price midpoints) we test
the functions directly.

Coverage map (5 new test classes):

1. TestStablecoinDetection
   - is_stable() canonical set + case insensitivity
2. TestPriceMidpoint
   - _midpoint preference order (last → close → bid/ask → average)
   - zero / missing values get skipped
3. TestUpsertBalance
   - The SQL has the right shape and binds parameters in the right order.
   - source='manual' rows are preserved (the ON CONFLICT WHERE clause).
4. TestReap
   - Empty keep-set deletes everything but manual rows.
   - Non-empty keep-set deletes only rows OUTSIDE the set.
5. TestDriftMath
   - Reported - expected per asset, BUY positive / SELL negative.
   - No fills → empty dict (drift undefined).

The integration of fetch+price+persist is exercised end-to-end in the
sync-jobs test in a follow-up task; this file focuses on the unit-level
contracts.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock

from csj_worker import balances as balx
from csj_worker import prices as prc
from csj_worker.types import CanonicalBalance, WalletType

# ---------------------------------------------------------------------------
# Cursor / connection mocks (mirrored from test_db_helpers)
# ---------------------------------------------------------------------------


def _mock_async_cursor(rowcount: int = 1, fetched: list | None = None) -> MagicMock:
    cur = MagicMock()
    cur.execute = AsyncMock(return_value=None)
    cur.rowcount = rowcount
    cur.fetchall = AsyncMock(return_value=fetched or [])
    cur.fetchone = AsyncMock(return_value=(fetched or [None])[0] if fetched else None)

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
    conn.commit = AsyncMock(return_value=None)
    conn.rollback = AsyncMock(return_value=None)
    return conn


# ---------------------------------------------------------------------------
# 1. Stablecoin detection
# ---------------------------------------------------------------------------


class TestStablecoinDetection:
    def test_canonical_stables(self) -> None:
        for s in ("USDT", "USDC", "BUSD", "DAI", "FDUSD", "TUSD", "USDP", "USD"):
            assert prc.is_stable(s), f"{s} should be stable"

    def test_case_insensitive(self) -> None:
        assert prc.is_stable("usdt")
        assert prc.is_stable("Usdc")
        assert prc.is_stable("DAI")

    def test_non_stables(self) -> None:
        for s in ("BTC", "ETH", "SOL", "XRP", "WBTC"):
            assert not prc.is_stable(s), f"{s} should NOT be stable"


# ---------------------------------------------------------------------------
# 2. Price midpoint
# ---------------------------------------------------------------------------


class TestPriceMidpoint:
    def test_prefers_last(self) -> None:
        p = prc._midpoint({"last": "100", "close": "200"})
        assert p == Decimal("100")

    def test_falls_back_to_close(self) -> None:
        p = prc._midpoint({"last": None, "close": "200"})
        assert p == Decimal("200")

    def test_falls_back_to_midpoint_of_bid_ask(self) -> None:
        p = prc._midpoint({"last": None, "close": None, "bid": "100", "ask": "102"})
        assert p == Decimal("101")

    def test_average_last_resort(self) -> None:
        p = prc._midpoint({"last": None, "close": None, "average": "99"})
        assert p == Decimal("99")

    def test_zero_skipped(self) -> None:
        # Zero values are skipped; nothing usable left → None.
        p = prc._midpoint({"last": "0", "close": "0", "bid": None, "ask": None})
        assert p is None

    def test_completely_empty_dict_returns_none(self) -> None:
        assert prc._midpoint({}) is None


# ---------------------------------------------------------------------------
# 3. Upsert balance — SQL shape + ON CONFLICT preservation
# ---------------------------------------------------------------------------


_NOW = datetime(2026, 5, 18, 12, 0, 0, tzinfo=UTC)


def _balance(
    *,
    asset: str = "BTC",
    wallet_type: WalletType = WalletType.SPOT,
    chain: str | None = None,
    total: str = "1.5",
    available: str = "1.0",
    locked: str = "0.5",
    borrowed: str = "0",
) -> CanonicalBalance:
    return CanonicalBalance(
        exchange_connection_id="c",
        wallet_type=wallet_type,
        asset=asset,
        chain=chain,
        total=Decimal(total),
        available=Decimal(available),
        locked=Decimal(locked),
        borrowed=Decimal(borrowed),
        snapshot_at=_NOW,
    )


class TestUpsertBalance:
    def test_sql_shape_and_param_order(self) -> None:
        cur = _mock_async_cursor()
        conn = _mock_async_conn(cur)
        bal = _balance()

        asyncio.run(
            balx._upsert_balance(
                conn,
                user_id="u",
                connection_id="c",
                balance=bal,
                usd_price=Decimal("90000"),
                usd_value=Decimal("135000"),
                snapshot_at=_NOW,
            )
        )

        # Verify the INSERT was executed once.
        assert cur.execute.await_count == 1
        sql, params = cur.execute.await_args.args
        assert "insert into public.exchange_balances" in sql
        assert "on conflict (exchange_connection_id, wallet_type, asset, chain)" in sql
        # Parameter order must match the columns named in the SQL.
        # user_id, connection_id, wallet_type, asset, chain, total, available,
        # locked, borrowed, usd_price, usd_value, snapshot_at
        assert params[0] == "u"
        assert params[1] == "c"
        assert params[2] == WalletType.SPOT.value
        assert params[3] == "BTC"
        assert params[4] is None  # chain
        assert params[5] == Decimal("1.5")
        assert params[6] == Decimal("1.0")
        assert params[7] == Decimal("0.5")
        assert params[8] == Decimal("0")
        assert params[9] == Decimal("90000")
        assert params[10] == Decimal("135000")
        assert params[11] == _NOW

    def test_on_conflict_preserves_manual_rows(self) -> None:
        cur = _mock_async_cursor()
        conn = _mock_async_conn(cur)
        bal = _balance()

        asyncio.run(
            balx._upsert_balance(
                conn,
                user_id="u",
                connection_id="c",
                balance=bal,
                usd_price=None,
                usd_value=None,
                snapshot_at=_NOW,
            )
        )

        sql, _ = cur.execute.await_args.args
        # The "where source <> 'manual'" guard is what keeps user-edited rows
        # from being overwritten on the next sync.
        assert "where public.exchange_balances.source <> 'manual'" in sql


# ---------------------------------------------------------------------------
# 4. Reap stale rows
# ---------------------------------------------------------------------------


class TestReap:
    def test_empty_keep_set_deletes_all_non_manual_rows(self) -> None:
        cur = _mock_async_cursor(rowcount=3)
        conn = _mock_async_conn(cur)
        deleted = asyncio.run(
            balx._reap_missing_balances(
                conn,
                connection_id="c",
                keep_keys=set(),
            )
        )
        assert deleted == 3
        sql, params = cur.execute.await_args.args
        assert "delete from public.exchange_balances" in sql
        assert "source <> 'manual'" in sql
        assert params == ("c",)

    def test_non_empty_keep_set_filters_out_kept_tuples(self) -> None:
        cur = _mock_async_cursor(rowcount=2)
        conn = _mock_async_conn(cur)
        keep = {
            ("spot", "BTC", ""),
            ("spot", "ETH", ""),
            ("futures", "USDT", ""),
        }
        deleted = asyncio.run(
            balx._reap_missing_balances(
                conn,
                connection_id="c",
                keep_keys=keep,
            )
        )
        assert deleted == 2

        sql, params = cur.execute.await_args.args
        assert "not in" in sql
        # First param is connection_id, then 3 keep tuples × 3 fields = 9.
        assert len(params) == 1 + 3 * 3
        assert params[0] == "c"


# ---------------------------------------------------------------------------
# 5. Drift math — reported vs fills
# ---------------------------------------------------------------------------


class TestDriftMath:
    def test_reported_minus_expected_per_asset(self) -> None:
        # Reported: BTC=1.5, ETH=10 (sum across exchanges).
        # Fills: BTC bought 1.0, sold 0.4 (net 0.6); ETH bought 8.0 (net 8.0).
        # Drift: BTC = 1.5 - 0.6 = +0.9; ETH = 10 - 8 = +2.0.
        reported_rows = [
            ("BTC", Decimal("1.5")),
            ("ETH", Decimal("10")),
        ]
        fill_rows = [
            ("BTC/USDT", "buy",  Decimal("1.0")),
            ("BTC/USDT", "sell", Decimal("0.4")),
            ("ETH/USDT", "buy",  Decimal("8.0")),
        ]
        # Two distinct cursors: first SELECT returns reported_rows, second
        # returns fill_rows. We build a stateful side_effect over fetchall.
        cur = MagicMock()
        cur.execute = AsyncMock(return_value=None)
        fetched_sequence = [reported_rows, fill_rows]
        call_index = {"n": 0}

        async def fetchall() -> list:
            i = call_index["n"]
            call_index["n"] += 1
            return fetched_sequence[i] if i < len(fetched_sequence) else []

        cur.fetchall = AsyncMock(side_effect=fetchall)

        async def _aenter() -> MagicMock:
            return cur

        async def _aexit(*args: object) -> None:
            return None

        cur.__aenter__ = AsyncMock(side_effect=_aenter)
        cur.__aexit__ = AsyncMock(side_effect=_aexit)

        conn = MagicMock()
        conn.cursor = MagicMock(return_value=cur)

        drift = asyncio.run(balx._compute_drift_per_asset(conn, user_id="u"))
        assert drift["BTC"] == Decimal("0.9")
        assert drift["ETH"] == Decimal("2.0")

    def test_no_fills_returns_empty(self) -> None:
        cur = MagicMock()
        cur.execute = AsyncMock(return_value=None)
        fetched_sequence: list[list] = [
            [("BTC", Decimal("1.0"))],
            [],  # no fills
        ]
        call_index = {"n": 0}

        async def fetchall() -> list:
            i = call_index["n"]
            call_index["n"] += 1
            return fetched_sequence[i] if i < len(fetched_sequence) else []

        cur.fetchall = AsyncMock(side_effect=fetchall)

        async def _aenter() -> MagicMock:
            return cur

        async def _aexit(*args: object) -> None:
            return None

        cur.__aenter__ = AsyncMock(side_effect=_aenter)
        cur.__aexit__ = AsyncMock(side_effect=_aexit)

        conn = MagicMock()
        conn.cursor = MagicMock(return_value=cur)

        drift = asyncio.run(balx._compute_drift_per_asset(conn, user_id="u"))
        assert drift == {}


# ---------------------------------------------------------------------------
# 6. Price-resolve fallback path — stables don't hit network
# ---------------------------------------------------------------------------


class TestPriceResolveStableShortCircuit:
    def test_stables_resolve_to_one_dollar_no_adapter_call(self) -> None:
        prc.clear_cache()
        # adapter exposes _build_client; ensure we don't call it for stables.
        adapter = MagicMock()
        adapter._build_client = MagicMock(side_effect=AssertionError(
            "should not be called for stable-only set"
        ))

        result = asyncio.run(
            prc.resolve_usd_prices(adapter, {"USDT", "USDC", "DAI"})
        )
        assert result == {
            "USDT": Decimal("1"),
            "USDC": Decimal("1"),
            "DAI": Decimal("1"),
        }
        # Adapter wasn't built — we short-circuited.
        adapter._build_client.assert_not_called()
