"""Agent-owned persistence — tenant-isolated SQLite behind a clean interface.

**Staged path (read this).** Spec §6 puts ``AgentFeedback`` (and ``AgentPolicyVersion``) in the
*tenant Prisma schema*. That production home is deferred to a later, separately-owned change (it
touches `packages/db/prisma/**/schema.prisma`, owned by sm-grafik-core and frozen for this task).
For the M2 increment the store is **owned inside `agent-service/`** — a small SQLite file behind
this interface — so the learning loop is demonstrable end-to-end without a schema migration. Every
row is keyed by ``tenantId`` and every read is filtered by it, so one tenant's feedback and policy
are never visible to another (**AG6**). Swapping this class for a Prisma-backed repository later is a
drop-in: the router only ever talks to this interface.

Tables
------
* ``agent_feedback`` — the spec §6 fields: id, proposalId, employeeId, demandId, editType,
  rewardSignal, tenantId, createdAt.
* ``proposals`` — the proposal a feedback/explain call refers back to (problem + assignments).
* ``policy_state`` — the learned per-tenant policy (JSON), one row per (tenantId).
* ``policy_versions`` — the spec §6 ``AgentPolicyVersion`` audit trail: id, version, trainedAt,
  ``metrics`` (JSON), ``artefactPath`` (the saved training artifact). ``acceptanceMetric``/``note``
  are kept as denormalised convenience columns for the pre-M2-C3 readers. Each formal retrain
  (``app.retrain``) writes one row with a persisted artifact; the online feedback nudge also records
  a row so the version history is continuous (AG5).
"""

from __future__ import annotations

import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone

def _default_db_path() -> str:
    # Read at call time (not import) so tests / deploys can point AGENT_DB_PATH wherever.
    return os.environ.get("AGENT_DB_PATH", "/data/agent.db")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


