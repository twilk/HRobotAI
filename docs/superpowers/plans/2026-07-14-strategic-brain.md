# Strategic-Brain (analiza wydajności + trajektoria + rekomendacja rekrutacji) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Zbudować moduł `strategic-brain`, który ciągle (scheduler) i wyjaśnialnie liczy 4 wymiary wydajności + trajektorię rozwoju pracowników i autonomicznie wydaje rekomendacje retencji + rekrutacji, przy twardej granicy RODO art. 22 (tylko rekomendacja, nigdy auto-akcja kadrowa).

**Architecture:** NestJS moduł `apps/tenant-runtime/src/strategic-brain/` z czystymi funkcjami scoringu (TDD), `@Cron` schedulerem pod `pg_advisory_xact_lock`, immutable-event rekomendacjami, oraz Prisma greenfield modelami (WorkOrder/Complaint jako osobne syntetyczne źródło demo, snapshot jako materializowany cache z wersjonowaniem). web-kit: proxy `[[...path]]` + `lib/strategic-brain.ts` + ekran `analiza/`. Wszystko za `RbacGuard` (grube role) + service-level scope przez `managedUnitIds`.

**Tech Stack:** TypeScript, NestJS, Prisma (Postgres, tenant DB-per-tenant), Jest (backend), Next.js 15 + vitest (web-kit). Autorytatywne źródło: `docs/superpowers/specs/2026-07-14-ai-performance-trajectory-recruitment-SPEC.md` (szczególnie §14 rekonsyliacja Codex).

