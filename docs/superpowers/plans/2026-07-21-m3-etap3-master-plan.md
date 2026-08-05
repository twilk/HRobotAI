# Kamień Milowy 3 (Etap 3) — Master Plan

> **Cel programu:** domknąć ostatni kamień grantu PARP (Poland Prize) — 3 moduły bazowe do odbioru przez 4Mobility, z pakietem dowodowym i zgodnością EU AI Act.
> **Beneficjent:** App Pro sp. z o.o. · **Odbiorca:** 4Mobility · **Odbiór M3:** 2026-08-20 · **Transza III:** 127 300 PLN (płatność 2026-09-09).
> **Źródła:** `docs/HRobotDocs/f-harmonogram-wdrozenia.md` §2, `e-analiza-ryzyk-technologicznych.md` (R10), `k-modul-dostepy.md` §5 (RCP→nadgodziny/ZUS), README HRobotDocs §3.
> **Status planu:** DO ZATWIERDZENIA. Po akceptacji: per moduł `brainstorm/spec → Codex crosscheck → plan TDD → subagent-driven build → live-verify → docs`, jak przy strategic-brain.

---

## 1. Wskaźnik odbioru = 3 moduły bazowe

| # | Moduł M3 | Zakres | Stan wyjściowy |
|---|---|---|---|
| 1 | **Analityk HR** | Analiza wydajności (4 wymiary) + trajektoria rozwoju + rekomendacja retencji/rekrutacji | 🟢 **≈ zbudowany** jako `strategic-brain` (branch `feat/demo-4mobility`, live-verified 3 konta) |
| 2 | **Moduł Dokumenty** | Generowanie dokumentów kadrowo-płacowych z RCP: **nadgodziny**, ewidencja czasu pracy, **deklaracje ZUS/Płatnik** | ⚪ nie zaczęty |
| 3 | **Agent Głosowy** | Polski interfejs głosowy (STT Whisper/OpenAI + intent) do obsługi wniosków/grafiku; **fallback formularz tekstowy** | ⚪ nie zaczęty (ryzyko R10) |

Każdy moduł: **dane syntetyczne**, kotwice demo nietknięte, human-gate na migrację/żywą bazę i push (stała zasada), demo-MVP altitude jak M2.

Odbiór potwierdzany **protokołem 4Mobility** + pakietem dowodowym KM3.

---

## 2. Moduł 1 — Analityk HR (DOMKNIĘCIE tego, co zbudowane)

**Co jest:** moduł `apps/tenant-runtime/src/strategic-brain/` (10 zadań TDD, 718+303 testy zielone, live-verified: RBAC 3 konta, wykluczenie L4, 6 profili trajektorii, immutable-event rekomendacje, granica zapisu art. 22). Spec: `docs/superpowers/specs/2026-07-14-ai-performance-trajectory-recruitment-SPEC.md`. UI `/analiza`.

**Do zrobienia (formalizacja jako oficjalny deliverable M3):**
- [ ] **Doc funkcjonalny** `docs/HRobotDocs/l-modul-analityk-hr.md` (wzór i–k): cel, przepływy, 4 wymiary + trajektoria, RBAC, kryteria akceptacji (AN-1..AN-n), sekcja RODO/EU AI Act (art. 22 — decyzja człowieka, wyjaśnialność, brak cech chronionych, wykluczenia L4/urlop).
- [ ] **Wizualny dowód** `/analiza` na 3 kontach (Chrome — panel przeglądarki nie sięga localhost; użyć realnego Chrome lub Claude-in-Chrome) → screenshoty do pakietu dowodowego.
- [ ] **Macierz pokrycia** AN-x → test/kod (wzór `macierz-pokrycia-m2.md`).
- **Effort:** niski (kod gotowy). Głównie dokumentacja + wizualny dowód.

---

## 3. Moduł 2 — Moduł Dokumenty

**Zakres funkcjonalny (do doprecyzowania w spec):** generowanie dokumentów kadrowo-płacowych z danych RCP (Moduł Dostępy M1) + kadrowych (Moduł Data M1):
- **Ewidencja czasu pracy** — raport okresowy per pracownik z zdarzeń RCP.
- **Nadgodziny** — wyliczenie nadgodzin (ponad normę) z RCP, z regułami (dobowe/średniotygodniowe, dodatki 50%/100%), do zatwierdzenia przez managera.
- **Deklaracje ZUS / format Płatnik** — eksport danych do formatu **KEDU/Płatnik** (np. RCA/RSA/DRA — do potwierdzenia zakresu z 4Mobility); na demo: generacja pliku w strukturze zgodnej z Płatnikiem na danych syntetycznych, **bez wysyłki** (human-gate).
- Możliwe dodatkowe: świadectwa pracy / zaświadczenia (jeśli 4Mobility potwierdzi zakres).

