# Demo 10 minut — 4Mobility (M2: Grafik + Agent AI)

> **Cel:** doprowadzić do ODBIORU ETAPU. Nie spacer po funkcjach — najkrótsza droga do „tak".
> **Jeden przekaz:** „Układamy zgodne z prawem grafiki automatycznie, a agent uczy się Waszej
> specyfiki." Solver = reguły, agent = różnica. Dane syntetyczne, RODO od pierwszego dnia.
> Pełna (dłuższa) wersja: `demo-scenario-4mobility.md`. To jest zredukowana wersja na czas.

## Przed demem (5 min wcześniej) — jedna komenda
- `cd HRobot-m2 && node scripts/demo-up.mjs` → `cd docs/design/web-kit && node start-prod.mjs` (:5601).
- ⚠ Na demo używaj **`start-prod.mjs`** (produkcja: build + `next start`), NIE `start-live.mjs` (`next dev`):
  produkcja nie ma nakładki „N Issues" ani ~30 s przymulenia przy pierwszym wejściu na każdą stronę.
- Checklist (zweryfikowane 2026-07-12): **7/7** kontenerów `hrobot-*` + agent :8010 = 200; **3 konta**
  logują się; tydz. **13–19 lip = 52 zmiany AUTO** (Anna=5); wniosek J5 **PENDING_MANAGER** obecny.
- Zakładki gotowe: **:5601/grafik**, **:5601/zamiany**, **:8010/agent/demo**. Zaloguj z góry jako `demo`.
- Zegarek na stół. Przećwicz raz na czas.

## Choreografia logowań (minimalizuj przełączenia)
Rdzeń + granica + agent jako **`demo`** (admin). Potem JEDNO przejście na **`pracownik.demo`**,
JEDNO na **`manager.demo`**. Nie skacz w tę i z powrotem.

---

## Minuta po minucie (≤10:00)

**0:00–0:45 · Otwarcie**
„HRobot to platforma HR. Dziś Etap 2: **Grafik** — automatyczne układanie grafików pod prawo pracy
i optymalizację dojazdów/etatów — oraz **Agent AI**, który uczy się z Waszych decyzji. Wszystko na
danych syntetycznych w kształcie 4Mobility, zero realnych danych osobowych."
*(Ekran: :5601/grafik zalogowany jako `demo`, tydz. 13–19 lipca.)*

**0:45–3:30 · RDZEŃ — „Generuj grafik" (pierwszy wow)**
Choreografia (próba potwierdziła — patrz ⚠): klik **„Następny tydzień"** raz (→ tydz. 20–26 lip),
potem **„Generuj grafik"**. „Solver (OR-Tools CP-SAT) układa wykonalny tydzień: **twardo** pilnuje
pokrycia, braku nakładania, urlopów i **11h odpoczynku dobowego** (Kodeks pracy art. 132),
minimalizując dojazdy i odchyłkę od etatu." Siatka zapełnia się na oczach (~0,6 s). Potem
**„Poprzedni tydzień"** → wróć na **13–19 lip** (hero week — Anna, kontekst wniosku).
- **Kotwica danych:** tydz. 13–19 lip = **52 zmiany AUTO** (zweryfikowane, pre-seed). Badge AUTO, godziny, lokacje.
- **Uczciwie:** „Twardo H1–H4. Tygodniowy odpoczynek 35h i limity nadgodzin — kolejny etap."
- ⚠ **NIGDY nie klikaj „Generuj grafik" na tygodniu 13–19.** To hero week: globalny re-solve kasuje
  zmiany referowane przez wniosek J5 (fix F2) → skrzynka managera będzie pusta w bicie 8:00. Solvuj
  **na sąsiednim tygodniu** (20–26). Solver <1 s, więc to bezpieczny, szybki wow. Jeśli i tak solvniesz
  13–19 (lub klikniesz wielokrotnie) → `node scripts/demo-up.mjs` re-seeduje wniosek.

**3:30–5:00 · Uczciwa granica — INFEASIBLE (buduje zaufanie mocniej niż happy-path)**
Przejdź na **tydzień 14–20 września** → „Generuj grafik" → **INFEASIBLE + `unmet[]`**.
„System nie udaje. Ten tydzień jest niewykonalny — wszyscy koordynatorzy na urlopie — i mówi
**dokładnie**, których slotów nie da się obsadzić." (Kotwica: **3/3 koordynatorów na urlopie**,
solve → INFEASIBLE, zweryfikowane.)

**5:00–8:00 · RÓŻNICA — Agent AI, który się uczy (drugi wow)**  ·  `:8010/agent/demo`
„To nie drugi solver. Solver ma stałe reguły. **Agent uczy się realnych preferencji Waszego zespołu**
z każdej korekty menedżera." Klik **„Reset & replay"** → pokaż **spadek liczby korekt** w rundach +
`rationale` (dlaczego taki przydział) + auto-naprawę niewykonalnej propozycji.
- **Uczciwie:** „Pilotowy inkrement, uczy się na danych syntetycznych; pełna autonomia produkcyjna —
  kolejny etap." **NIE mów „RL/Stable-Baselines3".**

