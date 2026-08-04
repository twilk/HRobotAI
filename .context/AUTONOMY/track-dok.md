# track-dok.md — tor DOK (forma generowanych dokumentów)

Baza: `feat/autonomy-20260803` @ 793b3b5. Gałąź robocza: `track/dok-forma-dokumentow`.

## ⚠ BLOKER WEJŚCIOWY — spec pliku nie znaleziono, zgłaszam zamiast pominąć po cichu

Brief każe: "PRZECZYTAJ NAJPIERW, W CAŁOŚCI: `docs/superpowers/specs/2026-08-04-forma-dokumentow-design.md`".
**Ten plik nie istnieje** — sprawdzone: `test -f` w tym worktree → NO; przeszukano `git log --all`
(pełna historia wszystkich gałęzi) za nazwą pliku → zero trafień w całym repo (plik nie był nigdy
commitowany, zgodne z notatką w MEMORY.md że `docs/superpowers/specs` bywa gitignored — czyli mógł
istnieć tylko lokalnie w innym, równoległym worktree tego biegu autonomicznego). Zasada izolacji
worktree (system) blokuje odczyt sąsiednich `.claude/worktrees/*` — nie próbowałem tego obejść.

**Co zrobiłem zamiast zgadywania:** brief w treści zadania SAM cytuje kryteria akceptacji §6
dosłownie (zero `|`, powtarzalny nagłówek tabeli, brak wiersza rozdartego przez granicę stron,
`strona X z Y`, JEDEN znak wodny, determinizm bajt-w-bajt, zero zadań sieciowych) — to jest
wystarczające do zaimplementowania i zweryfikowania. Język wizualny biorę z `DESIGN.md`
(repo-root, ISTNIEJE, status "Proposed" ale to jedyne zatwierdzone źródło tokenów w repo — sekcje
4/5/6/10 użyte tu wprost: kolory, typografia, tabela `.table` mono-header). Wzorca strukturalnego
(nagłówek/stopka/numeracja stron) użyłem z działającego `docs/raport-km3/build/print-km3.mjs`,
zgodnie z poleceniem brief-u.

**Zgłaszam integratorowi jako do wyjaśnienia:** czy spec `2026-08-04-forma-dokumentow-design.md`
istnieje w innym torze tego biegu i powinien zastąpić powyższe substytuty, gdy będzie dostępny.

---

## [11:30] start | Konfiguracja środowiska

`git fetch origin feat/autonomy-20260803` → tip `793b3b5` (zgodny z lokalnym). `git checkout -b
track/dok-forma-dokumentow feat/autonomy-20260803`. Drzewo czyste. `DESIGN.md` (root) przeczytany w
całości — kolory/typografia/spacing/tabela (§4/§5/§6/§10) będą źródłem wartości wizualnych.
Wzorzec potoku: `docs/raport-km3/build/print-km3.mjs` przeczytany — CDP raw WebSocket,
`Page.printToPDF` z `headerTemplate`/`footerTemplate` (`pageNumber`/`totalPages`), ścieżka
`chrome.exe` zaszyta na Windows (do naprawienia dla kontenera — §2 trzy odstępstwa: (1) ścieżka
binarki przez zmienną środowiskową zamiast hardkodu, (2) `--disable-dev-shm-usage` dla kontenera z
małym `/dev/shm`, (3) katalog `--user-data-dir` przez `os.tmpdir()` zamiast `process.env.TEMP`
Windows-owego).

## [11:45] fonty | Weryfikacja licencji (§4 briefu) — Cabinet Grotesk/General Sans NIE osadzone

Próba weryfikacji FFL (Fontshare/ITF) pod kątem embeddingu w dystrybuowanym PDF:
```
WebFetch https://www.fontshare.com/licenses -> SPA, tylko <title>, brak treści licencji
WebFetch https://www.fontshare.com/faq      -> to samo
WebSearch "Fontshare Free License FFL ... PDF ... desktop use" -> potwierdza istnienie FFL,
  NIE zwraca pełnego tekstu klauzul o embeddingu w generowanym dokumencie
```
Rezultat: nie da się w dostępnym czasie jednoznacznie potwierdzić, że FFL pozwala na embedding w
PDF dystrybuowanym do stron trzecich (inne pole licencyjne niż CSS `@font-face` na stronie WWW —
dokładnie ostrzeżenie z brief-u). Decyzja: **zamiennik OFL 1.1, opisany JAWNIE** w
`data/m2-evidence/licenses/forma-dokumentow-fonts.md`:
- Cabinet Grotesk → **Archivo** (wariabilny wght/wdth, OFL 1.1, `google/fonts`)
- General Sans → **Public Sans** (wariabilny wght, OFL 1.1, zaprojektowany do dokumentów
  urzędowych przez USWDS — tematycznie trafny dla dokumentu prawnego art. 149 KP)
