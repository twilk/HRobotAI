::: {.cover-title style="font-size:16pt; margin-top:8px;"}
Raport z realizacji 3 Kamienia Milowego
:::

::: {.cover-title style="font-size:11.5pt; margin:8px 0 18px;"}
w ramach projektu pn. „Concordia Accelerator -- We turn ideas into human
profit", współfinansowanego ze środków programu Fundusze Europejskie dla
Nowoczesnej Gospodarki, działanie Startup Booster Poland -- Smart UP.
:::

  ------------------------------------------------------------------ -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  Startup (Beneficjent):                                             **APP PRO SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ** --- KRS 0001236684 · NIP 5273215742 · REGON 544561467
  Odbiorca Technologii:                                              **4MOBILITY S.A.** --- ul. Fabryczna 5, 00-446 Warszawa (wdrożenie pilotażowe)
  Numer umowy:                                                       **0035/2026**
  Numer Kamienia Milowego:                                           **3**
  Opis Kamienia Milowego:                                            Zaprojektowanie oraz wdrożenie trzech modułów bazowych: Modułu Dokumenty (generowanie dokumentów kadrowo-płacowych z ewidencji czasu pracy, rozliczenie nadgodzin, szkielet eksportu ZUS/Płatnik), Agenta AI „Analityk HR" (ciągła, autonomiczna analiza wydajności, trajektoria rozwoju i rekomendacje strategiczne z twardą granicą decyzji człowieka) oraz Agenta Głosowego (asystent konwersacyjny dla języka polskiego), wraz z pełnym pokryciem testami automatycznymi i zgodnością z RODO oraz EU AI Act.
  Rodzaj Kamienia Milowego:                                          technologiczny
  Wskaźniki określające realizację Kamienia Milowego:                Liczba wdrożonych modułów bazowych: **3 szt.** (Moduł Dokumenty, Agent AI „Analityk HR", Agent Głosowy).
  Sposób weryfikacji osiągnięcia zaplanowanych wartości wskaźnika:   Raport z realizacji 3 Kamienia Milowego w formie dokumentu.
  ------------------------------------------------------------------ -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

::::::::::: sig
:::::: {}
::: sigline
\...\...\...\...\...\...\...\...\...\...\...\...\...\....
:::

::: lbl
APP PRO sp. z o.o.
:::

::: muted
(Startup)
:::
::::::

:::::: {}
::: sigline
\...\...\...\...\...\...\...\...\...\...\...\...\...\....
:::

::: lbl
4mobility S.A.
:::

::: muted
(Odbiorca technologii)
:::
::::::
:::::::::::

::::::: sig
:::::: {style="max-width:46%"}
::: sigline
\...\...\...\...\...\...\...\...\...\...\...\...\...\....
:::

::: lbl
CONCORDIA DESIGN sp. z o.o.
:::

::: muted
(Akcelerator)
:::
::::::
:::::::

::: page-break
:::

::::: att-title
::: big
Raport
:::

::: sub
Realizacja 3 Kamienia Milowego
:::

Raport zawiera szczegółowy opis prac zrealizowanych w ramach trzeciego
kamienia milowego projektu HRobot.AI

Warszawa, 30 lipca 2026
:::::

# Wstęp

Niniejszy dokument zawiera raport z realizacji trzeciego kamienia
milowego (KM3) projektu HRobot.AI --- wielodostępowej (multi-tenant)
platformy SaaS klasy Enterprise do automatyzacji procesów HR (kadry,
grafiki, wnioski, dostępy, dokumenty).

Zakres KM3 obejmował zaprojektowanie i wdrożenie **trzech modułów
bazowych** (wskaźnik KM3 --- 3 szt.): Modułu Dokumenty, Agenta AI
„Analityk HR" oraz Agenta Głosowego, wraz z pełnym pokryciem testami
automatycznymi i konsekwentnym utrzymaniem przyjętego w projekcie modelu
zgodności (RODO „privacy by design", przygotowanie do wymagań EU AI Act
dla systemów wspierających decyzje kadrowe). Wskaźnik realizacji KM3
(3 wdrożone moduły bazowe) został osiągnięty: wszystkie trzy moduły
zaimplementowano na poziomie modelu danych, silnika wyliczeń, API,
wyspecjalizowanych serwisów oraz interfejsu użytkownika działającego na
rzeczywistym API platformy, a całość pokryto testami automatycznymi.
Moduły działają na żywym środowisku testowym z danymi demonstracyjnymi
odwzorowującymi organizację Odbiorcy Technologii (4Mobility) i zostały
przygotowane do sesji akceptacyjnej domykającej odbiór kamienia w
terminie do 2026-08-20.

Zrealizowane moduły (wskaźnik KM3 --- 3 szt.):

- [Moduł Dokumenty]{.lbl} --- generowanie dokumentów kadrowo-płacowych z
  ewidencji czasu pracy (RCP): ewidencja czasu pracy, rozliczenie
  nadgodzin (dobowe 50%, średniotygodniowe/nocne/niedzielne/świąteczne
  100%) oraz szkielet eksportu ZUS/Płatnik (KEDU: DRA/RCA/RSA) ---
  **bez jakiejkolwiek wysyłki na zewnątrz** (twarda granica człowieka),
  z kontrolowanym odszyfrowaniem PESEL wyłącznie na potrzeby ZUS i
  audytem ids-only.
- [Agent AI „Analityk HR"]{.lbl} --- strategiczny mózg kadrowy: ciągła,
  autonomiczna analiza czterech wymiarów pracy (Wydajność, Terminowość,
  Jakość, Rozwój), wyjaśnialna trajektoria rozwoju (poziom vs trend) oraz
  proaktywne rekomendacje strategiczne (retencja per pracownik,
  rekrutacja per lokalizacja) --- wyłącznie analiza, decyzję kadrową
  zawsze zatwierdza człowiek (art. 22 RODO).
- [Agent Głosowy]{.lbl} --- konwersacyjny asystent dla języka polskiego:
  rozpoznanie intencji z zamkniętego zbioru komend (wniosek urlopowy, L4,
  „mój grafik") i wykonanie ich na istniejącym API platformy w imieniu
  użytkownika, z twardą bramką potwierdzenia człowieka przed każdą akcją
  zapisującą i twardym fallbackiem do formularza tekstowego (EU AI Act).

# 1. Informacje o Kamieniu Milowym

  --------------------------------------------------------------- ----------------------------------
  Okres realizacji Kamienia Milowego 3 (wg harmonogramu programu)   2026-07-21 → 2026-08-20
  Termin odbioru Kamienia Milowego 3                                2026-08-20
  Wskaźnik (liczba wdrożonych modułów bazowych)                     3 szt.
  Transza III (po odbiorze)                                         127 300 PLN (płatność 2026-09-09)
  --------------------------------------------------------------- ----------------------------------

# 2. Część A --- Proces wytwórczy, jakość i środowiska

Prace KM3 kontynuowano w tym samym reżimie wytwórczym co w KM2: każda
zmiana przechodzi przez pipeline ciągłej integracji (analiza statyczna →
kontrola typów `tsc --noEmit` → testy jednostkowe/integracyjne), a
zielony przebieg warunkuje włączenie zmian do gałęzi głównej. Moduły
zostały zaimplementowane metodą TDD (test przed implementacją) ---
szczególnie warstwy czystych wyliczeń (silnik RCP/nadgodzin, parser
intencji, silnik scoringu) i granice zgodności (granica zapisu, granica
braku wysyłki), które są weryfikowane niezależnymi testami
architektonicznymi.

::: keep
Jakość --- testy automatyczne (stan repozytorium KM3):

  Suita                                                                       Wynik            Zakres
  --------------------------------------------------------------------------- ---------------- ---------------------------------------------------------------------------------------------------------------
  Testy modułu Analityk HR (`strategic-brain`, jest)                          **134 / 134**    kryteria AN-1..AN-13: 4 wymiary, trajektoria, RBAC, granica zapisu art. 22, null-policy, append-only
  Testy Modułu Dokumenty (`dokumenty`, jest)                                  **84 / 84**      kryteria DOK-1..DOK-14: parowanie RCP, nadgodziny bez double-count, brak wysyłki, PESEL-tylko-ZUS, append-only
  Testy Agenta Głosowego (`agent-glosowy`, jest)                              **26 / 26**      komendy K1/K2/K3, parser intencji PL, bramka potwierdzenia człowieka, audyt ids-only, brak eskalacji uprawnień
  Cały pakiet backendu tenant-runtime (jest, 65 plików `*.spec.ts`)           **828 / 828**    logika wszystkich modułów, RBAC i izolacja tenantów, szyfrowanie danych, obieg wniosków/grafiku/zamian
  Aplikacja referencyjna web-kit (vitest)                                     **~355 / ~355**  kalkulatory prezentacji i logika UI wszystkich ekranów tenanta (w tym `/dokumenty`, `/analiza`, `/asystent`)
:::

Łącznie moduły KM3 wnoszą **244 dedykowane testy** (134 + 84 + 26),
które wraz z pozostałymi suitami składają się na zielony pakiet
**828 testów** backendu oraz **~355 testów** aplikacji referencyjnej.
Trzy moduły bazowe działają na tym samym stanie kodu, który jest wdrażany
na żywe środowisko testowe (pełny stos Docker Compose z żywym tenantem
demonstracyjnym), co dla Modułu Analityk HR zostało dodatkowo potwierdzone
weryfikacją na żywym tenancie i realnych kontach RBAC
(`docs/demo/strategic-brain-live-verification.md`).

# 3. Część B --- Moduły bazowe (wskaźnik KM3 --- 3 szt.) {#część-b-moduły-bazowe-wskaźnik-km3-3-szt. .page-break}

Poniżej opisano trzy moduły bazowe KM3 w jednolitej strukturze (cel,
co zbudowano z mapowaniem na realne pliki/API, kryteria akceptacji,
dowody). Kryteria akceptacji każdego modułu są rozpisane 1:1 na realne
pliki testów w załączonych macierzach pokrycia.

## 3.1. Moduł Dokumenty (dokumenty kadrowo-płacowe z RCP)

Cel zadania w ramach kamienia milowego:

Moduł Dokumenty automatyzuje generowanie dokumentów kadrowo-płacowych na
podstawie danych z Rejestracji Czasu Pracy (RCP). Na wejściu przyjmuje
surowe zdarzenia RCP (wejście/wyjście/przerwa) oraz dane kadrowe i
zatwierdzone nieobecności; na wyjściu produkuje trzy typy dokumentów:
**ewidencję czasu pracy**, **rozliczenie nadgodzin** oraz **szkielet
eksportu ZUS/Płatnik (KEDU)**. Zasada nadrzędna modułu: każdy krok o
skutkach prawnych (zatwierdzenie nadgodzin, „wysyłka" ZUS) przechodzi
przez bramkę człowieka, a na etapie demonstracyjnym **nic nie jest
wysyłane na zewnątrz**.

Co zbudowano (mapowanie na realne pliki/API):

- Model danych (Prisma, schemat tenanta, greenfield): `RcpEvent`
  (niemutowalne, append-only zdarzenie RCP; korekta = nowe zdarzenie
  `source=KOREKTA` przez `correctsEventId`) oraz `GeneratedDocument`
  (niemutowalny co do treści; ponowna generacja tworzy nowy wiersz
  wskazujący `replacesDocumentId`, `contentHash` zamraża treść). Migracja
  create-only, hand-authored, z notą `ALTER OWNER` i partial-unique
  indeksem deduplikacji importu (wzór modułu `strategic-brain`).
- Silnik czystych wyliczeń (TDD, oddzielony od Prisma i renderu):
  `apps/tenant-runtime/src/dokumenty/rcp.util.ts` (parowanie zdarzeń,
  agregacja ewidencji, strefa `Europe/Warsaw` z jawną obsługą DST),
  `overtime.util.ts` (nadgodziny dobowe 50% i średniotygodniowe 100%
  **bez double-countingu**, praca nocna/niedzielna/świąteczna 100%,
  ostrzeżenie o limicie rocznym bez blokady) oraz `kedu.util.ts`
  (mapowanie na strukturę bloków DRA/RCA/RSA).
- Warstwa render (oddzielona od wyliczeń):
  `render/pdf.renderer.ts` (PDF, pdfkit, ze stałym znakiem wodnym
  „WERSJA DEMO --- dane syntetyczne --- nie do obrotu prawnego / nie do
  wysyłki ZUS") oraz `render/kedu-xml.renderer.ts` (szkielet XML KEDU z
  elementem `<demo>true</demo>` i escapowaniem znaków specjalnych).
- Serwis i kontroler: `dokumenty.service.ts` + `dokumenty.controller.ts`
  udostępniające API `/api/dokumenty/*` (lista metadanych, `mine`,
  `generuj`, `:id`, `:id/pobierz`, `:id/zatwierdz`) za łańcuchem
  uwierzytelnienie (Keycloak JWT) → kontekst tenanta → autoryzacja RBAC
  (scope liczony w serwisie) → audyt. Kontrolowane odszyfrowanie PESEL
  **wyłącznie** przy dokumencie ZUS, z wpisem audytowym ids-only.
- Aplikacja referencyjna: ekran `app/(tenant)/dokumenty/page.tsx` +
  `lib/dokumenty.ts` (proxy do rzeczywistego API, kalkulatory
  prezentacji, testy vitest), z listą dokumentów, formularzem generacji,
  podglądem/pobraniem oraz stałym banerem RODO (art. 22).
- Dane demonstracyjne: `scripts/seed-demo-dokumenty.sql` --- idempotentny
  seed zdarzeń RCP dla podzbioru istniejących pracowników, pokrywający
  scenariusze (normalny czas, nadgodziny dobowe/średniotygodniowe, praca
  nocna/niedzielna, przypadek do ZUS, anomalie null-policy), **bez
  naruszania kotwic demo** (36 pracowników, 832 zmiany).

Kryteria akceptacji: 14 kryteriów **DOK-1 … DOK-14** (SPEC §9), w całości
odwzorowanych na realne testy w załączonej macierzy
(`macierz-pokrycia-dokumenty.md`).

Dowody: 84 testy jednostkowe i integracyjne modułu (100% zaliczonych), w
tym dedykowany test granicy braku wysyłki (`dokumenty-no-send.spec.ts`
--- statyczny skan: enum `DocumentStatus` bez stanu `SENT/EXPORTED_EXTERNAL`
oraz brak jakiegokolwiek wywołania sieciowego), test braku
double-countingu nadgodzin (`overtime.util.spec.ts`), test kontrolowanego
odszyfrowania PESEL z audytem ids-only i test braku PII w
`computedFacts`/`audit_log` (`dokumenty.service.spec.ts`).

## 3.2. Moduł Analityk HR (Agent AI --- analiza, trajektoria, rekomendacje)

Cel zadania w ramach kamienia milowego:

Moduł Analityk HR to strategiczny mózg kadrowy HRobot: warstwa, która
ciągle i autonomicznie --- bez ręcznego wyzwalania --- mierzy cztery
wymiary pracy każdego pracownika (Wydajność, Terminowość, Jakość,
Rozwój), wylicza trajektorię rozwoju w czasie i sama z siebie dostarcza
wyjaśnialne rekomendacje strategiczne: sygnał retencji per pracownik
(`UTRZYMAC`/`OBSERWOWAC`/`RYZYKO`/`INWESTOWAC`) oraz rekomendację
rekrutacji per lokalizacja (`WZNOW`/`WSTRZYMAJ`/`UTRZYMAJ`). Każda
rekomendacja jest **analizą, nie akcją** --- nieodwracalną decyzję
kadrową zawsze zatwierdza człowiek (art. 22 RODO).

Co zbudowano (mapowanie na realne pliki/API):

- Backend `apps/tenant-runtime/src/strategic-brain/` (prefiks API
  `/api/strategic-brain/*`, za `RbacGuard`): model danych greenfield
  (`EmployeePerformanceSnapshot` jako cache, `RecruitmentRecommendation`
  jako niemutowalne zdarzenia z `replacesRecommendationId`,
  `PerformanceConfig` z wagami i progami), silnik scoringu (czyste
  funkcje `scoring.util.ts`: cztery wymiary, `compositeScore` z
  renormalizacją wag, `retentionSignal` poziom×trend, `confidence`
  multiplikatywna, `developmentSlope` regresją liniową) oraz scheduler
  nocny (`@Cron`, per tenant, `pg_try_advisory_xact_lock`, feed PULL).
- Kluczowe granice zgodności: kontrola wejścia scoringu jako **allowlista**
  (`buildScoringInput()` rzuca na każdy klucz spoza listy metryk
  operacyjnych --- dowód braku proxy), strukturalne wykluczanie okien
  L4/urlop/onboarding z trendu oraz **statyczny test granicy zapisu**
  (`write-boundary.spec.ts`) dowodzący, że moduł nigdy nie mutuje stanu
  kadrowego/grafikowego.
- Aplikacja referencyjna `app/(tenant)/analiza/` + komponenty
  `strategic-brain/*` (heatmapa, karta pracownika ze sparkline
  trajektorii, panel rekrutacji, stały baner „Rekomendacja AI ---
  decyzję podejmuje człowiek").

Kryteria akceptacji: 13 kryteriów **AN-1 … AN-13**
(`docs/HRobotDocs/l-modul-analityk-hr.md` §9), w całości odwzorowanych na
realne testy w macierzy (`macierz-pokrycia-analityk-hr.md`).

Dowody: 134 testy jednostkowe i integracyjne modułu (100% zaliczonych)
oraz **weryfikacja na żywym środowisku demo**
(`docs/demo/strategic-brain-live-verification.md`, tenant
`hrobot_t_900d948b`): macierz RBAC odtworzona 1:1 na trzech realnych
kontach Keycloak (`demo`/`manager.demo`/`pracownik.demo`), 6 profili
trajektorii pokazujących jednocześnie przeciwstawne sygnały (np. Marcin
Dąbrowski 45/+6,80 → `INWESTOWAC` vs Rafał Adamczyk 66/−6,70 →
`RYZYKO`), 4 rekomendacje rekrutacyjne jednocześnie i czysty (wolny od
PII) `audit_log`.

## 3.3. Agent Głosowy (konwersacyjny asystent, język polski)

Cel zadania w ramach kamienia milowego:

Agent Głosowy pozwala pracownikowi wykonać najczęstsze operacje kadrowe
w języku naturalnym --- zamiast wypełniać formularz, wydaje polecenie
(np. „chcę urlop od 1 do 5 sierpnia", „zgłoś L4 od jutra", „jaki mam
grafik jutro"). Agent rozpoznaje intencję z **zamkniętego, skończonego**
zbioru komend, wypełnia encje (daty, typ wniosku) i wykonuje operację na
istniejącym API platformy w imieniu użytkownika --- przy czym każda akcja
zapisująca przechodzi przez **bramkę potwierdzenia człowieka**, a każde
rozpoznanie spoza zbioru lub o niskiej pewności kończy się **twardym
fallbackiem do formularza tekstowego** (nigdy „ciche" wykonanie).

Co zbudowano (mapowanie na realne pliki/API):

- Backend `apps/tenant-runtime/src/agent-glosowy/`: parser intencji
  `intent.util.ts` (regułowy, **bez LLM** --- deterministyczny i
  audytowalny; normalizacja dat PL „dziś/jutro/piątek/1 sierpnia" → ISO,
  próg pewności), serwis `voice-command.service.ts` z rozdziałem
  `interpret` (opisuje, nigdy nie wykonuje) i `execute` (wykonuje dopiero
  po `confirm: true` dla intencji zapisujących), kontroler
  `agent-glosowy.controller.ts` z dwoma trasami tekstowymi
  `POST /api/agent-glosowy/interpret` i `POST /api/agent-glosowy/execute`.
- Reużycie realnych serwisów bez eskalacji uprawnień: `execute` wywołuje
  istniejące `LeaveService.createRequest` (wnioski urlopowe/L4) oraz
  `GrafikService.listShifts` (odczyt grafiku), przekazując **ten sam
  aktor** (token użytkownika) --- wszystkie reguły RBAC/maker-checker
  egzekwuje istniejące API, agent jest wyłącznie tłumaczem głos/tekst →
  REST.
- Granica STT (mowa→tekst) jako **udokumentowany, pozamodułowy szew**
  (`stt.port.ts`): moduł działa w pełni przez tekst; rekomendowany
  adapter to lekki serwis Python `faster-whisper small` (PL) na CPU
  (RODO/UE, praca offline), zgodnie z raportem PoC
  (`docs/superpowers/specs/2026-07-21-agent-glosowy-poc.md`).
- Aplikacja referencyjna: ekran `app/(tenant)/asystent/page.tsx` +
  `lib/agent-glosowy.ts` (z testami vitest), z jawnym komunikatem
  „rozmawiasz z asystentem AI", ekranem potwierdzenia przed akcją
  zapisującą i formularzem-fallbackiem.

Kryteria akceptacji: komendy **K1** (wniosek urlopowy), **K2** (L4),
**K3** (mój grafik) + bramka potwierdzenia człowieka + wymogi EU AI Act,
odwzorowane na realne testy w macierzy
(`macierz-pokrycia-agent-glosowy.md`).

Dowody: 26 testów modułu (100% zaliczonych), w tym testy potwierdzające,
że `interpret` nigdy nie dotyka realnego serwisu, że `execute` odmawia
zapisu bez `confirm: true` (i wtedy nie loguje niczego), że L4 mapuje się
na `ZWOLNIENIE_LEKARSKIE` z audytem ids-only, że odczyt grafiku nie
przechodzi w zapis, oraz że każda interpretacja niesie notę
transparentności AI (`voice-command.service.spec.ts`,
`intent.util.spec.ts`, `agent-glosowy.controller.spec.ts`).

# 4. Zgodność, bezpieczeństwo i RODO / EU AI Act

Rozwiązania KM3 kontynuują przyjęty w projekcie model „privacy by
design" (RODO) i przygotowują platformę do wymagań EU AI Act dla systemów
wspierających decyzje kadrowe. Szczegółowa analiza zgodności znajduje się
w dokumencie [`docs/HRobotDocs/m-zgodnosc-eu-ai-act.md`](../HRobotDocs/m-zgodnosc-eu-ai-act.md).

- [Nadzór człowieka i granica art. 22 RODO:]{.lbl} żaden z trzech modułów
  nie podejmuje w pełni zautomatyzowanej decyzji kadrowej. Analityk HR
  wyłącznie rekomenduje (decyzję loguje `acknowledgedByUserId`), Moduł
  Dokumenty wymaga zatwierdzenia nadgodzin/ZUS przez człowieka i **nie
  wysyła nic na zewnątrz**, Agent Głosowy wykonuje akcje zapisujące
  dopiero po jawnym potwierdzeniu. Granice te są egzekwowane testami
  architektonicznymi (granica zapisu Analityka, granica braku wysyłki
  Dokumentów, bramka `confirm` Agenta).
- [Transparentność (EU AI Act):]{.lbl} systemy konwersacyjne jawnie
  informują „rozmawiasz z asystentem AI"; rekomendacje AI mają stały baner
  „decyzję podejmuje człowiek"; każda propozycja Analityka jest
  wyjaśnialna (rozbita na czynniki).
- [Minimalizacja i ochrona danych wrażliwych:]{.lbl} PESEL szyfrowany w
  spoczynku (jak w KM1), odszyfrowywany kontrolowanie **wyłącznie** na
  potrzeby dokumentu ZUS i tylko za wpisem audytowym; ewidencja i
  nadgodziny liczone bez odszyfrowania PESEL (SAFE_SELECT). Nagranie głosu
  traktowane jako dane osobowe --- stąd rekomendacja lokalnego STT (dane w
  UE, brak persystencji audio domyślnie, brak profilowania
  biometrycznego/emocji).
- [Audyt ids-only i append-only:]{.lbl} wszystkie operacje o znaczeniu
  kadrowym logowane są payloadami złożonymi z samych identyfikatorów i
  liczb (bez PII); `audit_log` jest niezmienny (trigger DB blokuje
  UPDATE/DELETE). Rekomendacje i dokumenty są modelami append-only.
- [Izolacja i rozliczalność:]{.lbl} fizycznie osobna baza per tenant;
  tożsamość tenanta wyłącznie z tokenu SSO; testy automatyczne izolacji
  tenantów.

# 5. Ograniczenia realizacji demonstracyjnej (uczciwość)

Zgodnie z przyjętą w projekcie zasadą jawności zakresu, poniżej wskazano
świadome ograniczenia etapu demonstracyjnego --- tak, aby żaden element
nie był traktowany jako produkcyjny ponad swój faktyczny stan:

- [Wartości prawne są poglądowe.]{.lbl} W Module Dokumenty stawki, progi i
  formaty zależne od polskiego prawa pracy i przepisów ZUS (normy czasu
  pracy, dodatki 50%/100%, pora nocna, kalendarz świąt, wersja schematu
  KEDU, okresy retencji) są **wartościami poglądowymi oznaczonymi „demo"**
  i wymagają weryfikacji przez radcę prawnego / specjalistę
  kadrowo-płacowego po stronie 4Mobility/App Pro. Silnik czyta je z
  konfiguracji (`dokumenty.config.ts`), nie ma ich zahardkodowanych.
- [Brak wysyłki ZUS.]{.lbl} Eksport ZUS/Płatnik (KEDU) na etapie demo to
  **szkielet strukturalny** (walidowalny strukturalnie XML DRA/RCA/RSA +
  czytelny PDF), oznaczony znakiem wodnym i elementem `<demo>true</demo>`;
  brak podpisu kwalifikowanego, brak integracji z Płatnikiem, brak
  jakiejkolwiek ścieżki „wysyłki na zewnątrz" (potwierdzone testem
  `dokumenty-no-send.spec.ts`).
- [STT jako runtime.]{.lbl} W Agencie Głosowym warstwa rozpoznawania mowy
  (audio→tekst) to osobny, pozamodułowy adapter; model
  (`faster-whisper small`, ~490 MB) jest pobierany i uruchamiany w czasie
  działania (runtime) i nie jest częścią pakietu testów jednostkowych.
  Testowany i w pełni działający jest natomiast cały „mózg" agenta ---
  parser intencji, bramka potwierdzenia i most do API --- dostępny przez
  tekst niezależnie od STT.
- [Dane syntetyczne.]{.lbl} Wszystkie moduły działają na danych
  demonstracyjnych/syntetycznych odwzorowujących organizację Odbiorcy;
  kotwice demo (36 pracowników, 832 zmiany) pozostają nietknięte.

# 6. Wskaźnik odbioru

Wskaźnik realizacji KM3 --- **liczba wdrożonych modułów bazowych: 3 szt.**
--- został **osiągnięty**. Wdrożono trzy moduły bazowe: Moduł Dokumenty,
Agenta AI „Analityk HR" oraz Agenta Głosowego. Każdy z modułów został
zaimplementowany na poziomie modelu danych, silnika/serwisów, API oraz
interfejsu użytkownika działającego na rzeczywistym API platformy, a
kryteria akceptacji (DOK-1..DOK-14, AN-1..AN-13, komendy K1/K2/K3 z
bramką człowieka) są w całości odwzorowane na realne testy automatyczne
(łącznie 244 dedykowane testy w ramach zielonego pakietu 828 testów
backendu i ~355 testów aplikacji referencyjnej).

# 7. Podsumowanie końcowe {#podsumowanie-końcowe .page-break}

Prace trzeciego kamienia milowego projektu HRobot.AI zrealizowano zgodnie
z zatwierdzonym harmonogramem; kamień jest przygotowany do odbioru w
terminie do 2026-08-20. Osiągnięto wskaźnik KM3 --- wdrożono trzy moduły
bazowe: Moduł Dokumenty (ewidencja czasu pracy, nadgodziny bez
double-countingu, szkielet KEDU bez wysyłki, PESEL-tylko-ZUS za audytem),
Agenta AI „Analityk HR" (ciągła autonomiczna analiza czterech wymiarów,
wyjaśnialna trajektoria poziom-vs-trend, rekomendacje retencji i
rekrutacji z twardą granicą decyzji człowieka, potwierdzone weryfikacją
na żywym tenancie) oraz Agenta Głosowego (zamknięty zbiór komend PL, most
do realnego API bez eskalacji uprawnień, bramka potwierdzenia i fallback
tekstowy). Całość pokryto testami automatycznymi (244 dedykowane testy w
ramach 828 testów backendu i ~355 testów aplikacji referencyjnej), a
platforma konsekwentnie realizuje model zgodności RODO i przygotowanie do
EU AI Act (nadzór człowieka, transparentność, minimalizacja, audyt
ids-only, izolacja tenantów).

Kamień Milowy 3 domyka zakres bazowy projektu HRobot.AI --- łącznie
wszystkich trzech kamieni --- dostarczając komplet modułów kadrowych,
grafikowych, analitycznych, dokumentowych i konwersacyjnych na wspólnej,
wielodostępowej platformie SaaS klasy Enterprise.

# 8. Wykaz załączników

  Nr           Dokument
  ------------ -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  **Zał. 1**   Macierz pokrycia kryteriów akceptacji Modułu Dokumenty (DOK-1..DOK-14) testami --- `macierz-pokrycia-dokumenty.md`
  **Zał. 2**   Macierz pokrycia kryteriów akceptacji Modułu Analityk HR (AN-1..AN-13) testami --- `macierz-pokrycia-analityk-hr.md`
  **Zał. 3**   Macierz pokrycia komend i wymogów EU AI Act Agenta Głosowego testami --- `macierz-pokrycia-agent-glosowy.md`
  **Zał. 4**   Analiza zgodności RODO / EU AI Act --- `docs/HRobotDocs/m-zgodnosc-eu-ai-act.md`
  **Zał. 5**   Weryfikacja na żywym środowisku (Analityk HR) --- `docs/demo/strategic-brain-live-verification.md`

::: keep
Raport sporządził:

**Tomasz Wilk**\
CTO\
APP PRO sp. z o.o.
:::
