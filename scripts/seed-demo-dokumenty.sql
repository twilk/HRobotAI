-- ============================================================================================
-- Moduł Dokumenty (M3) DEMO SEED (spec docs/superpowers/specs/2026-07-21-modul-dokumenty-SPEC.md
-- §8) — synthetic RCP (Rejestracja Czasu Pracy) events covering the ewidencja/nadgodziny/ZUS/
-- anomaly profiles the module's engine (rcp.util.ts / overtime.util.ts / kedu.util.ts, per §3/§13
-- of the plan) needs to demo against real data.
--
-- WHAT IT SEEDS (all SYNTHETIC, `sb_rcp_`-prefixed ids — never collides with any anchor or with the
--   strategic-brain seed's `sb_` rows in OTHER tables): `rcp_event` rows ONLY, `source='IMPORT'` so
--   every insert is deduplicated by the partial-unique index `rcp_event_dedup_import`
--   (employee_id, occurred_at, type) WHERE source IN ('IMPORT') — see §2.2 of the spec and the
--   20260721000000_dokumenty migration. Profiles covered (§8, at least 1 employee each):
--     1. normalny        — 5 weekdays x (WEJSCIE 08:00 / PRZERWA 12:00-12:30 / WYJSCIE 16:00) => 0 OT.
--     2. ot50             — 2 late-exit days (WYJSCIE ~18:30) => daily overtime at the 50% rate.
--     3. ot100_tydzien    — Mon-Thu normal + Fri late-exit (~18:30, contributes its own daily OT) +
--                           Saturday worked => week totals ~45.5h, deliberately mixing a REAL daily-OT
--                           day with a weekly-average overrun so the engine's "don't double-count
--                           hours already attributed to daily OT" rule (spec §3.2/DOK-4) has something
--                           non-trivial to prove against.
--     4. noc_niedziela    — one overnight shift squarely inside the demo night window (22:00-06:00
--                           Warsaw, spec §3.2 "pora nocna poglądowa") + one full Sunday day-shift =>
--                           both night and Sunday 100% premiums.
--     5. zus_absencja     — an employee with an EXISTING APPROVED LeaveRequest (never invented here;
--                           resolved at apply-time, see step 2 below) plus a couple of normal worked
--                           days => the ZUS/KEDU generator has both "worked" (RCA) and "absence" (RSA)
--                           material for this employee. The SAME employee also gets an RCP event
--                           stamped directly on their leave day => RCP_W_NIEOBECNOSCI null-policy
--                           anomaly (spec §3.1) — one employee, two related §8 bullets, deliberately.
--     6. niesparowane     — 4 normal days + 1 day with a lone WEJSCIE and NO matching WYJSCIE =>
--                           NIESPAROWANE null-policy anomaly.
--     7. brak_rcp         — resolved to an employee+date that already has an anchor `Shift` inside the
--                           demo week (13-19 Jul 2026). Deliberately NO INSERT for this profile: the
--                           anomaly IS the absence of an RCP event on a day the roster says they were
--                           scheduled (BRAK_RCP, spec §3.1) — nothing to seed except identifying WHICH
--                           employee/day it is (see the RAISE NOTICE summary at the bottom).
--
-- EMPLOYEE RESOLUTION — no UUIDs are hardcoded anywhere in this file. Every employee id is resolved
--   at APPLY TIME via JOINs against the live `employees` / `shifts` / `leave_requests` tables
--   (mirrors scripts/seed-demo-strategic-brain.sql's `sb_pick` pattern):
--     * normalny / ot50 / ot100_tydzien / noc_niedziela / niesparowane pick the 1st..5th employee by
--       (last_name, first_name), excluding the strategic-brain synthetic new-hire rows (`sb_emp_%`,
--       spec-irrelevant here);
--     * zus_absencja prefers an APPROVED leave that overlaps the demo week 13-19 Jul 2026 (e.g. the
--       `lr-demo-dropout-1` leave from seed-demo-m2-modules.sql, if already applied) and falls back
--       to the earliest APPROVED leave anywhere on the tenant if none overlaps that week;
--     * brak_rcp picks the earliest (employee, date) with an anchor Shift in the demo week, excluding
--       employees already used by the five ranked profiles above and by zus_absencja.
--   If any pick resolves to NULL (e.g. the tenant has fewer than 5 employees, or no APPROVED leave /
--   no demo-week Shift exists yet) the corresponding INSERT is a no-op (`WHERE emp_id IS NOT NULL`)
--   rather than erroring — never invents an employee.
--
-- DOES NOT TOUCH ANCHORS: only INSERTs into the greenfield `rcp_event` table (created by the
--   20260721000000_dokumenty migration). Never creates, updates, or deletes any `employees`,
--   `shifts`, `leave_requests`, or any other anchor/precedent-seed row (the 36-employee / 832-shift
--   roster and the strategic-brain / M2-modules synthetic additions are read-only inputs here).
--
-- TIMEZONE CONVENTION: `rcp_event.occurred_at` is stored as a naive TIMESTAMP(3) representing UTC
--   (spec §2.2/§3.1 — "occurredAt UTC w bazie; strefa lokalna liczona w silniku"). Poland is on CEST
--   (UTC+2) in July, so every literal below is written as the Warsaw wall-clock time MINUS 2 hours,
--   e.g. 08:00 Europe/Warsaw => 06:00 UTC. Each block is commented with both times so the mapping is
--   auditable without re-deriving it.
--
-- IDEMPOTENT: re-running first deletes only this script's own `sb_rcp_%`-prefixed rows, then
--   re-inserts under `ON CONFLICT (employee_id, occurred_at, type) WHERE source IN ('IMPORT')
--   DO NOTHING` (belt-and-suspenders with the delete — satisfies §8's explicit idempotency
--   requirement even if ids ever drift from the employee resolution above).
--
-- >>> DEPLOYMENT GATE (human, do NOT auto-apply) <<<
--   Apply by hand to the live tenant DB *after* the 20260721000000_dokumenty migration has been
--   applied AND its new tables reassigned (ALTER TABLE "rcp_event" OWNER TO hu_<tenant>; see that
--   migration's header + reference_hrobot_m2_deploy). Same human gate as the migration itself —
--   this script is authored only; nothing here has been run against any database.
-- ============================================================================================

BEGIN;

-- --------------------------------------------------------------------------------------------
-- 0) Idempotency: clear only rows this script created.
-- --------------------------------------------------------------------------------------------
DELETE FROM rcp_event WHERE id LIKE 'sb_rcp_%';

-- --------------------------------------------------------------------------------------------
-- 1) Resolve the 5 name-ranked profile employees (deterministic, stable across re-runs). Excludes
--    the strategic-brain synthetic new-hire rows (`sb_emp_%`) — recent placeholder hires with no
--    bearing on time-tracking demo scenarios.
-- --------------------------------------------------------------------------------------------
CREATE TEMP TABLE dok_ranked ON COMMIT DROP AS
SELECT e.id, row_number() OVER (ORDER BY e.last_name, e.first_name) AS rn
FROM employees e
WHERE e.id NOT LIKE 'sb_emp_%';

-- --------------------------------------------------------------------------------------------
-- 2) Resolve the ZUS-case employee via an EXISTING APPROVED leave (never invented here). Priority 1:
--    an APPROVED leave overlapping the demo week 13-19 Jul 2026 (e.g. the `lr-demo-dropout-1` leave
--    seeded by seed-demo-m2-modules.sql, if already applied). Priority 2 (fallback): the earliest
--    APPROVED leave anywhere on the tenant, whatever its actual dates — the RCP_W_NIEOBECNOSCI event
--    below is stamped on THAT leave's own start date, so the scenario is coherent even when it lands
--    outside the demo week.
-- --------------------------------------------------------------------------------------------
CREATE TEMP TABLE dok_leave_pick ON COMMIT DROP AS
SELECT emp_id, d0, d1
FROM (
  (
    SELECT lr.employee_id AS emp_id, lr.start_date AS d0, lr.end_date AS d1, 1 AS pri
    FROM leave_requests lr
    JOIN employees e ON e.id = lr.employee_id
    WHERE lr.status = 'APPROVED'::"LeaveStatus"
      AND e.id NOT LIKE 'sb_emp_%'
      AND lr.start_date <= DATE '2026-07-19'
      AND lr.end_date   >= DATE '2026-07-13'
    ORDER BY lr.id
    LIMIT 1
  )
  UNION ALL
  (
    SELECT lr.employee_id, lr.start_date, lr.end_date, 2 AS pri
    FROM leave_requests lr
    JOIN employees e ON e.id = lr.employee_id
    WHERE lr.status = 'APPROVED'::"LeaveStatus"
      AND e.id NOT LIKE 'sb_emp_%'
    ORDER BY lr.start_date, lr.id
    LIMIT 1
  )
) picks
ORDER BY pri
LIMIT 1;

