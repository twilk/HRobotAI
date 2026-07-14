-- Seeds ONE pending-manager shift-swap for the demo J5 flow, idempotently.
--
-- WHY DYNAMIC: `POST /grafik/solve` ("Generuj grafik") regenerates AUTO shifts, changing their ids and
-- deleting any swap that referenced the old ones (see F2 fix — solve now clears dependent swaps first).
-- So a hardcoded-id swap seed breaks after a re-solve. This picks two CURRENT KIEROWCA shifts in the
-- unit manager.demo manages (Region Centrum), on different days and different employees, and inserts a
-- PENDING_MANAGER swap the manager can approve. Re-runnable: it clears its own fixed-id row first.
--
-- Run: docker exec -i hrobot-postgres-1 psql -U postgres -d hrobot_t_900d948b < scripts/seed-demo-swap.sql

DELETE FROM shift_swap_requests WHERE id = 'dccccccc-0000-4000-8000-000000000001';

WITH centrum AS (
  SELECT s.id AS shift_id, s.employee_id, s.date
  FROM shifts s
  JOIN employees e ON s.employee_id = e.id
  WHERE e.unit_id = '053774f2-63fb-565c-b142-77b17f456ec7'  -- Region Centrum (manager.demo's unit)
    AND s.role = 'KIEROWCA'
    AND s.date >= DATE '2026-07-13' AND s.date < DATE '2026-07-20'
),
req AS (
  SELECT shift_id, employee_id, date FROM centrum ORDER BY date, shift_id LIMIT 1
),
tgt AS (
  SELECT c.shift_id, c.employee_id, c.date
  FROM centrum c, req
  WHERE c.employee_id <> req.employee_id
  ORDER BY c.date, c.shift_id LIMIT 1
)
INSERT INTO shift_swap_requests
  (id, requester_employee_id, requester_shift_id, target_employee_id, target_shift_id, state, reason, created_at, updated_at)
SELECT
  'dccccccc-0000-4000-8000-000000000001',
  req.employee_id, req.shift_id, tgt.employee_id, tgt.shift_id,
  'PENDING_MANAGER',
  'Seed demo — zamiana KIEROWCA↔KIEROWCA do zatwierdzenia (J5)',
  now(), now()
FROM req, tgt;

SELECT id, state, requester_shift_id, target_shift_id FROM shift_swap_requests WHERE id = 'dccccccc-0000-4000-8000-000000000001';
