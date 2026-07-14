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
- Backend (model, state machine, walidacja solverem H1–H4+H3, RBAC, blokada optymistyczna) — gotowy i przetestowany (PR #31).
- **UI Zamian obecnie na in-memory mocku** (`docs/design/web-kit/lib/swaps.ts`) — nie podłączony do `/api/shift-swap`. Do demo J5 przez UI wymaga podłączenia (zadanie osobne). Real-time (WebSocket/SSE) + AI-mediacja par → M3.

## CI/CD (d) + Staging (e)
- `ci.yml` + turbo targety napisane, **niezmergowane na `main`** (PR #9 — token bez scope `workflow`). Do czasu merge: brak automatycznej bramki CI; testy uruchamiane lokalnie (dowód: 107 TS + 51 py zielonych, PR #31).
- Staging (docker-compose full + tunel) działa; auto-deploy (`deploy-staging.yml` + self-hosted runner) do domknięcia.
- Izolacja tenantów (G6) udowodniona tylko unit-testem (mock) — brak testu integracyjnego na ≥2 realnych bazach. → do dodania.

## Poza zakresem M2 (świadomie → M3)
Pełne H5/H6/fairness · produkcyjny RL agenta · real-time zamiany · OSRM · self-hosted geokoder · pełna suita E2E/Playwright · produkcyjny K8s/Terraform.
