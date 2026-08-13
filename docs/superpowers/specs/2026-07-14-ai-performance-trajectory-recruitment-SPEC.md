# SPEC — HRobot „strategiczny mózg kadrowy": analiza wydajności + trajektoria rozwoju + autonomiczna rekomendacja rekrutacji

> **Status:** pełny SPEC (krok 1 metodyki) — rozwinięcie promptu `2026-07-13-ai-analiza-wydajnosci-rekrutacja.md`.
> **Następne:** Codex adversarial crosscheck (§13) → rekonsyliacja → plan TDD → build (backend → web-kit → live RBAC) → bramki §10 + wdrożeniowa.
> **Zakres:** moduł demo/mock, dane **wyłącznie syntetyczne**, kotwice demo (36 pracowników, 832 zmiany) **nietknięte**. Model greenfield.
> **Repo:** HRobot-m2, worktree `feat/demo-4mobility`.

---

## 1. Cel (jedno zdanie)
Moduł, w którym HRobot **ciągle i autonomicznie** mierzy wydajność, terminowość, jakość ORAZ **trajektorię rozwoju** pracowników i **sam z siebie** dostarcza wyjaśnialne rekomendacje strategiczne — o retencji osób i o **wstrzymaniu/wznowieniu rekrutacji** per lokalizacja — przy czym każdą nieodwracalną akcję kadrową zatwierdza człowiek (art. 22 RODO).

## 2. Nazewnictwo modułu
- Backend: `apps/tenant-runtime/src/strategic-brain/` (moduł Nest) — nie „performance", by uniknąć mylenia z metryką pojedynczą; narracja = mózg strategiczny.
- Prefix API: `/api/strategic-brain/*` (za `RbacGuard`).
- web-kit: `lib/strategic-brain.ts` + `components/strategic-brain/*` + ekran `app/(tenant)/analiza/`.

---

## 3. Model danych (greenfield, Prisma tenant schema)
Wszystkie modele: `@@map("snake_case")`, `owner` ustawiony przez `ALTER … OWNER TO hu_<id>` po ręcznej aplikacji na żywej bazie (bramka §10.6). **Zero PII** w danych operacyjnych (żadnego PESEL/adresu; tylko `employeeId`).

### 3.1 `WorkOrder` (zlecenie — źródło Performance + Terminowość)
```prisma
model WorkOrder {
  id                  String    @id @default(uuid())
  assignedToEmployeeId String   @map("assigned_to_employee_id")
  assignedByOperatorId String?  @map("assigned_by_operator_id")   // operator, nie pracownik
  assignedAt          DateTime  @map("assigned_at")
  completedAt         DateTime? @map("completed_at")
  status              WorkOrderStatus @default(OPEN)
  lokalizacjaId       String?   @map("lokalizacja_id")
  kind                String                                      // np. "detailing", "podstawienie"
  createdAt           DateTime  @default(now()) @map("created_at")
  @@index([assignedToEmployeeId])
  @@index([lokalizacjaId])
  @@index([completedAt])
  @@map("work_order")
}
enum WorkOrderStatus { OPEN IN_PROGRESS DONE CANCELLED }
```
- **Performance** = liczba `DONE` w oknie. **Terminowość** = `completedAt − assignedAt` (cycle time). `CANCELLED` nie liczy się do żadnej metryki (nie karać za anulowane przez operatora).

### 3.2 `Complaint` (reklamacja — źródło Jakości)
```prisma
model Complaint {
  id           String   @id @default(uuid())
  workOrderId  String?  @map("work_order_id")
  employeeId   String   @map("employee_id")           // odpowiedzialny (denormalizacja dla szybkiego defect-rate)
  category     String
  severity     ComplaintSeverity @default(MINOR)
  createdAt    DateTime @map("created_at")
  @@index([employeeId])
  @@map("complaint")
}
enum ComplaintSeverity { MINOR MAJOR CRITICAL }
```
- **Jakość** = `defectRate = complaints / completedWorkOrders` w oknie (NIE liczba bezwzględna — inaczej karzemy najpracowitszych).

