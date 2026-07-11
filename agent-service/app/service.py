"""Agent service layer — wires the policy, the tenant-isolated store, and rationale generation.

Owns the per-tenant lifecycle: lazily cold-starts a policy from the solver teacher on first use,
serves proposals with rationale, ingests feedback (persist + online learn + version bump), and
repairs infeasible proposals through the live solver.
"""

from __future__ import annotations

import threading

from .contract import Assignment, ProblemInput
from .fixtures import canonical_problem, canonical_solution
from .metrics import acceptance_metric
from .optimizer_client import OptimizerClient
from .policy import ImitationPolicy, PolicyState, ScoredCandidate, reward_for_edit, slot_signature
from .store import AgentStore
from .validate import validate

DEFAULT_TENANT = "demo-tenant"


class AgentService:
    def __init__(self, store: AgentStore):
        self.store = store
        # Serialises the feedback/retrain read-modify-write span (load policy -> apply -> bump version
        # -> record version). The store's own ``_lock`` protects a single write; this one keeps the
        # multi-statement span atomic so two concurrent feedback calls can't both read version N and
        # each write N+1 (lost update / duplicate version — M2 fix). Reentrant.
        self._lock = threading.RLock()

    # --- per-tenant policy lifecycle -------------------------------------------------------------

    def _load_policy(self, tenant_id: str) -> PolicyState:
        raw = self.store.load_policy(tenant_id)
        if raw is not None:
            return PolicyState.from_dict(raw)
        # Cold start: imitate the solver teacher on the canonical synthetic problem (BC), v1.
        state = PolicyState(version=1)
        policy = ImitationPolicy(state)
        policy.apply_teacher_assignments(canonical_problem(), canonical_solution())
        self.store.save_policy(tenant_id, state.to_dict())
        self.store.record_policy_version(tenant_id, 1, None, note="cold-start BC (solver imitation)")
        return state

    def _save_policy(self, tenant_id: str, state: PolicyState) -> None:
        self.store.save_policy(tenant_id, state.to_dict())

    # --- rationale ------------------------------------------------------------------------------

    def _rationale_for(
        self, problem: ProblemInput, assignment: Assignment, ranked: dict[str, list[ScoredCandidate]]
    ) -> dict:
        dem = next((d for d in problem.demands if d.id == assignment.demandId), None)
        cands = ranked.get(assignment.demandId, [])
        chosen = next((c for c in cands if c.employeeId == assignment.employeeId), None)
        reasons: list[str] = []
        if dem is not None:
            reasons.append(f"qualified for role {dem.role}")
        if chosen is not None:
            commute = chosen.parts.get("f_commute")
            if commute is not None:
                reasons.append(f"commute {commute:.0f} min")
            aff = chosen.parts.get("affinity", 0.0)
            if aff > 0:
                reasons.append(f"manager-learned preference (affinity {aff:+.2f})")
            elif aff < 0:
                reasons.append(f"against learned preference (affinity {aff:+.2f})")
        return {
            "employeeId": assignment.employeeId,
            "demandId": assignment.demandId,
            "score": round(chosen.score, 4) if chosen else None,
            "reasons": reasons,
        }

    def _alternatives_for(
        self, ranked: dict[str, list[ScoredCandidate]], demand_id: str, chosen_ids: set[str], limit: int = 3
    ) -> list[dict]:
        alts = []
        for c in ranked.get(demand_id, []):
            if c.employeeId in chosen_ids:
                continue
            alts.append(
                {
                    "employeeId": c.employeeId,
                    "score": round(c.score, 4),
                    "affinity": round(c.parts.get("affinity", 0.0), 4),
                    "reason": "eligible but scored lower",
                }
            )
            if len(alts) >= limit:
                break
        return alts

    # --- propose --------------------------------------------------------------------------------

    def propose(self, tenant_id: str, problem: ProblemInput) -> dict:
        state = self._load_policy(tenant_id)
        policy = ImitationPolicy(state)
        assignments, ranked = policy.propose(problem)
        rationale = [self._rationale_for(problem, a, ranked) for a in assignments]
        report = validate(problem, assignments)
        feasibility = {
            "feasible": report.feasible,
            "violations": report.as_wire(),
            "source": "agent-local-validator",
            "note": "authoritative feasibility guardian is the live solver via /agent/heal",
        }
        proposal_id = self.store.save_proposal(
            tenant_id,
            state.version,
            problem.model_dump(),
            [a.model_dump() for a in assignments],
            rationale,
        )
        # keep ranked candidates around for /agent/explain by caching them under the proposal
        return {
            "proposalId": proposal_id,
            "assignments": [a.model_dump() for a in assignments],
            "rationale": rationale,
            "policyVersion": state.version,
            "feasibility": feasibility,
        }

    # --- feedback -------------------------------------------------------------------------------

    def feedback(self, tenant_id: str, proposal_id: str, edits: list[dict], accepted: bool) -> dict:
        # Hold the service lock across the whole read-modify-write so the online nudge + version bump
        # are atomic against a concurrent feedback/retrain for the same tenant (M2 lost-update fix).
        with self._lock:
            proposal = self.store.get_proposal(tenant_id, proposal_id)
            if proposal is None:
                return {"ok": False, "rewardLogged": 0, "error": "unknown proposalId for tenant"}
            problem = ProblemInput.model_validate(proposal["problem"])

            # Persist each edit as an AgentFeedback row (spec §6), tenant-keyed.
            logged = 0
            effective_edits = list(edits)
            if accepted and not edits:
                effective_edits = [{"editType": "ACCEPT", "employeeId": None, "demandId": None}]
            for e in effective_edits:
                self.store.add_feedback(
                    tenant_id=tenant_id,
                    proposal_id=proposal_id,
                    employee_id=e.get("toEmployeeId") or e.get("employeeId"),
                    demand_id=e.get("demandId"),
                    edit_type=e.get("editType", "REJECT"),
                    reward_signal=reward_for_edit(e.get("editType", "REJECT")),
                )
                logged += 1

            # Online learning: move the policy toward the manager's corrections, then bump version.
            state = self._load_policy(tenant_id)
            policy = ImitationPolicy(state)
            updates = policy.apply_feedback_edits(problem, effective_edits)
            if updates:
                state.version += 1
                # Re-propose to measure the new acceptance metric on the same problem (AG5 progression).
                new_assignments, _ = policy.propose(problem)
                accepted_schedule = self._infer_accepted_schedule(proposal, effective_edits)
                metric = acceptance_metric(new_assignments, accepted_schedule) if accepted_schedule else None
                self._save_policy(tenant_id, state)
                # Online-nudge versions carry no saved artifact — that is the formal *batch* retrain's
                # job (app.retrain / POST /agent/retrain). The metrics blob records which path wrote it.
                self.store.record_policy_version(
                    tenant_id,
                    state.version,
                    metric,
                    note="online feedback nudge",
                    metrics={"acceptanceMetric": metric, "trainMethod": "online-nudge", "updates": updates},
                )
            else:
                self._save_policy(tenant_id, state)

            return {"ok": True, "rewardLogged": logged, "policyVersion": state.version}

    @staticmethod
    def _infer_accepted_schedule(proposal: dict, edits: list[dict]) -> list[Assignment] | None:
        """Apply MOVE/REMOVE/SWAP edits onto the proposed schedule to reconstruct what the manager kept."""
        pairs = {(a["employeeId"], a["demandId"]) for a in proposal["assignments"]}
        touched = False
        for e in edits:
            t = e.get("editType")
            did = e.get("demandId")
            if t == "MOVE" and did:
                pairs.discard((e.get("fromEmployeeId"), did))
                pairs.add((e.get("toEmployeeId"), did))
                touched = True
            elif t == "REMOVE" and did:
                pairs.discard((e.get("employeeId"), did))
                touched = True
            elif t == "SWAP" and did:
                pairs.discard((e.get("employeeId"), did))
                pairs.add((e.get("otherEmployeeId"), did))
                touched = True
        if not touched:
            return None
        return [Assignment(employeeId=emp, demandId=dem) for emp, dem in pairs if emp]

    # --- heal (live solver) ---------------------------------------------------------------------

    def heal(self, problem: ProblemInput, assignments: list[Assignment]) -> dict:
        # 1) Detect what's wrong locally (fast, names the broken hard rules).
        report = validate(problem, assignments)
        what_was_wrong = report.as_wire()

        # 2) Repair through the LIVE solver — the feasibility guardian (spec §3/§40, DRY §117).
        #    Reuses the #20 OptimizerClient seam (DRY: same client env.py's terminal reward uses).
        result = OptimizerClient().solve(problem)
        repaired = [a.model_dump() for a in result.assignments]
        if result.status.value == "INFEASIBLE":
            what_was_wrong.append(
                {
                    "code": "SOLVER_INFEASIBLE",
                    "demandId": None,
                    "employeeId": None,
                    "detail": "live solver could not fully cover demand; see unmet[]",
                }
            )
        return {
            "repairedAssignments": repaired,
            "whatWasWrong": what_was_wrong,
            "solverStatus": result.status.value,
            "unmet": [u.model_dump() for u in result.unmet],
        }

    # --- explain --------------------------------------------------------------------------------

    def explain(self, tenant_id: str, proposal_id: str, demand_id: str | None) -> dict | None:
        proposal = self.store.get_proposal(tenant_id, proposal_id)
        if proposal is None:
            return None
        problem = ProblemInput.model_validate(proposal["problem"])
        state = self._load_policy(tenant_id)
        policy = ImitationPolicy(state)
        _, ranked = policy.propose(problem)

        rationale = proposal["rationale"]
        chosen_by_demand: dict[str, set[str]] = {}
        for a in proposal["assignments"]:
            chosen_by_demand.setdefault(a["demandId"], set()).add(a["employeeId"])

        if demand_id:
            rationale = [r for r in rationale if r["demandId"] == demand_id]
            alternatives = self._alternatives_for(ranked, demand_id, chosen_by_demand.get(demand_id, set()))
        else:
            # summarise: alternatives for the first few demands
            alternatives = []
            for did in list(chosen_by_demand)[:5]:
                for alt in self._alternatives_for(ranked, did, chosen_by_demand[did], limit=2):
                    alt["demandId"] = did
                    alternatives.append(alt)
        return {"rationale": rationale, "alternativesConsidered": alternatives}

    # --- formal batch retrain (M2-C3) -----------------------------------------------------------

    def retrain(self, tenant_id: str, note: str | None = None) -> dict:
        """Trigger the formal batch retrain: re-fit from the full accumulated log, new version+artifact.

        Distinct from the per-``feedback`` online nudge above — see :mod:`app.retrain`. No synthetic
        acceptance eval is run here (real acceptance needs held-out manager labels), so the recorded
        ``acceptanceMetric`` is null; the metrics blob still captures the training provenance.
        """
        from .retrain import RetrainPipeline  # local import avoids a service<->retrain import cycle

        # Serialise against concurrent feedback/retrain so the version sequence stays gap-free and
        # unique for the tenant (M2 lost-update fix).
        with self._lock:
            # Ensure a cold-start v1 exists so retrain versions continue the tenant's history.
            self._load_policy(tenant_id)
            return RetrainPipeline(self.store).retrain(tenant_id, note=note)

    # --- tenant-scoped reset to cold-start (demo affordance) ------------------------------------

    def reset(self, tenant_id: str) -> dict:
        """Return **one tenant** to its day-1, untrained cold-start policy.

        This is the server side of the demo's *"Reset demo agent to cold-start & replay"*: it clears
        the tenant's accumulated feedback, its policy-version history and its learned policy state
        (tenant-scoped — never a blanket wipe), then re-derives the **exact same cold-start BC
        baseline** first use would build — imitation of the solver teacher on the canonical problem,
        recorded as policy ``v1``. No parallel policy path: it deletes state and replays the existing
        :meth:`_load_policy` cold start. Deterministic and idempotent, so a fresh ``propose`` for the
        demo scenario is back at the day-1 gap (~edit-distance 50 / agreement ~52%) every time.
        """
        deleted = self.store.reset_tenant(tenant_id)
        # policy_state was just cleared, so this cold-starts a fresh v1 (and records the version row).
        state = self._load_policy(tenant_id)
        return {
            "ok": True,
            "tenantId": tenant_id,
            "policyVersion": state.version,
            "feedbackCount": self.store.count_feedback(tenant_id),
            "cleared": deleted,
        }

    # --- policy read (AG5) ----------------------------------------------------------------------

    def policy_info(self, tenant_id: str) -> dict:
        state = self._load_policy(tenant_id)
        versions = self.store.policy_versions(tenant_id)
        latest_metric = next(
            (v["acceptanceMetric"] for v in reversed(versions) if v["acceptanceMetric"] is not None), None
        )
        latest_artefact = next(
            (v["artefactPath"] for v in reversed(versions) if v.get("artefactPath")), None
        )
        trained_at = versions[-1]["trainedAt"] if versions else None
        return {
            "version": state.version,
            "trainedAt": trained_at,
            "acceptanceMetric": latest_metric,
            "latestArtefactPath": latest_artefact,
            "trainingRuns": versions,
            "feedbackCount": self.store.count_feedback(tenant_id),
        }
