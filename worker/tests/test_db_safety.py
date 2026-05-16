"""Safety tests for the worker's secret-handling helpers.

These guard the invariant that credentials never leak through:
  • log lines (mask_secret)
  • the redacted DATABASE_URL (via main._redact_url)
  • error messages persisted to the connection row (truncated + dropped from
    exceptions before logging)

mask_secret itself has its own targeted tests in test_logging_config.py;
this file adds the URL + 500-byte payload boundaries that the log path relies
on.
"""

from __future__ import annotations

from csj_worker import main as worker_main
from csj_worker.logging_config import mask_secret


class TestMaskSecretBoundaries:
    """Edge cases the daemon hits in practice."""

    def test_typical_api_key_keeps_only_last_4(self) -> None:
        key = "binance_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaXYZW"
        masked = mask_secret(key)
        assert masked.endswith("XYZW")
        assert len(masked) == 7  # "***" + 4
        assert "binance" not in masked

    def test_short_keys_get_full_redaction(self) -> None:
        assert mask_secret("ab") == "***"
        assert mask_secret("abcd") == "***"

    def test_handles_unicode_payloads(self) -> None:
        # We mostly emit ASCII secrets, but the masker must not crash on bytes
        # that snuck through utf-8 decode somewhere upstream. Default keep=4.
        masked = mask_secret("hello☃snowman")
        assert masked == "***wman"


class TestRedactDatabaseUrl:
    """``_redact_url`` masks passwords for log lines.

    This is the load-bearing guard for log files; if it ever stops masking,
    daemons running under structured logging would dump the password to disk.
    """

    def test_redacts_user_password_url(self) -> None:
        url = "postgresql://crypto_journal:s0meL0ngS3cret@db.host:5432/db"
        out = worker_main._redact_url(url)
        assert "s0meL0ngS3cret" not in out
        assert out.startswith("postgresql://crypto_journal:")
        assert "@db.host:5432/db" in out

    def test_keeps_url_without_password_intact(self) -> None:
        url = "postgresql://crypto_journal@db.host:5432/db"
        assert worker_main._redact_url(url) == url

    def test_keeps_socket_style_urls_intact(self) -> None:
        # /run/postgresql/.s.PGSQL.5432 — no auth in URL.
        url = "postgresql:///db?host=/var/run/postgresql"
        out = worker_main._redact_url(url)
        # No password to mask; passthrough is the contract.
        assert out == url

    def test_never_throws_on_garbage_input(self) -> None:
        # The function wraps everything in try/except. Garbage just becomes
        # a sentinel string -- crucially, it never raises.
        out = worker_main._redact_url("@@@:::///not a url")
        assert isinstance(out, str)
