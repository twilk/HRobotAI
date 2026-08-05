# AI Grafik Manager — spec-seed

> **Status:** seed do brainstormu/planu (NIE zatwierdzony spec). Wejście do `/office-hours`
> (walidacja produktowa) lub `/plan-eng-review` (architektura). Duży feature — rozbij na 4
> podprojekty (per funkcjonalność) i rozstrzygnij „Otwarte decyzje" z właścicielem produktu
> przed planowaniem TDD.
> **Data:** 2026-07-13 · **Kontekst:** HRobot M2 (Grafik CP-SAT + Agent AI), 4Mobility / PARP.
> **Powiązane:** [[project_m2_grafik_decomposition]], employee-management-rbac (P0–F4, feat/demo-4mobility).

---

## Rola i cel
Zaprojektuj i zaimplementuj moduł „AI Grafik Manager": wyróżniony wpis w menu otwierający panel
konfiguracyjny + 4 agentowe funkcjonalności, które wspomagają managera w utrzymaniu grafiku
zgodnego z popytem, budżetem i prawem pracy — z człowiekiem w pętli przy każdej nieodwracalnej
decyzji.

To jest DUŻY feature spinający istniejące podsystemy. Zanim zaczniesz kodować, potraktuj ten
dokument jako materiał wejściowy do brainstormu/planu: rozbij na podprojekty (per funkcjonalność),
rozstrzygnij „Otwarte decyzje" niżej z właścicielem produktu, dopiero potem planuj TDD.

## Kontekst systemowy (co już istnieje — użyj ponownie, nie buduj od zera)
- Monorepo pnpm+turbo: `apps/tenant-runtime` (NestJS, Jest), `apps/control-plane`,
  `docs/design/web-kit` (Next.js 15, vitest), `grafik-optimizer` (Python CP-SAT),
  `agent-service` (scorer numpy, port 8010), `packages/{db,shared,config}`.
- RBAC (Keycloak, realm hrobot-staging, claim `hrobot_roles`): PRACOWNIK, MANAGER, HR,
  ADMIN_KLIENTA. `isGlobal` = HR∨ADMIN_KLIENTA (widzą wszystko); MANAGER scoped do zarządzanych
  jednostek (`UserRole`); PRACOWNIK widzi własną jednostkę i własny grafik. Wzorce w
  `apps/tenant-runtime/src/tenant-runtime/rbac/unit-scope.ts`.
- Encje tenanta (Prisma, `packages/db/prisma/tenant/schema.prisma`): `Employee`
  (position, employmentType {UMOWA_O_PRACE|UMOWA_ZLECENIE|UMOWA_O_DZIELO|B2B}, etat 0..1,
  unitId, qualifications, preferredDaysOff, preferredShiftStart), `Unit`, `Lokalizacja`,
  `Shift`, `ShiftSwapRequest` (maszyna stanów, np. PENDING_MANAGER), `Demand`/month-shifts
  (wzorzec popytu — już seedowany na Jun–Sep), `AuditLog` (append-only, trigger blokuje
  UPDATE/DELETE).
- Solver: `GrafikService.solveGrafik` (CP-SAT) z twardymi ograniczeniami H1–H4 (pokrycie ról,
  odpoczynek dobowy, itp.). Walidator wykonalności zastępstw:
  `shift-swap/optimizer-swap-feasibility.validator` — REUŻYJ go do sprawdzania kandydatów.
- Agent AI: `agent-service` (scorer) — REUŻYJ do rankingu kandydatów/propozycji.
- RODO: PESEL szyfrowany AES-256-GCM + blind index (`packages/db/src/employeePii.ts`),
  NIGDY nie opuszcza API; projekcja allowlist `toSafeEmployee`/`SAFE_SELECT`. Adres domowy
  (homeAddress/homeLat/homeLng) to też PII — nie może trafić do komunikatów ani audytu.
