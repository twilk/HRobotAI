# Kafelek zmiany: pełna treść bez dokładania miejsca

Data: 2026-08-13 · Moduł: Grafik · Branch: `feat/demo-4mobility`

Poprzedni krok (wdrożony, poza zakresem): sześć regułek CSS w `schedule-grid.tsx` — równe kolumny,
weekend, kolumna „dziś", zebra z podświetleniem wiersza, przyklejony nagłówek, wyciszony AUTO.

---

## 1. Zasada

Kafelek pokazuje to, **co się różni**. To, co jest wspólne dla całego widoku, mówi się raz —
w nagłówku.

Dzisiejszy kafelek robi odwrotnie: powtarza „Lotnisko Chop…" i „AUTO" po pięćdziesiąt razy na
ekranie, a informację, która naprawdę odróżnia jedną zmianę od drugiej — rolę — ucina.

Z tej zasady wynika całe rozwiązanie i dlatego **kafelek zostaje dwulinijkowy**. Wysokość wiersza
się nie zmienia.

## 2. Pomiary

Zmierzone na żywej aplikacji i na kroju z produktu (Canvas `measureText`, General Sans / IBM Plex
Mono z `app/fonts`):

| | 1500 px okna | 1280 px okna |
|---|---|---|
| kolumna dnia | 137 px | 116 px |
| miejsce na tekst w kafelku | **111 px** | **90 px** |

| napis | krój | szerokość |
|---|---|---|
| `06:00–14:00` | mono 11 | 73 px |
| `AUTO` / `RĘCZ` | mono 8,5 | 20 px |
| `KIEROWCA` / `OPERATOR` | mono 10,5 | 50 px |
| `SERWISANT` | mono 10,5 | 57 px |
| `KOORDYNATOR` | mono 10,5 | **69 px** |
| `KOORDYNATOR` | sans 11 | 81 px |
| `Warszawa Centrum` | sans 11 | 97 px |

Dwa wnioski, oba twarde:

**Linia 1 już dziś się nie mieści.** `73 + 4 + 20 = 97 px` przy dostępnych 90 px. Przy 1280 px
godzina i znacznik źródła zachodzą na siebie — to nie jest usterka, którą wprowadzam, tylko taka,
której dotąd nie widzieliśmy, bo zrzuty robiliśmy przy 1500 px.

**Rola mieści się sama, w mono.** 69 px przy 90 px dostępnych, z zapasem 21 px. W sansie zostałoby
9 px — za mało, żeby spać spokojnie. Mono jest zresztą w tym systemie krojem warstwy maszynowej:
tak są złożone nazwy dni, nagłówek „PRACOWNIK" i znacznik źródła. Rola do tego towarzystwa pasuje.

## 3. Co robię

```
┌───────────────────────────┐
│▌ 06:00–14:00              │   linia 1 — godziny, mono 11
│▌ OPERATOR                 │   linia 2 — rola, mono 10,5, wersaliki
└───────────────────────────┘
 ▲ pasek roli, 3 px
```

### 3.1 Lokalizacja wychodzi z kafelka — ODRZUCONE, patrz §9

W danych demo 1258 z 1558 zmian jest w jednym miejscu, 300 w drugim. Po włączeniu filtra jednostki
prawie zawsze zostaje jedno. Powtarzanie go w każdym kafelku to pięćdziesiąt kopii tej samej
informacji, która przez to nie mówi nic.

Zamiast tego: **dominująca lokalizacja widocznego tygodnia trafia do podtytułu** obok liczby zmian.
Kafelek pokazuje lokalizację **tylko wtedy, gdy różni się od dominującej** — i wtedy dostaje trzecią
linię. Wyjątek staje się widoczny, bo jest wyjątkiem.

- wszystko w jednym miejscu → podtytuł: `19 zmian · 38 zapotrzebowań · Lotnisko Chopina — Warszawa`,
  żaden kafelek nie nosi lokalizacji
- widok mieszany → podtytuł: `… · głównie Lotnisko Chopina — Warszawa`, a kafelki z pozostałych
  miejsc dostają trzecią linię ze skrótem

Nazwa skrócona pochodzi z mapy w `demo-locations.ts` (autorski `short`, nie cięcie stringa),
a pełna zostaje w `title`. `shortLoc()` i wielokropek znikają.

### 3.2 Źródło przestaje być słowem, staje się krawędzią

`AUTO` powtarza się na ekranie kilkadziesiąt razy i to on wypycha linię 1 poza kolumnę. Ta sama
informacja siedzi już w wyglądzie kafelka — wystarczy ją domknąć tak, żeby działała bez koloru:

