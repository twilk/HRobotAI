-- ============================================================================================
-- strategic-brain DEMO SEED (spec §9/§5, plan Task 11) — synthetic performance-trajectory data.
--
-- WHAT IT SEEDS (all SYNTHETIC, `sb_`-prefixed ids — never collides with any anchor):
--   * A current-window operational backdrop: `work_order` (DONE) + `complaint` rows for EVERY
--     employee, so the peer-normalised `performance` dimension (spec §14 M10) actually has a
--     populated peer group to rank against. Six employees are tuned to a trajectory profile; the
--     rest are a neutral "solid" baseline (~13 on-time orders, 1 complaint) that gives the weak
--     profiles a real low rank instead of an artificially high one.
--   * A multi-window `employee_performance_snapshot` SERIES (3–5 prior windows + the current
--     epoch-aligned window) for six employees, baked to realise ALL SIX trajectory profiles so the
--     analiza screen distinguishes them ON LOAD, before any scheduler tick:
--        1. gwiazda-stabilna    high composite, slope ~0            -> UTRZYMAC   (Anna Kowalska)
--        2. dobry-spadajacy     high composite, slope < 0           -> RYZYKO
--        3. slaby-rosnacy       low composite,  slope > minSlope    -> INWESTOWAC (the money shot)
--        4. slaby-plaski        low composite,  slope ~0            -> RYZYKO
--        5. nowy-rosnacy        rising, recent hire, low confidence -> OBSERWOWAC
--        6. nowy-plaski         flat,   recent hire, low confidence -> OBSERWOWAC
--   * One `L4`-excluded historical window on the gwiazda (Anna) + a matching APPROVED `L4`
--     LeaveRequest overlapping it — the demo proof that a return-from-sick-leave window does NOT
--     drag the trend down (finalizeWindow skips `excluded_reason IS NOT NULL` windows).
--   * A reproducible capacity gap (`shift_demands` with no covering `shifts`) at one lokalizacja,
--     backing a WZNOW recruitment verdict (spec §14 B5: gap = requiredCount - assigned Shift count).
--   * Initial immutable `recruitment_recommendation` events (replaces_recommendation_id = NULL) so
--     the recruitment feed shows WZNOW + WSTRZYMAJ + UTRZYMAJ immediately (no scheduler wait, B3).
--
-- IDEMPOTENT: re-running deletes only its own `sb_`-prefixed rows first, then re-inserts. Synthetic
--   employees are kept via ON CONFLICT. Re-running also RESETS the demo (restores the baked snapshot
--   values, undoing any scheduler-recompute drift on the current window).
--
-- DOES NOT TOUCH ANCHORS: it only INSERTs new rows in its own/greenfield tables. It never UPDATEs or
--   DELETEs any of the 36 anchor employees, the 832 anchor shifts, the anchor demands, or the
--   AI-Grafik APPROVED-leave anchors. The two `sb_emp_new*` rows are ADDITIVE synthetic employees
--   (same precedent as Katarzyna Zajac in seed-demo-m2-modules.sql), needed because the "nowy"
--   profiles require a recent hired_at that no anchor has and that we are forbidden to backfill.
--
-- >>> DEPLOYMENT GATE (human, do NOT auto-apply) <<<
--   Apply by hand to the live tenant DB *after* the 20260714000000_strategic_brain migration has
--   been applied AND its new tables reassigned (ALTER TABLE ... OWNER TO hu_<tenant>; see that
--   migration's header + reference_hrobot_m2_deploy). This script is authored only; a human runs it,
--   the same gate as the migration itself.
-- ============================================================================================

BEGIN;

-- --------------------------------------------------------------------------------------------
-- 0) Idempotency: clear only rows THIS script created (children -> parents). Synthetic employees
--    are intentionally NOT deleted (kept stable via ON CONFLICT below).
-- --------------------------------------------------------------------------------------------
DELETE FROM complaint                       WHERE id LIKE 'sb_cmp_%';
DELETE FROM work_order                      WHERE id LIKE 'sb_wo_%';
DELETE FROM employee_performance_snapshot   WHERE id LIKE 'sb_sn_%';
DELETE FROM recruitment_recommendation      WHERE id LIKE 'sb_rec_%';
DELETE FROM shifts                          WHERE id LIKE 'sb_sh_%';
DELETE FROM shift_demands                   WHERE id LIKE 'sb_sd_%';
DELETE FROM leave_requests                  WHERE id LIKE 'sb_lr_%';

