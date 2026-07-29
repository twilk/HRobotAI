# PoC feasibility — Agent Głosowy (STT PL) — de-ryzykowanie R10

- **Status dokumentu:** PoC / feasibility (nie budujemy jeszcze modułu)
- **Data:** 2026-07-21 (kamień M3 / Etap 3, tydzień T1)
- **Autor:** ML/Voice engineer (Claude Opus 4.8)
- **Cel:** de-ryzykowanie ryzyka **R10 — „Rozpoznawanie mowy w języku polskim"** (P×W = 3×2 = 6, strategia: mitygacja, termin M3) przed budową modułu w T2/T3.
- **Decyzja do podjęcia:** **lokalny faster-whisper (RODO/UE, prywatność — nagranie głosu = dane osobowe) vs OpenAI Whisper API (jakość, ale koszt per-użycie + dane opuszczają UE).**
- **Zakres:** raport analityczny + rekomendacja + projekt pipeline'u + zakres PoC na T2/T3. **NIE** budujemy pełnego modułu, **NIE** instalujemy modeli wielogigabajtowych, **NIE** modyfikujemy `agent-service`.

---

## 1. Znaleziony `agent-service` — stack i rola

Istniejący serwis Pythonowy znaleziono w monorepo:

- **Ścieżka:** `agent-service/` (w worktree `HRobot-m2`); obraz Docker `agent-service:*`.
- **Stack (z `agent-service/requirements.txt` + `app/`):**
  - **API:** FastAPI 0.115.6 + Uvicorn 0.34.0 + Pydantic 2.10.4, `httpx` 0.27.2.
  - **Auth:** `python-jose[cryptography]` 3.3.0 — weryfikacja bearer JWT (RS256) po JWKS realmu Keycloak; tenant wyprowadzany z `iss` tokenu (`…/realms/hrobot-<slug>`), nigdy z body — patrz `app/deps.py::require_tenant`.
  - **Stack ML/RL (ciężki, celowo osobny obraz od `grafik-optimizer`):** `torch` 2.3.1 (CPU wheel), `stable-baselines3` 2.3.2, `gymnasium` 0.29.1, `imitation` 1.0.0, `numpy` 1.26.4.
  - **Obraz bazowy:** `python:3.12-slim` (SB3/ortools/torch publikują koła dla CPython ≤ 3.12).
  - **Store:** tenant-keyed **SQLite** (`app/store.py`, `AGENT_DB_PATH`), izolacja per-tenant (AG6).
- **Faktyczna rola (dziś):** to **samouczący się agent grafikowy** (M2-C1/C2/C3) — behaviour cloning + online feedback + batch retrain, komunikuje się z CP-SAT `grafik-optimizer` przez zamrożony kontrakt `POST /solve`. **Nie ma nic wspólnego z głosem** — to inny agent.
- **Wniosek:** `agent-service` to **dobra baza do rozszerzenia** dla Agenta Głosowego, bo ma już gotowe: (a) szkielet FastAPI, (b) **działającą weryfikację tokenu Keycloak + izolację tenantową** (dokładnie to, czego potrzebuje most głos→API), (c) obraz Pythona z Dockerfile w CI. STT można dołożyć jako **nowy router** (`/voice/*`) w tym samym obrazie **albo** jako osobny lekki serwis. **Rekomendacja: osobny obraz/serwis STT** (patrz §6, ryzyko) — bo faster-whisper wymaga CTranslate2, a nie torch/SB3, i mieszanie zależności niepotrzebnie zwiększyłoby i tak ciężki obraz RL. Wzorzec auth (`deps.py`) **kopiujemy/wydzielamy**, nie duplikujemy logiki tenantowej.

> **Uwaga:** kontener `agent-service` **nie jest obecnie uruchomiony** (`docker ps` pokazuje wyłącznie stack `logmagai-*` — to inny projekt na tym hoście, nie HRobot). To bez znaczenia dla feasibility.

---

