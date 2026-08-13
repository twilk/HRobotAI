# Spec: zarządzanie pracownikami + RBAC (konta i profile)

> **Kontekst:** audyt RBAC (2026-07-13) na 3 kontach demo pokazał, że moduł „Pracownicy" jest dziś
> **tylko do odczytu i niezawężony**: `EmployeesController` ma wyłącznie `@Get()` findAll (bez `@Roles`,
> bez scopingu), więc PRACOWNIK widzi wszystkich 36; nie ma trasy profilu (`GET /employees/:id` → 404),
> edycji (`PATCH` → 404) ani dodawania (`POST` → 404; przycisk „Dodaj pracownika" to martwy `<Button>`).
> PESEL jest poprawnie wykluczony z `select` (RODO OK). Ten spec implementuje każde z tych znalezisk.
>
> **Źródła:** `apps/tenant-runtime/src/employees/employees.controller.ts`, model `Employee` w
> `packages/db/prisma/tenant/schema.prisma` (id, user_id, first_name, last_name, **pesel**, **pesel_hash**,
> position, employment_type, hired_at, unit_id, etat, home_*, qualifications, preferred_*),
> `packages/shared` `EncryptionService` (AES-256-GCM, versioned keyring, PESEL blind index),
> wzorzec RBAC z `apps/tenant-runtime/src/grafik/grafik.service.ts` (`isGlobal`, `managedUnitIds`,
> `keycloakSub`-scoping), web-kit `docs/design/web-kit/{app/(tenant)/pracownicy/page.tsx,
> components/employees/employees-screen.tsx}`.

## Model RBAC (decyzja projektowa — DO POTWIERDZENIA przez product)
Role: PRACOWNIK, MANAGER, HR, ADMIN_KLIENTA. `isGlobal` = HR ∨ ADMIN_KLIENTA.

| Akcja | ADMIN/HR (global) | MANAGER | PRACOWNIK |
|---|---|---|---|
| Lista pracowników (scoped) | wszyscy | własne jednostki | własna jednostka (katalog) |
| Podgląd profilu `:id` | każdy | tylko w swojej jednostce | tylko własny |
| Dodanie / edycja / usunięcie | ✅ | ❌ (read-only) | ❌ |

Uzasadnienie: mutacje pracowników to funkcja kadr → gate **HR/ADMIN only** (jak istniejące
`CATALOG_WRITE_ROLES` dla demands/templates). MANAGER i PRACOWNIK czytają w swoim zakresie.
**Otwarte pytania produktowe** (patrz sekcja na końcu): (a) czy PRACOWNIK ma widzieć własną jednostkę
czy tylko siebie; (b) czy MANAGER dostaje ograniczoną edycję (np. `position`, preferencje) dla swojej
jednostki, czy zostaje read-only.

## Zasady nadrzędne (każde zadanie)
- **RODO / PESEL:** pełny PESEL **nigdy** nie wraca z API. Na zapis PESEL jest szyfrowany
  (`EncryptionService`, AES-256-GCM) + wyliczany blind index (`pesel_hash`). Odczyt zwraca **co najwyżej**
  `peselLast4` i **tylko dla HR/ADMIN**. Walidacja PESEL (11 cyfr + suma kontrolna) na wejściu.
- **Audyt:** każda mutacja (create/update/delete) pisze wpis do `audit_log` (append-only) przez istniejący
  `AuditService`/`AuditInterceptor`, z `before`/`after` (bez PESEL w payloadzie).
- **Backend to granica:** RBAC egzekwowany endpointem (`@Roles` + scoping w serwisie), nie w UI.
- **Kotwice demo nietknięte:** konta demo/manager.demo/pracownik.demo, Anna Kowalska (pracownik.demo),
  hero week 13–19 lipca, tydzień 20–26 pusty, wniosek J5 `dccccccc-…`=PENDING_MANAGER. Testy i seedy
  nie modyfikują tych danych.
- **Repo publiczne:** zero sekretów w commitach. TDD (Jest backend / vitest web-kit), commity atomowe.

## Wspólna infrastruktura (prereq dla F1–F4)
`EmployeesController` nie ma dziś ani `@Roles`, ani projekcji aktora, ani scopingu. `managedUnitIds`
i `isGlobal` żyją prywatnie w `GrafikService`. Przed F1–F4:
- **P0:** wynieś scoping jednostek do reużywalnego miejsca (np. `UnitScopeService` w `tenant-runtime`
  lub helper w `@hrobot/shared`) tak, by grafik i employees korzystały z jednej implementacji
  `managedUnitIds(client, userId)` + `isGlobal(roles)` (DRY; dziś zduplikowane). Grafik ma pozostać
  zielony (158 testów) po refaktorze.
- Dodaj do modułu employees `EmployeesService` (dziś logika jest inline w kontrolerze) z projekcją
  aktora z JWT+IP (jak `GrafikController.actor`).

---

## F1 — Zawężenie listy pracowników po roli
**Znalezisko:** `GET /employees` zwraca wszystkich 36 każdej roli (PRACOWNIK widzi cały roster).

**Cel:** lista zawężona: global → wszyscy; MANAGER → własne jednostki; PRACOWNIK → własna jednostka
(lub tylko siebie — patrz decyzja).

**Zakres:**
- `EmployeesService.list(client, actor)` — trzy gałęzie mirrorujące `GrafikService.listShifts`
  (`isGlobal` → all; `managedUnitIds`>0 → `where: { unitId: { in: units } }`; else → własna jednostka
  ustalona z `employee.user.keycloakSub = actor.userId`, lub `where: { user: { keycloakSub } }` dla
  wariantu „tylko siebie").
- `EmployeesController.findAll` dostaje `@Roles(PRACOWNIK, MANAGER, HR, ADMIN_KLIENTA)` + projekcję aktora.
- `select` bez zmian (bez PESEL), + `peselLast4` tylko gdy `isGlobal(actor.roles)`.

**Testy (Jest):** global → brak `where`; MANAGER → `where: { unitId: { in: [...] } }`; PRACOWNIK →
scoped do własnej jednostki/siebie. **Akceptacja:** admin count = 36, manager < 36 (własna jednostka),
pracownik ≤ liczność jego jednostki; wszystkie bez PESEL; `peselLast4` obecny tylko dla HR/ADMIN.

## F2 — Profil pracownika (`GET /employees/:id`) + strona detalu
**Znalezisko:** brak trasy `:id` (404) i brak strony profilu (mimo nazwy gałęzi `feat/web-kit-employee-detail`).

**Cel:** endpoint detalu + ekran profilu, oba scoped tak jak lista.

**Zakres:**
- `EmployeesService.getById(client, actor, id)` — 404 gdy nie istnieje; **403 gdy poza zakresem aktora**
  (MANAGER na cudzą jednostkę, PRACOWNIK na cudzy profil). Zwraca pełny rekord kadrowy **bez PESEL**
  (+ `peselLast4` tylko dla HR/ADMIN). Nie zwraca `home_lat/lng` bez potrzeby (rozważyć).
- `GET /employees/:id` w kontrolerze, `@Roles(...READ_ROLES)`, `ParseUUIDPipe`.
- web-kit: `app/(tenant)/pracownicy/[id]/page.tsx` (server: `getSession` → RBAC nav) + komponent profilu
  (read-only karta: dane kadrowe, jednostka po nazwie z `GET /grafik/units`, umowa, kwalifikacje).
  Wiersz listy klikalny → profil.
- Proxy: catch-all `app/api/employees/[[...path]]/route.ts` (dziś jest tylko `route.ts` na bazowej
  ścieżce — dodać catch-all albo `[id]/route.ts`).

**Testy:** service — global widzi każdy profil; MANAGER 403 na cudzą jednostkę; PRACOWNIK 403 na cudzy,
200 na własny; 404 na nieistniejący. **Akceptacja:** klik w pracownika otwiera profil; nieuprawniony
dostęp → 403 (nie 200, nie ciche 404); brak PESEL w JSON.

## F3 — Edycja pracownika (`PATCH /employees/:id`) + formularz
**Znalezisko:** brak edycji (404).

**Cel:** HR/ADMIN edytują rekord kadrowy; audyt; RODO na PESEL.

**Zakres:**
- `UpdateEmployeeDto` (opcjonalne pola: firstName, lastName, position, employmentType, unitId, etat,
  qualifications, preferences; **pesel** jako write-only, opcjonalny). Walidacja (class-validator).
- `EmployeesService.update(client, actor, id, dto)` — gate **HR/ADMIN** (`ForbiddenException` inaczej);
  jeśli `dto.pesel` → zaszyfruj + przelicz `pesel_hash`; zapisz `updated_at`; `writeAudit` (before/after
  bez PESEL). 404 gdy brak.
- `PATCH /employees/:id`, `@Roles(HR, ADMIN_KLIENTA)`, `ParseUUIDPipe`, `@CurrentUser`+`@Ip`.
- web-kit: formularz edycji na stronie profilu (widoczny tylko dla HR/ADMIN wg `session.roles`);
  jednostka jako select z `GET /grafik/units`; PESEL pole „ustaw nowy" (nigdy nie prefill).

**Testy:** HR update OK + audit; MANAGER/PRACOWNIK → 403; `pesel` w dto → EncryptionService wywołane,
`pesel_hash` ustawiony, PESEL nie w audycie; 404 gdy brak. **Akceptacja:** HR zmienia stanowisko/jednostkę
i widzi to na liście/profilu; nie-HR nie ma przycisku ani nie przejdzie API (403); PESEL nigdy nie wraca.

## F4 — Dodawanie pracownika (`POST /employees`) + podpięcie przycisku
**Znalezisko:** `POST` 404; „Dodaj pracownika" to martwy `<Button>`.

**Cel:** HR/ADMIN tworzą rekord kadrowy; audyt; RODO.

**Zakres:**
- `CreateEmployeeDto` (wymagane: firstName, lastName, position, employmentType, unitId, pesel;
  opcjonalne: etat, qualifications, preferencje). Walidacja PESEL.
- `EmployeesService.create(client, actor, dto)` — gate **HR/ADMIN**; zaszyfruj PESEL + `pesel_hash`;
  utwórz rekord; `writeAudit`. **`user_id` = null** na start — to tworzy PROFIL kadrowy, NIE konto
  logowania (rozróżnienie konto/profil z audytu). Provisioning konta Keycloak dla nowego pracownika =
  osobny, późniejszy przepływ (patrz „Poza zakresem").
- `POST /employees`, `@Roles(HR, ADMIN_KLIENTA)`.
- web-kit: podłącz „Dodaj pracownika" → modal/formularz (widoczny tylko HR/ADMIN); po sukcesie odśwież
  listę. Ukryj przycisk dla MANAGER/PRACOWNIK.

**Testy:** HR create OK (rekord istnieje, PESEL zaszyfrowany, audyt) + MANAGER/PRACOWNIK 403; walidacja
odrzuca zły PESEL (400). **Akceptacja:** HR dodaje pracownika i widzi go na liście; przycisk nieaktywny/
niewidoczny dla nie-HR; POST bez uprawnień → 403; POST ze złym PESEL → 400.

## Kolejność / zależności
```
P0 (wspólna infra: UnitScope + EmployeesService + aktor)  ──►  F1 (scoped list)
                                                            ├─►  F2 (profil :id)
                                                            ├─►  F3 (edycja)  ──► zależy od F2 (strona profilu)
                                                            └─►  F4 (dodanie) ──► niezależne od F2/F3
```
Rekomendacja: P0 → F1 → F2 → (F3 ‖ F4).

## Poza zakresem (świadomie)
- **Personifikacja / „zaloguj jako":** dziś nie istnieje i to **dobrze** (mniejsza powierzchnia ataku) —
  nie implementujemy bez wyraźnej potrzeby.
- **Provisioning konta logowania** przy dodaniu pracownika (Keycloak user + rola realm + link `user_id`):
  osobny przepływ (styl `control-plane/keycloak-setup`), nie ten spec.
- **Twarde usunięcie** pracownika: employee ma FK z `shifts`/`leave_requests`/`shift_swap_requests` →
  zamiast `DELETE` rozważyć dezaktywację (pole `active`) w osobnym zadaniu.

## Otwarte decyzje produktowe (potwierdzić przed implementacją)
1. Widoczność listy dla PRACOWNIKA: własna jednostka (katalog) czy tylko on sam?
2. Czy MANAGER dostaje ograniczoną edycję dla swojej jednostki, czy zostaje read-only (spec zakłada
   read-only + mutacje HR/ADMIN only)?
3. Czy HR/ADMIN widzi `peselLast4` w profilu (spec zakłada tak), czy PESEL jest w 100% write-only?
