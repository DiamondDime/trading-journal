"""Shared pytest configuration for csj-worker tests."""
import pytest


# pytest-asyncio >= 0.23 requires explicit mode declaration.
# pyproject.toml sets asyncio_mode = "auto" globally.
