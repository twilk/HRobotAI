# Moduły podstawowe: Wnioski · Ustawienia · Dostępy · Użytkownicy — spec + plany implementacyjne

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) lub executing-plans. Kroki w checkboxach.
> **Data:** 2026-07-13 · **Kontekst:** HRobot M2 (4Mobility/PARP), worktree HRobot-m2, branch feat/demo-4mobility.
> **Powiązane:** [[project_m2_grafik_decomposition]]; wzorzec jakości: 2026-07-13-employee-management-rbac.md; tie-in: 2026-07-13-ai-grafik-manager-sp0-sp1.md.

**Goal:** Zamienić 4 ekrany-stuby (Wnioski, Ustawienia, Dostępy, Użytkownicy) w działające moduły — backend NestJS + web-kit — z RBAC, RODO i audytem, reużywając istniejącej maszynerii.

**To są 4 NIEZALEŻNE podsystemy.** Każdy = osobny plan wykonywalny samodzielnie. Kolejność i zależności niżej. Każdy nowy podprojekt: crosscheck Codeksa PRZED egzekucją (ten dokument już go przechodzi).

---

## Reużywane scaffoldingi (z eksploracji — replikować 4×, NIE zmyślać)

| Warstwa | Wzorzec do skopiowania |
|---|---|
| Moduł backend | `apps/tenant-runtime/src/employees/` (module+service+controller+dto) i `ai-grafik/` — rejestracja w `app.module.ts` |
| Kontroler | `@Controller('<x>') @TenantRoute()`; per-route `@Roles(...)` (`Role` z `@hrobot/shared`); `@CurrentTenantClient()`, `@CurrentUser()`, `@Ip()`, `@CurrentTenantId()`, `@Param('id',ParseUUIDPipe)`, `@Body()`, `@Query()`; helper `actor(user,ip)={userId:user.sub,roles:user.hrobot_roles??[],ipAddress:ip}`; ścieżki literalne PRZED `:id` |
| Serwis | `@Injectable`; `AuditService.log({tenantClient,actorUserId,action,entityType,entityId,payload,ipAddress})`; `isGlobal(roles)`/`managedUnitIds(client,userId)` z `tenant-runtime/rbac/unit-scope.ts` (global=HR∨ADMIN_KLIENTA, MANAGER scoped); mapowanie Prisma P2002→409 / P2003→400 (wzór `employees.service.ts`) |
| DTO | class-validator (`@IsUUID @IsString @IsOptional @IsEnum @IsDateString @IsInt @Min @Max @IsNotEmpty`); globalny `ValidationPipe({whitelist:true,transform:true})` (main.ts) |
| Maszyna stanów | pure `nextState(from,action)` — wzór `shift-swap/swap-state-machine.ts` + `@hrobot/shared/ai-grafik.ts`; enum parity w `packages/db/src/enumParity.test.ts` |
| Proxy web-kit | `app/api/<prefix>/[[...path]]/route.ts` (optional catch-all) → `proxyToTenantRuntime(req, joinBackendPath('<prefix>', path??[]), search)`; eksport GET/POST/PATCH(/DELETE) |
| Strona (shell) | `app/(tenant)/<x>/page.tsx`: `getSession()` → `canManage` → `<AppShell activeHref title tenant user roles><XScreen canManage/></AppShell>`; gate „Brak dostępu" jak w `ai-grafik-manager/page.tsx` |
| Ekran klient | `components/<x>/<x>-screen.tsx` `'use client'`: state loading/refreshing/error + `cancelledRef`, `fetch('/api/<x>',{cache:'no-store'})`, early returns (spinner/`role="alert"`/empty/table), re-fetch po mutacji |
| Formularz | inline `<Card>` panel (brak Modal); POST przez proxy; błędy — WŁASNY mapper PL (NIE `mutationErrorMessage` — jego 409 to komunikat o PESEL); loading/`role="alert"` |
| UI | `components/ui/{Card,Button(primary/ghost),Input,Field,Badge,EmptyState,table}`; raw `<select className={employeeSelectClass}>`; ikony `IconRequests/IconKey/IconSettings/IconUser/IconUserPlus/IconLock/...` |
| Gate'y web-kit | BRAK eslinta → `npx tsc --noEmit` + `npx vitest run` (node/lib-only) + `npx next build`. Logikę czystą (DTO buildery, walidatory) w `lib/*.ts` + `lib/*.test.ts` |
| Nav + middleware | `lib/nav.ts` — pozycje JUŻ istnieją z gatingiem; `middleware.ts` matcher JUŻ obejmuje trasy; `lib/session.ts` getSession + inline `canManage` |