-- --------------------------------------------------------------------------------------------
-- 3) Resolve the BRAK_RCP employee+date: earliest anchor Shift inside the demo week, excluding
--    employees already claimed by profiles 1-5/ZUS above (so this profile's "no RCP that day" is
--    never contradicted by another profile's events for the same employee/day).
-- --------------------------------------------------------------------------------------------
CREATE TEMP TABLE dok_shift_pick ON COMMIT DROP AS
SELECT s.employee_id AS emp_id, s.date::date AS d
FROM shifts s
JOIN employees e ON e.id = s.employee_id
WHERE e.id NOT LIKE 'sb_emp_%'
  AND s.date BETWEEN DATE '2026-07-13' AND DATE '2026-07-19'
  AND e.id NOT IN (SELECT id FROM dok_ranked WHERE rn <= 5)
  AND e.id <> COALESCE((SELECT emp_id FROM dok_leave_pick), '')
ORDER BY e.last_name, e.first_name, s.date
LIMIT 1;

-- --------------------------------------------------------------------------------------------
-- 4) Final profile -> employee_id mapping. NULL emp_id (too few employees / no matching leave or
--    shift yet) is handled per-profile below via `WHERE emp_id IS NOT NULL` — no profile ever
--    invents an employee.
-- --------------------------------------------------------------------------------------------
CREATE TEMP TABLE dok_pick ON COMMIT DROP AS
SELECT 'normalny'::text AS profile, (SELECT id FROM dok_ranked WHERE rn = 1) AS emp_id
UNION ALL SELECT 'ot50',          (SELECT id FROM dok_ranked WHERE rn = 2)
UNION ALL SELECT 'ot100_tydzien', (SELECT id FROM dok_ranked WHERE rn = 3)
UNION ALL SELECT 'noc_niedziela', (SELECT id FROM dok_ranked WHERE rn = 4)
UNION ALL SELECT 'niesparowane',  (SELECT id FROM dok_ranked WHERE rn = 5)
UNION ALL SELECT 'zus_absencja',  (SELECT emp_id FROM dok_leave_pick)
UNION ALL SELECT 'brak_rcp',      (SELECT emp_id FROM dok_shift_pick);

