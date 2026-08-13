# Blok F — ZRECENZOWANY (ankieta pulsowa i analiza dobrostanu, M3 b)

**Data recenzji:** 2026-08-12 · **Repo:** `HRobot-m2`, gałąź `feat/demo-4mobility` (HEAD `7fa86a7`)
**Źródło:** `docs/superpowers/plans/2026-08-12-km3-zamkniecie-luk.md`, linie 9671–12261 („⚠ Blok F — DOŁĄCZONY, ALE NIEZRECENZOWANY")
**Specyfikacja:** `spec-km3-luki.md`, sekcja „Blok F"

---

## Werdykt

**WARUNKOWO WYKONALNY.** Merytorycznie plan jest dobry — architektura modułu jest poprawna,
decyzja „dobrostan NIE wchodzi do `compositeScore`" jest respektowana bez żadnego wyjątku, a wszystkie
pięć kryteriów akceptacji ma odpowiadające zadania i testy. **Nie wolno go jednak wykonać w wersji
surowej**, bo w obecnym kształcie:

1. własny test izolacji planu **pada na własnych plikach planu** (trzy pliki produkcyjne zawierają
   napis, którego ten test zakazuje) — „40 passed" z Zadania 8 jest nieosiągalne;
2. `git add packages/db/generated` w Zadaniu 4 **zawsze się wywali** — ten katalog jest w `.gitignore`;
3. blok dodaje **19. trasę BFF**, a blok A przypina inwentarz 17 tras w siedmiu miejscach i drukuje go
   w Zał. 6 — kolizja tej samej klasy co K-1 (blok E), **nigdzie w planie nieodnotowana**;
4. wpis do §8 raportu KM3 jest napisany jako lista punktowana, a §8 to **prosta tabela pandoc**, i numer
   „Zał." koliduje z blokami A (Zał. 6) i B (Zał. 7);
5. scenariusz demo pokazuje stan „3 z 5" w jednostce, **której demonstrujący menedżer nie widzi**
   (zweryfikowane w żywej bazie).

Wszystkie te punkty są poprawione w treści poniżej. Dwa punkty **wymagają decyzji produktowej**,
a nie łatki — są wypisane w sekcji „Decyzje przed startem".

## Liczby recenzji

| Kategoria | Liczba |
|---|---|
| Zmyślone / niepotwierdzone fakty o kodzie | 7 |
| Błędy merytoryczne i dziury w scenariuszu | 15 |
| Niespójności nazw | 4 |
| Placeholdery / kroki bez wykonalnej treści | 4 |
| Braki wobec specu | 2 (żaden nie dotyczy kryteriów akceptacji) |
| **Fakty o kodzie potwierdzone w repo/żywej bazie** | **21** |

## Co zweryfikowałem na żywo (żeby nie powtórzyć błędu planisty)

Stos stał w trakcie recenzji (10 usług `healthy`), więc twierdzenia liczbowe sprawdziłem w bazie
`hrobot_t_900d948b`, a nie w dokumentach:

| Twierdzenie planu | Wynik weryfikacji |
|---|---|
| 39 pracowników, 1558 zmian, 122 snapshoty | **POTWIERDZONE** (`39 / 1558 / 122`, 39 pracowników ze snapshotem, 5 okien, 0 `NULL` w `composite_score`) |
| `performance_config` jest pusta | **POTWIERDZONE** (0 wierszy → obowiązuje syntetyczna domyślna z `performance-config.service.ts:129`) |
| `_prisma_migrations` ma 6 z 13 migracji | **POTWIERDZONE** (6 wierszy, ostatni `20260710000000_employee_preferences`; katalog ma 13) |
| Migracje idą przez `prisma migrate deploy` w kodzie, ręcznym SQL-em na żywym najemcy | **POTWIERDZONE** (`packages/db/src/migrateTenant.ts`; nagłówek `20260721000000_dokumenty/migration.sql` opisuje dokładnie tę drogę + `ALTER TABLE … OWNER TO hu_<tenant>`) |
| Źródłem prawdy jest `packages/db/prisma/tenant/schema.prisma` | **POTWIERDZONE, ale dowód planu jest fałszywy** — patrz Ustalenie 1 poniżej |
| `minPeerGroupSize = 5` pochodzi z `performance-config.service.ts:129` | **POTWIERDZONE** |
| `composite_score` jest zasiany, nie policzony (19 różnych wartości na 39 wierszy) | **POTWIERDZONE** dla okien `2026-06-18`, `2026-07-02`, `2026-07-16` |
| 4 jednostki: Centrum 14 / Północ 13 / Południe 12 / „4Mobility — Operacje" 0 | **POTWIERDZONE** |
| 2 konta Keycloak: Anna Kowalska (Centrum), Katarzyna Zając (Północ) | **POTWIERDZONE** |
| Raport KM3 mówi „36 pracowników, 832 zmiany" w liniach 227 i 406 | **POTWIERDZONE** |
| `SnapshotService.overview(client, scopeUnitIds)` zwraca `{heatmap, recruitment}` przez kontroler | **POTWIERDZONE** |
| `isGlobal` / `managedUnitIds`, `ROLES_KEY`, `TenantRoute`, `CurrentTenantClient`/`CurrentUser`, `JwtPayload.hrobot_roles`, `@Ip()` | **POTWIERDZONE** co do ścieżek i sygnatur |
| Konta E2E `manager.demo` / `pracownik.demo`, selektory `input[name="login"]`/`[name="pw"]` | **POTWIERDZONE** |

**Kontekst, który mógł się zdezaktualizować — sprawdzone:** stanowiska w żywej bazie to
`Serwisant floty 14 / Operator 14 / Kierowca 7 / Koordynator zmiany 4` (rename `Recepcjonista → Operator`
wszedł), a `shift_demands.required_role` trzyma kody ról. **Blok F nie odwołuje się do żadnej nazwy
stanowiska ani do `required_role`** — obie zmiany są dla niego obojętne i nic tu nie wymaga korekty.

## Decyzja niepodważalna — czy plan ją respektuje?

**TAK, bez wyjątku.** `ScoreDimensions`/`ScoreWeights` pozostają czterowymiarowe, model
`PulseSurveyResponse` nie ma żadnej relacji do `EmployeePerformanceSnapshot`, migracja jest wyłącznie
addytywna, a strażnik strukturalny zakazuje piątego wymiaru na przyszłość.

**Dowód liczbowy dla wszystkich 39 pracowników ISTNIEJE i jest poprawny**: `--dump` przed / `--dump` po
/ `--compare` na 122 wierszach, porównanie **tekstowe** (`composite_score::text`) bez tolerancji, z
kotwicami 39/1558 przerywającymi porównanie dwóch różnych zbiorów. To jest realny dowód i zostaje bez
zmian.

**ALE:** druga noga dowodu — `composite-score-nietkniety.spec.ts` — jest w planie opisana mocniej, niż
faktycznie działa. Sprawdziłem `SnapshotService.overview` → `toHeatCell`: `compositeScore` jest
**przepisywany z bazy przez `Number()`**, nigdy nie przeliczany. Zmiana wagi w `performance-config.service.ts`
albo funkcji `compositeScore()` w `scoring.util.ts` **nie zapali tego testu**. Komentarz w pliku testu jest
poprawiony poniżej, bo to zdanie trafiłoby do macierzy pokrycia idącej do PARP.

## Decyzje przed startem (nie da się ich załatać w planie)

**D-1. Komentarz ankiety trafia do `audit_log` w postaci jawnej.**
`AuditInterceptor` zapisuje `redactAuditPayload(req.body)` dla każdego POST-a, a `SENSITIVE_KEYS` to
`pesel, password, passwordhash, token, accesstoken, refreshtoken, secret, ssn, identifier` — **bez
`comment`**. Ekran obiecuje pracownikowi: *„Nikt — łącznie z Twoim przełożonym — nie zobaczy Twojej
pojedynczej oceny ani komentarza"*. Po zapisie do `audit_log` (tabela append-only, obok `actorUserId`)
to zdanie przestaje być prawdziwe wobec administratora bazy. To **sprzeczność między obietnicą na ekranie
a zachowaniem systemu**, nie ryzyko techniczne. Trzy wyjścia — wybór należy do właściciela produktu / IOD:
(a) dopisać `'comment'` do `SENSITIVE_KEYS` (zmienia audyt **wszystkich** modułów),
(b) wyłączyć `AuditInterceptor` dla `POST /ankieta/odpowiedz` (odstępstwo od `@TenantRoute()`),
(c) zmienić tekst na ekranie na prawdziwy.
**Bez tej decyzji Zadanie 10 nie ma prawa napisać tego akapitu.**

**D-2. Scenariusz demo dla stanu „poniżej progu".**
Seed w Zadaniu 11 sadzi 3 odpowiedzi w **Region Północ**, a demonstrator loguje się jako `manager.demo`.
Zweryfikowane w bazie: `manager.demo` ma rolę MANAGER wyłącznie na **Region Centrum** i
**„4Mobility — Operacje"**. `managedUnitIds` zwróci te dwie jednostki, więc **Region Północ nigdy nie
pojawi się na jego ekranie**, a stan „3 z 5" zobaczy tylko HR/ADMIN. Ponieważ „4Mobility — Operacje" ma
0 pracowników, u menedżera stan podprogowy wyrenderuje się jako **„0 z 5"** — asercja E2E przechodzi, ale
z innego powodu, niż plan zakłada. Do wyboru:
(a) demonstrujemy stan podprogowy na koncie `demo`/ADMIN (widzi wszystkie 4 jednostki) — **wariant przyjęty
w poprawionym planie, bo nie rusza danych demo**,
(b) nadajemy `manager.demo` rolę MANAGER na Region Północ (zmiana `user_roles` w danych demo — dotyka
kotwic innych modułów, m.in. inboksu zamian),
(c) obniżamy Region Centrum poniżej progu (traci się przypadek „wynik widoczny").

---

## Najpoważniejsze znaleziska (pełna lista, po jednym zdaniu)

### Zmyślone / niepotwierdzone fakty o kodzie

**F-1 (KRYTYCZNE).** Test `scoring-izolacja.spec.ts` („produkcyjne pliki ankiety nie sięgają do
strategic-brain") szuka literału `strategic-brain` w każdym nie-wyjątkowym pliku `.ts` katalogu
`src/ankieta`, a **trzy pliki, które ten sam plan każe napisać** (`ankieta.config.ts`, `ankieta.service.ts`,
`ankieta.controller.ts`) zawierają ten literał w komentarzach — więc Zadanie 8 Krok 5 („40 passed") jest
nieosiągalne. *Poprawka: test wykrywa realne krawędzie importu, nie wystąpienia napisu.*

**F-2 (KRYTYCZNE).** `git add … packages/db/generated` w Zadaniu 4 Krok 6 **zawsze zakończy się błędem** —
`.gitignore:10` zawiera `packages/db/generated/`, `git check-ignore` potwierdza dopasowanie, a
`git ls-files packages/db/generated` jest pusty. *Poprawka: usunięta ścieżka z `git add`.*

**F-3 (WYSOKIE).** Twierdzenie, że komentarz w `composite-score-nietkniety.spec.ts` opisuje prawdę —
„jakakolwiek zmiana w `scoring.util.ts`, w domyślnej konfiguracji wag … zapala ten test na czerwono" — jest
**fałszywe**: `toHeatCell` przepisuje `composite_score` z bazy przez `Number()` i nie wywołuje
`compositeScore()`. *Poprawka: komentarz mówi, co test faktycznie przypina, a czego nie.*

**F-4 (ŚREDNIE).** Ustalenie 1 planu twierdzi, że obie kopie `schema.prisma` są **„bajtowo identyczne"** —
nie są (`md5` 76b5d9… vs ed85d1…, 38408 vs 38448 B, źródło CRLF / kopia LF, inne wyrównanie kolumn); wniosek
o źródle prawdy jest jednak poprawny i ma mocniejszy dowód: katalog `generated/` jest w `.gitignore` i
nietrackowany.

**F-5 (ŚREDNIE).** Zadanie 6 Krok 2 przewiduje `TypeError: service.agregaty is not a function`, ale
`apps/tenant-runtime/jest.config.cjs` nie wyłącza diagnostyki ts-jest, więc wywołanie nieistniejącej metody
jest **błędem kompilacji `TS2339`** i suite w ogóle nie wystartuje.

**F-6 (NISKIE).** Spec kontrolera używa `Reflect.getMetadata(ROLES_KEY, …)`, podczas gdy **sześć istniejących
spec-ów kontrolerów** w tym repo używa `new Reflector().get<string[]>(ROLES_KEY, Ctrl.prototype[m] as …)` i
żaden nie importuje `reflect-metadata`.

**F-7 (NISKIE).** Cytat „`scoring.util.ts:100–105` renormalizuje" jest nieprecyzyjny (deklaracja funkcji w
linii 100, renormalizacja w 103–108, `ScoreDimensions` w 78) i powtórzony dosłownie w czterech miejscach, w
tym w tekście idącym do §5 raportu PARP.

### Błędy merytoryczne i dziury w scenariuszu

**F-8 (KRYTYCZNE).** Blok F dodaje `apps/web/app/api/ankieta/[[...path]]/route.ts`, czyli **19. trasę BFF**
(dziś 17, po bloku E 18), a blok A przypina inwentarz w `api-gate.security.test.ts` (17 tras z nazwy,
14 bramkowanych), `scripts/bff-routes.test.mjs`, sumach `pnpm test:security` (`94 / 49 / 265`) oraz w
**drukowanym Zał. 6 §4** — dokładnie kolizja klasy K-1, której plan dla bloku F w ogóle nie odnotowuje.

**F-9 (WYSOKIE).** Plan **nie dopisuje** `/api/ankieta/*` do listy `CHRONIONE` w
`apps/web/lib/middleware-api-gate.test.ts`, mimo że blok E robi to dla swojej trasy (Zadanie 8 Krok 8) —
bez tego nowa trasa BFF nie ma dowodu 401 w zestawie, który Zał. 6 zlicza.

**F-10 (WYSOKIE).** Zadanie 12 Krok 4 każe dopisać do §8 raportu **listę punktowaną**, a §8 jest
**prostą tabelą pandoc** (2 spacje wcięcia, `**Zał. N**`, 3 spacje, linia myślników ustalająca szerokości) —
wpis w podanym formacie rozbije tabelę; dodatkowo numer to **Zał. 8**, bo Zał. 6 zajmuje blok A, a Zał. 7 blok B.

**F-11 (WYSOKIE).** Zadanie 12 Krok 3 (korekta „36 pracowników, 832 zmiany") **dubluje Krok 47 bloku A**,
który robi globalny `-replace` w tym samym pliku — a pozycja K-9 tego samego dokumentu już to sygnalizuje;
w dodatku podany literał pasuje tylko do linii 406, bo linia 227 brzmi „kotwic demo", nie „kotwice demo".

**F-12 (WYSOKIE).** Scenariusz demo i E2E menedżera nie pokazują tego, co deklarują — patrz **D-2**.

**F-13 (ŚREDNIE).** Zadanie 9 Krok 7 **commituje świadomie czerwony** `middleware-matcher.test.ts`
(potwierdziłem, że zapali się dokładnie test „every matcher entry points at a route that actually exists");
jeden `git bisect` albo jeden przebieg CI na tym commicie to fałszywy alarm — kolejność kroków jest zmieniona.

**F-14 (ŚREDNIE).** `seed-demo-ankieta.sql` kończy na `ON CONFLICT … DO NOTHING`, więc po tym, jak
którykolwiek z ośmiu wybranych pracowników odpowie przez interfejs, ponowny przebieg seeda cicho pominie jego
wiersz i rozkład przestanie zgadzać się z oczekiwaniem Kroku 4.

**F-15 (ŚREDNIE).** `Get-Content …sql -Raw | docker exec -i … psql` w Windows PowerShell 5.1 przekodowuje
potok do strony kodowej konsoli, a seed niesie polskie teksty komentarzy, **które lądują w bazie i na ekranie
menedżera** — potrzebny `docker cp` + `psql -f`.

**F-16 (ŚREDNIE).** Zadanie 11 Krok 6 wymaga `$env:DEMO_ADMIN_PASSWORD` (skrypty repo przerywają, gdy jej
brak), czego plan nigdzie nie mówi, a `$diff.Count` przy zerze różnic zwraca w PS 5.1 `$null`, więc linia
kontrolna wypisze `rozjazdow=` zamiast `rozjazdow=0`.

**F-17 (ŚREDNIE).** Zadanie 8 Krok 6 zapowiada „**OBIE** nogi na czerwono", ale pokazane oczekiwane wyjście
zawiera wyłącznie awarie strażnika strukturalnego — dopisanie piątego wymiaru do typu nie zmienia
zapisanych wartości `composite_score`, więc test liczbowy się nie zapali (zapalą się za to błędy kompilacji
w całym `strategic-brain`).

**F-18 (NISKIE).** `agregujJednostke` przy ocenie spoza 1..5 wpisze `NaN` do `distribution`
(`distribution[klucz] += 1` na nieistniejącym kluczu), mimo że `suma` ją policzy — trzy bramki czynią to
nieosiągalnym, ale funkcja czysta powinna się bronić sama.

**F-19 (NISKIE).** `windowEnd` jest zapisywany i zwracany, ale **żadna ścieżka odczytu go nie używa**
(`agregaty` filtruje po `windowStart`), a komentarz opisuje go jako „datę kalendarzową, nie koniec doby",
czyli wartość, która nie jest ani końcem okna, ani do niczego potrzebna.

**F-20 (NISKIE).** `@Ip() _ip: string` w `agregaty` jest martwy (`AuditInterceptor` nie audytuje GET-ów), a
`IconMessageCircle` zostaje użyty **drugi raz** w tym samym menu (już nosi go „Asystent").

**F-21 (NISKIE).** Nakład „3 h" ze specu jest nierealny dla 12 zadań, ~70 kroków, migracji, wdrożenia na
żywy stos, E2E i edycji raportu — realnie **7–9 h**.

**F-22 (NISKIE).** Żaden krok nie uruchamia `lint` (ani w `apps/web`, ani w `apps/tenant-runtime`), mimo że
plan wprowadza nieużywany parametr i pliki z dyrektywą `'use client'`.

### Niespójności nazw

**F-23.** `AgregatJednostki` jest zadeklarowany **dwa razy** — w `ankieta.agregacja.ts` (`distribution: RozkladOcen | null`)
i w `apps/web/lib/ankieta.ts` (`Record<'1'|…, number> | null`) — celowo (granica BFF, jak `lib/dokumenty.ts`),
ale plan tego nie nazywa i nie pilnuje testem kształtu.

**F-24.** `MojaOdpowiedz` po stronie web opisuje `odpowiedz` jako `{score, comment, submittedAt, updatedAt}`,
podczas gdy `MOJA_SELECT` zwraca dodatkowo `windowStart` i `windowEnd` — typ-lustro nie jest lustrem.

**F-25.** Jeden moduł miesza dwie konwencje: pola agregatu po angielsku (`unitId`, `respondentCount`,
`averageScore`, `suppressed`) i klucze odpowiedzi API po polsku (`pytanie`, `jednostki`, `minAnonimowosci`).

**F-26.** Trzy nazwy na jedno pojęcie progu — `MIN_ANONIMOWOSCI`, parametr `minAnonimowosci`,
źródłowe `minPeerGroupSize` — spięte wyłącznie testem regexowym; wymaga jednego zdania w macierzy pokrycia.

### Placeholdery

**F-27.** Weryfikacje negatywne w Zadaniach 3 i 6 są opisane prozą („zmień tymczasowo… przywróć") bez
polecenia przywracającego — w Zadaniu 8 ten sam wzorzec ma już `git checkout --`; ujednolicone.

**F-28.** Zadanie 12 Kroki 2–4 to edycje prozą w pliku, który zmieniają **także bloki A, B, C, D i E**
(„najcięższa kolizja planu" wg jego własnej tabeli), bez zacytowanej kotwicy tekstowej dla §8.

**F-29.** Brak kroku dodającego trasę do inwentarza BFF (F-9) — to nie jest „placeholder", to brakujący krok.

**F-30.** Brak jakiegokolwiek testu w torze integracyjnym (`jest.integration.config.cjs`), mimo że plan
testów ze specu przewiduje integracyjny test progu anonimowości; plan podstawia w to miejsce E2E.

### Braki wobec specu

**Kryteria akceptacji: wszystkie pięć ma pokrycie.** 1 → `@@unique` + 2 testy `ankieta.service.spec.ts`;
2 → `ankieta.agregacja.spec.ts` + `ankieta.rodo.spec.ts` + `lib/ankieta.test.ts` + E2E; 3 → trzy testy RODO
+ E2E; 4 → `--dump`/`--compare` + test ścieżki odczytu + kontrola na żywo; 5 → test „brak komentarzy NIE
blokuje agregacji". **Żadne kryterium nie jest osierocone.**

**F-31.** Plan testów ze specu przewiduje dla bloku F **integracyjny** test progu; plan realizuje go jako E2E
— różnica jest do zaakceptowania, ale ma być powiedziana wprost, nie przemilczana.

**F-32.** Nakład ze specu (3 h) jest niezgodny z zawartością bloku (patrz F-21).

---

# PLAN PO POPRAWKACH

Poniżej pełna treść bloku F z naniesionymi poprawkami. Miejsca zmienione wobec wersji surowej są
oznaczone **`[POPRAWKA F-n]`**.

---

## Blok F — Ankieta pulsowa i analiza dobrostanu (M3 b)

**Ustalenia sprzeczne z założeniem:**

1. **Ścieżka schematu Prisma w briefie wskazuje kopię generowaną.** **`[POPRAWKA F-4]`** Wniosek planisty jest słuszny, ale jego dowód nie: obie kopie **NIE są bajtowo identyczne** — `md5` `76b5d974…` (źródło) vs `ed85d1d3…` (kopia), 38 408 B vs 38 448 B, źródło ma CRLF, kopia LF, a kopia jest przeformatowana (inne wyrównanie kolumn w `model Employee`). Identyczne są natomiast **zbiór modeli (24) i treść z dokładnością do białych znaków** (`diff -w --strip-trailing-cr` czysty), co potwierdza, że kopia powstaje z generatora (`output = "../../generated/tenant"`).
   Mocniejszy i rozstrzygający dowód, którego plan nie użył: **`packages/db/generated/` jest w `.gitignore` (linia 10) i nie ma w gicie ani jednego pliku** (`git ls-files packages/db/generated` → puste, `git check-ignore` → dopasowanie). Kopia jest artefaktem builda.
   Źródłem prawdy jest zatem **`packages/db/prisma/tenant/schema.prisma`** — tam edytujemy, kopia powstaje z `pnpm -C packages/db db:generate` (skrypt generuje dwa razy: control-plane i tenant). Plan używa ścieżki źródłowej i **nigdzie nie commituje `generated/`** (patrz poprawka w Zadaniu 4 Krok 6).

2. **Migracje: w repo Prisma, na żywym najemcy surowy SQL.** Kod deployu to `prisma migrate deploy` (`packages/db/src/migrateTenant.ts:45`, `apps/tenant-runtime/src/provisioning/steps/run-migrations.step.ts`), ale sprawdzone w żywej bazie: `SELECT migration_name FROM _prisma_migrations` w `hrobot_t_900d948b` zwraca **6 pozycji**, a katalog `packages/db/prisma/tenant/migrations/` ma **13**. Siedem ostatnich (w tym `20260721000000_dokumenty`) wgrano ręcznie przez `psql` + `ALTER TABLE … OWNER TO hu_900d948b`, bez wpisu do `_prisma_migrations` — dokładnie tak, jak opisuje nagłówek `20260721000000_dokumenty/migration.sql`. Plan idzie tą samą drogą i nie dotyka `_prisma_migrations`.

3. **`composite_score` w żywym najemcy jest ZASIANY, nie policzony przez silnik.** `scripts/seed-demo-strategic-brain-peers.sql:18` mówi to wprost: „WARTOSCI SA AUTORSKIE, NIE POLICZONE". Potwierdzone liczbowo: w oknie kończącym się 2026-07-16 jest 39 wierszy, ale tylko **19 różnych** wartości `composite_score`. Konsekwencja dla wymogu krytycznego: **nie da się** udowodnić niezmienności przez „przepuść dane przez `finalizeWindow` przed i po", bo `finalizeWindow` wyprodukowałoby inne liczby niż te rozliczane w KM3 — już dziś, przed blokiem F. Realny dowód liczbowy = Zadanie 1 + Zadanie 8 (zrzut bajtowy przed/po + odtworzenie ścieżki odczytu na 39 wierszach), opisane niżej.

4. **`performance_config` w żywym najemcy jest PUSTA** (`SELECT min_peer_group_size FROM performance_config LIMIT 1` → 0 wierszy). `minPeerGroupSize = 5` pochodzi z syntetycznej domyślnej konfiguracji `performance-config.service.ts:129`, nie z wiersza w bazie. Dlatego próg anonimowości pinujemy do **źródła** tego pliku, a nie do odczytu z DB.

5. **Kotwice w raporcie KM3 §5 są nieaktualne.** `docs/raport-km3/Raport_KM3_HRobot.md:406` mówi „36 pracowników, 832 zmiany"; żywy najemca ma zmierzone **39 pracowników i 1558 zmian** (`SELECT count(*) FROM employees` → 39, `FROM shifts` → 1558), zgodnie z briefem i z `docs/demo/2026-08-10-demo-4mobility-parp.md:48`. To luka §5, nie luka bloku F — Zadanie 12 dopisuje jedno zdanie i **nie** przepisuje istniejących czterech deklaracji.

**Zweryfikowane fakty, na których stoi plan:** 39 pracowników, 1558 zmian, 4 jednostki organizacyjne (Region Centrum 14 osób, Region Północ 13, Region Południe 12, „4Mobility — Operacje" 0), 122 wiersze `employee_performance_snapshot` w 5 oknach, wszystkie z niepustym `composite_score`, 2 pracowników z podpiętym kontem Keycloak (Anna Kowalska, Katarzyna Zając). Stack stoi (10 usług `healthy`). **Wszystkie te liczby przeliczyłem ponownie w recenzji — zgadzają się co do jednej.**

6. **`[POPRAWKA F-12/D-2]` Zakres MANAGERA w danych demo jest węższy, niż zakłada scenariusz seeda.** Zmierzone w `user_roles` żywego najemcy: `manager.demo` ma rolę `MANAGER` wyłącznie na **Region Centrum** i **„4Mobility — Operacje"**. `managedUnitIds` zwraca dokładnie te dwie jednostki, więc **Region Północ nie pojawi się na jego ekranie w ogóle** — a to tam surowy seed sadził stan „3 z 5". Ponieważ „4Mobility — Operacje" ma zero pracowników, menedżer zobaczy stan podprogowy jako **„0 z 5"**. Poprawiony seed i poprawione E2E (Zadania 10 i 11) demonstrują stan „3 z 5" na koncie `demo` (ADMIN, widzi wszystkie cztery jednostki), a u menedżera asertują jawnie „0 z 5" — bez zmiany danych demo.

7. **`[POPRAWKA F-8]` Blok F dodaje 19. trasę BFF i koliduje z blokiem A dokładnie jak blok E.** Dziś w `apps/web/app/api/**` jest **17** plików `route.ts`; blok E dodaje 18. (`/api/kalendarz`), blok F dodaje **19.** (`/api/ankieta`). Blok A przypina inwentarz w siedmiu miejscach (`apps/web/lib/api-gate.security.test.ts` — lista nazw i partycja 14/3; `scripts/bff-routes.test.mjs`; sumy `pnpm test:security` `94 / 49 / 265`; Zał. 6 §4 — tabela 17 wierszy; Krok 41 bloku A — kontrola wzrokowa). Pozycja **K-1** planu analizuje to wyłącznie dla bloku E. **Blok F musi wylądować przed blokiem A**, tak samo jak E; liczby dla A to wtedy **19 tras / 16 bramkowanych / 3 publiczne**, a `test:security` trzeba **zmierzyć**, nie wyliczyć. Jeśli blok A wyląduje pierwszy — siedem miejsc do ręcznej korekty **oraz przedruk Zał. 6**. Istniejący `apps/web/lib/api-gate.test.ts` asertuje `>= 17`, więc **on** się nie zapali; zapali się dopiero to, co dopisuje blok A.

---

### Kolizje bloku F z blokami A–E *(sekcja dopisana w recenzji)*

Tabela własności plików w planie głównym (linie 30–100) **nie wymienia ani jednego pliku bloku F**. Uzupełnienie:

| Plik | Kto jeszcze go dotyka | Charakter kolizji | Rozstrzygnięcie |
|---|---|---|---|
| `apps/web/app/api/**` (inwentarz tras) | A (przypina liczbę), E (dodaje 18.) | **F×A×E — najcięższa** | **F i E przed A**; A zapisuje 19/16/3 |
| `apps/web/lib/middleware-api-gate.test.ts` | E (dodaje `/api/kalendarz/*` do `CHRONIONE`) | F musi dopisać `/api/ankieta/*` | Zadanie 9 Krok 6a (nowy) |
| `apps/web/middleware.ts` (matcher) | tylko F | brak | — |
| `apps/web/lib/nav.ts` | tylko F | brak | — |
| `docs/raport-km3/Raport_KM3_HRobot.md` §5 | A, C, D, E | **F jest szóstym pisarzem** | F dopisuje **jedną** pozycję na końcu §5, nie rusza pozostałych |
| `docs/raport-km3/Raport_KM3_HRobot.md` §8 | A (Zał. 6), B (Zał. 7) | numeracja + format tabeli | F = **Zał. 8**, wiersz tabeli pandoc, po bramce „czy A i B wylądowały" |
| korekta kotwic 36/832 → 39/1558 | **A, Krok 47 (globalny `-replace`)** | duplikat | F **weryfikuje**, nie powtarza (Zadanie 12 Krok 3) |
| `packages/db/prisma/tenant/schema.prisma` + migracje | tylko F | brak | — |
| `apps/tenant-runtime/src/app.module.ts` | tylko F | brak (blok Zastępstw już wylądował) | — |

---

### Zadanie 1: Kotwica liczbowa `compositeScore` — zrzut „przed"

To zadanie MUSI być wykonane **przed jakąkolwiek zmianą kodu bloku F**. Bez zrzutu „przed" nie ma z czym porównywać.

**Pliki:**
- Utwórz: `scripts/composite-score-baseline.mjs`
- Utwórz: `docs/raport-km3/evidence/composite-baseline-przed.json` (wygenerowany, commitowany)

- [ ] **Krok 1: Utwórz katalog na dowody.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
New-Item -ItemType Directory -Force docs\raport-km3\evidence
```

Oczekiwane: katalog `docs/raport-km3/evidence` istnieje.

- [ ] **Krok 2: Napisz skrypt zrzutu i porównania.** Utwórz `scripts/composite-score-baseline.mjs`:

```js
#!/usr/bin/env node
// Kotwica liczbowa KM3: zrzut i BAJTOWE porównanie `composite_score` wszystkich snapshotów żywego
// najemcy. Istnieje po to, żeby zdanie „blok F nie zmienił wyników 39 pracowników" było liczbą,
// nie deklaracją.
//
// DLACZEGO PORÓWNUJEMY TEKST, NIE LICZBY. `composite_score` to postgresowy `numeric` o 30 miejscach
// po przecinku. Rzutowanie na JS `number` gubi końcówkę i potrafi ZAMASKOWAĆ różnicę (albo ją
// wyprodukować). Bierzemy `composite_score::text` i porównujemy napisy — różnica na 28. miejscu
// zapala się tak samo jak różnica na pierwszym.
//
//   node scripts/composite-score-baseline.mjs --dump docs/raport-km3/evidence/composite-baseline-przed.json
//   node scripts/composite-score-baseline.mjs --compare <przed.json> <po.json>
//
// Nadpisywalne przez env: PG_CONTAINER, TENANT_DB.

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const PG = process.env.PG_CONTAINER || 'hrobot-postgres-1'
const DB = process.env.TENANT_DB || 'hrobot_t_900d948b'

/** Kotwice danych demo — jeśli którakolwiek się rozjedzie, porównanie wyników jest bez znaczenia,
 *  bo porównywałoby dwa różne zbiory danych. */
const KOTWICA_PRACOWNICY = 39
const KOTWICA_ZMIANY = 1558

const SEP = '\u0001'

function psqlRows(sql) {
  const out = execFileSync(
    'docker',
    ['exec', '-i', PG, 'psql', '-U', 'postgres', '-d', DB, '-t', '-A', '-F', SEP, '-c', sql],
    { encoding: 'utf8' },
  )
  return out
    .split('\n')
    .map((l) => l.replace(/\r$/, '').trim())
    .filter(Boolean)
    .map((l) => l.split(SEP))
}

function dump(sciezka) {
  const [emp, shifts, snaps] = psqlRows(
    'SELECT (SELECT count(*) FROM employees), (SELECT count(*) FROM shifts), ' +
      '(SELECT count(*) FROM employee_performance_snapshot);',
  )[0].map(Number)

  const rows = psqlRows(
    "SELECT employee_id, window_start::date, window_end::date, coalesce(composite_score::text,'NULL') " +
      'FROM employee_performance_snapshot ORDER BY employee_id, window_start;',
  )

  const pracownicyZeSnapshotem = new Set(rows.map((r) => r[0])).size

  if (emp !== KOTWICA_PRACOWNICY || shifts !== KOTWICA_ZMIANY) {
    console.error(`✗ Kotwice demo się rozjechały: ${emp} pracowników / ${shifts} zmian ` +
      `(oczekiwano ${KOTWICA_PRACOWNICY} / ${KOTWICA_ZMIANY}). Zrzut byłby bezwartościowy.`)
    process.exit(2)
  }
  if (pracownicyZeSnapshotem !== KOTWICA_PRACOWNICY) {
    console.error(`✗ Snapshoty ma ${pracownicyZeSnapshotem} pracowników, nie ${KOTWICA_PRACOWNICY}.`)
    process.exit(2)
  }

  const doc = {
    tenantDb: DB,
    takenAt: new Date().toISOString(),
    anchors: { employees: emp, shifts, snapshots: snaps, employeesWithSnapshots: pracownicyZeSnapshotem },
    rows,
  }
  mkdirSync(dirname(sciezka), { recursive: true })
  writeFileSync(sciezka, JSON.stringify(doc, null, 2) + '\n', 'utf8')
  console.log(`✓ ${sciezka}: ${rows.length} wierszy, ${pracownicyZeSnapshotem} pracowników, ${shifts} zmian`)
}

function compare(a, b) {
  const A = JSON.parse(readFileSync(a, 'utf8'))
  const B = JSON.parse(readFileSync(b, 'utf8'))
  const bledy = []

  for (const k of Object.keys(A.anchors)) {
    if (A.anchors[k] !== B.anchors[k]) bledy.push(`kotwica ${k}: ${A.anchors[k]} -> ${B.anchors[k]}`)
  }

  const key = (r) => `${r[0]}|${r[1]}|${r[2]}`
  const mapA = new Map(A.rows.map((r) => [key(r), r[3]]))
  const mapB = new Map(B.rows.map((r) => [key(r), r[3]]))

  for (const [k, v] of mapA) {
    if (!mapB.has(k)) bledy.push(`zniknął wiersz ${k} (było ${v})`)
    else if (mapB.get(k) !== v) bledy.push(`ZMIENIONY WYNIK ${k}: ${v} -> ${mapB.get(k)}`)
  }
  for (const k of mapB.keys()) if (!mapA.has(k)) bledy.push(`doszedł wiersz ${k}`)

  if (bledy.length > 0) {
    console.error(`✗ compositeScore NIE jest identyczny — ${bledy.length} różnic:`)
    for (const b of bledy) console.error(`   ${b}`)
    process.exit(1)
  }
  console.log(`✓ compositeScore identyczny: ${mapA.size} wierszy, ` +
    `${new Set(A.rows.map((r) => r[0])).size} pracowników, porównanie tekstowe bez tolerancji`)
}

const [tryb, ...args] = process.argv.slice(2)
if (tryb === '--dump' && args[0]) dump(args[0])
else if (tryb === '--compare' && args[1]) compare(args[0], args[1])
else {
  console.error('użycie: --dump <plik> | --compare <przed> <po>')
  process.exit(64)
}
```

- [ ] **Krok 3: Uruchom zrzut „przed" i zobacz kotwice.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
node scripts/composite-score-baseline.mjs --dump docs/raport-km3/evidence/composite-baseline-przed.json
```

Oczekiwane wyjście:
```
✓ docs/raport-km3/evidence/composite-baseline-przed.json: 122 wierszy, 39 pracowników, 1558 zmian
```

- [ ] **Krok 4: Sprawdź, że porównanie pliku ze sobą jest zielone (test sanity samego narzędzia).**

```
node scripts/composite-score-baseline.mjs --compare docs/raport-km3/evidence/composite-baseline-przed.json docs/raport-km3/evidence/composite-baseline-przed.json
```

Oczekiwane: `✓ compositeScore identyczny: 122 wierszy, 39 pracowników, porównanie tekstowe bez tolerancji`

- [ ] **Krok 5: Weryfikacja negatywna narzędzia — podrób jeden wynik i zobacz czerwone.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
$p = "docs/raport-km3/evidence/composite-baseline-przed.json"
(Get-Content $p -Raw).Replace('"83.000000000000000000000000000000"','"83.000000000000000000000000000001"') | Set-Content -Encoding utf8 "$env:TEMP\fake-po.json"
node scripts/composite-score-baseline.mjs --compare $p "$env:TEMP\fake-po.json"
echo "exit=$LASTEXITCODE"
```

Oczekiwane wyjście (fragment):
```
✗ compositeScore NIE jest identyczny — 1 różnic:
   ZMIENIONY WYNIK <uuid>|2026-05-07|2026-05-21: 83.000000000000000000000000000000 -> 83.000000000000000000000000000001
exit=1
```

- [ ] **Krok 6: Posprzątaj podróbkę i zacommituj kotwicę.**

```
Remove-Item "$env:TEMP\fake-po.json"
git add scripts/composite-score-baseline.mjs docs/raport-km3/evidence/composite-baseline-przed.json
git commit -m "test(km3): kotwica liczbowa compositeScore — zrzut 122 wierszy / 39 pracownikow przed blokiem F"
```

---

### Zadanie 2: Okno pulsowe — funkcja czysta

Okno = tydzień ISO (poniedziałek 00:00 UTC → niedziela). Wybór świadomy: pokrywa się z tygodniem demo 13–19 lipca 2026, nie wymaga żadnej konfiguracji i jest w całości testowalny bez bazy.

**Pliki:**
- Utwórz: `apps/tenant-runtime/src/ankieta/ankieta.config.ts`
- Utwórz: `apps/tenant-runtime/src/ankieta/ankieta.window.ts`
- Test: `apps/tenant-runtime/src/ankieta/ankieta.window.spec.ts`

- [ ] **Krok 1: Napisz stałe modułu.** Utwórz `apps/tenant-runtime/src/ankieta/ankieta.config.ts`:

```ts
/**
 * Stałe modułu `ankieta` (M3 b — ankieta pulsowa i analiza dobrostanu).
 *
 * DOBROSTAN NIE WCHODZI DO `compositeScore`. `scoring.util.ts:100–108` (deklaracja w 100, renormalizacja w 103–108) renormalizuje wagi po
 * wymiarach OBECNYCH w danym oknie, więc piąty wymiar przeliczyłby wynik KAŻDEGO z 39 pracowników
 * w każdym oknie — czyli liczby rozliczane w macierzy AN-1..AN-13 raportu KM3. Dobrostan jest
 * osobnym sygnałem OBOK, dokładnie jak `retentionSignal`, który też nie wchodzi do wyniku.
 * Pilnuje tego `scoring-izolacja.spec.ts` (izolacja strukturalna) i
 * `composite-score-nietkniety.spec.ts` (dowód liczbowy na 39 pracownikach).
 */

/**
 * Próg anonimowości: poniżej tylu odpowiedzi w jednostce nie pokazujemy ŻADNEJ wartości wyniku.
 * Ta sama liczba, co `minPeerGroupSize` w domyślnej konfiguracji ocen
 * (`../strategic-brain/performance-config.service.ts:129`) — i to samo uzasadnienie (M10:
 * re-identyfikacja w małej grupie). Parytet obu liczb pilnuje `scoring-izolacja.spec.ts`, który
 * czyta tamten plik jako ŹRÓDŁO, więc nie ma tu importu ani zależności runtime od modułu
 * rozliczanego w KM3.
 *
 * [POPRAWKA F-26] DLACZEGO STAŁA, A NIE ODCZYT Z `performance_config`. Progu NIE czytamy z bazy
 * świadomie, z trzech powodów: (1) `performance_config` w żywym najemcy jest PUSTA (zmierzone: 0
 * wierszy), więc odczyt i tak zwróciłby tę samą syntetyczną domyślną; (2) odczyt zrobiłby z modułu
 * ankiety klienta modułu rozliczanego w KM3 — dokładnie ta zależność, której cały blok F unika;
 * (3) próg anonimowości to gwarancja dla pracownika, a nie parametr strojenia ocen — nie powinno go
 * dać się obniżyć zmianą konfiguracji wydajności. Funkcje agregujące i tak przyjmują `minAnonimowosci`
 * parametrem, więc gdy kiedyś powstanie własna konfiguracja ankiety, podmienia się jedno źródło.
 * KONSEKWENCJA DO ZAAKCEPTOWANIA: najemca, który podniesie `minPeerGroupSize` do 10, NIE podniesie
 * progu ankiety — zapali się wtedy `scoring-izolacja.spec.ts` i wymusi świadomą decyzję.
 */
export const MIN_ANONIMOWOSCI = 5

/** Skala odpowiedzi — jedno pytanie, 1..5. */
export const PULSE_SCORE_MIN = 1
export const PULSE_SCORE_MAX = 5

/** Górny limit komentarza. Komentarz jest OPCJONALNY i jego brak nigdy nie blokuje agregacji. */
export const PULSE_COMMENT_MAX = 500

/** Jedyne pytanie ankiety (M3 b: „jedno pytanie 1–5 + opcjonalny komentarz"). */
export const PULSE_PYTANIE = 'Jak oceniasz swoje samopoczucie w pracy w tym tygodniu?'
```

- [ ] **Krok 2: Napisz CZERWONY test okna.** Utwórz `apps/tenant-runtime/src/ankieta/ankieta.window.spec.ts`:

```ts
import { pulseWindow, pulseWindowKey } from './ankieta.window.js'

/** 2026-07-13 to poniedziałek (tydzień demo 13–19 lipca 2026, `docs/demo/2026-08-10-demo-4mobility-parp.md`). */
const PON = '2026-07-13'
const NIE = '2026-07-19'

describe('pulseWindow — tydzień ISO w UTC', () => {
  it('środa w tygodniu demo wpada w okno 13–19 lipca', () => {
    const w = pulseWindow(new Date('2026-07-15T11:24:00.000Z'))
    expect(w.start.toISOString()).toBe(`${PON}T00:00:00.000Z`)
    expect(w.end.toISOString()).toBe(`${NIE}T00:00:00.000Z`)
  })

  it('poniedziałek jest początkiem swojego własnego okna', () => {
    expect(pulseWindow(new Date(`${PON}T00:00:00.000Z`)).start.toISOString()).toBe(`${PON}T00:00:00.000Z`)
  })

  it('niedziela należy jeszcze do tego samego okna, nie do następnego', () => {
    expect(pulseWindow(new Date(`${NIE}T23:59:59.999Z`)).start.toISOString()).toBe(`${PON}T00:00:00.000Z`)
  })

  it('pora dnia nie zmienia okna (inaczej „raz na okno" zależałoby od godziny kliknięcia)', () => {
    const rano = pulseWindow(new Date('2026-07-15T00:00:00.000Z'))
    const wieczor = pulseWindow(new Date('2026-07-15T23:59:59.999Z'))
    expect(rano.start.getTime()).toBe(wieczor.start.getTime())
  })

  it('okno przechodzące przez granicę miesiąca nie rozpada się', () => {
    // 2026-08-01 to sobota → okno 27.07 – 02.08.
    const w = pulseWindow(new Date('2026-08-01T09:00:00.000Z'))
    expect(w.start.toISOString()).toBe('2026-07-27T00:00:00.000Z')
    expect(w.end.toISOString()).toBe('2026-08-02T00:00:00.000Z')
  })

  it('klucz okna to data poniedziałku w formacie YYYY-MM-DD', () => {
    expect(pulseWindowKey(pulseWindow(new Date('2026-07-15T11:24:00.000Z')))).toBe(PON)
  })
})
```

- [ ] **Krok 3: Uruchom i ZOBACZ, że pada.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2\apps\tenant-runtime
npx jest src/ankieta
```

Oczekiwane wyjście (fragment):
```
FAIL src/ankieta/ankieta.window.spec.ts
  ● Test suite failed to run
    Cannot find module './ankieta.window.js' from 'src/ankieta/ankieta.window.spec.ts'
```

- [ ] **Krok 4: Napisz minimalną implementację.** Utwórz `apps/tenant-runtime/src/ankieta/ankieta.window.ts`:

```ts
/**
 * Okno ankiety pulsowej — funkcja CZYSTA, bez Prismy, bez konfiguracji, bez `Date.now()` w środku
 * (czas zawsze wchodzi parametrem, żeby test nie zależał od zegara maszyny).
 *
 * Tydzień ISO liczony w UTC: poniedziałek 00:00Z → niedziela 00:00Z. Wybór okna tygodniowego, nie
 * miesięcznego, wynika z tego, że „pulsowa" znaczy częsta i krótka; wyrównanie do poniedziałku
 * pokrywa się z tygodniem demo 13–19 lipca 2026, więc ekran demonstracyjny i dane demo mówią o tym
 * samym oknie bez żadnego mapowania.
 *
 * `windowStart` jest KLUCZEM UNIKALNOŚCI odpowiedzi (`@@unique([employeeId, windowStart])` w
 * `packages/db/prisma/tenant/schema.prisma`) — stąd wymóg, żeby był deterministyczny i niezależny
 * od strefy czasowej procesu.
 */

const DAY_MS = 24 * 60 * 60 * 1000

export interface PulseWindow {
  /** Poniedziałek 00:00:00.000Z. */
  start: Date
  /** Niedziela 00:00:00.000Z tego samego tygodnia (data kalendarzowa, nie koniec doby). */
  end: Date
}

/** Okno tygodnia ISO (UTC), w którym leży `now`. */
export function pulseWindow(now: Date): PulseWindow {
  const polnocUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const dzienTygodnia = new Date(polnocUtc).getUTCDay() // 0 = niedziela
  const przesuniecie = dzienTygodnia === 0 ? 6 : dzienTygodnia - 1
  const start = new Date(polnocUtc - przesuniecie * DAY_MS)
  return { start, end: new Date(start.getTime() + 6 * DAY_MS) }
}

/** `YYYY-MM-DD` poniedziałku — stabilny, czytelny klucz okna w API i w interfejsie. */
export function pulseWindowKey(w: PulseWindow): string {
  return w.start.toISOString().slice(0, 10)
}
```

- [ ] **Krok 5: Uruchom i zobacz zielone.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2\apps\tenant-runtime
npx jest src/ankieta
```

Oczekiwane:
```
PASS src/ankieta/ankieta.window.spec.ts
Tests:       6 passed, 6 total
```

- [ ] **Krok 6: Commit.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
git add apps/tenant-runtime/src/ankieta
git commit -m "feat(ankieta): okno pulsowe jako tydzien ISO w UTC (funkcja czysta, 6 testow)"
```

---

### Zadanie 3: Agregacja z progiem anonimowości — funkcja czysta

**Pliki:**
- Utwórz: `apps/tenant-runtime/src/ankieta/ankieta.agregacja.ts`
- Test: `apps/tenant-runtime/src/ankieta/ankieta.agregacja.spec.ts`

- [ ] **Krok 1: Napisz CZERWONY test agregacji.** Utwórz `apps/tenant-runtime/src/ankieta/ankieta.agregacja.spec.ts`:

```ts
import { agregujJednostke, agregujWszystkie, type OdpowiedzDoAgregacji } from './ankieta.agregacja.js'
import { MIN_ANONIMOWOSCI } from './ankieta.config.js'

const U1 = 'unit-centrum'
const U2 = 'unit-polnoc'

const odp = (unitId: string, score: number, comment: string | null = null): OdpowiedzDoAgregacji => ({
  unitId,
  score,
  comment,
})

describe('agregujJednostke — próg anonimowości', () => {
  it('poniżej progu nie zwraca ŻADNEJ wartości wyniku (null, nigdy 0)', () => {
    const a = agregujJednostke(U1, 'Region Centrum', [odp(U1, 5), odp(U1, 4), odp(U1, 5), odp(U1, 1)])
    expect(a.respondentCount).toBe(4)
    expect(a.suppressed).toBe(true)
    expect(a.averageScore).toBeNull()
    expect(a.distribution).toBeNull()
    expect(a.comments).toEqual([])
  })

  it('dokładnie na progu (5) pokazuje średnią i rozkład', () => {
    const a = agregujJednostke(U1, 'Region Centrum', [
      odp(U1, 5), odp(U1, 4), odp(U1, 4), odp(U1, 3), odp(U1, 2),
    ])
    expect(a.respondentCount).toBe(MIN_ANONIMOWOSCI)
    expect(a.suppressed).toBe(false)
    expect(a.averageScore).toBe(3.6)
    expect(a.distribution).toEqual({ '1': 0, '2': 1, '3': 1, '4': 2, '5': 1 })
  })

  it('brak komentarzy NIE blokuje agregacji wyniku', () => {
    const a = agregujJednostke(U1, 'Region Centrum', [
      odp(U1, 3), odp(U1, 3), odp(U1, 3), odp(U1, 3), odp(U1, 3),
    ])
    expect(a.averageScore).toBe(3)
    expect(a.commentCount).toBe(0)
    expect(a.comments).toEqual([])
  })

  it('komentarze mają WŁASNY próg — 5 odpowiedzi, ale 1 komentarz, to nadal jedna osoba', () => {
    const a = agregujJednostke(U1, 'Region Centrum', [
      odp(U1, 3, 'za dużo nadgodzin'), odp(U1, 4), odp(U1, 4), odp(U1, 5), odp(U1, 2),
    ])
    expect(a.averageScore).toBe(3.6)
    expect(a.commentCount).toBe(1)
    expect(a.comments).toEqual([])
  })

  it('komentarze wychodzą dopiero gdy jest ich co najmniej 5, w kolejności NIEZALEŻNEJ od zgłoszenia', () => {
    const a = agregujJednostke(U1, 'Region Centrum', [
      odp(U1, 3, 'ee'), odp(U1, 4, 'cc'), odp(U1, 4, 'aa'), odp(U1, 5, 'dd'), odp(U1, 2, 'bb'),
    ])
    expect(a.comments).toEqual(['aa', 'bb', 'cc', 'dd', 'ee'])
  })

  it('pusty i biały komentarz nie liczy się jako komentarz', () => {
    const a = agregujJednostke(U1, 'Region Centrum', [
      odp(U1, 3, '   '), odp(U1, 4, ''), odp(U1, 4), odp(U1, 5), odp(U1, 2),
    ])
    expect(a.commentCount).toBe(0)
  })

  it('jednostka bez ani jednej odpowiedzi jest widoczna jako 0/5, nie znika z listy', () => {
    const a = agregujJednostke(U2, 'Region Północ', [])
    expect(a.respondentCount).toBe(0)
    expect(a.suppressed).toBe(true)
    expect(a.averageScore).toBeNull()
  })

  it('średnia jest zaokrąglana do 2 miejsc (a nie do liczby całkowitej — 3.33 to nie 3)', () => {
    const a = agregujJednostke(U1, 'Region Centrum', [
      odp(U1, 1), odp(U1, 2), odp(U1, 3), odp(U1, 5), odp(U1, 5), odp(U1, 4),
    ])
    expect(a.averageScore).toBe(3.33)
  })

  it('[POPRAWKA F-18] uszkodzony wiersz spoza skali 1..5 nie produkuje NaN ani nie psuje średniej', () => {
    // Nieosiągalne przez API (DTO + serwis + CHECK), ale funkcja czysta broni się sama.
    const a = agregujJednostke(U1, 'Region Centrum', [
      odp(U1, 4), odp(U1, 4), odp(U1, 4), odp(U1, 4), odp(U1, 4), odp(U1, 99),
    ])
    expect(a.respondentCount).toBe(6)
    expect(a.averageScore).toBe(4)
    expect(Object.values(a.distribution!).some((v) => Number.isNaN(v))).toBe(false)
    expect(a.distribution).toEqual({ '1': 0, '2': 0, '3': 0, '4': 5, '5': 0 })
  })
})

describe('agregujWszystkie', () => {
  it('grupuje po jednostce i zwraca jednostki bez odpowiedzi też', () => {
    const wynik = agregujWszystkie(
      [
        { id: U1, name: 'Region Centrum' },
        { id: U2, name: 'Region Północ' },
      ],
      [odp(U1, 5), odp(U1, 5), odp(U1, 5), odp(U1, 5), odp(U1, 5), odp(U2, 1), odp(U2, 2)],
    )
    expect(wynik.map((j) => j.unitId)).toEqual([U1, U2])
    expect(wynik[0]!.averageScore).toBe(5)
    expect(wynik[1]!.averageScore).toBeNull()
    expect(wynik[1]!.respondentCount).toBe(2)
  })

  it('ŻADNA jednostka poniżej progu nie ma liczbowego wyniku — sprawdzane na całym wyniku', () => {
    const wynik = agregujWszystkie(
      [{ id: U1, name: 'A' }, { id: U2, name: 'B' }],
      [odp(U1, 4), odp(U2, 1), odp(U2, 1), odp(U2, 1), odp(U2, 1)],
    )
    for (const j of wynik) {
      if (j.respondentCount < MIN_ANONIMOWOSCI) {
        expect(j.averageScore).toBeNull()
        expect(j.distribution).toBeNull()
        expect(j.comments).toEqual([])
      }
    }
  })
})
```

- [ ] **Krok 2: Uruchom i ZOBACZ, że pada.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2\apps\tenant-runtime
npx jest src/ankieta/ankieta.agregacja.spec.ts
```

Oczekiwane:
```
FAIL src/ankieta/ankieta.agregacja.spec.ts
  ● Test suite failed to run
    Cannot find module './ankieta.agregacja.js' from 'src/ankieta/ankieta.agregacja.spec.ts'
```

- [ ] **Krok 3: Napisz implementację.** Utwórz `apps/tenant-runtime/src/ankieta/ankieta.agregacja.ts`:

```ts
import { MIN_ANONIMOWOSCI } from './ankieta.config.js'

/**
 * Agregacja odpowiedzi ankiety pulsowej — funkcja CZYSTA (bez Prismy, bez I/O), żeby próg
 * anonimowości dał się udowodnić testem jednostkowym, a nie „wyklikać" na ekranie.
 *
 * ZASADA NADRZĘDNA: poniżej progu nie wychodzi ŻADNA liczba opisująca wynik — `null`, nigdy `0`.
 * Zero czyta się jak „wszyscy dali najgorszą ocenę", a to jest wypowiedź o ludziach, której nie
 * mamy prawa zrobić z czterech odpowiedzi. Jedyną liczbą, która przechodzi zawsze, jest
 * `respondentCount` — frekwencja, nie wynik; bez niej ekran nie umie powiedzieć, ile jeszcze
 * brakuje, a menedżer nie odróżni „nikt nie odpowiedział" od „za mało, żeby pokazać".
 *
 * KOMENTARZE MAJĄ WŁASNY PRÓG. Pięć odpowiedzi anonimizuje średnią, ale jeżeli komentarz zostawiła
 * JEDNA osoba, to ten komentarz nadal jest wypowiedzią jednej możliwej do wskazania osoby — treść
 * i styl identyfikują skuteczniej niż liczba. Dlatego komentarze wychodzą dopiero, gdy jest ich co
 * najmniej `minAnonimowosci`, i są sortowane leksykograficznie: kolejność zgłoszenia zdradzałaby,
 * kto odpowiedział pierwszy.
 */

export interface OdpowiedzDoAgregacji {
  unitId: string
  score: number
  comment: string | null
}

export interface JednostkaDoAgregacji {
  id: string
  name: string
}

export type RozkladOcen = Record<'1' | '2' | '3' | '4' | '5', number>

export interface AgregatJednostki {
  unitId: string
  /** Nazwa jednostki organizacyjnej — nie jest daną osobową. */
  unitName: string
  /** Frekwencja. Jedyna liczba przechodząca również poniżej progu. */
  respondentCount: number
  /** Liczba niepustych komentarzy. Przechodzi zawsze; treści już nie. */
  commentCount: number
  /** `null` poniżej progu. */
  averageScore: number | null
  /** `null` poniżej progu. */
  distribution: RozkladOcen | null
  /** Pusta lista, dopóki komentarzy nie ma co najmniej `minAnonimowosci`. */
  comments: string[]
  /** `true`, gdy jednostka nie osiągnęła progu — ekran ma pokazać komunikat, nie liczbę. */
  suppressed: boolean
}

const pustyRozklad = (): RozkladOcen => ({ '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 })

const niepusty = (c: string | null): c is string => typeof c === 'string' && c.trim().length > 0

/** Agregat pojedynczej jednostki. `odpowiedzi` muszą już należeć do tej jednostki. */
export function agregujJednostke(
  unitId: string,
  unitName: string,
  odpowiedzi: OdpowiedzDoAgregacji[],
  minAnonimowosci: number = MIN_ANONIMOWOSCI,
): AgregatJednostki {
  const respondentCount = odpowiedzi.length
  const komentarze = odpowiedzi.map((o) => o.comment).filter(niepusty).map((c) => c.trim())
  const commentCount = komentarze.length

  const podProgiem = respondentCount < minAnonimowosci
  if (podProgiem) {
    return {
      unitId,
      unitName,
      respondentCount,
      commentCount,
      averageScore: null,
      distribution: null,
      comments: [],
      suppressed: true,
    }
  }

  // [POPRAWKA F-18] Ocena spoza 1..5 nie może wpaść do rozkładu jako `NaN`. Skala jest pilnowana w
  // trzech warstwach (DTO, serwis, CHECK w bazie), więc tu jest to nieosiągalne — ale funkcja CZYSTA
  // nie ma prawa produkować `NaN` przy żadnym wejściu, bo to jedyna rzecz, którą ten moduł pokazuje
  // menedżerowi. Wiersz spoza skali jest POMIJANY w całości (także w sumie), a nie wliczany do
  // średniej i gubiony w rozkładzie.
  const distribution = pustyRozklad()
  let suma = 0
  let policzone = 0
  for (const o of odpowiedzi) {
    const klucz = String(o.score) as keyof RozkladOcen
    if (!(klucz in distribution)) continue
    suma += o.score
    policzone += 1
    distribution[klucz] += 1
  }

  return {
    unitId,
    unitName,
    respondentCount,
    commentCount,
    // Dzielimy przez `policzone`, nie `respondentCount`: frekwencja liczy wszystkich respondentów,
    // średnia — tylko wiersze o poprawnej skali. Przy poprawnych danych obie liczby są równe.
    averageScore: policzone === 0 ? null : Math.round((suma / policzone) * 100) / 100,
    distribution,
    comments: commentCount >= minAnonimowosci ? [...komentarze].sort() : [],
    suppressed: false,
  }
}

/** Agregat dla listy jednostek. Jednostki bez odpowiedzi ZOSTAJĄ na liście (jako 0 / próg). */
export function agregujWszystkie(
  jednostki: JednostkaDoAgregacji[],
  odpowiedzi: OdpowiedzDoAgregacji[],
  minAnonimowosci: number = MIN_ANONIMOWOSCI,
): AgregatJednostki[] {
  const wgJednostki = new Map<string, OdpowiedzDoAgregacji[]>()
  for (const o of odpowiedzi) {
    const lista = wgJednostki.get(o.unitId) ?? []
    lista.push(o)
    wgJednostki.set(o.unitId, lista)
  }
  return jednostki.map((j) => agregujJednostke(j.id, j.name, wgJednostki.get(j.id) ?? [], minAnonimowosci))
}
```

- [ ] **Krok 4: Uruchom i zobacz zielone.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2\apps\tenant-runtime
npx jest src/ankieta
```

Oczekiwane:
```
PASS src/ankieta/ankieta.window.spec.ts
PASS src/ankieta/ankieta.agregacja.spec.ts
Tests:       17 passed, 17 total
```

- [ ] **Krok 5: Weryfikacja negatywna — cofnij próg i zobacz czerwone.** Zmień tymczasowo w `ankieta.agregacja.ts` warunek `respondentCount < minAnonimowosci` na `respondentCount < 1`, uruchom `npx jest src/ankieta/ankieta.agregacja.spec.ts`. Oczekiwane:

```
● agregujJednostke — próg anonimowości › poniżej progu nie zwraca ŻADNEJ wartości wyniku (null, nigdy 0)
  expect(received).toBe(expected)
  Expected: true
  Received: false
```

**`[POPRAWKA F-27]`** Przywróć przez `git checkout -- apps/tenant-runtime/src/ankieta/ankieta.agregacja.ts`, a potem `npx jest src/ankieta` i `git status --short apps/tenant-runtime/src/ankieta` — status MUSI być pusty. „Przywróć ręcznie" to jedyny krok w tym bloku, po którym w drzewie może zostać zmiana wprowadzona na chwilę; kontrola statusu zamyka tę furtkę.

- [ ] **Krok 6: Commit.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
git add apps/tenant-runtime/src/ankieta
git commit -m "feat(ankieta): agregacja jednostki z progiem anonimowosci 5 (10 testow, prog udowodniony)"
```

---

### Zadanie 4: Model danych i migracja

**Pliki:**
- Zmień: `packages/db/prisma/tenant/schema.prisma`
- Utwórz: `packages/db/prisma/tenant/migrations/20260812090000_ankieta_pulsowa/migration.sql`

- [ ] **Krok 1: Dodaj model `PulseSurveyResponse`.** W `packages/db/prisma/tenant/schema.prisma` dopisz **na końcu pliku**:

```prisma
// ---------------------------------------------------------------------------
// Moduł Ankieta (M3 b): ankieta pulsowa i analiza dobrostanu. Jedno pytanie
// 1–5 + opcjonalny komentarz, jedna odpowiedź na pracownika na tydzień ISO,
// agregacja WYŁĄCZNIE na poziomie jednostki z progiem 5 odpowiedzi.
//
// DOBROSTAN NIE WCHODZI DO `compositeScore`. `scoring.util.ts:100–108`
// renormalizuje wagi po wymiarach obecnych w oknie, więc piąty wymiar
// przeliczyłby wynik każdego z 39 pracowników — czyli liczby rozliczane w
// macierzy AN-1..AN-13 raportu KM3. To jest osobny sygnał obok, jak
// `retentionSignal`. Żadnej relacji do EmployeePerformanceSnapshot.
// ---------------------------------------------------------------------------

/// Jedna odpowiedź w ankiecie pulsowej. `unitId` jest DENORMALIZOWANY (jednostka z chwili
/// odpowiedzi) — dzięki temu agregat nigdy nie dołącza tabeli `employees`, więc na ścieżce odczytu
/// menedżera nie ma żadnego pola z danymi osobowymi do przypadkowego przepuszczenia, a przeniesienie
/// pracownika między jednostkami nie przepisuje historii dobrostanu.
model PulseSurveyResponse {
  id          String             @id @default(uuid())
  employeeId  String             @map("employee_id")
  employee    Employee           @relation("PulseResponseEmployee", fields: [employeeId], references: [id])
  unitId      String             @map("unit_id")
  unit        OrganizationalUnit @relation("PulseResponseUnit", fields: [unitId], references: [id])
  /// Poniedziałek tygodnia ISO (UTC) — klucz okna, patrz src/ankieta/ankieta.window.ts.
  windowStart DateTime           @map("window_start") @db.Date
  /// [POPRAWKA F-19] Niedziela tego samego tygodnia. ŻADNA ścieżka odczytu jej nie używa — `agregaty`
  /// filtruje po `windowStart`, bo to on jest kluczem unikalności. Trzymamy ją, żeby wiersz był
  /// samoopisujący się w bazie (raport SQL bez znajomości `pulseWindow()` widzi granice okna), i
  /// świadomie NIE budujemy na niej żadnej logiki.
  windowEnd   DateTime           @map("window_end")   @db.Date
  /// Skala 1..5. Walidowana w DTO i ponownie w serwisie (CHECK w migracji jest trzecią bramką).
  score       Int
  /// Opcjonalny. Jego brak nigdy nie blokuje agregacji.
  comment     String?
  submittedAt DateTime           @default(now()) @map("submitted_at")
  updatedAt   DateTime           @updatedAt @map("updated_at")

  /// „Raz na okno": druga odpowiedź AKTUALIZUJE tę samą, nie tworzy drugiej.
  @@unique([employeeId, windowStart])
  @@index([unitId, windowStart])
  @@map("pulse_survey_response")
}
```

- [ ] **Krok 2: Dopisz relacje zwrotne (Prisma ich wymaga).** W `packages/db/prisma/tenant/schema.prisma`, w modelu `Employee`, tuż przed `@@map("employees")` dodaj:

```prisma
  pulseResponses       PulseSurveyResponse[]         @relation("PulseResponseEmployee")
```

W modelu `OrganizationalUnit`, tuż przed `@@map("organizational_units")` dodaj:

```prisma
  pulseResponses PulseSurveyResponse[] @relation("PulseResponseUnit")
```

- [ ] **Krok 3: Napisz migrację ręcznie (wzorzec `20260721000000_dokumenty`).** Utwórz `packages/db/prisma/tenant/migrations/20260812090000_ankieta_pulsowa/migration.sql`:

```sql
-- Moduł Ankieta (M3 b, greenfield): ankieta pulsowa i analiza dobrostanu.
-- Wyłącznie ADDYTYWNA — jedna nowa tabela, dwa FK do istniejących employees/organizational_units.
-- Zero zmian w istniejących obiektach, w szczególności ZERO zmian w employee_performance_snapshot
-- i performance_config (compositeScore rozliczany w KM3, macierz AN-1..AN-13).
--
-- HAND-AUTHORED (brak osiągalnej bazy shadow z tego środowiska — DATABASE_URL nie jest ustawione,
-- `prisma migrate dev --create-only` kończy się P1012), w kształcie generowanym przez Prismę,
-- wzorem 20260721000000_dokumenty/migration.sql.
--
-- BRAMKA WDROŻENIOWA (nie uruchamiać stąd): sprawdzone w żywym najemcy — `_prisma_migrations`
-- zawiera tylko 6 z 13 migracji, reszta była wgrywana ręcznie przez psql. Ten plik idzie tą samą
-- drogą (Zadanie 11), a po wgraniu tabela należy do roli wgrywającej i MUSI zostać przepisana:
--   ALTER TABLE "pulse_survey_response" OWNER TO hu_900d948b;

-- CreateTable
CREATE TABLE "pulse_survey_response" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "window_start" DATE NOT NULL,
    "window_end" DATE NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pulse_survey_response_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- „Raz na okno" jest niezmiennikiem BAZY, nie tylko serwisu: `upsert` w AnkietaService opiera się
-- dokładnie na tym kluczu, a wyścig dwóch równoległych zapisów tego samego pracownika kończy się
-- P2002, a nie drugim wierszem.
CREATE UNIQUE INDEX "pulse_survey_response_employee_id_window_start_key" ON "pulse_survey_response"("employee_id", "window_start");

-- CreateIndex
CREATE INDEX "pulse_survey_response_unit_id_window_start_idx" ON "pulse_survey_response"("unit_id", "window_start");

-- AddForeignKey
ALTER TABLE "pulse_survey_response" ADD CONSTRAINT "pulse_survey_response_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pulse_survey_response" ADD CONSTRAINT "pulse_survey_response_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "organizational_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Trzecia bramka skali 1..5 (pierwsza: DTO class-validator, druga: AnkietaService). Skala jest
-- CAŁYM znaczeniem tej kolumny — wartość spoza niej nie jest „dziwną oceną", tylko uszkodzonym
-- rekordem, którego agregat po cichu wliczyłby do średniej.
ALTER TABLE "pulse_survey_response" ADD CONSTRAINT "pulse_survey_response_score_range" CHECK ("score" BETWEEN 1 AND 5);
```

- [ ] **Krok 4: Wygeneruj klienta i sprawdź, że model istnieje w typach.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
pnpm -C packages/db db:generate
Select-String -Path packages\db\generated\tenant\index.d.ts -Pattern "pulseSurveyResponse" | Select-Object -First 3
```

Oczekiwane: `Generated Prisma Client (v5.22.0) to .\generated\tenant` (dwukrotnie — control-plane i tenant), a `Select-String` zwraca co najmniej jedno trafienie `pulseSurveyResponse`.

- [ ] **Krok 5: Typecheck całego backendu (nic nie mogło się zepsuć od relacji zwrotnych).**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
pnpm -C apps/tenant-runtime typecheck
```

Oczekiwane: brak wyjścia, kod 0.

- [ ] **Krok 6: Commit.**

**`[POPRAWKA F-2]`** `packages/db/generated/` jest w `.gitignore` (linia 10) i **nie ma w gicie ani jednego pliku** — `git add packages/db/generated` kończy się błędem „The following paths are ignored by one of your .gitignore files". Ta ścieżka została z polecenia usunięta; klient Prismy jest artefaktem builda i każdy, kto pobierze tę gałąź, odtworzy go przez `pnpm -C packages/db db:generate`.

```
git add packages/db/prisma/tenant/schema.prisma packages/db/prisma/tenant/migrations/20260812090000_ankieta_pulsowa
git status --short packages/db
git commit -m "feat(db): model PulseSurveyResponse + migracja addytywna (bez zmian w employee_performance_snapshot)"
```

Oczekiwane z `git status --short packages/db`: dokładnie dwa wpisy `A`/`M` (schemat + katalog migracji) i **żadnego** wpisu z `generated/`.

---

### Zadanie 5: `AnkietaService` — zapis „raz na okno"

**Pliki:**
- Utwórz: `apps/tenant-runtime/src/ankieta/ankieta.service.ts`
- Test: `apps/tenant-runtime/src/ankieta/ankieta.service.spec.ts`

- [ ] **Krok 1: Napisz CZERWONY test zapisu.** Utwórz `apps/tenant-runtime/src/ankieta/ankieta.service.spec.ts`:

```ts
import { NotFoundException } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import type { TenantClient } from '@hrobot/db'
import { AnkietaService, type AnkietaActor } from './ankieta.service.js'

/** Mock klienta najemcy — wyłącznie delegaty, których dotyka AnkietaService (idiom `makeClient`
 *  z recommendation.service.spec.ts). Brak `employee.findMany` na ścieżce agregatów jest CELOWY:
 *  gdyby serwis kiedykolwiek sięgnął po kartotekę pracownika, test rzuciłby TypeError. */
function makeClient() {
  return {
    employee: { findFirst: jest.fn() },
    organizationalUnit: { findMany: jest.fn() },
    pulseSurveyResponse: { upsert: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
  }
}
type MockClient = ReturnType<typeof makeClient>
const asClient = (c: MockClient): TenantClient => c as unknown as TenantClient

const AKTOR: AnkietaActor = { userId: 'kc-sub-anna', roles: ['PRACOWNIK'], ipAddress: '10.0.0.1' }
const TERAZ = new Date('2026-07-15T11:24:00.000Z') // środa tygodnia demo 13–19.07

describe('AnkietaService.zapiszOdpowiedz', () => {
  let service: AnkietaService
  let client: MockClient

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({ providers: [AnkietaService] }).compile()
    service = module.get(AnkietaService)
    client = makeClient()
    client.employee.findFirst.mockResolvedValue({ id: 'emp-anna', unitId: 'unit-centrum' })
    client.pulseSurveyResponse.upsert.mockImplementation((args: { create: Record<string, unknown> }) =>
      Promise.resolve({ id: 'resp-1', ...args.create }),
    )
  })

  it('rozwiązuje pracownika po keycloakSub i zapisuje w oknie bieżącego tygodnia', async () => {
    await service.zapiszOdpowiedz(asClient(client), AKTOR, { score: 4, comment: 'ok' }, TERAZ)

    expect(client.employee.findFirst).toHaveBeenCalledWith({
      where: { user: { keycloakSub: 'kc-sub-anna' } },
      select: { id: true, unitId: true },
    })
    const args = client.pulseSurveyResponse.upsert.mock.calls[0]![0] as {
      where: { employeeId_windowStart: { employeeId: string; windowStart: Date } }
      create: Record<string, unknown>
      update: Record<string, unknown>
    }
    expect(args.where.employeeId_windowStart.employeeId).toBe('emp-anna')
    expect((args.where.employeeId_windowStart.windowStart as Date).toISOString()).toBe('2026-07-13T00:00:00.000Z')
    expect(args.create).toMatchObject({ employeeId: 'emp-anna', unitId: 'unit-centrum', score: 4, comment: 'ok' })
  })

  it('druga próba w tym samym oknie AKTUALIZUJE (upsert), nigdy nie tworzy drugiej odpowiedzi', async () => {
    await service.zapiszOdpowiedz(asClient(client), AKTOR, { score: 4 }, TERAZ)
    await service.zapiszOdpowiedz(asClient(client), AKTOR, { score: 2, comment: 'gorzej' }, TERAZ)

    expect(client.pulseSurveyResponse.upsert).toHaveBeenCalledTimes(2)
    // Ten sam klucz w obu wywołaniach → baza ma jeden wiersz.
    const k1 = client.pulseSurveyResponse.upsert.mock.calls[0]![0] as { where: unknown }
    const k2 = client.pulseSurveyResponse.upsert.mock.calls[1]![0] as { where: unknown }
    expect(JSON.stringify(k2.where)).toBe(JSON.stringify(k1.where))
    const drugi = client.pulseSurveyResponse.upsert.mock.calls[1]![0] as { update: Record<string, unknown> }
    expect(drugi.update).toEqual({ score: 2, comment: 'gorzej' })
    // Żadnego `create` z drugą odpowiedzią — `update` istnieje i jest niepuste.
    expect(Object.keys(drugi.update).length).toBeGreaterThan(0)
  })

  it('brak komentarza zapisuje null, a nie pusty napis', async () => {
    await service.zapiszOdpowiedz(asClient(client), AKTOR, { score: 5 }, TERAZ)
    const args = client.pulseSurveyResponse.upsert.mock.calls[0]![0] as { create: { comment: unknown } }
    expect(args.create.comment).toBeNull()
  })

  it('konto bez kartoteki pracownika dostaje 404, a nie 500', async () => {
    client.employee.findFirst.mockResolvedValue(null)
    await expect(service.zapiszOdpowiedz(asClient(client), AKTOR, { score: 3 }, TERAZ)).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })

  it('ocena spoza 1..5 jest odrzucana także w serwisie (DTO to nie jedyna bramka)', async () => {
    await expect(service.zapiszOdpowiedz(asClient(client), AKTOR, { score: 6 }, TERAZ)).rejects.toThrow(
      /skali 1..5/,
    )
    expect(client.pulseSurveyResponse.upsert).not.toHaveBeenCalled()
  })
})

describe('AnkietaService.mojaOdpowiedz', () => {
  let service: AnkietaService
  let client: MockClient

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({ providers: [AnkietaService] }).compile()
    service = module.get(AnkietaService)
    client = makeClient()
    client.employee.findFirst.mockResolvedValue({ id: 'emp-anna', unitId: 'unit-centrum' })
  })

  it('zwraca okno i pytanie nawet gdy pracownik jeszcze nie odpowiedział', async () => {
    client.pulseSurveyResponse.findUnique.mockResolvedValue(null)
    const out = (await service.mojaOdpowiedz(asClient(client), AKTOR, TERAZ)) as {
      window: { key: string }
      odpowiedz: unknown
    }
    expect(out.window.key).toBe('2026-07-13')
    expect(out.odpowiedz).toBeNull()
  })
})
```

- [ ] **Krok 2: Uruchom i ZOBACZ, że pada.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2\apps\tenant-runtime
npx jest src/ankieta/ankieta.service.spec.ts
```

Oczekiwane:
```
FAIL src/ankieta/ankieta.service.spec.ts
  ● Test suite failed to run
    Cannot find module './ankieta.service.js' from 'src/ankieta/ankieta.service.spec.ts'
```

- [ ] **Krok 3: Napisz serwis (bez metody `agregaty` — ta w Zadaniu 6).** Utwórz `apps/tenant-runtime/src/ankieta/ankieta.service.ts`:

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { MIN_ANONIMOWOSCI, PULSE_PYTANIE, PULSE_SCORE_MAX, PULSE_SCORE_MIN } from './ankieta.config.js'
import { pulseWindow, pulseWindowKey, type PulseWindow } from './ankieta.window.js'

/** Aktor projektowany z JWT + IP (wzorzec `LeaveActor` / `DokumentyActor`). */
export interface AnkietaActor {
  userId: string
  roles: string[]
  ipAddress: string
}

export interface ZapisOdpowiedziInput {
  score: number
  comment?: string
}

/**
 * PROJEKCJA WŁASNEJ ODPOWIEDZI. Jedyna ścieżka, która w ogóle zwraca treść pojedynczej odpowiedzi —
 * i tylko WŁASNEJ, rozwiązanej przez `keycloakSub`. Nie ma `employeeId`, bo odbiorcą jest ten sam
 * pracownik: identyfikator niczego mu nie mówi, a każde pole, którego tu nie ma, nie może wyciec.
 */
const MOJA_SELECT = {
  windowStart: true,
  windowEnd: true,
  score: true,
  comment: true,
  submittedAt: true,
  updatedAt: true,
} as const

/**
 * Ankieta pulsowa (M3 b). Serwis pilnuje trzech niezmienników:
 *
 *  1. JEDNA ODPOWIEDŹ NA OKNO — `upsert` po `@@unique([employeeId, windowStart])`; druga próba
 *     aktualizuje tę samą, nie tworzy drugiej.
 *  2. TOŻSAMOŚĆ TYLKO Z TOKENU — pracownik jest rozwiązywany przez `user.keycloakSub`, nigdy z
 *     ciała żądania, więc nie da się odpowiedzieć „za kogoś".
 *  3. AGREGAT NIE WIDZI OSÓB — patrz {@link AnkietaService.agregaty}.
 *
 * Dobrostan NIE dotyka `strategic-brain`: ten plik nie importuje z tamtego modułu niczego, a
 * `scoring-izolacja.spec.ts` sprawdza to strukturalnie.
 */
@Injectable()
export class AnkietaService {
  /** Kartoteka pracownika stojąca za tokenem. 404 zamiast 500, gdy konto nie ma kartoteki
   *  (regresja znana z `/moj-tydzien` — konto bez `Employee` nie może wywalać ekranu). */
  private async mojaKartoteka(client: TenantClient, actor: AnkietaActor): Promise<{ id: string; unitId: string }> {
    const me = (await client.employee.findFirst({
      where: { user: { keycloakSub: actor.userId } },
      select: { id: true, unitId: true },
    })) as { id: string; unitId: string } | null
    if (!me) throw new NotFoundException('Brak kartoteki pracownika dla zalogowanego konta')
    return me
  }

  /** Zapis (lub aktualizacja) odpowiedzi w oknie zawierającym `now`. */
  async zapiszOdpowiedz(
    client: TenantClient,
    actor: AnkietaActor,
    input: ZapisOdpowiedziInput,
    now: Date,
  ): Promise<unknown> {
    if (!Number.isInteger(input.score) || input.score < PULSE_SCORE_MIN || input.score > PULSE_SCORE_MAX) {
      throw new BadRequestException(`Ocena musi być liczbą całkowitą ze skali 1..5 (otrzymano ${input.score})`)
    }
    const me = await this.mojaKartoteka(client, actor)
    const window = pulseWindow(now)
    const comment = input.comment && input.comment.trim().length > 0 ? input.comment.trim() : null

    return client.pulseSurveyResponse.upsert({
      where: { employeeId_windowStart: { employeeId: me.id, windowStart: window.start } },
      update: { score: input.score, comment },
      create: {
        employeeId: me.id,
        unitId: me.unitId,
        windowStart: window.start,
        windowEnd: window.end,
        score: input.score,
        comment,
      },
      select: MOJA_SELECT,
    } as never)
  }

  /** Własna odpowiedź w bieżącym oknie (albo `null`) + metadane okna dla ekranu. */
  async mojaOdpowiedz(client: TenantClient, actor: AnkietaActor, now: Date): Promise<unknown> {
    const me = await this.mojaKartoteka(client, actor)
    const window = pulseWindow(now)
    const odpowiedz = await client.pulseSurveyResponse.findUnique({
      where: { employeeId_windowStart: { employeeId: me.id, windowStart: window.start } },
      select: MOJA_SELECT,
    } as never)
    return { window: this.opisOkna(window), pytanie: PULSE_PYTANIE, minAnonimowosci: MIN_ANONIMOWOSCI, odpowiedz }
  }

  protected opisOkna(window: PulseWindow): { start: string; end: string; key: string } {
    return {
      start: window.start.toISOString(),
      end: window.end.toISOString(),
      key: pulseWindowKey(window),
    }
  }
}
```

- [ ] **Krok 4: Uruchom i zobacz zielone.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2\apps\tenant-runtime
npx jest src/ankieta
```

Oczekiwane:
```
Tests:       23 passed, 23 total
```

- [ ] **Krok 5: Commit.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
git add apps/tenant-runtime/src/ankieta
git commit -m "feat(ankieta): AnkietaService — jedna odpowiedz na okno, tozsamosc wylacznie z tokenu"
```

---

### Zadanie 6: `AnkietaService.agregaty` — menedżer nie widzi pojedynczej osoby

**Pliki:**
- Zmień: `apps/tenant-runtime/src/ankieta/ankieta.service.ts`
- Test: `apps/tenant-runtime/src/ankieta/ankieta.rodo.spec.ts`

- [ ] **Krok 1: Napisz CZERWONY test RODO/agregatów.** Utwórz `apps/tenant-runtime/src/ankieta/ankieta.rodo.spec.ts`:

```ts
import { Test, type TestingModule } from '@nestjs/testing'
import type { TenantClient } from '@hrobot/db'
import { AnkietaService } from './ankieta.service.js'
import type { AnkietaActor } from './ankieta.service.js'
import type { AgregatJednostki } from './ankieta.agregacja.js'

function makeClient() {
  return {
    employee: { findFirst: jest.fn() },
    organizationalUnit: { findMany: jest.fn() },
    pulseSurveyResponse: { upsert: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
  }
}
type MockClient = ReturnType<typeof makeClient>
const asClient = (c: MockClient): TenantClient => c as unknown as TenantClient

const MENEDZER: AnkietaActor = { userId: 'kc-sub-manager', roles: ['MANAGER'], ipAddress: '10.0.0.2' }
const TERAZ = new Date('2026-07-15T11:24:00.000Z')

const U_CENTRUM = 'unit-centrum'
const U_POLNOC = 'unit-polnoc'

describe('AnkietaService.agregaty — granica RODO', () => {
  let service: AnkietaService
  let client: MockClient

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({ providers: [AnkietaService] }).compile()
    service = module.get(AnkietaService)
    client = makeClient()
    client.organizationalUnit.findMany.mockResolvedValue([
      { id: U_CENTRUM, name: 'Region Centrum' },
      { id: U_POLNOC, name: 'Region Północ' },
    ])
  })

  it('ZAPYTANIE do bazy nie prosi o employeeId ani o kartotekę — agregat nie ma czego wyciec', async () => {
    client.pulseSurveyResponse.findMany.mockResolvedValue([])
    await service.agregaty(asClient(client), null, TERAZ)

    const args = client.pulseSurveyResponse.findMany.mock.calls[0]![0] as { select: Record<string, unknown> }
    expect(Object.keys(args.select).sort()).toEqual(['comment', 'score', 'unitId'])
    expect(args.select).not.toHaveProperty('employeeId')
    expect(args.select).not.toHaveProperty('employee')
    // Kartoteka nie jest w ogóle czytana na tej ścieżce.
    expect(client.employee.findFirst).not.toHaveBeenCalled()
  })

  it('jednostka z 4 odpowiedziami nie zwraca ŻADNEJ liczby wyniku', async () => {
    client.pulseSurveyResponse.findMany.mockResolvedValue([
      { unitId: U_POLNOC, score: 1, comment: 'ciężko' },
      { unitId: U_POLNOC, score: 2, comment: null },
      { unitId: U_POLNOC, score: 1, comment: null },
      { unitId: U_POLNOC, score: 5, comment: null },
    ])
    const out = (await service.agregaty(asClient(client), null, TERAZ)) as { jednostki: AgregatJednostki[] }
    const polnoc = out.jednostki.find((j) => j.unitId === U_POLNOC)!
    expect(polnoc.respondentCount).toBe(4)
    expect(polnoc.suppressed).toBe(true)
    expect(polnoc.averageScore).toBeNull()
    expect(polnoc.distribution).toBeNull()
    expect(polnoc.comments).toEqual([])
  })

  it('w CAŁEJ odpowiedzi API nie ma ani jednego identyfikatora pracownika', async () => {
    client.pulseSurveyResponse.findMany.mockResolvedValue([
      { unitId: U_CENTRUM, score: 5, comment: 'super' },
      { unitId: U_CENTRUM, score: 4, comment: 'ok' },
      { unitId: U_CENTRUM, score: 4, comment: 'ok2' },
      { unitId: U_CENTRUM, score: 3, comment: 'ok3' },
      { unitId: U_CENTRUM, score: 2, comment: 'ok4' },
    ])
    const out = await service.agregaty(asClient(client), null, TERAZ)
    const json = JSON.stringify(out)
    expect(json).not.toMatch(/employeeId/i)
    expect(json).not.toMatch(/emp-/)
    expect(json).not.toMatch(/keycloak/i)
  })

  it('MANAGER dostaje wyłącznie swoje jednostki — zakres idzie do OBU zapytań', async () => {
    client.organizationalUnit.findMany.mockResolvedValue([{ id: U_POLNOC, name: 'Region Północ' }])
    client.pulseSurveyResponse.findMany.mockResolvedValue([])
    await service.agregaty(asClient(client), [U_POLNOC], TERAZ)

    const unitArgs = client.organizationalUnit.findMany.mock.calls[0]![0] as { where: unknown }
    expect(unitArgs.where).toEqual({ id: { in: [U_POLNOC] } })
    const respArgs = client.pulseSurveyResponse.findMany.mock.calls[0]![0] as { where: Record<string, unknown> }
    expect(respArgs.where.unitId).toEqual({ in: [U_POLNOC] })
  })

  it('pusty zakres MANAGERA zwraca zero jednostek, nigdy obejście do widoku globalnego', async () => {
    client.organizationalUnit.findMany.mockResolvedValue([])
    client.pulseSurveyResponse.findMany.mockResolvedValue([])
    const out = (await service.agregaty(asClient(client), [], TERAZ)) as { jednostki: AgregatJednostki[] }
    expect(out.jednostki).toEqual([])
  })

  it('serwis NIE udostępnia żadnej metody zwracającej cudzą pojedynczą odpowiedź', () => {
    const metody = Object.getOwnPropertyNames(AnkietaService.prototype)
    expect(metody.sort()).toEqual(['agregaty', 'constructor', 'mojaKartoteka', 'mojaOdpowiedz', 'opisOkna', 'zapiszOdpowiedz'])
  })
})
```

- [ ] **Krok 2: Uruchom i ZOBACZ, że pada.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2\apps\tenant-runtime
npx jest src/ankieta/ankieta.rodo.spec.ts
```

**`[POPRAWKA F-5]`** `apps/tenant-runtime/jest.config.cjs` **nie wyłącza diagnostyki ts-jest**, więc wywołanie nieistniejącej metody jest błędem KOMPILACJI, a nie runtime'u — suite w ogóle nie wystartuje i nie zobaczysz `TypeError`. Oczekiwane:

```
FAIL src/ankieta/ankieta.rodo.spec.ts
  ● Test suite failed to run
    src/ankieta/ankieta.rodo.spec.ts:NN:NN - error TS2339: Property 'agregaty' does not exist on type 'AnkietaService'.
```

To jest ten sam czerwony, o który chodzi (metody nie ma), tylko zgłoszony przez kompilator. Jeżeli zobaczysz `TypeError`, znaczy że ktoś dopisał `diagnostics: false` do konfiguracji jest — i to jest osobna regresja do zgłoszenia.

- [ ] **Krok 3: Dopisz metodę `agregaty` do serwisu.** W `apps/tenant-runtime/src/ankieta/ankieta.service.ts` dodaj import agregacji na górze:

```ts
import { agregujWszystkie, type AgregatJednostki } from './ankieta.agregacja.js'
```

i wstaw metodę **przed** `protected opisOkna(...)`:

```ts
  /**
   * Agregaty dobrostanu w bieżącym oknie, per jednostka.
   *
   * TO JEST GRANICA RODO MODUŁU i jest ona egzekwowana PROJEKCJĄ, nie filtrowaniem po fakcie:
   * `select` prosi bazę wyłącznie o `unitId`, `score` i `comment`. Serwis fizycznie nie dostaje
   * `employeeId`, więc nie ma czego zgubić po drodze do odpowiedzi — żaden przyszły refaktor
   * mapowania nie „odsłoni" pola, którego w wyniku zapytania nie ma. Kartoteka `employees` nie
   * jest tu czytana ani razu.
   *
   * `scopeUnitIds === null` = aktor GLOBALNY (HR/ADMIN, wzorzec `isGlobal` z rbac/unit-scope.ts);
   * tablica (również PUSTA) = MANAGER — pusta daje zero jednostek, nigdy obejście do widoku
   * całego najemcy.
   */
  async agregaty(
    client: TenantClient,
    scopeUnitIds: string[] | null,
    now: Date,
  ): Promise<{
    window: { start: string; end: string; key: string }
    pytanie: string
    minAnonimowosci: number
    jednostki: AgregatJednostki[]
  }> {
    const window = pulseWindow(now)

    const jednostkiWZakresie = (await client.organizationalUnit.findMany({
      where: scopeUnitIds === null ? {} : { id: { in: scopeUnitIds } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })) as Array<{ id: string; name: string }>

    const odpowiedzi = (await client.pulseSurveyResponse.findMany({
      where: {
        windowStart: window.start,
        ...(scopeUnitIds === null ? {} : { unitId: { in: scopeUnitIds } }),
      },
      select: { unitId: true, score: true, comment: true },
    } as never)) as Array<{ unitId: string; score: number; comment: string | null }>

    return {
      window: this.opisOkna(window),
      pytanie: PULSE_PYTANIE,
      minAnonimowosci: MIN_ANONIMOWOSCI,
      jednostki: agregujWszystkie(jednostkiWZakresie, odpowiedzi, MIN_ANONIMOWOSCI),
    }
  }
```

- [ ] **Krok 4: Uruchom i zobacz zielone.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2\apps\tenant-runtime
npx jest src/ankieta
```

Oczekiwane:
```
Tests:       29 passed, 29 total
```

- [ ] **Krok 5: Weryfikacja negatywna — dodaj `employeeId` do projekcji i zobacz czerwone.** Zmień tymczasowo `select: { unitId: true, score: true, comment: true }` na `select: { unitId: true, score: true, comment: true, employeeId: true }` i uruchom `npx jest src/ankieta/ankieta.rodo.spec.ts`. Oczekiwane:

```
● ... › ZAPYTANIE do bazy nie prosi o employeeId ani o kartotekę — agregat nie ma czego wyciec
  expect(received).toEqual(expected)
  - Expected  - 0
  + Received  + 1
      "comment",
  +   "employeeId",
      "score",
```

**`[POPRAWKA F-27]`** Cofnij przez `git checkout -- apps/tenant-runtime/src/ankieta/ankieta.service.ts`, uruchom `npx jest src/ankieta` i potwierdź pustym `git status --short apps/tenant-runtime/src/ankieta`.

- [ ] **Krok 6: Commit.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
git add apps/tenant-runtime/src/ankieta
git commit -m "feat(ankieta): agregaty per jednostka z projekcja bez employeeId (6 testow RODO)"
```

---

### Zadanie 7: Kontroler, DTO, moduł i rejestracja

**Pliki:**
- Utwórz: `apps/tenant-runtime/src/ankieta/dto/odpowiedz-ankiety.dto.ts`
- Utwórz: `apps/tenant-runtime/src/ankieta/ankieta.controller.ts`
- Utwórz: `apps/tenant-runtime/src/ankieta/ankieta.module.ts`
- Zmień: `apps/tenant-runtime/src/app.module.ts`
- Test: `apps/tenant-runtime/src/ankieta/ankieta.controller.spec.ts`

- [ ] **Krok 1: Napisz DTO.** Utwórz `apps/tenant-runtime/src/ankieta/dto/odpowiedz-ankiety.dto.ts`:

```ts
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { PULSE_COMMENT_MAX, PULSE_SCORE_MAX, PULSE_SCORE_MIN } from '../ankieta.config.js'

/**
 * Ciało `POST /ankieta/odpowiedz`. Świadomie NIE ma tu `employeeId` ani `unitId`: tożsamość
 * odpowiadającego bierze się wyłącznie z tokenu (`AnkietaService.mojaKartoteka`), więc nie istnieje
 * pole, którym dałoby się odpowiedzieć „za kogoś". Globalny `ValidationPipe({ whitelist: true })`
 * (main.ts:24) usuwa wszystko poza tymi dwoma polami.
 */
export class OdpowiedzAnkietyDto {
  @IsInt()
  @Min(PULSE_SCORE_MIN)
  @Max(PULSE_SCORE_MAX)
  score!: number

  @IsOptional()
  @IsString()
  @MaxLength(PULSE_COMMENT_MAX)
  comment?: string
}
```

- [ ] **Krok 2: Napisz CZERWONY test kontrolera.** Utwórz `apps/tenant-runtime/src/ankieta/ankieta.controller.spec.ts`:

```ts
import { Reflector } from '@nestjs/core'
import { Test, type TestingModule } from '@nestjs/testing'
import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { ROLES_KEY } from '../tenant-runtime/rbac/roles.decorator.js'
import { AnkietaController } from './ankieta.controller.js'
import { AnkietaService } from './ankieta.service.js'
import type { JwtPayload } from '../tenant-runtime/keycloak/keycloak-jwt.strategy.js'

/**
 * [POPRAWKA F-6] Metadane ról czytamy `Reflector`em, a nie `Reflect.getMetadata`.
 * Tak robi SZEŚĆ istniejących spec-ów kontrolerów w tym repo (`dokumenty`, `analityk`, `cost`,
 * `ai-grafik`, `agent-glosowy`, …) i żaden z nich nie importuje `reflect-metadata` — trzymamy się
 * idiomu, zamiast zakładać, że polyfill jest już załadowany.
 */
const rolesFor = (m: keyof AnkietaController): string[] =>
  new Reflector().get<string[]>(ROLES_KEY, AnkietaController.prototype[m] as (...a: unknown[]) => unknown) ?? []

const client = {} as TenantClient
const pracownik = { sub: 'kc-sub-anna', hrobot_roles: [Role.PRACOWNIK] } as unknown as JwtPayload
const hr = { sub: 'kc-sub-hr', hrobot_roles: [Role.HR] } as unknown as JwtPayload

describe('AnkietaController', () => {
  let controller: AnkietaController
  let service: { zapiszOdpowiedz: jest.Mock; mojaOdpowiedz: jest.Mock; agregaty: jest.Mock }

  beforeEach(async () => {
    service = { zapiszOdpowiedz: jest.fn(), mojaOdpowiedz: jest.fn(), agregaty: jest.fn() }
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnkietaController],
      providers: [{ provide: AnkietaService, useValue: service }],
    }).compile()
    controller = module.get(AnkietaController)
  })

  it('POST /ankieta/odpowiedz jest otwarty dla PRACOWNIKA (to on wypełnia ankietę)', () => {
    expect(rolesFor('odpowiedz')).toContain(Role.PRACOWNIK)
  })

  it('GET /ankieta/agregaty jest ZAMKNIĘTY dla PRACOWNIKA', () => {
    const role = rolesFor('agregaty')
    expect(role).not.toContain(Role.PRACOWNIK)
    expect(role).toEqual(expect.arrayContaining([Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA]))
  })

  it('HR/ADMIN idzie do serwisu z zakresem null (globalny), bez odpytywania o jednostki', async () => {
    await controller.agregaty(client, hr)
    expect(service.agregaty).toHaveBeenCalledWith(client, null, expect.any(Date))
  })

  it('zapis przekazuje aktora zbudowanego z JWT + IP, nie z ciała żądania', async () => {
    await controller.odpowiedz(client, pracownik, '10.0.0.1', { score: 4, comment: 'ok' })
    expect(service.zapiszOdpowiedz).toHaveBeenCalledWith(
      client,
      { userId: 'kc-sub-anna', roles: [Role.PRACOWNIK], ipAddress: '10.0.0.1' },
      { score: 4, comment: 'ok' },
      expect.any(Date),
    )
  })
})
```

- [ ] **Krok 3: Uruchom i ZOBACZ, że pada.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2\apps\tenant-runtime
npx jest src/ankieta/ankieta.controller.spec.ts
```

Oczekiwane:
```
● Test suite failed to run
  Cannot find module './ankieta.controller.js' from 'src/ankieta/ankieta.controller.spec.ts'
```

- [ ] **Krok 4: Napisz kontroler.** Utwórz `apps/tenant-runtime/src/ankieta/ankieta.controller.ts`:

```ts
import { Body, Controller, Get, Ip, Post } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { TenantRoute } from '../tenant-runtime/tenant-route.decorator.js'
import { Roles } from '../tenant-runtime/rbac/roles.decorator.js'
import { CurrentTenantClient, CurrentUser } from '../tenant-runtime/tenant-context/current-tenant-client.decorator.js'
import type { JwtPayload } from '../tenant-runtime/keycloak/keycloak-jwt.strategy.js'
import { isGlobal, managedUnitIds } from '../tenant-runtime/rbac/unit-scope.js'
import { AnkietaService, type AnkietaActor } from './ankieta.service.js'
import { OdpowiedzAnkietyDto } from './dto/odpowiedz-ankiety.dto.js'

/** Ankietę wypełnia KAŻDY zalogowany — łącznie z plain PRACOWNIKIEM; to on jest respondentem. */
const RESPONDENT_ROLES = [Role.PRACOWNIK, Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA] as const
/** Agregaty czyta kadra zarządzająca. PRACOWNIK celowo poza listą — nie ma tu nic o nim samym. */
const AGREGAT_ROLES = [Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA] as const

/**
 * Powierzchnia HTTP modułu `ankieta` (M3 b). CIENKI kontroler wzorem
 * `dokumenty.controller.ts` / `strategic-brain.controller.ts`: `@TenantRoute()` składa
 * KeycloakJwtGuard + RbacGuard + TenantContextInterceptor + AuditInterceptor, a cała logika siedzi
 * w {@link AnkietaService}.
 *
 * `AuditInterceptor` zapisuje POST-a do `audit_log` automatycznie — payload to zredagowane ciało
 * żądania, czyli `{ score, comment }` bez żadnego identyfikatora osoby poza `actorUserId`, który
 * audyt zapisuje z definicji dla każdej mutacji w systemie.
 *
 * Zakres MANAGERA jest rozstrzygany TUTAJ i wstrzykiwany do serwisu (wzorzec M16): `RbacGuard`
 * zna tylko gruboziarniste `hrobot_roles` i nic nie wie o jednostkach.
 */
@Controller('ankieta')
@TenantRoute()
export class AnkietaController {
  constructor(private readonly ankieta: AnkietaService) {}

  private actor(user: JwtPayload, ip: string): AnkietaActor {
    return { userId: user.sub, roles: user.hrobot_roles ?? [], ipAddress: ip }
  }

  /** `null` ⇒ aktor GLOBALNY (HR/ADMIN); inaczej jednostki, którymi zarządza MANAGER. */
  private async resolveScope(client: TenantClient, user: JwtPayload): Promise<string[] | null> {
    return isGlobal(user.hrobot_roles ?? []) ? null : managedUnitIds(client, user.sub)
  }

  @Post('odpowiedz')
  @Roles(...RESPONDENT_ROLES)
  async odpowiedz(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Body() dto: OdpowiedzAnkietyDto,
  ): Promise<unknown> {
    return this.ankieta.zapiszOdpowiedz(client, this.actor(user, ip), dto, new Date())
  }

  @Get('moja')
  @Roles(...RESPONDENT_ROLES)
  async moja(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ): Promise<unknown> {
    return this.ankieta.mojaOdpowiedz(client, this.actor(user, ip), new Date())
  }

  // [POPRAWKA F-20] Bez `@Ip()`: `AuditInterceptor` nie audytuje GET-ów, a `AnkietaActor` nie jest tu
  // budowany, więc parametr byłby martwy i zapaliłby lint na nieużywanej zmiennej.
  @Get('agregaty')
  @Roles(...AGREGAT_ROLES)
  async agregaty(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
  ): Promise<unknown> {
    const scope = await this.resolveScope(client, user)
    return this.ankieta.agregaty(client, scope, new Date())
  }
}
```

- [ ] **Krok 5: Napisz moduł i zarejestruj go.** Utwórz `apps/tenant-runtime/src/ankieta/ankieta.module.ts`:

```ts
import { Module } from '@nestjs/common'
import { AnkietaController } from './ankieta.controller.js'
import { AnkietaService } from './ankieta.service.js'

/**
 * Moduł `ankieta` (M3 b). Bez `imports`: `AuditService` i `RbacGuard` pochodzą z `@Global()`
 * `TenantRuntimeModule`, a klient najemcy wstrzykuje `@CurrentTenantClient`. Brak `EncryptionService`
 * jest CELOWY — ten moduł nie dotyka żadnego pola szyfrowanego (ani PESEL, ani adresu).
 *
 * Zero powiązania ze `StrategicBrainModule`: dobrostan jest sygnałem OBOK wyniku, nie w nim.
 */
@Module({
  controllers: [AnkietaController],
  providers: [AnkietaService],
})
export class AnkietaModule {}
```

W `apps/tenant-runtime/src/app.module.ts` dodaj import obok pozostałych modułów M3:

```ts
import { AnkietaModule } from './ankieta/ankieta.module.js'
```

i wpis w tablicy `imports`, bezpośrednio po `AnalitykModule,`:

```ts
    // Blok F (M3 b) — ankieta pulsowa i analiza dobrostanu. Bez tej linii POST /api/ankieta/odpowiedz
    // nie jest osiągalne, mimo że kod istnieje (ta sama pułapka, co z ZastepstwaModule niżej).
    AnkietaModule,
```

- [ ] **Krok 6: Uruchom testy i typecheck.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2\apps\tenant-runtime
npx jest src/ankieta
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
pnpm -C apps/tenant-runtime typecheck
```

Oczekiwane: `Tests: 33 passed, 33 total`, typecheck bez wyjścia. **`[POPRAWKA]`** liczby testów w całym bloku są o 1–2 wyższe niż w wersji surowej, bo recenzja dołożyła test odporności agregacji (F-18) i test niepustości strażnika izolacji (F-1).

- [ ] **Krok 7: Commit.**

```
git add apps/tenant-runtime/src/ankieta apps/tenant-runtime/src/app.module.ts
git commit -m "feat(ankieta): kontroler + DTO + modul, PRACOWNIK odpowiada, agregaty tylko dla kadry"
```

---

### Zadanie 8: Dowód liczbowy — `compositeScore` 39 pracowników nietknięty

To zadanie realizuje **wymóg krytyczny**. Dwie nogi: fixture 122 wierszy z żywej bazy przepuszczony przez REALNĄ ścieżkę odczytu (`SnapshotService.overview`) oraz strukturalna izolacja modułów.

**Pliki:**
- Zmień: `scripts/composite-score-baseline.mjs` (tryb `--fixture`)
- Utwórz: `apps/tenant-runtime/src/ankieta/__fixtures__/km3-snapshots-39.json`
- Utwórz: `apps/tenant-runtime/src/ankieta/composite-score-nietkniety.spec.ts`
- Utwórz: `apps/tenant-runtime/src/ankieta/scoring-izolacja.spec.ts`

- [ ] **Krok 1: Dopisz tryb `--fixture` do skryptu.** W `scripts/composite-score-baseline.mjs` wstaw funkcję przed blokiem `const [tryb, ...args]`:

```js
/** Fixture do testu hermetycznego: WSZYSTKIE kolumny, które czyta `SnapshotService`, dla wszystkich
 *  122 wierszy. Dzięki temu test regresyjny odtwarza ścieżkę odczytu bez bazy — a więc chodzi w CI,
 *  a nie tylko na maszynie ze stojącym dockerem. */
function fixture(sciezka) {
  const rows = psqlRows(
    'SELECT employee_id, window_start::date, window_end::date, throughput, peer_group_key, ' +
      "coalesce(sla_hit_rate::text,'NULL'), coalesce(defect_rate::text,'NULL'), " +
      "coalesce(composite_score::text,'NULL'), coalesce(development_slope::text,'NULL'), " +
      "confidence::text, is_new_hire, coalesce(excluded_reason,'NULL') " +
      'FROM employee_performance_snapshot ORDER BY employee_id, window_start;',
  )
  const nz = (v) => (v === 'NULL' ? null : Number(v))
  const doc = rows.map((r) => ({
    employeeId: r[0],
    windowStart: `${r[1]}T00:00:00.000Z`,
    windowEnd: `${r[2]}T00:00:00.000Z`,
    throughput: Number(r[3]),
    peerGroupKey: r[4],
    slaHitRate: nz(r[5]),
    defectRate: nz(r[6]),
    compositeScore: nz(r[7]),
    developmentSlope: nz(r[8]),
    confidence: Number(r[9]),
    isNewHire: r[10] === 't',
    excludedReason: r[11] === 'NULL' ? null : r[11],
  }))
  mkdirSync(dirname(sciezka), { recursive: true })
  writeFileSync(sciezka, JSON.stringify(doc, null, 2) + '\n', 'utf8')
  console.log(`✓ ${sciezka}: ${doc.length} wierszy, ${new Set(doc.map((d) => d.employeeId)).size} pracowników`)
}
```

i dopisz gałąź w rozgałęzieniu trybów, przed `else {`:

```js
else if (tryb === '--fixture' && args[0]) fixture(args[0])
```

- [ ] **Krok 2: Wygeneruj fixture z żywej bazy.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
node scripts/composite-score-baseline.mjs --fixture apps/tenant-runtime/src/ankieta/__fixtures__/km3-snapshots-39.json
```

Oczekiwane:
```
✓ apps/tenant-runtime/src/ankieta/__fixtures__/km3-snapshots-39.json: 122 wierszy, 39 pracowników
```

- [ ] **Krok 3: Napisz test regresyjny (odtworzenie ścieżki odczytu).** Utwórz `apps/tenant-runtime/src/ankieta/composite-score-nietkniety.spec.ts`:

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Test, type TestingModule } from '@nestjs/testing'
import type { TenantClient } from '@hrobot/db'
import { SnapshotService } from '../strategic-brain/snapshot.service.js'
import { PerformanceConfigService } from '../strategic-brain/performance-config.service.js'

/**
 * WYMÓG KRYTYCZNY BLOKU F: `compositeScore` wszystkich 39 pracowników jest identyczny przed i po
 * wdrożeniu ankiety pulsowej.
 *
 * DLACZEGO TEN TEST WYGLĄDA TAK, A NIE INACZEJ. Naturalny pomysł — „przepuść dane przez
 * `RecommendationService.finalizeWindow` przed i po" — jest NIEWYKONALNY na tych danych, i to nie
 * z powodu bloku F: wartości `composite_score` w żywym najemcy są ZASIANE, nie policzone przez
 * silnik (`scripts/seed-demo-strategic-brain-peers.sql:18`: „WARTOSCI SA AUTORSKIE, NIE
 * POLICZONE"). Potwierdza to sam rozkład — 39 pracowników i tylko 19 różnych wyników w oknie.
 * Uruchomienie silnika wyprodukowałoby inne liczby niż te rozliczane w KM3 już DZIŚ, przed
 * jakąkolwiek zmianą, więc taki test nie mierzyłby bloku F.
 *
 * Mierzymy więc to, co faktycznie jest rozliczane: 39 liczb, które ŚCIEŻKA ODCZYTU
 * (`SnapshotService.overview` — feed ekranu `/analiza` i macierzy AN-1..AN-13) zwraca dla
 * zarejestrowanych danych. Fixture to zrzut 1:1 ze `hrobot_t_900d948b` (122 wiersze).
 *
 * [POPRAWKA F-3] CO TEN TEST PRZYPINA, A CZEGO NIE — bo pierwotna wersja tego komentarza obiecywała
 * więcej, niż test robi, a to zdanie idzie do macierzy pokrycia dla PARP.
 *
 *   PRZYPINA: regułę „najnowsze okno na pracownika", projekcję `toHeatCell` (nazwy pól, konwersję
 *   `Number()`, politykę null), liczbę 39 wierszy wynikowych i zawartość fixture'u. Każde z nich
 *   zmieniłoby liczby na ekranie `/analiza`, więc jest warte strażnika.
 *
 *   NIE PRZYPINA: samego silnika. `SnapshotService.overview` NIE liczy `compositeScore` — czyta
 *   zapisaną kolumnę `composite_score` i przepisuje ją przez `Number()`. Zmiana wag w
 *   `performance-config.service.ts` albo funkcji `compositeScore()` w `scoring.util.ts` tego testu
 *   NIE zapali. Za to odpowiada `scoring.util.spec.ts` (istniejący) i strażnik strukturalny
 *   `scoring-izolacja.spec.ts`.
 *
 * DOWODEM LICZBOWYM WYMOGU KRYTYCZNEGO jest więc `scripts/composite-score-baseline.mjs --compare`
 * (Zadania 1 i 11): TEKSTOWE, bez tolerancji, porównanie kolumny `composite_score` wszystkich 122
 * wierszy w żywej bazie przed i po wdrożeniu, z kotwicami 39/1558 przerywającymi porównanie dwóch
 * różnych zbiorów danych. Ten spec jest jego uzupełnieniem, nie zamiennikiem.
 */

interface FixtureRow {
  employeeId: string
  windowStart: string
  windowEnd: string
  throughput: number
  peerGroupKey: string
  slaHitRate: number | null
  defectRate: number | null
  compositeScore: number | null
  developmentSlope: number | null
  confidence: number
  isNewHire: boolean
  excludedReason: string | null
}

const FIXTURE = path.join(__dirname, '__fixtures__', 'km3-snapshots-39.json')
const rows: FixtureRow[] = JSON.parse(readFileSync(FIXTURE, 'utf8'))

const toRow = (r: FixtureRow) => ({ ...r, windowStart: new Date(r.windowStart), windowEnd: new Date(r.windowEnd) })

function makeClient() {
  const employeeIds = [...new Set(rows.map((r) => r.employeeId))]
  return {
    employee: { findMany: jest.fn().mockResolvedValue(employeeIds.map((id) => ({ id }))) },
    employeePerformanceSnapshot: {
      findMany: jest
        .fn()
        .mockResolvedValue(rows.map(toRow).sort((a, b) => b.windowEnd.getTime() - a.windowEnd.getTime())),
    },
    // Brak wiersza konfiguracji — dokładnie jak w żywym najemcy (`performance_config` jest pusta),
    // więc obowiązuje syntetyczna domyślna z performance-config.service.ts. Zmiana którejkolwiek
    // wagi w tamtym pliku zapali ten test.
    performanceConfig: { findFirst: jest.fn().mockResolvedValue(null) },
  }
}

describe('KM3 · compositeScore 39 pracowników — nietknięty przez blok F', () => {
  let snapshots: SnapshotService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SnapshotService, PerformanceConfigService],
    }).compile()
    snapshots = module.get(SnapshotService)
  })

  it('fixture trzyma kotwice KM3: 122 wiersze, 39 pracowników', () => {
    expect(rows).toHaveLength(122)
    expect(new Set(rows.map((r) => r.employeeId)).size).toBe(39)
  })

  it('ścieżka odczytu zwraca DOKŁADNIE zarejestrowane wyniki dla każdego z 39 pracowników', async () => {
    const cells = (await snapshots.overview(makeClient() as unknown as TenantClient, null)) as Array<{
      employeeId: string
      compositeScore: number | null
    }>

    expect(cells).toHaveLength(39)

    // Oczekiwane = wynik z NAJNOWSZEGO okna każdego pracownika (ta sama reguła, którą stosuje
    // `overview`), wzięty wprost z fixture'u.
    const oczekiwane = new Map<string, number | null>()
    for (const r of [...rows].sort((a, b) => a.windowEnd.localeCompare(b.windowEnd))) {
      oczekiwane.set(r.employeeId, r.compositeScore)
    }

    const rozjazdy = cells
      .filter((c) => c.compositeScore !== oczekiwane.get(c.employeeId))
      .map((c) => `${c.employeeId}: ${String(oczekiwane.get(c.employeeId))} -> ${String(c.compositeScore)}`)

    expect(rozjazdy).toEqual([])
  })

  it('żaden z 39 wyników nie jest null — inaczej test przeszedłby na pustych danych', () => {
    const najnowsze = new Map<string, number | null>()
    for (const r of [...rows].sort((a, b) => a.windowEnd.localeCompare(b.windowEnd))) {
      najnowsze.set(r.employeeId, r.compositeScore)
    }
    expect([...najnowsze.values()].filter((v) => v === null)).toEqual([])
  })
})
```

- [ ] **Krok 4: Napisz test izolacji strukturalnej.** Utwórz `apps/tenant-runtime/src/ankieta/scoring-izolacja.spec.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { MIN_ANONIMOWOSCI } from './ankieta.config.js'

/**
 * STRAŻNIK ARCHITEKTONICZNY bloku F, rodzeństwo `composite-score-nietkniety.spec.ts`.
 *
 * Tamten test mierzy LICZBY. Ten pilnuje KSZTAŁTU: dobrostan ma zostać sygnałem OBOK wyniku i nie
 * ma prawa wejść do `compositeScore` ani dziś, ani przy kolejnym refaktorze. Czyta prawdziwe pliki
 * źródłowe — tym samym idiomem, co `lib/api-gate.test.ts` i `lib/middleware-matcher.test.ts` w
 * apps/web — więc nie da się go uśpić przepisując asercję.
 */

const SRC = path.join(__dirname, '..')
const SCORING = path.join(SRC, 'strategic-brain', 'scoring.util.ts')
const PERF_CONFIG = path.join(SRC, 'strategic-brain', 'performance-config.service.ts')

/**
 * [POPRAWKA F-1] WYKRYWAMY KRAWĘDZIE IMPORTU, NIE WYSTĄPIENIA NAPISU.
 *
 * Wersja surowa tego testu szukała literału `strategic-brain` w treści plików — i padała na TRZECH
 * plikach produkcyjnych, które ten sam plan każe napisać (`ankieta.config.ts`, `ankieta.service.ts`,
 * `ankieta.controller.ts` mają ten napis w komentarzach wyjaśniających, PO CO ta izolacja istnieje).
 * Test, który zabrania opisania własnej decyzji architektonicznej, wymusza usunięcie komentarza — czyli
 * zjada dokładnie to, czego pilnuje. Sprawdzamy więc `import`/`require` wskazujące na tamten katalog:
 * to jest realna zależność, a nie zdanie w komentarzu.
 */
const IMPORT_STRATEGIC_BRAIN = /(?:from|require\()\s*['"][^'"]*strategic-brain[^'"]*['"]/

/** Testy, którym WOLNO importować strategic-brain — bo ich zadaniem jest go zmierzyć. */
const WYJATKI = ['composite-score-nietkniety.spec.ts', 'scoring-izolacja.spec.ts']

function pliki(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? pliki(path.join(dir, e.name)) : [path.join(dir, e.name)],
  )
}

describe('Blok F · izolacja od silnika oceny rozliczanego w KM3', () => {
  it('ScoreDimensions ma DOKŁADNIE 4 wymiary — piąty przeliczyłby wynik każdego z 39 pracowników', () => {
    const src = readFileSync(SCORING, 'utf8')
    const blok = /export type ScoreDimensions = \{([\s\S]*?)\n\}/.exec(src)
    expect(blok).not.toBeNull()
    const klucze = [...blok![1]!.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]).sort()
    expect(klucze).toEqual(['development', 'performance', 'quality', 'timeliness'])
  })

  it('ScoreWeights ma dokładnie te same 4 klucze co ScoreDimensions', () => {
    const src = readFileSync(SCORING, 'utf8')
    const blok = /export type ScoreWeights = \{([\s\S]*?)\n\}/.exec(src)
    expect(blok).not.toBeNull()
    const klucze = [...blok![1]!.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]).sort()
    expect(klucze).toEqual(['development', 'performance', 'quality', 'timeliness'])
  })

  it('żaden plik strategic-brain nie wie o istnieniu ankiety ani dobrostanu', () => {
    const winne = pliki(path.join(SRC, 'strategic-brain'))
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => /ankiet|dobrostan|wellbeing|pulse/i.test(readFileSync(f, 'utf8')))
      .map((f) => path.basename(f))
    expect(winne).toEqual([])
  })

  it('produkcyjne pliki ankiety nie IMPORTUJĄ ze strategic-brain', () => {
    const winne = pliki(__dirname)
      .filter((f) => f.endsWith('.ts') && !WYJATKI.includes(path.basename(f)))
      .filter((f) => IMPORT_STRATEGIC_BRAIN.test(readFileSync(f, 'utf8')))
      .map((f) => path.basename(f))
    expect(winne).toEqual([])
  })

  it('[POPRAWKA F-1] strażnik faktycznie coś wykrywa — nie jest asercją pustą', () => {
    // Gdyby regex przestał działać, test wyżej przechodziłby zawsze i nic nie pilnował.
    expect(IMPORT_STRATEGIC_BRAIN.test("import { X } from '../strategic-brain/scoring.util.js'")).toBe(true)
    expect(IMPORT_STRATEGIC_BRAIN.test('// dobrostan nie dotyka strategic-brain')).toBe(false)
  })

  it('próg anonimowości ankiety = minPeerGroupSize domyślnej konfiguracji ocen (jedna liczba, dwa moduły)', () => {
    const src = readFileSync(PERF_CONFIG, 'utf8')
    const m = /minPeerGroupSize:\s*(\d+),/.exec(src)
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBe(MIN_ANONIMOWOSCI)
  })
})
```

- [ ] **Krok 5: Uruchom obie nogi i zobacz zielone.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2\apps\tenant-runtime
npx jest src/ankieta
```

Oczekiwane:
```
PASS src/ankieta/composite-score-nietkniety.spec.ts
PASS src/ankieta/scoring-izolacja.spec.ts
Tests:       42 passed, 42 total
```

- [ ] **Krok 6: Weryfikacja negatywna — dodaj piąty wymiar i zobacz strażnika strukturalnego na czerwono.**

**`[POPRAWKA F-17]`** Wersja surowa zapowiadała „OBIE nogi na czerwono", ale pokazywała wyłącznie awarie strażnika strukturalnego — i słusznie, bo **test liczbowy się NIE zapali**: dopisanie piątego wymiaru do TYPU nie zmienia wartości `composite_score` już zapisanych w bazie, a `overview` je tylko przepisuje (patrz komentarz w `composite-score-nietkniety.spec.ts`). Tę weryfikację robimy więc w dwóch osobnych, uczciwych podejściach.

**6a. Strażnik strukturalny (to jest właściwa weryfikacja negatywna tego zadania).** W `apps/tenant-runtime/src/strategic-brain/scoring.util.ts` dopisz tymczasowo do `ScoreDimensions` linię `  wellbeing: number | null`, a w `performance-config.service.ts` w `defaultConfig` dopisz `weightWellbeing: 0.1`. Uruchom `npx jest src/ankieta/scoring-izolacja.spec.ts`. Oczekiwane:

```
● Blok F · izolacja od silnika oceny rozliczanego w KM3 › ScoreDimensions ma DOKŁADNIE 4 wymiary ...
  - Expected  - 0
  + Received  + 1
      "timeliness",
  +   "wellbeing",
● Blok F · izolacja ... › ScoreWeights ma dokładnie te same 4 klucze co ScoreDimensions
```

(Drugi test pada dlatego, że `ScoreWeights` ma teraz inny zestaw kluczy niż `ScoreDimensions` — czyli dokładnie ten rozjazd, który cichy refaktor by wprowadził. **Nie dopisuj** `wellbeing` do `ScoreWeights`: to wywoła kaskadę błędów kompilacji w całym `strategic-brain` i zamiast czytelnego czerwonego dostaniesz kilkanaście suite'ów „failed to run".)

**6b. Weryfikacja negatywna testu liczbowego — osobna i inna.** Podmień jedną wartość w fixture i sprawdź, że test wskaże ją z nazwy:

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
Copy-Item apps\tenant-runtime\src\ankieta\__fixtures__\km3-snapshots-39.json "$env:TEMP\fx.bak"
(Get-Content apps\tenant-runtime\src\ankieta\__fixtures__\km3-snapshots-39.json -Raw) -replace '"compositeScore": 83', '"compositeScore": 84' | Set-Content -Encoding utf8 apps\tenant-runtime\src\ankieta\__fixtures__\km3-snapshots-39.json
cd apps\tenant-runtime; npx jest src/ankieta/composite-score-nietkniety.spec.ts
```

Oczekiwane: test „ścieżka odczytu zwraca DOKŁADNIE zarejestrowane wyniki" **czerwony**, z listą rozjazdów zawierającą co najmniej jeden wiersz `<uuid>: 84 -> 83`. Przywróć fixture: `Copy-Item "$env:TEMP\fx.bak" apps\tenant-runtime\src\ankieta\__fixtures__\km3-snapshots-39.json -Force` i potwierdź zielone.

- [ ] **Krok 6c: Cofnij OBIE weryfikacje negatywne i potwierdź czysty stan.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
git checkout -- apps/tenant-runtime/src/strategic-brain/
git checkout -- apps/tenant-runtime/src/ankieta/__fixtures__/
git status --short apps/tenant-runtime/src/strategic-brain apps/tenant-runtime/src/ankieta/__fixtures__
Remove-Item "$env:TEMP\fx.bak" -ErrorAction SilentlyContinue
cd apps\tenant-runtime; npx jest src/ankieta
```

Oczekiwane: `git status --short` **nic nie wypisuje** dla obu ścieżek (fixture wraca do stanu z Kroku 2, `strategic-brain` jest nietknięty), a jest daje `42 passed`. **`[POPRAWKA F-17]`** Wersja surowa mówiła „cofnij WSZYSTKIE trzy zmiany", ale trzecia (`wellbeing` w `ScoreWeights`) została z Kroku 6a usunięta jako szkodliwa — i nie obejmowała podmiany fixture'u, która w wersji poprawionej jest osobną weryfikacją negatywną.

- [ ] **Krok 7: Commit.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
git status --short apps/tenant-runtime/src/strategic-brain
git add scripts/composite-score-baseline.mjs apps/tenant-runtime/src/ankieta
git commit -m "test(km3): dowod liczbowy — compositeScore 39 pracownikow nietkniety + izolacja strukturalna"
```

`git status --short` MUSI nie pokazać nic w `strategic-brain` — to potwierdzenie, że weryfikacja negatywna została cofnięta w całości.

---

### Zadanie 9: Front — klient BFF, trasa proxy, bramka sesji

**Pliki:**
- Utwórz: `apps/web/lib/ankieta.ts`
- Test: `apps/web/lib/ankieta.test.ts`
- Utwórz: `apps/web/app/api/ankieta/[[...path]]/route.ts`
- Zmień: `apps/web/middleware.ts`

- [ ] **Krok 1: Napisz CZERWONY test klienta.** Utwórz `apps/web/lib/ankieta.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { etykietaWyniku, komunikatProgu, type AgregatJednostki } from './ankieta'

const jed = (over: Partial<AgregatJednostki>): AgregatJednostki => ({
  unitId: 'u1',
  unitName: 'Region Centrum',
  respondentCount: 0,
  commentCount: 0,
  averageScore: null,
  distribution: null,
  comments: [],
  suppressed: true,
  ...over,
})

describe('etykietaWyniku', () => {
  it('powyżej progu pokazuje średnią z dwoma miejscami', () => {
    expect(etykietaWyniku(jed({ suppressed: false, averageScore: 3.6, respondentCount: 7 }))).toBe('3,60')
  })

  it('poniżej progu NIGDY nie renderuje liczby wyniku', () => {
    expect(etykietaWyniku(jed({ respondentCount: 4 }))).toBe('—')
  })

  it('zero odpowiedzi też daje kreskę, nie „0,00"', () => {
    expect(etykietaWyniku(jed({ respondentCount: 0 }))).toBe('—')
  })

  it('gdyby backend przysłał liczbę mimo suppressed, ekran i tak jej nie pokaże', () => {
    // Obrona w głąb: ekran nie ufa backendowi w kwestii progu, tylko sam go egzekwuje.
    expect(etykietaWyniku(jed({ suppressed: true, averageScore: 4.2, respondentCount: 2 }))).toBe('—')
  })
})

describe('komunikatProgu', () => {
  it('mówi wprost, ile odpowiedzi jest i ile trzeba', () => {
    expect(komunikatProgu(jed({ respondentCount: 3 }), 5)).toBe('Za mało odpowiedzi, żeby pokazać wynik (3 z 5).')
  })

  it('nie generuje komunikatu dla jednostki powyżej progu', () => {
    expect(komunikatProgu(jed({ suppressed: false, respondentCount: 8, averageScore: 4 }), 5)).toBeNull()
  })
})
```

- [ ] **Krok 2: Uruchom i ZOBACZ, że pada.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2\apps\web
npx vitest run lib/ankieta.test.ts
```

Oczekiwane:
```
FAIL  lib/ankieta.test.ts [ lib/ankieta.test.ts ]
Error: Failed to load url ./ankieta (resolved id: ./ankieta) in .../lib/ankieta.test.ts
```

- [ ] **Krok 3: Napisz klient.** Utwórz `apps/web/lib/ankieta.ts`:

```ts
/**
 * Ankieta pulsowa (M3 b) — model kliencki dla web-kitu.
 *
 * NA ŻYWO: `ankietaApi` rozmawia z REALNYM tenant-runtime przez same-origin proxy `/api/ankieta/*`
 * (app/api/ankieta/[[...path]] + lib/tenant-runtime.ts). Wzorzec z lib/dokumenty.ts: cienki
 * `ankietaFetch` + `AnkietaError` z upstreamowym statusem, a CZYSTE kalkulatory prezentacji
 * eksportowane osobno, żeby ekran i testy jednostkowe miały jedno źródło prawdy.
 *
 * PRÓG ANONIMOWOŚCI JEST EGZEKWOWANY DWA RAZY. Backend nigdy nie wysyła liczby dla jednostki
 * poniżej progu (`AnkietaService.agregaty`), a {@link etykietaWyniku} i tak nie narysuje liczby,
 * gdy `suppressed` jest ustawione. To nie jest nadmiarowość: gdyby kiedyś ktoś poluzował projekcję
 * po stronie serwera, ekran nadal nie pokaże wyniku dwóch osób.
 */

export interface AgregatJednostki {
  unitId: string
  unitName: string
  respondentCount: number
  commentCount: number
  averageScore: number | null
  distribution: Record<'1' | '2' | '3' | '4' | '5', number> | null
  comments: string[]
  suppressed: boolean
}

export interface AgregatyOdpowiedz {
  window: { start: string; end: string; key: string }
  pytanie: string
  minAnonimowosci: number
  jednostki: AgregatJednostki[]
}

export interface MojaOdpowiedz {
  window: { start: string; end: string; key: string }
  pytanie: string
  minAnonimowosci: number
  /**
   * [POPRAWKA F-24] Pola muszą odpowiadać `MOJA_SELECT` w `ankieta.service.ts` — wersja surowa gubiła
   * `windowStart`/`windowEnd`, więc typ-lustro nie był lustrem. Ekran ich nie używa (okno bierze z
   * `window`), ale typ ma opisywać to, co przychodzi z sieci, a nie to, co akurat renderujemy.
   */
  odpowiedz: {
    windowStart: string
    windowEnd: string
    score: number
    comment: string | null
    submittedAt: string
    updatedAt: string
  } | null
}

export class AnkietaError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'AnkietaError'
  }
}

async function ankietaFetch<T>(sciezka: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/ankieta${sciezka}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) throw new AnkietaError(`Ankieta: ${res.status}`, res.status)
  return (await res.json()) as T
}

export const ankietaApi = {
  moja: (): Promise<MojaOdpowiedz> => ankietaFetch<MojaOdpowiedz>('/moja'),
  agregaty: (): Promise<AgregatyOdpowiedz> => ankietaFetch<AgregatyOdpowiedz>('/agregaty'),
  odpowiedz: (score: number, comment?: string): Promise<unknown> =>
    ankietaFetch('/odpowiedz', { method: 'POST', body: JSON.stringify({ score, comment }) }),
}

/** Wynik jednostki do wyświetlenia. `—` zawsze, gdy próg nieosiągnięty — nigdy „0,00". */
export function etykietaWyniku(j: AgregatJednostki): string {
  if (j.suppressed || j.averageScore === null) return '—'
  return j.averageScore.toFixed(2).replace('.', ',')
}

/** Komunikat pokazywany ZAMIAST wyniku, albo `null` gdy wynik wolno pokazać. */
export function komunikatProgu(j: AgregatJednostki, min: number): string | null {
  if (!j.suppressed) return null
  return `Za mało odpowiedzi, żeby pokazać wynik (${j.respondentCount} z ${min}).`
}
```

- [ ] **Krok 4: Napisz trasę proxy.** Utwórz `apps/web/app/api/ankieta/[[...path]]/route.ts`:

```ts
// REAL proxy dla ankiety pulsowej: /api/ankieta[/<x>] → ${TENANT_RUNTIME_URL}/ankieta[/<x>].
// Obsługuje moja/agregaty/odpowiedz jednym handlerem, wzorem app/api/dokumenty/[[...path]].
// Opcjonalny catch-all, żeby również gołe `/api/ankieta` się dopasowało.
//
// Trasa jest ZAMKNIĘTA domyślnie: matcher `/api/:path*` w middleware.ts obejmuje ją bez żadnego
// dodatkowego wpisu, a `PUBLICZNE_API` (lib/api-gate.ts) jej NIE wymienia — i wymieniać nie może,
// bo agregaty dobrostanu to dane o ludziach. Strażnik parytetu lib/api-gate.test.ts to pilnuje.

import { joinBackendPath, proxyToTenantRuntime } from '@/lib/tenant-runtime'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ path?: string[] }> }

async function handle(req: Request, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params
  const search = new URL(req.url).search
  return proxyToTenantRuntime(req, joinBackendPath('ankieta', path ?? []), search)
}

export const GET = handle
export const POST = handle
```

- [ ] **Krok 5: `[POPRAWKA F-9]` Dopisz nową trasę BFF do strażnika `CHRONIONE`.**

Blok E robi dokładnie to samo dla swojej trasy (Zadanie 8 Krok 8). Bez tego wpisu `/api/ankieta` jest jedyną trasą BFF bez dowodu 401 w zestawie, który `pnpm test:security` i Zał. 6 zliczają. W `apps/web/lib/middleware-api-gate.test.ts` zamień ostatni element tablicy `CHRONIONE` (`  '/api/voice/transcribe',`) na:

```ts
  '/api/voice/transcribe',
  // Blok F (M3 b) — agregaty dobrostanu i własna odpowiedź pracownika. To są dane o ludziach; trasa
  // musi być zamknięta domyślnie tak samo jak /api/dokumenty czy /api/analityk.
  '/api/ankieta/moja',
  '/api/ankieta/agregaty',
```

- [ ] **Krok 6: Uruchom testy frontu — WSZYSTKO ma być zielone.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2\apps\web
npx vitest run lib/ankieta.test.ts lib/api-gate.test.ts lib/middleware-api-gate.test.ts lib/middleware-matcher.test.ts
```

Oczekiwane: `lib/ankieta.test.ts` zielony (6 testów), `lib/api-gate.test.ts` zielony (nowa trasa jest zamknięta domyślnie, a asercja inwentarza to `>= 17`, więc się nie zapali), `lib/middleware-api-gate.test.ts` zielony o **dwa testy więcej**, `lib/middleware-matcher.test.ts` zielony.

**`[POPRAWKA F-13]`** Wpis `'/ankieta/:path*'` do `middleware.ts` **przeniesiony do Zadania 10**, razem z ekranem. Wersja surowa dodawała go tutaj, świadomie zostawiała `middleware-matcher.test.ts` na czerwono i **commitowała ten stan**. Prognoza czerwonego była trafna (sprawdziłem: zapaliłby się test „every matcher entry points at a route that actually exists"), ale commit z czerwonym testem w historii to fałszywy alarm przy każdym `git bisect` i przy każdym przebiegu CI na tym commicie. Wpis do matchera i ekran, który go uzasadnia, lądują jednym commitem.

- [ ] **Krok 7: Commit (bez `middleware.ts` — ten idzie z ekranem).**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
git add apps/web/lib/ankieta.ts apps/web/lib/ankieta.test.ts "apps/web/app/api/ankieta" apps/web/lib/middleware-api-gate.test.ts
git commit -m "feat(web): klient ankiety + proxy BFF /api/ankieta (trasa zamknieta domyslnie, wpis w CHRONIONE)"
```

> **BRAMKA KOLEJNOŚCI (patrz Ustalenie 7).** Ten commit czyni `/api/ankieta` **19. trasą BFF**. Jeżeli blok A już wylądował, natychmiast po tym commicie zapalą się jego strażniki inwentarza (`api-gate.security.test.ts`, `scripts/bff-routes.test.mjs`, sumy `test:security`) i **Zał. 6 będzie drukował inwentarz, którego już nie ma**. Rekomendacja: blok F (jak blok E) **przed** blokiem A.

---

### Zadanie 10: Ekran ankiety, nawigacja, E2E

**Pliki:**
- Utwórz: `apps/web/app/(tenant)/ankieta/page.tsx`
- Utwórz: `apps/web/components/ankieta/ankieta-screen.tsx`
- Utwórz: `apps/web/components/ankieta/agregaty-screen.tsx`
- Zmień: `apps/web/lib/nav.ts`
- Utwórz: `apps/web/e2e/ankieta-prog-anonimowosci.spec.ts`

- [ ] **Krok 1: Napisz formularz pracownika.** Utwórz `apps/web/components/ankieta/ankieta-screen.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { ankietaApi, type MojaOdpowiedz } from '@/lib/ankieta'

/**
 * Formularz respondenta: JEDNO pytanie 1–5 + opcjonalny komentarz. Druga wysyłka w tym samym
 * tygodniu AKTUALIZUJE odpowiedź (backend robi upsert po `(employeeId, windowStart)`), dlatego
 * przycisk zmienia treść na „Zaktualizuj odpowiedź", gdy odpowiedź już istnieje — inaczej
 * użytkownik nie wiedziałby, że nie tworzy drugiej.
 */
export function AnkietaScreen() {
  const [stan, setStan] = useState<MojaOdpowiedz | null>(null)
  const [score, setScore] = useState<number | null>(null)
  const [comment, setComment] = useState('')
  const [zapisuje, setZapisuje] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)

  const wczytaj = () => {
    ankietaApi
      .moja()
      .then((m) => {
        setStan(m)
        setScore(m.odpowiedz?.score ?? null)
        setComment(m.odpowiedz?.comment ?? '')
      })
      .catch(() => setBlad('Nie udało się wczytać ankiety.'))
  }

  useEffect(wczytaj, [])

  const wyslij = async () => {
    if (score === null) return
    setZapisuje(true)
    setBlad(null)
    try {
      await ankietaApi.odpowiedz(score, comment.trim() || undefined)
      wczytaj()
    } catch {
      setBlad('Nie udało się zapisać odpowiedzi.')
    } finally {
      setZapisuje(false)
    }
  }

  if (blad) return <p className="text-[15px] text-muted">{blad}</p>
  if (!stan) return <p className="text-[15px] text-muted">Wczytywanie…</p>

  return (
    <div className="rounded-2xl border border-line bg-white p-6">
      <p className="text-[15px] font-semibold text-navy">{stan.pytanie}</p>
      <p className="mt-1 text-[13px] text-muted">Tydzień {stan.window.key}. Odpowiadasz raz w tygodniu.</p>

      <div className="mt-4 flex gap-2" role="radiogroup" aria-label={stan.pytanie}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={score === n}
            onClick={() => setScore(n)}
            className={`h-11 w-11 rounded-xl border text-[15px] font-semibold ${
              score === n ? 'border-navy bg-navy text-white' : 'border-line text-navy'
            }`}
          >
            {n}
          </button>
        ))}
      </div>

      <label className="mt-4 block text-[13px] text-muted" htmlFor="ankieta-komentarz">
        Komentarz (opcjonalny)
      </label>
      <textarea
        id="ankieta-komentarz"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        maxLength={500}
        rows={3}
        className="mt-1 w-full rounded-xl border border-line p-3 text-[15px]"
      />

      <button
        type="button"
        disabled={score === null || zapisuje}
        onClick={wyslij}
        className="mt-4 rounded-xl bg-navy px-5 py-2.5 text-[15px] font-semibold text-white disabled:opacity-40"
      >
        {stan.odpowiedz ? 'Zaktualizuj odpowiedź' : 'Wyślij odpowiedź'}
      </button>

      {stan.odpowiedz ? (
        <p className="mt-3 text-[13px] text-muted">
          Twoja odpowiedź w tym tygodniu jest już zapisana. Wysłanie ponownie ją nadpisze — nie powstanie druga.
        </p>
      ) : null}

      {/*
        [POPRAWKA D-1] TREŚĆ TEGO AKAPITU ZALEŻY OD DECYZJI PRODUKTOWEJ.
        Wersja surowa obiecywała: „Nikt — łącznie z Twoim przełożonym — nie zobaczy Twojej pojedynczej
        oceny ani komentarza". Zmierzone: `AuditInterceptor` zapisuje ciało każdego POST-a do
        `audit_log`, a `SENSITIVE_KEYS` w `audit.interceptor.ts` to
        `pesel, password, passwordhash, token, accesstoken, refreshtoken, secret, ssn, identifier` —
        BEZ `comment`. Komentarz trafia więc jawnie do tabeli append-only, obok `actorUserId`.
        Wobec przełożonego i wobec każdej ścieżki produktowej zdanie jest prawdziwe; wobec
        administratora bazy — nie. Poniższa wersja mówi dokładnie to, co system robi. Jeżeli
        właściciel produktu / IOD wybierze wariant (a) lub (b) z sekcji „Decyzje przed startem",
        wróć tu i uprość ten akapit do wersji pierwotnej.
      */}
      <p className="mt-4 text-[13px] text-muted">
        Wyniki są pokazywane wyłącznie zbiorczo, na poziomie jednostki, i dopiero od{' '}
        {stan.minAnonimowosci} odpowiedzi. Twój przełożony nie zobaczy Twojej pojedynczej oceny ani
        komentarza — ani na ekranie, ani przez API. Sama treść odpowiedzi jest, jak każda zmiana
        danych w systemie, zapisywana w dzienniku audytu dostępnym administratorowi.
      </p>
    </div>
  )
}
```

- [ ] **Krok 2: Napisz widok agregatów.** Utwórz `apps/web/components/ankieta/agregaty-screen.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { ankietaApi, etykietaWyniku, komunikatProgu, type AgregatyOdpowiedz } from '@/lib/ankieta'

