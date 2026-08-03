# Znane ograniczenia i etapowość (uczciwe ujęcie do protokołu)

> Jawne przedstawienie 4Mobility, co jest dostarczone w M2 vs odroczone. Chroni przed zarzutem over-promisingu i jest podstawą „protokołu z uwagami / etapowości".

## Grafik (a)
- **Twarde ograniczenia: H1–H4** (pokrycie, brak nakładania, dostępność/urlopy, odpoczynek dobowy 11h) — egzekwowane przez solver, zweryfikowane testami.
- **H5** (odpoczynek tygodniowy 35h): miękki proxy „≥N dni wolnych/tydz." (horyzont 1-tygodniowy nie modeluje rolling-35h). → pełne H5 w M3.
- **H6** (limity godzin/nadgodziny): **nie egzekwowane** w M2 (etat tylko jako cel miękki). → M3.
- **Fairness**: `fairnessScore = 0.0` (człon wariancji odroczony). → M3.
- **Waga `weights.d` (zapotrzebowanie) jest przyjmowana, ale nieużywana** — pokrycie jest twardym ograniczeniem struktury modelu, więc nie ma czego ważyć w funkcji celu. Zmiana tej wagi nie wpływa na wynik. Udokumentowane w `grafik-optimizer/app/solver.py` i przypięte testem; dopisane tutaj 03.08 dla spójności ujęcia odbiorowego. Aktywne wagi: `e` (odchylenie etatu), `g` (dojazdy), `p` (preferencje miękkie).
- **Preferencje pracownika** (`preferredDaysOff`, `preferredShiftStart`) są **miękkie** — optymalizowane przez człon `w_p`, nigdy gwarantowane.
- Dojazdy: haversine na współrzędnych syntetycznych; OSRM (realny routing drogowy) → po pilocie. Brak self-hosted geokodera (Nominatim) w M2.
- Determinizm: single-worker + stały seed; przy time-limit/FEASIBLE nie gwarantujemy bit-identyczności.

## Agent AI (b) — KLUCZOWE ujęcie
- Mechanizm serwujący = **uczący się scorer preferencji (affinity-learner) + wsadowy re-fit z akumulowanego feedbacku**, z wersjonowaną polityką. Uczenie jest **realne i mierzalne** (spadek edit-distance po feedbacku, AG2).
- **NIE jest to produkcyjny RL / on-policy Stable-Baselines3.** Weryfikacja w kodzie (03.08): `stable_baselines3` i `torch` nie są importowane przez ŻADEN moduł repozytorium; `app/policy.py` i `app/retrain.py` importują wyłącznie bibliotekę standardową. Istnieje rusztowanie Gym-env (`app/env.py`) i offline'owe CLI BC (`app/train_bc.py`, biblioteka `imitation`) — ale żaden algorytm RL nie jest trenowany, a ścieżka serwująca nie dotyka ani env, ani artefaktu z `train_bc`.
- Zdolności demonstrowane jako **inkrement pilotowy**: samoucząca (feedback→poprawa), wnioskująca (rationale), samolecząca (walidacja+naprawa solverem), samorozwijająca (re-fit+wersje). Pełna autonomia produkcyjna / długohoryzontowy RL na żywych danych → etapowo po M2.
- Metryka akceptacji online jest in-sample (samozwrotna) — traktować jako sygnał uczenia, nie absolutną jakość.

