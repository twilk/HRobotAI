# M2 · Podprojekt #2 — Agent AI Grafik Manager (projekt)

> **Projekt:** HRobot.AI — Kamień Milowy **M2** (odbiór 20.07.2026)
> **Punkt programu:** **b)** Agent AI Grafik Manager — inteligentny, **samouczący się** asystent układania grafiku
> **Beneficjent:** App Pro sp. z o.o. (0035/2026) · **Odbiorca Technologii:** 4Mobility
> **Repozytorium:** `github.com/twilk/HRobotAI` · **Gałąź:** `main`
> **Data:** 2026-07-09 · **Status:** Projekt (brainstorming) → plan implementacyjny
> **Zależność:** #1 Rdzeń Grafiku (kontrakt `ProblemInput/SolveResult`, historia grafików) · **Powiązane:** `2026-07-09-m2-roadmap-ukonczenie.md`, `2026-07-06-m2-p1-rdzen-grafiku-design.md`

---

## 1. Wizja i miejsce w M2

**Wizja produktowa (kapitan):** Agent AI to nowoczesne narzędzie HR, które **generuje grafiki, samo się uczy, wnioskuje, samorozwija podczas pracy i automatycznie leczy swoje błędy**. To nie jest statyczny optymalizator ani jednorazowy model — to agent z pętlą ciągłego uczenia, który staje się coraz lepszy im dłużej pracuje z danym zespołem.

**Kluczowe rozróżnienie względem #1 (solver CP-SAT):** solver ma **stałe wagi** i rozwiązuje problem *tak jak go zdefiniowano*. Agent uczy się **realnych preferencji konkretnego menadżera/oddziału** z jego korekt — czego solver o stałych wagach z definicji nie potrafi. To jest odpowiedź na pytanie „co AI wnosi, czego solver nie ma": **adaptację do rzeczywistości operacyjnej i samodoskonalenie**.

**Uczciwe ramy M2 (odbiór 20.07):** pełna, produkcyjna autonomia (długohoryzontowy RL na żywych danych) to praca miesięcy — **poza M2**. M2 dostarcza **demonstrowalny pierwszy inkrement** każdej z czterech zdolności na danych syntetycznych, plus **etapową ścieżkę** do pełnej autonomii. Nie przeobiecujemy 4Mobility: demo pokazuje *działającą pętlę*, nie ukończony produkcyjny mózg.

## 2. Cztery zdolności → konkretny inkrement M2

| Zdolność (wizja) | Mechanizm | Inkrement demonstrowalny na M2 |
|------------------|-----------|-------------------------------|
| **Samoucząca** | Pętla feedbacku: każda korekta menadżera (przesunięcie/zamiana przydziału względem propozycji AI) = etykietowany sygnał uczenia | Na danych syntetycznych: po N rundach feedbacku agent proponuje grafiki wymagające **mierzalnie mniej korekt** (metryka `edit-distance` ↓) |
| **Wnioskująca** | Agent anotuje każdy przydział uzasadnieniem (które ograniczenia/cele nim kierowały) i odpowiada „dlaczego nie X?" | Endpoint `/agent/explain` zwraca rationale per przydział; widoczne w UI |
| **Samorozwijająca** | Pipeline retreningu na akumulowanym feedbacku (imitacja→RL); wersjonowanie polityki | Widoczna progresja wersji polityki `v1→v2→…` z rosnącą metryką akceptacji; artefakt treningu |
| **Samolecząca błędy** | Pętla detekcja→naprawa: propozycja przechodzi walidację wykonalności solverem; infeasible/odrzucona → agent auto-naprawia i re-proponuje | Demo: agent dostaje wadliwy input/propozycję, **wykrywa naruszenie H1-H6 i sam koryguje** bez interwencji |

## 3. Decyzje projektowe

