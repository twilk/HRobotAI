# Demo 10 minut — 4Mobility (M2: Grafik + Agent AI)

> **Cel:** doprowadzić do ODBIORU ETAPU. Nie spacer po funkcjach — najkrótsza droga do „tak".
> **Jeden przekaz:** „Układamy zgodne z prawem grafiki automatycznie, a agent uczy się Waszej
> specyfiki." Solver = reguły, agent = różnica. Dane syntetyczne, RODO od pierwszego dnia.
> Pełna (dłuższa) wersja: `demo-scenario-4mobility.md`. To jest zredukowana wersja na czas.

## Przed demem (5 min wcześniej) — jedna komenda
- `cd HRobot-m2 && node scripts/demo-up.mjs` → `cd docs/design/web-kit && node start-live.mjs` (:5601).
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
Klik **„Generuj grafik"**. „Solver (OR-Tools CP-SAT) układa wykonalny tydzień: **twardo** pilnuje
pokrycia, braku nakładania, urlopów i **11h odpoczynku dobowego** (Kodeks pracy art. 132),
minimalizując dojazdy i odchyłkę od etatu."
- **Kotwica danych:** tydz. 13–19 lip → **52 zmiany AUTO** (zweryfikowane). Badge AUTO, godziny, lokacje.
- **Uczciwie:** „Twardo H1–H4. Tygodniowy odpoczynek 35h i limity nadgodzin — kolejny etap."
- ⚠ Klikaj „Generuj" **raz**. Po solve trzeba re-seedować wniosek (`demo-up` to robi).

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
- Stack/tunel pada → `node scripts/demo-up.mjs` + `node start-live.mjs`.
- Nie klikaj „Generuj grafik" wielokrotnie na oczach klienta. Po solve → `node scripts/demo-up.mjs`
  re-seeduje wniosek J5.
- Logowanie: klikaj przycisk „Zaloguj/Wyloguj" normalnie (działa); przy problemie z kliknięciem odśwież
  stronę i spróbuj ponownie.