-- --------------------------------------------------------------------------------------------
-- 1) Synthetic NEW-HIRE employees (additive, like Katarzyna Zajac). Recent hired_at (< the default
--    confidenceMinDays = 30) is what makes SnapshotService compute a genuinely low confidence +
--    is_new_hire = true even after a scheduler recompute — no anchor has a recent hired_at and we
--    must not modify anchors, so the "nowy" profiles need their own rows. They live in Region
--    Centrum so the demo MANAGER (manager.demo, scoped to Region Centrum) sees them too. No user
--    link (userId NULL) and clearly-marked, non-decryptable placeholder pesel/pesel_hash (this is a
--    SQL-only stage with no EncryptionService key; employees.service only ever decrypts pesel inside
--    a try/catch for a masked peselLast4, so a placeholder is safe).
-- --------------------------------------------------------------------------------------------
INSERT INTO employees
  (id, user_id, first_name, last_name, pesel, pesel_hash, position, employment_type, hired_at,
   unit_id, home_address, home_lat, home_lng, etat, qualifications, created_at, updated_at)
SELECT 'sb_emp_new1', NULL, 'Tomasz', 'Nowacki',
       'DEMO-PLACEHOLDER-UNENCRYPTED-PESEL-SB-NEW1',
       'demo-placeholder-pesel-hash-strategic-brain-new1',
       'Recepcjonista', 'UMOWA_O_PRACE'::"EmploymentType", (now() - interval '22 days'),
       ou.id, NULL, NULL, NULL, 1, ARRAY[]::text[], now(), now()
FROM organizational_units ou
WHERE ou.name = 'Region Centrum'
  AND NOT EXISTS (SELECT 1 FROM employees WHERE id = 'sb_emp_new1');

INSERT INTO employees
  (id, user_id, first_name, last_name, pesel, pesel_hash, position, employment_type, hired_at,
   unit_id, home_address, home_lat, home_lng, etat, qualifications, created_at, updated_at)
SELECT 'sb_emp_new2', NULL, 'Ewa', 'Lewandowska',
       'DEMO-PLACEHOLDER-UNENCRYPTED-PESEL-SB-NEW2',
       'demo-placeholder-pesel-hash-strategic-brain-new2',
       'Recepcjonista', 'UMOWA_O_PRACE'::"EmploymentType", (now() - interval '19 days'),
       ou.id, NULL, NULL, NULL, 1, ARRAY[]::text[], now(), now()
FROM organizational_units ou
WHERE ou.name = 'Region Centrum'
  AND NOT EXISTS (SELECT 1 FROM employees WHERE id = 'sb_emp_new2');

-- --------------------------------------------------------------------------------------------
-- 2) Context temp tables (dropped at COMMIT).
--    sb_ctx: the CURRENT epoch-aligned windows, computed with the SAME math as the scheduler
--      (StrategicBrainScheduler.currentWindow / currentWeekStart): floor(now/period)*period. `ws`
--      therefore matches the window the scheduler will UPSERT, so the seeded current-window (widx 4)
--      row is UPDATED in place on the next tick, never duplicated. `AT TIME ZONE 'UTC'` yields the
--      naive-UTC wall clock Prisma stores for a @db.Timestamp column.
--    windowDays=14 -> 1 209 600 s ; capacity week=7 d -> 604 800 s (both default config values).
-- --------------------------------------------------------------------------------------------
CREATE TEMP TABLE sb_ctx ON COMMIT DROP AS
SELECT
  (to_timestamp(floor(extract(epoch FROM now())/1209600.0)*1209600.0)      AT TIME ZONE 'UTC')::timestamp(3) AS ws,
  (to_timestamp((floor(extract(epoch FROM now())/1209600.0)+1)*1209600.0)  AT TIME ZONE 'UTC')::timestamp(3) AS we,
  (to_timestamp(floor(extract(epoch FROM now())/604800.0)*604800.0)        AT TIME ZONE 'UTC')::timestamp(3) AS wk_start;

