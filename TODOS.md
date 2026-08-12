# TODOS

Deferred items surfaced by `/autoplan`. Items here are NOT in the current plan's scope;
they are parked decisions or follow-up work. Merge-blocking fixes live in the plan file's
review report, not here.

## Autoplay "show" + provisioning pipeline (2026-06-01)

- [x] **Autoplay "show" mode** (`apps/web/show.js`, `5c1f4bc`/`4cae992`): one click → hands-free,
      timed walkthrough that drives the REAL APIs (fresh slug → signup → live provisioning awaited
      to DONE → login → team → checklist), with a Pause/Resume/Skip/Restart/Stop + speed control bar.
      Verified in-browser: show runs to the finale with all 5 provisioning steps ✓ and tenant ACTIVE.
- [x] **Provisioning pipeline now completes end-to-end** — fixed 5 stacked bugs that made signup→DONE
      never work on a real run (none caught by 114 unit tests; only running it surfaced them):
      @MessagePattern→@EventPattern; consumer providers→controllers; re-emit next step (incl. →DONE
      so DoneStep flips tenant ACTIVE); emit() wrapped in firstValueFrom; `pnpm prisma`→`node <prisma>`
      (Windows spawn hang); execute-actions-email best-effort (no dev SMTP). Live: 5 jobs reached DONE.
- [x] **SeedStep idempotency / at-least-once claim** (G-1): `ProvisioningService.process()` now
      compare-and-sets a per-step claim (`provisioning_jobs.claimed_at`, new nullable column +
      migration `20260803230000_add_provisioning_claimed_at`) before running any handler, so a
      redelivered RMQ message can never double-process a step. The claim is a LEASE
      (`CLAIM_LEASE_MS` = 5 min > the 120 s migrate timeout), so a consumer that dies mid-step does
      not strand the job; a contended delivery arms `nextAttemptAt` past the lease so RetryRelay
      recovers it, and a successful step clears both claim and arm. Defence in depth on the two
      steps whose *sequential* re-run was destructive: SeedStep only creates "Cała firma" when no
      root unit exists, DoneStep keeps the FIRST `provisionedAt`. Proof tests (fail without the
      fix): concurrent double-delivery executes the step once; a live claim is not re-run; a
      re-seeded tenant gains no second root; provisionedAt is not moved forward.
- [x] **Keycloak temp-password fallback** (G-2): when `execute-actions-email` cannot be delivered
      (no SMTP), KeycloakSetupStep now keeps the temporary admin password as a one-time bootstrap
      secret — AES-256-GCM encrypted at rest with the same service that protects `tenants.db_url`,
      AAD-bound to the tenant id, stored in `tenants.metadata`, never logged and absent from the
      public status route. A GLOBAL_ADMIN retrieves it exactly once via
      `GET /provision/bootstrap-credentials/:tenantId`, which wipes it on read; the credential is
      Keycloak-`temporary`, so first login forces a change. Stored only when that run actually
      created the user (on a 409 retry Keycloak ignores the credential, so persisting it would hand
      out a password that does not work), and wiped as soon as a reset e-mail does go through.

## Consolidation — `main` trunk (2026-06-01)

- [x] **All five feature branches consolidated into `main`** (default branch): two services
      (`apps/control-plane`, `apps/tenant-runtime`) + `apps/web` on the hardened data layer.
      `pnpm build` + 114 unit tests green. PRs #1-#5 closed as superseded (branches kept).
- [x] **Container build fixed for the two-app layout** (`e7bee40`, `37da00e`): per-app
      Dockerfiles (paths/name corrected, `packages/db/prisma` copied before install for the
      `postinstall` db:generate, bcrypt check run from the app dir); compose now has profile-gated
      `control-plane` (:3000) + `tenant-runtime` (:3001). Both images build; tenant-runtime image
      verified booting (health live/ready ok).
- [x] **Boot-blocker fixed (found by booting the image, not by tests):** `@TenantRoute()`
      re-instantiates `TenantContextInterceptor` per host module, but `REDIS_FALLBACK_COUNTER`
      wasn't exported from the `@Global()` `TenantRuntimeModule` → app crashed at startup. Exported
      the token + prom counter. All 42 unit specs mocked the token, so only a real boot caught it.
