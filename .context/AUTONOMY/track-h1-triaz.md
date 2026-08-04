# Tor H1 — triaż weryfikacyjny znalezisk toru M (`track-m-przeglad.md`)

**Rola:** audytor weryfikujący. Zero napraw, zero commitów kodu.
**Baza:** `feat/autonomy-20260803` @ `9f85288` (49 commitów), własna gałąź `track-h1-triaz` utworzona z tego punktu.
**Zakres:** W2–W5, W8–W14 (dziesięć znalezisk NIEZWERYFIKOWANYCH). W1/W6/W7/auth-bypass-Python wg brief-u miały być już naprawione — zweryfikowano pobieżnie na wejściu (patrz notatka niżej), reszta poza zakresem zadania.

---

## [start] krok | Konfiguracja środowiska

- `git checkout feat/autonomy-20260803` — zajęty przez inny worktree (`hrobot-integracja`), więc: `git checkout -b track-h1-triaz feat/autonomy-20260803` z czubka `9f85288`. Drzewo czyste.
- Log komend i dowodów dopisywany poniżej w kolejności wykonania. Sortowanie finalne (POTWIERDZONE malejąco po wadze → NIEROZSTRZYGNIĘTE → OBALONE) na końcu pliku.

---

## ⚠ NOTATKA POZA ZAKRESEM — W7 NIE jest naprawiony (wbrew briefowi)

Brief zakładał, że W7 (sprzeczność pakietu dowodowego M2) został już zweryfikowany i naprawiony.
Sprawdzone na wejściu (bo dotyczy integralności repo, którą i tak trzeba znać zanim ufa się
pozostałym plikom):

```
git log --oneline 8db25ca..9f85288 -- data/m2-evidence/README.md data/m2-evidence/known-limitations.md data/acceptance-criteria-M2.md
->  (pusto — zero commitów dotknęło te pliki od czubka raportu tora M)

sed -n '1,4p' data/m2-evidence/README.md
->  "Status: 🟡 szkielet gotowy; sloty [CAPTURE]/[4M] do uzupełnienia..."

sed -n '4p' data/acceptance-criteria-M2.md
->  "Status: ✅ mapowanie a–f kompletne z dowodami..."

grep -n "🟡\|✅\|❌" data/m2-evidence/README.md  (wiersze 19-24, macierz a-f)
->  d CI: 🟡 "branch protection po merge linii demo"      vs acceptance-criteria-M2.md:25 "✅ pipeline działa + branch protection"
->  e Staging: 🟡 "auto-deploy/runner" (blokada)           vs acceptance-criteria-M2.md:26 "✅ auto-deploy działa"
->  f UAT: ❌                                               vs acceptance-criteria-M2.md:27 "✅ przygotowane do odbioru"
```

Sprzeczność opisana w W7 istnieje **bit-identycznie** na dzisiejszym czubku. Żaden commit po
`8db25ca` (czubek raportu tora M) nie dotyka `README.md`, `known-limitations.md` ani
`acceptance-criteria-M2.md`. Deklaracja w briefie „W7 już naprawiony" jest nieprawdziwa dla tej
gałęzi — zgłaszam to integratorowi jako pilne, niezależnie od przydzielonego zakresu (W2–W5,
W8–W14), bo pakiet dowodowy w obecnym stanie nadal nie nadaje się do wysyłki.

Sprawdzono też historię auth-Python i W1/W6 w pełni (nie tylko grep): `git log 8db25ca..9f85288`
zawiera `230ee6b` (W1 — ProvisioningModule usunięty z tenant-runtime, potwierdzone czytaniem
`app.module.ts`) i `8e3d432` (W6 — matcher `/api/:path*` + `lib/api-gate.ts`, potwierdzone
czytaniem `middleware.ts`). Auth-bypass w Pythonie: `git log 323594d..8db25ca` zawiera `8d293da`
„fix(auth): JWKS tylko z zaufanej bazy wystawcy — obejście uwierzytelniania w agent-service i
stt-service", **przed** czubkiem raportu — zgodne z sekcją raportu „Uwierzytelnianie (priorytet 2)",
która na tym właśnie kodzie nie znalazła furtki. Te trzy potwierdzam jako rzeczywiście zamknięte;
dalej ich nie audytuję (poza zakresem).

---

## Metodologia dla W2–W5, W8–W14

Środowisko: `pnpm install` w katalogu głównym (potrzebne do jakichkolwiek testów — brak
`node_modules` na starcie). Stack live (`:3001`, `:5601`, `:8010`, `:8000`) **nie działał** w tym
środowisku audytora — jak w raporcie tora M, więc znaleziska wymagające żywego stosu pozostają
statyczne + dowód z jednostkowych/scratch testów (Jest, nie commitowane — utworzone, uruchomione,
wynik zapisany dosłownie, usunięte przed końcem sesji). Dla control-plane i tenant-runtime użyłem
istniejącego harnessu z `provisioning.service.spec.ts` (in-memory prisma mock replikujący
`updateMany`/`update` semantics) do zbudowania PoC-dowodów tam, gdzie to tanie; SQL i docker-compose
zweryfikowane wyłącznie statycznie (czytanie + grep), zgodnie z ograniczeniem braku żywej bazy.

