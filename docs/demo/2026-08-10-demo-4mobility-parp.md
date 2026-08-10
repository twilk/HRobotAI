# Skrypt demo — 4Mobility / PARP, 2026-08-10

> Środowisko: `http://localhost:8080` (Caddy → apps/web, Docker compose project `hrobot`, worktree `HRobot-m2`, branch `feat/demo-4mobility`). Zweryfikowane na żywo tuż przed demo — wszystkie 4 konta, wszystkie ekrany, generowanie PDF, asystent głosowy, pełny łańcuch propozycji AI.

## Konta (realm `hrobot-staging`, klient `hrobot-web`)

| Konto | Hasło | Rola | Zakres |
|---|---|---|---|
| `demo` | `demo-staging-2026` | ADMIN_KLIENTA | globalny |
| `manager.demo` | `Manager!2026` | MANAGER | Region Centrum |
| `pracownik.demo` | `Pracownik!2026` | PRACOWNIK (Anna Kowalska) | własne dane |
| `pracownica.demo` | `Pracownica!2026` | PRACOWNIK cross-unit (Katarzyna Zając, Region Północ) | własne dane |

## Przed demo (2 min)

- Stack żyje (`docker compose -p hrobot --profile full up -d`, 10 kontenerów `healthy`, `restart: unless-stopped` — auto-heal, gdyby coś padło w trakcie).
- Otwórz zakładkę `http://localhost:8080/login`.
- **Sprawdź stan danych do sekcji 3** (jedna komenda):
  ```
  docker exec -i hrobot-postgres-1 psql -U postgres -d hrobot_t_900d948b -c "SELECT state, count(*) FROM ai_proposal GROUP BY state;"
  ```
  Potrzebujesz **co najmniej 1 × `PENDING_EMPLOYEE_CONSENT`** (do zaakceptowania przez pracownicę).
  Stan na 10.08: 1 × `PENDING_EMPLOYEE_CONSENT` + 1 × `PENDING_MANAGER` (rezerwa). Jak odtworzyć — patrz koniec dokumentu.
- **NIE klikaj wielokrotnie „Generuj grafik"** — re-solve może skasować zaseedowaną zamianę demo.
- **Asystent obsługuje już zakresy wielodniowe** (naprawione 10.08) — możesz spokojnie powiedzieć „od 20 sierpnia do 21 sierpnia".
- **⚠ ROZGRZEJ MODEL MOWY, jeśli planujesz demo głosem.** Model ładuje się dopiero przy pierwszym użyciu: pierwsza transkrypcja trwa **13 s**, każda kolejna **7–8 s** (zmierzone 10.08). Jedna komenda oszczędza 5 sekund ciszy przed odbiorcą:
  ```
  curl -s http://localhost:8011/health
  ```
  Jeśli zwróci `"loaded": false`, wykonaj jedno próbne nagranie w `/asystent` **przed** wejściem odbiorcy. Po rozgrzaniu `"loaded": true`.

---

## 1. Otwarcie (30 s)

„HRobot to platforma HR dla 4Mobility. Dziś pokazujemy pełny zakres: **Grafik + Agent AI** (Etap 2) oraz trzy moduły Etapu 3 — **Dokumenty kadrowe, Analityk HR i Asystent głosowy**. Wszystko na danych syntetycznych, zgodnie z RODO, na żywym systemie — nie na slajdach."

## 2. ADMIN (`demo`) — pełny obraz organizacji (4 min)

Zaloguj jako `demo`.

