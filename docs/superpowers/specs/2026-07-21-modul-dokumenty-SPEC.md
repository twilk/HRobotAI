# SPEC — Moduł Dokumenty (M3): generowanie dokumentów kadrowo-płacowych z RCP (ewidencja + nadgodziny + eksport ZUS/Płatnik)

> **Status:** pełny SPEC (krok 1 metodyki) — moduł demo/MVP „Moduł Dokumenty" nazwany w `k-modul-dostepy.md` §5 jako odbiorca danych RCP („nadgodziny (Moduł Dokumenty, M3)", „Dokumenty/ZUS (M3)").
> **Kamień milowy:** M3 (Etap 3) · **Projekt:** HRobot.AI · **Beneficjent:** App Pro sp. z o.o. · **Odbiorca Technologii:** 4Mobility.
> **Następne:** Codex adversarial crosscheck (§13) → rekonsyliacja → plan TDD → build (backend model+silnik → generatory PDF/KEDU → controller+RBAC+audyt → web-kit → live RBAC) → bramki §11 + wdrożeniowa.
> **Zakres:** moduł demo/MVP, dane **wyłącznie syntetyczne**, kotwice demo (36 pracowników, 832 zmiany) **NIETKNIĘTE**. Model greenfield (Prisma tenant schema). **Bez wysyłki do ZUS** — twarda bramka człowieka.
> **Repo:** HRobot-m2, worktree `feat/demo-4mobility`.
> **Styl wzorcowy:** `docs/superpowers/specs/2026-07-14-ai-performance-trajectory-recruitment-SPEC.md` (strategic-brain — układ sekcji, dyscyplina RODO/audytu, reużycia realnego kodu M2).

---

## 0. Legenda oznaczeń decyzji

- 🔴 **[DECYZJA-4M]** — parametr biznesowy/procesowy, który **musi potwierdzić 4Mobility** (Odbiorca Technologii) przed buildem. Nie wymyślamy wartości — spec podaje propozycję domyślną „na demo" i oznacza ją jako do potwierdzenia.
- ⚖️ **[PRAWO-PL]** — reguła zależna od polskiego prawa pracy / przepisów ZUS. Spec podaje **kierunek** (kotwiczony w Kodeksie pracy / dokumentacji ZUS), ale **konkretne stawki, progi i formaty wymagają weryfikacji radcy prawnego / specjalisty kadrowo-płacowego** po stronie 4Mobility/App Pro. Na demo używamy jawnie oznaczonych wartości poglądowych.

Zasada nadrzędna: **żaden dokument z tego modułu nie jest dokumentem urzędowym** na etapie demo. Każdy PDF/XML nosi widoczny znak wodny „WERSJA DEMO — dane syntetyczne — nie do obrotu prawnego / nie do wysyłki ZUS".

---

## 1. Cel + zakres (demo-MVP)

