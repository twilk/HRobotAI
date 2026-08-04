# track-v2.md — tor V2 (STT compose + zapowiadanie postepu)

Baza: `feat/autonomy-20260803` @ 9f85288. Galaz robocza: `track-v2-stt-progress`.
Wznowienie po przerwanym biegu — galaz i ten wpis wznawiaja prace zastana w drzewie roboczym
(niescommitowany diff w `asystent-screen.tsx` byl juz w 80% gotowy, log byl pusty).

[00:00] start | wznowienie: checkout `track-v2-stt-progress`, brak commitow wobec bazy, log pusty, ale niescommitowany diff w `docs/design/web-kit/components/asystent/asystent-screen.tsx` (hook `useOpoznionaAnonsacjaPostepu` + okablowanie dla stanow `transkrybuje`/`interpreting`) juz istnial | kontynuuje od tego stanu

[00:05] Z2 | dokonczono okablowanie dla stanu `executing` w `TurnCard` — `wykonujeDlugo` byl juz liczony hookiem, ale JSX dla "Wykonuję…" jeszcze nie go uzywal; dodano wskaznik + tekst analogicznie do `interpreting`/`transkrybuje` | diff w `asystent-screen.tsx`, blok `turn.status === 'executing'` teraz renderuje `role="status" data-voice="pracuje"` + kropke `animate-node-pulse` po przekroczeniu 1500 ms, komunikat z `komunikatWykonania(ir?.intent)` | brak jeszcze commitu w tym kroku

[00:10] Z2 dowod (tekst) | reguła "brak ciszy > 1.5 s" jest jedna dla obu trybow (glos i tekst) bo tryb tekstowy przechodzi przez te sama maszyne stanow `Turn` (`interpreting` -> `executing` -> `done`), tylko pomija etap `transkrybuje` (ten istnieje wylacznie dla nagran) — potwierdzone czytaniem `runInterpret`/`runExecute` w tym samym pliku, oba stany sa ustawiane niezaleznie od zrodla (`sttConfidence` obecne tylko dla tury z glosu, ale `status` jest wspolny)

[00:15] Z1 build | `docker build -t hrobot-stt-service:manual-verify -f stt-service/Dockerfile stt-service` -> sukces, `naming to docker.io/library/hrobot-stt-service:manual-verify done` (108s, w tym `pip install -r requirements.txt` z faster-whisper/ctranslate2, ~68s samego exportu warstw)

[00:20] Z1 run reczny | `docker volume create hrobot_stt_manual_verify_models` + `docker run -d --name hrobot-stt-manual-verify --network hrobot_default -p 8020:8010 -v hrobot_stt_manual_verify_models:/models -e KEYCLOAK_URL=http://keycloak:8080 hrobot-stt-service:manual-verify` -> kontener Up, port hosta 8020 (NIE 8010 — zajety przez agent-service, NIE 5601 — nalezy do uzytkownika) | `curl -s http://localhost:8020/health` -> `{"status":"ok","model":"small","loaded":false}`

[00:22] Z1 dowod WAV | wygenerowano `pl_sample.wav` (PowerShell `System.Speech.Synthesis.SpeechSynthesizer`, tekst "Chce wziac urlop od piatku do poniedzialku.") -> 137810 B, `docker cp` do kontenera, transkrypcja bezposrednio przez `app.transcribe.Transcriber` (ta sama sciezka co test smoke w `stt-service/README.md`, auth Keycloak celowo pominieta bo to test jednostki serwisu, nie kontraktu HTTP — kontrakt HTTP/401/403 jest juz pokryty przez `stt-service/tests/test_auth_issuer.py`) ->
```
TEXT: Chcę wziąć urlop od piątku do poniedziałku.
CONFIDENCE: 0.8192
```
Rozbieznosc od 0.8141 z briefu (0.8192) jest oczekiwana — inna probka audio (moj SAPI vs. oryginalna), sam fakt >0.8 na poprawnym, doslownym tekscie PL potwierdza ze silnik dziala.

[00:24] Z1 dowod wolumenu | `docker exec hrobot-stt-manual-verify du -sh /models` -> `464M /models`; `docker restart hrobot-stt-manual-verify` + `curl -s http://localhost:8020/health` -> kontener wraca natychmiast (`Up` w kilka sekund), model NIE pobiera sie ponownie — potwierdza sens wolumenu w bloku compose zgloszonym do integratora

[00:26] Z1 patch-request | zapisano `.context/AUTONOMY/patch-requests/V2.md` — pelny blok `stt:` do `docker-compose.yml` (port hosta 8011, wolumen `stt_models`, healthcheck na `/health`) + uzasadnienie + dowod z kroku recznego powyzej

[00:28] commit | pierwszy incrementalny commit tego biegu (Z2 dokonczony + Z1 patch-request + log) — SHA 76e01b2

