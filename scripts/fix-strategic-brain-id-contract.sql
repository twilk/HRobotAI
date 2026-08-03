-- ============================================================================================
-- [I-01] REPAIR: strategic-brain demo rows whose primary key is NOT a UUID.
--
-- WHY. Every id below is reachable as an HTTP `:id` route param, and those controllers validate the
-- param with Nest's `ParseUUIDPipe`. A readable slug in such a column is therefore not a cosmetic
-- issue — it is a guaranteed 400 on every request for that row:
--
--     GET  /api/strategic-brain/employee/sb_emp_new1
--       -> 400 {"message":"Validation failed (uuid is expected)","error":"Bad Request","statusCode":400}
--     GET  /api/strategic-brain/employee/aeac802d-…   (an anchor, real UUID)
--       -> 200
--
-- User-visible symptom that started this: on `/analiza` the "Mapa wydajnosci" table left the SYGNAL
-- cell of Tomasz Nowacki and Ewa Lewandowska spinning forever, because the per-row fetch 400'd. The
-- module logic was correct — the SEED data broke the API contract.
--
-- WHAT IT FIXES (all four tables are `ParseUUIDPipe`-guarded):
--     employees                    GET /strategic-brain/employee/:id, GET/PATCH /employees/:id
--     recruitment_recommendation   POST /strategic-brain/recruitment/:id/acknowledge
--     leave_requests               GET /wnioski/:id, POST /wnioski/:id/decision, /cancel
--     shift_demands                GET /grafik/demands/:id
--
-- WHY UPDATE AND NOT DELETE+INSERT. Nothing here is destructive: this script contains ZERO DELETEs.
-- Every FK that points at `employees.id` is declared `ON UPDATE CASCADE` (see the
-- 20260709120000_grafik_core_schema and 20260714000000_strategic_brain migrations), so rekeying the
-- primary key carries every child row with it — shifts, leave_requests, work_order, complaint,
-- employee_performance_snapshot, rcp_event, access_grant, generated_document. No history is lost,
-- no personnel row is dropped, and the performance trend the demo depends on stays intact.
-- `recruitment_recommendation`, `leave_requests` and `shift_demands` have no inbound FKs at all.
--
-- IDEMPOTENT. Each statement is guarded by `NOT EXISTS` on the target id, so a second run is a no-op
-- and running it against an already-correct (freshly seeded) DB does nothing.
--
-- The target UUIDs are the SAME constants that `scripts/seed-demo-strategic-brain.sql` now inserts,
-- so a repaired DB and a freshly-seeded DB end up byte-identical. Pinned by
-- apps/tenant-runtime/src/strategic-brain/seed-id-contract.spec.ts.
--
-- Run: docker exec -i hrobot-postgres-1 psql -U postgres -d hrobot_t_900d948b \
--        -v ON_ERROR_STOP=1 < scripts/fix-strategic-brain-id-contract.sql
-- ============================================================================================

BEGIN;

-- 1) Synthetic new-hire employees ("nowy rosnacy" / "nowy plaski"). THE defect that caused the 400s.
UPDATE employees SET id = 'a1d00000-0000-4000-8000-00005b00e001', updated_at = now()
WHERE id = 'sb_emp_new1'
  AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.id = 'a1d00000-0000-4000-8000-00005b00e001');

UPDATE employees SET id = 'a1d00000-0000-4000-8000-00005b00e002', updated_at = now()
WHERE id = 'sb_emp_new2'
  AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.id = 'a1d00000-0000-4000-8000-00005b00e002');

-- 2) Seeded recruitment recommendations. Same class of defect, found while fixing (1): the whole
--    recruitment feed is seeded with slugs, so `POST /strategic-brain/recruitment/:id/acknowledge`
--    — the "potwierdz rekomendacje" action, the RODO art. 22 human-decision step — would 400 for
--    EVERY item in the feed, not just for the two employees.
UPDATE recruitment_recommendation SET id = 'a1d00000-0000-4000-8000-00005b00c001'
WHERE id = 'sb_rec_centrum_wznow'
  AND NOT EXISTS (SELECT 1 FROM recruitment_recommendation r
                  WHERE r.id = 'a1d00000-0000-4000-8000-00005b00c001');

UPDATE recruitment_recommendation SET id = 'a1d00000-0000-4000-8000-00005b00c002'
WHERE id = 'sb_rec_poludnie_wstrzymaj'
  AND NOT EXISTS (SELECT 1 FROM recruitment_recommendation r
                  WHERE r.id = 'a1d00000-0000-4000-8000-00005b00c002');

UPDATE recruitment_recommendation SET id = 'a1d00000-0000-4000-8000-00005b00c003'
WHERE id = 'sb_rec_polnoc_utrzymaj'
  AND NOT EXISTS (SELECT 1 FROM recruitment_recommendation r
                  WHERE r.id = 'a1d00000-0000-4000-8000-00005b00c003');

UPDATE recruitment_recommendation SET id = 'a1d00000-0000-4000-8000-00005b00c004'
WHERE id = 'sb_rec_lok_wznow'
  AND NOT EXISTS (SELECT 1 FROM recruitment_recommendation r
                  WHERE r.id = 'a1d00000-0000-4000-8000-00005b00c004');

-- 3) The APPROVED L4 leave that explains the excluded window on the gwiazda profile. Reachable via
--    `GET /wnioski/:id` from the Wnioski list, so it needs the same treatment.
UPDATE leave_requests SET id = 'a1d00000-0000-4000-8000-00005b00a001', updated_at = now()
WHERE id = 'sb_lr_l4_gwiazda'
  AND NOT EXISTS (SELECT 1 FROM leave_requests l WHERE l.id = 'a1d00000-0000-4000-8000-00005b00a001');

-- 4) The reproducible capacity-gap demand backing the WZNOW verdict; reachable via
--    `GET /grafik/demands/:id`.
UPDATE shift_demands SET id = 'a1d00000-0000-4000-8000-00005b00d001', updated_at = now()
WHERE id = 'sb_sd_understaffed'
  AND NOT EXISTS (SELECT 1 FROM shift_demands d WHERE d.id = 'a1d00000-0000-4000-8000-00005b00d001');

-- 5) Verification, printed by the script itself: after the updates NO strategic-brain demo row in a
--    UUID-contract table may still carry a slug. Anything listed here means the repair did not take.
SELECT 'STILL BROKEN' AS status, 'employees' AS "table", id
FROM employees WHERE id LIKE 'sb\_%'
UNION ALL SELECT 'STILL BROKEN', 'recruitment_recommendation', id
FROM recruitment_recommendation WHERE id LIKE 'sb\_%'
UNION ALL SELECT 'STILL BROKEN', 'leave_requests', id
FROM leave_requests WHERE id LIKE 'sb\_%'
UNION ALL SELECT 'STILL BROKEN', 'shift_demands', id
FROM shift_demands WHERE id LIKE 'sb\_%';

COMMIT;