-- ==============================================================================================
-- PROFILE 1 — normalny: 5 weekdays x (WEJSCIE 08:00 / PRZERWA 12:00-12:30 / WYJSCIE 16:00 Warsaw
--   = 06:00 / 10:00-10:30 / 14:00 UTC). 7.5h worked/day => 0 nadgodzin.
-- ==============================================================================================
INSERT INTO rcp_event (id, employee_id, occurred_at, type, source, created_at)
SELECT 'sb_rcp_normalny_' || to_char(d.day, 'YYYYMMDD') || '_' || d.suffix,
       p.emp_id, d.ts, d.typ::"RcpEventType", 'IMPORT'::"RcpEventSource", now()
FROM dok_pick p
CROSS JOIN LATERAL (VALUES
  (DATE '2026-07-13', TIMESTAMP '2026-07-13 06:00:00', 'wejscie',  'WEJSCIE'),
  (DATE '2026-07-13', TIMESTAMP '2026-07-13 10:00:00', 'przerwas', 'PRZERWA_START'),
  (DATE '2026-07-13', TIMESTAMP '2026-07-13 10:30:00', 'przerwak', 'PRZERWA_KONIEC'),
  (DATE '2026-07-13', TIMESTAMP '2026-07-13 14:00:00', 'wyjscie',  'WYJSCIE'),
  (DATE '2026-07-14', TIMESTAMP '2026-07-14 06:00:00', 'wejscie',  'WEJSCIE'),
  (DATE '2026-07-14', TIMESTAMP '2026-07-14 10:00:00', 'przerwas', 'PRZERWA_START'),
  (DATE '2026-07-14', TIMESTAMP '2026-07-14 10:30:00', 'przerwak', 'PRZERWA_KONIEC'),
  (DATE '2026-07-14', TIMESTAMP '2026-07-14 14:00:00', 'wyjscie',  'WYJSCIE'),
  (DATE '2026-07-15', TIMESTAMP '2026-07-15 06:00:00', 'wejscie',  'WEJSCIE'),
  (DATE '2026-07-15', TIMESTAMP '2026-07-15 10:00:00', 'przerwas', 'PRZERWA_START'),
  (DATE '2026-07-15', TIMESTAMP '2026-07-15 10:30:00', 'przerwak', 'PRZERWA_KONIEC'),
  (DATE '2026-07-15', TIMESTAMP '2026-07-15 14:00:00', 'wyjscie',  'WYJSCIE'),
  (DATE '2026-07-16', TIMESTAMP '2026-07-16 06:00:00', 'wejscie',  'WEJSCIE'),
  (DATE '2026-07-16', TIMESTAMP '2026-07-16 10:00:00', 'przerwas', 'PRZERWA_START'),
  (DATE '2026-07-16', TIMESTAMP '2026-07-16 10:30:00', 'przerwak', 'PRZERWA_KONIEC'),
  (DATE '2026-07-16', TIMESTAMP '2026-07-16 14:00:00', 'wyjscie',  'WYJSCIE'),
  (DATE '2026-07-17', TIMESTAMP '2026-07-17 06:00:00', 'wejscie',  'WEJSCIE'),
  (DATE '2026-07-17', TIMESTAMP '2026-07-17 10:00:00', 'przerwas', 'PRZERWA_START'),
  (DATE '2026-07-17', TIMESTAMP '2026-07-17 10:30:00', 'przerwak', 'PRZERWA_KONIEC'),
  (DATE '2026-07-17', TIMESTAMP '2026-07-17 14:00:00', 'wyjscie',  'WYJSCIE')
) AS d(day, ts, suffix, typ)
WHERE p.profile = 'normalny' AND p.emp_id IS NOT NULL
ON CONFLICT (employee_id, occurred_at, type) WHERE source IN ('IMPORT') DO NOTHING;