**8:00–9:15 · Dwustronność + RBAC + zamiana**
- Wyloguj → zaloguj **`pracownik.demo`** (Anna Kowalska): **Grafik → „mój grafik" read-only** (badge
  „TWÓJ GRAFIK — PODGLĄD", 5 zmian, brak akcji admina). „Pracownicy mają własne, bezpieczne konta,
  widzą tylko swój świat — RBAC egzekwowany po stronie backendu, nie ukryty w UI. PESEL nie wychodzi
  z serwera (RODO)."
- Wyloguj → zaloguj **`manager.demo`**: **Zamiany → Skrzynka managera** → oczekujący wniosek
  KIEROWCA↔KIEROWCA → **Zatwierdź** → „system sprawdza solverem, że zamiana nie łamie reguł, i pilnuje
  uprawnień (menedżer tylko swojej jednostki)". (Kotwica: **1 wniosek PENDING_MANAGER**, zweryfikowany.)

**9:15–10:00 · Zamknięcie**
„Podsumowując: układamy zgodne z prawem grafiki, optymalizujemy dojazdy/etaty, agent uczy się Waszej
specyfiki, pracownicy mają konta z rolami. Dane na cały **czerwiec–wrzesień** (~830 zmian) — to nie
zabawka na jeden tydzień." → przejście do **protokołu odbioru** + uwag (etapowość M2/M3).

---

## Uczciwość M2 vs M3 (mów proaktywnie — to sprzedaje odbiór)
- **Dostarczone (M2):** solver CP-SAT twardo H1–H4; „Generuj grafik" + INFEASIBLE z unmet; agent-pilot
  uczący się; konta Keycloak + RBAC (3 role); zamiany z zatwierdzaniem walidowanym solverem; pracownik
  widzi swój grafik; dane cze–wrz.
- **Świadomie M3:** tygodniowy odpoczynek 35h / nadgodziny; inicjowanie zamiany przez pracownika z jego
  grafiku (dziś inicjuje manager/seed); powiadomienia real-time; produkcyjny RL na żywych danych.

## Q&A — gotowe odpowiedzi
- „Czy to RL?" → „Agent uczy się i samodoskonali; w M2 pilotowy mechanizm na danych syntetycznych,
  produkcyjny RL to kolejny etap."
- „Odpoczynek tygodniowy / nadgodziny?" → „H1–H4 twardo teraz; H5/H6 udokumentowane, dochodzą w M3."
- „Bezpieczeństwo danych?" → „Dane syntetyczne; PESEL szyfrowany AES-256-GCM, nigdy nie zwracany przez
  API; audyt append-only; staging na prywatnej infrastrukturze."
- „Real-time zamiany?" → „Workflow działa; powiadomienia na żywo w M3."
- „Ile danych?" → „Cztery miesiące, ~830 zmian, urlopy skumulowane latem, jeden tydzień celowo
  niewykonalny — pokazujemy granice uczciwie."

## Ryzyka + fallback (demo ma jedno podejście)
- Solver wolny / live-solve pada → tydzień 13–19 jest **już zaseedowany** (nie musisz solvować na żywo);
  ostateczność: prekomputowany snapshot / nagranie.
- Stack/tunel pada → `node scripts/demo-up.mjs` + `node start-prod.mjs`.
- Nie klikaj „Generuj grafik" wielokrotnie na oczach klienta. Po solve → `node scripts/demo-up.mjs`
  re-seeduje wniosek J5.
- Logowanie: klikaj przycisk „Zaloguj/Wyloguj" normalnie (działa); przy problemie z kliknięciem odśwież
  stronę i spróbuj ponownie.

## Próba generalna — potwierdzone (2026-07-12)
Zmierzone latencje systemu (nie zależą od tempa prezentera):
- Logowanie (token): **~217 ms**. Solve wykonalny: **~0,6 s** (globalny) / **~0,36 s** (scoped).
  Solve INFEASIBLE (14 wrz): **~0,3 s**. → **System nigdy nie każe czekać >1 s**; budżet 10 min zależy
  wyłącznie od tempa mówienia/klikania, nie od zawieszeń solvera. Ryzyko „solver się zaciął" — realnie zerowe.
- Kotwice na żywo: 3 konta logują się; tydz. 13–19 = **52 zmiany / Anna 5**; 14 wrz → **INFEASIBLE**
  (3/3 koordynatorów na urlopie); wniosek J5 = **PENDING_MANAGER**; agent :8010 = 200; 7/7 kontenerów.
- **Znalezisko naprawione:** solvowanie hero week (13–19) na żywo psuło dane (52→88 zmian) i kasowało
  wniosek J5 → dlatego bit 0:45 solvuje na **sąsiednim** tygodniu 20–26 (patrz ⚠ wyżej). Po próbie
  przywrócono czysty stan (13–19 = 52, wniosek PENDING_MANAGER).
- **Werdykt czasu:** treść mieści się w ≤10:00 z zapasem na pytania. Największy pożeracz czasu to
  przełączanie kont (3× login ~3–5 s każde) i mówienie — dlatego choreografia minimalizuje logowania
  (rdzeń+granica+agent jako admin, potem 1× pracownik, 1× manager). Przećwicz raz z zegarkiem —
  jeśli wychodzisz ponad 10:00, tnij agenta (bit 5:00–8:00) do 2 min, nie rdzeń ani granicę.
