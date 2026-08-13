# Licencje fontów osadzanych w PDF ewidencji/nadgodzin/KEDU (tor DOK)

**Data ustalenia:** 2026-08-04
**Kontekst:** Naprawa formy generowanych dokumentów (art. 149 KP — ewidencja czasu pracy). Nowy
potok renderujący (`apps/tenant-runtime/src/dokumenty/render/pdf.renderer.ts`) buduje HTML/CSS i
drukuje go do PDF przez Chrome DevTools Protocol (`Page.printToPDF`). Fonty muszą być osadzone
**lokalnie** (żadnych zadań sieciowych przy renderowaniu — kryterium akceptacji), więc trafiają
bajt-w-bajt do wnętrza wygenerowanego pliku PDF. To jest **osadzenie w dokumencie dystrybuowanym
do stron trzecich** (pracownik, kadry, potencjalnie PIP/ZUS), a nie wyświetlenie na stronie WWW —
inne pole licencyjne, patrz niżej.

## Problem z pierwotnym wyborem (Cabinet Grotesk + General Sans, `DESIGN.md` §4)

`DESIGN.md` wskazuje **Cabinet Grotesk** i **General Sans** jako fonty systemu projektowego
(Fontshare / Indian Type Foundry, licencja "Fontshare Free License", FFL). Próbowano zweryfikować
dokładny tekst FFL pod kątem osadzania w generowanych, dystrybuowanych dokumentach (nie tylko CSS
`@font-face` na stronie WWW):

- `WebFetch` na `fontshare.com/licenses` i `fontshare.com/faq` — strona jest SPA renderowanym przez
  JS; narzędzie dostało tylko pusty szkielet HTML (sam tag `<title>`), bez treści licencji.
- `WebSearch` — potwierdza istnienie FFL i że fonty ITF dostępne są przez CSS embed / offline kit /
  instalację desktopową, ale **nie zwrócił pełnego tekstu klauzul** o osadzaniu w dokumentach
  generowanych przez aplikację (PDF) ani o redystrybucji fonta wewnątrz pliku, który trafia do osób
  trzecich.

**Rezultat: NIE udało się w dostępnym czasie uzyskać jednoznacznego, cytowalnego potwierdzenia, że
FFL pozwala na embedding fonta w dystrybuowanym PDF-ie.** Zgodnie z poleceniem — "jeśli licencja nie
pozwala [lub nie da się tego ustalić] — zamiennik OFL o zbliżonym charakterze, wybór opisany
JAWNIE" — **nie zgaduję** i nie osadzam Cabinet Grotesk/General Sans bez weryfikowalnej podstawy.
Dla dokumentu o znaczeniu prawnym (ewidencja czasu pracy, art. 149 KP) ryzyko niejasnego statusu
licencyjnego fonta osadzonego w pliku, który może trafić do inspektora PIP, jest nieakceptowalne.

## Decyzja: zamienniki SIL OFL 1.1 (jawnie opisane)

| Rola (DESIGN.md) | Oryginał (Fontshare/ITF, FFL — status embeddingu w PDF NIEROZSTRZYGNIĘTY) | Zamiennik (SIL OFL 1.1 — embedding w dokumentach jednoznacznie dozwolony) | Uzasadnienie doboru |
|---|---|---|---|
| Display / nagłówki | Cabinet Grotesk (700/800) | **Archivo** (wariabilny, oś `wght` 100–900, oś `wdth`) | Grotesk o podobnym, pewnym siebie charakterze redakcyjnym; szerokości/wagi pokrywają 700/800 z DESIGN.md; Google Fonts / `google/fonts` repo, OFL 1.1 |
| UI / treść | General Sans (400/500/600) | **Public Sans** (wariabilny, oś `wght`) | Humanistyczny grotesk zaprojektowany przez USWDS **specjalnie do oficjalnych/rządowych dokumentów** — pasuje tematycznie do dokumentu o znaczeniu prawnym; OFL 1.1, Google Fonts |
| Warstwa maszynowa (ID, mono) | IBM Plex Mono (400/500) | **IBM Plex Mono — bez zmian** | IBM Plex jest już OFL 1.1 (Reserved Font Name "Plex", IBM Corp.) — brak problemu, zostaje jak w DESIGN.md |

**Nie zastąpiono** Space Grotesk/Inter/Roboto/system-ui — DESIGN.md §9 explicite zakazuje ich jako
display/body (anti-slop). Archivo i Public Sans nie są na tej liście zakazanych.

## Źródło i weryfikacja plików

Pobrane z kanonicznego repozytorium `google/fonts` (branch `main`), plik `OFL.txt` pobrany razem z
każdym fontem i zapisany obok binarki:

```
apps/tenant-runtime/src/dokumenty/render/fonts/src/Archivo.ttf          (658596 B, wariabilny wdth+wght)
apps/tenant-runtime/src/dokumenty/render/fonts/src/Archivo-OFL.txt
apps/tenant-runtime/src/dokumenty/render/fonts/src/PublicSans.ttf       (103316 B, wariabilny wght)
apps/tenant-runtime/src/dokumenty/render/fonts/src/PublicSans-OFL.txt
apps/tenant-runtime/src/dokumenty/render/fonts/src/IBMPlexMono-Regular.ttf (135580 B)
apps/tenant-runtime/src/dokumenty/render/fonts/src/IBMPlexMono-Medium.ttf  (136704 B)
apps/tenant-runtime/src/dokumenty/render/fonts/src/IBMPlexMono-OFL.txt
```

Każdy `OFL.txt` zaczyna się od nagłówka `SIL Open Font License, Version 1.1`, zweryfikowano
`head -5` na wszystkich trzech plikach (dosłowny tekst w logu toru, krok "fonty"). SIL OFL 1.1 pkt
1 explicite pozwala na "embedding" i redystrybucję fonta jako część dokumentu/oprogramowania, pod
warunkiem niesprzedawania samego fonta osobno i niezmieniania nazwy zarezerwowanej — oba warunki
spełnione (fonty NIE są sprzedawane osobno, tylko osadzone w wygenerowanym PDF-ie; nazwy
zarezerwowane niezmienione).

## Co NIE jest tu rozstrzygnięte (jawnie)

- Reszta systemu (`docs/design/web-kit`, marketing, ekrany aplikacji) nadal używa Cabinet Grotesk /
  General Sans przez CDN `@font-face` (wyświetlanie w przeglądarce, nie embedding w dystrybuowanym
  pliku) — TEGO nie zmieniam, poza zakresem toru DOK i poza plikami, które wolno mi dotykać. Ta
  notatka dotyczy WYŁĄCZNIE fontów osadzanych bajt-w-bajt w PDF-ach generowanych przez
  `pdf.renderer.ts`.
- Jeśli integrator albo właściciel DESIGN.md uzyska od Fontshare/ITF pisemne potwierdzenie, że FFL
  pozwala na embedding w dystrybuowanym PDF, można wrócić do Cabinet Grotesk/General Sans w tym
  jednym miejscu — do tego czasu PDF-y z art. 149 KP używają Archivo/Public Sans/IBM Plex Mono.
