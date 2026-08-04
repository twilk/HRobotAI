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
