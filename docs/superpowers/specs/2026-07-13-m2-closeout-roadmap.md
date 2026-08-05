# Spec: domknięcie M2 + start M3 — 5 workstreamów

> **Kontekst:** M2 (Grafik CP-SAT + Agent AI) jest zbudowane, przetestowane (QA 95/100) i przećwiczone
> na demie 10-min w trybie produkcyjnym, na gałęzi `feat/demo-4mobility` (~10 commitów, NIE zmergowane
> do `main`). Twarda data: odbiór Etapu 2 przez 4Mobility/PARP (~2026-07-20). Repo jest **publiczne**.
> Ten spec zbiera 5 workstreamów, które teraz dają największą dźwignię, w jeden plan z kolejnością.
>
> **Źródła:** `data/m2-evidence/*` (demo-scenario, demo-10min, acceptance-criteria, protokół, RODO
> checklist), `scripts/*` (demo-up, seedy), memory `project_m2_grafik_decomposition` +
> `reference_km_report_workflow` + `reference_hrobot_multirepo`.

## Zasady nadrzędne (dotyczą KAŻDEGO workstreamu)
- **Nie ruszaj kotwic demo:** konta `demo`/`manager.demo`/`pracownik.demo`, hero week 13–19 lipca
  (52 zmiany, Anna=5), tydz. 20–26 pusty (pokaz INFEASIBLE), wniosek J5 `PENDING_MANAGER`,
  `keycloak_sub` w tenant DB zsynchronizowane.
- **Repo publiczne:** nigdy nie commituj sekretów; `.env` i `docker-compose.override.yml` są gitignored.
- **RODO / dane syntetyczne:** zero realnych danych osobowych; PESEL nigdy nie opuszcza serwera.
- **Weryfikacja dowodem, nie deklaracją:** każde „działa" potwierdź na żywo (login → endpoint/UI/test).
- **Commity atomowe**, jeden fix = jeden commit; testy zielone przed dalej.

## Kolejność i zależności
```
W1 Bezpieczeństwo ──► (blokuje pokazanie repo)   ┐
W2 Deliverable odbioru ──► (twarda data 20.07)    ├─► odbiór 4Mobility
W3 Ship do main ──► (zależy od zielonego CI)      ┘
── po odbiorze ──
W4 Hardening (dług techniczny)
W5 Plan M3 (patrzenie w przód)
```
**Rekomendacja:** W1 → W2 → W3, potem W4 i W5. W1 najpierw, bo publiczne repo z sekretami w historii
może zaszkodzić ZANIM cokolwiek pokażesz.

---

## W1 — Bezpieczeństwo / RODO (kontekst: security; priorytet: NAJWYŻSZY)
**Korzyść:** repo publiczne + sekrety w historii git = realne ryzyko przed odbiorem; szybki, wysoki zwrot.

**Cel:** repo bezpieczne do pokazania; twierdzenia RODO z demo potwierdzone w kodzie.

**Zakres:**
- Secret-scan CAŁEJ historii git (nie tylko HEAD): gitleaks/trufflehog → lista trafień (commit + ścieżka).
  Znane ryzyka: `TENANT_DB_ENCRYPTION_KEY=0123…cdef`, hasła dev (`dev-only-change-me`), kontekst PARP.
- Realne sekrety: plan rotacji + przeniesienie do env/secret-store (rotacja = akcja użytkownika, nie narzędzia).
- Weryfikacja RODO: PESEL nigdy nie w odpowiedzi API (przegląd wszystkich kontrolerów/`select`),
  `audit_log` faktycznie append-only (DB grants), AES-256-GCM działa.
- Dane syntetyczne w 100% (uwaga: realm `hrobot-4mobility` w volume ma realnie wyglądające maile —
  `pawel.blaszczak@4mobility.pl`, `wilczyy@gmail.com` — nie używać w demie; demo używa realmu `hrobot-staging`).

**Dostarczenie:** raport znalezisk wg severity + konkretne fixy + lista „wymaga decyzji użytkownika".
**Akceptacja:** 0 sekretów w bieżącym drzewie; historia zaudytowana; RODO-claimy potwierdzone kodem.

## W2 — Deliverable odbioru Etapu 2 (kontekst: compliance/biznes; priorytet: WYSOKI — deadline)
**Korzyść:** to jest właściwy obowiązek grantu z datą 20.07; cała praca sesji istnieje, by to podpisać.

**Cel:** komplet dokumentów gotowy do wysłki i podpisu.

**Zakres:**
- Dla KAŻDEGO kryterium z `data/acceptance-criteria-M2.md` → dowód: zrzut z demo (produkcja :5601),
  wynik solvera (OPTIMAL + INFEASIBLE), test, lub zapis w kodzie.
