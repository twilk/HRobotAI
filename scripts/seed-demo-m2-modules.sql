-- Demo dataset for the M2 modules (Wnioski · Ustawienia · Dostępy · Użytkownicy · Koszty),
-- consistent with the live 4Mobility tenant (36 employees / 3 regions / 15 lokalizacje).
-- SYNTHETIC only. Idempotent (fixed ids / guarded inserts). Applied to hrobot_t_900d948b.
-- Preserves anchors: employees (36), shifts (832), and the 26 APPROVED leaves that drive the
-- AI-Grafik drop-out scan (status unchanged; only decider attribution is backfilled).
-- Additive: +1 employee (Katarzyna Zając / pracownica.demo, §6 below) — the cross-unit travel
-- demo candidate from the 2026-07-14 replacement-travel spec; does not touch the 36 anchors.
--
-- Ownership note (raw-SQL apply as postgres): the target tables already exist and are owned by
-- hu_900d948b (created by the create-only migrations, ownership fixed), so no ALTER OWNER needed here.

BEGIN;

-- 1) USTAWIENIA — company singleton -------------------------------------------------
DELETE FROM company_settings;
INSERT INTO company_settings (id, company_name, timezone, region, locale, created_at, updated_at)
VALUES ('cs-4mobility-0001', '4Mobility sp. z o.o.', 'Europe/Warsaw', 'EU-Central', 'pl-PL', now(), now());

-- 2) UŻYTKOWNICY — give the `demo` ADMIN_KLIENTA a real User row (it had a KC login but no User
--    row, so it could not be a leave decider / grant issuer). manager.demo + pracownik.demo already
--    have rows. Makes the Użytkownicy list show all 3 accounts with roles.
INSERT INTO users (id, email, keycloak_sub, active, created_at)
VALUES ('a1d00000-0000-4000-8000-00000000ad11', 'admin@staging.hrobot.local',
        '9c60d8ab-f757-4a9b-8590-fccf8cde74b3', true, now())
ON CONFLICT (email) DO NOTHING;
INSERT INTO user_roles (user_id, role, unit_id)
SELECT 'a1d00000-0000-4000-8000-00000000ad11', 'ADMIN_KLIENTA'::"Role", NULL
WHERE NOT EXISTS (
  SELECT 1 FROM user_roles
  WHERE user_id = 'a1d00000-0000-4000-8000-00000000ad11' AND role = 'ADMIN_KLIENTA'::"Role" AND unit_id IS NULL
);

-- 2c) USTAWIENIA org-chart managers: Region Centrum is managed by manager.demo (matching his MANAGER
--     UserRole scope); the other units have no org-chart manager assigned yet — a realistic governance
--     gap the Admin dashboard's "Zdrowie organizacji" surfaces as "Jednostki bez managera".
UPDATE organizational_units SET manager_user_id = (SELECT id FROM users WHERE email = 'manager.demo@demo.hrobot.local')
  WHERE name = 'Region Centrum';
UPDATE organizational_units SET manager_user_id = NULL
  WHERE name IN ('4Mobility — Operacje', 'Region Południe', 'Region Północ');

-- 3) KOSZTY — a cost rate for every (position, employment_type) present in the roster, so the weekly
--    cost calculator has full coverage (no missing rates). PLN/h, plausible 2026 values.
INSERT INTO position_cost_rates (id, position, employment_type, hourly_rate, overtime_multiplier, currency, created_at, updated_at) VALUES
  ('pcr-01','Recepcjonista',      'UMOWA_O_PRACE'::"EmploymentType",  34.00, 1.5, 'PLN', now(), now()),
  ('pcr-02','Recepcjonista',      'UMOWA_ZLECENIE'::"EmploymentType", 33.00, 1.5, 'PLN', now(), now()),
  ('pcr-03','Recepcjonista',      'UMOWA_O_DZIELO'::"EmploymentType", 35.00, 1.5, 'PLN', now(), now()),
  ('pcr-04','Recepcjonista',      'B2B'::"EmploymentType",            52.00, 1.5, 'PLN', now(), now()),
  ('pcr-05','Kierowca',           'UMOWA_ZLECENIE'::"EmploymentType", 41.00, 1.5, 'PLN', now(), now()),
  ('pcr-06','Kierowca',           'UMOWA_O_DZIELO'::"EmploymentType", 43.00, 1.5, 'PLN', now(), now()),
  ('pcr-07','Koordynator zmiany', 'UMOWA_O_PRACE'::"EmploymentType",  54.00, 1.5, 'PLN', now(), now()),
  ('pcr-08','Koordynator zmiany', 'UMOWA_ZLECENIE'::"EmploymentType", 57.00, 1.5, 'PLN', now(), now()),
  ('pcr-09','Serwisant floty',    'UMOWA_O_PRACE'::"EmploymentType",  47.00, 1.5, 'PLN', now(), now()),
  ('pcr-10','Serwisant floty',    'B2B'::"EmploymentType",            72.00, 1.5, 'PLN', now(), now())