**Podejście techniczne (reużycie maszynerii HRobot):**
- Backend moduł `apps/tenant-runtime/src/dokumenty/` — controller `@TenantRoute`+`@Roles`, RBAC `hrobot_roles`, `unit-scope`, `AuditService` (ids-only), SAFE_SELECT (PESEL potrzebny do ZUS → szyfrowanie + kontrolowane odszyfrowanie z audytem).
- Silnik: czyste funkcje wyliczeń (nadgodziny, normy) — TDD; generacja dokumentów (PDF/XML KEDU) jako osobna warstwa.
- Dane RCP: model zdarzeń czasu pracy (jeśli nie istnieje z M1 — dobudować minimalny model RCP + seed syntetyczny).
- web-kit: ekran `/dokumenty` (proxy + lib + vitest + RBAC-gate), lista dokumentów + „Generuj" + podgląd/pobranie.

**Ryzyka:** poprawność formatu Płatnik/KEDU (schemat XML); reguły nadgodzin (prawo pracy PL). Mitygacja: zakres demo-MVP + potwierdzenie reguł z 4Mobility; PESEL w ZUS = odszyfrowanie kontrolowane + audyt.

**Fazy:** spec (funkcjonalny + prawny zakres nadgodzin/ZUS z 4Mobility) → Codex crosscheck → plan TDD → build (model RCP+seed → silnik wyliczeń → generator dokumentów → API+RBAC+audyt → web-kit) → live-verify.

---

## 4. Moduł 3 — Agent Głosowy

**Zakres funkcjonalny:** polski interfejs głosowy pozwalający pracownikowi/managerowi wykonać wybrane akcje głosem — np. „złóż wniosek urlopowy na piątek", „jaki mam grafik jutro", „zgłoś L4". Pipeline: **nagranie → STT (Whisper/OpenAI, PL) → rozpoznanie intencji + encji → wywołanie istniejącego API modułu (Wnioski/Grafik/Czas pracy) → potwierdzenie głosowe/tekstowe**. **Fallback:** przy niskiej pewności STT/intencji → formularz tekstowy (nigdy „ciche" wykonanie).

**Podejście techniczne:**
- STT: **Whisper** (lokalnie / faster-whisper) lub OpenAI Whisper API z dostrojeniem PL — **decyzja: lokalny vs API** (koszt/prywatność vs jakość; RODO — nagranie głosu = dane osobowe → preferencja lokalny/UE). Standalone `agent-service` (Python FastAPI) już istnieje jako baza.
- Intent/NLU: reguły + słowniki intencji PL (demo) — **bez LLM** dla zgodności z narracją „bez per-token", chyba że świadomie dopuścimy mały model; fallback tekstowy zawsze.
- Orkiestracja: nowy endpoint/serwis mostkujący STT→intent→istniejące API tenant-runtime (z tokenem użytkownika, RBAC bez zmian).
- web-kit: komponent mikrofonu na istniejących ekranach + tryb tekstowy.

