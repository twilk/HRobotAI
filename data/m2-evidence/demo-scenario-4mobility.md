# Scenariusz demo — spotkanie z 4Mobility (M2: Grafik + Agent AI)

> Cel: 15–20 min, pokazać 2 moduły M2 na żywo, na danych syntetycznych (RODO), z podkreśleniem różnicy: **agent, który się uczy**. Prowadzi kapitan.

## 0. Przed demo (checklist — 5 min wcześniej)
- [ ] Stack up: `docker ps` → 7 kontenerów `hrobot-*` + `agent-service-demo` (healthy). Jeśli nie: `docker start hrobot-postgres-1 hrobot-redis-1 hrobot-keycloak-1 hrobot-rabbitmq-1` → poczekaj 25s → `docker start hrobot-control-plane-1 hrobot-optimizer-1 hrobot-tenant-runtime-1`.
- [ ] Front: `cd HRobot-m2/docs/design/web-kit && node start-live.mjs` → `http://localhost:5601`.
- [ ] Zakładki gotowe: **:5601/grafik**, **:5601/zamiany**, **:8010/agent/demo**.
- [ ] Tydzień demo: **13–19 lipca 2026** (feasible, 52 AUTO-zmiany). Na :5601/grafik kliknij „Następny tydzień" jeśli trzeba.
- [ ] Konto: `demo` / `demo-staging-2026` (rola Admin klienta). Web-kit renderuje bez logowania (proxy self-auth) — wejście od razu.
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

## 6. J5 — zamiany zmian (2 min) · `:5601/zamiany`
- „Pracownik zgłasza zamianę, druga strona akceptuje wstępnie, menedżer zatwierdza — a **system sprawdza solverem, że zamiana nie łamie reguł** (np. nie wstawi kogoś na urlop, nie złamie odpoczynku), i pilnuje uprawnień (menedżer tylko swojej jednostki)."
- Pokaż oczekującą prośbę → **Zatwierdź** → zmiana się przepina + audyt.
- **Talking point:** to realny workflow na tym samym modelu grafiku; wersja real-time (powiadomienia na żywo) w kolejnym etapie.

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
