# Forma generowanych dokumentów — specyfikacja projektowa

> **Data:** 2026-08-04 · **Status:** zatwierdzony kierunek (wariant A), sekcja 1 zaakceptowana
> **Zakres:** wszystkie miejsca w systemie generujące dokumenty dla użytkownika
> **Powód:** wygenerowany PDF ewidencji czasu pracy ma formę zrzutu konsoli — tabela sklejona z `|` i `---`, dwa nachodzące na siebie znaki wodne przecinające treść, brak nagłówka, stopki i numeracji stron. To dokument wymagany przez art. 149 KP, zasilający ZUS.

---

## 1. Zasada nadrzędna

**Nie wymyślamy nowego języka wizualnego.** Projekt ma spisany system projektowy (`DESIGN.md`) i działający potok dokumentów (`docs/raport-km3/build/print-km3.mjs`), którym wyprodukowano raporty wysłane do PARP. Ta specyfikacja **łączy jedno z drugim** i nic ponadto.

Wszystkie wartości pochodzą z `DESIGN.md` — żadnych nowych kolorów, krojów ani odstępów.

## 2. Architektura — podmiana ostatniego ogniwa

Specyfikacja modułu Dokumenty mówi: *„wyliczenia nie wiedzą o formacie. Render bierze gotowy model liczbowy i produkuje bajty"*. Korzystamy z tego dosłownie.

| Element | Zmiana |
|---|---|
| `rcp.util.ts`, `overtime.util.ts`, `kedu.util.ts` | **żadna** |
| `kedu-xml.renderer.ts` | **żadna** (XML nie ma formy wizualnej) |
| `pdf.renderer.ts` | **nowa implementacja za tym samym kontraktem** `model → bajty` |
| testy silnika | **zostają**; testy renderera dostają nowe asercje |

Potok: `model → szablon HTML + CSS na tokenach DESIGN.md → Chromium Page.printToPDF → bajty`.

**Trzy odstępstwa od potoku KM3**, wymuszone przez kontener:
1. Ścieżka do przeglądarki **ze zmiennej środowiskowej**, nigdy zaszyta (KM3 ma `C:\Program Files\Google\Chrome\...` — w Linuksie nie zadziała).
2. Chromium **w obrazie `tenant-runtime`**, uruchamiany headless.
3. **Jeden proces przeglądarki na cykl życia usługi**, nie `spawn` na żądanie — inaczej każdy dokument kosztuje sekundy startu.

**Determinizm jest wymogiem, nie życzeniem:** ten sam model musi dawać ten sam bajt. Bez tego testy renderera są bezwartościowe. Oznacza to: zero zapytań sieciowych przy renderowaniu, zero dat generacji wstrzykiwanych poza modelem, fonty z dysku.

## 3. Anatomia dokumentu

Format **A4**, marginesy jak w KM3: góra `0.72"`, dół `0.55"`, boki `0.63"`.

**Nagłówek** (powtarzany na każdej stronie, przez `headerTemplate`):
- lewa strona: znak słowny **HRobot.ai** + nazwa najemcy (`4Mobility sp. z o.o.`)
- prawa strona: tytuł dokumentu i okres

**Blok metryczny** (tylko strona pierwsza, tabela dwukolumnowa, bez ramek — same włoskowate linie `--line #E7E4DA`):
pracownik i identyfikator · okres · data wygenerowania · podstawa prawna (art. 149 KP) · status dokumentu

**Tabela danych** — to jest sedno naprawy:
- prawdziwa tabela HTML, **nie znaki `|`**
- nagłówek kolumn: General Sans 600, tło `--card-2 #FBFAF6`, dolna linia `--line-strong #D9D5C8`
- wiersze: naprzemienne tło `#FFFFFF` / `#FBFAF6`, wysokość min. 22 px
- **liczby i daty w IBM Plex Mono**, wyrównane do prawej — to jedyne uzasadnione użycie kroju o stałej szerokości i właśnie po to on jest w systemie
- kolumny tekstowe wyrównane do lewej
- **nagłówek tabeli powtarza się na każdej stronie** (`thead` + `display: table-header-group`)
- **żaden wiersz nie łamie się w poprzek stron** (`break-inside: avoid`)

**Stopka** (każda strona): nazwa dokumentu · **numeracja `strona X z Y`** · znacznik wygenerowania. Dziś numeracji nie ma w ogóle.