## 2. Feasibility lokalnego STT (Python / faster-whisper)

### Środowisko hosta (zweryfikowane)
- **Python:** 3.13.14 (`python --version`) — systemowy.
- **pip:** 26.1.2 — działa, rozwiązuje pakiety.
- **`agent-service/.venv`:** Python **3.13.14**, zawiera **tylko** FastAPI/pydantic/uvicorn/httpx/jose/pytest — **BRAK** `torch`, `ctranslate2`, `faster-whisper`, `onnxruntime`, `av`. Czyli **STT nie jest tu wstępnie zainstalowane**.

### Dostępność pakietów (sprawdzone przez `pip index versions`, BEZ instalacji)
- `faster-whisper` — najnowsza **1.2.1** (dostępna na PyPI). ✅
- `ctranslate2` (silnik inferencyjny) — najnowsza **4.8.1** (ma koła CPython 3.13 x64). ✅

### Czy realne „od ręki"? — **Nie od ręki; wymaga instalacji + pobrania modelu (ale to jest wykonalne i tanie).**

| Element | Rozmiar / koszt | Uwaga |
|---|---|---|
| `pip install faster-whisper` (+ `ctranslate2`, `tokenizers`, `onnxruntime` dla VAD, `av`/PyAV dla audio) | **~120–180 MB** pobrania, ~1–3 min | koła binarne, bez kompilacji na Win x64 |
| Model CTranslate2 (int8, pobierany raz z HuggingFace `Systran/faster-whisper-<size>` przy 1. użyciu) | **tiny ~75 MB · base ~145 MB · small ~490 MB · medium ~1.5 GB · large-v3 ~3 GB** | cache lokalny; potem offline |

**Decyzja PoC:** **nie** wykonano realnej instalacji ani pobrania modelu w tym zadaniu — zgodnie z ograniczeniem „nie pobieraj modeli wielogigabajtowych / nie odpalaj długich instalacji". Instalacja `small` (koła + model ~490 MB) to jednorazowo ~5–8 min i **nie wymaga GPU** — do wykonania na starcie T2. **Realność: wysoka.** Nie ma blokera technicznego; jest tylko jednorazowy koszt setupu.

> **Uwaga wersyjna (do decyzji T2):** host ma Python **3.13**, a `agent-service` bazuje na **3.12-slim** (bo torch/SB3). CTranslate2 4.8 ma koła 3.13, więc **osobny obraz STT może iść na `python:3.12-slim`** (spójnie z resztą i bez ryzyka brakujących kół) — rekomendacja: **pinuj 3.12-slim** dla serwisu STT.

### Jakość PL i latencja CPU — z wiedzy o modelach (Whisper multilingual, PL)

Orientacyjnie (CPU, int8, ~5 s wypowiedzi PL, komendy z zamkniętego zbioru):

| Model | Jakość PL (WER, komendy krótkie) | Latencja CPU / 5 s audio | RAM | Ocena do naszego zastosowania |
|---|---|---|---|---|
| `tiny` | słaba (WER ~30–50%+), gubi PL fleksję/diakrytykę | ~0.3–1 s | ~0.5 GB | tylko smoke-test, **za słaby** na produkcję PL |
| `base` | umiarkowana (WER ~20–30%) | ~0.7–2 s | ~0.7 GB | **próg minimum** dla zamkniętego zbioru komend |
| `small` | **dobra** (WER ~10–18%), sensowne diakrytyki | ~2–5 s | ~1.5 GB | **rekomendowany** kompromis jakość/latencja |
| `medium` | b. dobra (WER ~8–12%) | ~6–15 s (za wolno na CPU) | ~3 GB | jakość super, ale **latencja/CPU boli** — dopiero z GPU |
| `large-v3` | najlepsza | GPU praktycznie wymagany | ~5 GB | poza zakresem PoC na CPU |