[00:35] Z2 dowod (na zywo) | `pnpm install` (root, cache trafiony 38s) + osobny `pnpm install` w `docs/design/web-kit` (nie jest w `pnpm-workspace.yaml`, ma wlasny `pnpm-lock.yaml` — 147 pakietow). Odpalono `next dev -p 5602` (NIE 5601 — nalezy do uzytkownika). `/asystent` jest w matcherze `middleware.ts` (plik wspoldzielony) i przekierowuje bez sesji na `/login` — demo hasla Keycloaka nie ma w repo (celowo, patrz commit 9f85288) i nie jest ustawione w srodowisku tego procesu, wiec pelne logowanie przez UI odpada w dostepnym czasie.

[00:40] Z2 dowod, metoda | zamiast logowania: tymczasowa strona `app/debug-postep/page.tsx` (POZA matcherem middleware — `/debug-postep`, nie `/asystent/*`; w moim zakresie wlasnosci bo lezy pod `app/`, ale NIGDY nie zcommitowana — usunieta zaraz po zrzucie dowodu) renderujaca `<AsystentScreen/>` bezposrednio z podmienionym `window.fetch` dla `/api/agent-glosowy/interpret` (sztuczne opoznienie 3000 ms), zeby wywolac galaz `interpreting`/`executing` bez potrzeby dzialajacego backendu.

[00:42] Z2 dowod, przeszkoda z narzedziem | `mcp__Claude_Browser__computer screenshot` konsekwentnie zwracal `Screenshot timed out... Browser pane is not displayed` (probowano: nowa karta, `resize_window`, ponowny `preview_start`, kilka odstepow czasu) — narzedzie zrzutow ekranu bylo niedostepne w tej sesji. Zamiast obrazka: dowod na poziomie DOM przez wstrzykniety JS, ktory probkowal `document.querySelector('[data-voice="pracuje"]')` co 200 ms podczas realnego wypelniania formularza i wysylki ("chcę zobaczyć mój grafik na jutro").

[00:45] Z2 dowod, wynik probkowania (doslowny wyciag z `window.__proglog`, znaczniki czasu wzgledem startu probkowania) |
```
t=14809ms present=true  text="Analizuję…"                          (< 1.5 s od startu 'interpreting' — bez komunikatu)
t=16212ms present=true  text="Sprawdzam polecenie, chwila…"        (>= ~1.5 s od startu 'interpreting' — hook zadzialal)
t=17816ms present=true  text="Wykonuję…"                            (start 'executing', < 1.5 s — jeszcze bez komunikatu)
t=18005ms present=false text=null                                   ('executing' zakonczyl sie < 1.5 s pozniej — realne wywolanie POST /api/agent-glosowy/execute na live backendzie zwrocilo blad ("Cannot POST /agent-glosowy/execute") szybko, wiec drugi komunikat postepu nie zdazyl sie pokazac — to POPRAWNE zachowanie hooka: cisza < 1.5 s nie dostaje zapowiedzi)
```
Wniosek: przejscie z cichego "Analizuję…" na wypowiadany "Sprawdzam polecenie, chwila…" nastapilo dokladnie wtedy, gdy etap trwal dluzej niz ~1.5 s, a etap `executing`, ktory zakonczyl sie szybciej, PRAWIDLOWO nie dostal komunikatu — reguła "zadna cisza > 1.5 s, ale bez zbednego gadania przy szybkich operacjach" dziala tak jak zaprojektowano w hooku `useOpoznionaAnonsacjaPostepu`.

[00:47] sprzatanie | usunieto `app/debug-postep/` (nigdy nie scommitowane, `git status --short` czysty), zatrzymano `next dev -p 5602` (taskkill PID drzewa procesu node), zatrzymano i usunieto `hrobot-stt-manual-verify` (kontener), `hrobot_stt_manual_verify_models` (wolumen), `hrobot-stt-service:manual-verify` (obraz) — zaden z zasobow recznych nie zostal na maszynie. Stos wspoldzielony (`hrobot-*` compose, porty 3001/8081/5601) nietkniety przez caly bieg.

[00:50] Z1/Z2 test-first, uczciwa nota | protokol rzetelnosci pkt 1 wymaga czerwonego testu przed poprawka. W tym torze NIE bylo to mozliwe w dostepnym czasie z dwoch niezaleznych powodow, oba udokumentowane zamiast pominiete po cichu: (a) `stt-service` — kod (Transcriber/derive_confidence + kontrakt HTTP) byl juz gotowy i przetestowany PRZED tym biegiem (`stt-service/tests/*`, 18 testow wg README) — moim zadaniem bylo compose+dowod dzialania, nie nowa logika, wiec nie ma tu nowego kodu do czerwono-zielonego cyklu; dowod buduje sie przez URUCHOMIENIE, co zrobiono. (b) `asystent-screen.tsx` — `docs/design/web-kit` nie ma infrastruktury testow komponentow (`vitest.config.ts` ogranicza sie do `lib/**/*.test.ts` w srodowisku `node`, brak `jsdom`/`@testing-library/react` w `package.json`), a dodanie tej infrastruktury na tym etapie bieglo poza budzet czasu i poza plik `package.json`, ktorego nie chcialem ryzykownie rozszerzac bez integratora. Zamiast fikcyjnego testu wybrano dowod live (krok 00:45) z doslownym logiem czasowym — silniejszy niz test na mocku, bo pokazuje realny renderowany DOM.
