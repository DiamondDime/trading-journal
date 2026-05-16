# syntax=docker/dockerfile:1.7

FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_SYSTEM_PYTHON=1 \
    UV_LINK_MODE=copy

# uv via the official installer image
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

# Layer-cache deps
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project

# App code
COPY . .
RUN uv sync --frozen

RUN useradd --create-home --uid 10001 app \
    && chown -R app:app /app
USER app

CMD ["uv", "run", "python", "-m", "csj_worker.main"]