- [ ] **End-to-end container boot of BOTH services via `docker compose --profile full up`** on a
      fresh stack (control-plane was verified in an earlier session; tenant-runtime verified now via
      `docker run`; the combined compose path + a real signup→DONE through the containers is the
      remaining check). Also: slim the 858MB images (`pnpm deploy --prod` / distroless).

## Foundation Plan 2 — Control Plane (review 2026-05-31)

### Deferred — foundation scope exclusion (premise P5, held by user)
- [ ] **Billing / trial gate.** Self-serve provisioning ships with no paywall, plan
      selection, trial expiry, or metering. Decide self-serve+billing vs sales-gated
      signup before public launch. (Both reviewers flagged.)

### Proposed at final gate (pending user decision — not auto-added)
- [ ] **DR / backup + tested restore** for per-tenant Postgres databases. DB-per-tenant
      makes "restore tenant #347 to 9am yesterday" an N-database problem with no current story.
- [ ] **`DEPROVISION` pipeline step + RODO Art. 17 erasure.** `TenantStatus.DEPROVISIONED`
      is an enum value with no implementing step; there is no tenant-delete path. Required
      for holding employee PII.
- [ ] **Per-tenant migration fan-out orchestrator** (routine-release path): status tracking,
      idempotent resume, parallelism control, mixed-version rollback policy. The provisioning
      `RUN_MIGRATIONS` step covers new-tenant only.

### Premise challenges (held by user at premise gate — carried for the record)
- [ ] Revisit **Keycloak realm-per-tenant → single-realm + Organizations** before ~1k
      tenants (scaling cliff; realm→org migration is brutal once users are live).
- [ ] Revisit **self-hosted Keycloak → managed auth** if ops attention becomes the bottleneck.
- [ ] Decouple the **slug** from subdomain/realm/`iss` and add a rename path (use tenant UUID
      for the realm identifier).

## Foundation Plan 3 — Tenant Runtime (review 2026-05-31)

### Cross-plan blocker — RESOLVED 2026-05-31
- [x] **Keycloak roles never produced.** ~~Plan 2's `keycloak-setup.step.ts` creates realm/client/user
      but no roles, no role assignment, and no `hrobot_roles` protocol mapper → Plan 3's RBAC is
      unsatisfiable end-to-end.~~ Fixed via C4b on PR #2 (`feat/control-plane-api`): the Keycloak step
      now creates one realm role per `@hrobot/shared` `Role`, registers an `oidc-usermodel-realm-role-mapper`
      emitting the top-level multivalued `hrobot_roles` claim, and assigns `ADMIN_KLIENTA` to the initial
      user (7 specs green). Plan 3 RBAC is now satisfiable end-to-end.