-- ==============================================================================================
-- PROFILE 2 — ot50: Mon/Tue/Wed normal; Thu+Fri late exit 18:30 Warsaw (16:30 UTC) => ~9.5h worked,
--   1.5h over the 8h daily norm => daily overtime at the 50% rate on both days.
-- ==============================================================================================
INSERT INTO rcp_event (id, employee_id, occurred_at, type, source, created_at)
SELECT 'sb_rcp_ot50_' || to_char(d.day, 'YYYYMMDD') || '_' || d.suffix,
       p.emp_id, d.ts, d.typ::"RcpEventType", 'IMPORT'::"RcpEventSource", now()
FROM dok_pick p
CROSS JOIN LATERAL (VALUES
  (DATE '2026-07-13', TIMESTAMP '2026-07-13 06:00:00', 'wejscie',  'WEJSCIE'),
  (DATE '2026-07-13', TIMESTAMP '2026-07-13 10:00:00', 'przerwas', 'PRZERWA_START'),
  (DATE '2026-07-13', TIMESTAMP '2026-07-13 10:30:00', 'przerwak', 'PRZERWA_KONIEC'),
  (DATE '2026-07-13', TIMESTAMP '2026-07-13 14:00:00', 'wyjscie',  'WYJSCIE'),
  (DATE '2026-07-14', TIMESTAMP '2026-07-14 06:00:00', 'wejscie',  'WEJSCIE'),
  (DATE '2026-07-14', TIMESTAMP '2026-07-14 10:00:00', 'przerwas', 'PRZERWA_START'),
  (DATE '2026-07-14', TIMESTAMP '2026-07-14 10:30:00', 'przerwak', 'PRZERWA_KONIEC'),
  (DATE '2026-07-14', TIMESTAMP '2026-07-14 14:00:00', 'wyjscie',  'WYJSCIE'),
  (DATE '2026-07-15', TIMESTAMP '2026-07-15 06:00:00', 'wejscie',  'WEJSCIE'),
  (DATE '2026-07-15', TIMESTAMP '2026-07-15 10:00:00', 'przerwas', 'PRZERWA_START'),
  (DATE '2026-07-15', TIMESTAMP '2026-07-15 10:30:00', 'przerwak', 'PRZERWA_KONIEC'),
  (DATE '2026-07-15', TIMESTAMP '2026-07-15 14:00:00', 'wyjscie',  'WYJSCIE'),
  -- Thu: late exit 18:30 Warsaw = 16:30 UTC => ot50
  (DATE '2026-07-16', TIMESTAMP '2026-07-16 06:00:00', 'wejscie',  'WEJSCIE'),
  (DATE '2026-07-16', TIMESTAMP '2026-07-16 10:00:00', 'przerwas', 'PRZERWA_START'),
  (DATE '2026-07-16', TIMESTAMP '2026-07-16 10:30:00', 'przerwak', 'PRZERWA_KONIEC'),
  (DATE '2026-07-16', TIMESTAMP '2026-07-16 16:30:00', 'wyjscie',  'WYJSCIE'),
  -- Fri: late exit 18:30 Warsaw = 16:30 UTC => ot50
  (DATE '2026-07-17', TIMESTAMP '2026-07-17 06:00:00', 'wejscie',  'WEJSCIE'),
  (DATE '2026-07-17', TIMESTAMP '2026-07-17 10:00:00', 'przerwas', 'PRZERWA_START'),
  (DATE '2026-07-17', TIMESTAMP '2026-07-17 10:30:00', 'przerwak', 'PRZERWA_KONIEC'),
  (DATE '2026-07-17', TIMESTAMP '2026-07-17 16:30:00', 'wyjscie',  'WYJSCIE')
) AS d(day, ts, suffix, typ)
WHERE p.profile = 'ot50' AND p.emp_id IS NOT NULL
ON CONFLICT (employee_id, occurred_at, type) WHERE source IN ('IMPORT') DO NOTHING;

