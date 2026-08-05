# AI Grafik SP4 — Budżetowanie kosztów — plan implementacyjny

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development. Kroki w checkboxach.
> **Data:** 2026-07-13 · **Kontekst:** HRobot M2, branch feat/demo-4mobility. Kontynuacja SP0+SP1 (wykonane).
> **Status:** CODEX-RECONCILED (2026-07-13, 6×P1 + 3×P2 domknięte). Gotowy do egzekucji.

**Goal:** Kalkulacja kosztów grafiku wg standardowego kosztu na stanowisku; dynamiczne przeliczanie; Δkoszt propozycji AI zastępstw; próg budżetu tygodniowego + alerty.

**Placeholdery już istnieją (z SP0):** `AiProposal.estimatedCost Decimal?` (schema.prisma:381) i `AiSchedulingConfig.budgetWeeklyCap Decimal?` (schema.prisma:360). UWAGA (Codex P1-2): kolumna `budgetWeeklyCap` istnieje w Prisma, ale `AiConfigService`/DTO JEJ NIE ZWRACAJĄ — default config zwraca tylko autonomy/TTL/unitId (ai-config.service.ts:38). SP4 musi ją **jawnie dołożyć** do DTO+service, to nie jest darmowe „reuse".

## Zablokowane decyzje (Codex-reconciled)

- **Nowy model `PositionCostRate`:** `id`, `position String`, `employmentType EmploymentType`, `hourlyRate Decimal`, `overtimeMultiplier Decimal @default(1.5)` (przechowywany na przyszłość, NIE liczony w MVP — patrz niżej), `currency String @default("PLN")`, timestamps. `@@unique([position, employmentType])`. Enum `EmploymentType` istnieje i MA parytet TS (enums.ts:34, enumParity.test.ts:40).
- **(Codex P2-1) Poprawne wartości enuma:** `UMOWA_O_PRACE`, `UMOWA_ZLECENIE`, `UMOWA_O_DZIELO`, `B2B` (schema.prisma:20, enums.ts:36). NIGDY literały z tekstu planu — importuj `EmploymentType` z `@hrobot/shared`.
- **(Codex P1-5) `position` to WOLNY TEKST** na `Employee.position` (schema.prisma:157, DTO tylko `@IsString()`). Join `Employee.position === PositionCostRate.position` da CICHE PUDŁA. Wymóg: **normalizacja** (trim + collapse spacji; case-sensitive dopasowanie po znormalizowaniu — bez zgadywania) PRZY zapisie stawki i przy lookupie; brak stawki NIGDY nie znaczy 0 — zwróć `missingRates: [{position, employmentType, employeeIds}]`. (Katalog stanowisk = przyszłość, poza SP4.)
- **(Codex P1-4) BRAK nadgodzin w MVP.** `Shift` ma tylko date/start/end/role/source — żadnej flagi OT ani modelu obecności/attendance (schema.prisma:247; solver jawnie bez historii, grafik.service.ts:394). Koszt zmiany = `hourlyRate(position,employmentType) × godziny(shift.start→end)`. **Bez** mnożnika OT. `overtimeMultiplier` zostaje w modelu jako pole na przyszłość, ale kalkulator go NIE używa i NIE ma testów „OT".
- **(Codex Open-Q overnight) Godziny nocne:** jeśli `end < start` → dodaj 24h (spójne z replacement.service.ts:92). `end === start` → traktuj jako **nieprawidłowe / 0h**, NIE 24h.
- **Koszt grafiku** = suma kosztów zmian per tydzień/jednostka (jednostka via `shift.employee.unitId` — wzorzec potwierdzony: grafik.service.ts:148, unit-scope.ts:5).
- **(Codex Open-Q FTE) Tylko realne godziny zmiany.** Etat (`Employee.etat`) to metadana docelowych godzin tygodniowych (schema.prisma:170), NIE mnożnik stawki.
- **Δkoszt propozycji AI** = koszt(top kandydat) − koszt(wypadający) dla danej zmiany. Zapis do `AiProposal.estimatedCost` przy tworzeniu propozycji.
- **(Codex P1-6) Hook Δkoszt NIE MA dziś danych.** `createReplacement` ładuje tylko `employee.unitId` (ai-proposal.service.ts:99); pula kandydatów selektuje tylko `id, preferredShiftStart` (replacement.service.ts:142). Wymóg: PO wybraniu top feasible kandydata **doczytać** kandydata + wypadającego z `position/employmentType`, potem lookup stawek jednym zapytaniem. Nie udawać, że ranked-candidate niesie dane kosztowe.
- **(Codex Open-Q missing rate) Δkoszt gdy brak stawki:** `estimatedCost = null` (nie 0) + flaga `missingRate`. Konsument (web-kit) renderuje null jako „brak stawki", NIGDY „0 zł". Budżet „OK" NIE może być asertowany gdy jakakolwiek stawka brakuje.
- **(Codex P1-3) Zakres progu budżetu:** config jest **per-jednostka** (jeden wiersz per `unitId`) lub **globalny** gdy `unitId = null` (schema.prisma:348, ai-config.service.ts:53). `GET /koszty/week` WYMAGA `unitId` dla widoku managera; koszt jednostki porównuj do capu JEJ jednostki, z fallbackiem: cap jednostki → w razie braku cap globalny (null-row) → w razie braku „brak capu". NIGDY nie porównuj podsumy jednej jednostki do globalnego capu po cichu. Widok globalny HR: koszt tenant-wide vs config globalny.
- **(Codex P1-1) RBAC — NIE reuse `PATCH /ai-grafik/config`.** `CONFIG_ROLES` tam = `[MANAGER, HR, ADMIN_KLIENTA]` (ai-grafik.controller.ts:18/46) → MANAGER mógłby edytować budżet. SP4 daje **własne** trasy z jawnym `@Roles(Role.HR, Role.ADMIN_KLIENTA)` na zapisach stawek i budżetu. MANAGER: read-only kosztów swoich jednostek. RODO: koszty to nie PII, ale zwroty z Employee przez allowlist.
- **(Codex Open-Q currency) Waluta mieszana:** MVP odrzuca sumowanie różnych walut per tydzień/jednostkę — zwróć `currencyConflict` zamiast sumy PLN+EUR. Jedna waluta/tenant zakładana, ale walidowana.

