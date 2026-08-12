-- ============================================================================================
-- Naprawa kluczy glownych shift_demands po zmianie nazwy roli RECEPCJA -> OPERATOR (12.08.2026)
--
-- PO CO. Kanoniczne zapotrzebowania z packages/db/src/seed/canonicalData.ts maja klucz glowny
-- wyliczany jako UUIDv5: stableId('demand', weekLabel, lokalizacja, data, start, ROLA). Rola
-- wchodzi do klucza naturalnego, wiec po przemianowaniu RECEPCJA -> OPERATOR wiersze w bazie
-- zostaly z identyfikatorami policzonymi ze STAREJ nazwy. Skutek: `seed:synthetic` liczylby juz
-- nowe UUID, nie trafialby w istniejace wiersze i zamiast upsertu WSTAWILBY DUPLIKATY.
--
-- Dotyczy WYLACZNIE 14 wierszy kanonicznych (UUIDv5 — cyfra wersji '5' na pozycji 15). Pozostale
-- 203 zapotrzebowania OPERATOR pochodza z seeda SQL, maja identyfikatory arbitralne i roli
-- w kluczu nie koduja, wiec ich to nie dotyczy.
--
-- BEZPIECZENSTWO. shifts.demand_id to jedyny klucz obcy wskazujacy na te tabele i ma
-- ON UPDATE CASCADE, wiec przepiecie 7 zmian dzieje sie samo. Skrypt jest IDEMPOTENTNY: gdy
-- starych identyfikatorow juz nie ma, UPDATE trafia w zero wierszy i nic sie nie dzieje.
--
-- Pary NIE sa zgadniete. Odtworzono stableId poza aplikacja i sprawdzono, ze ze STAREJ nazwy roli
-- daje dokladnie te identyfikatory, ktore leza w bazie — 14 na 14, co do znaku. Dopiero potem
-- policzono nowe.
-- ============================================================================================

BEGIN;

CREATE TEMP TABLE _mapa_id(stary text PRIMARY KEY, nowy text NOT NULL) ON COMMIT DROP;
INSERT INTO _mapa_id(stary, nowy) VALUES
  ('4ecbe661-337d-5eee-b582-ad23bf62ed84','238a6730-2608-5873-bc56-4c7a56bf2b9c'),  -- 2026-07-13 06:00 [feasible]
  ('619838bd-adc0-5a6d-bf8a-3ab5d7b629d0','ba73b508-2e3b-5df4-b735-b1cd1044e49c'),  -- 2026-07-14 06:00 [feasible]
  ('e781e6b5-fb90-5434-8011-b1e15d0d7001','1f863593-009b-5e2d-a42e-7c8ca0a3e816'),  -- 2026-07-15 06:00 [feasible]
  ('aa191c95-b911-5853-b566-50edc7052f4b','ef86ab1b-9019-5ebe-b321-0cddec409f33'),  -- 2026-07-16 06:00 [feasible]
  ('e1b70ade-bdf4-5697-8df7-3a316e952eef','eaf86ea2-e461-5cf6-8ae1-cb81376196e3'),  -- 2026-07-17 06:00 [feasible]
  ('5497d505-305a-5213-af67-a04f231d0f04','ae65e0a4-c4d5-5813-80e2-bafcd4ebcc8d'),  -- 2026-07-18 06:00 [feasible]
  ('b2fb9eea-e751-51d5-b13f-21c91a4e6659','fc4a0d07-3eb9-5a0b-8898-c1ce7d30b13a'),  -- 2026-07-19 06:00 [feasible]
  ('7efe9ff8-baf3-541d-a07a-b89e0a18f495','ebabdacd-0549-57dd-92fd-e08e6e8c32d9'),  -- 2026-07-20 06:00 [infeasible]
  ('f20a43ae-0b57-5926-83a2-6e9de90f97a7','596fee04-868f-563a-89b2-c7a43dfe053d'),  -- 2026-07-21 06:00 [infeasible]
  ('620a8404-ea17-5bf8-a62e-ff9faa4318dd','eae1e3e4-2225-5a62-819a-a12e6ed333fc'),  -- 2026-07-22 06:00 [infeasible]
  ('9f5ee0e6-e119-5dda-ac8e-79fcde5a7a70','2e3d5d74-aa89-51ca-995a-a14c6710adb6'),  -- 2026-07-23 06:00 [infeasible]
  ('c56ba9b8-bf99-59e7-b11a-7225def112b0','dde145dd-51ed-50ba-9eb6-3d98e3bbd93c'),  -- 2026-07-24 06:00 [infeasible]
  ('e97c0845-4d21-53ee-b527-8171140a7716','f170b879-699d-51b7-95ce-ceac4f263e86'),  -- 2026-07-25 06:00 [infeasible]
  ('bac7402a-fe31-5327-9984-ccc741ac5cfc','fce3dab8-f0a9-5d61-b42a-b68bff2376d3');  -- 2026-07-26 06:00 [infeasible]

-- Nowy identyfikator obecny OBOK starego oznaczalby, ze duplikat juz powstal. To blad danych,
-- nie sytuacja do przemilczenia.
DO $$
DECLARE kolizje int;
BEGIN
  SELECT count(*) INTO kolizje
    FROM _mapa_id m
    JOIN shift_demands n ON n.id = m.nowy
   WHERE EXISTS (SELECT 1 FROM shift_demands o WHERE o.id = m.stary);
  IF kolizje > 0 THEN
    RAISE EXCEPTION 'Nowy identyfikator istnieje obok starego (% kolizji) — przerwano', kolizje;
  END IF;
END $$;

UPDATE shift_demands d SET id = m.nowy, updated_at = now()
  FROM _mapa_id m WHERE d.id = m.stary;

-- Kaskada musi przepiac zmiany. Osierocona zmiana oznacza, ze cos poszlo nie tak.
DO $$
DECLARE sieroty int;
BEGIN
  SELECT count(*) INTO sieroty
    FROM shifts s
    LEFT JOIN shift_demands d ON s.demand_id = d.id
   WHERE s.demand_id IS NOT NULL AND d.id IS NULL;
  IF sieroty > 0 THEN
    RAISE EXCEPTION 'Po przepisaniu kluczy zostalo % osieroconych zmian — wycofano', sieroty;
  END IF;
END $$;

COMMIT;

SELECT count(*) AS kanoniczne_operator
  FROM shift_demands
 WHERE required_role = 'OPERATOR' AND substring(id from 15 for 1) = '5';