-- ==============================================================================================
-- PROFILE 3 — ot100_tydzien: Mon-Thu normal (4 x 7.5h = 30h); Fri late exit 18:30 Warsaw (16:30 UTC,
--   its OWN 1.5h daily-OT contributor, deliberately mixed in); Saturday worked 08:00-14:00 Warsaw
--   (06:00-12:00 UTC, no break, 6h, not a normal working day). Weekly total ~45.5h => weekly-average
--   overtime at the 100% rate, while Friday's 1.5h is ALREADY counted as daily OT — the engine must
--   not double-count those hours again in the weekly-100% bucket (spec §3.2/DOK-4).
-- ==============================================================================================
INSERT INTO rcp_event (id, employee_id, occurred_at, type, source, created_at)
SELECT 'sb_rcp_ot100tydz_' || to_char(d.day, 'YYYYMMDD') || '_' || d.suffix,
       p.emp_id, d.ts, d.typ::"RcpEventType", 'IMPORT'::"RcpEventSource", now()
FROM dok_pick p
CROSS JOIN LATERAL (VALUES
  (DATE '2026-07-13', TIMESTAMP '2026-07-13 06:00:00', 'wejscie',  'WEJSCIE'),
  (DATE '2026-07-13', TIMESTAMP '2026-07-13 10:00:00', 'przerwas', 'PRZERWA_START'),
  (DATE '2026-07-13', TIMESTAMP '2026-07-13 10:30:00', 'przerwak', 'PRZERWA_KONIEC'),
  (DATE '2026-07-13', TIMESTAMP '2026-07-13 14:00:00', 'wyjscie',  'WYJSCIE'),
  (DATE '2026-07-14', TIMESTAMP '2026-07-14 06:00:00', 'wejscie',  'WEJSCIE'),
  (DATE '2026-07-14', TIMESTAMP '2026-07-14 10:00:00', 'przerwas', 'PRZERWA_START'),
  (DATE '2026-07-14', TIMESTAMP '2026-07-14 10:30:00', 'przerwak', 'PRZERWA_KONIEC'),
  (DATE '2026-07-14', TIMESTAMP '2026-07-14 14:00:00', 'wyjscie',  'WYJSCIE'),
  (DATE '2026-07-15', TIMESTAMP '2026-07-15 06:00:00', 'wejscie',  'WEJSCIE'),
  (DATE '2026-07-15', TIMESTAMP '2026-07-15 10:00:00', 'przerwas', 'PRZERWA_START'),
  (DATE '2026-07-15', TIMESTAMP '2026-07-15 10:30:00', 'przerwak', 'PRZERWA_KONIEC'),
  (DATE '2026-07-15', TIMESTAMP '2026-07-15 14:00:00', 'wyjscie',  'WYJSCIE'),
  (DATE '2026-07-16', TIMESTAMP '2026-07-16 06:00:00', 'wejscie',  'WEJSCIE'),
  (DATE '2026-07-16', TIMESTAMP '2026-07-16 10:00:00', 'przerwas', 'PRZERWA_START'),
  (DATE '2026-07-16', TIMESTAMP '2026-07-16 10:30:00', 'przerwak', 'PRZERWA_KONIEC'),
  (DATE '2026-07-16', TIMESTAMP '2026-07-16 14:00:00', 'wyjscie',  'WYJSCIE'),
  -- Fri: late exit 18:30 Warsaw = 16:30 UTC (own daily-OT contributor)
  (DATE '2026-07-17', TIMESTAMP '2026-07-17 06:00:00', 'wejscie',  'WEJSCIE'),
  (DATE '2026-07-17', TIMESTAMP '2026-07-17 10:00:00', 'przerwas', 'PRZERWA_START'),
  (DATE '2026-07-17', TIMESTAMP '2026-07-17 10:30:00', 'przerwak', 'PRZERWA_KONIEC'),
  (DATE '2026-07-17', TIMESTAMP '2026-07-17 16:30:00', 'wyjscie',  'WYJSCIE'),
  -- Sat: 08:00-14:00 Warsaw = 06:00-12:00 UTC, no break, weekend work pushing the week over 40h
  (DATE '2026-07-18', TIMESTAMP '2026-07-18 06:00:00', 'wejscie',  'WEJSCIE'),
  (DATE '2026-07-18', TIMESTAMP '2026-07-18 12:00:00', 'wyjscie',  'WYJSCIE')
) AS d(day, ts, suffix, typ)
WHERE p.profile = 'ot100_tydzien' AND p.emp_id IS NOT NULL
ON CONFLICT (employee_id, occurred_at, type) WHERE source IN ('IMPORT') DO NOTHING;