- **Dashboard** — 39 pracowników, 1558 zaplanowanych zmian, 3 jednostki, panel RODO (DB-per-tenant, PESEL AES-256-GCM, append-only audit).
- **Grafik** (`/grafik`) — bieżący tydzień: 52 zmiany / 38 zapotrzebowań, siatka pracownik × dzień, filtr jednostek. *Talking point:* solver CP-SAT pilnuje twardo pokrycia, braku nakładania, urlopów i 11 h odpoczynku dobowego (K.p. art. 132).
- **Analityk HR** (`/analityk`) — sekcja „Na co zwrócić uwagę": skok absencji (+4,1 p.p.) i rosnąca kolejka wniosków, liczone na żywych danych, z proweniencją przy każdej liczbie („liczone" vs „planowane?"). Zjedź niżej — wykres nadwyżek pokazuje **imiona i nazwiska**, więc widać z kim rozmawiać.
- **Dokumenty** (`/dokumenty`) — Ewidencja czasu pracy, Anna Kowalska, 13–19.07.2026 → **Generuj dokument** → nowy wpis „DO ZATWIERDZENIA". *Talking point:* „HRobot liczy ewidencję, nadgodziny i szkielet ZUS, ale niczego nie wysyła — każdy dokument o skutku prawnym zatwierdza człowiek (RODO art. 22)."

---

## 3. ⭐ PEŁNY ŁAŃCUCH AI — sedno demo (6 min)

To najmocniejsza część. Pokazuje AI, która **wykrywa problem, uzasadnia propozycję, pyta człowieka o zgodę i czeka na decyzję managera** — trzy strony, każda widzi tylko swoje.

Zaloguj jako **`manager.demo`**.

### 3a. AI zauważa problem, którego nikt nie zgłosił

`/ai-grafik-manager` → sekcja **Wykrywanie wypadnięć** → zakres `2026-08-17` – `2026-08-23` → **Skanuj**.

Zwraca **dokładnie jeden** wynik (zweryfikowane 10.08) — i to ten sam, którego dotyczy propozycja w kroku 3b, więc opowieść się nie rozjeżdża:

```
czw 20.08 · 14:00–22:00 · KOORDYNATOR  —  Anna Kowalska
```

Zmiana, której przypisany pracownik ma **zatwierdzony urlop**: dziura w obsadzie, o której nikt nie napisał maila.

> *„To nie jest raport, który ktoś zamówił. System sam zestawił zatwierdzone urlopy z grafikiem i pokazał, gdzie za chwilę nie będzie komu pracować."*

### 3b. AI proponuje i pokazuje swoje rozumowanie

Ta sama strona, wyżej: **Skrzynka managera — propozycje do zatwierdzenia**. Wskaż wiersz i przeczytaj go na głos — trzy warstwy uzasadnienia w jednej linii:

```
czw 20.08 · 14:00–22:00 · KOORDYNATOR      ← wakat po Annie Kowalskiej
Katarzyna Zając,  ranga 1                   ← były inne opcje, ta jest najlepsza
CROSS-UNIT · ~7 KM · ~7 MIN · +16,09 ZŁ     ← rozumowanie przestrzenne
praca 0,00 zł + dojazd 16,09 zł = razem +16,09 zł   ← rozumowanie ekonomiczne
```

> *„AI nie mówi »zrób tak«. Mówi »proponuję Katarzynę, bo jest najlepiej dopasowana, będzie miała 7 km dojazdu i będzie Was to kosztować 16 złotych więcej«. Różnica między tymi dwoma zdaniami jest widoczna w audycie."*

Pokaż też **poziom autonomii** (góra strony): 4 stopnie od „tylko sugestie" po „automatycznie po zatwierdzeniu".

> *„To Wy decydujecie, ile autonomii dostaje AI. Nie my."*

### 3c. Pracownik świadomie się zgadza

Wyloguj → zaloguj jako **`pracownica.demo`** (Katarzyna Zając) → `/zamiany`.

Na górze: **„Propozycje AI — zastępstwo wymaga Twojej zgody"** z pełnym kontekstem:

```
czw 20.08 · 14:00–22:00 · KOORDYNATOR
Zastępstwo za zatwierdzony urlop
Lotnisko Chopina — Warszawa
Twój szacunkowy dojazd (demo): ~7 km · ~7 min
[Akceptuj]  [Odrzuć]
```