**Wniosek:** dla PL na CPU **`small` to sweet spot**, `base` jako fallback wydajnościowy. Zamknięty zbiór komend + `initial_prompt` ze słownictwem domenowym (patrz §5) dodatkowo redukuje realny WER poniżej wartości „ogólnych".

---

## 3. Porównanie opcji + REKOMENDACJA

| Kryterium | **Lokalny faster-whisper `small`/`base`** | **OpenAI Whisper API** (`whisper-1` / `gpt-4o-transcribe`) | **Google / Azure Speech-to-Text** |
|---|---|---|---|
| Jakość PL | dobra (`small` WER ~10–18%); bardzo dobra po `initial_prompt` domenowym | bardzo dobra (large-v3-class) | bardzo dobra (dedykowane modele PL) |
| Latencja | `small` ~2–5 s/5 s audio (CPU); szybciej na GPU | sieć + kolejka ~1–3 s | ~1–2 s (streaming realtime możliwy) |
| Model kosztu | **0 zł/użycie** (koszt = 1× setup + CPU/serwer) | ~$0.006/min (whisper-1) — **per użycie** | per minutę, per użycie (podobnie) |
| RODO / rezydencja danych | **✅ pełna kontrola — audio nie opuszcza UE/infra** | ❌ audio wychodzi poza UE (chyba że EU data-zone + DPA); głos = dane osobowe | ⚠️ możliwe regiony UE, ale procesor zewnętrzny + DPA |
| Offline / air-gapped | **✅ tak** (po pobraniu modelu) | ❌ nie | ❌ nie |
| Nakład integracji | średni (własny serwis, model, VAD) | **niski** (REST call) | niski/średni (SDK + klucze) |
| Zależność od dostawcy | **brak** (open-source, Apache/MIT) | wysoka (vendor lock, zmiany cen/API) | wysoka |
| Zgodność z narracją grantu | **✅ „bez per-token", prywatność, UE** | ✗ per-token, dane poza UE | ✗ per-użycie, procesor zewnętrzny |

### ➡️ REKOMENDACJA

**Lokalny `faster-whisper` (model `small` dla PL, `base` jako tryb szybki/fallback wydajnościowy), z twardym fallbackiem do formularza tekstowego.**

**Dlaczego (jedno zdanie):** nagranie głosu to dane osobowe (RODO) i cała narracja grantu to prywatność/UE „bez per-token" — lokalny faster-whisper daje **zerowy koszt per-użycie, pełną rezydencję danych w UE i pracę offline** przy jakości `small` w zupełności wystarczającej dla **zamkniętego** zbioru komend, a ewentualny niedobór jakości i tak wychwytuje twardy fallback tekstowy.

**Kiedy rozważyć API:** jeśli UAT na `small` pokaże WER zbyt wysoki dla akceptowalnego odsetka fallbacku, dopuszczamy **OpenAI Whisper API jako opcję konfiguracyjną (feature-flag)** — ale tylko z EU data-zone + DPA i jawną zgodą; **domyślnie zostaje lokalny**. Architektura pipeline'u (§4) trzyma STT za jednym interfejsem, więc podmiana silnika to zmiana adaptera, nie przepisanie modułu.

---

## 4. Projekt pipeline'u (zwięźle)