ON CONFLICT (position, employment_type) DO NOTHING;

-- 4) DOSTĘPY — 15 access grants, one per employee (first 15 by name) paired 1:1 with a lokalizacja.
--    Mostly ACTIVE cards/keys; grants 13 & 14 REVOKED (rotation), grant 15 LOST. issued by admin.
--
--    [L-1] ID CONTRACT. Ids read `'ag-' || lpad(e.rn::text, 4, '0')`, i.e. `ag-0001`..`ag-0015`.
--    `access_grant` is addressed by `GET /dostepy/:id` and `POST /dostepy/:id/revoke`, both guarded
--    by `ParseUUIDPipe`, so ALL FIFTEEN grants answered 400 — the Dostępy screen's detail view and
--    its "odbierz dostęp" button (docs/design/web-kit/lib/dostepy.ts:262,270) could not work for a
--    single row. Found by sweeping every text-`id` table on the live tenant against the list of
--    `ParseUUIDPipe` routes while closing the ds26/lr-demo debt; it was NOT in the guard's contract
--    map, so nothing would have caught it.
--
--    Fixed the same way as the generated ids in seed-dataset-2026.sql: 15 rows are still generated
--    (a row_number over employees), so the key is derived, not literal —
--    `'ac000000-0000-4000-8000-' || left(md5(<employee id>), 12)`, one grant per employee, which is
--    exactly the 1:1 this block already guarantees. Own namespace `ac000000-…` ("ac" = access), for
--    the same reason as `d5260000-…`: never share a prefix with another family's rows. The
--    human-readable numbering survives untouched on `identifier` (`AC-4M-0001`), which is what the
--    UI actually shows. Idempotency is unaffected — this block clears the whole table, it never
--    matched on an id prefix.
DELETE FROM access_grant;
WITH emps AS (
  SELECT id AS emp_id, row_number() OVER (ORDER BY last_name, first_name) AS rn
  FROM employees ORDER BY last_name, first_name LIMIT 15
),
loks AS (
  SELECT id AS lok_id, row_number() OVER (ORDER BY name) AS ln FROM lokalizacje
),
admin AS (SELECT id FROM users WHERE email = 'admin@staging.hrobot.local')
INSERT INTO access_grant
  (id, employee_id, type, label, identifier, lokalizacja_id, status, issued_by_user_id, issued_at, revoked_at, notes, created_at, updated_at)
SELECT
  'ac000000-0000-4000-8000-' || left(md5(e.emp_id), 12),
  e.emp_id,
  (CASE e.rn % 3 WHEN 0 THEN 'PERMISSION' WHEN 1 THEN 'CARD' ELSE 'KEY' END)::"AccessType",
  (CASE e.rn % 3 WHEN 0 THEN 'Uprawnienie systemowe' WHEN 1 THEN 'Karta dostępu' ELSE 'Klucz serwisowy' END),
  'AC-4M-' || lpad(e.rn::text, 4, '0'),
  l.lok_id,
  (CASE WHEN e.rn IN (13,14) THEN 'REVOKED' WHEN e.rn = 15 THEN 'LOST' ELSE 'ACTIVE' END)::"AccessStatus",
  (SELECT id FROM admin),
  now() - (e.rn || ' days')::interval,
  CASE WHEN e.rn IN (13,14) THEN now() - interval '2 days' ELSE NULL END,
  CASE WHEN e.rn IN (13,14) THEN 'Odebrano przy rotacji pracowniczej'
       WHEN e.rn = 15 THEN 'Zgłoszono zgubienie — wydać duplikat' ELSE NULL END,
  now(), now()
FROM emps e JOIN loks l ON l.ln = e.rn;

