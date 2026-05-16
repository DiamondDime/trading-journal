"""Structured-logging setup for the daemon.

Wires stdlib ``logging`` to emit JSON lines and configures ``structlog`` so the
adapter modules (which already use ``structlog.get_logger``) route through the
same handler. No new dependency: ``structlog`` is already in pyproject.toml.

Secrets discipline:
- Never include API keys / secrets / wallet plaintext in log fields.
- Callers MUST mask sensitive values to ``***`` before logging. This module
  does not attempt to redact at the formatter level — that would be theatre.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from datetime import datetime, timezone
from typing import Any

import structlog


class JsonFormatter(logging.Formatter):
    """Minimal JSON line formatter for stdlib ``logging``.

    Emits one JSON object per log record with: ts, level, logger, msg, plus
    any extra fields attached via ``logger.info(..., extra={...})``.
    ``exc_info`` is rendered as a string trace block.
    """

    # Standard LogRecord attributes we never want to copy into the JSON envelope.
    _RESERVED: frozenset[str] = frozenset(
        {
            "name", "msg", "args", "levelname", "levelno", "pathname", "filename",
            "module", "exc_info", "exc_text", "stack_info", "lineno", "funcName",
            "created", "msecs", "relativeCreated", "thread", "threadName",
            "processName", "process", "asctime", "message", "taskName",
        }
    )

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname.lower(),
            "logger": record.name,
            "msg": record.getMessage(),
        }
        # If structlog routed an event through stdlib, the structured fields land
        # in record.__dict__ under whatever keys structlog used. Carry them over,
        # but never let an extras key clobber the envelope reserved keys above —
        # if a caller accidentally passed `msg=...` we'd otherwise lose the
        # actual log message. Renaming is safer than silently dropping.
        envelope_keys = {"ts", "level", "logger", "msg", "exc"}
        for key, value in record.__dict__.items():
            if key in self._RESERVED or key.startswith("_"):
                continue
            out_key = f"extra_{key}" if key in envelope_keys else key
            try:
                json.dumps(value)  # cheap roundtrip — skip non-serializable
                payload[out_key] = value
            except (TypeError, ValueError):
                payload[out_key] = repr(value)
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, separators=(",", ":"), default=str)


def configure_logging(level: str | None = None) -> None:
    """Set up stdlib logging + structlog to emit JSON to stdout.

    Idempotent: calling twice is safe (existing handlers are removed first).
    Reads ``WORKER_LOG_LEVEL`` from env when ``level`` is None (default INFO).
    """
    log_level_name = (level or os.environ.get("WORKER_LOG_LEVEL") or "INFO").upper()
    log_level = getattr(logging, log_level_name, logging.INFO)

    root = logging.getLogger()
    # Clear any handlers a parent process or earlier call attached.
    for handler in list(root.handlers):
        root.removeHandler(handler)

    handler = logging.StreamHandler(stream=sys.stdout)
    handler.setFormatter(JsonFormatter())
    root.addHandler(handler)
    root.setLevel(log_level)

    # Tame noisy third-party loggers.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("ccxt").setLevel(logging.WARNING)

    # Route structlog through stdlib so adapters' structlog.get_logger() ends
    # up in the same JSON stream. Use ``wrap_for_formatter`` so structlog hands
    # the event dict off to the stdlib formatter rather than rendering JSON
    # itself — otherwise we'd emit JSON-inside-JSON. The stdlib JsonFormatter
    # we installed above picks up structlog's event-dict fields as record
    # attributes via add_log_level/add_logger_name + extras.
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.stdlib.add_log_level,
            structlog.stdlib.add_logger_name,
            structlog.processors.TimeStamper(fmt="iso", utc=True, key="ts"),
            structlog.processors.format_exc_info,
            # Convert the event dict into kwargs the stdlib logger picks up
            # via record.__dict__ — JsonFormatter then emits them as JSON.
            structlog.stdlib.render_to_log_kwargs,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(log_level),
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )


def mask_secret(value: str | None, *, keep: int = 4) -> str:
    """Mask a secret for logging. ``None`` becomes ``"none"``; empty becomes
    ``"empty"``. Otherwise returns ``"***<last-N>"``.

    Never emit the full plaintext; this helper exists so log lines that need
    *some* identifying suffix get a safe one.
    """
    if value is None:
        return "none"
    if not value:
        return "empty"
    if len(value) <= keep:
        return "***"
    return "***" + value[-keep:]