```
[Przeglądarka]                       [Serwis STT/most]                    [tenant-runtime API]
 mikrofon                             (FastAPI, obraz 3.12-slim)           (istniejące, RBAC bez zmian)
 MediaRecorder ──audio (webm/opus)──▶ POST /voice/transcribe
   │  (zgoda + banner „asystent AI")     │  faster-whisper small (PL)
   │                                      │  → text + confidence (avg logprob / no_speech)
   │                                      ▼
   │                                   Intent parsing (REGUŁY + słowniki PL, BEZ LLM)
   │                                      │  intent + encje (data, typ wniosku, zakres)
   │                                      │  confidence STT ∧ dopasowanie intencji
   │                    ┌─────────────────┴───────────────────┐
   │            wysoka pewność                        niska pewność / brak dopasowania
   │                    │                                       │
   │                    ▼                                       ▼
   │            Podgląd + POTWIERDZENIE  ◀────────────  TWARDY FALLBACK: formularz tekstowy
   │            człowieka („czy złożyć                  (prefill z tego, co zrozumiano;
   │            wniosek na 2026-08-01?")                 nigdy „ciche" wykonanie)
   │                    │ TAK
   │                    ▼
   │            Wywołanie istniejącego API z TOKENEM UŻYTKOWNIKA (Bearer):
   │              • Wniosek urlopowy  → POST /api/wnioski {startDate,endDate,type}
   │              • L4/zwolnienie     → POST /api/wnioski {..., type:"ZWOLNIENIE_LEKARSKIE"}
   │              • „mój grafik jutro"→ GET  /api/grafik/shifts?… (odczyt)
   │                    │
   ◀───── potwierdzenie tekstowe/głosowe (wynik z API) ─────────────────────┘
```