-- 5) WNIOSKI — backfill decider attribution on the existing APPROVED leaves (status unchanged, so the
--    AI-Grafik anchors are intact): Region Centrum → manager.demo, other regions → admin.
UPDATE leave_requests lr
SET decided_by_user_id = CASE
        WHEN e.unit_id = (SELECT id FROM organizational_units WHERE name = 'Region Centrum')
        THEN (SELECT id FROM users WHERE email = 'manager.demo@demo.hrobot.local')
        ELSE (SELECT id FROM users WHERE email = 'admin@staging.hrobot.local') END,
    decided_at = (lr.start_date::timestamp - interval '5 days'),
    updated_at = now()
FROM employees e
WHERE lr.employee_id = e.id AND lr.status = 'APPROVED' AND lr.decided_by_user_id IS NULL;

-- 5b) Add 2 PENDING (manager inbox) + 1 REJECTED for Region Centrum employees, so the approval
--     workflow is demonstrable. PENDING/REJECTED never feed the AI drop-out scan (only APPROVED does).
--
--     [L-1] ID CONTRACT. These ids used to be the readable slugs `lr-demo-p1/p2/r1`. `leave_requests`
--     is addressed by `GET /wnioski/:id`, `POST /wnioski/:id/decision` and `POST /wnioski/:id/cancel`,
--     all guarded by Nest's `ParseUUIDPipe`, so those three rows answered 400 to every request —
--     including the Zatwierdź / Odrzuć buttons on the Wnioski screen, i.e. exactly the approval
--     workflow this block exists to demonstrate (both PENDING rows were affected).
--     They now carry fixed ids from the demo family `a1d00000-0000-4000-8000-…`, tail `…0a0N`
--     (`a` = leave, matching scripts/seed-demo-strategic-brain.sql's convention).
--
--     The block was rewritten from `SELECT … FROM (VALUES …) g CROSS JOIN LATERAL (…)` into a plain
--     VALUES list so that each id is a LITERAL in the statement — a generated id cannot be pinned by
--     the seed guard, and with only three rows there is nothing to generate. The employee pick is
--     unchanged in meaning: same unit, same (last_name, first_name) order, same offsets 0/1/2. The
--     REJECTED decider is now resolved inline (an UNcorrelated scalar subquery is legal in VALUES —
--     only the correlated form was not), which retires the follow-up UPDATE that used to patch it.
INSERT INTO leave_requests
  (id, employee_id, start_date, end_date, status, type, created_at, updated_at, decided_at, decided_by_user_id, reason)
VALUES
  ('a1d00000-0000-4000-8000-000000000a01',
   (SELECT id FROM employees WHERE unit_id = (SELECT id FROM organizational_units WHERE name = 'Region Centrum')
    ORDER BY last_name, first_name OFFSET 0 LIMIT 1),
   DATE '2026-08-04', DATE '2026-08-08', 'PENDING'::"LeaveStatus", 'URLOP_WYPOCZYNKOWY', now(), now(),
   NULL, NULL, NULL),
  ('a1d00000-0000-4000-8000-000000000a02',
   (SELECT id FROM employees WHERE unit_id = (SELECT id FROM organizational_units WHERE name = 'Region Centrum')
    ORDER BY last_name, first_name OFFSET 1 LIMIT 1),
   DATE '2026-08-11', DATE '2026-08-12', 'PENDING'::"LeaveStatus", 'URLOP_NA_ZADANIE', now(), now(),
   NULL, NULL, NULL),
  ('a1d00000-0000-4000-8000-000000000a03',
   (SELECT id FROM employees WHERE unit_id = (SELECT id FROM organizational_units WHERE name = 'Region Centrum')
    ORDER BY last_name, first_name OFFSET 2 LIMIT 1),
   DATE '2026-07-28', DATE '2026-08-01', 'REJECTED'::"LeaveStatus", 'URLOP_WYPOCZYNKOWY', now(), now(),
   TIMESTAMP '2026-07-14 09:00',
   (SELECT id FROM users WHERE email = 'manager.demo@demo.hrobot.local'),
   'Brak zastępstwa w tym terminie — proszę o inny termin')
ON CONFLICT (id) DO NOTHING;

-- 5c) Demo DROP-OUT: an APPROVED leave landing on an assigned shift for a Region Centrum employee, so
--     the MANAGER dashboard "Wyjątki obsady" panel shows a real staffing threat (the AI-Grafik tie-in:
--     APPROVED leave overlapping an assigned shift → vacated shift surfaced by /replacements/scan).
--     Picks a Centrum employee who has a shift in the demo fortnight and covers those two dates.
--     [L-1] id was the slug `lr-demo-dropout-1` — see 5b for why that answered 400.
INSERT INTO leave_requests
  (id, employee_id, start_date, end_date, status, type, created_at, updated_at, decided_at, decided_by_user_id, reason)
