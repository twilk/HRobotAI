-- ============================================================================================
-- [L-1] REPAIR: Grafik/Wnioski demo rows whose primary key is NOT a UUID.
--
-- Sibling of scripts/fix-strategic-brain-id-contract.sql, closing the debt that script's guard
-- (apps/tenant-runtime/src/strategic-brain/seed-id-contract.spec.ts) recorded as KNOWN_ID_DEBT:
-- the `ds26-*` family from seed-dataset-2026.sql and the `lr-demo-*` family from
-- seed-demo-m2-modules.sql.
--
-- WHY. `leave_requests.id` and `shift_demands.id` are reachable as HTTP `:id` route params, and the
-- controllers validate them with Nest's `ParseUUIDPipe`:
--     leave_requests   GET /wnioski/:id, POST /wnioski/:id/decision, POST /wnioski/:id/cancel
--     shift_demands    GET /grafik/demands/:id
-- Measured on the live demo tenant BEFORE this repair:
--     GET  /api/wnioski/lr-demo-p1
--       -> 400 {"message":"Validation failed (uuid is expected)","error":"Bad Request","statusCode":400}
--     POST /api/wnioski/lr-demo-p1/decision  {"approve":true}   -> 400 (same body)
--     GET  /api/grafik/demands/ds26-0084a2a8ee3c12828cd2fdfb9763e7 -> 400 (same body)
--     GET  /api/wnioski/c908ad28-acf5-4096-9097-c1c2dbbf78ae       -> 200   (control, real UUID)
--     GET  /api/grafik/demands/01bf0019-dd47-55b0-9198-b19bf06b13c8 -> 200  (control, real UUID)
-- 608 of 686 shift_demands and 28 of 37 leave_requests were affected. `lr-demo-p1` and `lr-demo-p2`
-- are BOTH of the PENDING requests, i.e. the entire "Zatwierdź / Odrzuć" manager-approval demo on
-- the Wnioski screen (docs/design/web-kit/components/wnioski/wnioski-screen.tsx:147-153) answered
-- 400 on click.
--
-- WHAT IT DOES. Rekeys those rows in place, to exactly the ids the fixed seed scripts now generate,
-- so a repaired database and a freshly-seeded one are identical:
--     lr-demo-p1|p2|r1|dropout-1  ->  a1d00000-0000-4000-8000-000000000a01..a04  (fixed constants)
--     ds26-*                      ->  d5260000-0000-4000-8000- || left(md5(<natural key>), 12)
-- The `ds26-*` ids were never arbitrary — each is `'ds26-' || left(md5(<natural key>), 30)` over
-- columns the row still carries, so the natural key is recomputed FROM THE ROW and re-laid-out as a
-- UUID. Each UPDATE re-derives the OLD id the same way and matches on it, so a row whose id does not
-- actually come from that generator is left untouched rather than blindly renamed.
--   NB the `koord-jul` family changes natural key from `md5(id)` to `md5(id || '2026-07-20koord')`,
--   matching the fixed seed: the bare-employee-id key was the only one without a discriminator and
--   would have shared a hash space with any future family keyed on the employee alone.
--
-- WHY UPDATE AND NOT DELETE+INSERT. This script contains ZERO DELETEs. `shift_demands.id` has one
-- inbound FK — `shifts.demand_id`, declared ON UPDATE CASCADE ON DELETE SET NULL — so rekeying
-- carries every generated shift with it; a delete would have silently orphaned them (demand_id set
-- to NULL) and lost the demand->shift provenance the grafik screens rely on. `leave_requests` has no
-- inbound FKs at all.
--
-- IDEMPOTENT. Every statement matches only rows still carrying a legacy id, and is additionally
-- guarded by NOT EXISTS on the target id, so a second run is a no-op and running it against an
-- already-correct (freshly seeded) database does nothing.
--
-- Run (PowerShell 5.1 mangles UTF-8-without-BOM when piping into psql — copy the file, don't pipe):
--   docker cp scripts/fix-demo-id-contract-grafik-wnioski.sql hrobot-postgres-1:/tmp/fix-l1.sql
--   docker exec hrobot-postgres-1 psql -U postgres -d hrobot_t_900d948b -v ON_ERROR_STOP=1 -f /tmp/fix-l1.sql
-- ============================================================================================

BEGIN;

-- 1) WNIOSKI — the four hand-written demo rows from seed-demo-m2-modules.sql. `p1`/`p2` are the two
--    PENDING requests the manager-approval demo runs on; `r1` is the REJECTED example; `dropout-1`
--    is the APPROVED leave that makes the manager dashboard's "Wyjątki obsady" panel non-empty.
UPDATE leave_requests SET id = 'a1d00000-0000-4000-8000-000000000a01', updated_at = now()
WHERE id = 'lr-demo-p1'
  AND NOT EXISTS (SELECT 1 FROM leave_requests l WHERE l.id = 'a1d00000-0000-4000-8000-000000000a01');