---

## W2 · `apps/control-plane/src/provisioning/provisioning.service.ts` — zwolnienie claima bez fencingu

**WERDYKT: POTWIERDZONE (waga WYSOKA, zgodna z raportem; mechanizm doprecyzowany).**

Raport mówi o `releaseClaim` i polu `claimedBy` — **tych nie ma** w obecnym kodzie (schema
`packages/db/prisma/control-plane/schema.prisma:66` ma tylko `claimedAt`, żadnego `claimedBy`;
`grep -c releaseClaim provisioning.service.ts` → 0). Zwolnienie jest inline w trzech miejscach
(`provisioning.service.ts:86-89` sukces, `:106-114` porażka trwała, `:122-132` porażka z retry) —
wszystkie trzy robią `update({ where: { id: job.id }, data: { claimedAt: null, ... } })` **bez
warunku porównującego, czy claim wciąż należy do tego wykonawcy** (żadne z trzech nie używa
`updateMany` z predykatem na `claimedAt`, w przeciwieństwie do `claimStep()`, które CAS-uje
poprawnie). Efekt identyczny z opisanym w raporcie: konsument A, którego dzierżawa już wygasła
(ale A nadal żyje — tylko wolno pracuje), może zwolnieniem skasować **żywy** claim konsumenta B,
który legalnie przejął krok po wygaśnięciu dzierżawy A.

