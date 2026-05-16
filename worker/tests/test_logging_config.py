"""Smoke tests for JsonFormatter + mask_secret.

These don't exercise the database path — they only verify the log line shape
and the masking helper, which are the load-bearing pieces for "never leak
credentials in logs".
"""

from __future__ import annotations

import io
import json
import logging

from csj_worker.logging_config import JsonFormatter, mask_secret


def test_json_formatter_emits_envelope() -> None:
    fmt = JsonFormatter()
    record = logging.LogRecord(
        name="x",
        level=logging.INFO,
        pathname="x.py",
        lineno=1,
        msg="hello",
        args=(),
        exc_info=None,
    )
    out = json.loads(fmt.format(record))
    assert out["msg"] == "hello"
    assert out["level"] == "info"
    assert out["logger"] == "x"
    assert "ts" in out


def test_json_formatter_extras_pass_through() -> None:
    fmt = JsonFormatter()
    handler = logging.StreamHandler(stream=io.StringIO())
    handler.setFormatter(fmt)
    logger = logging.getLogger("test_extras_pass_through")
    logger.handlers.clear()
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)

    logger.info("evt", extra={"connection_id": "abc", "count": 5})
    out_line = handler.stream.getvalue().strip()
    out = json.loads(out_line)
    assert out["connection_id"] == "abc"
    assert out["count"] == 5


def test_json_formatter_renames_collisions() -> None:
    """If an extras key would clobber the envelope (ts/msg/...), rename it.

    The envelope's ``msg`` is the log message itself — never let an extras key
    silently overwrite it.
    """
    fmt = JsonFormatter()
    handler = logging.StreamHandler(stream=io.StringIO())
    handler.setFormatter(fmt)
    logger = logging.getLogger("test_collision_rename")
    logger.handlers.clear()
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)

    # Use a non-reserved attribute name (stdlib logging blocks 'msg' in
    # extras altogether), but our formatter must also guard against
    # structlog-style keys that hit the envelope shape.
    record = logging.LogRecord(
        name="x",
        level=logging.INFO,
        pathname="x.py",
        lineno=1,
        msg="real-message",
        args=(),
        exc_info=None,
    )
    record.ts = "should-not-clobber"
    record.level = "should-not-clobber"
    line = fmt.format(record)
    out = json.loads(line)
    assert out["msg"] == "real-message"
    # Renamed copies appear:
    assert out["extra_ts"] == "should-not-clobber"
    assert out["extra_level"] == "should-not-clobber"


def test_mask_secret_none() -> None:
    assert mask_secret(None) == "none"


def test_mask_secret_empty() -> None:
    assert mask_secret("") == "empty"


def test_mask_secret_short() -> None:
    assert mask_secret("abc") == "***"


def test_mask_secret_long() -> None:
    assert mask_secret("0123456789abcdef") == "***cdef"