### 3.3 `EmployeePerformanceSnapshot` (SERIA CZASOWA — wymóg trajektorii)
```prisma
model EmployeePerformanceSnapshot {
  id                 String   @id @default(uuid())
  employeeId         String   @map("employee_id")
  windowStart        DateTime @map("window_start")
  windowEnd          DateTime @map("window_end")
  throughput         Int                                        // DONE w oknie
  medianCycleMinutes Int?     @map("median_cycle_minutes")
  slaHitRate         Decimal? @map("sla_hit_rate")             // 0..1
  defectRate         Decimal? @map("defect_rate")             // 0..1
  compositeScore     Decimal? @map("composite_score")         // 0..100 znormalizowany
  developmentSlope   Decimal? @map("development_slope")       // trend compositeScore w czasie
  confidence         Decimal  @map("confidence")              // 0..1 (mały N ⇒ niska)
  peerGroupKey       String   @map("peer_group_key")          // rola|lokalizacja|etat — normalizacja
  isNewHire          Boolean  @map("is_new_hire")
  excludedReason     String?  @map("excluded_reason")         // "L4"|"URLOP"|"ONBOARDING" — okno wykluczone z trendu
  computedAt         DateTime @default(now()) @map("computed_at")
  @@unique([employeeId, windowStart, windowEnd])
  @@index([employeeId, windowEnd])
  @@map("employee_performance_snapshot")
}
```
- Historia okien (≥3) = wejście do `developmentSlope`/velocity. `@@unique` = idempotencja przeliczeń (upsert).
- `excludedReason` realizuje ochronę przed proxy-dyskryminacją (§7): okno z L4/urlopem/onboardingiem nie zaniża trendu.

### 3.4 `RecruitmentRecommendation` (autonomiczna, per lokalizacja/zespół)
```prisma
model RecruitmentRecommendation {
  id                 String   @id @default(uuid())
  scopeType          RecoScopeType @default(LOKALIZACJA) @map("scope_type")
  scopeId            String   @map("scope_id")            // lokalizacjaId lub unitId
  verdict            RecruitmentVerdict
  rationale          String                                // czytelne uzasadnienie
  factors            Json                                  // breakdown liczbowy (capacity gap, defect, sla, nowi/confidence)
  computedAt         DateTime @default(now()) @map("computed_at")
  supersededAt       DateTime? @map("superseded_at")      // append-only: nowa rekomendacja „zamyka" starą
  acknowledgedByUserId String? @map("acknowledged_by_user_id")
  acknowledgedAt     DateTime? @map("acknowledged_at")
  @@index([scopeType, scopeId, supersededAt])
  @@map("recruitment_recommendation")
}
enum RecoScopeType { LOKALIZACJA UNIT }
enum RecruitmentVerdict { WZNOW WSTRZYMAJ UTRZYMAJ }
```
- **Append-only** (jak audit): nowa rekomendacja ustawia `supersededAt` na poprzedniej, nie nadpisuje. „Aktualna" = `supersededAt IS NULL`.
- `acknowledgedBy*` = **ludzka decyzja** na podstawie rekomendacji (nie wykonanie zwolnień) — audytowane ids-only.

### 3.5 `PerformanceConfig` (wzór `AiSchedulingConfig`)
```prisma
model PerformanceConfig {
  id               String   @id @default(uuid())
  unitId           String?  @map("unit_id")               // NULL = wiersz domyślny
  weightPerformance Decimal @default(0.30) @map("weight_performance")
  weightTimeliness  Decimal @default(0.25) @map("weight_timeliness")
  weightQuality     Decimal @default(0.25) @map("weight_quality")
  weightDevelopment Decimal @default(0.20) @map("weight_development")   // trajektoria jako pełnoprawny wymiar
  slaTargetMinutes Int      @default(120) @map("sla_target_minutes")
  defectThreshold  Decimal  @default(0.10) @map("defect_threshold")
  confidenceMinDays Int     @default(30) @map("confidence_min_days")    // definicja „nowego"
  windowDays       Int      @default(14) @map("window_days")
  minSlopeForGrowth Decimal @default(0.5) @map("min_slope_for_growth")
  proactivityLevel ProactivityLevel @default(PROAKTYWNE_REKOMENDACJE) @map("proactivity_level")
  createdAt        DateTime @default(now()) @map("created_at")
  updatedAt        DateTime @updatedAt @map("updated_at")
  @@unique([unitId])
  @@map("performance_config")
}
enum ProactivityLevel { TYLKO_NA_ZADANIE PROAKTYWNE_REKOMENDACJE PROAKTYWNE_ALERTY }
// UWAGA: brak poziomu „AUTO_AKCJA_KADROWA" — twardy limit §7 (test wymusza brak w enumie).
```
Wagi domyślne sumują się do 1.00 (walidacja w `PerformanceConfigService`).

