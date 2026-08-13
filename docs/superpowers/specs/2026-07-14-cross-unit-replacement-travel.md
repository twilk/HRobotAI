# SPEC — Zastępstwa cross-unit z kosztem i czasem dojazdu + domknięcie pętli AI Grafik

> **Data:** 2026-07-14 · **Kontekst:** HRobot M2, tenant demo 4Mobility. Wynik diagnozy 7-warstwowej pętli zastępstw (screenshot Marka: wszystkie propozycje ESKALOWANE, KANDYDAT `—`).
> **Status:** DRAFT do crosschecku Codeksa, potem plan implementacyjny.
> **Decyzje użytkownika:** (F4) **cross-unit z kosztem i czasem dojazdu, uwzględniając transport między jednostkami**; (F5) autonomia **AUTO_ASK_CONSENT** (AI samo pyta kandydata).

## 0. Root-cause (z diagnozy)
Pula zastępców w `replacement.service` = `{ unit = jednostka zmiany, kwalifikacja = shift.role, ≠ wypadający }`. W każdym regionie jest **1 koordynator**, więc gdy Anna (jedyna w Region Centrum) wypada z KOORDYNATOR-zmiany → pula pusta → `ESCALATED`, KANDYDAT `—`, Δkoszt null („brak stawki"). System działa poprawnie; **brakuje kogokolwiek do zaproponowania**, bo pula jest ograniczona do jednej jednostki. Wtórnie: nawet feasible kandydat musi mieć **login** (inaczej `EMPLOYEE_UNREACHABLE`).

## 1. Cel
Gdy w jednostce brak zastępcy, silnik szuka **wśród kwalifikowanych z innych jednostek**, wliczając **dojazd (dystans, czas, koszt)** do lokalizacji zmiany — i proponuje najlepszego. Pętla domyka się end-to-end: wykrycie → propozycja (z dojazdem) → zgoda kandydata (AUTO_ASK_CONSENT) → zatwierdzenie managera → reasygnacja + Δkoszt (praca + dojazd) + audyt.

## 2. Dane, na których stoimy (zweryfikowane na żywo)
- `lokalizacje`: **`lat`, `lng` — 15/15 wypełnione** (lotniska + Stacje Mobilności w PL).
- `employees`: **`home_lat`, `home_lng`, `home_address` — 36/36 wypełnione**; `qualifications` (KOORDYNATOR/KIEROWCA/SERWISANT), `unit_id`, `position`.
- Feasibility seam: `SwapFeasibilityValidator.validate()` deklaruje H1–H6 (rest, kwalifikacje, brak nakładania, …) — miejsce na **H-dojazd**.
- Koszt: `cost.service.shiftCost(rate, shift)` = `hourlyRate(position, employmentType) × godziny`. Δkoszt hook w `ai-proposal.service.computeEstimatedCost`.
- **Fakt demo:** Jan Nowak (KOORDYNATOR, Region Północ) mieszka **~4 km** od Lot. Chopina (zmiana Anny) → idealny kandydat cross-unit z minimalnym dojazdem. Piotr Wiśniewski (Region Południe) ~287 km → kontrast „drogi dojazd".

## 3. Model dojazdu (nowy `travel.util` + `TravelService`)
- **Dystans:** haversine(base_kandydata, lokalizacja_zmiany) w km. `base` = **HOME kandydata** (`home_lat/lng`) — realny punkt startu.
- **Czas dojazdu:** `dystans / avgSpeedKmh` → minuty. `avgSpeedKmh` konfigurowalne (domyślnie ~60).
- **Koszt dojazdu:** `dystans × perKmRatePLN × przejazdy`. Domyślnie „kilometrówka" (~1.15 zł/km), round-trip (tam+z powrotem = ×2). Konfigurowalne.
- **Konfiguracja** (rozszerz `AiSchedulingConfig` lub nowy `TravelPolicy`): `avgSpeedKmh`, `perKmRatePLN`, `maxTravelMinutes` (twardy limit feasibility), `roundTrip`.
- **RODO (KLUCZOWE):** `home_lat/lng/home_address` to PII. Kalkulacja dojazdu biegnie **wyłącznie server-side**; na zewnątrz (API/UI/audyt) wychodzą **tylko pochodne** (dystans km, czas min, koszt zł) — **nigdy** współrzędne ani adres domowy. Rozważ alternatywę „bazy jednostki" jeśli prawnik odrzuci home (bramka człowieka §9).

## 4. Silnik zastępstw (zmiany w `replacement.service` / `ai-proposal.service`)
- **Pula dwupoziomowa (tiered):**
  1. **Lokalni** — jak dziś (ta sama jednostka, kwalifikacja, ≠ wypadający), **dojazd = 0**.
  2. **Cross-unit** — kwalifikowani z INNYCH jednostek, jeśli brak feasible lokalnych (lub zawsze, z karą dojazdu — patrz ranking).
- **Feasibility (H-dojazd, dołożone do H1–H6):** kandydat cross-unit jest feasible tylko gdy `czasDojazdu ≤ maxTravelMinutes` **oraz** zdąży na start zmiany z uwzględnieniem poprzedniej zmiany + rest (H2). Lokalni: bez ograniczenia dojazdu.
- **Δkoszt = [koszt(kandydat, praca) − koszt(wypadający, praca)] + kosztDojazdu(kandydat).** Lokalni: kosztDojazdu = 0. Zapis na `AiProposal.estimatedCost` (jak dziś); dodatkowo persist składowe dojazdu na kandydacie (`travelKm`, `travelMinutes`, `travelCost`) — nowe kolumny na `ai_proposal_candidate`.
- **Ranking:** feasible sortowani rosnąco po **koszcie całkowitym** (praca Δ + dojazd), tie-break jak dziś (godziny w tygodniu, potem id). Efekt: lokalny (0 dojazdu) wygrywa, gdy jest; cross-unit wchodzi, gdy trzeba, najtańszym dojazdem (Jan Nowak 4 km > Piotr 287 km).
- **ESKALACJA** tylko gdy **brak feasible lokalnych I cross-unit** (prawdziwy brak zastępcy) — realny, rzadszy przypadek.

## 5. Autonomia (F5)
Ustaw `AiSchedulingConfig.autonomyLevel = AUTO_ASK_CONSENT` (per tenant/jednostka). Po wykryciu wypadnięcia AI **od razu** prosi top kandydata o zgodę → propozycja idzie do `PENDING_EMPLOYEE_CONSENT` (nie DRAFT), o ile kandydat osiągalny (ma login). Człowiek dalej zatwierdza (art. 22 RODO — manager na końcu).

## 6. web-kit
- **Skrzynka managera (`proposal-inbox`):** kolumna KANDYDAT pokazuje kandydata + **badge dojazdu** („cross-unit · 4 km · ~4 min · +9 zł") gdy dojazd > 0; Δkoszt jako rozbicie **praca + dojazd = razem**. Dla ESKALOWANYCH (naprawdę brak): jasny komunikat zamiast pustego `—` (F3/F4 copy).
- **Ekran zgody kandydata (`ai-consent-section`, /zamiany):** kandydat widzi zmianę + lokalizację + swój dojazd (km/czas) przed akceptacją.
- **Fix copy:** „brak stawki" → „—" / „brak kandydata" gdy `estimatedCost` null z braku kandydata (nie z braku stawki).

## 7. Dane demo (odblokowanie pętli — reprodukowalne w seedzie)
- Utwórz **`pracownica.demo` / `Pracownica!2026`**: nowa pracownica **KOORDYNATOR**, position „Koordynator zmiany" (stawka istnieje), **inna jednostka** (Region Północ), `home_lat/lng` blisko Warszawy (~5–10 km od Lot. Chopina) → tania kandydatka **cross-unit**. Pełny łańcuch: Keycloak account + `User`(keycloakSub) + `Employee`(user_id link) → osiągalna do zgody i do logowania.
- Efekt demo: Anna (Centrum) wypada → AI proponuje **Pracownicę** (cross-unit, ~7 km, +~16 zł dojazdu) → Pracownica loguje się i akceptuje → Marek zatwierdza → zmiana reasygnowana + Δkoszt (praca + dojazd) + audyt.
- (Opcjonalnie) nadaj login istniejącemu Janowi Nowakowi jako 2. kandydatowi, by pokazać ranking dwóch cross-unit.

## 8. Plan (TDD, po crosschecku)
- [ ] `travel.util` (haversine, czas, koszt) + testy (znane pary miast).
- [ ] `TravelService`/policy config (`avgSpeedKmh`, `perKmRatePLN`, `maxTravelMinutes`, `roundTrip`).
- [ ] Migracja: `ai_proposal_candidate` + `travel_km/travel_minutes/travel_cost` (create-only).
- [ ] `replacement.service`: pula tiered + H-dojazd feasibility + ranking po koszcie całkowitym. Testy: lokalny wygrywa; brak lokalnego → cross-unit najtańszy; za daleko → infeasible; brak obu → ESKALACJA.
- [ ] `ai-proposal.service.computeEstimatedCost`: + kosztDojazdu; persist składowych na kandydacie.
- [ ] Config autonomii → AUTO_ASK_CONSENT.
- [ ] web-kit: badge dojazdu + rozbicie Δkoszt + copy fix; ekran zgody z dojazdem.
- [ ] Seed: `pracownica.demo` (KC + User + Employee KOORDYNATOR Region Północ, home ~Warszawa).
- [ ] Live-verify pełnej pętli na 4 kontach; koszty przed/po; audyt ids-only + bez PII dojazdu.

## 9. Bramki człowieka
- **RODO dojazdu:** czy wolno liczyć dojazd z `home` pracownika (PII) — czy z „bazy jednostki". (Rekomendacja: home server-side, na zewnątrz tylko km/czas/zł.)
- Parametry: `perKmRatePLN`, `avgSpeedKmh`, `maxTravelMinutes`, round-trip — decyzja biznesowa.
- Czy cross-unit zawsze w puli (z karą), czy tylko gdy brak lokalnych. (Rekomendacja: tylko gdy brak lokalnych feasible — tańsze obliczeniowo, jasna narracja.)
- Aplikacja migracji na żywą bazę + seed = bramka wdrożeniowa.

## 10. Znaleziska diagnozy — status w tym specu
| # | Znalezisko | Decyzja |
|---|---|---|
| F1 | Region ma 1 koordynatora → pula pusta → ESKALACJA | Cross-unit pool (§4) + `pracownica.demo` (§7) |
| F2 | Kandydat musi mieć login (reachable) | `pracownica.demo` pełny łańcuch KC+User+Employee (§7) |
| F3 | Δkoszt „brak stawki" = brak kandydata, nie bug stawki | Copy fix (§6); Δkoszt liczy się (zweryfikowane 0.00 na SERWISANT) |
| F3b | estimatedCost 0.00 na działającej propozycji | Zweryfikować poprawność Δ (praca) przy realnym kandydacie |
| F4 | ESKALOWANE = ślepy zaułek UI | Rozwiązane u źródła (cross-unit); ESKALACJA rzadka + komunikat |
| F5 | Pod SUGGEST_ONLY trzeba klikać „Zapytaj o zgodę" | AUTO_ASK_CONSENT (§5) |
| F6 | Ekran zgody istnieje | + info o dojeździe (§6) |
| F7 | Auto-scan po approve DZIAŁA | bez zmian |

---

## 11. Reconciliacja po Codex (adversarial) — OBOWIĄZUJĄCA

5×[P1] + 3×[P2], wszystkie trafne. Feature jest **architektonicznie głębszy** niż zakładał draft — poniżej korekty; §3–§6 czytać przez ten pryzmat.

- **[P1-1] Seam feasibility źle opisany.** Aktywny walidator to `OptimizerSwapFeasibilityValidator` (nie AllowAll), ale deklaruje H1–H4 i pakuje `latLng:null, homeLatLng:null, travelMatrix:[]` (sloty geo/dojazd ISTNIEJĄ, ale puste — optymalizator był projektowany pod dojazd, nie zasilony). **Korekta:** logikę dojazdu-feasibility zrób w **silniku zastępstw (TS)** dla MVP, NIE „dołóż H-travel do H1–H6". (Docelowo: zasil sloty optymalizatora.)
- **[P1-2] Cross-unit łamie model „jednostka zmiany = jednostka przypisanego".** Jednostka wakującej zmiany = `shift.employee.unitId`; po `approve` `Shift.employeeId` = kandydat cross-unit → zmiana „przenosi się" do jednostki kandydata, choć fizyczna lokalizacja się nie zmienia. **Korekta:** wprowadź **jednostkę-właściciela zmiany** (po `lokalizacja`/demand), albo **zamroź jednostkę-właściciela propozycji na czas tworzenia** (oryginalna jednostka = Region Centrum/Marek) i po niej autoryzuj + audytuj — NIE po bieżącym `employee`.
- **[P1-3] Osiągalność liczona PO rankingu → demo i tak eskaluje.** `topFeasible=feasible[0]`; sprawdzany tylko login top-1. Jan Nowak (rank 1, bez loginu) → `EMPLOYEE_UNREACHABLE`, NIE „spadnij na pracownicę". **Korekta:** dla `AUTO_ASK_CONSENT` wybierz jako aktywnego **pierwszego feasible OSIĄGALNEGO** (persystuj resztę jako kandydatów), nie top-1-bez-loginu.
- **[P1-4] Cross-unit przecieka przez granice zarządzania.** Manager scoped po `UserRole`; UI ma pokazać nazwiska + dojazd pracownika z INNEJ jednostki, a autoryzacja sprawdza tylko jednostkę wakującej zmiany. **Korekta:** propozycje cross-unit wymagają **globalnego aktora (HR/ADMIN)** LUB podwójnej akceptacji LUB jawnej polityki widoczności z redakcją. (Najprościej dla MVP: cross-unit widzi/zatwierdza tylko HR/ADMIN; manager — tylko lokalnych.)
- **[P1-5] Ranking niewykonalny z obecnego kontraktu.** Pula selektuje tylko `id, preferredShiftStart`; `RankedCandidate` nie ma cost/travel/reachability. **Korekta:** poszerz pulę + `RankedCandidate` o `unitId, homeLat/Lng, reachable, workCostDelta, travelKm/min/cost`.
- **[P2-6] Δkoszt-praca OK; dojazd osobno.** `computeEstimatedCost` poprawny (candidate−vacated, guard waluty); `0.00` przy tej samej pozycji to NIE bug. **Korekta:** dojazd jako **osobny składnik** z rozbiciem (praca + dojazd = razem), nie nadpisuj `estimatedCost`.
- **[P2-7] RODO za lekko.** `home_address` jest szyfrowany PII; `home_lat/lng` „nie-PII" to naciągane — `travelKm/min/cost` per lokalizacja **trianguluje dom** (zwłaszcza przy powtarzalnych propozycjach). **Korekta:** MVP licz od **bazy jednostki/lokalizacji**, nie domu; albo tylko zgrubne kubełki + ograniczona widoczność (HR/ADMIN).
- **[P2-8] Haversine/60km-h/round-trip = demo-grade, nie cost-grade.** Prosta linia zaniża realny dystans drogowy. **Korekta:** nazwij to **„szacunkowy dojazd (demo)"**, realny routing/tabela taryf przed traktowaniem jako zwrot kosztów.
- **[Sound] Potwierdzone:** `AUTO_ASK_CONSENT → PENDING_EMPLOYEE_CONSENT` gdy top-kandydat ma `Employee.userId`; zgoda przez `User.keycloakSub → Employee.user`. **`pracownica.demo` MUSI mieć: Keycloak + `User.keycloakSub` + `Employee.userId`** (pełny łańcuch).

### Rekomendowany zakres MVP (demo-pragmatyczny, po reconciliacji)
1. Dojazd-feasibility + koszt w **silniku zastępstw (TS)**; `travel.util` (haversine, „szacunkowy dojazd (demo)").
2. **Jednostka-właściciel propozycji zamrożona** na oryginalnej (Region Centrum) → Marek/HR zatwierdza; brak „przenoszenia" jednostki.
3. Cross-unit **widoczny/zatwierdzany przez HR/ADMIN** (globalny aktor); manager lokalnie. (Albo: pokazuj managerowi cross-unit tylko-do-odczytu, akcja u HR.)
4. Wybór **pierwszego feasible OSIĄGALNEGO** jako aktywnego kandydata.
5. Δkoszt = praca (jest) **+ dojazd (osobno, z rozbiciem)**.
6. RODO: baza = **lokalizacja/jednostka** (nie dom); na zewnątrz tylko km/czas/zł, widoczność HR/ADMIN.
7. `pracownica.demo`: pełny łańcuch KC+User+Employee, KOORDYNATOR, jednostka blisko Warszawy → osiągalna cross-unit kandydatka.
8. Migracja `ai_proposal_candidate` (+travel_*) create-only; live-verify na 4 kontach.

**Odłożone (pełna wersja, poza MVP):** zasilenie slotów optymalizatora CP-SAT (travelMatrix), realny routing drogowy, „jednostka-właściciel" na modelu `Shift`/demand, podwójna akceptacja cross-unit.

### Decyzje zatwierdzone (user, 2026-07-14): zakres **Demo-MVP**, baza dojazdu **dom (zgrubnie + ograniczona widoczność)**, governance **manager posiada drop-out i zatwierdza** (jednostka-właściciel propozycji zamrożona; dojazd zaokrąglony, widoczny dla właściciela drop-outu + HR/ADMIN, oznaczony „szacunkowy dojazd (demo)").

## 12. Plan implementacyjny MVP (TDD, subagent-driven)
- **Etap 1 — silnik + migracja:** `travel.util` (haversine → km, `round`; `travelMinutes = km/avgSpeed`; `travelCost = km × perKm × (roundTrip?2:1)`; oznacz demo) + testy (znane pary). Migracja create-only: `ai_proposal.owning_unit_id TEXT` (zamrożona jednostka), `ai_proposal_candidate.travel_km/travel_minutes/travel_cost`, pola travel-policy + `autonomy_level` default na `ai_scheduling_config`. Poszerz `RankedCandidate` (unitId, homeLat/Lng, reachable, workCostDelta, travelKm/min/cost). Pula **tiered** (lokalni → cross-unit gdy brak feasible lokalnych), **H-dojazd** (`travelMinutes ≤ maxTravelMinutes` + zdąży na start), ranking po koszcie całkowitym (praca Δ + dojazd), **wybór pierwszego feasible OSIĄGALNEGO** jako aktywnego.
- **Etap 2 — koszt + autonomia + owning-unit:** `computeEstimatedCost` = praca (jest) **+ dojazd (osobny składnik, breakdown)**; persist `travel_*` na kandydacie. Autoryzacja list/approve/consent + audyt po **`owning_unit_id`** (zamrożonej), nie po bieżącym `employee`. `autonomyLevel = AUTO_ASK_CONSENT`.
- **Etap 3 — web-kit:** kolumna KANDYDAT: nazwa + badge „cross-unit · ~N km · ~M min · +X zł"; Δkoszt jako rozbicie „praca + dojazd = razem"; copy „brak stawki" → „—/brak kandydata"; ekran zgody kandydata z info o dojeździe. RODO: zaokrąglone, widoczne dla właściciela/HR-ADMIN.
- **Etap 4 — dane:** `pracownica.demo`/`Pracownica!2026` pełny łańcuch (Keycloak w `seed-keycloak-demo.mjs` + `User.keycloakSub` + `Employee.userId`), KOORDYNATOR, jednostka Region Północ, `home_lat/lng` ~Warszawa (≈7 km od Lot. Chopina) → osiągalna cross-unit kandydatka. Reprodukowalne w seedzie.
- **Live-verify:** Anna→L4 (14.07) → AI proponuje Pracownicę (cross-unit, ~7 km, +dojazd) → Pracownica loguje się i akceptuje → Marek zatwierdza → zmiana reasygnowana + Δkoszt (praca+dojazd) + audyt bez PII. Na 4 kontach.