## Kolejność rekomendowana (zależności)
1. **Wnioski** — realny workflow + tie-in z AI Grafik (approved leave → wypadnięcie). Najwyższa wartość, samodzielny.
2. **Ustawienia** — units CRUD + company config; zasila reużycie `GET /grafik/units` w web-kit.
3. **Dostępy** — greenfield, samozawierający, prosta logika CRUD.
4. **Użytkownicy** — NAJTRUDNIEJSZY (Keycloak admin + dual-write). Wymaga decyzji człowieka (gdzie żyje KC-admin). Ostatni.

## Zasady przekrojowe (wszystkie 4)
- RBAC dwuwarstwowo: `@Roles` (route) + scoping w serwisie (`isGlobal`/`managedUnitIds`). Autoryzacja PRZED efektem ubocznym.
- RODO: PESEL/adres NIGDY nie wyciekają (allowlist/`toSafeEmployee` przy zwrotach z Employee). Nazwiska w UI z `/api/employees` (SAFE_SELECT). E-mail użytkownika = tożsamość logowania (traktować z rozwagą, ale nie jest to PESEL).
- Audyt: każda mutacja → `AuditService.log` (payload ids-only, bez PII), append-only.
- Dane demo: syntetyczne; nie ruszać kotwic (36 pracowników, hero week 13–19 lipca, wniosek J5, tygodnie INFEASIBLE). Migracje na żywą bazę = Bramka człowieka (dodatkowo: własność tabel → rola `hu_<id>`, patrz nauczka z AUTONOMOUS-HANDOFF).
- Repo publiczne — zero sekretów; nie pushować bez zgody.
- Definicja ukończenia per moduł: backend jest zielony (jest+eslint+tsc) + web-kit (vitest+tsc+next build) + dwustopniowe review domknięte + (opcjonalnie) live RBAC read-only na 3 kontach.

---

# MODUŁ A — WNIOSKI (urlopy z obiegiem akceptacji)

## Stan: `LeaveRequest` istnieje jako STORAGE, brak lifecycle
`LeaveRequest{ id, employeeId→Employee(relacja `leaves`), startDate/endDate @db.Date, status LeaveStatus @default(APPROVED), type String (free-form), createdAt, updatedAt }`; enum `LeaveStatus{PENDING,APPROVED,REJECTED,CANCELLED}`. **Brak** `decidedByUserId/decidedAt/reason`. Zero kontrolera/serwisu — dziś tylko odczyt APPROVED.

## Tie-in (KLUCZOWY): APPROVED wniosek → wypadnięcie w AI Grafik
Trzy konsumenci czytają `status:APPROVED`: solver (H3, `grafik.service.ts:419/498`), walidator swapów (`optimizer-swap-feasibility.validator.ts:140`), **detektor wypadnięć AI Grafik** (`replacement.service.ts:228/251` `findVacatedShifts`). Zatwierdzenie wniosku nakładającego się na przypisaną zmianę = to, co `POST /ai-grafik/replacements/scan` wykrywa jako vacated shift. **Nie trzeba nic zmieniać u konsumentów** — wystarczy, że approve pisze `APPROVED`.