- Audyt: każda akcja agenta i każda zgoda MUSZĄ być zapisane w `AuditLog`
  (`AuditService.log`), bez PII w payloadzie.

## Zakres UI
1. Wyróżniony wpis w menu „AI Grafik Manager" (widoczny dla MANAGER/HR/ADMIN_KLIENTA;
   PRACOWNIK go NIE widzi — analogicznie do gatingu `canManage`).
2. Panel konfiguracyjny (per tenant, edytowalny przez HR/ADMIN; MANAGER: konfiguracja
   własnych jednostek) z co najmniej:
   - Poziom autonomii agenta (drabina): `SUGGEST_ONLY` → `AUTO_NOTIFY` → `AUTO_ASK_CONSENT`
     → `AUTO_COMMIT_ON_APPROVAL`. Domyślnie najbezpieczniejszy. Każdy krok wyżej to świadoma
     zgoda właściciela.
   - Kanały komunikacji (in-app / e-mail / SMS — patrz „Otwarte decyzje"), godziny ciszy,
     limit częstotliwości wiadomości, język komunikatów (PL domyślnie).
   - Odbiorcy powiadomień managerskich; kolejność/fairness doboru kandydatów.
   - Profile sezonowości (per jednostka/lokalizacja) i horyzont prognozy.
   - Stawki kosztowe per stanowisko + reguły nadgodzin + progi/limity budżetu i alerty.

## Funkcjonalności

### 1. Autonomiczne zastępstwo przy wypadnięciu z grafiku
- Wyzwalacz: pracownik staje się niedostępny na przypisaną zmianę (nieobecność/urlop/L4,
  odrzucenie zmiany, wniosek o zamianę).
- Przepływ: agent wybiera kandydatów (walidacja przez istniejący walidator wykonalności:
  H1–H4, odpoczynek dobowy, pokrycie roli, kwalifikacje, limit etatu/nadgodzin), rankuje ich
  scorerem (agent-service, uwzględniając też koszt z funkcji 4 i fairness) → POWIADAMIA managera
  → PYTA wybranego pracownika o zgodę (komunikacja autonomiczna). Dopiero po zgodzie pracownika
  I akceptacji managera następuje realny commit reprzydziału zmiany.
- Granica autonomii: agent PROPONUJE i KOMUNIKUJE, ale NIE zatwierdza zmiany rosteru bez
  wymaganej zgody+akceptacji. Zgoda jest jawna, z terminem ważności i możliwością cofnięcia;
  wszystko audytowane. Wpina się w maszynę stanów `ShiftSwapRequest` (rozszerz o propozycje
  inicjowane przez AI).
- Przypadki brzegowe: brak wykonalnego kandydata (eskalacja do managera + sugestia mocy
  z funkcji 2/4), kilku równorzędnych kandydatów (kolejność wg polityki), kandydat nie
  odpowiada w oknie czasu (timeout → następny), kandydat cofa zgodę, kolizja z równoległą
  zmianą grafiku.
- Kryteria akceptacji: propozycja zawsze wykonalna wg walidatora; żadna zmiana rosteru bez
  pary zgoda+akceptacja; pełny ślad w audycie; komunikaty bez PII.

### 2. Dopasowanie do popytu / sezonowość
- Cel: grafik sygnalizuje sezonowość biznesu (4Mobility — szczyty wakacyjne/świąteczne,
  weekendy) i podpowiada, czy potrzebne są dodatkowe moce przerobowe.
- Dane: historyczny popyt (istniejące month-shifts) + konfigurowalny profil sezonowości.
  Wynik: per tydzień/jednostka luka popyt–podaż, rekomendacja (dodać zmiany / czasowe moce)
  zasilająca wejście popytowe solvera CP-SAT.
- Granica autonomii: to rekomendacja/podpowiedź — nie tworzy zatrudnień. Może przygotować
  propozycję dodatkowych zmian do zatwierdzenia.
- Przypadki brzegowe: brak historii dla nowej jednostki (fallback na profil ręczny),
  sezonowość vs zdarzenia jednorazowe, świadome oznaczenie odchyleń.
- Kryteria akceptacji: dla znanego szczytu (np. lipiec) moduł pokazuje lukę i rekomendację
  spójną z seedowanym popytem; rekomendacje da się wstrzyknąć do solvera.

### 3. Zmiany AD-HOC z autonomiczną zgodą
- Wyzwalacz: pojawia się pilny, nieplanowany temat/popyt (np. nagłe zapotrzebowanie na zmianę).
- Przepływ: agent autonomicznie kontaktuje uprawnionych pracowników (kolejność: fairness,
  koszt, kwalifikacje, dostępność), uzyskuje zgodę na przyjęcie zmiany, przydziela po zgodzie
  (+ akceptacji managera zależnie od poziomu autonomii). Te same granice/zgody/audyt co w #1.
- Przypadki brzegowe: nikt nie wyraża zgody (eskalacja), równoległe ad-hoc konkurujące o tych
  samych ludzi, godziny ciszy/limit wiadomości.
- Kryteria akceptacji: przydział tylko po jawnej zgodzie; audyt; komunikaty bez PII;
  respektowanie godzin ciszy i limitów.

### 4. Budżetowanie kosztów
- Cel: na poziomie grafiku dynamiczna kalkulacja kosztów wg standardowego kosztu na stanowisku;
  grafik zmienia się dynamicznie → koszt przelicza się na bieżąco.
- Dane: tabela stawek per stanowisko (nowy model — patrz „Model danych"), mnożniki nadgodzin,
  etat. Wyświetlanie: koszt całkowity per tydzień/jednostka, Δkoszt każdej propozycji AI
  (funkcje 1/3), progi budżetu i alerty przy przekroczeniu.
- Integracja: koszt może wejść jako składnik funkcji celu solvera i jako kryterium rankingu
  kandydatów w #1/#3.
- Przypadki brzegowe: brak stawki dla stanowiska (oznacz, nie zeruj po cichu), różne stawki
  per typ umowy, nadgodziny, waluta/zaokrąglenia.
- Kryteria akceptacji: koszt tygodnia zgadza się z sumą (stawka×godziny×etat); każda propozycja
  AI pokazuje wpływ na koszt; alert przy przekroczeniu progu.

## Zasady przekrojowe (bezpieczeństwo agentowe)
- Nic nieodwracalnego (realny reprzydział, wysyłka wiadomości do pracownika, zatwierdzenie
  zmiany) bez wymaganej zgody/akceptacji zgodnie z poziomem autonomii. Domyślnie najniższy poziom.
- Zgoda pracownika: jawna, świadoma, z terminem, cofalna, audytowana. Komunikat NIE zawiera
  PESEL/adresu — tylko niezbędne dane zmiany.
- Wychodząca komunikacja: rate-limit, godziny ciszy, dziennik wysyłek, brak spamu.
- Każda akcja agenta → wpis w `AuditLog` (bez PII), z modelem/decyzją i uzasadnieniem.
- Idempotencja i odporność na wyścigi przy równoległych zmianach grafiku.

## Model danych (nowe encje/pola — do potwierdzenia w planie)
- `PositionCostRate` (stanowisko × typ umowy → stawka, mnożnik nadgodzin, waluta).
- `SeasonalityProfile` (jednostka/lokalizacja → współczynniki per okres, horyzont).
- `AiSchedulingConfig` (per tenant/jednostka: poziom autonomii, kanały, godziny ciszy,
  progi budżetu, polityka fairness).
- `AiProposal` (typ: REPLACEMENT|ADHOC|CAPACITY|COST_ALERT; stan; kandydaci; score; Δkoszt;
  powiązanie z Shift/ShiftSwapRequest; ślad decyzji).
- `ConsentRecord` (pracownik, propozycja, kanał, stan: PENDING|GRANTED|DECLINED|REVOKED|EXPIRED,
  znaczniki czasu).

## Poza zakresem MVP (świadomie)
- Provisioning kont logowania dla nowo dodanych pracowników.
- Integracja z zewnętrznym payrollem/kadrami.
- Realna wysyłka SMS/e-mail w demo (użyj kanału in-app + symulacji, chyba że infra istnieje).

## Otwarte decyzje / brakująca infrastruktura (rozstrzygnij PRZED implementacją — nie zmyślaj)
1. **KANAŁ KOMUNIKACJI**: czy HRobot ma usługę powiadomień (in-app / e-mail / SMS)? To fundament
   3 z 4 funkcji. Jeśli nie — MVP oprzyj na powiadomieniach in-app (pracownik ma login Keycloak
   i widzi własny grafik), a e-mail/SMS zostaw jako abstrakcję z adapterem.
2. **DANE KONTAKTOWE** pracownika (e-mail/telefon) i powierzchnia zgody — czy istnieją? Jeśli tylko
   in-app, zgoda przez panel pracownika.
3. **STAWKI KOSZTOWE** per stanowisko — nie istnieją; potrzebny nowy model + seed danych syntetycznych.
4. **DANE SEZONOWOŚCI** — bazujemy na seedowanym popycie czy na osobnym profilu? Zdefiniuj źródło.
5. **PODSTAWA PRAWNA** autonomicznej komunikacji i przydziału (prawo pracy, RODO, dobrowolność
   zgody) — potwierdź granice, zwłaszcza dla umowy o pracę.
6. Zakres **akceptacji managera** per poziom autonomii (kiedy wymagana, kiedy tylko powiadomienie).

## Kryteria akceptacji / scenariusz demo (na 3 kontach: PRACOWNIK, MANAGER, HR/ADMIN)
- Menu „AI Grafik Manager" i panel widoczne tylko dla MANAGER/HR/ADMIN; PRACOWNIK ich nie widzi.
- Wypadnięcie z grafiku → wykonalna propozycja zastępstwa → powiadomienie managera → zapytanie
  o zgodę → commit dopiero po zgodzie+akceptacji → ślad w audycie, zero PII w komunikacie.
- Widok sezonowości pokazuje lukę popytu dla znanego szczytu i rekomendację.
- Ad-hoc → autonomiczne pozyskanie zgody → przydział → audyt.
- Panel kosztów: koszt tygodnia = suma stawek; każda propozycja pokazuje Δkoszt; alert progu.

## Ograniczenia demo (twarde)
- Wyłącznie dane syntetyczne (RODO). Nie modyfikuj kotwic demo (36 pracowników, hero week
  13–19 lipca, wniosek J5 = PENDING_MANAGER, tygodnie INFEASIBLE). Podczas testów realne
  mutacje zostaw jako rekomendacje/symulacje, nie jako wykonane zmiany.
- Sekrety nie trafiają do repo (repo jest publiczne).

## Proponowana dekompozycja na podprojekty (kolejność)
1. **Zastępstwo przy wypadnięciu** (funkcja 1) — najmocniej wpina się w istniejący shift-swap
   + walidator wykonalności; najlepszy pierwszy kęs. Wymaga: kanał komunikacji + ConsentRecord + AiProposal.
2. **Budżetowanie kosztów** (funkcja 4) — samodzielne, zasila ranking i solver; wymaga PositionCostRate.
3. **Sezonowość / dopasowanie do popytu** (funkcja 2) — analityka nad istniejącym popytem.
4. **Ad-hoc z autonomiczną zgodą** (funkcja 3) — reużywa infrastruktury z #1 (komunikacja+zgoda).
Wspólne fundamenty (kanał komunikacji, ConsentRecord, AiSchedulingConfig, AiProposal, audyt)
warto wydzielić jako podprojekt 0 przed #1.
