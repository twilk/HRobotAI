# Skrypt demo — 4Mobility / PARP, 2026-08-10

> Środowisko: `http://localhost:8080` (Caddy → apps/web, Docker compose project `hrobot`, worktree `HRobot-m2`, branch `feat/demo-4mobility`). Zweryfikowane na żywo tuż przed demo — wszystkie 4 konta, wszystkie ekrany, generowanie PDF, asystent głosowy.

## Konta (realm `hrobot-staging`, klient `hrobot-web`)

| Konto | Hasło | Rola | Zakres |
|---|---|---|---|
| `demo` | `demo-staging-2026` | ADMIN_KLIENTA | globalny |
| `manager.demo` | `Manager!2026` | MANAGER | Region Centrum |
| `pracownik.demo` | `Pracownik!2026` | PRACOWNIK (Anna Kowalska) | własne dane |
| `pracownica.demo` | `Pracownica!2026` | PRACOWNIK cross-unit (Katarzyna Zając, Region Północ) | własne dane |

## Przed demo (2 min)
- Stack już żyje (`docker compose -p hrobot --profile full up -d`, wszystkie 10 kontenerów `healthy`, `restart: unless-stopped` — auto-heal jeśli coś padnie w trakcie).
- Otwórz zakładkę `http://localhost:8080/login`.
- **NIE klikaj wielokrotnie „Generuj grafik"** — re-solve może skasować zaseedowaną zamianę demo.
- **Asystent głosowy: używaj TYLKO jednodniowych zakresów dat** (znany bug: wielodniowy zakres kolapsuje do jednego dnia — patrz Ryzyka niżej).

---

## 1. Otwarcie (30 s)
„HRobot to platforma HR dla 4Mobility. Dziś pokazujemy pełny zakres: **Grafik + Agent AI** (Etap 2) oraz trzy nowe moduły Etapu 3 — **Dokumenty kadrowe, Analityk HR i Asystent głosowy**. Wszystko na danych syntetycznych, zgodnie z RODO, na żywym systemie — nie na slajdach."

## 2. ADMIN (`demo`) — pełny obraz organizacji (5 min)
Zaloguj jako `demo`.

- **Dashboard** — 39 pracowników, 1558 zaplanowanych zmian, 5 zamian oczekujących, 3 jednostki, panel RODO (DB-per-tenant, PESEL AES-256-GCM, append-only audit).
- **Grafik** (`/grafik`) — bieżący tydzień ma 52 zmiany / 38 zapotrzebowań, siatka pracownik×dzień, filtr jednostek. *Talking point:* solver CP-SAT pilnuje twardo pokrycia, braku nakładania, urlopów i 11h odpoczynku dobowego (K.p. art. 132).
- **Analityk HR** (`/analityk`) — pokaż sekcję „Na co zwrócić uwagę": realny skok absencji (+4,1 p.p.) i rosnąca kolejka wniosków (+8), liczone na żywych danych z prowenencją („liczone" vs „planowane?"). To NOWY moduł Etapu 3.
- **Dokumenty** (`/dokumenty`) — wybierz pracownika (np. Anna Kowalska), okres 13–19.07.2026, kliknij **Generuj dokument**. Pokaż nowy wpis na liście, status „DO ZATWIERDZENIA". *Talking point:* „HRobot liczy ewidencję/nadgodziny/eksport ZUS, ale nigdy nie wysyła — każdy dokument z realnym skutkiem prawnym wymaga zatwierdzenia człowieka (RODO art. 22)."

## 3. Asystent głosowy — moduł Etapu 3 (3 min)
Zostań jako `demo` lub przełącz na `pracownik.demo` (bardziej naturalne dla samoobsługi — patrz sekcja 4).

- Wejdź na `/asystent`, wpisz/powiedz: **„Chcę wziąć urlop wypoczynkowy od 20 sierpnia do 20 sierpnia"** (jeden dzień — patrz ryzyka).
- Pokaż odpowiedź z intencją i % pewności, oraz że **nic się nie zapisuje bez kliknięcia „Potwierdź i wykonaj"**.
- *Talking point:* „Asystent rozumie polecenia w naturalnym polskim, ale zawsze czeka na potwierdzenie człowieka — nic nieodwracalnego nie dzieje się automatycznie."

## 4. PRACOWNIK (`pracownik.demo`) — samoobsługa + nowa mobilna trasa (3 min)
Wyloguj się, zaloguj jako `pracownik.demo`.