## Zablokowane decyzje (skorygowane po Codeksie)
- Migracja: dodaj `decidedByUserId String?`, `decidedAt DateTime?`, `reason String?` do `LeaveRequest` (+ relacja `decidedBy User? @relation(fields:[decidedByUserId], references:[id])`). **[Codex P1] `decidedByUserId` = `User.id`, NIE JWT `sub`** — JWT `sub`=`User.keycloakSub`, a FK celuje w `User.id` (app-supplied). Serwis MUSI zrezolwować `User.id` po `keycloakSub` przed zapisem (findFirst user where keycloakSub=actor.userId → id).
- **[Codex P2] `LeaveStatus.@default(PENDING)`** (zmień z APPROVED — footgun; seed/import ustawia APPROVED jawnie, i tak już to robi).
- **[Codex P2] Enumy poprawnie:** dodaj **TS `LeaveStatus`** do `@hrobot/shared` + `enumParity` (jak `SwapState`) — dziś istnieje TYLKO w Prisma. `LeaveAction` to enum AKCJI (nie Prisma) → tylko transition-tested (`nextLeaveState`), BEZ parity.
- Lifecycle (pure): `PENDING --approve--> APPROVED`, `PENDING --reject--> REJECTED`, `PENDING --cancel--> CANCELLED` (requester).
- Create ustawia PENDING jawnie.
- RBAC: PRACOWNIK tworzy własny wniosek (`employeeId` = jego Employee via keycloakSub) + `cancel` własny PENDING; MANAGER approve/reject dla pracowników zarządzanych jednostek; HR/ADMIN dowolne. `list` scoped. **[Codex P1] maker-checker: approver.employeeId MUSI ≠ leave.employeeId** (blokada self-approval, też dla HR/ADMIN). **[Codex P1] `getById` stosuje DOKŁADNIE ten sam scope co list** — test: out-of-scope UUID → 403/404 (bezpośredni odczyt UUID to typowy wyciek).
- Audyt `leave.created/approved/rejected/cancelled` (ids-only).

## Plan A (TDD, wzór employees/ai-grafik)
- [ ] **A1 Migracja + enum:** dodaj kolumny do `LeaveRequest`; `LeaveAction` + `nextLeaveState` w `@hrobot/shared` (+ `enumParity`). `prisma migrate --create-only` + `generate` (NIE aplikuj na żywo). Testy `nextLeaveState`.
- [ ] **A2 Serwis `LeaveService`** (`apps/tenant-runtime/src/leave/`): `createRequest(client,actor,dto)` (employeeId z keycloakSub lub podany przez HR; status PENDING; audyt); `list(client,actor,{mine?,state?,unitId?})` scoped; `getById`; `decide(client,actor,id,{approve,reason})` — tylko MANAGER(zarządzana jednostka)/HR/ADMIN; wymaga PENDING; optimistic-lock `updateMany(where:{id,status:'PENDING'})`; ustaw `decidedByUserId`(resolve z keycloakSub)/`decidedAt`/`reason`; audyt. `cancel(client,actor,id)` — tylko requester, PENDING. Testy: create PENDING; approve tylko manager-zarządzana-jednostka (out-of-unit → 403); optimistic 409; cancel tylko własny.
- [ ] **A3 DTO + kontroler** `@Controller('wnioski') @TenantRoute()`: `POST /` `@Roles(...ANY_ROLE)` create; `GET /` `@Roles(...ANY_ROLE)` list (scope w serwisie); `GET /:id`; `POST /:id/decision` `@Roles(MANAGER,HR,ADMIN_KLIENTA)`; `POST /:id/cancel` `@Roles(...ANY_ROLE)`. Metadata testy.
- [ ] **A4 web-kit:** proxy `app/api/wnioski/[[...path]]/route.ts` (prefix `wnioski`); strona `app/(tenant)/wnioski/page.tsx`; `components/wnioski/wnioski-screen.tsx` — sekcja „Moje wnioski" (create + lista + cancel) i (canManage) „Do zatwierdzenia" (approve/reject inbox, wzór `swap-workspace`/`proposal-inbox`); klient `lib/wnioski.ts` + pure buildery + vitest; enrichment nazwisk z `/api/employees`.
- [ ] **A5 (opcjonalny tie-in):** po `approve`, jeśli wniosek nakłada się na przypisane zmiany, pokaż managerowi CTA „Znajdź zastępstwa (AI Grafik)" linkujące do scanu — bez auto-tworzenia propozycji.
- [ ] Gate'y + commit per krok. **Kryteria akceptacji:** approve pisze APPROVED, które `findVacatedShifts` wykrywa; PRACOWNIK nie zatwierdza cudzych; audyt bez PII.

