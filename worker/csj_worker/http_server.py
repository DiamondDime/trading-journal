"""Worker HTTP server — minimal surface for the Next.js API to call.

Currently exposes a single endpoint, ``POST /test-connection``, which runs
the adapter's ``connect()`` synchronously and returns the result as JSON.
Used by ``POST /api/exchanges`` in Next.js for the eager connect-time
validation (audit finding §5).

Authentication
==============
The endpoint is protected by a shared bearer secret. The Next.js handler
reads ``WORKER_HTTP_SECRET`` from the same env, the worker reads the same.
The endpoint is intended to bind to ``127.0.0.1`` (loopback) when the
worker + Next.js run on the same host; for split deployments use an SSH
tunnel or a private network. Never expose this port publicly without TLS.

Why FastAPI here
================
FastAPI is already a dependency (see ``pyproject.toml``), gives us
declarative request validation, and runs on uvicorn — same posture as
the other Python services in the project. We don't have many endpoints;
keeping this thin is intentional.
"""

from __future__ import annotations

import logging
import os
from typing import Any

import psycopg
import uvicorn
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from csj_worker import db as dbx  # noqa: F401 — re-exported for symmetry
from csj_worker import main as worker_main

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------


class TestConnectionRequest(BaseModel):
    """Body for ``POST /test-connection``."""

    connection_id: str = Field(min_length=1, max_length=64)


class TestConnectionResponse(BaseModel):
    """Result of running ``adapter.connect()`` against a connection's
    decrypted credentials."""

    ok: bool
    health: str | None = None
    permissions: list[str] = Field(default_factory=list)
    unverified: list[str] = Field(default_factory=list)
    message: str | None = None
    error: str | None = None


class RefreshBalancesRequest(BaseModel):
    """Body for ``POST /refresh-balances``."""

    user_id: str = Field(min_length=1, max_length=64)


class RefreshBalancesResponse(BaseModel):
    """Summary the UI surfaces after manual refresh.

    All counters are best-effort: a failed connection still counts towards
    ``errors`` so the user sees "12/13 exchanges refreshed" if one's down.
    """

    ok: bool
    connections: int = 0
    upserted: int = 0
    reaped: int = 0
    snapshots: int = 0
    errors: int = 0
    message: str | None = None


# ---------------------------------------------------------------------------
# Auth — bearer secret
# ---------------------------------------------------------------------------


def _expected_secret() -> str:
    secret = os.environ.get("WORKER_HTTP_SECRET")
    if not secret:
        raise RuntimeError(
            "WORKER_HTTP_SECRET env var is required for the worker HTTP server"
        )
    return secret


def _require_bearer(
    authorization: str | None = Header(default=None),
) -> None:
    """Reject any request without the matching ``Authorization: Bearer …``.

    Constant-time comparison via ``secrets.compare_digest`` to defeat
    timing oracles. The endpoint is loopback-only in production but
    treat all auth as adversarial.
    """
    import secrets as _secrets

    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    presented = authorization.split(" ", 1)[1].strip()
    if not _secrets.compare_digest(presented, _expected_secret()):
        raise HTTPException(status_code=401, detail="Invalid bearer token")


# ---------------------------------------------------------------------------
# App factory — parameterized by database URL so tests can inject
# ---------------------------------------------------------------------------


def build_app(database_url: str) -> FastAPI:
    """Create the FastAPI app. Pure factory — no global state."""
    app = FastAPI(title="csj-worker", version="0.1.0")

    @app.get("/healthz")
    async def healthz() -> dict[str, Any]:
        # Quick DB ping — returns 200 even if DB is down so callers can
        # distinguish process-up from DB-up via the body.
        info: dict[str, Any] = {"process": "ok"}
        try:
            conn = await psycopg.AsyncConnection.connect(database_url, autocommit=True)
            try:
                async with conn.cursor() as cur:
                    await cur.execute("select 1")
                    await cur.fetchone()
                info["db"] = "ok"
            finally:
                await conn.close()
        except Exception as exc:
            info["db"] = f"error: {type(exc).__name__}"
        return info

    @app.post(
        "/test-connection",
        response_model=TestConnectionResponse,
        dependencies=[Depends(_require_bearer)],
    )
    async def test_connection(req: TestConnectionRequest) -> TestConnectionResponse:
        result = await worker_main.test_connection(database_url, req.connection_id)
        return TestConnectionResponse(**result)  # type: ignore[arg-type]

    @app.post(
        "/refresh-balances",
        response_model=RefreshBalancesResponse,
        dependencies=[Depends(_require_bearer)],
    )
    async def refresh_balances(req: RefreshBalancesRequest) -> RefreshBalancesResponse:
        """Re-fetch every connection's balances for the user, snapshot the result.

        The Next.js POST /api/balances/refresh handler calls this; it's the
        plumbing behind the "Refresh" button on the balances dashboard. The
        endpoint is synchronous — the user sees the spinner until the worker
        finishes (typically <10s for a handful of exchanges).
        """
        try:
            summary = await worker_main.run_balance_refresh(
                database_url, user_id=req.user_id
            )
            return RefreshBalancesResponse(
                ok=summary.get("errors", 0) == 0,
                connections=summary.get("connections", 0),
                upserted=summary.get("upserted", 0),
                reaped=summary.get("reaped", 0),
                snapshots=summary.get("snapshots", 0),
                errors=summary.get("errors", 0),
            )
        except Exception as exc:
            log.exception("http.refresh_balances.failed")
            return RefreshBalancesResponse(
                ok=False,
                message=f"{type(exc).__name__}: {exc}"[:500],
            )

    return app


async def run(
    database_url: str,
    *,
    host: str = "127.0.0.1",
    port: int = 7430,
) -> None:
    """Run the worker HTTP server. Blocks until shutdown."""
    log.info("http_server.start", extra={"host": host, "port": port})
    # Validate secret at startup — fail fast if missing.
    _expected_secret()
    app = build_app(database_url)
    config = uvicorn.Config(
        app,
        host=host,
        port=port,
        log_config=None,  # we configure logging at the worker level
    )
    server = uvicorn.Server(config)
    await server.serve()
