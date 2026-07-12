# Scenariusz demo — spotkanie z 4Mobility (M2: Grafik + Agent AI)

> Cel: 15–20 min, pokazać 2 moduły M2 na żywo, na danych syntetycznych (RODO), z podkreśleniem różnicy: **agent, który się uczy**. Prowadzi kapitan.

## 0. Przed demo (checklist — 5 min wcześniej)
- [ ] Stack up: `docker ps` → 7 kontenerów `hrobot-*` + `agent-service-demo` (healthy). Jeśli nie żyją: `cd HRobot-m2 && docker compose -p hrobot --profile full up -d` (używa `docker-compose.override.yml` — remapuje porty pod współdzielony box: keycloak→8081, tenant-runtime→3001, backing services bez host-portów).
- [ ] **KRYTYCZNE — realm Keycloak jest efemeryczny** (H2 w kontenerze; `compose down`/recreate keycloak go kasuje). Po świeżym `up` odtwórz realm `hrobot-staging` + userów demo: `cd HRobot-m2 && node scripts/seed-keycloak-demo.mjs`. Jeśli skrypt wypisze linie `UPDATE users SET keycloak_sub=…`, wykonaj je w bazie tenanta (`docker exec hrobot-postgres-1 psql -U postgres -d hrobot_t_900d948b -c "…"`) — inaczej „mój grafik" pracownika będzie pusty. Weryfikacja: login `pracownik.demo` → GET `:3001/api/grafik/shifts` zwraca 5 zmian.
- [ ] **Seed zamiany do J5** (PENDING_MANAGER w Skrzynce managera): `docker exec -i hrobot-postgres-1 psql -U postgres -d hrobot_t_900d948b < HRobot-m2/scripts/seed-demo-swap.sql`. Dynamiczny (wybiera aktualne zmiany) — URUCHOM PONOWNIE po każdym „Generuj grafik" (re-solve kasuje zależne wnioski o zamianę). Weryfikacja: manager.demo → Zamiany → 1 wniosek KIEROWCA↔KIEROWCA z „Zatwierdź".
- [ ] Front: `cd HRobot-m2/docs/design/web-kit && node start-live.mjs` → `http://localhost:5601`.
- [ ] Zakładki gotowe: **:5601/grafik**, **:5601/zamiany**, **:8010/agent/demo**.
- [ ] Tydzień demo: **13–19 lipca 2026** (feasible, 52 AUTO-zmiany). Na :5601/grafik kliknij „Następny tydzień" jeśli trzeba.
- [ ] **Logowanie (realny gate + RBAC):** `:5601` → przekierowanie na `/login`. Trzy konta:
  - **Admin/manager demo:** `demo` / `demo-staging-2026` (Admin klienta) — pełny grafik, generowanie, zatwierdzanie zamian.
  - **Pracownik:** `pracownik.demo` / `Pracownik!2026` (rola Pracownik = Anna Kowalska) — **własny grafik w trybie podglądu** (5 zmian, tydz. 13–19 lip), ograniczona nawigacja, brak akcji admina.
  - **Manager:** `manager.demo` / `Manager!2026` (Manager Region Centrum) — zatwierdza zamiany swojej jednostki.
  - Token httpOnly, wylogowanie w topbarze.
- [ ] Fallback pod ręką: prekomputowany snapshot (`agent-service/fixtures/canonical_solution.json`) + nagranie zapasowe (jeśli zrobione).
- [ ] Tenant w UI = **4Mobility sp. z o.o.** (rebrand).

## 1. Otwarcie (30 s)
„HRobot to platforma HR. Dziś Etap 2: **moduł Grafik** — automatyczne układanie grafików pod prawo pracy i optymalizację dojazdów/etatów — oraz **Agent AI**, który uczy się z Waszych decyzji. Wszystko na danych syntetycznych w kształcie 4Mobility, zero realnych danych osobowych."

## 2. J1 — zapotrzebowanie (2 min) · `:5601/grafik`
- Pokaż siatkę tygodnia, jednostki, realnych (syntetycznych) pracowników.
- „Menedżer definiuje zapotrzebowanie — kto, gdzie, kiedy, jaka rola."
- **Talking point:** szablony per typ lokalizacji generują domyślne zapotrzebowanie, menedżer koryguje.

## 3. J2 — generowanie grafiku (3 min) — RDZEŃ
- Kliknij **„Generuj grafik"**.
- „Solver (OR-Tools CP-SAT) układa wykonalny grafik: **twardo** pilnuje pokrycia, braku nakładania, urlopów i **11h odpoczynku dobowego** (Kodeks pracy art. 132), minimalizując dojazdy i odchyłkę od etatu."
- Pokaż wynik: 52 zmiany AUTO, badge AUTO, godziny.
- **Talking point (uczciwie):** „W M2 twardo egzekwujemy H1–H4; tygodniowy odpoczynek 35h i limity nadgodzin dochodzą w kolejnym etapie." (patrz known-limitations)