-- sb_pick: resolve the SIX profile employees to REAL ids (no invented ids).
--   * gwiazda = Anna Kowalska, resolved through pracownik.demo's login (the PRACOWNIK self-view /
--     employee/me lands on her card — a deliberately positive self-view: UTRZYMAC).
--   * dobry / rosnacy / plaski = three OTHER Region Centrum anchors, picked deterministically by
--     (last_name, first_name) so the pick is stable across re-runs and lands in the manager's scope.
--   * nowy_* = the two synthetic new hires from step 1.
--   If Region Centrum has < 3 non-Anna anchors, a pick is NULL and that profile is simply skipped
--   (every downstream insert filters emp_id IS NOT NULL) rather than erroring.
CREATE TEMP TABLE sb_pick ON COMMIT DROP AS
WITH anna AS (
  SELECT e.id FROM employees e JOIN users u ON e.user_id = u.id
  WHERE u.email = 'pracownik.demo@demo.hrobot.local'
),
centrum AS (SELECT id AS unit_id FROM organizational_units WHERE name = 'Region Centrum'),
others AS (
  SELECT e.id, row_number() OVER (ORDER BY e.last_name, e.first_name) AS rn
  FROM employees e, centrum c
  WHERE e.unit_id = c.unit_id
    AND e.id <> COALESCE((SELECT id FROM anna), '')
    AND e.id NOT LIKE 'sb_emp_%'
)
SELECT 'gwiazda'::text      AS profile, (SELECT id FROM anna)          AS emp_id
UNION ALL SELECT 'dobry',        (SELECT id FROM others WHERE rn = 1)
UNION ALL SELECT 'rosnacy',      (SELECT id FROM others WHERE rn = 2)
UNION ALL SELECT 'plaski',       (SELECT id FROM others WHERE rn = 3)
UNION ALL SELECT 'nowy_rosnacy', 'sb_emp_new1'
UNION ALL SELECT 'nowy_plaski',  'sb_emp_new2';

-- --------------------------------------------------------------------------------------------
-- 3) Current-window WORK ORDERS (DONE) for EVERY employee + tuned counts for the six profiles.
--    Why everyone: performance is a PEER PERCENTILE (spec §14 M10). Without a populated peer group
--    a lone weak employee would rank ~top (nobody to be below), inflating their composite on a
--    scheduler recompute. A neutral "solid" baseline (throughput 13, 85% on-time, 1 complaint) for
--    the rest gives the weak profiles (throughput 5–6) a real LOW rank, keeping them on-narrative.
--    on-time := completed within due_at (assignedAt + 120 min); late := +210 min (> due).
--    NB: this is the current window only; a scheduler recompute overwrites the six current-window
--    snapshots from THESE rows, so their raw signals (throughput / SLA / defects) stay on-narrative.
--    The trend SLOPE, however, is driven by the untouched HISTORICAL snapshots (step 4) and is the
--    robust, load-bearing signal that distinguishes rosnacy (INWESTOWAC) from dobry (RYZYKO).
-- --------------------------------------------------------------------------------------------
CREATE TEMP TABLE sb_empwo ON COMMIT DROP AS
SELECT e.id AS emp_id,
  CASE
    WHEN e.id = (SELECT emp_id FROM sb_pick WHERE profile='gwiazda') THEN 22
    WHEN e.id = (SELECT emp_id FROM sb_pick WHERE profile='dobry')   THEN 15
    WHEN e.id = (SELECT emp_id FROM sb_pick WHERE profile='rosnacy') THEN 6
    WHEN e.id = (SELECT emp_id FROM sb_pick WHERE profile='plaski')  THEN 5
    ELSE 13
  END AS wo_count,
  CASE
    WHEN e.id = (SELECT emp_id FROM sb_pick WHERE profile='gwiazda') THEN 95
    WHEN e.id = (SELECT emp_id FROM sb_pick WHERE profile='dobry')   THEN 80
    WHEN e.id = (SELECT emp_id FROM sb_pick WHERE profile='rosnacy') THEN 45
    WHEN e.id = (SELECT emp_id FROM sb_pick WHERE profile='plaski')  THEN 42
    ELSE 85
  END AS ontime_pct,
  CASE
    WHEN e.id = (SELECT emp_id FROM sb_pick WHERE profile='gwiazda') THEN 1
    WHEN e.id = (SELECT emp_id FROM sb_pick WHERE profile='dobry')   THEN 2
    WHEN e.id = (SELECT emp_id FROM sb_pick WHERE profile='rosnacy') THEN 2
    WHEN e.id = (SELECT emp_id FROM sb_pick WHERE profile='plaski')  THEN 2
    ELSE 1
  END AS complaints