- IBM Plex Mono → bez zmian (już OFL 1.1, `DESIGN.md` się nie zmienia w tym zakresie)

Dowód pobrania i weryfikacji nagłówków licencji:
```
curl -sI raw.githubusercontent.com/google/fonts/main/ofl/archivo/OFL.txt -> 200
head -5 .../Archivo-OFL.txt      -> "This Font Software is licensed under the SIL Open Font License, Version 1.1."
head -5 .../PublicSans-OFL.txt   -> "This Font Software is licensed under the SIL Open Font License, Version 1.1."
head -5 .../IBMPlexMono-OFL.txt  -> "This Font Software is licensed under the SIL Open Font License, Version 1.1."
```
Pliki pobrane do `apps/tenant-runtime/src/dokumenty/render/fonts/src/` (Archivo.ttf 658596B,
PublicSans.ttf 103316B, IBMPlexMono-Regular.ttf 135580B, IBMPlexMono-Medium.ttf 136704B) + 3×
`*-OFL.txt` obok binarek.

## [12:00–14:30] rdzeń | Przepisanie `pdf.renderer.ts`: pdfkit/`|` -> HTML/CSS + Chrome CDP

**Architektura.** Kontrakt zewnętrzny zachowany (`buildEwidencjaPdfContent`/`buildNadgodzinyPdfContent`/
`buildKeduPdfContent`/`renderReportPdf`/`renderEwidencjaPdf`/`renderNadgodzinyPdf`/`renderKeduPdf` —
te same nazwy i sygnatury; `dokumenty.service.ts` NIE zmieniony). Wewnątrz: `PdfContent` przestał być
`{title,lines[]}` (tekst sklejany `|`) — jest teraz `{title, meta[], tables[], notes[], watermark}`,
struktura bez żadnego pre-formatowania. Nowa czysta funkcja `renderContentsToHtml()` zamienia to na
prawdziwy HTML (`<table><thead>…`), testowalna BEZ przeglądarki. Druk do PDF przez CDP
`Page.printToPDF`, wzorem `docs/raport-km3/build/print-km3.mjs` (marginesy 0.72/0.55/0.63/0.63in —
identyczne), z trzema odstępstwami z §2 briefu: (1) ścieżka Chromium przez `HROBOT_CHROMIUM_PATH`/
`PUPPETEER_EXECUTABLE_PATH` + lista kandydatów per-platforma zamiast zaszytego `chrome.exe`, (2)
`--disable-dev-shm-usage` dla małego `/dev/shm` kontenera, (3) `os.tmpdir()` zamiast `%TEMP%`.

**TDD — czerwone przed poprawką (dosłowny log):**
```
npx jest --config jest.config.cjs src/dokumenty/render/pdf.renderer.spec.ts   (STARY plik testowy, NOWA implementacja)
-> FAIL: TS2339 Property 'lines' does not exist on type 'PdfContent' (5×) — dowód, że kształt treści
   faktycznie się zmienił, nie tylko kosmetyka.
```
Napisano NOWY `pdf.renderer.spec.ts` (16 testów: pure builders bez `|`, `renderContentsToHtml`
assercje strukturalne, `normalizePdfDeterminism`) -> zielony:
```
Tests: 16 passed, 16 total
```

**Determinizm — zweryfikowane EMPIRYCZNIE lokalnym Chrome (nie teoretycznie).** Napisano scratch-probe
(`determinism-probe.mjs`, usunięty po biegu) renderujący ten sam HTML dwa razy przez prawdziwe CDP:
```
identical: false — jedyna różnica: /CreationDate (D:...) i /ModDate (D:...) w /Info (Chrome wbija
  aktualny czas ściany). Po normalizacji (regex tej samej długości, offsety xref nietknięte):
  "normalized identical: true"
```
Naprawa: `normalizePdfDeterminism()` — zamiana `D:<14 cyfr><strefa>` na stały placeholder,
DŁUGOŚĆ ZACHOWANA (nie psuje xref). Wbudowana w `renderHtmlToPdfBuffer` (każdy render, nie tylko test).