## 4. J3 — metryki + korekta ręczna (2 min)
- Pokaż pasek metryk (dojazdy, honored-% preferencji).
- Przesuń/dodaj zmianę ręcznie. „Menedżer ma ostatnie słowo — ręczne zmiany są respektowane, a ponowne generowanie ich nie kasuje."

## 5. J4 — Agent AI, który się uczy (4 min) — RÓŻNICA · `:8010/agent/demo`
- „To nie jest drugi solver. Solver ma stałe reguły. **Agent uczy się realnych preferencji Waszego zespołu** z każdej korekty menedżera."
- Kliknij **„Reset & replay"** — pokaż **spadek liczby korekt (edit-distance)** w kolejnych rundach: agent staje się coraz lepszy.
- Pokaż `rationale` (dlaczego taki przydział) i auto-naprawę niewykonalnej propozycji.
- **Talking point (uczciwie):** „To pilotowy inkrement — agent uczy się i samodoskonali na danych syntetycznych; pełna autonomia produkcyjna to kolejny etap." (NIE mów „RL/Stable-Baselines3" — mechanizm to uczący się scorer + retrening; patrz known-limitations)

## 6. J5 — zamiany zmian + KONTA PRACOWNIKÓW (3 min) · `:5601/zamiany`
- **Pokaż dwustronność (login) + „mój grafik":** wyloguj się → zaloguj jako **`pracownik.demo`** (Anna Kowalska) → wejdź w **Grafik**: pracownik widzi **tylko własne zmiany** w trybie podglądu (badge „TWÓJ GRAFIK — PODGLĄD", brak „Generuj grafik", brak edycji) — RBAC egzekwowany po stronie backendu (zapytanie scope'owane po `keycloak_sub`, nie ukryte tylko w UI). „Pracownicy mają własne, bezpieczne konta i widzą swój grafik, bez dostępu administracyjnego." Wyloguj → wróć jako `demo`/`manager.demo`.
- „Pracownik zgłasza zamianę, druga strona akceptuje wstępnie, menedżer zatwierdza — a **system sprawdza solverem, że zamiana nie łamie reguł** (np. nie wstawi kogoś na urlop, nie złamie odpoczynku), i pilnuje uprawnień (menedżer tylko swojej jednostki)."
- Jako manager: **Skrzynka managera** → oczekująca prośba (RECEPCJA↔RECEPCJA) → **Zatwierdź** → zmiana przepina się atomowo + audyt.
- **Talking point:** realny workflow na modelu grafiku, walidacja solverem, konta z rolami (RBAC), pracownik widzi swój grafik. **Uczciwie:** *inicjowanie* zamiany przez pracownika bezpośrednio z jego grafiku (wybór zmiany kolegi) dochodzi w M3 — dziś wniosek inicjuje manager/seed, a pracownik widzi własny grafik i swoje zamiany. Real-time powiadomienia — M3.

## 7. Zamknięcie (1 min)
- „Podsumowując: układamy zgodne z prawem grafiki, optymalizujemy dojazdy/etaty, a agent uczy się Waszej specyfiki. Dane syntetyczne, RODO od pierwszego dnia."
- Przejdź do protokołu odbioru + uwag (etapowość) — `protokol-odbioru-template.md`.

## Q&A — przygotowane odpowiedzi
- „Czy to RL?" → „Agent uczy się i samodoskonali; w M2 to pilotowy mechanizm uczący się na danych syntetycznych, produkcyjny RL na żywych danych to kolejny etap." (uczciwie, bez over-promisingu)
- „Odpoczynek tygodniowy / nadgodziny?" → „H1–H4 twardo teraz; H5/H6 udokumentowane, dochodzą w M3."
- „Bezpieczeństwo danych?" → „Dane syntetyczne, PESEL generowany; realne dane szyfrowane AES-256-GCM; staging na infrastrukturze prywatnej."
- „Real-time zamiany?" → „Workflow działa; powiadomienia na żywo w M3."

## Ryzyka demo + mitygacje
- Solver wolny/live-solve pada → pokaż zapisany wynik (tydzień już zaseedowany) / snapshot fallback.
- Maszyna/tunel pada → lokalny `docker start` + `node start-live.mjs`; ostateczność: nagranie.
- Nie klikaj „Generuj grafik" wielokrotnie pod rząd na oczach klienta (re-solve) — raz wystarczy.
