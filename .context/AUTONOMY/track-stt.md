# Tor STT — odporność `stt-service/` (W12, W13)

UWAGA na lokalizację: agent działa w izolowanym worktree
(`.claude/worktrees/wf_8c66f8db-195-4`) i narzędzia plikowe odmawiają zapisu poza nim, więc ten
log oraz `patch-requests/STT.md` powstały pod `<worktree>/.context/AUTONOMY/...`, nie pod
współdzieloną ścieżką `C:/Users/Wilk/Documents/WORKSPACE/HRobot/.context/AUTONOMY/...` z briefu.
Integrator musi skopiować oba pliki do współdzielonej lokalizacji.

Log dopisywany chronologicznie. Każdy wpis: `[HH:MM] krok | co zrobiono | dowód | commit <sha>`.

[start] konfiguracja | `git checkout feat/autonomy-20260803` — czubek `793b3b5` (branch był
checked-out w innym worktree wcześniej dla innych torów, ale w tym worktree lokalna kopia była
aktualna po `git fetch`). Utworzono `track-stt/w12-w13-resilience` z tego punktu. `pnpm install`
w katalogu głównym uruchomiony (dla spójności ze stackiem monorepo — stt-service jest czystym
Pythonem, więc nie jest ściśle wymagany do jego testów, ale brief każe to zrobić).

[krok 1] baza | `python -m venv .venv` w `stt-service/`, `pip install -r requirements.txt` (w tym
faster-whisper/ctranslate2 — długi pobierz, ~5 min). Baseline: `python -m pytest -q` →
`25 passed in 34.73s`. Zgodne z briefem ("dziś 25 zielonych").

[krok 2] eksploracja mechanizmu W13 | Przeczytano `stt-service/.venv/Lib/site-packages/starlette/
formparsers.py` i `requests.py`: `MultiPartParser.max_file_size = 1MB` (stała klasy), użyta jako
`SpooledTemporaryFile(max_size=self.max_file_size)` — próg spool-do-dysku jest WEWNĄTRZ parsera
multipart, wywoływanego przez `Request.form()`/`UploadFile=File(...)` PODCZAS rozwiązywania
parametrów FastAPI, a więc PRZED uruchomieniem ciała handlera. Wniosek: samo przesunięcie linii
`if len(data) > MAX_AUDIO_BYTES` przed `data = await audio.read()` W CIELE FUNKCJI nie wystarczy —
parsowanie (i ewentualny zapis na dysk) już się odbyło, zanim jakikolwiek kod handlera dostał
szansę cokolwiek sprawdzić. Prawdziwa poprawka musi odrzucić żądanie PRZED wywołaniem
`request.form()` w ogóle (z nagłówka `Content-Length`) — i, dodatkowo, `max_file_size=1MB` jest
NIŻSZY niż `MAX_AUDIO_BYTES` (domyślnie 10MB), więc nawet zaakceptowane nagranie 2-9 MB
spoolowałoby się na dysk przy STANDARDOWYM parserze, mimo że mieści się w limicie — co czyniłoby
deklarację RODO w `route.ts` nieprawdziwą także dla legalnego ruchu, nie tylko dla odrzuconego.
Decyzja: podnieść `max_file_size` do `MAX_AUDIO_BYTES` przez własny podklas `MultiPartParser`,
UŻYWANY WYŁĄCZNIE po przejściu bramki Content-Length. | pliki jw. | -

[krok 3] czerwony test W12 | Dopisano `test_health_responds_while_a_transcription_is_in_flight` do
`tests/test_api.py`: dwa wątki, jeden POST /voice/transcribe z zamockowanym `_transcriber.transcribe`
blokującym się na `threading.Event.wait()` (symulacja CPU-bound), drugi GET /health mierzący czas.
PIERWSZA WERSJA testu (na współdzielonej fixturze `client = TestClient(app)` bez `with`) PRZESZŁA
FAŁSZYWIE — `starlette.testclient._TestClientTransport.handle_request` otwiera NOWY portal (nową
pętlę zdarzeń) per wywołanie, gdy klient nie jest użyty jako context manager, więc dwa równoległe
wywołania na tym samym `TestClient` i tak trafiają na DWIE różne pętle i test nic nie udowadnia.
Poprawiono: `with TestClient(app) as client:` (jeden portal na cały blok, tak jak jeden proces
uvicorn) → test: `AssertionError: /health took 5.02s while a transcription was in flight`. CZERWONY,
zapisane dosłownie. | `python -m pytest -q tests/test_api.py -k health_responds_while` →
`1 failed ... /health took 5.02s ... assert 5.02 < 1.0` | -

[krok 4] czerwony test W13 | Dopisano `test_oversized_audio_never_spools_to_disk` (spy na
`tempfile.SpooledTemporaryFile.rollover`, dowód bezpośredni zapisu na dysk, nie tylko kodu 413) i
`test_content_length_missing_is_refused_without_reading_body` (spy na `MultiPartParser.parse`,
weryfikuje że ciało w ogóle nie jest parsowane bez Content-Length). Uruchomione na niezmienionym
kodzie → `2 failed`: `rollover_calls == [1]` (dysk DOTKNIĘTY dla żądania >limit, potwierdza W13
dosłownie) oraz brak nagłówka Content-Length dawał dziś `400` zamiast oczekiwanego `411` (bo dziś
nic go nie sprawdza — parsowanie leci dalej, klapie na czymś innym). CZERWONE, zapisane dosłownie.
| `python -m pytest -q tests/test_api.py -k "never_spools_to_disk or content_length_missing"` →
`2 failed`; `assert [1] == []` (rollover) i `assert 400 == 411` | -

[krok 5] naprawa W12+W13 | `stt-service/app/main.py`: (a) `audio: UploadFile = File(...)` →
`request: Request`, ręczne parsowanie przez `_parse_multipart_bounded()` PO bramce Content-Length
(sprawdzenie `content-length` nagłówka: brak → 411, > MAX_AUDIO_BYTES → 413 — zanim jakikolwiek
multipart parser dotknie ciała); (b) `_InMemoryMultiPartParser(MultiPartParser)` z
`max_file_size = MAX_AUDIO_BYTES` zamiast domyślnego 1MB — bo inaczej NAWET zaakceptowane
nagranie 2-9 MB nadal spoolowałoby się na dysk mimo przejścia bramki Content-Length (krok 2);
(c) `_transcriber.transcribe(data)` → `await run_in_threadpool(_transcriber.transcribe, data)`
(W12 — offload CPU-bound pracy z pętli zdarzeń, ta sama prymitywa co FastAPI używa dla `def`
endpointów). Zaktualizowano też komentarz RODO w
`docs/design/web-kit/app/api/voice/transcribe/route.ts` — deklaracja "processes it in memory"
była PRAWDZIWA z lukami (patrz krok 2), teraz dopisano dokładnie GDZIE i JAK jest to egzekwowane
(`_InMemoryMultiPartParser` + bramka Content-Length w `main.py`), żeby przyszła zmiana w jednym
pliku nie mogła po cichu uczynić drugiego kłamliwym. | diff jw. | -

[krok 6] zielony | `python -m pytest -q` → `28 passed in 4.56s` (25 bazowych + 3 nowe: W12 health-
during-transcribe, W13 rollover-spy, W13 content-length-required). Zero regresji. | `python -m
pytest -q` → `28 passed in 4.56s` | (do uzupełnienia po commicie)