**EU AI Act (kluczowe dla tego modułu):** system rozmawiający z człowiekiem → **obowiązek transparentności** („rozmawiasz z asystentem AI"); **nadzór człowieka** (potwierdzenie przed akcją nieodwracalną); logowanie; brak profilowania emocji/biometrii. Nagranie głosu = dane osobowe (RODO): minimalizacja, retencja, zgoda.

**Ryzyko R10 (najwyższe):** jakość rozpoznawania mowy PL. Mitygacja (z analizy ryzyk): Whisper z dostrojeniem PL, **fallback do formularza tekstowego** (twardo wbudowany od początku, nie na końcu), zakres komend ograniczony i zamknięty (nie open-ended).

**Fazy:** spec (pipeline + zakres komend + decyzja STT lokalny/API + EU AI Act) → **PoC STT-PL wcześnie** (de-ryzykowanie) → Codex crosscheck → plan → build (STT → intent → most do API → fallback → web-kit mikrofon) → live-verify.

---

## 5. Warstwa zgodności EU AI Act (przekrojowa)

- **Klasyfikacja ryzyka:** Analityk HR (ocena pracowników) i częściowo Dokumenty/Agent w kontekście HR → obszar wrażliwy. Udokumentować, że **żaden moduł nie podejmuje w pełni automatycznej decyzji kadrowej** (art. 22 RODO + EU AI Act human oversight).
- **Transparentność:** Agent Głosowy — jawna informacja o AI. Analityk HR — banner + wyjaśnialność (jest).
- **Nadzór człowieka:** wszystkie akcje nieodwracalne za bramką człowieka (jest wzorzec z M2/strategic-brain).
- **Logowanie/audyt:** append-only, ids-only (jest).
- **Deliverable:** doc `docs/HRobotDocs/m-zgodnosc-eu-ai-act.md` spinający to dla 3 modułów.

---

## 6. Pakiet dowodowy KM3 + raport + Drive

- **Raport KM3** (wzór KM2): `docs/raport-km3/` — Raport_KM3_HRobot.pdf/docx, opis realizacji 3 modułów, mapowanie na kod, kryteria akceptacji, sekcje RODO/EU AI Act.
- **Załącznik — Pakiet dowodowy M3** (wzór Zał.2 M2): screenshoty 3 modułów na 3 kontach, dowody testów (jest/vitest zielone), macierze pokrycia.
- **Deliverable na Drive** (folder „Etap 3" = `1kebVDySMp2pIlIDpfRwvm4W_DcfC2sPe`, pusty) — komplet 3 plików jak Etap 1/2:
  - `README.txt` (KM3, wzór),
  - `01-HRobot-Kod-zrodlowy.zip` (git archive backendu+data-layer, bez web-kit/sekretów),
  - `02-HRobot-Dokumentacja-i-Raport.zip` (raport KM3 + pakiet dowodowy + HRobotDocs).
- **Protokół odbioru** 4Mobility (wzór Prot 1).

---

## 7. Harmonogram do 2026-08-20 (bramki)

| Tydzień | Zakres | Gate |
|---|---|---|
| **T1 (21–27.07)** | Analityk HR — domknięcie (doc l + wizualny dowód + macierz). Spec Modułu Dokumenty. **PoC STT-PL** (Agent) — de-ryzykowanie R10. | G1: Analityk HR udokumentowany; PoC STT decyzja lokalny/API |
| **T2 (28.07–03.08)** | Moduł Dokumenty — build (RCP+silnik nadgodzin + generator + API+web-kit). Spec Agent Głosowy. | G2: Dokumenty demo-działający (nadgodziny + eksport ZUS na syntetyku) |
| **T3 (04–10.08)** | Agent Głosowy — build (STT→intent→most→fallback→mikrofon). EU AI Act doc. | G3: Agent Głosowy demo (≥3 komendy + fallback) |
| **T4 (11–17.08)** | Integracja, live-verify 3 modułów na 3 kontach, raport KM3 + pakiet dowodowy, deliverable Drive. | G4: 3 moduły zielone + pakiet gotowy |
| **Bufor (18–20.08)** | Poprawki po review, protokół 4Mobility, odbiór. | **Odbiór M3 20.08** |

Ścieżka krytyczna: **Agent Głosowy** (R10). Dlatego PoC STT-PL już w T1, a fallback tekstowy budowany od początku.

---

## 8. Ryzyka + mitygacje

| Ryzyko | Mitygacja |
|---|---|
| R10 — STT polski słaby | PoC w T1; Whisper dostrojony PL; fallback tekstowy twardo od startu; zamknięty zbiór komend |
| Format Płatnik/ZUS (KEDU XML) błędny | zakres demo-MVP; potwierdzić z 4Mobility; walidacja schematu; bez wysyłki (human-gate) |
| Reguły nadgodzin (prawo pracy PL) | potwierdzić z 4Mobility; parametryzacja w configu; testy jednostkowe wyliczeń |
| PESEL w ZUS (RODO) | odszyfrowanie kontrolowane + audyt; minimalizacja; dane syntetyczne na demo |
| EU AI Act | doc przekrojowy; human oversight (jest); transparentność Agenta |
| Czas (4,5 tyg, 2 nowe moduły) | Analityk HR gotowy = fora; demo-MVP altitude; subagent-driven velocity; PoC wcześnie |

---

## 9. Decyzje do potwierdzenia PRZED buildem (bramki człowieka)

1. **Moduł Dokumenty — zakres ZUS:** które deklaracje (RCA/RSA/DRA?) i czy eksport KEDU vs tylko raporty PDF na demo? Reguły nadgodzin (dodatki 50/100%, normy) — potwierdzić z 4Mobility.
2. **Agent Głosowy — STT lokalny (faster-whisper, UE/prywatność) vs OpenAI API (jakość, koszt/token)?** Preferencja RODO = lokalny. Zbiór komend (które akcje głosem).
3. **Zakres komend/akcji** Agenta (Wnioski? Grafik? Czas pracy? tylko odczyt vs też zapis za potwierdzeniem).
4. Migracje na żywą bazę + push = human-gate (jak dotąd).

---

## 10. Następny krok
Po akceptacji planu — start **T1**: (a) domknięcie Analityk HR (doc l + wizualny dowód), (b) spec Modułu Dokumenty, (c) PoC STT-PL. Każdy moduł przechodzi pełny cykl `spec → Codex → plan → build → live-verify` jak strategic-brain.