### Architecture gate (deferred — ties to held DB-per-tenant premise)
- [ ] **Connection-pool ceiling under DB-per-tenant.** `TenantPrismaManager` caches up to 100
      PrismaClients, each with its own pool (~5-17 conns) × N API pods → can exceed Postgres
      `max_connections`. Set explicit per-tenant `connection_limit`; document the aggregate ceiling;
      front Postgres with PgBouncer at scale. (The related in-flight-eviction correctness bug — LRU/TTL
      `$disconnect` aborting live queries — is FIXED on PR #1 via `withClient()` lease, `63eb310`.)

### Audit model decision
- [ ] Decide audit coverage for **control-plane** mutations (onboarding PATCH writes the
      control-plane DB, not a tenant DB — the tenant-client-only AuditInterceptor can't audit it).

## Developer experience (Plan 2 first-run — surfaced 2026-05-31)

- [ ] **Keycloak dev admin-client automation.** First-run docker-compose boots Keycloak with
      `admin/admin`, but the provisioning `KEYCLOAK_SETUP` step needs a confidential admin client
      (`KEYCLOAK_CLIENT_ID` / `KEYCLOAK_ADMIN_CLIENT_SECRET`) that must currently be created by hand.
      Ship a realm/client import (`--import-realm` or a bootstrap script) so signup → DONE works with
      zero manual Keycloak setup. Until then the pipeline parks before `KEYCLOAK_SETUP`.
- [x] **Production Dockerfile for `apps/api`.** ~~docker-compose provides backing services only.~~ Done on
      PR #2: multi-stage Dockerfile + profile-gated compose `api` service, verified booting end-to-end.
      (Image is ~854MB — slimming via `pnpm deploy --prod` / distroless is a future optimization.)

## Foundation Plan 1 — Monorepo & Data Layer (review 2026-06-01)

### Premise gate — reconsidered + confirmed
- DB-per-tenant + Keycloak realm-per-tenant + app-layer crypto: both reviewers (Claude + Codex),
  with no shared context, independently challenged these as unearned premises. User reconsidered
  shared-schema+RLS at the gate and re-affirmed DB-per-tenant. ADR + rejected-alternatives written
  into the plan file (`docs/superpowers/plans/2026-05-27-foundation-01-monorepo-data-layer.md`).

### Ripple — rebase the stacked PRs onto the hardened data layer (PR #1 @ `63eb310`)
- [ ] **Rebase #2 (control-plane-api), then #3 (tenant-runtime), onto `feat/foundation-data-layer`.**
      The hardening kept data-layer APIs backward-compatible (EncryptionService Buffer ctor,
      TenantPrismaManager `getClient` + `max`/`ttl` aliases all preserved), so consumer code compiles
      unchanged — the rebase only needs conflict resolution in `packages/*`: `env.ts` (URL-scheme
      refinements vs Plan 2's added vars + the in-flight `KEYCLOAK_ADMIN_PASSWORD` rename), the
      `clients.ts`/`index.ts` barrel rename, and `encryption.ts`. After rebase: `pnpm test` both + re-run
      the in-container boot. (Coordinate with the still-uncommitted Keycloak DX work on #2.)

### Forward notes (when employee CRUD lands — later plan)
- [ ] Employee create/update MUST use `@hrobot/db` `encryptEmployeePesel()` (sets the now-required
      `pesel_hash` blind index + AAD-binds the ciphertext); look up via `employeePeselBlindIndex()`.
      Never assign a plaintext `pesel`.
- [ ] Migrate the tenant-runtime request path from `getClient()` to `withClient()` so LRU/TTL eviction
      cannot `$disconnect` a client mid-query.

### Deferred (extends existing items)
- [ ] **audit_log retention / partitioning.** The append-only trigger (now incl. TRUNCATE) blocks
      deletion forever, which collides with RODO retention limits; pair with the DEPROVISION/Art.17
      erasure item and add time-partitioning so old partitions can be detached.
- [ ] **audit_log trigger integration test** against a real Postgres (INSERT ok; UPDATE/DELETE/TRUNCATE
      rejected). Only the SQL ships today; no automated DB-level assertion (unit suite can't cover it).
- [ ] **Two-key split + envelope/KMS.** One `TENANT_DB_ENCRYPTION_KEY` covers both db_url and PESEL.
      The versioned keyring now supports rotation; next step is separate per-purpose keys and
      KMS-backed envelope encryption before holding real PII.

## Resolved 2026-05-31 (post-/autoplan, this session)

- [x] **H1 / M4 / C1–C5 / C4b** — Plan 2 security + correctness fixes committed + pushed to PR #2.
- [x] **C1 migration verified** — `next_attempt_at` migration applies cleanly against a real Postgres 16;
      durable-retry relay no longer relies on in-memory `setTimeout`.
- [x] **P3-1 / P3-4 / P3-5 / P3-7** — Plan 3 fixes (JWT issuer validation, PESEL redaction in audit_log,
      cache TTL 300→30s, `@TenantRoute()`) committed + pushed to PR #3.
- [x] **M7** — signup throttled to 5/min/IP (was the loose global 100/min default). PR #2.
- [x] **DX first-run** — docker-compose stack, `.env.example`, pgcrypto dev-admin seed, quickstart README.
      Verified end-to-end against a throwaway Postgres. PR #2.
- [x] **apps/api containerized** — multi-stage Dockerfile + profile-gated compose `api` service. PR #2.
- [x] **Two latent boot-blockers fixed (found by actually booting the image — all-mocked tests missed both):**
      (a) `amqp-connection-manager` was missing → NestJS RMQ transport threw PackageNotFound and the API
      never started; (b) `bcrypt` was absent from `pnpm.onlyBuiltDependencies` → native addon never built,
      so `node dist/main` would crash on first login. Both fixed + verified (login returns a JWT in-container). PR #2.

## Resolved 2026-06-01 (Plan 1 /autoplan, this session)

- [x] **Plan 1 data-layer hardening** (PR #1, `63eb310`) — /autoplan CEO+Eng+DX, both models. Versioned-keyring
      encryption (rotation) + 12B IV + AAD + `fromHexKey` + typed `DecryptionError`; PESEL blind index
      (`pesel_hash` UNIQUE) + AAD-bound `encryptEmployeePesel`/`decryptEmployeePesel` guard-rail helpers;
      `TenantPrismaManager.withClient()` lease so eviction never drops in-flight queries + `disconnectAll()`;
      `migrateTenant` env allowlist (no more leaking the master key into the per-tenant subprocess);
      `runWithConcurrency` limit<1 guard; `parseEnv` URL-scheme validation; `audit_log` BEFORE TRUNCATE trigger;
      enum-parity guard test; barrel curation; docker port 5433↔.env fix; `postinstall` db:generate.
      **42 unit tests green (was 17).** Stacked PR rebase tracked above.

## Poziom Enterprise dla 3 widoków AI: Grafik Manager, Asystent, Analityk HR (2026-08-10)

Backlog zebrany podczas przygotowań do demo 4Mobility/PARP. **Każda pozycja została zmierzona na żywym
stacku** (`docker compose -p hrobot --profile full`, tenant `hrobot_t_900d948b`), nie wywnioskowana z
lektury kodu — przy każdej podano dowód. Szacunki czasu są SZACUNKAMI, nie pomiarami.

**Sekwencja:** te pozycje świadomie NIE weszły przed demo. Rekomendacja: odbiór na obecnym stanie (jest
sprawny i uczciwie opisany w `docs/demo/2026-08-10-demo-4mobility-parp.md`), a potem `/spec` albo
`/autoplan` na tym backlogu — już z komentarzami odbiorcy zebranymi na żywo.

### Naprawione 2026-08-11

- [x] **`/zamiany` pokazywało surowe identyfikatory zamiast dat i godzin** (`e0ebd707` w kolumnie
      „TWOJA ZMIANA"). Etykiety powstawały w kliencie z `/api/grafik/shifts`, a ta lista jest
      OGRANICZONA — każda zamiana wskazująca zmianę spoza okna spadała do `id.slice(0, 8)`.
      Psuło się raz po jednej, raz po drugiej stronie, więc ekran wyglądał na losowo uszkodzony.
      Fix: `SWAP_INCLUDE` w `shift-swap.service.ts` osadza dane zmiany w wierszu (`list` **oraz**
      `create` i oba `findUniqueOrThrow`, inaczej błąd wracał po każdej mutacji); klient bierze
      etykietę z wiersza, mapa jest tylko fallbackiem, a ostateczny fallback ma prefiks `#`,
      żeby nie udawał daty. 4 testy; zweryfikowane na żywo — 0 gołych identyfikatorów.
      To była pozycja z backlogu przeglądu UX („etykieta budowana z listy, której odbiorca nie widzi"),
      ten sam wzorzec co `PROPOSAL_INCLUDE` w propozycjach AI. **Ten wzorzec został teraz naprawiony
      w trzech miejscach — przy każdym nowym ekranie sprawdzać, czy etykieta jedzie razem z wierszem.**

### Naprawione 2026-08-10 — kontekst, NIE robić ponownie

- [x] **`/moj-tydzien` gubił wszystkie zmiany** (`apps/web/lib/moj-tydzien.ts`): API zwraca `date` jako pełny
      ISO-timestamp, a kod porównywał go z gołym `YYYY-MM-DD`, więc każda zmiana odpadała — dla każdego
      pracownika, w każdym tygodniu. Fix + test regresyjny zweryfikowany negatywnie (cofnięty fix = czerwony test).
- [x] **Eksport ZUS/KEDU „Cała firma" zwracał HTTP 500** (`apps/tenant-runtime/src/dokumenty/dokumenty.service.ts`):
      3 rekordy z placeholderem `DEMO-PLACEHOLDER-UNENCRYPTED-PESEL-*` wywracały cały eksport firmowy.
      Teraz nieczytelny PESEL wyklucza JEDNEGO pracownika (audyt zapisuje `failedEmployeeIds`), a błąd 400
      leci dopiero gdy nieczytelni są wszyscy. 3 testy regresyjne.
- [x] **Przewodnik: 8 z 8 kroków zepsutych** (`apps/web/components/tour/`): dymek renderował się wewnątrz
      `<header>` z `position:sticky; z-10`, co tworzy własny kontekst stakowania — `z-[80]` dymka przegrywało
      ze sticky kolumną grafiku. Fix: `createPortal` do `document.body`. Do tego 2 martwe selektory
      (`[data-tour="dashboard"]` nie istnieje nigdzie w `apps/web`; `/analiza` zamiast `/analityk`) oraz
      zaszyta stała 220 px przy realnej wysokości dymka 268 px. Dołożony test pilnujący zgodności selektorów
      przewodnika z `lib/nav.ts`.
- [x] **Analityk HR pokazywał 9 surowych identyfikatorów zamiast nazwisk** (`apps/web/lib/analityk.ts`,
      funkcja `employeeLabel`). Rozwiązanych 8 z 9; pozostały to `managerUserId` — patrz pozycja otwarta niżej.
- [x] **Duplikaty wniosków urlopowych** (2 wiersze: Adamczyk, Dąbrowski) usunięte z `leave_requests`.
      ⚠️ **Do sprawdzenia:** czy `scripts/seed-demo-m2-modules.sql` odtworzy je przy kolejnym seedzie.
- [x] **Auto-heal stacku**: `restart: unless-stopped` + healthcheck na wszystkich 10 usługach
      (`docker-compose.yml`). Zweryfikowane realnym zabiciem procesu: `RestartCount` 0 → 1, powrót w ~5 s.
      Uwaga metodyczna: `docker kill` NIE testuje auto-healu (Docker traktuje to jako zatrzymanie celowe).

### AI Grafik Manager

- [x] **P1 — Ekran zgody pracownika renderował surowe dane techniczne. NAPRAWIONE 2026-08-10** (`021054b`).
      Pracownik widział `9c90b5b8` zamiast daty/godzin/roli oraz `leave 31964458-…-… approved` zamiast powodu
      po polsku — prosiliśmy człowieka o zgodę, nie mówiąc mu kiedy ani gdzie. Przyczyna NIE była w mapowaniu
      na kliencie: `GET /grafik/shifts` jest scope'owane do WŁASNYCH zmian, a proponowana zmiana z definicji
      należy do kogoś innego, więc kandydat fizycznie nie mógł jej dociągnąć. `PROPOSAL_INCLUDE` niesie teraz
      skrót zmiany (bez PII, przypięte testem odrzucającym `employee`/`pesel`/`homeAddress`), a
      `proposalReasonLabel` tłumaczy token audytowy na polskie zdanie bez ruszania wartości w bazie.
- [ ] **P1 — Propozycje w stanie `ESKALOWANA` to ślepy zaułek.** Kolumna „Decyzja" pokazuje „—" i manager nie
      ma żadnej ścieżki wyjścia; obecnie 4 takie wiersze siedzą w skrzynce decyzyjnej. Potrzebna akcja
      (odrzuć / obsłuż ręcznie w Grafiku / poproś innego kandydata) albo wyprowadzenie ich poza skrzynkę.
- [ ] **P2 — Backend nie rozróżnia trzech przyczyn braku wyceny.** `estimatedCost = null` znaczy jednocześnie
      „brak stawki godzinowej", „kandydat nieosiągalny (brak konta do zapytania o zgodę)" i „brak kandydata".
      2026-08-10 wdrożono wyłącznie OBEJŚCIE tekstowe (`costCellText` → „Brak wyceny — sprawdź kandydata"),
      bo mylący komunikat „brak stawki" wysyłał managera po stawkę, która już istniała. Właściwa naprawa:
      kolumna `escalation_reason` na `ai_proposal`, zapisywana we WSZYSTKICH ścieżkach eskalacji
      (`EMPLOYEE_UNREACHABLE`, `ALL_CANDIDATES_DECLINED`, `CONSENT_TTL_EXPIRED`, `NO_FEASIBLE_CANDIDATE`)
      plus rozróżnienie komunikatów w UI. Szac. 2,5–3,5 h. Kontekst: `ai-proposal.service.ts:150-174`.
- [ ] **P2 — Uzasadnienia kandydatów nie mają jakości produktowej.** Mieszanka polskiego i angielskiego z
      surowymi UUID, np. `1 of 1 slot(s) for role 'KOORDYNATOR' at '14bcfad7-661a-…' uncoverable under H1-H4`
      oraz `H-TRAVEL: szacunkowy dojazd ~287 min przekracza limit 120 min`. To jest NAJMOCNIEJSZY dowód
      wyjaśnialności AI w całym produkcie, a wygląda jak wpis do logu. Do przepisania na PL z nazwami lokalizacji.
- [ ] **P3 — Skrzynka bez filtrowania, sortowania i akcji masowych.** Przy realnym wolumenie (setki propozycji
      miesięcznie) lista bez filtrów po jednostce/statusie/dacie przestaje być użyteczna operacyjnie.

### Asystent (Agent Głosowy)

- [x] **P1 — Wielodniowy zakres dat kolapsował do jednego dnia. NAPRAWIONE 2026-08-10.**
      „od 20 sierpnia do 21 sierpnia" dawało `od 2026-08-20 do 2026-08-20` przy **90% pewności** —
      wyglądało wiarygodnie i było błędne. Przyczyna: `MONTH_RANGE_RE` obsługiwał wyłącznie formę
      z miesiącem RAZ, na końcu („od 1 do 5 sierpnia"), więc naturalniejsza wypowiedź z powtórzonym
      miesiącem spadała do wzorca pojedynczej daty, ten brał tylko pierwszą i ustawiał `dateTo = dateFrom`.
      Dodany `MONTH_FULL_RANGE_RE` (drugi miesiąc opcjonalny, dziedziczy pierwszy). Obsłużone warianty:
      powtórzony miesiąc, miesiąc tylko przy pierwszej dacie, przełom miesiąca i przełom roku
      (ten ostatni wychodzi sam z `monthDate`). 5 testów, zweryfikowane negatywnie; potwierdzone na żywym
      systemie. Ograniczenie zdjęte ze skryptu demo.
- [ ] **P2 — Brak kontekstu rozmowy.** Każde polecenie jest bezstanowe, nie da się doprecyzować poprzedniego
      („a jednak od piątku"), co przy poleceniach głosowych jest naturalnym odruchem użytkownika.
- [ ] **P3 — Wąski zestaw intencji** (wnioski urlopowe + pytania o własny grafik). Rozszerzenie o pytania
      o obsadę jest w KM3 opisane jako zakres przyszły — granicę trzymać świadomie, nie przez zaniedbanie.
- [ ] **P2 — Transkrypcja trwa 7–8 s po rozgrzaniu, 13 s na zimno.** Zmierzone 10.08 realnym nagraniem
      przepuszczonym przez `/voice/transcribe` (faster-whisper `small`, int8, CPU). Model ładuje się
      leniwie przy pierwszym użyciu — stąd różnica. Na demo obchodzimy to rozgrzewką i zagospodarowaniem
      ciszy narracją o lokalnym przetwarzaniu, ale produkcyjnie 8 s na polecenie głosowe to za dużo.
      Kierunki: wstępne ładowanie modelu przy starcie kontenera (kosztem ~490 MB RAM w spoczynku),
      mniejszy model dla krótkich poleceń, albo strumieniowanie zamiast czekania na całe nagranie.
- [x] **Ścieżka głosowa — SILNIK sprawdzony end-to-end (10.08).** Realne nagranie w formacie, który
      wysyła przeglądarka (webm/opus, `MediaRecorder`), przepuszczone przez cały tor: transkrypcja PL
      poprawna dla obu fraz demo (0,87 i 0,79 pewności), parser intencji poprawnie zwraca `URLOP`
      z datą oraz `NIEZNANE` + `fallbackToForm` dla pytania spoza zakresu. WAV i webm dają identyczny
      wynik. Nagranie testowe wygenerowane syntezatorem Windows (głos pl-PL), nie ludzkim głosem.
- [ ] **P3 — Warunki sali nadal niesprawdzone przez człowieka.** Silnik działa, ale nikt nie zweryfikował
      na sprzęcie demo: zgody przeglądarki na mikrofon, wzmocnienia i jakości mikrofonu w akustyce sali,
      ani zachowania modelu przy prawdziwej mowie (akcent, tempo, szum tła) — synteza mowy jest czystsza
      niż człowiek w pomieszczeniu. Wymaga jednego przejazdu na głos przed odbiorcą.

### Analityk HR

- [ ] **P2 — `managerUserId` nierozwiązywalny do nazwiska.** Konto `manager.demo` (`8ce7b92f`) istnieje
      w tabeli `users`, ale **nie ma rekordu w `employees`** — powiązanie ma tylko 2 z 4 użytkowników.
      To luka modelu danych, nie warstwy wyświetlania: `/api/employees` fizycznie nie ma czego zwrócić,
      a projekcja `SAFE_SELECT` nie wystawia `userId`. Wymaga decyzji produktowej: czy konto operacyjne
      ma mieć kartotekę pracownika, czy w tym miejscu pokazywać roli/e-mail zamiast nazwiska.
- [ ] **P2 — Brak drill-downu z sygnału do danych źródłowych.** „Skok absencji +4,1 p.p." nie prowadzi do
      listy wniosków ani osób, które ten skok tworzą — manager musi szukać ręcznie w innym module, co
      niweczy sens sekcji „Na co zwrócić uwagę".
- [ ] **P3 — Zdanie o RODO zmienione 2026-08-10, wymaga akceptacji właściciela produktu.** Było:
      „Identyfikatory zamiast nazwisk — moduł analityczny nie przetwarza danych osobowych" (nieścisłe:
      pseudonimizowany identyfikator to nadal dana osobowa, RODO motyw 26). Jest: „Do wyliczeń i scoringu
      trafiają wyłącznie identyfikatory i liczby — nigdy dane osobowe. Nazwiska podstawiane są dopiero
      w przeglądarce, dla uprawnionej roli." Sam scoring pozostał bez zmian (nadal ids-only) — zmieniono
      wyłącznie warstwę prezentacji i jej opis.

### Przekrojowe — dostępność i UX siatki (znalezione na Grafiku, dotyczą jakości „enterprise")

- [ ] **P1 — Kontrast poniżej WCAG AA.** Etykieta stanowiska pod nazwiskiem: `rgb(138,151,168)` na białym tle
      = **2,97:1** przy wymaganych 4,5:1 (zmierzone przez `getComputedStyle`, nie oszacowane na oko).
      Dotyczy systemowo wszystkich 39 wierszy. Uwaga wdrożeniowa: token koloru jest współdzielony, więc
      zmiana wymaga przejrzenia pozostałych użyć.
- [ ] **P1 — Pół tygodnia ukryte za scrollem bez wskazówki.** Siatka wymaga `scrollWidth 1589 px`
      w kontenerze `clientWidth 905 px` (ekran 1280 px): widać PON–ŚR, a PT/SOB/NDZ wymagają przewinięcia
      w poziomie, przy czym jedynym sygnałem jest cienki natywny scrollbar. Opcje: węższa kolumna dnia,
      widoczny cień/strzałka przy krawędzi, albo przełącznik zakresu („cały tydzień / dziś + 3 dni").
- [ ] **P2 — Brak widocznego focusa klawiaturowego** na komórkach zmian (`outline: none`, `boxShadow: none`)
      przy około 270 klikalnych komórkach w siatce — WCAG 2.4.7.
- [ ] **P3 — Polska fleksja**: karta pracownika pokazuje „1 etatu" zamiast „1 etat".
- [ ] **P1 — `/analiza` to DELIVERABLE KM3, którego NIE MA W NAWIGACJI. NIE USUWAĆ.**
      ⚠️ Wcześniejszy zapis w tym pliku nazywał `/analiza` „martwą trasą do usunięcia" — to był BŁĄD,
      skasowanie jej usunęłoby moduł rozliczany w grancie. Zweryfikowane 2026-08-10 na żywo.

      Istnieją DWA różne ekrany analityczne i tylko jeden jest w menu:
      - `/analityk` — pozycja „Analityk HR" w nawigacji. Operacyjny pulpit KPI: absencje, kolejka
        wniosków, mediana decyzji, proweniencja liczb.
      - `/analiza` — **„Strategiczny mózg kadrowy", czyli moduł opisany w KM3 §3.2 jako „Analityk HR"**
        (backend `strategic-brain`, kryteria AN-1..AN-13, 134 testy). Zawiera to, co raport obiecuje
        odbiorcy: cztery wymiary oceny (Wydajność/Terminowość/Jakość/Rozwój), trajektorię rozwoju,
        sygnały retencji (`UTRZYMAC`/`OBSERWOWAC`/`RYZYKO`/`INWESTOWAC`) i rekomendacje rekrutacji
        per jednostka i lokalizacja (`WZNOW`/`WSTRZYMAJ`/`UTRZYMAJ`), każda z uzasadnieniem i twardą
        granicą art. 22 („Rejestruje decyzję — nie wykonuje działań kadrowych"). Ekran działa w pełni.

      **Ryzyko odbiorowe:** jeśli ktoś z PARP poprosi o pokazanie Analityka HR z trajektorią i
      rekomendacjami, kliknięcie „Analityk HR" w menu pokaże INNY ekran, a rozliczany moduł jest
      osiągalny wyłącznie przez wpisanie adresu. Do decyzji: dodać pozycję w `lib/nav.ts`, scalić oba
      ekrany, albo świadomie zostawić i wpisać adres ręcznie na demo (tak robi obecny skrypt demo).
- [ ] **P3 — Strona AI Grafik Manager nie ma nagłówka `<h1>` dla roli MANAGER.** Tytuł niesie panel
      konfiguracji, a ten renderuje się wyłącznie dla HR/ADMIN_KLIENTA (`canEditConfig`), więc manager
      ogląda moduł bez tytułu w treści — jest tylko w topbarze. Znalezione 2026-08-10 przy pisaniu
      `demo-path.spec.ts`, którego asercja musiała celować w „Koszty grafiku / Propozycje AI".

### Spójność dokumentacji grantowej (KM1–KM3) — decyzje, nie zadania programistyczne

- [ ] **KM2 cytuje liczbę, którą własny audyt zespołu podważył.** Raport podaje, że liczba korekt „spada
      **monotonicznie** z 50 do 0 w 6 rundach", natomiast `data/m2-evidence/known-limitations.md` (03.08,
      czyli PO złożeniu KM2) stwierdza wprost, że tej krzywej NIE należy cytować jako dowodu uczenia się
      preferencji — wzorzec „decyzji managera" był generowany tą samą funkcją, której używa agent, więc
      zbieżność wynikała częściowo z konstrukcji testu. Uczciwy pomiar niezależny: **96 → 0 w 17 rundach,
      niemonotonicznie**, przy idealnie płaskiej próbie kontrolnej bez feedbacku, powtórzone dla 6 różnych
      profili managera. **Decyzja podjęta 2026-08-10: prezentować OBIE liczby i nazwać autokorektę**
      (slajd 9 w `docs/demo/HRobot-demo-4Mobility-PARP-v3.pptx`). Dowody: `agent-service/evidence/ag2_independent_*`,
      `hon2_controls_run.txt`.
- [ ] **KM1 używa sformułowania „uczenie ze wzmocnieniem" (RL), a implementacja RL-em nie jest**
      (`stable_baselines3` ani `torch` nie są importowane przez żaden moduł repozytorium). Ryzyko ograniczone:
      KM1 sam zastrzega, że moduły AI opisuje „wyłącznie jako kontekst architektoniczny i zakres przyszły",
      a KM2 — właściwy raport odbiorczy tego modułu — nigdzie RL nie deklaruje.
      **Zasada na prezentacje i rozmowy z odbiorcą: nie używać słowa „RL"; mówić „agent samouczący się",
      tak jak KM2.**
