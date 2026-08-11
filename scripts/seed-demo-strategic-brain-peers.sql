-- ============================================================================================
-- Demo: dosypanie grup porownawczych do "Mapy wydajnosci i rozwoju" (strategic-brain / KM3).
--
-- PO CO. Bazowy seed (seed-demo-strategic-brain.sql) tworzy 6 profili narracyjnych — dokladnie
-- tyle, ile potrzeba, zeby pokazac sygnaly retencji. Ale kolumna "Wydajnosc" to percentyl M10
-- w grupie `rola|jednostka|etat`, a grupa ponizej minPeerGroupSize (=5) jest z definicji
-- `meaningful:false`: percentyl liczony wobec jednej osoby to zawsze 50 i nic nie znaczy.
-- Ten skrypt dokłada pozostalych pracownikow, zeby ranking mial wobec kogo rankowac.
--
-- IDEMPOTENTNY. Wstawia tylko dla pracownikow, ktorzy jeszcze nie maja zadnego snapshotu,
-- i konczy na ON CONFLICT DO NOTHING. Bezpieczny do powtorzenia.
--
-- WYRÓWNANIE OKIEN JEST OBOWIAZKOWE. Okna bierzemy z NAJNOWSZEGO istniejacego snapshotu, a nie
-- z now(). `SnapshotService.overview` rankuje wylacznie w obrebie tego samego `window_end` —
-- gdyby nowi ludzie wyladowali w innym oknie niz szesciu z bazowego seeda, powstalyby dwie
-- rozlaczne grupy porownawcze i percentyl znowu bylby bez sensu.
--
-- WARTOSCI SA AUTORSKIE, NIE POLICZONE — tak samo jak w bazowym seedzie. `composite_score`
-- liczymy tu jawnie z terminowosci i jakosci (wagi domyslne 0.25/0.25 -> po renormalizacji 50/50,
-- dokladnie jak pierwszy przebieg SnapshotService przed finalizeWindow), a `development_slope`
-- jako regresje najmniejszych kwadratow po trzech rownoodleglych oknach — dla t=0,1,2 upraszcza
-- sie do (c2-c0)/2. Dzieki temu liczby sa wewnetrznie spojne, ale to NADAL dane demo: pipeline
-- ich nie wyprodukowal. Jesli ktos poprosi "policzcie to przy mnie", trzeba to powiedziec wprost.
-- ============================================================================================

BEGIN;

-- Powtarzalnosc: usun poprzedni przebieg TEGO skryptu (prefiks sb_peer_). Nie dotyka ani wierszy
-- bazowego seeda (sb_sn_*), ani niczego, co policzyl harmonogram.
DELETE FROM employee_performance_snapshot WHERE id LIKE 'sb_peer_%';

-- Okno odniesienia + parametry: dokladnie te, w ktorych siedzi bazowy seed.
CREATE TEMP TABLE sb_peer_win ON COMMIT DROP AS
SELECT window_start AS ws, window_end AS we, (window_end - window_start) AS span
FROM employee_performance_snapshot
ORDER BY window_end DESC
LIMIT 1;

-- Kandydaci: pracownicy BEZ zadnego snapshotu. `rn` per rola daje deterministyczny, powtarzalny
-- rozrzut (bez random() — skrypt ma dawac ten sam wynik przy kazdym uruchomieniu).
CREATE TEMP TABLE sb_peer_pick ON COMMIT DROP AS
SELECT
  e.id AS emp_id,
  (e.position || '|' || e.unit_id || '|' || e.etat::text) AS peer_key,
  row_number() OVER (PARTITION BY e.position ORDER BY e.id) AS rn
FROM employees e
WHERE NOT EXISTS (SELECT 1 FROM employee_performance_snapshot s WHERE s.employee_id = e.id);

