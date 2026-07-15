# UAT — 5 krytycznych user-journey (J1–J5) + skrypt sesji

> Produktowy definition-of-done odbioru. Każdy journey: kroki + kryterium pass/fail + gdzie uchwycić dowód `[CAPTURE]`.
> Środowisko: front web-kit `http://localhost:5601` (lub URL tunelu środowiska testowego — generowany na czas sesji i przekazywany uczestnikom przed jej rozpoczęciem), backend stack `hrobot`. Konto testowe: `demo` / `demo-staging-2026` (rola ADMIN_KLIENTA), realm `hrobot-staging`.

## J1 — Menadżer tworzy/edytuje zapotrzebowanie
- Kroki: zaloguj → Grafik → wybierz jednostkę → dodaj/edytuj zapotrzebowanie (szablon → korekta).
- **Pass:** zapotrzebowanie zapisane i widoczne w siatce tygodnia. **Fail:** brak zapisu / błąd.
- `[CAPTURE]` screen siatki z zapotrzebowaniem.

## J2 — Menadżer generuje grafik (solver)
- Kroki: tydzień z zapotrzebowaniem (np. 13–19.07) → „Generuj grafik".
- **Pass:** wykonalny grafik w ≤ limit, `status OPTIMAL/FEASIBLE`, 0 naruszeń H1–H4. **Fail:** błąd / naruszenia / brak wyniku.
- Dowód techniczny (zweryfikowany 2026-07-11): `POST /api/grafik/solve {weekStart:"2026-07-13"}` → `201, status=OPTIMAL, unmet=0, commute=10025`.
- `[CAPTURE]` screen siatki z 52 AUTO-zmianami (badge AUTO).

## J3 — Menadżer inspekcjonuje metryki i koryguje ręcznie
- Kroki: obejrzyj pasek metryk (dojazdy/etaty) → przesuń/dodaj zmianę ręcznie (MANUAL).
- **Pass:** metryki widoczne; edycja ręczna trwała; ręczna zmiana nie jest kasowana przez re-solve (po PR #31 solve respektuje MANUAL jako zajętość). **Fail:** metryki puste / edycja gubiona.
- `[CAPTURE]` screen paska metryk + zmiany MANUAL.

## J4 — Agent AI proponuje grafik z uzasadnieniem; menadżer koryguje → agent się uczy
- Kroki: `http://localhost:8010/agent/demo` → „Reset & replay"; obejrzyj spadek edit-distance po feedbacku; `/agent/explain` = rationale.
- **Pass:** agent proponuje wykonalny grafik; po N rundach feedbacku mierzalny spadek korekt (AG2); rationale widoczne. **Fail:** brak uczenia / infeasible bez naprawy.
- Dowód: `agent-service/evidence/ag2_chart.svg`, `ag2_editdistance.csv` (w repo). **Ujęcie uczciwe:** mechanizm = affinity-learner + batch re-fit (NIE produkcyjny SB3/RL) — patrz `known-limitations.md`.
- `[CAPTURE]` screen strony demo + wykres AG2.

## J5 — Pracownik zgłasza zamianę → peer akceptuje → menadżer zatwierdza
- Kroki: zgłoś zamianę → peer accept → manager approve.
- **Pass:** happy-path DRAFT→APPROVED mutuje obie zmiany + audyt; zamiana łamiąca H1–H4/urlop (H3) odrzucona przez walidację solverem; menadżer spoza obu jednostek nie zatwierdzi (RBAC). **Fail:** reguły przechodzą / cross-unit approve.
- Stan: backend + walidacja naprawione i przetestowane (PR #31; 62/62 testów PASS, bieg 2026-07-14). UI Zamian podłączone do realnego API (`lib/swaps.ts` → `/api/shift-swap/*`, UI-1 domknięte 14.07) — J5 demonstrowalne w całości przez UI; seed `scripts/seed-demo-swap.sql` przygotowuje zamianę w stanie PENDING_MANAGER.
- `[CAPTURE]` przebieg przez UI (po podłączeniu) lub log API.

---

## Skrypt sesji UAT z 4Mobility (f)
1. Wstęp: zakres M2 (2 moduły a+b; c/d/e/f wspierające), dane syntetyczne (RODO).
2. Przejdź J1→J5 na stagingu, notuj pass/fail w tabeli poniżej.
3. Omów `known-limitations.md` jawnie (H5/H6 → M3; agent pilotowy; UI Zamian; CI).
4. Zbierz uwagi → protokół z uwagami (`protokol-odbioru-template.md`).

| Journey | Pass/Fail | Uwagi 4Mobility |
|---|:--:|---|
| J1 | ☐ | |
| J2 | ☐ | |
| J3 | ☐ | |
| J4 | ☐ | |
| J5 | ☐ | |

## Fallback (odporność demo, UAT4)
- Prekomputowany snapshot wykonalnego grafiku: `agent-service/fixtures/canonical_solution.json` (istnieje) — możliwość pokazania zapisanego wyniku, gdy live-solve zawiedzie.
- Nagrany fallback (screen capture) każdego journeya — `[CAPTURE]` przed sesją.
- Droga awaryjna: lokalny `docker start hrobot-*` jeśli auto-deploy/tunel padnie.
- **Drill offline** na maszynie docelowej przed sesją (zaplanowany).