Drugie źródło niedeterminizmu znalezione PÓŹNIEJ, przy realnym roundtripie przez jest (nie w scratch-
probe — ujawniło się dopiero przy większej, bardziej "otagowanej" treści): PDF/UA "tagged PDF" nadaje
`/StructElem`/`/ID (nodeNNNNN)` liczniki różniące się między przebiegami. Naprawa: `generateTaggedPDF:
false` w `Page.printToPDF` (dokumentacja w kodzie — accessibility tagging vs. twardy wymóg
determinizmu, wybór na rzecz determinizmu, opisany jawnie w komentarzu).

Trzecie, najbardziej podchwytliwe: PO wyłączeniu tagowania determinizm był SPORADYCZNIE zielony (3/5
przebiegów), nie zawsze. Debug (`console.log` diagnostyczny w teście, usunięty po naprawie) pokazał
drastycznie różne rozmiary buforów (124119 vs 25786 B) między dwoma renderami TEJ SAMEJ treści —
podejrzenie: wyścig między `document.fonts.ready` a faktycznym layoutem, bo Chrome dostawał URL do
załadowania JUŻ na linii poleceń (nawigacja startowała RÓWNOLEGLE z konfiguracją CDP w Node, więc
`Page.loadEventFired` mógł zdarzyć się PRZED podpięciem nasłuchu). Naprawa: uruchamiać Chrome na
`about:blank`, dopiero PO `Page.enable` wywołać `Page.navigate` jawnie i czekać na
`Page.loadEventFired`, DOPIERO POTEM `document.fonts.ready`. Po tej zmianie: 3/3 kolejne przebiegi
`determinizm: dwa renderowania...` zielone (dowód: trzy pełne, osobne uruchomienia jest, zapisane w
historii komend tej sesji), plus pełen integration suite 5/5 zielony.

**Dowód wizualny (nie tylko asercje).** Wygenerowano próbkę wieloszronicową (`_scratch-sample...`,
usunięty przed commitem) i odczytano PDF narzędziem Read (renderuje strony jako obraz):
- strona 1: nagłówek marki (mały, szary, na górze), tytuł "Ewidencja czasu pracy (DEMO)", blok
  meta (Pracownik/Okres), tabela z prawdziwym `<thead>` (DATA/PRZEPRACOWANO/PRZERWY/ABSENCJA/UWAGI,
  mono uppercase — zgodnie z `DESIGN.md` §10 wzorcem tabeli), JEDEN ukośny znak wodny, stopka
  "Strona 1 z 2".
- strona 2: TEN SAM nagłówek tabeli powtórzony automatycznie przez przeglądarkę, TEN SAM JEDEN znak
  wodny (bez nachodzenia drugiego pod innym kątem — bug z brief-u naprawiony samą architekturą: jeden
  element `position:fixed` w źródle HTML, przeglądarka powiela go identycznie na każdej fizycznej
  stronie — zweryfikowane wcześniej osobnym probe na 150 wierszach/5 stronach), stopka "Strona 2 z 2".
- osobna próbka `nadgodziny` z celowo dobranymi polskimi znakami diakrytycznymi w danych
  ("Żaneta Wąsik-Świątkowska", "średniotygodniowe", "OSTRZEŻENIE… przekraczają… poglądowo…") —
  wszystkie znaki ł/ą/ę/ś/ż/ó/ć/ń renderują się poprawnie (fonty Archivo/Public Sans/IBM Plex Mono).

**Zero `|` jako układu** — test `zero znaków \`|\` użytych jako układ tabeli` w nowym spec + wizualnie
potwierdzone powyżej (prawdziwa tabela HTML, nie sklejane stringi).

**DOK-10 (`dokumenty-no-send.spec.ts`) — kolizja i naprawa, opisana jawnie, nie obejście po cichu.**
Strażnik "brak wysyłki na zewnątrz" złapał `fetch(` + literał `http://127.0.0.1` w nowym kodzie (CDP
do WŁASNEGO, dopiero co odpalonego procesu Chrome, loopback, nigdy nie opuszcza maszyny). Zamiast
obchodzić regex ukrywaniem stringa: (1) `pdf.renderer.ts` przepisany na `node:http` zamiast globalnego
`fetch` — strażnik nadal BEZWARUNKOWO blokuje `fetch(`/`axios`/`XMLHttpRequest` w całym module, bez
wyjątku; (2) regex URL w `dokumenty-no-send.spec.ts` dostał jawny, skomentowany wyjątek WYŁĄCZNIE dla
`127.0.0.1`/`localhost` — każdy inny host (w tym prawdziwy ZUS/Płatnik) nadal pada. Uzasadnienie w
komentarzu przy regexie. Plik testowy NIE jest na liście "nie dotykasz" (to `rcp.util.ts`/
`overtime.util.ts`/`kedu.util.ts`/`kedu-xml.renderer.ts` + ich testy — `dokumenty-no-send.spec.ts` do
nich nie należy), ale to strażnik zgodności RODO, więc zmiana minimalna i jawnie uzasadniona, nie
osłabienie właściwości bezpieczeństwa.