## Reużywane API (zweryfikowane)
`grafik.service.ts` (listShifts/solveGrafik — źródło zmian; Shift.start/end to realne `HH:mm`, shift.dto.ts:15), `replacement.service`/`ai-proposal.service` (hook Δkoszt — wymaga DOczytania position/employmentType, patrz wyżej), `unit-scope` (managedUnitIds), `AuditService`, wzorzec modułu employees/ai-grafik.
**(Codex P2-3)** `isoWeekRange` jest PRYWATNY w replacement.service.ts:101 — NIE eksportowany. Krok 0 planu: wyekstrahuj helpery tygodnia/daty do lokalnego util (`apps/tenant-runtime/src/ai-grafik/week-range.util.ts` lub `src/common/`) z testami, ZANIM CostService go użyje. `budgetWeeklyCap` NIE jest dziś w AiConfigService — SP4 go dokłada (P1-2).

## Plan (TDD)
- [ ] **0 Ekstrakcja helpera tygodnia:** wyciągnij `isoWeekRange`/date-helpery z `replacement.service.ts` do współdzielonego util + testy jednostkowe (parytet z obecnym zachowaniem). Podmień użycie w replacement.service. Commit.
- [ ] **1 Migracja:** `PositionCostRate` (+ `@@unique[position, employmentType]`). `--create-only`+`generate`. BEZ nowych enumów (EmploymentType istnieje). UWAGA live-apply (jeśli dotyczy demo DB): tabele tworzone przez migrację jako `postgres` → `ALTER TABLE/TYPE ... OWNER TO hu_<id>` (gotcha z SP0). NIE aplikuj na żywo bez bramki człowieka.
- [ ] **2 `budgetWeeklyCap` w configu:** rozszerz `AiConfigDto` + `AiConfigService` (get/patch) o `budgetWeeklyCap` (walidacja Decimal-money, nullable). Testy. Zdefiniuj semantykę braku capu jednostki (fallback do null-row / „brak capu").
- [ ] **3 `CostService`** (+spec, apps/tenant-runtime/src/cost/): `getRates/upsertRate` z jawnym `@Roles(HR, ADMIN)` w kontrolerze (service re-check); pure `shiftCost(rate, shift)` (godziny×stawka, overnight +24h, end===start→0, BEZ OT); `weekCost(client, actor, {weekStart, unitId})` scoped (suma zmian tygodnia + `missingRates[]`); `budgetStatus(client, actor, unitId, weekStart)` → {cost, cap, overBudget, missingRates, currencyConflict}. Testy: godziny/overnight; brak stawki→missingRates (nie 0); scoping; mieszana waluta→conflict.
- [ ] **4 Hook Δkoszt w AI:** w `AiProposalService.createReplacement` PO wyborze top kandydata doczytaj kandydata+wypadającego (position/employmentType), policz `estimatedCost = koszt(kandydat) − koszt(wypadający)` (null gdy brak stawki po którejkolwiek stronie) i zapisz. Testy na mockach: obie stawki są; brak jednej→null; znak Δ (oszczędność vs droższy).
- [ ] **5 DTO + kontroler** `@Controller('koszty') @TenantRoute()`: `GET /rates` (@Roles MANAGER/HR/ADMIN), `PATCH /rates` (@Roles HR/ADMIN); `GET /week?unitId&weekStart` (koszt+budżet+missingRates; wymaga unitId dla managera). Metadata testy. Rejestracja w app.module.
- [ ] **6 web-kit:** proxy `app/api/koszty/[[...path]]`; **(Codex P2-2)** dodaj `estimatedCost: string | number | null` do web-kit `AiProposal` (ai-grafik.ts:173) i renderuj null jako „brak stawki" (NIE „0 zł"); panel kosztów w `ai-grafik-manager` lub `grafik` (koszt tygodnia/jednostki + alert progu + Δkoszt + lista brakujących stawek); klient `lib/koszty.ts` + pure kalkulatory + vitest.
- [ ] Gate'y + commit per krok. **Akceptacja:** koszt tygodnia = suma stawek×realnych godzin; każda propozycja AI pokazuje Δkoszt (lub „brak stawki"); alert przy przekroczeniu `budgetWeeklyCap` we WŁAŚCIWYM zakresie (jednostka vs cap jednostki); brakujące stawki jawnie raportowane; mieszana waluta odrzucona; RBAC zapisu = HR/ADMIN tylko.

## Rozstrzygnięte (były „Otwarte", Codex-reconciled)
- Overnight (`end<start`) → +24h; `end===start` → 0h/nieprawidłowe. ✓
- Brak stawki → `estimatedCost = null` + `missingRate`, blokada asercji budżetu „OK". ✓
- Tylko realne godziny zmiany (etat = metadana, nie mnożnik). ✓
- Mieszana waluta → `currencyConflict`, brak sumowania PLN+EUR w MVP. ✓