UPDATE leave_requests SET id = 'a1d00000-0000-4000-8000-000000000a02', updated_at = now()
WHERE id = 'lr-demo-p2'
  AND NOT EXISTS (SELECT 1 FROM leave_requests l WHERE l.id = 'a1d00000-0000-4000-8000-000000000a02');

UPDATE leave_requests SET id = 'a1d00000-0000-4000-8000-000000000a03', updated_at = now()
WHERE id = 'lr-demo-r1'
  AND NOT EXISTS (SELECT 1 FROM leave_requests l WHERE l.id = 'a1d00000-0000-4000-8000-000000000a03');

UPDATE leave_requests SET id = 'a1d00000-0000-4000-8000-000000000a04', updated_at = now()
WHERE id = 'lr-demo-dropout-1'
  AND NOT EXISTS (SELECT 1 FROM leave_requests l WHERE l.id = 'a1d00000-0000-4000-8000-000000000a04');

-- 2) WNIOSKI — the generated summer-holiday cluster (seed-dataset-2026.sql §2).
UPDATE leave_requests lr
SET id = 'd5260000-0000-4000-8000-' || left(md5(lr.employee_id || lr.start_date::text || 'vac'), 12),
    updated_at = now()
WHERE lr.id = 'ds26-' || left(md5(lr.employee_id || lr.start_date::text || 'vac'), 30)
  AND NOT EXISTS (
    SELECT 1 FROM leave_requests x
    WHERE x.id = 'd5260000-0000-4000-8000-' || left(md5(lr.employee_id || lr.start_date::text || 'vac'), 12));

-- 3) WNIOSKI — the September coordinator block that makes the solver return INFEASIBLE (§3).
UPDATE leave_requests lr
SET id = 'd5260000-0000-4000-8000-' || left(md5(lr.employee_id || '2026-09-14koord'), 12),
    updated_at = now()
WHERE lr.id = 'ds26-' || left(md5(lr.employee_id || '2026-09-14koord'), 30)
  AND NOT EXISTS (
    SELECT 1 FROM leave_requests x
    WHERE x.id = 'd5260000-0000-4000-8000-' || left(md5(lr.employee_id || '2026-09-14koord'), 12));

-- 4) WNIOSKI — the July 20-26 coordinator block, the INFEASIBLE week one click from the hero week (§3b).
UPDATE leave_requests lr
SET id = 'd5260000-0000-4000-8000-' || left(md5(lr.employee_id || '2026-07-20koord'), 12),
    updated_at = now()
WHERE lr.id = 'ds26-koord-jul-' || left(md5(lr.employee_id), 20)
  AND NOT EXISTS (
    SELECT 1 FROM leave_requests x
    WHERE x.id = 'd5260000-0000-4000-8000-' || left(md5(lr.employee_id || '2026-07-20koord'), 12));

-- 5) GRAFIK — the Jun-Sep demand grid stamped from the canonical week (§1). The bulk of the debt:
--    608 of 686 rows. `shifts.demand_id` follows via ON UPDATE CASCADE.
UPDATE shift_demands d
SET id = 'd5260000-0000-4000-8000-'
         || left(md5(d.lokalizacja_id || d.date::text || d.required_role || d.start), 12),
    updated_at = now()
WHERE d.id = 'ds26-' || left(md5(d.lokalizacja_id || d.date::text || d.required_role || d.start), 30)
  AND NOT EXISTS (
    SELECT 1 FROM shift_demands x
    WHERE x.id = 'd5260000-0000-4000-8000-'
                 || left(md5(d.lokalizacja_id || d.date::text || d.required_role || d.start), 12));

-- 6) Verification, printed by the script itself. Anything listed here means the repair did not take:
--    a row in a UUID-contract table whose id would still make its controller answer 400.
SELECT 'STILL BROKEN' AS status, 'leave_requests' AS "table", id FROM leave_requests
WHERE id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
UNION ALL
SELECT 'STILL BROKEN', 'shift_demands', id FROM shift_demands
WHERE id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

COMMIT;
