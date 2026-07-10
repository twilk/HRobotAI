"""Formal **batch** retrain pipeline — the M2-C3 "self-developing" (samorozwijająca) increment.

What this is (and how it differs from ``policy.py``'s online update)
-------------------------------------------------------------------
``app/policy.py`` learns **online**: every ``/agent/feedback`` call nudges the *persistent* affinity
table by a per-edit delta. It is incremental and path-dependent — the policy you end up with depends
on the order corrections arrived and on the state they were applied to.

This module is the **batch retrain**: a distinct process that

  1. throws away the current affinity table and starts from a **fresh** :class:`PolicyState`;
  2. re-fits **from the full accumulated history** — the cold-start teacher dataset (imitation /
     behavioural cloning) *plus every* ``agent_feedback`` row logged for the tenant so far;
  3. emits a **new versioned policy** with a persisted **training artifact** and an
     ``AgentPolicyVersion`` audit record (spec §6: ``id, version, trainedAt, metrics, artefactPath``).

Because it always re-derives the policy from the whole dataset, a retrain is a *deterministic
function of (cold-start dataset + feedback log)* — reproducible and order-independent, unlike the
online nudge. As the feedback log grows, successive retrains produce policies whose acceptance metric
**rises** (AG5) and whose edit-distance to the manager-accepted schedule **drops** (AG2, now shown to
hold when driven by the batch pipeline, not only the online path).

Honest framing (see README): this is the **M2 increment** of self-development — a dependency-light
numpy BC + feedback re-fit with versioned artifacts. It is **NOT** the full long-horizon on-policy RL
retrain of the staged vision (spec §8). No production-autonomy claim.

Entry point
-----------
    python -m app.retrain                      # run the AG5 self-development scenario -> >=2 rising versions + evidence/
    python -m app.retrain --once --tenant T     # single production-shaped retrain from the live store
"""

from __future__ import annotations

import argparse
import json
import os
import re

from .contract import Assignment, ProblemInput
from .fixtures import canonical_problem, canonical_solution
from .metrics import acceptance_metric, edit_distance
from .policy import ImitationPolicy, PolicyState, slot_signature
from .store import AgentStore

# Batch feedback learning rate. Mirrors the online ``LR_FEEDBACK`` so a slot the manager keeps
# correcting accumulates decisive affinity across the accumulated log.
LR_FEEDBACK_BATCH = 3.0

# Per-edit affinity direction for the *stored* ``agent_feedback.employeeId`` (which the service records
# as ``toEmployeeId or employeeId``). Reinforce the employee the manager steered a slot *toward*;
# penalise the one they steered *away from* / rejected.
BATCH_DELTA = {
    "MOVE": +LR_FEEDBACK_BATCH,          # stored id = toEmployee (manager's target)
    "ACCEPT": +LR_FEEDBACK_BATCH * 0.25,  # kept assignment, mild reinforcement
    "SWAP": -LR_FEEDBACK_BATCH,          # stored id = employee swapped out
    "REJECT": -LR_FEEDBACK_BATCH,
    "REMOVE": -LR_FEEDBACK_BATCH,
}


def _default_artifacts_dir() -> str:
    """Agent-owned artifacts dir, adjacent to ``AGENT_DB_PATH`` (gitignored). Override with
    ``AGENT_ARTIFACTS_DIR``. Falls back to ``./artifacts`` when the store is in-memory."""
    override = os.environ.get("AGENT_ARTIFACTS_DIR")
    if override:
        return override
    db_path = os.environ.get("AGENT_DB_PATH", "/data/agent.db")
    if db_path == ":memory:":
        return os.path.abspath("artifacts")
    return os.path.join(os.path.dirname(os.path.abspath(db_path)), "artifacts")


def _slug(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]", "-", text)[:64]