**Kluczowe zasady architektury (spójne z master-planem):**
- **RBAC bez zmian:** most **nie** ma własnych uprawnień — przekazuje **token użytkownika** do tenant-runtime; wszystkie reguły (maker-checker, scoping, role) egzekwuje istniejące API. Most = tłumacz głos→REST, nie nowy autoryzator.
- **Tenant z tokenu:** identycznie jak `agent-service/deps.py` — slug z `iss` (`hrobot-<slug>`), nigdy z body.
- **Kształt endpointu STT:** `POST /voice/transcribe` (multipart audio) → `{ text, confidence, segments? }`. Osobno `POST /voice/interpret` (albo połączone) → `{ intent, entities, confidence, apiPlan }` — **apiPlan wykonywany dopiero po potwierdzeniu**.
- **Intent bez LLM:** dopasowanie regułowe (słowa-klucze + sloty PL, normalizacja dat „jutro/piątek/1 sierpnia" → ISO). Deterministyczne, audytowalne, „bez per-token".
- **Istniejące endpointy do mapowania (`apps/tenant-runtime/src`, prefix `/api`):**
  - `@Controller('wnioski')` → `POST /api/wnioski` (`CreateLeaveDto`: `startDate`, `endDate`, `type`; PENDING, decyzję podejmuje manager), `GET /api/wnioski`, `POST /api/wnioski/:id/cancel`.
  - `@Controller('grafik')` → `GET /api/grafik/shifts`, `GET /api/grafik/demands` (odczyt „mój grafik").
  - Czas pracy/RCP → moduł Dokumenty (M3 T2); na potrzeby PoC głosowego trzymamy się `wnioski` + `grafik`.

---

## 5. EU AI Act + RODO (obowiązki modułu)

- **Transparentność (AI Act, systemy konwersacyjne):** jawna, trwała informacja **„rozmawiasz z asystentem AI"** (banner + komunikat startowy). Bez udawania człowieka.
- **Nadzór człowieka (human-in-the-loop):** **potwierdzenie przed każdą akcją nieodwracalną/zapisującą** (złożenie wniosku, zgłoszenie L4). Odczyt (grafik) może iść bez potwierdzenia.
- **Twardy fallback tekstowy od początku:** przy niskiej pewności STT/intencji — **formularz**, nigdy ciche wykonanie. Wbudowany od dnia 1, nie „na koniec".
- **Zakaz biometrii/emocji:** **nie** profilujemy emocji ani cech biometrycznych z głosu; STT wyłącznie mowa→tekst.
- **RODO (nagranie głosu = dane osobowe):**
  - **Minimalizacja:** przetwarzać audio w pamięci; **nie** persystować nagrań domyślnie.
  - **Retencja:** jeśli audio zapisywane (debug/UAT) — krótkie TTL, jawna polityka, kasowanie.
  - **Zgoda:** wyraźna zgoda na użycie mikrofonu i przetwarzanie głosu; łatwe wyłączenie (tryb tekstowy zawsze dostępny).
  - **Rezydencja:** lokalny STT = audio zostaje w infrastrukturze UE (główny argument za rekomendacją z §3).
  - **Logowanie:** log akcji (kto/kiedy/jaka intencja) **bez** surowego audio i bez nadmiaru treści.

---

## 6. Minimalny zakres PoC na T2/T3 + zamknięty zbiór komend

### Co PoC ma udowodnić (bramka G3: „≥3 komendy + fallback")
1. **STT-PL działa na CPU:** faster-whisper `small` transkrybuje 3 nagrane komendy PL; zmierzony **WER na krótkiej próbce** (kilka–kilkanaście nagrań, np. 3 komendy × 3 głosy) — próg akceptacji np. **WER ≤ ~20%** lub, praktyczniej, **≥ ~90% trafność wykrycia intencji** (bo intencja z zamkniętego zbioru toleruje drobne błędy transkrypcji).
2. **Intent+encje z reguł:** 3 komendy poprawnie mapują się na intencję + encje (data, typ).
3. **Most do API:** poprawne wywołanie istniejącego endpointu z tokenem użytkownika (np. utworzenie wniosku PENDING) — na tenancie syntetycznym/demo (RODO-safe).
4. **Fallback + potwierdzenie:** wymuszony scenariusz niskiej pewności → formularz; akcja zapisująca → ekran potwierdzenia.
5. **Latencja:** czas STT/komendę mieści się w akceptowalnym UX (`small` na CPU ~2–5 s; jeśli za wolno → `base`).

### Zamknięty zbiór komend (propozycja — 3 na PoC, rozszerzalny)

| # | Intencja | Przykładowa wypowiedź PL | Encje | Akcja API | Zapis? → potwierdzenie |
|---|---|---|---|---|---|
| K1 | `LEAVE_REQUEST` (wniosek urlopowy) | „złóż wniosek urlopowy na piątek" / „chcę urlop od 1 do 5 sierpnia" | `startDate`, `endDate`, `type=URLOP_WYPOCZYNKOWY` | `POST /api/wnioski` | **TAK** — potwierdź przed |
| K2 | `SICK_LEAVE` (zgłoś L4) | „zgłoś L4 od jutra" / „jestem na zwolnieniu od poniedziałku" | `startDate`, `endDate?`, `type=ZWOLNIENIE_LEKARSKIE` | `POST /api/wnioski` | **TAK** — potwierdź przed |
| K3 | `MY_SCHEDULE` (mój grafik) | „jaki mam grafik jutro" / „pokaż mój grafik na środę" | `date` | `GET /api/grafik/shifts?…` | NIE (odczyt) |

**Zasady zbioru:** **zamknięty i skończony** (nie open-ended) — to wprost mitygacja R10. Rozpoznanie spoza zbioru → **fallback tekstowy**. Normalizacja dat PL („jutro", „piątek", „1 sierpnia") w warstwie intencji. `initial_prompt` STT zawiera słownik domenowy („urlop", „wniosek", „grafik", „L4", „zwolnienie", nazwy dni/miesięcy) — realnie podnosi trafność.

### Podział na tygodnie (z master-planu)
- **T1 (teraz):** ten PoC/feasibility + decyzja lokalny/API. ✅
- **T2:** spec Agenta Głosowego + **realna instalacja faster-whisper `small`** + smoke-test WER na nagranej próbce PL (bramka: WER/trafność intencji spełnia próg).
- **T3:** build (STT → intent → most → fallback → komponent mikrofonu web-kit) + doc EU AI Act; bramka **G3: demo ≥3 komendy + fallback**.

---

## 7. Ryzyka i mitygacje

| Ryzyko | Ocena | Mitygacja |
|---|---|---|
| **R10 — jakość STT PL** (główne) | wys. | `small` PL + `initial_prompt` domenowy; **zamknięty** zbiór komend; **twardy fallback tekstowy od startu**; próg WER/intencji na UAT; opcja API za flagą, jeśli trzeba |
| Latencja CPU na `small`/`medium` | śr. | domyślnie `small`; `base` jako tryb szybki; ewentualnie GPU na serwerze; STT asynchroniczne z UI „przetwarzam…" |
| Rozmiar/ciężkość obrazu, mieszanie z torch/SB3 | śr. | **osobny obraz STT** (CTranslate2, `python:3.12-slim`) — nie doklejać do obrazu RL `agent-service`; wzorzec auth `deps.py` wydzielić, nie duplikować |
| RODO — nagranie głosu = dane osobowe | wys. | lokalny STT (dane w UE), brak persystencji audio domyślnie, retencja/TTL, zgoda, tryb tekstowy zawsze |
| AI Act — transparentność/nadzór | wys. | banner „asystent AI"; potwierdzenie przed akcją zapisującą; brak biometrii/emocji; logowanie bez surowego audio |
| Błędne wykonanie akcji z błędnej transkrypcji | śr. | człowiek-w-pętli + podgląd encji przed zapisem; odczyt bez potwierdzenia, zapis zawsze z potwierdzeniem |
| Wersja Pythona (host 3.13 vs obraz 3.12) | nis. | pinować obraz STT na `3.12-slim`; CTranslate2 4.8 ma koła i dla 3.13, więc lokalny dev na 3.13 też zadziała |
| Wektor kosztu przy wyborze API | nis. (jeśli lokalny) | rekomendacja = lokalny (0 zł/użycie); API tylko opcjonalnie za flagą |

---

## 8. Podsumowanie / decyzja

- **Feasibility lokalnego STT: wysoka.** Python 3.13 + pip działają; `faster-whisper` 1.2.1 i `ctranslate2` 4.8.1 dostępne na PyPI z kołami CPU. Wymaga jednorazowej instalacji (~120–180 MB) + pobrania modelu (`small` ~490 MB) — kilka minut, **bez GPU**, potem offline. Nie zainstalowano w tym PoC (celowo — bez ciężkich pobrań).
- **Rekomendacja: lokalny `faster-whisper small` (PL) + twardy fallback tekstowy.** Zero kosztu per-użycie, dane w UE (RODO), praca offline, brak vendor lock — przy jakości wystarczającej dla zamkniętego zbioru komend. OpenAI Whisper API tylko jako opcja za feature-flag, gdyby UAT wykazał niedobór jakości.
- **Baza do rozszerzenia:** `agent-service` (FastAPI + gotowa weryfikacja Keycloak/izolacja tenantowa) — wzorzec auth do reużycia; sam STT w **osobnym, lekkim obrazie** (CTranslate2, nie torch).
- **Następny krok (T2):** spec + realna instalacja `small` + smoke-test WER na nagranej próbce PL.

---

### Załącznik A — dane techniczne zebrane w PoC (weryfikowalne)
- Host: `python --version` → **Python 3.13.14**; `pip --version` → **26.1.2**.
- `pip index versions faster-whisper` → **1.2.1** (dostępna); `ctranslate2` → **4.8.1** (dostępna).
- `agent-service/.venv`: Python 3.13.14, **bez** torch/ctranslate2/whisper (tylko FastAPI/pydantic/jose/pytest).
- `agent-service/requirements.txt`: fastapi 0.115.6, uvicorn 0.34.0, pydantic 2.10.4, httpx 0.27.2, python-jose[cryptography] 3.3.0, torch 2.3.1, stable-baselines3 2.3.2, gymnasium 0.29.1, imitation 1.0.0, numpy 1.26.4; obraz `python:3.12-slim`.
- Auth wzorzec: `agent-service/app/deps.py::require_tenant` (RS256 po JWKS realmu, tenant z `iss`).
- Endpointy tenant-runtime (prefix `/api`): `wnioski` (`CreateLeaveDto`: startDate/endDate/type), `grafik/shifts`, `grafik/demands`.
- `docker ps`: brak `agent-service`; działa wyłącznie niepowiązany stack `logmagai-*`.
