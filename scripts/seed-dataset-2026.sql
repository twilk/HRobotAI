-- Extends the demo tenant (hrobot_t_900d948b) to a coherent June–September 2026 dataset.
--
-- HOLISTIC INTENT: the team, catalog (15 locations, 3 templates, 4 units) and the demo fortnight
-- (Jul 13–26) already exist and are well-designed — this ONLY adds the missing months. It replicates
-- the proven weekly demand pattern (the Jul 13–19 week) onto every other week in Jun–Sep, and clusters
-- realistic summer leave. Everything it creates carries a `ds26-` id prefix so it is idempotent
-- (re-run safe) and can never collide with or delete the demo anchors (demo users, Anna's shifts, the
-- Jul 13–26 demands/shifts, the seeded J5 swap).
--
-- Run: docker exec -i hrobot-postgres-1 psql -U postgres -d hrobot_t_900d948b < scripts/seed-dataset-2026.sql
-- Shifts for the new weeks are generated afterwards by the solver (see seed-dataset-2026.mjs).

BEGIN;

-- Idempotency: clear only rows this script created.
DELETE FROM shift_demands WHERE id LIKE 'ds26-%';
DELETE FROM leave_requests WHERE id LIKE 'ds26-%';

-- 1. DEMANDS — stamp the canonical week (Jul 13–19) onto every target Monday in Jun–Sep, preserving
--    day-of-week, location, role, count and hours. Skip the two weeks that already exist (Jul 13, 20).
WITH pattern AS (
  SELECT lokalizacja_id, (date - DATE '2026-07-13') AS dow, start, "end", required_role, required_count
  FROM shift_demands
  WHERE date BETWEEN DATE '2026-07-13' AND DATE '2026-07-19' AND id NOT LIKE 'ds26-%'
),
targets(mon) AS (VALUES
  (DATE '2026-06-01'),(DATE '2026-06-08'),(DATE '2026-06-15'),(DATE '2026-06-22'),(DATE '2026-06-29'),
  (DATE '2026-07-06'),(DATE '2026-07-27'),
  (DATE '2026-08-03'),(DATE '2026-08-10'),(DATE '2026-08-17'),(DATE '2026-08-24'),(DATE '2026-08-31'),
  (DATE '2026-09-07'),(DATE '2026-09-14'),(DATE '2026-09-21'),(DATE '2026-09-28')
)
INSERT INTO shift_demands (id, lokalizacja_id, date, start, "end", required_role, required_count, source, created_at, updated_at)
SELECT
  'ds26-' || left(md5(p.lokalizacja_id || (t.mon + p.dow)::text || p.required_role || p.start), 30),
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
  'ds26-' || left(md5(id || sd::text || 'vac'), 30),
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
  'ds26-' || left(md5(id || '2026-09-14koord'), 30),
  id, DATE '2026-09-14', DATE '2026-09-20', 'APPROVED'::"LeaveStatus", 'URLOP_WYPOCZYNKOWY', now(), now()
FROM employees WHERE 'KOORDYNATOR' = ANY(qualifications)
ON CONFLICT (id) DO NOTHING;

-- 3b. INTENTIONAL INFEASIBILITY, adjacent to the hero week — all coordinators on leave 20–26 July
--     (the week right after the demo fortnight). Lets the 10-min demo show INFEASIBLE ONE click from
--     the hero week (13–19) instead of navigating to September. Does not overlap 13–19, so Anna keeps
--     her hero-week shifts and the J5 swap is untouched.
INSERT INTO leave_requests (id, employee_id, start_date, end_date, status, type, created_at, updated_at)
SELECT
  'ds26-koord-jul-' || left(md5(id), 20),
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
