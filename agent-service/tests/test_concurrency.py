"""C2 — concurrent feedback must not lose policy-version bumps or duplicate version numbers.

Each ``feedback`` that moves the policy is a read-modify-write: load policy vN, apply the nudge, write
vN+1 and append an AgentPolicyVersion row. Without a lock around that span two threads both read vN and
each write vN+1 — a lost update / duplicate version. The service-level ``RLock`` (plus the store's
write lock) serialises the span, so with N concurrent feedbacks the version numbers come out unique
and strictly increasing and every feedback row is persisted.
"""

from __future__ import annotations

import threading

from app.fixtures import canonical_problem
from app.service import AgentService
from app.store import AgentStore


def _burst(n_threads: int = 8) -> None:
    store = AgentStore(":memory:")
    service = AgentService(store)
    tenant = "concurrency-t"

    problem = canonical_problem()
    prop = service.propose(tenant, problem)  # cold-starts v1 and records it
    pid = prop["proposalId"]
    a0 = prop["assignments"][0]

    barrier = threading.Barrier(n_threads)
    errors: list[Exception] = []

    def worker(i: int) -> None:
        try:
            barrier.wait()  # maximise contention: everyone hits feedback together
            service.feedback(
                tenant,
                pid,
                [
                    {
                        "editType": "MOVE",
                        "demandId": a0["demandId"],
                        "fromEmployeeId": a0["employeeId"],
                        "toEmployeeId": f"emp-{i}",
                    }
                ],
                False,
            )
        except Exception as exc:  # pragma: no cover - surfaced via assert below
            errors.append(exc)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(n_threads)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors, f"feedback raised under concurrency: {errors}"

    # Every concurrent feedback persisted its row (nothing lost).
    assert store.count_feedback(tenant) == n_threads

    versions = [v["version"] for v in store.policy_versions(tenant)]
    # No duplicate version numbers (the lost-update symptom) and strictly increasing.
    assert len(versions) == len(set(versions)), f"duplicate policy versions: {versions}"
    assert versions == sorted(versions), f"versions not monotonic: {versions}"
    # cold-start v1 + one bump per feedback, contiguous.
    assert versions == list(range(1, n_threads + 2)), versions


def test_concurrent_feedback_versions_unique_and_monotonic():
    # Repeat the burst so a lock regression is caught reliably rather than flaking through.
    for _ in range(10):
        _burst(n_threads=8)