> *„Pracownik nie dostaje polecenia. Dostaje pytanie — z datą, godzinami, miejscem i szacunkiem własnego dojazdu, żeby mógł świadomie odpowiedzieć. I może odmówić."*

Kliknij **Akceptuj**.

*RODO:* z serwera wychodzą wyłącznie zaokrąglone kilometry i minuty — nigdy współrzędne ani adres domowy.

### 3d. Manager podejmuje decyzję, solver weryfikuje prawo

Wyloguj → zaloguj jako **`manager.demo`** → `/ai-grafik-manager` → propozycja jest teraz **„CZEKA NA MANAGERA"** → **Zatwierdź**.

> *„Dopiero w tym momencie optymalizator sprawdza twarde reguły H1–H4. AI proponuje, człowiek decyduje, a prawo weryfikuje solver. Zmiana przepina się atomowo i zostaje wpis w niezmiennym dzienniku audytu."*

**Puenta całej sekcji:**
> *„Zobaczyliście trzy różne role i ani razu AI nie podjęła decyzji kadrowej za człowieka. To jest architektura zgodna z EU AI Act — nie polityka wewnętrzna, tylko granica wymuszona w kodzie."*

---

## 4. Asystent głosowy (3 min)

Zostań jako `pracownica.demo` albo przełącz na `pracownik.demo` → `/asystent`.

- Wpisz: **„Chcę wziąć urlop wypoczynkowy 20 sierpnia"** (jeden dzień — patrz Ryzyka).
- Pokaż intencję + **PEWNOŚĆ 90%** + to, że **nic się nie zapisze bez kliknięcia „Potwierdź i wykonaj"**.
- **Celowo** zapytaj: **„Ile osób pracuje jutro na lotnisku?"** → *„Nie zrozumiałem — użyj formularza"*.

> *„To jest pointa, nie usterka. Gdybyśmy podpięli tu duży model językowy, wymyśliłby odpowiedź. My wolimy, żeby system powiedział »nie wiem« — bo to jest ścieżka o skutkach prawnych."*

Wspomnij: transkrypcja mowy liczy się **lokalnie** (faster-whisper) — nagranie głosu to dana osobowa i nie opuszcza infrastruktury w UE.

### Jeśli demonstrujesz GŁOSEM (tor przetestowany nagraniem 10.08)

Tor został sprawdzony realnym nagraniem w formacie, który wysyła przeglądarka (webm/opus): transkrypcja polska jest bardzo dobra, a obie frazy demo rozpoznają się poprawnie.

| Fraza | Transkrypcja | Pewność | Wynik parsera |
|---|---|---|---|
| „Chcę wziąć urlop wypoczynkowy 20 sierpnia" | *Chcę wziąć urlop wypoczynkowy 20 sierpnia.* | 0,87 | `URLOP` · 2026-08-20 · wymaga potwierdzenia |
| „Ile osób pracuje jutro na lotnisku" | *Ile osób pracuje jutro na lotnisku?* | 0,79 | `NIEZNANE` → odesłanie do formularza |

**Zagospodaruj 7–8 sekund ciszy.** Tyle trwa transkrypcja po rozgrzaniu modelu i w milczeniu wygląda to jak zawieszenie. Zamień to w argument — powiedz w trakcie liczenia:

> *„W tej chwili nagranie jest przetwarzane na naszym serwerze, nie w chmurze dostawcy. Te kilka sekund to dokładnie cena za to, że głos pracownika nie opuszcza Waszej infrastruktury."*

To jedyny moment w całym demo, w którym opóźnienie jest zaletą — nie przepraszaj za nie.

## 5. PRACOWNIK — mobilna trasa (2 min)

Zaloguj jako **`pracownik.demo`** (Anna Kowalska).

