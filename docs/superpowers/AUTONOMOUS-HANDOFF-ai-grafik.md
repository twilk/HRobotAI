# AUTONOMICZNE WYKONANIE — HRobot M2 „AI Grafik Manager" (handoff)

> Samodzielny prompt do wznowienia pracy w świeżej sesji / przez autonomicznego agenta.
> Data: 2026-07-13. Worktree: HRobot-m2, branch feat/demo-4mobility.

## Rola i cel
Jesteś autonomicznym agentem inżynieryjnym kontynuującym budowę „AI Grafik Manager"
(deliverable HRobot M2, Grafik CP-SAT + Agent AI, dla 4Mobility / PARP Poland Prize).
Wykonuj pozostałe podprojekty end-to-end: implementacja + testy + review + zielone gate'y +
commit — SAMODZIELNIE dla pracy kodowej, ZATRZYMUJĄC się wyłącznie na wyliczonych
„Bramkach człowieka". Nie proś o potwierdzenia dla rutynowych kroków; działaj.

## Środowisko
- Worktree: C:/Users/Wilk/Documents/WORKSPACE/HRobot-m2, branch feat/demo-4mobility
  (NIE twórz/zmieniaj brancha; NIE pushuj — patrz Bramki człowieka).
- Monorepo pnpm+turbo: apps/tenant-runtime (NestJS, Jest), apps/control-plane,
  docs/design/web-kit (Next.js 15, vitest node/lib-only, BRAK eslinta), packages/{db,shared,config},
  grafik-optimizer (Python CP-SAT), agent-service (scorer, port 8010, NIE wpięty w tenant-runtime).
- ESM NodeNext (importy z `.js`). CI Gate 1 = `eslint src` PRZED `tsc` (każdy dotknięty
  plik backendu eslint-clean, bez unused).

## Autorytatywne dokumenty (przeczytaj NA POCZĄTKU — one są źródłem prawdy)
- Plan SP0+SP1 (zadania, zablokowane decyzje, tabela reużywanych API, rekonsyliacja Codeksa):
  docs/superpowers/plans/2026-07-13-ai-grafik-manager-sp0-sp1.md
- Spec całej funkcjonalności (4 funkcje + dekompozycja na SP0..SP4):
  docs/superpowers/specs/2026-07-13-ai-grafik-manager.md
- Wzorzec jakości/patternów (ukończony feature):
  docs/superpowers/plans/2026-07-13-employee-management-rbac.md
(Te pliki są gitignorowane — żyją lokalnie w worktree; czytaj je z dysku.)

## Stan (co już ZROBIONE i zielone — nie powtarzaj)
- Employee-management RBAC (P0–F4): scoped roster, profil, edycja, dodawanie; RODO PESEL;
  zmergowane w gałąź (niepushnięte).
- AI Grafik Manager SP0 (fundamenty), 7 commitów 0de1058..2015aad, wszystkie gate'y zielone:
  modele Prisma (AiSchedulingConfig/AiProposal/AiProposalCandidate + enumy; realne FK;
  partial-unique default; @@unique[proposal,employee]); wspólne enumy + pure maszyna stanów
  `nextProposalState` + enum parity; `GET /employees/me`; `AiConfigService` + kontroler RBAC
  + eksport `SWAP_FEASIBILITY_VALIDATOR`; web-kit: wpis w menu + strona + proxy + panel configu.
- Migracja SP0 jest CREATE-ONLY — NIE zaaplikowana na żywej bazie demo (patrz Bramki człowieka).
- Testy zbiorczo: backend 232/232, web-kit 117/117, shared 47/47, enumParity 9/9.

## Metodyka (JAK pracować — sprawdzona w tej sesji)
1. Rozbij podprojekt na małe zadania TDD (test→fail→impl→pass→commit). Jedno spójne
   podsystemowe zadanie = jeden implementer.
2. Na każde zadanie: świeży subagent-implementer z PEŁNYM tekstem zadania + kontekstem
   (nie każ mu czytać planu — podaj treść). Po nim DWUSTOPNIOWE review:
   (a) spec-compliance, potem (b) code-quality — recenzenci WERYFIKUJĄ przez czytanie kodu,
   NIE ufają raportowi implementera. Każdy critical/important MUSISZ domknąć (fix-subagent)
   przed przejściem dalej.
3. Orkiestracja:
   - Zadania stanowe / mutujące wspólne pliki (migracje Prisma, app.module.ts, wspólny schema) —
     WYKONUJ SEKWENCYJNIE, pojedynczym recenzowanym subagentem (unikaj wyścigów na .git/index
     i klientach Prisma).
   - Resztę orkiestruj przez Workflow jako SEKWENCYJNY pipeline; review (read-only) uruchamiaj
     RÓWNOLEGLE (spec ‖ quality). Równoległych implementerów-mutatorów NIE odpalaj bez izolacji.
   - Migracje: `prisma migrate ... --create-only` (lub `migrate diff --script`), `prisma generate`
     (typy — bez bazy). NIE aplikuj na żywą bazę (Bramka człowieka).
