"""Shared fixtures: a TestClient bound to a fresh, tenant-isolated store per test.

Sets ``AGENT_DB_PATH`` to a writable temp file at import time — BEFORE any test module imports
``app.main`` (which constructs the module-level store). Without this, importing the app would try the
production default ``/data/agent.db`` and fail on a dev/CI host where ``/data`` is not writable.

Auth: the ``/agent/*`` handlers now require a Keycloak bearer token (``app.deps.require_tenant``).
Each fixture monkeypatches ``app.deps._jwks`` to the in-process :data:`TEST_JWKS`, so tokens minted by
``tests._authkit`` verify without a live Keycloak. The default ``client`` also carries a
``demo-tenant`` token so tests that don't care about the tenant work unchanged; tenant-specific tests
pass ``headers=auth("<tenant>")`` per request.
"""

from __future__ import annotations

import os
import tempfile

# Runs when conftest is first imported — ahead of test-module collection.
os.environ.setdefault("AGENT_DB_PATH", os.path.join(tempfile.mkdtemp(prefix="agentdb-"), "agent.db"))

import importlib  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from tests._authkit import TEST_JWKS, auth  # noqa: E402


def _fresh_app(tmp_path, monkeypatch):
    """Reload the app against an isolated SQLite file and a stubbed realm JWKS."""
    monkeypatch.setenv("AGENT_DB_PATH", str(tmp_path / "agent.db"))

    import app.agent_router as agent_router
    import app.deps as deps
    import app.main as main

    importlib.reload(agent_router)
    importlib.reload(main)
    # deps is not reloaded, so require_tenant's identity is stable; point its JWKS at the test key.
    monkeypatch.setattr(deps, "_jwks", lambda iss: TEST_JWKS)
    return main


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """Authenticated client — carries a demo-tenant bearer token by default."""
    main = _fresh_app(tmp_path, monkeypatch)
    c = TestClient(main.app)
    c.headers.update(auth("demo-tenant"))
    return c


@pytest.fixture()
def raw_client(tmp_path, monkeypatch):
    """Unauthenticated client — no default Authorization header (for auth-boundary tests)."""
    main = _fresh_app(tmp_path, monkeypatch)
    return TestClient(main.app)


def optimizer_up() -> bool:
    from app.optimizer_client import OptimizerClient

    return OptimizerClient().health()
