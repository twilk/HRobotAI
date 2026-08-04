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

[00:28] commit | pierwszy incrementalny commit tego biegu (Z2 dokonczony + Z1 patch-request + log) — SHA ponizej w podsumowaniu