**Decyzje bramek §10 (zatwierdzone 2026-07-14):** wagi 0.30/0.25/0.25/**0.20 rozwój**; `PROAKTYWNE_REKOMENDACJE` default (feed PULL, push poza MVP); **PRACOWNIK widzi swój score (self, read-only)** przez `/employee/me`; okno 14 dni, `minValidWindows=3`, `minSlope=0.5`, `minPeerGroupSize=5`, wykluczenia L4/URLOP/ONBOARDING z danych strukturalnych; źródło zleceń/reklamacji = mock; migracja na żywą bazę = bramka człowieka.

**Twarde inwarianty (z §14) — nie wolno ich naruszyć:**
- B2: snapshot = cache (upsert po [employeeId,windowStart,windowEnd]); + `algorithmVersion`,`configHash`. Rekomendacje zamrażają własne `factors`.
- B3: rekomendacja = immutable event z `replacesRecommendationId` (BEZ `supersededAt`). „Aktualna" = najnowsze zdarzenie per scope.
- B4/M14: scheduler pod `pg_advisory_xact_lock` per tenant; `@Cron`.
- B5: capacity-gap = query `ShiftDemand.requiredCount − COUNT(Shift)` per lokalizacja×rola×tydzień (persystowane).
- M11: fairness = ALLOWLIST inputu scoringu + test fail przy nieoczekiwanym kluczu.
- M13: moduł pisze WYŁĄCZNIE do własnych tabel; test architektoniczny zabrania mutacji Employee/Shift/AiProposal.
- M19: audit ids-only budowany ręcznie; test braku PII/nazwisk/rationale.

---

## Struktura plików
**Backend (nowe):**
- `packages/db/prisma/tenant/schema.prisma` (modyfikacja: +5 modeli +4 enumy)
- `packages/db/prisma/tenant/migrations/20260714xxxxxx_strategic_brain/migration.sql` (create-only + partial index + `ALTER OWNER` placeholder)
- `apps/tenant-runtime/src/strategic-brain/scoring.util.ts` + `.spec.ts` (rdzeń, czyste funkcje)
- `apps/tenant-runtime/src/strategic-brain/scoring-input.ts` + `.spec.ts` (ALLOWLIST + guard test)
- `apps/tenant-runtime/src/strategic-brain/snapshot.service.ts` + `.spec.ts`
- `apps/tenant-runtime/src/strategic-brain/recommendation.service.ts` + `.spec.ts`
- `apps/tenant-runtime/src/strategic-brain/capacity-gap.service.ts` + `.spec.ts`
- `apps/tenant-runtime/src/strategic-brain/performance-config.service.ts` + `.spec.ts`
- `apps/tenant-runtime/src/strategic-brain/strategic-brain.scheduler.ts` + `.spec.ts`
- `apps/tenant-runtime/src/strategic-brain/strategic-brain.controller.ts` + `.spec.ts`
- `apps/tenant-runtime/src/strategic-brain/strategic-brain.module.ts`
- `apps/tenant-runtime/src/strategic-brain/write-boundary.spec.ts` (M13 architektoniczny)
- `apps/tenant-runtime/src/app.module.ts` (rejestracja modułu)

**Seed:** `scripts/seed-demo-strategic-brain.sql`

**web-kit (nowe):**
- `docs/design/web-kit/app/api/strategic-brain/[[...path]]/route.ts` (proxy)
- `docs/design/web-kit/lib/strategic-brain.ts` + `test/strategic-brain.test.ts`
- `docs/design/web-kit/components/strategic-brain/{overview,employee-card,recruitment-panel,rodo-banner}.tsx`
- `docs/design/web-kit/app/(tenant)/analiza/page.tsx`

---

## FAZA 1 — Backend: model + silnik + scheduler + API (TDD)

### Task 1: Prisma modele + enumy (greenfield)

**Files:**
- Modify: `packages/db/prisma/tenant/schema.prisma`

- [ ] **Step 1: Dodaj modele i enumy** (na końcu pliku, przed żadnym trailing content)

```prisma
enum WorkOrderStatus { OPEN IN_PROGRESS DONE CANCELLED }
enum ComplaintSeverity { MINOR MAJOR CRITICAL }
enum RecoScopeType { LOKALIZACJA UNIT }
enum RecruitmentVerdict { WZNOW WSTRZYMAJ UTRZYMAJ }
enum ProactivityLevel { TYLKO_NA_ZADANIE PROAKTYWNE_REKOMENDACJE PROAKTYWNE_ALERTY }

model WorkOrder {
  id                   String   @id @default(uuid())
  assignedToEmployeeId String   @map("assigned_to_employee_id")
  assignedTo           Employee @relation("WorkOrderAssignee", fields: [assignedToEmployeeId], references: [id])
  assignedByOperatorId String?  @map("assigned_by_operator_id")
  assignedAt           DateTime @map("assigned_at")
  dueAt                DateTime @map("due_at")            // assignedAt + SLA(kind) — M6/M7
  completedAt          DateTime? @map("completed_at")
  status               WorkOrderStatus @default(OPEN)
  lokalizacjaId        String?  @map("lokalizacja_id")
  kind                 String                              // zbiór ograniczony walidacją serwisu
  createdAt            DateTime @default(now()) @map("created_at")
  complaints           Complaint[]
  @@index([assignedToEmployeeId])
  @@index([lokalizacjaId])
  @@index([completedAt])
  @@map("work_order")
}

model Complaint {
  id          String   @id @default(uuid())
  workOrderId String?  @map("work_order_id")
  workOrder   WorkOrder? @relation(fields: [workOrderId], references: [id])
  employeeId  String   @map("employee_id")
  employee    Employee @relation("ComplaintEmployee", fields: [employeeId], references: [id])
  category    String
  severity    ComplaintSeverity @default(MINOR)
  createdAt   DateTime @map("created_at")
  @@index([employeeId])
  @@map("complaint")
}

model EmployeePerformanceSnapshot {
  id                 String   @id @default(uuid())
  employeeId         String   @map("employee_id")
  employee           Employee @relation("SnapshotEmployee", fields: [employeeId], references: [id])
  windowStart        DateTime @map("window_start")
  windowEnd          DateTime @map("window_end")
  throughput         Int
  medianCycleMinutes Int?     @map("median_cycle_minutes")
  slaHitRate         Decimal? @map("sla_hit_rate")
  defectRate         Decimal? @map("defect_rate")
  compositeScore     Decimal? @map("composite_score")
  developmentSlope   Decimal? @map("development_slope")
  confidence         Decimal  @map("confidence")
  peerGroupKey       String   @map("peer_group_key")
  isNewHire          Boolean  @map("is_new_hire")
  excludedReason     String?  @map("excluded_reason")
  algorithmVersion   Int      @default(1) @map("algorithm_version")   // B2
  configHash         String   @map("config_hash")                    // B2
  computedAt         DateTime @default(now()) @map("computed_at")
  @@unique([employeeId, windowStart, windowEnd])
  @@index([employeeId, windowEnd])
  @@map("employee_performance_snapshot")
}

model RecruitmentRecommendation {
  id                     String   @id @default(uuid())
  scopeType              RecoScopeType @default(LOKALIZACJA) @map("scope_type")
  scopeId                String   @map("scope_id")
  verdict                RecruitmentVerdict
  rationale              String
  factors                Json                                  // zamrożone w chwili wydania — B2
  replacesRecommendationId String? @map("replaces_recommendation_id")  // B3 immutable event
  computedAt             DateTime @default(now()) @map("computed_at")
  acknowledgedByUserId   String?  @map("acknowledged_by_user_id")
  acknowledgedAt         DateTime? @map("acknowledged_at")
  @@index([scopeType, scopeId, computedAt])
  @@map("recruitment_recommendation")
}

model PerformanceConfig {
  id                String   @id @default(uuid())
  unitId            String?  @map("unit_id")
  weightPerformance Decimal  @default(0.30) @map("weight_performance")
  weightTimeliness  Decimal  @default(0.25) @map("weight_timeliness")
  weightQuality     Decimal  @default(0.25) @map("weight_quality")
  weightDevelopment Decimal  @default(0.20) @map("weight_development")
  slaTargetMinutes  Int      @default(120) @map("sla_target_minutes")
  defectThreshold   Decimal  @default(0.10) @map("defect_threshold")
  confidenceMinDays Int      @default(30) @map("confidence_min_days")
  windowDays        Int      @default(14) @map("window_days")
  minValidWindows   Int      @default(3) @map("min_valid_windows")
  minSlopeForGrowth Decimal  @default(0.5) @map("min_slope_for_growth")
  minPeerGroupSize  Int      @default(5) @map("min_peer_group_size")
  proactivityLevel  ProactivityLevel @default(PROAKTYWNE_REKOMENDACJE) @map("proactivity_level")
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")
  @@unique([unitId])
  @@map("performance_config")
}
```
Dodaj też relacje odwrotne na modelu `Employee` (pola: `workOrders WorkOrder[] @relation("WorkOrderAssignee")`, `complaints Complaint[] @relation("ComplaintEmployee")`, `performanceSnapshots EmployeePerformanceSnapshot[] @relation("SnapshotEmployee")`).

- [ ] **Step 2: Wygeneruj migrację (create-only)**

Run: `cd packages/db && pnpm prisma migrate dev --name strategic_brain --create-only`
Expected: nowy folder `migrations/20260714xxxxxx_strategic_brain/migration.sql`.

- [ ] **Step 3: Dopisz partial unique index (B1) na końcu migration.sql**

```sql
-- B1: nullable-default uniqueness (Postgres dopuszcza wiele NULL)
CREATE UNIQUE INDEX "perf_config_default_unique" ON "performance_config"("unit_id") WHERE "unit_id" IS NULL;
-- Bramka wdrożeniowa: po ręcznej aplikacji na żywej bazie wykonać ALTER TABLE ... OWNER TO hu_<id> dla nowych tabel/typów (patrz reference_hrobot_m2_deploy).
```

- [ ] **Step 4: Zregeneruj klienta + tsc**

Run: `cd packages/db && pnpm prisma generate` then `pnpm -w -F @hrobot/db build` (lub `tsc -b`)
Expected: PASS, typy `WorkOrder`/`Complaint`/`EmployeePerformanceSnapshot`/`RecruitmentRecommendation`/`PerformanceConfig` dostępne.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/tenant/schema.prisma packages/db/prisma/tenant/migrations
git commit -m "feat(strategic-brain): greenfield Prisma models + partial-unique default config"
```

---

### Task 2: `scoring.util.ts` — czyste funkcje (rdzeń, TDD)

**Files:**
- Create: `apps/tenant-runtime/src/strategic-brain/scoring.util.ts`
- Test: `apps/tenant-runtime/src/strategic-brain/scoring.util.spec.ts`

- [ ] **Step 1: Napisz failing testy** (pełne przypadki, w tym null-policy M8/M9)

```ts
import { medianCycleMinutes, defectRate, compositeScore, developmentSlope, confidence, retentionSignal } from './scoring.util'

describe('scoring.util', () => {
  it('medianCycleMinutes: null gdy brak ukończonych', () => {
    expect(medianCycleMinutes([])).toBeNull()
    expect(medianCycleMinutes([{ cycleMinutes: 10 }, { cycleMinutes: 30 }, { cycleMinutes: 20 }])).toBe(20)
  })
  it('defectRate: complaints/DONE, null gdy denominator < 1', () => {
    expect(defectRate(0, 3)).toBeNull()
    expect(defectRate(10, 2)).toBeCloseTo(0.2)
  })
  it('compositeScore: renormalizuje wagi po obecnych wymiarach (M8)', () => {
    // brak quality → waga rozkłada się na obecne
    const s = compositeScore({ performance: 80, timeliness: 60, quality: null, development: 40 },
      { performance: 0.3, timeliness: 0.25, quality: 0.25, development: 0.2 })
    expect(s).not.toBeNull()
  })
  it('compositeScore: null gdy < 2 wymiary obecne (M8)', () => {
    expect(compositeScore({ performance: 80, timeliness: null, quality: null, development: null },
      { performance: 0.3, timeliness: 0.25, quality: 0.25, development: 0.2 })).toBeNull()
  })
  it('developmentSlope: null gdy < minValidWindows (M9)', () => {
    expect(developmentSlope([{ t: 0, score: 40 }, { t: 1, score: 50 }], 3)).toBeNull()
  })
  it('developmentSlope: dodatni dla rosnącej serii ≥3', () => {
    const slope = developmentSlope([{ t: 0, score: 40 }, { t: 1, score: 50 }, { t: 2, score: 60 }], 3)
    expect(slope!).toBeGreaterThan(0)
  })
  it('retentionSignal: INWESTOWAC dla słaby-rosnący; RYZYKO dla dobry-spadający; OBSERWUJ dla null-trend (M9)', () => {
    const cfg = { minSlopeForGrowth: 0.5, confidenceMin: 0.5 }
    expect(retentionSignal(35, 5, 0.9, cfg)).toBe('INWESTOWAC')
    expect(retentionSignal(85, -5, 0.9, cfg)).toBe('RYZYKO')
    expect(retentionSignal(50, null, 0.9, cfg)).toBe('OBSERWOWAC')
  })
})
```

- [ ] **Step 2: Uruchom — ma failować.** Run: `pnpm -F @hrobot/tenant-runtime test scoring.util` → FAIL (brak modułu).

- [ ] **Step 3: Zaimplementuj `scoring.util.ts`** — pure functions realizujące null-policy (renormalizacja wag; slope null < minValidWindows; retentionSignal rozróżnia null-trend od flat-trend; INWESTOWAC = niski score ∧ slope>minSlope; RYZYKO = wysoki score ∧ slope<0 lub słaby-płaski). Bez zależności zewnętrznych (regresja liniowa własna).

- [ ] **Step 4: Uruchom — PASS.** Run: `pnpm -F @hrobot/tenant-runtime test scoring.util` → PASS.

- [ ] **Step 5: Commit** `feat(strategic-brain): scoring pure functions with deterministic null policy`

---

### Task 3: `scoring-input.ts` — ALLOWLIST + fairness guard (M11)

**Files:**
- Create: `apps/tenant-runtime/src/strategic-brain/scoring-input.ts`
- Test: `apps/tenant-runtime/src/strategic-brain/scoring-input.spec.ts`

- [ ] **Step 1: Failing test** — `buildScoringInput(row)` zwraca WYŁĄCZNIE dozwolone klucze (throughput, cycleMinutes[], slaHits, completedCount, complaintCount, windowSeries, hiredAt, peerGroupKey); test podaje wiersz z dodatkowym `wiek`/`plec`/`homeLat` i **oczekuje wyjątku** „unexpected key entered scorer".

```ts
it('rzuca gdy do inputu wejdzie klucz spoza allowlisty (M11 proxy-guard)', () => {
  expect(() => buildScoringInput({ throughput: 5, wiek: 40 } as any)).toThrow(/unexpected key/i)
})
it('przepuszcza tylko dozwolone metryki operacyjne', () => {
  const input = buildScoringInput({ throughput: 5, completedCount: 5, complaintCount: 1, cycleMinutes: [10], slaHits: 4, peerGroupKey: 'k', hiredAt: new Date() })
  expect(Object.keys(input).sort()).toEqual(['complaintCount','completedCount','cycleMinutes','hiredAt','peerGroupKey','slaHits','throughput'])
})
```

- [ ] **Step 2–4:** Run FAIL → implementuj `ALLOWED_KEYS` set + strict builder → Run PASS.
- [ ] **Step 5: Commit** `feat(strategic-brain): allowlist scoring input with proxy-discrimination guard`

---

### Task 4: `performance-config.service.ts` (B1 nullable upsert, wzór AiConfigService)

**Files:**
- Create: `apps/tenant-runtime/src/strategic-brain/performance-config.service.ts` + `.spec.ts`
- Reference: `apps/tenant-runtime/src/ai-grafik/ai-config.service.ts:106` (upsertConfig P2002-recovery)

- [ ] **Step 1: Failing test** — `getEffectiveConfig(unitId)` zwraca config jednostki lub domyślny (unitId=NULL); `upsertConfig` waliduje Σwag=1.00 (rzuca gdy ≠); nullable-default nie tworzy duplikatu (P2002 → recovery).
- [ ] **Step 2–4:** FAIL → implementuj (naśladuj `AiConfigService.upsertConfig`) → PASS.
- [ ] **Step 5: Commit** `feat(strategic-brain): performance config service with weight-sum validation`

---

### Task 5: `capacity-gap.service.ts` (B5 — reprodukowalne z ShiftDemand−Shift)

**Files:**
- Create: `apps/tenant-runtime/src/strategic-brain/capacity-gap.service.ts` + `.spec.ts`
- Reference: `apps/tenant-runtime/src/grafik/grafik.service.ts:403` (`ShiftDemand.requiredCount`), `:539` (unmet)

- [ ] **Step 1: Failing test** — `capacityGap(lokalizacjaId, weekStart)` = Σ `ShiftDemand.requiredCount` − COUNT przypisanych `Shift` per rola; deterministyczne z DB (mock Prisma). Gap>0 ⇒ luka.
- [ ] **Step 2–4:** FAIL → implementuj query → PASS.
- [ ] **Step 5: Commit** `feat(strategic-brain): reproducible capacity-gap from persisted ShiftDemand minus Shift`

---

### Task 6: `snapshot.service.ts` (B2 cache + upsert + wykluczenia strukturalne M12)

**Files:**
- Create: `apps/tenant-runtime/src/strategic-brain/snapshot.service.ts` + `.spec.ts`

- [ ] **Step 1: Failing test** — `computeSnapshot(employeeId, window)` liczy 4 wymiary z WorkOrder/Complaint (przez buildScoringInput), ustala `isNewHire` z `hiredAt`, `excludedReason` z przecięcia dat `LeaveRequest` (mapa type→kategoria) i onboardingu; upsert po `[employeeId,windowStart,windowEnd]` (idempotencja); zapisuje `algorithmVersion`+`configHash`. Test: ponowne wywołanie nie tworzy 2. wiersza. Test: okno z L4 dostaje `excludedReason='L4'`.
- [ ] **Step 2–4:** FAIL → implementuj → PASS.
- [ ] **Step 5: Commit** `feat(strategic-brain): snapshot cache with structural exclusion derivation`

---

### Task 7: `recommendation.service.ts` (B3 immutable events + retencja + rekrutacja)

**Files:**
- Create: `apps/tenant-runtime/src/strategic-brain/recommendation.service.ts` + `.spec.ts`

- [ ] **Step 1: Failing test** — `currentRecommendation(scope)` = najnowsze zdarzenie per scope (BEZ supersededAt); `emitRecommendation` tworzy NOWY wiersz z `replacesRecommendationId` = poprzedni; **change-detection**: nie emituje gdy verdict+factors bez istotnej zmiany (B4 dedup). Retencja: sygnał per pracownik z zamrożonym `factors`. Rekrutacja: verdict z `capacityGap` + jakość/terminowość.
- [ ] **Step 2–4:** FAIL → implementuj → PASS.
- [ ] **Step 5: Commit** `feat(strategic-brain): immutable-event recommendations with change-detection`

---

### Task 8: `strategic-brain.scheduler.ts` (B4/M14 — @Cron + advisory lock)

**Files:**
- Create: `apps/tenant-runtime/src/strategic-brain/strategic-brain.scheduler.ts` + `.spec.ts`
- Reference: `apps/tenant-runtime/src/outbox/outbox-relay.service.ts:16` (`@Cron`)

- [ ] **Step 1: Failing test** — job przelicza snapshoty→rekomendacje per tenant pod `pg_advisory_xact_lock` (mock: gdy lock zajęty, przebieg się pomija — brak podwójnego liczenia). Idempotentny.
- [ ] **Step 2–4:** FAIL → implementuj (`@Cron`, iteracja tenantów, `SELECT pg_try_advisory_xact_lock(...)`) → PASS.
- [ ] **Step 5: Commit** `feat(strategic-brain): cron scheduler under per-tenant advisory lock`

---

### Task 9: `strategic-brain.controller.ts` + module + RBAC service-scope (M16/M17/M19)

**Files:**
- Create: `apps/tenant-runtime/src/strategic-brain/strategic-brain.controller.ts` + `.spec.ts`, `strategic-brain.module.ts`
- Modify: `apps/tenant-runtime/src/app.module.ts` (import modułu)
- Reference: `employees.controller.ts:32` (`/me` przed `/:id`), `unit-scope.ts:10` (`managedUnitIds`), `audit.service.ts:18`

- [ ] **Step 1: Failing test** — endpointy §6 z §14: `/overview` (HR/ADMIN pełny, MANAGER scoped przez managedUnitIds), `/employee/me` (PRACOWNIK self przez keycloakSub), `/employee/:id` (HR/ADMIN/MANAGER-scoped), `/recruitment`, `POST /recruitment/:id/acknowledge` (audit ids-only — test: payload zawiera tylko id, brak nazwisk/rationale), `GET/PATCH /config`. `/me` zarejestrowane PRZED `/:id`.
- [ ] **Step 2–4:** FAIL → implementuj (RbacGuard `@Roles`, scope w serwisie, audit ids-only ręcznie) → PASS.
- [ ] **Step 5: Commit** `feat(strategic-brain): controller with service-level scope and ids-only audit`

---

### Task 10: `write-boundary.spec.ts` (M13 — twarda granica art. 22)

**Files:**
- Create: `apps/tenant-runtime/src/strategic-brain/write-boundary.spec.ts`

- [ ] **Step 1: Test architektoniczny** — skanuje pliki `strategic-brain/*.ts` i **fail'uje**, jeśli którykolwiek wywołuje write Prisma (`.create/.update/.delete/.upsert`) na modelach `employee`/`shift`/`aiProposal`/`leaveRequest` (dozwolone tylko własne tabele: workOrder[seed], complaint[seed], employeePerformanceSnapshot, recruitmentRecommendation, performanceConfig). Dowodzi, że moduł nigdy nie wykonuje akcji kadrowej.
- [ ] **Step 2: Uruchom — PASS** (kod z Task 2–9 nie narusza granicy).
- [ ] **Step 3: Commit** `test(strategic-brain): architectural write-boundary guard (RODO art.22)`

- [ ] **Step 4: Cała suita jest zielona.** Run: `pnpm -F @hrobot/tenant-runtime test` → PASS. `pnpm -F @hrobot/tenant-runtime build` (tsc) → PASS.

---

## FAZA 2 — Seed syntetyczny

### Task 11: `seed-demo-strategic-brain.sql` (6 profili + 2 lokalizacje + okno L4)

**Files:**
- Create: `scripts/seed-demo-strategic-brain.sql`

- [ ] **Step 1:** Idempotentny SQL (guarded `ON CONFLICT DO NOTHING`, syntetyczne id-prefiksy `wo_/cmp_/sn_`) generujący WorkOrder/Complaint + serię ≥3 snapshotów dla podzbioru istniejących 36 pracowników pokrywającą: gwiazda-stabilna, dobry-spadający(RYZYKO), słaby-rosnący(INWESTOWAC), słaby-płaski, nowy-rosnący(niska confidence), nowy-płaski; ≥1 lokalizacja z luką capacity (WZNOW) + 1 stabilna-powyżej (WSTRZYMAJ); 1 okno `excluded_reason='L4'` u „dobrego". NIE rusza 832 zmian ani kotwic.
- [ ] **Step 2:** Apply lokalnie do żywego tenanta demo (przez istniejącą ścieżkę `demo-up.mjs`/psql) — **lokalnie, nie prod**.
- [ ] **Step 3: Commit** `feat(strategic-brain): synthetic demo seed covering all trajectory paths`

---

## FAZA 3 — web-kit

### Task 12: Proxy route + `lib/strategic-brain.ts` (+vitest)

**Files:**
- Create: `docs/design/web-kit/app/api/strategic-brain/[[...path]]/route.ts` (wzór `api/ai-grafik/[[...path]]`)
- Create: `docs/design/web-kit/lib/strategic-brain.ts` + `test/strategic-brain.test.ts`

- [ ] **Step 1: Failing vitest** dla czystych kalkulatorów formatujących (retentionSignal→label/kolor; slope→strzałka; confidence→„orientacyjne" gdy grupa mała) + `sbFetch`/error-class (wzór `ai-grafik.ts`).
- [ ] **Step 2–4:** FAIL → implementuj proxy + lib → PASS (`pnpm -F web-kit vitest`).
- [ ] **Step 5: Commit** `feat(web-kit): strategic-brain proxy + lib with formatting calculators`

### Task 13: Komponenty + ekran `analiza/`

**Files:**
- Create: `components/strategic-brain/{overview,employee-card,recruitment-panel,rodo-banner}.tsx`, `app/(tenant)/analiza/page.tsx`

- [ ] **Step 1:** server-shell `getSession`+AppShell+RBAC-gate; overview (heatmapa 4 wymiarów + feed rekomendacji z uzasadnieniami); karta pracownika (4 wymiary + sparkline trajektorii + confidence + retentionSignal + breakdown, INWESTOWAC vs RYZYKO wizualnie odróżnione); panel rekrutacji (WZNOW/WSTRZYMAJ/UTRZYMAJ + „Zaakceptuj rekomendację"); stały banner RODO. Semantyka kolorów osobno od akcentu. Enrichment id→nazwisko przez `/api/employees`.
- [ ] **Step 2: tsc + vitest** zielone. Run: `pnpm -F web-kit build` (lub `tsc --noEmit`) → PASS.
- [ ] **Step 3: Commit** `feat(web-kit): strategic dashboard, employee trajectory card, recruitment panel`

---

## FAZA 4 — Live RBAC (weryfikacja na 3 kontach)

### Task 14: Live-verify + dowody

- [ ] **Step 1:** Rebuild backend (docker, w tle ~7min) + restart web-kit; apply seed lokalnie.
- [ ] **Step 2:** Zweryfikuj (get_page_text, bo screenshot bywa wedged):
  - **admin/HR:** pełny overview + panel rekrutacji + config.
  - **manager (Marek):** overview scoped do jednostek (managedUnitIds), brak cudzych.
  - **pracownica.demo (PRACOWNIK):** `/analiza` pokazuje TYLKO własną kartę (`/employee/me`), brak cudzych, banner RODO widoczny.
  - Trajektoria rozróżnia słaby-rosnący (INWESTOWAC) od dobry-spadający (RYZYKO).
  - Feed rekomendacji rekrutacji: ≥1 WZNOW + ≥1 WSTRZYMAJ z uzasadnieniem.
  - Okno L4 nie zaniża trendu „dobrego" pracownika.
  - `acknowledge` loguje decyzję; audit live czysty (ids-only, brak nazwisk).
- [ ] **Step 3:** Zapisz dowody (fragmenty get_page_text) do `docs/demo/`.

---

## Bramki człowieka (§10 — przed nieodwracalnym)
- **Migracja na żywą bazę** = zapytać przed aplikacją; po aplikacji `ALTER TABLE ... OWNER TO hu_<id>` dla nowych tabel/typów.
- **Push (git)** = zostaje LOKALNIE (stała decyzja użytkownika) — nie pushować bez zgody.
- Po fazie 4: `finishing-a-development-branch`.

## Self-review (writing-plans)
- **Pokrycie spec:** §3 model → Task 1; §4 silnik → Task 2–7; §5 scheduler → Task 8; §6 API → Task 9; §7 RODO → Task 3/10 + audit Task 9; §8 UI → Task 12–13; §9 seed → Task 11; §11 kryteria → Task 14; §14 B1–B5/M* → wpięte w Task 1,4,5,6,7,8,9,10. ✔
- **Brak placeholderów:** każdy Task ma pliki, testy z realnym kodem, komendy, oczekiwany wynik. ✔
- **Spójność typów:** `buildScoringInput` (Task 3) używany w `snapshot.service` (Task 6); `factors` Json zamrożony (Task 7) zgodny z modelem (Task 1); `/employee/me` przed `/:id` (Task 9) zgodny z M17. ✔