---

## 4. Silnik: pure functions (TDD, `cost/`-styl util + spec)
Plik `apps/tenant-runtime/src/strategic-brain/scoring.util.ts` — czyste funkcje, w pełni testowane:
- `medianCycleMinutes(orders): number|null`
- `slaHitRate(orders, slaTargetMinutes): number|null`
- `defectRate(completedCount, complaintCount): number|null`
- `normalizeToPeerGroup(value, peerValues): number` — percentyl/z-score względem peer-group (rola|lokalizacja|etat).
- `compositeScore(dims, weights): number` — 0..100, ważona z 4 wymiarów.
- `developmentSlope(snapshotSeries): number` — regresja liniowa `compositeScore` po czasie, **z pominięciem okien `excludedReason≠null`**.
- `confidence(sampleN, daysEmployed, minDays): number` — 0..1, rośnie z N i stażem.
- `retentionSignal(score, slope, confidence, cfg): 'UTRZYMAC'|'OBSERWOWAC'|'RYZYKO'|'INWESTOWAC'` — **INWESTOWAC** = słaby-ale-rosnący (niski score, dodatni slope); **RYZYKO** = dobry-ale-spadający (wysoki score, ujemny slope). Rozróżnienie poziom-vs-trend jest rdzeniem.
- `recruitmentVerdict(locStats, cfg): {verdict, factors, rationale}` — WZNOW gdy luka capacity (spięcie ze SP4/grafikiem) + wydajność/jakość poniżej celu; WSTRZYMAJ gdy powyżej celu i stabilnie; UTRZYMAJ w strefie neutralnej.

Materializacja wyników do snapshotów/rekomendacji (szybki, audytowalny UI — nie licz w request-time).

## 5. Scheduler (ciągła analiza „sama z siebie")
- Wzór `outbox-relay.service.ts` (`@Interval`/cron w Nest) — job `StrategicBrainScheduler`.
- Co interwał (demo: krótki; prod: nightly): przelicz snapshoty okien per pracownik (upsert po `@@unique`), potem rekomendacje retencji + rekrutacji (append-only supersede).
- Idempotentny: ponowne uruchomienie nie duplikuje (upsert snapshotów; supersede tylko przy zmianie verdictu/istotnej zmianie factors).
- `PROAKTYWNE_ALERTY` ⇒ push do HR przez istniejący `NotificationsService` (nie e-mail zewnętrzny; in-app).

## 6. API (kontrakty, wszystkie za `RbacGuard`, `@TenantRoute`)
| Metoda | Ścieżka | Role | Zwraca |
|---|---|---|---|
| GET | `/api/strategic-brain/overview` | HR, ADMIN_KLIENTA, MANAGER(scoped) | heatmapa wydajności + feed rekomendacji (retencja+rekrutacja) |
| GET | `/api/strategic-brain/employee/:id` | HR, ADMIN, MANAGER(scoped), PRACOWNIK(self) | karta: 4 wymiary + seria trajektorii + confidence + retentionSignal + breakdown |
| GET | `/api/strategic-brain/recruitment` | HR, ADMIN, MANAGER(scoped) | rekomendacje per lokalizacja (aktualne) |
| POST | `/api/strategic-brain/recruitment/:id/acknowledge` | HR, ADMIN | loguje ludzką decyzję (audit ids-only); **NIE** wykonuje akcji kadrowej |
| GET/PATCH | `/api/strategic-brain/config` | HR, ADMIN | wagi/progi/poziom proaktywności (walidacja Σwag=1) |
- `unit-scope`: MANAGER widzi tylko swoje jednostki (wzór `employees`); PRACOWNIK tylko `:id === self` (Employee.user_id ↔ JWT sub).
- Projekcje **SAFE_SELECT allowlist**; audit ids-only każdej rekomendacji i każdego `acknowledge`.

