# Znane ograniczenia i etapowość (uczciwe ujęcie do protokołu)

> Jawne przedstawienie 4Mobility, co jest dostarczone w M2 vs odroczone. Chroni przed zarzutem over-promisingu i jest podstawą „protokołu z uwagami / etapowości".

## Grafik (a)
- **Twarde ograniczenia: H1–H4** (pokrycie, brak nakładania, dostępność/urlopy, odpoczynek dobowy 11h) — egzekwowane przez solver, zweryfikowane testami.
- **H5** (odpoczynek tygodniowy 35h): miękki proxy „≥N dni wolnych/tydz." (horyzont 1-tygodniowy nie modeluje rolling-35h). → pełne H5 w M3.
- **H6** (limity godzin/nadgodziny): **nie egzekwowane** w M2 (etat tylko jako cel miękki). → M3.
- **Fairness**: `fairnessScore = 0.0` (człon wariancji odroczony). → M3.
- Dojazdy: haversine na współrzędnych syntetycznych; OSRM (realny routing drogowy) → po pilocie. Brak self-hosted geokodera (Nominatim) w M2.
- Determinizm: single-worker + stały seed; przy time-limit/FEASIBLE nie gwarantujemy bit-identyczności.

## Agent AI (b) — KLUCZOWE ujęcie
- Mechanizm serwujący = **uczący się scorer preferencji (affinity-learner) + wsadowy re-fit z akumulowanego feedbacku**, z wersjonowaną polityką. Uczenie jest **realne i mierzalne** (spadek edit-distance po feedbacku, AG2).
- **NIE jest to produkcyjny RL / on-policy Stable-Baselines3.** Rusztowanie SB3/Gym-env istnieje (CLI `train_bc.py`), ale ścieżka serwująca używa scorera, nie polityki SB3.
- Zdolności demonstrowane jako **inkrement pilotowy**: samoucząca (feedback→poprawa), wnioskująca (rationale), samolecząca (walidacja+naprawa solverem), samorozwijająca (re-fit+wersje). Pełna autonomia produkcyjna / długohoryzontowy RL na żywych danych → etapowo po M2.
- Metryka akceptacji online jest in-sample (samozwrotna) — traktować jako sygnał uczenia, nie absolutną jakość.

## Zamiany (c)
- Backend (model, state machine, walidacja solverem H1–H4+H3, RBAC, blokada optymistyczna) — gotowy i przetestowany (PR #31; 62/62 testów PASS, bieg 2026-07-14).
- UI Zamian **podłączone do realnego API** (`lib/swaps.ts` → proxy → `/shift-swap/*`; UI-1 domknięte) — aktualizacja 14.07, wcześniejszy zapis o mocku nieaktualny. Ograniczenie warstwy demo: pole `mineRole` bez endpointu `/me` (konto demo ADMIN_KLIENTA bez rekordu Employee). Real-time (WebSocket/SSE) + AI-mediacja par → M3.

## CI/CD (d) + Staging (e)
- `ci.yml` **zmergowany na `main`** (PR #9, 11.07) — bramki lint/typecheck/unit blokują integrację; zielone runy: 29166512951 (PR), 29166696122 (main). Job pytest dla serwisów Pythona dodany 14.07. Lane integracyjny (G6 na ≥2 bazach) i smoke Playwright świadomie odroczone do czasu powstania realnych testów (CI-4/CI-5).
- Testy (pełny bieg lokalny 2026-07-14): **855/855 TS w 76 suitach** + agent-service 48 passed/3 skipped (51/51 w kontenerze z żywym optymalizatorem) + grafik-optimizer w kontenerze python:3.12 — logi w `test-logs/`.
- Staging: auto-deploy DZIAŁA end-to-end (run [29374277217](https://github.com/twilk/HRobotAI/actions/runs/29374277217): 14/14 kroków, provisioning tenanta automatyczny po fixie #33, health-check 6/6) — osobny projekt compose `hrobot-staging` (porty 48xx), żywy stack demo 4Mobility nietknięty. Publiczny URL: quick tunnel (sesyjny) do czasu konfiguracji named tunnel.
- Izolacja tenantów (G6) udowodniona unit-testem (mock) — test integracyjny na ≥2 realnych bazach → do dodania (CI-4).

## Poza zakresem M2 (świadomie → M3)
Pełne H5/H6/fairness · produkcyjny RL agenta · real-time zamiany · OSRM · self-hosted geokoder · pełna suita E2E/Playwright · produkcyjny K8s/Terraform.
