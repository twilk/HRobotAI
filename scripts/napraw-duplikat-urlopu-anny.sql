-- Anna Kowalska miała w bazie DWA identyczne, zatwierdzone urlopy wypoczynkowe 20–26.07.2026
-- (kolizja dwóch seedów). Efekt był widoczny na ekranie: „Wykorzystano 23 z 20 dni urlopu —
-- pozostało -3". 23 = 7 + 7 (duplikat) + 1 + 1 + 7.
--
-- Skrypt usuwa JEDEN z duplikatów. Jest idempotentny: po pierwszym uruchomieniu kolejne nic nie
-- robią, bo warunek na dwa wiersze przestaje być spełniony.
--
-- Bezpieczeństwo: obie kopie nie mają ANI JEDNEGO wpisu w audit_log (sprawdzone 2026-08-13), więc
-- nie kasujemy historii decyzji — tylko nadmiarowy wiersz danych demo.
BEGIN;

DO $$
DECLARE
  v_emp   text;
  v_ile   int;
  v_usun  text;
BEGIN
  SELECT id INTO v_emp FROM employees WHERE first_name = 'Anna' AND last_name = 'Kowalska';
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'Nie ma pracownika Anna Kowalska — przerywam, bo skrypt trafił w złą bazę.';
  END IF;

  SELECT count(*) INTO v_ile
  FROM leave_requests
  WHERE employee_id = v_emp
    AND type = 'URLOP_WYPOCZYNKOWY'
    AND start_date::date = DATE '2026-07-20'
    AND end_date::date = DATE '2026-07-26';

  IF v_ile = 1 THEN
    RAISE NOTICE 'Duplikatu już nie ma (1 wiersz) — nic do zrobienia.';
    RETURN;
  END IF;

  IF v_ile <> 2 THEN
    RAISE EXCEPTION 'Spodziewałem się 1 albo 2 wierszy, jest %. Przerywam zamiast zgadywać.', v_ile;
  END IF;

  -- Zostaje wiersz o deterministycznym identyfikatorze (UUIDv5 z stableId) — to wzorzec, na który
  -- repo przeszło. Kasujemy starszy, z rodziny d5260000-*.
  SELECT id INTO v_usun
  FROM leave_requests
  WHERE employee_id = v_emp
    AND type = 'URLOP_WYPOCZYNKOWY'
    AND start_date::date = DATE '2026-07-20'
    AND end_date::date = DATE '2026-07-26'
    AND id::text LIKE 'd5260000-%';

  IF v_usun IS NULL THEN
    RAISE EXCEPTION 'Nie znalazłem kopii z rodziny d5260000-* — przerywam, żeby nie skasować złej.';
  END IF;

  DELETE FROM leave_requests WHERE id = v_usun;
  RAISE NOTICE 'Usunięto duplikat %.', v_usun;
END $$;

-- Kontrola po zmianie: ma zostać dokładnie jeden wiersz na ten termin, a suma dni
-- wypoczynkowych ma zejść z 23 na 16.
SELECT count(*) AS wierszy_na_20_26_07
FROM leave_requests lr JOIN employees e ON e.id = lr.employee_id
WHERE e.last_name = 'Kowalska' AND lr.type = 'URLOP_WYPOCZYNKOWY'
  AND lr.start_date::date = DATE '2026-07-20' AND lr.end_date::date = DATE '2026-07-26';

SELECT sum(lr.end_date::date - lr.start_date::date + 1) AS dni_wypoczynkowych_zatwierdzonych
FROM leave_requests lr JOIN employees e ON e.id = lr.employee_id
WHERE e.last_name = 'Kowalska' AND lr.type = 'URLOP_WYPOCZYNKOWY' AND lr.status = 'APPROVED';

COMMIT;
