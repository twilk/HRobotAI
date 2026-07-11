# M2 · Podprojekt #1 — Rdzeń Grafiku (projekt)

> **Projekt:** HRobot.AI — Kamień Milowy **M2** (odbiór 20.07.2026)
> **Punkt programu:** **a)** Implementacja Modułu Grafik — algorytm automatycznego układania grafiku pracowniczego, optymalizacja parametrów: dojazdy, etaty, godziny przepracowane
> **Beneficjent:** App Pro sp. z o.o. (0035/2026) · **Odbiorca Technologii:** 4Mobility
> **Repozytorium:** `github.com/twilk/HRobotAI` · **Gałąź główna:** `main`
> **Data:** 2026-07-06 · **Status:** Projekt zaakceptowany (brainstorming) → wejście w plan implementacyjny
> **Powiązane specyfikacje:** `2026-07-06-m2-cicd-srodowisko-testowe-design.md` (#4)

---

## 1. Kontekst i miejsce w M2

Podprojekt #1 z dekompozycji M2 (5 podprojektów — patrz spec #4, §1). **Fundament** — jego model domenowy i formalizacja problemu są reużywane przez:
- **#2 Agent AI Grafik Manager** — Gym-env RL reużywa tej samej formalizacji (te same zmienne, ograniczenia, funkcja celu); solver CP-SAT dostarcza baseline + imitation learning.
- **#3 Real-time + zamiany** — operuje na modelu `Shift` z #1.
- **#5 UAT** — scenariusze na wyniku solvera.

**Cel #1:** kompletna warstwa domenowa grafiku + deterministyczny auto-scheduler, który dla tygodnia i regionu układa **wykonalny** grafik optymalizujący dojazdy/etaty/godziny.

## 2. Decyzje projektowe (ustalone w brainstormingu)

| Decyzja | Wybór | Uzasadnienie |
|---------|-------|--------------|
| Kształt problemu | **Hybryda: szablony + generacja** | Szablony per typ lokalizacji generują domyślne zapotrzebowanie → korekta menadżera → solver obsadza. Najbliżej realnej pracy operacyjnej |
| Model dojazdów | **Geokodowanie adresu domowego** | Realny czas/odległość dom→lokalizacja. PII szyfrowane, geokoder w UE (RODO) |
| Architektura solvera | **Osobny serwis Python (grafik-optimizer, FastAPI)** | OR-Tools natywnie Python; współdzielony z RL #2; slot `agent` zarezerwowany w #4 |
| Rola tenant-runtime | **Mózg domenowy** | Persystencja, RBAC, audyt, pakowanie problemu; optimizer bezstanowy |

## 3. Architektura — 3 komponenty

```
web-kit (Next.js)                tenant-runtime (NestJS)                    grafik-optimizer (Python/FastAPI)
 siatka grafiku      ──HTTP──▶  src/grafik:                    ──HTTP/JSON──▶  buduje model CP-SAT (OR-Tools)
 UI zapotrzebowania             • CRUD Shift/ShiftDemand/Template            rozwiązuje → przydziały + metryki
 „Generuj grafik"               • persystencja (Prisma)                ◀──────  (bezstanowy; ten sam serwis
                                • pakuje ProblemInput                         hostuje później RL agenta #2)
                                • zapisuje wynik + audyt
```

- **grafik-optimizer** — bezstanowy serwis: `POST /solve` przyjmuje `ProblemInput` (JSON), zwraca `SolveResult` (przydziały + metryki + status wykonalności). Zero dostępu do DB — cała domena przez tenant-runtime. Deploy jako kontener `optimizer` (slot `agent` z #4).
- **tenant-runtime `src/grafik`** — moduł NestJS: modele/DTO, endpointy CRUD, endpoint `POST /grafik/solve` (pakuje problem z DB → woła optimizer → zapisuje `Shift[]` z `source=AUTO` → audyt). RBAC: MANAGER układa grafik swojej jednostki, HR/ADMIN szerzej.
- **web-kit** — wypięcie z in-memory (`lib/schedule.ts` store) na realne API tenant-runtime; UI zapotrzebowania + akcja „Generuj grafik"; ręczna edycja zostaje.

## 4. Dodatki do modelu danych (Prisma — schema tenant)

Nowe modele:
```
ShiftTemplate   id, lokalizacjaTyp, nazwa, dni[], okna[] (start/end/rola/liczba)   // generator zapotrzebowania
ShiftDemand     id, lokalizacjaId, date, start, end, requiredRole, requiredCount,  // zapotrzebowanie po korekcie
                source(TEMPLATE|MANUAL)
Shift           id, employeeId, lokalizacjaId, demandId?, date, start, end, role,  // wynik
                source(AUTO|MANUAL), createdAt/updatedAt
```

Rozszerzenie `Employee`:
```
homeAddress   String   // ENCRYPTED AES-256-GCM (jak pesel) — RODO PII
homeLat       Float?   // geokod (współrzędne, nie adres) — do macierzy dojazdów
homeLng       Float?
etat          Decimal  // wymiar etatu, np. 1.0 / 0.75 / 0.5  → targetWeeklyHours = etat × 40
qualifications String[] // dopasowanie do ShiftDemand.requiredRole
```

**Ujednolicenie:** obecny `Shift` (web-kit) używa `facilityId`; docelowo wszędzie **`lokalizacjaId`** (`Lokalizacja`). Seed: `facilities.ts` → rekordy `Lokalizacja`.

## 5. Formalizacja problemu (CP-SAT)

**Zmienne decyzyjne:** `x[e, d] ∈ {0,1}` — pracownik `e` przypisany do slotu zapotrzebowania `d` (slot = konkretne okno w konkretnej lokalizacji i dniu). Slot niesie lokalizację, dzień, okno, wymaganą rolę.

**Twarde ograniczenia (constraints):**
| # | Ograniczenie | Formuła / źródło |
|---|--------------|------------------|
| H1 | Pokrycie | `Σ_e x[e,d] = d.requiredCount` dla każdego slotu `d`; tylko `e` z `d.requiredRole ∈ e.qualifications` |
| H2 | Brak nakładania | dla nakładających się w czasie slotów `d1,d2`: `x[e,d1] + x[e,d2] ≤ 1` |
| H3 | Dostępność | `x[e,d] = 0` gdy `d.date` w APPROVED LeaveRequest pracownika `e` |
| H4 | Odpoczynek dobowy ≥ 11h | zakaz par slotów tego samego `e` z przerwą < 11h (art. 132 KP) |
| H5 | Odpoczynek tygodniowy ≥ 35h | ≥ jedno 35-h okno wolne w tygodniu (art. 133 KP) |
| H6 | Limity godzin | Σ godzin `e` ≤ max dobowy (8/12h) i tygodniowy wg etatu + limity nadgodzin |

**Miękkie cele (minimalizacja `w_d·Dojazdy + w_e·Etaty + w_g·Godziny`):**
| Cel | Definicja |
|-----|-----------|
| Dojazdy | `Σ_{e,d} x[e,d] · travelCost(e.home → d.lokalizacja)` (czas/odległość z geokodu) |
| Etaty | `Σ_e |workedHours(e) − e.targetWeeklyHours|` (odchyłka od etatu) |
| Godziny | wariancja rozkładu godzin między pracownikami + kara za nierówny rozkład zmian nocnych/weekendowych; korekta o historię (AttendanceRecord) |

- **Wagi `w_d, w_e, w_g`** — konfigurowalne per tenant, sensowne domyślne (dostrajalne w UAT).
- **Horyzont:** 1 tydzień (Pon-Nd) × zbiór lokalizacji jednej jednostki/regionu (nie pojedyncza lokalizacja — inaczej dojazdy nie mają sensu decyzyjnego).
- **Determinizm:** stały seed solvera + limit czasu → ten sam input daje ten sam grafik (kryterium akceptacji + wymóg testowalności).
- **Niewykonalność:** gdy H1-H6 nie da się spełnić, `SolveResult.status = INFEASIBLE` + raport, które sloty niepokryte i dlaczego (nie cichy błąd).

## 6. Geokodowanie i RODO

- `homeAddress` szyfrowany AES-256-GCM (mechanizm jak `pesel`, `EncryptionService`).
- Geokodowanie adres→współrzędne przez **self-hosted Nominatim/OSM (region UE)** — adresy nie opuszczają infrastruktury (RODO). Współrzędne cache'owane na `Employee` (geokod raz, nie per solve).
- `travelCost`: interfejs pluginowy. Pilot: **haversine (linia prosta)** — zero zależności; **gotowość na OSRM** (realny czas dojazdu drogą) jako upgrade bez zmiany modelu solvera.
- Staging (maszyna deva, #4): adresy **syntetyczne** — żadnych realnych danych.

## 7. Kontrakt API (tenant-runtime ↔ optimizer)

```
POST /solve   (grafik-optimizer)
  ProblemInput:  { horizon:{weekStart}, locations[], employees[]{id,qualifications,etat,homeLatLng,
                   approvedLeaveDates[], historyHours}, demands[]{id,locId,date,start,end,role,count},
                   travelMatrix[e][loc], weights:{d,e,g}, solverConfig:{seed,timeLimit} }
  SolveResult:   { status: OPTIMAL|FEASIBLE|INFEASIBLE, assignments[]{employeeId,demandId},
                   metrics:{commuteTotal, etatDeviation, fairnessScore}, unmet[]{demandId,reason} }
```

## 8. Zakres #1 dla M2 (co budujemy)
Persystencja (modele §4) + moduł `tenant-runtime/src/grafik` + serwis `grafik-optimizer` (CP-SAT, H1-H6 + 3 cele) + szablony/zapotrzebowanie + akcja „Generuj grafik" + wypięcie web-kit na realne API + ręczna edycja + seed danych syntetycznych.

## 9. Poza zakresem (YAGNI / późniejsze podprojekty)
- RL / uczenie i prognozowanie — **#2**.
- Real-time i pre-uzgadnianie zamian — **#3**.
- Optymalizacja floty/pojazdów w dojazdach (na razie tylko dojazd pracownika, nie relokacja aut).
- Wielotygodniowy horyzont, pełne pokrycie wszystkich reguł Kodeksu pracy (bierzemy H4-H6; pozostałe reguły → soft/backlog).
- OSRM (routing drogowy) — interfejs gotowy, implementacja opcjonalna po pilocie.

## 10. Kryteria akceptacji

| # | Kryterium | Weryfikacja |
|---|-----------|-------------|
| G1 | Solver zwraca **wykonalny** grafik (0 naruszeń H1-H6) dla tygodnia × region na danych syntetycznych 4Mobility | test integracyjny optimizer |
| G2 | Metryki dojazdów/etatów/godzin raportowane w `SolveResult` | test kontraktu API |
| G3 | Determinizm: ten sam input → ten sam grafik | test (2× solve, porównanie) |
| G4 | Niewykonalność raportowana jawnie (`INFEASIBLE` + niepokryte sloty), bez cichego błędu | test przypadku bez rozwiązania |
| G5 | Wynik widoczny i edytowalny w siatce web-kit (realne API, nie in-memory) | smoke E2E (#4) |
| G6 | Izolacja tenantów zachowana (grafik jednego tenanta niewidoczny w drugim) | test integracyjny |

## 11. Ryzyka i mitygacje

| Ryzyko | Mitygacja |
|--------|-----------|
| CP-SAT za wolny na realnym rozmiarze | limit czasu solvera + akceptacja `FEASIBLE` (nie tylko `OPTIMAL`); horyzont per region, nie globalny |
| Reguły Kodeksu pracy trudne do pełnego zamodelowania | zakres H4-H6 jasno ograniczony; reszta jako soft/backlog, udokumentowane |
| Brak realnych danych o etatach/adresach 4Mobility | dane syntetyczne do pilota + UAT; realne dane po odbiorze |
| Rozjazd kontraktu tenant-runtime ↔ optimizer | kontrakt §7 jako współdzielony schemat (walidacja Zod/pydantic po obu stronach) |
| Geokoder self-hosted to nowy komponent | pilot na haversine (bez geokodera online); Nominatim opcjonalny |

## 12. Powiązania / identyfikowalność
- Istniejąca domena grafiku (do wypięcia): `docs/design/web-kit/lib/schedule.ts`, `lib/actions/grafik-actions.ts`, `components/grafik/`, `app/(tenant)/grafik/page.tsx`
- Model danych: `packages/db/prisma/tenant/schema.prisma` (Employee, Lokalizacja, Pojazd, LeaveRequest, AttendanceRecord)
- Szyfrowanie PII: `EncryptionService` (`packages/shared`)
- Środowisko/CI/serwis optimizer w compose: spec #4 + `docker-compose.yml`
- Kontekst funkcjonalny: `docs/HRobotDocs/d-specyfikacja-funkcjonalna-wdrozenia.md`

## 13. Otwarte kwestie do kolejnych cykli (nie blokują #1)
- Domyślne wartości wag `w_d, w_e, w_g` — dostroić w UAT (#5).
- Model kwalifikacji: `qualifications String[]` wystarcza na pilot; ewentualny słownik ról/uprawnień pojazdowych później.
- Przejście haversine → OSRM (realny routing) — po pilocie.
- #2 dziedziczy: `ProblemInput`/`SolveResult` jako kontrakt Gym-env; historia grafików jako dane treningowe.