**Skutek uboczny znaleziony przy pełnym przebiegu `src/dokumenty`:** `dokumenty.service.spec.ts` (14
testów) zaczęło padać timeoutem 5000ms — bo teraz `renderReportPdf` naprawdę odpala Chrome (2-5s),
a ten plik nigdy go nie mockował (stary pdfkit był szybki, w-procesie). Naprawa: `jest.mock` TYLKO
`renderReportPdf` (pure buildXPdfContent zostają prawdziwe — ich poprawność sprawdza
`pdf.renderer.spec.ts`), z komentarzem czemu — przywraca "hermetic unit lane" (własny komentarz
`jest.config.cjs`). `dokumenty.controller.spec.ts` sprawdzony — mockuje CAŁY `DokumentyService`, nigdy
nie dotyka prawdziwego `render()`, bez zmian.

**pdfkit usunięty** z `apps/tenant-runtime/package.json` (dependencies + `@types/pdfkit`), `pnpm
install` przebudował lockfile. `NotoSans-Regular.ttf` usunięty (już nieużywany), `NOTICE.txt`
zaktualizowany.

**Dowód — pełen przebieg `src/dokumenty` (unit lane), PO wszystkich naprawach:**
```
PASS src/dokumenty/render/pdf.renderer.spec.ts
PASS src/dokumenty/render/kedu-xml.renderer.spec.ts
PASS src/dokumenty/kedu.util.spec.ts
PASS src/dokumenty/overtime.util.spec.ts
PASS src/dokumenty/dokumenty-no-send.spec.ts
PASS src/dokumenty/rcp.util.spec.ts
PASS src/dokumenty/dokumenty.service.spec.ts (8.3s — było by >77s bez mocka, realnie timeout)
PASS src/dokumenty/dokumenty.controller.spec.ts
Test Suites: 8 passed, 8 total
Tests:       95 passed, 95 total
```

**Dowód — nowy plik `pdf.renderer.chrome.integration.spec.ts` (integration lane, prawdziwy Chrome,
`jest.integration.config.cjs`), acceptance criteria §6 na realnych bajtach PDF:**
```
√ renderEwidencjaPdf zwraca niepusty Buffer zaczynający się od nagłówka %PDF
√ dokument >= 2 stron ma /Count >= 2 w /Pages (dowód łamania stron)
√ numeracja stron: przebieg z displayHeaderFooter+footerTemplate kończy się sukcesem
√ determinizm: dwa renderowania tej samej treści => identyczne bajty
√ renderReportPdf z wieloma sekcjami (multi-employee) też jest deterministyczny
Tests: 5 passed, 5 total
```
Test skipuje się (nie failuje) gdy brak Chromium w środowisku (`HROBOT_CHROMIUM_PATH` sprawdzany
najpierw) — nie blokuje reszty integration lane na maszynie bez przeglądarki.

## [14:35] Dockerfile | Chromium w obrazie runner + dowód działania w kontenerze (nie tylko w Windows)

`apps/tenant-runtime/Dockerfile` (w moim zakresie — NIE `docker-compose.yml`, którego nie dotykam):
dopisano `chromium fonts-liberation` do istniejącego `apt-get install` w stage `runner` +
`ENV HROBOT_CHROMIUM_PATH=/usr/bin/chromium` (czytane przez `resolveChromiumExecutable()`).