FROM employees e
WHERE e.id NOT LIKE 'sb_emp_%'
UNION ALL SELECT 'sb_emp_new1', 5, 60, 1
UNION ALL SELECT 'sb_emp_new2', 4, 50, 1;

INSERT INTO work_order
  (id, assigned_to_employee_id, assigned_by_operator_id, assigned_at, due_at, completed_at,
   status, lokalizacja_id, kind, created_at)
SELECT
  'sb_wo_' || w.emp_id || '_' || g.i,
  w.emp_id, NULL,
  (c.ws + ((g.i - 1) * interval '6 hours'))::timestamp(3),
  (c.ws + ((g.i - 1) * interval '6 hours') + interval '120 minutes')::timestamp(3),
  (c.ws + ((g.i - 1) * interval '6 hours')
        + (CASE WHEN g.i <= floor(w.wo_count * w.ontime_pct / 100.0)
                THEN interval '60 minutes' ELSE interval '210 minutes' END))::timestamp(3),
  'DONE'::"WorkOrderStatus", NULL,
  (ARRAY['SERWIS_FLOTY','WYDANIE_POJAZDU','KONTROLA_STANU'])[1 + (g.i % 3)],
  now()
FROM sb_empwo w
CROSS JOIN sb_ctx c
CROSS JOIN LATERAL generate_series(1, w.wo_count) AS g(i)
ON CONFLICT (id) DO NOTHING;

INSERT INTO complaint (id, work_order_id, employee_id, category, severity, created_at)
SELECT
  'sb_cmp_' || w.emp_id || '_' || g.j,
  NULL, w.emp_id,
  (ARRAY['CZAS_REALIZACJI','JAKOSC_OBSLUGI','KOMPLETNOSC'])[1 + (g.j % 3)],
  (CASE WHEN g.j = 1 THEN 'MAJOR' ELSE 'MINOR' END)::"ComplaintSeverity",
  (c.ws + (g.j * interval '2 days'))::timestamp(3)
FROM sb_empwo w
CROSS JOIN sb_ctx c
CROSS JOIN LATERAL generate_series(1, w.complaints) AS g(j)
WHERE w.complaints > 0
ON CONFLICT (id) DO NOTHING;