SELECT 'a1d00000-0000-4000-8000-000000000a04', pick.emp, pick.d0, pick.d0 + 1, 'APPROVED', 'URLOP_NA_ZADANIE', now(), now(),
       TIMESTAMP '2026-07-13 09:00', (SELECT id FROM users WHERE email = 'manager.demo@demo.hrobot.local'),
       'Pilny urlop na żądanie'
FROM (
  SELECT s.employee_id AS emp, MIN(s.date::date) AS d0
  FROM shifts s JOIN employees e ON e.id = s.employee_id
  WHERE e.unit_id = (SELECT id FROM organizational_units WHERE name = 'Region Centrum')
    AND s.date::date BETWEEN DATE '2026-07-15' AND DATE '2026-07-26'
  GROUP BY s.employee_id
  ORDER BY s.employee_id
  LIMIT 1
) pick
ON CONFLICT (id) DO NOTHING;

-- 6) CROSS-UNIT TRAVEL DEMO (2026-07-14 spec §7/§12) — pracownica.demo / Katarzyna Zając:
--    a KOORDYNATOR in Region Północ (cross-unit vs Anna Kowalska's Region Centrum), reachable
--    (linked User with a login) and living ~7km from Lot. Chopina (haversineKm(home, 52.1657,
--    20.9671) ~= 6.99 km — verified against apps/tenant-runtime/src/cost/travel.util.ts) — Anna's
--    14.07 14:00-22:00 shift location — so the replacement engine's tiered pool + H-travel
--    feasibility finds her as a cheap cross-unit candidate and AUTO_ASK_CONSENT can reach her
--    (Employee.userId -> login). Deliberately ~7km, not Jan Nowak's spec-documented ~4km, so the
--    two cross-unit candidates are distinguishable by dojazd cost.
--    keycloak_sub is a PLACEHOLDER: Keycloak reassigns user ids on every realm rebuild, so
--    demo-up.mjs re-syncs it to the live id right after this script runs via resolveSub()
--    (mirrors the admin keycloak_sub sync already there — see scripts/demo-up.mjs).
--    pesel/pesel_hash: this is a SQL-only seed stage with no access to the app's
--    EncryptionService/blind-index key, so these are clearly-marked, non-decryptable placeholders
--    (NOT real ciphertext). Safe: employees.service only ever decrypts pesel for a masked
--    `peselLast4` shown to global actors, and wraps that in try/catch — a decrypt failure is logged
--    and the field is simply omitted, never thrown. No PESEL-format validation runs on a raw INSERT.
INSERT INTO users (id, email, keycloak_sub, active, created_at)
VALUES ('a1d00000-0000-4000-8000-00000000bc02', 'pracownica.demo@demo.hrobot.local',
        'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee02', true, now())
ON CONFLICT (email) DO NOTHING;

INSERT INTO employees
  (id, user_id, first_name, last_name, pesel, pesel_hash, position, employment_type, hired_at,
   unit_id, home_address, home_lat, home_lng, etat, qualifications, created_at, updated_at)
SELECT
  'a1d00000-0000-4000-8000-00000000ec02',
  (SELECT id FROM users WHERE email = 'pracownica.demo@demo.hrobot.local'),
  'Katarzyna', 'Zając',
  'DEMO-PLACEHOLDER-UNENCRYPTED-PESEL-KZAJAC',
  'demo-placeholder-pesel-hash-katarzyna-zajac-cross-unit-001',
  'Koordynator zmiany', 'UMOWA_O_PRACE'::"EmploymentType", DATE '2022-03-01',
  (SELECT id FROM organizational_units WHERE name = 'Region Północ'),
  'ul. Demo Testowa 7, 00-001 Warszawa', 52.2286, 20.9671, 1,
  ARRAY['KOORDYNATOR']::TEXT[],
  now(), now()
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE id = 'a1d00000-0000-4000-8000-00000000ec02');

COMMIT;
