"""Shared fixtures: a TestClient bound to a fresh, tenant-isolated store per test.

Sets ``AGENT_DB_PATH`` to a writable temp file at import time — BEFORE any test module imports
``app.main`` (which constructs the module-level store). Without this, importing the app would try the
production default ``/data/agent.db`` and fail on a dev/CI host where ``/data`` is not writable.
"""

from __future__ import annotations

import os
import tempfile

# Runs when conftest is first imported — ahead of test-module collection.
os.environ.setdefault("AGENT_DB_PATH", os.path.join(tempfile.mkdtemp(prefix="agentdb-"), "agent.db"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture()
def client(tmp_path, monkeypatch):
    # Isolate each test's SQLite so tenant state never leaks between tests.
    monkeypatch.setenv("AGENT_DB_PATH", str(tmp_path / "agent.db"))
    import importlib

    import app.agent_router as agent_router
    import app.main as main

    importlib.reload(agent_router)
    importlib.reload(main)
    return TestClient(main.app)


def optimizer_up() -> bool:
    from app.optimizer_client import OptimizerClient

    return OptimizerClient().health()
