# M2 · Podprojekt #5 — UAT Etapu 2 + Pakiet Dowodowy Odbioru (projekt)

> **Projekt:** HRobot.AI — Kamień Milowy **M2** (odbiór 20.07.2026)
> **Punkt programu:** **f)** UAT Etapu 2 (sesje z użytkownikami 4Mobility)
> **Beneficjent:** App Pro sp. z o.o. (0035/2026) · **Odbiorca Technologii:** 4Mobility
> **Data:** 2026-07-09 · **Status:** Projekt → plan · **Zależność:** #1–#4
> **Powiązane:** `2026-07-09-m2-roadmap-ukonczenie.md` (§GSTACK REVIEW REPORT)

---

## 1. Kontekst — dlaczego to więcej niż „testy"

Odbiór grantowy M2 to **protokół odbioru podpisany przez 4Mobility**, nie zielony CI. Review /autoplan (3 głosy, krytyczne) wykazał: plan miał UAT, ale **brakowało instrumentu odbioru** — dowodu mapującego deliverables na punkty umowy, ścieżki fallback i produktowego „definition of done". Ten podprojekt to naprawia. Strategia **deep-2 + renegocjacja**: UAT potwierdza 2 moduły-wskaźniki (a Grafik + b Agent) i etapowość reszty.

## 2. Warunek wstępny (KRYTYCZNY, dni 0-2) — zanim UAT