-- --------------------------------------------------------------------------------------------
-- 4) The multi-window SNAPSHOT SERIES per profile (the trend). Window index widx maps to
--    [ws - (4-widx)*14d, +14d): widx 4 = current window, 3/2/1/0 = the prior windows. Historical
--    windows are NEVER recomputed by the scheduler (it only finalizes the current window), so their
--    baked composite_score drives developmentSlope robustly. The baked development_slope on widx 4
--    is the OLS slope over each profile's non-excluded composite series, matching what
--    RecommendationService.finalizeWindow would compute:
--       gwiazda 83,84,(52 L4 skipped),83,84 -> +0.20 ; dobry 86,80,73,66 -> -6.70
--       rosnacy 25,33,41,45 -> +6.80        ; plaski 38,37,39,38 -> +0.20
--       nowy_rosnacy 30,38,47 -> +8.50      ; nowy_plaski 34,33,34 -> 0.00
--    Retention signal (retentionSignal, cfg minSlopeForGrowth=0.5 / confidenceMin=0.5), evaluated
--    on the current (widx 4) composite+slope+confidence:
--       gwiazda 84 / +0.2 / .90 -> UTRZYMAC        dobry 66 / -6.7 / .85 -> RYZYKO
--       rosnacy 45 / +6.8 / .70 -> INWESTOWAC      plaski 38 / +0.2 / .75 -> RYZYKO
--       nowy_*  low confidence (.30 < .50)  -> OBSERWOWAC (never RYZYKO — "too new to judge")
--    config_hash = configHash(default PerformanceConfig fields) = 8f48eedbf9c86be7 (matches what the
--    scheduler stamps under the default config, so seeded rows don't read as a stale cache).
-- --------------------------------------------------------------------------------------------
INSERT INTO employee_performance_snapshot
  (id, employee_id, window_start, window_end, throughput, median_cycle_minutes, sla_hit_rate,
   defect_rate, composite_score, development_slope, confidence, peer_group_key, is_new_hire,
   excluded_reason, algorithm_version, config_hash, computed_at)
SELECT
  'sb_sn_' || d.profile || '_' || d.widx,
  p.emp_id,
  (c.ws - ((4 - d.widx) * interval '14 days'))::timestamp(3),
  (c.ws - ((4 - d.widx) * interval '14 days') + interval '14 days')::timestamp(3),
  d.thru, NULL, d.sla::numeric, d.defect::numeric, d.comp::numeric, d.slope::numeric, d.conf::numeric,
  (e.position || '|' || e.unit_id || '|' || e.etat::text),
  d.is_new, d.excl, 1, '8f48eedbf9c86be7', now()
FROM (VALUES
  -- profile,        widx, comp, sla,  defect, thru, conf, excl,  slope, is_new
  ('gwiazda',      0, 83, 0.93, 0.04, 20, 0.88, NULL,  NULL, false),
  ('gwiazda',      1, 84, 0.94, 0.03, 21, 0.89, NULL,  NULL, false),
  ('gwiazda',      2, 52, 0.70, 0.10,  8, 0.60, 'L4',  NULL, false),  -- sick-leave dip, EXCLUDED
  ('gwiazda',      3, 83, 0.93, 0.04, 20, 0.90, NULL,  NULL, false),
  ('gwiazda',      4, 84, 0.95, 0.045,22, 0.90, NULL,  0.2,  false),
  ('dobry',        1, 86, 0.90, 0.05, 20, 0.85, NULL,  NULL, false),
  ('dobry',        2, 80, 0.85, 0.07, 18, 0.85, NULL,  NULL, false),
  ('dobry',        3, 73, 0.80, 0.10, 16, 0.85, NULL,  NULL, false),
  ('dobry',        4, 66, 0.78, 0.12, 15, 0.85, NULL, -6.7,  false),
  ('rosnacy',      1, 25, 0.35, 0.35,  4, 0.65, NULL,  NULL, false),
  ('rosnacy',      2, 33, 0.40, 0.30,  5, 0.68, NULL,  NULL, false),
  ('rosnacy',      3, 41, 0.45, 0.28,  6, 0.70, NULL,  NULL, false),
  ('rosnacy',      4, 45, 0.45, 0.28,  6, 0.70, NULL,  6.8,  false),
  ('plaski',       1, 38, 0.55, 0.18,  8, 0.75, NULL,  NULL, false),
  ('plaski',       2, 37, 0.54, 0.19,  7, 0.75, NULL,  NULL, false),
  ('plaski',       3, 39, 0.56, 0.18,  8, 0.75, NULL,  NULL, false),
  ('plaski',       4, 38, 0.55, 0.18,  7, 0.75, NULL,  0.2,  false),
  ('nowy_rosnacy', 2, 30, 0.50, 0.20,  3, 0.28, NULL,  NULL, true),
  ('nowy_rosnacy', 3, 38, 0.55, 0.18,  4, 0.30, NULL,  NULL, true),
  ('nowy_rosnacy', 4, 47, 0.60, 0.17,  5, 0.30, NULL,  8.5,  true),
  ('nowy_plaski',  2, 34, 0.55, 0.16,  3, 0.28, NULL,  NULL, true),
  ('nowy_plaski',  3, 33, 0.54, 0.17,  4, 0.30, NULL,  NULL, true),
  ('nowy_plaski',  4, 34, 0.56, 0.16,  4, 0.30, NULL,  0.0,  true)
) AS d(profile, widx, comp, sla, defect, thru, conf, excl, slope, is_new)
JOIN sb_pick p   ON p.profile = d.profile
JOIN employees e ON e.id = p.emp_id
CROSS JOIN sb_ctx c
WHERE p.emp_id IS NOT NULL
ON CONFLICT (employee_id, window_start, window_end) DO NOTHING;

-- 4b) The APPROVED L4 leave that EXPLAINS the excluded gwiazda window (widx 2, [ws-28d, ws-14d)).
--     type 'L4' -> SnapshotService.mapLeaveTypeToExclusion -> 'L4'. It sits ~2–4 weeks before the
--     current window (well before the Jul demo fortnight), so it never disturbs the live grafik/AI
--     scan. This is the demo proof that a return-from-L4 window is skipped, not counted against the
--     trend.
INSERT INTO leave_requests
  (id, employee_id, start_date, end_date, status, type, created_at, updated_at,
   decided_at, decided_by_user_id, reason)
SELECT 'sb_lr_l4_gwiazda', p.emp_id,
  (c.ws - interval '27 days')::date, (c.ws - interval '16 days')::date,
  'APPROVED'::"LeaveStatus", 'L4', now(), now(),
  (c.ws - interval '30 days')::timestamp,
  (SELECT id FROM users WHERE email = 'manager.demo@demo.hrobot.local'),
  'Zwolnienie lekarskie (L4)'