- Wypełnij `protokol-odbioru-template.md` z uczciwą sekcją etapowości (M2 vs M3 — z `demo-scenario`).
- Zbuduj raport KM wg `reference_km_report_workflow` (szablon OPSOFT, screeny z portu-bypass,
  PDF przez Chrome CDP — bez Worda/LibreOffice na tym boxie).
- Każdy dowód zweryfikowany na żywo (login → endpoint/UI).

**Dostarczenie:** wypełniony protokół + evidence pack + PDF raportu KM, po polsku.
**Akceptacja:** każde kryterium ma dowód; protokół i raport kompletne; etapowość opisana uczciwie.

## W3 — Ship do main (kontekst: release; priorytet: WYSOKI)
**Korzyść:** ~10 commitów wisi na `feat/demo-4mobility`; domknięcie zabezpiecza sesję i daje czysty baseline.

**Cel:** M2 na `main`, PR z dowodami, zielone CI.

**Zakres:**
- Przegląd całego diffu vs `main` (nie commit-po-commicie) — regresje + co NIE ma trafić do main
  (potwierdź gitignore override/`.env`; zdecyduj, czy seedy demo + `data/m2-evidence` do main).
- Testy: Jest (`apps/tenant-runtime`) + pytest (`grafik-optimizer`/`agent-service`) — napraw czerwone.
- CHANGELOG + VERSION; PR body: feature'y M2 + fixy F1–F5 + dataset cze–wrz + demo, z linkami do dowodów.
- Nie merguj na siłę przy czerwonym CI — zdiagnozuj.

**Dostarczenie:** czysty `main` + link PR.
**Akceptacja:** testy zielone; diff przejrzany; PR opisuje dostarczone M2.

## W4 — Hardening / dług techniczny (kontekst: eng; priorytet: ŚREDNI — po odbiorze)
**Korzyść:** demo działa na skrótach wykrytych w tej sesji; zamiana na produkcję podnosi jakość i zdejmuje ryzyko.

**Cel:** produkcyjne rozwiązania zamiast obejść demo; każdy fix z testem.

**Zakres (każdy: root cause → minimalny fix → test regresyjny → potwierdzenie na żywo):**
1. Realm Keycloak efemeryczny (H2 bez volume) → zamontuj volume/persistent DB, by `compose down` nie kasował
   realmu (dziś ratuje `scripts/seed-keycloak-demo.mjs`).
2. Rotacja refresh-tokenów w web-kit (dziś cookie = access token, lifespan 1h → re-gate na /login).
3. Endpointy nazw: `GET /grafik/lokalizacje` + org-units, żeby web-kit nie mapował UUID→nazwa z
   `lib/demo-locations.ts`.
4. Zawężenie `/grafik/demands` dla PRACOWNIKA (dziś widzi cały katalog 685; nie-PII, ale nadmiarowe).
5. Stabilny produkcyjny build web-kit (był stale-cache „Cannot find module './NNN.js'"; `rm -rf .next` + build).

**Dostarczenie:** atomowe commity + testy; kotwice demo nietknięte.
**Akceptacja:** każdy skrót zastąpiony, zweryfikowany, otestowany.

## W5 — Plan M3 (kontekst: strategia/architektura; priorytet: ŚREDNI — po odbiorze)
**Korzyść:** granice M2→M3 są udokumentowane; przekucie w plan to naturalny następny krok grantu.

**Cel:** spec + plan M3 gotowy pod team agentów.

**Zakres:**
- Przez `/autoplan` (CEO→eng→design review, auto-decyzje): dekompozycja M3 na podprojekty z granicami/interfejsami,
  uszeregowane wg wartości dla 4Mobility i ryzyka.
- Twarde tematy do uczciwej wyceny: tygodniowy odpoczynek 35h + nadgodziny (H5/H6 w CP-SAT), inicjowanie
  zamiany przez pracownika z „mojego grafiku", powiadomienia real-time, agent z pilota (numpy scorer) →
  produkcyjny RL.
- Dla każdego: realna wartość vs „nice-to-have".

**Dostarczenie:** spec + plan (writing-plans) z kryteriami akceptacji.
**Akceptacja:** M3 zdekomponowane; każdy podprojekt dowozi działające, testowalne oprogramowanie sam.

---

## Wykonanie
Każdy workstream jest samodzielny (własne kryteria akceptacji). Startuj W1. Rekomendowana ścieżka
krytyczna do 20.07: **W1 → W2 → W3**; W4/W5 po odbiorze.