### Co dokładnie mierzy AG2 (aktualizacja 03.08 — HON-2)
- **Scenariusz domyślny („constructed") ma wadę metodologiczną, którą trzeba zgłosić samemu.** Wzorzec „prawdy managera" powstaje przez wywołanie **własnej** funkcji agenta `ImitationPolicy.propose()`. Cel leży więc w klasie hipotez polityki z konstrukcji — agent odtwarza go dokładnie (edit-distance 0), gdy poda mu się pasującą tablicę affinity. Krzywej `50 → 0 w 5 rundach` **nie należy** cytować jako dowodu, że agent uczy się preferencji managera.
- **Dodany scenariusz „independent" (`python -m app.demo_ag2 --manager independent`)** definiuje grafik managera **bez udziału polityki agenta** (`app/manager_profile.py`): inna kolejność zapotrzebowań, reguła zależna od obciążenia, tygodniowy limit zmian, preferencja z SHA-256 nieskorelowana z cechami agenta. Wzorzec jest twardo wykonalny (0 naruszeń, pokrycie 52/52), więc porównanie jest uczciwe.
- **Wynik pomiaru (pozytywny, ale słabszy niż stara narracja):** dystans day-1 **96/104** (zgodność **7,7%**) zamiast 50/104 (51,9%); zbieżność do 0 w **rundzie 17** zamiast 5; krzywa `96 76 62 70 60 52 50 52 44 40 34 36 28 26 20 16 10 0`. **Monotoniczność NIE zachodzi** (wzrosty 62→70, 50→52, 34→36) — monotoniczność jest własnością wyłącznie starego, skonstruowanego wzorca.
- Powtórzone dla **sześciu** różnych, arbitralnych managerów: day-1 96–100, zbieżność w rundach 14–17. Ablacja bez feedbacku: krzywa **idealnie płaska** w każdym przypadku → spadek pochodzi wyłącznie z uczenia.
- **Zero transferu między tygodniami.** Agent doprowadzony do dystansu 0 na tygodniu W daje na tygodniu W+7d (te same osoby, przesunięte daty) dystans **98** — dokładnie tyle co agent nieuczony, przy propozycji identycznej co do przypisania. Przyczyna: klucz uczenia `slot_signature` zawiera datę. Generalizacja międzytygodniowa → M3.
- Odtworzenie: `python -m app.demo_ag2 --manager independent` oraz `python -m demo.hon2_controls`; dowody dosłowne w `agent-service/evidence/ag2_independent_*` i `agent-service/evidence/hon2_controls_run.txt`.
- Ograniczenie samego eksperymentu: „manager" koryguje z **pełną informacją** o docelowym grafiku (do 6 najgorszych zapotrzebowań na rundę). To pokazuje, że kanał feedbacku działa end-to-end — nie modeluje szumu ani niekonsekwencji realnego managera.

## Zamiany (c)
- Backend (model, state machine, walidacja solverem H1–H4+H3, RBAC, blokada optymistyczna) — gotowy i przetestowany (PR #31; 62/62 testów PASS, bieg 2026-07-14).
- UI Zamian **podłączone do realnego API** (`lib/swaps.ts` → proxy → `/shift-swap/*`; UI-1 domknięte) — aktualizacja 14.07, wcześniejszy zapis o mocku nieaktualny. Ograniczenie warstwy demo: pole `mineRole` bez endpointu `/me` (konto demo ADMIN_KLIENTA bez rekordu Employee). Real-time (WebSocket/SSE) + AI-mediacja par → M3.

## CI/CD (d) + Staging (e)
- `ci.yml` **zmergowany na `main`** (PR #9, 11.07) — bramki lint/typecheck/unit blokują integrację; zielone runy: 29166512951 (PR), 29166696122 (main). Job pytest dla serwisów Pythona dodany 14.07. Lane integracyjny (G6 na ≥2 bazach) i smoke Playwright świadomie odroczone do czasu powstania realnych testów (CI-4/CI-5).
- Testy — **stan zmierzony 2026-08-03** (poprzedni zapis „855/855 w 76 suitach" pochodził z biegu 14.07 i zdezaktualizował się):

  | Suita | Wynik | Komenda odtwarzająca |
  |---|---|---|
  | TS (jest, cały monorepo) | **857 testów / 66 suit** | `npx turbo run test` |
  | `agent-service` (pytest) | **62 passed / 3 skipped** | `cd agent-service && python -m pytest -q` |
  | `grafik-optimizer` (pytest) | **24 passed** | `cd grafik-optimizer && python -m pytest -q` |

  Uwagi do odtworzenia: 3 skipped w `agent-service` to `test_env*` — wymagają `gymnasium`/`imitation`, których koła nie istnieją dla CPython ≥ 3.13; w kontenerze `python:3.12-slim` (`docker.exe exec agent-smoke python -m pytest -q`) biegnie **65/65**. Liczba testów `agent-service` wzrosła 51 → 65 wraz z HON-2 (`tests/test_ag2_independent.py` + 3 testy scenariusza niezależnego w `tests/test_demo_router.py`). Liczby TS pochodzą z pomiaru toru weryfikującego stack na żywym kodzie 03.08. **Zasada: nie przepisujcie tych liczb z pamięci — uruchomcie komendy z tabeli.** Logi historyczne w `test-logs/`.
- Staging (docker-compose full + tunel) działa i utrzymuje żywy tenant 4Mobility; auto-deploy (`deploy-staging.yml` na main, PR #18) — aktywacja po rejestracji self-hosted runnera (w toku 14.07).
- Izolacja tenantów (G6) udowodniona unit-testem (mock) — test integracyjny na ≥2 realnych bazach → do dodania (CI-4).

## Poza zakresem M2 (świadomie → M3)
Pełne H5/H6/fairness · produkcyjny RL agenta · real-time zamiany · OSRM · self-hosted geokoder · pełna suita E2E/Playwright · produkcyjny K8s/Terraform.