FROM sb_pick p CROSS JOIN sb_ctx c
WHERE p.profile = 'gwiazda' AND p.emp_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- --------------------------------------------------------------------------------------------
-- 5) Reproducible CAPACITY GAP (spec §14 B5) backing a WZNOW: a ShiftDemand in the current epoch
--    week with NO covering shifts -> capacityGap(lokalizacja, weekStart).byRole gap = requiredCount
--    (2) - assigned (0) = +2. One lokalizacja, deterministically chosen. (A "stable/above-target"
--    lokalizacja is represented by the seeded WSTRZYMAJ recommendation's frozen factors in step 6 —
--    no extra anchor shifts needed, keeping the grafik demo untouched.)
-- --------------------------------------------------------------------------------------------
INSERT INTO shift_demands
  (id, lokalizacja_id, date, start, "end", required_role, required_count, source, created_at, updated_at)
SELECT 'sb_sd_understaffed', (SELECT id FROM lokalizacje ORDER BY name LIMIT 1),
  (c.wk_start + interval '2 days')::date, '08:00', '16:00', 'Koordynator zmiany', 2,
  'MANUAL'::"DemandSource", now(), now()
FROM sb_ctx c
WHERE EXISTS (SELECT 1 FROM lokalizacje)
ON CONFLICT (id) DO NOTHING;

-- --------------------------------------------------------------------------------------------
-- 6) Initial immutable RECRUITMENT recommendations (B3: replaces_recommendation_id = NULL for the
--    first event per scope; frozen factors JSON; Polish rationale). Emitted so the feed is populated
--    immediately, before the first scheduler tick.
--
--    SCOPE <-> MANAGER VISIBILITY (flag from Task 9, documented choice): the controller filters a
--    MANAGER's recruitment view by `scopeId IN managedUnitIds`, and managedUnitIds(manager.demo)
--    returns his MANAGER UserRole.unit_id — the Region Centrum OrganizationalUnit id (pinned by
--    seed-demo-m2-modules.sql). The filter is a pure membership test and ignores scope_type, so the
--    manager-visible recommendation is scoped scope_type='UNIT', scope_id = manager.demo's managed
--    unit id (resolved directly from his UserRole below — guaranteed to equal what managedUnitIds
--    returns). UNIT scope is also SCHEDULER-IMMUNE: the scheduler only ever emits LOKALIZACJA-scoped
--    recommendations (one per lokalizacja), so these curated UNIT events are never superseded or
--    deduped by a tick — WZNOW/WSTRZYMAJ/UTRZYMAJ stay visible through the live 5-minute cadence.
-- --------------------------------------------------------------------------------------------

-- 6a) Region Centrum (UNIT) -> WZNOW  [the MANAGER-VISIBLE one; backed by the step-5 capacity gap]
INSERT INTO recruitment_recommendation
  (id, scope_type, scope_id, verdict, rationale, factors, replaces_recommendation_id,
   computed_at, acknowledged_by_user_id, acknowledged_at)