## 7. RODO + odpowiedzialna AI (WARUNEK KONIECZNY)
- **Art. 22:** żadnej w pełni zautomatyzowanej decyzji o skutkach istotnych. Autonomia = analiza+rekomendacja; akcję zatwierdza człowiek. Banner wszędzie: „Rekomendacja AI — decyzję podejmuje człowiek".
- **Wyjaśnialność:** każdy score i rekomendacja rozbite na czynniki+wagi; „rozwój" jawnie (co znaczy „nie rozwija się" = slope < `minSlopeForGrowth` przy confidence ≥ próg).
- **Uczciwość:** normalizacja per peer-group; ochrona nowych (confidence — NIE karać za brak danych); **brak cech chronionych** (wiek, płeć, pochodzenie, zdrowie, ciąża, związkowość) w scoringu — **test wymuszający** (scoring input type nie zawiera tych pól). Proxy-guard: okna `L4/URLOP/ONBOARDING` wykluczone z trendu (`excludedReason`).
- **Minimalizacja + audyt:** SAFE_SELECT; audit ids-only; append-only rekomendacje.
- **Interceptor:** `SENSITIVE_KEYS` już redaguje pesel/identifier — potwierdzić, że nowe DTO nie wnoszą PII.

## 8. RBAC + UI (Polski, „strategic dashboard")
- Ekran `analiza/`: (a) **overview** — heatmapa 4 wymiarów × pracownik/jednostka + **feed proaktywnych rekomendacji** (retencja + rekrutacja) z uzasadnieniami; (b) **karta pracownika** — 4 wymiary + **sparkline trajektorii** (seria snapshotów) + confidence + retentionSignal + breakdown; (c) **panel rekrutacji** per lokalizacja (WZNOW/WSTRZYMAJ/UTRZYMAJ + „Zaakceptuj rekomendację" = loguje decyzję); (d) **banner RODO** stały.
- web-kit: `lib/strategic-brain.ts` (aiFetch + error-class + pure kalkulatory formatujące + vitest), proxy `[[...path]]`, server-shell `getSession`+AppShell+RBAC-gate, enrichment id→nazwisko przez `/api/employees`.
- Semantyka kolorów (dobra/uwaga/ryzyko) osobno od akcentu; sparkline z wyróżnionym końcem; „INWESTOWAC" (słaby-rosnący) wizualnie odróżnione od „RYZYKO" (dobry-spadający).

## 9. Seed syntetyczny (spójny z 36 pracownikami, kotwice nietknięte)
`scripts/seed-demo-strategic-brain.sql` — dla podzbioru istniejących pracowników generuje WorkOrder/Complaint + serię ≥3 snapshotów pokazującą **wszystkie ścieżki**:
- gwiazda-stabilna (wysoki score, slope≈0) · dobry-spadający (wysoki, slope<0 ⇒ RYZYKO) · słaby-rosnący (niski, slope>0 ⇒ INWESTOWAC) · słaby-płaski (niski, slope≈0 ⇒ RYZYKO/OBSERWOWAC) · nowy-rosnący (niska confidence, slope>0 ⇒ obserwuj) · nowy-płaski.
- Min. jedna lokalizacja z luką capacity (⇒ WZNOW) i jedna stabilna-powyżej-celu (⇒ WSTRZYMAJ).
- Jedno okno z `excludedReason='L4'` u „dobrego" pracownika — demo pokazuje, że powrót z L4 NIE zaniża trendu.
- Idempotentny (guarded INSERT/`ON CONFLICT DO NOTHING`), tylko syntetyczne id-prefiksy, nie rusza 832 zmian.

## 10. Bramki człowieka — PROPOZYCJE domyślnych (do potwierdzenia przed buildem)
| # | Gate | Proponowana wartość | Uzasadnienie |
|---|---|---|---|
| 1 | Wagi 4 wymiarów | 0.30 / 0.25 / 0.25 / **0.20 rozwój** | rozwój pełnoprawny, ale nie dominujący; poziom nadal główny |
| 2 | Poziom proaktywności (default) | `PROAKTYWNE_REKOMENDACJE` | agent liczy sam, ale nie spamuje pushami; alerty opcjonalnie |
| 3 | PRACOWNIK widzi swój score/trajektorię | **TAK (self, read-only)** | transparentność RODO wzmacnia narrację; nie widzi cudzych |
| 4 | Definicja „rozwoju" | okno 14 dni, ≥3 okna, `minSlope=0.5`, wyklucz L4/URLOP/ONBOARDING | nie krzywdzić po przerwach; trend wymaga serii |
| 5 | Źródło zleceń/reklamacji | **mock** (demo) | real po demo |
| 6 | Migracja na żywą bazę | **bramka człowieka** + `ALTER OWNER` | zgodnie z procedurą wdrożeniową |

## 11. Kryteria akceptacji (= §11 promptu)
4 wymiary liczone i wyjaśnione; nowy z jawną confidence; trajektoria rozróżnia słaby-rosnący vs dobry-spadający; autonomiczny feed bez ręcznego wyzwalania; guardrails RODO widoczne + test braku cech chronionych; audit ids-only; RBAC na 3 kontach (HR pełny / MANAGER scoped / PRACOWNIK self); gate'y (tsc/vitest/jest) zielone; migracja create-only.

## 12. Plan build (fazy)
1. **Backend model+silnik:** Prisma modele → `scoring.util.ts` + spec (TDD) → `PerformanceConfigService` (Σwag=1) → snapshot/reco services → scheduler → controller+RBAC+audit → jest zielony.
2. **Seed:** `seed-demo-strategic-brain.sql` (6 profili + 2 lokalizacje + okno L4) → apply lokalnie.
3. **web-kit:** `lib/strategic-brain.ts` (+vitest) → overview → karta+sparkline → panel rekrutacji → banner RODO → tsc/vitest zielone.
4. **Live RBAC** na 3 kontach (admin/manager/pracownica.demo) → weryfikacja scoping + self + banner + audit clean.
5. **Bramki §10** i wdrożeniowa — human gate przed migracją na żywą bazę i przed pushem.

## 13. Do ataku przez Codex (adversarial crosscheck)
- Model danych: czy `WorkOrder`/`Complaint`/snapshot pokrywają wszystkie 4 wymiary + trajektorię bez PII? denormalizacja `Complaint.employeeId` vs integralność?
- Scoring: normalizacja peer-group przy małym N; composite gdy brakuje wymiaru (null-handling); slope przy <3 oknach; podatność na gaming.
- Fairness/RODO: czy proxy-guard (L4/urlop) wystarcza? czy peer-group nie ukrywa dyskryminacji? test braku cech chronionych szczelny?
- Autonomia: czy scheduler + append-only faktycznie uniemożliwiają auto-akcję kadrową? idempotencja supersede.
- Reużycia vs realny kod: `@@unique([unitId])` partial-default, `RbacGuard`/`unit-scope`, `AuditService`, `NotificationsService`, SAFE_SELECT — zgodne z faktycznymi sygnaturami?
- Spięcie capacity-gap ze SP4/grafikiem: skąd realnie „zapotrzebowanie" na demo?

---

## 14. Rekonsyliacja Codex (AUTORYTATYWNA — nadpisuje wcześniejsze sekcje przy konflikcie)
Codex adversarial crosscheck (2026-07-14): 6 BLOCKER, 14 MAJOR, 1 MINOR, werdykt „not buildable as-is". **Wszystkie 21 trafne** (zweryfikowane wobec realnego kodu M2). Rozstrzygnięcia:

### BLOCKERY (must-fix przed buildem)
- **[B1] `PerformanceConfig` nullable-default uniqueness.** Postgres dopuszcza wiele NULL — `@@unique([unitId])` nie chroni wiersza domyślnego. Fix: dodać **partial unique index** `CREATE UNIQUE INDEX perf_config_default_unique ON performance_config(unit_id) WHERE unit_id IS NULL` (jak `ai_scheduling_config`), a serwis `PerformanceConfigService.upsertConfig` naśladuje `AiConfigService.upsertConfig` (P2002-recovery). Migracja create-only + `ALTER OWNER`.
- **[B2] Snapshot = materializowany CACHE, nie fakt audytowy.** Dodać `algorithmVersion Int` + `configHash String` do `EmployeePerformanceSnapshot`; upsert po `@@unique([employeeId, windowStart, windowEnd])` **świadomie nadpisuje** przy przeliczeniu. Reprodukowalność decyzji zapewnia to, że każda `RecruitmentRecommendation`/retencja **zamraża własne `factors` (Json)** w chwili wydania — nie zależy od bieżących wag. Trajektoria czytana z cache.
- **[B3] Rekomendacja: model zdarzeń niemutowalnych, nie „supersede przez mutację".** Zamiast ustawiać `supersededAt` na starym wierszu (to mutacja — jedyny prawdziwy append-only w repo to `audit_log` z triggerem), model = **immutable events** z `replacesRecommendationId String?`. „Aktualna" = najnowsze zdarzenie per scope (bez `supersededAt`). Usunąć `supersededAt`.
- **[B4] Wyścig przy insercie „aktualnej".** Scheduler trzyma **`pg_advisory_xact_lock`** per tenant (jeden przebieg naraz) — eliminuje podwójny insert. Dodatkowo change-detection: nowe zdarzenie tylko gdy `verdict` lub istotne `factors` się zmieniły. (Partial-unique na „aktywnej" nie pasuje do modelu zdarzeń — lock + dedup zamiast tego.)
- **[B5] Źródło capacity-gap konkretne i reprodukowalne.** NIE efemeryczne `unmet[]` solvera. Gap liczony z **persystowanych** danych: `ShiftDemand.requiredCount` MINUS liczba przypisanych `Shift` per lokalizacja×rola×tydzień. Query deterministyczne → rekomendacja rekrutacji reprodukowalna z DB. (Poprawka §3.4/§4/§6.)
- **[B-notif] `NotificationsService` NIE istnieje w M2** (jest w głównym repo, nie w tym worktree). Fix: **push zdejmujemy z zakresu MVP.** Domyślny `proactivityLevel = PROAKTYWNE_REKOMENDACJE` (feed serwowany PULL-em przez `/overview`, „sam z siebie" = scheduler liczy w tle, user tylko otwiera ekran). `PROAKTYWNE_ALERTY` zostaje w enumie jako **roadmap** (bez implementacji push). Kryteria akceptacji NIE zależą od notyfikacji.

### MAJORY (rozstrzygnięcia)
- **[M5] `Complaint` integralność:** dodać relacje FK do `Employee` i `WorkOrder`; źródło kanoniczne = `workOrder.assignedToEmployeeId`; test wymusza `complaint.employeeId === workOrder.assignedToEmployeeId` gdy `workOrderId` ustawione.
- **[M6/M7] `WorkOrder` = osobne, syntetyczne źródło demo** (zadania detailing/podstawienie 4Mobility — świadomie ODRĘBNE od `Shift`/`ShiftDemand`). `kind` z **ograniczonego zbioru** (walidacja); **SLA per `kind`** z mapy w `PerformanceConfig` (lub stała mapa demo); `dueAt = assignedAt + slaForKind`. Terminowość = `completedAt ≤ dueAt`. Denominator jakości = liczba `DONE` (min. próg denominatora, inaczej confidence↓). „Brak pracy" = **brak danych** (niska confidence), NIE zła wydajność.
- **[M8] Null-policy composite (deterministyczna + testowana):** brakujący wymiar → **renormalizacja wag** po obecnych wymiarach; jeśli obecne < 2 wymiary → `compositeScore = null` + kara confidence. Testy dla każdego wariantu częściowych danych.
- **[M9] Slope < `minValidWindows` (=3 ważne okna) → `null`.** Reguły retencji/rekrutacji traktują **null-trend ≠ flat-trend**: null → „OBSERWUJ, zbieraj dane" (nigdy RYZYKO).
- **[M10] Peer-group małe N:** `minPeerGroupSize` (=5); **fallback** grupowania (rola|lokalizacja|etat → rola|lokalizacja → rola → global); kara confidence; UI ujawnia „grupa zbyt mała — normalizacja orientacyjna" (ochrona przed re-identyfikacją).
- **[M11] Fairness = ALLOWLIST, nie denylist.** `ScoringInput` budowany z **jawnie wymienionych** pól operacyjnych; test buduje input z Prisma-select i **fail'uje, jeśli wejdzie nieoczekiwany klucz** (dowodzi braku proxy, nie tylko braku nazwy cechy).
- **[M12] Wykluczenia (L4/urlop/onboarding) z danych STRUKTURALNYCH, nie string-match:** okno onboardingu z `Employee.hiredAt`; wykluczenia absencji z **przecięcia dat** `LeaveRequest` (mapa znanych `type`→kategoria, udokumentowana) z oknem snapshotu. `excludedReason` = wynik pochodny, nie ręczny string.
- **[M13] Art. 22 twarda granica zapisu:** moduł `strategic-brain` pisze **wyłącznie** do własnych tabel (snapshot/recommendation/config/acknowledge). Test architektoniczny: serwisy modułu **nigdy** nie mutują `Employee`/`Shift`/`AiProposal` ani stanu wykonania kadrowego (brak importu ścieżek zapisu).
- **[M14] Scheduler:** `@Cron` (nie `@Interval`); jawna iteracja po tenantach; `pg_advisory_xact_lock` (patrz B4) przeciw podwójnemu uruchomieniu przy wielu instancjach.
- **[M16] RBAC jawnie service-level:** `RbacGuard` tylko grube role (`hrobot_roles`); **każdy endpoint** robi własny scope-check przez `managedUnitIds` (`unit-scope.ts`). Spec nie sugeruje, że guard robi scoping.
- **[M17] Self endpoint = `/strategic-brain/employee/me`** (kolejność tras jak `employees/me`); `:id` tylko HR/MANAGER(scoped); PRACOWNIK trafia na `/me` (lookup przez `User.keycloakSub`).
- **[M18] SAFE_SELECT:** projekcje **module-local** dla strategic-brain (nie współdzielony allowlist). I tak brak pól PII (tylko `employeeId` + metryki liczbowe).
- **[M19] Audit ids-only budowany ręcznie:** serwisy konstruują payload ids-only same (AuditService przyjmuje dowolny payload — nie wymusza); test: brak nazwisk/PII/`rationale`/`factors`-tekstu w audycie.

### MINOR
- **[M21] web-kit:** dodać jawnie `app/api/strategic-brain/[[...path]]/route.ts` (proxy wzorem `api/ai-grafik/[[...path]]`) + ekran `app/(tenant)/analiza/`.

### Skutki dla modelu danych (netto zmiany vs §3)
1. `PerformanceConfig`: + partial-unique index (B1).
2. `EmployeePerformanceSnapshot`: + `algorithmVersion`, `configHash` (B2).
3. `RecruitmentRecommendation`: − `supersededAt`, + `replacesRecommendationId` (B3).
4. `WorkOrder`: `kind` ograniczony + `dueAt` + SLA-per-kind (M6/M7).
5. `Complaint`: + FK do `Employee`/`WorkOrder` + test spójności (M5).
6. Capacity-gap: query `ShiftDemand − Shift` (B5), nie nowa tabela.

**Werdykt po rekonsyliacji:** buildable — po naniesieniu B1–B5 + [B-notif] do modelu/planu. Fairness (M8–M12) i granica zapisu (M13) idą jako **testy wymuszające** w fazie 1 (TDD).