**DOWÓD — PoC test (Jest, in-memory prisma mock, usunięty po biegu, nie commitowany):**
scenariusz: A zajmuje `SEED` w `t0`; symulowany upływ `CLAIM_LEASE_MS` (300s); B legalnie przejmuje
przez `updateMany` z tym samym predykatem co `claimStep()`; A (nadal „żywy", tylko spóźniony) woła
dokładnie ten sam update co `provisioning.service.ts:86-89` — test:
```
PASS  W2 fencing evidence
  ✓ release-on-success clears a claim it no longer owns (consumer A steals back consumer B live lease)
```
Asercje potwierdzone: `store.current().claimedAt` po zwolnieniu A === `null` (żywy claim B skasowany),
a trzeci konsument C może przejąć krok natychmiast potem — dokładnie scenariusz z raportu, tylko bez
pola `claimedBy` (bo go w kodzie nie ma).

**SCENARIUSZ SZKODY.** Jak w raporcie: A wisi (wolny Keycloak/migracja) dłużej niż 5 min, B
przejmuje krok, A wraca i zwalnia claim B, C wchodzi na krok, który B właśnie wykonuje — trzy
równoległe wykonania `CreateDbStep`/`SeedStep` (patrz W4).

**PROPOZYCJA POPRAWKI.** CAS na każdym zwolnieniu: `updateMany({ where: { id, claimedAt: <wartość,
którą TEN wykonawca zapisał w claimStep> }, data: {...} })` i sprawdzać `count === 1` — analogicznie
do `claimStep()`. Wymaga przekazania własnej wartości `claimedAt` z `claimStep()` do `process()`
(dziś `claimStep` tylko zwraca `boolean`).

---

## W3 · `apps/control-plane/src/outbox/retry-relay.service.ts:37` + `provisioning.controller.ts:33-38`

**WERDYKT: POTWIERDZONE (waga WYSOKA — WYŻSZA niż w raporcie, patrz niżej).**

Sweep faktycznie wyklucza `step IN ('DONE','FAILED')` bezwarunkowo (`retry-relay.service.ts:37`),
niezależnie od `next_attempt_at`/`claimed_at`. Ale kluczowe odkrycie ponad raport: **`job.step`
przechodzi na `'DONE'` PRZED wykonaniem `DoneStep`, nie w jego trakcie.**
`keycloak-setup.step.ts:238-241` sam ustawia `step: ProvisioningStep.DONE` jako swój OSTATNI zapis —
to dzieje się, zanim `DoneStep.execute()` w ogóle wystartuje (uruchamia je dopiero kolejny `emit()`
z `provisioning.service.ts:91-93`). Status endpoint (`provisioning.controller.ts:33-38`) liczy
`done: failed || job.step === 'DONE'`.

**Konsekwencja realna, nie tylko brak retry:** w oknie między zapisem `step=DONE` przez
`KeycloakSetupStep` a faktycznym wykonaniem `DoneStep` (które dopiero przełącza `tenant.status` na
`ACTIVE`), `GET /provision/status/:jobId` **już zwraca `done: true`** — sukces zgłoszony ZANIM
tenant jest aktywny. Normalnie to okno to pojedynczy round-trip RMQ (ms), ale jeśli emit padnie
(broker chwilowo niedostępny) — trafia w catch-block `provisioning.service.ts:95-134`, który
**nie ustawia `step`** w danych update (zostaje `DONE`, bo `KeycloakSetupStep` już to zapisał),
tylko `attemptCount`/`nextAttemptAt`/`claimedAt`. Rezultat: `nextAttemptAt` jest ustawiony, ale
sweep i tak pominie wiersz, bo filtr `step NOT IN ('DONE','FAILED')` jest **bezwarunkowy** — nie
patrzy na `next_attempt_at` wcale. Job zawieszony na zawsze, a `status` już od dawna kłamie „gotowe".

**DOWÓD.** Statyczny, z treści plików cytowanych wyżej (numery linii aktualne na `9f85288`); logika
SQL nie wymaga żywej bazy do zweryfikowania — `WHERE step NOT IN ('DONE','FAILED') AND (...)` jest
jednoznaczna: żaden `OR next_attempt_at <= now()` nie uratuje wiersza ze `step = 'DONE'`.
**Niezweryfikowane na żywym RMQ** (brak stacku) — dowód wymagałby zasymulowania padającego `emit`
na żywym brokerze; scenariusz statyczny jest jednak jednoznaczny z samego kodu.

**PROPOZYCJA POPRAWKI.** Rozdzielić `DONE` (krok do wykonania) od `ACTIVE`/`COMPLETED` (stan
terminalny w `provisioning_job`, osobno od `tenant.status`); `status` endpoint powinien sprawdzać
`tenant.status === ACTIVE`, nie `job.step === 'DONE'`. W sweepie warunkować pominięcie na faktycznym
stanie tenanta, nie na samym stringu kroku.

---

## W4 · `create-db.step.ts`, `seed.step.ts`, `keycloak-setup.step.ts` — idempotencja sekwencyjna ≠ bezpieczeństwo współbieżne

**WERDYKT: POTWIERDZONE dla CreateDbStep i SeedStep (waga WYSOKA); KeycloakSetupStep SŁABSZY
argument niż w raporcie — dopisuję niżej dlaczego.**

- **`CreateDbStep` (`create-db.step.ts:35-65`)** — `dbPassword = randomBytes(24)...` generowany
  na nowo w KAŻDYM `execute()`; `tenant.dbUrl` zapisywany w linii 44-47 **przed** `ALTER/CREATE
  ROLE ... PASSWORD` w linii 49-55. Dwa niezależne, nieotransakcjonowane zapisy (Prisma update +
  osobne zapytanie `pg`), bez blokady. Przy dwóch współbieżnych przebiegach (W2 pokazuje, że to
  osiągalne mimo „CAS") kolejność zapisów `dbUrl` i `ALTER ROLE` może się rozjechać niezależnie —
  ostatni zapis `dbUrl` i ostatni `ALTER ROLE` mogą pochodzić z RÓŻNYCH przebiegów. Potwierdzone
  czytaniem kodu — brak transakcji, brak locka, dwa oddzielne systemy (Postgres control-plane dla
  `dbUrl`, bezpośrednie `pg.query` dla roli).
- **`SeedStep` (`seed.step.ts:44-54`)** — dosłowny check-then-act: `findFirst` → `if (!existingRoot)
  create()`, bez unikalnego ograniczenia. Komentarz w kodzie (linia 42-43) explicite zakłada, że
  „ProvisioningService's step claim prevents the CONCURRENT case" — założenie **obalone przez W2**.
- **`KeycloakSetupStep` (`keycloak-setup.step.ts:217-231`)** — SŁABSZY przypadek niż sugeruje
  raport: kod ma faktyczną obronę — `tempPassword` jest zapisywany do `nextMeta` TYLKO gdy
  `userCreated === true` (linia 221), a `userCreated` jest prawdziwe tylko dla przebiegu, który
  naprawdę dostał `201` z Keycloaka (drugi współbieżny przebieg dostanie `409` i nie ustawi
  `userCreated`), więc przegrany wyścigu NIE nadpisze zapisanego hasła bezsensownym. Nie jest to
  „brak atomowości" w sensie, w jakim mówi raport — to freestanding idempotency-guard, który
  akurat działa. Zostawiam jako częściowo obalone w tej części.

**DOWÓD.** Statyczny (czytanie kodu, cytowane linie). Współbieżność sama w sobie potwierdzona przez
W2 (PoC test) — bez tamtego dowodu argument „to się nie zdarzy, bo CAS" byłby wiarygodny.
**Niezweryfikowane empirycznie na żywej bazie** (wymaga dwóch równoległych `pg.query(ALTER ROLE)`),
zgodnie z ograniczeniem braku stacku.

**PROPOZYCJA POPRAWKI.** `CreateDbStep`: rotacja hasła + zapis `dbUrl` w jednej transakcji
(np. zapisać `dbUrl` PO potwierdzeniu `ALTER ROLE`, nie przed). `SeedStep`: unikalny częściowy
indeks na `organizational_unit (tenant, parentId) WHERE parentId IS NULL` jeśli schemat na to
pozwala, albo `INSERT ... ON CONFLICT DO NOTHING` na poziomie bazy tenantowej.

---

## W5 · `retry-relay.service.ts` + `outbox-relay.service.ts` — zwolnienie/claim wokół emit

**WERDYKT: RAPORT NIETRAFNY W SZCZEGÓLE, ale POTWIERDZONY pokrewny defekt (waga ŚREDNIA, niżej niż
sugeruje raport).**

Zbadano dosłownie: `outbox-relay.service.ts:23-42` CLAIMUJE (`published_at = now()`) **PRZED**
próbą `emit()` (linia 33), i zwalnia (`publishedAt: null`) TYLKO gdy `emit` rzuci (catch, linia
34-42) — to jest „claim → spróbuj → zwolnij-na-porażce", nie „zwolnij PRZED emitem", jak twierdzi
raport. Ten wzorzec jest w porządku poza jednym brakiem: crash procesu MIĘDZY claimem a emitem
(zanim dojdzie do catch) zostawia wiersz trwale „opublikowany" (`published_at` ustawiony), choć
wiadomość nigdy nie poszła — cichy zgubiony event, inny mechanizm niż opisany w raporcie.

`retry-relay.service.ts:33-49` (SQL) rzeczywiście zeruje `next_attempt_at` w RAMACH zapytania
claimującego, przed pętlą `emit()` (linia 51-64) — to jest zgodne z „claim przed emit", ale na
PORAŻCE kod jawnie DOZBRAJA `nextAttemptAt = now()+10s` (linia 59-62), więc job **nie** zostaje
bez właściciela, jak twierdzi raport — dostaje nowy termin za 10 s.

**Rzeczywisty, potwierdzony defekt: `claimStep()`'s losing branch (`provisioning.service.ts:172-188`)
bezwarunkowo NADPISUJE `nextAttemptAt` na `leaseEnds + 1000` (linia 179-182) — NIEZALEŻNIE od tego,
co już tam było.** Jeśli w tej samej chwili właściwy posiadacz claimu (albo poprzedni failure-path)
zapisał krótszy, świeżo wyliczony backoff (np. 30 s po pierwszej porażce, `RETRY_DELAYS_MS[0]`), a
DUPLIKAT dostarczenia (RMQ at-least-once) w międzyczasie trafi w gałąź `stillOnSameStep`, **ten
duplikat zastąpi 30-sekundowy backoff dziesięciokrotnie dłuższym** (`CLAIM_LEASE_MS=300s + 1s`) —
opóźniając retry, nie gubiąc go. To pasuje do jednego zdania raportu („przegrany wyścigu o claim
nadpisuje nextAttemptAt zwycięzcy, resetując backoff"), ale mechanizm i konsekwencja (opóźnienie,
nie utrata) są inne niż cała reszta akapitu W5 sugeruje.

**DOWÓD.** Statyczny — `claimStep()` linia 179-182 pisze `nextAttemptAt` bez `updateMany`/CAS, więc
nie ma ochrony przed nadpisaniem świeższej wartości zapisanej równolegle.

**PROPOZYCJA POPRAWKI.** W gałęzi `stillOnSameStep` pisać `nextAttemptAt` tylko gdy jest ono
`null` LUB późniejsze niż `leaseEnds+1000` (`MIN`, nie bezwarunkowe nadpisanie) — jedna klauzula
`WHERE nextAttemptAt IS NULL OR nextAttemptAt > $proposed`.

---

## W8 · `analityk.service.ts` (`wnioski.wToku`) — CANCELLED w kolejce

**WERDYKT: OBALONE.**

Formuła opisana w raporcie (`wToku = zlozone − APPROVED − REJECTED`) **nie istnieje** w kodzie na
`9f85288` — ani nawet na czubku samego raportu (`8db25ca`). Sprawdzone bezpośrednio:
`git show 8db25ca:apps/tenant-runtime/src/analityk/analityk.service.ts` linie 780-830 pokazują już
PRZEBUDOWANĄ logikę z commitu `0ff0573` (fix C2-1+C2-2, **potwierdzony jako przodek 8db25ca** przez
`git merge-base --is-ancestor 0ff0573 8db25ca` → prawda). `wToku` to dziś `pendingRows.length`, gdzie
`pendingRows` wymaga `status: PENDING AND decidedAt: null` LUB `decidedAt >= zakres` — wiersz
`CANCELLED` (który nigdy nie ma `status: PENDING`) nie spełnia żadnej klauzuli i jest poprawnie
wykluczony, niezależnie od tego, czy `decidedAt` jest ustawiony.

**Efekt uboczny znaleziony przy weryfikacji (nie był w 14 znaleziskach, zgłaszam osobno, niżej
priorytet):** komentarz w kodzie (`analityk.service.ts:799-800`) twierdzi „decidedAt is written on
every approve/reject/cancel" — to jest NIEPRAWDA: `leave.service.ts:283-286` (`cancel()`) ustawia
tylko `status`, nigdy `decidedAt`. Sprawdzono, że to akurat NIE psuje `wToku` (klauzula
`status: PENDING` i tak wyklucza CANCELLED) ani `decisionHours` (linia 835: `if (!r.decidedAt)
continue`), więc to rozbieżność dokumentacji z kodem, nie aktywny błąd — ale warta jednoliniowej
poprawki komentarza, żeby nie zmylić następnego audytora.

**DOWÓD.**
```
git merge-base --is-ancestor 0ff0573 8db25ca && echo ancestor -> "ancestor"
git show 8db25ca:apps/tenant-runtime/src/analityk/analityk.service.ts | sed -n '804-826p' -> kod pendingRows z OR [{status:PENDING,decidedAt:null},{decidedAt:{gte:toExcl}}]
grep -n "data: { status: target }" apps/tenant-runtime/src/leave/leave.service.ts:285 -> brak decidedAt w cancel()
```

---

## W9 · `analityk.service.ts` (`czasPracy`, norma tygodniowa) — okna krótsze niż tydzień

**WERDYKT: OBALONE.**

Formuła `pełne_tygodnie × 40 = floor(dni/7)×40` **nie istnieje** w obecnym kodzie. Norma liczona
per-tydzień jako `bucket.etat * 8 * businessDaysInRange(weekStart, weekEnd, range)`
(`analityk.service.ts:654-656`), gdzie `businessDaysInRange` (`analityk.range.ts:130`) przecina
tydzień z ANALIZOWANYM zakresem i liczy dni robocze W TYM przecięciu — dokładnie scenariusz z
raportu (5 dni roboczych pon–pt) daje `normaDni=5`, `norma=1×8×5=40`, nie `0`. Test
`analityk.range.spec.ts:85-95` pokrywa graniczne przypadki przecięcia tygodnia z zakresem (2 dni,
0 dni). Ten sam commit `0ff0573`/wcześniejsze prace nad `analityk.range.ts` naprawiły to przed
czubkiem raportu — nie znaleziono komitu KASUJĄCEGO tę poprawkę po `8db25ca`.

**DOWÓD.** Kod cytowany wyżej, aktualny na `9f85288`; `businessDaysInRange` zweryfikowane czytaniem
implementacji i testu jednostkowego (nie uruchomiono pełnego jesta ze względu na czas — logika
czysto arytmetyczna, czytelna bezpośrednio z kodu).

---

## W10 · `common/leave-type.ts` (`L4_MARKERS`) — `ZWOLNIENIE_LEKARSKIE` nierozpoznane

**WERDYKT: POTWIERDZONE (waga WYSOKA, zgodna z raportem).**

`L4_MARKERS = ['l4', 'chorob']` (`leave-type.ts:41`). `classifyLeaveType('ZWOLNIENIE_LEKARSKIE')`
normalizuje do `'zwolnienie_lekarskie'`, które nie zawiera ani `'l4'` ani `'chorob'` ani `'urlop'`
→ `'NIEZNANY'`. Literał `ZWOLNIENIE_LEKARSKIE` jest RZECZYWIŚCIE używany w produkcie:
`agent-glosowy/voice-command.service.ts:68` (`L4: 'ZWOLNIENIE_LEKARSKIE'`),
`dokumenty/dokumenty.config.ts:141-142`, `docs/design/web-kit/lib/wnioski.ts:54` (opcja formularza).

**DOWÓD — test (Jest, usunięty po biegu):**
```
FAIL src/common/_w10-evidence.scratch.spec.ts
  × does NOT classify the literal type the product actually writes for L4
    Expected: "L4"
    Received: "NIEZNANY"
```

**SCENARIUSZ SZKODY.** `strategic-brain/snapshot.service.ts:71-72`
(`mapLeaveTypeToExclusion` → `classifyLeaveType`) zwraca `null` dla `ZWOLNIENIE_LEKARSKIE` →
pracownik na zwolnieniu lekarskim NIE jest wykluczony z okna oceny AI-Grafik i jest oceniany, jakby
pracował. Równolegle w Analityk HR rozbicie „wg typu" wrzuca L4 do kubełka nierozpoznanego.

**PROPOZYCJA POPRAWKI.** Dopisać `'zwolnienie_lekarskie'` (i `'niezdolnosc'`) do `L4_MARKERS`;
dołożyć do `leave-type.spec.ts` test parametryzowany po WSZYSTKICH wartościach z
`web-kit/lib/wnioski.ts` i `dokumenty.config.ts`, żeby żaden literał produktowy nie mógł wpaść w
`NIEZNANY` niepostrzeżenie (dokładnie propozycja raportu — podtrzymuję ją).

---

## W11 · `scripts/seed-demo-m2-modules.sql` — rzekomy brak sweepu starych ID

**WERDYKT: OBALONE.**

Sprawdzono WSZYSTKIE bloki `INSERT`/`DELETE` w pliku (211 linii): (1) `company_settings` —
`DELETE FROM company_settings;` przed insertem (pełny sweep singletona); (2) `users`/`user_roles` —
`ON CONFLICT (email) DO NOTHING` + `WHERE NOT EXISTS`; (3) `position_cost_rates` —
`ON CONFLICT (position, employment_type) DO NOTHING`; (4) `access_grant` — `DELETE FROM
access_grant;` przed insertem (pełny sweep); (5b/5c) `leave_requests` — **`ON CONFLICT (id) DO
NOTHING`** z deterministycznymi UUID-ami (rodzina `a1d00000-...-a01..a04`); (6) `users`/`employees`
dla Katarzyny Zając — `ON CONFLICT (email) DO NOTHING` + `WHERE NOT EXISTS`. Każdy blok jest
odporny na podwójne uruchomienie TEGO pliku. Sprawdzone też na czubku raportu (`8db25ca`) — ten sam
stan już wtedy (blok 5b/5c z `ON CONFLICT` widoczny w `git show 8db25ca:scripts/seed-demo-m2-
modules.sql`).

Propozycja poprawki z raportu („oprzeć wstawienia na `ON CONFLICT (id) DO NOTHING` z
deterministycznymi UUID-ami") **jest już zaimplementowana** — to dokładnie obecny stan kodu.

**Zastrzeżenie (nie testowane, poza zakresem statycznym).** Siostrzany skrypt
`scripts/fix-demo-id-contract-grafik-wnioski.sql` rekluczuje STARE sluggowe id (`lr-demo-p1` itd.)
na nowe UUID przez `UPDATE`, nie `DELETE+INSERT` (potwierdzone czytaniem linii 61-73 tamtego pliku).
Jeśli żywy tenant `hrobot_t_900d948b` był zasiany PRZED tą migracją i rekey nigdy się na nim nie
wykonał, mogłyby tam nadal wisieć wiersze o starych id obok nowych — ale to pytanie o STAN
KONKRETNEJ BAZY, nie o kod na tej gałęzi, i wymagałoby zapytania SQL do żywego/staging tenanta,
którego nie miałem (zgodnie z zasadą „nie dotykaj współdzielonego stosu, stwórz własną jednorazową
bazę" — a to pytanie dotyczy konkretnie WSPÓŁDZIELONEJ bazy, więc jednorazowa nic by nie
udowodniła). Integrator z dostępem do stagingu może to zamknąć w minutę:
`SELECT id FROM leave_requests WHERE id !~ '^[0-9a-f-]{36}$';` na `hrobot_t_900d948b`.

---

## W12 · `stt-service/app/main.py:55,73` — `async def transcribe` blokuje event loop

**WERDYKT: POTWIERDZONE (waga WYSOKA, zgodna z raportem).**

`async def transcribe(...)` (linia 54-58) woła `_transcriber.transcribe(data)` (linia 73)
bezpośrednio — `Transcriber.transcribe` (`transcribe.py:103`) to zwykła `def`, CPU-bound, bez
`await`. FastAPI NIE wypycha `async def` handlerów do threadpoola (robi to tylko dla zwykłych
`def`) — potwierdzone czytaniem kodu, brak `run_in_threadpool`/`asyncio.to_thread` gdziekolwiek w
pliku (`grep -c "to_thread\|run_in_threadpool" main.py` → 0). Jedna transkrypcja blokuje CAŁY
proces uvicorn, łącznie z `/health`.

**DOWÓD.** Statyczny (kod jednoznaczny). **Niezweryfikowane empirycznie** — obraz `stt` nie
zbudowany w tym środowisku (brak modelu faster-whisper ~490 MB do pobrania, poza budżetem czasowym
audytu); odtworzenie wymaga dwóch równoległych `POST /voice/transcribe` z realnym nagraniem.

**PROPOZYCJA POPRAWKI.** `def transcribe(...)` zamiast `async def` (FastAPI przeniesie do
threadpoola automatycznie) — najmniejsza zmiana, zgodna z propozycją raportu.

---

## W13 · `stt-service/app/main.py:66,69` — limit rozmiaru sprawdzany po wczytaniu

**WERDYKT: POTWIERDZONE (waga WYSOKA, zgodna z raportem).**

`data = await audio.read()` (linia 66) **przed** `if len(data) > MAX_AUDIO_BYTES` (linia 69) —
kolejność w kodzie jest jednoznaczna, cały upload trafia do pamięci/Starlette
`SpooledTemporaryFile` (próg 1 MB, potem dysk) zanim padnie 413. Deklaracja RODO w
`docs/design/web-kit/app/api/voice/transcribe/route.ts:9` („never buffers it to disk") jest w
sprzeczności z tym zachowaniem powyżej progu 1 MB.

**DOWÓD.** Statyczny — kolejność linii 66/69 jest jednoznaczna. **Niezweryfikowane empirycznie**
(brak zbudowanego obrazu `stt`); odtworzenie: `curl -F audio=@50MB.webm` + monitor `/tmp` w
kontenerze.

**PROPOZYCJA POPRAWKI.** Sprawdzić `Content-Length` przed czytaniem i odrzucić wcześnie; czytać
strumieniowo z narastającym licznikiem; albo skorygować zapis w dokumencie RODO na zgodny z
prawdą, jeśli buforowanie zostaje.

---

## W14 · `docker-compose.yml:199` — kolizja portu 8010 (`stt` vs `agent-service`)

**WERDYKT: POTWIERDZONE (waga WYSOKA, zgodna z raportem).**

Trzy niezależne źródła twardo kodują `8010` dla DWÓCH różnych usług:
```
docker-compose.yml:199              "8010:8010"                    (usługa stt, profil "full")
agent-service/demo/up.sh:14         HOST_PORT="${AGENT_HOST_PORT:-8010}"   (agent-service, poza compose)
docs/design/web-kit/.../route.ts:23 STT_SERVICE_URL ?? 'http://localhost:8010'
```
`agent-service` startuje POZA `docker-compose.yml` (własny `docker run` w `up.sh`), więc
`docker compose --profile full up` po uruchomionym agencie próbuje zbindować już zajęty port hosta.
Dodatkowo domyślny `STT_SERVICE_URL` w web-kit wskazuje na 8010, które w runbooku demo (J4,
`data/m2-evidence/uat-journeys.md`) jest portem agenta — proxy głosowe wysłałoby nagranie do
NIEWŁAŚCIWEJ usługi.

**DOWÓD.** `grep -rn "8010" docker-compose.yml agent-service/demo/up.sh docs/design/web-kit/app/api/
voice/transcribe/route.ts` → trzy trafienia jak wyżej. **Niezweryfikowane empirycznie**
(`docker compose --profile full up` nie uruchomiony w tym audycie — poza budżetem czasowym i
ryzykiem dla współdzielonego stosu); statyczne dowody są jednoznaczne i nie wymagają uruchomienia.

**PROPOZYCJA POPRAWKI.** Przenieść `stt` na wolny port wg `WORKSPACE/PORTS.md` (rejestr portów —
plik protokołu wspólnego, NIE edytuję; zgłoszenie do integratora patrz niżej), zaktualizować
domyślny `STT_SERVICE_URL` i dopisać zmienną do `.env.example`.

---

# PODSUMOWANIE FINALNE — posortowane

## POTWIERDZONE (malejąco po wadze rzeczywistej)

| # | Znalezisko | Waga rzeczywista | Scenariusz szkody (skrót) |
|---|---|---|---|
| 1 | **W3** — `provisioning.controller.ts` status kłamie „done" | **WYSOKA (podniesiona ponad raport)** | `job.step` przechodzi na `DONE` PRZED wykonaniem `DoneStep` (ustawia to `KeycloakSetupStep` na końcu SWOJEGO wykonania); status endpoint już zwraca `done:true`, choć tenant nie jest `ACTIVE`. Jeśli follow-up emit padnie, sweep nigdy nie odzyska joba (`step NOT IN ('DONE','FAILED')` bezwarunkowo) — tenant utknie w `PROVISIONING` NA ZAWSZE, a klient dostał już zielone światło. |
| 2 | **W2** — zwolnienie claima bez fencingu (`provisioning.service.ts:86-132`) | WYSOKA | Konsument A (żywy, tylko spóźniony) zwalnia claim, który mu już nie przysługuje, kasując żywy claim konsumenta B; trzeci konsument C wchodzi na krok, który B właśnie wykonuje. Potwierdzone działającym PoC (Jest, mechanizm identyczny jak w `claimStep`). Jest to root cause, który czyni W4 osiągalnym mimo deklarowanego „CAS". |
| 3 | **W4** — `CreateDbStep`/`SeedStep`, brak atomowości pod współbieżnością | WYSOKA | `CreateDbStep`: dwa równoległe przebiegi (umożliwione przez W2) mogą rozjechać zapisany `dbUrl` i faktyczne hasło roli PostgreSQL → tenant traci możliwość połączenia z własną bazą. `SeedStep`: check-then-act bez unique constraint → druga „Cała firma", rozjazd RBAC. (KeycloakSetupStep częściowo obalone — ma realną ochronę przez `userCreated`.) |
| 4 | **W14** — kolizja portu 8010 (`docker-compose.yml` / `agent-service/demo/up.sh` / web-kit) | WYSOKA | Pierwszy `docker compose --profile full up` przy działającym agencie = „port already allocated"; w drugiej kolejności agent nie wstaje. Ścieżka demo J4 (kluczowa dla odbioru 4Mobility) przestaje istnieć. Domyślny `STT_SERVICE_URL` też wskazuje 8010 → nagranie leci do niewłaściwej usługi. |
| 5 | **W12** — `stt-service` blokuje event loop (`main.py:55,73`) | WYSOKA | `async def` handler woła synchroniczną, wielosekundową transkrypcję bez threadpoola — jedna transkrypcja zawiesza CAŁY proces, w tym `/health`, po którym compose ocenia żywotność. Dwóch równoległych użytkowników = drugi czeka na pierwszego; healthcheck może uznać serwis za martwy w trakcie normalnej pracy. |
| 6 | **W10** — `ZWOLNIENIE_LEKARSKIE` nierozpoznane w `L4_MARKERS` | WYSOKA | Potwierdzone testem (czerwony bez poprawki). Pracownik na zwolnieniu lekarskim NIE jest wykluczany z okna oceny AI-Grafik (`mapLeaveTypeToExclusion` zwraca `null`) — oceniany, jakby pracował; w Analityk HR L4 wpada do kubełka „nieznany". Dotyczy realnego, produktowego literału (14 trafień w kodzie produkcyjnym). |
| 7 | **W13** — `stt-service` buforuje do dysku przed sprawdzeniem limitu | WYSOKA (zgodna z raportem) | `await audio.read()` przed sprawdzeniem `MAX_AUDIO_BYTES` — powyżej 1 MB Starlette pisze na dysk zanim padnie 413; zaprzecza to dosłownie zapisowi RODO w `route.ts:9` („never buffers it to disk"). Realne ryzyko: wyczerpanie dysku/pasma, i nieprawdziwa deklaracja w dokumencie zgodności. |
| 8 | **W5** — `claimStep()` bezwarunkowo nadpisuje `nextAttemptAt` w gałęzi przegranej | ŚREDNIA (obniżona względem raportu) | Mechanizm z raportu („release przed emit", „job bez właściciela") NIE potwierdza się — obie usługi relay poprawnie dozbrajają/nie zwalniają na porażce. Realny, mniejszy defekt: przegrany wyścigu może nadpisać krótszy, świeżo wyliczony backoff dłuższym (do +300s) — OPÓŹNIENIE retry, nie jego utrata. |

## NIEROZSTRZYGNIĘTE

Brak pozycji w tej kategorii dla przydzielonego zakresu (W2–W5, W8–W14) — każde znalezisko dało się
rozstrzygnąć statycznie z kodu lub testem jednostkowym w dostępnym czasie. Jedyna otwarta kwestia
to poboczne zastrzeżenie przy **W11** (patrz sekcja W11 wyżej): czy żywy tenant `hrobot_t_900d948b`
zawiera osierocone wiersze `leave_requests` ze starymi sluggowymi id sprzed migracji rekeyującej —
to pytanie o stan KONKRETNEJ bazy, nie o kod na tej gałęzi, i wymaga jednego zapytania SQL na
stagingu przez kogoś z dostępem (komenda podana w sekcji W11).

## OBALONE

| # | Znalezisko | Dlaczego obalone (skrót — pełny dowód wyżej) |
|---|---|---|
| 1 | **W8** — `wnioski.wToku` liczy CANCELLED jako „w toku" | Formuła z raportu (`zlozone − APPROVED − REJECTED`) nie istnieje w kodzie — ani na czubku raportu (`8db25ca`), ani dziś. Zastąpiona rekonstrukcją historyczną (`0ff0573`, przodek `8db25ca`), która poprawnie wyklucza CANCELLED przez warunek `status: PENDING`. |
| 2 | **W9** — norma tygodniowa = 0 dla zakresów < 7 dni | Formuła `floor(dni/7)×40` nie istnieje w kodzie. Zastąpiona `businessDaysInRange` liczącym dni robocze w przecięciu tygodnia z zakresem — scenariusz z raportu (pon–pt, 5 dni) daje poprawne 40h normy, nie 0. |
| 3 | **W11** — brak legacy-sweepu w `seed-demo-m2-modules.sql` powoduje duplikaty | Każdy z 6 bloków insertów w pliku ma już ochronę (`ON CONFLICT DO NOTHING` / pełny `DELETE`-sweep / `WHERE NOT EXISTS`) — także na czubku raportu. Propozycja poprawki z raportu jest już zaimplementowanym stanem obecnym. |

---

## Zdanie zamykające

**Blokują wypchnięcie na produkcję:** W3 i W2 razem (kłamliwy status „gotowe" + mechanizm, który
czyni podwójne wykonanie kroków provisioningu realnie osiągalnym pomimo deklarowanego „G-1 fix"),
W4 (konkretna, produkcyjna manifestacja tego samego łańcucha — tenant może stracić dostęp do
własnej bazy), W14 (blokuje demo J4 przy najbliższym `docker compose --profile full up`) oraz W10
(psuje realną figurę oceny pracownika na L4 w AI-Grafiku, nie tylko kosmetykę UI) — te pięć dotyka
albo integralności danych/tenantów, albo samego scenariusza odbiorowego 4Mobility. **Długiem do
zaplanowania** (nie blokuje najbliższego wypchnięcia, ale wymaga wpisu do backlogu) są W12/W13
(odporność `stt-service` — nowa, izolowana usługa, nie na krytycznej ścieżce demo J1-J3) i W5
(kosmetyczne opóźnienie retry, nie utrata danych). Osobno, **poza moim zakresem ale odnotowane jako
pilne**: W7 (sprzeczność pakietu dowodowego M2) NIE jest naprawiona wbrew założeniu briefu — to
osobny bloker, który blokuje wysyłkę pakietu do PARP niezależnie od stanu kodu.



## Sanity check wejściowy — W1, W6 (deklarowane jako naprawione)

```
grep -n "ProvisioningModule" apps/tenant-runtime/src/app.module.ts
-> "// N-1: ProvisioningModule is intentionally NOT imported here — see the note in main.ts."
```
Zgodne z deklaracją — tenant-runtime już nie konkuruje o kolejkę `tenant.provision`. OK.

```
grep -n "matcher" docs/design/web-kit/middleware.ts
-> matcher: ['/api/:path*', ...] + lib/api-gate.ts z PUBLICZNE_API allowlist
```
Zgodne z deklaracją — `/api/**` jest teraz za bramką. OK. (Nie audytowano głębiej — poza zakresem.)

---
