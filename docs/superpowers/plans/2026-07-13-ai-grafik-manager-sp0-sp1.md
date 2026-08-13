# AI Grafik Manager — SP0 (fundamenty) + SP1 (zastępstwo przy wypadnięciu) — plan implementacyjny

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use `- [ ]` checkboxes.

**Goal:** Zbudować fundament „AI Grafik Manager" (menu + panel konfiguracji + wspólne encje/stany/audyt + resolver `/me`) oraz pierwszą funkcjonalność: gdy pracownik wypada z grafiku, agent proponuje wykonalne zastępstwo, powiadamia managera i pyta kandydata o zgodę — commit reprzydziału dopiero po zgodzie pracownika **i** akceptacji managera.

**Architecture:** Nowy moduł NestJS `ai-grafik` w `apps/tenant-runtime` reużywa istniejącej maszynerii shift-swap: legalność kandydata przez port `SWAP_FEASIBILITY_VALIDATOR` (kształt „give-away"), commit reprzydziału wzorowany na transakcyjnym `ShiftSwapService.approve()` (reassign `Shift.employeeId` + optimistic-lock `updateMany` → 409 + `AuditLog`). Komunikacja z pracownikiem/managerem = **wewnątrzaplikacyjna skrzynka propozycji z pollingiem** (wzorzec `zamiany`/`swap-workspace.tsx`); brak e-mail/SMS w MVP. Frontend: wyróżniony wpis w `lib/nav.ts`, strona `/ai-grafik-manager` + proxy `/api/ai-grafik/*`.

**Tech Stack:** NestJS, Prisma (tenant schema), class-validator, Jest (backend); Next.js 15, vitest (web-kit). ESM NodeNext (`.js` importy). CI Gate 1 = `eslint src` przed `tsc` (każdy dotknięty plik eslint-clean).

---

## Zablokowane decyzje projektowe (ugruntowane w eksploracji — NIE zmyślać alternatyw)

1. **Kanał = in-app polled inbox.** Propozycja pojawia się w skrzynce managera i (jeśli dotyczy) pracownika, odpytywanej co ~4 s (jak `swap-workspace.tsx`). E-mail/SMS = poza MVP, za portem `NotificationChannel` (fast-follow).
2. **Osiągalność zgody.** Tylko pracownik z powiązanym `User` (login, `Employee.userId != null` → `User.keycloakSub`) może wyrazić zgodę in-app. Pracownik bez konta → propozycja auto-**ESCALATED** (manager przydziela ręcznie), flaga `EMPLOYEE_UNREACHABLE`.
3. **Ranking kandydatów = deterministyczna heurystyka** (tylko feasible; kolejność: najmniej godzin w tygodniu → zgodność `preferredShiftStart`/`preferredDaysOff` → [koszt, gdy SP4]). ML-scorer `agent-service:8010` = fast-follow (wymaga nowego klienta HTTP z tokenem kodującym tenant).
4. **Legalność = reużycie `SWAP_FEASIBILITY_VALIDATOR`** z inputem give-away (`incomingRequesterShiftEmployeeId = kandydat`, `targetShift = null`). Zero zmian w optymalizatorze.
5. **Commit = wzorzec `ShiftSwapService.approve()`**: `$transaction` → ponowna walidacja feasibility → `shift.update({employeeId})` → optimistic-locked `updateMany(where state=PENDING_MANAGER)` (0 wierszy ⇒ 409 `SwapConcurrentModificationError`-odpowiednik) → `AuditLog action:'ai_proposal.approved'`.
6. **Nowa encja `AiProposal`** (NIE nadpisujemy `ShiftSwapRequest` — inny cykl życia: AI-inicjowany, wielu kandydatów, zgoda+akceptacja). Własna, czysta maszyna stanów.
7. **Zgoda złożona w wiersz kandydata** (`AiProposalCandidate.consentState`), nie osobna tabela `ConsentRecord` — 1:1 pytanie na kandydata. (Decyzja do zakwestionowania przez Codex.)
8. **Trigger:** (a) ręczne „znajdź zastępstwo" na zmianie (manager); (b) detektor kolizji: zmiana, której `employee` ma APPROVED `LeaveRequest` obejmujący `shift.date`. Autonomiczne odpalanie detektora bramkowane poziomem autonomii z configu.
9. **Drabina autonomii** (`AiSchedulingConfig.autonomyLevel`): `SUGGEST_ONLY` (tylko pokaż managerowi DRAFT) → `AUTO_NOTIFY` (utwórz propozycję, powiadom managera) → `AUTO_ASK_CONSENT` (dodatkowo zapytaj kandydata) → `AUTO_COMMIT_ON_APPROVAL` (auto-commit, gdy jest zgoda+akceptacja). **Nigdy** brak człowieka w pętli przy commicie w MVP.

## Ograniczenia demo (twarde)
- Dane syntetyczne. Nie ruszać kotwic (36 pracowników, hero week 13–19 lipca, wniosek J5 = PENDING_MANAGER, tygodnie INFEASIBLE). Realne mutacje w testach na żywo zostawiać jako rekomendacje/symulacje.
- Repo publiczne — zero sekretów w commitach.

## Poza zakresem SP0+SP1
- E-mail/SMS realnie wysyłane (tylko port + in-app). Sezonowość (SP3), koszty (SP4 — pole `estimatedCost` w `AiProposal` zostawiamy nullable pod SP4), ad-hoc (SP2). Provisioning kont dla pracowników bez loginu. ML-scorer.

---

## Reużywane API (z eksploracji — wołać dokładnie tak)

| Seam | Sygnatura / kształt |
|---|---|
| Feasibility | port `SWAP_FEASIBILITY_VALIDATOR` (`shift-swap/swap-feasibility-validator.ts`): `validate(input): Promise<{feasible:boolean; reason?:string}>`; input `{client, requesterShift:{id,employeeId}, targetShift:null, incomingRequesterShiftEmployeeId, incomingTargetShiftEmployeeId:null}` |
| Commit-wzorzec | `ShiftSwapService.approve()` (`shift-swap/shift-swap.service.ts:279`) — `$transaction`, optimistic `updateMany`, audit |
| Audit | `AuditService.log({tenantClient, actorUserId, action, entityType, entityId, payload, ipAddress})` (append-only) |
| RBAC scope | `apps/tenant-runtime/src/tenant-runtime/rbac/unit-scope.ts`: `isGlobal(roles)`, `managedUnitIds(client, userId)` |
| Aktor | z JWT: `{ userId: user.sub, roles: user.hrobot_roles ?? [] }`, `@Ip()` dla audytu |
| Leave (trigger) | `LeaveRequest{employeeId,startDate,endDate,status}`, tylko `APPROVED` liczy; `Shift{employeeId, date, start, end, role, lokalizacjaId}` (jednostka przez `Shift.employee.unitId`) |
| Web proxy | `app/api/<prefix>/[[...path]]/route.ts` → `proxyToTenantRuntime(req, joinBackendPath('<prefix>', path??[]), search)` |
| Nav | `lib/nav.ts` `NAV: NavGroup[]`, `NavItem{label,href,icon,tag?,roles?,highlight?}`, filtr `visibleGroups(roles)`; render `components/layout/sidebar-nav.tsx` |
| Consent UI wzorzec | `components/swaps/swap-workspace.tsx` (polling 4 s, `mineActions(state)` → Accept/Odrzuć, inbox managera), klient `lib/swaps.ts` |
| Session/gate | `lib/session.ts` `getSession()`; gate schedulingowy `roles.some(r=>['MANAGER','HR','ADMIN_KLIENTA'].includes(r))` |

---

## File Structure

| Plik | Odpowiedzialność | Task |
|---|---|---|
| `packages/db/prisma/tenant/schema.prisma` | modele `AiSchedulingConfig`, `AiProposal`, `AiProposalCandidate` + enumy | 0.1 |
| `packages/db/prisma/tenant/migrations/<ts>_ai_grafik/…` | migracja | 0.1 |
| `packages/shared/src/ai-grafik.ts` (+ barrel) | enumy `AutonomyLevel`, `AiProposalState`, `ConsentState`, `AiProposalType`, `ProposalAction` + `nextProposalState` (pure) | 0.2 |
| `apps/tenant-runtime/src/ai-grafik/ai-grafik.module.ts` | moduł (importuje ShiftSwapModule dla walidatora, AuditService @Global) | 0.3 |
| `apps/tenant-runtime/src/ai-grafik/ai-config.service.ts` (+spec) | get/upsert `AiSchedulingConfig`, RBAC scope | 0.3 |
| `apps/tenant-runtime/src/ai-grafik/ai-grafik.controller.ts` (+spec) | `GET/PATCH /ai-grafik/config`, `/me`, proposals routes | 0.3,0.5,1.3,1.4 |
| `apps/tenant-runtime/src/ai-grafik/dto/*.dto.ts` | DTO config + akcje propozycji | 0.3,1.4 |
| `apps/tenant-runtime/src/employees/employees.controller.ts` | `GET /employees/me` resolver | 0.5 |
| `apps/tenant-runtime/src/ai-grafik/replacement.service.ts` (+spec) | detekcja wypadnięć + generacja/ranking/vetting kandydatów | 1.1,1.2 |
| `apps/tenant-runtime/src/ai-grafik/ai-proposal.service.ts` (+spec) | tworzenie propozycji, transitions, consent, commit | 1.3,1.4 |
| `docs/design/web-kit/lib/nav.ts` + `components/layout/sidebar-nav.tsx` | wpis „AI Grafik Manager" + styl highlight | 0.4 |
| `docs/design/web-kit/app/(tenant)/ai-grafik-manager/page.tsx` | server shell + gate | 0.4 |
| `docs/design/web-kit/app/api/ai-grafik/[[...path]]/route.ts` | proxy | 0.4 |
| `docs/design/web-kit/components/ai-grafik/*` + `lib/ai-grafik.ts` | panel configu + inbox propozycji (manager+pracownik) | 0.4,1.5 |

---

## SP0 — Fundamenty

### Task 0.1: Modele danych + migracja

**Files:** `packages/db/prisma/tenant/schema.prisma` (+ migracja).

- [ ] **Step 1: Dodaj enumy + modele** (dopasuj typy do realnego schematu — `Shift.id`, `Employee.id`, `Unit.id` to `String`/uuid):

```prisma
enum AutonomyLevel { SUGGEST_ONLY AUTO_NOTIFY AUTO_ASK_CONSENT AUTO_COMMIT_ON_APPROVAL }
enum AiProposalType { REPLACEMENT ADHOC CAPACITY }        // SP1 używa REPLACEMENT
enum AiProposalState { DRAFT PENDING_EMPLOYEE_CONSENT EMPLOYEE_AGREED PENDING_MANAGER APPROVED REJECTED ESCALATED CANCELLED }
enum ConsentState { NOT_ASKED PENDING GRANTED DECLINED EXPIRED }   // [Codex P1] NOT_ASKED = jeszcze nie pytany (sekwencyjnie)

model AiSchedulingConfig {
  id            String        @id @default(uuid())
  unitId        String?                          // null = domyślny config tenanta
  unit          Unit?         @relation(fields: [unitId], references: [id])   // [Codex P1] realna relacja — użyj REALNEJ nazwy modelu jednostki (zweryfikuj schema.prisma ~l.84: Unit vs OrganizationalUnit) + back-relacja
  autonomyLevel AutonomyLevel @default(SUGGEST_ONLY)
  quietHoursStart String?     // "HH:mm" lub null
  quietHoursEnd   String?
  consentTtlHours Int         @default(24)
  budgetWeeklyCap Decimal?    // pod SP4
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt
  @@unique([unitId])          // 1 config na jednostkę (dla non-null); dla NULL patrz partial index niżej
  @@map("ai_scheduling_config")
}
// [Codex P1] W SQL migracji DODAJ ręcznie (Prisma nie generuje partial unique):
//   CREATE UNIQUE INDEX ai_config_single_default ON ai_scheduling_config (unit_id) WHERE unit_id IS NULL;
// bo `@unique`/`@@unique` na nullable kolumnie w Postgresie DOPUSZCZA wiele NULL → inaczej wiele „domyślnych".

model AiProposal {
  id            String          @id @default(uuid())
  type          AiProposalType  @default(REPLACEMENT)
  state         AiProposalState @default(DRAFT)
  shiftId       String
  shift         Shift           @relation(fields: [shiftId], references: [id])   // + back-relacja `aiProposals AiProposal[]` na Shift
  vacatedEmployeeId String
  vacatedEmployee   Employee    @relation("AiProposalVacated", fields: [vacatedEmployeeId], references: [id])  // [Codex P1] realny FK
  activeCandidateId String?                             // [Codex P1] wiersz kandydata AKTUALNIE pytanego (sekwencyjna zgoda)
  reason        String?                                 // "APPROVED_LEAVE" | "MANUAL"
  estimatedCost Decimal?                                // SP4
  decidedByManagerId String?
  expiresAt     DateTime?                               // [Codex P2] TTL zgody = consentRequestedAt + consentTtlHours
  createdAt     DateTime        @default(now())
  updatedAt     DateTime        @updatedAt
  candidates    AiProposalCandidate[]
  @@index([state])
  @@index([shiftId])
  @@map("ai_proposal")
}

model AiProposalCandidate {
  id           String       @id @default(uuid())
  proposalId   String
  proposal     AiProposal   @relation(fields: [proposalId], references: [id], onDelete: Cascade)
  employeeId   String
  employee     Employee     @relation("AiProposalCandidateEmp", fields: [employeeId], references: [id])  // [Codex P1] realny FK
  rank         Int
  feasible     Boolean
  reason       String?
  score        Decimal?
  consentState ConsentState @default(NOT_ASKED)          // [Codex P1] domyślnie NOT_ASKED; tylko aktywny kandydat → PENDING
  consentRequestedAt DateTime?                           // [Codex P2] podstawa TTL
  consentAt    DateTime?
  @@unique([proposalId, employeeId])                     // [Codex P1] jeden wiersz na (propozycja, pracownik)
  @@index([proposalId, rank])
  @@map("ai_proposal_candidate")
}
```
Back-relacje do DODANIA: na `Shift` → `aiProposals AiProposal[]`; na `Employee` → `aiProposalsVacated AiProposal[] @relation("AiProposalVacated")` i `aiProposalCandidacies AiProposalCandidate[] @relation("AiProposalCandidateEmp")`; na modelu jednostki → `aiConfig AiSchedulingConfig[]`. NIE dodawaj PII — trzymamy tylko FK-relacje do `Employee`, nigdy PESEL/adresu.

**[Codex P1] Sekwencyjna zgoda:** propozycja pyta JEDNEGO kandydata naraz — `AiProposal.activeCandidateId` wskazuje aktywnego; tylko jego wiersz ma `consentState=PENDING`, reszta `NOT_ASKED`. Odmowa → serwis ustawia następnego feasible jako aktywnego (`PENDING`) lub `ESCALATED`, gdy nie ma już kandydatów. list-dla-pracownika filtruje: `proposal.activeCandidate.employeeId == me && consentState==PENDING`.

- [ ] **Step 2: Migracja.** `cd packages/db && npx prisma migrate dev --name ai_grafik --schema prisma/tenant/schema.prisma` (lub konwencja repo — sprawdź jak generowano `20260609000000_add_lokalizacje_pojazdy`). Zweryfikuj wygenerowany SQL (tylko CREATE, brak DROP istniejących).
- [ ] **Step 3:** `npx prisma generate` (oba klienty). Potwierdź, że `TenantClient` ma `aiProposal`/`aiSchedulingConfig`/`aiProposalCandidate`.
- [ ] **Step 4: Commit** `feat(db): AI Grafik Manager tenant models (config, proposal, candidate)`.

### Task 0.2: Wspólne enumy + pure maszyna stanów propozycji

**Files:** `packages/shared/src/ai-grafik.ts` (+ barrel export), test.

- [ ] **Step 1: Failing test** `packages/shared/src/ai-grafik.spec.ts` (Jest/vitest — sprawdź runner pakietu shared):
```ts
import { nextProposalState, ProposalAction, AiProposalState } from './ai-grafik.js'
it('DRAFT --ask_consent--> PENDING_EMPLOYEE_CONSENT', () => {
  expect(nextProposalState('DRAFT', 'ask_consent')).toBe('PENDING_EMPLOYEE_CONSENT')
})
it('EMPLOYEE consent granted --> EMPLOYEE_AGREED', () => {
  expect(nextProposalState('PENDING_EMPLOYEE_CONSENT', 'employee_accept')).toBe('EMPLOYEE_AGREED')
})
// [Codex P1] decline ma DWIE osobne akcje (serwis wybiera wg pozostałych kandydatów):
it('employee_decline_next --> stays PENDING_EMPLOYEE_CONSENT (serwis promuje następnego)', () => {
  expect(nextProposalState('PENDING_EMPLOYEE_CONSENT', 'employee_decline_next')).toBe('PENDING_EMPLOYEE_CONSENT')
})
it('employee_decline_last --> ESCALATED (brak kolejnych kandydatów)', () => {
  expect(nextProposalState('PENDING_EMPLOYEE_CONSENT', 'employee_decline_last')).toBe('ESCALATED')
})
// [Codex P1] draft dla managera (SUGGEST_ONLY/AUTO_NOTIFY) MUSI mieć drogę do akceptacji:
it('DRAFT --submit_to_manager--> PENDING_MANAGER', () => {
  expect(nextProposalState('DRAFT', 'submit_to_manager')).toBe('PENDING_MANAGER')
})
it('EMPLOYEE_AGREED --submit_to_manager--> PENDING_MANAGER', () => {
  expect(nextProposalState('EMPLOYEE_AGREED', 'submit_to_manager')).toBe('PENDING_MANAGER')
})
it('PENDING_MANAGER --approve--> APPROVED / --reject--> REJECTED', () => {
  expect(nextProposalState('PENDING_MANAGER', 'manager_approve')).toBe('APPROVED')
  expect(nextProposalState('PENDING_MANAGER', 'manager_reject')).toBe('REJECTED')
})
it('expire from consent --> ESCALATED (lazy TTL)', () => {
  expect(nextProposalState('PENDING_EMPLOYEE_CONSENT', 'expire')).toBe('ESCALATED')
})
it('rejects illegal transition', () => {
  expect(() => nextProposalState('APPROVED', 'manager_approve')).toThrow()
})
```
- [ ] **Step 2: Implement** (pure, wzór `swap-state-machine.ts`): enumy jako const-tuple + `type`, `TRANSITIONS` mapa `{ [from]: { [action]: to } }`, `nextProposalState(from, action)` rzuca na nielegalne. Akcje: `ask_consent`, `submit_to_manager` (z DRAFT i z EMPLOYEE_AGREED), `employee_accept`, `employee_decline_next` (self-loop na PENDING_EMPLOYEE_CONSENT — serwis promuje kolejnego `activeCandidateId`), `employee_decline_last`→ESCALATED, `expire`→ESCALATED, `manager_approve`/`manager_reject`, `direct_escalate` (DRAFT/PENDING_EMPLOYEE_CONSENT→ESCALATED), `cancel` (dowolny pre-terminal→CANCELLED). Terminalne: `{APPROVED, REJECTED, CANCELLED, ESCALATED}`.
- [ ] **Step 3:** run test → PASS; eksport w barrelu `packages/shared/src/index.ts`.
- [ ] **Step 4: [Codex P2] Enum parity** — repo wymusza zgodność enumów Prisma↔TS przez `packages/db/src/enumParity.test.ts` (i AGENTS.md). Dodaj asercje parity dla `AutonomyLevel`, `AiProposalType`, `AiProposalState`, `ConsentState`; uruchom `npx jest enumParity` (lub runner pakietu db) → PASS.
- [ ] **Step 5: Commit** `feat(shared): AI proposal state machine + enums (+ parity)`.

### Task 0.3: AiConfigService + controller (config CRUD, RBAC)

**Files:** `ai-grafik.module.ts`, `ai-config.service.ts`(+spec), `ai-grafik.controller.ts`(+spec), `dto/ai-config.dto.ts`.

- [ ] **Step 1: DTO** `UpdateAiConfigDto`: `autonomyLevel? @IsEnum(AutonomyLevel)`, `unitId? @IsUUID`, `quietHoursStart?/End? @Matches(/^\d{2}:\d{2}$/)`, `consentTtlHours? @IsInt @Min(1) @Max(168)`. (SP4 `budgetWeeklyCap` pomiń teraz.)
- [ ] **Step 2: Failing service tests** (`ai-config.service.spec.ts`, mock `TenantClient.aiSchedulingConfig.{findFirst,findUnique,upsert}` + aktorzy HR/ADMIN/MANAGER/PRACOWNIK):
  - `getConfig(client, actor, unitId?)` → global (HR/ADMIN) czyta dowolny; MANAGER tylko swój (`managedUnitIds`), inaczej `ForbiddenException`; brak wiersza → zwraca domyślny (`SUGGEST_ONLY`).
  - `upsertConfig(client, actor, dto)` → PRACOWNIK `ForbiddenException`; MANAGER tylko swoje jednostki; HR/ADMIN dowolne; audytuje `ai_config.updated`.
- [ ] **Step 3: Implement** `AiConfigService` (reużyj `isGlobal`/`managedUnitIds`; `writeAudit` jak w employees). `getConfig` z fallbackiem na `{autonomyLevel:'SUGGEST_ONLY', consentTtlHours:24}` gdy brak wiersza.
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5: Controller** `@Controller('ai-grafik') @TenantRoute()`; `@Get('config') @Roles(MANAGER,HR,ADMIN_KLIENTA)`; `@Patch('config') @Roles(MANAGER,HR,ADMIN_KLIENTA)` (RBAC per-jednostka egzekwuje serwis). Aktor + `@Ip()`. Metadata test `rolesFor('getConfig'|'updateConfig')`.
- [ ] **Step 6: Module** — `imports:[ShiftSwapModule]` + provide `AiConfigService`; zarejestruj `AiGrafikModule` w `app.module.ts`. **[Codex P1] DI:** `ShiftSwapModule` obecnie eksportuje TYLKO `ShiftSwapService` (`shift-swap.module.ts:22`); `SWAP_FEASIBILITY_VALIDATOR` jest jedynie providerem (`:20`), więc `imports:[ShiftSwapModule]` GO NIE UDOSTĘPNI — DI padnie w SP1. Wybierz jedno: (a) dodaj `SWAP_FEASIBILITY_VALIDATOR` do `exports` w `shift-swap.module.ts`; albo (b) providuj walidator (`OptimizerSwapFeasibilityValidator` + jego optimizer client) bezpośrednio w `AiGrafikModule`. Preferuj (a) — jedno źródło prawdy dla walidatora.
- [ ] **Step 7: Gates** (jest ai-grafik, eslint, tsc) + **Commit** `feat(ai-grafik): tenant config service + RBAC controller`.

### Task 0.5: Resolver `GET /employees/me`

**Files:** `employees.controller.ts`, `employees.service.ts`(+spec).

- [ ] **Step 1: Failing test** — `me(client, actor)` zwraca `toSafeEmployee` własnego rekordu (via `user.keycloakSub`), lub `404` gdy brak `Employee` dla loginu.
- [ ] **Step 2: Implement** `EmployeesService.me(client, actor)` = `findFirst({where:{user:{keycloakSub:actor.userId}}})` → `toSafeEmployee` (bez PESEL/home). Controller `@Get('me') @Roles(...READ_ROLES)` PRZED `@Get(':id')` (kolejność tras — `me` nie może być złapane przez `:id`+ParseUUID). Test kolejności/metadanych.
- [ ] **Step 3: Gates + Commit** `feat(employees): GET /employees/me self-resolver (fills mineRole gap)`.

### Task 0.4: Web-kit — nav + strona + proxy + panel configu

**Files:** `lib/nav.ts`, `components/layout/sidebar-nav.tsx`, `app/(tenant)/ai-grafik-manager/page.tsx`, `app/api/ai-grafik/[[...path]]/route.ts`, `components/ai-grafik/ai-config-panel.tsx`, `lib/ai-grafik.ts`, `middleware.ts`.

- [ ] **Step 1: Nav** — dodaj do grupy „Moduły HR" w `lib/nav.ts`: `{ label:'AI Grafik Manager', href:'/ai-grafik-manager', icon: IconSparkles, tag:'AI', highlight:true, roles:['MANAGER','HR','ADMIN_KLIENTA'] }`. Rozszerz `NavItem` o `highlight?: boolean`; w `sidebar-nav.tsx` dodaj gałąź stylu (np. obwódka/gradient accent) gdy `highlight`. Dodaj `IconSparkles` do `components/icons` (jeśli brak). Dopisz `/ai-grafik-manager/:path*` do matchera w `middleware.ts`.
- [ ] **Step 2: Proxy** — `app/api/ai-grafik/[[...path]]/route.ts` skopiuj z `shift-swap/[[...path]]/route.ts`, prefix `'ai-grafik'`, eksportuj `GET/POST/PATCH`.
- [ ] **Step 3: Strona** — `app/(tenant)/ai-grafik-manager/page.tsx` wzór `grafik/page.tsx`: `getSession()`, `canManage = roles.some(r=>['MANAGER','HR','ADMIN_KLIENTA'].includes(r))`, `<AppShell activeHref="/ai-grafik-manager">{<AiConfigPanel canManage={canManage}/> + (SP1) inbox}</AppShell>`. Gdy `!canManage` → komunikat „brak dostępu" (pracownik trafia tu tylko jeśli damy mu sekcję zgód w SP1 — na razie manager-only).
- [ ] **Step 4: Panel** — `components/ai-grafik/ai-config-panel.tsx` (client): `GET /api/ai-grafik/config` (loading/error/refresh guard jak w `employees-screen.tsx`), formularz: `autonomyLevel` (select), `consentTtlHours` (number), quiet hours (2× time input); zapis `PATCH /api/ai-grafik/config` (błędy przez `mutationErrorMessage`). `lib/ai-grafik.ts` — klient fetch + typy.
- [ ] **Step 5: Testy pure** — logikę mapowania configu (np. label poziomu autonomii, walidacja quiet-hours) wydziel do `lib/ai-grafik.ts` i pokryj vitest (web-kit vitest = node-only, lib-only).
- [ ] **Step 6: Gates** (`npx vitest run`, `npx tsc --noEmit`, `npx next build`) + **Commit** `feat(web-kit): AI Grafik Manager nav + config panel`.

---

## SP1 — Zastępstwo przy wypadnięciu

### Task 1.1: Ranking + vetting kandydatów (reużycie feasibility)

**Files:** `replacement.service.ts`(+spec).

- [ ] **Step 1: Failing tests** (`replacement.service.spec.ts`, mock `TenantClient`, wstrzyknięty mock `SWAP_FEASIBILITY_VALIDATOR`):
  - `rankCandidates(client, shift, poolEmployees)` woła `validator.validate` dla KAŻDEGO kandydata z inputem give-away (`incomingRequesterShiftEmployeeId = kandydat.id`, `targetShift:null`), odrzuca `feasible:false` (zapisuje `reason`), a feasible sortuje heurystyką: rosnąco po godzinach zaplanowanych w tygodniu shiftu, potem zgodność `preferredShiftStart`, potem stabilnie po `id`.
  - kandydat = sam wypadający jest wykluczony; kandydat spoza scope jednostki jest wykluczony (patrz Step 3 — pool już scoped).
  - brak feasible → zwraca pustą listę (sygnał do eskalacji).
- [ ] **Step 2: run → FAIL.**
- [ ] **Step 3: Implement.** Pool = pracownicy w jednostce zmiany (`shift.employee.unitId`) i o wymaganej roli/kwalifikacji (`shift.role ∈ employee.qualifications`), z wyłączeniem wypadającego. Dla każdego: `validator.validate({client, requesterShift:{id:shift.id, employeeId:shift.employeeId}, targetShift:null, incomingRequesterShiftEmployeeId: cand.id, incomingTargetShiftEmployeeId:null})`. Godziny w tygodniu: policz z istniejących `shifts` kandydata w tym samym tygodniu ISO (reużyj helpera tygodnia z grafiku, jeśli jest). Zwróć `Array<{employeeId, feasible, reason?, rank, score}>` (feasible posortowane, rank 1..n).
- [ ] **Step 4: run → PASS.** Commit `feat(ai-grafik): candidate ranking via reused feasibility validator`.

### Task 1.2: Detekcja wypadnięć (kolizja z urlopem) + ręczny trigger

**Files:** `replacement.service.ts`(+spec), controller route.

- [ ] **Step 1: Failing tests** — `findVacatedShifts(client, actor, {from,to})` zwraca zmiany, których `employee` ma APPROVED `LeaveRequest` z `startDate <= shift.date <= endDate`, scoped po roli (global = wszystkie; MANAGER = zarządzane jednostki; PRACOWNIK — poza zakresem/pusty lub `Forbidden`). Zmiana bez kolizji nie jest zwracana.
- [ ] **Step 2: Implement** zapytanie (join/`some` na `employee.leaves` z `status:APPROVED` i zakresem dat obejmującym `date`) + scope przez `managedUnitIds`. Uwaga na strefy/`@db.Date`.
- [ ] **Step 3: Controller** `@Post('replacements/scan') @Roles(MANAGER,HR,ADMIN_KLIENTA)` (ręczny detektor) i `@Post('replacements/for-shift/:shiftId')` (ręczne „znajdź zastępstwo" dla konkretnej zmiany). Metadata testy.
- [ ] **Step 4: Gates + Commit** `feat(ai-grafik): vacated-shift detection (approved-leave collision) + manual trigger`.

### Task 1.3: Tworzenie propozycji + przejścia (bez commitu)

**Files:** `ai-proposal.service.ts`(+spec), controller routes, `dto/proposal-action.dto.ts`.

- [ ] **Step 1: Failing tests** (`ai-proposal.service.spec.ts`):
  - `createReplacement(client, actor, shiftId, reason)` → woła ranking; jeśli 0 feasible → tworzy `AiProposal` w stanie `ESCALATED` (audyt `ai_proposal.escalated`); w przeciwnym razie tworzy `AiProposal` + `AiProposalCandidate[]`. Stan startowy zależny od `AiSchedulingConfig.autonomyLevel`: `SUGGEST_ONLY`→`DRAFT`; `AUTO_NOTIFY`→`DRAFT` (widoczne w inboxie managera); `AUTO_ASK_CONSENT`/`AUTO_COMMIT_ON_APPROVAL`→ jeśli top-kandydat osiągalny (ma `User`) → `PENDING_EMPLOYEE_CONSENT` (+ oznacz top candidate `consentState:PENDING`), inaczej → `ESCALATED` (`EMPLOYEE_UNREACHABLE`).
  - reachability: kandydat osiągalny ⇔ `employee.userId != null`.
  - `list(client, actor, {mine?, state?})` — manager widzi propozycje swoich jednostek (scope), pracownik widzi tylko te, gdzie jest oczekiwanym kandydatem (`candidate.employeeId = me && consentState=PENDING`).
- [ ] **Step 2: Implement** — reużyj `nextProposalState` do wszystkich zmian stanu; osiągalność przez `employee.userId`; audyt każdej zmiany (`ai_proposal.created/escalated`). NIE commituj tu żadnego reassignu.
- [ ] **Step 3: Controller** `@Get('proposals') @Roles(...ANY_ROLE)` (scope w serwisie), `@Get('proposals/:id')`. Metadata + delegacja testy.
- [ ] **Step 4: Gates + Commit** `feat(ai-grafik): replacement proposal creation + autonomy-gated state`.

### Task 1.4: Zgoda pracownika, akceptacja managera, COMMIT reprzydziału

**Files:** `ai-proposal.service.ts`(+spec), controller routes.

- [ ] **Step 1: Failing tests** — najważniejsze bezpieczeństwo:
  - `employeeConsent(client, actor, proposalId, accept)` — tylko oczekiwany kandydat (`candidate.employeeId = me`, `consentState=PENDING`, stan `PENDING_EMPLOYEE_CONSENT`); `accept=true` → candidate `GRANTED`, proposal `EMPLOYEE_AGREED`→(auto) `PENDING_MANAGER`; `accept=false` → candidate `DECLINED`, przejdź do następnego feasible kandydata (`PENDING_EMPLOYEE_CONSENT` na kolejnym) lub `ESCALATED` gdy brak; inny użytkownik → `ForbiddenException`.
  - `managerDecision(client, actor, proposalId, {approve})` — tylko MANAGER (zarządzający jednostką zmiany) / HR / ADMIN; wymaga stanu `PENDING_MANAGER`; `approve=false` → `REJECTED`; `approve=true` → **commit** (patrz Step 2); PRACOWNIK → `Forbidden`.
  - **Commit re-vetting:** przed reassignem PONOWNIE `validator.validate(...)` dla wybranego kandydata; jeśli `feasible:false` → `ConflictException` (grafik się zmienił), bez mutacji.
  - **Optimistic lock:** `updateMany({where:{id, state:'PENDING_MANAGER'}, data:{state:'APPROVED', decidedByManagerId}})`; `count===0` → `ConflictException` (równoległa decyzja), rollback.
  - **RODO/audyt:** payload audytu `ai_proposal.approved` zawiera tylko id (shiftId, proposalId, fromEmployeeId, toEmployeeId) — ZERO PESEL/adresu.
- [ ] **Step 2: Implement commit.** [Codex P1] KOREKTA względem błędnego pierwotnego szkicu: realny `ShiftSwapService.approve()` (`shift-swap.service.ts:298,334`) waliduje feasibility **PRZED** `$transaction` (walidator uruchamia własny solve — nie w transakcji zapisu), a audyt pisze **wprost** `tx.auditLog.create`, NIE przez `AuditService.log` (który wymaga pełnego `TenantClient`, a klient transakcji nim nie jest). Mirror TEGO wzorca:
```ts
// 1) RE-VET poza transakcją (pełny client — walidator NIE przyjmuje klienta tx do własnego solve)
const chosen = topGrantedCandidate(proposal)   // aktywny kandydat z consentState=GRANTED
const feas = await this.feasibility.validate({ client, requesterShift:{id:proposal.shiftId, employeeId:proposal.vacatedEmployeeId}, targetShift:null, incomingRequesterShiftEmployeeId: chosen.employeeId, incomingTargetShiftEmployeeId:null })
if (!feas.feasible) throw new ConflictException(feas.reason ?? 'no longer feasible')
await client.$transaction(async (tx) => {
  // 2) [Codex P1] reassign + GUARD że zmiana WCIĄŻ należy do wypadającego (nie zmieniła się od czasu vetu)
  const reassigned = await tx.shift.updateMany({ where:{ id: proposal.shiftId, employeeId: proposal.vacatedEmployeeId }, data:{ employeeId: chosen.employeeId } })
  if (reassigned.count === 0) throw new ConflictException('shift no longer held by vacated employee (changed concurrently)')
  // 3) optimistic lock na stanie propozycji
  const flipped = await tx.aiProposal.updateMany({ where:{ id: proposal.id, state:'PENDING_MANAGER' }, data:{ state:'APPROVED', decidedByManagerId: actor.userId } })
  if (flipped.count === 0) throw new ConflictException('proposal changed concurrently')
  // 4) audyt WPROST na tx (bez PII) — jak realny approve()
  await tx.auditLog.create({ data:{ actorUserId: actor.userId, action:'ai_proposal.approved', entityType:'AiProposal', entityId: proposal.id, payload:{ shiftId: proposal.shiftId, from: proposal.vacatedEmployeeId, to: chosen.employeeId }, ipAddress: actor.ipAddress } })
})
```
**[Codex P1] Znane ograniczenie TOCTOU:** między re-vetem (poza tx) a reassignem grafik kandydata mógł się zmienić (np. dostał inną zmianę). Guard z kroku 2 chroni tylko *wypadającą* zmianę, nie harmonogram kandydata. To ta sama luka co w istniejącym `approve()`. W teście udokumentuj ją; jako wzmocnienie rozważ `isolationLevel: 'Serializable'` na `$transaction` lub kolumnę-wersję na `Shift` (poza MVP — zapisz jako fast-follow).
- [ ] **Step 3: Controller** `@Post('proposals/:id/consent') @Roles(...ANY_ROLE)` (serwis sprawdza że to oczekiwany kandydat), `@Post('proposals/:id/manager-decision') @Roles(MANAGER,HR,ADMIN_KLIENTA)`. `@Param('id', ParseUUIDPipe)`, `@Body()` dla `{accept}`/`{approve}`. Metadata testy.
- [ ] **Step 4: Gates** (jest ai-grafik + pełny suite; eslint; tsc) + **Commit** `feat(ai-grafik): consent + manager approval + transactional replacement commit`.

### Task 1.5: Web-kit — inbox managera + skrzynka zgód pracownika

**Files:** `lib/ai-grafik.ts`, `components/ai-grafik/proposal-inbox.tsx`, strona AI + (pracownik) sekcja zgód.

- [ ] **Step 1:** `lib/ai-grafik.ts` — klient (`listProposals`, `consent(id,accept)`, `managerDecision(id,approve)`, `scan`, `forShift`) na `/api/ai-grafik/*`; wzbogacenie id→etykiety (nazwisko + „pon 13.07 · 06:00–14:00 · ROLA") wzorem `lib/swaps.ts`. Użyj `GET /api/employees/me` do wyznaczenia „czy jestem oczekiwanym kandydatem" (naprawia lukę `mineRole`).
- [ ] **Step 2:** `components/ai-grafik/proposal-inbox.tsx` — wzór `swap-workspace.tsx`: polling ~4 s, dwie sekcje: „Skrzynka managera — propozycje do zatwierdzenia" (`manager-decision` Approve/Reject; widoczna dla canManage) i „Twoje propozycje zmian — wymagają zgody" (`consent` Akceptuj/Odrzuć; widoczna dla zalogowanego kandydata). `aiProposalActions(state, mineRole)` → zestaw przycisków (wzór `mineActions`). Badge stanu (wzór `swap-badge.tsx`).
- [ ] **Step 3:** Wepnij inbox w `ai-grafik-manager/page.tsx`; pracownik (nie-canManage) widzi TYLKO sekcję zgód (jeśli ma jakąś oczekującą propozycję) — dostosuj gate strony, by pracownik z propozycją miał dostęp do własnej sekcji.
- [ ] **Step 4:** Pure logikę (`aiProposalActions`, mapowanie stanu→etykieta, filtr „moje do zgody") w `lib/ai-grafik.ts` + vitest.
- [ ] **Step 5: Gates** (vitest, tsc, next build) + **Commit** `feat(web-kit): AI proposal inbox (manager approve + employee consent)`.

---

## [Codex P1] Warunek demo zgody (PRZED weryfikacją happy-path)
Kanoniczny seed NIE ustawia `Employee.userId` (`canonicalData.ts:58`, `seed-synthetic.ts:161`) → żaden z 36 pracowników nie ma loginu → nikt nie może wyrazić zgody in-app, a ścieżka zgody w demo jest niewykonalna. Zanim pokażesz happy-path:
- Podlinkuj ≥1 pracownika-kandydata (w NIE-kotwicowej jednostce) do konta Keycloak: utwórz `User{keycloakSub, email}` i ustaw `Employee.userId`, albo reużyj istniejącego `pracownik.demo` (jego `keycloak_sub` jest już zsynchronizowany z wcześniejszej pracy) i upewnij się, że jego `Employee.userId` wskazuje ten `User`.
- Alternatywa (jeśli nie chcemy dotykać seedu): demo pokazuje ścieżkę **ESCALATED** (kandydat bez loginu → manager przydziela ręcznie) jako świadomy, uczciwy scenariusz — ale wtedy „AI pyta pracownika o zgodę" nie jest zaprezentowane. Rekomendacja: podlinkuj jeden login, by pokazać pełną pętlę.

## Weryfikacja końcowa (po SP0+SP1)
- Backend jest zielony (pełny suite, w tym `enumParity`); web-kit vitest zielony; eslint 0; tsc czysty; next build OK.
- **Live RBAC (read-only + 403, bez mutacji kotwic)** na 3 kontach: config widoczny/edytowalny tylko manager/HR/ADMIN (PRACOWNIK 403 na PATCH); `scan` zwraca zmiany kolidujące z urlopem tylko w scope; `proposals` filtrowane per rola; `consent` od nie-kandydata → 403; `manager-decision` od PRACOWNIKa → 403.
- **Ścieżka happy (na danych syntetycznych, poza kotwicami):** utwórz syntetyczny urlop APPROVED nakładający się na syntetyczną zmianę (NIE hero week) → `scan` ją wykrywa → propozycja z feasible kandydatem → zgoda kandydata → akceptacja managera → `Shift.employeeId` zmieniony, `AiProposal=APPROVED`, `audit_log` ma `ai_proposal.approved` bez PII. **Posprzątaj po sobie** (usuń syntetyczny urlop/propozycję, przywróć `employeeId`) — kotwice bez zmian.
- Potwierdź: żaden commit reprzydziału bez pary (zgoda kandydata + akceptacja managera); re-vetting feasibility przy commicie; optimistic-lock 409 przy współbieżności; zero PESEL/adresu w propozycjach i audycie.

## Self-review (autor)
- Pokrycie seeda: funkcjonalność 1 (zastępstwo) — Task 1.1–1.5; fundamenty (menu, panel, config, audyt, resolver) — SP0. Sezonowość/koszty/ad-hoc świadomie poza zakresem (SP2–SP4), z `estimatedCost` nullable zostawionym pod SP4.
- Uczciwie oznaczone niewiadome/decyzje: (a) heurystyka rankingu vs ML-scorer; (b) detekcja „wypadnięcia" tylko przez APPROVED leave (brak workflow nieobecności); (c) czy pracownik ma własny wpis w menu, czy sekcja zgód żyje w `zamiany`.

---

## Codex crosscheck (rekonsyliacja) — 2026-07-13

Codex (adversarial, czytał plan + realny kod HRobot-m2). **8×[P1] + 2×[P2], wszystkie trafne — zaadresowane inline powyżej.** Potwierdził też 3 filary jako poprawne.

| # | Finding | Rozwiązanie w planie |
|---|---|---|
| P1-1 | `AiProposalCandidate` nie modeluje sekwencyjnej zgody (wszyscy PENDING naraz; sprzeczność decline→ESCALATED vs →następny) | `activeCandidateId` na `AiProposal`; `ConsentState.NOT_ASKED`; `@@unique([proposalId,employeeId])`; dwie akcje `employee_decline_next` (self-loop) / `employee_decline_last` (→ESCALATED); filtr list po `activeCandidate` (T0.1, T0.2) |
| P1-2 | Zgoda w demo niewykonalna — seed nie ustawia `Employee.userId` | Nowa sekcja „Warunek demo zgody": podlinkuj ≥1 login (np. `pracownik.demo`) do kandydata w nie-kotwicowej jednostce, lub demo pokazuje ESCALATED |
| P1-3 | `unitId String? @unique` ≠ jeden domyślny (Postgres: wiele NULL); brak FK jednostki | `@@unique([unitId])` + ręczny partial index `WHERE unit_id IS NULL` w SQL; realna relacja `unit` (T0.1) |
| P1-4 | „FK-string" bez FK dla vacated/candidate employee | Nazwane relacje `Employee` + back-relacje (T0.1) |
| P1-5 | Reużycie tx/audytu fałszywe — realny `approve()` waliduje PRZED tx i pisze `tx.auditLog.create` | Re-vet poza `$transaction`; audyt wprost `tx.auditLog.create`, nie `AuditService.log(tx)` (T1.4 skorygowany) |
| P1-6 | `imports:[ShiftSwapModule]` nie udostępni walidatora (nie w `exports`) | Dodaj `SWAP_FEASIBILITY_VALIDATOR` do `exports` (T0.3 Step 6) |
| P1-7 | Commit nie chroni współbieżnych zmian grafiku | `updateMany` shift `where:{id, employeeId:vacated}` guard + optimistic-lock stanu; TOCTOU udokumentowany, serializable/wersja jako fast-follow (T1.4) |
| P1-8 | Propozycje DRAFT martwe dla akceptacji managera | `DRAFT --submit_to_manager--> PENDING_MANAGER` w maszynie + akcja managera na draftcie w inboxie (T0.2, T1.5) |
| P2-9 | TTL nieimplementowalny (brak `consentRequestedAt`/`expiresAt`) | `consentRequestedAt` (kandydat) + `expiresAt` (propozycja); akcja `expire`→ESCALATED; leniwe wygaszanie przy odczycie (T0.1, T0.2) |
| P2-10 | Brak enum parity (repo wymusza `enumParity.test.ts`) | Task 0.2 Step 4: parity dla 4 nowych enumów |

**Potwierdzone jako poprawne (filary architektury):**
- Kształt „give-away" walidatora FAKTYCZNIE weryfikuje przychodzącego zastępcę (`incomingRequesterShiftEmployeeId` sprawdzany, `targetShift:null`) — cały mechanizm vettingu SP1 stoi.
- `Shift` nie ma `unitId` → jednostka przez `Shift.employee.unitId` (plan zakładał to poprawnie).
- Leave overlap jako przedział domknięty zgodny ze schematem.

**Świadomie zaakceptowane ograniczenia (nie bugi):** in-app-only komunikacja (e-mail/SMS = fast-follow za portem); TOCTOU grafiku kandydata przy commicie (jak w istniejącym `approve()`); leniwe TTL (brak crona — Redis bez Bull).

---

## SP0 + SP1 — WYKONANE (2026-07-13)

**SP0** (fundamenty), 9 commitów `0de1058..2015aad` — modele+migracja, wspólne enumy+maszyna stanów+parity, `/employees/me`, `AiConfigService`+kontroler+eksport walidatora, web-kit menu+panel. Backend 232/232, web-kit 117/117.

**SP1** (zastępstwo), 9 commitów `461ffa5..a300c99` — ranking (reużycie feasibility), detekcja wypadnięć (kolizja z APPROVED leave), createReplacement (autonomia→stan), sekwencyjna zgoda, transakcyjny commit (re-vet poza tx, guard `employeeId==vacated`, optimistic-lock stanu, audyt ids-only), web-kit inbox managera + sekcja zgody w `/zamiany` + trigger scan. Backend 306/306, web-kit 132/132.

**Finalny holistyczny review SP1: brak Critical** (zero bypassu RBAC, zero wycieku PII; ścieżka commitu poprawna i lepiej zabezpieczona niż `approve()`). 3 Important (luki kompletności, nie korektność):
- #1 DRAFT bez drogi naprzód (default SUGGEST_ONLY) → **naprawione**: akcja managera `request-consent` (DRAFT→ask_consent, przez zgodę pracownika, nie pomija jej).
- #2 `expiresAt`/`consentTtlHours` tylko zapisywane → **naprawione**: leniwe wygaszanie przy odczycie (list/getById/consent → ESCALATED po TTL).
- #3 `AUTO_ASK_CONSENT` == `AUTO_COMMIT_ON_APPROVAL` (identyczne — oba wymagają kliknięcia managera) → **zaakceptowane/udokumentowane**: zgodne z zablokowaną decyzją „NIGDY commit bez akceptacji managera w MVP". `AUTO_COMMIT_ON_APPROVAL` zarezerwowany na przyszłość (manager pre-autoryzuje) — dziś zachowuje się jak `AUTO_ASK_CONSENT`.

**Bramki człowieka OTWARTE przed demo na żywo:** (2) aplikacja migracji AI-grafik do żywej bazy tenanta demo; (3) podlinkowanie ≥1 pracownika-kandydata do loginu Keycloak (inaczej pełna pętla zgody niewykonalna — tylko ESCALATED). Kod+testy SP0/SP1 zielone na mockowanej Prismie, bez tych kroków.