| Decyzja | Wybór | Uzasadnienie |
|---------|-------|--------------|
| Zimny start (cold start) | **Imitacja z solvera (#1)** | Agent działa od dnia 1 bez czekania na miesiące danych; solver = nauczyciel baseline |
| Silnik uczenia | **Stable-Baselines3 (RL) + `imitation` do BC** | Pętla ciągłego uczenia to RL (nagroda z feedbacku operacyjnego), nie czysty BC; SB3 = utrzymane, właściwe miejsce |
| Środowisko | **Gym-env owijający kontrakt #1** | Stan = `ProblemInput`; akcja = przydział slotu; nagroda = wykonalność + zgodność z akceptacją menadżera + cele miękkie |
| Źródło nagrody | **Hybryda: solver (gęsta, offline) + feedback menadżera (rzadka, online)** | Cold start gęsty z solvera; online reward z realnych korekt = adaptacja |
| Serwing | **Slot `agent` w compose (Python/FastAPI)** | Zarezerwowany w spec #4; współdzieli infra z `grafik-optimizer` |
| Reconciliacja wykonalności | **Zawsze przez solver #1 przed pokazaniem** | Polityka RL może emitować infeasible; solver = strażnik + mechanizm samoleczenia |

> **Krytyczna nota inżynierska (z review):** czysta polityka RL nie zna twardych ograniczeń i **będzie** emitować niewykonalne grafiki. Dlatego każde wyjście agenta przechodzi walidację `SolveResult`/feasibility solvera przed prezentacją — a wykryte naruszenie uruchamia pętlę samoleczenia (naprawa + sygnał uczenia). To nie obejście: to jest mechanizm „samolecząca".

## 4. Architektura i pętla

```
                    feedback menadżera (korekty, akceptacje/odrzucenia)
                          │  (online reward, rzadki)
                          ▼
 ┌──────────────┐   ProblemInput    ┌──────────────────────────┐   propozycja+rationale
 │ tenant-runtime│ ───────────────▶ │  agent (Python/SB3)       │ ──────────────────────▶ web-kit
 │  src/grafik   │                  │  • Gym-env (kontrakt #1)   │
 │  (mózg domeny)│ ◀─ walidacja ──  │  • polityka vN (imitacja→RL)│
 └──────┬───────┘   wykonalności    │  • forecaster zapotrzeb.   │
        │           ┌─────────────▶ │  • self-heal: infeasible→   │
        │  ProblemInput             │    solve→repair→relearn     │
        ▼           │               └──────────┬────────────────┘
 ┌──────────────┐   │ SolveResult              │ dataset = (input→przydział, +reward)
 │grafik-optimizer│ ─┘  (baseline + strażnik)  ▼
 │  CP-SAT (#1)   │                    ┌────────────────────┐
 └──────────────┘                     │ pipeline retreningu │ → polityka v(N+1), wersjonowana
                                       │ (imitation → RL)    │
                                       └────────────────────┘
```

Pętla życia: **generuj → pokaż z rationale → menadżer koryguje → zapisz feedback → (auto-heal infeasible) → retrenuj → nowa wersja polityki**. Każdy obrót pętli czyni agenta lepszym dla tego zespołu.

## 5. Kontrakt API (agent, dodatkowo do #1)

```
POST /agent/propose   { problemInputId }         → { assignments[], rationale[], policyVersion, feasibility }
POST /agent/feedback  { proposalId, edits[], accepted:bool } → { ok, rewardLogged }
POST /agent/heal      { infeasibleProposal }      → { repairedAssignments[], whatWasWrong[] }
GET  /agent/explain   { proposalId, demandId? }   → { rationale, alternativesConsidered[] }
POST /agent/forecast  { locationId, horizon }     → { predictedDemand[] }
GET  /agent/policy    → { version, trainedAt, acceptanceMetric, trainingRuns[] }
```

Kontrakt walidowany po obu stronach (pydantic ‖ Zod). Rozszerza, nie łamie, kontraktu #1.

## 6. Dane i model danych (dodatki)

- **Cold-start dataset:** wygenerowany przez solver #1 na kanonicznym zbiorze syntetycznym (#4 §6, zamrożony D2): pary `(ProblemInput → assignments solvera)`.
- **Feedback log (nowy model, tenant schema):** `AgentFeedback` (id, proposalId, employeeId, demandId, editType(MOVE|SWAP|REMOVE|ACCEPT|REJECT), rewardSignal, createdAt) — trwałe źródło online reward.
- **Wersje polityki:** `AgentPolicyVersion` (id, version, trainedAt, metrics json, artefactPath) — audyt „samorozwoju".
- RODO: tylko dane syntetyczne w M2; feedback log nie zawiera PII poza id-kami.

## 7. Zakres #2 dla M2 (co budujemy)
Gym-env na kontrakcie #1 · cold-start imitacja (BC) · serwing polityki (`/agent/propose`) · pętla feedbacku (`/agent/feedback` + model `AgentFeedback`) · self-heal (`/agent/heal` przez solver) · rationale (`/agent/explain`) · forecaster zapotrzebowania (`/agent/forecast`, sezonowość tygodniowa) · pipeline retreningu z wersjonowaniem · demo mierzalnego spadku korekt na danych syntetycznych.

## 8. Poza zakresem M2 (etapowo po odbiorze)
Długohoryzontowy RL on-policy na żywych danych 4Mobility · pełna autonomia bez nadzoru menadżera · wielooddziałowy transfer learning · zaawansowany forecasting (pogoda/eventy/ML szeregów czasowych) · automatyczne strojenie wag solvera przez agenta.

## 9. Kryteria akceptacji

| # | Kryterium | Weryfikacja |
|---|-----------|-------------|
| AG1 | Agent proponuje **wykonalny** grafik (po walidacji solverem) na danych syntetycznych | test integracyjny |
| AG2 | **Samoucząca:** po ≥N rundach feedbacku metryka `edit-distance` propozycji maleje monotonicznie na ustalonym scenariuszu | test + wykres do evidence pack |
| AG3 | **Samolecząca:** podany infeasible input → agent wykrywa naruszenie i zwraca naprawioną, wykonalną propozycję | test przypadku |
| AG4 | **Wnioskująca:** `/agent/explain` zwraca sensowne rationale per przydział | przegląd + demo UAT |
| AG5 | **Samorozwijająca:** ≥2 wersje polityki z rosnącą metryką akceptacji + artefakt treningu | `/agent/policy` + artefakt |
| AG6 | Izolacja tenantów: feedback i polityka jednego tenanta niewidoczne w drugim | test integracyjny |

## 10. Ryzyka i mitygacje

| Ryzyko | Mitygacja |
|--------|-----------|
| Polityka emituje infeasible | zawsze walidacja solverem przed prezentacją; to zarazem mechanizm AG3 |
| „AI nic nie wnosi" (zarzut review) | demo skupione na adaptacji (AG2) + forecaster + rationale, nie na kopiowaniu solvera |
| Za mało danych na realny RL w 11 dni | cold start imitacją (działa dzień 1); online reward demonstrowany na syntetyku; pełny RL etapowo |
| Rozjazd kontraktu z #1 | kontrakt zamrożony D2 (koperta), addytywny do D3; walidacja 2-str. |
| Przeobiecanie 4Mobility | spec jawnie rozdziela „inkrement M2" od „wizji docelowej"; evidence pack (#5) opisuje etapowość |
| SB3/`imitation`/gym ciężkie do postawienia w oknie | minimalna wykonalna ścieżka: BC przez `imitation`, RL jako warstwa na feedbacku; degradacja do samego BC+forecaster jeśli D2 spec/kontrakt się opóźni |

## 11. Otwarte kwestie
- Kształt nagrody online: waga akceptacji vs cele miękkie — dostroić na danych syntetycznych.
- Reprezentacja stanu Gym-env (embedding `ProblemInput`) — zacząć od cech tabelarycznych.
- Czy `/agent/heal` reużywa `/grafik/solve` z #1 (rekomendacja: tak, DRY).
