-- Extends the demo tenant (hrobot_t_900d948b) to a coherent June–September 2026 dataset.
--
-- HOLISTIC INTENT: the team, catalog (15 locations, 3 templates, 4 units) and the demo fortnight
-- (Jul 13–26) already exist and are well-designed — this ONLY adds the missing months. It replicates
-- the proven weekly demand pattern (the Jul 13–19 week) onto every other week in Jun–Sep, and clusters
-- realistic summer leave. Everything it creates carries the `d5260000-0000-4000-8000-` id namespace
-- so it is idempotent (re-run safe) and can never collide with or delete the demo anchors (demo
-- users, Anna's shifts, the Jul 13–26 demands/shifts, the seeded J5 swap).
--
-- [L-1] ID CONTRACT. Ids here used to read `'ds26-' || left(md5(<natural key>), 30)`. Both tables
-- this script writes are addressed by an HTTP `:id` guarded by Nest's `ParseUUIDPipe`
-- (`GET /grafik/demands/:id`; `GET /wnioski/:id`, `POST /wnioski/:id/decision`, `.../cancel`), so a
-- readable slug was a guaranteed 400 on every request for such a row — 608 of 686 demands and 24 of
-- 37 leave requests on the live demo tenant. The rows CANNOT carry literal ids (their count is a
-- cross product of the pattern week and 16 target Mondays — data-driven, not source-driven), so the
-- derivation was reshaped instead: the same md5 of the same natural key, laid out as a real UUID.
--
-- Layout: `d5260000-0000-4000-8000-` ++ 12 hex from md5(natural key). Version nibble `4`, variant
-- nibble `8`, so it satisfies ParseUUIDPipe and the seed guard alike. Kept deterministic on purpose —
-- `ON CONFLICT (id) DO NOTHING` and the sweep below both depend on re-runs producing the same ids.
--
-- WHY A DEDICATED NAMESPACE AND NOT THE `a1d00000-…` DEMO FAMILY: the idempotency sweep below is a
-- prefix match, and `a1d00000-0000-4000-8000-%` would also match the strategic-brain anchors
-- (…00005b00a001 leave, …00005b00d001 demand) — the sweep would DELETE another track's demo rows.
-- A separate namespace makes that impossible by construction. Pinned by
-- apps/tenant-runtime/src/strategic-brain/seed-id-contract.spec.ts.
--
-- Run: docker exec -i hrobot-postgres-1 psql -U postgres -d hrobot_t_900d948b < scripts/seed-dataset-2026.sql
-- An existing tenant seeded before [L-1] is migrated in place (rekey, no deletes) by
-- scripts/fix-demo-id-contract-grafik-wnioski.sql — run that FIRST on such a database.
-- Shifts for the new weeks are generated afterwards by the solver (see seed-dataset-2026.mjs).

BEGIN;

-- Idempotency: clear only rows this script created. The legacy `ds26-%` sweep is kept so that a
-- database still holding pre-[L-1] rows (never migrated) does not end up with both generations.
DELETE FROM shift_demands  WHERE id LIKE 'd5260000-0000-4000-8000-%' OR id LIKE 'ds26-%';
DELETE FROM leave_requests WHERE id LIKE 'd5260000-0000-4000-8000-%' OR id LIKE 'ds26-%';

-- 1. DEMANDS — stamp the canonical week (Jul 13–19) onto every target Monday in Jun–Sep, preserving
--    day-of-week, location, role, count and hours. Skip the two weeks that already exist (Jul 13, 20).
WITH pattern AS (
  SELECT lokalizacja_id, (date - DATE '2026-07-13') AS dow, start, "end", required_role, required_count
  FROM shift_demands
  -- Exclude this script's own output so a re-run never re-derives the pattern from generated rows.
  -- (Belt and braces: no target Monday's week overlaps Jul 13–19, so nothing generated lands here.)
  WHERE date BETWEEN DATE '2026-07-13' AND DATE '2026-07-19'
    AND id NOT LIKE 'd5260000-0000-4000-8000-%' AND id NOT LIKE 'ds26-%'
),
targets(mon) AS (VALUES
  (DATE '2026-06-01'),(DATE '2026-06-08'),(DATE '2026-06-15'),(DATE '2026-06-22'),(DATE '2026-06-29'),
  (DATE '2026-07-06'),(DATE '2026-07-27'),
  (DATE '2026-08-03'),(DATE '2026-08-10'),(DATE '2026-08-17'),(DATE '2026-08-24'),(DATE '2026-08-31'),
  (DATE '2026-09-07'),(DATE '2026-09-14'),(DATE '2026-09-21'),(DATE '2026-09-28')
)
INSERT INTO shift_demands (id, lokalizacja_id, date, start, "end", required_role, required_count, source, created_at, updated_at)
SELECT
  'd5260000-0000-4000-8000-' || left(md5(p.lokalizacja_id || (t.mon + p.dow)::text || p.required_role || p.start), 12),
  p.lokalizacja_id, t.mon + p.dow, p.start, p."end", p.required_role, p.required_count, 'TEMPLATE', now(), now()
FROM pattern p CROSS JOIN targets t
ON CONFLICT (id) DO NOTHING;

-- 2. LEAVE — realistic summer cluster (urlop wypoczynkowy). One-week blocks staggered across Jun–Aug
--    for every 2nd employee. APPROVED if it already started (today = 2026-07-12), else a PENDING/APPROVED
--    mix. HARD RULE: no Region Centrum leave overlapping the demo week (Jul 13–19) so that week stays
--    feasible and Anna keeps her shifts.
WITH emp AS (
  SELECT e.id, ou.name AS unit, row_number() OVER (ORDER BY e.id) AS rn
  FROM employees e JOIN organizational_units ou ON e.unit_id = ou.id
),
vac AS (
  SELECT id, unit, (DATE '2026-06-01' + (((rn * 9) % 82)) * INTERVAL '1 day')::date AS sd
  FROM emp WHERE rn % 2 = 0
)
INSERT INTO leave_requests (id, employee_id, start_date, end_date, status, type, created_at, updated_at)
SELECT
  'd5260000-0000-4000-8000-' || left(md5(id || sd::text || 'vac'), 12),
  id, sd, sd + 6,
  (CASE WHEN sd < DATE '2026-07-12' THEN 'APPROVED'
        WHEN (extract(day FROM sd)::int % 3) = 0 THEN 'PENDING'
        ELSE 'APPROVED' END)::"LeaveStatus",
  'URLOP_WYPOCZYNKOWY', now(), now()
FROM vac
WHERE NOT (unit = 'Region Centrum' AND sd <= DATE '2026-07-19' AND sd + 6 >= DATE '2026-07-13')
ON CONFLICT (id) DO NOTHING;

-- 3. INTENTIONAL INFEASIBILITY (showcase) — all KOORDYNATOR-qualified staff on leave Sep 14–20, so any
--    demand needing a coordinator that week cannot be met → solver returns INFEASIBLE + unmet[]. Well
--    clear of the demo week.
INSERT INTO leave_requests (id, employee_id, start_date, end_date, status, type, created_at, updated_at)
SELECT
  'd5260000-0000-4000-8000-' || left(md5(id || '2026-09-14koord'), 12),
  id, DATE '2026-09-14', DATE '2026-09-20', 'APPROVED'::"LeaveStatus", 'URLOP_WYPOCZYNKOWY', now(), now()
FROM employees WHERE 'KOORDYNATOR' = ANY(qualifications)
ON CONFLICT (id) DO NOTHING;

-- 3b. INTENTIONAL INFEASIBILITY, adjacent to the hero week — all coordinators on leave 20–26 July
--     (the week right after the demo fortnight). Lets the 10-min demo show INFEASIBLE ONE click from
--     the hero week (13–19) instead of navigating to September. Does not overlap 13–19, so Anna keeps
--     her hero-week shifts and the J5 swap is untouched.
INSERT INTO leave_requests (id, employee_id, start_date, end_date, status, type, created_at, updated_at)
SELECT
  'd5260000-0000-4000-8000-' || left(md5(id || '2026-07-20koord'), 12),
  id, DATE '2026-07-20', DATE '2026-07-26', 'APPROVED'::"LeaveStatus", 'URLOP_WYPOCZYNKOWY', now(), now()
FROM employees WHERE 'KOORDYNATOR' = ANY(qualifications)
ON CONFLICT (id) DO NOTHING;
-- Clear pre-existing AUTO shifts for 20–26 so the week presents EMPTY. Then a live "Generuj grafik"
-- returns INFEASIBLE against an empty grid (clean demo), rather than showing stale shifts. The J5 swap
-- references only 13–14 July shifts, so this delete never touches it.
DELETE FROM shifts WHERE date BETWEEN DATE '2026-07-20' AND DATE '2026-07-26';

COMMIT;

-- Report
SELECT 'demands by month' AS report, to_char(date,'YYYY-MM') AS m, count(*) FROM shift_demands GROUP BY 2 ORDER BY 2;
SELECT 'leave by month/status' AS report, to_char(start_date,'YYYY-MM') AS m, status::text, count(*) FROM leave_requests GROUP BY 2,3 ORDER BY 2,3;