- **Dashboard** — Anna widzi tylko swój grafik (5 nadchodzących zmian), godziny vs etat (40/40h), swoje urlopy.
- **`/moj-tydzien`** (NOWOŚĆ, świeżo naprawiona dziś rano) — jedna mobilna trasa: „kiedy pracuję" + „złóż wniosek o urlop", duże przyciski dotykowe (44px), myślana dla pracownika w terenie, nie przy biurku. *Talking point:* „Reszta systemu jest desktopowa — bo HR i managerowie pracują przy biurku. Ale pracownik fizyczny stoi przy samochodzie, nie przy komputerze — to jest jego jedyny ekran."

## 5. MANAGER (`manager.demo`) — zamiany + koszty (3 min)
Wyloguj się, zaloguj jako `manager.demo`.

- **Dashboard** — „Skrzynka decyzji": 7 wniosków, 5 zamian, 1 propozycja AI, koszt jednostki tygodnia (7656 zł, „W BUDŻECIE"), prognoza obsady na 14 dni. *Talking point:* to widok decyzyjny, nie raportowy — manager widzi tylko to, co wymaga jego działania, w zakresie swojego regionu (RBAC egzekwowany po stronie backendu, nie tylko UI).
- **Zamiany** (`/zamiany`) → Skrzynka managera → zatwierdź jedną z oczekujących próśb. *Talking point:* „System sprawdza solverem, że zamiana nie łamie reguł (urlop, odpoczynek), zanim pozwoli ją zatwierdzić."

## 6. Zamknięcie (1 min)
„Podsumowując: układamy zgodne z prawem grafiki, agent uczy się specyfiki zespołu, dokumenty kadrowe generują się z prawdziwych danych RCP, Analityk HR podpowiada, na co zwrócić uwagę, a asystent głosowy i mobilna trasa pracownika pokazują, że myślimy o użytkowniku w terenie, nie tylko przy biurku. Wszystko na danych syntetycznych, RODO od pierwszego dnia."

---

## Ryzyka demo + mitygacje (przeczytaj przed startem)

1. **Asystent głosowy: wielodniowy zakres dat kolapsuje do jednego dnia** (np. „od 20 do 21 sierpnia" → potwierdza tylko 20 sierpnia, przy 90% pewności — wygląda przekonująco, ale jest błędne). **Mitygacja: demo tylko jednodniowy urlop, albo nie demo tego zapytania na żywo, tylko opowiedz o mechanizmie.**
2. **Asystent nie odpowiada na pytania otwarte** („ile osób pracuje jutro" → „Nie zrozumiałem"). To zamierzone (wąski parser intencji, nie ogólny czat). **Mitygacja: używaj wyłącznie frazy typu „chcę wziąć urlop od X do Y".**
3. Nie klikaj „Generuj grafik" wielokrotnie pod rząd — re-solve może skasować zaseedowaną zamianę demo (J5).
4. Jeśli coś padnie w trakcie: stack ma teraz `restart: unless-stopped` na wszystkich 10 kontenerach — samo wraca w kilka sekund. Sprawdź `docker ps` jeśli strona nie odpowiada dłużej niż 10s.
5. Otwarta konsola przeglądarki pokaże nieszkodliwe błędy 404 (`/api/employees/me` dla kont bez rekordu Employee, `/api/koszty/week` 403 dla jednostek spoza zakresu managera) — to znane, nieblokujące zachowanie RBAC, nie pokazuj devtools na żywo.

## Q&A — przygotowane odpowiedzi (skrót, pełne w `data/m2-evidence/demo-scenario-4mobility.md`)
- „Czy agent to RL?" → Nie, to uczący się scorer preferencji (affinity-learner) + wsadowy re-fit, nie produkcyjny Stable-Baselines3. Uczciwie udokumentowane.
- „Odpoczynek tygodniowy / nadgodziny?" → H1–H4 twardo teraz w solverze; H5 (35h tygodniowo) i H6 (limity nadgodzin) to M3/kolejny etap.
- „Bezpieczeństwo danych?" → Dane syntetyczne; PESEL AES-256-GCM; DB-per-tenant; append-only audit.
- „Dokumenty ZUS idą automatycznie do ZUS?" → Nie, nigdy. HRobot generuje szkielet, człowiek zawsze zatwierdza i wysyła (RODO art. 22).