-- ==============================================================================================
-- PROFILE 4 — noc_niedziela: an overnight shift squarely inside the demo night window (22:00-06:00
--   Warsaw, spec §3.2) crossing Tue 14 Jul into Wed 15 Jul (22:00 Warsaw Tue = 20:00 UTC Tue;
--   06:00 Warsaw Wed = 04:00 UTC Wed) + a full Sunday (19 Jul) day-shift (08:00-16:00 Warsaw =
--   06:00-14:00 UTC) => both the night-work and Sunday-work 100% premiums (spec §3.2, poglądowo).
-- ==============================================================================================
INSERT INTO rcp_event (id, employee_id, occurred_at, type, source, created_at)
SELECT 'sb_rcp_nocniedz_' || d.suffix,
       p.emp_id, d.ts, d.typ::"RcpEventType", 'IMPORT'::"RcpEventSource", now()
FROM dok_pick p
CROSS JOIN LATERAL (VALUES
  -- Overnight shift: WEJSCIE Tue 14.07 22:00 Warsaw = 20:00 UTC
  (TIMESTAMP '2026-07-14 20:00:00', 'noc_wejscie',  'WEJSCIE'),
  -- short break: 02:00-02:15 Warsaw Wed 15.07 = 00:00-00:15 UTC
  (TIMESTAMP '2026-07-15 00:00:00', 'noc_przerwas', 'PRZERWA_START'),
  (TIMESTAMP '2026-07-15 00:15:00', 'noc_przerwak', 'PRZERWA_KONIEC'),
  -- WYJSCIE Wed 15.07 06:00 Warsaw = 04:00 UTC
  (TIMESTAMP '2026-07-15 04:00:00', 'noc_wyjscie',  'WYJSCIE'),
  -- Sunday day-shift 19.07: 08:00-16:00 Warsaw = 06:00-14:00 UTC
  (TIMESTAMP '2026-07-19 06:00:00', 'niedz_wejscie',  'WEJSCIE'),
  (TIMESTAMP '2026-07-19 10:00:00', 'niedz_przerwas', 'PRZERWA_START'),
  (TIMESTAMP '2026-07-19 10:30:00', 'niedz_przerwak', 'PRZERWA_KONIEC'),
  (TIMESTAMP '2026-07-19 14:00:00', 'niedz_wyjscie',  'WYJSCIE')
) AS d(ts, suffix, typ)
WHERE p.profile = 'noc_niedziela' AND p.emp_id IS NOT NULL
ON CONFLICT (employee_id, occurred_at, type) WHERE source IN ('IMPORT') DO NOTHING;