class AgentStore:
    def __init__(self, db_path: str | None = None):
        db_path = db_path or _default_db_path()
        self.db_path = db_path
        if db_path != ":memory:":
            os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)
        # A single shared connection (check_same_thread off for the FastAPI worker).
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._init_schema()

    @contextmanager
    def _tx(self):
        cur = self._conn.cursor()
        try:
            yield cur
            self._conn.commit()
        finally:
            cur.close()

    def _init_schema(self) -> None:
        with self._tx() as c:
            c.executescript(
                """
                CREATE TABLE IF NOT EXISTS agent_feedback (
                    id TEXT PRIMARY KEY,
                    proposalId TEXT NOT NULL,
                    employeeId TEXT,
                    demandId TEXT,
                    editType TEXT NOT NULL,
                    rewardSignal REAL NOT NULL,
                    tenantId TEXT NOT NULL,
                    createdAt TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS ix_feedback_tenant ON agent_feedback(tenantId);
                CREATE INDEX IF NOT EXISTS ix_feedback_proposal ON agent_feedback(tenantId, proposalId);

                CREATE TABLE IF NOT EXISTS proposals (
                    id TEXT PRIMARY KEY,
                    tenantId TEXT NOT NULL,
                    policyVersion INTEGER NOT NULL,
                    problem TEXT NOT NULL,
                    assignments TEXT NOT NULL,
                    rationale TEXT NOT NULL,
                    createdAt TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS ix_proposals_tenant ON proposals(tenantId);

                CREATE TABLE IF NOT EXISTS policy_state (
                    tenantId TEXT PRIMARY KEY,
                    state TEXT NOT NULL,
                    updatedAt TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS policy_versions (
                    id TEXT PRIMARY KEY,
                    tenantId TEXT NOT NULL,
                    version INTEGER NOT NULL,
                    trainedAt TEXT NOT NULL,
                    acceptanceMetric REAL,
                    metrics TEXT,
                    artefactPath TEXT,
                    note TEXT
                );
                CREATE INDEX IF NOT EXISTS ix_versions_tenant ON policy_versions(tenantId);
                """
            )
            # Forward-migrate a pre-M2-C3 policy_versions table (added: metrics, artefactPath).
            existing = {r["name"] for r in c.execute("PRAGMA table_info(policy_versions)").fetchall()}
            if "metrics" not in existing:
                c.execute("ALTER TABLE policy_versions ADD COLUMN metrics TEXT")
            if "artefactPath" not in existing:
                c.execute("ALTER TABLE policy_versions ADD COLUMN artefactPath TEXT")

    # --- proposals -------------------------------------------------------------------------------

    def save_proposal(
        self, tenant_id: str, policy_version: int, problem: dict, assignments: list[dict], rationale: list[dict]
    ) -> str:
        pid = new_id()
        with self._tx() as c:
            c.execute(
                "INSERT INTO proposals (id, tenantId, policyVersion, problem, assignments, rationale, createdAt)"
                " VALUES (?,?,?,?,?,?,?)",
                (pid, tenant_id, policy_version, json.dumps(problem), json.dumps(assignments), json.dumps(rationale), _now_iso()),
            )
        return pid

    def get_proposal(self, tenant_id: str, proposal_id: str) -> dict | None:
        row = self._conn.execute(
            "SELECT * FROM proposals WHERE tenantId=? AND id=?", (tenant_id, proposal_id)
        ).fetchone()
        if row is None:
            return None
        return {
            "id": row["id"],
            "tenantId": row["tenantId"],
            "policyVersion": row["policyVersion"],
            "problem": json.loads(row["problem"]),
            "assignments": json.loads(row["assignments"]),
            "rationale": json.loads(row["rationale"]),
            "createdAt": row["createdAt"],
        }

    # --- feedback --------------------------------------------------------------------------------

    def add_feedback(
        self, *, tenant_id: str, proposal_id: str, employee_id: str | None, demand_id: str | None,
        edit_type: str, reward_signal: float,
    ) -> str:
        fid = new_id()
        with self._tx() as c:
            c.execute(
                "INSERT INTO agent_feedback (id, proposalId, employeeId, demandId, editType, rewardSignal, tenantId, createdAt)"
                " VALUES (?,?,?,?,?,?,?,?)",
                (fid, proposal_id, employee_id, demand_id, edit_type, reward_signal, tenant_id, _now_iso()),
            )
        return fid

    def feedback_for_tenant(self, tenant_id: str) -> list[dict]:
        rows = self._conn.execute(
            "SELECT * FROM agent_feedback WHERE tenantId=? ORDER BY createdAt", (tenant_id,)
        ).fetchall()
        return [dict(r) for r in rows]

    def count_feedback(self, tenant_id: str) -> int:
        return self._conn.execute(
            "SELECT COUNT(*) AS n FROM agent_feedback WHERE tenantId=?", (tenant_id,)
        ).fetchone()["n"]

    # --- policy state ----------------------------------------------------------------------------

    def load_policy(self, tenant_id: str) -> dict | None:
        row = self._conn.execute(
            "SELECT state FROM policy_state WHERE tenantId=?", (tenant_id,)
        ).fetchone()
        return json.loads(row["state"]) if row else None

    def save_policy(self, tenant_id: str, state: dict) -> None:
        with self._tx() as c:
            c.execute(
                "INSERT INTO policy_state (tenantId, state, updatedAt) VALUES (?,?,?)"
                " ON CONFLICT(tenantId) DO UPDATE SET state=excluded.state, updatedAt=excluded.updatedAt",
                (tenant_id, json.dumps(state), _now_iso()),
            )

    def record_policy_version(
        self,
        tenant_id: str,
        version: int,
        acceptance_metric: float | None,
        note: str | None = None,
        metrics: dict | None = None,
        artefact_path: str | None = None,
    ) -> str:
        """Append an ``AgentPolicyVersion`` audit row (spec §6) and return its id.

        ``metrics`` is the full JSON metrics blob (acceptance + training provenance) written by the
        formal retrain; ``acceptanceMetric`` stays populated as a scalar convenience column so the
        pre-M2-C3 ``policy_info`` reader keeps working. ``artefactPath`` is where the trained policy
        artifact was saved.
        """
        vid = new_id()
        with self._tx() as c:
            c.execute(
                "INSERT INTO policy_versions"
                " (id, tenantId, version, trainedAt, acceptanceMetric, metrics, artefactPath, note)"
                " VALUES (?,?,?,?,?,?,?,?)",
                (
                    vid,
                    tenant_id,
                    version,
                    _now_iso(),
                    acceptance_metric,
                    json.dumps(metrics) if metrics is not None else None,
                    artefact_path,
                    note,
                ),
            )
        return vid

    # --- tenant-scoped reset ---------------------------------------------------------------------

    def reset_tenant(self, tenant_id: str) -> dict:
        """Delete **only this tenant's** learned state so its policy can be cold-started afresh.

        Clears ``agent_feedback``, ``policy_versions`` and ``policy_state`` (plus the tenant's cached
        ``proposals``, which reference the now-gone feedback) — every statement is filtered by
        ``tenantId``, so another tenant's data is never touched (**AG6**). Idempotent: resetting a
        tenant with no rows is a no-op that returns zero counts. Returns the deleted-row counts so the
        caller (``POST /agent/reset``) can report what it cleared.
        """
        with self._tx() as c:
            c.execute("DELETE FROM agent_feedback WHERE tenantId=?", (tenant_id,))
            feedback_deleted = c.rowcount
            c.execute("DELETE FROM policy_versions WHERE tenantId=?", (tenant_id,))
            versions_deleted = c.rowcount
            c.execute("DELETE FROM policy_state WHERE tenantId=?", (tenant_id,))
            policy_deleted = c.rowcount
            c.execute("DELETE FROM proposals WHERE tenantId=?", (tenant_id,))
            proposals_deleted = c.rowcount
        return {
            "feedbackDeleted": feedback_deleted,
            "policyVersionsDeleted": versions_deleted,
            "policyStateDeleted": policy_deleted,
            "proposalsDeleted": proposals_deleted,
        }

    def policy_versions(self, tenant_id: str) -> list[dict]:
        rows = self._conn.execute(
            "SELECT id, version, trainedAt, acceptanceMetric, metrics, artefactPath, note"
            " FROM policy_versions WHERE tenantId=? ORDER BY trainedAt, version",
            (tenant_id,),
        ).fetchall()
        out: list[dict] = []
        for r in rows:
            d = dict(r)
            d["metrics"] = json.loads(d["metrics"]) if d.get("metrics") else None
            out.append(d)
        return out