4. Plany architektoniczne przepuszczaj przez CROSSCHECK Codeksa (adversarial: `codex exec`
   read-only, każ czytać plan + realny kod, weryfikować reużycia i szukać dziur RODO/RBAC/
   stanów/transakcji). Rekonsyliuj każdy [P1]/[P2] do planu PRZED egzekucją.
5. Po każdym podprojekcie: pełne suite'y zielone + finalny holistyczny review (cross-task:
   spójność RBAC frontend↔backend, RODO end-to-end, zgodność kontraktów DTO).

## Zablokowane decyzje projektowe (z planu — NIE zmyślaj alternatyw)
- Kanał komunikacji = wewnątrzaplikacyjna skrzynka propozycji z pollingiem (wzór `zamiany`/
  `swap-workspace.tsx`); e-mail/SMS = fast-follow za portem NotificationChannel.
- Osiągalność zgody: tylko pracownik z loginem (`Employee.userId != null` → `User.keycloakSub`);
  bez loginu → propozycja auto-ESCALATED (manager przydziela ręcznie), flaga EMPLOYEE_UNREACHABLE.
- Legalność kandydata = reużycie `SWAP_FEASIBILITY_VALIDATOR.validate()` z inputem „give-away"
  (`incomingRequesterShiftEmployeeId=kandydat`, `targetShift:null`). Zero zmian w optymalizatorze.
  (Codex potwierdził: ten kształt FAKTYCZNIE weryfikuje przychodzącego zastępcę wobec H1–H4.)
- Commit reprzydziału = wzór `ShiftSwapService.approve()`: RE-VET feasibility POZA `$transaction`
  (pełny client), potem w tx: `shift.updateMany({where:{id, employeeId:vacated}})` (guard) +
  optimistic-lock stanu propozycji + audyt WPROST `tx.auditLog.create` (NIE `AuditService.log(tx)` —
  wymaga pełnego TenantClient). Znany TOCTOU grafiku kandydata udokumentuj (jak w istniejącym approve).
- Encja `AiProposal` (nie nadpisuj ShiftSwapRequest); sekwencyjna zgoda przez
  `AiProposal.activeCandidateId` + `ConsentState.NOT_ASKED`; jeden kandydat pytany naraz;
  odmowa → następny feasible (`employee_decline_next`) lub ESCALATED (`employee_decline_last`).
- Drabina autonomii (`AiSchedulingConfig.autonomyLevel`): SUGGEST_ONLY → AUTO_NOTIFY →
  AUTO_ASK_CONSENT → AUTO_COMMIT_ON_APPROVAL. NIGDY commit bez pary zgoda-pracownika +
  akceptacja-managera. DRAFT musi mieć drogę do managera (`submit_to_manager`).
- Trigger „wypadnięcia": (a) ręczne „znajdź zastępstwo" (manager) na zmianie; (b) detektor
  kolizji: zmiana, której `employee` ma APPROVED `LeaveRequest` obejmujący `shift.date`
  (przedział domknięty; `Shift.date` to @db.Date; jednostka przez `Shift.employee.unitId` —
  Shift NIE ma unitId).
- Ranking = deterministyczna heurystyka (feasible-only; najmniej godzin w tygodniu →
  zgodność `preferredShiftStart`/`preferredDaysOff` → koszt gdy SP4). ML-scorer = fast-follow.

## Reużywane API (patrz tabela w planie; wołaj DOKŁADNIE tak — najpierw przeczytaj realne pliki)
`SWAP_FEASIBILITY_VALIDATOR` (już eksportowany z ShiftSwapModule); `ShiftSwapService.approve()`;
`AuditService.log({tenantClient,actorUserId,action,entityType,entityId,payload,ipAddress})`
(append-only trigger); `tenant-runtime/rbac/unit-scope.ts` (isGlobal/managedUnitIds);
aktor z JWT `{userId:user.sub, roles:user.hrobot_roles??[]}` + `@Ip()`; `LeaveRequest`(APPROVED)
i `Shift`; proxy web-kit `app/api/<prefix>/[[...path]]/route.ts` → proxyToTenantRuntime/joinBackendPath;
`lib/nav.ts` (NavItem{...,highlight?}, roles); `swap-workspace.tsx`/`lib/swaps.ts` (inbox+Accept/Odrzuć);
`lib/session.ts` getSession + gate `roles.some(r=>['MANAGER','HR','ADMIN_KLIENTA'].includes(r))`;
`toSafeEmployee`/`SAFE_SELECT` (RODO allowlist).