---

# MODUŁ B — USTAWIENIA (firma · jednostki · strefy czasowe)

## Stan: units read-only, brak encji company-config
`OrganizationalUnit{ id, name, parentId(self-tree "UnitTree"), managerUserId→manager, roles, employees, aiConfig }` — bez `type/timezone/region`. `GET /grafik/units`→`{id,name}` istnieje (read). BRAK company-config (nazwa/strefa hardcoded w web-kit). web-kit używa hardcoded `DEMO_UNIT_NAMES`.

## Zablokowane decyzje (skorygowane po Codeksie)
- Nowy model `CompanySettings` (singleton): `id String @id @default(uuid())`, `companyName String`, `timezone String @default("Europe/Warsaw")`, `region String @default("EU-Central")`, `locale String @default("pl-PL")`, timestamps. **[Codex P2] Wymuś singleton ręcznym SQL w migracji** — np. `CREATE UNIQUE INDEX company_settings_singleton ON company_settings ((true));` (albo stałe id) — inaczej nic nie broni wielu wierszy. Serwis: read singleton (fallback-default gdy brak), upsert na tym samym wierszu.
- `OrganizationalUnit.timezone` — MVP: pomiń (tylko firmowa strefa).
- **[Codex P2] Własna projekcja jednostek** — `GET /grafik/units` zwraca TYLKO `{id,name}`, za mało na edytor drzewa. Dodaj w Ustawieniach `GET /ustawienia/units` zwracające `{id,name,parentId,managerUserId,children}`.
- Unit CRUD: `create`(name,parentId), `rename`, `reparent`, `setManager`. RBAC: ADMIN_KLIENTA (write); MANAGER/HR read-only.
- **[Codex P2] Reparent w transakcji z lockiem** (advisory/row lock na poddrzewie) + walidacja cyklu (self-parent, descendant-parent); test także współbieżnych reparentów. Sama walidacja app-level nie wystarcza (dwa równoległe reparenty → cykl).
- web-kit: zastąp hardcoded `DEMO_UNIT_NAMES` fetchem; formularz company-settings + edytor drzewa (przez `GET /ustawienia/units`).

## Plan B (TDD)
- [ ] **B1 Migracja:** `CompanySettings` (+ ewentualny partial-unique dla singletona). `--create-only`+`generate`.
- [ ] **B2 Serwis `SettingsService`**: `getCompany(client,actor)` (fallback-default gdy brak wiersza); `upsertCompany(client,actor,dto)` (ADMIN only; audyt `settings.updated`); `listUnits` (reużyj/przenieś z grafik lub deleguj); `createUnit/renameUnit/reparentUnit/setManager` (ADMIN only; walidacja braku cykli w drzewie; P2003→400 na złym parent/manager). Testy RBAC + cykl-guard.
- [ ] **B3 DTO + kontroler** `@Controller('ustawienia') @TenantRoute()`: `GET/PATCH /company` `@Roles(MANAGER,HR,ADMIN_KLIENTA)` GET / `@Roles(ADMIN_KLIENTA)` PATCH; `GET /units`, `POST /units`, `PATCH /units/:id` `@Roles(ADMIN_KLIENTA)` (GET szerzej). Metadata testy.
- [ ] **B4 web-kit:** proxy `app/api/ustawienia/[[...path]]/route.ts`; strona `ustawienia/page.tsx` (ADMIN gate); `components/ustawienia/settings-screen.tsx` (company form + units tree); klient `lib/ustawienia.ts` + walidatory (timezone IANA, strefa) + vitest. Podmień `DEMO_UNIT_NAMES` na fetch.
- [ ] Gate'y + commit. **Akceptacja:** ADMIN edytuje nazwę/strefę firmy; tworzy/zmienia jednostki bez cykli; nie-ADMIN 403; audyt.