- **Dashboard** — tylko swój grafik (5 nadchodzących zmian), godziny vs etat (40/40 h), swoje urlopy.
- **`/moj-tydzien`** — jedna mobilna trasa: „kiedy pracuję" + „złóż wniosek o urlop", przyciski min. 44 px.

> *„Reszta systemu jest desktopowa, bo HR i managerowie pracują przy biurku. Ale pracownik fizyczny stoi przy samochodzie — to jest jego jedyny ekran."*

## 6. MANAGER — koszt i budżet (2 min)

Zaloguj jako **`manager.demo`**.

- **Dashboard** — „Skrzynka decyzji": wnioski, zamiany, propozycje AI, koszt jednostki tygodnia (7656 zł, „W BUDŻECIE"), prognoza obsady na 14 dni.
- `/ai-grafik-manager` → **Koszty grafiku**: koszt liczony z realnych godzin × stawka na stanowisku, tabela stawek.

> *„To widok decyzyjny, nie raportowy — manager widzi wyłącznie to, co wymaga jego działania, i wyłącznie w swoim regionie. Uprawnienia są egzekwowane po stronie serwera, nie przez ukrycie przycisku."*

## 7. Zamknięcie (1 min)

„Podsumowując: układamy grafik zgodny z prawem, agent uczy się specyfiki zespołu, dokumenty liczą się z prawdziwych danych RCP, Analityk HR podpowiada na co zwrócić uwagę, a asystent i mobilna trasa biorą pod uwagę kogoś, kto pracuje przy samochodzie, nie przy biurku. Wszystko na danych syntetycznych, RODO od pierwszego dnia."

---

## Ryzyka demo + mitygacje (przeczytaj przed startem)

1. ~~**Asystent: wielodniowy zakres dat kolapsuje do jednego dnia.**~~ **NAPRAWIONE 10.08.** Forma z powtórzonym miesiącem („od 20 sierpnia do 21 sierpnia") nie pasowała do wzorca zakresu, więc parser brał tylko pierwszą datę. Działają teraz wszystkie warianty — powtórzony miesiąc, miesiąc tylko przy pierwszej dacie („od 20 sierpnia do 25"), przełom miesiąca („od 30 sierpnia do 2 września") i przełom roku („od 30 grudnia do 2 stycznia"). Zweryfikowane na żywym systemie.
2. **Asystent nie odpowiada na pytania otwarte** — to zamierzone (wąski parser intencji, nie ogólny czat) i w sekcji 4 jest użyte jako atut. Nie improwizuj innych pytań.
3. **Nie klikaj „Generuj grafik" wielokrotnie** — re-solve może skasować zaseedowaną zamianę demo (J5).
4. **Sekcja 3 zużywa dane.** Po próbie generalnej odtwórz je (instrukcja niżej), inaczej ekran zgody będzie pusty.
5. **Rezerwa na sekcję 3d:** jeśli akceptacja w 3c z jakiegoś powodu nie zadziała, w skrzynce czeka **druga propozycja już w stanie „CZEKA NA MANAGERA"** — zatwierdź ją i mów dalej jak gdyby nigdy nic.
6. **Wiersze „ESKALOWANA"** w skrzynce mają w kolumnie decyzji „—" (brak kandydata możliwego do obsadzenia). Nie zatrzymuj się na nich; jeśli ktoś zapyta: *„system nie znalazł nikogo, kto spełnia twarde reguły — świadomie nie proponuje wtedy nikogo na siłę"*.
7. Jeśli coś padnie: wszystkie 10 kontenerów ma `restart: unless-stopped`, wracają w kilka sekund. Sprawdź `docker ps`, jeśli strona nie odpowiada dłużej niż 10 s.
8. **Nie otwieraj devtools** — konsola pokaże nieszkodliwe 404 (`/api/employees/me` dla kont bez rekordu Employee) i 403 (`/api/koszty/week` dla jednostek spoza zakresu managera). To poprawne zachowanie RBAC, ale wygląda źle bez kontekstu.