/**
 * Widok kadry: jeden wiersz na jednostkę. Jednostka poniżej progu pokazuje KOMUNIKAT, nigdy liczbę
 * — a decyzję o tym podejmuje `etykietaWyniku`/`komunikatProgu` z lib/ankieta.ts, przetestowane
 * jednostkowo w lib/ankieta.test.ts. Ten komponent nie liczy niczego sam.
 */
export function AgregatyScreen() {
  const [dane, setDane] = useState<AgregatyOdpowiedz | null>(null)
  const [blad, setBlad] = useState<string | null>(null)

  useEffect(() => {
    ankietaApi
      .agregaty()
      .then(setDane)
      .catch(() => setBlad('Nie udało się wczytać agregatów.'))
  }, [])

  if (blad) return <p className="text-[15px] text-muted">{blad}</p>
  if (!dane) return <p className="text-[15px] text-muted">Wczytywanie…</p>

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted">
        Tydzień {dane.window.key}. Próg anonimowości: {dane.minAnonimowosci} odpowiedzi w jednostce.
      </p>
      {dane.jednostki.map((j) => {
        const komunikat = komunikatProgu(j, dane.minAnonimowosci)
        return (
          <div key={j.unitId} className="rounded-2xl border border-line bg-white p-5">
            <div className="flex items-baseline justify-between">
              <span className="text-[15px] font-semibold text-navy">{j.unitName}</span>
              <span className="font-display text-2xl font-extrabold text-navy">{etykietaWyniku(j)}</span>
            </div>
            <p className="mt-1 text-[13px] text-muted">
              {komunikat ?? `${j.respondentCount} odpowiedzi · ${j.commentCount} komentarzy`}
            </p>
            {j.comments.length > 0 ? (
              <ul className="mt-3 space-y-1 text-[13px] text-navy">
                {j.comments.map((c, i) => (
                  <li key={i}>„{c}"</li>
                ))}
              </ul>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Krok 3: Napisz stronę.** Utwórz `apps/web/app/(tenant)/ankieta/page.tsx`:

```tsx
import { AppShell } from '@/components/layout/app-shell'
import { AnkietaScreen } from '@/components/ankieta/ankieta-screen'
import { AgregatyScreen } from '@/components/ankieta/agregaty-screen'
import type { Role } from '@/lib/nav'
import { getTenant } from '@/lib/tenant'
import { getSession } from '@/lib/session'

/**
 * Ankieta pulsowa i analiza dobrostanu (M3 b). Serwerowa powłoka wzorem
 * app/(tenant)/dokumenty/page.tsx: tożsamość z `getSession`, AppShell, obie sekcje.
 *
 * KAŻDA rola widzi formularz — kierownik też jest pracownikiem i też odpowiada. Agregaty widzi
 * wyłącznie kadra; realne wymuszenie jest serwerowe (`@Roles` na `AnkietaController.agregaty` +
 * zakres jednostek w `AnkietaService.agregaty`), to tutaj jest tylko układ ekranu.
 */
export default async function AnkietaPage() {
  const session = await getSession()
  const tenant = await getTenant()
  const user = session?.user ?? { name: 'Użytkownik', role: '—', initials: '?' }
  const roles: Role[] = session?.roles ?? []
  const firstName = user.name.split(' ')[0]
  const widziAgregaty = roles.some((r) => r === 'MANAGER' || r === 'HR' || r === 'ADMIN_KLIENTA')

  return (
    <AppShell activeHref="/ankieta" title="Dobrostan" tenant={tenant} user={user} roles={roles}>
      <div className="mx-auto max-w-[1120px]">
        <h1 className="font-display text-3xl font-extrabold leading-tight tracking-tighter2 text-navy">
          Ankieta <span className="text-accent-ink">pulsowa</span>
        </h1>
        <p className="mt-2 max-w-[62ch] text-[15px] text-muted">
          {firstName}, jedno pytanie w tygodniu. Wyniki są liczone wyłącznie zbiorczo — dobrostan jest
          osobnym sygnałem i nie wpływa na ocenę wydajności ani na wynik zbiorczy w module rozwoju.
        </p>

        <div className="mt-6">
          <AnkietaScreen />
        </div>

        {widziAgregaty ? (
          <div className="mt-10">
            <h2 className="font-display text-xl font-extrabold text-navy">Dobrostan jednostek</h2>
            <div className="mt-4">
              <AgregatyScreen />
            </div>
          </div>
        ) : null}
      </div>
    </AppShell>
  )
}
```

- [ ] **Krok 3a: `[POPRAWKA F-13]` Dodaj ekran do bramki sesji (przeniesione z Zadania 9 Krok 5).** W `apps/web/middleware.ts`, w tablicy `matcher`, tuż po wpisie `'/analiza/:path*',` dodaj:

```ts
    // Ankieta pulsowa (M3 b) — pracownik zostawia tu ocenę samopoczucia, menedżer czyta agregaty
    // swoich jednostek. Bez tego wpisu ekran renderowałby pełny AppShell anonimowi, dokładnie tak,
    // jak zdarzyło się to wcześniej trzem modułom M3 (patrz komentarz przy /dokumenty).
    '/ankieta/:path*',
```

Ten wpis i katalog `app/(tenant)/ankieta/` z Kroku 3 muszą powstać **w jednym commicie** — `lib/middleware-matcher.test.ts` pilnuje parytetu w obie strony, więc każdy z nich osobno daje czerwony.

- [ ] **Krok 4: Dodaj pozycję do nawigacji.** W `apps/web/lib/nav.ts`, w grupie `Moduły HR`, tuż po wpisie `Asystent`, dodaj:

```ts
      // Ankieta pulsowa / dobrostan (M3 b). BEZ ograniczenia ról: formularz jest dla każdego (także
      // MANAGER i HR są pracownikami i odpowiadają), a sekcję agregatów strona pokazuje dopiero
      // kadrze — realny zakres egzekwuje `@Roles` na AnkietaController.agregaty, nie to menu.
      { label: 'Dobrostan', href: '/ankieta', icon: IconHeart },
```

**`[POPRAWKA F-20]`** Wersja surowa użyła `IconMessageCircle`, który **już nosi pozycja „Asystent"** w tej samej grupie menu — dwa sąsiadujące wpisy z identycznym glifem. Jeżeli `IconHeart` nie istnieje w `apps/web/components/icons.tsx`, dopisz go tam obok pozostałych (ten sam kształt `(p: IconProps) => (…)`, `stroke="currentColor"`, `viewBox="0 0 24 24"`) — to jeden mały komponent SVG, nie zależność.

- [ ] **Krok 5: Uruchom strażników parytetu — teraz muszą być zielone.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2\apps\web
npx vitest run
```

Oczekiwane: wszystkie pliki zielone, w tym `lib/middleware-matcher.test.ts` (wpis `ankieta` ma teraz swój katalog `app/(tenant)/ankieta`) i `lib/api-gate.test.ts` (nowa trasa jest zamknięta domyślnie).

- [ ] **Krok 6: Napisz E2E progu anonimowości.** Utwórz `apps/web/e2e/ankieta-prog-anonimowosci.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

/**
 * Blok F (M3 b) na żywym stacku. Sprawdza dokładnie dwie rzeczy, których test jednostkowy nie
 * dosięgnie: że pracownik może odpowiedzieć z menu, i że menedżer NIE widzi na ekranie liczby dla
 * jednostki poniżej progu.
 *
 *   E2E_BASE_URL=http://localhost:8080 npx playwright test e2e/ankieta-prog-anonimowosci.spec.ts
 */

async function zaloguj(page: import('@playwright/test').Page, login: string, pw: string) {
  await page.context().clearCookies()
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.locator('input[name="login"]').fill(login)
  await page.locator('input[name="pw"]').fill(pw)
  await page.getByRole('button', { name: /Zaloguj/i }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 })
}

test('PRACOWNIK dochodzi do ankiety z menu i zapisuje odpowiedź', async ({ page }) => {
  test.setTimeout(180_000)
  await zaloguj(page, 'pracownik.demo', 'Pracownik!2026')

  const pozycja = page.locator('a[href="/ankieta"]')
  await expect(pozycja, 'PRACOWNIK nie widzi pozycji „Dobrostan" w nawigacji').toHaveCount(1)
  await pozycja.click()
  await page.waitForURL(/\/ankieta/, { timeout: 20_000 })

  await expect(page.getByRole('heading', { name: /Ankieta/i }).first()).toBeVisible({ timeout: 30_000 })
  await page.getByRole('radio', { name: '4' }).click()
  await page.getByRole('button', { name: /Wyślij odpowiedź|Zaktualizuj odpowiedź/ }).click()

  await expect(page.getByText(/Twoja odpowiedź w tym tygodniu jest już zapisana/)).toBeVisible({ timeout: 20_000 })

  // Nie ma sekcji agregatów — PRACOWNIK nie ogląda dobrostanu jednostek.
  await expect(page.getByRole('heading', { name: /Dobrostan jednostek/ })).toHaveCount(0)
})

/**
 * [POPRAWKA F-12 / D-2] CO MENEDŻER FAKTYCZNIE WIDZI — zmierzone w `user_roles` żywego najemcy.
 *
 * `manager.demo` ma rolę MANAGER wyłącznie na `Region Centrum` i `4Mobility — Operacje`.
 * `managedUnitIds` zwraca dokładnie te dwie jednostki, więc `Region Północ` (gdzie seed sadzi stan
 * „3 z 5") NIE POJAWI SIĘ na jego ekranie w ogóle. Wersja surowa asertowała `\(\d z 5\)` i
 * przechodziła — ale trafiając w „0 z 5" pustej jednostki `4Mobility — Operacje`, czyli mierząc coś
 * innego, niż deklarowała. Rozdzielamy to na dwie asercje mówiące prawdę:
 *   - MANAGER: jedna jednostka z wynikiem (Centrum) + jedna pusta z „0 z 5";
 *   - ADMIN (`demo`): widzi wszystkie cztery jednostki, więc to TAM demonstrujemy stan „3 z 5".
 */
test('MANAGER: jednostka poniżej progu pokazuje komunikat, nigdy liczbę', async ({ page }) => {
  test.setTimeout(180_000)
  await zaloguj(page, 'manager.demo', 'Manager!2026')
  await page.goto('/ankieta', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: /Dobrostan jednostek/ })).toBeVisible({ timeout: 30_000 })

  const tresc = await page.locator('main').innerText()

  // Zakres MANAGERA to dokładnie te dwie jednostki — nic więcej nie ma prawa się pokazać.
  expect(tresc).toContain('Region Centrum')
  expect(tresc).toContain('4Mobility')
  expect(tresc, 'MANAGER widzi jednostkę spoza swojego zakresu').not.toContain('Region Północ')
  expect(tresc, 'MANAGER widzi jednostkę spoza swojego zakresu').not.toContain('Region Południe')

  // Jednostka bez odpowiedzi: komunikat, nigdy „0,00".
  expect(tresc).toMatch(/Za mało odpowiedzi, żeby pokazać wynik \(0 z 5\)\./)

  // Twarda granica: na ekranie menedżera nie może paść ani jedno nazwisko respondenta.
  // (Wszystkie cztery nazwiska istnieją w kartotece — sprawdzone — więc asercja nie jest pusta.)
  for (const nazwisko of ['Kowalska', 'Zając', 'Adamczyk', 'Lewandowska']) {
    expect(tresc, `wyciek: menedżer widzi nazwisko respondenta (${nazwisko})`).not.toContain(nazwisko)
  }
})

test('ADMIN: stan „za mało odpowiedzi" dla jednostki z 3 odpowiedziami — bez żadnej liczby wyniku', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const haslo = process.env.DEMO_ADMIN_PASSWORD
  test.skip(!haslo, 'Ustaw DEMO_ADMIN_PASSWORD, żeby zademonstrować stan podprogowy na koncie ADMIN.')
  await zaloguj(page, 'demo', haslo!)
  await page.goto('/ankieta', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: /Dobrostan jednostek/ })).toBeVisible({ timeout: 30_000 })

  const tresc = await page.locator('main').innerText()
  // ADMIN jest globalny: cztery jednostki, w tym Północ z dokładnie trzema odpowiedziami.
  expect(tresc).toContain('Region Północ')
  expect(tresc).toMatch(/Za mało odpowiedzi, żeby pokazać wynik \(3 z 5\)\./)
  for (const nazwisko of ['Kowalska', 'Zając', 'Adamczyk', 'Lewandowska']) {
    expect(tresc, `wyciek: ADMIN widzi nazwisko respondenta (${nazwisko})`).not.toContain(nazwisko)
  }
})
```

- [ ] **Krok 7: Commit (E2E uruchomimy w Zadaniu 11, po wdrożeniu i zasianiu danych).**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2\apps\web
npx vitest run
npx tsc --noEmit -p tsconfig.json
npm run lint
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
git add "apps/web/app/(tenant)/ankieta" apps/web/components/ankieta apps/web/components/icons.tsx apps/web/lib/nav.ts apps/web/middleware.ts apps/web/e2e/ankieta-prog-anonimowosci.spec.ts
git commit -m "feat(web): ekran ankiety pulsowej + agregaty jednostek + pozycja Dobrostan w menu + bramka sesji /ankieta"
```

**`[POPRAWKA F-13/F-22]`** `middleware.ts` jest **w tym** commicie (nie w Zadaniu 9), więc żaden commit w historii nie ma czerwonego `middleware-matcher.test.ts`. Dodany też `lint` — wersja surowa nie uruchamiała go ani razu w całym bloku.

---

### Zadanie 11: Wdrożenie na żywy stack, seed demo i zrzut „po"

**Pliki:**
- Utwórz: `scripts/seed-demo-ankieta.sql`
- Utwórz: `docs/raport-km3/evidence/composite-baseline-po.json` (wygenerowany, commitowany)

- [ ] **Krok 1: Napisz seed demo.** Utwórz `scripts/seed-demo-ankieta.sql`:

```sql
-- ============================================================================================
-- Demo bloku F (M3 b): odpowiedzi ankiety pulsowej pokazujące WSZYSTKIE TRZY stany progu.
--
--   Region Centrum       → 8 odpowiedzi, 6 komentarzy → wynik i komentarze WIDOCZNE
--   Region Północ        → 3 odpowiedzi               → komunikat „za mało odpowiedzi (3 z 5)"
--   Region Południe      → 0 odpowiedzi               → komunikat „za mało odpowiedzi (0 z 5)"
--   4Mobility — Operacje → 0 pracowników              → komunikat „za mało odpowiedzi (0 z 5)"
--
-- KTO CO WIDZI (zmierzone w `user_roles`, nie założone):
--   manager.demo ma MANAGER na `Region Centrum` + `4Mobility — Operacje` → zobaczy wynik Centrum i
--   „0 z 5" dla pustej jednostki. Stanu „3 z 5" (Region Północ) NIE zobaczy — ten demonstrujemy na
--   koncie `demo` (ADMIN), które jest globalne. Patrz „Decyzje przed startem", pozycja D-2.
--
-- IDEMPOTENTNY. Kasuje własny poprzedni przebieg po prefiksie `ank_demo_` i kończy na
-- ON CONFLICT … DO UPDATE. Dotyka WYŁĄCZNIE nowej tabeli pulse_survey_response — nie rusza kotwic
-- demo (39 pracowników, 1558 zmian) ani employee_performance_snapshot.
--
-- Okno wyliczane z CURRENT_DATE, żeby ekran zawsze pokazywał bieżący tydzień: date_trunc('week')
-- w Postgresie daje poniedziałek — dokładnie to samo okno, co pulseWindow() w TypeScripcie.
-- ============================================================================================

BEGIN;

DELETE FROM pulse_survey_response WHERE id LIKE 'ank_demo_%';

CREATE TEMP TABLE ank_win ON COMMIT DROP AS
SELECT date_trunc('week', CURRENT_DATE)::date AS ws,
       (date_trunc('week', CURRENT_DATE)::date + 6) AS we;

-- Kandydaci: deterministyczna kolejność po id, po 8 / 3 / 0 osób z trzech regionów.
WITH kand AS (
  SELECT e.id AS employee_id,
         e.unit_id,
         u.name AS unit_name,
         row_number() OVER (PARTITION BY e.unit_id ORDER BY e.id) AS rn
  FROM employees e
  JOIN organizational_units u ON u.id = e.unit_id
),
wybrani AS (
  SELECT * FROM kand WHERE unit_name = 'Region Centrum' AND rn <= 8
  UNION ALL
  SELECT * FROM kand WHERE unit_name = 'Region Północ'  AND rn <= 3
)
INSERT INTO pulse_survey_response (id, employee_id, unit_id, window_start, window_end, score, comment, submitted_at, updated_at)
SELECT
  'ank_demo_' || w.employee_id,
  w.employee_id,
  w.unit_id,
  win.ws,
  win.we,
  -- Rozrzut 2..5, deterministyczny, bez random(): skrypt ma dawać ten sam wynik przy każdym runie.
  2 + ((w.rn * 3) % 4)::int,
  CASE
    WHEN w.unit_name = 'Region Centrum' AND w.rn <= 6
      THEN (ARRAY[
        'Za dużo nadgodzin w tym tygodniu.',
        'Grafik wreszcie stabilny, dużo lepiej.',
        'Brakuje ludzi na zmianie popołudniowej.',
        'Dobra komunikacja od koordynatora.',
        'Dojazdy między lokalizacjami męczą.',
        'Bez uwag.'
      ])[w.rn::int]
    ELSE NULL
  END,
  now(),
  now()
FROM wybrani w CROSS JOIN ank_win win
-- [POPRAWKA F-14] DO UPDATE, nie DO NOTHING. Wersja surowa kasowała własne wiersze po prefiksie
-- `ank_demo_`, ale odpowiedź złożoną przez interfejs ma id-uuid — DELETE jej nie dosięga, a
-- DO NOTHING cicho pomija wstawkę. Efekt: po pierwszym przebiegu E2E kolejne uruchomienie seeda
-- daje inny rozkład niż oczekiwany w Kroku 4, i to bez żadnego komunikatu. `DO UPDATE` czyni seed
-- naprawdę idempotentnym: po nim stan demo jest zawsze taki sam, niezależnie od tego, kto klikał.
ON CONFLICT (employee_id, window_start) DO UPDATE
  SET score = EXCLUDED.score,
      comment = EXCLUDED.comment,
      updated_at = now();

COMMIT;
```

- [ ] **Krok 2: Zbuduj obraz tenant-runtime z blokiem F i podnieś usługę.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
docker compose -p hrobot --profile full up -d --build tenant-runtime web
```

Oczekiwane: `Container hrobot-tenant-runtime-1  Started`, `Container hrobot-web-1  Started`.

- [ ] **Krok 3: Wgraj migrację ręcznie i przepisz właściciela (droga sprawdzona w tym repo).**

**`[POPRAWKA F-15]`** **Nie przepuszczaj SQL-a przez potok PowerShella.** W Windows PowerShell 5.1 `Get-Content -Raw | docker exec -i` przekodowuje strumień do strony kodowej konsoli. Migracja i seed niosą polskie znaki, a **teksty seeda lądują w bazie i potem na ekranie menedżera** („Za dużo nadgodzin…"). Kopiujemy plik do kontenera i wykonujemy przez `psql -f`, co jest odporne na kodowanie hosta:

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
docker cp packages\db\prisma\tenant\migrations\20260812090000_ankieta_pulsowa\migration.sql hrobot-postgres-1:/tmp/ankieta.sql
docker exec -i hrobot-postgres-1 psql -U postgres -d hrobot_t_900d948b -v ON_ERROR_STOP=1 -f /tmp/ankieta.sql
docker exec -i hrobot-postgres-1 psql -U postgres -d hrobot_t_900d948b -c "ALTER TABLE pulse_survey_response OWNER TO hu_900d948b;"
docker exec -i hrobot-postgres-1 psql -U postgres -d hrobot_t_900d948b -t -A -c "\dt pulse_survey_response"
```

`-v ON_ERROR_STOP=1` jest istotne: bez niego `psql` przechodzi dalej po błędzie i wyjście wygląda na sukces.

Oczekiwane ostatnie wyjście:
```
public|pulse_survey_response|table|hu_900d948b
```
(rola `hu_900d948b`, nie `postgres` — jeśli jest `postgres`, `ALTER TABLE` nie zadziałał i aplikacja dostanie „permission denied for table").

- [ ] **Krok 4: Zasiej dane demo i sprawdź rozkład.**

```
docker cp scripts\seed-demo-ankieta.sql hrobot-postgres-1:/tmp/seed-ankieta.sql
docker exec -i hrobot-postgres-1 psql -U postgres -d hrobot_t_900d948b -v ON_ERROR_STOP=1 -f /tmp/seed-ankieta.sql
docker exec -i hrobot-postgres-1 psql -U postgres -d hrobot_t_900d948b -t -A -F"|" -c "SELECT u.name, count(*), count(r.comment) FROM pulse_survey_response r JOIN organizational_units u ON u.id=r.unit_id GROUP BY 1 ORDER BY 1;"
docker exec -i hrobot-postgres-1 psql -U postgres -d hrobot_t_900d948b -t -A -c "SELECT comment FROM pulse_survey_response WHERE comment LIKE '%nadgodzin%';"
```

Oczekiwane:
```
Region Centrum|8|6
Region Północ|3|0
Za dużo nadgodzin w tym tygodniu.
```

**`[POPRAWKA F-15]`** Ostatnia linia jest **kontrolą kodowania**, nie ozdobą: jeśli zamiast `Za dużo` zobaczysz `Za du¿o` albo `Za du??o`, plik przeszedł przez przekodowany potok i seed trzeba cofnąć (`DELETE FROM pulse_survey_response WHERE id LIKE 'ank_demo_%';`) i wgrać ponownie przez `docker cp` + `psql -f`. Zepsute znaki wyszłyby dopiero na ekranie w trakcie demonstracji.

- [ ] **Krok 5: DOWÓD LICZBOWY — zrzut „po" i porównanie.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
node scripts/composite-score-baseline.mjs --dump docs/raport-km3/evidence/composite-baseline-po.json
node scripts/composite-score-baseline.mjs --compare docs/raport-km3/evidence/composite-baseline-przed.json docs/raport-km3/evidence/composite-baseline-po.json
echo "exit=$LASTEXITCODE"
```

Oczekiwane:
```
✓ docs/raport-km3/evidence/composite-baseline-po.json: 122 wierszy, 39 pracowników, 1558 zmian
✓ compositeScore identyczny: 122 wierszy, 39 pracowników, porównanie tekstowe bez tolerancji
exit=0
```

Jeżeli `exit` ≠ 0 — **zatrzymaj wdrożenie**, skrypt wypisze z nazwy każdy rozjechany wiersz.

- [ ] **Krok 6: Sprawdź, że ŻYWA ścieżka odczytu zwraca te same 39 wyników co fixture.**

**`[POPRAWKA F-16]`** Dołożone: jawna bramka na `DEMO_ADMIN_PASSWORD` (skrypty repo — `demo-up.mjs`, `seed-dataset-2026.mjs` — przerywają, gdy jej brak; tutaj bez niej `Invoke-RestMethod` wywali się nieczytelnie na 401) oraz `@()` wokół wyniku `Where-Object`, bo w PS 5.1 `$null.Count` daje `$null` i linia kontrolna wypisałaby `rozjazdow=` zamiast `rozjazdow=0` — czyli zieloną kontrolę wyglądającą jak awaria (albo odwrotnie).

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
if (-not $env:DEMO_ADMIN_PASSWORD) { throw "Ustaw `$env:DEMO_ADMIN_PASSWORD (haslo konta 'demo' w realmie hrobot-staging) — bez niego ten krok nie zmierzy niczego." }
$tok = (Invoke-RestMethod -Method Post -Uri "http://localhost:8081/realms/hrobot-staging/protocol/openid-connect/token" -Body @{grant_type='password';client_id='hrobot-web';username='demo';password=$env:DEMO_ADMIN_PASSWORD}).access_token
$ov = Invoke-RestMethod -Uri "http://localhost:3001/api/strategic-brain/overview" -Headers @{Authorization="Bearer $tok"}
$live = @{}; $ov.heatmap | ForEach-Object { $live[$_.employeeId] = [string]$_.compositeScore }
$fx = Get-Content apps\tenant-runtime\src\ankieta\__fixtures__\km3-snapshots-39.json -Raw | ConvertFrom-Json
$last = @{}; $fx | Sort-Object windowEnd | ForEach-Object { $last[$_.employeeId] = [string]$_.compositeScore }
$diff = @($live.Keys | Where-Object { $live[$_] -ne $last[$_] })
"pracownikow=$($live.Count) rozjazdow=$($diff.Count)"
if ($diff.Count -gt 0) { $diff | ForEach-Object { "  ROZJAZD $_ : fixture=$($last[$_]) live=$($live[$_])" } }
```

Oczekiwane: `pracownikow=39 rozjazdow=0` i żadnej linii `ROZJAZD`. Port 8081 dla Keycloaka i 3001 dla tenant-runtime są zweryfikowane w `docker ps` (KC publikuje `8081->8080`, bo `8080` na hoście trzyma Caddy).

- [ ] **Krok 7: Uruchom E2E bloku F na żywym stacku.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2\apps\web
$env:E2E_BASE_URL="http://localhost:8080"; npx playwright test e2e/ankieta-prog-anonimowosci.spec.ts
```

Oczekiwane: `3 passed` (PRACOWNIK + MANAGER + ADMIN). Jeżeli `DEMO_ADMIN_PASSWORD` nie jest ustawione, trzeci test raportuje się jako `skipped` — **to nie jest sukces**, tylko brak demonstracji stanu „3 z 5"; ustaw hasło i uruchom ponownie przed zapisem dowodu do macierzy.

> **`[POPRAWKA F-14]`** Po tym kroku Anna Kowalska ma w bazie własną odpowiedź z id-uuid. Nie jest wśród ośmiu wybranych przez seed (sprawdzone: pierwszych ośmiu w `Region Centrum` wg `id` to Piotrowski, Witkowski, Kowalczyk, Pawłowska, Wróbel, Wieczorek, Majewski, Dąbrowski), więc `Region Centrum` ma teraz **9** odpowiedzi, nie 8. To jest poprawne i oczekiwane. Ponowne uruchomienie seeda po E2E **nie** zmieni już tej liczby ani rozkładu — dzięki `DO UPDATE`.

- [ ] **Krok 8: Commit.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
git add scripts/seed-demo-ankieta.sql docs/raport-km3/evidence/composite-baseline-po.json
git commit -m "chore(km3): seed demo ankiety + dowod liczbowy, compositeScore 122/122 wierszy identyczny po wdrozeniu"
```

---

### Zadanie 12: Zapis do raportu KM3 i macierz pokrycia

**Pliki:**
- Zmień: `docs/raport-km3/Raport_KM3_HRobot.md` (§5 — DOPISUJEMY, nie przepisujemy)
- Utwórz: `docs/raport-km3/macierz-pokrycia-ankieta.md`

- [ ] **Krok 1: Napisz macierz pokrycia.** Utwórz `docs/raport-km3/macierz-pokrycia-ankieta.md`:

```markdown
# Macierz pokrycia — Ankieta pulsowa i analiza dobrostanu (M3 b)

| Nr | Kryterium | Dowód | Co dokładnie dowodzi |
|---|---|---|---|
| ANK-1 | Jedno pytanie 1–5 + opcjonalny komentarz | `apps/tenant-runtime/src/ankieta/ankieta.config.ts` (`PULSE_PYTANIE`, `PULSE_SCORE_MIN/MAX`), `dto/odpowiedz-ankiety.dto.ts`, CHECK `pulse_survey_response_score_range` w migracji `20260812090000_ankieta_pulsowa` | Skala jest wymuszona w trzech warstwach: DTO, serwis, baza. Komentarz jest `NULL`-owalny. |
| ANK-2 | Pracownik odpowiada raz na okno; druga próba aktualizuje | `@@unique([employeeId, windowStart])` + `upsert` w `AnkietaService.zapiszOdpowiedz`; testy „druga próba w tym samym oknie AKTUALIZUJE" i „ten sam klucz w obu wywołaniach" (`ankieta.service.spec.ts`) | Niezmiennik jest w BAZIE, nie tylko w kodzie — wyścig kończy się P2002, nie drugim wierszem. |
| ANK-3 | Jednostka poniżej 5 odpowiedzi nie pokazuje żadnej wartości liczbowej | `ankieta.agregacja.spec.ts` („poniżej progu nie zwraca ŻADNEJ wartości wyniku"), `ankieta.rodo.spec.ts` („jednostka z 4 odpowiedziami"), `lib/ankieta.test.ts` („poniżej progu NIGDY nie renderuje liczby"), E2E `ankieta-prog-anonimowosci.spec.ts` | Próg egzekwowany trzy razy: agregacja, API, ekran. Poniżej progu `null`, nigdy `0`. |
| ANK-4 | Manager nie widzi odpowiedzi pojedynczej osoby na żadnym ekranie ani w żadnej odpowiedzi API | `ankieta.rodo.spec.ts` — „ZAPYTANIE do bazy nie prosi o employeeId", „w CAŁEJ odpowiedzi API nie ma ani jednego identyfikatora pracownika", „serwis NIE udostępnia żadnej metody zwracającej cudzą pojedynczą odpowiedź"; E2E: brak nazwisk w `main` | Granica jest PROJEKCJĄ (`select` bez `employeeId`), nie filtrowaniem po fakcie. |
| ANK-5 | **`compositeScore` przed i po wdrożeniu identyczny dla wszystkich 39 pracowników** | **Dowód główny:** `docs/raport-km3/evidence/composite-baseline-przed.json` vs `...-po.json` porównane przez `scripts/composite-score-baseline.mjs --compare` — 122 wiersze, porównanie **tekstowe** (`composite_score::text`, 30 miejsc po przecinku) bez tolerancji, z kotwicami 39/1558 przerywającymi porównanie dwóch różnych zbiorów. **Dowody wspierające:** żywy `GET /api/strategic-brain/overview` (39 wyników, 0 rozjazdów wobec fixture'u) oraz `composite-score-nietkniety.spec.ts` (ścieżka odczytu na 122-wierszowym fixture, bez bazy). | Wartość rozliczana w KM3 jest tą zapisaną w `employee_performance_snapshot`; dowodem jest jej **bajtowe** porównanie przed i po. Dwa dowody wspierające pokazują, że ta sama liczba dochodzi niezmieniona do ekranu `/analiza`. |
| ANK-5a | **Ograniczenie dowodu — powiedziane wprost** | `composite-score-nietkniety.spec.ts`, blok komentarza „CO TEN TEST PRZYPINA, A CZEGO NIE" | `SnapshotService.overview` **czyta** `composite_score` z bazy i przepisuje przez `Number()`; nie przelicza go. Ten spec przypina regułę „najnowsze okno", projekcję `toHeatCell` i zawartość fixture'u — **nie** silnik wag. Za silnik odpowiada `scoring.util.spec.ts` (istniejący) i strażnik ANK-6. |
| ANK-6 | Dobrostan nie wchodzi do wyniku ani teraz, ani po refaktorze | `scoring-izolacja.spec.ts` — `ScoreDimensions`/`ScoreWeights` mają dokładnie 4 klucze; żaden plik `strategic-brain` nie zna słowa „ankieta"/„dobrostan"/„pulse"; żaden produkcyjny plik ankiety nie **importuje** ze `strategic-brain` | Strażnik strukturalny czyta prawdziwe pliki źródłowe, więc nie da się go uśpić przepisując asercję. Wykrywa krawędzie importu, a nie wystąpienia napisu — inaczej zakazywałby opisania własnej decyzji w komentarzu. |
| ANK-7 | Brak komentarza nie blokuje agregacji | `ankieta.agregacja.spec.ts` — „brak komentarzy NIE blokuje agregacji wyniku" | Średnia i rozkład liczone z samych ocen. |
| ANK-8 | Migracja addytywna, wycofywalna w całości | `20260812090000_ankieta_pulsowa/migration.sql` — same `CREATE TABLE` / `CREATE INDEX` / `ADD CONSTRAINT` na NOWEJ tabeli; zero `ALTER` na istniejących | `DROP TABLE pulse_survey_response;` cofa blok F bez śladu w danych demo. |
| ANK-9 | Kotwice demo nietknięte | `scripts/seed-demo-ankieta.sql` pisze wyłącznie do `pulse_survey_response`; skrypt kotwicy przerywa z kodem 2, gdy liczba pracowników ≠ 39 lub zmian ≠ 1558 | 39 pracowników i 1558 zmian potwierdzone w obu zrzutach (`anchors` w plikach JSON). |
| ANK-10 | Próg anonimowości ma jedno źródło i jest z nim spięty testem | `ankieta.config.ts` (`MIN_ANONIMOWOSCI = 5`) + `scoring-izolacja.spec.ts` (parytet z `minPeerGroupSize` w `performance-config.service.ts:129`) | Próg jest **stałą modułu**, nie odczytem z `performance_config` — ta tabela w najemcy jest pusta, a obniżenie progu ankiety nie może być efektem ubocznym strojenia ocen. Rozejście się obu liczb zapala test i wymusza świadomą decyzję. |
| ANK-11 | Nowa trasa BFF jest zamknięta domyślnie | `apps/web/lib/api-gate.test.ts` (trasa nie jest w `PUBLICZNE_API`), `apps/web/lib/middleware-api-gate.test.ts` (`/api/ankieta/moja`, `/api/ankieta/agregaty` na liście `CHRONIONE` → 401 dla anonima) | Matcher `/api/:path*` obejmuje trasę bez dodatkowego wpisu; strażnik parytetu pilnuje, żeby nikt jej nie otworzył. |
```

**`[POPRAWKA F-23/F-24/F-25/F-26]` Uwagi o nazewnictwie do wpisania pod macierzą** (żeby dwa lustrzane typy nie rozjechały się po cichu):

```markdown
**Nazewnictwo i granice typów.** `AgregatJednostki` istnieje w dwóch egzemplarzach: w
`apps/tenant-runtime/src/ankieta/ankieta.agregacja.ts` (kontrakt serwera) i w `apps/web/lib/ankieta.ts`
(lustro po stronie klienta) — tak samo jak `lib/dokumenty.ts` luster kontrakt modułu Dokumenty. To jest
granica BFF, nie duplikacja przez nieuwagę: web-kit nie importuje typów z tenant-runtime. Pola agregatu są
po angielsku (`unitId`, `respondentCount`, `averageScore`, `suppressed`), a klucze odpowiedzi API po polsku
(`pytanie`, `jednostki`, `minAnonimowosci`) — konwencja odziedziczona po sąsiednich modułach; nie zmieniamy
jej w bloku F, żeby nie przepisywać 42 testów tydzień przed odbiorem. Próg anonimowości występuje pod trzema
nazwami: `MIN_ANONIMOWOSCI` (stała), `minAnonimowosci` (parametr funkcji i pole odpowiedzi API),
`minPeerGroupSize` (źródło liczby w module ocen) — spina je test parytetu ANK-10.
```

- [ ] **Krok 2: DOPISZ jedną pozycję do §5 raportu (istniejące cztery zostają bez zmian).** W `docs/raport-km3/Raport_KM3_HRobot.md`, w sekcji `# 5. Ograniczenia realizacji demonstracyjnej (uczciwość)`, **po** pozycji `[Dane syntetyczne.]{.lbl}` dodaj:

```markdown
- [Ankieta pulsowa w zakresie minimalnym.]{.lbl} Moduł ankiet pracowniczych i
  analizy dobrostanu (harmonogram M3 b) wdrożono w zakresie **jednego pytania
  w skali 1–5 z opcjonalnym komentarzem**, w oknie tygodniowym, z agregacją
  wyłącznie na poziomie jednostki organizacyjnej i **progiem anonimowości
  5 odpowiedzi** (poniżej progu ekran nie pokazuje żadnej wartości liczbowej).
  Poza zakresem demonstracji pozostają: wielopytaniowe kwestionariusze, analiza
  treści komentarzy i trendy międzyokresowe. Wskaźnik dobrostanu jest **osobnym
  sygnałem** i świadomie **nie wchodzi do wyniku zbiorczego** modułu rozwoju —
  liczby rozliczane w macierzy AN-1..AN-13 pozostają niezmienione, co
  potwierdzono porównaniem 122 wierszy ocen dla 39 pracowników przed i po
  wdrożeniu (`docs/raport-km3/macierz-pokrycia-ankieta.md`, poz. ANK-5).
```

- [ ] **Krok 3: `[POPRAWKA F-11]` ZWERYFIKUJ kotwice 39/1558 — nie poprawiaj ich tutaj.**

Wersja surowa kazała zmienić „36 pracowników, 832 zmiany" na „39 pracowników, 1558 zmian" w §5 i w linii 227. **To jest zadanie bloku A** (Krok 47), który robi globalny `-replace` w tym samym pliku; pozycja **K-9** planu głównego już to sygnalizuje. Dwa bloki wykonujące tę samą podmianę to albo konflikt scalania, albo — gdy A wyląduje pierwszy — krok, który nic nie znajduje i myli wykonawcę. Dodatkowo podany literał pasuje **tylko do linii 406**: linia 227 brzmi „**kotwic** demo (36 pracowników, 832 zmiany)", nie „kotwice demo".

Zamiast podmiany — kontrola:

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
Select-String -Path docs\raport-km3\Raport_KM3_HRobot.md -Pattern '36 pracowników, 832 zmiany'
```

- **Brak trafień** → blok A już poprawił kotwice. Idź dalej.
- **Dwa trafienia (linie ~227 i ~406)** → blok A jeszcze nie wylądował. **Nie poprawiaj tego tutaj.** Zanotuj w opisie commita: „kotwice 36/832 zostają do korekty w bloku A, Krok 47" i idź dalej. Pozycja §5 dopisana w Kroku 2 podaje własne, zmierzone liczby (39 / 122 wiersze) i jest poprawna niezależnie od tamtej korekty.

- [ ] **Krok 4: `[POPRAWKA F-10]` Dopisz macierz do wykazu załączników — jako WIERSZ TABELI, po bramce na bloki A i B.**

Sekcja `# 8. Wykaz załączników` **nie jest listą punktowaną** — to **prosta tabela pandoc**: dwie spacje wcięcia, `**Zał. N**`, trzy spacje, treść, a szerokości kolumn wyznacza linia myślników nad wierszami (kolumna „Nr" ma 12 znaków, druga zaczyna się na offsecie 15). Wpis w formacie `- Macierz pokrycia — …` z wersji surowej **rozbiłby tę tabelę przy składzie pandokiem**. Numer też był pominięty, a Zał. 6 zajmuje blok A i Zał. 7 blok B — ten załącznik to **Zał. 8**.

Najpierw bramka (ten sam wzorzec, co Krok 60 bloku B):

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
Select-String -Path docs\raport-km3\Raport_KM3_HRobot.md -Pattern '^\s+\*\*Zał\. [0-9]+\*\*' | ForEach-Object { $_.Line }
```

- Widzisz **Zał. 1 … Zał. 7** → wstaw swój wiersz bezpośrednio pod `  **Zał. 7**`, jako `**Zał. 8**`.
- Widzisz **Zał. 1 … Zał. 6** → blok B jeszcze nie wylądował; **przerwij Zadanie 12 tutaj** i wróć po bloku B. Kroki 1–3 są kompletne i samodzielnie użyteczne (macierz istnieje i jest zacommitowana).
- Widzisz **Zał. 1 … Zał. 5** → nie wylądował ani A, ani B; przerwij tak samo.

Wiersz do wstawienia (dokładnie: dwie spacje, `**Zał. 8**`, trzy spacje, treść; **nie ruszaj** linii myślników):

```
  **Zał. 8**   Macierz pokrycia kryteriów akceptacji Ankiety pulsowej i analizy dobrostanu (ANK-1..ANK-9) testami --- `macierz-pokrycia-ankieta.md`
```

Uwaga na ścieżkę: sąsiednie wiersze podają **samą nazwę pliku** (`macierz-pokrycia-dokumenty.md`), a nie ścieżkę od korzenia — trzymamy ten sam wzorzec, żeby tabela była spójna.

- [ ] **Krok 5: Sprawdź, że §5 ma teraz pięć pozycji i że cztery poprzednie są nietknięte.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
git diff docs/raport-km3/Raport_KM3_HRobot.md
```

**`[POPRAWKA F-11]`** Oczekiwane: w §5 **wyłącznie dodane linie** nowej pozycji, w §8 **wyłącznie jeden dodany wiersz** tabeli — i **ani jednej linii zmienionej**. Jeżeli w diffie widzisz zmodyfikowaną linię z kotwicami 36/832, znaczy że mimo Kroku 3 ktoś je jednak podmienił: cofnij tę zmianę (`git checkout -p`) i zostaw ją blokowi A, inaczej powstanie konflikt scalania w pliku, który zmienia pięć innych bloków.

- [ ] **Krok 6: Uruchom pełną bramkę i zacommituj.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2\apps\tenant-runtime
npx jest src/ankieta src/strategic-brain
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2\apps\web
npx vitest run
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
pnpm -C apps/tenant-runtime typecheck
pnpm -C apps/web typecheck
pnpm -C apps/tenant-runtime lint
pnpm -C apps/web lint
git add docs/raport-km3/macierz-pokrycia-ankieta.md docs/raport-km3/Raport_KM3_HRobot.md
git commit -m "docs(km3): macierz pokrycia ankiety (ANK-1..ANK-9) + poz. w par. 5 + Zal. 8 w wykazie"
```

Oczekiwane: jest zielony (moduł `ankieta` **42** testy + `strategic-brain` bez zmiany liczby), vitest zielony, oba typechecki i oba linty bez wyjścia.

---

**Ryzyka:**

1. **`ALTER TABLE … OWNER TO hu_900d948b` pominięte przy ręcznym wgraniu migracji.** Tabela zostaje własnością `postgres`, aplikacja dostaje „permission denied for table pulse_survey_response" przy pierwszym zapisie — czyli błąd pojawia się dopiero na demo, nie przy wdrożeniu. Zadanie 11 Krok 3 kończy się jawnym `\dt`, który pokazuje właściciela; wynik `postgres` zamiast `hu_900d948b` zatrzymuje wdrożenie.
2. **`[POPRAWKA F-13]` Ktoś rozbije parę „wpis w matcherze ↔ ekran" i `/ankieta` stanie się osiągalne anonimowo** — dokładnie tak, jak zdarzyło się to trzem modułom M3. W wersji surowej to ryzyko było wbudowane w plan: Zadanie 9 dodawało wpis do matchera, zostawiało `middleware-matcher.test.ts` na czerwono i **commitowało ten stan**, licząc na to, że nikt nie „naprawi" go usunięciem wpisu. Teraz wpis do `middleware.ts` (Zadanie 10 Krok 3a) i katalog `app/(tenant)/ankieta/` (Krok 3) idą **jednym commitem**, więc żaden commit w historii nie ma czerwonego strażnika i nie ma czego „naprawiać".
3. **Fixture `km3-snapshots-39.json` rozjeżdża się z żywą bazą**, jeśli ktoś przepuści scheduler `strategic-brain` (cron 2:00) albo ponownie uruchomi `seed-demo-strategic-brain-peers.sql`. Wtedy `composite-score-nietkniety.spec.ts` zostanie zielony, ale będzie mierzył nieaktualne dane. Skrypt kotwicy przerywa z kodem 2 przy rozjeździe kotwic, a Zadanie 11 Krok 6 porównuje fixture z ŻYWĄ odpowiedzią API — to jest bramka, która to wykryje.
4. **`comment` to pole swobodnego tekstu wpisywane przez pracownika**, więc może zawierać dane osobowe wpisane przez niego samego. Ograniczają to: własny próg 5 komentarzy, sortowanie leksykograficzne zrywające związek z kolejnością zgłoszeń oraz limit 500 znaków. Nie ograniczają tego automatycznie: treść nie jest filtrowana. To jest świadome i należy to powiedzieć odbiorcy wprost — nie jest to wpisane do §5, bo §5 mówi o ograniczeniach zakresu, a to jest właściwość projektu.
5. **Okno tygodniowe liczone w UTC** — pracownik odpowiadający w niedzielę po 22:00 czasu polskiego (letniego) trafia już do okna poniedziałkowego. Przy jednym pytaniu na tydzień jest to bez znaczenia dla agregatu, ale gdyby ktoś w przyszłości oparł na tym oknie rozliczenie czasu pracy, byłby to błąd. Komentarz w `ankieta.window.ts` mówi to wprost.
6. **`AuditInterceptor` zapisuje ciało POST-a do `audit_log`**, czyli treść komentarza trafia do tabeli append-only, z której nie da się jej usunąć. `redactAuditPayload` nie zna klucza `comment` (zweryfikowane: `SENSITIVE_KEYS` = `pesel, password, passwordhash, token, accesstoken, refreshtoken, secret, ssn, identifier`). **`[POPRAWKA D-1]` To NIE jest ryzyko poboczne, tylko sprzeczność z obietnicą, którą moduł składa pracownikowi na ekranie** — dlatego zostało wyniesione do sekcji „Decyzje przed startem" jako pozycja **D-1** i wymaga rozstrzygnięcia właściciela produktu / IOD **przed** Zadaniem 10. Domyślne wyjście przyjęte w tym planie: tekst na ekranie mówi prawdę o audycie, a zmiana `SENSITIVE_KEYS` (dotyka wszystkich modułów) zostaje poza zakresem bloku F.

7. **`[POPRAWKA F-8]` Blok F ląduje po bloku A i zapala jego strażniki inwentarza BFF.** Nowa trasa `/api/ankieta` jest 19. trasą; blok A przypina 17 w siedmiu miejscach i drukuje inwentarz w Zał. 6. Bramka: Zadanie 9 Krok 7 ma jawne ostrzeżenie, a rekomendowana kolejność to **F i E przed A**. Skutek przeoczenia: siedem miejsc do ręcznej korekty i przedruk załącznika idącego do PARP.

8. **`[POPRAWKA F-10]` Kolizja numeracji załączników.** §8 raportu dostaje wiersze od trzech bloków: A (Zał. 6), B (Zał. 7), F (Zał. 8). Zadanie 12 Krok 4 ma bramkę sprawdzającą, czy A i B już wylądowały, i przerywa zadanie, gdy nie — tak samo jak Krok 60 bloku B.

9. **`[POPRAWKA F-12]` Scenariusz demo nie pokrywa się z zakresem konta demonstrującego.** `manager.demo` nie widzi Regionu Północ, więc stan „3 z 5" pokazujemy na koncie `demo` (ADMIN). Jeżeli demonstracja ma iść **wyłącznie** z konta menedżera, trzeba wybrać wariant (b) albo (c) z pozycji D-2 — to zmiana w danych demo, nie w kodzie, i dotyka kotwic innych modułów.

10. **`[POPRAWKA F-15]` Kodowanie polskich znaków przy wgrywaniu SQL-a z Windows PowerShell 5.1.** Teksty komentarzy z seeda są widoczne na ekranie menedżera, więc przekodowany potok psuje **demonstrację**, nie tylko komentarz w pliku. Zadania 11 Kroki 3–4 używają `docker cp` + `psql -f -v ON_ERROR_STOP=1` i kończą jawną kontrolą znaku „ż".

**Wycofanie:**

Blok F tworzy **nową** tabelę i nie zmienia ani jednego istniejącego obiektu bazy, więc wycofanie jest zupełne i nie dotyka danych demo:

1. Na żywym najemcy: `docker exec -i hrobot-postgres-1 psql -U postgres -d hrobot_t_900d948b -c "DROP TABLE IF EXISTS pulse_survey_response;"`
2. W repo: `git revert` commitów Zadań 4–12 (kolejność odwrotna). Migracja `20260812090000_ankieta_pulsowa` nigdy nie została wpisana do `_prisma_migrations`, więc jej usunięcie nie zostawia sieroty w historii migracji.
3. `pnpm -C packages/db db:generate` — regeneracja klienta bez modelu `PulseSurveyResponse`.
4. Weryfikacja, że wycofanie niczego nie ruszyło: `node scripts/composite-score-baseline.mjs --compare docs/raport-km3/evidence/composite-baseline-przed.json <świeży zrzut>` musi dać `exit=0` — czyli te same 122 wiersze i te same 39 wyników, co przed blokiem F.

Wycofanie samego **ekranu** bez wycofania backendu (gdyby wystarczyło ukryć funkcję na demo): usuń wpis `Dobrostan` z `apps/web/lib/nav.ts` i katalog `apps/web/app/(tenant)/ankieta/` wraz z wpisem `'/ankieta/:path*'` z `middleware.ts` — oba strażniki parytetu (`middleware-matcher.test.ts`, `api-gate.test.ts`) pilnują, żeby to usunięcie było kompletne.

**`[POPRAWKA F-9]`** Jeżeli wycofujesz też trasę BFF (`apps/web/app/api/ankieta/`), usuń **równocześnie** dwa wpisy `/api/ankieta/*` z `CHRONIONE` w `apps/web/lib/middleware-api-gate.test.ts` — inaczej ten test będzie sprawdzał 401 na trasie, której nie ma (dostanie 404 i stanie się czerwony bez powodu).

---

## Nakład — korekta

**`[POPRAWKA F-21]`** Specyfikacja wycenia blok F na **3 h**. To jest niewykonalne: 12 zadań, ~70 kroków,
nowy model + migracja wgrywana ręcznie na żywego najemcę, serwis + kontroler + moduł, dwa ekrany, klient BFF,
trasa proxy, 42 testy jednostkowe, 3 testy E2E na żywym stosie, dowód liczbowy w dwóch przebiegach oraz
edycja dokumentu, który zmienia pięć innych bloków.

| Etap | Realny czas |
|---|---|
| Zadania 1–3 (kotwica, okno, agregacja) | 1,0 h |
| Zadanie 4 (schemat + migracja) | 0,7 h |
| Zadania 5–7 (serwis, agregaty, kontroler) | 1,8 h |
| Zadanie 8 (dowód liczbowy + izolacja + obie weryfikacje negatywne) | 1,3 h |
| Zadania 9–10 (front, ekran, nawigacja, E2E) | 2,0 h |
| Zadanie 11 (wdrożenie, seed, dowód „po", E2E na żywo) | 1,2 h |
| Zadanie 12 (macierz + raport, z bramkami na bloki A i B) | 0,8 h |
| **Razem** | **≈ 8,8 h** |

Do tego **decyzje D-1 i D-2** — nie są pracą programistyczną, ale bez nich Zadania 10 i 11 nie mają
rozstrzygniętej treści.

## Plan testów — różnica wobec specu

**`[POPRAWKA F-31]`** Plan testów ze specyfikacji przewiduje dla bloku F test **integracyjny** progu
anonimowości (tor `jest.integration.config.cjs`, wymaga żywego Postgresa). Ten plan go **nie tworzy** —
próg jest dowiedziony testem jednostkowym funkcji czystej (`ankieta.agregacja.spec.ts`), testem serwisu na
zamockowanym kliencie (`ankieta.rodo.spec.ts`), testem klienta web (`lib/ankieta.test.ts`) i testem E2E na
żywym stosie (`ankieta-prog-anonimowosci.spec.ts`). Pokrycie kryterium 2 jest pełne, ale **warstwa
integracyjna zostaje pusta** — to świadome odstępstwo, nie przeoczenie, i tak trzeba je zapisać, jeśli
plan testów ze specu trafia do dokumentacji odbiorczej.