| źródło | kafelek |
|---|---|
| AUTO | obramowanie **ciągłe** + tło `accent/[0.07]` (jak dziś) |
| ręczna | obramowanie **kreskowane** + tło `card-2` |

Ciągłe kontra kreskowane czyta się w skali szarości, na wydruku i przy daltonizmie. Kosztuje zero
pikseli. Legenda nad tabelą dostaje te same dwa wzory zamiast dwóch prostokątów — i to ona nosi
słowa „AUTO" i „ręczna".

### 3.3 Rola dostaje pasek

Lewa krawędź kafelka to pasek 3 px w kolorze przypisanym roli — ten sam dla każdej osoby w tej roli,
w całej aplikacji. Kolor nigdy nie jest jedynym nośnikiem: nazwa roli stoi obok, wypisana słowem.

| rola | token | hex |
|---|---|---|
| KOORDYNATOR | `navy` | `#0B1F3B` |
| KIEROWCA | `accent` | `#0C8FA3` |
| OPERATOR | `verified` | `#2E9E6B` |
| SERWISANT | `warn` | `#B8791F` |
| nieznana | `muted-2` | `#8A97A8` |

Żadnego nowego odcienia. `error` zostaje zarezerwowany dla błędów. Przyjmuję świadomie, że
`verified` i `warn` niosą gdzie indziej znaczenie statusowe — pasek 3 px obok wypisanej słowem roli
nie czyta się jako alert.

Legenda ról dochodzi do paska legend, tylko dla menedżera. Pracownik widzi w swoim grafiku jedną
rolę; legenda czterech byłaby tam szumem.

## 4. Bilans

| | dziś | po |
|---|---|---|
| wysokość kafelka | 34 px | **34 px** |
| wysokość wiersza z jedną zmianą | 57 px | **57 px** |
| linia 1 przy 1280 px | 97 px / 90 px — **zachodzi** | 73 px / 90 px |
| linia 2 przy 1280 px | ucięta wielokropkiem | 69 px / 90 px — **pełna** |
| powtórzeń „AUTO" na ekranie | ~50 | 0 (raz w legendzie) |
| powtórzeń nazwy lokalizacji | ~50 | 1 (w podtytule) |
| nowe tokeny w palecie | — | 0 |

Trzecia linia pojawia się wyłącznie na kafelkach spoza dominującej lokalizacji. W obecnych danych
z filtrem jednostki: zero. Bez filtra: 300 z 1558.

## 5. Gdzie — pliki

| plik | zmiana | rozmiar |
|---|---|---|
| `apps/web/lib/grafik-roles.ts` | **nowy.** `roleBar(role)` → klasa koloru paska, fallback `muted-2`. Bez Reacta, testowalny osobno. | ~25 linii |
| `apps/web/lib/demo-locations.ts` | mapa `Record<id, string>` → `Record<id, { name, short }>`; nowa `locationShort(id)`. **Uwaga:** `friendlyReason()` w tym samym pliku sięga do mapy wprost (`DEMO_LOCATION_NAMES[m.toLowerCase()]`) — musi dostać `.name`, inaczej w komunikatach solvera wyjdzie `[object Object]`. Jedyne miejsce poza modułem, które zna kształt mapy. | ~30 linii diffu |
| `apps/web/components/grafik/schedule-grid.tsx` | kafelek: pasek roli, rola w mono na linii 2, `AUTO`/`RĘCZ` usunięte, obramowanie kreskowane dla ręcznych, `shortLoc()` usunięte, warunkowa linia 3, nowy prop `dominantLocationId` | ~30 linii diffu |
| `apps/web/components/grafik/grafik-screen.tsx` | wyliczenie dominującej lokalizacji z `shiftsByCell`, dopisek w podtytule, legenda wzorów + legenda ról | ~30 linii |

Granice zostają czyste: `grafik-roles.ts` nic nie wie o siatce, `schedule-grid.tsx` nic nie wie
o tym, skąd bierze się kolor ani jak liczy się dominacja — dostaje gotowe `dominantLocationId`.

## 6. Czego nie robię

| poza zakresem | dlaczego |
|---|---|
| API i model danych | `role` i `lokalizacjaId` już przychodzą; to warstwa prezentacji |
| układ poniżej 1280 px | siatka 7 kolumn nie zmieści się na telefonie żadnym zestawem regułek — to drugi widok (dzienny), osobna decyzja |
| kolor kafelka wg pory dnia | konkurowałby z kolorem roli o tę samą krawędź |
| ujednolicenie `role` z `position` | `OPERATOR` w kafelku, `Operator` w wierszu, `Serwisant floty` gdzie indziej — realna niespójność słownika, ale w modelu, nie w CSS |