## Jak odtworzyć dane do sekcji 3 (po próbie generalnej)

**Najpierw ustal, jak daleko zaszła próba** — od tego zależy, czy wystarczy klikanie, czy potrzebna jest też jedna komenda SQL.

### Przypadek A — próba skończyła się na 3c (zgoda udzielona, BEZ zatwierdzenia)

Wystarczy odtworzyć propozycję. Jako `manager.demo`:

1. `/ai-grafik-manager` → **Wykrywanie wypadnięć** → zakres `2026-08-17` – `2026-08-23` → **Skanuj**
2. przy jedynym wierszu (czw 20.08, Anna Kowalska) → **Utwórz propozycję zastępstwa**
3. dla TEJ zmiany jedynym wykonalnym kandydatem jest Katarzyna Zając, która ma konto — więc przy autonomii „Automatycznie za zgodą pracownika" propozycja idzie do niej jako `PENDING_EMPLOYEE_CONSENT` i sekcja 3c znów ma na czym działać

### Przypadek B — próba przeszła CAŁY łańcuch łącznie z 3d (zatwierdzenie)

⚠️ **Samo powtórzenie kroków z przypadku A NIE zadziała** i to jest najłatwiejsza pułapka w całym przygotowaniu. Zatwierdzenie w 3d **przepina zmianę na Katarzynę** — to dowód, że łańcuch działa, ale od tej chwili Anna nie jest już przypisana do tej zmiany, więc **skan zwraca 0 wypadnięć** (nie ma czego wykrywać). Sprawdzone na żywo 10.08 po biegu dowodowego.

Najpierw przywróć przypisanie zmiany do Anny (jedna komenda, trafia w dokładnie jeden wiersz — selektor po dacie, godzinie i roli, więc nie trzeba przepisywać żadnego UUID):

```
docker exec -i hrobot-postgres-1 psql -U postgres -d hrobot_t_900d948b -c "UPDATE shifts SET employee_id = (SELECT id FROM employees WHERE first_name='Anna' AND last_name='Kowalska'), updated_at = now() WHERE date::date='2026-08-20' AND start='14:00' AND role='KOORDYNATOR';"
```

Sprawdź, czy przywrócenie się udało — oczekiwany wynik to `Anna Kowalska | 1` (jedynka oznacza, że ma na ten dzień zatwierdzony urlop, czyli skan ma co znaleźć):

```
docker exec -i hrobot-postgres-1 psql -U postgres -d hrobot_t_900d948b -c "SELECT e.first_name||' '||e.last_name AS przypisany, (SELECT count(*) FROM leave_requests l WHERE l.employee_id=s.employee_id AND l.status='APPROVED' AND s.date BETWEEN l.start_date AND l.end_date) AS ma_urlop FROM shifts s JOIN employees e ON e.id=s.employee_id WHERE s.date::date='2026-08-20' AND s.start='14:00' AND s.role='KOORDYNATOR';"
```

Dopiero teraz wykonaj kroki 1–3 z przypadku A.

> Wpisów w dzienniku audytu **nie usuwamy** — jest append-only z założenia i poprawnie rejestruje, co wydarzyło się podczas próby. Przywrócenie danych demonstracyjnych to osobna czynność administracyjna, nie kasowanie historii.

### Uwagi wspólne

> ⚠️ **Użyj właśnie tego zakresu dat.** Dla innych wypadnięć (np. w lipcu) jedynym kandydatem bywa ktoś **bez konta w systemie** — wtedy propozycja od razu ląduje jako `ESKALOWANA`, bo nie ma kogo zapytać o zgodę, i sekcja 3c nie będzie miała czego pokazać.