-- Trzy okna wstecz (widx 2,3,4 w konwencji bazowego seeda), zeby "Rozwoj" mial z czego policzyc
-- trend — przy jednym oknie minValidWindows(=3) nie jest spelnione i kolumna zostaje pusta.
INSERT INTO employee_performance_snapshot
  (id, employee_id, window_start, window_end, throughput, median_cycle_minutes, sla_hit_rate,
   defect_rate, composite_score, development_slope, confidence, peer_group_key, is_new_hire,
   excluded_reason, algorithm_version, config_hash, computed_at)
SELECT
  'sb_peer_' || p.emp_id || '_' || w.widx,
  p.emp_id,
  (win.ws - ((2 - w.widx) * win.span))::timestamp(3),
  (win.we - ((2 - w.widx) * win.span))::timestamp(3),
  m.thru,
  NULL,
  m.sla::numeric,
  m.defect::numeric,
  -- composite = srednia terminowosci i jakosci (pierwszy przebieg silnika, wagi 0.25/0.25)
  (((m.sla * 100) + ((1 - m.defect) * 100)) / 2)::numeric,
  -- slope tylko na ostatnim oknie: (c2 - c0)/2 po composite z widx 0 i 2
  CASE WHEN w.widx = 2 THEN (
    ((((m.sla + 0.06) * 100) + ((1 - (m.defect - 0.02)) * 100)) / 2
     - (((m.sla - 0.06) * 100) + ((1 - (m.defect + 0.02)) * 100)) / 2) / 2
  )::numeric ELSE NULL END,
  m.conf::numeric,
  p.peer_key,
  false,
  NULL,
  1,
  '8f48eedbf9c86be7',
  now()
FROM sb_peer_pick p
CROSS JOIN sb_peer_win win
CROSS JOIN (VALUES (0), (1), (2)) AS w(widx)
CROSS JOIN LATERAL (
  SELECT
    -- JEDNA ZMIENNA UKRYTA `q` (0..1) NA PRACOWNIKA steruje wszystkimi trzema metrykami.
    --
    -- Pierwsza wersja losowala throughput, sla i defect z NIEZALEZNYCH wyrazen — i wyszlo, ze
    -- ktos z 5 zleceniami mial Wynik 89, bo trafil mu sie wysoki sla i niski defect. Na ekranie
    -- 14 z 39 wierszy pokazywalo niski percentyl "Wydajnosci" obok wysokiego "Wyniku" i tabela
    -- sama sobie przeczyla. Skorelowanie metryk jest tu wymogiem poprawnosci, nie estetyki.
    --
    -- Sufit throughputu (2..14) jest ponizej wartosci szesciorga z bazowego seeda (gwiazda 22,
    -- Rafal 15), zeby narracyjne postacie zostaly wysoko w percentylu — ich `composite_score`
    -- jest tam napisany recznie i nie da sie go wyprowadzic z tych danych.
    GREATEST(1, 2 + round(m0.q * 11)::int + w.widx)                                  AS thru,
    LEAST(0.97, GREATEST(0.42, 0.45 + m0.q * 0.45 + (w.widx - 1) * 0.04))            AS sla,
    LEAST(0.34, GREATEST(0.03, 0.30 - m0.q * 0.24 - (w.widx - 1) * 0.015))           AS defect,
    LEAST(0.93, GREATEST(0.58, 0.62 + m0.q * 0.30))                                  AS conf
  FROM (SELECT (((p.rn * 37) % 100)::numeric / 100) AS q) AS m0
) AS m
ON CONFLICT (employee_id, window_start, window_end) DO NOTHING;

COMMIT;

-- Kontrola: ile osob trafi teraz do mapy i jak duze sa grupy porownawcze.
SELECT
  split_part(peer_group_key, '|', 1) AS rola,
  count(*)                           AS osob_w_oknie
FROM employee_performance_snapshot s
WHERE s.window_end = (SELECT max(window_end) FROM employee_performance_snapshot)
GROUP BY 1
ORDER BY 2 DESC;