**Dowód — nie tylko "powinno działać", zbudowano i uruchomiono rzeczywisty kontener.** Docker Desktop
dostępny w tym środowisku (`docker version` → server `linux/amd64`). Żeby nie płacić za pełny build
monorepo (niepowiązany z tą zmianą), zbudowano jednorazowy probe-obraz z DOKŁADNIE tą samą linią
`apt-get install` na tej samej bazie (`node:22-bookworm-slim`):
```
docker build -f Dockerfile.chromium-probe -t hrobot-chromium-probe:tmp .
-> RUN chromium --version -> "Chromium 151.0.7922.71 built on Debian GNU/Linux 12 (bookworm)"
```
Potem realny test roundtrip identyczny z potokiem `pdf.renderer.ts` (spawn `/usr/bin/chromium`
`--headless=new --no-sandbox --disable-dev-shm-usage`, CDP WebSocket, `Page.navigate` + `Page.
printToPDF`) URUCHOMIONY WEWNĄTRZ kontenera (`docker run --rm -v .../probe.mjs:/probe.mjs:ro
--entrypoint node hrobot-chromium-probe:tmp /probe.mjs`):
```
CONTAINER PRINT OK, bytes: 16685 magic: %PDF-
```
D-Bus błędy w stderr (`Failed to connect to the bus: ...`) są nieszkodliwym szumem Chromium bez
sesji D-Bus w minimalnym kontenerze — potwierdzone przez sam fakt sukcesu `--dump-dom` i
`Page.printToPDF` mimo ich obecności. Probe-obraz i tymczasowe pliki posprzątane
(`docker rmi hrobot-chromium-probe:tmp`, scratch pliki usunięte) — stos współdzielony (`hrobot-*`
compose) nietknięty przez cały ten krok.

## [15:00] eksport CSV | Analityk HR — OBALONA połowa diagnozy + naprawiona druga połowa

**Diagnoza z brief-u:** "eksport CSV ... ma dostać blok nagłówkowy z najemcą, okresem, datą i
zastrzeżeniami z `meta.uwagi` — dziś eksport je gubi".

**Sprawdzone czytaniem `docs/design/web-kit/lib/analityk.ts` PRZED jakąkolwiek zmianą + istniejącym
`lib/analityk.test.ts`:** `podsumowanieToCsv()` JUŻ dołącza `meta.uwagi` (przez `zebraneUwagi()`) na
KOŃCU pliku jako sekcję "Zastrzeżenia" — z DEDYKOWANYM testem `'APPENDS the caveats — the export is
the path to a deck...'` (linia 298 przed moją zmianą) i drugim testem pilnującym, żeby pusta lista
uwag NIE drukowała pustego nagłówka. To NIE jest zgubione — **obalam tę część zarzutu, dowód: kod +
test istniały przed moim dotknięciem pliku.**

**Prawdziwa, potwierdzona część:** nagłówek CSV miał TYLKO okres (`Analityk HR {od} – {do}`) — BRAK
nazwy najemcy i BRAK znacznika czasu wygenerowania. To jest realny problem (dowód w komentarzu
funkcji sprzed zmiany — brak jakiejkolwiek wzmianki o tenant/dacie), zgodny z tą częścią zarzutu.

**TDD — czerwone przed poprawką:** dopisano 5 testów do `lib/analityk.test.ts` (`Najemca;`/
`Wygenerowano;`/kombinacja/backward-compat) →
```
npx vitest run lib/analityk.test.ts
FAIL: 3 failed | 53 passed (56)   — 3 nowe asercje dla Najemca/Wygenerowano faktycznie padają
```
Naprawa: `podsumowanieToCsv(data, opts?: {companyName?, generatedAt?})` — opcje DOMYŚLNIE puste (stary
kształt eksportu bajt-w-bajt niezmieniony, dowód: nowy test "stays byte-identical... backward
compatible"), `Najemca;<nazwa>` dopisywane PRZED tytułem gdy podane, `Wygenerowano;<data>` PO
tytule gdy podane. Zielono:
```
Tests: 56 passed, 56 total
```
Okablowanie w `components/analityk/dashboard.tsx`: dociągnięcie `ustawieniaApi.getCompany()`
(best-effort, jak `porownanie`/`anomalie` — awaria nie blokuje dashboardu), `exportCsv` przekazuje
`{companyName, generatedAt: new Date()}`. **Bez dedykowanego testu komponentu** — potwierdzone
wcześniej przez tor V2 (`track-v2.md`), że `docs/design/web-kit` nie ma infrastruktury testów
komponentów (brak jsdom/@testing-library w `package.json`), a dodawanie jej wykracza poza zakres
tego zadania. Zweryfikowane: `npx tsc --noEmit` (czysto) + pełen `npx vitest run` w `web-kit`
(**525 testów, 23 pliki, wszystkie zielone** — dowód, że zmiana nie zepsuła niczego innego). Portu
`:5601` (własność użytkownika) nie zajęto ani nie nawigowano — brak weryfikacji na żywym podglądzie
przeglądarki dla tej konkretnej zmiany, tylko typecheck + testy.