**Znak wodny** — specyfikacja modułu **wymaga** go na każdym dokumencie demo: „WERSJA DEMO — dane syntetyczne — nie do obrotu prawnego / nie do wysyłki ZUS". Błędem nie jest jego obecność, tylko wykonanie:
- **jeden** znak, nie dwa
- jeden kąt, na środku strony, pod treścią (`z-index` niżej, nie w poprzek liter)
- krycie ~8%, kolor `--muted-2 #8A97A8`, nie czerwony
- **nie może przecinać tabeli w sposób utrudniający odczyt liczb** — to dokument, z którego ktoś przepisuje dane

## 4. Typografia i kolor — wyłącznie z `DESIGN.md`

| Rola | Krój | Rozmiar | Kolor |
|---|---|---|---|
| Tytuł dokumentu | Cabinet Grotesk 700 | 20 pt | `--navy #0B1F3B` |
| Nagłówki sekcji | Cabinet Grotesk 700 | 12 pt | `--navy` |
| Tekst, etykiety | General Sans 400/500 | 9,5 pt | `--ink #101A2B` |
| Dane liczbowe, daty, ID | IBM Plex Mono 400 | 9 pt | `--ink` |
| Podpisy, zastrzeżenia | General Sans 400 | 8 pt | `--muted #5B6B82` |
| Linie tabeli | — | 0,5 pt | `--line #E7E4DA` / `--line-strong #D9D5C8` |

Tło strony **białe**, nie pergaminowe — `--canvas #F6F4EE` jest tłem aplikacji, nie dokumentu drukowanego. Pergamin na papierze zżera toner i pogarsza kontrast przy kopiowaniu.

**Fonty osadzone w obrazie**, ładowane przez `@font-face` z lokalnych plików. Zero żądań sieciowych.

⚠️ **Do rozstrzygnięcia przed osadzeniem:** Cabinet Grotesk i General Sans pochodzą z Fontshare/ITF. Osadzenie fontu w PDF to inne pole licencyjne niż wyświetlenie na stronie. **Sprawdzić warunki i wpisać do `data/m2-evidence/licenses/`.** Jeśli licencja nie pozwala — zamiennik na OFL o zbliżonym charakterze, wybór opisany jawnie. **Nie wolno po cichu wrócić do Noto i udawać, że to zgodne z systemem projektowym.**

## 5. Zakres wdrożenia — wszystkie punkty generacji

| Punkt | Dziś | Po zmianie |
|---|---|---|
| `dokumenty/render/pdf.renderer.ts` — ewidencja, nadgodziny, podsumowanie ZUS | pdfkit, rysowanie imperatywne | nowy potok |
| `analityk` — eksport CSV (`components/analityk/dashboard.tsx`) | goły CSV | **blok nagłówkowy**: najemca, okres, data, zastrzeżenia z `meta.uwagi`. CSV nie ma typografii, ale ma kontekst — a dziś eksport gubi zastrzeżenia, przez co liczby wyglądają na pewniejsze niż są |
| `docs/raport-km3/build/print-km3.mjs` — raporty kamieni | **już dobry** | bez zmian; jest wzorcem, nie przedmiotem naprawy |

## 6. Kryteria akceptacji

1. Wygenerowana ewidencja **nie zawiera żadnego znaku `|` ani `---`** jako elementu układu.
2. Tabela ma powtarzalny nagłówek i **żaden wiersz nie jest przecięty przez granicę stron** — sprawdzone na dokumencie ≥ 2 stron.
3. Każda strona ma stopkę z numeracją `strona X z Y`.
4. Jeden znak wodny, nieprzecinający czytelności liczb.
5. **Determinizm:** dwukrotne wygenerowanie tego samego modelu daje identyczne bajty (poza znacznikiem czasu, jeśli jest częścią modelu).
6. Zero żądań sieciowych podczas renderowania — zweryfikowane przy odciętej sieci.
7. Polskie znaki diakrytyczne poprawne we wszystkich krojach.
8. Testy renderera przechodzą; testy silnika **nietknięte**.

## 7. Czego ta specyfikacja NIE obejmuje

Podpisu elektronicznego, pieczęci kwalifikowanej, archiwizacji zgodnej z okresami retencji, wysyłki do ZUS. Wszystko to jest poza demem i poza tą zmianą — moduł nadal produkuje dokumenty **oznaczone jako demonstracyjne**.