-- ==============================================================================================
-- PROFILE 5 — niesparowane: Tue-Fri normal; Mon 13.07 has a LONE WEJSCIE (08:00 Warsaw = 06:00 UTC)
--   with NO matching WYJSCIE that day => NIESPAROWANE null-policy anomaly (spec §3.1).
-- ==============================================================================================
INSERT INTO rcp_event (id, employee_id, occurred_at, type, source, created_at)
SELECT 'sb_rcp_niesparowane_' || to_char(d.day, 'YYYYMMDD') || '_' || d.suffix,
       p.emp_id, d.ts, d.typ::"RcpEventType", 'IMPORT'::"RcpEventSource", now()
FROM dok_pick p
CROSS JOIN LATERAL (VALUES
  -- Mon: lone WEJSCIE, deliberately no WYJSCIE
  (DATE '2026-07-13', TIMESTAMP '2026-07-13 06:00:00', 'wejscie',  'WEJSCIE'),
  (DATE '2026-07-14', TIMESTAMP '2026-07-14 06:00:00', 'wejscie',  'WEJSCIE'),
  (DATE '2026-07-14', TIMESTAMP '2026-07-14 10:00:00', 'przerwas', 'PRZERWA_START'),
  (DATE '2026-07-14', TIMESTAMP '2026-07-14 10:30:00', 'przerwak', 'PRZERWA_KONIEC'),
  (DATE '2026-07-14', TIMESTAMP '2026-07-14 14:00:00', 'wyjscie',  'WYJSCIE'),
  (DATE '2026-07-15', TIMESTAMP '2026-07-15 06:00:00', 'wejscie',  'WEJSCIE'),
  (DATE '2026-07-15', TIMESTAMP '2026-07-15 10:00:00', 'przerwas', 'PRZERWA_START'),
  (DATE '2026-07-15', TIMESTAMP '2026-07-15 10:30:00', 'przerwak', 'PRZERWA_KONIEC'),
  (DATE '2026-07-15', TIMESTAMP '2026-07-15 14:00:00', 'wyjscie',  'WYJSCIE'),
  (DATE '2026-07-16', TIMESTAMP '2026-07-16 06:00:00', 'wejscie',  'WEJSCIE'),
  (DATE '2026-07-16', TIMESTAMP '2026-07-16 10:00:00', 'przerwas', 'PRZERWA_START'),
  (DATE '2026-07-16', TIMESTAMP '2026-07-16 10:30:00', 'przerwak', 'PRZERWA_KONIEC'),
  (DATE '2026-07-16', TIMESTAMP '2026-07-16 14:00:00', 'wyjscie',  'WYJSCIE'),
  (DATE '2026-07-17', TIMESTAMP '2026-07-17 06:00:00', 'wejscie',  'WEJSCIE'),
  (DATE '2026-07-17', TIMESTAMP '2026-07-17 10:00:00', 'przerwas', 'PRZERWA_START'),
  (DATE '2026-07-17', TIMESTAMP '2026-07-17 10:30:00', 'przerwak', 'PRZERWA_KONIEC'),
  (DATE '2026-07-17', TIMESTAMP '2026-07-17 14:00:00', 'wyjscie',  'WYJSCIE')
) AS d(day, ts, suffix, typ)
WHERE p.profile = 'niesparowane' AND p.emp_id IS NOT NULL
ON CONFLICT (employee_id, occurred_at, type) WHERE source IN ('IMPORT') DO NOTHING;

-- ==============================================================================================
-- PROFILE 6 — zus_absencja: two normal demo-week days (worked material for RCA) for the employee
--   resolved in step 2 (an EXISTING APPROVED LeaveRequest — never invented here).
-- ==============================================================================================
INSERT INTO rcp_event (id, employee_id, occurred_at, type, source, created_at)
SELECT 'sb_rcp_zus_' || to_char(d.day, 'YYYYMMDD') || '_' || d.suffix,
       p.emp_id, d.ts, d.typ::"RcpEventType", 'IMPORT'::"RcpEventSource", now()