**Weryfikacja końcowa** — komenda `psql` z sekcji „Przed demo" powinna pokazać co najmniej jeden `PENDING_EMPLOYEE_CONSENT`. Dla pewności zaloguj się jako `pracownica.demo` i sprawdź, czy na `/zamiany` widać wiersz `czw 20.08 · 14:00–22:00 · KOORDYNATOR` z przyciskami Akceptuj/Odrzuć.

### Runbook przetestowany, nie tylko spisany

Powyższa procedura (przypadek B) została **przejechana w całości 10.08 po próbie generalnej**, która świadomie zużyła dane przechodząc przez krok 3d. Zmierzony przebieg:

| Moment | `PENDING_EMPLOYEE_CONSENT` | Zmiana 20.08 przypisana do |
|---|---|---|
| przed próbą | 1 | Anna Kowalska |
| po próbie (3d wykonane) | **0** | Katarzyna Zając |
| po komendzie SQL | 0 | Anna Kowalska |
| po skanie i utworzeniu propozycji | **1** | Anna Kowalska |

Rezerwowa propozycja `PENDING_MANAGER` przetrwała cały cykl nietknięta.

## Co jeszcze warto wiedzieć po próbie generalnej

- **Automatyczny przejazd trwa ~45 s**, ale to sprawdzian FUNKCJONALNY, nie próba tempa prowadzącego. Na żywo licz ~20 min według czasów przy sekcjach i przećwicz przełączanie kont — to ono zabiera najwięcej czasu, a nie same ekrany.
- **Każda próba dokłada wersję dokumentu.** Po kilku przejazdach lista w module Dokumenty ma kilka wpisów „Ewidencja czasu pracy · Anna Kowalska · 13–19.07". To NIE jest usterka, tylko wersjonowanie append-only: zawsze dokładnie jedna pozycja ma status bieżący, poprzednie dostają **ZASTĄPIONY**. Jeśli ktoś zapyta — to jest dobra odpowiedź: *„regenerowanie nie nadpisuje poprzedniej wersji, tylko ją oznacza jako zastąpioną; pełna historia zostaje"*.
- **Liczba `APPROVED` rośnie z każdą próbą** (przed demo: 4). Nie ma to wpływu na przebieg — zatwierdzone propozycje nie pojawiają się w skrzynce decyzyjnej.

## Q&A — przygotowane odpowiedzi

- **„Czy agent to RL?"** → Nie. Uczący się scorer preferencji (affinity-learner) + wsadowy re-fit z wersjonowaną polityką. `stable_baselines3` nie jest importowany w żadnym module — sprawdzone w kodzie. **Nie używaj słowa „RL".**
- **„Skąd wiadomo, że efekt uczenia nie jest ustawiony?"** → Domyślny scenariusz generował wzorzec tą samą funkcją, której używa agent, więc zbiegał z konstrukcji. Sami to wykryliśmy i dobudowaliśmy scenariusz niezależny: **96 → 0 w 17 rundach, niemonotonicznie**, przy płaskiej próbie kontrolnej bez feedbacku, powtórzone dla 6 profili managera.
- **„Odpoczynek tygodniowy / nadgodziny?"** → H1–H4 twardo teraz w solverze; H5 (35 h tygodniowo) i H6 (limity nadgodzin) to kolejny etap. Udokumentowane, nie przemilczane.
- **„Bezpieczeństwo danych?"** → Dane syntetyczne; PESEL AES-256-GCM + blind index; DB-per-tenant; append-only audit z wyzwalaczem blokującym UPDATE/DELETE.
- **„Dokumenty ZUS idą automatycznie do ZUS?"** → Nigdy. HRobot generuje szkielet, człowiek zatwierdza i wysyła (RODO art. 22).
- **„Czy AI może zdecydować za managera?"** → Nie ma takiej ścieżki w kodzie. Nawet najwyższy poziom autonomii wymaga zatwierdzenia; moduł Analityk HR ma twardą granicę zapisu (analizuje i rekomenduje, nigdy nie wykonuje).