## Twarde ograniczenia (NIENARUSZALNE)
- RODO: PESEL i adres domowy (homeAddress/homeLat/homeLng) NIGDY nie opuszczają API, nie trafiają
  do `audit_log`, ani do komunikatu do pracownika. Zawsze projektuj przez allowlist (`toSafeEmployee`/
  `SAFE_SELECT`), nigdy spread surowego wiersza. peselLast4 tylko HR/ADMIN i tylko na profilu.
- Dane WYŁĄCZNIE syntetyczne. NIE modyfikuj kotwic demo: 36 pracowników, hero week 13–19 lipca,
  wniosek J5 = PENDING_MANAGER, tygodnie INFEASIBLE. Testy na żywo tylko READ-ONLY (+403); realne
  mutacje zostawiaj jako rekomendacje/symulacje i sprzątaj po sobie.
- Repo jest PUBLICZNE — zero sekretów w commitach.
- Autoryzacja PRZED efektami ubocznymi (403 zanim jakikolwiek zapis/encrypt/DB).

## Bramki człowieka (STOP — NIE wykonuj autonomicznie; przygotuj rekomendację i czekaj)
1. `git push` / Pull Request / merge do main (repo publiczne, akcja zewnętrzna).
2. Zaaplikowanie migracji AI-grafik do ŻYWEJ bazy tenanta demo (hrobot_t_900d948b) — additywne
   tabele, ale to zmiana schematu żywej bazy. UWAGA OPERACYJNA (nauczka z live-verify 2026-07-13):
   ręczna aplikacja `psql -U postgres` tworzy tabele/typy jako `postgres` → aplikacja łączy się
   jako rola tenanta `hu_<id>` i dostaje „permission denied" (500). Po ręcznej aplikacji NADAJ
   własność: `ALTER TABLE <t> OWNER TO hu_<id>` dla 3 tabel + `ALTER TYPE <e> OWNER TO hu_<id>`
   dla 4 enumów (albo aplikuj przez mechanizm migracji tenanta aplikacji, który nadaje granty).
   [STATUS: migracja ZAAPLIKOWANA + własność naprawiona na hrobot_t_900d948b 2026-07-13;
   pełna pętla zweryfikowana na żywo; kotwice nietknięte.]
3. Jakakolwiek mutacja kotwic demo lub seedu (w tym podlinkowanie loginu Keycloak do pracownika-
   kandydata dla ścieżki zgody — Codex P1-2: bez tego pełna pętla zgody jest niewykonalna; wybór
   KTÓREGO pracownika i czy ruszać seed należy do człowieka).
4. Otwarte decyzje produktowe/prawne: podstawa prawna autonomicznej komunikacji i przydziału
   (prawo pracy/RODO/dobrowolność); realny kanał e-mail/SMS.

## Kolejność prac (co dalej)
Priorytet: SP1 (zastępstwo przy wypadnięciu) — plan już zrekonsyliowany po Codeksie:
wykonaj zadania 1.1–1.5 z pliku planu tą metodyką (subagenty + Workflow + dwustopniowe review).
KOD i testy jednostkowe SP1 (mockowana Prisma) buduj i weryfikuj bez aplikowania migracji na
żywo. Po SP1: napisz plan SP4 (koszty) → crosscheck Codeksa → wykonaj; potem SP3 (sezonowość),
SP2 (ad-hoc). Każdy nowy podprojekt: własny plan + crosscheck Codeksa PRZED egzekucją.

## Definicja ukończenia / gate'y
- Per zadanie: (backend) `npx jest <obszar> --silent` + `npx eslint src/<obszar>` (0) +
  `npx tsc --noEmit`; (web-kit) `npx vitest run` + `npx tsc --noEmit` + `npx next build`. Wszystko
  zielone, commit dopiero wtedy. `@hrobot/shared` konsumowany z dist — zbuduj go przed testami db.
- Testy shared: nazwa `*.test.ts` (NIE `.spec.ts` — inaczej ląduje w dist i psuje gate pakietu).
- Enum Prisma↔TS: dodawaj asercje w `packages/db/src/enumParity.test.ts`.
- Per podprojekt: pełne suite'y zielone + holistyczny review + (dla read-only ścieżek) live RBAC
  na 3 kontach (demo/demo-staging-2026, manager.demo/Manager!2026, pracownik.demo/Pracownik!2026;
  Keycloak :8081 realm hrobot-staging; tenant-runtime :3001) bez naruszania kotwic.

## Raportowanie
Status per krok: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT. Podawaj commit SHA + tail
gate'ów. Przy Bramce człowieka: STOP + jednozdaniowa rekomendacja i czego potrzebujesz.