### 1.1 Cel (jedno zdanie)
Moduł, w którym HRobot **generuje dokumenty kadrowo-płacowe** (ewidencję czasu pracy, rozliczenie nadgodzin i szkielet eksportu ZUS/Płatnik) **z danych RCP** (zdarzenia wejście/wyjście/przerwa) i danych kadrowych z Modułu Data, przy czym **każdy krok o skutkach prawnych (zatwierdzenie nadgodzin, „wysyłka" ZUS) przechodzi przez bramkę człowieka** — na demo nic nie jest wysyłane na zewnątrz.

### 1.2 Zakres funkcjonalny (3 dokumenty)
1. **Ewidencja czasu pracy** — raport okresowy per pracownik (lub zakres pracowników), agregujący zdarzenia RCP w dni robocze: godziny wejścia/wyjścia, czas przepracowany, przerwy, nieobecności (przecięcie z `LeaveRequest`), suma godzin w okresie. Realizuje obowiązek prowadzenia ewidencji czasu pracy ⚖️ **[PRAWO-PL]** (Kodeks pracy art. 149 — zakres wymaganych pól do potwierdzenia).
2. **Nadgodziny** — wyliczenie z RCP: przekroczenia normy dobowej (8h) i przeciętnej normy tygodniowej (40h w okresie rozliczeniowym), z podziałem na dodatki **50%** i **100%** ⚖️ **[PRAWO-PL]** (Kodeks pracy art. 151¹). Wynik przechodzi **bramkę zatwierdzenia managera/HR** przed uznaniem za „zatwierdzony" (stan `APPROVED`).
3. **Eksport ZUS/Płatnik** — struktura **KEDU** na danych syntetycznych: szkielet dokumentów **RCA / RSA / DRA** ⚖️ **[PRAWO-PL]**. **BEZ wysyłki** (human-gate). Na demo produkujemy **raport PDF** (czytelne podsumowanie) **+ szkielet XML KEDU** (walidowalny strukturalnie, ale oznaczony jako demo). PESEL potrzebny w RCA/RSA → kontrolowane odszyfrowanie + audyt (§6).

### 1.3 Poza zakresem MVP (świadomie)
- Realna wysyłka do ZUS / integracja z Płatnikiem / podpis kwalifikowany.
- Naliczanie wynagrodzeń brutto/netto, zaliczki PIT, potrącenia (to płace, nie ten moduł — reużywamy jedynie `PositionCostRate` jako źródło stawki, jeśli 4Mobility potwierdzi 🔴).
- Automatyczne zatwierdzanie nadgodzin (art. 22 RODO — decyzja o skutku dla pracownika = człowiek).
- Korekty zdarzeń RCP z UI (na demo korekta = wpis o `source=KOREKTA` przez seed/skrypt; pełny UI korekt to zakres rozwojowy).

### 1.4 Nazewnictwo modułu
- Backend: `apps/tenant-runtime/src/dokumenty/` (moduł Nest) — polska nazwa spójna z `k-modul-dostepy.md` §5.
- Prefix API: `/api/dokumenty/*` (za `RbacGuard`, `@TenantRoute`).
- web-kit: `lib/dokumenty.ts` + `components/dokumenty/*` + ekran `app/(tenant)/dokumenty/`.
- Silnik RCP→wyliczenia: `apps/tenant-runtime/src/dokumenty/rcp.util.ts` (czyste funkcje) + `overtime.util.ts`.
- Generatory (render): `apps/tenant-runtime/src/dokumenty/render/` (`pdf.renderer.ts`, `kedu-xml.renderer.ts`).

---

## 2. Model danych (Prisma greenfield, tenant schema)

> Konwencje jak w całym `packages/db/prisma/tenant/schema.prisma`: `@@map("snake_case")`, kolumny `@map(...)`, `id String @id @default(uuid())`, migracja **create-only + ręczny `ALTER … OWNER TO hu_<id>`** (bramka §11 — wzór `20260714000000_strategic_brain/migration.sql` linie 13–22). Środowisko nie ma dostępu do żywej/shadow bazy → migracja **hand-authored** w kształcie zgodnym z generatorem Prisma (jak strategic-brain).

### 2.1 Czy istnieje model RCP? — NIE. Definiujemy minimalny `RcpEvent`.
Weryfikacja `schema.prisma` (grep `Rcp|Time|Attendance|WorkTime|Clock`): istnieją tylko `Employee`, `ShiftTemplate`, `ShiftDemand`, `Shift`, `ShiftSwapRequest`, `LeaveRequest`, oraz modele strategic-brain (`WorkOrder`, `Complaint`, `EmployeePerformanceSnapshot`, `RecruitmentRecommendation`, `PerformanceConfig`). **Brak jakiegokolwiek modelu zdarzeń czasu pracy.** `WorkOrder` (zlecenie detailing/podstawienie) to źródło metryk wydajności strategic-brain — **NIE** jest RCP i nie wolno go nadużyć do ewidencji (inna semantyka: zlecenie ≠ obecność). Dlatego M3 definiuje własny, minimalny model zdarzeń.

### 2.2 `RcpEvent` — zdarzenie rejestracji czasu pracy
Odzwierciedla maszynę stanów RCP z `k-modul-dostepy.md` §5 (`POZA_PRACA → W_PRACY → PRZERWA → …`).

```prisma
/// Surowe zdarzenie RCP (Rejestracja Czasu Pracy) — atomowy fakt „pracownik X, chwila T, typ zdarzenia".
/// Źródło ewidencji czasu pracy i wyliczeń nadgodzin (Moduł Dokumenty, M3). Zdarzenia są parowane
/// (wejście↔wyjście, start↔koniec przerwy) w warstwie silnika (rcp.util.ts), NIE w bazie — baza trzyma
/// tylko surowe fakty. Zdarzenie jest NIEMUTOWALNE; korekta = nowe zdarzenie o `source=KOREKTA`
/// wskazujące `correctsEventId` (append-only, jak recruitment_recommendation.replaces… w strategic-brain).
model RcpEvent {
  id             String       @id @default(uuid())
  employeeId     String       @map("employee_id")
  employee       Employee     @relation("RcpEventEmployee", fields: [employeeId], references: [id])
  /// Chwila zdarzenia (UTC w bazie; strefa lokalna liczona w silniku — patrz §3 null/tz-policy).
  occurredAt     DateTime     @map("occurred_at")
  type           RcpEventType
  source         RcpEventSource @default(PANEL_WEB)
  /// Opcjonalna placówka, w której padło zdarzenie (spina RCP z Modułem Dostępy; nullable — panel/mobile
  /// bez czytnika). FK do istniejącej `Lokalizacja`.
  lokalizacjaId  String?      @map("lokalizacja_id")
  lokalizacja    Lokalizacja? @relation(fields: [lokalizacjaId], references: [id])
  /// Korekta: id zdarzenia, które ten wpis poprawia (tylko dla source=KOREKTA). Append-only ślad.
  correctsEventId String?     @map("corrects_event_id")
  /// Kto wprowadził korektę/wpis ręczny (audyt; NULL dla zdarzeń z automatycznej kontroli dostępu).
  enteredByUserId String?     @map("entered_by_user_id")
  createdAt      DateTime     @default(now()) @map("created_at")

  @@index([employeeId, occurredAt])
  @@index([lokalizacjaId])
  @@map("rcp_event")
}

enum RcpEventType {
  WEJSCIE
  WYJSCIE
  PRZERWA_START
  PRZERWA_KONIEC
}

/// Skąd padło zdarzenie (spójne z k-modul-dostepy §5: kontrola dostępu / panel / mobile) + import + korekta.
enum RcpEventSource {
  KONTROLA_DOSTEPU
  PANEL_WEB
  MOBILE
  IMPORT
  KOREKTA
}
```

**Idempotencja importu/seedu.** Zdarzenia RCP z importu muszą być deduplikowalne. Ponieważ `(employeeId, occurredAt, type)` nie jest bezpiecznym kluczem naturalnym dla źródeł ręcznych (dwa legalne wejścia w tej samej sekundzie są nierealne, ale korekta celowo duplikuje timestamp), stosujemy: **partial-unique index** tylko dla zdarzeń **importowanych/seedowych** (deterministyczne), pomijając korekty:
```sql
CREATE UNIQUE INDEX "rcp_event_dedup_import"
  ON "rcp_event"("employee_id","occurred_at","type")
  WHERE "source" IN ('IMPORT');
```
Seed używa `INSERT … ON CONFLICT DO NOTHING` (idempotencja — §8). Korekty (`KOREKTA`) i wpisy ręczne nie podlegają temu indeksowi (mogą świadomie dzielić timestamp). 🔴 **[DECYZJA-4M]** — czy dopuszczamy wiele zdarzeń tego samego typu w tej samej minucie ze źródła `KONTROLA_DOSTEPU` (dubel odczytu karty)? Domyślnie na demo: dedup też dla `KONTROLA_DOSTEPU`.

### 2.3 `GeneratedDocument` — wygenerowany dokument (metadane + treść/ścieżka)
```prisma
/// Jeden wygenerowany dokument (ewidencja / nadgodziny / eksport ZUS-KEDU) za dany OKRES i ZAKRES.
/// NIEMUTOWALNY co do treści: ponowne wygenerowanie tworzy NOWY wiersz wskazujący `replacesDocumentId`
/// (append-only historia, wzór recruitment_recommendation w strategic-brain §14 B3). `contentHash`
/// zamraża treść w chwili generacji → reprodukowalność/audyt bez trzymania PII w audit_log.
model GeneratedDocument {
  id            String        @id @default(uuid())
  type          DocumentType
  format        DocumentFormat
  status        DocumentStatus @default(GENERATED)
  /// Okres rozliczeniowy dokumentu (daty kalendarzowe; @db.Date jak ShiftDemand/LeaveRequest).
  periodStart   DateTime      @map("period_start") @db.Date
  periodEnd     DateTime      @map("period_end")   @db.Date
  /// Zakres: pojedynczy pracownik, jednostka, lub cały tenant. Dla EMPLOYEE ustawione `employeeId`,
  /// dla UNIT — `unitId`. `scopeType=ALL` => oba NULL (całość, tylko HR/ADMIN).
  scopeType     DocScopeType  @map("scope_type")
  employeeId    String?       @map("employee_id")
  employee      Employee?     @relation("DocEmployee", fields: [employeeId], references: [id])
  unitId        String?       @map("unit_id")
  /// Zmaterializowana treść. Na demo trzymamy treść w kolumnie (PDF jako bytea/base64 lub XML jako text)
  /// LUB ścieżkę w izolowanym storage tenanta — patrz §4.4 (decyzja storage). Dokładnie JEDNO z pól.
  contentText   String?       @map("content_text")   // XML KEDU / tekstowe raporty
  contentBytes  Bytes?        @map("content_bytes")  // PDF (binarny)
  contentPath   String?       @map("content_path")   // alternatywa: ścieżka w storage (jeśli wybrana)
  /// SHA-256 treści w chwili generacji — reprodukowalność + wykrycie manipulacji (bez PII w audycie).
  contentHash   String        @map("content_hash")
  /// Zamrożone parametry/wynik liczbowy (Json) użyte do renderu — pozwala odtworzyć „dlaczego tyle nadgodzin"
  /// bez PII (tylko id + liczby; NIGDY PESEL/nazwisko w tym polu — §6).
  computedFacts Json          @map("computed_facts")
  /// Wersja silnika wyliczeń, którą wyprodukowano dokument (jak snapshot.algorithmVersion w strategic-brain).
  algorithmVersion Int        @default(1) @map("algorithm_version")
  replacesDocumentId String?  @map("replaces_document_id")
  generatedByUserId String     @map("generated_by_user_id")
  generatedAt   DateTime      @default(now()) @map("generated_at")
  /// Bramka nadgodzin/ZUS: kto i kiedy zatwierdził (NULL = niezatwierdzony). Art. 22 RODO — człowiek.
  approvedByUserId String?    @map("approved_by_user_id")
  approvedAt    DateTime?     @map("approved_at")
  /// RODO retencja: do kiedy dokument jest przechowywany (polityka retencji §6). Po tej dacie — do czyszczenia.
  retentionUntil DateTime?    @map("retention_until") @db.Date
  createdAt     DateTime      @default(now()) @map("created_at")

  @@index([type, periodStart, periodEnd])
  @@index([employeeId])
  @@index([unitId])
  @@map("generated_document")
}

enum DocumentType {
  EWIDENCJA_CZASU_PRACY
  NADGODZINY
  ZUS_KEDU
}

enum DocumentFormat {
  PDF
  XML_KEDU
}

/// Cykl życia. Ewidencja: GENERATED (finalny). Nadgodziny: GENERATED → APPROVED (bramka managera) lub
/// SUPERSEDED (gdy przeliczono na nowo). ZUS: GENERATED → APPROVED (zatwierdzenie do „wysyłki" — ale
/// wysyłki NIE ma na demo). Brak stanu „SENT/EXPORTED_EXTERNAL" — twarda granica (żadnej wysyłki).
enum DocumentStatus {
  GENERATED
  APPROVED
  SUPERSEDED
}

enum DocScopeType {
  EMPLOYEE
  UNIT
  ALL
}
```

### 2.4 Zmiany w istniejących modelach (additive-only)
- `Employee`: dodać relacje odwrotne `rcpEvents RcpEvent[] @relation("RcpEventEmployee")` oraz `documents GeneratedDocument[] @relation("DocEmployee")`. (Wzór: `Employee` już ma `workOrders`, `complaints`, `performanceSnapshots` — dokładamy analogicznie, bez zmian kolumn.)
- `Lokalizacja`: dodać `rcpEvents RcpEvent[]` (jak istniejące `shifts`, `accessGrants`).
- **Zero PII w nowych modelach.** `RcpEvent` i `GeneratedDocument` **nie mają** kolumn PESEL/adres. PESEL pojawia się **wyłącznie** w zmaterializowanej treści dokumentu ZUS-KEDU (`contentText`/`contentBytes`) — zaszyfrowanej-w-spoczynku decyzją storage (§4.4/§6), nigdy w `computedFacts`.

### 2.5 Migracja (create-only, hand-authored) — nota `ALTER OWNER`
Plik `packages/db/prisma/tenant/migrations/20260721xxxxxx_dokumenty/migration.sql`, w kształcie generatora Prisma (jak strategic-brain). Nagłówek z **bramką wdrożeniową**:
```sql
-- DEPLOYMENT GATE (do NOT run here): po ręcznym zaaplikowaniu na żywej bazie tenanta:
--   ALTER TABLE "rcp_event"          OWNER TO hu_<tenant>;
--   ALTER TABLE "generated_document" OWNER TO hu_<tenant>;
-- (wzór reference_hrobot_m2_deploy: raw-SQL migrations + ALTER OWNER; żywy tenant hu_900d948b).
```
Plus `CREATE TYPE` dla 5 enumów, `CREATE TABLE` × 2, indeksy (w tym partial-unique `rcp_event_dedup_import`), FK do `employees`/`lokalizacje`. **Nie modyfikuje** żadnego istniejącego obiektu (tylko `AddForeignKey`/relacje odwrotne są wirtualne w Prisma — nie generują ALTERów na `employees`).

---

## 3. Silnik: pure functions (TDD)

> Wzór: `strategic-brain/scoring.util.ts` (czyste, w pełni testowane funkcje; `*.util.spec.ts`). Wyliczenia **oddzielone** od Prisma/render — wejście to zwykłe obiekty, wyjście to liczby/struktury. TDD: test pisany przed implementacją (`superpowers:test-driven-development`).

### 3.1 `rcp.util.ts` — parowanie zdarzeń i ewidencja
- `pairEvents(events: RcpEventLite[]): WorkSession[]` — sortuje po `occurredAt`, paruje `WEJSCIE↔WYJSCIE` i `PRZERWA_START↔PRZERWA_KONIEC`. Zwraca sesje pracy z odjętymi przerwami.
- `dailyWorkedMinutes(sessions, day, tz): number` — minuty przepracowane w danym dniu lokalnym.
- `aggregateEwidencja(events, leaves, period, tz): EwidencjaRow[]` — per dzień okresu: `{ date, firstIn, lastOut, workedMinutes, breakMinutes, absence?: 'URLOP'|'L4'|… , anomalie: string[] }`. Nieobecności z przecięcia dat `LeaveRequest` z dniem (mapa `LeaveRequest.type` → kategoria — **udokumentowana**, wzór M12 strategic-brain: wykluczenia ze STRUKTURY, nie string-match). 🔴 **[DECYZJA-4M]** mapowanie typów urlopów.
- **Null-policy (krytyczna, testowana):**
  - Brak jakichkolwiek zdarzeń w dniu, w którym pracownik **miał grafik** (`Shift`) → wiersz `anomalie:['BRAK_RCP']`, `workedMinutes` = `null` (NIE `0` — „brak danych" ≠ „0 godzin"; jak M6/M7 strategic-brain: „brak pracy" = brak danych).
  - Niesparowane zdarzenie (wejście bez wyjścia, wyjście bez wejścia) → `anomalie:['NIESPAROWANE']`, sesja domknięta wg reguły 🔴 **[DECYZJA-4M]** (domyślnie demo: domknięcie na koniec zaplanowanej zmiany z flagą; nie zgadujemy „pracował do północy").
  - Przerwa bez końca / zagnieżdżone przerwy → flaga anomalii, przerwa liczona do najbliższego `WYJSCIE`.
  - Dzień urlopu/L4 z jednoczesnymi zdarzeniami RCP → anomalia `RCP_W_NIEOBECNOSCI` (do decyzji kadr).
- **Strefa czasowa:** zdarzenia w UTC; agregacja w strefie `Europe/Warsaw`; przełom doby/DST liczony jawnie (test dla dnia zmiany czasu). 🔴 **[DECYZJA-4M]** — czy doba pracownicza = kalendarzowa (00:00–24:00), czy „doba pracownicza" od pierwszego wejścia (art. 128 §3 KP — pojęcie doby) ⚖️ **[PRAWO-PL]**.

### 3.2 `overtime.util.ts` — nadgodziny
- `overtimeDaily(workedMinutes, normaDobowaMin=480): { normalMin, ot50Min }` — przekroczenie normy dobowej (8h) → nadgodziny z dodatkiem **50%** ⚖️ **[PRAWO-PL]** (art. 151¹ §1 pkt 2 — dni robocze).
- `overtimeWeekly(dailyRows, normaTygodnMin, okresRozliczeniowy): { ot100Min }` — przekroczenie **przeciętnej** normy tygodniowej (40h) w okresie rozliczeniowym → dodatek **100%** ⚖️ **[PRAWO-PL]** (art. 151¹ §1 pkt 1). Uwaga: nadgodziny średniotygodniowe liczone są **na koniec okresu rozliczeniowego** i nie mogą podwójnie liczyć godzin już rozliczonych jako dobowe — test na brak double-counting.
- `overtimeNightSundayHoliday(...)` — dodatek **100%** za pracę w nocy, niedziele i święta niebędące dniami pracy ⚖️ **[PRAWO-PL]** (art. 151¹ §1 pkt 1). **Pora nocna**, **kalendarz świąt** oraz **rozkład dni wolnych** to 🔴 **[DECYZJA-4M]** (na demo: pora nocna 22:00–06:00 poglądowo; kalendarz świąt PL z jawnej stałej tablicy oznaczonej „demo").
- `overtimeSummary(period, rows, cfg): OvertimeSummary` — sumy `ot50Min`, `ot100Min`, liczba nadgodzin, ostrzeżenie o przekroczeniu **limitu rocznego** (150h/rok lub limit z układu) ⚖️ **[PRAWO-PL]** — **tylko ostrzeżenie, bez blokady** (moduł nie podejmuje decyzji kadrowej).
- **Null-policy:** dni z `workedMinutes=null` (brak RCP) **nie wchodzą** do podstawy nadgodzin (nie karzemy/nie nagradzamy za brak danych); raport jawnie wykazuje „dni bez danych RCP: N" — analogia do `confidence`/`excludedReason` w strategic-brain.
- **Konfiguracja norm** czytana z `DokumentyConfig` (§3.3), nigdy zahardkodowana w silniku (wzór: strategic-brain czyta wagi z `PerformanceConfig`, nie z kodu).

### 3.3 Konfiguracja (`DokumentyConfig`) — czy potrzebna osobna tabela?
Propozycja: **NIE tworzyć nowej tabeli konfiguracyjnej w MVP**. Normy (8h/40h), okres rozliczeniowy, pora nocna, mapa typów urlopów, próg limitu rocznego trzymamy w **jednym module stałych** `dokumenty.config.ts` (jawnie oznaczonym „wartości poglądowe demo — do potwierdzenia 4Mobility/radca"), przekazywanym do funkcji silnika jako argument `cfg`. Uzasadnienie: to reguły **prawne**, nie per-jednostka tuning — nie chcemy sugerować, że każdy manager je zmienia. 🔴 **[DECYZJA-4M]** — jeśli 4Mobility potwierdzi różne okresy rozliczeniowe per jednostka, wtedy wprowadzamy tabelę wzorem `AiSchedulingConfig` (nullable `unitId` + partial-unique default). Do potwierdzenia przed buildem.

### 3.4 `kedu.util.ts` — mapowanie na strukturę KEDU (bez renderu)
- `buildKeduModel(employees, period, ewidencja, overtime, cfg): KeduModel` — czysta struktura opisująca bloki **DRA** (deklaracja rozliczeniowa — nagłówek płatnika, okres), **RCA** (imienny raport miesięczny o należnych składkach — per pracownik, wymaga PESEL), **RSA** (raport o przerwach/wyłączeniach — absencje z `LeaveRequest`) ⚖️ **[PRAWO-PL]**. Ta funkcja przyjmuje PESEL **jako argument** (odszyfrowany wcześniej w serwisie — §6), sama nie sięga do bazy/EncryptionService. Zwraca model, który renderer zamienia na XML/PDF.
- 🔴 **[DECYZJA-4M]** — **które deklaracje** faktycznie generujemy na demo (minimalnie DRA+RCA; RSA gdy są absencje) i wg **której wersji schematu KEDU** (KEDU 5.x / aktualny) ⚖️ **[PRAWO-PL]**. Na demo: szkielet strukturalny oznaczony wersją poglądową.

---

## 4. Generacja dokumentów (warstwa render, oddzielona od wyliczeń)

> Zasada: **wyliczenia (§3) nie wiedzą o formacie**. Render bierze gotowy model liczbowy i produkuje bajty. Ułatwia testy (silnik testowany bez PDF) i podmianę formatu.

### 4.1 `render/pdf.renderer.ts`
- Wejście: model ewidencji / nadgodzin / KEDU (czyste struktury z §3).
- Wyjście: `Buffer` (PDF). Nagłówek 4Mobility/HRobot, tabela dni/godzin, podsumowanie, **znak wodny „WERSJA DEMO — dane syntetyczne — nie do obrotu prawnego"** (§0).
- 🔴 **[DECYZJA-4M]** biblioteka PDF (np. serwerowy generator już używany w KM-raportach — Chrome CDP z `reference_km_report_workflow`, albo lekki lib `pdfkit`). Do potwierdzenia w fazie planu; brak nowej ciężkiej zależności bez zgody.

### 4.2 `render/kedu-xml.renderer.ts`
- Wejście: `KeduModel`. Wyjście: `string` (XML). Struktura bloków DRA/RCA/RSA, kodowanie i deklaracja zgodne z KEDU ⚖️ **[PRAWO-PL]** (walidacja strukturalna, nie semantyczna, na demo).
- **Twardy element bezpieczeństwa:** XML KEDU zawiera PESEL. Renderer dostaje PESEL już odszyfrowany (kontrolowane, audytowane — §6). Element `<demo>true</demo>` i komentarz nagłówkowy oznaczają plik jako demo.

### 4.3 Spójność treść↔hash
Serwis liczy `contentHash = sha256(bytes|text)` i zapisuje razem z treścią (§2.3). Ponowna generacja z tymi samymi danymi wejściowymi daje ten sam model liczbowy (`computedFacts`), ale nowy wiersz (append-only) — hash pozwala wykryć, czy treść realnie się zmieniła.

### 4.4 Przechowywanie treści (decyzja storage)
🔴 **[DECYZJA-4M]** / bramka inżynierska:
- **Opcja A (domyślna demo):** treść w kolumnie (`content_text`/`content_bytes`) w bazie tenanta (fizyczna izolacja per tenant — spójne z modelem izolacji `i-modul-data`). Prosto, audytowalnie, PESEL w treści chroniony izolacją bazy + brakiem PESEL w API listy.
- **Opcja B:** osobny storage plikowy per tenant + `content_path`. Wymaga polityki szyfrowania-w-spoczynku i czyszczenia. Poza MVP, chyba że 4Mobility wymaga.
Wybór A na demo; B jako roadmap. **PESEL w treści dokumentu ZUS to jedyne miejsce, gdzie PESEL opuszcza `employees` — patrz §6.**

---

## 5. API — kontrakty (za `RbacGuard`, `@TenantRoute`)

> Wzór 1:1: `strategic-brain.controller.ts` (thin controller, `@TenantRoute()` + `@Roles(...)`, scope w SERWISIE przez `isGlobal`/`managedUnitIds`, kolejność tras `me` przed `:id`, audyt ids-only budowany ręcznie). Projekcje list przez **module-local SAFE_SELECT** (bez PESEL).

| Metoda | Ścieżka | Role | Zwraca / robi |
|---|---|---|---|
| GET | `/api/dokumenty` | HR, ADMIN_KLIENTA, MANAGER(scoped) | lista metadanych dokumentów (bez treści, bez PESEL); MANAGER tylko swoje jednostki |
| GET | `/api/dokumenty/mine` | + PRACOWNIK(self) | 🔴 **[DECYZJA-4M]** czy pracownik widzi **własną** ewidencję (transparentność vs zakres demo). Trasa literalna PRZED `:id` (jak `employee/me`). Domyślnie: TAK, read-only, tylko ewidencja własna |
| POST | `/api/dokumenty/generuj` | HR, ADMIN, MANAGER(scoped) | body `{ type, periodStart, periodEnd, scopeType, employeeId?, unitId? }` → liczy (§3) + renderuje (§4) + zapisuje `GeneratedDocument` (status `GENERATED`); audyt ids-only |
| GET | `/api/dokumenty/:id` | HR, ADMIN, MANAGER(scoped), PRACOWNIK(self-own) | metadane pojedynczego dokumentu (bez surowej treści) |
| GET | `/api/dokumenty/:id/pobierz` | j.w. | strumień treści (PDF/XML) z `Content-Type`/`Content-Disposition`; **odszyfrowanie PESEL tylko dla ZUS_KEDU** + audyt (§6) |
| POST | `/api/dokumenty/:id/zatwierdz` | HR, ADMIN, MANAGER(scoped) | bramka: `NADGODZINY`/`ZUS_KEDU` GENERATED → APPROVED; stempluje `approvedBy*`; audyt ids-only; **NIE wysyła nic na zewnątrz** (art. 22 RODO) |

- **Scope (M16):** `RbacGuard` sprawdza tylko grubą rolę (`hrobot_roles`); **każdy endpoint** liczy scope w serwisie (`resolveScope`: `null` dla GLOBAL HR/ADMIN, inaczej `managedUnitIds`). MANAGER generuje/czyta tylko dla swoich jednostek; `scopeType=ALL` **tylko** GLOBAL. PRACOWNIK — wyłącznie własne przez `/mine` i `:id`/`pobierz` gdy `document.employeeId ↔ własny Employee` (lookup po `keycloakSub`, wzór `employee/me`).
- **Walidacja DTO** (`class-validator`, wzór `dto/performance-config.dto.ts`): `type`/`format`/`scopeType` z enuma; `periodStart ≤ periodEnd`; `employeeId`/`unitId` = `@IsUUID()`; spójność scope↔pola (EMPLOYEE⇒employeeId, UNIT⇒unitId, ALL⇒oba puste). Błędy → 400.
- **Bramka nadgodzin:** dokument `NADGODZINY` jest „ważny do rozliczenia" dopiero po `zatwierdz` przez managera/HR (stan APPROVED). UI oznacza GENERATED jako „do zatwierdzenia".

---

## 6. RODO + minimalizacja (WARUNEK KONIECZNY)

> Wzór dyscypliny: `EmployeesService` (SAFE_SELECT allowlist, kontrolowane `decryptEmployeePesel` tylko dla GLOBAL + maska), audit interceptor (`SENSITIVE_KEYS` już redaguje `pesel`), strategic-brain (audyt ids-only, append-only).

- **PESEL — kontrolowane odszyfrowanie tylko dla ZUS.** Ewidencja i nadgodziny **nie potrzebują PESEL** → liczone na `SAFE_SELECT` (id, imię, nazwisko, position, unitId, etat) — **zero PESEL**. PESEL odszyfrowywany (`decryptEmployeePesel(this.encryption, tenantId, emp.pesel)`) **wyłącznie** przy generacji/pobraniu `ZUS_KEDU`, w jednym miejscu serwisu, natychmiast po użyciu wychodzący z zakresu (nie trafia do `computedFacts`, nie do logów). Każde takie odszyfrowanie → **wpis audytowy ids-only** (`action:'dokumenty.zus.pesel-decrypt'`, `entityId:documentId`, payload `{ employeeIds:[…] }` — same id, bez PESEL/nazwisk).
- **SAFE_SELECT module-local** dla list/metadanych (jak strategic-brain M18): `GeneratedDocument` metadata **nie zawiera treści** ani PESEL; lista pracowników do ewidencji przez allowlist bez pól PII.
- **Audyt ids-only append-only** (M19): każda `generuj`, `zatwierdz`, `pobierz(ZUS)`, `pesel-decrypt` → `AuditService.log` z payloadem złożonym ręcznie z samych id/liczb. `audit_log` jest append-only (trigger DB blokuje UPDATE/DELETE — `i-modul-data` ID-6). Interceptor `redactAuditPayload` i tak redaguje `pesel` (defense-in-depth), ale payloady **z założenia** go nie zawierają.
- **Treść dokumentu ZUS zawiera PESEL** — to nieusuwalny wymóg formatu. Ochrona: izolacja bazy tenanta (§4.4 opcja A), brak PESEL w API listy, pobranie tylko dla uprawnionych ról + audyt pobrania, znak wodny „nie do wysyłki".
- **Minimalizacja:** dokument liczony na najwęższym zbiorze pól; `computedFacts` = tylko id + liczby (test: brak `pesel`/nazwiska/pełnego adresu w `computedFacts`).
- **Retencja (`retentionUntil`):** dokumenty kadrowo-płacowe mają ustawowe okresy przechowywania ⚖️ **[PRAWO-PL]** (ewidencja czasu pracy / dokumentacja pracownicza — 10 lat wg obecnych przepisów, do potwierdzenia). Na demo `retentionUntil = periodEnd + <okres>` z jawnej stałej „poglądowo"; realny job czyszczący = roadmap. 🔴 **[DECYZJA-4M]** okresy retencji per typ dokumentu.
- **Art. 22 RODO:** żadna generacja nie jest decyzją o skutku prawnym samą w sobie; nadgodziny/ZUS wymagają **zatwierdzenia człowieka** (`zatwierdz`), a „wysyłki" nie ma. Banner w UI: „Dokument generowany automatycznie — zatwierdza i wysyła człowiek".

---

## 7. web-kit — ekran `/dokumenty`

> Wzór 1:1: strategic-brain web-kit — proxy `app/api/<mod>/[[...path]]/route.ts` (`proxyToTenantRuntime` + `joinBackendPath`), `lib/<mod>.ts` (`xFetch` + klasa błędu + czyste kalkulatory formatujące + vitest), server-shell `getSession`+AppShell+RBAC-gate, enrichment id→nazwisko przez `/api/employees`.

- **Proxy:** `app/api/dokumenty/[[...path]]/route.ts` — optional catch-all, `GET`/`POST` → `proxyToTenantRuntime(req, joinBackendPath('dokumenty', path ?? []), search)`. (Kopia `app/api/strategic-brain/[[...path]]/route.ts`.) Dla `pobierz` proxy musi przepuścić **binarny** strumień + nagłówki `Content-Disposition` (uwaga inżynierska: `proxyToTenantRuntime` sprawdzić pod kątem non-JSON body — jeśli zakłada JSON, dodać wariant strumieniowy).
- **`lib/dokumenty.ts`:** `DokumentyError extends Error` (status HTTP), `dokFetch<T>` (wzór `sbFetch`), typy odpowiedzi (parytet z DTO backendu), **czyste kalkulatory prezentacji** (formatowanie minut→„8h 30m", etykiety statusów PL, suma nadgodzin, kolory semantyczne „do zatwierdzenia/zatwierdzony") + `lib/dokumenty.test.ts` (vitest). Kalkulatory operują na **już policzonym** wyjściu backendu — nie liczą nadgodzin po stronie klienta.
- **Ekran `app/(tenant)/dokumenty/page.tsx`** (server-shell + RBAC-gate wzorem istniejących tras tenant):
  - (a) **Lista dokumentów** — tabela: typ, okres, zakres (pracownik/jednostka/całość, enrichment id→nazwisko), status (badge „do zatwierdzenia"/„zatwierdzony"), format, data generacji; akcje: podgląd/pobierz, zatwierdź (dla ról).
  - (b) **Generuj** — formularz: typ dokumentu, okres (od–do), zakres; POST `/api/dokumenty/generuj`; po sukcesie odświeżenie listy.
  - (c) **Podgląd/pobierz** — link do `/api/dokumenty/:id/pobierz` (PDF w nowej karcie / XML download).
  - (d) **Banner RODO** stały (art. 22) + znak wodny widoczny na wygenerowanych plikach.
  - **RBAC-gate:** trasa widoczna dla MANAGER/HR/ADMIN_KLIENTA (spójnie z `/dostepy` w `lib/nav.ts`); sekcja „moja ewidencja" dla PRACOWNIK jeśli 🔴 potwierdzone.

---

## 8. Seed syntetyczny (kotwice nietknięte, idempotentny)

`scripts/seed-demo-dokumenty.sql` — dla **podzbioru** istniejących 36 pracowników generuje zdarzenia `RcpEvent` pokrywające scenariusze demo. **Nie rusza** 832 zmian ani innych kotwic; tylko INSERT do `rcp_event` (i opcjonalnie kilka `generated_document` przykładowych).

Profile do pokrycia (min. po 1 pracowniku):
- **Normalny czas** — 5 dni × (WEJSCIE 08:00, PRZERWA 12:00–12:30, WYJSCIE 16:00) ⇒ 0 nadgodzin.
- **Nadgodziny dobowe (50%)** — kilka dni z WYJSCIE ~18:30 ⇒ ot50.
- **Nadgodziny średniotygodniowe (100%)** — tydzień z pracą w sobotę / ponad 40h ⇒ ot100 (test double-counting).
- **Praca w niedzielę/nocy (100%)** — zdarzenia w porze nocnej / niedzielę ⇒ ot100 (⚖️ oznaczone poglądowo).
- **Przypadek do ZUS** — pracownik z pełnymi danymi + PESEL (już w kotwicy `employees`), z absencją w `LeaveRequest` ⇒ blok RSA (przerwa) + RCA.
- **Anomalie null-policy** — dzień z grafikiem bez zdarzeń (`BRAK_RCP`); wejście bez wyjścia (`NIESPAROWANE`); zdarzenie RCP w dniu urlopu (`RCP_W_NIEOBECNOSCI`).

Wymogi: **idempotencja** (`INSERT … ON CONFLICT DO NOTHING`, wykorzystuje `rcp_event_dedup_import` — wszystkie zdarzenia seeda `source='IMPORT'`), **syntetyczne id-prefiksy**, **tylko istniejący podzbiór pracowników** (JOIN po id z kotwicy — bez tworzenia nowych `employees`), zero PESEL w skrypcie (PESEL już zaszyfrowany w kotwicy). Uruchamiany ręcznie na żywym tenancie po migracji (bramka §11).

---

## 9. Kryteria akceptacji (DOK-1 … DOK-14)

| # | Kryterium | Weryfikacja |
|---|-----------|-------------|
| **DOK-1** | Migracja tworzy `rcp_event` + `generated_document` (+ 5 enumów, indeksy, partial-unique dedup) czysto, create-only, z notą `ALTER OWNER` | `prisma migrate` / inspekcja SQL |
| **DOK-2** | `pairEvents`/`aggregateEwidencja` poprawnie parują zdarzenia i liczą czas przepracowany (z przerwami) | test jednostkowy (TDD) |
| **DOK-3** | Null-policy: brak RCP w dniu z grafikiem ⇒ `null` + `BRAK_RCP` (nie `0`); niesparowane ⇒ flaga; nieobecność z `LeaveRequest` rozpoznana | test jednostkowy |
| **DOK-4** | Nadgodziny dobowe (50%) i średniotygodniowe (100%) liczone, **bez double-countingu** godzin dobowych w tygodniowych | test jednostkowy |
| **DOK-5** | Nadgodziny nocne/niedzielne/świąteczne (100%) wg jawnej, oznaczonej-poglądowo konfiguracji | test jednostkowy |
| **DOK-6** | Dokument `NADGODZINY`: GENERATED → APPROVED tylko przez `zatwierdz` (MANAGER/HR); PRACOWNIK nie zatwierdza | test integracyjny + RBAC |
| **DOK-7** | Ewidencja i nadgodziny liczone **bez odszyfrowania PESEL** (SAFE_SELECT) | test (brak wywołania decrypt) |
| **DOK-8** | `ZUS_KEDU`: PESEL odszyfrowany kontrolowane **tylko** przy generacji/pobraniu ZUS + wpis audytowy ids-only `pesel-decrypt` | test integracyjny + inspekcja audytu |
| **DOK-9** | Render oddzielony: PDF (znak wodny „DEMO") i szkielet XML KEDU (DRA/RCA/RSA, `<demo>true`) powstają z modelu liczbowego | test render + snapshot |
| **DOK-10** | **Brak** stanu/ścieżki „wysyłka na zewnątrz"; enum `DocumentStatus` nie zawiera `SENT/EXPORTED_EXTERNAL` | test asertujący zbiór enuma (wzór strategic-brain „brak AUTO_AKCJA") |
| **DOK-11** | Audyt ids-only append-only dla `generuj`/`zatwierdz`/`pobierz(ZUS)`; brak PESEL/nazwisk w `audit_log` i w `computed_facts` | test + inspekcja |
| **DOK-12** | RBAC na 3 kontach: HR pełny / MANAGER scoped (tylko swoje jednostki, `scopeType=ALL` zablokowany) / PRACOWNIK tylko własna ewidencja | live na `admin`/`manager`/`pracownica.demo` |
| **DOK-13** | Ponowna generacja = **nowy** wiersz `replacesDocumentId` (append-only), stary `SUPERSEDED`; `contentHash` zamraża treść | test integracyjny |
| **DOK-14** | Seed idempotentny (`ON CONFLICT DO NOTHING`), kotwice (36 prac./832 zmiany) nietknięte; gate'y `tsc`/`jest`/`vitest` zielone | ponowny run seeda + testy |

---

## 10. Reużycia realnego kodu M2 (mapa, nie wymyślać API)

| Potrzeba | Realny wzór/plik do naśladowania |
|---|---|
| Controller thin + `@TenantRoute` + `@Roles` + scope w serwisie | `strategic-brain/strategic-brain.controller.ts`, `employees/employees.controller.ts` |
| Kolejność tras `mine`/`me` przed `:id` (ParseUUIDPipe) | `employees.controller.ts` (`@Get('me')` przed `@Get(':id')`) |
| Scope: `isGlobal`, `managedUnitIds`, `resolveScope` | `tenant-runtime/rbac/unit-scope.js`, `strategic-brain.controller.ts` |
| SAFE_SELECT allowlist + odszyfrowanie PESEL kontrolowane | `employees.service.ts` (`SAFE_SELECT`, `decryptEmployeePesel(this.encryption, tenantId, emp.pesel)`) |
| Audyt ids-only | `tenant-runtime/audit/audit.service.ts` + interceptor (`redactAuditPayload`, `SENSITIVE_KEYS`) |
| Model append-only przez event/replaces + `factors`/`facts` (Json) | `RecruitmentRecommendation` (`replacesRecommendationId`), `EmployeePerformanceSnapshot` (`algorithmVersion`, `configHash`) |
| Migracja create-only hand-authored + partial-unique + `ALTER OWNER` | `migrations/20260714000000_strategic_brain/migration.sql` |
| Czyste funkcje + spec (TDD) | `strategic-brain/scoring.util.ts` (+ `scoring.util.spec.ts`) |
| DTO + `class-validator` | `strategic-brain/dto/performance-config.dto.ts` |
| web-kit proxy `[[...path]]` | `app/api/strategic-brain/[[...path]]/route.ts` |
| web-kit `lib` (`xFetch` + Error + czyste kalkulatory + vitest) | `lib/strategic-brain.ts` (+ `.test.ts`), `lib/ai-grafik.ts` |
| Szyfrowanie PESEL (helpery) | `@hrobot/db` `encryptEmployeePesel`/`decryptEmployeePesel`, `@hrobot/shared` `EncryptionService` |
| Nawigacja RBAC-gate | `lib/nav.ts` (wpis `/dostepy` jako wzór dla `/dokumenty`) |

---

## 11. Bramki człowieka — PROPOZYCJE domyślne (do potwierdzenia przed buildem)

| # | Bramka | Propozycja demo | Uzasadnienie |
|---|--------|-----------------|--------------|
| 1 | Normy czasu pracy | dobowa 8h / średniotyg. 40h; okres rozliczeniowy 1 mies. | wartość poglądowa ⚖️ **[PRAWO-PL]** / 🔴 **[DECYZJA-4M]** — realny system i okres |
| 2 | Dodatki nadgodzinowe | 50% (doba) / 100% (tydz., noc, niedz./święta) | za art. 151¹ KP ⚖️ **[PRAWO-PL]** — do potwierdzenia radcy |
| 3 | Pora nocna / kalendarz świąt | 22:00–06:00; stała tablica świąt PL „demo" | 🔴 **[DECYZJA-4M]** — regulamin pracy 4Mobility |
| 4 | Które deklaracje ZUS na demo | DRA + RCA (+ RSA gdy absencja) | minimalny sensowny szkielet ⚖️ **[PRAWO-PL]** |
| 5 | PDF vs XML KEDU na demo | **oba** (PDF czytelny + szkielet XML) | pokazuje intencję, XML oznaczony demo |
| 6 | Pracownik widzi własną ewidencję | TAK (self, read-only) | transparentność RODO; nie widzi cudzych — 🔴 potwierdzić |
| 7 | Przechowywanie treści | kolumna w bazie tenanta (opcja A §4.4) | izolacja per tenant, prostota demo |
| 8 | Retencja dokumentów | `periodEnd + <okres ustawowy>` poglądowo | ⚖️ **[PRAWO-PL]** — realne okresy do potwierdzenia |
| 9 | Migracja na żywą bazę + seed | **bramka człowieka** + `ALTER OWNER` | procedura wdrożeniowa `reference_hrobot_m2_deploy` |
| 10 | Biblioteka PDF | do wyboru w fazie planu (CDP vs lib) | brak nowej ciężkiej zależności bez zgody |

---

## 12. Plan build (fazy)

1. **Spec → Codex.** Ten dokument → adversarial crosscheck (§13) → rekonsyliacja (osobna sekcja „14. Rekonsyliacja Codex", autorytatywna, jak w strategic-brain).
2. **Plan TDD** (`superpowers:writing-plans`).
3. **Backend model + silnik:** Prisma `RcpEvent`/`GeneratedDocument` + enumy → migracja create-only (hand-authored, partial-unique, `ALTER OWNER`) → `rcp.util.ts`/`overtime.util.ts`/`kedu.util.ts` + spec (TDD, null-policy, brak double-counting) → renderery PDF/KEDU → serwisy (generuj/zatwierdz/pobierz, SAFE_SELECT, decrypt-tylko-ZUS, audyt ids-only) → controller + RBAC + DTO → `jest` zielony.
4. **Seed:** `seed-demo-dokumenty.sql` (profile §8) → apply lokalnie/na tenancie za bramką.
5. **web-kit:** proxy `[[...path]]` → `lib/dokumenty.ts` (+vitest) → ekran lista/generuj/podgląd + banner RODO + RBAC-gate → `tsc`/`vitest` zielone.
6. **Live-verify RBAC** na 3 kontach (`admin`/`manager`/`pracownica.demo` na KC 8081, `reference_hrobot_m2_deploy`): scoping, self, bramka zatwierdzenia, audyt clean, znak wodny na plikach.
7. **Bramki §11 + wdrożeniowa** — human gate przed migracją/seedem na żywej bazie i przed pushem.

---

## 13. Do ataku przez Codex (adversarial crosscheck)

- **Model RCP:** czy `RcpEvent` (4 typy + 5 źródeł) wystarcza do ewidencji i nadgodzin bez modelu sesji w bazie? Czy `correctsEventId`/append-only korekty są spójne? Czy partial-unique dedup (`source IN ('IMPORT')`) nie przepuszcza dubli z `KONTROLA_DOSTEPU`? Czy `occurredAt` w UTC + agregacja w `Europe/Warsaw` poprawnie łapie DST/przełom doby oraz **pojęcie doby pracowniczej** (art. 128 §3 KP)?
- **Poprawność nadgodzin ⚖️:** double-counting doba-vs-tydzień; nadgodziny średniotygodniowe liczone na koniec okresu rozliczeniowego; pora nocna/niedziele/święta; limit roczny jako ostrzeżenie (nie blokada); traktowanie dni `null` (brak RCP) poza podstawą.
- **Poprawność KEDU ⚖️:** czy DRA/RCA/RSA są sensownie odwzorowane strukturalnie na danych syntetycznych; wersja schematu; brak twierdzenia, że to plik gotowy do wysyłki.
- **RODO/PESEL:** czy PESEL na pewno pojawia się TYLKO w treści ZUS i tylko za audytem; czy `computedFacts`/API listy/`audit_log` są wolne od PII (test); czy izolacja bazy (opcja A) wystarcza dla treści z PESEL; retencja.
- **Granica art. 22 / brak wysyłki:** czy na pewno nie ma ścieżki „wysyłka na zewnątrz"; czy enum `DocumentStatus` domyka to testem; czy `zatwierdz` to jedyna bramka i nie wykonuje akcji poza stemplem.
- **Reużycia vs realny kod:** czy `resolveScope`/`managedUnitIds`, `SAFE_SELECT`, `AuditService`, `decryptEmployeePesel`, proxy `[[...path]]`, partial-unique + `ALTER OWNER` zgadzają się z **faktycznymi** sygnaturami M2 (nie wymyślone API). Czy `proxyToTenantRuntime` obsługuje **binarny** strumień PDF (podgląd/pobierz) — realne ryzyko (zakłada JSON?).
- **Spięcie z RCP↔grafik:** skąd „pracownik miał grafik w tym dniu" dla null-policy `BRAK_RCP` — z `Shift`? Czy to deterministyczne i dostępne w serwisie?

---

## 14. Decyzje do potwierdzenia z 4Mobility (zbiorczo)

> Wszystkie 🔴/⚖️ z treści, zebrane dla kierownictwa 4Mobility/App Pro. Bez tych potwierdzeń build rusza na **wartościach poglądowych oznaczonych „demo"**, których **nie wolno** traktować jak produkcyjnych.

1. **System i normy czasu pracy** ⚖️ — system (podstawowy/równoważny/…), okres rozliczeniowy (1/3/4/12 mies.), definicja doby pracowniczej.
2. **Reguły nadgodzin** ⚖️ — stawki dodatków 50%/100%, pora nocna (godziny), kalendarz świąt/dni wolnych 4Mobility, limit roczny nadgodzin (150h czy z układu/umowy), rekompensata czasem wolnym vs dodatek.
3. **Które deklaracje ZUS i wersja KEDU** ⚖️ — DRA/RCA/RSA (i ew. inne), wersja schematu KEDU; czy demo ma jedynie szkielet czy walidowalny XML.
4. **PDF vs XML KEDU na demo** — potwierdzenie zakresu (proponujemy oba; XML jako szkielet oznaczony demo, bez wysyłki).
5. **Mapa typów urlopów/absencji** → kategorie RSA/ewidencji (`LeaveRequest.type` → kategoria).
6. **Widoczność własnej ewidencji dla pracownika** — TAK/NIE (RODO transparentność vs zakres demo).
7. **Przechowywanie treści dokumentów** — baza tenanta (opcja A) vs storage plikowy (B) + szyfrowanie-w-spoczynku.
8. **Okresy retencji** dokumentów kadrowo-płacowych per typ ⚖️.
9. **Źródło stawki do ewentualnej wyceny** — czy używamy `PositionCostRate` (dziś SP4/koszty), czy poza zakresem M3.
10. **Biblioteka/silnik PDF** — akceptacja zależności (CDP z KM-workflow vs lekki lib).

---

## 15. Ograniczenia realizacji tego SPEC-u (uczciwość)

- **Wartości prawne są poglądowe.** Autor nie jest radcą prawnym ani specjalistą kadrowo-płacowym; wszystkie ⚖️ **[PRAWO-PL]** wymagają weryfikacji po stronie 4Mobility/App Pro. Spec podaje **kierunek i strukturę**, nie autorytatywne stawki.
- **Środowisko bez żywej/shadow bazy** → migracja hand-authored (jak strategic-brain); poprawność względem generatora Prisma zweryfikować w fazie planu na maszynie z bazą.
- **KEDU na demo = szkielet strukturalny**, nie plik zdatny do realnej wysyłki; brak podpisu, brak integracji z Płatnikiem — świadomie poza MVP.
- Wszystko powyżej pozostaje spójne z kotwicami demo (36 pracowników, 832 zmiany **nietknięte**) i z twardą granicą **braku jakiejkolwiek wysyłki na zewnątrz**.