## 7. Ryzyka

**Znika słowo „AUTO" z kafelków.** W demo dla PARP to widoczny dowód, że grafik ułożyła maszyna.
Zostaje w legendzie i w podtytule wyniku solvera, ale na samym zrzucie ekranu będzie go mniej.
To jest jedyna rzecz w tym specu, którą warto rozważyć osobno — patrz decyzja niżej.

**Dominująca lokalizacja liczy się z widocznego tygodnia.** Zmiana tygodnia lub filtra jednostki
może zmienić podtytuł i sprawić, że kafelki dostaną albo stracą trzecią linię. To jest zamierzone
(kontekst ma się dostosowywać), ale wysokość wierszy nie jest wtedy stała między tygodniami.

**Kreskowane obramowanie przy 1 px jest delikatne.** Trzeba sprawdzić na zrzucie, czy czyta się
jako kreska, a nie jako artefakt renderowania. Jeśli nie — awaryjnie: lewy pasek roli kreskowany
zamiast obramowania całego kafelka.

## 8. Jak sprawdzę

1. `tsc --noEmit` i `eslint` czyste.
2. `grafik-roles.test.ts`: cztery role → cztery różne klasy; nieznana → fallback.
3. Playwright na żywym stacku, role `manager.demo` i `pracownik.demo`, okna **1280×800** i
   **1500×950**. Asercja mierzona, nie oglądana: dla każdego elementu tekstowego w każdym kafelku
   `scrollWidth <= clientWidth` — zero uciętego tekstu w całym zakresie.
4. Osobna asercja: `document.querySelectorAll('[class*=truncate]')` w obrębie kafelków = 0.
5. Zrzuty obu widoków w obu szerokościach do obejrzenia, zanim uznam rzecz za zrobioną.

---

**Decyzja do potwierdzenia:** czy „AUTO" ma zniknąć z kafelków.

- **Zniknąć** (rekomendacja) — linia 1 mieści się przy 1280 px z zapasem 17 px, ekran traci
  pięćdziesiąt powtórzeń tego samego słowa, informacja zostaje w kroju obramowania i w legendzie.
- **Zostać** — trzeba wtedy podnieść `min-w-[1000px]` do `1050px`, co daje 97 px na tekst,
  czyli tyle, ile linia 1 zajmuje co do piksela. Zero zapasu i szerszy poziomy pasek przewijania
  przy wąskich oknach. Dla materiału do PARP może być tego warte — to Twoja decyzja, nie moja.

**Rozstrzygnięte 2026-08-13:** AUTO znika z kafelków. Reszta §3.2 i §3.3 wdrożona bez zmian.

---

## 9. Korekta po wdrożeniu: lokalizacja wraca na kafelek

§3.1 zakładała, że nazwa lokalizacji ma zejść do podtytułu, a kafelek nosi ją tylko wtedy, gdy
odbiega od dominującej. Po obejrzeniu wyniku decyzja brzmi inaczej: **pełna nazwa ma być na każdym
kafelku**, w całości, bez skrótu.

Jednej linii nie da się na to poświęcić — `Lotnisko Chopina — Warszawa` to ~137 px przy 90 px
kolumny. Zamiast tego nazwa **zawija się**, 10 px z interlinią 1,2, z naturalnym łamaniem po
myślniku. Najdłuższy niepodzielny wyraz w całej mapie ma ~56 px, a `break-words` jest
zabezpieczeniem na nazwy spoza demo, więc wyjście poza kafelek jest niemożliwe.

Co z tego wypadło:

- `dominantLocationId` (prop `ScheduleGrid`) i wyliczenie dominującej lokalizacji w `GrafikScreen`
- `locationShort()` oraz pole `short` w `DEMO_LOCATIONS` — `demo-locations.ts` wraca do mapy
  `Record<string, string>` sprzed zmian, razem z `friendlyReason()`
- dopisek o lokalizacji w podtytule

Cena, zmierzona po wdrożeniu:

| | przed sesją | po sześciu regułkach | po korekcie |
|---|---|---|---|
| kafelek | 34 px | 39 px | **62 px** (74 px przy 1280 px dla najdłuższej nazwy) |
| wiersz, widok pracownika | 57 px | 62 px | **71 px** |
| wiersz, widok zespołu | ~78 px | ~84 px | **97 px** |

Weryfikacja z §8 przechodzi w czterech kombinacjach (zespół × pracownik, 1280 × 1500 px), z dodaną
asercją: ostatnia linia kafelka musi być znak w znak równa pełnej nazwie z atrybutu `title`.