---

# MODUŁ C — DOSTĘPY (karty · klucze · uprawnienia fizyczne) — GREENFIELD

## Stan: całkowicie greenfield (brak modelu/serwisu/proxy)

## Zablokowane decyzje (skorygowane po Codeksie)
- Nowy model `AccessGrant`: `id`, `employeeId→Employee` (FK RESTRICT), `type AccessType {CARD,KEY,PERMISSION}`, `label String`, `identifier String?` (nr karty/klucza), `lokalizacjaId String?→Lokalizacja` (FK SET NULL), `status AccessStatus {ACTIVE,REVOKED,LOST}`, `issuedByUserId String?`, `issuedBy User? @relation(fields:[issuedByUserId],references:[id], onDelete:SetNull)` **[Codex P1 — realny FK, nie gołe id]**, `issuedAt @default(now())`, `revokedAt DateTime?`, `notes String?`, timestamps. Enum `AccessType/AccessStatus` (Prisma) + **TS w `@hrobot/shared` + parity**.
- **[Codex P1] `identifier` to DANE OSOBOWE + security** (nie „wewnętrzne, nie-PII"): nie eksponuj w szerokiej liście bez potrzeby, audyt ids-only (bez identifier w payloadzie), i **partial-unique na aktywnych: `(type, identifier) WHERE status='ACTIVE' AND identifier IS NOT NULL`** (ręczny SQL w migracji) — jedna aktywna karta/klucz nie może być wydana wielu osobom.
- **[Codex P1] `issuedByUserId` = `User.id` zrezolwowany po `keycloakSub`** (jak leave decidedBy).
- CRUD: `issue`, `revoke`(id, reason→notes), `list` scoped (via `employee.unitId`, `managedUnitIds`), `getById`. **[Codex P1] `getById` z tym samym scope co list** (test out-of-scope UUID → 403/404). RBAC: MANAGER(zarządzane)/HR/ADMIN; PRACOWNIK brak (nav już gatuje).
- Audyt `access.issued/revoked` (ids-only, bez identifier).
- RODO: zwroty z Employee przez allowlist (id/imię/nazwisko/jednostka), bez PESEL/adresu; identifier traktowany jak dane wrażliwe.

## Plan C (TDD)
- [ ] **C1 Migracja:** `AccessGrant` + enumy + FK (Employee RESTRICT, Lokalizacja SET NULL). `--create-only`+`generate`; parity.
- [ ] **C2 Serwis `AccessService`**: `issue/revoke/list(scoped)/getById`; scoping po `employee.unitId` (managedUnitIds) jak w replacement/employees; audyt; P2003→400 (zły employee/lokalizacja). Testy RBAC + scoping.
- [ ] **C3 DTO + kontroler** `@Controller('dostepy') @TenantRoute()` `@Roles(MANAGER,HR,ADMIN_KLIENTA)`: `GET /`, `POST /`, `POST /:id/revoke`, `GET /:id`. Metadata testy.
- [ ] **C4 web-kit:** proxy `app/api/dostepy/[[...path]]/route.ts`; strona `dostepy/page.tsx` (canManage=MANAGER/HR/ADMIN, gate „Brak dostępu"); `components/dostepy/dostepy-screen.tsx` (lista scoped + issue/revoke, inline Card form); klient `lib/dostepy.ts` + vitest; enrichment nazwisk/jednostek.
- [ ] Gate'y + commit. **Akceptacja:** manager wydaje/odbiera dostęp tylko w zarządzanych jednostkach; audyt; brak PESEL.

---

# MODUŁ D — UŻYTKOWNICY (zaproszenia + role RBAC) — NAJTRUDNIEJSZY

## Stan + crux: DUAL-WRITE (Keycloak realm roles ↔ UserRole)
- `User{ id(app-supplied), email@unique, keycloakSub@unique, active }`, `UserRole{ role, unitId?, @@unique([userId,role,unitId]) }`. `Role{PRACOWNIK,MANAGER,HR,ADMIN_KLIENTA}`.
- **RbacGuard czyta JWT `hrobot_roles`** (z ról realmu Keycloak, mapowanych 1:1 z `Role`), a **`managedUnitIds` czyta tabelę `UserRole`** (dla `unitId`). Nadanie roli MUSI zapisać OBA: (1) realm-role mapping na userze KC (żeby claim był w tokenie) + (2) wiersz `UserRole` (dla scopingu). Łącznik: `User.keycloakSub` = KC user id (KC ignoruje id z body na POST /users → trzeba odczytać zwrotnie).
- **Brak reużywalnego `KeycloakAdminService`** — kompletna implementacja tylko inline w `apps/control-plane/.../keycloak-setup.step.ts` (getAdminToken przez master realm admin-cli + `KEYCLOAK_ADMIN_CLIENT_SECRET`; POST /users; GET /roles/{name}+POST /users/{id}/role-mappings/realm; PUT /execute-actions-email). tenant-runtime MA te env (`KEYCLOAK_URL`,`KEYCLOAK_ADMIN_CLIENT_SECRET`).

## Zablokowane decyzje (mocno skorygowane po Codeksie — to najbardziej ryzykowny moduł)
- **`KeycloakAdminService`** w tenant-runtime (`tenant-runtime/keycloak/`), wzór admin-token/admin-API z control-plane: `createUser(email)→kcId` (odczytaj id z Location, KC IGNORUJE id z body), `assignRealmRole/removeRealmRole(kcId,role)`, `sendPasswordSetupEmail(kcId)`, `setEnabled(kcId,bool)`. Idempotencja (toleruj 409). (Gdzie żyje KC-admin = Bramka człowieka #1.)
- **[Codex P1] `User.id` jest app-supplied** (nie auto) — invite MUSI wygenerować `id=randomUUID()` i zapisać `keycloakSub=kcId` (odczytany zwrotnie).
- **[Codex P1] `@@unique([userId,role,unitId])` NIE jest idempotentny dla ról globalnych** (Postgres wiele NULL). Dodaj ręczny **partial-unique `(user_id, role) WHERE unit_id IS NULL`** (jak `ai_config_single_default`) — inaczej wielokrotne assign HR/ADMIN duplikują wiersze.
- **[Codex P1] Kolejność dual-write z kompensacją (bo RbacGuard ufa JWT, a scope czyta UserRole):**
  - **GRANT:** najpierw `UserRole` (scope istnieje zanim claim wejdzie), POTEM KC assignRealmRole (claim pojawia się przy następnym tokenie). KC-fail po UserRole → wiszący UserRole bez claimu = brak przywileju (bezpieczne) → reconciliation.
  - **REVOKE:** najpierw KC removeRealmRole (claim znika przy następnym tokenie), POTEM `UserRole`. UserRole-fail po KC → wiszący UserRole bez claimu (bezpieczne).
  - **INVITE:** (1) KC createUser→kcId; (2) `User`(id=uuid,email,keycloakSub=kcId,active); jeśli (2) padnie → skompensuj KC (disable/delete — Bramka #3); (3) GRANT jak wyżej; (4) sendPasswordSetupEmail (best-effort).
- **[Codex P1] JWT jest cache'owany** (token ~3600s) — odebranie roli nie działa natychmiast (utrzymuje się do wygaśnięcia tokenu). Dla tras UPRZYWILEJOWANYCH (zmiana ról, deaktywacja) **dodaj sprawdzanie `User.active` + realnej roli w DB w guardzie/serwisie** — bo dziś `User.active` jest IGNOROWANE przez guardy (RbacGuard patrzy tylko na JWT). Udokumentuj okno niespójności.
- **[Codex P1] Guardy biznesowe:** blokada **self-escalation** (użytkownik nie nadaje sobie wyższej roli) i **last-admin** (nie można odebrać ostatniej roli ADMIN_KLIENTA / zdeaktywować ostatniego admina).
- **Reconciliation:** job/endpoint uzgadniający KC realm-roles ↔ UserRole (wykrywa wiszące wiersze po częściowej awarii). Testy kompensacji KAŻDEGO interleavingu (KC-ok+DB-fail, DB-ok+KC-fail, revoke-KC-fail, deactivate-KC-fail).
- `deactivate`: `User.active=false` + KC `setEnabled(false)`. `list` users+role. RBAC: ADMIN_KLIENTA (czy też HR? — Bramka #2). Audyt `user.invited/role.assigned/role.revoked/user.deactivated` (ids-only).
- web-kit: strona `ustawienia/uzytkownicy` (ADMIN gate); lista+role, „Zaproś użytkownika", zmiana/odbiór roli, deaktywacja. Proxy `/api/uzytkownicy` (optional catch-all).

## Plan D (TDD) — testy mockują KeycloakAdminService + Prisma
- [ ] **D1 `KeycloakAdminService`** + spec (mock fetch): admin-token, createUser (odczyt id z Location + fallback email-lookup), assign/remove realm role (GET role repr + POST/DELETE mapping), execute-actions-email, setEnabled; toleruj 409. Provider w module.
- [ ] **D2 `UsersService`** + spec: `invite` (kolejność + kompensacja przy błędzie DB), `assignRole/revokeRole` (dual-write: KC + UserRole `@@unique`), `list`, `deactivate`. Testy: invite tworzy User(keycloakSub=kcId)+UserRole+woła KC assign; revoke usuwa KC mapping + UserRole; kompensacja gdy DB pada po KC create; RBAC ADMIN-only (403 dla innych PRZED KC).
- [ ] **D3 DTO + kontroler** `@Controller('uzytkownicy') @TenantRoute()` `@Roles(ADMIN_KLIENTA)`: `GET /`, `POST /` (invite), `POST /:userId/roles` (assign), `DELETE /:userId/roles` (revoke), `POST /:userId/deactivate`. Metadata testy.
- [ ] **D4 Moduł** — provide KeycloakAdminService+UsersService+AuditService; rejestracja w app.module. tsc + eslint + jest.
- [ ] **D5 web-kit:** proxy `app/api/uzytkownicy/[[...path]]/route.ts`; strona `ustawienia/uzytkownicy/page.tsx` (ADMIN gate); `components/users/users-screen.tsx` (lista + invite dialog + role edit); klient `lib/uzytkownicy.ts` + vitest.
- [ ] Gate'y + commit. **Akceptacja (wymaga żywego Keycloak — Bramka człowieka):** invite tworzy usera KC + User + UserRole; nowy user po ustawieniu hasła loguje się z właściwym `hrobot_roles`; MANAGER z `unitId` widzi scoped dane; revoke odbiera oba; audyt bez PII.

---

## Otwarte decyzje / Bramki człowieka (rozstrzygnij PRZED egzekucją danego modułu)
1. **[D] Gdzie żyje Keycloak-admin?** (a) `KeycloakAdminService` w tenant-runtime (self-contained, ale daje tenant-runtime moc admina KC); (b) invite w control-plane (kompletny step już tam jest, ale rozdziela UI↔provisioning). Rekomendacja: (a) dla spójności modułu; decyzja bezpieczeństwa należy do człowieka.
2. **[D] Kto może zapraszać?** tylko ADMIN_KLIENTA, czy też HR (dla managerów/pracowników)? Wpływa na `@Roles`.
3. **[D] Kompensacja dual-write:** przy błędzie DB po KC-create — delete usera KC czy `active=false`+retry? (delete = czystsze; disable = bezpieczniejsze audytowo).
4. **[B] Strefa czasowa per-jednostka** (override) w MVP czy tylko firmowa? (rekomendacja: tylko firmowa w MVP).
5. **[wszystkie] Aplikacja migracji na żywą bazę demo** = Bramka człowieka (dodatkowo `ALTER TABLE/TYPE OWNER TO hu_<id>` po ręcznej aplikacji — nauczka z live-verify).
6. **[A] Auto-scan AI Grafik po approve** — automatycznie tworzyć propozycje zastępstw, czy tylko CTA? (rekomendacja: CTA, człowiek w pętli).

## Self-review (autor)
- Pokrycie: 4 moduły, każdy z data-model + backend + frontend + RBAC/RODO/audyt + akceptacją. Reużycia wskazane z realnych plików (LeaveRequest+konsumenci APPROVED, GET /grafik/units, wzorzec KC-admin z control-plane, dual-write UserRole↔realm roles, scaffolding web-kit).
- Uczciwie oznaczone greenfieldy (Dostępy w całości; company-config; leave-lifecycle+kolumny; KeycloakAdminService) i decyzje do zakwestionowania przez Codex: dual-write bez atomowości (kompensacja), gdzie żyje KC-admin, kształt CompanySettings (singleton), model AccessGrant, cykl-guard drzewa jednostek, że create-leave nadpisuje model-default APPROVED na PENDING.
- Kolejność ryzyka: Użytkownicy ostatni (Keycloak). Wnioski pierwszy (wartość + tie-in AI Grafik).
- **[Codex P2] Proxy = OPTIONAL catch-all `[[...path]]`** (jak employees/shift-swap, bo są bare-list routes), NIE required `[...path]` z grafiku.

---

## Codex crosscheck (rekonsyliacja) — 2026-07-13
Codex (adversarial, czytał plan + realny kod). **7×[P1] + 6×[P2], wszystkie trafne — zaadresowane inline powyżej.** Potwierdził 3 filary jako poprawne.

| # | Finding | Rozwiązanie |
|---|---|---|
| P1-1 | `decidedByUserId`/`issuedByUserId` z JWT `sub`(=keycloakSub) łamią FK do `User.id` | Rezolwuj `User.id` po `keycloakSub` przed zapisem (A2, C2) |
| P1-2 | Dual-write niebezpieczny (RbacGuard=JWT, scope=UserRole) | Saga: GRANT=UserRole→KC, REVOKE=KC→UserRole; sprawdzanie `active`/roli w DB dla tras uprzywilejowanych; self/last-admin guard; reconciliation; testy interleavingów (D) |
| P1-3 | `@@unique([userId,role,unitId])` nie idempotentny dla ról globalnych (wiele NULL) | Partial-unique `(user_id,role) WHERE unit_id IS NULL` (D) |
| P1-4 | Self-approval urlopu (manager=pracownik w swojej jednostce) | Maker-checker `approver.employeeId ≠ leave.employeeId`, też HR/ADMIN (A2) |
| P1-5 | `getById` niedospecyfikowany → wyciek przez UUID | `getById` = ten sam scope co list; test out-of-scope→403/404 (A, C) |
| P1-6 | Access `identifier` to PII + brak unikalności | Traktuj jak PII, audyt bez identifier, partial-unique active `(type,identifier)` (C) |
| P1-7 | `issuedByUserId` nie jest FK | Realny FK `User.id` onDelete:SetNull (C) |
| P2-8 | Default `APPROVED` footgun | Default `PENDING`; seed jawnie APPROVED (A) |
| P2-9 | Plan enumów urlopu błędny | TS `LeaveStatus`+parity (jak SwapState); `LeaveAction` tylko transition-tested (A) |
| P2-10 | CompanySettings singleton niedospecyfikowany | Ręczny unique na stałej / fixed id (B) |
| P2-11 | `GET /grafik/units` za słaby na edytor drzewa | Własna projekcja `GET /ustawienia/units` {id,name,parentId,managerUserId,children} (B) |
| P2-12 | Reparent cycle-guard bez transakcji/lockingu | Transakcja+lock+testy self/descendant/concurrent (B) |
| P2-13 | Scaffolding przegeneralizowany (grafik=required path) | Optional `[[...path]]` dla nowych modułów |

**Potwierdzone jako poprawne (filary):** LeaveRequest + konsumenci APPROVED (grafik/swap/replacement) + route scan — tie-in Wniosków→AI Grafik realny; RBAC z `hrobot_roles` + identity-mapping ról + brak reużywalnego KC-admin (trzeba zbudować); web-kit nav/middleware/`mutationErrorMessage`-409-PESEL.