SELECT 'sb_rec_centrum_wznow', 'UNIT'::"RecoScopeType", ur.unit_id, 'WZNOW'::"RecruitmentVerdict",
  'Luka kadrowa w Regionie Centrum wg zapotrzebowania grafiku (Koordynator zmiany: brak 2 osob w biezacym tygodniu). Zalecane wznowienie rekrutacji.',
  jsonb_build_object(
    'totalGap', 2,
    'byRole', jsonb_build_array(jsonb_build_object('role','Koordynator zmiany','required',2,'assigned',0,'gap',2)),
    'avgDefectRate', 0.14, 'avgSlaHitRate', 0.72,
    'defectThreshold', 0.1, 'slaTargetRate', 0.8,
    'qualityBelowTarget', true, 'timelinessBelowTarget', true,
    'employeeCount', 6,
    'weekStart', (SELECT to_char(wk_start, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') FROM sb_ctx)),
  NULL, now(), NULL, NULL
FROM user_roles ur JOIN users u ON ur.user_id = u.id
WHERE u.email = 'manager.demo@demo.hrobot.local'
  AND ur.role = 'MANAGER'::"Role" AND ur.unit_id IS NOT NULL
LIMIT 1
ON CONFLICT (id) DO NOTHING;

-- 6b) Region Poludnie (UNIT) -> WSTRZYMAJ  [covered / above target: halt recruitment]
INSERT INTO recruitment_recommendation
  (id, scope_type, scope_id, verdict, rationale, factors, replaces_recommendation_id,
   computed_at, acknowledged_by_user_id, acknowledged_at)
SELECT 'sb_rec_poludnie_wstrzymaj', 'UNIT'::"RecoScopeType", ou.id, 'WSTRZYMAJ'::"RecruitmentVerdict",
  'Obsada w Regionie Poludnie pokryta (nadwyzka wzgledem zapotrzebowania) i metryki w normie. Zalecane wstrzymanie rekrutacji.',
  jsonb_build_object(
    'totalGap', -1,
    'byRole', jsonb_build_array(jsonb_build_object('role','Recepcjonista','required',3,'assigned',4,'gap',-1)),
    'avgDefectRate', 0.05, 'avgSlaHitRate', 0.9,
    'defectThreshold', 0.1, 'slaTargetRate', 0.8,
    'qualityBelowTarget', false, 'timelinessBelowTarget', false,
    'employeeCount', 6,
    'weekStart', (SELECT to_char(wk_start, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') FROM sb_ctx)),
  NULL, now(), NULL, NULL
FROM organizational_units ou WHERE ou.name = 'Region Południe'
ON CONFLICT (id) DO NOTHING;

-- 6c) Region Polnoc (UNIT) -> UTRZYMAJ  [covered but quality below target: fix process, not headcount]
INSERT INTO recruitment_recommendation
  (id, scope_type, scope_id, verdict, rationale, factors, replaces_recommendation_id,
   computed_at, acknowledged_by_user_id, acknowledged_at)
SELECT 'sb_rec_polnoc_utrzymaj', 'UNIT'::"RecoScopeType", ou.id, 'UTRZYMAJ'::"RecruitmentVerdict",
  'Obsada w Regionie Polnoc pokryta, ale ponizej celu (jakosc). Utrzymac stan, poprawic proces bez zwiekszania obsady.',
  jsonb_build_object(
    'totalGap', 0,
    'byRole', jsonb_build_array(jsonb_build_object('role','Kierowca','required',3,'assigned',3,'gap',0)),
    'avgDefectRate', 0.16, 'avgSlaHitRate', 0.85,
    'defectThreshold', 0.1, 'slaTargetRate', 0.8,
    'qualityBelowTarget', true, 'timelinessBelowTarget', false,
    'employeeCount', 6,
    'weekStart', (SELECT to_char(wk_start, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') FROM sb_ctx)),
  NULL, now(), NULL, NULL
FROM organizational_units ou WHERE ou.name = 'Region Północ'
ON CONFLICT (id) DO NOTHING;

-- 6d) Understaffed LOKALIZACJA -> WZNOW  [the reproducible location-scoped event that matches what
--     the scheduler will (re)emit for this lokalizacja from the step-5 gap; same verdict, so a later
--     scheduler event just chains onto it via replaces_recommendation_id — never contradicts it].
INSERT INTO recruitment_recommendation
  (id, scope_type, scope_id, verdict, rationale, factors, replaces_recommendation_id,
   computed_at, acknowledged_by_user_id, acknowledged_at)
SELECT 'sb_rec_lok_wznow', 'LOKALIZACJA'::"RecoScopeType", (SELECT id FROM lokalizacje ORDER BY name LIMIT 1),
  'WZNOW'::"RecruitmentVerdict",
  'Luka kadrowa w lokalizacji wg zapotrzebowania grafiku (Koordynator zmiany: brak 2 osob). Zalecane wznowienie rekrutacji.',
  jsonb_build_object(
    'totalGap', 2,
    'byRole', jsonb_build_array(jsonb_build_object('role','Koordynator zmiany','required',2,'assigned',0,'gap',2)),
    'avgDefectRate', 0.14, 'avgSlaHitRate', 0.72,
    'defectThreshold', 0.1, 'slaTargetRate', 0.8,
    'qualityBelowTarget', true, 'timelinessBelowTarget', true,
    'employeeCount', 6,
    'weekStart', (SELECT to_char(wk_start, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') FROM sb_ctx)),
  NULL, now(), NULL, NULL
FROM sb_ctx
WHERE EXISTS (SELECT 1 FROM lokalizacje)
ON CONFLICT (id) DO NOTHING;

COMMIT;
