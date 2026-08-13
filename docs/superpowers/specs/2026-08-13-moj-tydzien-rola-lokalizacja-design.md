# /moj-tydzien: rola i lokalizacja przy zmianie

Data: 2026-08-13 · Moduł: Mój tydzień (widok mobilny pracownika) · Branch: `feat/demo-4mobility`

## 1. Problem

`/moj-tydzien` pokazuje przy każdej zmianie wyłącznie godziny. Pracownik nie wie, w jakiej roli
pracuje ani gdzie ma się stawić — a to są dwie rzeczy, które musi wiedzieć przed wyjściem z domu.
`/dashboard` ma komplet od dawna, więc ten sam pracownik dostaje dwie różne odpowiedzi zależnie od
tego, którym ekranem akurat patrzy.

## 2. Ustalenia z kodu

| fakt | źródło | konsekwencja |
|---|---|---|
| `Shift` niesie `role` i `lokalizacjaId` | `lib/grafik.ts`, kolumny `shifts` | dane są już w odpowiedzi `/api/grafik/shifts` |
| `WeekShift` zawęża typ do `{id, date, start, end, lokalizacjaId?}` | `lib/moj-tydzien.ts` | rola gubi się na granicy typu, nie w API |
| `GET /grafik/lokalizacje` i `GET /grafik/units` istnieją, obie z `PRACOWNIK` w `READ_ROLES` | `grafik.controller.ts:90,96` | nazwy da się pobrać, nie trzeba ich zgadywać |
| proxy `app/api/grafik/[...path]` jest catch-allem | — | oba adresy działają z frontu bez zmian |
| `/api/employees/me` zwraca `unitId`, `position`, `etat` | `SAFE_SELECT` w `employees.service.ts:24` | jednostkę da się nazwać |
| `PracownikBoard` już pobiera `/api/grafik/lokalizacje` i buduje `Map<id, name>` | `components/dashboard/pracownik-board.tsx:100` | jest wzorzec do naśladowania, nie do wymyślania |

Backend nie wymaga żadnej zmiany.

## 3. Rozwiązanie

### 3.1 Dane

`MobileWeek` dokłada dwa wywołania do istniejącego `Promise.all`: `/api/grafik/lokalizacje`
i `/api/grafik/units`. Z obu powstaje `Map<id, name>` — ten sam kształt, którego używa
`PracownikBoard`.

Nazwy pochodzą z API, nie z twardej mapy `DEMO_LOCATION_NAMES` w `lib/demo-locations.ts`. Tamta ma
piętnaście wpisów wpisanych ręcznie pod dane demo i u innego najemcy zwróci `Lok. 14bcfa`.

### 3.2 Odporność — wymaganie, nie ozdobnik

Dziś wszystkie fetche siedzą w jednym `Promise.all`, więc odrzucenie któregokolwiek gasi cały ekran
komunikatem „Brak połączenia. Sprawdź internet i odśwież.".

Słowniki nazw idą przez wrapper, który przy błędzie zwraca pustą listę. Ekran, którego jedynym
zadaniem jest odpowiedź „kiedy pracuję", nie może stracić godzin dlatego, że nie doczytał słownika
nazw. Przy awarii lookupu zostają godziny i rola, znika sama linia z lokalizacją.

`toNameMap()` jest odporna po swojej stronie: cokolwiek dostanie — `null`, obiekt, tablicę wpisów
bez `name` — zwraca mapę, nigdy nie rzuca.

### 3.3 Karta dnia

Zmiana rozwija się z jednej linii na trzy:

```
14:00 – 22:00
▌KOORDYNATOR
Lotnisko Chopina — Warszawa
```

Pasek roli to `roleBar()` z `lib/grafik-roles.ts` — ten sam kolor, którego pracownik nauczył się
w Grafiku. Karta na telefonie ma ~343 px wobec 90 px kolumny w siatce, więc problem ucinania tu nie
istnieje i nic nie trzeba skracać: pełna nazwa lokalizacji, pełna nazwa roli.

Godziny zostają w `font-display text-lg font-bold` — to nadal główna odpowiedź ekranu, a rola
i miejsce są jej opisem, nie konkurencją.

### 3.4 Nagłówek

Pod `Cześć, Anna` dochodzi nazwa jednostki, rozwiązana z `/grafik/units` po `me.unitId`. Jednostka
jest cechą pracownika, nie zmiany (w tabeli `shifts` nie ma `unit_id`), więc powtarzanie jej przy
każdej zmianie niosłoby zero informacji.

Gdy `unitId` jest puste albo słownik nie doszedł — linii po prostu nie ma. Żadnego „—".

### 3.5 Pusty tydzień

Zdanie „Najbliższa: wtorek, 12 sierpnia, 14:00–22:00" dostaje rolę i miejsce. Bez tego jedyna
zmiana, o której ekran wtedy mówi, byłaby jedyną bez kompletu informacji.

## 4. Czego nie robię

| poza zakresem | dlaczego |
|---|---|
| zmiany w backendzie | wszystko potrzebne już jest w API |
| `AUTO`/`RĘCZ` na karcie | pracownika nie obchodzi, czy grafik ułożył solver, czy koordynator |
| przełączenie siatki Grafiku na `/grafik/lokalizacje` | osobna usterka w innym module, patrz §7 |
| filtry, nawigacja po tygodniach, edycja | ten ekran ma odpowiadać na dwa pytania i tyle |

## 5. Pliki

| plik | zmiana | rozmiar |
|---|---|---|
| `apps/web/lib/moj-tydzien.ts` | `WeekShift` zyskuje `role` i `lokalizacjaId`; nowa czysta `toNameMap()` | ~20 linii |
| `apps/web/lib/moj-tydzien.test.ts` | przypadki dla `toNameMap` (poprawne wejście, nie-tablica, wpisy bez `name`, puste) | ~25 linii |
| `apps/web/components/moj-tydzien/mobile-week.tsx` | dwa fetche przez tolerancyjny wrapper, trzylinijkowa zmiana z paskiem roli, jednostka w nagłówku, uzupełnione zdanie o najbliższej zmianie | ~40 linii diffu |

`lib/grafik-roles.ts` bez zmian — jest już jednym źródłem kolorów ról i teraz obsługuje drugi ekran.

## 6. Weryfikacja

1. `tsc --noEmit`, `eslint`, `vitest run lib/moj-tydzien.test.ts`.
2. Playwright na żywym stacku, konto `pracownik.demo`, viewport **375×812** (telefon):
   - każda zmiana pokazuje niepustą rolę i niepustą nazwę lokalizacji,
   - `scrollWidth <= clientWidth` dla każdej linii karty — nic nie wychodzi poza kartę,
   - strona nie przewija się w poziomie,
   - nagłówek zawiera nazwę jednostki.
3. Osobny przebieg z zablokowanym `/api/grafik/lokalizacje` (Playwright `route.abort()`): godziny
   i rola nadal się renderują, ekran **nie** pokazuje „Brak połączenia".
4. Zrzut ekranu przy 375 px do obejrzenia.

## 7. Zgłoszenie poboczne

`lib/demo-locations.ts` twierdzi w komentarzu, że `GET /grafik/lokalizacje` nie istnieje („backlog
CI/Q14"). Endpoint istnieje i `PracownikBoard` z niego korzysta. Siatka Grafiku
(`components/grafik/grafik-screen.tsx`) nadal rozwiązuje nazwy z twardej mapy demo, więc u najemcy
spoza dema pokaże `Lok. 14bcfa` zamiast nazwy lokalizacji. To samo dotyczy `unitName()` w filtrze
jednostek. Osobna poprawka, osobny commit.
