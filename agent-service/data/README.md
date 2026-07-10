# Cold-start dataset format

`train_bc.py` reads a **JSONL** file (one JSON object per line). Each row pairs a full
`ProblemInput` (per the FROZEN `packages/shared/src/grafik/contract.ts` contract) with the expert
`assignments` label for it:

```json
{ "problem": { "...ProblemInput..." }, "assignments": [ {"employeeId": "emp-1", "demandId": "dem-1"} ] }
```

- `assignments` is exactly the `SolveResult.assignments` shape — so a dataset is produced by running
  the optimizer (or a human roster) over `problem` and pairing input ↔ output.
- A demand of `count` C consumes up to C assignments; any remaining slot becomes the env's
  "leave unfilled" action during replay.
- **RODO:** synthetic only — invented ids/coords, no PII.

`coldstart_sample.jsonl` here is a **tiny synthetic smoke sample** owned by this task. The **real**
cold-start dataset is produced by the parallel task that owns `agent/`; point `train_bc.py` at it
with `--dataset <path>` (or the `COLDSTART_DATASET` path your deployment wires in).