1. **Ekstrakcja dosłownych kryteriów odbioru M2** z umowy PARP + wzoru protokołu 4Mobility. Wkleić verbatim, zmapować każde zdanie na artefakt demo. *(To gatuje framing b i c — patrz roadmapa UC1/UC2.)*
2. **Sesja potwierdzenia wymagań z 4Mobility (2-3 dzień)** na istniejącym prototypie web-kit (~50%) — potwierdzić, że „pilot b / minimalne c / etapowość" jest zgodne z protokołem; uzgodnić strukturę **protokołu z uwagami** jako fallback.
3. Wynik: `data/acceptance-criteria-M2.md` — źródło prawdy dla wszystkich AC (#1–#4).

## 3. Pięć krytycznych user-journey (produktowy DoD)

UAT testuje **przepływy użytkownika**, nie komponenty. Każdy journey ma kryterium pass/fail:

| # | Journey | Pass/fail |
|---|---------|-----------|
| J1 | Menadżer tworzy/edytuje zapotrzebowanie (szablon → korekta) | zapotrzebowanie zapisane, widoczne w siatce |
| J2 | Menadżer generuje grafik („Generuj") → solver → wynik | wykonalny grafik w ≤ limit, 0 naruszeń H1-H6 |
| J3 | Menadżer inspekcjonuje metryki i naruszenia; ręcznie koryguje | metryki (dojazdy/etaty) widoczne; edycja trwała |
| J4 | Agent AI proponuje grafik z uzasadnieniem; menadżer koryguje → agent się uczy | rationale widoczne; feedback zapisany; (demo AG2) |
| J5 | Pracownik zgłasza zamianę → peer akceptuje → menadżer zatwierdza | happy-path SW1; zamiana łamiąca reguły odrzucona (SW2) |

## 4. Dane UAT (syntetyczne, RODO)

Kanoniczny zbiór **zamrożony D2** (współdzielony z #4 §6 i cold-startem #2): 15 lokalizacji (z `facilities.ts`), 36 pracowników (syntetyczni, PESEL generowany — nie realny), kwalifikacje, urlopy, szablony zapotrzebowania, **≥1 tydzień feasible + ≥1 przypadek infeasible** (do demonstracji jawnego raportowania niewykonalności G4 i samoleczenia AG3). Seed idempotentny (upsert po stabilnych id syntetycznych).

## 5. Pakiet Dowodowy Odbioru (Evidence Pack) — `data/m2-evidence/`

Budowany przyrostowo od D3, kompletny na D7:

- **Macierz odbioru a-f** — każdy punkt programu → konkretny artefakt/krok demo → status.
- **Zrzuty i nagrania** ekranu każdego z 5 journeyów (web-kit :3051, wzorzec z workflow raportów KM).
- **Linki do runów CI** (zielony `ci.yml`, artefakty Playwright) — dowód punktu d.
- **URL stagingu** (Cloudflare tunnel) + lista kont testowych — dowód punktu e.
- **Skrypt UAT** (kroki dla 4Mobility) + checklista wyników.
- **Znane ograniczenia + etapowość** (jawnie: pełna autonomia agenta i real-time zamiany → M3).
- **Szablon sign-off / protokołu odbioru** gotowy do podpisu.
- **Mapowanie wymaganie grantowe → krok demo** (z §2.1).

## 6. Ścieżka fallback (odporność demo, nie fikcja)

Na wypadek awarii solvera/stagingu w dniu odbioru:
- Prekomputowany, zaseedowany snapshot wykonalnego grafiku (możliwość załadowania zapisanego wyniku, gdy live-solve zawiedzie).
- Nagrany fallback demo (screen capture) każdego journeya jako ubezpieczenie sesji.
- Lokalny `docker compose up` jako droga awaryjna, jeśli auto-deploy/tunel padnie.
- Jawne: fallback = odporność prezentacji, **nie** udawana funkcjonalność.

## 7. Checklista RODO / bezpieczeństwo stagingu

- Asercja „tylko dane syntetyczne" — seed twardo odmawia PESEL spoza puli syntetycznej.
- Brak importu realnych danych 4Mobility na maszynę deva.
- Runner self-hosted: tylko `main`/`workflow_run`, nigdy fork-PR; user nieuprzywilejowany; klucz szyfrujący nie w logach.
- Lista kont testowych; polityka dostępu do tunelu; polityka czyszczenia po UAT.
- Obecność audytu przy generacji grafiku i zatwierdzeniu zamiany.

## 8. Harmonogram UAT (z roadmapy)
- D0-2: kryteria + sesja potwierdzenia wymagań (§2).
- D5: scenariusze + checklista gotowe; staging zaseedowany.
- D6: dry-run wewnętrzny, bugfix.
- D7 (17.07): sesja UAT #1 z 4Mobility; zebranie feedbacku; evidence pack kompletny.
- Weekend 18-19: iteracja feedbacku.
- D8 (20.07): demo finalne → protokół odbioru (2 moduły) + ew. uwagi/etapowość.

## 9. Kryteria akceptacji (odbiorowe)

| # | Kryterium | Weryfikacja |
|---|-----------|-------------|
| UAT1 | 5 journeyów J1-J5 przechodzi pass na stagingu z danymi syntetycznymi | sesja UAT + evidence |
| UAT2 | Evidence pack kompletny: macierz a-f, zrzuty, linki CI, URL, sign-off | przegląd `data/m2-evidence/` |
| UAT3 | Kryteria odbioru (§2.1) zmapowane 1:1 na artefakty; zero „reprezentowane ale niepotwierdzone" | macierz a-f |
| UAT4 | Ścieżka fallback zweryfikowana (drill offline na maszynie docelowej D6) | próba awaryjna |
| UAT5 | Etapowość (pilot b, minimalne c) zaakceptowana przez 4Mobility lub ujęta w protokole z uwagami | protokół |

## 10. Ryzyka
| Ryzyko | Mitygacja |
|--------|-----------|
| UAT za późno wykrywa rozjazd wymagań | sesja potwierdzenia wymagań w D0-2 (§2.2), nie dopiero D7 |
| Maszyna deva offline w sesji | fallback §6 + drill D6 |
| Protokół zakwestionuje głębię b/c | uzgodnienie §2 + evidence pack z jawną etapowością |
| Zły/nierealny syntetyk psuje demo | kanoniczny zbiór zamrożony D2, ≥1 feasible + 1 infeasible |