FROM dok_pick p
CROSS JOIN LATERAL (VALUES
  (DATE '2026-07-13', TIMESTAMP '2026-07-13 06:00:00', 'wejscie',  'WEJSCIE'),
  (DATE '2026-07-13', TIMESTAMP '2026-07-13 10:00:00', 'przerwas', 'PRZERWA_START'),
  (DATE '2026-07-13', TIMESTAMP '2026-07-13 10:30:00', 'przerwak', 'PRZERWA_KONIEC'),
  (DATE '2026-07-13', TIMESTAMP '2026-07-13 14:00:00', 'wyjscie',  'WYJSCIE'),
  (DATE '2026-07-14', TIMESTAMP '2026-07-14 06:00:00', 'wejscie',  'WEJSCIE'),
  (DATE '2026-07-14', TIMESTAMP '2026-07-14 10:00:00', 'przerwas', 'PRZERWA_START'),
  (DATE '2026-07-14', TIMESTAMP '2026-07-14 10:30:00', 'przerwak', 'PRZERWA_KONIEC'),
  (DATE '2026-07-14', TIMESTAMP '2026-07-14 14:00:00', 'wyjscie',  'WYJSCIE')
) AS d(day, ts, suffix, typ)
WHERE p.profile = 'zus_absencja' AND p.emp_id IS NOT NULL
ON CONFLICT (employee_id, occurred_at, type) WHERE source IN ('IMPORT') DO NOTHING;

-- 6b) RCP_W_NIEOBECNOSCI anomaly: a full WEJSCIE/PRZERWA/WYJSCIE pattern stamped directly on the
--     SAME employee's resolved leave day (dok_leave_pick.d0 — whatever date that actually is; see
--     step 2's comment on the priority/fallback resolution). 08:00/12:00/12:30/16:00 Warsaw =
--     06:00/10:00/10:30/14:00 UTC on that date.
INSERT INTO rcp_event (id, employee_id, occurred_at, type, source, created_at)
SELECT 'sb_rcp_zus_leaveday_' || to_char(lp.d0, 'YYYYMMDD') || '_' || d.suffix,
       lp.emp_id, (lp.d0::timestamp + d.delta), d.typ::"RcpEventType", 'IMPORT'::"RcpEventSource", now()
FROM dok_leave_pick lp
CROSS JOIN LATERAL (VALUES
  (interval '6 hours',  'wejscie',  'WEJSCIE'),
  (interval '10 hours', 'przerwas', 'PRZERWA_START'),
  (interval '10.5 hours', 'przerwak', 'PRZERWA_KONIEC'),
  (interval '14 hours', 'wyjscie',  'WYJSCIE')
) AS d(delta, suffix, typ)
WHERE lp.emp_id IS NOT NULL
ON CONFLICT (employee_id, occurred_at, type) WHERE source IN ('IMPORT') DO NOTHING;

-- ==============================================================================================
-- PROFILE 7 — brak_rcp: deliberately NO INSERT. The anomaly is the ABSENCE of an RCP event on a day
--   the roster (anchor `shifts`) says this employee was scheduled — resolved in step 3 above. Summary
--   below reports which (employee_id, date) this refers to.
-- ==============================================================================================

-- --------------------------------------------------------------------------------------------
-- Summary — reports what got resolved (and any profile skipped for lack of matching data), so a
-- human running this by hand can immediately see which employees to look up in the /dokumenty UI.
-- --------------------------------------------------------------------------------------------
DO $$
DECLARE r RECORD;
BEGIN
  RAISE NOTICE '--- seed-demo-dokumenty.sql resolution summary ---';
  FOR r IN SELECT profile, emp_id FROM dok_pick ORDER BY profile LOOP
    IF r.emp_id IS NULL THEN
      RAISE NOTICE 'profile % : SKIPPED (no matching employee/leave/shift found)', r.profile;
    ELSE
      RAISE NOTICE 'profile % : employee_id = %', r.profile, r.emp_id;
    END IF;
  END LOOP;
  FOR r IN SELECT emp_id, d0, d1 FROM dok_leave_pick LOOP
    RAISE NOTICE 'zus_absencja leave window: employee_id = %, % .. %', r.emp_id, r.d0, r.d1;
  END LOOP;
  FOR r IN SELECT emp_id, d FROM dok_shift_pick LOOP
    RAISE NOTICE 'brak_rcp day (no RCP inserted on purpose): employee_id = %, date = %', r.emp_id, r.d;
  END LOOP;
END $$;

COMMIT;