class RetrainPipeline:
    """Re-fit a tenant's policy from its full accumulated history, versioned with a saved artifact."""

    def __init__(self, store: AgentStore, artifacts_dir: str | None = None):
        self.store = store
        self.artifacts_dir = artifacts_dir or _default_artifacts_dir()

    # --- feedback replay (batch) -----------------------------------------------------------------

    def _apply_feedback_log(self, policy: ImitationPolicy, tenant_id: str) -> dict:
        """Fold every accumulated feedback row into affinity. Returns replay provenance counts.

        Demand context (needed for ``slot_signature``) is recovered from each row's originating
        proposal, which the store persisted with its full ``problem``. Rows whose proposal or demand
        can no longer be resolved are skipped (and counted) rather than guessed at.
        """
        rows = self.store.feedback_for_tenant(tenant_id)
        problems: dict[str, ProblemInput] = {}
        dem_index: dict[str, dict] = {}
        applied = 0
        skipped = 0
        by_type: dict[str, int] = {}

        for r in rows:
            pid = r["proposalId"]
            if pid not in problems:
                proposal = self.store.get_proposal(tenant_id, pid)
                if proposal is None:
                    problems[pid] = None  # type: ignore[assignment]
                else:
                    prob = ProblemInput.model_validate(proposal["problem"])
                    problems[pid] = prob
                    dem_index[pid] = {d.id: d for d in prob.demands}
            prob = problems[pid]
            demand = dem_index.get(pid, {}).get(r["demandId"]) if prob is not None else None
            emp = r["employeeId"]
            delta = BATCH_DELTA.get(r["editType"])
            if prob is None or demand is None or not emp or delta is None:
                skipped += 1
                continue
            key = f"{emp}::{slot_signature(demand)}"
            policy.state.affinity[key] = policy.state.affinity.get(key, 0.0) + delta
            applied += 1
            by_type[r["editType"]] = by_type.get(r["editType"], 0) + 1

        return {"feedbackRows": len(rows), "applied": applied, "skipped": skipped, "byType": by_type}

    # --- artifact persistence --------------------------------------------------------------------

    def _save_artifact(self, tenant_id: str, version: int, state: PolicyState, metrics: dict) -> str:
        os.makedirs(self.artifacts_dir, exist_ok=True)
        path = os.path.join(self.artifacts_dir, f"policy_{_slug(tenant_id)}_v{version}.json")
        payload = {
            "tenantId": tenant_id,
            "version": version,
            "kind": "numpy-imitation-bc+feedback-refit",
            "policyState": state.to_dict(),
            "metrics": metrics,
        }
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=2, sort_keys=True)
        return path

    @staticmethod
    def load_artifact(path: str) -> PolicyState:
        """Rehydrate a saved policy artifact back into a :class:`PolicyState` (round-trip proof)."""
        with open(path, encoding="utf-8") as fh:
            payload = json.load(fh)
        return PolicyState.from_dict(payload["policyState"])

    # --- the pipeline ----------------------------------------------------------------------------

    def retrain(
        self,
        tenant_id: str,
        *,
        cold_start: list[tuple[ProblemInput, list[Assignment]]] | None = None,
        eval_problem: ProblemInput | None = None,
        eval_accepted: list[Assignment] | None = None,
        note: str | None = None,
    ) -> dict:
        """Run one batch retrain: BC on cold-start + replay of the full feedback log -> new version.

        Persists the re-fitted policy as the tenant's serving policy, saves the training artifact, and
        records an ``AgentPolicyVersion`` row carrying ``metrics`` (JSON) + ``artefactPath``.
        """
        if cold_start is None:
            cold_start = [(canonical_problem(), canonical_solution())]

        existing = self.store.policy_versions(tenant_id)
        next_version = max((v["version"] for v in existing), default=0) + 1

        # 1) Fresh policy, re-fit from the WHOLE accumulated history (not an incremental tweak).
        state = PolicyState(version=next_version)
        policy = ImitationPolicy(state)
        teacher_examples = 0
        for problem, teacher in cold_start:
            policy.apply_teacher_assignments(problem, teacher)
            teacher_examples += len(teacher)
        replay = self._apply_feedback_log(policy, tenant_id)

        # 2) Evaluate the freshly-fitted policy (AG5 acceptance / AG2 edit-distance) if a probe given.
        acceptance: float | None = None
        eval_edit_distance: int | None = None
        if eval_problem is not None and eval_accepted is not None:
            proposed, _ = policy.propose(eval_problem)
            acceptance = acceptance_metric(proposed, eval_accepted)
            eval_edit_distance = edit_distance(proposed, eval_accepted)

        metrics = {
            "acceptanceMetric": acceptance,
            "editDistance": eval_edit_distance,
            "teacherExamples": teacher_examples,
            "feedbackRows": replay["feedbackRows"],
            "feedbackApplied": replay["applied"],
            "feedbackSkipped": replay["skipped"],
            "feedbackByType": replay["byType"],
            "affinityKeys": len(state.affinity),
            "trainMethod": "batch-refit(BC-cold-start + full-feedback-log)",
        }

        # 3) Persist: artifact -> serving policy -> AgentPolicyVersion audit row.
        artefact_path = self._save_artifact(tenant_id, next_version, state, metrics)
        self.store.save_policy(tenant_id, state.to_dict())
        version_id = self.store.record_policy_version(
            tenant_id,
            next_version,
            acceptance,
            note=note or "batch retrain (BC cold-start + accumulated feedback re-fit)",
            metrics=metrics,
            artefact_path=artefact_path,
        )

        return {
            "id": version_id,
            "tenantId": tenant_id,
            "version": next_version,
            "metrics": metrics,
            "artefactPath": artefact_path,
            "acceptanceMetric": acceptance,
            "editDistance": eval_edit_distance,
        }


# --- CLI -----------------------------------------------------------------------------------------


def _run_once(tenant: str) -> None:
    store = AgentStore()
    pipeline = RetrainPipeline(store)
    result = pipeline.retrain(tenant)
    print(json.dumps(result, indent=2))
    print(f"\nretrained tenant '{tenant}' -> policy v{result['version']}")
    print(f"artifact: {result['artefactPath']}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Batch retrain pipeline (M2-C3 self-development).")
    ap.add_argument("--once", action="store_true", help="single retrain from the live store for --tenant")
    ap.add_argument("--tenant", default="demo-tenant")
    args = ap.parse_args()

    if args.once:
        _run_once(args.tenant)
        return

    # Default: the AG5 self-development scenario — accumulate feedback, retrain repeatedly, prove
    # >=2 policy versions with rising acceptance + saved artifacts, and the AG2 edit-distance drop.
    from .demo_ag5 import main as demo_main

    demo_main()


if __name__ == "__main__":  # pragma: no cover
    main()
